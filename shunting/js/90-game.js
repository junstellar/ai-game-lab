/* ============================================================================
   조차장 / SHUNTING — 90-game.js   →  SH.Game
   부팅 · 상태 머신 · 모듈 접착제 · 스크린샷 API
   ----------------------------------------------------------------------------
   CONTRACT (공개 API)

   SH.Game.boot(canvasEl)          부팅 시작 (index.html 이 1회 호출)
   SH.Game.phase                   'BOOT'|'TITLE'|'PLAY'|'ANIM'|'WIN'  (읽기 전용)
   SH.Game.quality                 0|1|2
   SH.Game.state                   현재 Puzzle 상태 (읽기 전용으로 취급할 것)
   SH.Game.level                   현재 levelDef
   SH.Game.levelIndex              현재 레벨 인덱스
   SH.Game.world                   SH.World.build 결과
   SH.Game.go(trackId)             트랙 이동 시도 (Input/UI 대신 호출 가능)
   SH.Game.cut(k)                  분리 시도
   SH.Game.undo() / .restart() / .hint() / .next()
   SH.Game.loadLevel(i)            레벨 교체
   SH.Game.setQuality(q)           같은 티어면 무시. 플레이 중이면 선컴파일 뒤 적용(비동기).
   SH.Game.isBusy()                애니메이션 중이면 true
   SH.Game.rules(open)             규칙 카드 열기/닫기 (UI.rules 가 없으면 토스트로 대체)
   SH.Game.tutorialSkip()          현재 레벨 튜토리얼 건너뛰기
   SH.Game.fresh                   ?fresh=1 로 열렸는가 (읽기 전용)

   ----------------------------------------------------------------------------
   온보딩 (ONBOARDING.md) — Game 이 UI 에 흘려보내는 것

   UI.labels(list)     매 프레임. [{id,name,key,x,y,visible,state,reason,count,cap}]
                       state = 'active'|'here'|'blocked', x/y = CSS px
   UI.consist(list,h)  상태가 바뀔 때. [{id,type,livery}] 서→동, 기관차 제외.
                       h.onCut(k) → Puzzle.cut → Motion 분리 연출
   UI.tutorial(step)   {id,level,index,total,k,text,anchor,at,art,arrow,ok,force} | null
                       hooks.onTutorialSkip() = 이 레벨 안내 종료 / onTutorialNext() = 다음 단계
   UI.rules(open)      hooks.onRules() / '?' 키
   UI.hintPulse(t)     승리 직전 인상선 강조
   전부 **선택 훅**이다 — UI 에 그 함수가 없으면 조용히 건너뛴다.

   ?fresh=1  저장된 판·진행도·튜토리얼 기록을 무시하고 처음 상태로 연다(쓰기도 막는다).

   window.__SHOT = { ready, pose(name), level(i), step(ms), hideUI(b), info() }
      SPEC §7. `?shot=1` 이면 자동 저장을 무시하고 결정론 모드로 동작한다
      (rAF 루프는 시뮬레이션을 진행시키지 않고, step() 만 시간을 진행시킨다).

   ----------------------------------------------------------------------------
   다른 모듈이 알아야 할 것

   1) Motion.execute(state, move, done)
      · state = **이동 직전** 상태 (지금 화면에 배치되어 있는 상태)
      · move  = { type:'go',  track, trackId, to, from, prev, next }
                { type:'cut', k, keep, track,          prev, next }
        - track/trackId/to : 목적지 트랙 id (문자열, 세 이름 모두 같은 값)
        - from             : 출발 트랙 id
        - prev / next      : 이동 전/후 Puzzle 상태 객체 (원하면 참고)
      · done() 을 정지 시점에 호출. 호출하지 않으면 Game 이 워치독(go 14s / cut 3s,
        시뮬레이션 시간)으로 강제 종료하고 Motion.snap 으로 배치를 맞춘다.

   2) 접촉 연출: Motion 이 `SH.Bus.emit('impact', {pos, speed})` 를 쏘면
      Game 이 Render.shake + FX.impact + Audio.play('clank') 를 붙인다.
      쏘지 않으면 Game 이 정지 시점에 Audio.play('couple') 로 대체한다.

   3) Game 이 쏘는 이벤트 (SH.Bus):
      'game:phase'(phase) 'game:level'({index,def,state}) 'game:state'({state})
      'game:reject'({track,reason}) 'game:hint'({type,track,k})
      'game:pulseTrack'(trackId) 'game:win'(result) 'game:quality'(q)
      'game:rest'({state,move}) 'game:hoverTrack'({track,legal})
      'game:hintReady'(bool)   힌트가 지금 즉답 가능한가 (Puzzle.hintReady)

   4) Puzzle 상태에 `_cap`(트랙별 정원) 과 `_target`(목표 배열) 을 덧붙여 둔다.
      Puzzle.clone 이 알 수 없는 필드를 지우지 않는다고 가정한다 (지워져도 Game 이 다시 채움).

   5) 선택 훅 — 있으면 쓰고 없으면 조용히 건너뛴다:
      UI.tick(dt) · UI.pulse(id) · UI.hint(id) · UI.reject(id) · UI.shake(id) ·
      UI.hide(b) · Input.highlight(id) · Input.setEnabled(b)
      UI.isModalOpen() -> bool   카드(도움말/레벨 선택/승리)가 떠 있는가.
                                 없으면 Game 이 오버레이의 .is-on 클래스로 판정한다.
      UI.setHintReady(b)         힌트 버튼 활성/스피너. 없으면 Game 이 .sh-hint 의
                                 aria-disabled 를 직접 토글한다(같은 CSS 규칙을 쓴다).
   ============================================================================ */
