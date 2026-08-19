/* ============================================================
   오디세이아 — 00-core.js  (OD.Core / OD.Bus)
   게임의 뼈대: 상태머신 · 스테이지 흐름 · 부하 추적 · 저장
   ------------------------------------------------------------
   다른 모듈이 쓰는 계약(요약):

     OD.Bus.on(evt, fn) / off / once / emit(evt, payload)
       'stage:enter'      {index, stage, retry, crew, budget}
       'placement:change' {index, stage, slotId, added, placed[], remaining}
       'run:result'       {index, stage, result, runs, crewBefore, crew,
                           lost, stars, canAdvance, last}
       'stage:clear'      (run:result 와 동일 payload, win 일 때만)
       'game:end'         {crew, startCrew, results[], elapsed, stages}

     OD.Core.init()            부팅 시 1회. OD.Stages 에서 스테이지를 받아온다.
     OD.Core.begin()           저장된 지점(없으면 0)부터 시작.
     OD.Core.start(i)          스테이지 진입 → 'stage:enter'
     OD.Core.place(id)/unplace(id)/toggle(id)   실행 전 무제한, 재시도로 세지 않음
     OD.Core.canRun()          true | '사유'
     OD.Core.run()             runs++ 후 stage.run(ctx) 호출, 부하 갱신. 막히면 null
     OD.Core.retryStage() / OD.Core.nextStage()
     OD.Core.totalElapsed()    ms
     OD.Core.save() / load()   localStorage 'gamelab:odyssey'
     OD.Core.rng(seed)         시드 난수 (Math.random 금지)

   스테이지 정의(30-stages)는 SPEC §4 를 따른다. Core 가 추가로 봐주는 선택 필드:
     stage.setup(ctx)          진입/재시도 때 호출 (내부 상태 초기화)
     stage.canPlace(id, ctx)   true | '사유'  (없으면 budget.count 로 판정)
     stage.validate(ctx)       true | '사유'  (없으면 "1개 이상 배치" 로 판정)
     stage.alwaysProceed       실패해도 이야기가 진행되는 판(2편·5편)
     stage.mercyRuns           이 횟수를 넘기면 실패해도 진행 허용 (기본 10)
   ============================================================ */
window.OD = window.OD || {};

