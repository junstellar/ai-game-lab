/* ============================================================================
   조차장 / SHUNTING — 50-puzzle.js
   순수 게임 규칙 + 최적 솔버.  THREE / DOM 을 일절 참조하지 않습니다.
   → SH.Puzzle
   ============================================================================ */
/* CONTRACT ────────────────────────────────────────────────────────────────────

  SH.Puzzle — SPEC.md §2 (규칙) / §6 (계약) 의 구현. 완전 결정적, 부작용 없음.

  ── 상태 ────────────────────────────────────────────────────────────────────
  state = {
    tracks : { HEAD:[wagonId…], S1:[…], S2:[…], S3:[…], EXIT:[…] },  // 서→동
    at     : 'HEAD',      // 기관차가 서 있는 트랙 id
    consist: [wagonId…],  // 기관차에 연결된 화차, 서→동 (기관차는 consist[0] 의 서쪽)
    moves  : 0,           // 지금까지 쓴 go 횟수
    target : [wagonId…],  // 이 레벨의 EXIT 목표 (meta.target 과 같은 배열 참조)
    meta   : { order, caps, kinds, head, exit, target, levelId }
  }
  · 트랙 `at` 위의 물리적 배열은 [LOCO, ...consist, ...tracks[at]] 입니다.
  · `meta` 는 레벨 상수(불변)이며 clone 시 참조가 공유됩니다. 절대 수정하지 마세요.
  · go/cut/apply 는 모두 **새 상태를 반환**합니다 (입력 상태는 변경되지 않음).
    → Game 의 undo 스택은 그냥 이전 상태 객체를 쌓으면 됩니다.

  ── 공개 API ────────────────────────────────────────────────────────────────
  Puzzle.create(levelDef) -> state
  Puzzle.clone(state) -> state
  Puzzle.meta(state) -> meta                     // 없으면 추론해서 붙여 줌
  Puzzle.cap(state, trackId) -> int
  Puzzle.trackIds(state) -> [id…]                // 정규 순서
  Puzzle.headId(state) / Puzzle.exitId(state) -> id

  Puzzle.legalGo(state, trackId) -> true | 'same' | 'head-full' | 'track-full' | 'no-track'
  Puzzle.legalCut(state, k)      -> true | 'bad-k'
  Puzzle.legalMoves(state)       -> [{type:'go', track}]        // 지금 바로 가능한 go
  Puzzle.maxCut(state, trackId)  -> int | -1                    // 그 트랙으로 갈 수 있는 최대 k
  Puzzle.go(state, trackId) -> state             // 불법이면 throw
  Puzzle.cut(state, k) -> state                  // 0 move. k = 남길 량 수 (0..consist.length)
  Puzzle.apply(state, move) -> state             // move = {type:'go',track} | {type:'cut',k}
  Puzzle.applyAll(state, moves) -> state
  Puzzle.isWin(state, target?) -> bool
  Puzzle.key(state) -> string                    // 정규화 키 (트랙 순서 고정 + consist + at)

  Puzzle.solve(state, target?, opts?) -> { moves:[…], gos:int, nodes:int, ms:number } | null
      opts = { maxNodes:Puzzle.MAX_NODES, timeLimit:ms, target:[…], method:'auto'|'bidi'|'astar' }
      · go 횟수 최소를 **보장**합니다 (par 계산에 그대로 씁니다).
      · 한 엣지 = cut(k) 후 go(t). cut 은 무료이므로 반환 moves 안에 섞여 나옵니다.
      · cut 이 무료라는 점 때문에 목표 판정은 "tracks.EXIT === target && at !== EXIT" 이며,
        consist 가 남아 있으면 마지막에 {type:'cut',k:0} 이 자동으로 붙습니다.
      · 기본은 **양방향 BFS(정수 인코딩 코어)**. 야드의 모든 화차가 target 에 들어가는
        보통의 레벨에서는 목표 배치가 하나로 확정되므로 역방향 탐색이 가능합니다.
        8화차/5트랙(sh-14)이 처음 350ms 내외, 같은 레벨을 다시 풀면 100ms 내외입니다.
        목표가 화차의 일부뿐이거나(목표 집합이 커짐) 화차가 아주 많아 상태를 정수 하나로
        못 담으면 자동으로 **A*** (허용적 휴리스틱 + 재확장 + 사이딩 대칭 축약) 로 갑니다.
      · 어느 경로로 풀렸든 반환 직전에 수순을 **게임 규칙으로 재실행하며 검증**합니다.
        검증에 실패하면 A* 로 다시 풀고, 그것도 안 되면 null.
      · 상한(maxNodes/timeLimit)에 걸리면 대부분 **null**. Puzzle.stats.aborted 로 구분.
      · 성공하면 그 경로 전체를 힌트 색인에 넣습니다 (아래 hint 참고).
  Puzzle.solveAsync(state, target?, opts?) -> handle
      opts = { slice:6, immediate:ms|true, maxNodes, target, onDone(res,h), onProgress(info) }
      handle = { done, cancelled, result, ms, slices, pump(ms)->bool, cancel(), schedule() }
      · **메인 스레드를 막지 않는 solve.** 한 콜백에서 slice ms 만 쓰고 다음 유휴 시간으로
        넘깁니다 (requestIdleCallback → rAF → setTimeout). Web Worker 를 쓰지 않습니다.
      · 결과는 solve 와 **같은 최적값**입니다. 끝나면 경로가 힌트 색인에 들어갑니다.
      · pump(ms) 로 직접 동기 진행시킬 수도 있습니다 (테스트/즉시 응답용).
      · 동시에 살아 있는 탐색은 하나뿐 — 새 탐색이 시작되면 이전 것은 취소됩니다.
  Puzzle.prewarm(state, target?, opts?) -> handle | null
      · 최적 경로를 유휴 시간에 미리 풀어 둔다. **Puzzle.create 가 자동으로 예약**하므로
        (Puzzle.autoPrewarm) 레벨을 연 뒤 잠깐 지나면 힌트는 탐색 없이 즉답입니다.
  Puzzle.hint(state, target?) -> move | null     // 최적 경로의 다음 한 수 (cut 일 수도 있음)
  Puzzle.hintGo(state, target?) -> {cut:k|null, track:id} | null   // UI 용 요약
  Puzzle.hintReady(state, target?) -> bool       // 지금 누르면 탐색 없이 나오는가
      · 힌트는 ① 색인된 최적 경로 위 → O(1), ② 캐시된 역방향 거리표 안 → O(경로길이),
        ③ 그 외에는 Puzzle.HINT_SYNC_MS(기본 6ms)만 동기로 풀어 보고 못 끝내면
        **백그라운드로 넘기고 null** 을 돌려줍니다. 프레임을 길게 잡아먹지 않는 것이
        우선이라, UI 는 null 이면 레벨의 기본 힌트 문구를 띄우면 됩니다 (잠시 뒤 다시
        누르면 정확한 수가 나옵니다). hintReady() 로 미리 물어볼 수 있습니다.
      · 어느 경로로 답하든 **항상 최적**입니다. 대충 좋은 수를 주지 않습니다.
  Puzzle.clearCache()                            // 색인·역방향 캐시·진행 중 탐색을 버림
  Puzzle.par(levelDef, opts?) -> int | null      // BFS 최적 go 수
  Puzzle.reachableAnalysis(state, target?, opts?)
      -> { solvable:true|false|null, gos:int, reason:null|'missing-wagon'|'dup-wagon'|
           'deadlock'|'bad-state'|'unknown', aborted:bool }
      · solvable === false 이면 데드락 (UI 가 "다시 시작" 을 권할 수 있음).
      · solvable === null 은 탐색 상한 초과 — 모른다는 뜻.
  Puzzle.stats -> { nodes, expanded, ms, aborted, gos }   // 마지막 동기 solve 의 통계
  Puzzle.MAX_NODES        // 방문 상한 (쓰기 가능)
  Puzzle.MAX_CACHE_NODES  // 역방향 색인을 캐시에 남길 최대 크기
  Puzzle.SLICE_MS         // solveAsync 가 한 콜백에서 쓰는 시간 (기본 6)
  Puzzle.HINT_SYNC_MS     // hint 가 동기로 버티는 시간 (기본 6, 0 이면 끝까지 동기)
  Puzzle.autoPrewarm      // create() 시 최적 경로를 미리 풀어 둘지 (기본 true)
  Puzzle._selfTest() -> { pass:bool, cases:[{name,pass,detail}] }   // 콘솔 출력 없음

  ── 다른 모듈이 알아야 할 것 ────────────────────────────────────────────────
  · 불법 사유 코드는 위 5종이 전부. UI 가 한국어로 매핑하세요.
  · Math.random 미사용, 완전 결정적. 같은 입력 → 같은 최적 go 수.
    (여러 최적해가 있을 때 어느 것을 고르는지는 캐시 상태에 따라 달라질 수 있습니다.
     go 수는 언제나 같습니다.)
  · 이 파일은 THREE / document / localStorage 를 쓰지 않습니다.
    SH.U.now 와, 조각 탐색을 위한 requestIdleCallback/rAF/setTimeout 만 씁니다.
  · 캐시는 전부 메모리 안에만 있고 Puzzle.clearCache() 로 언제든 비울 수 있습니다.
  ───────────────────────────────────────────────────────────────────────────── */