SH.Game = (function () {
  'use strict';

  var SH = window.SH, U = SH.U;

  /* ── 상수 ─────────────────────────────────────────────────── */

  var SAVE_KEY = 'gamelab:shunting:save';
  var PROG_KEY = 'gamelab:shunting:prog.game';   // Levels.progress 가 없을 때만 사용
  var MUTE_KEY = 'gamelab:shunting:mute';
  var GAME_ID  = 'shunting';

  var TUT_KEY  = 'gamelab:shunting:tut.game';    // 튜토리얼을 끝낸 레벨 id 기록

  var TRACK_KO = { HEAD: '인상선', EXIT: '출발선', S1: '측선 1', S2: '측선 2', S3: '측선 3' };
  var TRACK_ORDER = ['S1', 'S2', 'S3', 'EXIT', 'HEAD'];

  /* 선로 이름표에 붙는 **짧은** 사유 (ONBOARDING §Game). 거절 토스트에 쓰는 긴 문장은
     reasonText 가 따로 만든다 — 라벨은 한 줄 안에 들어가야 한다. */
  var LABEL_REASON = {
    'same': '기관차가 이미 여기 있습니다',
    'head-full': '인상선에 다 들어가지 않습니다',
    'track-full': '이 선로가 가득 찼습니다'
  };
  /* Input.trackKeys 가 아직 없을 때만 쓰는 숫자키 표시 (매핑 자체는 Input 소유) */
  var TRACK_KEY_FALLBACK = { S1: 1, S2: 2, S3: 3, EXIT: 4, HEAD: 5 };

  var RULES_FALLBACK =
    '선로를 탭하면 기관차가 그 선의 화차를 전부 물고 옵니다. ✂ 로 원하는 만큼 떼어 놓고, ' +
    '목표 순서대로 출발선에 남긴 뒤 기관차만 출발선 밖으로 빼면 끝!';

  /* Levels 모듈이 죽어도 화면은 보여야 한다 — 최소 레벨 1개 */
  var FALLBACK_LEVEL = {
    id: 'fallback-1', name: '시운전',
    tracks: [
      { id: 'HEAD', kind: 'head',   capacity: 4 },
      { id: 'S1',   kind: 'siding', capacity: 4 },
      { id: 'S2',   kind: 'siding', capacity: 4 },
      { id: 'S3',   kind: 'siding', capacity: 4 },
      { id: 'EXIT', kind: 'exit',   capacity: 7 }
    ],
    wagons: [
      { id: 'a', type: 'box',    livery: '#9e3b2c' },
      { id: 'b', type: 'tank',   livery: '#4b5560' },
      { id: 'c', type: 'open',   livery: '#3f6b4e' },
      { id: 'd', type: 'hopper', livery: '#d99a26' },
      { id: 'e', type: 'flat',   livery: '#d9cbb0' },
      { id: 'f', type: 'brake',  livery: '#2f5d97' }
    ],
    start: { HEAD: [], S1: ['a', 'b'], S2: ['c', 'd'], S3: ['e', 'f'], EXIT: [], at: 'HEAD' },
    target: ['c', 'a', 'b'],
    par: 6, timeOfDay: 0.34,
    hint: '인상선에는 기관차를 포함해 4량까지만 들어갑니다.'
  };

  /* ── 모듈 상태 ────────────────────────────────────────────── */

  var canvasEl = null;
  var phase = 'BOOT';
  var quality = 2, qualityForced = false;
  /* qualityApplied — 실제로 모듈들에 **적용된** 티어. 같은 값을 다시 적용하면
     셰이더가 통째로 재컴파일되므로(한 프레임 10초) 중복 적용을 여기서 막는다.
     qReady — 로딩 화면이 내려간 뒤인가. 부팅 중에는 즉시 적용해도 안전하다.
     qBusy  — 선컴파일 대기 중. 그 사이 들어온 요청은 무시한다. */
  var qualityApplied = -1, qReady = false, qBusy = false;
  var calibrated = false, gameDropped = false;
  var world = null, def = null, st = null;
  var curIndex = 0;
  var undoStack = [], hintsUsed = 0;
  var pending = null, busy = false, busyT = 0, busyLimit = 14, sawImpact = false;
  var resume = null, resumed = false;
  var booted = false, bootFailed = 0;
  var rafId = 0, lastT = 0, simT = 0, titleT = 0;
  var frames = 0, fpsNow = 60, fpsT = 0, lowT = 0;
  var lastShotDraw = 0, resizePend = false, lastAspect = 0;
  var audioReady = false, muted = false;
  var shotMode = /[?&]shot=1?/.test(location.search);
  /* ?fresh=1 — 저장된 판·진행도·튜토리얼 기록을 전부 무시하고 완전 초기 상태로 연다.
     아무것도 지우지 않고 **읽기만 건너뛴다**(쓰기는 noPersist 로 막는다) — 검증용 옵션이
     사람의 실제 진행도를 날려 버리면 안 되기 때문이다. */
  var freshMode = /[?&]fresh=1?/.test(location.search);
  var noPersist = shotMode || freshMode;

  var strikes = Object.create(null);
  var dead = Object.create(null);

  /* ── 안전 호출 ────────────────────────────────────────────── */

  function strike(key, e) {
    var n = (strikes[key] = (strikes[key] || 0) + 1);
    if (n <= 2) U.err('[' + key + '] ' + ((e && e.stack) || e));
    if (n === 5) { dead[key] = 1; U.err('[' + key + '] 반복 실패 — 이후 호출을 건너뜁니다.'); }
  }

  function guard(key, fn) {
    if (dead[key]) return undefined;
    try { return fn(); } catch (e) { strike(key, e); return undefined; }
  }

  /** SH.<mod>.<fn>(...) 안전 호출. 없으면 undefined, 던지면 삼킨다. */
  function M(o, f, a2, a3, a4) {
    var obj = SH[o];
    if (!obj || typeof obj[f] !== 'function') return undefined;
    var key = o + '.' + f;
    if (dead[key]) return undefined;
    try {
      switch (arguments.length) {
        case 2:  return obj[f]();
        case 3:  return obj[f](a2);
        case 4:  return obj[f](a2, a3);
        default: return obj[f](a2, a3, a4);
      }
    } catch (e) { strike(key, e); return undefined; }
  }

  function emit(name, payload) { try { SH.Bus.emit('game:' + name, payload); } catch (e) { U.err(e); } }

  /* ── 내장 폴백 퍼즐 (SH.Puzzle 이 없거나 깨졌을 때만) ───────── */

  var FB = {
    cap: function (s, id) { return (s._cap && s._cap[id]) || 99; },
    create: function (d) {
      var s = { tracks: {}, at: 'HEAD', consist: [], moves: 0 };
      var start = d.start || {}, list = d.tracks || [];
      for (var i = 0; i < list.length; i++) s.tracks[list[i].id] = (start[list[i].id] || []).slice();
      if (!s.tracks.EXIT) s.tracks.EXIT = (start.EXIT || []).slice();
      if (!s.tracks.HEAD) s.tracks.HEAD = (start.HEAD || []).slice();
      s.at = start.at || 'HEAD';
      return s;
    },
    clone: function (s) {
      var t = {}, k;
      for (k in s.tracks) t[k] = (s.tracks[k] || []).slice();
      return {
        tracks: t, at: s.at, consist: (s.consist || []).slice(), moves: s.moves | 0,
        _cap: s._cap, _target: s._target
      };
    },
    legalGo: function (s, t) {
      if (!s.tracks || !s.tracks[t]) return 'no-track';
      if (t === s.at) return 'same-track';
      if (1 + s.consist.length > FB.cap(s, 'HEAD')) return 'head-capacity';
      if (1 + s.consist.length + s.tracks[t].length > FB.cap(s, t)) return 'capacity';
      return true;
    },
    go: function (s, t) {
      var n = FB.clone(s);
      n.consist = n.consist.concat(n.tracks[t] || []);
      n.tracks[t] = [];
      n.at = t; n.moves = (n.moves | 0) + 1;
      return n;
    },
    cut: function (s, k) {
      var n = FB.clone(s);
      k = Math.max(0, Math.min(k | 0, n.consist.length));
      n.tracks[n.at] = n.consist.slice(k).concat(n.tracks[n.at] || []);
      n.consist = n.consist.slice(0, k);
      return n;
    },
    isWin: function (s) {
      return U.eqArr(s.tracks.EXIT || [], s._target || []) &&
             (s.consist || []).length === 0 && s.at !== 'EXIT';
    }
  };

  /** Puzzle 함수 1개를 가져온다 (없으면 폴백). */
  function pf(name) {
    var P = SH.Puzzle;
    if (P && typeof P[name] === 'function' && !dead['Puzzle.' + name]) {
      return function (a, b) {
        try { return P[name](a, b); }
        catch (e) { strike('Puzzle.' + name, e); return FB[name] ? FB[name](a, b) : undefined; }
      };
    }
    return FB[name] || function () { return undefined; };
  }

  /** 상태에 Game 이 필요로 하는 보조 필드를 채워 넣는다. */
  function stamp(s) {
    if (!s) return s;
    if (!s.tracks) s.tracks = {};
    if (!s.consist) s.consist = [];
    if (typeof s.moves !== 'number') s.moves = 0;
    if (!s.at) s.at = 'HEAD';
    if (def) {
      if (!s._cap) {
        var c = {}, l = def.tracks || [];
        for (var i = 0; i < l.length; i++) c[l[i].id] = l[i].capacity || 4;
        s._cap = c;
      }
      if (!s._target) s._target = (def.target || []).slice();
      for (var j = 0; j < TRACK_ORDER.length; j++) {
        if (!s.tracks[TRACK_ORDER[j]]) s.tracks[TRACK_ORDER[j]] = [];
      }
    }
    return s;
  }

  function pclone(s) {
    var c = pf('clone')(s);
    if (!c || !c.tracks) c = FB.clone(s);
    return stamp(c);
  }

  function createState(d) {
    var s = null;
    try { if (SH.Puzzle && SH.Puzzle.create) s = SH.Puzzle.create(d); }
    catch (e) { strike('Puzzle.create', e); }
    if (!s || !s.tracks) s = FB.create(d);
    return stamp(s);
  }

  /* ── 한국어 문구 ──────────────────────────────────────────── */

  function trackName(id) { return TRACK_KO[id] || String(id || '그 선'); }

  function reasonText(code, id) {
    var c = String(code == null ? '' : code).toLowerCase();
    var n = trackName(id);
    if (/same|already|here|current/.test(c)) return '기관차가 이미 ' + n + '에 서 있습니다.';
    if (/head|throat|lead|shunt/.test(c))
      return '인상선이 모자랍니다 — 기관차와 화차가 한 번에 목을 빠져나가야 해요.';
    if (/cap|full|space|room|over|long/.test(c)) return n + '에 자리가 부족합니다.';
    if (/busy|moving|anim/.test(c)) return '아직 움직이는 중이에요.';
    if (/track|exist|unknown|none|null|invalid/.test(c)) return '그 선으로는 갈 수 없습니다.';
    return '지금은 그 이동을 할 수 없어요.';
  }

  function starText(n) { return '★★★☆☆☆'.substr(3 - n, 3); }

  /* ── 진행도 (Levels.progress 우선, 없으면 자체 저장) ────────── */

  function progGet(id) {
    if (freshMode) return null;
    var L = SH.Levels;
    if (L && L.progress && typeof L.progress.get === 'function') {
      var r = guard('Levels.progress.get', function () { return L.progress.get(id); });
      if (r !== undefined) return r || null;
    }
    var all = U.store(PROG_KEY) || {};
    return all[id] || null;
  }

  function progSet(id, rec) {
    if (noPersist) return;
    var L = SH.Levels;
    if (L && L.progress && typeof L.progress.set === 'function') {
      var ok = guard('Levels.progress.set', function () { L.progress.set(id, rec); return 1; });
      if (ok) return;
    }
    var all = U.store(PROG_KEY) || {};
    all[id] = rec;
    U.store(PROG_KEY, all);
  }

  function levelPack() {
    var L = SH.Levels;
    var p = (L && L.pack && L.pack.length) ? L.pack : null;
    return p || [FALLBACK_LEVEL];
  }

  function totalStars() {
    var pack = levelPack(), sum = 0;
    for (var i = 0; i < pack.length; i++) {
      var r = progGet(pack[i].id);
      if (r && r.stars) sum += r.stars | 0;
    }
    return sum;
  }

  function starsFor(moves, par) {
    if (!par) par = moves;
    if (moves <= par) return 3;
    if (moves <= par + 2) return 2;
    return 1;
  }

  /* ── 품질 추정 ────────────────────────────────────────────── */

  function detectQuality() {
    var m = /[?&]q(?:uality)?=([0-2])/.exec(location.search);
    if (m) { qualityForced = true; return +m[1]; }
    if (shotMode) return 2;                       // 리뷰 스크린샷은 항상 최고 품질

    var cores = navigator.hardwareConcurrency || 4;
    var mem   = navigator.deviceMemory || 4;
    var dpr   = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(window.innerWidth || 0, (screen && screen.width) || 0);
    var h = Math.max(window.innerHeight || 0, (screen && screen.height) || 0);
    var px = (w * h * dpr) || 1e6;

    var score = 0;
    score += cores >= 8 ? 2.0 : (cores >= 6 ? 1.4 : (cores >= 4 ? 0.8 : 0));
    score += mem >= 8 ? 1.4 : (mem >= 4 ? 0.8 : 0.2);
    score += px > 4.2e6 ? -1.0 : (px > 2.4e6 ? -0.35 : 0.3);
    if (U.isTouch()) score -= 0.9;
    if (/Android/i.test(navigator.userAgent)) score -= 0.4;

    return score >= 2.6 ? 2 : (score >= 1.2 ? 1 : 0);
  }

  function setQualityQuiet(q) { quality = U.clamp(q | 0, 0, 2); Game.quality = quality; }

  function applyQualityNow(q) {
    qualityApplied = q;
    M('Render', 'setQuality', q);
    M('Mat', 'setQuality', q);
    M('FX', 'setQuality', q);
    emit('quality', q);
  }

  /* ★ 티어 전환은 **한 프레임을 10초로 만든다** (실측 10,299ms).
     월드 재생성이 아니다 — 지오메트리 개수는 그대로다. Mat.setQuality 가 모든
     머티리얼에 needsUpdate 를 걸면 다음 renderer.render() 안에서 드라이버가
     프로그램을 하나씩 순서대로 다시 컴파일하고, 그 합이 통째로 한 프레임에 얹힌다.
     그래서 여기서 두 가지를 한다.
       1) 같은 티어면 **아무 일도 하지 않는다**. 예전엔 setQuality(2) 를 다시 불러도
          전 머티리얼이 재컴파일 대상이 됐다.
       2) 플레이 중이면 렌더를 잠깐 세우고 프로그램을 먼저 준비한 뒤 재개한다.
          캔버스는 직전 화면이 남지만 메인 스레드는 막히지 않는다(입력·UI·소리 계속). */
  function setQuality(q) {
    q = U.clamp(q | 0, 0, 2);
    quality = q;
    Game.quality = q;
    /* 렌더러가 이미 그 티어인지도 같이 본다 — 누가 Render.setQuality 를 직접 불러
       둘이 어긋났으면 건너뛰면 안 된다(검증 도구가 실제로 그렇게 부른다). */
    var rq = (SH.Render && typeof SH.Render.quality === 'number') ? SH.Render.quality : q;
    if (q === qualityApplied && q === rq) return;

    var canDefer = qReady && SH.Render &&
      typeof SH.Render.suspend === 'function' &&
      typeof SH.Render.precompile === 'function';

    if (!canDefer) { applyQualityNow(q); return; }
    if (qBusy) return;
    /* 플레이 중 강등은 한 번이면 족하다 — Render.autoQuality 든 아래 감시자든,
       먼저 내린 쪽이 그 한 번을 쓴다. */
    gameDropped = true;
    qBusy = true;
    M('Render', 'suspend', true);
    applyQualityNow(q);
    /* 플레이 중이므로 조각은 잘게 — 한 프레임이 길어지면 안 된다 */
    M('Render', 'precompile', function () {
      qBusy = false;
      M('Render', 'suspend', false);
    }, 15000, 6);
  }

  /* ── 에러 안전망 ──────────────────────────────────────────── */

  var dbgEl = null;

  /* 브라우저가 스스로 뱉는 무해한 경고들. 게임의 결함이 아니므로 기록하지도,
     콘솔로 흘려보내지도 않는다 (리뷰 하네스가 콘솔 error 를 결함으로 집계한다). */
  var BENIGN = /ResizeObserver loop|Non-Error promise rejection captured|ResizeObserver loop completed/i;

  function isBenign(x) {
    if (x == null) return false;
    var s = '';
    try { s = (x && x.message) ? String(x.message) : String(x); } catch (e) { return false; }
    return BENIGN.test(s);
  }

  function installErrorNet() {
    window.addEventListener('error', function (e) {
      var v = (e && (e.error || e.message)) || 'error';
      if (isBenign(v) || isBenign(e && e.message)) {
        // 기본 동작(콘솔 보고)까지 막는다 — ResizeObserver 경고는 우리 잘못이 아니다
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
        return;
      }
      U.err(v);
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      var v = (e && e.reason) || 'unhandledrejection';
      if (isBenign(v)) { if (e && e.preventDefault) e.preventDefault(); return; }
      U.err(v);
    }, true);
    // 스크린샷/심사 모드에서는 디버그 오버레이를 아예 만들지 않는다
    if (!U.DEBUG || shotMode) return;
    dbgEl = document.createElement('pre');
    dbgEl.id = 'sh-debug';
    dbgEl.style.cssText =
      'position:fixed;left:10px;bottom:10px;z-index:200;max-width:46vw;max-height:38vh;' +
      'overflow:auto;margin:0;padding:8px 10px;border-radius:8px;white-space:pre-wrap;' +
      'font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#ffb9ae;' +
      'background:rgba(9,11,15,.86);border:1px solid rgba(229,83,75,.45);' +
      'pointer-events:none;display:none';
    document.body.appendChild(dbgEl);
    setInterval(function () {
      var list = U._errors || [];
      if (!list.length) { dbgEl.style.display = 'none'; return; }
      dbgEl.style.display = 'block';
      dbgEl.textContent = '⚠ ' + list.length + '\n' + list.slice(-5).join('\n\n');
    }, 800);
  }

  function softFail(label, e) {
    bootFailed++;
    strike('boot.' + label, e);
    U.fail(label + ' 단계에서 문제가 생겼어요. 나머지는 계속 불러옵니다.');
  }

  /* ── 부팅 ─────────────────────────────────────────────────── */

  /** 각 단계 사이에서 브라우저가 한 번 그릴 수 있게 양보한다. */
  function runSteps(list, i, doneFn) {
    if (i >= list.length) { if (doneFn) doneFn(); return; }
    var s = list[i];
    U.boot(s[0], s[1]);
    requestAnimationFrame(function () {
      setTimeout(function () {
        try { s[2](); } catch (e) { softFail(s[1], e); }
        runSteps(list, i + 1, doneFn);
      }, 0);
    });
  }

  function boot(el) {
    if (booted) return;
    booted = true;
    canvasEl = el || document.getElementById('gl');
    installErrorNet();
    muted = !!U.store(MUTE_KEY);

    SH.Bus.on('impact', onImpact);
    SH.Bus.on('motion:impact', onImpact);

    runSteps([
      [0.04, '기기 성능 확인', function () { setQualityQuiet(detectQuality()); }],
      [0.10, '렌더러 준비', function () {
        M('Render', 'init', canvasEl);
        /* 부팅 중에는 자동 강등을 끈다 — 티어는 calibrateQuality() 가 로딩 화면
           뒤에서 확정하고, 그 뒤에 다시 켠다(허용 1회). */
        M('Render', 'setAutoQuality', false);
        setQuality(quality);
      }],
      [0.20, '텍스처 굽는 중', function () { M('Tex', 'build', quality); }],
      [0.46, '재질 준비', function () { M('Mat', 'build'); M('Mat', 'setQuality', quality); }],
      [0.56, '레벨 불러오기', function () { pickStartLevel(); }],
      [0.62, '조차장 짓는 중', function () { buildWorld(); }],
      [0.78, '먼지와 빛', function () {
        var sc = SH.Render && SH.Render.scene;
        if (sc) M('FX', 'init', sc);
        M('FX', 'setQuality', quality);
        if (world && world.bounds) M('FX', 'pollen', world.bounds);
      }],
      [0.84, '차량 배치', function () {
        M('Motion', 'init', world);
        M('Motion', 'snap', st);
        M('Render', 'setTimeOfDay', todOf(def));
        frameYard(true);
      }],
      [0.89, '조작 연결', function () {
        M('Input', 'init', canvasEl, inputHooks);
        M('Input', 'pickables', world, st);
      }],
      [0.93, '화면 구성', function () { M('UI', 'init', uiHooks); refreshLevelUI(); }],
      [0.97, '소리 준비', function () {
        M('Audio', 'init'); M('Audio', 'mute', muted); armAudioUnlock(); armShotRelease();
      }],
      [0.98, '첫 장면 그리는 중', function () { renderFrame(0); }]
    ], 0, function () { calibrateQuality(bootFinished); });
  }

  /* ── 부팅 중 티어 확정 ──────────────────────────────────────────────
     detectQuality() 는 코어 수·메모리로 **추측**만 한다. 추측이 틀리면 플레이 도중에
     티어가 내려가고, 그 순간 셰이더가 전부 재컴파일되어 화면이 통째로 멈춘다
     (실측 10.3초, 저사양 폰은 강등이 두 번이라 20초 넘게 얼어붙었다).
     그래서 여기서 **실제로 몇 프레임 그려 보고** 티어를 확정한다. 느리면 그 자리에서
     내리고, 재컴파일까지 로딩 화면 뒤에서 끝낸 뒤에야 게임을 넘긴다.

     비용은 짧게 잡는다. 빠른 기기는 표본 14장 ≈ 0.25초로 끝나고 강등이 없으므로
     추가 비용이 사실상 없다. 느린 기기도 측정은 1초 안에서 끊는다(CAL_HARD).
     프레임 시간은 평균이 아니라 **중앙값**을 쓴다 — 텍스처 업로드 같은 한 번짜리
     튐이 평균을 망가뜨려 멀쩡한 기기를 강등시키는 걸 막는다. */
  var CAL_WARM = 3;        /* 버리는 프레임 (직전 프레임이 곧 첫 컴파일이다) */
  var CAL_MIN = 3;
  var CAL_MAX = 14;
  var CAL_MS = 450;        /* 표본 수집 목표 시간 */
  var CAL_HARD = 1000;     /* 측정 전체 상한 — 부팅을 늘리지 않는다 */

  function measureFrameFps(cb) {
    var warm = CAL_WARM, n = 0, last = 0, t0 = U.now();
    var dts = [];
    function tick() {
      renderFrame(0);
      var t = U.now();
      if (warm > 0) { warm--; last = t; requestAnimationFrame(tick); return; }
      if (last) { dts.push(t - last); n++; }
      last = t;
      var acc = t - t0;
      var enough = (n >= CAL_MIN && (n >= CAL_MAX || acc >= CAL_MS + CAL_WARM * 16));
      if (!enough && acc < CAL_HARD) { requestAnimationFrame(tick); return; }
      if (!dts.length) { cb(60); return; }
      dts.sort(function (a, b) { return a - b; });
      var med = dts[dts.length >> 1];
      cb(med > 0 ? 1000 / med : 60);
    }
    requestAnimationFrame(tick);
  }

  /** 로딩 화면 뒤에서 n 프레임 흘려보낸다 (컴파일된 프로그램을 실제로 한 번 태운다). */
  function flushFrames(n, cb) {
    function tick() {
      renderFrame(0);
      if (--n > 0) { requestAnimationFrame(tick); return; }
      cb();
    }
    requestAnimationFrame(tick);
  }

  function calibrateQuality(done) {
    var haveRenderer = !!(SH.Render && SH.Render.renderer);
    if (qualityForced || shotMode || !haveRenderer) { done(); return; }

    U.boot(0.985, '기기 속도 재는 중');
    measureFrameFps(function (fps) {
      calibrated = true;
      /* 임계값 — autoQuality 의 목표(32fps)에 맞춘다. 여유를 두고,
         한참 모자라면 한 단계씩 내려 두 번 멈추는 대신 **한 번에** 최저로 간다. */
      var tgt = quality;
      if (fps < 20) tgt = 0;
      else if (fps < 30) tgt = quality - 1;
      tgt = U.clamp(tgt, 0, quality);
      if (tgt >= quality) { done(); return; }

      /* 메시지를 먼저 **그리게** 한 뒤 무거운 일을 시작한다(runSteps 와 같은 양보 패턴).
         rAF 콜백은 페인트 직전이므로 setTimeout 으로 한 번 더 넘겨야 글자가 실제로 뜬다. */
      yieldTo('이 기기에 맞게 화질 맞추는 중', 0.99, function () {
        setQuality(tgt);                  /* qReady 전이라 즉시 적용된다 */
        /* 로딩 화면 뒤라 조각을 크게 잡는다 — 프레임이 길어도 보이지 않고, 빨리 끝난다 */
        yieldTo('그림 다시 준비하는 중', 0.995, function () {
          M('Render', 'precompile', function () { flushFrames(3, done); }, 25000, 120);
        });
      });
    });
  }

  function yieldTo(msg, pct, fn) {
    U.boot(pct, msg);
    requestAnimationFrame(function () { setTimeout(fn, 0); });
  }

  function bootFinished() {
    U.boot(1.00, '첫 장면 그리는 중');
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('keydown', onKey);

    renderFrame(0);
    U.bootDone();

    setPhase(shotMode ? 'PLAY' : 'TITLE');
    M('Input', 'setEnabled', true);

    /* 여기부터는 티어를 바꾸면 재컴파일이 **플레이 중에** 일어난다 → 지연 적용 경로를 켠다. */
    qReady = true;
    /* 부팅 중 실측으로 티어를 확정했으면 플레이 중 강등은 보험으로 **한 번만** 남긴다
       (측정이 틀렸을 때를 위해서다). 측정을 건너뛴 경우에만 예전처럼 두 번 허용한다.
       강제 품질(?q=)이면 아예 끈다 — 사용자가 고른 화질을 마음대로 깎지 않는다. */
    M('Render', 'setAutoQuality', !qualityForced && !shotMode, calibrated ? 1 : 2);

    startLoop();
    SHOT.ready = true;
    Game.ready = true;

    /* 중간 저장을 복원했으면 그 자리에서 다시 예열한다 — Puzzle 의 자동 프리웜은
       레벨 **시작 상태**만 커버해서, 이어하기로 들어오면 힌트 캐시가 비어 있다. */
    if (resumed) prewarmHint();
    pushHintReady(true);

    if (resumed) M('UI', 'toast', '하던 판을 이어서 불러왔어요 — 처음부터 하려면 다시하기를 누르세요.');
  }

  /** ?shot=1 로 열어 놓고 사람이 직접 만지면 결정론 모드를 풀어 준다
      (스크린샷 하네스는 입력을 주지 않으므로 영향 없음). */
  function armShotRelease() {
    if (!shotMode) return;
    function go() {
      window.removeEventListener('pointerdown', go, true);
      shotMode = false;              // noPersist 는 그대로 → 저장은 계속 안 함
      clearPoseCam();                // 포즈 카메라 잠금 해제 → 다시 궤도 조작 가능
      lastT = U.now();
      setPhase(phase === 'BOOT' ? 'PLAY' : phase);
    }
    window.addEventListener('pointerdown', go, { capture: true, passive: true });
  }

  function armAudioUnlock() {
    var evts = ['pointerdown', 'touchstart', 'keydown'];
    function fire() {
      for (var i = 0; i < evts.length; i++) window.removeEventListener(evts[i], fire, true);
      M('Audio', 'unlock');
      M('Audio', 'mute', muted);
      M('Audio', 'ambience', !muted);
      audioReady = true;
    }
    for (var j = 0; j < evts.length; j++) {
      window.addEventListener(evts[j], fire, { capture: true, passive: true });
    }
  }

  /* ── 레벨 ─────────────────────────────────────────────────── */

  function todOf(d) { return (d && typeof d.timeOfDay === 'number') ? d.timeOfDay : 0.35; }

  function pickStartLevel() {
    var pack = levelPack();
    var saved = (shotMode || freshMode) ? null : U.store(SAVE_KEY);
    if (saved && saved.s && saved.s.tracks) {
      var idx = U.clamp(saved.i | 0, 0, pack.length - 1);
      var d = pack[idx];
      if (d && (!saved.id || saved.id === d.id) && (saved.s.moves | 0) > 0) {
        resume = { index: idx, state: saved.s, hints: saved.h | 0 };
        applyLevel(idx, { state: saved.s, hints: saved.h | 0 });
        resumed = true;
        return;
      }
    }
    var first = 0;
    for (var i = 0; i < pack.length; i++) {
      var p = progGet(pack[i].id);
      if (!p || !p.stars) { first = i; break; }
      first = Math.min(i + 1, pack.length - 1);
    }
    applyLevel(shotMode ? 0 : first, {});
  }

  /** 상태/레벨 필드만 세팅한다 (월드 생성은 buildWorld 가 별도로). */
  function applyLevel(i, opts) {
    opts = opts || {};
    var pack = levelPack();
    curIndex = U.clamp(i | 0, 0, pack.length - 1);
    def = pack[curIndex] || FALLBACK_LEVEL;
    Game.level = def; Game.levelIndex = curIndex;
    st = opts.state ? stamp(opts.state) : createState(def);
    Game.state = st;
    hintsUsed = opts.hints || 0;
    undoStack.length = 0;
    pending = null; busy = false; busyT = 0;
  }

  /** 씬 전체 바운즈(섬 + 야드 + 소품). 그림자 ortho·근원평면·안개가 이걸 기준으로 잡힌다. */
  function sceneBoundsBox() {
    if (!world) return null;
    var b = new THREE.Box3();
    try {
      if (world.root) b.setFromObject(world.root);
      if (b.isEmpty() && world.bounds) b.copy(world.bounds);
      if (world.islandBounds && world.islandBounds.isBox3 && !world.islandBounds.isEmpty()) {
        b.union(world.islandBounds);
      }
    } catch (e) { U.err(e); return null; }
    if (b.isEmpty() || !isFinite(b.min.x) || !isFinite(b.max.x)) return null;
    b.expandByScalar(6);
    b.max.y += 18;              // 배기 연기·꽃가루가 잘리지 않게 위쪽 여유
    return b;
  }

  function buildWorld() {
    var scene = SH.Render && SH.Render.scene;
    if (!scene) return;
    if (world) M('World', 'dispose');
    world = M('World', 'build', scene, def, U.hash('shunt:' + (def.id || curIndex))) || null;
    Game.world = world;
    /* Render 는 아무도 알려주지 않으면 몇십 프레임마다 씬 바운즈를 **추정**한다.
       그러면 같은 포즈라도 호출 시점에 따라 안개·그림자가 달라져 스크린샷이 흔들린다.
       월드를 만든 우리가 정확한 값을 즉시 알려 준다 (Render 계약의 world:ready 훅). */
    var sb = sceneBoundsBox();
    if (sb) {
      M('Render', 'setSceneBounds', sb);
      try { SH.Bus.emit('world:ready', { world: world, bounds: sb }); } catch (e) { U.err(e); }
    }
    M('Render', 'attachAO', scene);
  }

  function loadLevel(i, opts) {
    opts = opts || {};
    clearQueue();            /* 이전 판에서 예약된 입력이 새 판에 발동하면 안 된다 */
    applyLevel(i, opts);
    buildWorld();
    M('Motion', 'init', world);
    M('Motion', 'snap', st);
    M('Render', 'setTimeOfDay', opts.tod == null ? todOf(def) : opts.tod);
    frameYard(true);
    refreshLevelUI();
    M('Input', 'pickables', world, st);
    M('Input', 'setEnabled', true);
    setPhase('PLAY');
    emit('level', { index: curIndex, def: def, state: st });
    nearWinT = false;
    tutIdx = -1;
    tutSync();
    if (opts.state) prewarmHint();     /* 시작 상태가 아닌 판(이어하기 등)은 여기서 예열 */
    pushHintReady(true);
    if (!opts.noSave) saveNow();
    return true;
  }

  function nextLevel() {
    var pack = levelPack();
    if (curIndex + 1 >= pack.length) {
      M('UI', 'toast', '마지막 판까지 모두 끝냈어요. 별 ' + totalStars() + '개!');
      M('UI', 'levelSelect', true);
      return false;
    }
    clearSave();
    loadLevel(curIndex + 1);
    return true;
  }

  /* ── UI 갱신 ──────────────────────────────────────────────── */

  function refreshStateUI() {
    Game.state = st;
    M('UI', 'setState', st);
    M('UI', 'setMoves', st ? (st.moves | 0) : 0, def ? (def.par | 0) : 0);
    pushConsist();
    emit('state', { state: st });
  }

  function refreshLevelUI() {
    M('UI', 'setLevel', def);
    M('UI', 'target', (def && def.target) || []);
    setBusyUI(busy);
    refreshStateUI();
  }

  function setPhase(p) {
    if (phase === p) return;
    phase = p;
    Game.phase = p;
    if (p === 'PLAY') titleT = 0;
    emit('phase', p);
  }

  function enterPlay() {
    if (phase !== 'TITLE') return;
    setPhase('PLAY');
    tutSync();
  }

  /* ══════════════════════════════════════════════════════════════
     온보딩 — "처음 보는 사람이 설명 없이 LV01~03 을 클리어한다"
     ONBOARDING.md §A(튜토리얼) §C(선로 이름표 데이터) §E(승리 조건 안내) §F(규칙 카드)
     여기서 하는 일은 **데이터 공급과 배선**뿐이다. 그리기는 전부 SH.UI 담당이고,
     UI 가 아직 그 함수를 갖고 있지 않으면 M() 이 조용히 건너뛴다.
     ══════════════════════════════════════════════════════════════ */

  function tArr(s, id) { return (s && s.tracks && s.tracks[id]) || []; }
  function tCon(s) { return (s && s.consist) || []; }

  /* ── C. 선로 이름표 데이터 (매 프레임) ─────────────────────── */

  var anchorCache = null, anchorFor = null;

  /** Input.trackAnchor 가 없으면 World 기하로 직접 잡는다.
      측선·출발선은 직선이 시작하는 서쪽 끝, 인상선은 기관차가 실제로 서는 동쪽 끝. */
  function fallbackAnchor(id) {
    if (!world || !world.tracks || !world.tracks.get) return null;
    var t = world.tracks.get(id);
    if (!t) return null;
    var s = (id === 'HEAD') ? Math.max(0, (t.length || 64) - 10) : ((t.straightS || 0) + 2);
    var p = M('World', 'point', id, s);
    if (!p || !p.pos) return null;
    return new THREE.Vector3(p.pos.x, (p.pos.y || 0) + 6, p.pos.z);
  }

  function trackAnchor(id) {
    if (anchorFor !== world) { anchorCache = Object.create(null); anchorFor = world; }
    var got = anchorCache[id];
    if (got !== undefined) return got;
    var v = M('Input', 'trackAnchor', id) || null;
    if (!v || typeof v.x !== 'number') v = fallbackAnchor(id);
    anchorCache[id] = v || null;
    return anchorCache[id];
  }

  function keyOf(id) {
    var list = SH.Input && SH.Input.trackKeys;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) if (list[i] === id) return i + 1;
    }
    return TRACK_KEY_FALLBACK[id] || 0;
  }

  function buildLabels() {
    var out = [], i;
    if (!world || !world.tracks || !world.tracks.get || !st) return out;
    for (i = 0; i < TRACK_ORDER.length; i++) {
      var id = TRACK_ORDER[i];
      if (!world.tracks.get(id)) continue;          // 이 레벨에 없는 선로 (stamp 가 만든 빈칸)
      var a = trackAnchor(id);
      if (!a) continue;
      var sp = M('Render', 'screenPos', a) || { x: 0, y: 0, visible: false };
      var state = 'active', reason = '';
      if (id === st.at) state = 'here';
      else {
        var r = pf('legalGo')(st, id);
        if (r !== true) {
          state = 'blocked';
          reason = LABEL_REASON[String(r)] || reasonText(r, id);
        }
      }
      out.push({
        id: id, name: trackName(id), key: keyOf(id),
        x: sp.x, y: sp.y,
        visible: !!sp.visible && phase !== 'BOOT' && phase !== 'WIN',
        state: state, reason: reason,
        /* 정원은 기관차를 포함해 센다 — 50-puzzle.js 의 legalGo 가
           `1 + consist.length + tracks[t].length > cap` 로 판정하기 때문이다.
           기관차를 빼고 세면 "2/4 인데 왜 안 들어가지" 가 된다. */
        count: tArr(st, id).length + (id === st.at ? 1 + tCon(st).length : 0),
        cap: (st._cap && st._cap[id]) || 0
      });
    }
    return out;
  }

  function updateLabels() {
    if (!SH.UI || typeof SH.UI.labels !== 'function') return;
    guard('UI.labels', function () { SH.UI.labels(buildLabels()); });
  }

  /* ── B. 편성 바 (분리의 주 경로) ──────────────────────────── */

  var consistHooks = { onCut: function (k) { return doCut(k); } };

  function wagonMeta(id) {
    var list = (def && def.wagons) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function pushConsist() {
    if (!SH.UI || typeof SH.UI.consist !== 'function') return;
    var c = tCon(st), out = [];
    for (var i = 0; i < c.length; i++) {
      var w = wagonMeta(c[i]);
      out.push({
        id: c[i],
        type: (w && w.type) || 'box',
        livery: (w && w.livery) || '#9e3b2c'
      });
    }
    M('UI', 'consist', out, consistHooks);
  }

  /* ── F. 규칙 카드 (? 버튼 / ? 키) ──────────────────────────── */

  function showRules(open) {
    if (SH.UI && typeof SH.UI.rules === 'function') { M('UI', 'rules', open !== false); return true; }
    if (open !== false) M('UI', 'toast', RULES_FALLBACK);   // 규칙 카드가 없어도 규칙은 보여 준다
    return false;
  }

  /* ── A. 튜토리얼 상태 머신 (LV01~03) ────────────────────────
     단계는 **상태 술어**로 판정한다. 매번 "아직 만족하지 않은 첫 단계"를 다시 고르므로
     엉뚱한 곳을 눌러도 막을 필요가 없고(다시 그 단계를 안내할 뿐), 되돌리기로 상태가
     뒤로 가면 안내도 저절로 뒤로 간다. */

  var TUT = {
    'sh-01': [
      { text: '측선 1을 탭하세요. 기관차가 가서 화차를 자동으로 물어옵니다.',
        anchor: 'track:S1',
        done: function (s) { return tArr(s, 'S1').length === 0; } },
      { text: '출발선을 탭해 화차를 밀어 넣으세요.',
        anchor: 'track:EXIT',
        done: function (s) { return s.at === 'EXIT' || tArr(s, 'EXIT').length > 0; } },
      { text: '✂ 를 눌러 기관차를 분리하세요.',
        anchor: 'consist-cut',
        done: function (s) { return tCon(s).length === 0; } },
      { text: '인상선을 탭해 기관차를 빼면 완료입니다.',
        anchor: 'track:HEAD',
        done: function (s) { return s.at !== 'EXIT'; } }
    ],
    'sh-02': [
      { text: '측선은 막다른 길입니다. 먼저 넣은 화차가 안쪽에 갇혀요. ' +
              '순서를 바꾸려면 다른 측선에 잠시 내려놓아야 합니다.',
        anchor: null, art: 'lifo', ok: true,
        done: function (s) { return (s.moves | 0) > 0; } }
    ],
    'sh-03': [
      /* 편성 바(=✂ 가 사는 곳)는 화차를 물어야 나타난다. 첫 량이 출발선에 들어갈
         때까지 띄워 두면 실제로 ✂ 를 쓰는 순간에 안내가 붙어 있다. */
      { text: '✂ 로 일부만 떼어놓을 수 있습니다. 분리는 수를 소모하지 않습니다.',
        anchor: 'consist-cut', art: 'cut', ok: true,
        done: function (s) { return (s.moves | 0) > 0 && tArr(s, 'EXIT').length > 0; } }
    ]
  };

  var tutMap = null, tutShown = false, tutIdx = -1;
  var tutSkipped = Object.create(null);
  var tutAck = Object.create(null);       // '알겠어요' 로 넘긴 단계

  function tutStore() {
    if (!tutMap) tutMap = (freshMode ? null : U.store(TUT_KEY)) || {};
    return tutMap;
  }

  function tutMarkDone(id) {
    if (!id) return;
    var m = tutStore();
    if (m[id]) return;
    m[id] = 1;
    if (!noPersist) U.store(TUT_KEY, m);
  }

  function tutSteps() {
    if (shotMode || !def) return null;                 // 스크린샷 포즈에는 말풍선을 띄우지 않는다
    if (tutSkipped[def.id] || tutStore()[def.id]) return null;
    return TUT[def.id] || null;
  }

  function tutClose() {
    tutIdx = -1;
    if (!tutShown) return;
    tutShown = false;
    M('UI', 'tutorial', null);
  }

  /** '알겠어요' — 이 단계는 읽었다. 다음 단계로 넘어간다(안내 자체를 끝내지는 않는다). */
  function tutNext() {
    if (!def || tutIdx < 0) { tutClose(); return false; }
    tutAck[def.id + ':' + tutIdx] = 1;
    tutIdx = -1;                                       // 같은 단계 재표시 방지 가드를 푼다
    tutSync();
    return true;
  }

  /** 건너뛰기 — 이 레벨의 튜토리얼 전체를 끝낸다 (사용자가 직접 요청한 기능). */
  function tutSkip() {
    if (!def) return false;
    tutSkipped[def.id] = 1;
    tutMarkDone(def.id);
    tutClose();
    M('UI', 'toast', '튜토리얼을 건너뛰었어요. ? 를 누르면 규칙을 다시 볼 수 있습니다.');
    M('Audio', 'play', 'ui');
    return true;
  }

  function tutSync() {
    var steps = tutSteps();
    if (!steps || !st || phase === 'BOOT' || phase === 'WIN') { tutClose(); return; }
    var i = 0;
    while (i < steps.length && (steps[i].done(st) || tutAck[def.id + ':' + i])) i++;
    if (i >= steps.length) { tutMarkDone(def.id); tutClose(); return; }
    if (tutShown && tutIdx === i) return;              // 같은 단계면 다시 그리지 않는다
    tutIdx = i; tutShown = true;
    var s = steps[i];
    M('UI', 'tutorial', {
      id: def.id + ':' + i,
      level: curIndex, index: i, total: steps.length,
      k: (i + 1) + ' / ' + steps.length,
      text: s.text,
      anchor: s.anchor || null,
      at: s.anchor || null,                            // 예전 UI 의 필드 이름
      art: s.art || null,
      arrow: !!s.anchor,
      ok: !!s.ok,
      force: true                                      // 표시 여부는 Game 이 판단한다
    });
  }

  /** 같은 단계라도 카드/포인터를 다시 그리게 한다 (엉뚱한 곳을 눌러 재안내할 때). */
  function tutRepoint() {
    if (tutIdx < 0) { tutSync(); return; }
    tutIdx = -1;
    tutSync();
  }

  /** 지금 안내가 가리키는 선로 id (없으면 null). */
  function tutTarget() {
    var steps = tutSteps();
    if (!steps || tutIdx < 0 || tutIdx >= steps.length) return null;
    var a = String(steps[tutIdx].anchor || '');
    return a.indexOf('track:') === 0 ? a.slice(6) : null;
  }

  /* 튜토리얼이 "측선 1을 탭하세요" 를 띄운 상태에서 호기심에 빈 출발선을 눌러 보면
     그대로 실행되어 **아무것도 안 하고 1수가 사라진다.** par 3 짜리 판에서는 그것만으로
     별이 날아간다. 막지는 않는다(가둬두면 답답하다는 것이 원래 방침) — 대신 대가를
     분명히 말해 주고, 안내 카드를 원래 선로로 다시 겨눈다. */
  function tutStrayNotice(id, pre, want) {
    if (!want || want === id) return;
    var empty = ((pre.tracks && pre.tracks[id]) || []).length === 0;
    var light = ((pre.consist) || []).length === 0;
    M('UI', 'toast',
      (empty && light)
        ? '빈 선로로 이동했습니다 — 1수 소모. 지금 안내는 ' + trackName(want) + ' 입니다.'
        : '안내와 다른 선로로 갔어요 — 이 이동도 1수를 씁니다.',
      'warn');
    M('UI', 'hintPulse', 'track:' + want);
    M('Input', 'highlight', want);
    tutRepoint();
  }

  /* ── E. 승리 직전 안내 ─────────────────────────────────────
     "화차를 다 놓았는데 왜 안 끝나지?" 가 실제 사용자가 막힌 지점이다.
     50-puzzle.js 는 건드리지 않고 여기서 조건만 검사한다. */

  var nearWinT = false;

  function checkNearWin() {
    if (!st || !def) return;
    var ok = U.eqArr(tArr(st, 'EXIT'), def.target || []) &&
             tCon(st).length === 0 && st.at === 'EXIT';
    if (!ok) { nearWinT = false; return; }
    if (nearWinT) return;
    nearWinT = true;
    M('UI', 'hintPulse', 'track:HEAD');
    M('UI', 'pulse', 'HEAD');
    M('Input', 'highlight', 'HEAD');
    emit('pulseTrack', 'HEAD');
    M('UI', 'toast', '편성 완료! 기관차를 출발선 밖으로 빼면 끝납니다.', 'good');
  }

  /* ══════════════════════════════════════════════════════════════
     카메라 프레이밍 — "떠 있는 디오라마"는 **섬 전체가 프레임 안에** 있어야
     성립한다. 선로만 감싸서 맞추면(예전 yardBox) 섬이 화면 좌·하·우 세 변에서
     잘려 나가 사선 슬래시가 되고, 동쪽 끝 화차까지 프레임 밖으로 밀린다.
     그래서 여기서는
       1) 섬 상판(Geo.island 이 실제로 만든 메시)의 XZ 범위를 그대로 쓰고,
       2) 위아래로 정해진 만큼만 여유를 둔 히어로 박스를 만들고,
       3) 그 박스가 가로·세로를 **고르게** 채우는 방위각을 화면비별로 골라
       4) 직접 거리·주시점을 계산해 Render.setCam 으로 앉힌다.
     (Render.frameBounds 대신 setCam 을 쓰는 이유: frameBounds 안에는 세로 화면
      전용 보정이 들어 있어 여기서 계산한 채움 비율을 다시 흔든다.)
     ══════════════════════════════════════════════════════════════ */

  var DEG = Math.PI / 180;

  /* 상판 기준 위/아래 여유(m).
     · 위는 3.5m 만 — 나무·급수탑처럼 실제로 높은 소품은 아래에서 **제 위치에**
       표본점으로 따로 넣는다. 섬 윤곽 전체를 12m 들어올리면 화면 위쪽에 아무것도
       없는 띠가 15% 생긴다(그게 "화면 절반이 빈 하늘"의 절반이었다).
     · 아래 22m 면 지층 절벽이 통째로 읽히고, 그보다 깊은 낙석·뿌리는 프레임
       밑으로 흘려 보낸다(그쪽이 오히려 "뜯겨 나온" 느낌이 산다). */
  var ISLE_UP = 3.5, ISLE_DOWN = 22;
  var PROP_MIN_H = 5.5, PROP_MAX_H = 16;   /* 새떼(y 27) 같은 건 프레이밍에서 뺀다 */
  var TARGET_Y = -2;                       /* 주시점 높이 — Render 의 pan 클램프 안쪽 */


  /* 인상선 서쪽 끝(x −98)까지 프레임에 넣으면 야드가 화면에서 손톱만 해진다.
     정지 상태에서 차량은 절대 x < −52 로 가지 않으므로(HEAD 는 동쪽으로 밀어 세운다)
     서쪽을 잘라 야드를 30% 크게 잡는다. (클로즈업 포즈의 폴백으로만 쓴다.) */
  var WEST_CUT = -54;

  function yardBox() {
    var b = new THREE.Box3(), any = false;
    if (world && world.tracks && world.tracks.forEach) {
      world.tracks.forEach(function (t) {
        if (!t || !t.group) return;
        var tb = new THREE.Box3().setFromObject(t.group);
        if (tb.isEmpty()) return;
        if (any) b.union(tb); else { b.copy(tb); any = true; }
      });
    }
    if (!any) b.set(new THREE.Vector3(-98, -1, -9), new THREE.Vector3(62, 6, 14.5));
    b.min.x = Math.max(b.min.x, WEST_CUT);
    if (b.max.x <= b.min.x + 20) b.max.x = b.min.x + 20;
    b.min.y = Math.min(b.min.y, -0.6);
    b.max.y = Math.max(b.max.y, 5.6);
    return b;
  }

  /** 섬 상판의 실제 XZ 윤곽(볼록껍질). AABB 로 재면 렌즈꼴 섬의 빈 모서리까지
      프레임에 넣게 되어 섬이 화면에서 15~20% 작아진다 — 그게 바로 "하늘만 넓은"
      그림의 원인이었다. 월드 1회당 한 번만 계산해 캐시한다. */
  var _fp = null, _fpFor = null;

  function hull2D(pts) {
    if (pts.length < 4) return pts;
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop();
      lo.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop();
      up.push(pts[i]);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  function footprint() {
    if (_fpFor === world && _fp) return _fp;
    _fpFor = world; _fp = null;

    var raw = [], isl = world && world.island;
    /* 상판 + 절벽만. 늘어진 뿌리(z ±36)까지 재면 윤곽이 두 배로 부풀어
       섬이 도로 화면에서 작아진다. */
    var ud = (isl && isl.userData) || {};
    var roots = [];
    if (ud.top) roots.push(ud.top);
    if (ud.wall) roots.push(ud.wall);
    if (!roots.length && isl) {
      for (var c = 0; c < isl.children.length; c++) {
        if (!/root/i.test(isl.children[c].name || '')) roots.push(isl.children[c]);
      }
    }
    if (!roots.length && isl) roots.push(isl);
    for (var ri = 0; ri < roots.length; ri++) {
      var root = roots[ri];
      if (!root || !root.traverse) continue;
      root.updateWorldMatrix(true, true);
      var v = new THREE.Vector3();
      root.traverse(function (n) {
        if (!n.isMesh && !n.isInstancedMesh) return;
        var g = n.geometry, pa = g && g.attributes && g.attributes.position;
        if (!pa || !pa.count) return;
        if (n.isInstancedMesh) {          /* 인스턴스는 월드 AABB 네 귀퉁이로 대신 */
          var bb = new THREE.Box3().setFromObject(n);
          if (bb.isEmpty()) return;
          raw.push([bb.min.x, bb.min.z], [bb.min.x, bb.max.z],
                   [bb.max.x, bb.min.z], [bb.max.x, bb.max.z]);
          return;
        }
        var step = Math.max(1, Math.ceil(pa.count / 1200));
        for (var i = 0; i < pa.count; i += step) {
          v.fromBufferAttribute(pa, i).applyMatrix4(n.matrixWorld);
          raw.push([v.x, v.z]);
        }
      });
    }

    var poly = raw.length >= 8 ? hull2D(raw) : null;
    if (!poly || poly.length < 3) {
      /* 폴백: 섬 메시를 못 읽으면 AABB 모서리 */
      var b = (world && world.islandBounds && !world.islandBounds.isEmpty())
        ? world.islandBounds
        : new THREE.Box3(new THREE.Vector3(-108, -20, -23), new THREE.Vector3(73, 10, 30));
      poly = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]];
    }
    /* 상판 가장자리의 잔디 스커트가 프레임에 딱 붙지 않게 중심에서 살짝 부풀린다 */
    var cx = 0, cz = 0, j;
    for (j = 0; j < poly.length; j++) { cx += poly[j][0]; cz += poly[j][1]; }
    cx /= poly.length; cz /= poly.length;
    for (j = 0; j < poly.length; j++) {
      poly[j] = [cx + (poly[j][0] - cx) * 1.02, cz + (poly[j][1] - cz) * 1.02];
    }
    _fp = poly;
    return _fp;
  }

  /** 프레이밍에 쓰는 3D 표본점 — 섬 윤곽 × (위 여유, 아래 절벽) + 키 큰 소품.
      월드가 바뀔 때만 다시 만든다(수를 둘 때마다 재프레이밍하므로). */
  var _hp = null, _hpFor = null;

  function heroPoints() {
    if (_hpFor === world && _hp) return _hp;
    _hpFor = world;
    var poly = footprint(), out = [], i;
    for (i = 0; i < poly.length; i++) {
      out.push([poly[i][0], ISLE_UP, poly[i][1]]);
      out.push([poly[i][0], -ISLE_DOWN, poly[i][1]]);
    }
    /* 나무·급수탑·신호기는 실루엣의 천장이다 — 제자리에 꼭짓점으로 넣는다 */
    var pr = world && world.props;
    if (pr && pr.children) {
      for (i = 0; i < pr.children.length; i++) {
        var bb = new THREE.Box3().setFromObject(pr.children[i]);
        if (bb.isEmpty()) continue;
        var top = bb.max.y;
        if (top < PROP_MIN_H || top > PROP_MAX_H) continue;
        out.push([bb.min.x, top, bb.min.z], [bb.min.x, top, bb.max.z],
                 [bb.max.x, top, bb.min.z], [bb.max.x, top, bb.max.z]);
      }
    }
    _hp = out;
    return out;
  }

  function boxPoints(b) {
    var out = [];
    for (var xi = 0; xi < 2; xi++) for (var yi = 0; yi < 2; yi++) for (var zi = 0; zi < 2; zi++) {
      out.push([xi ? b.max.x : b.min.x, yi ? b.max.y : b.min.y, zi ? b.max.z : b.min.z]);
    }
    return out;
  }

  function camAspect() {
    var cam = SH.Render && SH.Render.camera;
    if (cam && cam.aspect > 0.05) return cam.aspect;
    var w = (canvasEl && canvasEl.clientWidth) || window.innerWidth || 1280;
    var h = (canvasEl && canvasEl.clientHeight) || window.innerHeight || 800;
    return Math.max(w / Math.max(h, 1), 0.2);
  }

  /** 0 = 넉넉한 가로 화면, 1 = 폰 세로. */
  function portraitK() { return U.clamp01((1.15 - camAspect()) / 0.72); }

  /** 표본점들을 화면에 fill 비율로 담는 **대략의** 거리(평행투영 근사).
      화면 축(right/up)에 실제로 투영해 min/max 를 재므로 AABB 처럼 있지도 않은
      모서리를 위해 물러나지 않는다. 방위각 탐색과 solveFit 의 초기값으로 쓴다. */
  function fitPoints(pts, azDeg, elDeg, asp, fill) {
    var az = azDeg * DEG, el = elDeg * DEG;
    var ce = Math.cos(el), se = Math.sin(el), sa = Math.sin(az), ca = Math.cos(az);
    var rx = ca, rz = sa;                                  /* 화면 오른쪽 */
    var ux = se * sa, uy = ce, uz = -se * ca;              /* 화면 위 */
    var fx = -sa * ce, fy = se, fz = ca * ce;              /* 주시점→카메라 */
    var rmin = Infinity, rmax = -Infinity, umin = Infinity, umax = -Infinity;
    var fmin = Infinity, fmax = -Infinity, i, p, r, u, f;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      r = p[0] * rx + p[2] * rz;
      u = p[0] * ux + p[1] * uy + p[2] * uz;
      f = p[0] * fx + p[1] * fy + p[2] * fz;
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (u < umin) umin = u; if (u > umax) umax = u;
      if (f < fmin) fmin = f; if (f > fmax) fmax = f;
    }
    var hw = (rmax - rmin) * 0.5, hh = (umax - umin) * 0.5, hd = (fmax - fmin) * 0.5;
    var fov = (SH.Render && SH.Render.camera && SH.Render.camera.fov) || 24;
    var tv = Math.tan(fov * 0.5 * DEG), th = tv * Math.max(asp, 0.05);
    /* hd 항 = 앞쪽이 카메라에 가까워 커지는 만큼의 여유(원근 보정) */
    return Math.max(hw / th, hh / tv) / U.clamp(fill || 0.86, 0.35, 1.0) + hd * 0.16;
  }

  /** fitPoints 는 평행투영 근사라 카메라에 가까운 앞쪽 모서리가 예상보다 크게
      찍혀 프레임을 살짝 넘는다(섬 남동쪽 절벽이 오른쪽 변에 닿던 원인).
      여기서는 실제로 카메라를 세워 NDC 를 재고 **정확히** fill 만큼 차도록
      거리·주시점을 반복 보정한다. 6회면 수렴한다.

      주시점은 늘 y = TARGET_Y 인 지면 위 점으로만 움직인다:
        · 화면 가로 = r(=지면 오른쪽) 방향 이동
        · 화면 세로 = g(=시선의 지면 투영) 방향 이동   (1/sin(el) 배)
      y 를 건드리지 않으므로 Render 의 pan 클램프(target.y ≥ −6)에 걸려
      구도가 아래로 밀리는 일이 없다. */
  function solveFit(pts, azDeg, elDeg, asp, fill) {
    var az = azDeg * DEG, el = elDeg * DEG;
    var ce = Math.cos(el), se = Math.sin(el), sa = Math.sin(az), ca = Math.cos(az);
    var rx = ca, rz = sa;                          /* 화면 오른쪽(지면) */
    var gx = sa, gz = -ca;                          /* 화면 위의 지면 투영 */
    var ux = se * sa, uy = ce, uz = -se * ca;
    var fx = -sa * ce, fy = se, fz = ca * ce;
    var fov = (SH.Render && SH.Render.camera && SH.Render.camera.fov) || 24;
    var tv = Math.tan(fov * 0.5 * DEG), th = tv * Math.max(asp, 0.05);
    var want = U.clamp(fill || 0.88, 0.35, 1.0);
    if (se < 0.2) se = 0.2;

    var i, cxs = 0, czs = 0;
    for (i = 0; i < pts.length; i++) { cxs += pts[i][0]; czs += pts[i][2]; }
    var tx = cxs / pts.length, tz = czs / pts.length, ty = TARGET_Y;
    var d = fitPoints(pts, azDeg, elDeg, asp, want);

    for (var it = 0; it < 6; it++) {
      var cx = tx + fx * d, cy = ty + fy * d, cz = tz + fz * d;
      var xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
      for (i = 0; i < pts.length; i++) {
        var px = pts[i][0] - cx, py = pts[i][1] - cy, pz = pts[i][2] - cz;
        var zv = -(px * fx + py * fy + pz * fz);          /* 카메라 앞 거리 */
        if (zv < 1) zv = 1;
        var nx = (px * rx + pz * rz) / zv / th;
        var ny = (px * ux + py * uy + pz * uz) / zv / tv;
        if (nx < xmn) xmn = nx; if (nx > xmx) xmx = nx;
        if (ny < ymn) ymn = ny; if (ny > ymx) ymx = ny;
      }
      var s = Math.max((xmx - xmn) * 0.5, (ymx - ymn) * 0.5);
      if (!(s > 1e-4)) break;
      var mo = (xmn + xmx) * 0.5 * th * d;              /* 가로 보정(월드 m) */
      var vo = (ymn + ymx) * 0.5 * tv * d / se;         /* 세로 보정(지면 위) */
      tx += mo * rx + vo * gx;
      tz += mo * rz + vo * gz;
      /* Render 의 pan 박스 밖으로 나가면 어차피 클램프되므로 여기서 미리 막는다 */
      tx = U.clamp(tx, -88, 50); tz = U.clamp(tz, -24, 30);
      var kd = s / want;
      d *= kd;
      if (Math.abs(kd - 1) < 0.002 && Math.abs(mo) + Math.abs(vo) < 0.4) break;
    }
    return { dist: d, target: new THREE.Vector3(tx, ty, tz) };
  }

  /** 가로·세로를 가장 고르게 채우는 방위각. 최적치의 2% 안이면 미술적으로
      정해 둔 pref 쪽을 고른다 — 화면비가 조금 변해도 각이 튀지 않게. */
  function pickAzimuth(pts, elDeg, asp, lo, hi, pref) {
    var a, d, best = Infinity;
    for (a = lo; a <= hi + 1e-6; a += 1) {
      d = fitPoints(pts, a, elDeg, asp, 1);
      if (d < best) best = d;
    }
    var lim = best * 1.02, gap = Infinity, out = pref;
    for (a = lo; a <= hi + 1e-6; a += 1) {
      if (fitPoints(pts, a, elDeg, asp, 1) > lim) continue;
      var g = Math.abs(a - pref);
      if (g < gap) { gap = g; out = a; }
    }
    return out;
  }

  /** 섬(또는 주어진 박스)을 프레임에 앉힌다.
      o = { box, el, az, fill, instant, lockView } */
  function frameHero(o) {
    o = o || {};
    var pts = o.box ? boxPoints(o.box) : heroPoints();
    if (!pts.length) return;
    var asp = camAspect(), k = portraitK();
    var az, el;
    if (o.lockView) {
      var cur = M('Render', 'getCam');
      az = cur ? cur.azimuth : -44;
      el = cur ? cur.elevation : 27;
    } else {
      /* 세로 화면에서는 섬의 **폭**(z 53m)이 프레임 폭을 잡아먹는다. 길이를 잘라도
         소용없고(장축이 화면 세로를 만든다) 방위를 최대한 틀어 섬을 끝에서 보고,
         부감을 조금 올려 장축을 화면 세로로 늘여야 세로 프레임이 덜 빈다.
         더 올리면 지층 절벽이 사라져 "떠 있는 섬"이 죽으므로 +10°(≈40°)까지만. */
      el = U.clamp((o.el == null ? 29 : o.el) + 10 * k, 18, 44);
      az = (o.az == null)
        ? pickAzimuth(pts, el, asp, U.lerp(-52, -66, k), U.lerp(-32, -56, k),
                      U.lerp(-44, -64, k))
        : o.az;
    }
    /* 세로에서는 여백을 조금 더 줄인다 — 가로가 빡빡한 대신 위아래가 남기 때문 */
    var fill = (o.fill == null ? 0.88 : o.fill) + 0.03 * k;
    var fit = solveFit(pts, az, el, asp, fill);
    M('Render', 'setCam', {
      target: fit.target,
      azimuth: o.lockView ? undefined : az,
      elevation: o.lockView ? undefined : el,
      distance: fit.dist,
      instant: !!o.instant
    });
  }

  /** instant = 레벨 진입/부팅. 그 외(수 처리 후)에는 플레이어가 돌려 놓은
      방위·부감을 그대로 두고 거리·주시점만 다시 맞춘다. */
  function frameYard(instant) {
    frameHero({ instant: !!instant, lockView: !instant, fill: 0.91 });
  }

  function vehicleOf(id) {
    if (!world || !world.vehicles) return null;
    if (typeof world.vehicles.get === 'function') return world.vehicles.get(id) || null;
    return world.vehicles[id] || null;
  }

  function rigOf(v) {
    if (!v) return null;
    return v.rig || (v.group && v.group.userData && v.group.userData.rig) || null;
  }

  function boxOfObject(obj, pad) {
    if (!obj) return null;
    var b = new THREE.Box3().setFromObject(obj);
    if (b.isEmpty()) return null;
    if (pad) b.expandByScalar(pad);
    return b;
  }

  /* ── 저장 ─────────────────────────────────────────────────── */

  function saveNow() {
    if (shotMode || noPersist || !st || !def) return;
    U.store(SAVE_KEY, {
      v: 1, i: curIndex, id: def.id, h: hintsUsed, t: Date.now(),
      s: { tracks: st.tracks, at: st.at, consist: st.consist, moves: st.moves | 0 }
    });
  }

  function clearSave() { if (!shotMode && !noPersist) U.store(SAVE_KEY, null); }

  /* ── 플레이어 행동 ────────────────────────────────────────── */

  function pushUndo(pre) {
    undoStack.push(pre);
    if (undoStack.length > 120) undoStack.shift();
  }

  function reject(id, code) {
    M('UI', 'toast', reasonText(code, id));
    M('UI', 'reject', id);
    M('UI', 'shake', id);
    M('Audio', 'play', 'fail');
    M('Render', 'shake', 0.22);
    emit('reject', { track: id, reason: String(code) });
  }

  /* ── 카드(모달)가 떠 있는 동안 ────────────────────────────────────
     **규칙을 읽는 행동이 판을 바꾸면 안 된다.** 도움말 카드에 "키보드: 12345 선로"
     라고 적혀 있으니 읽다가 눌러 보는 것이 자연스러운데, 그때마다 기관차가 실제로
     움직이고 이동수가 올라갔다.
     키는 Game 의 onKey 와 Input 의 onKey 두 곳에서 들어오므로 키 핸들러가 아니라
     **행동 지점(doGo/doCut)** 에서 막는다 — 한 군데만 막으면 다른 쪽으로 새어 든다.
     판정: UI 가 isModalOpen() 을 주면 그 말을 따르고, 없으면 오버레이의 is-on
     클래스로 본다(80-ui 의 show() 가 클래스를 **동기로** 토글하므로, 카드를 닫고
     곧바로 행동을 부르는 버튼들 — 승리 카드의 '다시하기', 레벨 시트의 레벨 선택 —
     은 그대로 동작한다). */
  var MODAL_SEL = '.sh-rules.is-on,.sh-sheet.is-on,.sh-win.is-on,.sh-scrim.is-on';
  var modalNagT = -1e9;

  function modalOpen() {
    if (shotMode) return false;                 // 결정론 스크린샷 모드는 스스로 UI 를 여닫는다
    var r = M('UI', 'isModalOpen');
    if (typeof r === 'boolean') return r;
    var host = (SH.UI && SH.UI.el) || document.getElementById('ui-root');
    if (!host || !host.querySelector) return false;
    try { return !!host.querySelector(MODAL_SEL); } catch (e) { return false; }
  }

  /** 카드가 떠 있으면 true (그리고 가끔 이유를 한 번 알려 준다 — 토스트는 카드 위에 뜬다). */
  function modalBlocks() {
    if (!modalOpen()) return false;
    if (phase === 'PLAY' && U.now() - modalNagT > 2500) {
      modalNagT = U.now();
      M('UI', 'toast', '카드를 닫으면 조작할 수 있어요.');
    }
    return true;
  }

  /* ── 입력 큐 ────────────────────────────────────────────────────
     이동 애니메이션은 2~4초다. 그동안 들어온 탭/키를 예전엔 조용히 버렸다.
     플레이테스트에서 20여 세션 중 12번의 입력이 이렇게 증발했고, 거부 피드백이
     전혀 없어서 "내가 안 눌렀나? 게임이 멈췄나?" 를 구분할 수 없었다.
     이제 의도를 담아 두고 애니메이션이 끝나면 바로 실행한다.
     담을 때 즉시 피드백(펄스 + 클릭음)을 줘서 "접수됐다"를 알린다.

     컷과 이동은 **서로 다른 슬롯**에 담는다. 하나짜리 큐로 뭉쳤더니 "여기서 분리하고
     저쪽으로 가자" 라는 자연스러운 연속 입력에서 뒤이은 이동이 예약된 컷을 덮어써서,
     분리가 조용히 사라지고 기관차가 화차를 도로 끌고 나갔다(고치려던 바로 그 증상이다).
     비울 때는 컷을 먼저 — 컷은 수를 소모하지 않고 논리적으로 이동보다 앞선다. */
  var queuedGo = null, queuedCut = null, queuedAt = 0;
  /* TTL 은 "판이 멈춘 뒤" 부터 잰다 (touchQueue 참고). 기다리게 만든 쪽은 게임이므로
     애니메이션이 흐른 시간을 의도의 나이로 세면 안 된다. */
  var QUEUE_TTL = 6000;        // 너무 늦게 도착한 의도는 실행하지 않는다

  /** 대기 시계를 지금으로 되감는다. 정지 시점에 호출. */
  function touchQueue() { if (queuedGo || queuedCut) queuedAt = U.now(); }

  function queueIntent(it) {
    /* 숫자키는 Input 과 Game 두 곳에서 처리된다 — 한 번 눌러도 doGo 가 두 번 들어오고,
       두 번째는 이미 busy 라 **예약**된다. 그 예약은 도착하는 순간 언제나 'same-track'
       이라, 정지하자마자 "기관차가 이미 측선 1에 서 있습니다" 라는 엉뚱한 거절이
       뜬다(실측). 지금 들어가고 있는 선로로 가는 예약과 같은 예약의 중복은 담지 않는다. */
    if (it.kind === 'go') {
      if (pending && pending.move && pending.move.type === 'go' && pending.move.track === it.id) return;
      if (queuedGo && queuedGo.id === it.id) return;
    } else if (queuedCut && queuedCut.k === it.k) return;

    if (it.kind === 'go') queuedGo = it; else queuedCut = it;
    queuedAt = U.now();
    M('Audio', 'play', 'ui');
    if (it.kind === 'go') M('UI', 'hintPulse', 'track:' + it.id);
    else M('UI', 'hintPulse', 'consist-cut');
  }
  function clearQueue() { queuedGo = queuedCut = null; }
  function flushQueue() {
    if (!queuedGo && !queuedCut) return;
    if (U.now() - queuedAt > QUEUE_TTL) { clearQueue(); return; }
    /* 애니메이션 중에 도움말을 열었다면 지금 실행하지 않는다. 버리지도 않는다 —
       카드를 닫으면 (TTL 안이라면) simulate 의 저빈도 점검이 그때 실행한다. */
    if (modalOpen()) return;
    /* 컷이 먼저. 컷은 자기 애니메이션을 띄우므로 남은 이동은 그 완료 시점에 다시 flush 된다. */
    if (queuedCut) { var c = queuedCut; queuedCut = null; doCut(c.k); return; }
    var g = queuedGo; queuedGo = null; doGo(g.id);
  }

  /** 이 레벨에 실제로 있는 선로인가 (stamp 가 채워 넣은 빈칸과 구분한다). */
  function hasTrack(id) {
    if (world && world.tracks && world.tracks.get) return !!world.tracks.get(id);
    var l = (def && def.tracks) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return true;
    return !l.length;
  }

  function doGo(id) {
    if (modalBlocks()) return false;       // 카드를 읽는 동안에는 판이 바뀌지 않는다
    enterPlay();
    if (!st || !id) return false;
    /* 이 판에 없는 선로(LV01 의 측선 3 처럼)는 애니메이션 중이라도 지금 거절한다.
       상태와 무관하게 앞으로도 불법이라 예약해 두면 몇 초 뒤에야 거절 토스트가 뜬다. */
    if (!hasTrack(id)) { reject(id, 'no-track'); return false; }
    if (busy || phase === 'ANIM') { queueIntent({ kind: 'go', id: id }); return false; }
    if (phase !== 'PLAY') return false;

    var legal = pf('legalGo')(st, id);
    if (legal !== true) { reject(id, legal); return false; }

    var pre = pclone(st);
    var want = tutTarget();                /* 안내가 가리키던 선로 — 상태가 바뀌기 전에 잡아 둔다 */
    var next = pf('go')(st, id);
    if (!next || !next.tracks) next = FB.go(pre, id);
    stamp(next);

    pushUndo(pre);
    st = next; Game.state = st;
    refreshStateUI();
    tutSync();                             /* 카드·포인터가 애니메이션을 기다리지 않고 따라온다 */
    tutStrayNotice(id, pre, want);
    startMotion({
      type: 'go', track: id, trackId: id, to: id, from: pre.at,
      prev: pre, next: st
    });
    return true;
  }

  function doCut(k) {
    if (modalBlocks()) return false;       // 카드를 읽는 동안에는 판이 바뀌지 않는다
    enterPlay();
    if (!st) return false;
    if (busy || phase === 'ANIM') { queueIntent({ kind: 'cut', k: k | 0 }); return false; }
    if (phase !== 'PLAY') return false;
    k = k | 0;
    var n = (st.consist || []).length;
    if (n === 0) { M('UI', 'toast', '기관차에 붙은 화차가 없습니다.'); M('Audio', 'play', 'fail'); return false; }
    if (k < 0 || k > n - 1) { M('UI', 'toast', '거기서는 분리할 수 없어요.'); M('Audio', 'play', 'fail'); return false; }

    var pre = pclone(st);
    var next = pf('cut')(st, k);
    if (!next || !next.tracks) next = FB.cut(pre, k);
    stamp(next);

    pushUndo(pre);
    st = next; Game.state = st;
    refreshStateUI();
    tutSync();                             /* 분리 직후 다음 단계로 카드가 즉시 넘어간다 */
    M('Audio', 'play', 'hiss');
    startMotion({ type: 'cut', k: k, keep: k, track: pre.at, prev: pre, next: st });
    return true;
  }

  function undo() {
    if (busy) return false;
    clearQueue();                 /* 되돌린 뒤 예약된 의도가 발동하면 안 된다 */
    if (phase === 'WIN') { M('UI', 'toast', '이미 편성을 끝냈어요.'); return false; }
    if (!undoStack.length) { M('UI', 'toast', '되돌릴 수 있는 이동이 없습니다.'); return false; }
    st = stamp(undoStack.pop());
    Game.state = st;
    setPhase('PLAY');
    M('Motion', 'snap', st);
    M('Input', 'pickables', world, st);
    refreshStateUI();
    M('Audio', 'play', 'ui');
    saveNow();
    nearWinT = false;
    tutSync();
    checkNearWin();
    prewarmHint();                /* 되돌린 자리도 힌트가 즉답이어야 한다 */
    pushHintReady(true);
    emit('undo', { state: st });
    return true;
  }

  function restart() {
    if (busy) return false;
    clearSave();
    loadLevel(curIndex, { noSave: true });
    M('Audio', 'play', 'ui');
    M('UI', 'toast', '처음부터 다시 시작합니다.');
    return true;
  }

  /* ── 힌트 프리웜 (50-puzzle 계약) ─────────────────────────────────
     Puzzle.create 의 자동 프리웜은 레벨 **시작 상태**만 예열한다. 이어하기로 들어오거나
     수를 둔 뒤에는 색인이 비어 있어 힌트를 누르는 순간 탐색이 시작되고, 그 프레임이
     길어지거나(동기 예산 초과) 아무 수도 못 주고 빈손으로 돌아온다.
     그래서 ① 판이 새 위치에 정지할 때마다 미리 풀어 두고, ② 아직 못 푼 동안에는
     힌트 버튼을 잠가(스피너) "눌렀는데 왜 아무 일도 없지" 를 없앤다. */

  var hintOK = true, hintPollT = 0;

  function puzzleHintReady() {
    if (!st || !def) return false;
    var P = SH.Puzzle;
    if (!P || typeof P.hintReady !== 'function' || dead['Puzzle.hintReady']) return true;
    var r = guard('Puzzle.hintReady', function () { return P.hintReady(st, def.target); });
    return (r === undefined) ? true : !!r;      // 알 수 없으면 잠그지 않는다
  }

  function prewarmHint() {
    if (shotMode || !st || !def) return;
    var P = SH.Puzzle;
    if (!P || typeof P.prewarm !== 'function' || dead['Puzzle.prewarm']) return;
    guard('Puzzle.prewarm', function () { P.prewarm(st, def.target); });
  }

  function hintBtnEl() {
    var host = (SH.UI && SH.UI.el) || document.getElementById('ui-root');
    if (!host || !host.querySelector) return null;
    try { return host.querySelector('.sh-hint'); } catch (e) { return null; }
  }

  /** 힌트 버튼 상태를 UI 에 반영. UI 에 훅이 있으면 그쪽이 우선. */
  function applyHintGate() {
    if (SH.UI && typeof SH.UI.setHintReady === 'function') { M('UI', 'setHintReady', hintOK); return; }
    var b = hintBtnEl();
    if (!b) return;
    var off = !hintOK || busy;                  // busy 는 UI.setBusy 와 같은 판단
    b.setAttribute('aria-disabled', off ? 'true' : 'false');
    b.disabled = off;
    b.setAttribute('aria-busy', hintOK ? 'false' : 'true');
  }

  function pushHintReady(force) {
    var r = puzzleHintReady();
    if (!force && r === hintOK) return r;
    hintOK = r;
    applyHintGate();
    emit('hintReady', r);
    return r;
  }

  /** UI.setBusy 와 힌트 게이트를 함께 갱신한다 (setBusy 가 버튼을 되살리므로). */
  function setBusyUI(b) { M('UI', 'setBusy', b); applyHintGate(); }

  function hint() {
    if (busy || !st || !def) return null;
    var ready = pushHintReady(true);
    var m = null;
    if (ready) {
      try { if (SH.Puzzle && SH.Puzzle.hint) m = SH.Puzzle.hint(st, def.target); }
      catch (e) { strike('Puzzle.hint', e); }
    } else {
      prewarmHint();                            // 프레임을 잡아먹지 않고 예열만 건다
    }
    if (!m) {
      var msg = ready
        ? ((def.hint && String(def.hint)) || '지금은 알려줄 수 있는 수가 없어요.')
        : '최적 경로를 계산하는 중이에요 — 잠시 뒤 다시 눌러 주세요.';
      M('UI', 'toast', msg);
      M('Audio', 'play', 'ui');
      pushHintReady(true);
      return null;
    }
    hintsUsed++;
    var kind = m.type || (m.k != null || m.keep != null ? 'cut' : 'go');
    if (kind === 'cut') {
      var k = (m.k != null) ? m.k : (m.keep | 0);
      M('UI', 'toast', '힌트 — ' + k + '량만 남기고 분리하세요. (별 1개 차감)');
      emit('hint', { type: 'cut', k: k });
    } else {
      var t = m.track || m.trackId || m.to || m.id;
      M('UI', 'toast', '힌트 — ' + trackName(t) + '(으)로 보내세요. (별 1개 차감)');
      M('UI', 'pulse', t);
      M('UI', 'hint', t);
      M('Input', 'highlight', t);
      emit('hint', { type: 'go', track: t });
      emit('pulseTrack', t);
    }
    M('Audio', 'play', 'ui');
    refreshStateUI();
    saveNow();
    return m;
  }

  /* ── 이동 애니메이션 ──────────────────────────────────────── */

  function setExhaust(load) {
    if (!world || !world.loco) return;
    var rig = rigOf(world.loco);
    var a = (rig && rig.exhaust) || (world.loco.group || null);
    if (a) M('FX', 'exhaust', a, load);
  }

  function startMotion(move) {
    busy = true; busyT = 0; sawImpact = false;
    busyLimit = (move.type === 'cut') ? 3.0 : 14.0;
    setPhase('ANIM');
    setBusyUI(true);
    M('Input', 'setEnabled', false);
    setExhaust(move.type === 'go' ? 0.9 : 0.15);

    var rec = { move: move, done: false, fin: null };
    rec.fin = function () {
      if (rec.done) return;
      rec.done = true;
      // 레벨이 갈아끼워진 뒤 늦게 도착한 콜백은 무시한다
      if (pending !== rec) return;
      pending = null;
      onMotionDone(move);
    };
    pending = rec;

    var ran = false;
    if (SH.Motion && typeof SH.Motion.execute === 'function' && !dead['Motion.execute']) {
      try { SH.Motion.execute(move.prev, move, rec.fin); ran = true; }
      catch (e) { strike('Motion.execute', e); ran = false; }
    }
    if (!ran) { M('Motion', 'snap', st); rec.fin(); }
  }

  function onMotionDone(move) {
    busy = false; busyT = 0;
    setExhaust(0.12);
    setBusyUI(false);
    M('Input', 'setEnabled', true);
    M('Input', 'pickables', world, st);
    refreshStateUI();

    if (move.type === 'go' && !sawImpact) M('Audio', 'play', 'couple');

    if (checkWin()) { clearQueue(); return; }
    setPhase('PLAY');
    frameYard(false);
    saveNow();
    tutSync();
    checkNearWin();
    prewarmHint();                /* 새로 정지한 자리의 최적 경로를 유휴 시간에 미리 푼다 */
    pushHintReady(true);
    emit('rest', { state: st, move: move });
    /* 이동 한 번이 TTL 보다 길어지면(실측 4.5~6.5초, 워치독은 14초까지 허용) 애니메이션
       중에 넣은 의도가 **실행 직전에** 나이로 버려졌다 — 고치려던 증발이 그대로 재현된다.
       기다리게 만든 쪽은 게임이므로, 정지한 지금부터 다시 센다. */
    touchQueue();
    flushQueue();          /* 애니메이션 중 들어온 입력을 여기서 실행한다 */
  }

  function onImpact(p) {
    sawImpact = true;
    M('Audio', 'play', 'clank');
    M('Render', 'shake', 0.55);
    if (p && p.pos) M('FX', 'impact', p.pos);
  }

  /* ── 승리 ─────────────────────────────────────────────────── */

  function localWin() {
    if (!st || !def) return false;
    var ex = (st.tracks && st.tracks.EXIT) || [];
    return U.eqArr(ex, def.target || []) && (st.consist || []).length === 0 && st.at !== 'EXIT';
  }

  function checkWin() {
    var w = false;
    try {
      if (SH.Puzzle && SH.Puzzle.isWin) {
        var r = SH.Puzzle.isWin(st);
        if (typeof r === 'boolean') w = r;
      }
    } catch (e) { strike('Puzzle.isWin', e); }
    if (!w) w = localWin();
    if (!w) return false;
    presentWin();
    return true;
  }

  function winResult() {
    var moves = st ? (st.moves | 0) : 0;
    var par = (def && (def.par | 0)) || moves;
    var s = starsFor(moves, par);
    if (hintsUsed > 0) s = Math.max(1, s - 1);
    var prev = progGet(def.id) || { stars: 0, best: 0 };
    var best = prev.best ? Math.min(prev.best | 0, moves) : moves;
    return {
      id: def.id, index: curIndex, name: def.name, moves: moves, par: par,
      stars: s, starText: starText(s), bestStars: Math.max(prev.stars | 0, s),
      best: best, isNewBest: !prev.best || moves < (prev.best | 0),
      hints: hintsUsed, total: 0,
      hasNext: curIndex + 1 < levelPack().length
    };
  }

  function presentWin() {
    setPhase('WIN');
    if (def) tutMarkDone(def.id);      // 클리어했으면 그 판의 안내는 끝난 것이다
    tutClose();                        // 말풍선이 승리 카드를 가리지 않게
    nearWinT = false;
    var res = winResult();
    if (!noPersist) {
      progSet(def.id, { stars: res.bestStars, best: res.best, done: true });
      clearSave();
    }
    res.total = totalStars();
    if (!noPersist) {
      try { if (window.GameStats) GameStats.record(GAME_ID, { score: res.total }); }
      catch (e) { U.err(e); }
    }
    M('Audio', 'play', 'win');
    M('Render', 'shake', 0.3);
    M('UI', 'setBusy', false);
    M('UI', 'win', res);
    M('Input', 'setEnabled', true);
    frameYard(false);
    emit('win', res);
    return res;
  }

  function share() {
    var res = winResult();
    var url = location.href.split('?')[0].split('#')[0];
    var txt = '🚂 조차장 — ' + (def.name || ('제 ' + (curIndex + 1) + '판')) + '\n' +
              starText(res.stars) + '  ' + res.moves + '수 (파 ' + res.par + ')\n' +
              '별 ' + totalStars() + '개 모았어요';
    try {
      if (window.GameShare) GameShare.share({ text: txt, url: url });
      else M('UI', 'toast', txt);
    } catch (e) { U.err(e); }
  }

  function toggleMute() {
    muted = !muted;
    var r = M('Audio', 'mute', muted);
    if (typeof r === 'boolean') muted = r;
    U.store(MUTE_KEY, muted);
    M('Audio', 'ambience', !muted);
    M('UI', 'toast', muted ? '소리를 껐어요.' : '소리를 켰어요.');
    return muted;
  }

  /* ── 훅 (Input / UI 가 호출) ──────────────────────────────── */

  var inputHooks = {
    onTrack: function (id) { doGo(id); },
    onCoupler: function (k) { doCut(k); },
    onEmpty: function () {
      enterPlay();
      M('UI', 'levelSelect', false);
      emit('empty', null);
    },
    onHoverTrack: function (id) {
      var legal = null;
      if (id && st && !busy && phase === 'PLAY') legal = (pf('legalGo')(st, id) === true);
      emit('hoverTrack', { track: id, legal: legal });
    }
  };

  var uiHooks = {
    onRestart: function () { return restart(); },
    onUndo:    function () { return undo(); },
    onHint:    function () { return hint(); },
    onLevel:   function (i) { clearSave(); return loadLevel(i); },
    onNext:    function () { return nextLevel(); },
    onShare:   function () { return share(); },
    onMute:    function () { return toggleMute(); },
    onMenu:    function (open) { M('UI', 'levelSelect', open !== false); },
    onCut:     function (k) { return doCut(k); },
    onGo:      function (id) { return doGo(id); },
    /* ── 온보딩 배선 ── */
    onTutorialSkip: function () { return tutSkip(); },
    onTutorialNext: function () { return tutNext(); },
    onRules:   function (open) { return showRules(open !== false); },
    onHelp:    function () { return showRules(true); },
    onZoom:    function (d) { M('Render', 'zoom', +d || 0); }
  };

  /* ── 엔진음 정규화 ────────────────────────────────────────────────
     Audio.engine(on, load) 는 load 를 **0~1** 로 받는다. 예전에는 speed/5.5 를 넘겨
     열차가 구르는 내내 load 가 1.0 에 붙어 있었고, 그래서 오디오 쪽이 만든
     아이들→노치 스윕이 실제로는 한 번도 재생되지 않았다.
     60-motion 의 최고속은 상수가 아니라 (구간 거리 ÷ 소요시간) 에서 나오고 지금
     25~32 m/s 로 조정되는 중이다. 그래서
       ① Motion 이 최고속을 공개하면 그 값으로,
       ② 아니면 이번 세션에서 **실제로 관측한 최고속**으로 정규화한다
          (초기값 = 목표 대역의 중앙 28 m/s).
     어느 값으로 착지하든 첫 이동 한 번이면 스윕이 전 구간을 쓰게 된다. */

  var ENGINE_TOP0 = 28;        // 60-motion 목표 최고속(25~32 m/s)의 중앙값
  var ENGINE_TOP_CAP = 90;     // 관측 이상치 방어 (한 프레임 튐)
  var engTop = ENGINE_TOP0;

  function engineLoad(sp) {
    var m = SH.Motion;
    var top = m ? +(m.maxSpeed || m.MAX_SPEED || m.topSpeed || 0) : 0;
    if (!(top > 1)) {
      /* ② 구형 Motion — 관측값으로 정규화한다. 위로만 올라가므로 한 번 긴 이동을
         보고 나면 짧은 이동이 영영 저부하로 들리는 부작용이 있다. 그래서 ① 이 우선. */
      if (sp > engTop && sp < ENGINE_TOP_CAP) engTop = sp;
      top = engTop;
    }
    return U.clamp01(sp / top);
  }

  /** 지금 소리(engine/roll)를 60-motion 이 몰고 있는가.
      Motion 은 job 이 있는 동안(=isBusy) 매 프레임 Audio.engine/roll 을 부른다.
      update 가 죽어 있으면 아무도 안 부르는 것이므로 Game 이 되가져온다. */
  function motionDrivesAudio() {
    return !!(SH.Motion && SH.Motion.isBusy && SH.Motion.update && !dead['Motion.update']);
  }

  /* ── 시뮬레이션 + 렌더 ────────────────────────────────────── */

  function renderFrame(dt) {
    if (SH.Render && typeof SH.Render.frame === 'function' && !dead['Render.frame']) {
      try { SH.Render.frame(dt || 0); }
      catch (e) { strike('Render.frame', e); }
    }
    frames++;
  }

  function simulate(dt) {
    simT += dt;

    if (SH.Motion && SH.Motion.update && !dead['Motion.update']) {
      try { SH.Motion.update(dt); } catch (e) { strike('Motion.update', e); }
    }
    if (SH.FX && SH.FX.update && !dead['FX.update']) {
      try { SH.FX.update(dt, SH.Render && SH.Render.camera); } catch (e) { strike('FX.update', e); }
    }
    /* ★ 이동 중에는 소리를 60-motion 이 몬다 — 여기서 덮어쓰지 않는다.
       60-motion 은 update() 안에서 Audio.engine/roll 을 이미 매 프레임 부르고, 그 값은
       속도뿐 아니라 **단계**를 담고 있다(브레이크 해제 0.62 → 견인/추진 → 정차 0.07).
       Game 이 그 뒤에 속도비만으로 다시 부르면 마지막 호출이 이기므로 그 envelope 이
       통째로 사라진다(실측: 같은 프레임 55개 중 51개가 불일치, 순항 내내 load 1.0 고정).
       그래서 소유권을 시간으로 나눈다 — **이동 중 = Motion, 정지 중 = Game(아이들)**. */
    if (audioReady && SH.Audio && !motionDrivesAudio()) {
      var sp = Math.abs(+(SH.Motion && SH.Motion.speed) || 0);
      if (SH.Audio.roll && !dead['Audio.roll']) {
        try { SH.Audio.roll(sp); } catch (e) { strike('Audio.roll', e); }   // roll 은 m/s 그대로
      }
      if (SH.Audio.engine && !dead['Audio.engine']) {
        try { SH.Audio.engine(true, engineLoad(sp)); } catch (e) { strike('Audio.engine', e); }
      }
    }
    if (SH.UI && SH.UI.tick && !dead['UI.tick']) {
      try { SH.UI.tick(dt); } catch (e) { strike('UI.tick', e); }
    }
    /* 선로 이름표는 카메라를 따라다녀야 하므로 매 프레임 좌표를 새로 넘긴다.
       (DOM 재생성은 UI 쪽 금지 사항 — 여기서는 숫자만 흘려보낸다.) */
    updateLabels();

    /* 프리웜은 유휴 시간에 조금씩 도니까, 다 풀렸는지 낮은 빈도로 물어 버튼을 푼다.
       카드 때문에 미뤄 둔 예약 입력도 여기서 다시 시도한다. */
    hintPollT += dt;
    if (hintPollT > 0.3) {
      hintPollT = 0;
      pushHintReady(false);
      if (phase === 'PLAY' && !busy && (queuedGo || queuedCut)) flushQueue();
    }

    // 모션 워치독 — done() 이 안 오면 스냅으로 강제 정렬
    if (pending) {
      busyT += dt;
      if (busyT > busyLimit) {
        strike('Motion.execute', new Error('done() 미호출 — 워치독으로 종료'));
        M('Motion', 'snap', st);
        pending.fin();
      }
    }

    if (phase === 'TITLE') { titleT += dt; if (titleT > 0.9) enterPlay(); }
  }

  /** 결정론 진행: 1/60 슬라이스로 시뮬레이션, 4슬라이스마다 + 마지막에 렌더. */
  function stepSim(ms, renderEvery) {
    var left = U.clamp(+ms || 0, 0, 30000) / 1000;
    var re = renderEvery || 4, acc = 0, k = 0;
    while (left > 1e-6) {
      var d = Math.min(1 / 60, left);
      left -= d;
      simulate(d);
      acc += d; k++;
      if (k % re === 0) { renderFrame(acc); acc = 0; }
    }
    renderFrame(acc);
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);

    if (resizePend) {
      resizePend = false;
      M('Render', 'resize');
      /* 가로↔세로가 바뀌면 고른 방위·부감이 통째로 달라진다. 화면비가 크게
         변했을 때만 다시 앉힌다 — 창을 조금 끄는 정도로는 카메라를 안 건드린다. */
      var asp = camAspect();
      if (world && Math.abs(Math.log(asp / (lastAspect || asp))) > 0.16) {
        lastAspect = asp;
        if (phase !== 'BOOT') frameHero({ instant: false, fill: 0.91 });
      } else if (!lastAspect) lastAspect = asp;
    }

    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(0.05, dt);

    if (shotMode) {
      // 결정론 모드: 시간은 step() 으로만 흐른다. 캔버스가 비지 않게 저빈도 재렌더.
      if (now - lastShotDraw > 110) { lastShotDraw = now; renderFrame(0); }
      return;
    }

    simulate(dt);
    renderFrame(dt);

    // fps 측정 + 적응형 품질
    fpsT += dt;
    if (fpsT >= 0.5) { fpsNow = frames / fpsT; frames = 0; fpsT = 0; }
    /* 감시자는 **최후의 보험**이다. 티어는 부팅 중에 실측으로 확정했고(calibrateQuality),
       여기서 한 번 더 내리는 건 그 측정이 틀렸을 때뿐이다. 두 번 내리지 않는다 —
       강등 한 번마다 셰이더가 전부 재컴파일되기 때문이다. 선컴파일이 도는 동안(qBusy)
       프레임은 어차피 안 그려지므로 fps 를 믿을 수 없다. 그때는 판단을 멈춘다. */
    if (!qualityForced && !gameDropped && !qBusy) {
      if (fpsNow < 27) lowT += dt; else lowT = Math.max(0, lowT - dt * 0.6);
      if (lowT > 4) {
        lowT = 0;
        /* ★ 반드시 **렌더러의 실제 티어**에서 한 단계 내려야 한다.
           예전엔 Game 의 지역 카운터(부팅값 2)에서 내렸는데, 그 사이 Render.autoQuality 가
           스스로 0 까지 내려가 있으면 setQuality(1) 이 되어 **강등이 승격**이 됐다.
           실측(CPU 4x)에서 이 순간 fps 6.3 → 2.9, 드로우콜 2,670 → 4,098 로 튀었다. */
        var cur = (SH.Render && typeof SH.Render.quality === 'number')
          ? SH.Render.quality : quality;
        if (cur > 0) {
          gameDropped = true;
          setQuality(cur - 1);
          M('UI', 'toast', '부드럽게 돌아가도록 화질을 한 단계 낮췄어요.');
        } else {
          setQualityQuiet(0);          /* 이미 최저 — 카운터만 렌더러에 맞춘다 */
        }
      }
    } else if (qBusy) {
      lowT = 0; frames = 0; fpsT = 0;
    }
  }

  function startLoop() { if (rafId) return; lastT = U.now(); rafId = requestAnimationFrame(loop); }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function onResize() { resizePend = true; }

  function onVisibility() {
    if (document.hidden) {
      stopLoop();
      saveNow();
      if (audioReady) M('Audio', 'engine', false, 0);
      M('Audio', 'ambience', false);
    } else {
      lastT = U.now();          // dt 리셋 — 복귀 시 순간이동 방지
      frames = 0; fpsT = 0;
      if (audioReady && !muted) { M('Audio', 'engine', true, 0); M('Audio', 'ambience', true); }
      startLoop();
    }
  }

  /* ── 키보드 (데스크톱 보조) ───────────────────────────────── */

  var KEYMAP = { '1': 'S1', '2': 'S2', '3': 'S3', '4': 'EXIT', '5': 'HEAD', '0': 'HEAD' };

  function onKey(e) {
    if (!e || e.metaKey || e.ctrlKey || e.altKey) return;
    var tg = e.target;
    if (tg && /^(input|textarea|select)$/i.test(tg.tagName || '')) return;
    var k = e.key;
    /* 카드가 떠 있는 동안에는 판을 바꾸는 키를 아예 받지 않는다.
       닫기(esc)·소리(m)·규칙(?)·승리 카드의 다음 판(n/enter)만 통과시키고,
       preventDefault 도 하지 않는다 — 카드 자신의 단축키를 막으면 안 되기 때문이다. */
    if (modalOpen()) {
      var kk = (k || '').toLowerCase();
      var pass = (kk === 'escape' || kk === 'm' || kk === '?' || kk === '/' ||
                  ((kk === 'n' || kk === 'enter') && phase === 'WIN'));
      if (!pass) { if (KEYMAP[k]) modalBlocks(); return; }
    }
    if (KEYMAP[k]) { doGo(KEYMAP[k]); e.preventDefault(); return; }
    switch ((k || '').toLowerCase()) {
      /* 'w' 는 Input 이 cut(1) 로 쓴다 (ONBOARDING §D). 인상선은 숫자 5 / 0. */
      case 'e': doGo('EXIT'); break;
      case '?': case '/': showRules(true); break;
      case 'z': case 'u': case 'backspace': undo(); break;
      case 'r': restart(); break;
      case 'h': hint(); break;
      case 'm': toggleMute(); break;
      case 'n': case 'enter': if (phase === 'WIN') nextLevel(); break;
      case 'escape': M('UI', 'levelSelect', false); break;
      default: return;
    }
    e.preventDefault();
  }

  /* ══════════════════════════════════════════════════════════════
     스크린샷 / 리뷰 API — SPEC §7
     포즈는 항상 같은 레벨·같은 시드·같은 상태에서 시작하고, 시간은
     stepSim() 으로만 흐르므로 몇 번을 호출해도 같은 그림이 나온다.
     ══════════════════════════════════════════════════════════════ */

  /* dist 가 있으면 = 카메라를 직접 배치(클로즈업). 없으면 = 히어로 박스 피팅.
     az/el 은 도(度). az 는 Render 와 같은 규약: 정남(+Z)에서 서(−X)쪽으로 잰 각.
     cam:'yard' 포즈는 az 를 지정하지 않는다 — 화면비에 맞춰 가로·세로를 고르게
     채우는 각을 frameHero 가 고른다(가로 ≈ −44°, 세로 ≈ −60°). */
  var POSES = {
    'establish':       { ui: false, cam: 'yard',    settle: 900,  fill: 0.96,
                         tod: 0.38, el: 30 },
    'ui':              { ui: true,  cam: 'yard',    settle: 900,  fill: 0.91,
                         tod: 0.38, el: 30, play: 2 },
    /* 화차 클로즈업: 뒤쪽 측선의 편성이 배경으로 겹치도록 방위를 잡아 하늘이 비지 않게 */
    'closeup-wagon':   { ui: false, cam: 'wagon',   settle: 800,
                         tod: 0.38, az: -34, el: 20, dist: 30 },
    /* 연결기: 궤도에 거의 직각으로, 그리고 **가장 바깥 측선(S3)** 에서 봐야
       옆 선에 선 화차 옆구리에 시야가 막히지 않는다 */
    'closeup-coupler': { ui: false, cam: 'coupler', settle: 800,
                         tod: 0.38, az: -22, el: 19, dist: 12,
                         attach: 2, attachOn: 'S3' },
    'closeup-track':   { ui: false, cam: 'track',   settle: 800,
                         tod: 0.40, az: -40, el: 26, dist: 13.5 },
    'mid-move':        { ui: false, cam: 'train',   settle: 500,  tod: 0.30,
                         az: -34, el: 23, dist: 66, attach: 2, move: true, moveMs: 1300 },
    'dusk':            { ui: false, cam: 'yard',    settle: 1000, fill: 0.96,
                         tod: 0.79, el: 27 },
    'win':             { ui: true,  cam: 'yard',    settle: 900,  fill: 0.91,
                         tod: 0.40, el: 30, win: true }
  };

  /* ── 포즈 전용 카메라 오버라이드 ──────────────────────────────
     SH.Render 의 궤도 리그는 거리 하한 120m · 고도 하한 18° 로 클램프되어 있어
     (플레이어가 흉한 각도를 못 찾게 하려는 것) 그대로는 클로즈업이 불가능하다.
     리뷰용 포즈에서만 Render.camera 의 lookAt 을 가로채, 리그가 매 프레임
     카메라를 다시 계산한 **직후**에 우리 위치/주시점을 덮어쓴다.
     (updateCamera 는 position → up → lookAt 순서라, lookAt 안에서 덮으면
      그 뒤의 근/원평면·안개·행렬 계산이 전부 우리 카메라 기준으로 돈다.)
     camOv = null 이면 원래 동작 그대로 — 게임 플레이에는 아무 영향이 없다. */

  var camOv = null, camHooked = null, camLookAt0 = null;

  function installCamHook() {
    var cam = SH.Render && SH.Render.camera;
    if (!cam || camHooked === cam) return;
    camHooked = cam;
    if (!camLookAt0) camLookAt0 = THREE.Object3D.prototype.lookAt;
    cam.lookAt = function (x, y, z) {
      if (camOv) {
        this.position.copy(camOv.pos);
        this.up.set(0, 1, 0);
        return camLookAt0.call(this, camOv.at);
      }
      return camLookAt0.call(this, x, y, z);
    };
  }

  function clearPoseCam() { camOv = null; }

  /** at 을 바라보며 거리 dist, 고도 el°, 방위 az° 에 카메라를 세운다. */
  function setPoseCam(at, dist, elDeg, azDeg) {
    if (!at) return false;
    var e = elDeg * Math.PI / 180, a = azDeg * Math.PI / 180, ce = Math.cos(e);
    var pos = new THREE.Vector3(-Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce)
      .multiplyScalar(dist).add(at);
    installCamHook();
    camOv = { pos: pos, at: at.clone() };
    /* 리그도 최대한 가깝게 맞춰 둔다 — 오버라이드가 풀렸을 때 카메라가 튀지 않도록 */
    M('Render', 'setCam', {
      target: at, azimuth: azDeg, elevation: Math.max(18, elDeg),
      distance: dist, instant: true
    });
    return true;
  }

  var shotStyle = null;

  function ensureShotStyle() {
    if (shotStyle) return;
    shotStyle = document.createElement('style');
    shotStyle.textContent =
      'body.sh-nogui #ui-root,body.sh-nogui #boot,body.sh-nogui .toast,' +
      'body.sh-nogui #sh-debug{display:none!important}';
    document.head.appendChild(shotStyle);
  }

  function setUIHidden(b) {
    ensureShotStyle();
    document.body.classList[b ? 'add' : 'remove']('sh-nogui');
    var root = document.getElementById('ui-root');
    if (root) root.style.display = b ? 'none' : '';
    M('UI', 'hide', b);
  }

  /** 세 측선이 모두 차 있고 화차가 가장 많은 레벨 = 전경 샷이 제일 꽉 찬다.
      (8량 부근이 최적. 너무 적으면 야드가 비어 보이고, 한 선에 몰리면 구도가 죽는다.) */
  function poseLevelIndex() {
    var pack = levelPack(), best = -1, bestScore = -1e9;
    for (var i = 0; i < pack.length; i++) {
      var s = pack[i].start || {};
      var n1 = (s.S1 || []).length, n2 = (s.S2 || []).length, n3 = (s.S3 || []).length;
      if (!n1 || !n2 || !n3) continue;
      var w = (pack[i].wagons || []).length;
      var score = w * 10 - Math.abs(w - 8) * 4 - Math.abs(n1 - n2) - Math.abs(n2 - n3);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) return best;
    for (var j = 0; j < pack.length; j++) {
      var t = pack[j].start || {};
      if ((t.S1 || []).length && (t.S2 || []).length) return j;
    }
    return Math.min(3, pack.length - 1);
  }

  function firstLegalTrack(order) {
    var list = order || TRACK_ORDER;
    for (var i = 0; i < list.length; i++) {
      if (pf('legalGo')(st, list[i]) === true) return list[i];
    }
    return null;
  }

  /** 기관차가 선 선의 화차를 서쪽부터 n량 연결한다 (물리 규칙과 동일).
      prefer 를 주면 그 선으로 먼저 보낸 것으로 친다 (포즈 구도용). */
  function attachWagons(n, prefer) {
    if (!st) return;
    if (prefer && st.tracks[prefer] && st.tracks[prefer].length) st.at = prefer;
    var t = st.tracks[st.at] || (st.tracks[st.at] = []);
    while (st.consist.length < n && t.length) st.consist.push(t.shift());
    for (var i = 0; i < TRACK_ORDER.length && st.consist.length < n; i++) {
      var id = TRACK_ORDER[i];
      var a = st.tracks[id];
      if (!a || !a.length) continue;
      st.at = id;
      while (st.consist.length < n && a.length) st.consist.push(a.shift());
    }
  }

  /** 규칙에 맞는 수를 n번 즉시(애니메이션 없이) 진행한다. */
  function autoPlay(n) {
    for (var i = 0; i < n; i++) {
      var t = firstLegalTrack();
      if (!t) break;
      var pre = pclone(st);
      var nx = pf('go')(st, t);
      if (!nx || !nx.tracks) nx = FB.go(pre, t);
      stamp(nx);
      pushUndo(pre);
      st = nx;
    }
    Game.state = st;
  }

  /** 승리한 배치를 직접 만든다 (EXIT = target, 나머지는 측선에 분산). */
  function buildWinState() {
    var s = createState(def), k;
    for (k in s.tracks) s.tracks[k] = [];
    var tgt = (def.target || []).slice();
    var ids = [], list = def.wagons || [];
    for (var i = 0; i < list.length; i++) ids.push(list[i].id);
    s.tracks.EXIT = tgt.slice();
    var sid = ['S1', 'S2', 'S3'], j = 0;
    for (var m = 0; m < ids.length; m++) {
      if (tgt.indexOf(ids[m]) >= 0) continue;
      var t = sid[j % sid.length];
      if (!s.tracks[t]) s.tracks[t] = [];
      s.tracks[t].push(ids[m]);
      j++;
    }
    s.consist = [];
    s.at = 'HEAD';
    s.moves = (def.par | 0) || 0;
    return stamp(s);
  }

  function anchorPos(v, side) {
    var rig = rigOf(v);
    var o = (rig && rig.couplers && rig.couplers[side]) ||
            (rig && rig.buffers && rig.buffers[side]) ||
            (v && v.group) || null;
    if (!o || !o.getWorldPosition) return null;
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(new THREE.Vector3());
  }

  /** 실루엣이 재미있는 차량을 결정론적으로 고른다. */
  function pickWagon() {
    var pref = ['tank', 'hopper', 'brake', 'open', 'box', 'flat'];
    var list = (def && def.wagons) || [];
    for (var p = 0; p < pref.length; p++) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === pref[p]) {
          var v = vehicleOf(list[i].id);
          if (v && v.group) return v;
        }
      }
    }
    for (var j = 0; j < list.length; j++) {
      var w = vehicleOf(list[j].id);
      if (w && w.group) return w;
    }
    return null;
  }

  function trainBox() {
    var b = new THREE.Box3(), any = false;
    var objs = [];
    if (world && world.loco && world.loco.group) objs.push(world.loco.group);
    var c = (st && st.consist) || [];
    for (var i = 0; i < c.length; i++) {
      var v = vehicleOf(c[i]);
      if (v && v.group) objs.push(v.group);
    }
    for (var k = 0; k < objs.length; k++) {
      var ob = boxOfObject(objs[k], 0);
      if (!ob) continue;
      if (any) b.union(ob); else { b.copy(ob); any = true; }
    }
    if (!any) return yardBox();
    b.expandByScalar(6);
    return b;
  }

  function camBox(kind) {
    if (kind === 'wagon') {
      var v = pickWagon();
      return boxOfObject(v && v.group, 0.8) || yardBox();
    }
    if (kind === 'coupler') {
      var a = anchorPos(world && world.loco, 'e');
      var b = anchorPos(vehicleOf(st && st.consist && st.consist[0]), 'w');
      var c = (a && b) ? a.clone().lerp(b, 0.5) : (a || b);
      if (!c) return yardBox();
      return new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(3.2, 2.6, 3.2));
    }
    if (kind === 'track') {
      var p = M('World', 'point', 'S1', 26);
      var pos = (p && p.pos && p.pos.clone) ? p.pos.clone() : new THREE.Vector3(10, 0.3, 2.5);
      pos.y = 0.35;
      return new THREE.Box3().setFromCenterAndSize(pos, new THREE.Vector3(7.5, 2.2, 5.4));
    }
    if (kind === 'train') return trainBox();
    return null;                                   /* 'yard' = 섬 윤곽으로 직접 피팅 */
  }

  /** 클로즈업 주시점 — 카메라를 직접 세울 때 쓴다. */
  function camTarget(kind) {
    var c, b;
    if (kind === 'wagon') {
      b = boxOfObject(pickWagon() && pickWagon().group, 0);
      if (b) {
        c = b.getCenter(new THREE.Vector3());
        c.y = b.min.y + (b.max.y - b.min.y) * 0.46;   // 차체 중앙보다 살짝 아래 = 접지가 보인다
        return c;
      }
    } else if (kind === 'coupler') {
      var a = anchorPos(world && world.loco, 'e');
      var w = anchorPos(vehicleOf(st && st.consist && st.consist[0]), 'w');
      /* 앵커는 레일면(y=0.3)에 있다 — 완충기·연결기 하드웨어 높이로 올려 잡는다 */
      if (a && w) { c = a.clone().lerp(w, 0.5); c.y += 0.78; return c; }
      if (a || w) { c = (a || w).clone(); c.y += 0.78; return c; }
    } else if (kind === 'track') {
      /* S1 의 직선 구간. z 를 S2 쪽으로 조금 밀어 두 선로와 그 사이 자갈·잡초를 함께 담는다. */
      var p = M('World', 'point', 'S1', 30);
      var pos = (p && p.pos && p.pos.clone) ? p.pos.clone() : new THREE.Vector3(14, 0.3, 2.5);
      pos.y = 0.42; pos.z += 1.6;
      return pos;
    } else if (kind === 'train') {
      b = trainBox();
      if (b) { c = b.getCenter(new THREE.Vector3()); c.y = 2.4; return c; }
    }
    b = camBox(kind) || yardBox();
    return b.getCenter(new THREE.Vector3());
  }

  function applyPose(p) {
    if (p.dist) {
      if (setPoseCam(camTarget(p.cam), p.dist, p.el, p.az)) return;
    }
    clearPoseCam();
    frameHero({
      box: camBox(p.cam), instant: true,
      fill: p.fill == null ? 0.86 : p.fill,
      el: (typeof p.el === 'number') ? p.el : undefined,
      az: (typeof p.az === 'number') ? p.az : undefined
    });
  }

  function doPose(name) {
    name = String(name || 'establish');
    var p = POSES[name] || POSES.establish;
    noPersist = true;
    clearPoseCam();                 // 이전 포즈의 카메라 잠금을 반드시 먼저 푼다

    // 항상 같은 레벨·같은 시드에서 다시 시작 → 결정론
    loadLevel(poseLevelIndex(), { noSave: true, tod: p.tod == null ? undefined : p.tod });
    if (p.tod != null) M('Render', 'setTimeOfDay', p.tod);
    setPhase('PLAY');

    if (p.attach) { attachWagons(p.attach, p.attachOn); M('Motion', 'snap', st); }
    if (p.play)   { autoPlay(p.play);       M('Motion', 'snap', st); }
    if (p.win)    { st = buildWinState(); Game.state = st; M('Motion', 'snap', st); }

    refreshLevelUI();
    M('Input', 'pickables', world, st);
    setUIHidden(!p.ui);

    applyPose(p);
    stepSim(p.settle == null ? 800 : p.settle);
    applyPose(p);                   // settle 중 차량이 움직였을 수 있으니 다시 조준

    if (p.move) {
      var t = firstLegalTrack(['S3', 'S2', 'S1', 'EXIT', 'HEAD']);
      if (t) {
        doGo(t);
        stepSim(p.moveMs || 1250);
        applyPose(p);               // 달리는 열차에 카메라를 다시 맞춘다
        stepSim(110);               // 배기·먼지가 살아있는 순간
        applyPose(p);
      }
    }
    if (p.win) { presentWin(); stepSim(520); applyPose(p); }

    renderFrame(0);
    return name;
  }

  function shotInfo() {
    var r = SH.Render && SH.Render.renderer;
    var i = r && r.info;
    var deadList = [];
    for (var k in dead) deadList.push(k);
    return {
      fps: Math.round(fpsNow * 10) / 10,
      tris: i ? (i.render.triangles | 0) : 0,
      calls: i ? (i.render.calls | 0) : 0,
      /* quality 는 **렌더러의 실제 값**을 보고한다. 예전엔 Game 의 지역 변수를 그대로 내보냈는데,
         Render.autoQuality 가 내부적으로 강등해도 Game 에는 통보되지 않아 계측이 거짓말을 했다
         (실제로 강등이 일어난 상황을 "강등 안 됨" 으로 오판했다). qualityGame 은 참고용. */
      quality: (SH.Render && typeof SH.Render.quality === 'number') ? SH.Render.quality : quality,
      qualityGame: quality,
      phase: phase,
      level: curIndex,
      levelId: def ? def.id : null,
      moves: st ? (st.moves | 0) : 0,
      par: def ? (def.par | 0) : 0,
      geometries: (i && i.memory) ? (i.memory.geometries | 0) : 0,
      textures: (i && i.memory) ? (i.memory.textures | 0) : 0,
      errors: (U._errors || []).length,
      disabled: deadList
    };
  }

  var SHOT = window.__SHOT = {
    ready: false,
    pose: function (name) {
      return new Promise(function (res) {
        try { doPose(name); } catch (e) { U.err(e); }
        res(true);
      });
    },
    level: function (i) {
      return new Promise(function (res) {
        try { noPersist = true; loadLevel(i | 0, { noSave: true }); stepSim(600); }
        catch (e) { U.err(e); }
        res(true);
      });
    },
    step: function (ms) { try { stepSim(ms); } catch (e) { U.err(e); } return true; },
    hideUI: function (b) { try { setUIHidden(!!b); } catch (e) { U.err(e); } return true; },
    info: function () { try { return shotInfo(); } catch (e) { U.err(e); return null; } }
  };

  /* ── 공개 API ─────────────────────────────────────────────── */

  var Game = {
    boot: boot,
    phase: phase,
    quality: quality,
    ready: false,
    state: null,
    level: null,
    levelIndex: 0,
    world: null,
    go: doGo,
    cut: doCut,
    undo: undo,
    restart: restart,
    hint: hint,
    next: nextLevel,
    loadLevel: loadLevel,
    setQuality: setQuality,
    share: share,
    mute: toggleMute,
    isBusy: function () { return !!busy; },
    rules: showRules,
    tutorialSkip: tutSkip,
    fresh: freshMode,
    trackName: trackName,
    stars: starsFor,
    totalStars: totalStars
  };

  return Game;
})();