/* ── 이벤트 버스 ───────────────────────────────────────────── */
OD.Bus = (function () {
  var map = {};
  function list(e) { return (map[e] || (map[e] = [])); }
  return {
    on: function (e, fn) { list(e).push(fn); return fn; },
    off: function (e, fn) {
      var a = list(e), i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    once: function (e, fn) {
      var self = this;
      var w = function (p) { self.off(e, w); fn(p); };
      return this.on(e, w);
    },
    emit: function (e, payload) {
      var a = list(e).slice();
      for (var i = 0; i < a.length; i++) {
        try { a[i](payload); } catch (err) { OD.Core && OD.Core._err(err); }
      }
    }
  };
})();

/* ── 코어 ──────────────────────────────────────────────────── */
OD.Core = (function () {
  var KEY = 'gamelab:odyssey';
  var SAVE_V = 1;
  var START_CREW = 600;
  var MAX_RUNS = 10;          // SPEC §1 하드 제약: 판당 실행 10회 이내

  var C = {
    START_CREW: START_CREW,
    MAX_RUNS: MAX_RUNS,
    stages: [],
    current: null,            // {index, stage, placements:Set, runs}
    crew: START_CREW,
    results: [],              // [{id, lost, runs, win, stars}]
    resumeIndex: 0,
    finished: false,
    fresh: false,
    lastError: null
  };

  /* 시간 추적 -------------------------------------------------- */
  var elapsedMs = 0, mark = 0, ticking = false;

  function now() { return Date.now(); }
  function timeStart() { if (!ticking) { mark = now(); ticking = true; } }
  function timeStop() {
    if (ticking) { elapsedMs += now() - mark; ticking = false; }
  }
  C.totalElapsed = function () {
    return elapsedMs + (ticking ? now() - mark : 0);
  };

  /* 시드 난수 (mulberry32) — Math.random 은 쓰지 않는다 --------- */
  C.rng = function (seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  C._err = function (e) {
    C.lastError = (e && (e.stack || e.message)) || String(e);
  };

  /* 스테이지 수집 --------------------------------------------- */
  function collectStages() {
    var S = OD.Stages;
    if (!S) return [];
    var raw = S;
    if (typeof S.list === 'function') raw = S.list();
    else if (S.list) raw = S.list;
    else if (S.all) raw = (typeof S.all === 'function') ? S.all() : S.all;
    else if (S.defs) raw = S.defs;
    else if (S.stages) raw = S.stages;
    return Object.prototype.toString.call(raw) === '[object Array]' ? raw.slice() : [];
  }

  C.stageIndexById = function (id) {
    for (var i = 0; i < C.stages.length; i++) if (C.stages[i].id === id) return i;
    return -1;
  };

  /* 현재 판의 문맥 (스테이지 함수에 넘겨준다) ------------------ */
  function ctx() {
    var cur = C.current;
    if (!cur) return null;
    return {
      stage: cur.stage,
      index: cur.index,
      crew: crewAtEnter,
      runs: cur.runs,
      placed: C.placedList(),
      placements: cur.placements,
      has: function (id) { return cur.placements.has(id); },
      remaining: C.remaining(),
      rng: C.rng(1000 + cur.index * 977)
    };
  }
  C.ctx = ctx;

  var crewAtEnter = START_CREW;   // 이 판 진입 시점의 부하 수 (재시도로 복원)

  function budgetCount(stage) {
    var b = stage && stage.budget;
    if (!b) return Infinity;
    return (b.count == null) ? Infinity : b.count;
  }
  C.budget = function () {
    var cur = C.current;
    return cur ? (cur.stage.budget || null) : null;
  };
  C.remaining = function () {
    var cur = C.current;
    if (!cur) return 0;
    var n = budgetCount(cur.stage);
    return (n === Infinity) ? Infinity : Math.max(0, n - cur.placements.size);
  };
  C.placedList = function () {
    var out = [];
    if (!C.current) return out;
    C.current.placements.forEach(function (id) { out.push(id); });
    return out;
  };
  C.isPlaced = function (id) {
    return !!(C.current && C.current.placements.has(id));
  };
  C.hasSlot = function (id) {
    var cur = C.current;
    if (!cur || !cur.stage.slots) return true;
    var s = cur.stage.slots;
    for (var i = 0; i < s.length; i++) if (s[i].id === id) return true;
    return false;
  };

  /* 진입 ------------------------------------------------------ */
  C.start = function (index, opt) {
    opt = opt || {};
    if (index < 0 || index >= C.stages.length) return null;
    var stage = C.stages[index];

    crewAtEnter = C.crew;
    stage.crew = C.crew;                       // 이 판에 걸린 부하 수
    /* 스테이지가 배치를 자기 안에도 들고 있다(30-stages 의 attach).
       여기서 비워두지 않으면 재시도할 때 Core 의 집합과 어긋나 자원이 찬 것처럼 보인다. */
    if (typeof stage.clear === 'function') {
      try { stage.clear(); } catch (e) { C._err(e); }
    }
    C.current = {
      index: index,
      stage: stage,
      placements: new Set(),
      runs: (opt.keepRuns && C.current && C.current.index === index) ? C.current.runs : 0
    };
    if (typeof stage.setup === 'function') {
      try { stage.setup(ctx()); } catch (e) { C._err(e); }
    }
    C.resumeIndex = index;
    C.finished = false;
    timeStart();
    C.save();
    OD.Bus.emit('stage:enter', {
      index: index,
      stage: stage,
      retry: !!opt.retry,
      runs: C.current.runs,
      crew: C.crew,
      budget: stage.budget || null
    });
    return C.current;
  };

  C.begin = function () { return C.start(C.resumeIndex || 0); };

  /* 배치 (실행 전 무제한 — 재시도로 세지 않는다) --------------- */
  function emitPlacement(slotId, added) {
    var cur = C.current;
    OD.Bus.emit('placement:change', {
      index: cur.index,
      stage: cur.stage,
      slotId: slotId,
      added: added,
      placed: C.placedList(),
      remaining: C.remaining()
    });
  }

  C.place = function (slotId) {
    var cur = C.current;
    if (!cur) return '진행 중인 스테이지가 없습니다';
    if (cur.placements.has(slotId)) return true;
    if (!C.hasSlot(slotId)) return '없는 자리입니다';
    if (typeof cur.stage.canPlace === 'function') {
      var ok;
      try { ok = cur.stage.canPlace(slotId, ctx()); } catch (e) { C._err(e); ok = true; }
      if (ok !== true && ok != null && ok !== undefined) {
        if (ok === false) return '여기엔 놓을 수 없습니다';
        if (typeof ok === 'string') return ok;
      }
    } else if (cur.placements.size >= budgetCount(cur.stage)) {
      return '자원을 모두 썼습니다';
    }
    cur.placements.add(slotId);
    if (typeof cur.stage.place === 'function') {
      try { cur.stage.place(slotId, ctx()); } catch (e) { C._err(e); }
    }
    emitPlacement(slotId, true);
    return true;
  };

  C.unplace = function (slotId) {
    var cur = C.current;
    if (!cur || !cur.placements.has(slotId)) return false;
    cur.placements['delete'](slotId);
    if (typeof cur.stage.unplace === 'function') {
      try { cur.stage.unplace(slotId, ctx()); } catch (e) { C._err(e); }
    }
    emitPlacement(slotId, false);
    return true;
  };

  C.toggle = function (slotId) {
    return C.isPlaced(slotId) ? (C.unplace(slotId), false) : (C.place(slotId) === true);
  };

  C.clearPlacements = function () {
    var cur = C.current;
    if (!cur) return;
    var ids = C.placedList();
    for (var i = 0; i < ids.length; i++) C.unplace(ids[i]);
  };

  /* 실행 ------------------------------------------------------ */
  C.canRun = function () {
    var cur = C.current;
    if (!cur) return '진행 중인 스테이지가 없습니다';
    var st = cur.stage;
    if (typeof st.validate === 'function') {
      var v;
      try { v = st.validate(ctx()); } catch (e) { C._err(e); v = true; }
      if (v === true || v == null) return true;
      return (typeof v === 'string') ? v : '아직 실행할 수 없습니다';
    }
    if (cur.placements.size === 0) return '아직 아무것도 배치하지 않았습니다';
    return true;
  };

  function starsFor(stage, lost, win) {
    if (!win) return 0;
    var opt = (stage.optimal == null) ? 0 : stage.optimal;
    if (lost <= opt) return 3;
    if (lost <= opt + Math.max(1, Math.ceil(opt * 0.5))) return 2;
    return 1;
  }

  C.run = function () {
    var cur = C.current;
    if (!cur) return null;
    if (C.canRun() !== true) return null;

    cur.runs++;
    var stage = cur.stage;
    var crewBefore = crewAtEnter;
    var raw;
    try {
      raw = (typeof stage.run === 'function') ? stage.run(ctx()) : null;
    } catch (e) { C._err(e); raw = null; }
    raw = raw || {};

    var lost = Math.max(0, Math.min(crewBefore, Math.round(raw.lost || 0)));
    var survived = (raw.survived == null)
      ? crewBefore - lost
      : Math.max(0, Math.min(crewBefore, Math.round(raw.survived)));
    if (raw.survived != null) lost = crewBefore - survived;
    var win = !!raw.win;

    var result = {
      lost: lost,
      survived: survived,
      win: win,
      reason: raw.reason || '',
      /* tag / advance 는 스테이지가 결과 카드 문구(storyOut)를 고를 때 본다.
         여기서 떨어뜨리면 난파·전멸 같은 갈래가 전부 '그냥 실패'로 읽힌다. */
      tag: raw.tag || '',
      advance: (raw.advance == null) ? !!raw.proceed : !!raw.advance,
      detail: raw.detail || null,
      trace: raw.trace || null
    };

    C.crew = survived;                      // 재시도하면 진입 시점으로 되돌린다
    var stars = starsFor(stage, lost, win);
    var mercy = (stage.mercyRuns == null) ? MAX_RUNS : stage.mercyRuns;
    var canAdvance = win || !!stage.alwaysProceed || !!raw.proceed || cur.runs >= mercy;
    var last = (cur.index >= C.stages.length - 1);

    C.results[cur.index] = {
      id: stage.id, lost: lost, runs: cur.runs, win: win, stars: stars
    };

    var payload = {
      index: cur.index, stage: stage, result: result, runs: cur.runs,
      crewBefore: crewBefore, crew: C.crew, lost: lost,
      stars: stars, canAdvance: canAdvance, last: last
    };
    C.save();
    OD.Bus.emit('run:result', payload);
    if (win) OD.Bus.emit('stage:clear', payload);
    return result;
  };

  /* 재시도 / 다음 판 ------------------------------------------ */
  C.retryStage = function () {
    var cur = C.current;
    if (!cur) return null;
    C.crew = crewAtEnter;                   // 손실 원복
    return C.start(cur.index, { retry: true, keepRuns: true });
  };

  C.nextStage = function () {
    var cur = C.current;
    if (!cur) return null;
    var next = cur.index + 1;
    if (next < C.stages.length) return C.start(next);
    return C.endGame();
  };

  C.endGame = function () {
    C.finished = true;
    C.resumeIndex = Math.max(0, C.stages.length - 1);
    timeStop();
    C.save();
    OD.Bus.emit('game:end', {
      crew: C.crew,
      startCrew: START_CREW,
      results: C.results.slice(),
      elapsed: C.totalElapsed(),
      stages: C.stages
    });
    return null;
  };

  /* 저장 / 불러오기 ------------------------------------------- */
  C.save = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: SAVE_V,
        index: C.current ? C.current.index : C.resumeIndex,
        // 판 도중에 새로고침하면 그 판 진입 시점의 부하 수로 되돌아온다
        crew: (C.current && !C.finished) ? crewAtEnter : C.crew,
        results: C.results,
        elapsed: C.totalElapsed(),
        finished: C.finished,
        ts: now()
      }));
      return true;
    } catch (e) { C._err(e); return false; }
  };

  C.load = function () {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (e) { C._err(e); s = null; }
    if (!s || s.v !== SAVE_V) return false;
    C.crew = (typeof s.crew === 'number') ? s.crew : START_CREW;
    C.results = s.results || [];
    C.resumeIndex = Math.min(Math.max(0, s.index | 0), Math.max(0, C.stages.length - 1));
    C.finished = !!s.finished;
    elapsedMs = Math.max(0, s.elapsed | 0);
    return true;
  };

  C.reset = function () {
    try { localStorage.removeItem(KEY); } catch (e) { C._err(e); }
    C.crew = START_CREW;
    C.results = [];
    C.resumeIndex = 0;
    C.finished = false;
    C.current = null;
    crewAtEnter = START_CREW;
    elapsedMs = 0; ticking = false;
    return true;
  };

  /* 초기화 ---------------------------------------------------- */
  C.init = function () {
    C.stages = collectStages();
    C.crew = START_CREW;
    C.results = [];
    C.resumeIndex = 0;
    C.finished = false;
    C.current = null;
    crewAtEnter = START_CREW;
    elapsedMs = 0; ticking = false;

    C.fresh = /[?&]fresh=1\b/.test(location.search);
    var resumed = C.fresh ? (C.reset(), false) : C.load();

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { timeStop(); C.save(); } else if (C.current) timeStart();
      });
    }
    return { resumed: resumed, index: C.resumeIndex, stages: C.stages.length };
  };

  return C;
})();