SH.Puzzle = (function () {
  'use strict';

  var SEP = '\u0001';       // 키 구분자
  var BASE = 0x100;         // 화차 id → 문자 인코딩 시작점 (SEP 와 절대 충돌하지 않음)

  var DEFAULT_TRACKS = [
    { id: 'HEAD', kind: 'head',   capacity: 4 },
    { id: 'S1',   kind: 'siding', capacity: 4 },
    { id: 'S2',   kind: 'siding', capacity: 4 },
    { id: 'S3',   kind: 'siding', capacity: 4 },
    { id: 'EXIT', kind: 'exit',   capacity: 12 }
  ];

  var _stats = { nodes: 0, expanded: 0, ms: 0, aborted: false, gos: -1 };

  function now() {
    var U = SH.U;
    return (U && U.now) ? U.now() : Date.now();
  }
  function eqArr(a, b) {
    var U = SH.U;
    if (U && U.eqArr) return U.eqArr(a, b);
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* ── 레벨 상수(meta) ─────────────────────────────────────────── */

  function buildMeta(trackDefs, target, levelId) {
    var order = [], caps = {}, kinds = {}, head = null, exit = null;
    for (var i = 0; i < trackDefs.length; i++) {
      var d = trackDefs[i], id = d.id;
      var kind = d.kind || (id === 'HEAD' ? 'head' : (id === 'EXIT' ? 'exit' : 'siding'));
      order.push(id);
      kinds[id] = kind;
      caps[id] = (d.capacity != null) ? (d.capacity | 0) : (kind === 'exit' ? 99 : 4);
      if (kind === 'head' && head === null) head = id;
      if (kind === 'exit' && exit === null) exit = id;
    }
    if (head === null) head = (order.indexOf('HEAD') >= 0) ? 'HEAD' : order[0];
    if (exit === null) exit = (order.indexOf('EXIT') >= 0) ? 'EXIT' : order[order.length - 1];
    return {
      order: order, caps: caps, kinds: kinds, head: head, exit: exit,
      target: (target || []).slice(), levelId: levelId == null ? null : levelId
    };
  }

  /** meta 가 없는 상태(외부에서 손으로 만든 것)도 안전하게 다루기 위한 추론 */
  function meta(state) {
    if (state && state.meta) return state.meta;
    if (!state || !state.tracks) throw new Error('Puzzle: 상태가 아닙니다');
    var ids = Object.keys(state.tracks), defs = [], i;
    for (i = 0; i < ids.length; i++) {
      var known = null;
      for (var j = 0; j < DEFAULT_TRACKS.length; j++) {
        if (DEFAULT_TRACKS[j].id === ids[i]) { known = DEFAULT_TRACKS[j]; break; }
      }
      defs.push(known || { id: ids[i], kind: 'siding', capacity: 4 });
    }
    var m = buildMeta(defs, state.target || [], null);
    try {
      Object.defineProperty(state, 'meta', { value: m, enumerable: false, writable: true, configurable: true });
    } catch (e) { state.meta = m; }
    return m;
  }

  function trackIds(state) { return meta(state).order.slice(); }
  function headId(state) { return meta(state).head; }
  function exitId(state) { return meta(state).exit; }
  function cap(state, id) { var c = meta(state).caps[id]; return c == null ? 0 : c; }

  /* ── 생성 / 복제 ─────────────────────────────────────────────── */

  function create(levelDef) {
    if (!levelDef) throw new Error('Puzzle.create: levelDef 가 없습니다');
    var defs = (levelDef.tracks && levelDef.tracks.length) ? levelDef.tracks : DEFAULT_TRACKS;
    var m = buildMeta(defs, levelDef.target, levelDef.id);
    var start = levelDef.start || {};
    var tracks = {};
    for (var i = 0; i < m.order.length; i++) {
      var id = m.order[i], s = start[id];
      tracks[id] = s ? s.slice() : [];
    }
    var at = start.at || m.head;
    if (!tracks[at]) at = m.head;
    var st = {
      tracks: tracks,
      at: at,
      consist: (start.consist ? start.consist.slice() : []),
      moves: 0,
      target: m.target
    };
    try {
      Object.defineProperty(st, 'meta', { value: m, enumerable: false, writable: true, configurable: true });
    } catch (e) { st.meta = m; }
    // 레벨을 열면 최적 경로를 유휴 시간에 미리 풀어 둔다 (힌트를 즉답으로 만들기 위해).
    // 여러 번 부르면 마지막 것만 살아남고, 어떤 solve 든 시작하면 즉시 취소됩니다.
    try { warmLater(st, m.target); } catch (e) { }
    return st;
  }

  function clone(state) {
    var m = meta(state), tracks = {}, i;
    for (i = 0; i < m.order.length; i++) {
      var id = m.order[i];
      tracks[id] = (state.tracks[id] || []).slice();
    }
    // meta.order 에 없는 트랙이 있으면 (방어) 같이 복사
    var extra = Object.keys(state.tracks);
    for (i = 0; i < extra.length; i++) {
      if (!tracks[extra[i]]) tracks[extra[i]] = state.tracks[extra[i]].slice();
    }
    var st = {
      tracks: tracks,
      at: state.at,
      consist: state.consist.slice(),
      moves: state.moves | 0,
      target: state.target
    };
    try {
      Object.defineProperty(st, 'meta', { value: m, enumerable: false, writable: true, configurable: true });
    } catch (e) { st.meta = m; }
    return st;
  }

  /* ── 규칙 ────────────────────────────────────────────────────── */

  function legalGo(state, t) {
    var m = meta(state);
    if (!state.tracks[t]) return 'no-track';
    if (t === state.at) return 'same';
    var capH = m.caps[m.head] | 0;
    var n = state.consist.length;
    if (1 + n > capH) return 'head-full';                       // 컷 전체가 스로트를 못 벗어남
    if (1 + n + state.tracks[t].length > (m.caps[t] | 0)) return 'track-full';
    return true;
  }

  /** 그 트랙으로 갈 수 있는 최대 k (cut 후 남길 량 수). 갈 방법이 없으면 -1 */
  function maxCut(state, t) {
    var m = meta(state);
    if (!state.tracks[t] || t === state.at) return -1;
    var lim = Math.min(state.consist.length, (m.caps[m.head] | 0) - 1,
                       (m.caps[t] | 0) - 1 - state.tracks[t].length);
    return lim < 0 ? -1 : lim;
  }

  function legalCut(state, k) {
    if (typeof k !== 'number' || !isFinite(k) || k !== (k | 0)) return 'bad-k';
    if (k < 0 || k > state.consist.length) return 'bad-k';
    return true;
  }

  function go(state, t) {
    var r = legalGo(state, t);
    if (r !== true) throw new Error('Puzzle.go: 불법 이동 (' + r + ') → ' + t);
    var ns = clone(state);
    ns.consist = state.consist.concat(state.tracks[t]);   // 그 트랙의 전부와 연결
    ns.tracks[t] = [];
    ns.at = t;
    ns.moves = (state.moves | 0) + 1;
    return ns;
  }

  function cut(state, k) {
    var r = legalCut(state, k);
    if (r !== true) throw new Error('Puzzle.cut: 잘못된 k (' + k + ')');
    var ns = clone(state);
    ns.tracks[state.at] = state.consist.slice(k).concat(state.tracks[state.at]);
    ns.consist = state.consist.slice(0, k);
    return ns;                                            // moves 그대로 (무료)
  }

  function apply(state, move) {
    if (!move) return state;
    if (move.type === 'go') return go(state, move.track);
    if (move.type === 'cut') return cut(state, move.k);
    throw new Error('Puzzle.apply: 알 수 없는 move.type ' + move.type);
  }
  function applyAll(state, moves) {
    var s = state;
    for (var i = 0; i < moves.length; i++) s = apply(s, moves[i]);
    return s;
  }

  function legalMoves(state) {
    var m = meta(state), out = [];
    for (var i = 0; i < m.order.length; i++) {
      var id = m.order[i];
      if (legalGo(state, id) === true) out.push({ type: 'go', track: id });
    }
    return out;
  }

  function isWin(state, target) {
    var m = meta(state);
    var tgt = target || state.target || m.target || [];
    if (state.at === m.exit) return false;                // 기관차가 출발선을 비켜야 한다
    if (state.consist.length !== 0) return false;
    return eqArr(state.tracks[m.exit] || [], tgt);
  }

  function key(state) {
    var m = meta(state), s = '';
    for (var i = 0; i < m.order.length; i++) {
      s += (state.tracks[m.order[i]] || []).join(',') + SEP;
    }
    return s + state.consist.join(',') + SEP + state.at;
  }

  /* ── 정수 인코딩 탐색 코어 ───────────────────────────────────────────────
     예전 구현은 상태를 문자열로 다뤘습니다. 노드마다 join / split / Map(문자열) 이
     들어가는데, 8화차 레벨은 노드가 50만을 넘어가므로 이것만으로 1.4초가 나갔습니다.
     (측정: sh-14 solve 1494ms / 노드 567k → 노드당 2.1µs, 그중 대부분이 문자열·Map)

     그래서 상태를 **정수 하나**로 압축합니다.
       · 화차 id 를 목표 순서대로 1..NW 심볼로 바꾼다 → 목표는 항상 1,2,…,NW.
       · 트랙/컨시스트는 서→동을 자릿수로 갖는 B(=NW+1)진수 정수. 0 은 구분자.
       · 키 = [트랙0]0[트랙1]0…[트랙NT-1]0[컨시스트] 를 이어붙인 뒤 ×NT + at.
         자릿수 NW+NT, 최댓값 B^(NW+NT)·NT.  8화차/5트랙이면 9^13·5 ≈ 1.3e13 로
         double 정수 한계(2^53)에 한참 못 미칩니다. 넘어가면(화차가 아주 많으면)
         이 코어를 쓰지 않고 solve 가 기존 A* 로 넘어갑니다.
       · 방문 집합은 Map 대신 **열린 주소 해시(Int32Array)** — 슬롯에는 노드 번호만
         담고 키 비교는 Float64Array 에서 합니다.
     덕분에 노드당 비용이 1/8 수준으로 떨어지고, 노드 배열이 전부 TypedArray 라
     메모리도 예전의 1/4 입니다.

     ── 역방향 색인 재사용 ────────────────────────────────────────────────
     역방향 BFS 는 **시작 상태와 무관**합니다 (목표 배치에서 거꾸로 퍼질 뿐).
     화차 심볼을 목표 순서로 고정했으므로 목표 내용도 항상 1..NW 로 같습니다.
     따라서 (트랙 수 · 용량 · 인상선 용량 · EXIT 위치 · 화차 수) 가 같으면 역방향
     색인을 그대로 재사용할 수 있습니다. 같은 레벨 안에서 두 번째 이후의 solve 는
     역방향을 다시 만들지 않고, 게다가 **역방향 색인에 들어 있는 상태는 거리표를
     한 칸씩 내려가며 O(1) 로 최적 수순을 뽑을 수 있습니다** (힌트가 여기서 즉답).
     ──────────────────────────────────────────────────────────────────── */

  var MAX_KEY = 4503599627370496;             // 2^52. 키가 이보다 크면 정수 코어 불가
  var _bw = null;                             // { sig, S } 재사용 가능한 역방향 색인
  var _live = null;                           // 진행 중(조각 탐색) 핸들 — 동시에 하나만

  /* 열린 주소 해시.
     키를 슬롯에 **직접** 담습니다 (0 = 빈 칸. 키는 항상 ≥ 1 이라 안 겹침).
     노드 배열을 한 번 더 들여다보는 구조로 만들면 탐색 한 번에 임의 접근이 두 번
     생겨서 캐시 미스가 두 배가 됩니다 — 그 차이가 전체 시간의 절반쯤 됩니다. */
  function htNew(bits) {
    var cap = 1 << bits;
    return { bits: bits, mask: cap - 1, n: 0, lim: cap >> 1,
             k: new Float64Array(cap), v: new Int32Array(cap) };
  }
  function htHash(k) {
    var lo = k >>> 0, hi = (k - lo) / 4294967296;
    var h = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA6B);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13;
    return h;
  }
  /** k 가 놓일 슬롯. ht.k[slot] === 0 이면 아직 없는 상태(그 자리에 넣으면 된다) */
  function htSlot(ht, k) {
    var t = ht.k, mask = ht.mask, i = htHash(k) & mask, x;
    while ((x = t[i]) !== 0 && x !== k) i = (i + 1) & mask;
    return i;
  }
  function htFind(ht, k) {
    var i = htSlot(ht, k);
    return ht.k[i] === 0 ? -1 : ht.v[i];
  }
  /* 2배씩. 4배씩 늘리면 재해싱 횟수는 줄지만 **한 번이 20ms 넘게** 걸려서
     조각 탐색 중에 프레임이 통째로 날아갑니다 (측정: 최악 프레임 58ms). */
  function htGrow(ht) {
    var ok = ht.k, ov = ht.v, bits = ht.bits + 1, cap = 1 << bits, i, x, j;
    ht.bits = bits; ht.mask = cap - 1; ht.lim = cap >> 1;
    var nk = ht.k = new Float64Array(cap), nv = ht.v = new Int32Array(cap), mask = ht.mask;
    for (i = 0; i < ok.length; i++) {
      x = ok[i]; if (x === 0) continue;
      j = htHash(x) & mask;
      while (nk[j] !== 0) j = (j + 1) & mask;
      nk[j] = x; nv[j] = ov[i];
    }
  }

  /* 탐색 한쪽(순방향/역방향)의 노드 저장소.
     배열이 커지는 순간(재할당·재해싱)은 수 ms 씩 걸리므로 그 프레임에서는 바로
     양보하도록 _grew 로 알립니다 — 안 그러면 조각 예산을 크게 넘깁니다. */
  var _grew = false;

  function sideNew() {
    var n = 16384;
    return {
      key: new Float64Array(n), g: new Uint16Array(n), p: new Int32Array(n),
      mk: new Int8Array(n), mt: new Int8Array(n), n: 0,
      ht: htNew(15), fr: [], nx: [], fi: 0, depth: 0
    };
  }
  /** slot 은 htSlot 으로 미리 구한 빈 자리 (탐색을 두 번 하지 않기 위해) */
  function sidePush(S, k, g, par, mk, mt, slot) {
    if (S.n >= S.key.length) {
      var cap = S.key.length * 2, a;
      a = new Float64Array(cap); a.set(S.key); S.key = a;
      a = new Uint16Array(cap); a.set(S.g); S.g = a;
      a = new Int32Array(cap); a.set(S.p); S.p = a;
      a = new Int8Array(cap); a.set(S.mk); S.mk = a;
      a = new Int8Array(cap); a.set(S.mt); S.mt = a;
      _grew = true;
    }
    var i = S.n++;
    S.key[i] = k; S.g[i] = g; S.p[i] = par; S.mk[i] = mk; S.mt[i] = mt;
    var ht = S.ht;
    if (slot === undefined) slot = htSlot(ht, k);
    ht.k[slot] = k; ht.v[slot] = i;
    if (++ht.n > ht.lim) { htGrow(ht); _grew = true; }
    return i;
  }

  /**
   * 레벨의 "모양"(상수) + 시작 상태 인코딩. 양방향 탐색이 불가능하면 null.
   * 불가능 조건: 목표에 중복 / 야드 화차가 목표와 다름 / EXIT 용량 부족 / 키 초과.
   */
  function shapeOf(m, state, target) {
    var order = m.order, NT = order.length, i, j;
    var atI = order.indexOf(state.at), exitI = order.indexOf(m.exit);
    if (NT < 2 || atI < 0 || exitI < 0) return null;
    var TL = target ? target.length : 0;
    if (TL < 1) return null;

    var caps = new Int32Array(NT);
    for (i = 0; i < NT; i++) caps[i] = m.caps[order[i]] | 0;
    var capH = m.caps[m.head] | 0; if (capH < 1) capH = 1;
    if (TL > caps[exitI]) return null;

    var sym = Object.create(null);
    for (i = 0; i < TL; i++) {
      if (sym[target[i]] !== undefined) return null;       // 목표에 같은 화차가 두 번
      sym[target[i]] = i + 1;
    }
    var NW = TL, B = NW + 1, nd = NW + NT;
    var POW = new Float64Array(nd + 1);
    POW[0] = 1;
    for (i = 1; i <= nd; i++) POW[i] = POW[i - 1] * B;
    if (POW[nd] * NT > MAX_KEY) return null;               // 정수 키에 안 들어감 → A*

    var vals = new Float64Array(NT + 1), lens = new Int32Array(NT + 1);
    var seen = new Uint8Array(NW + 1), cnt = 0, s;
    for (i = 0; i < NT; i++) {
      var arr = state.tracks[order[i]] || [], v = 0;
      for (j = 0; j < arr.length; j++) {
        s = sym[arr[j]];
        if (s === undefined || seen[s]) return null;       // 목표 밖 화차 / 중복
        seen[s] = 1; cnt++; v = v * B + s;
      }
      vals[i] = v; lens[i] = arr.length;
    }
    var con = state.consist || [], cv = 0;
    for (j = 0; j < con.length; j++) {
      s = sym[con[j]];
      if (s === undefined || seen[s]) return null;
      seen[s] = 1; cnt++; cv = cv * B + s;
    }
    vals[NT] = cv; lens[NT] = con.length;
    if (cnt !== TL) return null;                           // 야드에 목표가 다 있지 않음

    var goalV = 0;
    for (i = 0; i < TL; i++) goalV = goalV * B + (i + 1);

    function encode(vv, ll, at) {
      var key = 0, z;
      for (z = 0; z < NT; z++) key = (key * POW[ll[z]] + vv[z]) * B;
      return (key * POW[ll[NT]] + vv[NT]) * NT + at;
    }
    /* double 나눗셈/나머지는 곱셈보다 10배 넘게 비쌉니다 (프로파일에서 decode 가
       전체의 19% 였습니다). 자릿수가 0..NW 로 작으므로 **뺄셈 반복**으로 뽑습니다. */
    function decode(key, vv, ll) {
      var at = key % NT, r = (key - at) / NT, z, d, pw;
      var li = 0, v = 0, ln = 0;
      for (z = nd - 1; z >= 0; z--) {                    // 위 자리부터
        pw = POW[z]; d = 0;
        while (r >= pw) { r -= pw; d++; }
        if (d === 0) { vv[li] = v; ll[li] = ln; li++; v = 0; ln = 0; }
        else { v = v * B + d; ln++; }
      }
      vv[NT] = v; ll[NT] = ln;                           // 마지막 구간 = 컨시스트
      return at;
    }

    return {
      NT: NT, atI: atI, exitI: exitI, caps: caps, capH: capH,
      TL: TL, NW: NW, B: B, nd: nd, POW: POW, goalV: goalV,
      order: order, vals: vals, lens: lens,
      rootKey: encode(vals, lens, atI),
      encode: encode, decode: decode,
      sig: NT + ':' + Array.prototype.join.call(caps, ',') + ':' + capH + ':' + exitI + ':' + TL
    };
  }

  /**
   * 양방향 탐색 컨텍스트. run(deadline) 을 반복 호출하면 이어서 탐색합니다.
   *   run -> 'run'(예산 소진, 계속) | 'done' | 'none'(해 없음) | 'abort'(상한/취소)
   */
  function makeBidi(shape, opts) {
    if (_live && !_live.done) _live.cancel();               // 동시에 두 탐색은 금지
    var NT = shape.NT, B = shape.B, nd = shape.nd, POW = shape.POW;
    var caps = shape.caps, capH = shape.capH, exitI = shape.exitI;
    var encode = shape.encode, decode = shape.decode;
    var maxN = (opts && opts.maxNodes) || 0;

    var F = sideNew(), S, i;
    if (_bw && _bw.sig === shape.sig) S = _bw.S;
    else {
      S = sideNew();
      var gv = new Float64Array(NT + 1), gl = new Int32Array(NT + 1);
      gv[exitI] = shape.goalV; gl[exitI] = shape.TL;
      for (i = 0; i < NT; i++) {
        if (i === exitI || caps[i] < 1) continue;
        var gk = encode(gv, gl, i);
        if (htFind(S.ht, gk) >= 0) continue;
        S.fr.push(sidePush(S, gk, 0, -1, -1, -1));
      }
      _bw = { sig: shape.sig, S: S };
    }

    var n0 = F.n + S.n;
    var mu = Infinity, muF = -1, muB = -1;
    var aborted = false, cancelled = false, expanded = 0, cur = 0;
    var vv = new Float64Array(NT + 1), ll = new Int32Array(NT + 1);

    var root = sidePush(F, shape.rootKey, 0, -1, -1, -1);
    F.fr.push(root);
    var h0 = htFind(S.ht, shape.rootKey);
    if (h0 >= 0) { mu = S.g[h0]; muF = root; muB = h0; }

    function over() { return maxN > 0 && (F.n + S.n - n0) >= maxN; }

    function stepF(deadline) {
      var fr = F.fr, nx = F.nx, tick = 0, k, ti;
      while (F.fi < fr.length) {
        if (over()) { aborted = true; return false; }
        if (((tick++) & 15) === 0 && deadline && now() > deadline) return false;
        var ni = fr[F.fi++];
        var a = decode(F.key[ni], vv, ll);
        var conV = vv[NT], conL = ll[NT], ng = F.g[ni] + 1;
        var oldV = vv[a], oldL = ll[a];
        expanded++;
        var kmax = conL < (capH - 1) ? conL : (capH - 1);
        for (k = 0; k <= kmax; k++) {
          var rest = conL - k;
          var dv = rest === 0 ? 0 : conV % POW[rest];
          var kv = rest === 0 ? conV : (conV - dv) / POW[rest];
          vv[a] = dv * POW[oldL] + oldV; ll[a] = rest + oldL;
          for (ti = 0; ti < NT; ti++) {
            if (ti === a) continue;
            var tl = ll[ti];
            if (1 + k + tl > caps[ti]) continue;
            var tv = vv[ti];
            vv[ti] = 0; ll[ti] = 0;
            vv[NT] = kv * POW[tl] + tv; ll[NT] = k + tl;
            var nk = encode(vv, ll, ti);
            vv[ti] = tv; ll[ti] = tl;
            var slot = htSlot(F.ht, nk);
            if (F.ht.k[slot] !== 0) continue;
            var idx = sidePush(F, nk, ng, ni, k, ti, slot);
            nx.push(idx);
            var hit = htFind(S.ht, nk);
            if (hit >= 0) { var sum = ng + S.g[hit]; if (sum < mu) { mu = sum; muF = idx; muB = hit; } }
          }
        }
        vv[a] = oldV; ll[a] = oldL;
        if (_grew) { _grew = false; if (deadline) return false; }   // 재할당 직후엔 양보
      }
      F.fr = nx; F.nx = []; F.fi = 0; F.depth++;
      return true;
    }

    /* 역방향 한 수: 후속 X=(tr',t,con') 의 선행 P 들을 모두 만든다.
         tr[t] = con'[k:]                       k = 0…min(|con'|, capH-1)
         con   = con'[:k] + tr'[a][:mm]         mm = 0…|tr'[a]|
         tr[a] = tr'[a][mm:]
       합법: tr'[t] 는 비어 있어야 하고, 1+|con'| ≤ cap(t), 1+k+|tr'[a]| ≤ cap(a). */
    function stepB(deadline) {
      var fr = S.fr, nx = S.nx, tick = 0, a, k, mm;
      while (S.fi < fr.length) {
        if (over()) { aborted = true; return false; }
        if (((tick++) & 15) === 0 && deadline && now() > deadline) return false;
        var ni = fr[S.fi++];
        var t = decode(S.key[ni], vv, ll);
        expanded++;
        if (ll[t] !== 0) continue;
        var cl = ll[NT], cpV = vv[NT];
        if (1 + cl > caps[t]) continue;
        var ng = S.g[ni] + 1;
        var kmax = cl < (capH - 1) ? cl : (capH - 1);
        for (a = 0; a < NT; a++) {
          if (a === t) continue;
          var taV = vv[a], taL = ll[a];
          for (k = 0; k <= kmax; k++) {
            if (1 + k + taL > caps[a]) continue;
            var rest = cl - k;
            var tv = rest === 0 ? 0 : cpV % POW[rest];
            var pv = rest === 0 ? cpV : (cpV - tv) / POW[rest];
            vv[t] = tv; ll[t] = rest;
            for (mm = 0; mm <= taL; mm++) {
              var rl = taL - mm;
              var sufV = rl === 0 ? 0 : taV % POW[rl];
              var preV = rl === 0 ? taV : (taV - sufV) / POW[rl];
              vv[a] = sufV; ll[a] = rl;
              vv[NT] = pv * POW[mm] + preV; ll[NT] = k + mm;
              var nk = encode(vv, ll, a);
              var slot = htSlot(S.ht, nk);
              if (S.ht.k[slot] !== 0) continue;
              var idx = sidePush(S, nk, ng, ni, k, t, slot);
              nx.push(idx);
              var hit = htFind(F.ht, nk);
              if (hit >= 0) { var sum = F.g[hit] + ng; if (sum < mu) { mu = sum; muF = hit; muB = idx; } }
            }
            vv[a] = taV; ll[a] = taL;
          }
          vv[t] = 0; ll[t] = 0;
        }
        if (_grew) { _grew = false; if (deadline) return false; }   // 재할당 직후엔 양보
      }
      S.fr = nx; S.nx = []; S.fi = 0; S.depth++;
      return true;
    }

    return {
      sig: shape.sig,
      nodes: function () { return F.n + S.n - n0; },
      expanded: function () { return expanded; },
      aborted: function () { return aborted; },
      depth: function () { return F.depth + S.depth; },
      cancel: function () { cancelled = true; },
      /** 역방향 색인을 캐시에 남긴다 (너무 크면 버린다) */
      release: function () {
        if (S.n > (Puzzle.MAX_CACHE_NODES || 600000)) { if (_bw && _bw.S === S) _bw = null; }
      },
      run: function (deadline) {
        while (true) {
          if (cancelled) return 'abort';
          if (mu <= F.depth + S.depth + 1) break;          // 양방향 BFS 종료 조건
          if (!F.fr.length || !S.fr.length) break;          // 한쪽이 소진 → 더 짧은 해 없음
          if (aborted || over()) { aborted = true; break; }
          if (deadline && now() > deadline) return 'run';
          var side = cur || ((F.fr.length <= S.fr.length) ? 1 : 2);
          cur = side;
          var ok = (side === 1) ? stepF(deadline) : stepB(deadline);
          if (!ok) { if (aborted || cancelled) break; return 'run'; }
          cur = 0;
        }
        if (cancelled) return 'abort';
        if (mu === Infinity) return aborted ? 'abort' : 'none';
        return 'done';
      },
      /** 만난 지점에서 [[k, 트랙번호], …] 를 복원 */
      raw: function () {
        if (mu === Infinity) return null;
        var out = [], x;
        for (x = muF; F.p[x] >= 0; x = F.p[x]) out.push([F.mk[x], F.mt[x]]);
        out.reverse();
        for (x = muB; S.p[x] >= 0; x = S.p[x]) out.push([S.mk[x], S.mt[x]]);
        return out;
      }
    };
  }

  /**
   * 캐시된 역방향 거리표만으로 최적 수순을 뽑는다 (탐색 없음, O(경로길이)).
   * 상태가 색인 안에 없거나 완성되지 않은 층이면 null.
   */
  function bwPath(shape) {
    if (!_bw || _bw.sig !== shape.sig) return null;
    var S = _bw.S, NT = shape.NT, B = shape.B, POW = shape.POW;
    var caps = shape.caps, capH = shape.capH;
    var encode = shape.encode, decode = shape.decode;
    var hit = htFind(S.ht, shape.rootKey);
    if (hit < 0) return null;
    var d = S.g[hit];
    if (d > S.depth) return null;                          // 아직 다 채워지지 않은 층
    var vv = new Float64Array(NT + 1), ll = new Int32Array(NT + 1);
    var out = [], cur = shape.rootKey, guard = 0, k, ti;
    while (d > 0) {
      if (++guard > 400) return null;
      var a = decode(cur, vv, ll);
      var conV = vv[NT], conL = ll[NT], oldV = vv[a], oldL = ll[a];
      var kmax = conL < (capH - 1) ? conL : (capH - 1), found = -1;
      for (k = 0; k <= kmax && found < 0; k++) {
        var rest = conL - k;
        var dv = rest === 0 ? 0 : conV % POW[rest];
        var kv = rest === 0 ? conV : (conV - dv) / POW[rest];
        vv[a] = dv * POW[oldL] + oldV; ll[a] = rest + oldL;
        for (ti = 0; ti < NT; ti++) {
          if (ti === a) continue;
          var tl = ll[ti];
          if (1 + k + tl > caps[ti]) continue;
          var tv = vv[ti];
          vv[ti] = 0; ll[ti] = 0;
          vv[NT] = kv * POW[tl] + tv; ll[NT] = k + tl;
          var nk = encode(vv, ll, ti);
          vv[ti] = tv; ll[ti] = tl;
          var h = htFind(S.ht, nk);
          if (h >= 0 && S.g[h] === d - 1) { found = nk; out.push([k - 0, ti]); break; }
        }
        vv[a] = oldV; ll[a] = oldL;
      }
      if (found < 0) return null;
      cur = found; d--;
    }
    return out;
  }

  /** raw([[k, 트랙번호], …]) → move 목록. **게임 규칙으로 다시 검증**하며 만든다. */
  function rawToMoves(state, raw, order, target) {
    var s = state, out = [], i;
    for (i = 0; i < raw.length; i++) {
      var k = raw[i][0], t = order[raw[i][1]];
      if (k < 0 || k > s.consist.length) return null;
      if (k < s.consist.length) { out.push({ type: 'cut', k: k }); s = cut(s, k); }
      if (legalGo(s, t) !== true) return null;
      out.push({ type: 'go', track: t }); s = go(s, t);
    }
    if (s.consist.length) { out.push({ type: 'cut', k: 0 }); s = cut(s, 0); }
    if (!isWin(s, target)) return null;
    return out;
  }

  /* ── 솔버 ────────────────────────────────────────────────────────────────
     한 엣지 = cut(k) 후 go(t).  cut 은 무료이므로 비용 1 은 go 에만 붙습니다.

     휴리스틱 h (허용적):
       EXIT 위에 이미 완성된 목표의 **접미(동쪽) 일치 길이** j 를 구하고 rem = |target| - j.
       한 번의 go(EXIT) 로 새로 놓을 수 있는 량은 최대 M = min(cap(HEAD), cap(EXIT)) - 1.
       놓은 뒤에는 반드시 EXIT 를 떠나야 하므로 배치 1회당 go 는 2회 필요 → 2*ceil(rem/M).
     h 는 허용적이지만 일관적(consistent)이지는 않으므로 **노드 재확장을 허용**합니다.
     (허용적 h + 팝 시점 목표 판정 + 재확장 → 최적해 보장)
     ------------------------------------------------------------------------ */

  /* 정수 코어는 노드 하나가 24바이트(+해시 4바이트)라 예전 문자열판의 1/4 이하입니다.
     예전 상한 400k 는 sh-14(노드 567k)를 끝까지 못 풀고 중간에 끊겼습니다 — 우연히
     같은 답이 나왔을 뿐이라 상한을 올려 **끝까지 푸는 쪽**으로 바꿉니다. */
  var MAX_NODES = 1500000;

  function solve(state, target, opts) {
    opts = opts || {};
    var t0 = now();
    var m = meta(state);
    target = target || opts.target || state.target || m.target || [];

    var maxNodes = opts.maxNodes || Puzzle.MAX_NODES || MAX_NODES;
    var deadline = opts.timeLimit ? (t0 + opts.timeLimit) : 0;

    var order = m.order, NT = order.length;
    var atI = order.indexOf(state.at);
    var exitI = order.indexOf(m.exit);
    _stats = { nodes: 0, expanded: 0, ms: 0, aborted: false, gos: -1 };
    if (atI < 0 || exitI < 0 || NT === 0) { _stats.ms = now() - t0; return null; }

    var caps = new Array(NT), i;
    for (i = 0; i < NT; i++) caps[i] = m.caps[order[i]] | 0;
    var capH = m.caps[m.head] | 0; if (capH < 1) capH = 1;

    /* 화차 id → 1문자 (문자열 연산으로 상태를 다루면 압도적으로 빠릅니다) */
    var idMap = Object.create(null), nId = 0;
    function enc(id) {
      var c = idMap[id];
      if (c === undefined) { c = String.fromCharCode(BASE + nId++); idMap[id] = c; }
      return c;
    }
    function encArr(a) { var s = ''; for (var z = 0; z < a.length; z++) s += enc(a[z]); return s; }

    var startTr = new Array(NT);
    for (i = 0; i < NT; i++) startTr[i] = encArr(state.tracks[order[i]] || []);
    var startCon = encArr(state.consist);
    var TGT = encArr(target), TL = TGT.length;

    var M = Math.min(capH, caps[exitI]) - 1; if (M < 1) M = 1;

    var atChars = new Array(NT);
    for (i = 0; i < NT; i++) atChars[i] = String.fromCharCode(48 + i);

    var buf = new Array(NT + 2), kLim = new Array(NT);
    function mkKey(tr, con, ai) {
      for (var z = 0; z < NT; z++) buf[z] = tr[z];
      buf[NT] = con; buf[NT + 1] = atChars[ai];
      return buf.join(SEP);
    }

    /* ── 대칭 축약 ────────────────────────────────────────────────
       규칙은 사이딩을 이름으로 구분하지 않는다 (용량만 본다). 따라서 같은 종류·같은
       용량의 사이딩끼리는 서로 바꿔치기해도 완전히 같은 퍼즐이다. 방문 집합의 키를
       "정규 배치"(기관차가 선 트랙을 그룹의 첫 칸에, 나머지는 사전순 정렬)로 만들면
       상태 수가 그룹 크기의 계승만큼 줄어든다. 탐색 자체는 실제 트랙 이름 위에서
       진행하므로 복원된 수순은 그대로 실제 트랙 id 를 가리킨다. */
    var groups = [], groupOf = new Array(NT);
    (function () {
      var bykey = Object.create(null), gi;
      for (var z = 0; z < NT; z++) {
        groupOf[z] = -1;
        if (m.kinds[order[z]] !== 'siding') continue;
        var kkey = 's' + caps[z];
        (bykey[kkey] || (bykey[kkey] = [])).push(z);
      }
      var names = Object.keys(bykey);
      for (gi = 0; gi < names.length; gi++) {
        var g = bykey[names[gi]];
        if (g.length < 2) continue;
        for (var z2 = 0; z2 < g.length; z2++) groupOf[g[z2]] = groups.length;
        groups.push(g);
      }
    })();
    var hasGroups = groups.length > 0;
    var canonBuf = new Array(NT + 2), gtmp = [];
    var gTokens = []; for (i = 0; i < groups.length + 1; i++) gTokens.push('g' + i);

    function canonKey(tr, con, ai) {
      for (var z = 0; z < NT; z++) canonBuf[z] = tr[z];
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi], w = 0, z2, n;
        gtmp.length = 0;
        for (z2 = 0; z2 < g.length; z2++) if (g[z2] !== ai) gtmp.push(tr[g[z2]]);
        n = gtmp.length;
        // 2~3개는 직접 정렬 (Array.sort 호출 비용이 아까울 만큼 자주 불립니다)
        if (n === 2) { if (gtmp[0] > gtmp[1]) { z2 = gtmp[0]; gtmp[0] = gtmp[1]; gtmp[1] = z2; } }
        else if (n === 3) {
          if (gtmp[0] > gtmp[1]) { z2 = gtmp[0]; gtmp[0] = gtmp[1]; gtmp[1] = z2; }
          if (gtmp[1] > gtmp[2]) { z2 = gtmp[1]; gtmp[1] = gtmp[2]; gtmp[2] = z2; }
          if (gtmp[0] > gtmp[1]) { z2 = gtmp[0]; gtmp[0] = gtmp[1]; gtmp[1] = z2; }
        } else if (n > 3) gtmp.sort();
        if (groupOf[ai] === gi) { canonBuf[g[0]] = tr[ai]; w = 1; }
        for (z2 = 0; z2 < n; z2++) canonBuf[g[w + z2]] = gtmp[z2];
      }
      canonBuf[NT] = con;
      canonBuf[NT + 1] = (groupOf[ai] >= 0) ? gTokens[groupOf[ai]] : atChars[ai];
      return canonBuf.join(SEP);
    }

    function heur(exitStr, con, ai) {
      if (ai === exitI) {
        // EXIT 위에 서 있다 → 최소 1수(떠나기). 남은 목표는 consist 로도 다 못 채우면 추가 배치 필요.
        var r2 = TL - con.length; if (r2 < 0) r2 = 0;
        return 1 + 2 * Math.ceil(r2 / M);
      }
      var a = exitStr.length, jj = 0;
      while (jj < a && jj < TL && exitStr.charCodeAt(a - 1 - jj) === TGT.charCodeAt(TL - 1 - jj)) jj++;
      var rem = TL - jj;
      if (rem > 0) return 2 * Math.ceil(rem / M);
      return a > TL ? 2 : 0;      // 접미는 맞지만 서쪽에 잡동사니 → 최소 2수(들어갔다 나오기)
    }

    var nodeCount = 0, expanded = 0, aborted = false;

    function buildMoves(raw) { return rawToMoves(state, raw, order, target); }

    /* ── 1) A* (일반 경로) ──────────────────────────────────────────
       노드 저장: 키 문자열만 보관하고 확장 시 split 으로 복원 (메모리 절약).
       keys[] 는 실제 배치, CK[] 는 정규(대칭 축약) 키. best 는 CK 기준. */
    function astar() {
      var keys = [], CK = [], G = [], PAR = [], MK = [], MT = [];
      var best = new Map();
      var buckets = [], ptr = 0;
      var ti, k, q;

      function push(idx, f) {
        var b = buckets[f];
        if (!b) b = buckets[f] = [];
        b.push(idx);
        if (f < ptr) ptr = f;
      }

      var k0 = mkKey(startTr, startCon, atI);
      var c0 = hasGroups ? canonKey(startTr, startCon, atI) : k0;
      keys.push(k0); CK.push(c0); G.push(0); PAR.push(-1); MK.push(-1); MT.push(-1);
      best.set(c0, 0);
      push(0, heur(startTr[exitI], startCon, atI));

      var goalIdx = -1;
      while (true) {
        while (ptr < buckets.length && (!buckets[ptr] || buckets[ptr].length === 0)) ptr++;
        if (ptr >= buckets.length) break;               // 개방 목록 소진 → 해 없음
        var ni = buckets[ptr].pop();
        var gi = G[ni];
        if (best.get(CK[ni]) < gi) continue;            // 더 짧은 경로로 갱신된 낡은 항목

        var parts = keys[ni].split(SEP);
        var ai = parts[NT + 1].charCodeAt(0) - 48;
        var con = parts[NT];

        if (ai !== exitI && parts[exitI] === TGT) { goalIdx = ni; break; }

        expanded++;
        if ((expanded & 511) === 0 && deadline && now() > deadline) { aborted = true; break; }
        if (keys.length >= maxNodes) { aborted = true; break; }

        var ng = gi + 1;
        var conLen = con.length;
        var kmax = conLen < (capH - 1) ? conLen : (capH - 1);
        for (q = 0; q < NT; q++) { buf[q] = parts[q]; kLim[q] = caps[q] - 1 - parts[q].length; }
        for (k = 0; k <= kmax; k++) {
          buf[ai] = (k >= conLen ? '' : con.slice(k)) + parts[ai];
          var conPre = (k === 0) ? '' : (k >= conLen ? con : con.slice(0, k));
          for (ti = 0; ti < NT; ti++) {
            if (ti === ai || k > kLim[ti]) continue;
            var dest = parts[ti];
            buf[ti] = '';
            var ncon = conPre + dest;
            buf[NT] = ncon; buf[NT + 1] = atChars[ti];
            var nc = hasGroups ? canonKey(buf, ncon, ti) : buf.join(SEP);
            var prev = best.get(nc);
            if (prev === undefined || prev > ng) {
              best.set(nc, ng);
              var idx = keys.length;
              keys.push(hasGroups ? buf.join(SEP) : nc);
              CK.push(nc); G.push(ng); PAR.push(ni); MK.push(k); MT.push(ti);
              push(idx, ng + heur(buf[exitI], ncon, ti));
            }
            buf[ti] = dest;                             // 복원
          }
        }
      }
      nodeCount += keys.length;
      if (goalIdx < 0) return null;
      var raw = [];
      for (var x = goalIdx; PAR[x] >= 0; x = PAR[x]) raw.push([MK[x], MT[x]]);
      raw.reverse();
      return raw;
    }

    /* ── 2) 양방향 BFS (정수 코어) ─────────────────────────────────
       모든 화차가 target 에 들어가는 보통의 레벨에서만 쓸 수 있습니다 (목표 배치가
       하나로 확정되어야 역방향 탐색이 가능). 자세한 내용은 파일 위쪽 코어 설명 참고. */
    function bidi() {
      var shape = shapeOf(m, state, target);
      if (!shape) return 'skip';                        // 부적격 → A* 로

      var quick = bwPath(shape);                        // 캐시된 거리표에 이미 있으면 즉답
      if (quick) return quick;

      var ctx = makeBidi(shape, { maxNodes: maxNodes });
      var r = ctx.run(deadline);
      nodeCount += ctx.nodes(); expanded += ctx.expanded();
      if (r !== 'done' && r !== 'none') aborted = true;   // 시간/노드 상한
      if (ctx.aborted()) aborted = true;
      // 상한에 걸렸어도 만난 지점이 있으면 예전 구현과 같이 그 수순을 돌려준다
      var raw = (r === 'none') ? 'none' : ctx.raw();
      ctx.release();
      return raw;
    }

    var raw = (opts.method === 'astar') ? 'skip' : bidi();
    var moves = (raw && raw !== 'skip' && raw !== 'none') ? buildMoves(raw) : null;
    if (!moves && raw !== 'none' && !aborted && opts.method !== 'bidi') {
      raw = astar();                                    // 부적격 · 검증 실패 → A* 로 재시도
      moves = raw ? buildMoves(raw) : null;
    }

    var ms = now() - t0;
    _stats.nodes = nodeCount; _stats.expanded = expanded; _stats.ms = ms; _stats.aborted = aborted;
    if (!moves) return null;
    var gos = 0;
    for (i = 0; i < moves.length; i++) if (moves[i].type === 'go') gos++;
    _stats.gos = gos;
    indexSolution(state, target, moves);   // 이 경로 위에서는 앞으로 힌트가 즉답
    return { moves: moves, gos: gos, nodes: nodeCount, ms: ms };
  }

  /* ── 조각 탐색 (프레임을 막지 않는 solve) ─────────────────────────────────
     Web Worker 를 쓰지 않고, 한 프레임에 몇 ms 만 쓰고 다음 콜백으로 넘깁니다.
     requestIdleCallback → requestAnimationFrame → setTimeout 순으로 잡습니다.
     ───────────────────────────────────────────────────────────────────── */

  function glob() {
    if (typeof self !== 'undefined' && self) return self;
    if (typeof window !== 'undefined' && window) return window;
    if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
    return null;
  }
  function hasScheduler() {
    var g = glob();
    return !!(g && (g.requestIdleCallback || g.requestAnimationFrame || g.setTimeout));
  }
  /** fn(남은ms) 를 다음 유휴/프레임에 부른다. 잡을 수 없으면 false */
  function later(fn) {
    var g = glob();
    if (!g) return false;
    if (g.requestIdleCallback) {
      g.requestIdleCallback(function (dl) {
        fn((dl && dl.timeRemaining) ? dl.timeRemaining() : 0);
      }, { timeout: 60 });                               // 유휴가 안 오면 60ms 안에 강제
      return true;
    }
    if (g.requestAnimationFrame) { g.requestAnimationFrame(function () { fn(0); }); return true; }
    if (g.setTimeout) { g.setTimeout(function () { fn(0); }, 0); return true; }
    return false;
  }

  /* ── 해답 경로 색인 ───────────────────────────────────────────────────────
     한 번 푼 최적 수순의 **모든 중간 상태**를 key(state) 로 색인해 둡니다.
     플레이어가 그 경로 위에 있으면 다시 풀 필요 없이 O(1) 로 다음 수가 나옵니다.
     (cut 뒤 상태도 넣으므로 "cut → go" 를 한 수씩 물어봐도 즉답)               */

  var _sol = { sig: '', map: null };

  function solSig(m, target) {
    var s = (target || []).join(',') + '#', i;
    for (i = 0; i < m.order.length; i++) s += m.order[i] + ':' + (m.caps[m.order[i]] | 0) + ',';
    return s + '#' + m.head + '/' + m.exit;
  }
  function goOf(moves, i) {
    var mv = moves[i];
    if (mv.type !== 'cut') return { cut: null, track: mv.track };
    var nx = moves[i + 1];
    return { cut: mv.k, track: (nx && nx.type === 'go') ? nx.track : null };
  }
  function indexSolution(state, target, moves) {
    if (!moves || !moves.length) return;
    var m = meta(state), sig = solSig(m, target);
    if (!_sol.map || _sol.sig !== sig) _sol = { sig: sig, map: Object.create(null) };
    var st = state, i;
    for (i = 0; i < moves.length; i++) {
      _sol.map[key(st)] = { mv: moves[i], go: goOf(moves, i), left: moves.length - i };
      st = apply(st, moves[i]);
    }
  }
  function solLookup(state, target) {
    if (!_sol.map) return null;
    var m = meta(state);
    if (_sol.sig !== solSig(m, target)) return null;
    return _sol.map[key(state)] || null;
  }

  /**
   * 조각 탐색 핸들. 만들자마자 백그라운드로 이어서 돕니다.
   *   opts = { slice:ms, immediate:ms|true, maxNodes, target, onDone(res, h), onProgress(info) }
   *   handle = { done, cancelled, result, ms, pump(ms)->bool, cancel(), schedule() }
   */
  function solveAsync(state, target, opts) {
    opts = opts || {};
    var m = meta(state);
    var tgt = target || opts.target || state.target || m.target || [];
    var slice = (opts.slice != null) ? opts.slice : (Puzzle.SLICE_MS || 6);
    var maxN = opts.maxNodes || Puzzle.MAX_NODES || MAX_NODES;
    var t0 = now(), pending = false;

    _warm = null;                                       // 예약된 프리웜이 우리를 덮지 않게
    var shape = shapeOf(m, state, tgt);
    var ctx = shape ? makeBidi(shape, { maxNodes: maxN }) : null;   // 이전 핸들을 취소한다

    var H = {
      id: key(state) + '\u0002' + tgt.join(','),
      done: false, cancelled: false, result: null, ms: 0, slices: 0,
      nodes: 0, sliced: !!ctx
    };

    function finish(moves) {
      H.done = true; H.ms = now() - t0;
      if (moves) {
        indexSolution(state, tgt, moves);
        var gos = 0, i;
        for (i = 0; i < moves.length; i++) if (moves[i].type === 'go') gos++;
        H.result = { moves: moves, gos: gos, nodes: H.nodes, ms: H.ms };
      }
      if (_live === H) _live = null;
      if (opts.onDone) { try { opts.onDone(H.result, H); } catch (e) { } }
    }

    H.cancel = function () {
      if (H.done) return;
      H.cancelled = true;
      if (ctx) { ctx.cancel(); ctx.release(); ctx = null; }
      finish(null);
    };

    /** 동기로 ms 만큼 진행. 끝났으면 true. ms<=0 이면 끝까지. */
    H.pump = function (ms) {
      if (H.done) return true;
      H.slices++;
      if (!ctx) {                                       // 정수 코어 부적격 → 통짜(A*)
        var res = solve(state, tgt, { target: tgt, maxNodes: maxN });
        H.nodes = _stats.nodes;
        finish(res ? res.moves : null);
        return true;
      }
      var r = ctx.run(ms > 0 ? (now() + ms) : 0);
      H.nodes = ctx.nodes();
      if (opts.onProgress) {
        try { opts.onProgress({ nodes: H.nodes, ms: now() - t0, done: r !== 'run' }); } catch (e) { }
      }
      if (r === 'run') return false;
      var raw = (r === 'none') ? null : ctx.raw();
      var moves = raw ? rawToMoves(state, raw, m.order, tgt) : null;
      ctx.release(); ctx = null;
      if (!moves && r !== 'none') {                     // 검증 실패(있으면 안 됨) → A* 재시도
        var alt = solve(state, tgt, { target: tgt, maxNodes: maxN });
        moves = alt ? alt.moves : null;
      }
      finish(moves);
      return true;
    };

    function tick(remain) {
      pending = false;
      if (H.done) return;
      var b = slice;
      if (remain > 0 && remain < b) b = remain;
      if (b < 1) b = 1;
      if (!H.pump(b)) H.schedule();
    }
    H.schedule = function () {
      if (pending || H.done) return;
      if (!later(tick)) { H.pump(0); return; }           // 스케줄러가 없으면 통짜로
      pending = true;
    };

    _live = H;
    var imm = opts.immediate;
    if (imm) H.pump(imm === true ? slice : imm);
    if (!H.done) H.schedule();
    return H;
  }

  /**
   * 이 상태의 최적 경로를 백그라운드로 미리 풀어 둔다 (색인만 채우고 끝).
   * Puzzle.create 가 자동으로 걸어 두므로, 레벨을 연 뒤 잠깐 지나면 힌트는 즉답.
   */
  function prewarm(state, target, opts) {
    var m = meta(state);
    var tgt = target || state.target || m.target || [];
    if (!tgt.length) return null;
    if (solLookup(state, tgt)) return null;                       // 이미 안다
    return solveAsync(state, tgt, opts || {});
  }

  var _warm = null, _warmPending = false;
  function warmLater(state, target) {
    if (!Puzzle.autoPrewarm || !target || !target.length) return;
    _warm = { state: state, target: target };
    if (_warmPending) return;
    if (!later(warmTick)) { _warm = null; return; }
    _warmPending = true;
  }
  function warmTick() {
    _warmPending = false;
    var w = _warm; _warm = null;
    if (!w || !Puzzle.autoPrewarm) return;
    if (_live && !_live.done) return;                  // 이미 다른 탐색이 돌고 있으면 비켜 준다
    try { prewarm(w.state, w.target); } catch (e) { }
  }

  /* ── 힌트 ─────────────────────────────────────────────────────────────────
     1) 색인된 최적 경로 위      → O(1)
     2) 캐시된 역방향 거리표 안  → O(경로길이). 뽑은 경로는 그대로 색인해 둔다
     3) 그 외 — Puzzle.HINT_SYNC_MS 만큼만 동기로 풀어 보고, 못 끝내면 백그라운드로
        넘긴 뒤 null. 프레임을 길게 잡아먹지 않는 것이 우선입니다 (UI 는 레벨의
        기본 힌트 문구를 대신 띄우면 되고, 잠시 뒤 다시 누르면 정확한 수가 나옵니다).
        스케줄러가 아예 없는 환경이면 예전처럼 끝까지 동기로 풉니다.
     ───────────────────────────────────────────────────────────────────── */

  function hintEntry(state, target) {
    var m = meta(state);
    var tgt = target || state.target || m.target || [];
    var e = solLookup(state, tgt);
    if (e) return e;

    var shape = shapeOf(m, state, tgt);
    if (shape) {
      var raw = bwPath(shape);
      if (raw) {
        if (!raw.length) return null;                    // 이미 이긴 상태
        var mv = rawToMoves(state, raw, m.order, tgt);
        if (mv && mv.length) { indexSolution(state, tgt, mv); return solLookup(state, tgt); }
      }
    }

    var budget = Puzzle.HINT_SYNC_MS;
    if (!(budget > 0) || !hasScheduler()) {
      var full = solve(state, tgt, {});
      if (full && full.moves.length) { indexSolution(state, tgt, full.moves); return solLookup(state, tgt); }
      return null;
    }
    var id = key(state) + '\u0002' + tgt.join(',');
    if (_live && !_live.done && _live.id === id) _live.pump(budget);
    else solveAsync(state, tgt, { immediate: budget });
    return solLookup(state, tgt);
  }

  function hint(state, target) {
    var e = hintEntry(state, target);
    return e ? e.mv : null;
  }

  /** UI 편의: 다음 한 수를 "몇 량 남기고 어느 트랙으로" 형태로 */
  function hintGo(state, target) {
    var e = hintEntry(state, target);
    return e ? e.go : null;
  }

  /** 힌트가 지금 즉시(탐색 없이) 나오는지 */
  function hintReady(state, target) {
    var m = meta(state);
    var tgt = target || state.target || m.target || [];
    if (solLookup(state, tgt)) return true;
    var shape = shapeOf(m, state, tgt);
    if (!shape || !_bw || _bw.sig !== shape.sig) return false;
    var hit = htFind(_bw.S.ht, shape.rootKey);
    return hit >= 0 && _bw.S.g[hit] <= _bw.S.depth;
  }

  /** 색인·역방향 캐시·진행 중인 조각 탐색을 모두 버린다 */
  function clearCache() {
    if (_live && !_live.done) _live.cancel();
    _live = null; _bw = null; _warm = null;
    _sol = { sig: '', map: null };
  }
  function par(levelDef, opts) {
    var s = create(levelDef);
    var r = solve(s, levelDef.target, opts);
    return r ? r.gos : null;
  }

  /* ── 데드락 분석 ─────────────────────────────────────────────── */

  function reachableAnalysis(state, target, opts) {
    var m = meta(state);
    var tgt = target || state.target || m.target || [];
    var out = { solvable: null, gos: -1, reason: null, aborted: false };

    var seen = Object.create(null), i, j, id;
    for (i = 0; i < m.order.length; i++) {
      var arr = state.tracks[m.order[i]] || [];
      for (j = 0; j < arr.length; j++) {
        if (seen[arr[j]]) { out.solvable = false; out.reason = 'dup-wagon'; return out; }
        seen[arr[j]] = 1;
      }
    }
    for (j = 0; j < state.consist.length; j++) {
      if (seen[state.consist[j]]) { out.solvable = false; out.reason = 'dup-wagon'; return out; }
      seen[state.consist[j]] = 1;
    }
    for (i = 0; i < tgt.length; i++) {
      if (!seen[tgt[i]]) { out.solvable = false; out.reason = 'missing-wagon'; return out; }
    }
    if (m.order.indexOf(state.at) < 0) { out.solvable = false; out.reason = 'bad-state'; return out; }

    var r = solve(state, tgt, opts || { maxNodes: 250000, timeLimit: 1500 });
    if (r) { out.solvable = true; out.gos = r.gos; return out; }
    out.aborted = _stats.aborted;
    if (_stats.aborted) { out.reason = 'unknown'; return out; }
    out.solvable = false; out.reason = 'deadlock';
    return out;
  }

  /* ── 자체 테스트 ─────────────────────────────────────────────── */

  function tracksDef(caps) {
    return [
      { id: 'HEAD', kind: 'head',   capacity: caps.HEAD },
      { id: 'S1',   kind: 'siding', capacity: caps.S1 },
      { id: 'S2',   kind: 'siding', capacity: caps.S2 },
      { id: 'S3',   kind: 'siding', capacity: caps.S3 },
      { id: 'EXIT', kind: 'exit',   capacity: caps.EXIT }
    ];
  }
  function lv(caps, start, target) {
    return { id: 'test', name: 'test', tracks: tracksDef(caps), start: start, target: target };
  }
  var CAPS = { HEAD: 4, S1: 4, S2: 4, S3: 4, EXIT: 12 };

  /** 독립 구현(무작정 너비 우선)으로 solve 의 최적성을 교차 검증 */
  function bruteGos(state, target, nodeCap) {
    var m = meta(state);
    function goal(s) { return s.at !== m.exit && eqArr(s.tracks[m.exit] || [], target); }
    if (goal(state)) return 0;
    var seen = Object.create(null), count = 1;
    seen[key(state)] = 1;
    var frontier = [state], depth = 0;
    while (frontier.length && depth < 24) {
      depth++;
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var s = frontier[i];
        for (var ci = 0; ci <= s.consist.length; ci++) {
          var cs = (ci === s.consist.length) ? s : cut(s, ci);
          for (var ti = 0; ti < m.order.length; ti++) {
            var t = m.order[ti];
            if (legalGo(cs, t) !== true) continue;
            var ns = go(cs, t);
            var kk = key(ns);
            if (seen[kk]) continue;
            seen[kk] = 1; count++;
            if (count > nodeCap) return -2;
            if (goal(ns)) return depth;
            next.push(ns);
          }
        }
      }
      frontier = next;
    }
    return -1;
  }

  function _selfTest() {
    var cases = [], all = true;
    function T(name, fn) {
      var ok = false, detail = '';
      try { var r = fn(); ok = (r === true || r === undefined); if (r && r !== true) detail = String(r); }
      catch (e) { ok = false; detail = String((e && e.message) || e); }
      if (!ok) all = false;
      cases.push({ name: name, pass: ok, detail: detail });
    }

    /* 1. 생성 + go 결합 규칙 */
    T('go: 도착 트랙의 전부와 연결', function () {
      var s = create(lv(CAPS, { HEAD: [], S1: ['a', 'b'], S2: [], S3: [], EXIT: [], at: 'HEAD' }, ['a', 'b']));
      if (s.moves !== 0 || s.consist.length !== 0) return 'init';
      var s2 = go(s, 'S1');
      if (!eqArr(s2.consist, ['a', 'b'])) return 'consist=' + s2.consist;
      if (s2.tracks.S1.length !== 0) return 'S1 이 비지 않음';
      if (s2.at !== 'S1' || s2.moves !== 1) return 'at/moves';
      if (s.consist.length !== 0 || s.tracks.S1.length !== 2) return '입력 상태가 변경됨';
      return true;
    });

    /* 2. legalGo: same */
    T('legalGo: 같은 트랙은 불법(same)', function () {
      var s = create(lv(CAPS, { S1: ['a'], at: 'HEAD' }, ['a']));
      if (legalGo(s, 'HEAD') !== 'same') return String(legalGo(s, 'HEAD'));
      if (legalGo(s, 'NOPE') !== 'no-track') return 'no-track 미판정';
      return true;
    });

    /* 3. legalGo: head-full (헤드샨트 제한) */
    T('legalGo: 헤드샨트 초과 → head-full', function () {
      var c = { HEAD: 4, S1: 8, S2: 4, S3: 4, EXIT: 12 };
      var s = create(lv(c, { S1: ['a', 'b', 'c', 'd'], at: 'HEAD' }, ['a']));
      var s2 = go(s, 'S1');                       // 1+0+4=5 <= cap S1(8) OK
      if (s2.consist.length !== 4) return 'consist 4 아님';
      if (legalGo(s2, 'S2') !== 'head-full') return String(legalGo(s2, 'S2'));  // 1+4=5 > 4
      var s3 = cut(s2, 3);                        // 3량만 남김
      if (legalGo(s3, 'S2') !== true) return '3량은 통과해야 함';
      return true;
    });

    /* 4. legalGo: track-full (용량 초과) */
    T('legalGo: 목적 트랙 용량 초과 → track-full', function () {
      var c = { HEAD: 4, S1: 4, S2: 4, S3: 4, EXIT: 12 };
      var s = create(lv(c, { S1: ['a'], S2: ['x', 'y', 'z'], at: 'HEAD' }, ['a']));
      var s2 = go(s, 'S1');                       // consist ['a']
      if (legalGo(s2, 'S2') !== 'track-full') return String(legalGo(s2, 'S2')); // 1+1+3=5 > 4
      var s3 = cut(s2, 0);
      if (legalGo(s3, 'S2') !== true) return '빈 컨시스트는 1+0+3=4 로 통과해야 함';
      return true;
    });

    /* 5. cut 경계값 k=0 / k=len-1 / k=len */
    T('cut: 경계값 k=0, k=len-1, k=len', function () {
      var s = create(lv(CAPS, { S1: ['a', 'b', 'c'], S2: ['z'], at: 'HEAD' }, ['a']));
      var s1 = go(s, 'S1');                       // consist [a,b,c] @S1
      var z0 = cut(s1, 0);
      if (z0.consist.length !== 0 || !eqArr(z0.tracks.S1, ['a', 'b', 'c'])) return 'k=0';
      if (z0.moves !== s1.moves) return 'cut 이 move 를 소비함';
      var z2 = cut(s1, 2);
      if (!eqArr(z2.consist, ['a', 'b']) || !eqArr(z2.tracks.S1, ['c'])) return 'k=len-1';
      var z3 = cut(s1, 3);
      if (!eqArr(z3.consist, ['a', 'b', 'c']) || z3.tracks.S1.length !== 0) return 'k=len (무동작)';
      if (legalCut(s1, 4) !== 'bad-k' || legalCut(s1, -1) !== 'bad-k') return 'bad-k 미판정';
      // 기존 트랙 내용물 앞(서쪽)에 붙는지
      var s2 = go(cut(s1, 2), 'S2');              // consist [a,b] + S2 의 [z] = [a,b,z] @S2
      if (!eqArr(s2.consist, ['a', 'b', 'z'])) return 'consist=' + s2.consist;
      var z4 = cut(s2, 1);                        // S2 = [b,z], consist = [a]
      if (!eqArr(z4.tracks.S2, ['b', 'z']) || !eqArr(z4.consist, ['a'])) return 'S2=' + z4.tracks.S2;
      var z5 = cut(z4, 0);                        // 남은 [a] 를 기존 [b,z] 의 서쪽에 붙인다
      if (!eqArr(z5.tracks.S2, ['a', 'b', 'z'])) return '서쪽 결합 실패 S2=' + z5.tracks.S2;
      return true;
    });

    /* 6. 승리 판정 */
    T('isWin: 기관차가 EXIT 에 있으면 승리 아님', function () {
      var s = create(lv(CAPS, { EXIT: ['a', 'b'], at: 'EXIT' }, ['a', 'b']));
      if (isWin(s) !== false) return 'EXIT 위에서 승리로 판정됨';
      var s2 = go(s, 'S1');                       // S1 비어 있음 → consist 그대로 []
      if (!isWin(s2)) return 'S1 로 비켰는데 승리가 아님';
      var s3 = create(lv(CAPS, { S1: ['c'], EXIT: ['a', 'b'], at: 'HEAD' }, ['a', 'b']));
      var s4 = go(s3, 'S1');                      // consist ['c'] → 아직 승리 아님
      if (isWin(s4) !== false) return 'consist 가 남았는데 승리로 판정됨';
      if (!isWin(cut(s4, 0))) return 'cut(0) 후 승리여야 함';
      var s5 = create(lv(CAPS, { EXIT: ['b', 'a'], at: 'HEAD' }, ['a', 'b']));
      if (isWin(s5) !== false) return '순서가 달라도 승리로 판정됨';
      return true;
    });

    /* 7. key 정규화 */
    T('key: 정규화 (at/consist 포함, 트랙 순서 고정)', function () {
      var a = create(lv(CAPS, { S1: ['a'], S2: ['b'], at: 'HEAD' }, ['a']));
      var b = create(lv(CAPS, { S2: ['b'], S1: ['a'], at: 'HEAD' }, ['a']));
      if (key(a) !== key(b)) return '같은 상태인데 키가 다름';
      var c = go(a, 'S3');                        // at 만 바뀜
      if (key(a) === key(c)) return 'at 이 다른데 키가 같음';
      return true;
    });

    /* 8. 솔버: 1수 (EXIT 위에서 출발, 비켜 주기만 하면 끝) */
    T('solve: 자명한 1수', function () {
      var L = lv(CAPS, { EXIT: ['a'], at: 'EXIT' }, ['a']);
      var s = create(L);
      var r = solve(s, L.target);
      if (!r) return 'null';
      if (r.gos !== 1) return 'gos=' + r.gos;
      if (!isWin(applyAll(s, r.moves))) return '수순을 적용해도 승리가 아님';
      return true;
    });

    /* 9. 솔버: 화차 1량 배달 = 3수 (집기 → EXIT → 비키기) */
    T('solve: 1량 배달 par=3', function () {
      var L = lv(CAPS, { S1: ['a'], at: 'HEAD' }, ['a']);
      var s = create(L);
      var r = solve(s, L.target);
      if (!r) return 'null';
      if (r.gos !== 3) return 'gos=' + r.gos;
      if (!isWin(applyAll(s, r.moves))) return '수순 적용 실패';
      return true;
    });

    /* 10. 솔버 최적성: 독립 BFS 와 교차 검증 */
    T('solve: 독립 BFS 와 최적 go 수 일치', function () {
      var Ls = [
        lv(CAPS, { S1: ['a', 'b'], S2: ['c'], at: 'HEAD' }, ['c', 'a', 'b']),
        lv(CAPS, { S1: ['a', 'b', 'c'], at: 'HEAD' }, ['c', 'b', 'a']),
        lv({ HEAD: 3, S1: 3, S2: 3, S3: 3, EXIT: 8 },
           { S1: ['a', 'b'], S2: ['c', 'd'], at: 'HEAD' }, ['a', 'c', 'b', 'd']),
        lv(CAPS, { S1: ['b'], S2: ['a'], S3: ['c'], at: 'S3' }, ['a', 'b', 'c'])
      ];
      for (var i = 0; i < Ls.length; i++) {
        var s = create(Ls[i]);
        var r = solve(s, Ls[i].target);
        var bg = bruteGos(s, Ls[i].target, 300000);
        if (bg === -2) continue;                  // 무작정 BFS 가 너무 커지면 건너뜀
        if (!r && bg >= 0) return '#' + i + ' solve=null, brute=' + bg;
        if (r && r.gos !== bg) return '#' + i + ' solve=' + r.gos + ' brute=' + bg;
        if (r && !isWin(applyAll(s, r.moves))) return '#' + i + ' 수순 적용 실패';
      }
      return true;
    });

    /* 11. 해가 없는 레벨 → null + 데드락 판정 */
    T('solve: 해결 불가 레벨은 null / reachableAnalysis 가 deadlock', function () {
      // EXIT 용량 2 → 1(기관차)+consist+EXIT 내용 <= 2 이므로 EXIT 에 2량을 절대 못 세운다
      var L = lv({ HEAD: 2, S1: 2, S2: 2, S3: 2, EXIT: 2 },
                 { S1: ['b'], S2: ['a'], at: 'HEAD' }, ['a', 'b']);
      var s = create(L);
      var r = solve(s, L.target);
      if (r) return '해가 있다고 나옴 gos=' + r.gos;
      if (_stats.aborted) return '상한에 걸림 (탐색이 끝나지 않음)';
      var an = reachableAnalysis(s, L.target);
      if (an.solvable !== false || an.reason !== 'deadlock') return JSON.stringify(an);
      var an2 = reachableAnalysis(s, ['a', 'zz']);
      if (an2.reason !== 'missing-wagon') return 'missing-wagon 미판정';
      return true;
    });

    /* 12. hint 는 최적 경로의 첫 수 */
    T('hint: 최적 경로의 첫 수', function () {
      var L = lv(CAPS, { S1: ['a', 'b'], S2: ['c'], at: 'HEAD' }, ['c', 'a', 'b']);
      var s = create(L);
      var full = solve(s, L.target);
      var h = hint(s, L.target);
      if (!full || !h) return 'null';
      if (h.type !== full.moves[0].type) return 'type 불일치';
      if (h.type === 'go' && h.track !== full.moves[0].track) return 'track 불일치';
      var hg = hintGo(s, L.target);
      if (!hg || !hg.track) return 'hintGo null';
      // 힌트를 계속 따라가면 par 안에 끝나야 한다
      var st = s, guard = 0;
      while (!isWin(st) && guard++ < 60) st = apply(st, hint(st, L.target));
      if (!isWin(st)) return '힌트를 따라가도 완주 못 함';
      if (st.moves !== full.gos) return '힌트 완주 moves=' + st.moves + ' par=' + full.gos;
      return true;
    });

    /* 13. 무작위 교차 검증: 양방향 BFS vs A* vs 무작정 BFS 가 전부 같은 par 를 내야 한다 */
    T('solve: 무작위 레벨 교차 검증 (양방향 / A* / 무작정 BFS)', function () {
      var rnd = SH.U.rng('puzzle-selftest');
      var pool = ['a', 'b', 'c', 'd', 'e'];
      for (var n = 0; n < 14; n++) {
        var ids = SH.U.shuffle(rnd, pool).slice(0, 3 + (n % 3));
        var start = { at: 'HEAD', S1: [], S2: [], S3: [] };
        for (var w = 0; w < ids.length; w++) start['S' + (1 + (w % 3))].push(ids[w]);
        var L = lv(CAPS, start, SH.U.shuffle(rnd, ids));
        var s = create(L);
        var rb = solve(s, L.target, { method: 'bidi' });
        var ra = solve(s, L.target, { method: 'astar' });
        var bg = bruteGos(s, L.target, 400000);
        var tag = '#' + n + ' [' + ids.join('') + '→' + L.target.join('') + '] ';
        if (!ra || !rb) return tag + 'null (a=' + (ra && ra.gos) + ' b=' + (rb && rb.gos) + ')';
        if (ra.gos !== rb.gos) return tag + 'astar=' + ra.gos + ' bidi=' + rb.gos;
        if (bg >= 0 && bg !== ra.gos) return tag + 'brute=' + bg + ' solver=' + ra.gos;
        if (!isWin(applyAll(s, rb.moves))) return tag + '양방향 수순 적용 실패';
        if (!isWin(applyAll(s, ra.moves))) return tag + 'A* 수순 적용 실패';
      }
      return true;
    });

    /* 14. 목표가 화차의 일부일 때 (양방향 불가 → A* 경로) */
    T('solve: 목표가 화차 일부면 A* 로 폴백', function () {
      var L = lv(CAPS, { S1: ['a', 'b'], S2: ['c', 'd'], at: 'HEAD' }, ['b', 'a']);
      var s = create(L);
      var r = solve(s, L.target);
      var bg = bruteGos(s, L.target, 400000);
      if (!r) return 'null';
      if (bg >= 0 && bg !== r.gos) return 'brute=' + bg + ' solver=' + r.gos;
      var fin = applyAll(s, r.moves);
      if (!eqArr(fin.tracks.EXIT, L.target)) return 'EXIT=' + fin.tracks.EXIT;
      if (!isWin(fin, L.target)) return '승리 아님';
      return true;
    });

    /* 15. 8화차 / 4트랙 성능 + 정확성 */
    T('solve: 8화차 성능', function () {
      var c = { HEAD: 4, S1: 4, S2: 4, S3: 4, EXIT: 12 };
      var starts = { S1: ['a', 'b', 'c'], S2: ['d', 'e', 'f'], S3: ['g', 'h'], at: 'HEAD' };
      var tg = [['c', 'f', 'a', 'd', 'h', 'b', 'e', 'g'], ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']];
      for (var i = 0; i < tg.length; i++) {
        var L = lv(c, starts, tg[i]);
        var s = create(L);
        var t = now();
        var r = solve(s, L.target, { maxNodes: 400000 });
        var ms = now() - t;
        if (!r) return '#' + i + ' null (nodes=' + _stats.nodes + ', aborted=' + _stats.aborted + ')';
        if (!isWin(applyAll(s, r.moves))) return '#' + i + ' 수순 적용 실패';
        if (ms > 2000) return '#' + i + ' ms=' + Math.round(ms);
      }
      return true;
    });

    /* 17. 해답 경로 캐시: 한 번 푼 경로 위에서는 재탐색 없이 즉답 */
    T('힌트 캐시: 최적 경로 위에서는 탐색 없이 즉답', function () {
      var c = { HEAD: 3, S1: 3, S2: 5, S3: 4, EXIT: 9 };
      var L = lv(c, { S1: ['c', 'e'], S2: ['d', 'f', 'b', 'g'], S3: ['a'], at: 'HEAD' },
                 ['b', 'd', 'a', 'e', 'f', 'c', 'g']);
      clearCache();
      var s = create(L);
      var full = solve(s, L.target);                 // solve 가 경로를 색인해 둔다
      if (!full) return 'solve null';
      var st = s, guard = 0, worst = 0;
      while (!isWin(st) && guard++ < 60) {
        if (!hintReady(st, L.target)) return '즉답 불가 (moves=' + st.moves + ')';
        var t = now(), h = hint(st, L.target), d = now() - t;
        if (d > worst) worst = d;
        if (!h) return '힌트 null (moves=' + st.moves + ')';
        st = apply(st, h);
      }
      if (!isWin(st)) return '완주 실패';
      if (st.moves !== full.gos) return 'moves=' + st.moves + ' par=' + full.gos;
      if (worst > 8) return '즉답이 아님 (' + Math.round(worst) + 'ms)';
      // hintGo 요약이 hint 와 어긋나지 않아야 한다
      var hg = hintGo(s, L.target), h0 = hint(s, L.target);
      if (!hg || !h0) return 'hintGo null';
      if (h0.type === 'cut' && hg.cut !== h0.k) return 'hintGo.cut 불일치';
      if (h0.type === 'go' && hg.track !== h0.track) return 'hintGo.track 불일치';
      return true;
    });

    /* 18. 경로를 벗어나도 최적: 역방향 거리표/재탐색 결과가 solve 와 같아야 한다 */
    T('힌트: 경로를 벗어난 상태에서도 최적', function () {
      var c = { HEAD: 3, S1: 4, S2: 4, S3: 4, EXIT: 8 };
      var L = lv(c, { S1: ['e', 'c', 'd'], S2: ['a', 'f'], S3: ['b'], at: 'HEAD' },
                 ['a', 'c', 'b', 'd', 'e', 'f']);
      var keep = Puzzle.HINT_SYNC_MS;
      Puzzle.HINT_SYNC_MS = 0;    // 기계 속도와 무관하게: 이 검사에서는 끝까지 동기로
      try {
        clearCache();
        var s = create(L), i;
        for (i = 0; i < 4 && !isWin(s); i++) {         // 최적으로 몇 수 진행
          var h = hint(s, L.target);
          if (!h) return '준비 단계에서 힌트 null';
          s = apply(s, h);
        }
        var opt = hint(s, L.target), lg = legalMoves(s), off = null;
        for (i = 0; i < lg.length; i++) {
          if (!(opt && opt.type === 'go' && lg[i].track === opt.track)) off = lg[i];
        }
        if (!off) return '이탈할 수가 없음';
        var dev = apply(s, off);                       // 일부러 다른 수 → 경로 이탈
        var truth = solve(clone(dev), L.target);
        if (!truth) return '이탈 상태가 풀리지 않음';
        var z = dev, guard = 0;
        while (!isWin(z) && guard++ < 80) {
          var hh = hint(z, L.target);
          if (!hh) return '이탈 상태에서 힌트 null';
          z = apply(z, hh);
        }
        if (!isWin(z)) return '이탈 상태에서 완주 실패';
        if (z.moves - dev.moves !== truth.gos) {
          return '이탈 후 힌트 완주 ' + (z.moves - dev.moves) + '수 ≠ 최적 ' + truth.gos;
        }
        return true;
      } finally { Puzzle.HINT_SYNC_MS = keep; }
    });

    /* 19. 역방향 색인 재사용이 답을 바꾸면 안 된다.
           같은 트랙 모양·같은 화차 수면 목표가 달라도 색인을 공유하므로 특히 중요. */
    T('캐시: 역방향 색인을 공유·재사용해도 par 가 같다', function () {
      var c = { HEAD: 4, S1: 4, S2: 4, S3: 4, EXIT: 8 };
      var start = { S1: ['a', 'b'], S2: ['c', 'd'], S3: ['e'], at: 'HEAD' };
      var tg = [['e', 'a', 'c', 'b', 'd'], ['a', 'b', 'c', 'd', 'e'],
                ['e', 'd', 'c', 'b', 'a'], ['c', 'e', 'a', 'd', 'b']];
      var solo = [], shared = [], i, r;
      for (i = 0; i < tg.length; i++) {
        clearCache();                                 // 매번 새로 (색인 없이)
        r = solve(create(lv(c, start, tg[i])), tg[i]);
        solo.push(r ? r.gos : null);
      }
      clearCache();
      for (i = 0; i < tg.length; i++) {               // 한 번만 지우고 연속으로 (색인 공유)
        r = solve(create(lv(c, start, tg[i])), tg[i]);
        shared.push(r ? r.gos : null);
      }
      for (i = 0; i < tg.length; i++) {
        if (solo[i] == null) return '#' + i + ' null';
        if (solo[i] !== shared[i]) return '#' + i + ' 단독=' + solo[i] + ' 공유=' + shared[i];
      }
      return true;
    });

    /* 20. 조각 탐색: 동기 solve 와 같은 최적값 + 한 조각이 예산 안에 끝난다 */
    T('solveAsync: 조각 탐색이 동기 solve 와 같은 답 (예산 준수)', function () {
      var c = { HEAD: 3, S1: 3, S2: 5, S3: 4, EXIT: 10 };
      var L = lv(c, { S1: ['d', 'c'], S2: ['f', 'e', 'a', 'g'], S3: ['b', 'h'], at: 'HEAD' },
                 ['b', 'f', 'd', 'a', 'e', 'h', 'c', 'g']);       // 8화차 (가장 무거운 형태)
      clearCache();
      var ref = solve(create(L), L.target);
      if (!ref) return '동기 solve null';
      clearCache();
      var s = create(L);
      var H = solveAsync(s, L.target, { slice: 5 });
      var worst = 0, guard = 0;
      while (!H.done && guard++ < 5000) {
        var t = now(); H.pump(5); var d = now() - t;
        if (d > worst) worst = d;
      }
      if (!H.done) return '끝나지 않음';
      if (!H.result) return 'result 없음';
      if (H.result.gos !== ref.gos) return '조각=' + H.result.gos + ' 동기=' + ref.gos;
      if (!isWin(applyAll(s, H.result.moves))) return '수순 적용 실패';
      if (H.slices < 3) return '조각이 ' + H.slices + '개뿐 (조각내지 못함)';
      if (worst > 40) return '조각 하나가 ' + Math.round(worst) + 'ms';
      // 취소도 동작해야 한다
      clearCache();
      var H2 = solveAsync(create(L), L.target, { slice: 1 });
      H2.cancel();
      if (!H2.done || !H2.cancelled || H2.result) return 'cancel 이 먹지 않음';
      clearCache();
      return true;
    });

    /* 14. par 계산 + 순차 적용 불변식 */
    T('par: levelDef 로부터 직접 계산', function () {
      var L = lv(CAPS, { S1: ['a', 'b', 'c'], at: 'HEAD' }, ['a', 'b', 'c']);
      var p = par(L);
      if (p == null) return 'null';
      var s = create(L), r = solve(s, L.target);
      if (p !== r.gos) return 'par=' + p + ' gos=' + r.gos;
      // 수순 적용 중 어느 시점에도 규칙을 어기지 않아야 한다
      var st = s;
      for (var i = 0; i < r.moves.length; i++) {
        var mv = r.moves[i];
        if (mv.type === 'go' && legalGo(st, mv.track) !== true) return 'i=' + i + ' 불법 go';
        st = apply(st, mv);
      }
      if (!isWin(st)) return '완주 실패';
      if (st.moves !== p) return 'moves=' + st.moves;
      return true;
    });

    return { pass: all, cases: cases };
  }

  /* ── 공개 ────────────────────────────────────────────────────── */

  var Puzzle = {
    MAX_NODES: MAX_NODES,
    MAX_CACHE_NODES: 600000,      // 역방향 색인을 이보다 크면 캐시에 남기지 않는다
    SLICE_MS: 6,                  // solveAsync 가 한 콜백에서 쓰는 시간
    HINT_SYNC_MS: 5,              // hint 가 동기로 버티는 시간 (넘으면 백그라운드행)
    autoPrewarm: true,            // create() 시 최적 경로를 유휴 시간에 미리 풀어 둔다
    create: create,
    clone: clone,
    meta: meta,
    cap: cap,
    trackIds: trackIds,
    headId: headId,
    exitId: exitId,
    legalGo: legalGo,
    legalCut: legalCut,
    legalMoves: legalMoves,
    maxCut: maxCut,
    go: go,
    cut: cut,
    apply: apply,
    applyAll: applyAll,
    isWin: isWin,
    key: key,
    solve: solve,
    solveAsync: solveAsync,
    prewarm: prewarm,
    hint: hint,
    hintGo: hintGo,
    hintReady: hintReady,
    clearCache: clearCache,
    par: par,
    reachableAnalysis: reachableAnalysis,
    _selfTest: _selfTest
  };
  Object.defineProperty(Puzzle, 'stats', { get: function () { return _stats; } });
  return Puzzle;
})();
