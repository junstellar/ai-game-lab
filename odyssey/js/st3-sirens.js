/* ============================================================================
   오디세이아 / ODYSSEY — st3-sirens.js  →  OD.St3
   3편 「세이렌의 노래」 — 한 버튼 '버티기' (STAGES-3-6.md §3편)
   ----------------------------------------------------------------------------
   1·2편과 같은 구조다. 이 파일 하나가 3편의 전부를 소유한다:
   장면 · 게임루프 · 입력 · 규칙 · 게이지 · 피드백 · 결과 카드.

   OD.St3.mount(root, ui, opts) -> stage    root = 캔버스 | DOM 요소 | THREE.Object3D
   OD.St3.press(down)                       true=누름 시작, false=놓음
   OD.St3.update(dt)
   OD.St3.onEnd = fn(result)                {win, lost, survived, ...}
   OD.St3.dispose()

   보조: init/start/pause/reset/resize/state/skipTo/auto/simulate/setCrew

   ── 동사: 버티기. **2편의 반대다.** ──────────────────────────────────────
   2편은 누르면 나아가고 놓으면 안전했다. 3편은 **누르면 안전하고 놓으면 진다.**

     누르고 있으면 → 밧줄을 붙잡고 버틴다.  유혹이 내려간다(−TD·(1−TDS·노래)/s)
                                            악력이 닳는다(−(GD0+GD1·노래)/s)
     놓으면        → 손이 매듭으로 간다.    유혹이 오른다(+TU·노래²/s)
                                            악력이 회복된다(숨 고르기 뒤에)

     유혹이 1 에 닿으면 → 밧줄을 풀고 바다로 뛰어든다 (실패)
     악력이 0 이 되면   → 손이 저절로 풀린다 (1.15초, 그동안 유혹이 치솟는다)

   그래서 **계속 붙잡고 있을 수도, 계속 놓고 있을 수도 없다.**
   노래가 밀려오는 동안 버티고, 잦아든 사이에 놓아 악력을 되찾는 것이 이 편이다.
   유혹은 노래의 **제곱**에 비례해 오른다 — 잦아든 골짜기에서 놓는 건 거의 공짜고
   마루에서 놓는 건 2.5초면 끝이다. 그래서 **노랫결을 읽는 것이 곧 실력이다.**

   ── 게이지 셋 (규칙을 글이 아니라 그림으로 가르친다) ──────────────────────
   1) 노랫결 (상단 파형) — 앞으로 5초가 **미리 보인다.** 마루가 붉을수록 놓으면
      비싸다(붉기 = 유혹 상승률 그 자체). 1편의 붉은 위험범위와 같은 언어다.
   2) 유혹 (왼쪽 앵커) — 놓으면 오른다. 오른쪽 끝이 한계.
      유령 막대가 "지금 놓은 채로 1초 더 가면 여기까지"를 미리 그린다.
   3) 악력 (오른쪽 앵커) — 붙잡으면 준다. 놓으면 회복한다.
      ▼ 표시 = **이번 파도를 끝까지 붙잡는 데 드는 악력.** 이게 남은 악력보다
      길면 못 버틴다 — 미리 놓거나, 파도 안의 틈을 노려야 한다.

   두 막대는 **양 끝에서 자란다.** 누르면 두 머리가 서로 벌어지고(안전),
   놓으면 마주 다가온다(위험). 같은 버튼이 반대로 움직이는 게 눈에 보인다.

   ── 난이도 ──
   파도 6번, 약 80초. 뒤로 갈수록 길어지고 사이가 짧아진다.
   마지막 파도는 한 번에 붙잡을 수 없게 설계돼 있고(필요 악력 > 1), 대신 한가운데
   **거짓 틈**이 있다 — 노랫결에 미리 보인다. 목표 2~3분, 시도 2~4회.

   ── 부하 ──
   신화에서 세이렌 구간의 사망자는 없다. 밀랍이 그들을 지켰다.
   그래서 이 편은 **아무도 잃지 않는다**(lost = 0). 부하 수는 그대로 다음 편으로.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St3 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — 밸런스는 전부 여기에 있다.
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    CREW: 6,

    /* ── 노랫결 ── */
    /* ★ 길이를 절반으로 (약 81초 → 약 43초). 난이도는 그대로 두라는 요청이라
       **시간만 줄이고 비율은 하나도 안 건드렸다** — 파도 길이와 사이를 절반으로
       줄인 대신 악력 소모·회복·유혹 속도(GD0·GD1·GR·TU·TD)를 두 배로 올렸다.
       그래서 "이 파도를 끝까지 붙잡을 악력이 되나"의 답은 예전과 똑같다. */
    LEAD: 2.0,            // 첫 파도까지
    TAIL: 2.4,            // 마지막 파도 뒤 (바위가 멀어진다)
    LOW: 0.03,            // 파도 사이에도 노래가 완전히 멎지는 않는다
    REST_TH: 0.30,        // 이 위 = '파도'. 필요 악력을 세는 구간.
    HOT_TH: 0.45,         // 노랫결에 선이 그어지는 높이 (여기부터 붉어진다)
    PRE: 3.6,             // 앞으로 보이는 시간 (파도가 두 배로 빨라졌으니
                          //   같은 폭에 같은 밀도로 보이도록 줄인다)
    PAST: 1.5,            // 뒤로 남는 시간

    /* 파도 여섯. p=마루 · a=밀려오는 시간 · s=유지 · d=잦아드는 시간 · gap=사이
       lull = 파도 안의 거짓 틈 (6번 파도에만 있다)                          */
    W: [
      { p: 0.70, a: 1.2, s: 1.1, d: 1.0, gap: 2.2 },
      { p: 0.82, a: 1.1, s: 1.5, d: 1.0, gap: 2.0 },
      { p: 0.90, a: 1.0, s: 2.0, d: 1.0, gap: 1.8 },
      { p: 0.96, a: 0.9, s: 2.6, d: 0.9, gap: 1.6 },
      { p: 1.00, a: 0.9, s: 3.2, d: 0.9, gap: 1.5 },
      { p: 1.00, a: 0.9, s: 2.5, d: 1.1, gap: 0,
        lull: { d: 0.5, hold: 1.0, u: 0.5, v: 0.12 }, s2: 3.0 }
    ],

    /* ── 유혹 ── */
    TU: 0.80,             // 놓고 있을 때 상승 = TU · 노래²  (마루에서 1.25초면 끝)
                          // 파도가 절반으로 짧아졌으니 이것도 두 배 — 안 그러면
                          // 짧은 파도는 그냥 손 놓고 흘려보낼 수 있게 된다
    /* 붙잡고 있을 때 하강 = TD · (1 − TDS·노래).
       ★ 노래가 셀수록 덜 지워진다 — 마루에서는 버텨야 겨우 **멈춘다.**
       이게 없으면 "계속 누르고만 있어도 이긴다"가 되어 이 편이 무너진다.
       잦아든 사이에 붙잡고 있으면 빠르게 잊는다(0.42/s). */
    TD: 0.80,
    TDS: 0.80,
    GHOST: 1.0,           // 유령 막대가 내다보는 시간

    /* ── 악력 ── */
    /* 아래 셋도 두 배다 — 파도가 절반이니 소모·회복이 두 배라야
       "한 파도를 끝까지 붙잡는 데 드는 악력"이 예전과 같아진다. */
    GD0: 0.070,           // 붙잡는 것 자체의 값
    GD1: 0.150,           // 노래가 셀수록 더 든다
    GR: 0.60,             // 놓았을 때 회복 (/s)
    LAG: 0.20,            // 놓고 이만큼은 숨만 고른다 (연타로 회복 못 한다)
    RAMP: 0.24,           // 회복이 최대가 되기까지
    FORCED: 1.15,         // 악력이 0 → 손이 풀려 있는 시간
    /* 손이 풀린 동안은 붙잡으려 허우적댈 뿐이라 잘 쉬지 못한다(<1).
       그래서 한 번 바닥나면 곧 또 풀린다 — 악력은 **미리** 아껴야 한다. */
    FORCED_REC: 0.55,
    WARN: 0.26,           // 이 아래로는 악력이 붉어지고 소리가 난다

    /* ── 연출 ── */
    FREEZE: 0.22,         // 손이 풀리는 순간의 짧은 정지
    ROCK_Z: -19,          // 세이렌의 바위 (배는 z=0)
    BAND_EVERY: 0.42,     // 빛의 띠 간격
    BAND_TRAVEL: 2.3,     // 띠가 배까지 오는 시간 → 띠의 밝기 = 그때의 노래
    OVER_T: 2.4,          // 실패 연출 (밧줄을 풀고 뛰어든다)
    WIN_T: 3.0            // 성공 연출 (노래가 멀어진다)
  };

  /* 색 — 안개 낀 새벽 바다. 노래만 금빛이다. */
  var COL = {
    mist: 0x1b2b44,       // 안개 = 하늘. 바다보다 밝아야 수평선이 생긴다.
    dawn: 0xffb489,
    sea: 0x0b1626, seaLit: 0x1b3149,
    hull: 0x2b2117, deck: 0x3d2f1e, rail: 0x231a12, mast: 0x503d24,
    rope: 0xc7a468, ropeHot: 0xffe6a8,
    skin: 0xc99b6c, tunic: 0xb4503a, cloak: 0x6d2f2a,
    crew: 0x4f6076, crewSkin: 0xbb8f63, wax: 0xf6e7bb,
    oar: 0x63492b,
    rock: 0x1d2939,
    siren: 0xa294c9, sirenLit: 0xffd6f2,
    song: 0xffd07a
  };

  /* ══════════════════════════════════════════════════════════════════════
     1. 잡동사니
     ════════════════════════════════════════════════════════════════════ */
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function ease(cur, tgt, dt, tau) { return cur + (tgt - cur) * (1 - Math.exp(-dt / tau)); }

  /* ══════════════════════════════════════════════════════════════════════
     2. 순수 규칙 — 실제 플레이와 simulate() 가 **이 함수들만** 쓴다.
        노랫결은 시각 t 만의 함수다. 그래서 '앞으로 보이는 것'과 '실제로 오는 것'이
        한 치도 어긋나지 않는다 (1편의 손 왕복과 같은 구조).
     ════════════════════════════════════════════════════════════════════ */
  function buildSong() {
    var kt = [], kv = [], t = 0, i, w, spans = [];
    function key(tt, vv) { kt.push(tt); kv.push(vv); }

    key(0, 0);
    t = C.LEAD;
    key(t, C.LOW);
    for (i = 0; i < C.W.length; i++) {
      w = C.W[i];
      var a0 = t;
      t += w.a; key(t, w.p);
      t += w.s; key(t, w.p);
      if (w.lull) {
        t += w.lull.d; key(t, w.lull.v);
        t += w.lull.hold; key(t, w.lull.v);
        t += w.lull.u; key(t, w.p);
        t += w.s2; key(t, w.p);
      }
      t += w.d; key(t, C.LOW);
      spans.push({ i: i, a: a0, b: t });
      if (w.gap) { t += w.gap; key(t, C.LOW); }
    }
    t += C.TAIL; key(t, 0);

    var f = { kt: kt, kv: kv, total: t, spans: spans, waves: C.W.length };

    /* 실제로 '파도'인 구간(노래 ≥ REST_TH)을 수치로 잡아낸다.
       필요 악력·파도 번호·다음 파도까지 남은 시간이 전부 여기서 나온다.
       6번 파도의 거짓 틈은 여기서 **두 구간으로 갈라진다** — 화면에도 그렇게 보인다. */
    var step = 0.02, u, on = false, seg = null, hot = [];
    for (u = 0; u <= f.total; u += step) {
      var v = songAt(f, u);
      if (!on && v >= C.REST_TH) { on = true; seg = { a: u, b: u, w: 0, peak: v }; }
      else if (on) {
        if (v > seg.peak) seg.peak = v;
        if (v < C.REST_TH) { on = false; seg.b = u; hot.push(seg); seg = null; }
      }
    }
    if (on && seg) { seg.b = f.total; hot.push(seg); }
    /* 각 구간을 끝까지 붙잡는 데 드는 악력 (뒤에서부터 누적) */
    for (i = 0; i < hot.length; i++) {
      var s2 = hot[i], sum = 0, k, n = Math.max(1, Math.round((s2.b - s2.a) / 0.05));
      var cum = new Float64Array(n + 1);
      for (k = n - 1; k >= 0; k--) {
        var uu = s2.a + (k + 0.5) * (s2.b - s2.a) / n;
        sum += (C.GD0 + C.GD1 * songAt(f, uu)) * ((s2.b - s2.a) / n);
        cum[k] = sum;
      }
      cum[n] = 0;
      s2.cost = sum; s2.cum = cum; s2.n = n;
      /* 몇 번째 파도에 속하는가 (거짓 틈으로 갈라진 두 토막은 같은 번호다) */
      for (k = 0; k < spans.length; k++) {
        if (s2.a >= spans[k].a - 0.01 && s2.a <= spans[k].b + 0.01) { s2.w = k + 1; break; }
      }
    }
    f.hot = hot;
    return f;
  }

  function songAt(f, t) {
    var T = f.kt, V = f.kv, n = T.length;
    if (n === 0) return 0;
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    var lo = 0, hi = n - 1, mid;
    while (hi - lo > 1) { mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
    var span = T[hi] - T[lo];
    if (span <= 1e-6) return V[hi];
    return lerp(V[lo], V[hi], smooth((t - T[lo]) / span));
  }

  /* 지금(파도 안) 또는 다음(잦아든 사이) 붙잡아야 하는 구간 */
  function hotAt(f, t) {
    var h = f.hot, i;
    for (i = 0; i < h.length; i++) if (t < h[i].b) return h[i];
    return null;
  }
  /* ★ 이 구간을 끝까지 붙잡는 데 드는 악력 — 게이지의 ▼ 표시가 이 값이다 */
  function needAt(f, t) {
    var s = hotAt(f, t);
    if (!s) return 0;
    if (t <= s.a) return s.cost;
    var k = Math.floor((t - s.a) / (s.b - s.a) * s.n);
    return s.cum[clamp(k, 0, s.n)];
  }
  function waveNoAt(f, t) {
    var s = hotAt(f, t);
    return s ? s.w : f.waves;
  }
  function wavesDone(f, t) {
    var n = 0, i;
    for (i = 0; i < f.spans.length; i++) if (t >= f.spans[i].b) n++;
    return n;
  }

  var SONG = null;   // 한 번만 만든다 (순수 데이터)
  function song() { if (!SONG) SONG = buildSong(); return SONG; }

  /* 유혹의 두 속도 — 게이지·봇·화면이 전부 이 둘만 본다 */
  function riseAt(s) { return C.TU * s * s; }             // 놓고 있을 때 (+)
  function fallAt(s) { return C.TD * (1 - C.TDS * s); }   // 붙잡고 있을 때 (−)

  function newGame(crew) {
    var f = song();
    return {
      f: f, t: 0, song: 0, tempt: 0, grip: 1, rest: 9, forced: 0,
      holding: false, want: false,
      crew: crew, crew0: crew, slips: 0, held: 0, peak: 0,
      phase: 'run', reason: '', evt: '', overT: 0
    };
  }

  /* ── 한 걸음. 이 함수가 3편의 규칙 전부다. ── */
  function advance(g, dt, want) {
    var f = g.f;
    g.evt = '';
    if (g.phase !== 'run') {
      /* 끝난 뒤: 이겼으면 노래가 멀어지고, 졌으면 노래가 그를 삼킨다.
         (overT 는 update() 가 센다 — 여기서 또 더하면 두 번 센다) */
      g.song = clamp(g.song + dt * (g.phase === 'won' ? -0.5 : 0.35), 0, 1);
      return;
    }
    g.t += dt;
    var s = songAt(f, g.t);
    g.song = s;
    g.want = !!want;
    if (g.forced > 0) g.forced = Math.max(0, g.forced - dt);

    var hold = !!want && g.forced <= 0;
    g.holding = hold;

    if (hold) {
      g.held += dt;
      g.rest = 0;
      g.grip -= (C.GD0 + C.GD1 * s) * dt;
      g.tempt -= fallAt(s) * dt;
      if (g.grip <= 0) {
        g.grip = 0; g.forced = C.FORCED; g.slips++;
        g.holding = false; g.evt = 'slip';
      }
    } else {
      g.rest += dt;
      var rec = g.forced > 0 ? C.FORCED_REC
                             : clamp((g.rest - C.LAG) / C.RAMP, 0, 1);
      g.grip += C.GR * rec * dt;
      g.tempt += riseAt(s) * dt;
    }
    g.grip = clamp(g.grip, 0, 1);
    if (g.tempt < 0) g.tempt = 0;
    if (g.tempt > g.peak) g.peak = g.tempt;

    if (g.tempt >= 1) {
      g.tempt = 1; g.phase = 'lost'; g.overT = 0;
      g.reason = g.slipAt && (g.t - g.slipAt) < 1.6 ? 'slip' : 'let';
      g.evt = 'lose';
    } else if (g.t >= f.total) {
      g.phase = 'won'; g.overT = 0; g.evt = 'win';
    }
    if (g.evt === 'slip') g.slipAt = g.t;
  }

  function resultOf(g) {
    return {
      win: g.phase === 'won',
      lost: 0,                                   // 세이렌 구간의 사망자는 없다
      survived: g.crew, crew: g.crew,
      waves: wavesDone(g.f, g.t), total: g.f.waves,
      slips: g.slips, held: +g.held.toFixed(1),
      t: +g.t.toFixed(1), span: +g.f.total.toFixed(1),
      peak: +g.peak.toFixed(2), reason: g.reason
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시뮬레이션 — "계속 붙잡을 수도, 놓을 수도 없다"를 숫자로 확인한다.
        policy: 'none' | 'greedy' | 'flutter' | 'plain' | 'smart'
     ════════════════════════════════════════════════════════════════════ */
  function makeBot(o) {
    o = o || {};
    var pol = o.policy || 'smart';
    var rnd = makeRng(o.seed || 4423);
    var jit = o.jit == null ? 0 : o.jit;         // 판단이 흔들리는 정도(초)
    var lat = o.lat == null ? 0 : o.lat;         // 반응이 늦는 정도(초)
    var buf = [], want = false, flip = 0;
    return function (g, dt) {
      var f = g.f, t = g.t + (jit ? (rnd() * 2 - 1) * jit : 0);
      var s = songAt(f, t), w;
      if (pol === 'none') w = false;
      else if (pol === 'greedy') w = true;
      else if (pol === 'flutter') { flip += dt; w = (flip % 0.30) < 0.15; }
      else if (pol === 'plain') w = s >= C.REST_TH;                 // 파도면 무조건 붙잡는다
      /* 겁먹은 사람 — 완전히 조용해질 때만 놓는다. 악력을 못 채워 5편쯤에서 무너진다. */
      else if (pol === 'timid') w = s >= 0.08;
      /* 마지막 파도의 거짓 틈을 못 믿고 계속 붙잡는 사람 */
      else if (pol === 'nolull') w = s >= C.REST_TH || (t > 62 && t < 70);
      else {
        /* smart — 파도면 붙잡되, 이번 구간을 못 버틸 것 같으면 **미리** 놓는다.
           (강제 해제는 하필 마루에서 터지므로 언제나 손해다) */
        w = s >= C.REST_TH;
        if (w && g.grip <= 0.05) w = false;
        if (w && needAt(f, t) > g.grip + 0.001 && s < 0.55 && g.tempt < 0.45) w = false;
        if (!w && g.tempt > 0.62 && s > 0.25 && g.grip > 0.10) w = true;   // 급하면 붙잡는다
      }
      if (!lat) return w;
      buf.push(w);
      var n = Math.max(1, Math.round(lat / Math.max(1e-4, dt)));
      while (buf.length > n) want = buf.shift();
      return want;
    };
  }

  function simulate(o) {
    o = o || {};
    var g = newGame(o.crew == null ? C.CREW : o.crew);
    var bot = makeBot(o);
    var dt = o.dt || 1 / 60, n = Math.round((o.max || 200) / dt), i;
    var minGrip = 1, maxTempt = 0;
    for (i = 0; i < n && g.phase === 'run'; i++) {
      advance(g, dt, bot(g, dt));
      if (g.grip < minGrip) minGrip = g.grip;
      if (g.tempt > maxTempt) maxTempt = g.tempt;
    }
    var r = resultOf(g);
    r.policy = o.policy || 'smart';
    r.minGrip = +minGrip.toFixed(3);
    r.maxTempt = +maxTempt.toFixed(3);
    return r;
  }

  /* 설계 확인용 — 파도마다 '끝까지 붙잡는 데 드는 악력' 표 */
  function costTable() {
    var f = song(), out = [], i;
    for (i = 0; i < f.hot.length; i++) {
      var h = f.hot[i];
      out.push({ w: h.w, a: +h.a.toFixed(1), b: +h.b.toFixed(1),
                 len: +(h.b - h.a).toFixed(1), peak: +h.peak.toFixed(2),
                 cost: +h.cost.toFixed(3) });
    }
    return { total: +f.total.toFixed(1), waves: f.waves, hot: out };
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 지오메트리 헬퍼
     ════════════════════════════════════════════════════════════════════ */
  var T3 = null;

  function merge(parts) {
    var gs = [], total = 0, i, g;
    for (i = 0; i < parts.length; i++) {
      g = parts[i].g;
      g = g.index ? g.toNonIndexed() : g.clone();
      if (parts[i].m) g.applyMatrix4(parts[i].m);
      gs.push(g);
      total += g.attributes.position.count;
    }
    var pos = new Float32Array(total * 3),
        nrm = new Float32Array(total * 3),
        col = new Float32Array(total * 3), o = 0;
    for (i = 0; i < gs.length; i++) {
      var n = gs[i].attributes.position.count;
      pos.set(gs[i].attributes.position.array, o * 3);
      nrm.set(gs[i].attributes.normal.array, o * 3);
      var c = new T3.Color(parts[i].c == null ? 0xffffff : parts[i].c);
      for (var j = 0; j < n; j++) {
        col[(o + j) * 3] = c.r; col[(o + j) * 3 + 1] = c.g; col[(o + j) * 3 + 2] = c.b;
      }
      o += n;
      gs[i].dispose();
    }
    var out = new T3.BufferGeometry();
    out.setAttribute('position', new T3.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T3.BufferAttribute(nrm, 3));
    out.setAttribute('color', new T3.BufferAttribute(col, 3));
    return out;
  }

  function M(x, y, z, sx, sy, sz, rx, ry, rz) {
    var m = new T3.Matrix4();
    var q = new T3.Quaternion().setFromEuler(new T3.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new T3.Vector3(x, y, z), q,
              new T3.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return m;
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 소리 — WebAudio 최소 합성. 파일 로드 없음.
        노래 자체가 게이지다: 세기가 곧 노래 소리 크기다.
     ════════════════════════════════════════════════════════════════════ */
  function makeAudio(rnd) {
    var ctx = null, master = null, noise = null, on = true, ready = false;
    var vA = null, vB = null, vG = null, vF = null, vib = null, vibG = null;
    var creak = null, creakG = null, creakF = null;

    function ensure() {
      if (ctx || !on) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return null; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.5;
        master.connect(ctx.destination);

        var len = Math.floor(ctx.sampleRate * 1.5);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        /* 세이렌의 목소리 — 겹친 두 사인 + 느린 비브라토 */
        vG = ctx.createGain(); vG.gain.value = 0;
        vF = ctx.createBiquadFilter();
        vF.type = 'lowpass'; vF.frequency.value = 1500; vF.Q.value = 0.8;
        vA = ctx.createOscillator(); vA.type = 'sine'; vA.frequency.value = 392;
        vB = ctx.createOscillator(); vB.type = 'sine'; vB.frequency.value = 587.3;
        vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 4.8;
        vibG = ctx.createGain(); vibG.gain.value = 5.5;
        vib.connect(vibG); vibG.connect(vA.frequency); vibG.connect(vB.frequency);
        vA.connect(vF); vB.connect(vF); vF.connect(vG); vG.connect(master);
        vA.start(); vB.start(); vib.start();

        /* 밧줄이 삐걱거리는 소리 — 붙잡고 있을 때만 */
        creak = ctx.createBufferSource();
        creak.buffer = noise; creak.loop = true;
        creakF = ctx.createBiquadFilter();
        creakF.type = 'bandpass'; creakF.frequency.value = 240; creakF.Q.value = 3.0;
        creakG = ctx.createGain(); creakG.gain.value = 0;
        creak.connect(creakF); creakF.connect(creakG); creakG.connect(master);
        creak.start();
        ready = true;
      } catch (e) { on = false; ctx = null; }
      return ctx;
    }
    function resume() {
      ensure();
      try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { }
    }
    function now() { return ctx ? ctx.currentTime : 0; }
    function tone(type, f0, f1, dur, vol) {
      if (!ctx) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = now();
        o.type = type; o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { }
    }
    function burst(f, q, dur, vol) {
      if (!ctx) return;
      try {
        var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(),
            g = ctx.createGain(), t = now();
        s.buffer = noise; s.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(bp); bp.connect(g); g.connect(master);
        s.start(t); s.stop(t + dur + 0.02);
      } catch (e) { }
    }
    return {
      resume: resume,
      get ready() { return ready; },
      /* 노래 — 세기 0..1, 유혹이 높을수록 더 가까이 들린다 */
      voice: function (lv, pull) {
        if (!ctx || !vG) return;
        try {
          var t = now();
          vG.gain.setTargetAtTime(0.035 + 0.30 * lv * lv, t, 0.10);
          vF.frequency.setTargetAtTime(520 + 2200 * lv * (0.6 + 0.6 * pull), t, 0.18);
          vibG.gain.setTargetAtTime(3.0 + 9.0 * lv, t, 0.2);
        } catch (e) { }
      },
      creak: function (lv) {
        if (!ctx || !creakG) return;
        try {
          creakG.gain.setTargetAtTime(0.012 + 0.11 * lv, now(), 0.08);
          creakF.frequency.setTargetAtTime(190 + 320 * lv, now(), 0.12);
        } catch (e) { }
      },
      grab: function () { burst(420, 1.4, 0.13, 0.10); tone('sine', 180, 120, 0.12, 0.10); },
      slip: function () {
        burst(900, 0.7, 0.34, 0.18);
        tone('sawtooth', 300, 70, 0.42, 0.16);
      },
      tick: function () { burst(1500, 6.0, 0.05, 0.06); },
      wave: function (p) { burst(500 + p * 700, 0.6, 0.55, 0.045); },
      splash: function () {
        burst(700, 0.5, 0.7, 0.26); tone('sine', 150, 45, 0.8, 0.28);
      },
      bell: function () {
        tone('sine', 660, 660, 1.5, 0.20); tone('sine', 990, 988, 1.2, 0.09);
        tone('triangle', 1320, 1318, 0.9, 0.05);
      },
      mute: function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () {
        try { if (vA) vA.stop(); if (vB) vB.stop(); if (vib) vib.stop(); } catch (e) { }
        try { if (creak) creak.stop(); } catch (e) { }
        try { if (ctx) ctx.close(); } catch (e) { }
        ctx = null;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. HUD — 게이지가 규칙을 가르친다
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st3-css';
  var CSS = [
    '.st3{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#eaf0f8;-webkit-user-select:none;user-select:none;z-index:5}',

    /* ── 상단: 노랫결 ── */
    '.st3 .top{position:absolute;left:0;right:0;top:0;padding:13px 15px 0;',
    'display:flex;flex-direction:column;gap:6px;align-items:center}',
    '.st3 .toprow{width:min(88vw,620px);display:flex;align-items:center;gap:10px}',
    '.st3 .toprow em{font-style:normal;font-size:.62rem;letter-spacing:.18em;font-weight:700;',
    'opacity:.6;text-shadow:0 2px 8px #000;white-space:nowrap}',
    '.st3 .waves{margin-left:auto;display:flex;gap:5px;align-items:center}',
    '.st3 .waves i{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.18);',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.30)}',
    '.st3 .waves i.on{background:#ffd07a;box-shadow:0 0 9px rgba(255,190,110,.85)}',
    '.st3 .waves i.now{background:#fff3d6;box-shadow:0 0 14px 3px rgba(255,200,120,.9)}',
    '.st3 .songwrap{width:min(88vw,620px);height:74px;position:relative}',
    '.st3 canvas.song{display:block;width:100%;height:100%}',

    /* ── 하단: 유혹 · 악력 ── */
    '.st3 .bottom{position:absolute;left:0;right:0;bottom:0;padding:0 0 5.2%;',
    'display:flex;flex-direction:column;align-items:center;gap:7px}',
    '.st3 .row{width:min(88vw,620px);display:flex;align-items:center;gap:9px}',
    '.st3 .row>em{font-style:normal;font-size:.62rem;letter-spacing:.16em;font-weight:800;',
    'width:2.6em;text-align:right;opacity:.72;text-shadow:0 2px 8px #000;white-space:nowrap}',
    '.st3 .row>s{text-decoration:none;font-size:.78rem;font-weight:900;width:1.1em;',
    'text-align:center;opacity:0;transition:opacity .12s;text-shadow:0 2px 8px #000}',
    '.st3 .row>s.on{opacity:1}',

    '.st3 .tk{position:relative;flex:1;border-radius:7px;background:rgba(4,8,15,.72);',
    'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.15),0 5px 18px rgba(0,0,0,.45)}',
    '.st3 .tk i,.st3 .tk b,.st3 .tk u{position:absolute;top:0;bottom:0;display:block}',
    '.st3 .tempt .tk{height:26px}',
    '.st3 .grip .tk{height:17px}',

    /* 유혹 — 왼쪽에서 자란다. 오른쪽 끝이 한계다. */
    '.st3 .tfill{left:0;border-radius:5px 3px 3px 5px;',
    'background:linear-gradient(90deg,#7a3fa8,#e0559a)}',
    '.st3 .tghost{border-radius:0 3px 3px 0;background:rgba(255,120,170,.42);',
    'box-shadow:inset 1px 0 0 rgba(255,255,255,.55)}',
    '.st3 .thead{width:3px;margin-left:-1.5px;background:#fff;border-radius:2px;',
    'box-shadow:0 0 10px 2px rgba(255,255,255,.55)}',
    '.st3 .tedge{right:0;width:8px;border-radius:0 5px 5px 0;background:#e2415f;opacity:.55}',
    '.st3 .tempt.calm .tfill{background:linear-gradient(90deg,#2f6f9e,#59b6d8)}',
    '.st3 .tempt.hot .tk{box-shadow:inset 0 0 0 2px rgba(255,110,140,.95),',
    '0 5px 26px rgba(200,30,70,.55)}',

    /* 악력 — 오른쪽에서 자란다. 왼쪽 끝이 바닥이다. */
    '.st3 .gfill{right:0;border-radius:3px 5px 5px 3px;',
    'background:linear-gradient(90deg,#3f8f8a,#8fe6d0)}',
    '.st3 .grip.low .gfill{background:linear-gradient(90deg,#a2472e,#ff9a6a)}',
    '.st3 .grip.rest .gfill{background:linear-gradient(90deg,#4f9bd8,#a8f0e2)}',
    '.st3 .ghead{width:3px;margin-left:-1.5px;background:#fff;border-radius:2px;',
    'box-shadow:0 0 10px 2px rgba(255,255,255,.5)}',
    /* ▼ 이번 파도를 끝까지 붙잡는 데 드는 악력 */
    '.st3 .need{width:2px;margin-left:-1px;background:#ffd07a;opacity:.9;',
    'box-shadow:0 0 8px rgba(255,200,120,.8)}',
    '.st3 .need:after{content:"";position:absolute;left:50%;top:-7px;margin-left:-5px;',
    'border:5px solid transparent;border-top-color:#ffd07a}',
    '.st3 .short{background:repeating-linear-gradient(115deg,',
    'rgba(226,66,42,.75) 0 7px,rgba(150,30,20,.75) 7px 14px);border-radius:3px}',
    '.st3 .grip.rest .tk{box-shadow:inset 0 0 0 1.5px rgba(150,220,255,.5),0 5px 18px rgba(0,0,0,.45)}',
    '.st3 .grip.low .tk{box-shadow:inset 0 0 0 2px rgba(255,140,90,.9),0 5px 22px rgba(160,50,20,.5)}',

    /* ── 부하 ── */
    '.st3 .crew{width:min(88vw,620px);display:flex;justify-content:flex-end;',
    'align-items:center;gap:6px;font-size:.78rem;font-weight:700;opacity:.62;',
    'text-shadow:0 2px 8px #000;font-variant-numeric:tabular-nums}',
    '.st3 .crew em{font-style:normal;opacity:.7;font-size:.66rem;letter-spacing:.1em}',

    /* ── 한마디 ── */
    '.st3 .cue{position:absolute;left:50%;top:31%;transform:translate(-50%,-50%) scale(.85);',
    'font-size:2.1rem;font-weight:900;letter-spacing:-.02em;opacity:0;color:#ffd98c;',
    'text-shadow:0 0 26px rgba(0,0,0,.95),0 3px 12px #000;transition:opacity .14s}',
    '.st3 .cue.on{opacity:1;transform:translate(-50%,-50%) scale(1);',
    'transition:opacity .1s,transform .2s}',
    '.st3 .flash{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);',
    'font-size:1.42rem;font-weight:900;opacity:0;white-space:nowrap;text-align:center;',
    'text-shadow:0 2px 14px #000,0 0 24px rgba(0,0,0,.75);transition:opacity .2s,top .5s}',
    '.st3 .flash.on{opacity:1;top:40%}',
    '.st3 .flash u{display:block;margin-top:4px;font-size:.86rem;font-weight:700;',
    'text-decoration:none;letter-spacing:.02em;opacity:.9}',
    '.st3 .hint{position:absolute;left:50%;bottom:23%;transform:translateX(-50%);',
    'font-size:.95rem;font-weight:700;color:#dfe6f0;opacity:0;white-space:nowrap;',
    'padding:8px 17px;border-radius:999px;background:rgba(6,10,18,.5);',
    'text-shadow:0 2px 10px #000;transition:opacity .5s}',
    '.st3 .hint.on{opacity:.92}',

    /* 유혹이 차오를수록 화면 가장자리가 노래에 물든다 */
    '.st3 .edge{position:absolute;inset:0;opacity:0;',
    'background:radial-gradient(86% 60% at 50% 46%,rgba(0,0,0,0) 34%,rgba(210,40,120,.92) 100%)}',
    '.st3 .white{position:absolute;inset:0;opacity:0;background:#fff}',

    /* ── 결과 카드 ── */
    '.st3 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:14px;background:rgba(5,8,15,.9);',
    'opacity:0;pointer-events:none;visibility:hidden;',
    'transition:opacity .5s;text-align:center;padding:26px}',
    '.st3 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st3 .end h2{font-size:1.55rem;font-weight:800;margin:0;letter-spacing:-.02em}',
    '.st3 .end p{font-size:1rem;color:#c6cfdc;margin:0;line-height:1.85;max-width:30em}',
    '.st3 .end .fact{font-size:.9rem;color:#9aa4b4;font-style:italic}',
    '.st3 .end .stat{font-size:.9rem;color:#9fb4cc;font-variant-numeric:tabular-nums}',
    '.st3 .end b{color:#ffd88f}',
    '.st3 .end button{margin-top:8px;padding:12px 28px;border-radius:999px;',
    'border:1px solid #46536b;background:#141a26;color:#eef1f6;font-size:1rem;font-weight:700;',
    'cursor:pointer;font-family:inherit}',
    '.st3 .end button:active{transform:translateY(1px)}',

    /* 좁은 세로 화면 */
    '@media (max-width:520px){',
    '.st3 .songwrap{height:62px}',
    '.st3 .tempt .tk{height:23px}.st3 .grip .tk{height:15px}',
    '.st3 .cue{font-size:1.7rem;top:34%}.st3 .flash{font-size:1.2rem}',
    '.st3 .toprow,.st3 .songwrap,.st3 .row,.st3 .crew{width:92vw}}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function pc(v) { return (v * 100).toFixed(2) + '%'; }

  function makeHud(host, crew0, waves) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'st3';
    var pips = '', i;
    for (i = 0; i < waves; i++) pips += '<i></i>';
    el.innerHTML =
      '<div class="edge"></div><div class="white"></div>' +
      '<div class="top">' +
        '<div class="toprow"><em>노랫결</em>' +
          '<div class="waves">' + pips + '</div></div>' +
        '<div class="songwrap"><canvas class="song"></canvas></div>' +
      '</div>' +
      '<div class="bottom">' +
        '<div class="row tempt"><em>유혹</em><s></s><div class="tk">' +
          '<i class="tfill"></i><i class="tghost"></i><i class="tedge"></i>' +
          '<b class="thead"></b></div></div>' +
        '<div class="row grip"><em>악력</em><s></s><div class="tk">' +
          '<i class="short"></i><i class="gfill"></i>' +
          '<u class="need"></u><b class="ghead"></b></div></div>' +
        '<div class="crew"><em>부하</em><span>' + crew0 + '</span></div>' +
      '</div>' +
      '<div class="cue">붙잡아라</div>' +
      '<div class="flash"><span></span><u></u></div>' +
      '<div class="hint">누르고 있으면 버틴다 · 놓으면 끌려간다</div>' +
      '<div class="end"><h2></h2><p></p><div class="fact"></div>' +
        '<div class="stat"></div><button type="button">다시</button></div>';
    host.appendChild(el);

    var q = function (sel) { return el.querySelector(sel); };
    var cv = q('canvas.song'), cx = cv.getContext('2d');
    var wavePips = el.querySelectorAll('.waves i');
    var tempt = q('.tempt'), tArr = q('.tempt s'), tfill = q('.tfill'),
        tghost = q('.tghost'), thead = q('.thead');
    var gripR = q('.grip'), gArr = q('.grip s'), gfill = q('.gfill'),
        ghead = q('.ghead'), need = q('.need'), shortEl = q('.short');
    var crewN = q('.crew span'), edge = q('.edge'), white = q('.white');
    var cue = q('.cue'), flash = q('.flash'), fT = q('.flash span'), fW = q('.flash u'),
        hint = q('.hint'), end = q('.end'), endH = q('.end h2'), endP = q('.end p'),
        endF = q('.end .fact'), endS = q('.end .stat'), endB = q('.end button');

    var flashT = 0, last = {}, cw = 0, ch = 0, dpr = 1;
    function set(node, prop, v) {
      var k = node.__k || (node.__k = {});
      if (k[prop] === v) return;
      k[prop] = v; node.style[prop] = v;
    }

    /* ── ★ 노랫결 — 앞으로 5초가 미리 보인다 ──────────────────────────
       가로축 = 시간(지금은 왼쪽에서 28%), 세로축 = 노래의 세기.
       마루의 붉기 = **유혹 상승률 그 자체**(노래²). 규칙을 색으로 그린다. */
    function drawSong(g, f) {
      var w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      var r = Math.min(window.devicePixelRatio || 1, 2);
      if (w !== cw || h !== ch || r !== dpr) {
        cw = w; ch = h; dpr = r;
        cv.width = Math.round(w * r); cv.height = Math.round(h * r);
      }
      cx.setTransform(r, 0, 0, r, 0, 0);
      cx.clearRect(0, 0, w, h);

      var t0 = g.t - C.PAST, t1 = g.t + C.PRE, sp = t1 - t0;
      var nx = (g.t - t0) / sp * w;                 // '지금' 선
      var pad = 3, base = h - pad, top = pad + 1, hh = base - top;
      function X(t) { return (t - t0) / sp * w; }
      function Y(v) { return base - clamp(v, 0, 1) * hh; }

      cx.save();
      var rr = 7;
      cx.beginPath();
      cx.moveTo(rr, 0); cx.lineTo(w - rr, 0); cx.quadraticCurveTo(w, 0, w, rr);
      cx.lineTo(w, h - rr); cx.quadraticCurveTo(w, h, w - rr, h);
      cx.lineTo(rr, h); cx.quadraticCurveTo(0, h, 0, h - rr);
      cx.lineTo(0, rr); cx.quadraticCurveTo(0, 0, rr, 0);
      cx.closePath(); cx.clip();

      cx.fillStyle = 'rgba(4,8,15,.72)';
      cx.fillRect(0, 0, w, h);
      /* 앞으로 올 쪽은 아주 살짝 밝다 — '아직 오지 않았다' */
      cx.fillStyle = 'rgba(255,255,255,.035)';
      cx.fillRect(nx, 0, w - nx, h);

      /* 붙잡아야 하는 높이 */
      cx.strokeStyle = 'rgba(255,190,120,.30)';
      cx.setLineDash([3, 4]); cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(0, Y(C.HOT_TH)); cx.lineTo(w, Y(C.HOT_TH)); cx.stroke();
      cx.setLineDash([]);

      /* 파형 — 아래를 채운다 */
      var N = 128, i2, tt, v;
      cx.beginPath();
      cx.moveTo(0, base);
      for (i2 = 0; i2 <= N; i2++) {
        tt = t0 + sp * (i2 / N);
        v = songAt(f, tt);
        cx.lineTo(X(tt), Y(v));
      }
      cx.lineTo(w, base); cx.closePath();
      var grad = cx.createLinearGradient(0, top, 0, base);
      grad.addColorStop(0, 'rgba(255,96,120,.85)');
      grad.addColorStop(0.42, 'rgba(255,170,90,.62)');
      grad.addColorStop(1, 'rgba(120,90,60,.20)');
      cx.fillStyle = grad;
      cx.fill();

      /* 윤곽 */
      cx.beginPath();
      for (i2 = 0; i2 <= N; i2++) {
        tt = t0 + sp * (i2 / N);
        v = songAt(f, tt);
        if (i2 === 0) cx.moveTo(X(tt), Y(v)); else cx.lineTo(X(tt), Y(v));
      }
      cx.strokeStyle = 'rgba(255,226,180,.92)'; cx.lineWidth = 1.6;
      cx.stroke();

      /* 지금 — 흰 선 + 값 점 */
      var cur = songAt(f, g.t);
      cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(nx, 0); cx.lineTo(nx, h); cx.stroke();
      cx.beginPath(); cx.arc(nx, Y(cur), 4.2, 0, 6.2832);
      cx.fillStyle = g.holding ? '#8fe6d0' : '#ff86b0';
      cx.fill();
      cx.strokeStyle = 'rgba(0,0,0,.55)'; cx.lineWidth = 1; cx.stroke();

      /* 붙잡아야 하는 구간을 위쪽 띠로 한 번 더 — 언제부터 언제까지인지 */
      var hs = f.hot, k;
      for (k = 0; k < hs.length; k++) {
        var a = hs[k].a, b = hs[k].b;
        if (b < t0 || a > t1) continue;
        var xa = Math.max(0, X(a)), xb = Math.min(w, X(b));
        cx.fillStyle = (g.t >= a && g.t < b) ? 'rgba(255,120,90,.85)'
                                             : 'rgba(255,170,110,.42)';
        cx.fillRect(xa, 0, Math.max(1.5, xb - xa), 3);
      }
      cx.restore();
    }

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },

      /* ★ 이 함수가 3편의 규칙을 전부 그린다 */
      gauge: function (g, f) {
        drawSong(g, f);

        /* ── 유혹: 왼쪽에서 자란다 ── */
        var T = clamp(g.tempt, 0, 1);
        set(tfill, 'width', pc(T));
        set(thead, 'left', pc(T));
        var rise = g.holding ? -fallAt(g.song) : riseAt(g.song);
        var gh = g.holding ? 0 : clamp(rise * C.GHOST, 0, 1 - T);
        if (gh > 0.005) {
          set(tghost, 'left', pc(T));
          set(tghost, 'width', pc(gh));
          set(tghost, 'opacity', '1');
        } else set(tghost, 'width', '0%');
        var tcls = 'row tempt' + (g.holding ? ' calm' : '') + (T > 0.62 ? ' hot' : '');
        if (tempt.className !== tcls) tempt.className = tcls;
        var ta = g.holding ? '◀' : (rise > 0.02 ? '▶' : '');
        if (last.ta !== ta) { last.ta = ta; tArr.textContent = ta; }
        var taOn = ta ? 's on' : 's';
        if (tArr.className !== taOn) tArr.className = taOn;
        set(tArr, 'color', g.holding ? '#8fe6d0' : '#ff86b0');

        /* ── 악력: 오른쪽에서 자란다. 두 머리가 벌어지면 안전, 다가오면 위험 ── */
        var G = clamp(g.grip, 0, 1);
        set(gfill, 'width', pc(G));
        set(ghead, 'left', pc(1 - G));
        var nd = clamp(needAt(f, g.t), 0, 1);
        set(need, 'left', pc(1 - nd));
        set(need, 'opacity', nd > 0.01 ? '1' : '0');
        set(need, 'background', nd > G ? '#ff7a52' : '#ffd07a');
        /* 모자란 만큼을 빗금으로 — "이 파도는 끝까지 못 붙잡는다" */
        if (nd > G + 0.004) {
          set(shortEl, 'left', pc(1 - nd));
          set(shortEl, 'width', pc(nd - G));
          set(shortEl, 'opacity', '1');
        } else set(shortEl, 'width', '0%');
        var resting = !g.holding && g.forced <= 0 && g.rest < C.LAG;
        var gcls = 'row grip' + (G < C.WARN ? ' low' : (resting ? ' rest' : ''));
        if (gripR.className !== gcls) gripR.className = gcls;
        var ga = g.holding ? '▶' : (g.rest >= C.LAG || g.forced > 0 ? '◀' : '');
        if (last.ga !== ga) { last.ga = ga; gArr.textContent = ga; }
        var gaOn = ga ? 's on' : 's';
        if (gArr.className !== gaOn) gArr.className = gaOn;
        set(gArr, 'color', g.holding ? '#ff9a6a' : '#8fe6d0');

        /* 파도 몇 번째인가 — 거짓 틈에 들어가도 '지금 이 파도'는 켜져 있어야 한다 */
        var done = wavesDone(f, g.t);
        for (var i3 = 0; i3 < wavePips.length; i3++) {
          var c = (i3 < done) ? 'on' : (g.t >= f.spans[i3].a ? 'now' : '');
          if (wavePips[i3].className !== c) wavePips[i3].className = c;
        }

        set(edge, 'opacity', (T < 0.35 ? 0 : (T - 0.35) / 0.65 * 0.85).toFixed(3));
      },
      crew: function (n) { if (last.crew !== n) { last.crew = n; crewN.textContent = String(n); } },
      white: function (v) { set(white, 'opacity', clamp(v, 0, 1).toFixed(3)); },
      cue: function (on) {
        var c = on ? 'cue on' : 'cue';
        if (cue.className !== c) cue.className = c;
      },
      flash: function (txt, col, why) {
        if (!txt) { flash.className = 'flash'; flashT = 0; return; }
        fT.textContent = txt;
        fW.textContent = why || '';
        flash.style.color = col;
        flash.className = 'flash on';
        flashT = 1.35;
      },
      hint: function (on) {
        var c = on ? 'hint on' : 'hint';
        if (hint.className !== c) hint.className = c;
      },
      tick: function (dt) {
        if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.className = 'flash'; }
      },
      end: function (r) {
        if (!r) { end.className = 'end'; return; }
        if (r.win) {
          endH.textContent = '그는 들었다. 그리고 살아남았다';
          endP.innerHTML = '노래가 멀어졌다. 밧줄이 풀리고,<br>' +
                           '부하들이 귀에서 밀랍을 뺐다.<br>' +
                           '노래를 듣고 살아남은 사람은 그가 처음이었다.';
          endF.textContent = '세이렌이 부른 것은 미인이 아니라 지식이었다.';
          endS.innerHTML = '파도 <b>' + r.total + '</b>번을 넘겼다 · 버틴 시간 <b>' +
                           Math.round(r.held) + '초</b>' +
                           (r.slips ? ' · 손이 풀림 ' + r.slips + '회' : '') +
                           '<br>부하 <b>' + r.survived + '명</b> 그대로 — 밀랍이 그들을 지켰다.';
        } else {
          endH.textContent = '그는 밧줄을 풀었다';
          endP.innerHTML = (r.reason === 'slip'
              ? '악력이 다해 손이 풀린 사이<br>노래가 밀려들었다.<br>'
              : '노래가 밀려오는 동안 손을 놓았다.<br>') +
            '그는 매듭을 풀고 바다로 뛰어들었다.';
          endF.textContent = '부하들이 그를 끌어올려 더 단단히 묶었다.';
          endS.innerHTML = '파도 <b>' + r.waves + ' / ' + r.total + '</b> 에서 무너졌다' +
                           (r.slips ? ' · 손이 풀림 ' + r.slips + '회' : '');
        }
        end.className = 'end on';
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 장면 — 돛대에 묶인 오디세우스가 화면 한가운데 있다
     ════════════════════════════════════════════════════════════════════ */

  /* ── 노잡이 한 명 (귀에 밀랍) ── */
  function rowerGeo() {
    var p = [];
    var sph = new T3.SphereGeometry(0.5, 8, 6);
    var box = new T3.BoxGeometry(1, 1, 1);
    p.push({ g: sph, m: M(0, 0.52, 0, 0.42, 0.56, 0.36), c: COL.crew });        // 몸통
    p.push({ g: sph, m: M(0, 0.86, 0, 0.26, 0.28, 0.25), c: COL.crewSkin });    // 머리
    p.push({ g: sph, m: M(0, 0.87, 0.12, 0.10, 0.11, 0.07), c: COL.wax });      // 귀의 밀랍
    p.push({ g: sph, m: M(0, 0.87, -0.12, 0.10, 0.11, 0.07), c: COL.wax });
    p.push({ g: box, m: M(0.20, 0.62, 0.13, 0.34, 0.10, 0.10, 0, 0, -0.35), c: COL.crewSkin });
    p.push({ g: box, m: M(0.20, 0.62, -0.13, 0.34, 0.10, 0.10, 0, 0, -0.35), c: COL.crewSkin });
    var g = merge(p);
    sph.dispose(); box.dispose();
    return g;
  }

  /* ── 오디세우스 — 돛대에 묶였다. 몸이 곧 유혹 게이지다. ── */
  function buildKing(parent) {
    var pivot = new T3.Group();          // 발끝을 축으로 앞뒤로 젖힌다
    parent.add(pivot);
    var mS = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var mT = new T3.MeshLambertMaterial({ color: COL.tunic, flatShading: true });
    var mH = new T3.MeshLambertMaterial({ color: 0x2b2018, flatShading: true });
    var box = new T3.BoxGeometry(1, 1, 1);
    var sph = new T3.SphereGeometry(0.5, 10, 7);

    function put(par, g, m, x, y, z, sx, sy, sz, rx, ry, rz) {
      var o = new T3.Mesh(g, m);
      o.position.set(x, y, z);
      o.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      par.add(o); return o;
    }
    // 다리 — 버틸 때 앞으로 뻗어 갑판을 민다
    var legL = put(pivot, box, mS, 0.0, 0.30, 0.16, 0.16, 0.62, 0.17);
    var legR = put(pivot, box, mS, 0.0, 0.30, -0.16, 0.16, 0.62, 0.17);
    // 몸통 (가슴을 축으로 위쪽이 움직인다)
    var torso = new T3.Group();
    torso.position.set(0, 0.60, 0);
    pivot.add(torso);
    put(torso, sph, mT, 0, 0.34, 0, 0.50, 0.72, 0.40);                  // 가슴
    put(torso, box, mT, 0, 0.06, 0, 0.40, 0.26, 0.34);                  // 허리
    var head = put(torso, sph, mS, 0.02, 0.82, 0, 0.28, 0.31, 0.27);
    put(torso, sph, mH, -0.06, 0.90, 0, 0.29, 0.24, 0.28);              // 머리털
    put(torso, sph, mH, 0.14, 0.70, 0, 0.20, 0.22, 0.20);               // 수염
    // 팔 — 어깨에서 손까지. 손은 가슴 앞의 밧줄을 잡는다.
    var armL = new T3.Group(); armL.position.set(0, 0.52, 0.26); torso.add(armL);
    var armR = new T3.Group(); armR.position.set(0, 0.52, -0.26); torso.add(armR);
    put(armL, box, mS, 0.14, -0.10, 0.04, 0.13, 0.40, 0.13, 0, 0, -0.55);
    put(armR, box, mS, 0.14, -0.10, -0.04, 0.13, 0.40, 0.13, 0, 0, -0.55);
    var fistL = put(armL, sph, mS, 0.30, -0.26, 0.06, 0.17, 0.17, 0.16);
    var fistR = put(armR, sph, mS, 0.30, -0.26, -0.06, 0.17, 0.17, 0.16);

    return {
      grp: pivot, torso: torso, head: head, armL: armL, armR: armR,
      fistL: fistL, fistR: fistR, legL: legL, legR: legR,
      geos: [box, sph], mats: [mS, mT, mH]
    };
  }

  /* ── 세이렌 — 안개 속 바위 위의 형체. 얼굴은 없다. ── */
  function buildSirens(parent, rnd) {
    var g = new T3.Group();
    parent.add(g);
    var rockM = new T3.MeshLambertMaterial({ color: COL.rock, flatShading: true });
    var bodyM = new T3.MeshBasicMaterial({ color: COL.siren });   // 빛과 무관하게 떠 보인다
    var glowM = new T3.MeshBasicMaterial({ color: COL.sirenLit, transparent: true,
                                           opacity: 0.0, depthWrite: false,
                                           blending: T3.AdditiveBlending });
    var ico = new T3.IcosahedronGeometry(1, 0);
    var cone = new T3.ConeGeometry(1, 1, 7);
    var sph = new T3.SphereGeometry(0.5, 8, 6);
    var box = new T3.BoxGeometry(1, 1, 1);

    // 바위 (그룹 원점 = 바위 꼭대기 언저리. 형체들은 그 위에 선다)
    var spots = [[0, -2.0, 0, 7.5, 4.4, 6.0], [-9.5, -3.2, 2, 5.2, 2.8, 4.2],
                 [9.0, -3.6, -2, 4.6, 2.4, 3.8], [3, -4.4, 5, 3.4, 1.8, 3.0],
                 [-4.5, -1.2, -3, 2.6, 2.2, 2.4]];
    for (var i = 0; i < spots.length; i++) {
      var r = new T3.Mesh(ico, rockM);
      r.position.set(spots[i][0], spots[i][1], spots[i][2]);
      r.scale.set(spots[i][3], spots[i][4], spots[i][5]);
      r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      g.add(r);
    }
    /* 형체 셋 — 안개보다 **밝게**. 어둡게 하면 안개에 묻혀 그냥 사라진다.
       머리는 있으나 얼굴은 없다. 팔을 들어 부른다. */
    var figs = [];
    var at = [[-3.1, 0.0], [0.4, 0.85], [3.5, 0.2]];
    for (i = 0; i < at.length; i++) {
      var f = new T3.Group();
      f.position.set(at[i][0], 2.05 + at[i][1], 0.6);
      g.add(f);
      var body = new T3.Mesh(cone, bodyM);
      body.scale.set(0.56, 2.30, 0.56);
      body.position.y = 1.15;
      body.rotation.x = Math.PI;         // 아래가 넓게
      f.add(body);
      var hd = new T3.Mesh(sph, bodyM);
      hd.scale.setScalar(0.56); hd.position.y = 2.52;
      f.add(hd);
      // 부르는 팔
      var arms = new T3.Group();
      arms.position.y = 2.05;
      f.add(arms);
      var aL = new T3.Mesh(box, bodyM);
      aL.scale.set(0.13, 0.95, 0.13); aL.position.set(-0.32, 0.30, 0);
      aL.rotation.z = 0.62;
      var aR = new T3.Mesh(box, bodyM);
      aR.scale.set(0.13, 0.95, 0.13); aR.position.set(0.32, 0.30, 0);
      aR.rotation.z = -0.62;
      arms.add(aL, aR);
      var gl = new T3.Mesh(cone, glowM);
      gl.scale.set(1.05, 2.9, 1.05); gl.position.y = 1.5; gl.rotation.x = Math.PI;
      f.add(gl);
      figs.push({ g: f, glow: gl, arms: arms, ph: i * 2.1, base: at[i][1] });
    }
    return { grp: g, figs: figs, glowM: glowM,
             geos: [ico, cone, sph, box], mats: [rockM, bodyM, glowM] };
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 스테이지 본체
     ════════════════════════════════════════════════════════════════════ */
  var S = null;

  function init(root3, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');
    if (S) dispose();

    var rnd = makeRng(opts.seed || 20260814);
    var world = new T3.Group();
    (root3 || opts.scene).add(world);

    var s = {
      world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, snd: makeAudio(makeRng(9137)),
      crew0: opts.crew == null ? C.CREW : opts.crew,
      g: null, phase: 'ready',
      wall: 0, want: false, shake: 0, freeze: 0,
      lean: 0, gripPose: 0, bandAt: 0, tickAt: 0,
      cueOn: false, cuedOnce: false, gotOne: false, result: null,
      disposables: { geos: [], mats: [] }
    };
    s.g = newGame(s.crew0);

    /* ── 빛 — 새벽 안개. 노래 쪽(−z)에서 옅은 금빛이 온다. ── */
    var amb = new T3.AmbientLight(0x2f3d5c, 2.35);
    var key = new T3.DirectionalLight(0xbfd4f0, 1.35);
    key.position.set(18, 24, 22);
    var rim = new T3.DirectionalLight(0xffc98a, 1.05);
    rim.position.set(-14, 9, -30);
    world.add(amb, key, rim);
    s.rim = rim;

    /* ── 바다 ── */
    var seaG = new T3.PlaneGeometry(600, 600);
    var seaM = new T3.MeshLambertMaterial({ color: COL.sea, flatShading: true });
    var sea = new T3.Mesh(seaG, seaM);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.02;
    world.add(sea);
    s.disposables.geos.push(seaG); s.disposables.mats.push(seaM);

    /* 수평선의 새벽빛 — 눈높이에 딱 맞춘 얇은 띠. 아래 절반은 바다가 가리므로
       한 줄로 읽힌다. 안개뿐이면 하늘과 바다가 붙어버려 깊이가 죽는다. */
    var dawnG = new T3.PlaneGeometry(700, 1);
    s.disposables.geos.push(dawnG);
    var dawnH = [[0.8, 0.20], [2.4, 0.10], [5.6, 0.055]];   // 겹쳐서 위로 흐려지게
    for (i = 0; i < dawnH.length; i++) {
      var dm = new T3.MeshBasicMaterial({ color: COL.dawn, transparent: true,
                                          opacity: dawnH[i][1], depthWrite: false, fog: false,
                                          blending: T3.AdditiveBlending });
      var dq = new T3.Mesh(dawnG, dm);
      dq.position.set(0, 3.05 + dawnH[i][0] * 0.30, -70);
      dq.scale.set(1, dawnH[i][0], 1);
      world.add(dq);
      s.disposables.mats.push(dm);
    }

    // 물결 — 얇은 판 몇 개가 흘러간다
    var wG = new T3.PlaneGeometry(1, 1);
    var wM = new T3.MeshBasicMaterial({ color: COL.seaLit, transparent: true,
                                        opacity: 0.20, depthWrite: false });
    s.disposables.geos.push(wG); s.disposables.mats.push(wM);
    s.ripples = [];
    for (var i = 0; i < 26; i++) {
      var rp = new T3.Mesh(wG, wM);
      rp.rotation.x = -Math.PI / 2;
      rp.position.set((rnd() * 2 - 1) * 70, 0.03, -4 - rnd() * 46);
      rp.scale.set(5 + rnd() * 12, 0.30 + rnd() * 0.4, 1);
      rp.userData.sp = 5 + rnd() * 5;
      world.add(rp);
      s.ripples.push(rp);
    }

    /* ── 배 ── */
    var ship = new T3.Group();
    world.add(ship);
    s.ship = ship;

    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 10);
    var sph = new T3.SphereGeometry(0.5, 10, 7);
    s.disposables.geos.push(box, cyl, sph);
    var hullM = new T3.MeshLambertMaterial({ color: COL.hull, flatShading: true });
    var deckM = new T3.MeshLambertMaterial({ color: COL.deck, flatShading: true });
    var railM = new T3.MeshLambertMaterial({ color: COL.rail, flatShading: true });
    var mastM = new T3.MeshLambertMaterial({ color: COL.mast, flatShading: true });
    var oarM = new T3.MeshLambertMaterial({ color: COL.oar, flatShading: true });
    s.disposables.mats.push(hullM, deckM, railM, mastM, oarM);

    function put(par, g, m, x, y, z, sx, sy, sz, rx, ry, rz) {
      var o = new T3.Mesh(g, m);
      o.position.set(x, y, z);
      o.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      par.add(o); return o;
    }
    put(ship, sph, hullM, 0, 0.55, 0, 9.2, 1.5, 2.6);                 // 선체
    put(ship, box, deckM, 0, 1.02, 0, 7.6, 0.12, 1.90);               // 갑판
    put(ship, box, railM, 0, 1.18, 0.96, 7.7, 0.22, 0.13);            // 뱃전
    put(ship, box, railM, 0, 1.18, -0.96, 7.7, 0.22, 0.13);
    put(ship, sph, hullM, 4.35, 1.35, 0, 0.9, 2.0, 0.55);             // 뱃머리
    put(ship, sph, hullM, -4.35, 1.30, 0, 0.8, 1.7, 0.5);             // 고물
    var mast = put(ship, cyl, mastM, 0, 4.60, 0, 0.135, 7.20, 0.135); // 돛대
    s.mast = mast;
    put(ship, cyl, mastM, 0, 7.55, 0, 0.10, 4.60, 0.10, Math.PI / 2, 0, 0);  // 활대
    // 걷어올린 돛 — 노만 젓는다
    put(ship, box, new T3.MeshLambertMaterial({ color: 0xcfc3a6, flatShading: true }),
        0, 7.32, 0, 0.34, 0.34, 4.00);

    /* 노잡이 — 부하 수만큼 실제로 앉아 있다 */
    var rowG = rowerGeo();
    s.disposables.geos.push(rowG);
    var rowM = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    s.disposables.mats.push(rowM);
    /* 자리는 여덟 개를 늘 만들어 두고 **보이는 수만** 바꾼다 —
       앞 편에서 잃은 부하는 갑판에서도 실제로 비어 있어야 한다(setCrew). */
    var nRow = 8;
    s.rowers = new T3.InstancedMesh(rowG, rowM, nRow);
    s.rowers.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    s.rowers.frustumCulled = false;
    ship.add(s.rowers);
    /* 자리는 고물 쪽으로 — 카메라와 오디세우스 사이를 비운다 */
    s.rowSeat = [];
    for (i = 0; i < nRow; i++) {
      s.rowSeat.push({ x: -1.15 - (i >> 1) * 1.45, z: (i % 2 ? 1 : -1) * 0.60,
                       ph: (i >> 1) * 0.30 + (i % 2) * 0.12 });
    }
    /* 노 */
    s.oars = [];
    for (i = 0; i < nRow; i++) {
      var sgn = (i % 2) ? 1 : -1;
      var piv = new T3.Group();
      piv.position.set(s.rowSeat[i].x, 1.10, sgn * 0.95);
      ship.add(piv);
      put(piv, box, oarM, 0, 0, sgn * 1.35, 0.10, 0.10, 2.70);
      put(piv, box, oarM, 0, 0, sgn * 2.65, 0.09, 0.30, 0.70);
      s.oars.push({ p: piv, side: sgn, ph: s.rowSeat[i].ph });
    }
    showCrew(s, s.crew0);

    /* 오디세우스 — 돛대 바로 앞(−z, 세이렌 쪽) */
    s.king = buildKing(ship);
    s.king.grp.position.set(0.10, 1.08, -0.70);  // 돛대 왼편(세이렌 쪽)
    s.king.grp.rotation.y = 0.80;              // 뱃머리와 노래 사이 — 카메라엔 옆모습
    s.king.grp.scale.setScalar(1.12);
    s.disposables.geos = s.disposables.geos.concat(s.king.geos);
    s.disposables.mats = s.disposables.mats.concat(s.king.mats);

    /* ── 밧줄 — 돛대와 그를 한 번에 감은 고리 셋 ────────────────────────
       고리라야 '묶였다'가 한눈에 읽힌다. 앞으로 끌릴수록 고리가 늘어나
       팽팽해지고 밝아진다 — 유혹 게이지의 3D 판본이다.                   */
    var ropeM = new T3.MeshLambertMaterial({ color: COL.rope, flatShading: true });
    var ropeG = new T3.TorusGeometry(1, 0.048, 5, 18);
    s.disposables.mats.push(ropeM); s.disposables.geos.push(ropeG);
    s.ropes = [];
    for (i = 0; i < 3; i++) {
      var rm = new T3.Mesh(ropeG, ropeM);
      rm.rotation.x = -Math.PI / 2;                 // 눕혀서 몸을 두른다
      ship.add(rm);
      s.ropes.push({ m: rm, y: 1.68 + i * 0.40 });
    }
    /* 매듭 — 놓으면 그가 이걸 푼다 */
    var knot = new T3.Mesh(sph, ropeM);
    knot.scale.set(0.20, 0.17, 0.17);
    ship.add(knot);
    s.knot = knot;
    s.ropeM = ropeM;

    /* 그를 비추는 작은 온기 — 어두운 새벽에 주인공이 묻히지 않게 */
    var warm = new T3.PointLight(0xffcf9a, 5.5, 6.0, 2);
    warm.position.set(0.9, 2.5, 1.0);
    ship.add(warm);
    s.warm = warm;

    /* ── 세이렌의 바위 ── */
    s.sir = buildSirens(world, rnd);
    s.disposables.geos = s.disposables.geos.concat(s.sir.geos);
    s.disposables.mats = s.disposables.mats.concat(s.sir.mats);

    /* ── 노래 = 밀려오는 빛의 띠 ──────────────────────────────────────
       바위에서 나서 배까지 BAND_TRAVEL 초에 걸쳐 온다. 띠의 밝기는
       **도착할 때의 노래 세기**다 — 그래서 다가오는 띠가 곧 예고다.      */
    var bandG = new T3.PlaneGeometry(1, 1);
    s.disposables.geos.push(bandG);
    s.bands = [];
    for (i = 0; i < 30; i++) {
      var bmm = new T3.MeshBasicMaterial({ color: COL.song, transparent: true,
                                           opacity: 0, depthWrite: false, fog: false,
                                           blending: T3.AdditiveBlending });
      var bm = new T3.Mesh(bandG, bmm);   // 수면에 눕힌 띠 — 배 쪽으로 밀려온다
      bm.rotation.x = -Math.PI / 2;
      bm.visible = false;
      bm.renderOrder = 3;
      world.add(bm);
      s.disposables.mats.push(bmm);
      s.bands.push({ m: bm, mat: bmm, live: false, u: 0, v: 0, x: 0, h: 0 });
    }

    /* ── HUD ── */
    var host = opts.hudHost || (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host === document.body && host.style && !host.style.position) host.style.position = 'relative';
    s.hud = makeHud(host, s.crew0, s.g.f.waves);
    s.hud.onRestart(function () { reset(); start(); });

    if (opts.bindInput !== false) bindInput(s);

    s.dummy = new T3.Object3D();
    S = s;
    layout(s);
    s.hud.gauge(s.g, s.g.f);
    frame(s, 0);
    return api;
  }

  /* 갑판에 앉아 있는 사람 수를 부하 수에 맞춘다 */
  function showCrew(s, n) {
    var k = Math.max(0, Math.min(s.rowSeat.length, n || 0)), i;
    s.rowers.count = k;
    for (i = 0; i < s.oars.length; i++) s.oars[i].p.visible = i < k;
  }

  /* ── 스페이스 / 클릭·탭 → press(down) 하나로 ── */
  function bindInput(s) {
    var target = s.canvas || document;
    s.onKey = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        if (!e.repeat) press(true);
      }
    };
    s.onKeyUp = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault(); press(false);
      }
    };
    s.onDown = function (e) {
      if (e.button != null && e.button !== 0) return;
      if (e.preventDefault) e.preventDefault();
      press(true);
    };
    s.onUp = function () { press(false); };
    s.onBlur = function () { press(false); };
    window.addEventListener('keydown', s.onKey, false);
    window.addEventListener('keyup', s.onKeyUp, false);
    target.addEventListener('pointerdown', s.onDown, false);
    window.addEventListener('pointerup', s.onUp, false);
    window.addEventListener('pointercancel', s.onUp, false);
    window.addEventListener('blur', s.onBlur, false);
    s.inputTarget = target;
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. 카메라 — 돛대에 묶인 그가 화면 한가운데. 바위는 그 너머 왼쪽.
     ════════════════════════════════════════════════════════════════════ */
  /* 돛대에 묶인 그가 화면을 채워야 한다 — 눈높이에서 가까이.
     수평선은 화면 위쪽 절반에 걸리고, 그 너머에 세이렌의 바위가 뜬다. */
  /* 돛대에 묶인 그가 화면을 채워야 한다 — 눈높이에서 가까이.
     ★ 카메라는 돛대의 **오른쪽 앞**에 선다. 그가 돛대 왼편(세이렌 쪽)에 묶여 있으니
     이 각도라야 돛대에 가리지 않고 옆모습이 보인다. 수평선은 화면 중간, 그 위에 바위. */
  var CAM = {
    L: { fov: 45, pos: [5.10, 3.20, 4.60], look: [0.05, 2.48, -0.50] },
    P: { fov: 60, pos: [3.85, 3.00, 3.55], look: [0.05, 2.38, -0.45] }
  };
  function layout(s) {
    var cam = s.camera;
    if (!cam) return;
    var w = s.viewW || (s.canvas ? s.canvas.clientWidth : 1100) || 1100;
    var h = s.viewH || (s.canvas ? s.canvas.clientHeight : 820) || 820;
    var aspect = w / h;
    var k = aspect < 1 ? CAM.P : CAM.L;
    cam.fov = k.fov;
    cam.aspect = aspect;
    cam.near = 0.4; cam.far = 700;
    cam.position.set(k.pos[0], k.pos[1], k.pos[2]);
    cam.lookAt(k.look[0], k.look[1], k.look[2]);
    cam.updateProjectionMatrix();
    s.camBase = cam.position.clone();
  }
  function resize(w, h) {
    if (!S) return;
    if (w) { S.viewW = w; S.viewH = h; }
    else if (S.canvas) { S.viewW = S.canvas.clientWidth; S.viewH = S.canvas.clientHeight; }
    layout(S);
    if (S.renderer && S.viewW) S.renderer.setSize(S.viewW, S.viewH, false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     10. 입력
     ════════════════════════════════════════════════════════════════════ */
  function press(down) {
    var s = S;
    if (!s) return 'none';
    s.snd.resume();
    if (down === undefined) down = !s.want;
    if (s.phase === 'ready') { start(); if (!down) return 'start'; }
    if (s.phase !== 'run') return 'idle';
    var was = s.want;
    s.want = !!down;
    if (down && !was) {
      if (s.g.forced > 0) s.hud.flash('아직 잡히지 않는다', '#ffb27a', '손이 풀렸다');
      else {
        s.snd.grab();
        s.cueOn = false; s.cuedOnce = true; s.hud.cue(false);
        if (!s.gotOne) { s.gotOne = true; s.hud.hint(false); }
      }
    }
    return down ? 'down' : 'up';
  }

  /* ══════════════════════════════════════════════════════════════════════
     11. 루프
     ════════════════════════════════════════════════════════════════════ */
  function update(dt, quiet) {
    var s = S;
    if (!s) return;
    dt = clamp(dt || 0, 0, 0.05);
    s.wall += dt;
    s.hud.tick(dt);

    if (s.phase === 'run') {
      var g = s.g;
      /* 손이 풀리는 순간의 짧은 정지 — 무슨 일이 났는지 볼 시간을 준다 */
      var step = dt;
      if (s.freeze > 0) { s.freeze = Math.max(0, s.freeze - dt); step = 0; }
      advance(g, step, s.want);
      digest(s, g, step);
      if (g.phase !== 'run') {
        g.overT += dt;
        if (!s.result && g.overT >= (g.phase === 'won' ? C.WIN_T : C.OVER_T)) finish(s);
      }
    }
    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  /* ── 규칙이 낸 사건을 화면·소리로 옮긴다 ── */
  function digest(s, g, dt) {
    var e = g.evt; g.evt = '';
    if (e === 'slip') {
      s.snd.slip();
      s.shake = 1; s.freeze = C.FREEZE;
      s.hud.flash('손이 풀렸다', '#ff8a5a', '악력이 바닥났다');
    } else if (e === 'lose') {
      s.snd.splash();
      s.shake = 0.7;
      s.hud.cue(false);
      s.hud.flash('밧줄을 풀었다', '#ff6a9a',
                  g.reason === 'slip' ? '손이 풀린 사이 노래가 밀려들었다'
                                      : '노래가 밀려오는 동안 손을 놓았다');
    } else if (e === 'win') {
      s.snd.bell();
      s.hud.flash('노래가 멀어진다', '#8fe6d0');
    }
    if (e === 'lose' || e === 'win') s.hud.hint(false);

    /* ── 첫 파도에서 딱 한 번 "붙잡아라" (1편의 "지금!" 과 같은 자리) ── */
    if (!s.cuedOnce && g.phase === 'run') {
      var on = g.song >= 0.16 && !s.want;
      if (on !== s.cueOn) { s.cueOn = on; s.hud.cue(on); }
      if (s.want || g.t > s.g.f.hot[0].b) { s.cuedOnce = true; s.cueOn = false; s.hud.cue(false); }
    }

    /* ── 소리 ── */
    s.snd.voice(g.song, clamp(g.tempt, 0, 1));
    s.snd.creak(g.holding ? (0.25 + 0.75 * (1 - g.grip)) : 0);
    if (g.holding && g.grip < C.WARN) {
      s.tickAt -= dt;
      if (s.tickAt <= 0) { s.tickAt = 0.12 + g.grip * 0.9; s.snd.tick(); }
    } else s.tickAt = 0;

    s.hud.gauge(g, g.f);
  }

  function finish(s) {
    if (s.result) return;
    var r = resultOf(s.g);
    s.result = r;
    s.phase = 'over';
    s.snd.voice(0, 0); s.snd.creak(0);
    s.hud.hint(false); s.hud.cue(false);
    var handled = false;
    if (typeof api.onEnd === 'function') {
      try { api.onEnd(r); handled = true; } catch (e) { handled = false; }
    }
    if (!handled || s.opts.endPanel === true) s.hud.end(r);
  }

  /* ══════════════════════════════════════════════════════════════════════
     12. 한 프레임 그리기
     ════════════════════════════════════════════════════════════════════ */
  function frame(s, dt) {
    dt = dt || 0;
    var g = s.g, w = s.wall;
    var over = g.phase !== 'run';
    var dying = g.phase === 'lost';
    var oT = over ? clamp(g.overT / (dying ? C.OVER_T : C.WIN_T), 0, 1) : 0;

    /* ── 몸이 곧 게이지다 ────────────────────────────────────────────
       버틸 때는 뒤로 젖히고, 놓으면 앞으로 끌려간다. 유혹이 높을수록 더 멀리. */
    var pull = clamp(g.tempt, 0, 1);
    var target = clamp((g.holding ? -0.15 : 0.10 + 0.26 * g.song) + pull * 0.30, -0.16, 0.52);
    if (dying) target = 0.95 + oT * 0.55;
    s.lean = ease(s.lean, target, dt || 0.016, dying ? 0.22 : 0.13);
    var K = s.king;
    K.grp.rotation.x = -s.lean;                       // −z(세이렌) 쪽으로 기운다
    K.torso.rotation.x = -s.lean * 0.45 + Math.sin(w * 1.6) * 0.02;
    K.head.rotation.x = -0.10 - s.lean * 0.35;
    /* 실패 — 매듭을 풀고 뱃전을 넘어 바다로. 위로 뜨는 게 아니라 **떨어진다.** */
    K.grp.position.y = 1.08 + (dying ? Math.sin(oT * 3.14159) * 0.55 - oT * oT * 3.4 : 0);
    K.grp.position.z = -0.70 - (dying ? oT * 3.6 : 0);
    K.grp.rotation.y = 0.80 + (dying ? oT * 0.5 : 0);
    K.grp.visible = !(dying && oT > 0.88);

    /* 팔 — 버틸 땐 밧줄을 움켜쥐고(안쪽), 놓으면 매듭을 푼다(위로) */
    s.gripPose = ease(s.gripPose, g.holding ? 1 : 0, dt || 0.016, 0.10);
    var strain = g.holding ? (1 - g.grip) : 0;
    var shake = strain * 0.06 * Math.sin(w * 26);
    K.armL.rotation.z = -0.15 + s.gripPose * 0.55 + shake;
    K.armR.rotation.z = -0.15 + s.gripPose * 0.55 - shake;
    K.armL.rotation.x = (1 - s.gripPose) * (0.55 + Math.sin(w * 7.5) * 0.30);
    K.armR.rotation.x = (1 - s.gripPose) * (0.55 + Math.sin(w * 7.5 + 1.1) * 0.30);
    // 다리 — 버틸 때 앞으로 뻗어 민다
    K.legL.rotation.x = -0.10 - s.gripPose * 0.34;
    K.legR.rotation.x = -0.10 - s.gripPose * 0.34;

    /* ── 밧줄 — 돛대와 그를 함께 감은 고리. 앞으로 끌릴수록 늘어난다. ── */
    var sinL = Math.sin(s.lean), cz0 = 0, i;
    for (i = 0; i < s.ropes.length; i++) {
      var rp = s.ropes[i];
      var h = rp.y - 1.08;                       // 발끝에서의 높이
      var cz = -0.70 - sinL * h;                 // 그 높이에서 가슴이 있는 곳
      var back = 0.24, front = cz - 0.24;        // 돛대 뒤 ~ 가슴 앞
      if (i === 0) cz0 = cz;
      var rz = (back - front) * 0.5;
      rp.m.position.set(0.05, rp.y - sinL * 0.06, (back + front) * 0.5);
      rp.m.scale.set(rz * 0.52, rz, 1);
      rp.m.visible = !(dying && oT > 0.45);
    }
    s.knot.position.set(0.14, s.ropes[1].y - 0.02, cz0 - 0.28);
    s.knot.visible = !(dying && oT > 0.45);
    /* 팽팽할수록 밝다 — 밧줄 자체가 유혹 게이지의 3D 판본이다 */
    s.ropeM.color.setRGB(0.72 + pull * 0.28, 0.60 + pull * 0.22, 0.38 - pull * 0.10);

    /* ── 노잡이 · 노 — 계속 젓는다 (그들은 아무것도 못 듣는다) ── */
    var dm = s.dummy, row = w * 1.35;
    for (i = 0; i < s.rowSeat.length; i++) {
      var st = s.rowSeat[i];
      var a = Math.sin(row - st.ph);
      dm.position.set(st.x + a * 0.13, 1.06, st.z);
      dm.rotation.set(a * 0.26, st.z > 0 ? -1.57 : 1.57, 0);
      dm.scale.setScalar(1);
      dm.updateMatrix();
      s.rowers.setMatrixAt(i, dm.matrix);
    }
    s.rowers.instanceMatrix.needsUpdate = true;
    for (i = 0; i < s.oars.length; i++) {
      var o = s.oars[i];
      o.p.rotation.x = 0.26 * o.side + Math.sin(row - o.ph) * 0.30 * o.side;
      o.p.rotation.y = Math.sin(row - o.ph + 1.57) * 0.13;
    }

    /* 배가 물결에 흔들린다 — 노래가 셀수록 크게 */
    var sway = 0.02 + g.song * 0.035;
    s.ship.rotation.z = Math.sin(w * 0.9) * sway;
    s.ship.rotation.x = Math.sin(w * 0.62 + 1.1) * sway * 0.6;
    s.ship.position.y = Math.sin(w * 0.85) * 0.10;

    /* ── 바위가 지나간다 — 3파도쯤 프레임에 들어와 5·6파도에 가장 가깝다.
       수평선(눈높이 y≈3.05) 위로 솟아야 안개를 배경으로 실루엣이 산다. ── */
    var pr = clamp(g.t / g.f.total, 0, 1);
    var rockX = 18 - pr * 56;
    s.sir.grp.position.set(rockX, 0.30, C.ROCK_Z);
    for (i = 0; i < s.sir.figs.length; i++) {
      var fg = s.sir.figs[i];
      var rise = g.song * (0.9 + 0.4 * Math.sin(w * 0.8 + fg.ph));
      fg.g.position.y = 2.05 + fg.base + rise * 1.1;
      fg.g.rotation.z = Math.sin(w * 1.1 + fg.ph) * 0.10 + g.song * 0.16;
      fg.g.rotation.x = -g.song * 0.20;
      // 팔을 들어 부른다 — 노래가 셀수록 크게
      fg.arms.rotation.z = Math.sin(w * 1.4 + fg.ph) * 0.10 * (0.3 + g.song);
      fg.arms.rotation.x = -g.song * 0.45;
    }
    s.sir.glowM.opacity = 0.04 + g.song * 0.26 * (over ? (1 - oT) : 1);
    s.rim.intensity = 0.7 + g.song * 1.5;

    /* ── 빛의 띠 — 바위에서 나서 배로 밀려온다 ────────────────────────
       밝기 = **도착할 때의 노래 세기.** 다가오는 띠가 곧 예고다. */
    if (!over && g.phase === 'run') {
      s.bandAt -= dt;
      if (s.bandAt <= 0) {
        s.bandAt = C.BAND_EVERY;
        var vv = songAt(g.f, g.t + C.BAND_TRAVEL);
        if (vv > 0.02) {
          for (i = 0; i < s.bands.length; i++) {
            if (!s.bands[i].live) {
              s.bands[i].live = true; s.bands[i].u = 0; s.bands[i].v = vv;
              s.bands[i].x = rockX + (s.rnd() * 2 - 1) * 8;
              s.bands[i].h = 0.10 + s.rnd() * 0.5;
              if (vv > 0.5 && s.rnd() < 0.4) s.snd.wave(vv);
              break;
            }
          }
        }
      }
    }
    for (i = 0; i < s.bands.length; i++) {
      var b = s.bands[i];
      if (!b.live) { if (b.m.visible) b.m.visible = false; continue; }
      b.u += dt / C.BAND_TRAVEL;
      if (b.u >= 1.25) { b.live = false; b.m.visible = false; continue; }
      var uu = clamp(b.u, 0, 1.25);
      var z = lerp(C.ROCK_Z + 1.0, -1.6, uu);
      var wid = lerp(17, 12, Math.min(uu, 1));
      var dep = (0.34 + b.v * 0.95) * lerp(0.7, 1.25, Math.min(uu, 1));
      b.m.visible = true;
      b.m.position.set(lerp(b.x, 0, Math.min(uu, 1) * 0.9), 0.05 + b.h * 0.06, z);
      b.m.scale.set(wid, dep, 1);
      /* 가까이 올수록 옅어진다 — 배 위에서 터지면 화면이 하얗게 날아간다 */
      var fade = (b.u < 0.06 ? b.u / 0.06 : 1) * clamp((1.05 - b.u) / 0.45, 0, 1);
      b.mat.opacity = (0.06 + b.v * 0.40) * fade * (over ? (1 - oT) : 1);
    }

    /* ── 물결이 흘러간다 ── */
    for (i = 0; i < s.ripples.length; i++) {
      var rr = s.ripples[i];
      rr.position.x -= rr.userData.sp * dt;
      if (rr.position.x < -80) rr.position.x = 80;
    }

    /* ── 흔들림 · 하얗게 물드는 화면 ── */
    if (s.camera && s.camBase) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt * 2.2);
        var m = s.shake * s.shake * 0.34;
        s.camera.position.set(
          s.camBase.x + (s.rnd() * 2 - 1) * m,
          s.camBase.y + (s.rnd() * 2 - 1) * m,
          s.camBase.z + (s.rnd() * 2 - 1) * m * 0.6);
      } else s.camera.position.copy(s.camBase);
    }
    if (s.warm) s.warm.intensity = 5.5 + Math.sin(w * 1.7) * 0.5 + g.song * 1.2;
    s.hud.white(dying ? Math.max(0, (oT - 0.6) / 0.4) * 0.9 : 0);
  }

  /* ══════════════════════════════════════════════════════════════════════
     13. 흐름 제어
     ════════════════════════════════════════════════════════════════════ */
  function start() {
    if (!S) return;
    if (S.phase === 'over') reset();
    S.phase = 'run';
    S.snd.resume();
    S.hud.end(null);
    S.hud.hint(!S.gotOne);
  }
  function pause() { if (S && S.phase === 'run') S.phase = 'pause'; }

  function reset() {
    var s = S;
    if (!s) return;
    s.g = newGame(s.crew0);
    s.want = false; s.result = null; s.shake = 0; s.freeze = 0;
    s.lean = 0; s.gripPose = 0; s.bandAt = 0; s.tickAt = 0;
    s.cueOn = false; s.cuedOnce = false;
    for (var i = 0; i < s.bands.length; i++) { s.bands[i].live = false; s.bands[i].m.visible = false; }
    s.hud.end(null); s.hud.flash(''); s.hud.cue(false); s.hud.hint(false);
    s.hud.crew(s.crew0); s.hud.white(0);
    s.phase = 'ready';
    s.hud.gauge(s.g, s.g.f);
    frame(s, 0);
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try {
      if (s.onKey) window.removeEventListener('keydown', s.onKey, false);
      if (s.onKeyUp) window.removeEventListener('keyup', s.onKeyUp, false);
      if (s.onUp) {
        window.removeEventListener('pointerup', s.onUp, false);
        window.removeEventListener('pointercancel', s.onUp, false);
      }
      if (s.onBlur) window.removeEventListener('blur', s.onBlur, false);
      if (s.onDown && s.inputTarget) s.inputTarget.removeEventListener('pointerdown', s.onDown, false);
      if (s.onWinResize) window.removeEventListener('resize', s.onWinResize, false);
    } catch (e) { }
    try { if (s.raf) cancelAnimationFrame(s.raf); } catch (e) { }
    try { s.snd.dispose(); } catch (e) { }
    try { s.hud.dispose(); } catch (e) { }
    try {
      if (s.world.parent) s.world.parent.remove(s.world);
      s.world.traverse(function (o) {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        if (o.material) {
          if (o.material.length) { for (var i = 0; i < o.material.length; i++) o.material[i].dispose(); }
          else o.material.dispose();
        }
      });
    } catch (e) { }
    S = null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     14. 단독 실행 — 캔버스/DOM 요소를 주면 렌더러까지 이 파일이 세운다
     ════════════════════════════════════════════════════════════════════ */
  function mount(root, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');
    if (root && root.isObject3D) return init(root, ui, opts);

    var host = null, canvas = null;
    if (root && root.tagName === 'CANVAS') { canvas = root; host = root.parentNode; }
    else if (root && root.appendChild) {
      host = root;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      host.appendChild(canvas);
    } else throw new Error('mount: 캔버스나 DOM 요소가 필요합니다.');

    var renderer = new T3.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 1100, canvas.clientHeight || 820, false);
    var scene = new T3.Scene();
    scene.background = new T3.Color(COL.mist);
    scene.fog = new T3.Fog(COL.mist, 11, 88);
    var camera = new T3.PerspectiveCamera(46, 1, 0.4, 700);
    scene.add(camera);
    var r3 = new T3.Group();
    scene.add(r3);

    var st = init(r3, ui, {
      camera: camera, renderer: renderer, canvas: canvas, scene: scene,
      seed: opts.seed, crew: opts.crew,
      hudHost: opts.hudHost || host, endPanel: opts.endPanel,
      bindInput: opts.bindInput
    });
    resize(canvas.clientWidth, canvas.clientHeight);

    if (opts.loop !== false) {
      var last = 0;
      var tick = function (tt) {
        if (!S) return;
        S.raf = requestAnimationFrame(tick);
        var dt = last ? (tt - last) / 1000 : 0.016;
        last = tt;
        update(dt);
      };
      S.raf = requestAnimationFrame(tick);
    }
    if (opts.onResize !== false) {
      S.onWinResize = function () {
        if (!S || !S.canvas) return;
        resize(S.canvas.clientWidth, S.canvas.clientHeight);
      };
      window.addEventListener('resize', S.onWinResize, false);
    }
    if (opts.autoStart !== false) start();
    return st;
  }

  /* ══════════════════════════════════════════════════════════════════════
     15. 디버그 스냅샷 · 자동 조종
     ════════════════════════════════════════════════════════════════════ */
  function state() {
    var s = S;
    if (!s) return { ready: false };
    var g = s.g, f = g.f;
    var h = hotAt(f, g.t);
    return {
      ready: true, phase: s.phase, gphase: g.phase,
      t: +g.t.toFixed(2), span: +f.total.toFixed(1),
      song: +g.song.toFixed(3),
      tempt: +g.tempt.toFixed(3), grip: +g.grip.toFixed(3),
      need: +needAt(f, g.t).toFixed(3),
      rise: +(g.holding ? -fallAt(g.song) : riseAt(g.song)).toFixed(3),
      drain: +(g.holding ? (C.GD0 + C.GD1 * g.song) : 0).toFixed(3),
      holding: g.holding, want: s.want, forced: +g.forced.toFixed(2),
      rest: +g.rest.toFixed(2),
      wave: waveNoAt(f, g.t), waves: wavesDone(f, g.t), total: f.waves,
      inWave: !!(h && g.t >= h.a && g.t < h.b),
      hotA: h ? +h.a.toFixed(1) : null, hotB: h ? +h.b.toFixed(1) : null,
      slips: g.slips, held: +g.held.toFixed(1), peak: +g.peak.toFixed(3),
      lean: +s.lean.toFixed(3),
      result: s.result || null
    };
  }

  /* 세계를 원하는 시각까지 조용히 민다 (스크린샷용).
     hold 는 boolean 또는 g=>boolean */
  function skipTo(sec, hold) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var n = 0;
    while (s.g.t < sec && s.g.phase === 'run' && n++ < 30000) {
      s.want = typeof hold === 'function' ? !!hold(s.g) : !!hold;
      update(0.02, true);
    }
    update(0, false);
    return state();
  }

  /* 자동 조종 — simulate() 와 같은 봇을 실제 입력 경로로 돌린다.
     둘이 어긋나면 화면과 규칙이 어긋난 것이다. */
  function auto(policy, maxSec, quiet, opts) {
    var s = S;
    if (!s) return null;
    reset(); start();
    var bot = makeBot({ policy: policy, seed: (s.opts.seed || 20260814),
                        jit: opts && opts.jit, lat: opts && opts.lat });
    var dt = 1 / 60, n = Math.round((maxSec || 200) / dt), i;
    for (i = 0; i < n && s.phase === 'run'; i++) {
      s.want = bot(s.g, dt);
      update(dt, quiet !== false);
    }
    s.want = false;
    update(0, false);
    var st = state();
    st.result = s.result;
    return st;
  }

  function setCrew(n) {
    var s = S;
    if (!s) return null;
    if (typeof n === 'number' && isFinite(n)) {
      s.crew0 = Math.max(0, Math.round(n));
      s.opts.crew = s.crew0;
      showCrew(s, s.crew0);              // 갑판에서도 실제로 줄어든다
      if (s.phase === 'ready') { s.g.crew = s.crew0; s.g.crew0 = s.crew0; s.hud.crew(s.crew0); }
    }
    return s.crew0;
  }

  /* ── 공개 API ── */
  var api = {
    init: init,
    mount: mount,
    setCrew: setCrew,
    start: start,
    pause: pause,
    reset: reset,
    press: press,
    update: update,
    resize: resize,
    dispose: dispose,
    state: state,
    skipTo: skipTo,
    auto: auto,
    simulate: simulate,
    costTable: costTable,
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
