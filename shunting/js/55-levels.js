/* ============================================================================
   조차장 / SHUNTING — 55-levels.js
   레벨 팩(14) + 랜덤 생성기 + 일일 문제 + 진행도 저장.
   → SH.Levels
   SPEC.md §2.5 / §6 Levels 계약.
   ============================================================================ */

/* CONTRACT ────────────────────────────────────────────────────────────────
   SH.Levels.pack                  -> [levelDef, ...]   난이도 순 14개
   SH.Levels.count                 -> 14
   SH.Levels.get(i)                -> levelDef | null   (0-based 인덱스)
   SH.Levels.byId(id)              -> levelDef | null
   SH.Levels.indexOf(id)           -> int (-1)
   SH.Levels.clone(def)            -> levelDef 깊은 복사 (World/Puzzle 가 자유롭게 변형)

   SH.Levels.generate(seed, difficulty, opts) -> levelDef | null
        difficulty 0..1. SH.Puzzle.solve 로 검증하며 par 를 채워 반환.
        opts = { tries:40, budgetMs:1800, timeOfDay:Number }
        40회 안에 목표 par 대역을 못 맞추면 "풀리는 것 중 대역에 가장 가까운" 후보를
        돌려준다(par 는 언제나 실제 최적값). 단 한 개도 못 풀면 null.
   SH.Levels.daily(dateStr?)       -> levelDef      로컬 날짜(YYYY-MM-DD) 시드, 하루 고정
   SH.Levels.todayKey()            -> 'YYYY-MM-DD'

   SH.Levels.starsFor(moves, par)  -> 0..3           (SPEC §2.5)
   SH.Levels.progress.get(id)      -> { stars, best, done }
   SH.Levels.progress.set(id, {stars, best}) -> record   (stars 는 max, best 는 min 병합)
   SH.Levels.progress.record(id, moves, par) -> { stars, best, done, improved }
   SH.Levels.progress.all()        -> { id: record }
   SH.Levels.progress.totalStars() -> int  (팩 레벨 기준)
   SH.Levels.progress.cleared()    -> int
   SH.Levels.progress.unlocked(iOrId) -> bool   (앞 레벨 클리어 시 해금 / 0~2 는 항상)
   SH.Levels.progress.reset()
   저장 키: 'gamelab:shunting:prog'  (SH.U.store)

   SH.Levels.LIVERY                -> { key: '#rrggbb' }  SPEC §3.3 팔레트
   SH.Levels.TYPES                 -> ['box','open','tank','flat','hopper','brake']
   SH.Levels.colorDist(a,b)        -> 0..765 지각적 색거리(redmean)
   SH.Levels._verifyPack(opts)     -> [{ id, name, par, actual, ok, ms, warnings[] }]
        SH.Puzzle.solve 로 팩 전체의 하드코딩 par 를 재검증. 개발용(느림).

   이벤트: SH.Bus.emit('levels:progress', { id, record })

   의존: SH.U (로드 시), SH.Puzzle (generate/daily/_verifyPack 호출 시에만).
   로드 시점에 SH.Puzzle 를 건드리지 않는다.
   ────────────────────────────────────────────────────────────────────────── */

