/* ============================================================================
   오디세이아 / ODYSSEY — st6-bow.js  →  OD.St6
   6편 「이타카의 활」 — 당겼다 정확히 놓기 (STAGES-3-6.md "# 6편")
   ----------------------------------------------------------------------------
   이 파일 하나가 6편의 전부를 소유한다: 장면 · 게임루프 · 입력 · 규칙 · 게이지 ·
   피드백 · 결과 카드.

   OD.St6.mount(rootEl, ui, opts) -> stage
   OD.St6.press(down)      down=true 누름, false 놓음 (스페이스·클릭·탭 공통)
   OD.St6.update(dt, quiet)
   OD.St6.onEnd = fn({win, crew, lost, survived, axe, shots, ...})
   OD.St6.dispose()

   보조: init / start / pause / reset / resize / state / skipTo / auto /
         simulate / setCrew

   ── 이 편의 동사 ──────────────────────────────────────────────────────────
   2편도 hold/release 였지만 2편은 **몇 초마다 반복하는 리듬**이다.
   6편은 **단 한 발**. 눌러 시위를 당기고, 조준선이 열두 구멍을 꿰는 찰나에 놓는다.

   ── 규칙이 화면으로 오는 방법 ──────────────────────────────────────────────
   오차는 두 축이다. 두 축이 각각 게이지 하나다.

     세로 ↕  힘이 모자라면 화살이 가라앉는다   sag = sK·d² · p^(−3.2)
     가로 ↔  당길수록 손이 떨린다              lat = A(t)·sin(φ(t))

   조준경 한가운데에 **구멍 크기 그대로의 고리**를 띄우고 그 안에 십자선을 찍는다.
   처음엔 십자선이 고리 **한참 아래**에 있다(힘이 모자라다). 당기면 올라오는데,
   올라올 때쯤이면 좌우로 흔들리기 시작한다(떨림 폭이 구멍보다 커진다).
   **둘이 동시에 맞는 찰나**가 이 편의 전부다.

   그리고 도끼 열두 자루의 구멍마다 **점을 하나씩** 찍는다 — 지금 놓으면 화살이
   그 구멍의 어디를 지나는지. 열두 점이 전부 초록이면 지나간다. 먼 도끼일수록
   먼저 붉어진다: 각도 오차가 거리에 비례해 커진다는 걸 설명 없이 가르친다.

   힘 막대의 **최소선(MINP)은 규칙에서 유도한다.** sag(D12, MINP) == TOL 이므로
   막대의 선과 조준경 고리의 아래턱이 같은 하나를 가리킨다 — 게이지와 판정이
   어긋날 수 있는 여지 자체가 없다.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St6 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — 밸런스는 전부 여기 있다.
        simulate() 로 "시도 4~8회" 를 실제로 재 볼 수 있다.
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    crew: 2,               // opts.crew 로 덮인다 — 부하 수가 편을 관통한다
    arrows: 3,             // 화살통

    /* ── 1막: 시위 얹기 ─────────────────────────────────────────────
       구혼자 108명이 못 한 일. 여기서 hold/release 를 글자 없이 배운다.
       띠가 넓다(37%) — 시험이 아니라 의식이다. */
    strRate: 1 / 1.30,
    strLo: 0.55, strHi: 0.92,
    strBack: 0.95,         // 실패하면 활이 펴지고 다시

    /* ── 2막: 사격 ────────────────────────────────────────────────── */
    drawFull: 2.90,        // 힘 1.0 까지 (선형 — 읽기 쉬워야 한다)
    holdMax: 3.35,         // 이 뒤엔 팔이 풀린다 (강제 발사, 크게 빗나감)
    rel: 0.030,            // 손을 떠나기까지. 조준경도 이 시점을 그린다.
    wildK: 3.4,            // 팔이 풀렸을 때 오차 배수

    // 떨림 A(t) — 단위는 "열두째 도끼에서의 좌우 오차(world)"
    // (구멍 크기 TOL 에 비례해 맞춰 둔 값들이다. TOL 을 바꾸면 셋 다 같은 비율로.)
    trA0: 0.0733, trK: 0.2151, trT0: 0.30, trE: 1.5,
    // 떨림 주기 T(t) = trP0 − trPk·t (당길수록 빨라진다)
    trP0: 0.80, trPk: 0.10, trPmin: 0.30,

    /* ── 도끼 열두 자루 ───────────────────────────────────────────── */
    nAxe: 12,
    bowZ: 1.20,            // 화살촉이 출발하는 z
    axe0: 3.20,            // 첫 도끼까지
    axeGap: 1.80,
    lineY: 1.35,           // 구멍 중심 높이 = 조준선 높이
    holeR: 0.21,
    arrowR: 0.030,
    sK: 1.676e-5, vE: 3.2, // sag(d,p) = sK·d² · p^(−vE)

    /* ── 비행 ── */
    flySpeed: 15.5,        // u/s — 24.2 유닛을 1.56초에 지난다
    hitHold: 1.30,         // 걸린 뒤 멈춰 있는 시간

    /* ── 카메라 ────────────────────────────────────────────────────
       ★ 눈이 조준선 가까이 있어야 **구멍이 구멍으로 보인다.** 위에서 내려다보면
       도끼가 서로를 가려 한 덩어리 능선이 된다(1차 시안의 실패). 그래서 눈높이를
       구멍(y=1.35) 바로 위에 두고 **옆으로만** 비켜선다. 그러면 열두 고리가
       부채꼴로 늘어서고, 오디세우스는 어깨 너머 왼쪽에 남는다. */
    camL: { fov: 40, x: 1.26, y: 1.76, z: 5.55, fx: 0.04, fy: 1.35, fz: -15.0 },
    camP: { fov: 43, x: 0.52, y: 1.72, z: 5.15, fx: -0.55, fy: 1.30, fz: -15.0 },

    /* ── 조준경 (표시 전용) ── */
    retDist: 6.0, retR: 0.27,
    markR: 0.014,          // 도끼마다 찍는 점 (거리에 비례해 커진다 = 화면상 같은 크기)
    subSec: 5.0            // 페넬로페 한 줄이 떠 있는 시간
  };

  var TOL = C.holeR - C.arrowR;                          // 0.180
  var D12 = C.bowZ + C.axe0 + C.axeGap * (C.nAxe - 1);   // 24.2
  var MAG = C.retR / TOL;                                // 조준경 배율

  /* ★ 최소선은 **규칙에서 유도한다.** 손으로 적어 넣으면 게이지에 그린 선과
     실제 판정이 어긋나고, 그 순간 "왜 안 됐는지 모르겠다"가 된다.
     sag(D12, MINP) == TOL — 즉 이 힘에서 십자선이 고리 아래턱에 정확히 닿는다.
     막대의 선과 조준경의 고리가 같은 하나를 가리킨다.                        */
  var MINP = Math.pow(C.sK * D12 * D12 / TOL, 1 / C.vE); // ≈ 0.403

  // 색 — 어두운 홀 + 횃불. 도끼의 쇠만 차갑다.
  var COL = {
    bg: 0x090a0f,
    floor: 0x241c14,
    floorLit: 0xffc27a,
    wall: 0x140f0b,
    wallFar: 0x2b1d13,
    door: 0x74501f,
    beam: 0x1c150f,
    col: 0x2b2118,
    iron: 0x707a86,
    ironDark: 0x39404a,
    edge: 0xb6c2d0,
    wood: 0x4a3323,
    woodDark: 0x2b1e14,
    bow: 0x6d4a29,
    horn: 0xd6c197,
    string: 0xe8dfc8,
    shaft: 0xd9c9a4,
    fletch: 0xc94f38,
    skin: 0xc59a6d,
    rag: 0x5f5140,
    ragOff: 0xc7a15a,
    hair: 0x2a2119,
    suitA: 0x584a6a,
    suitB: 0x44586a,
    suitC: 0x6a4a4a,
    bench: 0x33261a,
    pene: 0x9083ab,
    loom: 0x7d6d52
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
  /* 고리 안쪽은 1:1 로 정확하게, 바깥은 눌러서 화면 안에 잡아 둔다.
     판정이 일어나는 건 고리 안쪽뿐이니 바깥의 정밀도는 필요 없다. */
  function squash(v, R) {
    var a = Math.abs(v);
    if (a <= R) return v;
    var s = v < 0 ? -1 : 1;
    return s * (R + (a - R) / (1 + (a - R) / (R * 1.15)));
  }

  var ORD = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째',
             '일곱째', '여덟째', '아홉째', '열째', '열한째', '열두째'];

  /* ══════════════════════════════════════════════════════════════════════
     2. 순수 모델 — 당긴 시간 t 하나로 세계가 결정된다.
        (simulate() 와 실제 플레이가 한 치도 어긋나지 않는 이유)
     ════════════════════════════════════════════════════════════════════ */
  function powAt(t) { return clamp(t / C.drawFull, 0, 1); }

  /* 떨림 진폭 — t≈1.23 에서 구멍을 넘어선다. 힘이 차는 건 t≈1.50 이다.
     **떨림이 먼저 커지고 힘이 나중에 찬다** — 이 순서가 6편의 전부다. */
  function ampAt(t) {
    var u = t - C.trT0;
    return C.trA0 + (u > 0 ? C.trK * Math.pow(u, C.trE) : 0);
  }
  /* 주기가 줄어드는 진동의 위상은 적분해야 한다 (ω·t 로 쓰면 어긋난다) */
  function phaseAt(t) {
    var p = C.trP0 - C.trPk * t;
    if (p < C.trPmin) {
      var tc = (C.trP0 - C.trPmin) / C.trPk;
      return (2 * Math.PI / C.trPk) * Math.log(C.trP0 / C.trPmin) +
             (t - tc) * (2 * Math.PI / C.trPmin);
    }
    return (2 * Math.PI / C.trPk) * Math.log(C.trP0 / p);
  }
  function latAt(t, ph0) { return ampAt(t) * Math.sin(phaseAt(t) + ph0); }

  function distOf(k) { return C.bowZ + C.axe0 + C.axeGap * k; }   // k = 0..11
  function zOf(k) { return -(C.axe0 + C.axeGap * k); }
  function sagAt(d, p) { return C.sK * d * d * Math.pow(Math.max(0.06, p), -C.vE); }

  /* 지금 놓으면 k째 도끼의 구멍 어디를 지나는가 (구멍 중심 기준) */
  function offAt(k, lat, p) {
    var d = distOf(k);
    return { x: lat * d / D12, y: -sagAt(d, p), d: d };
  }
  /* 한 발의 운명. 걸린 도끼와 **왜** 까지 함께 돌려준다. */
  function shotOf(lat, p, wild) {
    var k;
    for (k = 0; k < C.nAxe; k++) {
      var o = offAt(k, lat, p);
      if (Math.sqrt(o.x * o.x + o.y * o.y) > TOL) {
        return {
          win: false, axe: k, wild: !!wild,
          why: Math.abs(o.y) > Math.abs(o.x) ? 'power' : 'shake',
          side: o.x < 0 ? 'L' : 'R', lat: lat, p: p
        };
      }
    }
    return { win: true, axe: C.nAxe, wild: !!wild, why: '', side: '', lat: lat, p: p };
  }
  function greenNow(lat, p) { return shotOf(lat, p).win; }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시뮬레이션 — "가장 어렵되 시도 4~8회" 를 실제로 잰다.
        sigma = 놓는 순간의 오차(초). 0.03 능숙 · 0.09 처음.
     ════════════════════════════════════════════════════════════════════ */
  function botShot(ph0, sigma, rnd) {
    var t0 = MINP * C.drawFull, dt = 1 / 500, t, a = -1, b = -1;
    for (t = t0; t <= C.holdMax; t += dt) {
      var ok = greenNow(latAt(t + C.rel, ph0), powAt(t));
      if (ok && a < 0) a = t;
      if (!ok && a >= 0) {
        if (t - a >= 0.045) { b = t; break; }   // 눈에 보일 만큼 넓은 창만 노린다
        a = -1;
      }
    }
    if (a < 0) return { win: false, axe: 0, why: 'none', win0: 0 };
    if (b < 0) b = Math.min(C.holdMax, a + 0.10);
    var aim = (a + b) * 0.5;
    var jit = (rnd() + rnd() + rnd() - 1.5) * 2 * sigma;    // 표준편차 = sigma(초)
    var tr = clamp(aim + jit, 0.05, C.holdMax);
    var wild = tr >= C.holdMax - 1e-6;
    var r = shotOf(latAt(tr + C.rel, ph0) * (wild ? C.wildK : 1), powAt(tr), wild);
    r.win0 = b - a;      // 그 순간의 창 너비(초)
    return r;
  }
  function simulate(o) {
    o = o || {};
    var sigma = (o.sigma == null) ? 0.055 : o.sigma;
    var n = o.n || 400;
    var rnd = makeRng(o.seed || 60601);
    var wins = 0, shots = 0, axeSum = 0, winSum = 0, i, r;
    var arrowSum = 0;
    for (i = 0; i < n; i++) {
      var ph0 = rnd() * 6.28318, used = 0, won = false;
      while (used < C.arrows && !won) {
        r = botShot(ph0 + used * 1.7, sigma, rnd);
        used++; shots++; axeSum += r.axe; winSum += r.win0 || 0;
        if (r.win) won = true;
      }
      arrowSum += used;
      if (won) wins++;
    }
    return {
      sigma: sigma, runs: n, wins: wins,
      runRate: +(wins / n).toFixed(3),
      shotRate: +(wins / shots).toFixed(3),
      arrowsPerRun: +(arrowSum / n).toFixed(2),
      meanAxe: +(axeSum / shots).toFixed(2),
      window: +(winSum / shots).toFixed(3),        // 통과 구간의 평균 너비(초)
      expectShots: +(shots / Math.max(1, wins)).toFixed(1)
    };
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
      if (!g.attributes.normal) g.computeVertexNormals();
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
  /* InstancedMesh 의 per-instance 색은 재질에 vertexColors 가 켜져야 곱해진다.
     그런데 vertexColors 를 켜면 지오메트리에 color 속성이 없을 때 검게 나온다.
     (도끼마다 찍는 점이 전부 까맣게 나왔던 이유가 이것이었다) */
  function whiteColors(g) {
    var n = g.attributes.position.count;
    var c = new Float32Array(n * 3);
    for (var i = 0; i < n * 3; i++) c[i] = 1;
    g.setAttribute('color', new T3.BufferAttribute(c, 3));
    return g;
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
        도끼를 지날 때마다 반음씩 오른다 → 통과가 곧 한 옥타브다.
     ════════════════════════════════════════════════════════════════════ */
  function makeAudio(rnd) {
    var ctx = null, master = null, noise = null;
    var crk = null, crkG = null, crkF = null;
    var mur = null, murG = null, murF = null;
    var on = true, ready = false;

    function ensure() {
      if (ctx || !on) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);

        var len = Math.floor(ctx.sampleRate * 1.6);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        crk = ctx.createBufferSource(); crk.buffer = noise; crk.loop = true;
        crkF = ctx.createBiquadFilter();
        crkF.type = 'bandpass'; crkF.frequency.value = 320; crkF.Q.value = 3.2;
        crkG = ctx.createGain(); crkG.gain.value = 0;
        crk.connect(crkF); crkF.connect(crkG); crkG.connect(master); crk.start();

        mur = ctx.createBufferSource(); mur.buffer = noise; mur.loop = true;
        murF = ctx.createBiquadFilter();
        murF.type = 'lowpass'; murF.frequency.value = 460; murF.Q.value = 0.9;
        murG = ctx.createGain(); murG.gain.value = 0;
        mur.connect(murF); murF.connect(murG); murG.connect(master); mur.start();
        ready = true;
      } catch (e) { on = false; ctx = null; }
      return ctx;
    }
    function resume() {
      ensure();
      try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { }
    }
    function now() { return ctx ? ctx.currentTime : 0; }
    function tone(type, f0, f1, dur, vol, delay) {
      if (!ctx) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = now() + (delay || 0);
        o.type = type; o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.010);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.02);
      } catch (e) { }
    }
    function burst(f, q, dur, vol, delay) {
      if (!ctx) return;
      try {
        var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(),
            g = ctx.createGain(), t = now() + (delay || 0);
        s.buffer = noise; s.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(bp); bp.connect(g); g.connect(master);
        s.start(t); s.stop(t + dur + 0.02);
      } catch (e) { }
    }
    return {
      resume: resume,
      get ready() { return ready; },
      creak: function (lv) {
        if (!ctx || !crkG) return;
        try {
          crkG.gain.setTargetAtTime(0.055 * lv * lv, now(), 0.06);
          crkF.frequency.setTargetAtTime(240 + 420 * lv, now(), 0.09);
        } catch (e) { }
      },
      murmur: function (lv) {
        if (!ctx || !murG) return;
        try { murG.gain.setTargetAtTime(0.052 * lv, now(), 0.25); } catch (e) { }
      },
      string: function () {
        tone('triangle', 210, 128, 0.42, 0.24);
        tone('sine', 640, 420, 0.22, 0.13);
        burst(1700, 2.4, 0.10, 0.06);
      },
      slip: function () {
        tone('sine', 190, 74, 0.34, 0.18);
        burst(420, 1.1, 0.20, 0.09);
      },
      laugh: function (n) {
        var i;
        for (i = 0; i < (n || 5); i++) {
          burst(300 + i * 95, 4.5, 0.11, 0.055, i * 0.075);
          tone('sawtooth', 150 + i * 22, 110 + i * 16, 0.13, 0.030, i * 0.075);
        }
      },
      gasp: function () { burst(1100, 0.9, 0.34, 0.075); },
      twang: function () {
        tone('triangle', 300, 96, 0.34, 0.30);
        tone('sine', 900, 300, 0.16, 0.12);
        burst(2600, 1.6, 0.09, 0.07);
      },
      pass: function (k) {
        var f = 520 * Math.pow(2, k / 12);
        tone('sine', f, f * 0.94, 0.085, 0.13);
        burst(f * 2.4, 6.0, 0.05, 0.045);
      },
      thunk: function () {
        tone('sine', 140, 52, 0.34, 0.34);
        tone('sawtooth', 380, 120, 0.20, 0.10);
        burst(760, 1.0, 0.16, 0.13);
      },
      ring: function () {
        tone('sine', 1046, 1046, 1.30, 0.10, 0.35);
        tone('sine', 1568, 1568, 1.10, 0.055, 0.45);
        tone('sine', 784, 784, 1.60, 0.07, 0.30);
      },
      rise: function () {
        tone('sawtooth', 70, 46, 1.5, 0.16);
        burst(240, 0.6, 1.2, 0.11);
      },
      tick: function () { burst(2400, 5.0, 0.035, 0.038); },
      mute: function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () {
        try { if (crk) crk.stop(); } catch (e) { }
        try { if (mur) mur.stop(); } catch (e) { }
        try { if (ctx) ctx.close(); } catch (e) { }
        ctx = null;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. HUD — 최소한만. 규칙은 조준경이 가르친다.
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st6-css';
  var CSS = [
    '.st6{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#efe7d8;-webkit-user-select:none;user-select:none;z-index:5}',
    '.st6 .bar{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;',
    'align-items:flex-start;padding:14px 16px;gap:12px}',
    '.st6 .ar{display:flex;align-items:center;gap:9px}',
    '.st6 .ar b{font-size:2.05rem;line-height:1;font-weight:800;letter-spacing:-.03em;',
    'text-shadow:0 2px 10px #000}',
    '.st6 .pips{display:flex;gap:6px}',
    '.st6 .pip{width:5px;height:19px;border-radius:2px;background:#e8dfc8;',
    'box-shadow:0 0 6px rgba(0,0,0,.8);transition:background .2s}',
    '.st6 .pip.spent{background:#3a322a;box-shadow:inset 0 0 0 1.5px #6b5a44}',
    '.st6 .crew{display:flex;align-items:center;gap:7px;opacity:.9;font-weight:700;',
    'font-size:.98rem;text-shadow:0 2px 8px #000}',
    '.st6 .crew i{display:block;width:9px;height:9px;border-radius:50%;background:#7ee0a8}',
    '.st6 .sub{position:absolute;left:50%;top:12.5%;transform:translateX(-50%);',
    'font-size:.94rem;font-weight:600;color:#d6c8ac;opacity:0;text-align:center;',
    'letter-spacing:.01em;text-shadow:0 2px 12px #000;transition:opacity .9s;',
    'max-width:88%;line-height:1.5}',
    '.st6 .sub.on{opacity:.92}',
    '.st6 .cue{position:absolute;left:50%;top:77%;transform:translate(-50%,-50%) scale(.8);',
    'font-size:2.3rem;font-weight:900;letter-spacing:-.02em;opacity:0;color:#ffd98c;',
    'text-shadow:0 0 26px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,1),0 3px 12px #000;',
    'transition:opacity .12s}',
    '.st6 .cue.on{opacity:1;transform:translate(-50%,-50%) scale(1);transition:opacity .1s,transform .18s}',
    '.st6 .flash{position:absolute;left:50%;top:70%;transform:translate(-50%,-50%);',
    'font-size:1.3rem;font-weight:800;opacity:0;white-space:nowrap;text-align:center;',
    'text-shadow:0 2px 12px #000;transition:opacity .2s,top .5s}',
    '.st6 .flash.on{opacity:1;top:66.5%}',
    '.st6 .flash u{display:block;margin-top:3px;font-size:.94rem;font-weight:700;',
    'text-decoration:none;letter-spacing:.02em;opacity:.92}',
    '.st6 .flash.on.soft{opacity:.82;font-size:1.04rem;font-weight:700}',
    '.st6 .hint{position:absolute;left:50%;bottom:3.5%;transform:translateX(-50%);',
    'font-size:.9rem;font-weight:600;color:#d9cfba;opacity:0;white-space:nowrap;',
    'padding:7px 15px;border-radius:999px;background:rgba(10,9,7,.42);',
    'text-shadow:0 2px 10px #000;transition:opacity .5s}',
    '.st6 .hint.on{opacity:.9}',
    /* 숨어 있는 동안 히트테스트에서 완전히 빠져야 한다 */
    '.st6 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:12px;background:rgba(6,7,10,.88);',
    'opacity:0;pointer-events:none;visibility:hidden;overflow-y:auto;',
    'transition:opacity .45s;text-align:center;padding:26px 22px}',
    '.st6 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st6 .end h2{font-size:1.58rem;font-weight:800;margin:0;letter-spacing:-.02em}',
    '.st6 .end p{font-size:1rem;color:#c2b8a6;margin:0;line-height:1.75;max-width:34em}',
    '.st6 .end p.q{color:#9c9384;font-style:italic;font-size:.95rem}',
    '.st6 .end b{color:#ffd88f}',
    '.st6 .end .epi{margin-top:2px;padding-top:13px;border-top:1px solid #322b22;',
    'max-width:34em;width:100%}',
    '.st6 .end .epi h3{margin:0 0 6px;font-size:1.04rem;font-weight:800;color:#efe7d8}',
    '.st6 .end .epi p{margin:0 auto}',
    '.st6 .end ol{margin:11px 0 0;padding:0;list-style:none;text-align:left;',
    'display:inline-block;color:#a89e8d;font-size:.86rem;line-height:1.8}',
    '.st6 .end ol li b{color:#c9bda6;font-weight:700;margin-right:5px}',
    '.st6 .end .film{margin-top:11px;font-size:.89rem;color:#8d8474}',
    '.st6 .end button{margin-top:8px;padding:11px 26px;border-radius:999px;',
    'border:1px solid #55493a;background:#1a1712;color:#efe7d8;font-size:1rem;font-weight:700;',
    'cursor:pointer;font-family:inherit}',
    '.st6 .end button:active{transform:translateY(1px)}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function makeHud(host) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'st6';
    el.innerHTML =
      '<div class="bar">' +
        '<div class="ar"><b>3</b><div class="pips"></div></div>' +
        '<div class="crew"><i></i><span>0</span></div>' +
      '</div>' +
      '<div class="sub">페넬로페는 낮에 짠 수의를 밤마다 풀었다. 이십 년을.</div>' +
      '<div class="cue">지금</div>' +
      '<div class="flash"><span></span><u></u></div>' +
      '<div class="hint">누르고 있다가 놓는다</div>' +
      '<div class="end"><h2></h2><p></p><p class="q"></p>' +
        '<div class="epi"></div><button type="button">다시</button></div>';
    host.appendChild(el);

    var bigN = el.querySelector('.ar b'),
        pips = el.querySelector('.pips'),
        crewN = el.querySelector('.crew span'),
        sub = el.querySelector('.sub'),
        cue = el.querySelector('.cue'),
        flash = el.querySelector('.flash'),
        fT1 = el.querySelector('.flash span'),
        fT2 = el.querySelector('.flash u'),
        hint = el.querySelector('.hint'),
        end = el.querySelector('.end'),
        endH = el.querySelector('.end h2'),
        endP = el.querySelector('.end p'),
        endQ = el.querySelector('.end p.q'),
        endE = el.querySelector('.end .epi'),
        endB = el.querySelector('.end button');

    var pipEls = [], i;
    for (i = 0; i < C.arrows; i++) {
      var d = document.createElement('i');
      d.className = 'pip';
      pips.appendChild(d); pipEls.push(d);
    }
    var flashT = 0, lastA = '', lastC = '';

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },
      arrows: function (n) {
        var key = String(n);
        if (key === lastA) return;
        lastA = key;
        bigN.textContent = key;
        for (var j = 0; j < pipEls.length; j++)
          pipEls[j].className = 'pip' + (j < C.arrows - n ? ' spent' : '');
      },
      crew: function (n) {
        var key = String(n);
        if (key === lastC) return;
        lastC = key;
        crewN.textContent = key;
      },
      sub: function (on) { sub.className = on ? 'sub on' : 'sub'; },
      cue: function (on) { cue.className = on ? 'cue on' : 'cue'; },
      hint: function (on) { hint.className = on ? 'hint on' : 'hint'; },
      flash: function (txt, col, why, soft) {
        if (!txt) { flash.className = 'flash'; flashT = 0; return; }
        fT1.textContent = txt;
        fT2.textContent = why || '';
        flash.style.color = col;
        flash.className = soft ? 'flash on soft' : 'flash on';
        flashT = soft ? 0.62 : 1.60;
      },
      tick: function (dt) {
        if (flashT > 0) {
          flashT -= dt;
          if (flashT <= 0) flash.className = 'flash';
        }
      },
      end: function (r) {
        if (!r) { end.className = 'end'; endE.innerHTML = ''; return; }
        if (r.win) {
          endH.textContent = '열두 자루를 지났다';
          endP.innerHTML = '화살이 열두 자루를 소리 없이 지났다. 홀이 조용해졌다.<br>' +
                           '그는 누더기를 벗고 두 번째 화살을 메겼다.';
          endQ.textContent = '';
          endE.innerHTML =
            '<h3>호메로스의 오디세우스는 <b>혼자</b> 돌아왔습니다.</h3>' +
            '<p>' + (r.crew > 0 ? '당신은 <b>' + r.crew + '명</b>을 데려왔습니다.'
                                : '당신도 <b>혼자</b>였습니다.') + '</p>' +
            '<ol>' +
              '<li><b>1</b>키클롭스의 동굴에서 양 배에 매달려 빠져나왔다.</li>' +
              '<li><b>2</b>아이올로스의 바람 자루를 이타카가 보이는 새벽에 잃었다.</li>' +
              '<li><b>3</b>세이렌의 노래를 듣고 살아남은 첫 사람이 되었다.</li>' +
              '<li><b>4</b>스킬라에게 여섯을 내주고 배를 지켰다.</li>' +
              '<li><b>5</b>헬리오스의 소에 손댄 대가로 배가 쪼개졌다.</li>' +
              '<li><b>6</b>이십 년 만에 돌아와, 아무도 못 당긴 활을 당겼다.</li>' +
            '</ol>' +
            '<div class="film">이 이야기의 나머지는 극장에서 이어집니다.</div>';
        } else {
          endH.textContent = '화살이 떨어졌다';
          endP.innerHTML = '가장 멀리 간 화살은 <b>' + ORD[clamp(r.best - 1, 0, 11)] +
                           '</b> 도끼까지였다.<br>구혼자들이 다시 떠들기 시작했다.';
          endQ.textContent = '그 활은 아직 그의 손에 있다.';
          endE.innerHTML = '';
        }
        endE.style.display = r.win ? '' : 'none';
        end.className = 'end on';
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 장면 만들기
     ════════════════════════════════════════════════════════════════════ */

  /* ── 도끼 한 자루 — **머리가 고리다.**
     ★ 여기서 한 번 실패했다: 쇠머리를 판(板)으로 만들었더니 앞 도끼가 뒷 도끼의
       구멍을 덮어 열두 자루가 회색 능선 하나로 뭉갰다. 그래서 머리를 비운다.
       고리 + 위의 날 + 아래의 자루. 고리 사이가 뚫려 있어 **열두 구멍이 끝까지
       사슬로 보인다.** 이 편의 표적이 보이느냐 마느냐가 여기 달렸다.        */
  function axeGeo() {
    var p = [];
    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 8);
    var tor = new T3.TorusGeometry(C.holeR, 0.055, 8, 26);
    var R = C.holeR, Y = C.lineY;
    var hbot = Y - R - 0.05;

    p.push({ g: cyl, m: M(0, hbot * 0.5 - 0.10, 0, 0.048, hbot + 0.20, 0.048), c: COL.wood });
    p.push({ g: box, m: M(0, hbot + 0.03, 0, 0.15, 0.10, 0.10), c: COL.ironDark });
    p.push({ g: tor, m: M(0, Y, 0, 1, 1, 1), c: COL.iron });
    // 날 — 고리 위로만 솟는다. 옆으로 벌어져도 구멍 높이는 가리지 않는다.
    p.push({ g: box, m: M(0, Y + R + 0.055, 0, 0.11, 0.13, 0.085), c: COL.iron });
    p.push({ g: box, m: M(0, Y + R + 0.195, 0, 0.34, 0.17, 0.070), c: COL.iron });
    p.push({ g: box, m: M(0, Y + R + 0.315, 0, 0.26, 0.07, 0.050), c: COL.edge });

    var g = merge(p);
    box.dispose(); cyl.dispose(); tor.dispose();
    return g;
  }

  /* ── 앉은 구혼자 (키 ~1.25) ── */
  function suitorGeo(cloth) {
    var p = [];
    var sph = new T3.SphereGeometry(0.5, 8, 6);
    var box = new T3.BoxGeometry(1, 1, 1);
    p.push({ g: sph, m: M(0, 0.58, 0, 0.42, 0.60, 0.37), c: cloth });
    p.push({ g: sph, m: M(0, 0.90, 0.02, 0.21, 0.23, 0.21), c: COL.skin });
    p.push({ g: sph, m: M(0, 0.97, -0.05, 0.23, 0.19, 0.22), c: COL.hair });
    p.push({ g: box, m: M(0.21, 0.60, 0.09, 0.10, 0.28, 0.10, 0, 0, 0.35), c: cloth });
    p.push({ g: box, m: M(-0.21, 0.60, 0.09, 0.10, 0.28, 0.10, 0, 0, -0.35), c: cloth });
    p.push({ g: box, m: M(0.11, 0.26, 0.19, 0.14, 0.31, 0.28), c: cloth });
    p.push({ g: box, m: M(-0.11, 0.26, 0.19, 0.14, 0.31, 0.28), c: cloth });
    p.push({ g: sph, m: M(0.27, 0.76, 0.20, 0.10, 0.12, 0.10), c: 0xa8853f });
    var g = merge(p);
    sph.dispose(); box.dispose();
    return g;
  }

  /* ── 오디세우스 (뒷모습) ── */
  function buildArcher(root) {
    var G = new T3.Group();
    var mat = {
      rag: new T3.MeshLambertMaterial({ color: COL.rag, flatShading: true }),
      skin: new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true }),
      hair: new T3.MeshLambertMaterial({ color: COL.hair, flatShading: true }),
      bow: new T3.MeshLambertMaterial({ color: COL.bow, flatShading: true }),
      horn: new T3.MeshLambertMaterial({ color: COL.horn, flatShading: true }),
      shaft: new T3.MeshLambertMaterial({ color: COL.shaft, flatShading: true }),
      fletch: new T3.MeshLambertMaterial({ color: COL.fletch, flatShading: true })
    };
    var sph = new T3.SphereGeometry(0.5, 10, 7);
    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 8);
    var cone = new T3.ConeGeometry(0.036, 0.12, 6);

    function add(g, m, x, y, z, sx, sy, sz, rx, ry, rz) {
      var o = new T3.Mesh(g, m);
      o.position.set(x, y, z);
      o.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      G.add(o); return o;
    }
    /* ★ 몸은 화살선(local x = 0)에서 살짝 비켜 서 있다.
       실제 궁수도 화살이 얼굴 옆을 지난다 — 그래야 활도 사람도 서로 안 가린다. */
    var BX = -0.14;
    add(box, mat.rag, BX - 0.10, 0.40, 0.02, 0.17, 0.80, 0.20);
    add(box, mat.rag, BX + 0.10, 0.40, -0.05, 0.17, 0.80, 0.20);
    add(sph, mat.rag, BX, 0.86, 0, 0.40, 0.26, 0.28);
    var torso = add(sph, mat.rag, BX, 1.20, 0, 0.46, 0.58, 0.30);
    add(box, mat.rag, BX, 1.22, -0.11, 0.36, 0.46, 0.07);
    add(sph, mat.rag, BX + 0.22, 1.46, 0, 0.20, 0.18, 0.19);
    add(sph, mat.rag, BX - 0.22, 1.46, 0, 0.20, 0.18, 0.19);
    add(cyl, mat.skin, BX, 1.56, -0.02, 0.070, 0.14, 0.070);
    add(sph, mat.skin, BX, 1.71, -0.02, 0.185, 0.215, 0.19);
    add(sph, mat.hair, BX, 1.745, -0.05, 0.20, 0.19, 0.20);
    add(sph, mat.hair, BX, 1.655, -0.11, 0.17, 0.14, 0.10);

    var armL = {
      up: add(cyl, mat.skin, 0, 0, 0, 0.055, 1, 0.055),
      el: add(sph, mat.skin, 0, 0, 0, 0.085, 0.085, 0.085),
      fo: add(cyl, mat.skin, 0, 0, 0, 0.048, 1, 0.048),
      S: new T3.Vector3(BX + 0.22, 1.45, 0), L1: 0.36, L2: 0.36,
      pole: new T3.Vector3(0.6, -1.0, 0.15)
    };
    var armR = {
      up: add(cyl, mat.skin, 0, 0, 0, 0.055, 1, 0.055),
      el: add(sph, mat.skin, 0, 0, 0, 0.085, 0.085, 0.085),
      fo: add(cyl, mat.skin, 0, 0, 0, 0.048, 1, 0.048),
      S: new T3.Vector3(BX - 0.22, 1.45, 0), L1: 0.36, L2: 0.36,
      pole: new T3.Vector3(-1.0, 0.55, 0.30)
    };
    var handL = add(sph, mat.skin, 0, 0, 0, 0.080, 0.090, 0.080);
    var handR = add(sph, mat.skin, 0, 0, 0, 0.075, 0.082, 0.075);

    /* 등에 멘 화살통 — 남은 화살이 실제로 꽂혀 있다 */
    add(cyl, mat.bow, BX - 0.16, 1.16, -0.20, 0.070, 0.44, 0.070, 0.22, 0, 0.30);
    var qArrows = [];
    for (var qi = 0; qi < C.arrows; qi++) {
      var qa = add(cyl, mat.shaft, BX - 0.22 + qi * 0.035, 1.52, -0.28 + qi * 0.02,
                   0.013, 0.34, 0.013, 0.22, 0, 0.30);
      qArrows.push(qa);
    }

    /* 활 — 열여섯 토막의 곡선. 당기면 실제로 휜다. */
    var NB = 16, bowSeg = [], i;
    for (i = 0; i < NB; i++) {
      var m = new T3.Mesh(cyl, (i < 3 || i > NB - 4) ? mat.horn : mat.bow);
      m.scale.set(0.034, 0.12, 0.034);
      G.add(m); bowSeg.push(m);
    }
    var grip = add(cyl, mat.horn, 0, 0, 0, 0.050, 0.20, 0.050);

    /* 시위 — 두 토막. 당기면 V 가 된다. */
    var strM = new T3.MeshBasicMaterial({ color: COL.string });
    var str1 = new T3.Mesh(cyl, strM); str1.scale.set(0.013, 1, 0.013); G.add(str1);
    var str2 = new T3.Mesh(cyl, strM); str2.scale.set(0.013, 1, 0.013); G.add(str2);

    /* 화살 */
    var arrow = new T3.Group();
    var ashaft = new T3.Mesh(cyl, mat.shaft);
    ashaft.scale.set(0.015, 0.94, 0.015);
    ashaft.rotation.x = Math.PI / 2;
    var tip = new T3.Mesh(cone, mat.horn);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.52;
    var fl1 = new T3.Mesh(box, mat.fletch);
    fl1.scale.set(0.006, 0.065, 0.16); fl1.position.z = 0.40;
    var fl2 = new T3.Mesh(box, mat.fletch);
    fl2.scale.set(0.065, 0.006, 0.16); fl2.position.z = 0.40;
    arrow.add(ashaft, tip, fl1, fl2);
    G.add(arrow);

    root.add(G);
    return {
      group: G, mat: mat, torso: torso, qArrows: qArrows,
      armL: armL, armR: armR, handL: handL, handR: handR,
      bowSeg: bowSeg, grip: grip, str1: str1, str2: str2,
      arrow: arrow,
      geos: [sph, box, cyl, cone],
      mats: [mat.rag, mat.skin, mat.hair, mat.bow, mat.horn, mat.shaft, mat.fletch, strM]
    };
  }

  /* ── 홀 ── */
  function buildHall(root) {
    var out = { mats: [], geos: [], lights: [], flames: [] };
    function mat(m) { out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }

    var FAR = -27.0;

    var floor = new T3.Mesh(geo(new T3.PlaneGeometry(26, 46)),
                            mat(new T3.MeshLambertMaterial({ color: COL.floor })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -9);
    root.add(floor);

    // 참호 — 도끼가 박힌 자리. 복도를 한 줄로 묶는다.
    var trZ = (zOf(0) + zOf(C.nAxe - 1)) * 0.5;
    var tr = new T3.Mesh(geo(new T3.BoxGeometry(0.88, 0.32, 23.8)),
                         mat(new T3.MeshLambertMaterial({ color: COL.woodDark })));
    tr.position.set(0, 0.03, trZ);
    root.add(tr);
    var trTop = new T3.Mesh(geo(new T3.PlaneGeometry(0.88, 23.8)),
                            mat(new T3.MeshBasicMaterial({
                              color: COL.floorLit, transparent: true, opacity: 0.11,
                              depthWrite: false, blending: T3.AdditiveBlending })));
    trTop.rotation.x = -Math.PI / 2;
    trTop.position.set(0, 0.20, trZ);
    root.add(trTop);

    var wm = mat(new T3.MeshLambertMaterial({ color: COL.wall }));
    var wg = geo(new T3.PlaneGeometry(46, 12));
    var wl = new T3.Mesh(wg, wm);
    wl.rotation.y = Math.PI / 2; wl.position.set(-7.4, 4, -9); root.add(wl);
    var wr = new T3.Mesh(wg, wm);
    wr.rotation.y = -Math.PI / 2; wr.position.set(7.4, 4, -9); root.add(wr);
    var ceil = new T3.Mesh(geo(new T3.PlaneGeometry(16, 46)),
                           mat(new T3.MeshLambertMaterial({ color: COL.beam })));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 5.6, -9); root.add(ceil);

    var bm = mat(new T3.MeshLambertMaterial({ color: COL.beam, flatShading: true }));
    var bg = geo(new T3.BoxGeometry(15, 0.36, 0.42));
    for (var b = 0; b < 10; b++) {
      var bb = new T3.Mesh(bg, bm);
      bb.position.set(0, 5.28, 2 - b * 3.2);
      root.add(bb);
    }

    var cm = mat(new T3.MeshLambertMaterial({ color: COL.col, flatShading: true }));
    var cg = geo(new T3.CylinderGeometry(0.30, 0.34, 5.1, 8));
    var cgTop = geo(new T3.BoxGeometry(0.88, 0.30, 0.88));
    var cz, q, xs = [-5.3, 5.3];
    for (cz = 0; cz < 7; cz++) {
      var z = 1.2 - cz * 3.8;
      for (q = 0; q < 2; q++) {
        var c1 = new T3.Mesh(cg, cm);
        c1.position.set(xs[q], 2.55, z); root.add(c1);
        var c2 = new T3.Mesh(cgTop, cm);
        c2.position.set(xs[q], 5.20, z); root.add(c2);
      }
    }

    // 뒷벽 + 문 — 열두째 너머의 소실점. 도끼 고리가 여기에 실루엣으로 뜬다.
    var back = new T3.Mesh(geo(new T3.PlaneGeometry(16, 12)),
                           mat(new T3.MeshBasicMaterial({ color: COL.wallFar })));
    back.position.set(0, 4, FAR); root.add(back);
    var door = new T3.Mesh(geo(new T3.PlaneGeometry(2.6, 3.6)),
                           mat(new T3.MeshBasicMaterial({ color: COL.door })));
    door.position.set(0, 1.80, FAR + 0.12); root.add(door);
    var glow = new T3.Mesh(geo(new T3.PlaneGeometry(3.6, 4.6)),
                           mat(new T3.MeshBasicMaterial({
                             color: 0xffb066, transparent: true, opacity: 0.16,
                             depthWrite: false, blending: T3.AdditiveBlending })));
    glow.position.set(0, 1.95, FAR + 0.26); root.add(glow);

    // 횃불
    var fm = mat(new T3.MeshBasicMaterial({ color: 0xffc070 }));
    var fg = geo(new T3.SphereGeometry(0.15, 7, 5));
    var tz = [0.6, -3.2, -7.0, -10.8, -14.6, -18.4, -22.2];
    for (var ti = 0; ti < tz.length; ti++) {
      var sx = (ti % 2 === 0) ? -4.95 : 4.95;
      var fl = new T3.Mesh(fg, fm);
      fl.position.set(sx, 3.15, tz[ti]);
      fl.scale.setScalar(1 - ti * 0.08);
      root.add(fl);
      out.flames.push(fl);
      // 복도 끝까지 빛이 닿아야 열두째 도끼가 보인다
      var pl = new T3.PointLight(0xffa860, 7.6 - ti * 0.6, 14, 2);
      pl.position.set(sx * 0.72, 3.0, tz[ti]);
      root.add(pl);
      out.lights.push(pl);
    }

    // 페넬로페 — 옆의 높은 자리. 뒤에 베틀(수의를 짜던 그것).
    var pm = mat(new T3.MeshLambertMaterial({ color: COL.pene, flatShading: true }));
    var lm = mat(new T3.MeshLambertMaterial({ color: COL.loom, flatShading: true }));
    var pg = geo(new T3.SphereGeometry(0.5, 9, 7));
    var pb = geo(new T3.BoxGeometry(1, 1, 1));
    var dais = new T3.Mesh(pb, mat(new T3.MeshLambertMaterial({ color: COL.bench })));
    dais.scale.set(1.7, 0.55, 1.5); dais.position.set(-5.0, 0.27, -1.6); root.add(dais);
    var pBody = new T3.Mesh(pg, pm);
    pBody.scale.set(0.52, 0.86, 0.46); pBody.position.set(-5.0, 1.05, -1.6); root.add(pBody);
    var pHead = new T3.Mesh(pg, mat(new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true })));
    pHead.scale.set(0.25, 0.29, 0.25); pHead.position.set(-5.0, 1.62, -1.6); root.add(pHead);
    var pVeil = new T3.Mesh(pg, pm);
    pVeil.scale.set(0.30, 0.34, 0.30); pVeil.position.set(-5.0, 1.68, -1.68); root.add(pVeil);
    // 베틀 — 세로 기둥 둘 + 가로대 둘 + 걸린 천
    var lp = [[-6.15, 1.35, -2.5, 0.09, 2.7, 0.09], [-6.15, 1.35, -0.7, 0.09, 2.7, 0.09],
              [-6.15, 2.62, -1.6, 0.09, 0.09, 1.9], [-6.15, 0.15, -1.6, 0.09, 0.09, 1.9]];
    for (var li = 0; li < lp.length; li++) {
      var lb = new T3.Mesh(pb, lm);
      lb.position.set(lp[li][0], lp[li][1], lp[li][2]);
      lb.scale.set(lp[li][3], lp[li][4], lp[li][5]);
      root.add(lb);
    }
    var cloth = new T3.Mesh(pb, mat(new T3.MeshLambertMaterial({ color: 0xb9ad91 })));
    cloth.scale.set(0.03, 1.5, 1.7); cloth.position.set(-6.13, 1.95, -1.6); root.add(cloth);

    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 스테이지 본체
     ════════════════════════════════════════════════════════════════════ */
  var S = null;

  function init(root, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');
    if (S) dispose();

    var seed = opts.seed || 20260814;
    var rnd = makeRng(seed);
    var world = new T3.Group();
    (root || opts.scene).add(world);

    var crew0 = (typeof opts.crew === 'number' && isFinite(opts.crew))
                ? Math.max(0, Math.round(opts.crew)) : C.crew;

    var s = {
      root: root, world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, seed: seed, snd: makeAudio(makeRng(seed ^ 0x5bd1)),
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      hud: null,
      phase: 'ready',            // ready | run | pause | over
      gp: 'string',              // string | nock | aim | fly | hit | won
      wall: 0,                   // 실시간
      want: false,               // 지금 누르고 있나
      bend: 0,                   // 시위 얹기 게이지
      strung: false, strFail: 0,
      dt6: 0,                    // 당긴 시간
      draw: 0,                   // 화면에 보이는 당김(부드럽게 따라온다)
      ph0: rnd() * 6.28318,      // 이 화살의 떨림 위상
      lat: 0, pw: 0,
      arrowsLeft: C.arrows, crew0: crew0, crew: crew0,
      shots: [], best: 0,
      flyT: 0, fly: null, flyNext: 0,
      beat: 0,                   // 다음 상태까지의 대기
      shake: 0, cueOn: false, cuedOnce: false, gotStr: false,
      subT: 0, result: null, endAt: 0,
      disposables: { geos: [], mats: [] }
    };

    /* ── 조명 ── */
    var amb = new T3.AmbientLight(0x2a3040, 1.15);
    var key = new T3.DirectionalLight(0xffd0a0, 1.35);
    key.position.set(-4, 7, 6);
    var rim = new T3.DirectionalLight(0x86a0d0, 0.85);
    rim.position.set(3, 5, -12);
    world.add(amb, key, rim);

    /* ── 홀 ── */
    var hall = buildHall(world);
    s.disposables.geos = s.disposables.geos.concat(hall.geos);
    s.disposables.mats = s.disposables.mats.concat(hall.mats);
    s.flames = hall.flames;
    s.lights = hall.lights;

    /* ── 도끼 열두 자루 — 하나로 합쳐 인스턴싱 ── */
    var ag = axeGeo();
    s.axeGeo = ag;
    var axeMat = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    s.disposables.mats.push(axeMat);
    s.axes = new T3.InstancedMesh(ag, axeMat, C.nAxe);
    s.axes.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    s.axes.frustumCulled = false;
    world.add(s.axes);
    var dm = new T3.Object3D(), k;
    s.axeCol = new T3.Color();
    for (k = 0; k < C.nAxe; k++) {
      dm.position.set(0, 0, zOf(k));
      dm.rotation.set(0, 0, 0);
      dm.scale.setScalar(1);
      dm.updateMatrix();
      s.axes.setMatrixAt(k, dm.matrix);
      s.axes.setColorAt(k, s.axeCol.setRGB(1, 1, 1));
    }
    s.axes.instanceMatrix.needsUpdate = true;
    if (s.axes.instanceColor) s.axes.instanceColor.needsUpdate = true;
    s.axeF = [];
    for (k = 0; k < C.nAxe; k++) s.axeF.push(1);

    /* ★ 구멍 열두 개를 빛으로 한 번 더 그린다 — 앞 도끼가 뒤를 가려도
       "지나야 할 구멍"의 사슬은 끝까지 보여야 한다. 이게 이 편의 표적이다. */
    var hrG = new T3.RingGeometry(C.holeR * 0.90, C.holeR * 1.06, 30);
    var hrM = new T3.MeshBasicMaterial({
      color: 0xffd39a, transparent: true, opacity: 0.50,
      depthWrite: false, blending: T3.AdditiveBlending, side: T3.DoubleSide });
    s.holeRings = new T3.InstancedMesh(hrG, hrM, C.nAxe);
    s.holeRings.frustumCulled = false;
    s.holeRings.renderOrder = 5;
    world.add(s.holeRings);
    s.disposables.geos.push(hrG);
    s.disposables.mats.push(hrM);
    for (k = 0; k < C.nAxe; k++) {
      dm.position.set(0, C.lineY, zOf(k) + 0.07);
      dm.rotation.set(0, 0, 0);
      dm.scale.setScalar(1);
      dm.updateMatrix();
      s.holeRings.setMatrixAt(k, dm.matrix);
    }
    s.holeRings.instanceMatrix.needsUpdate = true;

    /* ── 구혼자들 — 양옆에 앉아 있다 ── */
    var cloths = [COL.suitA, COL.suitB, COL.suitC];
    s.suitors = [];
    var benchM = new T3.MeshLambertMaterial({ color: COL.bench, flatShading: true });
    var benchG = new T3.BoxGeometry(0.9, 0.42, 1.0);
    s.disposables.mats.push(benchM);
    s.disposables.geos.push(benchG);
    for (var ci = 0; ci < 3; ci++) {
      var sg = suitorGeo(cloths[ci]);
      var smat = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      s.disposables.mats.push(smat);
      var im = new T3.InstancedMesh(sg, smat, 8);
      im.instanceMatrix.setUsage(T3.DynamicDrawUsage);
      im.frustumCulled = false;
      world.add(im);
      s.suitors.push({ mesh: im, geo: sg, slots: [] });
    }
    var rows = [], si = 0;
    for (var sx2 = 0; sx2 < 2; sx2++) {
      for (var sz2 = 0; sz2 < 12; sz2++) {
        var X = (sx2 ? 1 : -1) * (3.05 + (sz2 % 2) * 1.10);
        var Z = -0.7 - sz2 * 1.62;
        rows.push({ x: X, z: Z, ph: rnd() * 6.28318, g: si % 3 });
        si++;
      }
    }
    s.suitorList = rows;
    for (var ri = 0; ri < rows.length; ri++) {
      var grp = s.suitors[rows[ri].g];
      rows[ri].slot = grp.slots.length;
      grp.slots.push(rows[ri]);
      var bench = new T3.Mesh(benchG, benchM);
      bench.position.set(rows[ri].x, 0.21, rows[ri].z + 0.10);
      world.add(bench);
    }

    /* ── 오디세우스 ── */
    s.ar = buildArcher(world);
    s.ar.group.position.set(0, 0, 1.83);
    s.disposables.geos = s.disposables.geos.concat(s.ar.geos);
    s.disposables.mats = s.disposables.mats.concat(s.ar.mats);

    /* ══ ★ 조준선 — 도끼 구멍들을 지나는 경로. 이 편의 심장. ══════════
       이전 프로토타입의 최대 실패가 "도끼도 화살 경로도 안 그려서 숫자
       술래잡기가 됐다" 였다. 그래서 선을 **실제로** 그린다. */
    var NL = 72;
    var lpos = new Float32Array(NL * 3), lcol = new Float32Array(NL * 3);
    var lg = new T3.BufferGeometry();
    lg.setAttribute('position', new T3.BufferAttribute(lpos, 3));
    lg.setAttribute('color', new T3.BufferAttribute(lcol, 3));
    var lmat = new T3.LineBasicMaterial({ vertexColors: true, transparent: true,
                                          opacity: 0.95, depthWrite: false });
    s.aimLine = new T3.Line(lg, lmat);
    s.aimLine.frustumCulled = false;
    s.aimLine.renderOrder = 8;
    world.add(s.aimLine);
    s.disposables.geos.push(lg);
    s.disposables.mats.push(lmat);
    s.NL = NL;

    /* ★ 도끼마다 찍는 점 — 지금 놓으면 그 구멍의 어디를 지나는지.
       열둘이 전부 초록이면 통과다. 먼 것부터 붉어진다. */
    var mkG = whiteColors(new T3.CircleGeometry(1, 14));
    var mkM = new T3.MeshBasicMaterial({ vertexColors: true, transparent: true,
                                         opacity: 0.95, depthWrite: false, depthTest: false });
    s.marks = new T3.InstancedMesh(mkG, mkM, C.nAxe);
    s.marks.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    s.marks.frustumCulled = false;
    s.marks.renderOrder = 9;
    world.add(s.marks);
    s.disposables.geos.push(mkG);
    s.disposables.mats.push(mkM);
    s.markCol = new T3.Color();

    /* ── 날아가는 화살 ── */
    var flG = new T3.CylinderGeometry(0.020, 0.020, 0.95, 6);
    var flM = new T3.MeshLambertMaterial({ color: COL.shaft, flatShading: true });
    s.flyArrow = new T3.Mesh(flG, flM);
    s.flyArrow.rotation.x = Math.PI / 2;
    s.flyArrow.visible = false;
    world.add(s.flyArrow);
    s.disposables.geos.push(flG);
    s.disposables.mats.push(flM);

    /* ══ ★ 조준경 — 규칙 두 개가 한 그림에 있다 ═══════════════════════
       고리   = 구멍 크기 그대로 (배율 MAG)
       십자선 = 지금 놓으면 열두째 구멍의 어디를 지나는가
                아래 = 힘 모자람 · 좌우 = 떨림
       세로막대 = 힘. 최소선이 그어져 있다.                              */
    var ret = new T3.Group();
    ret.renderOrder = 30;
    world.add(ret);
    function flat(hex, op, order) {
      var m = new T3.MeshBasicMaterial({ color: hex, transparent: true, opacity: op,
                                         depthWrite: false, depthTest: false });
      s.disposables.mats.push(m);
      return m;
    }
    var quad = new T3.PlaneGeometry(1, 1);
    var ringG = new T3.RingGeometry(0.90, 1.0, 44);
    s.disposables.geos.push(quad, ringG);
    function put(geo, m, order) {
      var o = new T3.Mesh(geo, m);
      o.renderOrder = order;
      ret.add(o);
      return o;
    }
    var R = C.retR;
    s.ret = {
      grp: ret,
      ring: put(ringG, flat(0xe2e9f2, 0.62), 31),
      ringHot: put(ringG, flat(0xffd88f, 0.0), 32),
      swL: put(quad, flat(0xff7a52, 0.42), 31),      // 떨림 폭 (좌)
      swR: put(quad, flat(0xff7a52, 0.42), 31),      // 떨림 폭 (우)
      swBar: put(quad, flat(0xff7a52, 0.16), 31),
      crossH: put(quad, flat(0xfff3d2, 0.95), 34),
      crossV: put(quad, flat(0xfff3d2, 0.95), 34),
      barBack: put(quad, flat(0x0a0806, 0.72), 31),
      barFill: put(quad, flat(0x63e79b, 0.92), 32),
      barMin: put(quad, flat(0xffd88f, 0.95), 33),
      barBand: put(quad, flat(0xffd88f, 0.22), 32),
      alpha: 0
    };
    s.ret.ring.scale.setScalar(R);
    s.ret.ringHot.scale.setScalar(R);

    /* ── HUD ── */
    var host = opts.hudHost ||
               (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host && host.style && !host.style.position && host === document.body)
      host.style.position = 'relative';
    s.hud = makeHud(host);
    s.hud.onRestart(function () { reset(); start(); });

    if (opts.bindInput !== false) bindInput(s);

    s.dummy = new T3.Object3D();
    s.v = {
      a: new T3.Vector3(), b: new T3.Vector3(), c: new T3.Vector3(),
      d: new T3.Vector3(), e: new T3.Vector3(), f: new T3.Vector3(),
      up: new T3.Vector3(0, 1, 0), tgt: new T3.Vector3(),
      camAt: new T3.Vector3(), camTo: new T3.Vector3()
    };
    S = s;
    layout(s);
    s.hud.arrows(s.arrowsLeft);
    s.hud.crew(s.crew);
    frame(s, 0);
    return api;
  }

  /* ── 스페이스 / 클릭·탭 → press(down) 하나로 ── */
  function bindInput(s) {
    var target = s.canvas || document;
    s.onKeyD = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        if (!e.repeat) press(true);
      }
    };
    s.onKeyU = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault(); press(false);
      }
    };
    s.onDown = function (e) {
      if (e.button != null && e.button !== 0) return;
      press(true);
    };
    s.onUp = function () { press(false); };
    s.onBlur = function () { press(false); };
    window.addEventListener('keydown', s.onKeyD, false);
    window.addEventListener('keyup', s.onKeyU, false);
    target.addEventListener('pointerdown', s.onDown, false);
    // 놓는 건 어디서 놓든 놓은 것이다 — 캔버스 밖으로 끌고 나가도 발사된다
    window.addEventListener('pointerup', s.onUp, false);
    window.addEventListener('pointercancel', s.onUp, false);
    window.addEventListener('blur', s.onBlur, false);
    s.inputTarget = target;
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. 카메라
     ════════════════════════════════════════════════════════════════════ */
  function layout(s) {
    var cam = s.camera;
    if (!cam) return;
    var w = s.viewW || (s.canvas ? s.canvas.clientWidth : 1100) || 1100;
    var h = s.viewH || (s.canvas ? s.canvas.clientHeight : 820) || 820;
    var aspect = w / h;
    var k = (aspect < 1) ? C.camP : C.camL;
    cam.fov = k.fov;
    cam.aspect = aspect;
    cam.near = 0.4; cam.far = 200;
    cam.updateProjectionMatrix();
    s.camK = k;
    s.camHome = new T3.Vector3(k.x, k.y, k.z);
    s.camLook = new T3.Vector3(k.fx, k.fy, k.fz);
    if (s.gp !== 'fly' && s.gp !== 'hit') {
      cam.position.copy(s.camHome);
      cam.lookAt(s.camLook);
    }
  }
  function resize(w, h) {
    if (!S) return;
    if (w) { S.viewW = w; S.viewH = h; }
    else if (S.canvas) { S.viewW = S.canvas.clientWidth; S.viewH = S.canvas.clientHeight; }
    layout(S);
    if (S.renderer && S.viewW) S.renderer.setSize(S.viewW, S.viewH, false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     10. 입력 → 규칙
     ════════════════════════════════════════════════════════════════════ */
  function press(down) {
    var s = S;
    if (!s) return 'none';
    s.snd.resume();
    if (down === undefined) down = !s.want;
    if (s.phase === 'ready') { start(); if (!down) return 'start'; }
    if (s.phase !== 'run') return 'idle';

    if (down) {
      if (s.gp === 'string') { s.want = true; return 'bend'; }
      if (s.gp === 'aim') {
        if (!s.want) { s.want = true; s.dt6 = 0; s.snd.tick(); }
        return 'draw';
      }
      /* 화살이 날아가는 동안 눌러 둔 손은 삼키지 않는다 — 다음 화살이 메겨지는
         순간 그대로 당기기 시작한다. 안 그러면 "누르고 있는데 왜 안 당겨지지"가 된다. */
      s.armed = true;
      return 'wait';
    }

    // 놓았다
    s.armed = false;
    if (!s.want) { s.want = false; return 'idle'; }
    s.want = false;
    if (s.gp === 'string') return releaseString(s);
    if (s.gp === 'aim') return loose(s, false);
    return 'wait';
  }

  /* ── 1막의 판정 ── */
  function releaseString(s) {
    var b = s.bend;
    if (b >= C.strLo && b <= C.strHi) {
      s.strung = true;
      s.gp = 'nock';
      s.beat = 1.15;
      s.snd.string();
      s.snd.gasp();
      s.hud.flash('시위가 걸렸다', '#ffd98c', '홀이 조용해졌다');
      s.hud.hint(false); s.gotStr = true;
      for (var i = 0; i < s.suitorList.length; i++) s.suitorList[i].lean = 1;
      return 'strung';
    }
    s.strFail++;
    s.bend = 0;
    s.snd.slip();
    s.snd.laugh(4 + (s.strFail > 1 ? 2 : 0));
    if (b < C.strLo) s.hud.flash('활이 펴졌다', '#9fb6cd', '덜 당겼다', true);
    else s.hud.flash('시위를 놓쳤다', '#e2b25f', '너무 당겼다', true);
    for (var j = 0; j < s.suitorList.length; j++) s.suitorList[j].laugh = 1;
    return 'slip';
  }

  /* ── 2막의 판정 — 이 한 줄이 6편의 전부다 ── */
  function loose(s, wild) {
    var t = s.dt6;
    var p = powAt(t);
    var lat = latAt(t + C.rel, s.ph0) * (wild ? C.wildK : 1);
    var r = shotOf(lat, p, wild);
    r.t = t;
    s.lat = lat; s.pw = p;
    s.shots.push(r);
    s.best = Math.max(s.best, r.win ? C.nAxe : r.axe);
    s.gp = 'fly';
    s.flyT = 0; s.flyNext = 0; s.fly = r;
    s.want = false;
    s.arrowsLeft--;                 // 화살은 쏜 순간 화살통을 떠난다
    s.hud.arrows(s.arrowsLeft);
    s.snd.twang();
    s.snd.creak(0);
    s.hud.cue(false); s.cueOn = false; s.cuedOnce = true;
    if (wild) s.hud.flash('팔이 풀렸다', '#e2705f', '너무 오래 당겼다');
    s.flyArrow.visible = true;
    s.springT = 0.001;      // 시위가 튕겨 돌아온다
    return 'loose';
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

    if (s.phase === 'run') step(s, dt);
    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  function step(s, dt) {
    if (s.subT > 0) {
      s.subT -= dt;
      if (s.subT <= 0) s.hud.sub(false);
    }
    if (s.springT > 0) s.springT = Math.max(0, s.springT - dt * 2.6);

    if (s.gp === 'string') {
      s.bend = clamp(s.bend + (s.want ? C.strRate : -C.strRate * C.strBack) * dt, 0, 1.0);
      s.snd.creak(s.bend * 0.8);
      s.snd.murmur(1 - s.bend * 0.35);
      // 다 휘도록 안 놓으면 손이 미끄러진다 (막다른 길이 없게)
      if (s.bend >= 1.0 && s.want) { s.want = false; releaseString(s); }

    } else if (s.gp === 'nock') {
      s.beat -= dt;
      s.snd.murmur(0.30);
      if (s.beat <= 0) { s.gp = 'aim'; s.dt6 = 0; s.draw = 0; if (s.armed) s.want = true; }

    } else if (s.gp === 'aim') {
      if (s.want) {
        s.dt6 += dt;
        s.snd.creak(clamp(powAt(s.dt6), 0, 1));
        s.snd.murmur(clamp(0.34 - powAt(s.dt6) * 0.34, 0, 1));
        if (s.dt6 >= C.holdMax) { loose(s, true); return; }
      } else {
        s.dt6 = Math.max(0, s.dt6 - dt * 2.4);   // 놓으면 이미 발사됐다; 여긴 대기 상태
        s.snd.creak(0);
        s.snd.murmur(0.40);
      }
      // ★ 지금 놓으면 통과하는가 — 처음 한 번만 "지금" 을 띄운다
      var lat = latAt(s.dt6 + C.rel, s.ph0);
      var ok = s.want && greenNow(lat, powAt(s.dt6));
      if (!s.cuedOnce) {
        if (ok !== s.cueOn) {
          s.cueOn = ok; s.hud.cue(ok);
          if (!ok && s.sawGreen) s.cuedOnce = true;
          if (ok) s.sawGreen = true;
        }
      }
      if (ok && !s.tickOn) { s.snd.tick(); s.tickOn = true; }
      if (!ok) s.tickOn = false;

    } else if (s.gp === 'fly') {
      s.flyT += dt;
      var d = s.flyT * C.flySpeed;
      var stopK = s.fly.win ? C.nAxe : s.fly.axe;
      // 지나간 도끼마다 소리 — 반음씩 올라간다
      while (s.flyNext < stopK && d >= distOf(s.flyNext)) {
        s.snd.pass(s.flyNext);
        s.axeHit = s.flyNext; s.axeHitT = 0.35;
        s.flyNext++;
      }
      if (d >= flyStop(s.fly)) endFlight(s);

    } else if (s.gp === 'hit') {
      s.beat -= dt;
      if (s.beat <= 0) nextArrow(s);

    } else if (s.gp === 'won') {
      s.beat -= dt;
      if (s.beat > 0 && s.beat < 2.30 && !s.rose) {
        s.rose = true;
        s.snd.rise();
        for (var i = 0; i < s.suitorList.length; i++) s.suitorList[i].stand = 1;
      }
      if (s.beat <= 0 && !s.result) finish(s, true);
    }
    if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 2.6);
  }

  /* 화살이 멈추는 거리 — 통과면 문턱까지, 걸리면 그 도끼에서 */
  function flyStop(r) { return r.win ? (D12 + 2.2) : distOf(r.axe); }

  function endFlight(s) {
    var r = s.fly;
    if (r.win) {
      s.gp = 'won';
      s.beat = 3.8; s.rose = false;
      s.snd.ring();
      s.hud.flash('열두 자루를 지났다', '#ffd98c');
      s.ar.mat.rag.color.setHex(COL.ragOff);      // 누더기를 벗는다
    } else {
      s.gp = 'hit';
      s.beat = C.hitHold;
      s.shake = 1;
      s.snd.thunk();
      s.axeHit = r.axe; s.axeHitT = 1.0;
      /* ★ 왜 못 지났는지 — 몇째 도끼에서, 어느 쪽으로 */
      var why = r.wild ? '팔이 풀렸다'
              : (r.why === 'power' ? '힘이 모자랐다'
                                   : (r.side === 'L' ? '왼쪽으로 떨렸다' : '오른쪽으로 떨렸다'));
      s.hud.flash(ORD[r.axe] + ' 도끼에 걸렸다', '#e2705f', why);
      for (var i = 0; i < s.suitorList.length; i++) s.suitorList[i].laugh = 1;
      s.snd.laugh(5);
    }
  }

  function nextArrow(s) {
    if (s.arrowsLeft <= 0) { finish(s, false); return; }
    s.gp = 'aim';
    s.dt6 = 0; s.draw = 0;
    if (s.armed) s.want = true;     // 누르고 있던 손은 그대로 이어진다
    s.ph0 = s.rnd() * 6.28318;      // 다음 화살은 떨림의 결이 다르다
    s.flyArrow.visible = false;
    s.tickOn = false;
  }

  function finish(s, win) {
    s.phase = 'over';
    s.flyArrow.visible = false;
    s.snd.creak(0); s.snd.murmur(win ? 0.10 : 0.55);
    var res = {
      win: !!win,
      crew: s.crew, survived: s.crew, lost: 0,
      arrows: s.shots.length,
      best: s.best,
      axe: win ? C.nAxe : (s.shots.length ? s.shots[s.shots.length - 1].axe : 0),
      shots: s.shots.slice(),
      strFail: s.strFail
    };
    s.result = res;
    s.hud.hint(false);
    var handled = false;
    if (typeof api.onEnd === 'function') {
      try { api.onEnd(res); handled = true; } catch (e) { handled = false; }
    }
    if (!handled || s.opts.endPanel === true) s.hud.end(res);
  }

  /* ══════════════════════════════════════════════════════════════════════
     12. 한 프레임 그리기
     ════════════════════════════════════════════════════════════════════ */
  function segment(mesh, a, b) {
    var V = S.v;
    var mid = V.e.addVectors(a, b).multiplyScalar(0.5);
    var d = V.f.subVectors(b, a);
    var len = Math.max(0.01, d.length());
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(V.up, d.normalize());
    mesh.scale.y = len;
  }
  /* 두 마디 팔 — 어깨 S 에서 손 H 까지 */
  function ik(arm, H, hand) {
    var V = S.v;
    var d = V.a.subVectors(H, arm.S);
    var dist = clamp(d.length(), 0.05, arm.L1 + arm.L2 - 0.01);
    var a = (arm.L1 * arm.L1 - arm.L2 * arm.L2 + dist * dist) / (2 * dist);
    var hgt = Math.sqrt(Math.max(0, arm.L1 * arm.L1 - a * a));
    var dir = V.b.copy(d).normalize();
    var perp = V.c.copy(arm.pole).addScaledVector(dir, -arm.pole.dot(dir));
    if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0);
    perp.normalize();
    var E = V.d.copy(arm.S).addScaledVector(dir, a).addScaledVector(perp, hgt);
    segment(arm.up, arm.S, E);
    segment(arm.fo, E, H);
    arm.el.position.copy(E);
    if (hand) hand.position.copy(H);
  }

  function frame(s, dt) {
    dt = dt || 0;
    var i, k;
    var A = s.ar, V = s.v, dmy = s.dummy;

    /* ── 활 · 시위 · 팔 (archer local: z 가 −쪽이 앞) ─────────────────
       archer.group 은 z=2.62 에 있으므로 로컬 bowZ = C.bowZ − 2.62 = −1.42 */
    var bz = C.bowZ - A.group.position.z;
    var by = C.lineY;
    var pull;
    if (s.gp === 'string') pull = s.bend * 0.30;            // 활을 무릎에 대고 휜다
    else {
      var want = (s.gp === 'aim') ? powAt(s.dt6) : 0;
      if (s.springT > 0) want = 0;
      s.draw = lerp(s.draw, want, 1 - Math.pow(0.0015, Math.max(dt, 0.0001)));
      pull = 0.10 + s.draw * 0.58;
    }
    var bendAmt = (s.gp === 'string') ? s.bend : clamp(pull / 0.68, 0, 1);

    // 활 곡선: u ∈ [−1,1] → (y, z)
    var NB = A.bowSeg.length, HB = 0.72;
    var prevY = 0, prevZ = 0;
    for (i = 0; i <= NB; i++) {
      var u = -1 + 2 * i / NB;
      var yy = by + u * HB;
      var zz = bz - (1 - u * u) * (0.34 - 0.40 * bendAmt) - Math.pow(Math.abs(u), 6) * 0.22;
      if (i > 0) {
        var m = A.bowSeg[i - 1];
        V.a.set(0, prevY, prevZ); V.b.set(0, yy, zz);
        segment(m, V.a, V.b);
      }
      prevY = yy; prevZ = zz;
    }
    A.grip.position.set(0, by, bz - (0.34 - 0.40 * bendAmt));
    A.grip.rotation.set(0, 0, 0);

    // 시위 — 두 끝(활 끝)에서 노크까지
    var tipY = by + HB, tipZ = bz - Math.pow(1, 6) * 0.22;
    var nockZ = bz + pull;
    V.a.set(0, tipY, tipZ); V.b.set(0, by, nockZ);
    segment(A.str1, V.a, V.b);
    V.a.set(0, by - HB, tipZ);
    segment(A.str2, V.a, V.b);

    // 화살 — 활 위에 얹혀 있다
    var showArrow = (s.gp === 'aim' || s.gp === 'nock');
    A.arrow.visible = showArrow && s.springT <= 0;
    A.arrow.position.set(0, by + 0.035, nockZ - 0.46);

    // 두 팔
    V.tgt.set(0, by, bz - (0.34 - 0.40 * bendAmt) - 0.05);
    ik(A.armL, V.tgt, A.handL);
    if (s.gp === 'string') V.tgt.set(-0.10, by - 0.34 + s.bend * 0.34, bz + 0.34 + s.bend * 0.24);
    else V.tgt.set(0, by + 0.045, nockZ + 0.05);
    ik(A.armR, V.tgt, A.handR);
    // 당길수록 몸이 뒤로 젖혀진다
    A.group.rotation.x = -0.055 * (s.gp === 'aim' ? s.draw : s.bend * 0.5);
    // 화살통 — 남은 화살이 실제로 줄어든다
    for (i = 0; i < A.qArrows.length; i++)
      A.qArrows[i].visible = (i < s.arrowsLeft - (s.gp === 'aim' || s.gp === 'nock' ? 1 : 0));

    /* ── 도끼 — 걸린 자리는 붉게 번쩍인다.
       ★ 화살을 따라가는 동안, 카메라를 스쳐 지나갈 만큼 가까워진 도끼는 지운다.
         안 그러면 고리 하나가 화면을 통째로 삼켜 터널이 사라진다. */
    if (s.axeHitT > 0) s.axeHitT = Math.max(0, s.axeHitT - dt);
    var camZ = s.camera ? s.camera.position.z : 99;
    var near = (s.camFly || 0) > 0.02;
    for (k = 0; k < C.nAxe; k++) {
      var hot = (s.axeHit === k) ? s.axeHitT : 0;
      var passed = (s.gp === 'fly' || s.gp === 'won' || s.gp === 'hit') &&
                   s.fly && k < s.flyNext ? 1 : 0;
      var g = 1 + passed * 0.25;
      s.axeCol.setRGB(1 + hot * 1.9, g - hot * 0.65, g - hot * 0.75);
      s.axes.setColorAt(k, s.axeCol);
      var f = 1;
      if (near) f = smooth(clamp((camZ - zOf(k) - 0.9) / 1.5, 0, 1));
      if (f !== s.axeF[k]) {
        s.axeF[k] = f;
        dmy.position.set(0, 0, zOf(k));
        dmy.rotation.set(0, 0, 0);
        dmy.scale.setScalar(Math.max(0.0001, f));
        dmy.updateMatrix();
        s.axes.setMatrixAt(k, dmy.matrix);
        dmy.position.set(0, C.lineY, zOf(k) + 0.07);
        dmy.scale.setScalar(Math.max(0.0001, f));
        dmy.updateMatrix();
        s.holeRings.setMatrixAt(k, dmy.matrix);
        s.axeDirty = true;
      }
    }
    if (s.axes.instanceColor) s.axes.instanceColor.needsUpdate = true;
    if (s.axeDirty) {
      s.axes.instanceMatrix.needsUpdate = true;
      s.holeRings.instanceMatrix.needsUpdate = true;
      s.axeDirty = false;
    }

    /* ── 구혼자들 — 웃고, 몸을 기울이고, 마지막엔 일어선다 ── */
    for (i = 0; i < s.suitors.length; i++) s.suitors[i].n = 0;
    for (i = 0; i < s.suitorList.length; i++) {
      var m2 = s.suitorList[i];
      if (m2.laugh > 0) m2.laugh = Math.max(0, m2.laugh - dt * 1.6);
      if (m2.lean == null) m2.lean = 0;
      if (m2.stand == null) m2.stand = 0;
      if (m2.stand > 0) m2.stand = Math.min(1, m2.stand + dt * 1.4);
      var bob = Math.sin(s.wall * 1.7 + m2.ph) * 0.014;
      var lg2 = m2.laugh > 0 ? Math.sin(s.wall * 21 + m2.ph) * 0.055 * m2.laugh : 0;
      var st = m2.stand > 0 ? smooth(m2.stand) : 0;
      // 일어설 때는 걸상에서 한 발 나선다 — 그냥 띄우면 공중에 뜬 것처럼 보인다
      dmy.position.set(m2.x + st * (m2.x > 0 ? -0.10 : 0.10),
                       0.42 + bob + lg2 + st * 0.30, m2.z + st * 0.42);
      dmy.rotation.set(-0.10 * m2.lean - lg2 * 1.8 - st * 0.10,
                       (m2.x > 0 ? -0.5 : 0.5) * (1 - st * 0.55), 0);
      dmy.scale.setScalar(1);
      dmy.updateMatrix();
      var grp2 = s.suitors[m2.g];
      grp2.mesh.setMatrixAt(m2.slot, dmy.matrix);
    }
    for (i = 0; i < s.suitors.length; i++) s.suitors[i].mesh.instanceMatrix.needsUpdate = true;

    /* ══ ★ 조준선 + 도끼마다의 점 ═══════════════════════════════════ */
    var aiming = (s.phase === 'run' && s.gp === 'aim');
    s.aimLine.visible = aiming;
    s.marks.visible = aiming;
    if (aiming) {
      var lat = latAt(s.dt6 + C.rel, s.ph0);
      var pw = powAt(s.dt6);
      var pass = shotOf(lat, pw);
      var pos = s.aimLine.geometry.attributes.position.array;
      var col = s.aimLine.geometry.attributes.color.array;
      var farD = D12 + 2.4;
      var down = false;
      for (i = 0; i < s.NL; i++) {
        var f = i / (s.NL - 1);
        var d = f * farD;
        var x = lat * d / D12;
        var y = C.lineY - sagAt(Math.max(0.001, d), pw);
        /* 땅에 닿으면 거기서 끊는다 — 힘이 모자라면 화살이 **어디에 떨어지는지**가
           바닥에 찍힌 선 끝으로 보인다. 바닥 아래로 계속 그리면 그 정보가 사라진다. */
        if (y < 0.04) { y = 0.04; down = true; }
        if (down) {
          pos[i * 3] = pos[(i - 1) * 3];
          pos[i * 3 + 1] = pos[(i - 1) * 3 + 1];
          pos[i * 3 + 2] = pos[(i - 1) * 3 + 2];
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
          continue;
        }
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = C.bowZ - d;
        // 멀수록 흐려진다 — 홀이 어둡다. 정답을 읽어 내는 게 아니라 가운데를 맞추는 게임이다.
        var fade = clamp(1 - f * 0.88, 0.10, 1);
        var hot = pass.win ? 1 : 0;
        col[i * 3] = (hot ? 1.0 : 0.98) * fade;
        col[i * 3 + 1] = (hot ? 0.90 : 0.72) * fade;
        col[i * 3 + 2] = (hot ? 0.52 : 0.42) * fade;
      }
      s.aimLine.geometry.attributes.position.needsUpdate = true;
      s.aimLine.geometry.attributes.color.needsUpdate = true;

      for (k = 0; k < C.nAxe; k++) {
        var o = offAt(k, lat, pw);
        var er = Math.sqrt(o.x * o.x + o.y * o.y);
        var ok2 = er <= TOL;
        var sc = C.markR * (o.d / distOf(0));
        /* 크게 빗나가도 점은 구멍 곁에 붙여 둔다 — 화면 밖으로 날아가 버리면
           "몇 번째부터 틀어졌는지" 라는 정보 자체가 사라진다. 색은 진실 그대로. */
        var lim = TOL * 3.0;
        dmy.position.set(clamp(o.x, -lim, lim),
                         C.lineY + clamp(o.y, -lim, lim), zOf(k) + 0.10);
        dmy.rotation.set(0, 0, 0);
        dmy.scale.set(sc, sc, 1);
        dmy.updateMatrix();
        s.marks.setMatrixAt(k, dmy.matrix);
        s.markCol.setRGB(ok2 ? 0.28 : 1.0, ok2 ? 1.0 : 0.20, ok2 ? 0.46 : 0.14);
        s.marks.setColorAt(k, s.markCol);
      }
      s.marks.instanceMatrix.needsUpdate = true;
      if (s.marks.instanceColor) s.marks.instanceColor.needsUpdate = true;
    }

    /* ══ ★ 조준경 ═══════════════════════════════════════════════════ */
    updateReticle(s, dt);

    /* ── 날아가는 화살 ── */
    if (s.gp === 'fly' && s.fly) {
      var dd = Math.min(s.flyT * C.flySpeed, flyStop(s.fly));
      s.flyArrow.position.set(s.fly.lat * dd / D12,
                              C.lineY - sagAt(Math.max(0.001, dd), s.fly.p),
                              C.bowZ - dd);
      s.flyArrow.visible = true;
    } else if (s.gp !== 'hit') {
      s.flyArrow.visible = false;
    }

    /* ── 카메라 ── */
    updateCamera(s, dt);

    /* ── 횃불이 흔들린다 ── */
    for (i = 0; i < s.flames.length; i++) {
      var fs = 1 - i * 0.10 + Math.sin(s.wall * 7.3 + i * 2.1) * 0.07;
      s.flames[i].scale.setScalar(fs);
    }
    for (i = 0; i < s.lights.length; i++)
      s.lights[i].intensity = (7.6 - i * 0.6) * (1 + Math.sin(s.wall * 5.1 + i) * 0.09);
  }

  /* ── 조준경: 규칙 두 개가 한 그림에 ────────────────────────────────
     고리   = 구멍 크기 그대로
     십자선 = 지금 놓으면 열두째 구멍의 어디를 지나는가
              (아래 = 힘 모자람 · 좌우 = 떨림)
     주황 세로선 두 개 = 떨림의 폭. 고리보다 넓어지는 순간이 눈에 보인다.
     왼쪽 막대 = 힘. 가로선이 열두째까지 닿는 최소선.                   */
  function updateReticle(s, dt) {
    var R2 = s.ret, cam = s.camera;
    var show = s.phase === 'run' && (s.gp === 'aim' || s.gp === 'string' || s.gp === 'nock');
    R2.alpha = clamp(R2.alpha + (show ? dt * 6 : -dt * 7), 0, 1);
    R2.grp.visible = R2.alpha > 0.015;
    if (!R2.grp.visible || !cam) return;

    // 열두째 도끼의 구멍 방향에 맞춰 카메라 앞에 띄운다
    var V = s.v;
    var W = V.camAt.set(0, C.lineY, zOf(C.nAxe - 1));
    var dir = V.camTo.subVectors(W, cam.position).normalize();
    R2.grp.position.copy(cam.position).addScaledVector(dir, C.retDist);
    R2.grp.quaternion.copy(cam.quaternion);

    var a = R2.alpha, R = C.retR;
    var aim = (s.gp === 'aim');
    var lat = aim ? latAt(s.dt6 + C.rel, s.ph0) : 0;
    var pw = aim ? powAt(s.dt6) : 0;
    var amp = aim ? ampAt(s.dt6 + C.rel) : 0;
    var pass = aim ? shotOf(lat, pw).win : false;

    // 고리 — 구멍 크기 그대로. 이 안에 십자선이 들어오면 지나간다.
    R2.ring.visible = aim;
    R2.ringHot.visible = aim && pass;
    R2.ring.material.opacity = 0.60 * a;
    R2.ringHot.material.opacity = pass ? (0.80 * a) : 0;
    R2.ringHot.scale.setScalar(R * (1.09 + 0.05 * Math.sin(s.wall * 14)));

    // 떨림 폭 — 고리보다 넓어지는 순간이 눈에 보인다
    var sw = squash(amp * MAG, R);
    R2.swL.visible = R2.swR.visible = R2.swBar.visible = aim;
    R2.swL.position.set(-sw, 0, 0); R2.swL.scale.set(0.016, R * 0.80, 1);
    R2.swR.position.set(sw, 0, 0); R2.swR.scale.set(0.016, R * 0.80, 1);
    R2.swBar.position.set(0, 0, 0); R2.swBar.scale.set(sw * 2, 0.009, 1);
    var over = amp > TOL ? 1 : 0;
    R2.swL.material.opacity = R2.swR.material.opacity = (0.30 + over * 0.38) * a;
    R2.swBar.material.opacity = (0.10 + over * 0.14) * a;

    // 십자선 — 지금 놓으면 열두째 구멍의 여기를 지난다
    var cx = squash(lat * MAG, R);
    var cyRaw = -sagAt(D12, Math.max(0.06, pw)) * MAG;
    var cy = squash(cyRaw, R);
    var clamped = cyRaw < -R * 2.0;
    R2.crossH.visible = R2.crossV.visible = aim;
    R2.crossH.position.set(cx, cy, 0); R2.crossH.scale.set(R * 0.44, 0.015, 1);
    R2.crossV.position.set(cx, cy, 0); R2.crossV.scale.set(0.015, R * 0.44, 1);
    var cc = pass ? 0x9dffc0 : (clamped ? 0x8fa6bd : 0xfff3d2);
    R2.crossH.material.color.setHex(cc);
    R2.crossV.material.color.setHex(cc);
    R2.crossH.material.opacity = R2.crossV.material.opacity = (clamped ? 0.62 : 0.96) * a;

    // 힘 막대 — 최소선이 그어져 있다
    var bx = -R * 2.30, bh = R * 2.3;
    var lvl = aim ? pw : s.bend;
    R2.barBack.position.set(bx, 0, 0);
    R2.barBack.scale.set(0.070, bh, 1);
    R2.barBack.material.opacity = 0.74 * a;
    var fh = bh * clamp(lvl, 0, 1);
    R2.barFill.visible = fh > 0.004;
    R2.barFill.position.set(bx, -bh * 0.5 + fh * 0.5, 0);
    R2.barFill.scale.set(0.044, fh, 1);
    var enough = aim ? (pw >= MINP) : (s.bend >= C.strLo && s.bend <= C.strHi);
    R2.barFill.material.color.setHex(enough ? 0x63e79b : 0x5c7fa8);
    R2.barFill.material.opacity = 0.94 * a;
    if (aim) {
      // 최소선
      R2.barMin.visible = true;
      R2.barMin.position.set(bx, -bh * 0.5 + bh * MINP, 0);
      R2.barMin.scale.set(0.135, 0.018, 1);
      R2.barMin.material.opacity = 0.95 * a;
      R2.barBand.visible = false;
    } else {
      // 시위를 걸 수 있는 띠
      R2.barMin.visible = false;
      R2.barBand.visible = true;
      R2.barBand.position.set(bx, -bh * 0.5 + bh * (C.strLo + C.strHi) * 0.5, 0);
      R2.barBand.scale.set(0.115, bh * (C.strHi - C.strLo), 1);
      R2.barBand.material.opacity = 0.60 * a;
    }
  }

  /* ── 카메라: 평소엔 어깨 뒤, 쏘면 화살을 따라간다.
        ★ 이 편의 절정이다. 도끼를 하나씩 지날 때마다 소리가 나고, 열두 번째를
          지나면 정적. 그래서 화살 뒤 4.6 유닛에 붙어 복도가 계속 보이게 한다.
          (너무 붙였더니 고리 하나가 화면을 다 덮어 무슨 일인지 알 수 없었다) */
  function updateCamera(s, dt) {
    var cam = s.camera;
    if (!cam || !s.camHome) return;
    var V = s.v;
    var flying = (s.gp === 'fly') ||
                 (s.gp === 'hit' && s.beat > C.hitHold - 0.70) ||
                 (s.gp === 'won' && s.beat > 2.10);
    s.camFly = clamp((s.camFly || 0) + (flying ? dt * 4.2 : -dt * 2.4), 0, 1);
    if (s.camFly <= 0.002) {
      cam.position.copy(s.camHome);
      cam.lookAt(s.camLook);
    } else {
      var d = s.fly ? Math.min(s.flyT * C.flySpeed, flyStop(s.fly)) : 0;
      /* 카메라는 열두째 도끼 앞에서 멈춘다 — 화살만 고리를 지나 문 쪽으로
         멀어진다. 계속 따라가면 뒷벽밖에 안 남아 절정이 민무늬가 된다. */
      d = Math.min(d, D12 - 1.2);
      var ax = (s.fly ? s.fly.lat : 0) * d / D12;
      var ay = C.lineY - sagAt(Math.max(0.001, d), s.fly ? s.fly.p : 1);
      var az = C.bowZ - d;
      /* ★ 화살 바로 뒤, **거의 축 위**(구멍 반지름 안쪽)에 붙는다. 그래야 남은
         고리들이 겹겹이 포개져 터널이 되고, 빗나가는 화살은 그 터널이 옆으로
         밀려나는 것으로 보인다 — 왜 걸렸는지가 말이 아니라 그림으로 온다. */
      var blend = smooth(s.camFly);
      V.a.set(ax + 0.10, ay + 0.15, az + 4.4);
      cam.position.lerpVectors(s.camHome, V.a, blend);
      V.b.set(ax, ay, az - 10.0);
      V.c.copy(s.camLook).lerp(V.b, blend);
      cam.lookAt(V.c);
    }
    if (s.shake > 0) {
      var m = s.shake * s.shake * 0.26;
      cam.position.x += (s.rnd() * 2 - 1) * m;
      cam.position.y += (s.rnd() * 2 - 1) * m;
    }
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
    S.hud.hint(!S.gotStr);
    if (!S.subShown) {
      S.subShown = true;
      S.hud.sub(true);
      S.subT = C.subSec;
    }
  }
  function pause() { if (S && S.phase === 'run') { S.phase = 'pause'; S.want = false; } }

  function reset() {
    var s = S;
    if (!s) return;
    s.phase = 'ready'; s.gp = 'string';
    s.want = false; s.bend = 0; s.strung = false; s.strFail = 0;
    s.dt6 = 0; s.draw = 0; s.springT = 0;
    s.ph0 = s.rnd() * 6.28318;
    s.arrowsLeft = C.arrows; s.crew = s.crew0;
    s.shots.length = 0; s.best = 0;
    s.flyT = 0; s.fly = null; s.flyNext = 0; s.beat = 0;
    s.shake = 0; s.camFly = 0; s.armed = false; s.cueOn = false; s.cuedOnce = false; s.sawGreen = false;
    s.tickOn = false; s.result = null; s.rose = false;
    s.axeHit = -1; s.axeHitT = 0;
    s.ar.mat.rag.color.setHex(COL.rag);
    s.flyArrow.visible = false;
    var i;
    for (i = 0; i < s.suitorList.length; i++) {
      s.suitorList[i].laugh = 0; s.suitorList[i].lean = 0; s.suitorList[i].stand = 0;
    }
    s.snd.creak(0); s.snd.murmur(0.55);
    s.hud.end(null); s.hud.cue(false); s.hud.flash(''); s.hud.hint(false);
    s.hud.arrows(s.arrowsLeft); s.hud.crew(s.crew);
    if (s.camera && s.camHome) { s.camera.position.copy(s.camHome); s.camera.lookAt(s.camLook); }
    frame(s, 0);
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try { if (s.onKeyD) window.removeEventListener('keydown', s.onKeyD, false); } catch (e) { }
    try { if (s.onKeyU) window.removeEventListener('keyup', s.onKeyU, false); } catch (e) { }
    try { if (s.onDown && s.inputTarget) s.inputTarget.removeEventListener('pointerdown', s.onDown, false); } catch (e) { }
    try { if (s.onUp) window.removeEventListener('pointerup', s.onUp, false); } catch (e) { }
    try { if (s.onUp) window.removeEventListener('pointercancel', s.onUp, false); } catch (e) { }
    try { if (s.onBlur) window.removeEventListener('blur', s.onBlur, false); } catch (e) { }
    try { if (s.raf) cancelAnimationFrame(s.raf); } catch (e) { }
    try { if (s.onWinResize) window.removeEventListener('resize', s.onWinResize, false); } catch (e) { }
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
     14. 단독 실행 — 렌더러·씬·카메라까지 이 파일이 세운다
     ════════════════════════════════════════════════════════════════════ */
  function mount(rootEl, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');

    /* THREE 루트를 주면 1편처럼 씬 안에 붙기만 한다 */
    if (rootEl && rootEl.isObject3D) return init(rootEl, ui, opts);

    var host = null, canvas = null;
    if (rootEl && rootEl.tagName === 'CANVAS') { canvas = rootEl; host = rootEl.parentNode; }
    else if (rootEl && rootEl.appendChild) {
      host = rootEl;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
      host.appendChild(canvas);
    } else throw new Error('mount: 캔버스나 DOM 요소가 필요합니다.');

    var renderer = new T3.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 1100, canvas.clientHeight || 820, false);
    renderer.setClearColor(COL.bg, 1);
    var scene = new T3.Scene();
    scene.background = new T3.Color(COL.bg);
    scene.fog = new T3.Fog(COL.bg, 24, 62);
    var camera = new T3.PerspectiveCamera(46, 1, 0.4, 200);
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
    update(0, false);          // 첫 프레임은 루프를 기다리지 않는다 (manual 모드 포함)
    return st;
  }

  /* ══════════════════════════════════════════════════════════════════════
     15. 디버그 스냅샷 · 하네스용
     ════════════════════════════════════════════════════════════════════ */
  function state() {
    var s = S;
    if (!s) return { ready: false };
    var lat = latAt(s.dt6 + C.rel, s.ph0);
    var pw = powAt(s.dt6);
    var sh = shotOf(lat, pw);
    var green = 0, k;
    for (k = 0; k < C.nAxe; k++) {
      var o = offAt(k, lat, pw);
      if (Math.sqrt(o.x * o.x + o.y * o.y) <= TOL) green++;
    }
    return {
      ready: true, phase: s.phase, gp: s.gp,
      want: s.want,
      bend: +s.bend.toFixed(3),
      t: +s.dt6.toFixed(3), p: +pw.toFixed(3),
      lat: +lat.toFixed(4), amp: +ampAt(s.dt6 + C.rel).toFixed(4),
      sag12: +sagAt(D12, Math.max(0.06, pw)).toFixed(4),
      tol: +TOL.toFixed(4),
      pass: sh.win, wouldAxe: sh.win ? C.nAxe : sh.axe, why: sh.why,
      green: green,
      arrows: s.arrowsLeft, best: s.best, shots: s.shots.length,
      strFail: s.strFail, crew: s.crew,
      flyT: +s.flyT.toFixed(2), flyNext: s.flyNext,
      result: s.result || null
    };
  }

  /* 원하는 만큼 조용히 민다 (스크린샷용). hold 는 boolean 또는 st=>boolean */
  function skipTo(sec, hold) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var dt = 1 / 60, n = Math.round((sec || 0) / dt), i;
    for (i = 0; i < n; i++) {
      var want = typeof hold === 'function' ? !!hold(state()) : !!hold;
      if (want !== s.want) press(want);
      update(dt, true);
    }
    update(0, false);
    return state();
  }

  /* 조건이 참이 될 때까지 굴린 뒤 그 자리에서 멈춘다 (연출 확인용) */
  function until(cond, maxSec, hold) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var dt = 1 / 60, n = Math.round((maxSec || 20) / dt), i, g;
    for (i = 0; i < n; i++) {
      g = state();
      if (cond(g)) break;
      var want = typeof hold === 'function' ? !!hold(g) : !!hold;
      if (want !== s.want) press(want);
      update(dt, true);
    }
    update(0, false);
    return state();
  }

  /* 자동 플레이 — simulate() 와 같은 봇을 실제 입력 경로로 돌린다.
     둘의 결과가 어긋나면 화면과 규칙이 어긋났다는 뜻이다. */
  function auto(o) {
    var s = S;
    if (!s) return null;
    o = o || {};
    var sigma = (o.sigma == null) ? 0.055 : o.sigma;
    var rnd = makeRng(o.seed || 991);
    reset(); start();
    var dt = 1 / 60, n = Math.round((o.maxSec || 120) / dt), i;
    var target = -1, plan = -1;
    for (i = 0; i < n && s.phase === 'run'; i++) {
      var want = false;
      if (s.gp === 'string') want = s.bend < (C.strLo + C.strHi) * 0.5;
      else if (s.gp === 'aim') {
        if (plan !== s.shots.length) {          // 이 화살의 목표 시각을 정한다
          plan = s.shots.length;
          target = planShot(s.ph0, sigma, rnd);
        }
        want = s.dt6 < target;
      }
      if (want !== s.want) press(want);
      update(dt, true);
    }
    if (s.want) press(false);
    update(0, false);
    var st = state();
    st.result = s.result;
    return st;
  }
  function planShot(ph0, sigma, rnd) {
    var t0 = MINP * C.drawFull, dt = 1 / 500, t, a = -1, b = -1;
    for (t = t0; t <= C.holdMax; t += dt) {
      var ok = greenNow(latAt(t + C.rel, ph0), powAt(t));
      if (ok && a < 0) a = t;
      if (!ok && a >= 0) {
        if (t - a >= 0.045) { b = t; break; }   // 눈에 보일 만큼 넓은 창만 노린다
        a = -1;
      }
    }
    if (a < 0) return C.holdMax - 0.1;
    if (b < 0) b = Math.min(C.holdMax, a + 0.10);
    var jit = (rnd() + rnd() + rnd() - 1.5) * 2 * sigma;
    return clamp((a + b) * 0.5 + jit, 0.05, C.holdMax - 0.01);
  }

  /* 이 판에 걸린 부하 수를 갈아 끼운다 — 이전 편에서 데려온 수가 이어져 온다 */
  function setCrew(n) {
    var s = S;
    if (!s) return null;
    if (typeof n === 'number' && isFinite(n)) {
      s.crew0 = Math.max(0, Math.round(n));
      s.opts.crew = s.crew0;
      if (s.phase !== 'over') { s.crew = s.crew0; s.hud.crew(s.crew0); }
    }
    return s.crew0;
  }

  /* ── 공개 API ── */
  var api = {
    init: init,
    mount: mount,
    start: start,
    pause: pause,
    reset: reset,
    press: press,
    update: update,
    resize: resize,
    dispose: dispose,
    state: state,
    skipTo: skipTo,
    until: until,
    auto: auto,
    simulate: simulate,
    setCrew: setCrew,
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
