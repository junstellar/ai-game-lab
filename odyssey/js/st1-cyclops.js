/* ============================================================================
   오디세이아 / ODYSSEY — st1-cyclops.js  →  OD.St1
   1편 「키클롭스의 동굴」 — 한 버튼 타이밍 액션 (STAGE1.md 재설계안)
   ----------------------------------------------------------------------------
   이 파일 하나가 1편의 전부를 소유한다: 장면 · 게임루프 · 입력 · 규칙 · 피드백.

   OD.St1.init(root, ui, opts) -> stage      root = THREE.Object3D, ui = OD.UI(선택)
   OD.St1.start() / pause() / reset() / dispose()
   OD.St1.press()                             스페이스·클릭·탭이 전부 이걸 부른다
   OD.St1.update(dt)
   OD.St1.onEnd = fn({escaped, caught, trapped, total, perfect})

   보조:
   OD.St1.mount(canvas, opts) -> stage        렌더러·씬·카메라까지 직접 세운다(단독 실행)
   OD.St1.state()                             디버그 스냅샷
   OD.St1.simulate({policy, jitter, seed})    수치 검증용 순수 시뮬레이션

   ── 규칙 (STAGE1.md §2 · §6) ─────────────────────────────────────────────
   양 18마리(큰5·중7·작6)가 약 75초에 걸쳐 입구를 지난다. 양이 게이트를 덮고 있는
   동안에만 누를 수 있고, 양 하나에 부하 하나다(누른 순간 그 양은 소모된다).
   거인의 손은 게이트 위를 **일정한 속도로** 왕복한다(삼각파, 주기 2.2초 → 마지막
   1/3에서 1.9초). 누르면 부하가 0.20초 뒤 양의 배에 닿고, 그 순간
   |손 − 게이트| ≥ r(크기) 이면 빠져나가고 아니면 붙잡힌다.

     r = A·(1 − 2·window/2.2)  →  큰 0.90초 · 중간 0.55초 · 작은 0.30초
     손 그림자 반지름 = 지금 양의 r. 규칙을 글이 아니라 그림자 크기로 가르친다.

   부하는 6명, 큰 양은 5마리다 — 안전한 것만 노리면 한 명은 반드시 갇힌다.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St1 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — STAGE1.md §2/§6 을 그대로 옮긴 곳. 여기만 고치면 밸런스가 바뀐다.
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    crew: 6,

    gate: 5.0,            // 입구 판정선 (world x)
    sweepA: 2.35,         // 손 왕복 진폭 — 게이트 ± 2.35
    periodBase: 2.2,      // 손 왕복 주기
    periodFast: 1.9,      // 마지막 1/3
    fastFrom: 12,         // 12번째 양(0-based)부터 가속

    lead: 0.20,           // 누른 뒤 배에 닿기까지 — 반응이 아니라 '판단'이 되게
    cooldown: 0.15,       // 연타 방지
    nearMiss: 0.15,       // 이 안쪽으로 놓쳤으면 "아슬아슬"
    freeze: 0.25,         // 붙잡혔을 때 정지
    speed: 0.58,          // 양 이동 속도 (u/s)
    startLead: 1.4,       // 첫 양이 게이트에 닿기까지

    // 크기 3단계 — 크기가 곧 규칙이다
    cls: {
      big: { win: 0.90, scale: 1.30, dwell: 5.0 },
      mid: { win: 0.55, scale: 1.01, dwell: 4.2 },
      sml: { win: 0.30, scale: 0.78, dwell: 3.4 }
    },
    // 큰5 · 중7 · 작6 = 18마리. 큰 양은 흩어 놓는다(1,4,8,11,15).
    order: ['mid', 'big', 'sml', 'mid', 'big', 'sml', 'mid', 'sml', 'big',
            'mid', 'sml', 'big', 'mid', 'sml', 'mid', 'big', 'sml', 'mid'],

    unitLen: 1.55,        // 배율 1 인 양의 몸 길이
    grabPad: 0.14,        // 몸이 게이트를 덮는 판정 여유

    hideX: 2.20,          // 부하들이 웅크린 자리 (게이트 왼쪽 앞, 바위 그늘)
    hideZ: 2.70,
    handY: 2.62,          // 손이 훑는 높이 (양 등 위로 확실히)
    handZ: 1.10,
    sheepZ: 0.90,
    exitX: 16.2,          // 여기를 지나면 동굴 밖

    // 카메라 — 낮게, 양 눈높이에서 거인을 올려다본다.
    // halfW/halfH = 반드시 담아야 할 반폭·반높이. fx/fy 는 게이트 기준 시선점.
    camL: { fov: 50, halfW: 7.4, halfH: 6.10, camX: -0.6, camY: 1.10, fx: 0.7, fy: 4.2 },
    camP: { fov: 58, halfW: 3.6, halfH: 5.20, camX: -1.0, camY: 0.95, fx: 0.0, fy: 4.6 },

    /* ── 보이게 하는 것들 (표시 전용 — 난이도는 위 숫자로만 바꾼다) ──
       게이지는 시간자다: 길이 = 안전 창 × gPx. 그래서 큰 양 2.70 · 중간 1.65 ·
       작은 양 0.90 유닛이 되고, 크기 차이가 설명 없이 길이로 보인다. */
    gPx: 3.0,
    gY: 0.08,             // 게이지 높이 (양 배 아래)
    gZ: 2.30,             // 게이지를 카메라 쪽으로 — 붉은 영역과 겹쳐 읽히지 않게
    gH: 0.17,             // 게이지 두께
    gHold: 1.60,          // 누른 뒤 마커를 붙잡아 두는 시간 (결과 문구가 떠 있는 내내)
    gLead: 0.45,          // 위험 구간에서 "곧 열린다"를 미리 보여주는 최대 시간
    bandZ: 1.15,          // 손 위험 범위의 z 반경 (양이 지나는 길 폭)
    blink: 0.30,          // 누를 게 없을 때 게이트가 깜빡이는 시간
    lockFlash: 0.45       // 결과 문구가 뜬 직후 이만큼은 잔소리로 덮지 않는다
  };

  // 색 — 어두운 동굴 + 입구의 빛. 이 대비가 분위기의 전부다.
  var COL = {
    bg: 0x07080b,
    floor: 0x181410,
    floorLit: 0xffcf8a,
    wall: 0x0d0b09,
    ceil: 0x090807,
    rock: 0x241f19,
    sky: 0xffe0a6,
    sea: 0x2f6a86,
    horizon: 0xfff3d2,
    wool: 0xe4dccb,
    woolDim: 0xcdc4b1,
    hide: 0x2a231b,
    skin: 0x6d6152,
    skinDark: 0x4b4237,
    hair: 0x241f1a,
    scar: 0x5e2a22,
    crew: 0xc4593f,
    crewSkin: 0xc59a6d
  };

  /* ══════════════════════════════════════════════════════════════════════
     1. 잡동사니 — 시드 난수 · 수학
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

  /* 삼각파 −1..1 — 일정한 속도의 왕복 (사인은 끝에서 느려져 규칙이 흐려진다) */
  function tri(p) {
    p = p - Math.floor(p);
    return p < 0.5 ? (p * 4 - 1) : (3 - p * 4);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 순수 모델 — 게임 시간 gt 만으로 세계가 결정된다.
        (그래서 아래 simulate() 와 실제 플레이가 한 치도 어긋나지 않는다)
     ════════════════════════════════════════════════════════════════════ */
  function buildFlock() {
    var list = [], t = C.startLead, i, k, cls;
    for (i = 0; i < C.order.length; i++) {
      k = C.order[i]; cls = C.cls[k];
      var len = C.unitLen * cls.scale;
      list.push({
        i: i, k: k, scale: cls.scale, len: len, win: cls.win,
        r: C.sweepA * (1 - 2 * cls.win / C.periodBase),
        half: len * 0.5 + C.grabPad,     // 몸이 게이트를 덮는 반경
        tIn: t, dwell: cls.dwell,
        tMid: t + cls.dwell * 0.5,       // 중심이 게이트를 지나는 시각
        used: false, rider: null, out: false
      });
      t += cls.dwell;
    }
    return { list: list, total: t, tFast: list[C.fastFrom].tIn };
  }

  function phaseAt(f, t) {
    if (t <= f.tFast) return t / C.periodBase;
    return f.tFast / C.periodBase + (t - f.tFast) / C.periodFast;
  }
  function periodAt(f, t) { return t <= f.tFast ? C.periodBase : C.periodFast; }
  /* 게이트 기준 손의 좌우 오프셋 */
  function handOff(f, t) { return C.sweepA * tri(phaseAt(f, t)); }
  function sheepX(s, t) { return C.gate + C.speed * (t - s.tMid); }
  function grabbable(s, t) { return Math.abs(sheepX(s, t) - C.gate) <= s.half; }

  /* ── 한 시점의 진실. 게이지·붉은 영역·판정이 전부 이 하나에서 나온다 ──
     safe    : 지금 손이 반경 r 밖에 있다
     remain  : 안전이 남은 시간 (창이 닫히기까지) — 게이지의 초록 길이
     toExit  : (위험일 때) 다시 안전해지기까지
     sinceIn : (위험일 때) 창이 닫힌 지 얼마나 됐나
     late    : 창이 닫힌 쪽에 더 가깝다 → "너무 늦었다"                     */
  function probe(f, t, r) {
    var A = C.sweepA;
    var u = handOff(f, t);
    var v = 4 * A / periodAt(f, t);                 // 손의 속력
    var dir = tri(phaseAt(f, t) + 1e-4) - tri(phaseAt(f, t)) >= 0 ? 1 : -1;
    var au = Math.abs(u);
    if (au >= r) {
      // 게이트에서 멀어지는 중이면 끝까지 갔다 돌아올 때까지가 남은 시간
      var out = (u > 0) === (dir > 0);
      return {
        safe: true, u: u, dir: dir,
        remain: (out ? (A - au) + (A - r) : (au - r)) / v,
        toExit: 0, sinceIn: 0, late: false, near: false
      };
    }
    var toExit = (dir > 0 ? (r - u) : (u + r)) / v;
    var sinceIn = (dir > 0 ? (u + r) : (r - u)) / v;
    return {
      safe: false, u: u, dir: dir, remain: 0,
      toExit: toExit, sinceIn: sinceIn,
      // 창이 닫힌 지 얼마 안 됐으면 "늦었다", 다시 열릴 쪽이 가까우면 "일렀다".
      // 한가운데(sinceIn == toExit)는 기다리면 열리는 쪽이니 "아직 이르다"가 맞다.
      late: sinceIn < toExit, near: Math.min(toExit, sinceIn) <= C.nearMiss
    };
  }

  /* 판정: 놓친 정도와 빗나간 쪽까지 함께 돌려준다 */
  function judge(f, tj, r) {
    var p = probe(f, tj, r);
    if (p.safe) return { safe: true, near: false, slack: Math.abs(p.u) - r,
                         late: false, remain: p.remain };
    return { safe: false, near: p.near, slack: -Math.min(p.toExit, p.sinceIn),
             late: p.late, toExit: p.toExit, sinceIn: p.sinceIn };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시뮬레이션 — "큰 양만 노리면 6명을 다 못 내보낸다"를 실제로 확인한다.
        policy: 'big' | 'bigmid' | 'greedy' | 'smart'
     ════════════════════════════════════════════════════════════════════ */
  function simulate(o) {
    o = o || {};
    var policy = o.policy || 'smart';
    var jitter = (o.jitter == null) ? 0.07 : o.jitter;
    var rnd = makeRng(o.seed || 12345);
    var f = buildFlock();
    var crew = C.crew, escaped = 0, caught = 0, nears = 0, tries = [];
    var bigLeft = 0, i;
    for (i = 0; i < f.list.length; i++) if (f.list[i].k === 'big') bigLeft++;

    for (i = 0; i < f.list.length; i++) {
      var s = f.list[i];
      if (s.k === 'big') bigLeft--;
      if (crew <= 0) break;

      var take = false;
      if (policy === 'greedy') take = true;
      else if (policy === 'big') take = (s.k === 'big');
      else if (policy === 'bigmid') take = (s.k === 'big' || s.k === 'mid');
      else { // smart — 큰 양을 우선하되, 남은 큰 양이 모자라면 중간도 잡는다
        take = (s.k === 'big') || (s.k === 'mid' && crew > bigLeft) ||
               (s.k === 'sml' && crew > bigLeft + countLeft(f, i, 'mid'));
      }
      if (!take) continue;

      var w = bestWindow(f, s);
      if (!w) continue;
      var tp = w.mid + (rnd() * 2 - 1) * jitter;
      tp = clamp(tp, w.a - 0.25, w.b + 0.25);
      var g0 = s.tMid - s.half / C.speed, g1 = s.tMid + s.half / C.speed;
      if (tp < g0) tp = g0;
      if (tp > g1) tp = g1;
      var r = judge(f, tp + C.lead, s.r);
      crew--;
      if (r.safe) escaped++; else { caught++; if (r.near) nears++; }
      tries.push({ i: i, k: k2(s), t: +tp.toFixed(2), win: +w.w.toFixed(2), ok: r.safe });
    }
    return {
      policy: policy, jitter: jitter,
      escaped: escaped, caught: caught, trapped: crew,
      total: C.crew, perfect: escaped === C.crew, nears: nears,
      flockSec: +f.total.toFixed(1), tries: tries
    };
  }
  function k2(s) { return s.k; }
  function countLeft(f, from, kind) {
    var n = 0, i;
    for (i = from + 1; i < f.list.length; i++) if (f.list[i].k === kind) n++;
    return n;
  }
  /* 이 양에게 남은 '누를 수 있는 구간' 중 가장 넓은 것 */
  function bestWindow(f, s) {
    var g0 = s.tMid - s.half / C.speed;
    var g1 = s.tMid + s.half / C.speed;
    var step = 1 / 480, t, best = null, a = null, prev = false;
    for (t = g0; t <= g1 + step; t += step) {
      var ok = (t <= g1) && (Math.abs(handOff(f, t + C.lead)) >= s.r);
      if (ok && !prev) a = t;
      if (!ok && prev) {
        var w = t - a;
        if (!best || w > best.w) best = { a: a, b: t, w: w, mid: (a + t) * 0.5 };
      }
      prev = ok;
    }
    return best;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 지오메트리 헬퍼 — 여러 도형을 하나로 합쳐 인스턴싱에 쓴다
     ════════════════════════════════════════════════════════════════════ */
  var T3 = null;

  function mkColor(hex) { return new T3.Color(hex); }

  /* parts: [{ g:Geometry, m:Matrix4|null, c:0xRRGGBB }] → 색 속성을 가진 하나의 지오메트리 */
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
      var c = mkColor(parts[i].c == null ? 0xffffff : parts[i].c);
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
     5. 소리 — WebAudio 로 최소한만 합성. 파일 로드 없음.
     ════════════════════════════════════════════════════════════════════ */
  function makeAudio(rnd) {
    var ctx = null, master = null, noise = null, rum = null, rumG = null, rumF = null;
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

        var len = Math.floor(ctx.sampleRate * 1.4);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        rum = ctx.createBufferSource();
        rum.buffer = noise; rum.loop = true;
        rumF = ctx.createBiquadFilter();
        rumF.type = 'lowpass'; rumF.frequency.value = 190; rumF.Q.value = 1.2;
        rumG = ctx.createGain(); rumG.gain.value = 0;
        rum.connect(rumF); rumF.connect(rumG); rumG.connect(master);
        rum.start();
        ready = true;
      } catch (e) { on = false; ctx = null; }
      return ctx;
    }
    function resume() {
      ensure();
      try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) { }
    }
    function now() { return ctx ? ctx.currentTime : 0; }

    function tone(type, f0, f1, dur, vol, dest) {
      if (!ctx) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain(), t = now();
        o.type = type; o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(dest || master);
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
      /* 손이 다가올 때의 낮은 마찰음 — 0..1 */
      rumble: function (lv) {
        if (!ctx || !rumG) return;
        try {
          rumG.gain.setTargetAtTime(0.02 + 0.30 * lv * lv, now(), 0.05);
          rumF.frequency.setTargetAtTime(150 + 260 * lv, now(), 0.08);
        } catch (e) { }
      },
      dash: function () { burst(900, 1.2, 0.12, 0.10); },
      /* 성공 — 밝고 짧게 */
      good: function () {
        tone('sine', 620, 1180, 0.20, 0.24);
        tone('triangle', 930, 1560, 0.16, 0.10);
        burst(2200, 2.0, 0.10, 0.05);
      },
      /* 붙잡힘 — 낮은 충격 + 비명 */
      bad: function () {
        tone('sine', 110, 42, 0.50, 0.40);
        tone('sawtooth', 430, 96, 0.55, 0.16);
        burst(700, 0.8, 0.30, 0.16);
      },
      /* 아슬아슬 — 스치는 소리 */
      graze: function () { burst(1500, 3.5, 0.22, 0.09); tone('sine', 300, 240, 0.18, 0.07); },
      bleat: function (p) {
        if (!ctx) return;
        try {
          var o = ctx.createOscillator(), lfo = ctx.createOscillator(),
              lg = ctx.createGain(), g = ctx.createGain(),
              lp = ctx.createBiquadFilter(), t = now();
          o.type = 'sawtooth'; o.frequency.value = 200 + p * 90;
          lfo.type = 'sine'; lfo.frequency.value = 17; lg.gain.value = 26;
          lfo.connect(lg); lg.connect(o.frequency);
          lp.type = 'lowpass'; lp.frequency.value = 1300;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
          o.connect(lp); lp.connect(g); g.connect(master);
          o.start(t); lfo.start(t); o.stop(t + 0.36); lfo.stop(t + 0.36);
        } catch (e) { }
      },
      tick: function () { burst(320, 1.0, 0.05, 0.05); },
      mute: function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () {
        try { if (rum) rum.stop(); } catch (e) { }
        try { if (ctx) ctx.close(); } catch (e) { }
        ctx = null;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. HUD — 최소한만 (STAGE1.md §5). 설명 텍스트 없음.
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st1-css';
  var CSS = [
    '.st1{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#efe7d8;-webkit-user-select:none;user-select:none;z-index:5}',
    '.st1 .bar{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;',
    'align-items:flex-start;padding:14px 16px;gap:12px}',
    '.st1 .crew{display:flex;align-items:center;gap:9px}',
    '.st1 .crew b{font-size:2.15rem;line-height:1;font-weight:800;letter-spacing:-.03em;',
    'text-shadow:0 2px 10px #000}',
    '.st1 .pips{display:flex;gap:5px}',
    '.st1 .pip{width:9px;height:9px;border-radius:50%;background:#efe7d8;',
    'box-shadow:0 0 6px rgba(0,0,0,.8);transition:background .2s,transform .2s}',
    '.st1 .pip.out{background:#5ad39a}',
    '.st1 .pip.lost{background:#3b2320;box-shadow:inset 0 0 0 1.5px #8e2f26}',
    '.st1 .pip.gone{background:#2a2723;box-shadow:inset 0 0 0 1.5px #4b463d}',
    '.st1 .flock{display:flex;align-items:center;gap:8px;opacity:.92}',
    '.st1 .flock i{display:block;border-radius:50%;background:#efe7d8;',
    'box-shadow:0 0 8px rgba(0,0,0,.7);transition:width .25s,height .25s}',
    '.st1 .flock span{font-size:1.05rem;font-weight:700;text-shadow:0 2px 8px #000;',
    'font-variant-numeric:tabular-nums}',
    '.st1 .cue{position:absolute;left:50%;top:73%;transform:translate(-50%,-50%) scale(.8);',
    'font-size:2.6rem;font-weight:900;letter-spacing:-.02em;opacity:0;',
    'color:#ffd98c;text-shadow:0 0 26px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,1),0 3px 12px #000;',
    'transition:opacity .12s}',
    '.st1 .cue.on{opacity:1;transform:translate(-50%,-50%) scale(1);transition:opacity .1s,transform .18s}',
    '.st1 .flash{position:absolute;left:50%;top:70%;transform:translate(-50%,-50%);',
    'font-size:1.25rem;font-weight:800;opacity:0;white-space:nowrap;text-align:center;',
    'text-shadow:0 2px 12px #000;transition:opacity .2s,top .5s}',
    '.st1 .flash.on{opacity:1;top:66%}',
    /* 왜 실패했는지 — 마커 옆에 붙는 한 마디 */
    '.st1 .flash u{display:block;margin-top:3px;font-size:.92rem;font-weight:700;',
    'text-decoration:none;letter-spacing:.02em;opacity:.92}',
    /* ★ 헛누름 — 페널티가 없는 일이니 목소리도 작아야 한다. 결과 문구와 구별된다. */
    '.st1 .flash.on.soft{opacity:.82;font-size:1.02rem;font-weight:700}',
    /* 조작 안내 — 시작에 한 번만. 첫 성공이 나오면 사라진다. */
    '.st1 .hint{position:absolute;left:50%;bottom:3.5%;transform:translateX(-50%);',
    'font-size:.9rem;font-weight:600;color:#d9cfba;opacity:0;white-space:nowrap;',
    'padding:7px 15px;border-radius:999px;background:rgba(10,9,7,.42);',
    'text-shadow:0 2px 10px #000;transition:opacity .5s}',
    '.st1 .hint.on{opacity:.9}',
    /* ★ 숨어 있는 동안에는 히트테스트에서 완전히 빠져야 한다.
       visibility 를 안 주면 안 보이는 '다시' 버튼이 화면 한가운데서 탭을 삼킨다. */
    '.st1 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:16px;background:rgba(6,7,10,.86);',
    'opacity:0;pointer-events:none;visibility:hidden;',
    'transition:opacity .35s;text-align:center;padding:24px}',
    '.st1 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st1 .end h2{font-size:1.7rem;font-weight:800;margin:0}',
    '.st1 .end p{font-size:1rem;color:#b9b0a0;margin:0;line-height:1.7}',
    '.st1 .end b{color:#ffd88f}',
    '.st1 .end button{margin-top:6px;padding:11px 26px;border-radius:999px;',
    'border:1px solid #55493a;background:#1a1712;color:#efe7d8;font-size:1rem;font-weight:700;',
    'cursor:pointer;font-family:inherit}',
    '.st1 .end button:active{transform:translateY(1px)}'
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
    el.className = 'st1';
    el.innerHTML =
      '<div class="bar">' +
        '<div class="crew"><b>6</b><div class="pips"></div></div>' +
        '<div class="flock"><i></i><span>18</span></div>' +
      '</div>' +
      '<div class="cue">지금!</div>' +
      '<div class="flash"><span></span><u></u></div>' +
      '<div class="hint">스페이스 또는 화면을 눌러 내보낸다</div>' +
      '<div class="end"><h2></h2><p></p><button type="button">다시</button></div>';
    host.appendChild(el);

    var big = el.querySelector('.crew b'),
        pips = el.querySelector('.pips'),
        next = el.querySelector('.flock i'),
        cnt = el.querySelector('.flock span'),
        cue = el.querySelector('.cue'),
        flash = el.querySelector('.flash'),
        flashT1 = el.querySelector('.flash span'),
        flashT2 = el.querySelector('.flash u'),
        hint = el.querySelector('.hint'),
        end = el.querySelector('.end'),
        endH = el.querySelector('.end h2'),
        endP = el.querySelector('.end p'),
        endB = el.querySelector('.end button');

    var pipEls = [], i;
    for (i = 0; i < C.crew; i++) {
      var d = document.createElement('i');
      d.className = 'pip'; d.setAttribute('data-i', i);
      pips.appendChild(d); pipEls.push(d);
    }
    var flashT = 0, lastCrew = '', lastFlock = '';

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },
      crew: function (n, marks) {
        var key = n + '|' + marks.join(',');
        if (key === lastCrew) return;
        lastCrew = key;
        big.textContent = String(n);
        for (var j = 0; j < pipEls.length; j++) pipEls[j].className = 'pip ' + (marks[j] || '');
      },
      flock: function (n, kind) {
        var key = n + '|' + kind;
        if (key === lastFlock) return;
        lastFlock = key;
        cnt.textContent = String(n);
        var px = kind === 'big' ? 20 : (kind === 'mid' ? 14 : 9);
        next.style.width = px + 'px'; next.style.height = px + 'px';
        next.style.opacity = kind ? '1' : '0';
      },
      cue: function (on) { cue.className = on ? 'cue on' : 'cue'; },
      hint: function (on) { hint.className = on ? 'hint on' : 'hint'; },
      flash: function (txt, col, why, soft) {
        if (!txt) { flash.className = 'flash'; flashT = 0; return; }   // 즉시 지운다
        flashT1.textContent = txt;
        flashT2.textContent = why || '';
        flash.style.color = col;
        flash.className = soft ? 'flash on soft' : 'flash on';
        flashT = soft ? 0.62 : 1.15;
      },
      tick: function (dt) {
        if (flashT > 0) {
          flashT -= dt;
          if (flashT <= 0) flash.className = 'flash';
        }
      },
      end: function (r) {
        if (!r) { end.className = 'end'; return; }
        endH.textContent = r.perfect ? '여섯 모두 나왔다' :
                           (r.escaped === 0 ? '아무도 나오지 못했다' : '동굴을 벗어났다');
        endP.innerHTML = '빠져나간 부하 <b>' + r.escaped + '</b>명 · 붙잡힘 ' + r.caught +
                         '명' + (r.trapped ? ' · 갇힘 ' + r.trapped + '명' : '');
        end.className = 'end on';
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 장면 만들기
     ════════════════════════════════════════════════════════════════════ */

  /* ── 양 한 마리 (배율 1, 어깨높이 1.0, 몸길이 1.55, +x 가 진행방향) ── */
  function sheepGeo(rnd) {
    var p = [], i;
    var sph = new T3.SphereGeometry(0.5, 12, 9);
    var box = new T3.BoxGeometry(1, 1, 1);

    p.push({ g: sph, m: M(0, 0.66, 0, 1.42, 0.96, 1.02), c: COL.wool });
    // 복슬복슬한 실루엣 — 양털 덩어리 몇 개
    var bumps = [[-0.42, 0.92, 0.10], [0.02, 1.00, -0.06], [0.40, 0.90, 0.12],
                 [-0.18, 0.86, -0.30], [0.20, 0.84, 0.32], [-0.58, 0.72, -0.14]];
    for (i = 0; i < bumps.length; i++) {
      var s = 0.40 + rnd() * 0.16;
      p.push({ g: sph, m: M(bumps[i][0], bumps[i][1], bumps[i][2], s, s * 0.86, s), c: COL.wool });
    }
    // 목 · 머리 · 주둥이
    p.push({ g: sph, m: M(0.56, 0.86, 0, 0.52, 0.50, 0.46), c: COL.woolDim });
    p.push({ g: sph, m: M(0.76, 0.82, 0, 0.44, 0.40, 0.38), c: COL.hide });
    p.push({ g: box, m: M(0.92, 0.74, 0, 0.20, 0.15, 0.15), c: COL.hide });
    // 귀
    p.push({ g: box, m: M(0.72, 0.96, 0.15, 0.07, 0.16, 0.04, 0, 0, -0.5), c: COL.hide });
    p.push({ g: box, m: M(0.72, 0.96, -0.15, 0.07, 0.16, 0.04, 0, 0, -0.5), c: COL.hide });
    // 다리 4개
    var legs = [[0.34, 0.20], [0.34, -0.20], [-0.36, 0.20], [-0.36, -0.20]];
    for (i = 0; i < legs.length; i++) {
      p.push({ g: box, m: M(legs[i][0], 0.21, legs[i][1], 0.09, 0.44, 0.09), c: COL.hide });
    }
    // 꼬리
    p.push({ g: sph, m: M(-0.74, 0.74, 0, 0.20, 0.24, 0.18), c: COL.wool });

    var g = merge(p);
    sph.dispose(); box.dispose();
    return g;
  }

  /* ── 부하 한 명 (웅크린 자세, 키 ~0.62) ── */
  function crewGroup() {
    var g = new T3.Group();
    var mS = new T3.MeshLambertMaterial({ color: COL.crewSkin, flatShading: true });
    var mC = new T3.MeshLambertMaterial({ color: COL.crew, flatShading: true });
    var torso = new T3.Mesh(new T3.SphereGeometry(0.17, 8, 6), mC);
    torso.scale.set(1, 1.15, 0.82); torso.position.y = 0.30;
    var head = new T3.Mesh(new T3.SphereGeometry(0.105, 8, 6), mS);
    head.position.set(0.03, 0.53, 0);
    var arm = new T3.Mesh(new T3.BoxGeometry(0.30, 0.08, 0.08), mS);
    arm.position.set(0.14, 0.30, 0.11); arm.rotation.z = -0.5;
    var leg = new T3.Mesh(new T3.BoxGeometry(0.10, 0.24, 0.10), mS);
    leg.position.set(0.05, 0.11, 0.09);
    var leg2 = leg.clone(); leg2.position.z = -0.09;
    g.add(torso, head, arm, leg, leg2);
    g.userData.head = head;
    g.userData.torso = torso;
    return g;
  }

  /* ── 키클롭스 — 화면을 압도하는 크기, 눈이 멀었다 ── */
  function buildCyclops(root) {
    var G = new T3.Group();
    var skin = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var dark = new T3.MeshLambertMaterial({ color: COL.skinDark, flatShading: true });
    var hair = new T3.MeshLambertMaterial({ color: COL.hair, flatShading: true });
    var scar = new T3.MeshLambertMaterial({ color: COL.scar, flatShading: true });
    var slit = new T3.MeshBasicMaterial({ color: 0x120d0a });

    function add(geo, mat, x, y, z, sx, sy, sz, rx, ry, rz) {
      var m = new T3.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      G.add(m); return m;
    }
    var ico = new T3.IcosahedronGeometry(1, 1);
    var ico0 = new T3.IcosahedronGeometry(1, 0);
    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 10);

    // 접은 다리 · 골반
    add(ico0, dark, 0.3, 1.15, -3.2, 2.7, 1.15, 1.7, 0, 0.2, 0);
    add(ico0, dark, -2.2, 1.35, -4.2, 1.8, 1.35, 2.4, 0, 0.35, 0);
    add(ico0, dark, 2.4, 1.00, -3.8, 1.5, 1.00, 1.8, 0, -0.2, 0);
    add(ico, skin, 0.2, 2.7, -4.7, 2.9, 1.6, 2.3);

    // 몸통 — 앞으로 기울어 더듬는다
    var torso = add(ico, skin, 0.55, 5.10, -5.2, 2.65, 2.95, 2.05, 0.16, 0.12, 0);
    add(ico, dark, 0.4, 3.4, -4.3, 2.3, 1.3, 1.7);
    // 목
    add(cyl, skin, 1.05, 7.30, -5.1, 1.0, 1.25, 1.0, 0.1, 0, -0.06);

    // 머리 — 크다
    var head = new T3.Group();
    head.position.set(1.25, 8.45, -4.95);
    head.rotation.set(0.16, 0.44, -0.05);      // 소리 쪽으로 돌린 고개
    G.add(head);
    function h(geo, mat, x, y, z, sx, sy, sz, rx, ry, rz) {
      var m = new T3.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      head.add(m); return m;
    }
    h(ico, skin, 0, 0, 0, 1.68, 1.62, 1.55);
    h(ico0, hair, -0.1, 0.95, -0.35, 1.55, 0.95, 1.4);              // 머리털
    h(ico0, hair, -0.9, 0.35, 0.25, 0.8, 0.9, 0.9);
    // 눈두덩 · 이마
    h(ico0, skin, 0.15, 0.30, 1.35, 1.15, 0.55, 0.5, 0.15, 0, 0.06);
    // ★ 감긴 외눈 — 부풀어 오른 눈꺼풀 + 가로 봉합선
    h(ico, skin, 0.12, -0.12, 1.42, 0.86, 0.55, 0.42);
    h(box, slit, 0.12, -0.14, 1.80, 1.34, 0.10, 0.10, 0, 0, 0.04);
    // ★ 그을린 상처 — 눈을 가로지르는 세 줄
    h(box, scar, 0.05, 0.16, 1.72, 1.05, 0.17, 0.13, 0, 0, -0.62);
    h(box, scar, 0.26, -0.34, 1.68, 0.85, 0.15, 0.12, 0, 0, -0.55);
    h(box, scar, -0.35, -0.52, 1.55, 0.55, 0.13, 0.11, 0, 0, -0.75);
    h(ico0, scar, 0.12, -0.10, 1.62, 0.30, 0.30, 0.22);
    // 코 · 입 · 수염
    h(ico0, skin, 0.30, -0.72, 1.35, 0.42, 0.42, 0.45);
    h(box, slit, 0.25, -1.06, 1.22, 0.90, 0.13, 0.14, 0.2, 0, -0.05);
    h(ico0, hair, 0.15, -1.30, 0.85, 1.15, 0.65, 1.05);
    h(ico0, hair, -0.55, -1.15, 0.55, 0.75, 0.55, 0.75);

    // ── 팔: 어깨 · 위팔 · 팔꿈치 · 아래팔 · 손 ──────────────────────────
    // 위에서 아래로 내려 짚는 각도라야 화면을 가로로 가르지 않는다
    var arm = { S: new T3.Vector3(2.85, 6.30, -2.40), L1: 3.3, L2: 3.9 };
    add(ico, skin, 1.95, 6.20, -3.60, 1.75, 1.45, 1.45);                // 앞으로 내민 가슴
    add(ico, skin, arm.S.x, arm.S.y, arm.S.z, 1.30, 1.20, 1.20);        // 어깨
    add(ico, skin, -2.10, 6.55, -5.55, 1.2, 1.1, 1.1);                  // 반대쪽 어깨
    add(ico0, dark, -3.1, 4.4, -4.9, 1.0, 2.5, 1.0, 0.25, 0, 0.35);     // 반대쪽 팔(짚은 손)
    add(ico0, dark, -3.9, 1.5, -4.0, 1.1, 1.1, 1.3);

    var upper = add(cyl, skin, 0, 0, 0, 0.68, 1, 0.68);
    var elbow = add(ico, skin, 0, 0, 0, 0.84, 0.84, 0.84);
    var fore = add(cyl, skin, 0, 0, 0, 0.56, 1, 0.56);

    // 손 — 아래로 더듬는 갈퀴. 이 판에서 가장 중요한 물체이므로
    //      덩어리의 무게중심을 판정점(그룹 원점)에 맞춘다. 안 그러면
    //      "손가락이 있는 곳"과 "실제 위험한 곳"이 어긋나 억울해진다.
    var hand = new T3.Group();
    hand.scale.setScalar(1.12);
    G.add(hand);
    var hskin = new T3.MeshLambertMaterial({ color: 0xa08f76, emissive: 0x16110b,
                                             flatShading: true });
    var palm = new T3.Mesh(box, hskin);
    palm.scale.set(1.72, 0.60, 2.00); palm.position.set(0, 0.42, 0);
    hand.add(palm);
    var knuck = new T3.Mesh(ico0, hskin);
    knuck.scale.set(0.98, 0.34, 1.05); knuck.position.set(0.30, 0.18, 0);
    hand.add(knuck);

    var fingers = [];
    var fz = [-0.72, -0.25, 0.25, 0.72];
    for (var fi = 0; fi < fz.length; fi++) {
      var fg = new T3.Group();                       // 손가락 밑마디 (아래로)
      fg.position.set(0.42 - Math.abs(fz[fi]) * 0.18, 0.18, fz[fi]);
      fg.rotation.z = -1.05;
      var p1 = new T3.Mesh(box, hskin);
      p1.scale.set(0.80, 0.34, 0.34); p1.position.set(0.38, 0, 0);
      var jg = new T3.Group(); jg.position.set(0.78, 0, 0);
      var p2 = new T3.Mesh(box, hskin);
      p2.scale.set(0.70, 0.29, 0.29); p2.position.set(0.34, 0, 0);
      jg.add(p2); fg.add(p1, jg); hand.add(fg);
      fingers.push({ g: fg, j: jg, ph: fi * 0.8, base: -1.05 });
    }
    var thumb = new T3.Group();
    thumb.position.set(-0.52, 0.22, -0.86);
    thumb.rotation.set(0, 0.9, -0.75);
    var tp = new T3.Mesh(box, hskin);
    tp.scale.set(0.86, 0.34, 0.34); tp.position.set(0.40, 0, 0);
    thumb.add(tp); hand.add(thumb);

    root.add(G);
    return {
      group: G, head: head, torso: torso, arm: arm,
      upper: upper, elbow: elbow, fore: fore, hand: hand,
      fingers: fingers, thumb: thumb,
      geos: [ico, ico0, box, cyl],
      mats: [skin, dark, hair, scar, slit, hskin]
    };
  }

  /* ── 동굴 · 입구의 빛 ── */
  function buildCave(root, rnd) {
    var out = { mats: [], geos: [] };
    function mat(m) { out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }

    var WZ = -8.5;        // 뒷벽
    var SKZ = -10.5;      // 바깥

    // 바닥 — 뒷벽에서 끊어 구멍 너머로 이어지지 않게
    var floor = new T3.Mesh(geo(new T3.PlaneGeometry(64, 28)),
                            mat(new T3.MeshLambertMaterial({ color: COL.floor })));
    floor.rotation.x = -Math.PI / 2; floor.position.set(4, 0, WZ + 14);
    root.add(floor);

    // 뒷벽 — 오른쪽에 아치 구멍을 뚫는다
    var shape = new T3.Shape();
    shape.moveTo(-30, -2); shape.lineTo(34, -2); shape.lineTo(34, 30);
    shape.lineTo(-30, 30); shape.lineTo(-30, -2);
    var hole = new T3.Path();
    var ax0 = 8.9, ax1 = 21.0, ay = 4.6, top = 8.9;
    hole.moveTo(ax0, -2);
    hole.lineTo(ax0 - 0.5, ay);
    hole.lineTo(ax0 + 1.4, top - 0.9);
    hole.lineTo(ax0 + 4.4, top);
    hole.lineTo(ax1 - 2.4, top - 1.3);
    hole.lineTo(ax1 + 0.6, ay - 0.8);
    hole.lineTo(ax1, -2);
    hole.lineTo(ax0, -2);
    shape.holes.push(hole);
    var wall = new T3.Mesh(geo(new T3.ShapeGeometry(shape)),
                           mat(new T3.MeshLambertMaterial({ color: COL.wall })));
    wall.position.set(0, 0, WZ);
    root.add(wall);

    // 구멍 너머 — 하늘 · 바다 · 수평선
    var sky = new T3.Mesh(geo(new T3.PlaneGeometry(34, 26)),
                          mat(new T3.MeshBasicMaterial({ color: COL.sky })));
    sky.position.set(15, 8, SKZ); root.add(sky);
    var sea = new T3.Mesh(geo(new T3.PlaneGeometry(34, 9.0)),
                          mat(new T3.MeshBasicMaterial({ color: COL.sea })));
    sea.position.set(15, 0.1, SKZ + 0.15); root.add(sea);
    var hz = new T3.Mesh(geo(new T3.PlaneGeometry(34, 0.42)),
                         mat(new T3.MeshBasicMaterial({ color: COL.horizon })));
    hz.position.set(15, 4.65, SKZ + 0.3); root.add(hz);

    // 바깥 바위 실루엣 — 수평선이 맨 줄로 보이지 않게
    var farM = mat(new T3.MeshBasicMaterial({ color: 0x1d2b33 }));
    var farG = geo(new T3.IcosahedronGeometry(1, 0));
    var far = [[10.2, 0.42, 1.7], [19.8, 0.60, 2.2], [15.4, 0.26, 1.1]];
    for (var q = 0; q < far.length; q++) {
      var fm = new T3.Mesh(farG, farM);
      fm.position.set(far[q][0], 4.45, SKZ + 0.5);
      fm.scale.set(far[q][2], far[q][1], 0.3);
      fm.rotation.z = rnd() * 0.6;
      root.add(fm);
    }

    // 천장 · 왼쪽 벽 — 프레임을 어둡게 닫는다
    var ceil = new T3.Mesh(geo(new T3.PlaneGeometry(64, 34)),
                           mat(new T3.MeshLambertMaterial({ color: COL.ceil })));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(4, 14.5, WZ + 12); root.add(ceil);
    var lw = new T3.Mesh(geo(new T3.PlaneGeometry(34, 32)),
                         mat(new T3.MeshLambertMaterial({ color: COL.ceil })));
    lw.rotation.y = Math.PI / 2; lw.position.set(-13, 9, WZ + 12); root.add(lw);

    // 바위 — 양이 지나는 길(z ≈ sheepZ)과 게이트 앞은 비워 둔다
    var rockG = geo(new T3.IcosahedronGeometry(1, 0));
    var rockM = mat(new T3.MeshLambertMaterial({ color: COL.rock, flatShading: true }));
    var spots = [[-6.6, 0.5, -2.2, 1.6], [-9.5, 0.7, 0.6, 2.0], [-3.4, 0.35, -3.4, 1.1],
                 [7.6, 0.4, -3.8, 1.3], [-1.0, 0.3, -4.2, 0.9],
                 [-8.0, 0.4, 4.4, 1.7], [3.0, 0.25, -4.6, 0.8], [-4.5, 0.3, 3.6, 1.0]];
    for (var i = 0; i < spots.length; i++) {
      var r = new T3.Mesh(rockG, rockM);
      r.position.set(spots[i][0], spots[i][1], spots[i][2]);
      var sc = spots[i][3];
      r.scale.set(sc * (0.8 + rnd() * 0.5), sc * (0.5 + rnd() * 0.4), sc * (0.8 + rnd() * 0.5));
      r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      root.add(r);
    }
    // 카메라 앞 바위 능선 — 화면 아래를 닫는 액자. 세로에서 특히 효과가 크다.
    var fgM = mat(new T3.MeshLambertMaterial({ color: 0x16120d, flatShading: true }));
    var fg = [[-2.0, 6.6, 2.6], [3.4, 7.4, 2.2], [8.4, 6.9, 2.8], [13.0, 6.4, 2.4],
              [-6.5, 7.2, 2.6], [5.9, 8.8, 2.0]];
    for (var t = 0; t < fg.length; t++) {
      var fr = new T3.Mesh(rockG, fgM);
      fr.position.set(fg[t][0], -1.35, fg[t][1]);
      fr.scale.set(fg[t][2] * (0.9 + rnd() * 0.4), 1.35 + rnd() * 0.3, 1.5);
      fr.rotation.set(rnd() * 0.3, rnd() * 3, rnd() * 0.4);
      root.add(fr);
    }

    // 천장에서 내려온 바위 — 화면 위를 닫는다
    var top2 = [[-1.0, 12.6, -3.0, 3.4], [5.5, 13.2, -4.5, 2.6], [10.5, 13.4, -3.4, 2.2],
                [-6.0, 12.9, -1.0, 2.8], [2.0, 13.6, 1.5, 3.0]];
    for (var u2 = 0; u2 < top2.length; u2++) {
      var tr = new T3.Mesh(rockG, fgM);
      tr.position.set(top2[u2][0], top2[u2][1], top2[u2][2]);
      tr.scale.set(top2[u2][3], 1.5 + rnd(), top2[u2][3] * 0.8);
      tr.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.4);
      root.add(tr);
    }

    // 부하들이 웅크린 바위 그늘 — 뒤쪽에 낮게 둬서 가리지 않는다
    var shelter = new T3.Mesh(rockG, rockM);
    shelter.position.set(C.hideX - 1.95, 0.40, C.hideZ + 1.10);
    shelter.scale.set(1.30, 0.62, 0.70);
    shelter.rotation.set(0.2, 0.7, 0.1);
    root.add(shelter);

    // 양이 지나는 길 — 은은하게 밝다. 손 그림자는 이 위에서만 읽힌다.
    var lane = new T3.Mesh(geo(new T3.PlaneGeometry(30, 4.0)),
                           mat(new T3.MeshBasicMaterial({
                             color: COL.floorLit, transparent: true, opacity: 0.17,
                             depthWrite: false, blending: T3.AdditiveBlending
                           })));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(4.5, 0.008, C.sheepZ);
    root.add(lane);

    // 입구에서 들어오는 빛 — 바닥에 퍼진다
    var pool = new T3.Mesh(geo(new T3.CircleGeometry(1, 40)),
                           mat(new T3.MeshBasicMaterial({
                             color: COL.floorLit, transparent: true, opacity: 0.20,
                             depthWrite: false, blending: T3.AdditiveBlending
                           })));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(C.gate + 5.2, 0.012, C.sheepZ - 1.0);
    pool.scale.set(8.6, 1, 5.0);
    root.add(pool);

    // 게이트 — 좁은 빛기둥이 닿는 자리. 여기가 판정선이다.
    var pool2 = new T3.Mesh(geo(new T3.CircleGeometry(1, 36)),
                            mat(new T3.MeshBasicMaterial({
                              color: COL.floorLit, transparent: true, opacity: 0.42,
                              depthWrite: false, blending: T3.AdditiveBlending
                            })));
    pool2.rotation.x = -Math.PI / 2;
    pool2.position.set(C.gate, 0.014, C.sheepZ);
    pool2.scale.set(1.15, 1, 0.85);
    root.add(pool2);
    out.gate = pool2;         // 누를 게 없을 때 여기가 깜빡인다 — "이 자리가 비었다"

    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 스테이지 본체
     ════════════════════════════════════════════════════════════════════ */
  var S = null;   // 살아있는 인스턴스 (한 판에 하나)

  function init(root, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');
    if (S) dispose();

    var rnd = makeRng(opts.seed || 20260812);
    var world = new T3.Group();
    (root || opts.scene).add(world);

    var s = {
      root: root, world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, snd: makeAudio(makeRng(7717)),
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      hud: null,
      flock: null,
      phase: 'ready',        // ready | run | pause | over
      gt: 0,                 // 게임 시간 (정지 중에는 멈춘다)
      wall: 0,               // 실시간 (연출용)
      freeze: 0, shake: 0,
      lastPress: -9, gateBlink: 0, flashLock: -9,
      waiting: C.crew, escaped: 0, caught: 0,
      marks: [], riders: [], crewMen: [],
      cuedOnce: false, cueOn: false,
      bleatAt: 2.4,
      disposables: { geos: [], mats: [] }
    };
    for (var i = 0; i < C.crew; i++) s.marks.push('');

    /* ── 조명: 낮은 환경광 + 입구에서 들어오는 따뜻한 빛 ── */
    var amb = new T3.AmbientLight(0x1b2130, 1.05);
    var key = new T3.DirectionalLight(0xffd9a2, 2.0);
    key.position.set(16, 7.5, -2);
    var rim = new T3.DirectionalLight(0x8ea0c8, 1.15);
    rim.position.set(-7, 5.5, 12);
    var warm = new T3.PointLight(0xffb877, 26, 16, 2);
    warm.position.set(C.gate + 3.2, 2.2, -1.2);
    world.add(amb, key, rim, warm);
    s.warm = warm;

    /* ── 동굴 · 거인 ── */
    var cave = buildCave(world, rnd);
    s.disposables.geos = s.disposables.geos.concat(cave.geos);
    s.disposables.mats = s.disposables.mats.concat(cave.mats);
    s.gatePool = cave.gate;
    s.cy = buildCyclops(world);

    /* ── 양 — 크기별 3종 인스턴싱 ── */
    s.flock = buildFlock();
    var base = sheepGeo(rnd);
    s.sheepGeo = base;
    var sheepMat = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    s.disposables.mats.push(sheepMat);
    var counts = { big: 0, mid: 0, sml: 0 };
    var j;
    for (j = 0; j < s.flock.list.length; j++) counts[s.flock.list[j].k]++;
    s.inst = {};
    var kinds = ['big', 'mid', 'sml'];
    for (j = 0; j < kinds.length; j++) {
      var im = new T3.InstancedMesh(base, sheepMat, counts[kinds[j]]);
      im.instanceMatrix.setUsage(T3.DynamicDrawUsage);
      im.frustumCulled = false;
      world.add(im);
      s.inst[kinds[j]] = { mesh: im, n: 0 };
    }
    for (j = 0; j < s.flock.list.length; j++) {
      var sh = s.flock.list[j];
      sh.slot = s.inst[sh.k].n++;
      sh.bob = rnd() * 6.28;
    }

    // 접지 그림자 (양 아래 어두운 타원)
    var contactG = new T3.CircleGeometry(1, 20);
    var contactM = new T3.MeshBasicMaterial({ color: 0x000000, transparent: true,
                                              opacity: 0.42, depthWrite: false });
    s.contact = new T3.InstancedMesh(contactG, contactM, s.flock.list.length);
    s.contact.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    s.contact.frustumCulled = false;
    s.contact.renderOrder = 1;
    world.add(s.contact);
    s.disposables.geos.push(contactG);
    s.disposables.mats.push(contactM);

    /* ── 손 그림자 — 반지름이 곧 규칙이다 ── */
    var shG = new T3.CircleGeometry(1, 44);
    var shM = new T3.MeshBasicMaterial({ color: 0x000000, transparent: true,
                                         opacity: 0.55, depthWrite: false });
    s.handShadow = new T3.Mesh(shG, shM);
    s.handShadow.rotation.x = -Math.PI / 2;
    s.handShadow.position.set(C.gate, 0.02, C.sheepZ);
    s.handShadow.renderOrder = 2;
    world.add(s.handShadow);
    s.disposables.geos.push(shG);
    s.disposables.mats.push(shM);

    /* ── ★ 손이 훑을 자리 — 바닥의 붉은 영역 ──────────────────────────
       손의 3D 위치만으로는 어디가 붙잡히는 자리인지 알 수 없다. 그래서
       "지금 누르면 손이 와 있을 자리"(gt + lead)를 바닥에 깔아 준다.
       반지름은 지금 양의 r — 작은 양일수록 넓게 덮는다.
       그래서 손보다 늘 조금 앞서 움직인다: 다가오는 게 미리 보인다.       */
    var bandG = new T3.CircleGeometry(1, 40);
    s.disposables.geos.push(bandG);
    s.band = new T3.Group();
    s.band.position.set(C.gate, 0.028, C.sheepZ);
    s.band.renderOrder = 3;
    world.add(s.band);
    var rings = [[1.00, 0.30], [1.26, 0.16], [1.58, 0.095], [2.00, 0.05]];
    for (j = 0; j < rings.length; j++) {
      var bm = new T3.MeshBasicMaterial({
        color: 0xff4324, transparent: true, opacity: rings[j][1],
        depthWrite: false, blending: T3.AdditiveBlending
      });
      var bmesh = new T3.Mesh(bandG, bm);
      bmesh.rotation.x = -Math.PI / 2;
      bmesh.scale.set(rings[j][0], C.bandZ * rings[j][0], 1);
      bmesh.renderOrder = 3;
      s.band.add(bmesh);
      s.disposables.mats.push(bm);
    }
    // 손에서 그 자리까지 이어지는 옅은 자국 — 붉은 영역이 손과 따로 놀지 않게
    var trailM = new T3.MeshBasicMaterial({
      color: 0xff4324, transparent: true, opacity: 0.085,
      depthWrite: false, blending: T3.AdditiveBlending
    });
    var trailG = new T3.PlaneGeometry(1, 1);
    s.bandTrail = new T3.Mesh(trailG, trailM);
    s.bandTrail.rotation.x = -Math.PI / 2;
    s.bandTrail.position.set(C.gate, 0.026, C.sheepZ);
    s.bandTrail.renderOrder = 3;
    world.add(s.bandTrail);
    s.disposables.geos.push(trailG);
    s.disposables.mats.push(trailM);

    /* ── ★ 타이밍 게이지 — 빛웅덩이의 양 바로 아래 ────────────────────
       길이 = 그 양의 안전 창 × gPx. 큰 양은 길고 새끼양은 3분의 1이다.
       초록 = 남은 안전 시간(오른쪽 끝이 창이 닫히는 순간).
       왼쪽 = 이르다 · 오른쪽 = 늦다. 마커가 트랙 밖에 찍히면 그쪽으로 빗나간 것. */
    var quad = new T3.PlaneGeometry(1, 1);
    s.disposables.geos.push(quad);
    function gpart(hex, op, add, order) {
      var m = new T3.MeshBasicMaterial({
        color: hex, transparent: true, opacity: op, depthWrite: false,
        depthTest: false, blending: add ? T3.AdditiveBlending : T3.NormalBlending
      });
      var q = new T3.Mesh(quad, m);
      q.renderOrder = order;
      s.disposables.mats.push(m);
      return q;
    }
    var ggrp = new T3.Group();
    ggrp.position.set(C.gate, C.gY, C.sheepZ + C.gZ);
    world.add(ggrp);
    s.gauge = {
      grp: ggrp,
      back: gpart(0x0a0806, 0.52, false, 20),   // 빛웅덩이 위에서도 막대가 읽히게
      track: gpart(0xffcf8a, 0.34, true, 21),
      fill: gpart(0x6ce39a, 0.92, false, 22),
      capL: gpart(0xffe6bd, 0.50, true, 23),
      capR: gpart(0xffe6bd, 0.50, true, 23),
      mark: gpart(0xfff3d2, 0.95, false, 24),
      len: 1, fillC: 0, fillL: 0, danger: 0, dead: 0,
      alpha: 0, markOn: 0, markX: 0, hold: 0
    };
    ggrp.add(s.gauge.back, s.gauge.track, s.gauge.fill,
             s.gauge.capL, s.gauge.capR, s.gauge.mark);

    /* ── 부하 6명 — 어둠 속에 웅크린다 ── */
    var crewMat = null;
    for (j = 0; j < C.crew; j++) {
      var g = crewGroup();
      g.scale.setScalar(1.55);
      // 셀 수 있게 늘어놓는다 — 겹치면 몇 명 남았는지 화면이 말해주지 못한다
      g.position.set(C.hideX + 0.85 - j * 0.46, 0, C.hideZ - 0.35 + (j % 2) * 0.62);
      g.rotation.y = -0.30 + s.rnd() * 0.45;
      g.userData.home = g.position.clone();
      g.userData.base = 1.55;
      g.userData.ph = s.rnd() * 6.28;
      world.add(g);
      s.crewMen.push(g);
      if (!crewMat) crewMat = g.children[0].material;
    }

    /* ── HUD ── */
    var host = opts.hudHost ||
               (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host && host.style && !host.style.position &&
        host === document.body) host.style.position = 'relative';
    s.hud = makeHud(host);
    s.hud.onRestart(function () { reset(); start(); });

    /* ── 입력 ── */
    if (opts.bindInput !== false) bindInput(s);

    s.dummy = new T3.Object3D();
    s.tmpC = new T3.Color();
    s.v = { H: new T3.Vector3(), d: new T3.Vector3(), dir: new T3.Vector3(),
            pole: new T3.Vector3(), perp: new T3.Vector3(), E: new T3.Vector3(),
            belly: new T3.Vector3(), tgt: new T3.Vector3(),
            a: new T3.Vector3(), b: new T3.Vector3(), up: new T3.Vector3(0, 1, 0) };
    S = s;
    layout(s);
    refreshHud(s);
    frame(s, 0);
    return api;
  }

  /* ── 스페이스 / 클릭·탭 → press() 하나로 ── */
  function bindInput(s) {
    var target = s.canvas || document;
    s.onKey = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        press();
      }
    };
    s.onDown = function (e) {
      if (e.button != null && e.button !== 0) return;
      press();
    };
    window.addEventListener('keydown', s.onKey, false);
    target.addEventListener('pointerdown', s.onDown, false);
    s.inputTarget = target;
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. 카메라 — 낮게, 양 눈높이에서 거인을 올려다본다. 세로 화면도 함께.
     ════════════════════════════════════════════════════════════════════ */
  function layout(s) {
    var cam = s.camera;
    if (!cam) return;
    var w = s.viewW || (s.canvas ? s.canvas.clientWidth : 1100) || 1100;
    var h = s.viewH || (s.canvas ? s.canvas.clientHeight : 820) || 820;
    var aspect = w / h;
    var portrait = aspect < 1;
    var k = portrait ? C.camP : C.camL;

    cam.fov = k.fov;
    cam.aspect = aspect;
    cam.near = 0.5; cam.far = 260;

    // 가로로 반드시 담아야 하는 폭(손이 훑는 구간 = ±2.35 + 여유).
    // 세로 화면에서는 이 값이 곧 세로 여백을 결정한다 — 좁게 잡아야 거인이 찬다.
    var vHalf = Math.max(k.halfH, k.halfW / aspect);
    var dist = vHalf / Math.tan(cam.fov * Math.PI / 360);
    dist = clamp(dist, 10, 32);

    cam.position.set(C.gate + k.camX, k.camY, C.sheepZ + dist * 0.96);
    cam.lookAt(C.gate + k.fx, k.fy, -1.6);
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
     10. 입력 → 규칙
     ════════════════════════════════════════════════════════════════════ */
  function activeSheep(s) {
    var l = s.flock.list, i, best = null, bd = 9;
    for (i = 0; i < l.length; i++) {
      if (l[i].used) continue;
      if (!grabbable(l[i], s.gt)) continue;
      var d = Math.abs(sheepX(l[i], s.gt) - C.gate);
      if (d < bd) { bd = d; best = l[i]; }
    }
    return best;
  }
  function nearestSheep(s) {   // 그림자 크기용 — 소모된 양도 포함
    var l = s.flock.list, i, best = null, bd = 9;
    for (i = 0; i < l.length; i++) {
      if (l[i].out) continue;
      var d = Math.abs(sheepX(l[i], s.gt) - C.gate);
      if (d < bd) { bd = d; best = l[i]; }
    }
    return best;
  }

  function press() {
    var s = S;
    if (!s) return 'none';
    s.snd.resume();
    if (s.phase === 'ready') { start(); return 'start'; }
    if (s.phase !== 'run') return 'idle';
    if (s.wall - s.lastPress < C.cooldown) return 'cooldown';
    s.lastPress = s.wall;
    if (s.waiting <= 0) { blank(s, '남은 부하가 없다'); return 'nocrew'; }
    if (s.pending) return 'busy';

    var sh = activeSheep(s);
    // ★ 매달릴 양이 없다. 페널티는 없다 — 대신 왜 안 나갔는지가 화면에 뜬다.
    //    (없으면 "열심히 눌렀는데 안 나간다"가 규칙 탓인지 버그인지 알 수 없다)
    if (!sh) { flinch(s); s.snd.tick(); blank(s, '아직 양이 없다'); return 'nosheep'; }

    // 이 양은 여기서 소모된다 — 양 하나에 부하 하나
    sh.used = true;
    var idx = C.crew - s.waiting;         // 나가는 부하 번호
    s.waiting--;
    var man = s.crewMen[C.crew - 1 - idx] || s.crewMen[0];
    var rider = {
      sheep: sh, man: man, t0: s.gt, tJudge: s.gt + C.lead,
      from: man.position.clone(), state: 'dash', life: 0, res: null
    };
    sh.rider = rider;
    s.riders.push(rider);
    s.pending = rider;
    markPress(s, sh);
    s.snd.dash();
    s.cueOn = false; s.cuedOnce = true; s.hud.cue(false);
    refreshHud(s);
    return 'go';
  }

  /* ── 헛누름의 대답 — 게이트가 한 번 깜빡이고, 한 줄이 뜬다 ──────────────
     잃는 건 없다. 막 눌러 봐도 손해가 없어야 입력을 실험할 수 있다.
     방금 결과 문구가 떴다면 그건 덮지 않는다 — 깜빡임만으로도 대답은 된다. */
  function blank(s, msg) {
    s.gateBlink = C.blink;
    if (s.wall >= s.flashLock) s.hud.flash(msg, '#d8cbb2', '', true);
  }

  function flinch(s) {
    for (var i = 0; i < s.crewMen.length; i++) {
      if (s.crewMen[i].userData.done) continue;
      s.crewMen[i].userData.flinch = 0.22;
    }
  }

  function resolve(s, rider) {
    var r = judge(s.flock, rider.tJudge, rider.sheep.r);
    rider.res = r;
    s.flashLock = s.wall + C.lockFlash;   // 결과는 잔소리에 덮이지 않는다
    if (r.safe) {
      rider.state = 'ride';
      s.escaped++;
      markPip(s, rider.man, 'out');
      s.snd.good();
      s.hud.flash('빠져나갔다', '#7ee0a8');
      // 첫 성공이 나오면 조작 안내는 할 일을 다 했다
      if (!s.gotOne) { s.gotOne = true; s.hud.hint(false); }
    } else {
      rider.state = 'grab';
      s.caught++;
      markPip(s, rider.man, 'lost');
      s.freeze = C.freeze;
      s.shake = 1;
      s.snatchOn = true; s.snatchT = 0;
      s.snd.bad();
      // ★ 왜 실패했는지 — 빗나간 쪽을 한 마디로. 아슬아슬해도 사람을 잃은 것이다.
      var why = r.late ? '너무 늦었다' : '너무 일렀다';
      if (r.near) { s.snd.graze(); s.hud.flash('아슬아슬하게 놓쳤다', '#ff9a6a', why); }
      else s.hud.flash('붙잡혔다', '#e2705f', why);
    }
    rider.life = 0;
    s.pending = null;
    refreshHud(s);
  }

  function markPip(s, man, cls) {
    var i = s.crewMen.indexOf(man);
    if (i < 0) return;
    var slot = 0, j;
    for (j = 0; j < s.marks.length; j++) if (!s.marks[j]) { slot = j; break; }
    s.marks[slot] = cls;
    man.userData.done = true;
  }

  function refreshHud(s) {
    var left = 0, i;
    for (i = 0; i < s.flock.list.length; i++) if (!s.flock.list[i].out) left++;
    var nx = null;
    for (i = 0; i < s.flock.list.length; i++) {
      var sh = s.flock.list[i];
      if (sh.out || sh.used) continue;
      if (sheepX(sh, s.gt) > C.gate + sh.half) continue;
      nx = sh; break;
    }
    s.hud.crew(s.waiting, s.marks);
    s.hud.flock(left, nx ? nx.k : null);
  }

  /* ══════════════════════════════════════════════════════════════════════
     11. 루프
     ════════════════════════════════════════════════════════════════════ */
  /* quiet=true 면 그리지 않고 세계만 굴린다 (디버그로 시간을 밀 때) */
  function update(dt, quiet) {
    var s = S;
    if (!s) return;
    dt = clamp(dt || 0, 0, 0.05);
    s.wall += dt;
    s.hud.tick(dt);

    if (s.phase === 'run' || s.phase === 'over') {
      // 붙잡히는 순간의 0.25초 정지 — 세계가 멈추고 화면만 흔들린다
      if (s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
      else s.gt += dt;
    }

    if (s.phase === 'run') {
      // 판정
      if (s.pending && s.gt >= s.pending.tJudge) resolve(s, s.pending);

      // 양이 지나갔는지
      var l = s.flock.list, i;
      for (i = 0; i < l.length; i++) {
        if (!l[i].out && sheepX(l[i], s.gt) > C.exitX) l[i].out = true;
      }

      // 첫 양에서 한 번만 "지금!"
      if (!s.cuedOnce) {
        var a0 = activeSheep(s);
        if (a0 && a0.i === 0) {
          var ok = Math.abs(handOff(s.flock, s.gt + C.lead)) >= a0.r &&
                   Math.abs(handOff(s.flock, s.gt + C.lead + 0.14)) >= a0.r;
          if (ok !== s.cueOn) {
            s.cueOn = ok; s.hud.cue(ok);
            if (!ok) s.cuedOnce = true;      // 딱 한 번. 그 뒤론 침묵.
          }
        } else if (s.cueOn || (a0 && a0.i > 0)) {
          s.cueOn = false; s.hud.cue(false); s.cuedOnce = true;
        }
      }

      // 양 울음 — 가끔
      s.bleatAt -= dt;
      if (s.bleatAt <= 0) { s.bleatAt = 3.2 + s.rnd() * 4.5; s.snd.bleat(s.rnd()); }

      // 마찰음 — 손이 다가올수록
      var nb = nearestSheep(s);
      var rr = nb ? nb.r : C.sweepA * 0.5;
      var off = Math.abs(handOff(s.flock, s.gt));
      s.snd.rumble(clamp(1 - off / Math.max(0.7, rr * 1.9), 0, 1));

      checkEnd(s);
      refreshHud(s);
    }

    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  function checkEnd(s) {
    if (s.phase !== 'run') return;
    var lastPassed = true, l = s.flock.list, i;
    for (i = 0; i < l.length; i++) {
      if (!l[i].used && sheepX(l[i], s.gt) <= C.gate + l[i].half) { lastPassed = false; break; }
    }
    var noPending = !s.pending;
    if ((s.waiting <= 0 || lastPassed) && noPending) {
      if (s.endAt == null) s.endAt = s.gt + (s.waiting <= 0 ? 1.5 : 0.9);
      if (s.gt >= s.endAt) finish(s);
    } else s.endAt = null;
  }

  function finish(s) {
    s.phase = 'over';
    var res = {
      escaped: s.escaped, caught: s.caught, trapped: s.waiting,
      total: C.crew, perfect: s.escaped === C.crew
    };
    s.result = res;
    s.snd.rumble(0);
    s.hud.hint(false);
    var handled = false;
    if (typeof api.onEnd === 'function') {
      try { api.onEnd(res); handled = true; } catch (e) { handled = false; }
    }
    if (!handled || s.opts.endPanel === true) s.hud.end(res);
  }

  /* ── 한 프레임 그리기 ── */
  function frame(s, dt) {
    var gt = s.gt, i;
    var f = s.flock;
    var off = handOff(f, gt);
    var hx = C.gate + off;

    /* 손 · 팔 IK */
    var cy = s.cy;
    var dip = 0, grip = 0;
    if (s.snatchOn) {
      s.snatchT += (dt || 0.016);
      var su = clamp(s.snatchT / 0.62, 0, 1);
      dip = Math.sin(su * Math.PI) * 1.30;
      grip = clamp(s.snatchT / 0.14, 0, 1) * (1 - clamp((s.snatchT - 0.34) / 0.26, 0, 1));
      if (su >= 1) s.snatchOn = false;
    }
    var V = s.v;
    var H = V.H.set(hx, C.handY + Math.sin(s.wall * 2.3) * 0.06 - dip, C.handZ);
    s.handWorld = H;
    var Sv = cy.arm.S;
    var d = V.d.subVectors(H, Sv);
    var dist = Math.max(0.001, d.length());
    var L1 = cy.arm.L1, L2 = cy.arm.L2;
    dist = Math.min(dist, L1 + L2 - 0.02);
    var a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    var hgt = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    var dir = V.dir.copy(d).normalize();
    var pole = V.pole.set(-1.0, 0.35, 0.10);
    var perp = V.perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0);
    perp.normalize();
    var E = V.E.copy(Sv).addScaledVector(dir, a).addScaledVector(perp, hgt);
    segment(cy.upper, Sv, E);
    segment(cy.fore, E, H);
    cy.elbow.position.copy(E);

    cy.hand.position.copy(H);
    var vdir = tri(phaseAt(f, gt) + 0.001) - tri(phaseAt(f, gt)) >= 0 ? 1 : -1;
    // 진행 방향으로 살짝 끌리듯 기운다 — 방향이 눈에 보여야 예측이 된다
    cy.hand.rotation.set(0.06 * vdir, 0, -vdir * 0.22 + Math.sin(s.wall * 1.7) * 0.04);
    for (i = 0; i < cy.fingers.length; i++) {
      var fg = cy.fingers[i];
      var curl = 0.26 + Math.sin(s.wall * 3.1 + fg.ph) * 0.24 + grip * 0.85;
      fg.g.rotation.z = fg.base + curl * 0.30;
      fg.j.rotation.z = -curl;
    }
    cy.thumb.rotation.z = -0.75 + Math.sin(s.wall * 2.6) * 0.18;
    // 고개는 손을 따라 아주 조금 움직인다 (귀로 좇는다)
    cy.head.rotation.y = 0.30 + off * 0.055;
    cy.torso.rotation.y = 0.10 + off * 0.025;

    /* 손 그림자 — 지금 양의 안전 반경 그대로 */
    var nb = nearestSheep(s);
    var wantR = nb ? nb.r : 1.17;
    s.shadowR = s.shadowR == null ? wantR : lerp(s.shadowR, wantR, 1 - Math.pow(0.002, dt || 0.016));
    var sr = Math.max(0.34, s.shadowR);
    s.handShadow.position.x = hx;
    s.handShadow.scale.set(sr, 1, sr * 0.72);
    s.handShadow.material.opacity = 0.42 + 0.30 * clamp(sr / 1.8, 0, 1);

    /* ★ 붉은 위험 범위 — "지금 누르면" 손이 가 있을 자리 (gt + lead).
       이게 빛웅덩이를 덮고 있으면 눌러도 못 나간다. 눈으로 그대로 보인다. */
    var jx = C.gate + handOff(f, gt + C.lead);
    s.band.position.x = jx;
    s.band.scale.x = sr;
    var mid = (hx + jx) * 0.5, span = Math.abs(jx - hx) + sr * 1.7;
    s.bandTrail.position.x = mid;
    s.bandTrail.scale.set(span, C.bandZ * 1.15, 1);
    updateGauge(s, dt || 0.016);

    /* 양 */
    var kindsOrd = ['big', 'mid', 'sml'], k;
    for (k = 0; k < kindsOrd.length; k++) s.inst[kindsOrd[k]].mesh.count =
      s.inst[kindsOrd[k]].mesh.instanceMatrix.count;
    var dm = s.dummy, cN = 0;
    for (i = 0; i < f.list.length; i++) {
      var sh = f.list[i];
      var x = sheepX(sh, gt);
      var bob = Math.sin(gt * 5.4 + sh.bob) * 0.028 * sh.scale;
      var lean = Math.sin(gt * 5.4 + sh.bob + 1.2) * 0.045;
      var y = bob, hide = false;
      if (x < -13 || x > C.exitX + 2.5) hide = true;
      dm.position.set(x, y, C.sheepZ + Math.sin(sh.bob) * 0.16);
      dm.rotation.set(0, 0, lean);
      dm.scale.setScalar(hide ? 0.0001 : sh.scale);
      dm.updateMatrix();
      var slot = s.inst[sh.k];
      slot.mesh.setMatrixAt(sh.slot, dm.matrix);

      // 그림자가 양 위를 덮으며 지나간다
      var cover = clamp(1 - Math.abs(x - hx) / (sr + 0.30), 0, 1);
      var lit = clamp((x - C.gate + 2.2) / 5.6, 0, 1);
      var atGate = Math.exp(-Math.pow((x - C.gate) / 1.7, 2));
      var v = (0.62 + lit * 0.42 + atGate * 0.34) * (1 - 0.74 * cover);
      if (sh === nb) { s.dbgCover = cover; s.dbgV = v; }
      s.tmpC.setRGB(v, v * (1 - 0.04 * cover), v * (1 - 0.11 * cover));
      slot.mesh.setColorAt(sh.slot, s.tmpC);

      // 접지 그림자
      dm.position.set(x, 0.01, C.sheepZ + Math.sin(sh.bob) * 0.16);
      dm.rotation.set(-Math.PI / 2, 0, 0);
      dm.scale.set(hide ? 0.0001 : sh.scale * 0.78, hide ? 0.0001 : sh.scale * 0.5, 1);
      dm.updateMatrix();
      s.contact.setMatrixAt(cN++, dm.matrix);
    }
    for (k = 0; k < kindsOrd.length; k++) {
      var im = s.inst[kindsOrd[k]].mesh;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    s.contact.instanceMatrix.needsUpdate = true;

    /* 부하들 */
    for (i = 0; i < s.crewMen.length; i++) {
      var man = s.crewMen[i];
      if (man.userData.done) continue;
      var ph = man.userData.ph;
      var fl = man.userData.flinch || 0;
      if (fl > 0) man.userData.flinch = Math.max(0, fl - (dt || 0.016));
      var duck = Math.sin(s.wall * 1.9 + ph) * 0.02 + (fl > 0 ? -0.07 : 0);
      man.position.y = man.userData.home.y + duck;
      man.rotation.x = 0.18 + (fl > 0 ? 0.25 : 0);
    }

    /* 나가는 부하들 */
    for (i = s.riders.length - 1; i >= 0; i--) {
      var rd = s.riders[i];
      rd.life += (dt || 0.016);
      var sx = sheepX(rd.sheep, gt);
      var sc = rd.sheep.scale;
      // 배 아래에 가로로 매달린 자리 — 카메라 쪽으로 살짝 빼야 실제로 보인다
      var belly = V.belly.set(sx - 0.34 * sc, 0.37 * sc, C.sheepZ +
                              Math.sin(rd.sheep.bob) * 0.16 + 0.36 * sc);
      if (rd.state === 'dash') {
        var t = clamp((gt - rd.t0) / C.lead, 0, 1);
        var p = rd.man.position;
        p.lerpVectors(rd.from, belly, smooth(t));
        p.y += Math.sin(t * Math.PI) * 0.22;
        rd.man.rotation.set(0.35 * t, 0, -Math.PI * 0.5 * t);
      } else if (rd.state === 'ride') {
        // 양 배를 붙잡고 미끄러져 나간다 — 머리가 진행 방향을 향한다
        rd.man.position.copy(belly);
        rd.man.rotation.set(0.22, 0, -Math.PI * 0.5 + Math.sin(gt * 5.4 + rd.sheep.bob) * 0.05);
        if (sx > C.exitX - 0.6) { rd.man.visible = false; s.riders.splice(i, 1); }
      } else if (rd.state === 'grab') {
        // 낚아채인다 — 손으로 끌려 올라간다
        var u = clamp(rd.life / 0.62, 0, 1);
        var tgt = V.tgt.set(s.handWorld.x, s.handWorld.y + 0.25, s.handWorld.z);
        rd.man.position.lerpVectors(belly, tgt, smooth(u));
        rd.man.rotation.set(-0.4 - u * 1.6, u * 3.4, 0.8 * u);
        rd.man.scale.setScalar((rd.man.userData.base || 1) * (1 - u * 0.25));
        if (u >= 1) { rd.man.visible = false; s.riders.splice(i, 1); }
      }
    }

    /* 화면 흔들림 */
    if (s.camera && s.camBase) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - (dt || 0.016) * 2.4);
        var m = s.shake * s.shake * 0.42;
        s.camera.position.set(
          s.camBase.x + (s.rnd() * 2 - 1) * m,
          s.camBase.y + (s.rnd() * 2 - 1) * m,
          s.camBase.z + (s.rnd() * 2 - 1) * m * 0.5);
      } else s.camera.position.copy(s.camBase);
    }

    /* 입구 빛이 아주 조금 흔들린다 */
    if (s.warm) s.warm.intensity = 24 + Math.sin(s.wall * 1.3) * 2.5;

    /* ★ 게이트 깜빡임 — 매달릴 양이 없을 때 눌렀다는 대답.
       판정선이 한 번 밝아졌다 꺼진다: "여기가 지금 비어 있다". */
    if (s.gatePool) {
      var gb = 0;
      if (s.gateBlink > 0) {
        // 진짜 dt 로만 삭는다 — 시계를 얼리면(dt=0) 깜빡임도 멈춰야 계측이 된다
        s.gateBlink = Math.max(0, s.gateBlink - (dt || 0));
        gb = Math.sin(clamp(1 - s.gateBlink / C.blink, 0, 1) * Math.PI);
      }
      s.gatePool.material.opacity = 0.42 + 0.44 * gb;
      s.gatePool.scale.set(1.15 + 0.46 * gb, 1, 0.85 + 0.34 * gb);
    }
  }

  /* ── ★ 타이밍 게이지 ────────────────────────────────────────────────
     트랙 = 이 양의 안전 창 전체(길이 = win × gPx). 왼끝이 창이 열리는 순간,
     오른끝이 닫히는 순간이다. 초록은 오른끝에 붙어 "남은 안전 시간"만큼 남고,
     시간이 흐르면 오른쪽으로 줄어든다. 위험 구간에서는 트랙이 붉어지고,
     왼끝 바깥에서 붉은 토막이 다가온다 — 닿는 순간 창이 다시 열린다.       */
  function updateGauge(s, dt) {
    var G = s.gauge, ga = null, L, pr, fl, rl;
    if (G.hold > 0) {                       // 누른 직후: 그 순간을 얼려 보여준다
      // 다음 양이 벌써 게이트에 들어왔으면 붙잡아 두지 않는다 — 게이지는 지금 양의 것이다
      if (s.phase === 'run' && s.waiting > 0 && !s.pending) {
        var nx = activeSheep(s);
        if (nx && nx !== G.sheep) G.hold = Math.min(G.hold, 0.26);
      }
      G.hold = Math.max(0, G.hold - dt);
      G.alpha = G.hold > 0.40 ? 1 : G.hold / 0.40;
    } else {
      G.dead = 0;                          // 붙잡아 두던 게 끝났다 — 다시 살아 있는 자다
      if (s.phase === 'run' && s.waiting > 0 && !s.pending) ga = activeSheep(s);
      if (ga) {
        L = ga.win * C.gPx;
        pr = probe(s.flock, s.gt + C.lead, ga.r);
        G.len = L;
        if (pr.safe) {
          fl = clamp(pr.remain, 0, ga.win) * C.gPx;
          G.fillL = fl; G.fillC = L * 0.5 - fl * 0.5; G.danger = 0;
        } else {
          // 위험: 붉은 토막이 왼끝을 향해 줄어든다. 다 빠지는 순간 창이 열린다.
          rl = Math.min(pr.toExit * C.gPx, L);
          G.fillL = rl; G.fillC = -L * 0.5 + rl * 0.5; G.danger = 1;
        }
        G.alpha = Math.min(1, G.alpha + dt * 7);
        G.markOn = Math.max(0, G.markOn - dt * 3);
      } else {
        G.alpha = Math.max(0, G.alpha - dt * 5);
      }
    }

    /* dead = 이미 써 버린 게이지. 흐려지는 게 아니라 **색을 잃는다.**
       흐리게만 하면 마커가 어디에 찍혔는지까지 같이 사라진다 — 그건 실패 설명을
       지우는 짓이다. 그래서 밝기는 지키고 초록·빨강만 걷어낸다.
       "지금 누를 수 있다"는 초록은 살아 있는 게이지만 낼 수 있는 색이다. */
    var dead = !!G.dead;
    var a = G.alpha;
    G.grp.visible = a > 0.012;
    if (!G.grp.visible) return;
    var w = Math.max(0.02, G.len);
    // 바닥의 붉은 발광 위에서도 막대가 떠 보이게 — 검은 판을 넓고 진하게 깐다.
    // 이게 없으면 위험(빨강) 게이지가 게이트의 주황 웅덩이에 그대로 묻힌다.
    G.back.scale.set(w + 0.19, C.gH * 2.15, 1);
    G.back.material.opacity = 0.90 * a;
    G.track.scale.set(w, C.gH, 1);
    G.track.material.opacity = (dead ? 0.52 : (G.danger ? 0.62 : 0.50)) * a;
    G.track.material.color.setHex(dead ? 0xa79c8c : (G.danger ? 0xff7a52 : 0xffcf8a));
    G.capL.position.x = -w * 0.5; G.capR.position.x = w * 0.5;
    G.capL.scale.set(0.05, C.gH * 2.15, 1);
    G.capR.scale.set(0.05, C.gH * 2.15, 1);
    G.capL.material.opacity = G.capR.material.opacity = (dead ? 0.46 : 0.62) * a;
    G.fill.visible = G.fillL > 0.006;
    if (G.fill.visible) {
      G.fill.position.x = G.fillC;
      G.fill.scale.set(G.fillL, C.gH * 0.74, 1);
      G.fill.material.color.setHex(dead ? 0x8d8474 : (G.danger ? 0xff5334 : 0x63e79b));
      G.fill.material.opacity = (dead ? 0.44 : (G.danger ? 0.85 : 0.95)) * a;
    }
    G.mark.visible = G.markOn > 0.02;
    if (G.mark.visible) {
      G.mark.position.x = G.markX;
      G.mark.scale.set(0.075, C.gH * 2.5, 1);
      G.mark.material.color.setHex(G.markCol);
      // 마커만은 죽이지 않는다 — 잔상 위에 남는 유일하게 또렷한 것
      G.mark.material.opacity = 0.96 * G.alpha * Math.min(1, G.markOn * 2.2);
    }
  }

  /* 누른 순간을 게이지 위에 찍는다 — 안전 창 밖이면 어느 쪽으로 빗나갔는지 */
  function markPress(s, sh) {
    var G = s.gauge, L = sh.win * C.gPx;
    var pr = probe(s.flock, s.gt + C.lead, sh.r);
    G.len = L; G.sheep = sh;
    if (pr.safe) {
      G.markX = L * 0.5 - clamp(pr.remain, 0, sh.win) * C.gPx;
      G.fillL = clamp(pr.remain, 0, sh.win) * C.gPx;
      G.fillC = L * 0.5 - G.fillL * 0.5;
      G.danger = 0; G.markCol = 0xfff3d2;
    } else {
      G.markX = pr.late ? (L * 0.5 + Math.min(pr.sinceIn, 0.65) * C.gPx)
                        : (-L * 0.5 - Math.min(pr.toExit, 0.65) * C.gPx);
      G.fillL = 0; G.danger = 1; G.markCol = 0xff9b73;
    }
    /* ★ 이 양은 여기서 끝났다 — 게이지는 이 순간부터 '지난 것'이다.
       초록인 채로 남겨두면 "초록인데 왜 안 나가지"가 된다. 회색으로 죽인다.
       마커와 트랙은 남긴다: 어디를 눌렀고 창이 어디였는지는 계속 읽혀야 한다. */
    G.dead = 1;
    G.markOn = 1; G.alpha = 1; G.hold = C.gHold;
  }

  function segment(mesh, a, b) {
    var V = S.v;
    var mid = V.a.addVectors(a, b).multiplyScalar(0.5);
    var d = V.b.subVectors(b, a);
    var len = Math.max(0.01, d.length());
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(V.up, d.normalize());
    mesh.scale.y = len;
  }

  /* ══════════════════════════════════════════════════════════════════════
     12. 흐름 제어
     ════════════════════════════════════════════════════════════════════ */
  function start() {
    if (!S) return;
    if (S.phase === 'over') reset();
    S.phase = 'run';
    S.snd.resume();
    S.hud.end(null);
    S.hud.hint(!S.gotOne);          // 조작은 시작에 한 번만 말한다
  }
  function pause() { if (S && S.phase === 'run') S.phase = 'pause'; }

  function reset() {
    var s = S;
    if (!s) return;
    s.gt = 0; s.freeze = 0; s.shake = 0; s.endAt = null;
    s.waiting = C.crew; s.escaped = 0; s.caught = 0;
    s.pending = null; s.riders.length = 0;
    s.cuedOnce = false; s.cueOn = false; s.result = null;
    s.snatchOn = false; s.snatchT = 0;
    s.lastPress = -9; s.bleatAt = 2.4; s.gotOne = false;
    s.gateBlink = 0; s.flashLock = -9;
    s.gauge.alpha = 0; s.gauge.markOn = 0; s.gauge.hold = 0;
    s.gauge.fillL = 0; s.gauge.danger = 0; s.gauge.sheep = null; s.gauge.dead = 0;
    var i;
    for (i = 0; i < s.marks.length; i++) s.marks[i] = '';
    for (i = 0; i < s.flock.list.length; i++) {
      s.flock.list[i].used = false;
      s.flock.list[i].out = false;
      s.flock.list[i].rider = null;
    }
    for (i = 0; i < s.crewMen.length; i++) {
      var m = s.crewMen[i];
      m.visible = true; m.scale.setScalar(m.userData.base || 1);
      m.position.copy(m.userData.home);
      m.rotation.set(0.18, m.rotation.y, 0);
      m.userData.done = false; m.userData.flinch = 0;
    }
    s.hud.end(null); s.hud.cue(false); s.hud.hint(false); s.hud.flash('');
    s.phase = 'ready';
    refreshHud(s);
    frame(s, 0);
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try { if (s.onKey) window.removeEventListener('keydown', s.onKey, false); } catch (e) { }
    try { if (s.onDown && s.inputTarget) s.inputTarget.removeEventListener('pointerdown', s.onDown, false); } catch (e) { }
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
     13. 단독 실행 — 렌더러·씬·카메라까지 이 파일이 세운다
     ════════════════════════════════════════════════════════════════════ */
  function mount(canvas, opts) {
    opts = opts || {};
    T3 = window.THREE;
    var renderer = new T3.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 1100, canvas.clientHeight || 820, false);
    renderer.setClearColor(COL.bg, 1);
    var scene = new T3.Scene();
    scene.background = new T3.Color(COL.bg);
    scene.fog = new T3.Fog(COL.bg, 22, 46);
    var camera = new T3.PerspectiveCamera(52, 1, 0.5, 200);
    scene.add(camera);
    var root = new T3.Group();
    scene.add(root);

    var st = init(root, opts.ui || null, {
      camera: camera, renderer: renderer, canvas: canvas, scene: scene,
      seed: opts.seed, hudHost: opts.hudHost, endPanel: opts.endPanel,
      bindInput: opts.bindInput
    });
    resize(canvas.clientWidth, canvas.clientHeight);

    if (opts.loop !== false) {
      var last = 0;
      var tick = function (t) {
        if (!S) return;
        S.raf = requestAnimationFrame(tick);
        var dt = last ? (t - last) / 1000 : 0.016;
        last = t;
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
     14. 디버그 스냅샷
     ════════════════════════════════════════════════════════════════════ */
  function state() {
    var s = S;
    if (!s) return { ready: false };
    var a = activeSheep(s);
    var off = handOff(s.flock, s.gt);
    return {
      ready: true, phase: s.phase,
      gt: +s.gt.toFixed(2),
      waiting: s.waiting, escaped: s.escaped, caught: s.caught,
      sheepLeft: (function () {
        var n = 0, i;
        for (i = 0; i < s.flock.list.length; i++) if (!s.flock.list[i].out) n++;
        return n;
      })(),
      active: a ? { i: a.i, k: a.k, r: +a.r.toFixed(2), win: a.win } : null,
      handOff: +off.toFixed(2),
      safeNow: a ? Math.abs(handOff(s.flock, s.gt + C.lead)) >= a.r : null,
      nearNow: a ? judge(s.flock, s.gt + C.lead, a.r).near : null,
      lateNow: a ? judge(s.flock, s.gt + C.lead, a.r).late : null,
      shadowR: s.shadowR ? +s.shadowR.toFixed(2) : null,
      // 보이게 한 것들이 실제로 어떤 값으로 그려지는지
      gauge: s.gauge ? {
        len: +s.gauge.len.toFixed(2), fill: +s.gauge.fillL.toFixed(2),
        danger: s.gauge.danger, dead: s.gauge.dead ? 1 : 0,
        alpha: +s.gauge.alpha.toFixed(2),
        mark: +s.gauge.markX.toFixed(2), markOn: +s.gauge.markOn.toFixed(2)
      } : null,
      band: { x: +(C.gate + handOff(s.flock, s.gt + C.lead)).toFixed(2),
              r: s.shadowR ? +s.shadowR.toFixed(2) : null,
              overGate: Math.abs(handOff(s.flock, s.gt + C.lead)) < (s.shadowR || 1) },
      cover: s.dbgCover == null ? null : +s.dbgCover.toFixed(2),
      shade: s.dbgV == null ? null : +s.dbgV.toFixed(2),
      pending: !!s.pending,
      result: s.result || null,
      flockSec: +s.flock.total.toFixed(1)
    };
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
    simulate: simulate,
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