SH.Levels = (function () {
  'use strict';

  var U = SH.U;
  var STORE_KEY = 'gamelab:shunting:prog';

  /* ── 팔레트 (SPEC §3.3) ─────────────────────────────────────── */
  var LIVERY = {
    oxide:   '#9e3b2c',   // 산화철 적갈
    mustard: '#d99a26',   // 겨자
    pine:    '#3f6b4e',   // 짙은 녹
    cobalt:  '#2f5d97',   // 코발트
    cream:   '#d9cbb0',   // 크림
    slate:   '#4b5560'    // 슬레이트
  };
  /* 인접해도 확실히 구별되는 순회 순서. 이웃 간 최소 색거리 163. */
  var LIV_CYCLE = ['oxide', 'cobalt', 'cream', 'pine', 'mustard', 'slate'];
  var TYPES = ['box', 'open', 'tank', 'flat', 'hopper', 'brake'];

  /** redmean 근사 색거리. 0..~765. 130 미만이면 "붙여 놓으면 헷갈린다". */
  function colorDist(a, b) {
    var A = U.rgb(a), B = U.rgb(b);
    var rm = (A.r + B.r) * 0.5, dr = A.r - B.r, dg = A.g - B.g, db = A.b - B.b;
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  }
  var MIN_DIST = 130;      // 인접 화차 최소 색거리
  var TYPE_FORCE = 200;    // 이보다 가까우면 실루엣(타입)이 반드시 달라야 함

  /* ── levelDef 빌더 ──────────────────────────────────────────── */

  function tracksOf(headCap, sidCaps, exitCap) {
    var a = [{ id: 'HEAD', kind: 'head', capacity: headCap }];
    for (var i = 0; i < sidCaps.length; i++) {
      a.push({ id: 'S' + (i + 1), kind: 'siding', capacity: sidCaps[i] });
    }
    a.push({ id: 'EXIT', kind: 'exit', capacity: exitCap });
    return a;
  }

  /** 'a oxide box' 형태 문자열 배열 → wagon 객체 배열 */
  function wagonsOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i].split(/\s+/);
      out.push({ id: p[0], type: p[2], livery: LIVERY[p[1]] || p[1], liveryKey: p[1] });
    }
    return out;
  }

  /** {S1:'da', S2:'c'} + 트랙목록 → 완전한 start 객체 */
  function startOf(tracks, spec) {
    var s = {};
    for (var i = 0; i < tracks.length; i++) {
      var id = tracks[i].id;
      var v = spec[id];
      s[id] = !v ? [] : (typeof v === 'string' ? v.split('') : v.slice());
    }
    s.at = spec.at || 'HEAD';
    if (spec.consist) s.consist = typeof spec.consist === 'string' ? spec.consist.split('') : spec.consist.slice();
    return s;
  }

  function def(o) {
    var tr = tracksOf(o.head, o.sid, o.exit);
    return {
      id: o.id,
      name: o.name,
      tracks: tr,
      wagons: wagonsOf(o.w),
      start: startOf(tr, o.start),
      target: typeof o.target === 'string' ? o.target.split('') : o.target.slice(),
      par: o.par,
      timeOfDay: o.tod,
      hint: o.hint,
      generated: false
    };
  }

  function clone(d) {
    if (!d) return null;
    var i, t = [];
    for (i = 0; i < d.tracks.length; i++) {
      t.push({ id: d.tracks[i].id, kind: d.tracks[i].kind, capacity: d.tracks[i].capacity });
    }
    var w = [];
    for (i = 0; i < d.wagons.length; i++) {
      var s = d.wagons[i];
      w.push({ id: s.id, type: s.type, livery: s.livery, liveryKey: s.liveryKey });
    }
    var st = {};
    for (var k in d.start) {
      st[k] = (d.start[k] && d.start[k].slice) ? d.start[k].slice() : d.start[k];
    }
    return {
      id: d.id, name: d.name, tracks: t, wagons: w, start: st,
      target: d.target.slice(), par: d.par, timeOfDay: d.timeOfDay,
      hint: d.hint, generated: !!d.generated
    };
  }

  /* ── 레벨 팩 ────────────────────────────────────────────────────
     par 는 전부 BFS 최적해로 사전 검증됨 (_verifyPack 로 재확인 가능).
     timeOfDay: 0 새벽 · 0.5 정오 · 1 밤.  1→14 로 아침→낮→노을→밤.
     리버리는 인접(목표 순서·같은 측선 위아래) 색거리 ≥163 을 만족하도록 배치했고,
     타입(실루엣)도 서로 다르게 섞어 색약 대비를 확보했다.
     ───────────────────────────────────────────────────────────── */

  var PACK_SRC = [
    /* ── 1~3 튜토리얼: 화차 2~3량, 측선 2개 ── */
    {
      id: 'sh-01', name: '아침 첫 입환', tod: 0.06,
      head: 4, sid: [4, 4], exit: 6,
      w: ['a oxide box', 'b cream tank'],
      start: { S1: 'ab', at: 'HEAD' },
      target: 'ab', par: 3,
      hint: '측선의 화차를 그대로 물고 출발선까지 밀어 넣으면 됩니다.'
    },
    {
      id: 'sh-02', name: '거꾸로 선 두 량', tod: 0.12,
      head: 4, sid: [4, 4], exit: 6,
      w: ['a cobalt open', 'b mustard hopper'],
      start: { S1: 'ab', at: 'HEAD' },
      target: 'ba', par: 5,
      hint: '측선은 막다른 스택입니다. 순서를 뒤집으려면 한 량씩 나눠 밀어 넣으세요.'
    },
    {
      id: 'sh-03', name: '끊고 붙이기', tod: 0.18,
      head: 4, sid: [4, 4], exit: 6,
      w: ['a oxide box', 'b cream tank', 'c cobalt flat'],
      start: { S1: 'ba', S2: 'c', at: 'HEAD' },
      target: 'abc', par: 6,
      hint: '연결기를 눌러 원하는 지점에서 끊으세요. 끊기는 이동 수에 포함되지 않습니다.'
    },

    /* ── 4~7 화차 4~5량, 측선 3개, par 6~9 ── */
    {
      id: 'sh-04', name: '세 갈래 측선', tod: 0.26,
      head: 4, sid: [4, 4, 4], exit: 6,
      w: ['a oxide box', 'b cream tank', 'c cobalt hopper', 'd mustard open'],
      start: { S1: 'da', S2: 'c', S3: 'b', at: 'HEAD' },
      target: 'dbca', par: 6,
      hint: '빈 측선은 임시 보관소입니다. 아깝다고 아끼지 마세요.'
    },
    {
      id: 'sh-05', name: '자갈 열차', tod: 0.34,
      head: 4, sid: [4, 4, 4], exit: 6,
      w: ['a oxide flat', 'b cobalt box', 'c cream tank', 'd mustard hopper'],
      start: { S1: 'db', S2: 'c', S3: 'a', at: 'HEAD' },
      target: 'cbad', par: 7,
      hint: '맨 뒤에 설 화차부터 출발선에 넣어야 합니다. 조성은 거꾸로 생각하세요.'
    },
    {
      id: 'sh-06', name: '석탄 열차', tod: 0.42,
      head: 4, sid: [4, 4, 4], exit: 7,
      w: ['a oxide open', 'b cream hopper', 'c cobalt box', 'd mustard flat', 'e pine tank'],
      start: { S1: 'ae', S2: 'cb', S3: 'd', at: 'HEAD' },
      target: 'edbca', par: 8,
      hint: '한 번 들어간 측선에서 다시 꺼내면 순서가 뒤집힙니다.'
    },
    {
      id: 'sh-07', name: '정오의 조성', tod: 0.50,
      head: 4, sid: [4, 4, 4], exit: 7,
      w: ['a cream box', 'b oxide tank', 'c mustard open', 'd cobalt flat', 'e slate brake'],
      start: { S1: 'ec', S3: 'dab', at: 'HEAD' },
      target: 'eacdb', par: 9,
      hint: '비어 있는 2번선을 어떻게 쓰느냐로 두세 수가 갈립니다.'
    },

    /* ── 8~11 인상선 용량 3 (기관차 포함) — 한 번에 2량까지, par 10~13 ── */
    {
      id: 'sh-08', name: '짧은 인상선', tod: 0.58,
      head: 3, sid: [4, 4, 4], exit: 7,
      w: ['a oxide box', 'b cream flat', 'c cobalt tank', 'd mustard hopper', 'e pine open'],
      start: { S1: 'de', S2: 'a', S3: 'cb', at: 'HEAD' },
      target: 'acdbe', par: 10,
      hint: '인상선에 기관차 포함 3량까지. 한 번에 2량씩만 옮길 수 있습니다.'
    },
    {
      id: 'sh-09', name: '유조 화차 분리', tod: 0.66,
      head: 3, sid: [4, 4, 4], exit: 7,
      w: ['a slate brake', 'b oxide tank', 'c cream box', 'd cobalt open', 'e mustard tank'],
      start: { S1: 'dce', S2: 'ba', at: 'HEAD' },
      target: 'bcdea', par: 11,
      hint: '유조차 두 량을 떼어 놓을 자리를 먼저 만들어 두세요.'
    },
    {
      id: 'sh-10', name: '노을 진 조차장', tod: 0.74,
      head: 3, sid: [4, 4, 4], exit: 8,
      w: ['a pine hopper', 'b cobalt box', 'c cream tank', 'd mustard flat', 'e slate open', 'f oxide brake'],
      start: { S1: 'ecd', S2: 'af', S3: 'b', at: 'HEAD' },
      target: 'acbdef', par: 12,
      hint: '차장차(맨 끝 화차)를 가장 먼저 출발선에 넣어 두면 편합니다.'
    },
    {
      id: 'sh-11', name: '막차 준비', tod: 0.82,
      head: 3, sid: [4, 4, 4], exit: 8,
      w: ['a slate brake', 'b pine hopper', 'c cobalt tank', 'd cream box', 'e mustard open', 'f oxide flat'],
      start: { S1: 'df', S2: 'bec', S3: 'a', at: 'HEAD' },
      target: 'adcebf', par: 13,
      hint: '2번선을 통째로 비워야 숨통이 트입니다.'
    },

    /* ── 12~14 측선 용량 비대칭 + 인상선 3, par 14~19 ── */
    {
      id: 'sh-12', name: '좁은 1번선', tod: 0.90,
      head: 3, sid: [3, 4, 4], exit: 8,
      w: ['a slate brake', 'b oxide box', 'c pine hopper', 'd mustard flat', 'e cream tank', 'f cobalt open'],
      start: { S1: 'ad', S2: 'f', S3: 'ceb', at: 'HEAD' },
      target: 'aecdfb', par: 14,
      hint: '1번선에는 화차 두 량밖에 못 섭니다. 좁은 선을 언제 비울지가 전부입니다.'
    },
    {
      id: 'sh-13', name: '야간 조성', tod: 0.96,
      head: 3, sid: [3, 5, 4], exit: 9,
      w: ['a slate flat', 'b pine tank', 'c cobalt open', 'd mustard hopper', 'e cream box',
        'f oxide brake', 'g oxide box'],
      start: { S1: 'ce', S2: 'dfbg', S3: 'a', at: 'HEAD' },
      target: 'bdaefcg', par: 16,
      hint: '램프가 켜졌습니다. 넓은 2번선을 중간 야적장처럼 쓰세요.'
    },
    {
      id: 'sh-14', name: '마지막 열차', tod: 1.00,
      head: 3, sid: [3, 5, 4], exit: 10,
      w: ['a mustard box', 'b slate flat', 'c oxide tank', 'd cobalt hopper', 'e pine brake',
        'f cream open', 'g cobalt open', 'h cream box'],
      start: { S1: 'dc', S2: 'feag', S3: 'bh', at: 'HEAD' },
      target: 'bfdaehcg', par: 19,
      hint: '여덟 량. 왕도는 없습니다 — 두 량씩, 끝에서부터 쌓으세요.'
    }
  ];

  var PACK = (function () {
    var out = [];
    for (var i = 0; i < PACK_SRC.length; i++) {
      try { out.push(def(PACK_SRC[i])); } catch (e) { U.err(e); }
    }
    return out;
  })();

  function indexOf(id) {
    for (var i = 0; i < PACK.length; i++) if (PACK[i].id === id) return i;
    return -1;
  }
  function byId(id) { var i = indexOf(id); return i < 0 ? null : PACK[i]; }
  function get(i) { return (i >= 0 && i < PACK.length) ? PACK[i] : null; }

  /* ── 리버리/타입 배정 (생성기용) ────────────────────────────── */

  /** 목표 순서 + 각 측선 스택에서 "서로 붙어 서는" 쌍 목록 */
  function adjacentPairs(target, stacks) {
    var pairs = [], i, j, s;
    for (i = 1; i < target.length; i++) pairs.push([target[i - 1], target[i]]);
    for (j = 0; j < stacks.length; j++) {
      s = stacks[j];
      for (i = 1; i < s.length; i++) pairs.push([s[i - 1], s[i]]);
    }
    return pairs;
  }

  function dealCycle(rng, n, arr) {
    var out = [], pool = [];
    while (out.length < n) {
      if (!pool.length) pool = U.shuffle(rng, arr);
      out.push(pool.pop());
    }
    return out;
  }

  /**
   * 화차별 {livery, type} 배정.
   * 인접 쌍의 색거리를 최대화하고, 가까운 색끼리는 실루엣을 강제로 다르게 한다.
   */
  function dress(seed, ids, target, stacks) {
    var rng = U.rng('dress|' + seed);
    var pairs = adjacentPairs(target, stacks);
    var idx = {}, i;
    for (i = 0; i < ids.length; i++) idx[ids[i]] = i;

    var best = null, bestScore = -Infinity;
    for (var it = 0; it < 260; it++) {
      var liv = dealCycle(rng, ids.length, LIV_CYCLE);
      var typ = dealCycle(rng, ids.length, TYPES);
      var minD = 765, bad = 0, k;
      for (k = 0; k < pairs.length; k++) {
        var A = idx[pairs[k][0]], B = idx[pairs[k][1]];
        if (A === undefined || B === undefined) continue;
        var d = (liv[A] === liv[B]) ? 0 : colorDist(LIVERY[liv[A]], LIVERY[liv[B]]);
        if (d < minD) minD = d;
        if (d < TYPE_FORCE && typ[A] === typ[B]) bad++;
      }
      // 같은 도색 + 같은 형식인 쌍은 어디에 있든 금지 (구별 불가)
      for (k = 0; k < ids.length; k++) {
        for (var m = k + 1; m < ids.length; m++) {
          if (liv[k] === liv[m] && typ[k] === typ[m]) bad++;
        }
      }
      var score = minD - bad * 500;
      if (score > bestScore) { bestScore = score; best = { liv: liv, typ: typ }; }
      if (minD >= MIN_DIST && !bad) break;
    }

    var out = [];
    for (i = 0; i < ids.length; i++) {
      out.push({ id: ids[i], type: best.typ[i], livery: LIVERY[best.liv[i]], liveryKey: best.liv[i] });
    }
    return out;
  }

  /* ── 생성기 ─────────────────────────────────────────────────── */

  var WAGON_IDS = 'abcdefgh'.split('');

  /* 화차 수별 목표 par 대역 (경험적으로 측정한 분포 기준) */
  var PAR_BAND = { 3: [5, 7], 4: [6, 9], 5: [8, 11], 6: [11, 14], 7: [13, 17], 8: [16, 21] };

  function cfgFor(d) {
    d = U.clamp01(d);
    var n = 3 + Math.round(d * 5);                       // 3 → 8량
    var sidings = d < 0.22 ? 2 : 3;
    var head = d < 0.40 ? 4 : 3;                         // 기관차 포함
    var sid = [];
    if (d < 0.62) {
      for (var i = 0; i < sidings; i++) sid.push(4);
    } else {
      var asym = [3, 5, 4];
      for (var j = 0; j < sidings; j++) sid.push(asym[j % 3]);
    }
    // 화차가 다 들어갈 자리는 반드시 확보
    var slots = 0, k;
    for (k = 0; k < sid.length; k++) slots += sid[k] - 1;
    while (slots < n) { sid[sid.length - 1]++; slots++; }
    var band = PAR_BAND[n] || [8, 14];
    var lo = band[0] + (head === 3 ? 1 : 0);
    var hi = band[1] + (head === 3 ? 1 : 0);
    return { n: n, head: head, sid: sid, exit: n + 2, lo: lo, hi: hi };
  }

  /** 랜덤 배치 1회. 아직 par 는 없다. */
  function layout(rng, cfg, id, name, tod) {
    var ids = WAGON_IDS.slice(0, cfg.n);
    var tr = tracksOf(cfg.head, cfg.sid, cfg.exit);
    var sidIds = [];
    for (var i = 0; i < cfg.sid.length; i++) sidIds.push('S' + (i + 1));

    var order = U.shuffle(rng, ids);
    var stacks = {};
    for (i = 0; i < sidIds.length; i++) stacks[sidIds[i]] = [];
    for (i = 0; i < order.length; i++) {
      var cand = [];
      for (var j = 0; j < sidIds.length; j++) {
        if (stacks[sidIds[j]].length < cfg.sid[j] - 1) cand.push(sidIds[j]);
      }
      if (!cand.length) return null;
      stacks[U.pick(rng, cand)].push(order[i]);
    }
    // 최소 두 개의 측선은 써야 문제가 된다
    var used = 0;
    for (i = 0; i < sidIds.length; i++) if (stacks[sidIds[i]].length) used++;
    if (used < 2 && sidIds.length > 1) return null;

    var target = U.shuffle(rng, ids);

    var stackArr = [];
    for (i = 0; i < sidIds.length; i++) stackArr.push(stacks[sidIds[i]]);
    var wagons = dress(id + '|' + target.join(''), ids, target, stackArr);

    var start = {};
    for (i = 0; i < tr.length; i++) start[tr[i].id] = [];
    for (i = 0; i < sidIds.length; i++) start[sidIds[i]] = stacks[sidIds[i]].slice();
    start.at = 'HEAD';

    return {
      id: id, name: name, tracks: tr, wagons: wagons, start: start,
      target: target, par: 0, timeOfDay: tod, hint: '', generated: true
    };
  }

  function solvePar(d) {
    var P = SH.Puzzle;
    if (!P || !P.create || !P.solve) return null;
    var st = P.create(d);
    var sol = P.solve(st, d.target, {});
    if (!sol) return null;
    return (typeof sol.gos === 'number') ? sol.gos
      : (sol.moves ? countGos(sol.moves) : null);
  }
  function countGos(moves) {
    var c = 0;
    for (var i = 0; i < moves.length; i++) if (moves[i] && moves[i].type === 'go') c++;
    return c;
  }

  var GEN_HINTS = [
    '급할수록 빈 측선을 먼저 만드세요.',
    '맨 뒤에 설 화차부터 출발선에 넣습니다.',
    '측선은 막다른 스택 — 넣은 순서의 반대로 나옵니다.',
    '인상선 용량을 넘기는 절단은 아예 시작할 수 없습니다.',
    '끊기는 공짜입니다. 이동만 셉니다.'
  ];

  /**
   * @param seed  숫자 또는 문자열
   * @param difficulty 0..1
   * @param opts { tries, budgetMs, name, id, timeOfDay, hint }
   */
  function generate(seed, difficulty, opts) {
    opts = opts || {};
    var cfg = cfgFor(difficulty == null ? 0.5 : difficulty);
    var tries = opts.tries || 40;
    var budget = opts.budgetMs == null ? 1800 : opts.budgetMs;
    var t0 = U.now();
    var id = opts.id || ('gen-' + U.hash(String(seed) + '|' + cfg.n));
    var name = opts.name || '생성된 조차 #' + (U.hash(String(seed)) % 900 + 100);
    var tod = opts.timeOfDay;
    if (tod == null) tod = U.clamp01(0.10 + U.clamp01(difficulty) * 0.85);

    var best = null, bestGap = Infinity;
    for (var i = 0; i < tries; i++) {
      var rng = U.rng(String(seed) + '#' + i);
      var d;
      try { d = layout(rng, cfg, id, name, tod); } catch (e) { U.err(e); d = null; }
      if (!d) continue;
      var par;
      try { par = solvePar(d); } catch (e) { U.err(e); par = null; }
      if (par == null || par <= 0) continue;
      d.par = par;
      d.hint = opts.hint || GEN_HINTS[U.hash(id + i) % GEN_HINTS.length];
      if (par >= cfg.lo && par <= cfg.hi) return d;
      var gap = par < cfg.lo ? (cfg.lo - par) : (par - cfg.hi);
      if (gap < bestGap) { bestGap = gap; best = d; }
      if (U.now() - t0 > budget) break;
    }
    return best;
  }

  function todayKey(dt) {
    var d = dt || new Date();
    function p2(v) { return v < 10 ? '0' + v : '' + v; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  /* 요일별 난이도 (월 쉬움 → 토 어려움, 일 중간) */
  var DAILY_D = [0.55, 0.38, 0.47, 0.56, 0.65, 0.74, 0.86];
  var dailyCache = null;

  function daily(dateStr) {
    var key = dateStr || todayKey();
    if (dailyCache && dailyCache.key === key) return dailyCache.def;
    var parts = key.split('-');
    var dt = new Date(+parts[0], (+parts[1]) - 1, +parts[2]);
    var dow = isNaN(dt.getDay()) ? 3 : dt.getDay();
    var d = generate('daily|' + key, DAILY_D[dow], {
      id: 'daily-' + key,
      name: '오늘의 조차 (' + (+parts[1]) + '월 ' + (+parts[2]) + '일)',
      timeOfDay: 0.10 + ((U.hash(key) % 1000) / 1000) * 0.85,
      tries: 40,
      budgetMs: 2600
    });
    if (d) { d.daily = true; dailyCache = { key: key, def: d }; }
    return d;
  }

  /* ── 진행도 ─────────────────────────────────────────────────── */

  function starsFor(moves, par) {
    if (!(moves > 0)) return 0;
    if (moves <= par) return 3;
    if (moves <= par + 2) return 2;
    return 1;
  }

  var cache = null;
  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = U.store(STORE_KEY); } catch (e) { U.err(e); }
    if (!raw || typeof raw !== 'object' || !raw.lv) raw = { v: 1, lv: {} };
    cache = raw;
    return cache;
  }
  function save() {
    try { U.store(STORE_KEY, load()); } catch (e) { U.err(e); }
  }

  var EMPTY = { stars: 0, best: 0, done: false };

  function progGet(id) {
    var r = load().lv[id];
    if (!r) return { stars: 0, best: 0, done: false };
    return { stars: r.s | 0, best: r.b | 0, done: (r.s | 0) > 0 };
  }

  function progSet(id, rec) {
    rec = rec || {};
    var db = load();
    var cur = db.lv[id] || { s: 0, b: 0 };
    var stars = Math.max(cur.s | 0, rec.stars | 0);
    var best = rec.best > 0 ? (cur.b > 0 ? Math.min(cur.b, rec.best) : rec.best) : (cur.b | 0);
    db.lv[id] = { s: stars, b: best };
    save();
    var out = { stars: stars, best: best, done: stars > 0 };
    try { SH.Bus.emit('levels:progress', { id: id, record: out }); } catch (e) { U.err(e); }
    return out;
  }

  function progRecord(id, moves, par) {
    var before = progGet(id);
    var stars = starsFor(moves, par);
    var out = progSet(id, { stars: stars, best: moves });
    out.improved = (stars > before.stars) || (before.best === 0) || (moves < before.best);
    return out;
  }

  function progAll() {
    var db = load(), out = {};
    for (var k in db.lv) out[k] = { stars: db.lv[k].s | 0, best: db.lv[k].b | 0, done: (db.lv[k].s | 0) > 0 };
    return out;
  }

  function totalStars() {
    var db = load(), n = 0;
    for (var i = 0; i < PACK.length; i++) {
      var r = db.lv[PACK[i].id];
      if (r) n += r.s | 0;
    }
    return n;
  }

  function clearedCount() {
    var db = load(), n = 0;
    for (var i = 0; i < PACK.length; i++) {
      var r = db.lv[PACK[i].id];
      if (r && (r.s | 0) > 0) n++;
    }
    return n;
  }

  /** 앞 레벨을 클리어하면 해금. 1~3(index 0~2)은 항상 열려 있다. */
  function unlocked(iOrId) {
    var i = (typeof iOrId === 'number') ? iOrId : indexOf(iOrId);
    if (i < 0) return true;              // 생성 레벨·일일 문제는 제한 없음
    if (i <= 2) return true;
    var prev = PACK[i - 1];
    return prev ? progGet(prev.id).done : true;
  }

  function progReset() {
    cache = { v: 1, lv: {} };
    save();
    try { SH.Bus.emit('levels:progress', { id: null, record: null }); } catch (e) { U.err(e); }
  }

  /* ── 팩 검증 (개발용) ───────────────────────────────────────── */

  /**
   * 팩 전체의 하드코딩 par 를 SH.Puzzle.solve 로 재계산해 비교한다.
   * 색/실루엣 구별 경고도 함께 반환. 느리므로 런타임 경로에서 부르지 말 것.
   * @param opts { from, to }  일부 구간만 검사
   */
  function verifyPack(opts) {
    opts = opts || {};
    var from = opts.from == null ? 0 : opts.from;
    var to = opts.to == null ? PACK.length : opts.to;
    var out = [];
    for (var i = from; i < to && i < PACK.length; i++) {
      var d = PACK[i];
      var row = { id: d.id, name: d.name, par: d.par, actual: null, ok: false, ms: 0, warnings: [] };
      var t0 = U.now();
      try {
        row.actual = solvePar(clone(d));
      } catch (e) { U.err(e); row.warnings.push('solve 예외: ' + e); }
      row.ms = Math.round(U.now() - t0);
      row.ok = (row.actual === d.par);
      if (row.actual == null) row.warnings.push('해가 없거나 SH.Puzzle 미로드');
      // 색/실루엣 구별 검사
      var byIdMap = {}, k;
      for (k = 0; k < d.wagons.length; k++) byIdMap[d.wagons[k].id] = d.wagons[k];
      var stacks = [];
      for (k = 0; k < d.tracks.length; k++) {
        var t = d.tracks[k];
        if (t.kind === 'siding' && d.start[t.id] && d.start[t.id].length) stacks.push(d.start[t.id]);
      }
      var pairs = adjacentPairs(d.target, stacks);
      for (k = 0; k < pairs.length; k++) {
        var A = byIdMap[pairs[k][0]], B = byIdMap[pairs[k][1]];
        if (!A || !B) { row.warnings.push('알 수 없는 화차 id: ' + pairs[k].join(',')); continue; }
        var dist = (A.livery === B.livery) ? 0 : colorDist(A.livery, B.livery);
        if (dist < MIN_DIST) row.warnings.push('인접 색 근접 ' + A.id + '/' + B.id + ' = ' + Math.round(dist));
        if (dist < TYPE_FORCE && A.type === B.type) {
          row.warnings.push('인접 색+형식 동일 ' + A.id + '/' + B.id);
        }
      }
      for (k = 0; k < d.wagons.length; k++) {
        for (var m = k + 1; m < d.wagons.length; m++) {
          if (d.wagons[k].livery === d.wagons[m].livery && d.wagons[k].type === d.wagons[m].type) {
            row.warnings.push('완전 동일 외형 ' + d.wagons[k].id + '/' + d.wagons[m].id);
          }
        }
      }
      // 자리 수 검사
      var slots = 0;
      for (k = 0; k < d.tracks.length; k++) {
        if (d.tracks[k].kind === 'siding') slots += d.tracks[k].capacity - 1;
      }
      if (slots < d.wagons.length) row.warnings.push('측선 용량 부족');
      var exitCap = 0;
      for (k = 0; k < d.tracks.length; k++) if (d.tracks[k].id === 'EXIT') exitCap = d.tracks[k].capacity;
      if (exitCap < d.wagons.length + 1) row.warnings.push('EXIT 용량 부족');
      if (d.target.length !== d.wagons.length) row.warnings.push('target 길이 불일치');
      out.push(row);
    }
    return out;
  }

  /* ── public ─────────────────────────────────────────────────── */
  return {
    pack: PACK,
    count: PACK.length,
    get: get,
    byId: byId,
    indexOf: indexOf,
    clone: clone,

    generate: generate,
    daily: daily,
    todayKey: todayKey,

    starsFor: starsFor,
    progress: {
      get: progGet,
      set: progSet,
      record: progRecord,
      all: progAll,
      totalStars: totalStars,
      cleared: clearedCount,
      unlocked: unlocked,
      reset: progReset,
      KEY: STORE_KEY
    },

    LIVERY: LIVERY,
    TYPES: TYPES,
    colorDist: colorDist,
    _verifyPack: verifyPack
  };
})();
