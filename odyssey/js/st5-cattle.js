/* ============================================================================
   오디세이아 / ODYSSEY — st5-cattle.js  →  OD.St5
   5편 「헬리오스의 소」 — 한 버튼 배분 액션 (STAGES-3-6.md "# 5편")
   ----------------------------------------------------------------------------
   이 파일 하나가 5편의 전부를 소유한다: 장면 · 게임루프 · 입력 · 규칙 · 게이지 ·
   피드백 · 결과 카드.

   OD.St5.mount(root, ui, opts) -> stage    root = THREE.Object3D | canvas | div
   OD.St5.press(down)                       탭 전용 — down=true 만 처리한다
   OD.St5.update(dt)
   OD.St5.onEnd = fn({ win, lost, survived, crew, day, ... })
   OD.St5.dispose()

   보조: init / start / pause / reset / resize / setCrew / state / simulate / skipTo

   ── 동사: 배분 탭 ────────────────────────────────────────────────────────
   1편은 "순간에 탭", 2편은 "누르고 있다 놓기". 5편은 **한 국자씩 나눠 주기**다.
   짧고 잦은 판단이 2분 내내 70여 번 이어진다.

   ── 규칙 (게이지가 가르친다) ─────────────────────────────────────────────
   부하 여섯의 굶주림 막대가 각자 다른 속도로 오른다. 누르면 **가장 굶주린
   사람**에게 한 국자(R=0.60)가 간다. 막대마다 구간이 셋이다.

     0 ─ R      어둡다   : 여기서 부으면 국자가 넘쳐 **흘린다** (R−h 만큼 손실)
     R ─ T      금색     : **지금.** 한 방울도 안 흘리고 다 들어간다
     T ─ 1      붉다     : **늦었다.** 소를 보기 시작하고 굶주림이 1.75배로 빨라진다
     1 을 넘으면          : 일어나 언덕으로 걸어간다. 1.5초 안에 붙잡지 못하면
                            소에 손을 댄다 → 제우스의 벼락 → **전멸**

   식량은 88국자, 완벽하게 배분해야 겨우 닿는 양이다. 신화대로 지는 게 기본이고
   완벽에 가까우면 엿새를 버텨 바람이 돌아온다 — 그때만 특별 카드가 나온다.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St5 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — 밸런스는 전부 여기서만 바뀐다
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    lines: 6,             // 굶주림 막대 = 부하 여섯 줄
    CREW: 6,              // opts.crew 로 덮어쓴다 (편을 관통하는 부하 수)

    DAYS: 6,              // 엿새를 버티면 바람이 돌아온다
    DAYLEN: 22.0,         // 하루 (초) → 총 132초 ≈ 2분 12초

    R: 0.60,              // 한 국자가 내리는 굶주림 = 금색 구간이 시작하는 선
    T: 0.80,              // 유혹선 — 이 위에서는 소를 본다
    TMUL: 2.55,           // 유혹선 위에서 굶주림이 빨라지는 배수
    COOL: 0.42,           // 국자 재장전 (항아리로 갔다 온다)
    BUF: 0.14,            // 입력 버퍼 — 재장전 직전 누름을 살려 준다
    GRACE: 1.50,          // 한계를 넘고 소에 닿기까지 (마지막 기회)
    FOOD: 99,             // 남은 국자

    // 여섯의 굶주림 속도 (units/s) — 속도가 다르니 순서가 계속 바뀐다
    rate: [0.0400, 0.0505, 0.0345, 0.0570, 0.0455, 0.0385],
    // 첫날부터 이미 배가 고프다 — 시작하자마자 첫 국자를 부을 수 있게
    h0:   [0.44, 0.31, 0.52, 0.26, 0.39, 0.35],
    // 날이 갈수록 몸이 상한다
    dayMul: [1.00, 1.20, 1.42, 1.68, 2.00, 2.40],

    ahead: 3.0,           // 예고 눈금 — "이 속도면 3초 뒤 여기"

    /* ── 장면 좌표 ── */
    crewZ: 2.0,
    crewGap: 1.30,
    barY: 1.40,           // 막대 바닥 (앉은 부하 머리 위, 늘 같은 높이)
    barH: 1.95,           // 화면에서 가장 큰 정보 — 크게 세운다
    barW: 0.54,
    barZ: 2.26,
    potX: -4.05, potZ: 2.35,
    hillX: 4.6, hillZ: -14.5,

    /* 카메라 — halfW/halfH = 반드시 담아야 할 반폭·반높이.
       spread = 부하 여섯 줄을 가로로 얼마나 벌릴지. 세로 화면에서는 줄을 좁혀야
       (아니면 halfW 가 커지고 → 세로 시야가 같이 늘어나 막대가 콩알이 된다) */
    camL: { fov: 42, halfW: 6.55, halfH: 3.95, fx: 0.15, fy: 2.60, camY: 4.15,
            spread: 1.00, pot: [-4.05, 2.35] },
    camP: { fov: 50, halfW: 3.30, halfH: 5.00, fx: 0.05, fy: 2.55, camY: 5.60,
            spread: 0.68, pot: [0.05, 5.50] }
  };

  /* 색 — 뜨겁고 바람 한 점 없는 낮. 소만 금빛이다. */
  var COL = {
    bg: 0x8bbcd8,
    sky: 0x86b9d8,
    skyHaze: 0xf2e2bc,
    sea: 0x2a6f92,
    seaLine: 0xbfe2ef,
    sand: 0xd2ae80,
    sandDark: 0xb18d5e,
    sandFore: 0x8b6a45,
    hill: 0x9d9a5c,
    hillDark: 0x77743f,
    cow: 0xf6c750,
    cowDark: 0xcf9a26,
    cowHorn: 0xf7ecc9,
    hull: 0x5d4029,
    hullDark: 0x3c2a1b,
    mast: 0x6d4c31,
    sail: 0xece2c9,
    tunic: 0xc4593f,
    tunic2: 0x9d5b7a,
    skin: 0xc59a6d,
    hair: 0x2e241c,
    odyBlue: 0x3f5580,
    pot: 0x8a5a3a,
    potDark: 0x5d3b25,
    ladle: 0x7a5636,
    grain: 0xf3dda0,
    sun: 0xfff3cf
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
  function approach(cur, want, dt, k) { return cur + (want - cur) * (1 - Math.pow(k, dt * 60)); }

  var DAYNAME = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째'];

  /* ══════════════════════════════════════════════════════════════════════
     2. 순수 모델 — 화면 없이도 똑같이 굴러간다 (아래 simulate 가 이걸 쓴다)
     ════════════════════════════════════════════════════════════════════ */
  function newGame(seed, crew) {
    var rnd = makeRng(seed || 20260814);
    var men = [], i;
    for (i = 0; i < C.lines; i++) {
      men.push({
        i: i,
        h: C.h0[i],
        rate: C.rate[i],
        state: 'sit',        // sit | tempt | walk | gone
        walk: 0,             // 언덕으로 걸어간 시간
        look: 0,             // 소를 보는 정도 0..1 (연출)
        served: 0,
        ph: rnd() * 6.283
      });
    }
    return {
      t: 0, day: 1, food: C.FOOD, cool: 0,
      men: men,
      poured: 0, spilled: 0, perfect: 0, late: 0, early: 0, saved: 0,
      over: false, win: false, doomWho: -1, ranOut: false,
      crew: crew == null ? C.CREW : crew
    };
  }

  function dayIdx(g) { return clamp(Math.floor(g.t / C.DAYLEN), 0, C.DAYS - 1); }
  function dayMul(g) { return C.dayMul[dayIdx(g)]; }
  /* 지금 이 사람의 실제 굶주림 속도 — 유혹선 위에서는 스스로 빨라진다 */
  function rateOf(g, m) { return m.rate * dayMul(g) * (m.h >= C.T ? C.TMUL : 1); }

  /* 급한 순서: 걸어가는 사람이 무조건 먼저, 그 다음은 막대가 높은 순 */
  function urg(m) { return m.state === 'walk' ? (2 + m.walk) : m.h; }
  function target(g) {
    var best = null, i, m;
    for (i = 0; i < g.men.length; i++) {
      m = g.men[i];
      if (m.state === 'gone') continue;
      if (!best || urg(m) > urg(best)) best = m;
    }
    return best;
  }

  function advance(g, dt) {
    if (g.over) return;
    g.t += dt;
    g.day = dayIdx(g) + 1;
    g.cool = Math.max(0, g.cool - dt);
    var dm = dayMul(g), i, m;
    for (i = 0; i < g.men.length; i++) {
      m = g.men[i];
      if (m.state === 'gone') continue;
      m.h += m.rate * dm * (m.h >= C.T ? C.TMUL : 1) * dt;
      if (m.h >= 1) {
        if (m.state !== 'walk') { m.state = 'walk'; m.walk = 0; }
        m.walk += dt;
        if (m.h > 1.34) m.h = 1.34;
        if (m.walk >= C.GRACE) {
          g.over = true; g.win = false; g.doomWho = i;
          return;
        }
      } else {
        m.state = (m.h >= C.T) ? 'tempt' : 'sit';
        m.walk = 0;
      }
    }
    if (g.t >= C.DAYS * C.DAYLEN) { g.over = true; g.win = true; g.day = C.DAYS; }
  }

  /* 한 국자 — 이 게임의 유일한 행동 */
  function pour(g) {
    if (g.over) return { ok: false, why: 'over' };
    if (g.cool > 0) return { ok: false, why: 'cool' };
    if (g.food <= 0) { g.ranOut = true; return { ok: false, why: 'nofood' }; }
    var m = target(g);
    if (!m) return { ok: false, why: 'none' };

    var h0 = m.h;
    var give = Math.min(C.R, h0);      // 배가 덜 비었으면 남은 만큼만 들어간다
    var spill = C.R - give;            // 나머지는 모래에 쏟아진다
    var walked = (m.state === 'walk');

    m.h = Math.max(0, h0 - give);
    m.state = 'sit'; m.walk = 0; m.served++;
    g.food--; g.cool = C.COOL; g.poured++; g.spilled += spill;

    var kind = spill > 0.0005 ? 'early' : (h0 > C.T ? 'late' : 'perfect');
    if (kind === 'early') g.early++;
    else if (kind === 'late') g.late++;
    else g.perfect++;
    if (walked) g.saved++;

    return { ok: true, i: m.i, h0: h0, give: give, spill: spill,
             kind: kind, saved: walked };
  }

  function resultOf(g) {
    var lost = g.win ? 0 : g.crew;
    return {
      stage: 'cattle',
      win: !!g.win,
      lost: lost,
      survived: g.crew - lost,
      crew: g.crew,
      day: g.day,
      dayName: DAYNAME[clamp(g.day - 1, 0, 6)],
      t: +g.t.toFixed(1),
      food: g.food,
      poured: g.poured,
      spilled: +g.spilled.toFixed(2),
      perfect: g.perfect, late: g.late, early: g.early, saved: g.saved,
      ranOut: !!g.ranOut,
      doomWho: g.doomWho,
      reason: g.win ? 'wind' : (g.ranOut ? 'starved' : 'burst')
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시뮬레이션 — "식량이 모자라도록 설계되었다"를 수치로 확인한다
        policy: 'spam' | 'band' | 'late' | 'human' | 'thresh'
     ════════════════════════════════════════════════════════════════════ */
  function simulate(o) {
    o = o || {};
    var policy = o.policy || 'band';
    var jit = o.jitter == null ? 0 : o.jitter;
    var rnd = makeRng(o.seed || 5150);
    var g = newGame(o.seed || 5150, o.crew == null ? C.CREW : o.crew);
    var dt = 1 / 120, guard = 0, th = o.thresh == null ? C.R : o.thresh;
    var lag = 0, lapse = o.lapse || 0;
    while (!g.over && guard++ < 60000) {
      advance(g, dt);
      if (g.over) break;
      if (lag > 0) { lag -= dt; continue; }
      if (g.cool <= 0 && g.food > 0) {
        var m = target(g), want = false;
        if (m.state === 'walk') want = true;
        else if (policy === 'spam') want = true;
        else if (policy === 'late') want = m.h >= C.T;
        else if (policy === 'thresh') want = m.h >= th;
        else if (policy === 'human') want = m.h >= (C.R + (rnd() * 2 - 1) * jit);
        else want = m.h >= C.R;                    // 'band' — 완벽한 배분
        if (want) {
          pour(g);
          if (jit > 0) lag = rnd() * jit * 0.5;
          if (lapse > 0 && rnd() < lapse) lag = 0.8 + rnd() * 1.3;  // 한눈판다
        }
      }
    }
    var r = resultOf(g);
    r.policy = policy;
    r.jitter = jit;
    r.lapse = lapse;
    return r;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 지오메트리 헬퍼 — 여러 도형을 색 속성 하나로 합친다
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
     ════════════════════════════════════════════════════════════════════ */
  function makeAudio(rnd) {
    var ctx = null, master = null, noise = null;
    var droneOsc = null, droneG = null, droneF = null;
    var on = true, ready = false;

    function ensure() {
      if (ctx || !on) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return null; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.5;
        master.connect(ctx.destination);

        var len = Math.floor(ctx.sampleRate * 1.2);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        // 굶주림이 높을수록 커지는 낮은 불안 — 화면 밖의 압박
        droneOsc = ctx.createOscillator();
        droneOsc.type = 'sawtooth'; droneOsc.frequency.value = 47;
        droneF = ctx.createBiquadFilter();
        droneF.type = 'lowpass'; droneF.frequency.value = 160; droneF.Q.value = 3;
        droneG = ctx.createGain(); droneG.gain.value = 0;
        droneOsc.connect(droneF); droneF.connect(droneG); droneG.connect(master);
        droneOsc.start();
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
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(bp); bp.connect(g); g.connect(master);
        s.start(t); s.stop(t + dur + 0.02);
      } catch (e) { }
    }

    return {
      resume: resume,
      get ready() { return ready; },
      /* 국자가 알곡을 붓는다 — 마른 소리 */
      pourGood: function () { burst(2400, 1.1, 0.16, 0.10); tone('sine', 760, 1180, 0.13, 0.13); },
      /* 넘쳐 흘렀다 — 둔하게 떨어진다 */
      pourSpill: function (a) {
        burst(520, 0.7, 0.24, 0.06 + 0.10 * a);
        tone('sine', 250, 120, 0.20, 0.10);
      },
      /* 늦었다 — 낮게 눌린 소리 */
      pourLate: function () { burst(1300, 1.4, 0.14, 0.07); tone('sine', 380, 300, 0.16, 0.10); },
      /* 걸어가던 사람을 붙잡았다 */
      pullBack: function () {
        tone('triangle', 300, 720, 0.22, 0.20);
        tone('sine', 600, 1100, 0.18, 0.10, 0.05);
      },
      empty: function () { burst(240, 1.4, 0.10, 0.07); },
      cool: function () { burst(900, 3.0, 0.05, 0.030); },
      /* 하루가 지난다 */
      day: function () { tone('sine', 196, 196, 1.10, 0.11); tone('sine', 294, 294, 0.95, 0.06); },
      /* 소 울음 */
      moo: function (p) {
        if (!ctx) return;
        try {
          var o = ctx.createOscillator(), g = ctx.createGain(),
              lp = ctx.createBiquadFilter(), t = now();
          o.type = 'sawtooth'; o.frequency.setValueAtTime(96 + p * 22, t);
          o.frequency.linearRampToValueAtTime(78 + p * 16, t + 0.75);
          lp.type = 'lowpass'; lp.frequency.value = 620;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.075, t + 0.10);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
          o.connect(lp); lp.connect(g); g.connect(master);
          o.start(t); o.stop(t + 0.9);
        } catch (e) { }
      },
      /* 누군가 일어섰다 */
      rise: function () { tone('sawtooth', 150, 330, 0.45, 0.14); burst(420, 1.0, 0.35, 0.07); },
      /* 제우스의 벼락 */
      bolt: function () {
        burst(3600, 0.5, 0.10, 0.34);
        burst(900, 0.4, 0.85, 0.30, 0.03);
        tone('sine', 70, 26, 1.60, 0.42, 0.02);
        tone('sawtooth', 240, 40, 1.20, 0.14, 0.05);
      },
      /* 바람이 돌아온다 */
      wind: function () {
        burst(700, 0.4, 1.6, 0.16);
        tone('sine', 392, 588, 0.60, 0.16);
        tone('sine', 588, 784, 0.70, 0.12, 0.16);
      },
      unease: function (lv) {
        if (!ctx || !droneG) return;
        try {
          droneG.gain.setTargetAtTime(0.006 + 0.10 * lv * lv, now(), 0.25);
          droneF.frequency.setTargetAtTime(120 + 200 * lv, now(), 0.3);
        } catch (e) { }
      },
      mute: function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () {
        try { if (droneOsc) droneOsc.stop(); } catch (e) { }
        try { if (ctx) ctx.close(); } catch (e) { }
        ctx = null;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. HUD — 최소한만. 규칙은 막대가 가르친다.
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st5-css';
  var CSS = [
    '.st5{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#fdf6e6;-webkit-user-select:none;user-select:none;z-index:5}',
    '.st5 .bar{position:absolute;left:0;right:0;top:0;display:flex;',
    'justify-content:space-between;align-items:flex-start;padding:13px 15px;gap:12px;',
    'background:linear-gradient(180deg,rgba(24,14,4,.42) 0%,rgba(24,14,4,.20) 55%,',
    'rgba(24,14,4,0) 100%);padding-bottom:26px}',

    /* 남은 식량 — 이 판에서 가장 큰 숫자 */
    '.st5 .food{min-width:132px}',
    '.st5 .food .row{display:flex;align-items:baseline;gap:7px}',
    '.st5 .food b{font-size:2.3rem;line-height:1;font-weight:800;letter-spacing:-.03em;',
    'text-shadow:0 2px 12px rgba(20,10,0,.85);font-variant-numeric:tabular-nums}',
    '.st5 .food i{font-style:normal;font-size:.86rem;font-weight:700;opacity:.85;',
    'text-shadow:0 2px 8px rgba(20,10,0,.9)}',
    '.st5 .food .tr{margin-top:6px;height:7px;border-radius:99px;',
    'background:rgba(24,14,4,.45);overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.4)}',
    '.st5 .food .fi{height:100%;width:100%;border-radius:99px;background:#f3dda0;',
    'transition:width .18s linear,background .3s}',
    '.st5 .food.low b{color:#ffb56b}',
    '.st5 .food.low .fi{background:#ff9a4d}',
    '.st5 .food.out b{color:#ff7a63}',
    '.st5 .food.out .fi{background:#e2543c}',

    /* 날짜 — 여섯 칸 */
    '.st5 .day{text-align:right}',
    '.st5 .day s{display:block;text-decoration:none;font-size:1.02rem;font-weight:800;',
    'text-shadow:0 2px 10px rgba(20,10,0,.9)}',
    '.st5 .day .pips{display:flex;gap:5px;justify-content:flex-end;margin-top:7px}',
    '.st5 .day .pip{width:15px;height:7px;border-radius:2px;background:rgba(24,14,4,.42);',
    'box-shadow:inset 0 0 0 1px rgba(255,240,200,.35)}',
    '.st5 .day .pip.on{background:#ffdf9c;box-shadow:0 0 8px rgba(255,215,130,.7)}',
    '.st5 .day .pip.now{background:#fff3cf;box-shadow:0 0 12px rgba(255,235,170,.95)}',

    /* 한 마디 — 국자의 결과 */
    '.st5 .flash{position:absolute;left:50%;top:77.5%;transform:translate(-50%,-50%);',
    'font-size:1.28rem;font-weight:800;opacity:0;white-space:nowrap;text-align:center;',
    'padding:6px 18px;border-radius:999px;background:rgba(20,12,4,.34);',
    'text-shadow:0 2px 14px rgba(15,8,0,.95),0 0 8px rgba(15,8,0,.8);',
    'transition:opacity .18s,top .45s}',
    '.st5 .flash.on{opacity:1;top:75%}',
    '.st5 .flash u{display:block;margin-top:3px;font-size:.9rem;font-weight:700;',
    'text-decoration:none;opacity:.9}',
    '.st5 .flash.on.soft{opacity:.8;font-size:1.04rem}',

    /* 곧 터진다 — 화면이 붉어지고 한 줄이 뜬다 */
    '.st5 .warn{position:absolute;left:50%;top:12.5%;transform:translate(-50%,0) scale(.94);',
    'font-size:1.12rem;font-weight:800;color:#ffd0bd;opacity:0;white-space:nowrap;',
    'padding:7px 16px;border-radius:999px;background:rgba(96,20,10,.62);',
    'text-shadow:0 2px 10px rgba(0,0,0,.9);transition:opacity .18s,transform .18s}',
    '.st5 .warn.on{opacity:1;transform:translate(-50%,0) scale(1)}',
    '.st5 .vig{position:absolute;inset:0;opacity:0;transition:opacity .25s;',
    'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 42%,rgba(150,26,10,.62) 100%)}',
    '.st5 .bolt{position:absolute;inset:0;background:#fffbf0;opacity:0;',
    'transition:opacity .10s}',

    /* 조작 안내 — 시작에 한 번만 */
    '.st5 .hint{position:absolute;left:50%;bottom:3.4%;transform:translateX(-50%);',
    'font-size:.9rem;font-weight:600;color:#fdf1da;opacity:0;white-space:nowrap;',
    'padding:7px 15px;border-radius:999px;background:rgba(28,16,4,.42);',
    'text-shadow:0 2px 10px rgba(0,0,0,.7);transition:opacity .5s}',
    '.st5 .hint.on{opacity:.92}',

    /* 결과 카드 */
    '.st5 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:14px;background:rgba(12,9,6,.88);',
    'opacity:0;pointer-events:none;visibility:hidden;',
    'transition:opacity .45s;text-align:center;padding:26px}',
    '.st5 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st5.done .bar,.st5.done .warn,.st5.done .flash{opacity:0;transition:opacity .3s}',
    '.st5 .end h2{font-size:1.62rem;font-weight:800;margin:0;letter-spacing:-.01em}',
    '.st5 .end p{font-size:1rem;color:#c8bda8;margin:0;line-height:1.75;max-width:30rem}',
    '.st5 .end em{font-style:italic;color:#e8c98c;font-size:.98rem;display:block;',
    'margin-top:2px;line-height:1.7}',
    '.st5 .end .stat{font-size:.86rem;color:#8e8474;letter-spacing:.01em}',
    '.st5 .end b{color:#ffd88f}',
    '.st5 .end.win h2{color:#ffe9a8}',
    '.st5 .end button{margin-top:8px;padding:11px 26px;border-radius:999px;',
    'border:1px solid #5b4c39;background:#1c1712;color:#f2e8d6;font-size:1rem;',
    'font-weight:700;cursor:pointer;font-family:inherit}',
    '.st5 .end button:active{transform:translateY(1px)}'
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
    el.className = 'st5';
    var pipHtml = '', i;
    for (i = 0; i < C.DAYS; i++) pipHtml += '<div class="pip"></div>';
    el.innerHTML =
      '<div class="vig"></div>' +
      '<div class="bar">' +
        '<div class="food"><div class="row"><b>88</b><i>국자</i></div>' +
          '<div class="tr"><div class="fi"></div></div></div>' +
        '<div class="day"><s>첫째 날</s><div class="pips">' + pipHtml + '</div></div>' +
      '</div>' +
      '<div class="warn"></div>' +
      '<div class="flash"><span></span><u></u></div>' +
      '<div class="hint">화면을 눌러 한 국자씩 나눠 준다</div>' +
      '<div class="bolt"></div>' +
      '<div class="end"><h2></h2><p></p><div class="stat"></div>' +
        '<button type="button">다시</button></div>';
    host.appendChild(el);

    var foodBox = el.querySelector('.food'),
        foodN = el.querySelector('.food b'),
        foodFi = el.querySelector('.food .fi'),
        dayS = el.querySelector('.day s'),
        pips = el.querySelectorAll('.day .pip'),
        warn = el.querySelector('.warn'),
        vig = el.querySelector('.vig'),
        bolt = el.querySelector('.bolt'),
        flash = el.querySelector('.flash'),
        fT1 = el.querySelector('.flash span'),
        fT2 = el.querySelector('.flash u'),
        hint = el.querySelector('.hint'),
        end = el.querySelector('.end'),
        endH = el.querySelector('.end h2'),
        endP = el.querySelector('.end p'),
        endS = el.querySelector('.end .stat'),
        endB = el.querySelector('.end button');

    var flashT = 0, lastFood = -1, lastDay = -1, lastWarn = '';

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },
      food: function (n, max) {
        if (n === lastFood) return;
        lastFood = n;
        foodN.textContent = String(n);
        foodFi.style.width = (100 * clamp(n / max, 0, 1)) + '%';
        foodBox.className = 'food' + (n <= 0 ? ' out' : (n <= max * 0.22 ? ' low' : ''));
      },
      day: function (d) {
        if (d === lastDay) return;
        lastDay = d;
        dayS.textContent = DAYNAME[clamp(d - 1, 0, 6)] + ' 날';
        for (var j = 0; j < pips.length; j++) {
          pips[j].className = 'pip' + (j < d - 1 ? ' on' : (j === d - 1 ? ' now' : ''));
        }
      },
      warn: function (txt) {
        if (txt === lastWarn) return;
        lastWarn = txt;
        if (!txt) { warn.className = 'warn'; return; }
        warn.textContent = txt;
        warn.className = 'warn on';
      },
      vig: function (a) { vig.style.opacity = String(clamp(a, 0, 1)); },
      bolt: function (a) { bolt.style.opacity = String(clamp(a, 0, 1)); },
      flash: function (txt, col, why, soft) {
        if (!txt) { flash.className = 'flash'; flashT = 0; return; }
        fT1.textContent = txt;
        fT2.textContent = why || '';
        flash.style.color = col;
        flash.className = soft ? 'flash on soft' : 'flash on';
        flashT = soft ? 0.60 : 1.05;
      },
      hint: function (on) { hint.className = on ? 'hint on' : 'hint'; },
      tick: function (dt) {
        if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.className = 'flash'; }
      },
      end: function (r) {
        el.className = r ? 'st5 done' : 'st5';
        if (!r) { end.className = 'end'; return; }
        if (r.win) {
          endH.textContent = '바람이 돌아왔다';
          endP.innerHTML = '엿새를 굶주림으로 버텼다. 소는 <b>한 마리도</b> 줄지 않았다.' +
            '<em>호메로스에서는 일어나지 않은 일입니다. 당신은 신화를 이겼습니다.</em>';
        } else {
          endH.textContent = '제우스의 벼락';
          endP.innerHTML = '<b>' + r.dayName + ' 날</b>, 오디세우스가 잠든 사이 ' +
            '부하들이 소를 잡았다.<br>벼락이 배를 쪼갰다. 살아남은 것은 그 하나였다.' +
            '<em>그가 혼자 돌아온 이유다.</em>';
        }
        endS.textContent = '나눈 국자 ' + r.poured + ' · 흘린 몫 ' +
          r.spilled.toFixed(1) + ' · 남은 식량 ' + r.food +
          (r.saved ? ' · 붙잡은 사람 ' + r.saved : '');
        end.className = 'end on' + (r.win ? ' win' : '');
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 장면 조각들
     ════════════════════════════════════════════════════════════════════ */

  /* ── 부하 한 명 — 웅크렸다가 굶주리면 일어나 언덕을 본다 ── */
  function crewGroup(tint) {
    var g = new T3.Group();
    var mS = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var mC = new T3.MeshLambertMaterial({ color: tint, flatShading: true });
    var mH = new T3.MeshLambertMaterial({ color: COL.hair, flatShading: true });

    var body = new T3.Group();               // 상체 전체 — 굶주리면 펴진다
    var torso = new T3.Mesh(new T3.SphereGeometry(0.26, 9, 7), mC);
    torso.scale.set(1, 1.18, 0.80); torso.position.y = 0.40;
    var neck = new T3.Mesh(new T3.CylinderGeometry(0.062, 0.075, 0.10, 7), mS);
    neck.position.y = 0.685;
    var headG = new T3.Group(); headG.position.set(0, 0.79, 0.015);
    var head = new T3.Mesh(new T3.SphereGeometry(0.155, 10, 8), mS);
    head.scale.set(1, 1.08, 0.96);
    var hair = new T3.Mesh(new T3.SphereGeometry(0.163, 10, 7), mH);
    hair.scale.set(1, 0.82, 1); hair.position.set(0, 0.045, -0.028);
    var beard = new T3.Mesh(new T3.SphereGeometry(0.10, 8, 6), mH);
    beard.scale.set(1, 0.78, 0.6); beard.position.set(0, -0.10, 0.085);
    headG.add(head, hair, beard);
    // 팔 — 무릎을 감싸 안았다
    var armL = new T3.Mesh(new T3.BoxGeometry(0.085, 0.40, 0.085), mS);
    armL.position.set(-0.235, 0.36, 0.10); armL.rotation.x = 0.66;
    var armR = armL.clone(); armR.position.x = 0.235;
    body.add(torso, neck, headG, armL, armR);
    body.position.y = 0;

    // 접은 다리
    var thigh = new T3.Mesh(new T3.BoxGeometry(0.13, 0.13, 0.36), mS);
    thigh.position.set(-0.10, 0.155, 0.16);
    var thigh2 = thigh.clone(); thigh2.position.x = 0.10;
    var shin = new T3.Mesh(new T3.BoxGeometry(0.115, 0.30, 0.115), mS);
    shin.position.set(-0.10, 0.15, 0.30);
    var shin2 = shin.clone(); shin2.position.x = 0.10;

    g.add(body, thigh, thigh2, shin, shin2);
    g.userData.body = body;
    g.userData.head = headG;
    g.userData.legs = [thigh, thigh2, shin, shin2];
    g.userData.mats = [mS, mC, mH];
    return g;
  }

  /* ── 오디세우스 — 항아리 옆에 서 있다. 부하들과 색으로 구분된다. ── */
  function odysseusGroup() {
    var g = new T3.Group();
    var mS = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var mC = new T3.MeshLambertMaterial({ color: COL.odyBlue, flatShading: true });
    var mH = new T3.MeshLambertMaterial({ color: COL.hair, flatShading: true });
    var torso = new T3.Mesh(new T3.SphereGeometry(0.29, 9, 7), mC);
    torso.scale.set(1, 1.35, 0.78); torso.position.y = 0.92;
    var skirt = new T3.Mesh(new T3.CylinderGeometry(0.24, 0.32, 0.42, 9), mC);
    skirt.position.y = 0.48;
    var legL = new T3.Mesh(new T3.BoxGeometry(0.115, 0.34, 0.115), mS);
    legL.position.set(-0.11, 0.17, 0);
    var legR = legL.clone(); legR.position.x = 0.11;
    var headG = new T3.Group(); headG.position.set(0, 1.36, 0.02);
    var head = new T3.Mesh(new T3.SphereGeometry(0.17, 10, 8), mS);
    var hair = new T3.Mesh(new T3.SphereGeometry(0.178, 10, 7), mH);
    hair.scale.set(1, 0.84, 1); hair.position.set(0, 0.05, -0.03);
    var beard = new T3.Mesh(new T3.SphereGeometry(0.115, 8, 6), mH);
    beard.scale.set(1, 0.86, 0.66); beard.position.set(0, -0.108, 0.088);
    headG.add(head, hair, beard);
    var armL = new T3.Mesh(new T3.BoxGeometry(0.09, 0.44, 0.09), mS);
    armL.position.set(-0.30, 0.96, 0.06); armL.rotation.x = 0.18;
    var armR = new T3.Mesh(new T3.BoxGeometry(0.09, 0.44, 0.09), mS);
    armR.position.set(0.30, 0.98, 0.13); armR.rotation.x = -0.75;
    g.add(torso, skirt, legL, legR, headG, armL, armR);
    g.userData.head = headG;
    g.userData.arm = armR;
    g.userData.mats = [mS, mC, mH];
    return g;
  }

  /* ── 황금빛 소 — 유혹은 눈앞에 있어야 한다 ── */
  function cowGeo() {
    var p = [];
    var sph = new T3.SphereGeometry(0.5, 10, 8);
    var box = new T3.BoxGeometry(1, 1, 1);
    var cone = new T3.ConeGeometry(0.5, 1, 7);

    p.push({ g: sph, m: M(0, 0.86, 0, 1.62, 0.86, 0.92), c: COL.cow });          // 몸통
    p.push({ g: sph, m: M(-0.45, 0.92, 0, 0.95, 0.80, 0.86), c: COL.cow });      // 엉덩이
    p.push({ g: sph, m: M(0.62, 0.94, 0, 0.72, 0.66, 0.66), c: COL.cow });       // 어깨
    p.push({ g: box, m: M(0.90, 0.80, 0, 0.30, 0.34, 0.34, 0, 0, -0.42), c: COL.cow });  // 목
    var head = M(1.13, 0.66, 0, 0.46, 0.34, 0.32);
    p.push({ g: sph, m: head, c: COL.cow });                                     // 머리
    p.push({ g: box, m: M(1.33, 0.58, 0, 0.22, 0.17, 0.20), c: COL.cowDark });   // 주둥이
    // 뿔 — 소라는 걸 한눈에
    p.push({ g: cone, m: M(1.12, 0.86, 0.15, 0.10, 0.30, 0.10, 0, 0, -0.55), c: COL.cowHorn });
    p.push({ g: cone, m: M(1.12, 0.86, -0.15, 0.10, 0.30, 0.10, 0, 0, -0.55), c: COL.cowHorn });
    // 귀
    p.push({ g: box, m: M(1.03, 0.72, 0.22, 0.13, 0.07, 0.06), c: COL.cowDark });
    p.push({ g: box, m: M(1.03, 0.72, -0.22, 0.13, 0.07, 0.06), c: COL.cowDark });
    // 다리 넷
    var legs = [[0.52, 0.24], [0.52, -0.24], [-0.52, 0.24], [-0.52, -0.24]];
    for (var i = 0; i < legs.length; i++) {
      p.push({ g: box, m: M(legs[i][0], 0.24, legs[i][1], 0.13, 0.50, 0.13), c: COL.cowDark });
    }
    // 꼬리
    p.push({ g: box, m: M(-0.88, 0.78, 0, 0.07, 0.55, 0.07, 0, 0, 0.30), c: COL.cowDark });
    p.push({ g: sph, m: M(-0.96, 0.48, 0, 0.16, 0.20, 0.16), c: COL.cowHorn });

    var g = merge(p);
    sph.dispose(); box.dispose(); cone.dispose();
    return g;
  }

  /* ── 해변에 끌어올린 배 ── */
  function buildShip(root) {
    var G = new T3.Group();
    var mH = new T3.MeshLambertMaterial({ color: COL.hull, flatShading: true });
    var mD = new T3.MeshLambertMaterial({ color: COL.hullDark, flatShading: true });
    var mM = new T3.MeshLambertMaterial({ color: COL.mast, flatShading: true });
    var mS = new T3.MeshLambertMaterial({ color: COL.sail, flatShading: true,
                                          side: T3.DoubleSide });
    function add(geo, mat, x, y, z, sx, sy, sz, rx, ry, rz) {
      var m = new T3.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      G.add(m); return m;
    }
    var sph = new T3.SphereGeometry(0.5, 12, 8);
    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 8);

    add(sph, mH, 0, 0.62, 0, 8.6, 1.55, 2.05);              // 선체
    add(box, mD, 0, 1.12, 0, 8.0, 0.16, 1.95);              // 갑판
    add(sph, mH, 3.9, 1.25, 0, 1.5, 2.30, 0.55, 0, 0, -0.5);// 뱃머리
    add(sph, mH, -3.9, 1.15, 0, 1.2, 2.00, 0.52, 0, 0, 0.5);// 고물
    add(box, mD, 0, 1.02, 0.98, 7.6, 0.36, 0.14);           // 뱃전
    add(box, mD, 0, 1.02, -0.98, 7.6, 0.36, 0.14);
    add(cyl, mM, 0.2, 3.5, 0, 0.16, 5.0, 0.16);             // 돛대
    var yard = add(cyl, mM, 0.2, 5.4, 0, 0.12, 4.6, 0.12, 0, 0, Math.PI / 2);
    // 바람이 없어 돛이 축 늘어졌다 — 이 편의 전제다
    var sail = add(box, mS, 0.2, 4.35, 0.06, 3.9, 1.85, 0.05);
    // 모래에 박은 받침목
    add(box, mD, 2.4, 0.30, 1.35, 0.20, 0.60, 0.20, 0.3, 0, 0);
    add(box, mD, -2.0, 0.30, 1.35, 0.20, 0.60, 0.20, 0.3, 0, 0);
    // 노 몇 자루
    for (var i = 0; i < 4; i++) {
      add(cyl, mM, -2.2 + i * 1.5, 1.55, 1.05, 0.07, 3.2, 0.07, 1.15, 0.15, 0.25);
    }
    root.add(G);
    return { group: G, sail: sail, yard: yard,
             geos: [sph, box, cyl], mats: [mH, mD, mM, mS] };
  }

  /* ── 해변 · 바다 · 하늘 · 언덕 ── */
  function buildBeach(root, rnd) {
    var out = { mats: [], geos: [] };
    function mat(m) { out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }

    // 하늘 (뒤판) — 세로 화면에서 위를 채운다
    var sky = new T3.Mesh(geo(new T3.PlaneGeometry(180, 110)),
                          mat(new T3.MeshBasicMaterial({ color: COL.sky })));
    sky.position.set(0, 30, -60); root.add(sky);
    var haze = new T3.Mesh(geo(new T3.PlaneGeometry(180, 5.0)),
                           mat(new T3.MeshBasicMaterial({ color: COL.skyHaze,
                             transparent: true, opacity: 0.45 })));
    haze.position.set(0, 2.2, -58); root.add(haze);

    // 헬리오스의 해 — 낮게, 크게. 늘 지켜보고 있다.
    var sun = new T3.Mesh(geo(new T3.CircleGeometry(3.4, 36)),
                          mat(new T3.MeshBasicMaterial({ color: COL.sun,
                            transparent: true, opacity: 0.92 })));
    sun.position.set(-8.0, 12.0, -55); root.add(sun);
    var halo = new T3.Mesh(geo(new T3.CircleGeometry(5.4, 36)),
                           mat(new T3.MeshBasicMaterial({ color: COL.sun,
                             transparent: true, opacity: 0.055,
                             blending: T3.AdditiveBlending, depthWrite: false })));
    halo.position.set(-8.0, 12.0, -54.6); root.add(halo);
    out.sun = sun; out.halo = halo;

    // 바다
    var sea = new T3.Mesh(geo(new T3.PlaneGeometry(180, 46)),
                          mat(new T3.MeshLambertMaterial({ color: COL.sea })));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.02, -42); root.add(sea);
    var line = new T3.Mesh(geo(new T3.PlaneGeometry(180, 0.9)),
                           mat(new T3.MeshBasicMaterial({ color: COL.seaLine,
                             transparent: true, opacity: 0.5 })));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.05, -20.2); root.add(line);
    var line2 = new T3.Mesh(geo(new T3.PlaneGeometry(180, 0.55)),
                            mat(new T3.MeshBasicMaterial({ color: COL.seaLine,
                              transparent: true, opacity: 0.32 })));
    line2.rotation.x = -Math.PI / 2; line2.position.set(0, 0.05, -24.6); root.add(line2);

    // 모래
    var sand = new T3.Mesh(geo(new T3.PlaneGeometry(200, 46)),
                           mat(new T3.MeshLambertMaterial({ color: COL.sand })));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0, 3); root.add(sand);
    var wet = new T3.Mesh(geo(new T3.PlaneGeometry(200, 3.4)),
                          mat(new T3.MeshLambertMaterial({ color: COL.sandDark })));
    wet.rotation.x = -Math.PI / 2; wet.position.set(0, 0.012, -18.6); root.add(wet);

    // 언덕 — 소가 어슬렁거리는 곳
    var hillG = geo(new T3.SphereGeometry(1, 20, 12));
    var hillM = mat(new T3.MeshLambertMaterial({ color: COL.hill, flatShading: true }));
    var hillD = mat(new T3.MeshLambertMaterial({ color: COL.hillDark, flatShading: true }));
    var hill = new T3.Mesh(hillG, hillM);
    hill.position.set(C.hillX, -1.4, C.hillZ);
    hill.scale.set(13.5, 6.4, 7.6);
    root.add(hill);
    var hill2 = new T3.Mesh(hillG, hillD);
    hill2.position.set(C.hillX + 11.0, -1.9, C.hillZ - 4.5);
    hill2.scale.set(9.5, 5.6, 5.5);
    root.add(hill2);
    var hill3 = new T3.Mesh(hillG, hillD);
    hill3.position.set(C.hillX - 15.0, -2.1, C.hillZ - 3.0);
    hill3.scale.set(9.0, 4.8, 5.0);
    root.add(hill3);

    // 앞쪽 모래 둔덕 — 화면 아래를 닫는 액자 (세로에서 특히)
    var rockG = geo(new T3.IcosahedronGeometry(1, 0));
    var foreM = mat(new T3.MeshLambertMaterial({ color: COL.sandFore, flatShading: true }));
    var fore = [[-10.2, 8.4, 3.4], [-5.6, 8.9, 3.1], [5.6, 8.7, 3.1], [10.4, 8.4, 3.4],
                [-2.8, 11.0, 3.6], [3.0, 11.2, 3.6]];
    for (var i = 0; i < fore.length; i++) {
      var fr = new T3.Mesh(rockG, foreM);
      fr.position.set(fore[i][0], -2.60, fore[i][1]);
      fr.scale.set(fore[i][2] * (1.2 + rnd() * 0.4), 2.35 + rnd() * 0.35, 2.2);
      fr.rotation.set(rnd() * 0.3, rnd() * 3, rnd() * 0.35);
      root.add(fr);
    }
    // 꺼진 모닥불 — 구울 것이 없어 불도 껐다. 앞쪽 빈 모래를 이야기로 채운다.
    var ashM = mat(new T3.MeshLambertMaterial({ color: 0x4a4038, flatShading: true }));
    var charM = mat(new T3.MeshLambertMaterial({ color: 0x241c16, flatShading: true }));
    var ringG = geo(new T3.IcosahedronGeometry(1, 0));
    for (var q = 0; q < 8; q++) {
      var an = q / 8 * Math.PI * 2;
      var rk = new T3.Mesh(ringG, ashM);
      rk.position.set(2.55 + Math.cos(an) * 0.62, 0.10, 5.10 + Math.sin(an) * 0.44);
      rk.scale.setScalar(0.15 + rnd() * 0.07);
      rk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      root.add(rk);
    }
    var ashG = geo(new T3.CircleGeometry(0.52, 14));
    var ash = new T3.Mesh(ashG, mat(new T3.MeshLambertMaterial({ color: 0x6b625a })));
    ash.rotation.x = -Math.PI / 2; ash.position.set(2.55, 0.02, 5.10); root.add(ash);
    var logG = geo(new T3.BoxGeometry(1, 1, 1));
    for (q = 0; q < 3; q++) {
      var lg2 = new T3.Mesh(logG, charM);
      lg2.position.set(2.55 + (rnd() - 0.5) * 0.5, 0.07, 5.10 + (rnd() - 0.5) * 0.4);
      lg2.scale.set(0.62, 0.12, 0.12);
      lg2.rotation.y = rnd() * 3;
      root.add(lg2);
    }
    // 텅 빈 바구니 둘
    var baskM = mat(new T3.MeshLambertMaterial({ color: 0xa9834c, flatShading: true }));
    var baskG = geo(new T3.CylinderGeometry(0.34, 0.26, 0.36, 9, 1, true));
    var bk = new T3.Mesh(baskG, baskM);
    bk.position.set(-2.85, 0.18, 5.55); bk.rotation.set(0.9, 0.4, 0.2); root.add(bk);
    var bk2 = new T3.Mesh(baskG, baskM);
    bk2.position.set(-3.75, 0.17, 4.85); bk2.rotation.set(0.2, 1.1, 0.1); root.add(bk2);

    // 흩어진 돌
    var stoneM = mat(new T3.MeshLambertMaterial({ color: COL.sandDark, flatShading: true }));
    var stones = [[-7.2, -1.4, 0.5], [6.9, 0.4, 0.42], [-2.6, -4.2, 0.34],
                  [8.6, -3.4, 0.55], [-9.8, 2.6, 0.4], [2.1, -5.6, 0.30],
                  [11.4, 1.2, 0.46], [-5.0, -6.2, 0.36]];
    for (i = 0; i < stones.length; i++) {
      var st = new T3.Mesh(rockG, stoneM);
      st.position.set(stones[i][0], stones[i][2] * 0.45, stones[i][1]);
      st.scale.setScalar(stones[i][2] * (0.8 + rnd() * 0.6));
      st.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      root.add(st);
    }
    return out;
  }

  /* ── 식량 항아리 + 국자 ────────────────────────────────────────────────
     국자는 두 가지 일을 한다: (1) 다음에 누구에게 갈지 가리킨다
     (2) 항아리를 다녀오는 동안이 곧 재장전 시간이다 — 재장전이 눈에 보인다. */
  function buildPot(root) {
    var G = new T3.Group();
    G.position.set(C.potX, 0, C.potZ);
    G.scale.setScalar(0.82);
    var mP = new T3.MeshLambertMaterial({ color: COL.pot, flatShading: true });
    var mD = new T3.MeshLambertMaterial({ color: COL.potDark, flatShading: true });
    var mG = new T3.MeshLambertMaterial({ color: COL.grain, flatShading: true });
    var body = new T3.Mesh(new T3.SphereGeometry(0.5, 12, 9), mP);
    body.scale.set(1.15, 1.45, 1.15); body.position.y = 0.52;
    var neck = new T3.Mesh(new T3.CylinderGeometry(0.30, 0.36, 0.26, 10), mD);
    neck.position.y = 1.06;
    var lip = new T3.Mesh(new T3.TorusGeometry(0.30, 0.055, 6, 14), mD);
    lip.rotation.x = Math.PI / 2; lip.position.y = 1.18;
    var grain = new T3.Mesh(new T3.CircleGeometry(0.27, 14), mG);
    grain.rotation.x = -Math.PI / 2; grain.position.y = 1.16;
    G.add(body, neck, lip, grain);
    root.add(G);

    // 국자
    var L = new T3.Group();
    var mL = new T3.MeshLambertMaterial({ color: COL.ladle, flatShading: true });
    var bowl = new T3.Mesh(new T3.SphereGeometry(0.20, 10, 6, 0, Math.PI * 2, 0,
                                                 Math.PI * 0.55), mL);
    bowl.rotation.x = Math.PI;
    var handle = new T3.Mesh(new T3.CylinderGeometry(0.033, 0.033, 0.86, 6), mL);
    handle.position.set(0, 0.34, -0.16); handle.rotation.x = 0.34;
    var fill = new T3.Mesh(new T3.CircleGeometry(0.155, 12), mG);
    fill.rotation.x = -Math.PI / 2; fill.position.y = -0.035;
    L.add(bowl, handle, fill);
    root.add(L);

    return { pot: G, ladle: L, fill: fill, grain: grain,
             mats: [mP, mD, mG, mL],
             geos: [body.geometry, neck.geometry, lip.geometry, grain.geometry,
                    bowl.geometry, handle.geometry, fill.geometry] };
  }

  /* ── ★ 굶주림 막대 — 규칙을 가르치는 물건 ──────────────────────────────
     한 사람에 하나. 늘 같은 높이에 떠 있어 여섯을 나란히 비교할 수 있다.
       어두운 아래칸  : 여기서 부으면 흘린다
       금색 가운데칸  : 지금 부으면 한 방울도 안 흘린다
       붉은 위칸      : 늦었다 — 소를 보기 시작한다
     그리고 예고 눈금이 "이 속도면 3초 뒤 여기"를 미리 찍어 준다.
     → 어느 막대가 곧 터질지가 높이 하나가 아니라 **높이 + 눈금**으로 읽힌다. */
  function buildBar(root, x, quad, mats) {
    var g = new T3.Group();
    g.position.set(x, C.barY, C.barZ);
    root.add(g);
    function part(mat, order, z) {
      var m = new T3.Mesh(quad, mat);
      m.renderOrder = order;
      m.position.z = z;
      g.add(m);
      return m;
    }
    var W = C.barW, H = C.barH;
    var back = part(mats.back, 30, 0);
    back.scale.set(W + 0.085, H + 0.085, 1);
    back.position.y = H * 0.5;

    var zLow = part(mats.zLow, 31, 0.012);
    zLow.scale.set(W, H * C.R, 1);
    zLow.position.y = H * C.R * 0.5;

    var zGold = part(mats.zGold, 31, 0.012);
    zGold.scale.set(W, H * (C.T - C.R), 1);
    zGold.position.y = H * (C.R + C.T) * 0.5;

    var zRed = part(mats.zRed, 31, 0.012);
    zRed.scale.set(W, H * (1 - C.T), 1);
    zRed.position.y = H * (C.T + 1) * 0.5;

    // 구간 경계선 — 채움 위에 그린다. 막대가 차올라도 금색 칸이 어디였는지
    // 계속 보여야 "지금이 그때인가"를 매 순간 다시 읽을 수 있다.
    var lineA = part(mats.line, 37, 0.052);
    lineA.scale.set(W + 0.11, 0.036, 1); lineA.position.y = H * C.R;
    var lineB = part(mats.line, 37, 0.052);
    lineB.scale.set(W + 0.11, 0.030, 1); lineB.position.y = H * C.T;
    var cap = part(mats.cap, 37, 0.052);
    cap.scale.set(W + 0.16, 0.046, 1); cap.position.y = H;

    // 채움 — 이 사람의 지금 굶주림
    var fillM = new T3.MeshBasicMaterial({ color: 0xf3dda0, transparent: true,
                                           opacity: 0.96, depthWrite: false });
    var fill = new T3.Mesh(quad, fillM);
    fill.renderOrder = 34; fill.position.z = 0.034;
    g.add(fill);

    // 예고 눈금 — 3초 뒤 여기
    var ghM = new T3.MeshBasicMaterial({ color: 0xffd6a8, transparent: true,
                                         opacity: 0.0, depthWrite: false,
                                         blending: T3.AdditiveBlending });
    var ghost = new T3.Mesh(quad, ghM);
    ghost.renderOrder = 35; ghost.position.z = 0.042;
    ghost.scale.set(W + 0.13, 0.030, 1);
    g.add(ghost);

    // 이 막대가 다음 국자를 받는다
    var tgM = new T3.MeshBasicMaterial({ color: 0xfff4d8, transparent: true,
                                         opacity: 0.0, depthWrite: false,
                                         blending: T3.AdditiveBlending });
    var glow = new T3.Mesh(quad, tgM);
    glow.renderOrder = 29; glow.position.z = -0.01;
    glow.scale.set(W + 0.34, H + 0.34, 1);
    glow.position.y = H * 0.5;
    g.add(glow);

    return { grp: g, fill: fill, fillM: fillM, ghost: ghost, ghM: ghM,
             glow: glow, tgM: tgM, zGold: zGold, zRed: zRed, x: x, baseX: x };
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

    var s = {
      root: root, world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, seed: seed,
      snd: makeAudio(makeRng(4471)),
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      crew0: opts.crew == null ? C.CREW : Math.max(1, Math.round(opts.crew)),
      hud: null, g: null,
      phase: 'ready',        // ready | run | doom | wind | over
      wall: 0, shake: 0, buf: 0,
      bars: [], men: [], cows: [],
      lastDay: 1, mooAt: 3.0, spillMsgAt: -9, taught: 0,
      doomT: 0, windT: 0, boltT: 0, result: null,
      ladleP: 1, ladleTip: 0, ladleAt: 0,
      spread: -1, potXs: C.potX, potZs: C.potZ,
      gotOne: 0,
      disposables: { geos: [], mats: [] }
    };
    s.g = newGame(seed, s.crew0);

    /* ── 빛: 한낮의 뜨거운 태양 ── */
    var amb = new T3.AmbientLight(0xa8bccd, 1.30);
    var key = new T3.DirectionalLight(0xfff2d2, 2.15);
    key.position.set(5, 13, 11);          // 정면 위 — 인물·돛이 죽지 않게
    var rim = new T3.DirectionalLight(0xffd9a0, 0.85);
    rim.position.set(-10, 7, -6);
    world.add(amb, key, rim);

    /* ── 해변 · 배 ── */
    var beach = buildBeach(world, rnd);
    s.disposables.geos = s.disposables.geos.concat(beach.geos);
    s.disposables.mats = s.disposables.mats.concat(beach.mats);
    s.sun = beach.sun; s.halo = beach.halo;

    var ship = buildShip(world);
    ship.group.position.set(-9.4, 0.15, -6.2);
    ship.group.rotation.set(0.03, 0.50, -0.05);
    s.ship = ship;
    s.disposables.geos = s.disposables.geos.concat(ship.geos);
    s.disposables.mats = s.disposables.mats.concat(ship.mats);

    /* ── 황금빛 소 — 언덕 위에 늘 있다 ── */
    var cg = cowGeo();
    var cowMat = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true,
                                              emissive: 0x3a2703 });
    s.disposables.geos.push(cg);
    s.disposables.mats.push(cowMat);
    s.cowMat = cowMat;
    var spots = [[0.9, -12.4, 1.02, -0.5], [4.4, -14.0, 1.10, 0.35],
                 [7.8, -12.8, 0.96, -0.9], [2.6, -16.6, 0.90, 1.1],
                 [10.6, -15.6, 0.98, 0.2], [-2.2, -15.2, 0.88, 2.5]];
    for (var ci = 0; ci < spots.length; ci++) {
      var cow = new T3.Mesh(cg, cowMat);
      var cx = spots[ci][0], cz = spots[ci][1];
      cow.position.set(cx, hillY(cx, cz), cz);
      cow.scale.setScalar(spots[ci][2]);
      cow.rotation.y = spots[ci][3];
      cow.userData = { ph: rnd() * 6.28, base: cow.position.y, ry: spots[ci][3],
                       bx: cx, sp: 0.5 + rnd() * 0.6 };
      world.add(cow);
      s.cows.push(cow);
    }

    /* ── 부하 여섯 · 굶주림 막대 여섯 ── */
    var quad = new T3.PlaneGeometry(1, 1);
    s.disposables.geos.push(quad);
    function zone(hex, op, add) {
      var m = new T3.MeshBasicMaterial({ color: hex, transparent: true, opacity: op,
                                         depthWrite: false,
                                         blending: add ? T3.AdditiveBlending
                                                       : T3.NormalBlending });
      s.disposables.mats.push(m);
      return m;
    }
    var barMats = {
      back: zone(0x120c06, 0.86, false),      // 하늘이 비쳐 구간 색이 흐려지지 않게
      zLow: zone(0x342b1d, 0.92, false),      // 아직 이르다 — 어둡고 죽어 있다
      zGold: zone(0xffbe3c, 0.90, false),     // 지금 — 이 칸이 이 편의 전부다
      zRed: zone(0xd6300f, 0.86, false),      // 늦었다
      line: zone(0xfffbe8, 0.95, false),
      cap: zone(0xff7a4e, 0.95, false)
    };
    s.barMats = barMats;

    var tints = [COL.tunic, COL.tunic2, 0xa8623a, 0x7d6f9c, 0xbf6b4a, 0x8f5563];
    var x0 = -(C.lines - 1) * 0.5 * C.crewGap;
    for (var i = 0; i < C.lines; i++) {
      var mx = x0 + i * C.crewGap;
      var man = crewGroup(tints[i % tints.length]);
      man.position.set(mx, 0, C.crewZ + (i % 2) * 0.14);
      man.rotation.y = -0.18 + rnd() * 0.36;
      man.userData.home = man.position.clone();
      man.userData.baseX = mx;
      man.userData.ry0 = man.rotation.y;
      man.userData.ph = rnd() * 6.28;
      world.add(man);
      s.men.push(man);
      for (var mm = 0; mm < man.userData.mats.length; mm++) {
        s.disposables.mats.push(man.userData.mats[mm]);
      }
      s.bars.push(buildBar(world, mx, quad, barMats));
    }

    /* 소를 보는 시선 — 굶주림이 오르면 눈에서 언덕으로 금빛 선이 간다.
       가는 원통이라 어느 방향에서 봐도 선으로 보인다(빌보드가 필요 없다). */
    var gazeG = new T3.CylinderGeometry(1, 1, 1, 5);
    s.disposables.geos.push(gazeG);
    s.gazes = [];
    for (i = 0; i < C.lines; i++) {
      var gzM = new T3.MeshBasicMaterial({ color: 0xffd166, transparent: true,
                                           opacity: 0, depthWrite: false,
                                           blending: T3.AdditiveBlending });
      var gz = new T3.Mesh(gazeG, gzM);
      gz.renderOrder = 12;
      s.disposables.mats.push(gzM);
      world.add(gz);
      s.gazes.push(gz);
    }
    s.up = new T3.Vector3(0, 1, 0);

    /* ── 오디세우스 · 항아리 · 국자 ── */
    var ody = odysseusGroup();
    ody.position.set(C.potX - 0.92, 0, C.potZ + 0.18);
    ody.rotation.y = 0.55;
    ody.scale.setScalar(1.05);
    world.add(ody);
    s.ody = ody;
    for (var om = 0; om < ody.userData.mats.length; om++) {
      s.disposables.mats.push(ody.userData.mats[om]);
    }
    var pot = buildPot(world);
    s.pot = pot;
    s.disposables.mats = s.disposables.mats.concat(pot.mats);
    s.disposables.geos = s.disposables.geos.concat(pot.geos);

    /* 쏟아지는 알곡 — 국자에서 부하로 (성공) / 모래로 (흘림) */
    var streamM = new T3.MeshBasicMaterial({ color: COL.grain, transparent: true,
                                             opacity: 0, depthWrite: false });
    s.disposables.mats.push(streamM);
    s.stream = new T3.Mesh(quad, streamM);
    s.stream.renderOrder = 20;
    world.add(s.stream);

    /* 벼락 — 하늘에서 배로 */
    s.bolt = new T3.Group();
    var boltM = new T3.MeshBasicMaterial({ color: 0xfffdf2, transparent: true,
                                           opacity: 0, depthWrite: false });
    s.disposables.mats.push(boltM);
    s.boltM = boltM;
    var bx = -3.8, by = 28, seg = 8, prev = new T3.Vector3(bx, by, -7.0);
    for (i = 0; i < seg; i++) {
      var ny = by - (by - 3.4) * (i + 1) / seg;
      var nx = bx + (rnd() * 2 - 1) * 1.5;
      var q = new T3.Mesh(quad, boltM);
      var dx = nx - prev.x, dy = ny - prev.y;
      q.position.set((prev.x + nx) * 0.5, (prev.y + ny) * 0.5, -7.0);
      q.scale.set(0.72, Math.sqrt(dx * dx + dy * dy) + 0.30, 1);
      q.rotation.z = Math.atan2(-dx, dy);
      q.renderOrder = 40;
      s.bolt.add(q);
      prev.set(nx, ny, -7.0);
    }
    s.bolt.visible = false;
    world.add(s.bolt);

    /* ── HUD ── */
    var host = opts.hudHost ||
               (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host && host.style && !host.style.position && host === document.body) {
      host.style.position = 'relative';
    }
    s.hud = makeHud(host);
    s.hud.onRestart(function () { reset(); start(); });

    if (opts.bindInput !== false) bindInput(s);

    s.v = { a: new T3.Vector3(), b: new T3.Vector3(), c: new T3.Vector3() };
    S = s;
    layout(s);
    refreshHud(s);
    frame(s, 0);
    return api;
  }

  /* 언덕 표면 높이 — 소를 언덕에 붙여 세운다 */
  function hillY(x, z) {
    var dx = (x - C.hillX) / 13.5, dz = (z - C.hillZ) / 7.6;
    var d = dx * dx + dz * dz;
    if (d >= 1) return 0;
    return -1.4 + 6.4 * Math.sqrt(1 - d);
  }

  /* ── 스페이스 / 클릭·탭 → press() 하나로 (탭 전용) ── */
  function bindInput(s) {
    var target = s.canvas || document;
    s.onKey = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        if (e.repeat) return;          // 키 반복은 탭이 아니다
        press(true);
      }
    };
    s.onDown = function (e) {
      if (e.button != null && e.button !== 0) return;
      press(true);
    };
    window.addEventListener('keydown', s.onKey, false);
    target.addEventListener('pointerdown', s.onDown, false);
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
    var k = aspect < 1 ? C.camP : C.camL;

    cam.fov = k.fov;
    cam.aspect = aspect;
    cam.near = 0.5; cam.far = 400;

    var vHalf = Math.max(k.halfH, k.halfW / aspect);
    var dist = vHalf / Math.tan(cam.fov * Math.PI / 360);
    dist = clamp(dist, 9, 34);

    cam.position.set(k.fx, k.camY, C.crewZ + dist * 0.97);
    cam.lookAt(k.fx, k.fy, -1.0);
    cam.updateProjectionMatrix();
    s.camBase = cam.position.clone();

    /* 가로 간격 — 세로 화면에서는 줄을 좁혀 막대를 키운다 */
    var sp = k.spread;
    if (s.spread !== sp) {
      s.spread = sp;
      s.potXs = k.pot[0]; s.potZs = k.pot[1];
      for (var q = 0; q < s.bars.length; q++) {
        var bx = s.bars[q].baseX * sp;
        s.bars[q].x = bx;
        s.bars[q].grp.position.x = bx;
        var mn = s.men[q];
        mn.userData.home.x = mn.userData.baseX * sp;
        if (!mn.userData.walking) mn.position.x = mn.userData.home.x;
      }
      if (s.pot) s.pot.pot.position.set(s.potXs, 0, s.potZs);
      if (s.ody) s.ody.position.set(s.potXs - 0.92, 0, s.potZs + 0.18);
    }

    /* 막대는 세로로 선 채 카메라 쪽으로 아주 조금만 젖힌다.
       (내려다보는 각도만큼만 — 더 눕히면 바닥에 깔린 판이 되어 못 읽는다) */
    var pitch = Math.atan2(cam.position.y - (C.barY + C.barH * 0.5),
                           cam.position.z - C.barZ);
    for (var i = 0; i < s.bars.length; i++) s.bars[i].grp.rotation.x = pitch * 0.92;
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
    if (down === false) return 'up';          // 탭 전용 — 놓는 건 쓰지 않는다
    s.snd.resume();
    if (s.phase === 'ready') { start(); return 'start'; }
    if (s.phase !== 'run') return 'idle';

    var g = s.g;
    if (g.cool > 0) {
      // 재장전 중 — 아주 짧게 버퍼에 담아 준다(입력 지연을 용서할 만큼만)
      if (g.cool <= C.BUF) { s.buf = C.BUF; s.snd.cool(); return 'buffered'; }
      s.buf = 0;
      s.snd.cool();
      softMsg(s, '국자가 아직 비었다');
      return 'cool';
    }
    return doPour(s);
  }

  function doPour(s) {
    var g = s.g;
    var r = pour(g);
    if (!r.ok) {
      if (r.why === 'nofood') {
        s.snd.empty();
        softMsg(s, '식량이 떨어졌다');
      }
      return r.why;
    }
    s.buf = 0;
    s.ladleP = 0; s.ladleTip = 0.30; s.ladleAt = r.i;
    s.gotOne++;
    if (s.gotOne >= 3) s.hud.hint(false);

    // ★ 한 국자의 대답 — 세 갈래. 이게 규칙을 몸에 새긴다.
    var bar = s.bars[r.i];
    if (r.saved) {
      s.snd.pullBack();
      s.hud.flash('붙잡았다', '#ffd98c', '한 걸음 앞에서');
      pulse(s, bar, 0xfff0c2, 1.0);
    } else if (r.kind === 'perfect') {
      s.snd.pourGood();
      pulse(s, bar, 0xffe08a, 0.75);
      if (s.taught < 3) { s.taught++; s.hud.flash('가득', '#ffdf9c'); }
    } else if (r.kind === 'late') {
      s.snd.pourLate();
      pulse(s, bar, 0xff9a6a, 0.8);
      s.hud.flash('늦었다', '#ff9f74', '이미 소를 보고 있었다');
    } else {
      s.snd.pourSpill(clamp(r.spill / C.R, 0, 1));
      pulse(s, bar, 0xff7a52, 0.8);
      // 흘린 양이 뚜렷할 때만 말한다 — 매번 떠들면 잔소리가 된다
      if (r.spill > 0.13 && s.wall - s.spillMsgAt > 1.1) {
        s.spillMsgAt = s.wall;
        s.hud.flash('흘렸다', '#ff9a6a',
                    '배가 덜 비었다 · ' + Math.round(r.spill / C.R * 100) + '% 손실');
      }
    }
    spawnStream(s, r);
    refreshHud(s);
    return 'pour';
  }

  function softMsg(s, m) { s.hud.flash(m, '#e6d7ba', '', true); }

  function pulse(s, bar, hex, str) {
    bar.pulse = str;
    bar.pulseC = hex;
  }

  function spawnStream(s, r) {
    s.fx = { i: r.i, t: 0, spill: r.spill / C.R };
  }

  function refreshHud(s) {
    s.hud.food(s.g.food, C.FOOD);
    s.hud.day(s.g.day);
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
      advance(g, dt);

      // 버퍼에 담긴 누름 — 국자가 차는 순간 나간다
      if (s.buf > 0) {
        s.buf -= dt;
        if (g.cool <= 0) { s.buf = 0; doPour(s); }
      }

      if (g.day !== s.lastDay) {
        s.lastDay = g.day;
        s.snd.day();
      }
      s.mooAt -= dt;
      if (s.mooAt <= 0) { s.mooAt = 5.5 + s.rnd() * 6.0; s.snd.moo(s.rnd()); }

      // 가장 위험한 사람 — 화면 전체의 온도를 정한다
      var worst = 0, walking = 0, i, m;
      for (i = 0; i < g.men.length; i++) {
        m = g.men[i];
        if (m.h > worst) worst = m.h;
        if (m.state === 'walk') walking++;
      }
      s.worst = worst;
      s.snd.unease(clamp((worst - 0.55) / 0.45, 0, 1));
      s.hud.vig(clamp((worst - 0.80) / 0.22, 0, 1) * 0.95);
      if (walking > 0) {
        s.hud.warn(walking > 1 ? (walking + '명이 소로 간다') : '한 명이 소로 간다');
      } else if (worst >= 0.90) {
        s.hud.warn('굶주림이 한계에 닿는다');
      } else s.hud.warn('');

      if (g.over) {
        if (g.win) { s.phase = 'wind'; s.windT = 0; s.hud.hint(false);
                     s.snd.wind(); s.snd.unease(0); }
        else {
          s.phase = 'doom'; s.doomT = 0; s.boltT = 0;
          s.hud.hint(false);
          s.hud.warn(g.ranOut ? '식량이 떨어졌다' : '굶주림이 한계를 넘었다');
          s.snd.unease(0);
        }
      }
      refreshHud(s);
    } else if (s.phase === 'doom') {
      s.doomT += dt;
      if (s.doomT > 1.05 && s.boltT === 0) {
        s.boltT = 0.001;
        s.snd.bolt();
        s.shake = 1.6;
      }
      if (s.boltT > 0) s.boltT += dt;
      s.hud.bolt(s.boltT > 0 ? clamp(1 - (s.boltT - 0.05) / 0.55, 0, 1) * 0.92 : 0);
      s.hud.vig(clamp(1 - s.doomT * 0.4, 0, 1));
      if (s.doomT >= 2.7) finish(s);
    } else if (s.phase === 'wind') {
      s.windT += dt;
      s.hud.vig(0);
      if (s.windT >= 2.0) finish(s);
    }

    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  function finish(s) {
    if (s.phase === 'over') return;
    s.phase = 'over';
    var r = resultOf(s.g);
    s.result = r;
    s.hud.hint(false);
    s.hud.warn('');
    s.hud.bolt(0);
    var handled = false;
    if (typeof api.onEnd === 'function') {
      try { api.onEnd(r); handled = true; } catch (e) { handled = false; }
    }
    if (!handled || s.opts.endPanel === true) s.hud.end(r);
  }

  /* ── 한 프레임 그리기 ── */
  function frame(s, dt) {
    dt = dt || 0;
    var g = s.g, i, m, bar, man;
    var H = C.barH;
    var tgt = (s.phase === 'run') ? target(g) : null;

    /* 금색 칸이 천천히 숨 쉰다 — 눈이 먼저 거기로 간다 (재질은 여섯이 공유) */
    if (s.barMats) {
      s.barMats.zGold.opacity = 0.86 + 0.14 * Math.sin(s.wall * 2.1);
    }

    /* 굶주림 막대 */
    for (i = 0; i < C.lines; i++) {
      m = g.men[i];
      bar = s.bars[i];
      var h = clamp(m.h, 0, 1);
      var over = m.h > 1;

      bar.fill.scale.set(C.barW - 0.045, Math.max(0.004, H * h), 1);
      bar.fill.position.y = H * h * 0.5;
      // 채움 색이 곧 지금 어느 칸에 있는지다
      var col = 0xf0e2b8;                      // 아직 이르다 — 창백한 색
      if (m.h >= 1) col = 0xff5233;
      else if (m.h >= C.T) col = 0xf0552c;
      else if (m.h >= C.R) col = 0xffc94f;     // 금색 칸 — 지금이다
      var pl = bar.pulse || 0;
      if (pl > 0) {
        bar.pulse = Math.max(0, pl - dt * 3.2);
        bar.fillM.color.setHex(bar.pulseC);
      } else bar.fillM.color.setHex(col);
      // 한계에 닿을수록 빨라지는 깜빡임 — 곧 터진다는 신호
      var beat = 1;
      if (m.h >= C.T) {
        var u = clamp((m.h - C.T) / (1 - C.T), 0, 1);
        beat = 0.80 + 0.20 * Math.sin(s.wall * (7 + 16 * u));
      }
      bar.fillM.opacity = (over ? 1 : 0.94) * beat;

      // 예고 눈금 — 이 속도면 3초 뒤 여기까지 온다
      var ahead = clamp(m.h + rateOf(g, m) * C.ahead, 0, 1);
      bar.ghost.position.y = H * ahead;
      bar.ghM.opacity = (s.phase === 'run' && !over) ?
        (0.30 + 0.28 * clamp((ahead - h) * 4, 0, 1)) : 0.12;

      // 다음 국자가 갈 곳 — 국자가 이미 그 위에 떠 있고, 테두리도 밝아진다
      var isT = (tgt && tgt.i === i);
      bar.tgM.opacity = approach(bar.tgM.opacity, isT ? (g.cool > 0 ? 0.16 : 0.46) : 0,
                                 dt, 0.72);
      bar.glow.scale.set(C.barW + (isT ? 0.40 : 0.30), H + 0.40, 1);
      bar.grp.position.y = C.barY + (over ? Math.sin(s.wall * 22) * 0.03 : 0);
      // 벼락 직전엔 막대가 접힌다 — 이제 볼 것은 언덕을 오르는 사람들이다
      var dq = (s.phase === 'doom') ? smooth(clamp((s.doomT - 0.15) / 0.6, 0, 1)) : 0;
      bar.grp.scale.set(1 - dq * 0.92, 1 - dq * 0.92, 1);
      bar.grp.visible = dq < 0.98;
    }

    /* 부하들 — 굶주림이 오르면 몸을 펴고 언덕을 본다 */
    for (i = 0; i < C.lines; i++) {
      m = g.men[i];
      man = s.men[i];
      var look = clamp((m.h - (C.T - 0.10)) / (1 - (C.T - 0.10)), 0, 1);
      man.userData.look = look;
      var ph = man.userData.ph;
      var body = man.userData.body;
      var head = man.userData.head;

      // ★ 벼락 직전 — 여섯이 모두 일어나 언덕으로 올라간다. 이 걸음이 신화다.
      var du = (s.phase === 'doom') ? smooth(s.doomT / 0.95) : 0;

      // 앉음 → 일어섬
      var rise = Math.max(du, m.state === 'walk' ? 1 : look * 0.45);
      body.position.y = lerp(0, 0.44, rise) + Math.sin(s.wall * 1.5 + ph) * 0.012;
      body.rotation.x = lerp(0.34, -0.06, rise);
      for (var li = 0; li < man.userData.legs.length; li++) {
        var lg = man.userData.legs[li];
        lg.visible = rise < 0.7;
      }
      // 소 쪽으로 몸을 돌린다
      var wantRy = man.userData.ry0 + Math.max(look, du) * 2.15;
      man.rotation.y = approach(man.rotation.y, wantRy, dt, 0.86);
      head.rotation.x = -Math.max(look, du * 0.7) * 0.34;

      // 걸어간다 — 마지막 기회의 1.5초 (그리고 doom 에서는 끝까지 간다)
      if (m.state === 'walk' || du > 0) {
        var u = clamp(m.walk / C.GRACE, 0, 1);
        // 줄을 벗어나 언덕 쪽으로 반걸음씩. 자기 막대 아래를 크게 벗어나지 않아
        // "누가 일어섰는지"가 막대와 함께 읽힌다.
        var wx = man.userData.home.x + (C.hillX - man.userData.home.x) * 0.14 * u;
        var wz = lerp(man.userData.home.z, C.crewZ + 0.95, u);
        if (du > 0) {          // 소에 닿는 마지막 걸음 — 언덕 위로 올라간다
          wx = lerp(wx, C.hillX * 0.72 + (i - 2.5) * 1.5, du);
          wz = lerp(wz, C.hillZ * 0.52, du);
        }
        man.position.set(wx, Math.abs(Math.sin((u + du) * 15)) * 0.075 +
                             hillY(wx, wz) * du, wz);
        man.scale.setScalar(1 + u * 0.04 - du * 0.10);
        man.userData.walking = true;
        if (!man.userData.rose) { man.userData.rose = true; s.snd.rise(); }
      } else {
        man.position.x = approach(man.position.x, man.userData.home.x, dt, 0.80);
        man.position.z = approach(man.position.z, man.userData.home.z, dt, 0.80);
        man.position.y = 0;
        man.scale.setScalar(1);
        man.userData.rose = false;
        man.userData.walking = false;
      }

      // 소를 보는 시선 — 굶주릴수록 또렷해지는 금빛 실선
      var gz = s.gazes[i];
      var from = s.v.a.set(man.position.x, 0.92 + rise * 0.52, man.position.z - 0.1);
      var to = s.v.b.set(C.hillX + 0.4, 3.1, C.hillZ + 1.6);
      var dir = s.v.c.subVectors(to, from);
      var len = Math.max(0.01, dir.length());
      gz.position.copy(from).addScaledVector(dir, 0.5);
      gz.quaternion.setFromUnitVectors(s.up, dir.normalize());
      gz.scale.set(0.020 + 0.016 * look, len, 0.020 + 0.016 * look);
      gz.material.opacity = look * 0.34 * (0.62 + 0.38 * Math.sin(s.wall * 3 + ph));
    }

    /* 국자 — 항아리와 대상 사이를 오간다. 이 왕복이 곧 재장전이다. */
    var lad = s.pot.ladle;
    var cool = g.cool, p;
    if (s.phase === 'run' && cool > 0) p = 1 - cool / C.COOL; else p = 1;
    s.ladleP = p;
    var tx, ty, tz;
    var aim = tgt ? s.bars[tgt.i].x : 0;
    var HOV = C.barY + C.barH + 0.34, HOZ = C.barZ + 0.30;   // 대상 막대 바로 위
    if (p >= 0.55) {
      var u2 = smooth((p - 0.55) / 0.45);
      tx = lerp(s.potXs, aim, u2);
      ty = lerp(1.24, HOV, u2) + Math.sin(u2 * Math.PI) * 0.30;
      tz = lerp(s.potZs, HOZ, u2);
    } else if (p >= 0.30) {
      var u3 = (p - 0.30) / 0.25;
      tx = s.potXs; ty = 1.24 - Math.sin(u3 * Math.PI) * 0.34; tz = s.potZs;
    } else {
      var u4 = smooth(p / 0.30);
      tx = lerp(s.bars[s.ladleAt] ? s.bars[s.ladleAt].x : 0, s.potXs, u4);
      ty = lerp(HOV, 1.24, u4) + Math.sin(u4 * Math.PI) * 0.30;
      tz = lerp(HOZ, s.potZs, u4);
    }
    lad.position.set(tx, ty, tz);
    lad.visible = (s.phase === 'run' || s.phase === 'ready');
    s.ladleTip = Math.max(0, s.ladleTip - dt * 2.2);
    lad.rotation.set(-0.25 + s.ladleTip * 2.6, 0, 0);
    s.pot.fill.visible = (p >= 0.5);
    // 국자가 가득 찼으면 살짝 뜬다 — "지금 부을 수 있다"
    if (p >= 1) lad.position.y += Math.sin(s.wall * 3.4) * 0.045;

    // 오디세우스가 국자를 따라 몸을 돌린다
    if (s.ody) {
      s.ody.rotation.y = approach(s.ody.rotation.y, 0.42 + (tx - s.potXs) * 0.055, dt, 0.85);
      s.ody.userData.arm.rotation.x = -0.75 - s.ladleTip * 0.8;
    }

    /* 쏟아지는 알곡 */
    if (s.fx) {
      s.fx.t += dt;
      var f = s.fx, ft = clamp(f.t / 0.42, 0, 1);
      var bx2 = s.bars[f.i].x;
      var yTop = C.barY + C.barH + 0.08, yBot = f.spill > 0.02 ? 0.05 : 1.06;
      var yy = lerp(yTop, yBot, ft);
      s.stream.position.set(bx2, (yTop + yy) * 0.5, C.barZ + 0.34);
      s.stream.scale.set(0.075 + f.spill * 0.06, Math.max(0.02, yTop - yy), 1);
      s.stream.material.opacity = (1 - ft) * 0.9;
      s.stream.material.color.setHex(f.spill > 0.02 ? 0xd8b878 : COL.grain);
      if (ft >= 1) { s.fx = null; s.stream.material.opacity = 0; }
    }

    /* 소 — 천천히 어슬렁거린다. 금빛이 숨 쉰다. */
    var scatter = (s.phase === 'doom') ? smooth(clamp((s.doomT - 0.55) / 0.7, 0, 1)) : 0;
    for (i = 0; i < s.cows.length; i++) {
      var cw = s.cows[i], ud = cw.userData;
      cw.position.y = ud.base + Math.sin(s.wall * 0.5 * ud.sp + ud.ph) * 0.045 +
                      scatter * Math.abs(Math.sin(s.wall * 11 + ud.ph)) * 0.35;
      cw.rotation.y = ud.ry + Math.sin(s.wall * 0.22 * ud.sp + ud.ph) * 0.26 +
                      scatter * 1.4;
      cw.position.x = ud.bx + scatter * (ud.ph > 3.14 ? 2.6 : -2.6);
    }
    if (s.cowMat) {
      var glow = 0.5 + 0.5 * Math.sin(s.wall * 0.9);
      s.cowMat.emissive.setRGB(0.20 + 0.06 * glow, 0.135 + 0.04 * glow, 0.012);
    }

    /* 해 — 하루가 지날수록 하늘을 가로지른다 */
    if (s.sun) {
      var dayT = clamp((g.t % C.DAYLEN) / C.DAYLEN, 0, 1);
      var ang = (dayT - 0.5) * 2.1;
      var sx = ang * 7.6;
      var sy = 15.2 - Math.abs(ang) * 6.6;
      s.sun.position.set(sx, sy, -55);
      s.halo.position.set(sx, sy, -54.6);
      s.halo.material.opacity = 0.05 + 0.03 * Math.sin(s.wall * 1.1);
    }

    /* 배 — 바람이 돌아오면 돛이 부푼다 */
    if (s.ship) {
      var sail = s.ship.sail;
      if (s.phase === 'wind') {
        var wu = smooth(s.windT / 1.2);
        sail.scale.set(3.9 + wu * 0.7, 1.85 + wu * 0.9, 0.05 + wu * 0.9);
        sail.position.z = 0.06 + wu * 0.55;
        sail.rotation.x = -wu * 0.16;
      } else {
        sail.scale.set(3.9, 1.85, 0.05);
        sail.position.z = 0.06;
        sail.rotation.x = 0;
      }
    }

    /* 벼락 */
    if (s.boltT > 0) {
      s.bolt.visible = s.boltT < 0.75;
      s.boltM.opacity = clamp(1 - s.boltT / 0.7, 0, 1) *
                        (0.65 + 0.35 * Math.sin(s.boltT * 80));
    } else s.bolt.visible = false;

    /* 화면 흔들림 */
    if (s.camera && s.camBase) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt * 1.6);
        var mg = s.shake * s.shake * 0.30;
        s.camera.position.set(
          s.camBase.x + (s.rnd() * 2 - 1) * mg,
          s.camBase.y + (s.rnd() * 2 - 1) * mg,
          s.camBase.z + (s.rnd() * 2 - 1) * mg * 0.5);
      } else s.camera.position.copy(s.camBase);
    }
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
    S.hud.hint(S.gotOne < 3);
  }
  function pause() { if (S && S.phase === 'run') S.phase = 'pause'; }

  function reset() {
    var s = S;
    if (!s) return;
    s.g = newGame(s.seed, s.crew0);
    s.phase = 'ready';
    s.shake = 0; s.buf = 0; s.doomT = 0; s.windT = 0; s.boltT = 0;
    s.lastDay = 1; s.mooAt = 3.0; s.spillMsgAt = -9; s.taught = 0;
    s.result = null; s.fx = null; s.gotOne = 0;
    s.ladleP = 1; s.ladleTip = 0; s.ladleAt = 0;
    for (var i = 0; i < s.men.length; i++) {
      var man = s.men[i];
      man.position.copy(man.userData.home);
      man.rotation.y = man.userData.ry0;
      man.scale.setScalar(1);
      man.userData.rose = false;
      var bar = s.bars[i];
      bar.pulse = 0; bar.tgM.opacity = 0;
    }
    s.stream.material.opacity = 0;
    s.bolt.visible = false;
    s.hud.end(null); s.hud.flash(''); s.hud.warn(''); s.hud.vig(0);
    s.hud.bolt(0); s.hud.hint(false);
    refreshHud(s);
    frame(s, 0);
  }

  function setCrew(n) {
    var s = S;
    if (!s) return null;
    if (typeof n === 'number' && isFinite(n)) {
      s.crew0 = Math.max(1, Math.round(n));
      s.opts.crew = s.crew0;
      s.g.crew = s.crew0;
    }
    return s.crew0;
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try { if (s.onKey) window.removeEventListener('keydown', s.onKey, false); } catch (e) { }
    try {
      if (s.onDown && s.inputTarget) {
        s.inputTarget.removeEventListener('pointerdown', s.onDown, false);
      }
    } catch (e) { }
    try { if (s.onWinResize) window.removeEventListener('resize', s.onWinResize, false); } catch (e) { }
    try { if (s.raf) cancelAnimationFrame(s.raf); } catch (e) { }
    try { s.snd.dispose(); } catch (e) { }
    try { s.hud.dispose(); } catch (e) { }
    try {
      if (s.world.parent) s.world.parent.remove(s.world);
      s.world.traverse(function (o) {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        if (o.material) {
          if (o.material.length) {
            for (var i = 0; i < o.material.length; i++) o.material[i].dispose();
          } else o.material.dispose();
        }
      });
    } catch (e) { }
    S = null;
  }

  /* ══════════════════════════════════════════════════════════════════════
     13. 단독 실행
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
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.touchAction = 'none';
      host.appendChild(canvas);
    } else throw new Error('mount 대상이 필요합니다.');

    var renderer = new T3.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 1100, canvas.clientHeight || 820, false);
    renderer.setClearColor(COL.bg, 1);
    var scene = new T3.Scene();
    scene.background = new T3.Color(COL.bg);
    scene.fog = new T3.Fog(0xa8c8dd, 42, 130);
    var camera = new T3.PerspectiveCamera(48, 1, 0.5, 400);
    scene.add(camera);
    var groot = new T3.Group();
    scene.add(groot);

    var st = init(groot, ui, {
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
     14. 디버그 — 검증 하네스가 쓰는 창구
     ════════════════════════════════════════════════════════════════════ */
  /* 원하는 지점까지 세계를 민다. policy 는 simulate 와 같은 이름. */
  function skipTo(sec, policy) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var dt = 1 / 60, n = Math.round(clamp(sec - s.g.t, 0, 400) / dt), i;
    var rnd = makeRng(9911);
    for (i = 0; i < n; i++) {
      if (s.phase !== 'run') break;
      if (policy) {
        var m = target(s.g);
        var want = false;
        if (m && m.state === 'walk') want = true;
        else if (policy === 'spam') want = true;
        else if (policy === 'late') want = m && m.h >= C.T;
        else if (policy === 'human') want = m && m.h >= C.R + (rnd() * 2 - 1) * 0.10;
        else want = m && m.h >= C.R;
        if (want) press(true);
      }
      update(dt, true);
    }
    update(0, false);
    return state();
  }

  function state() {
    var s = S;
    if (!s) return { ready: false };
    var g = s.g, hs = [], rs = [], i;
    for (i = 0; i < g.men.length; i++) {
      hs.push(+g.men[i].h.toFixed(3));
      rs.push(+rateOf(g, g.men[i]).toFixed(4));
    }
    var t = target(g);
    return {
      ready: true, phase: s.phase,
      t: +g.t.toFixed(2), day: g.day,
      food: g.food, cool: +g.cool.toFixed(2),
      h: hs, rate: rs,
      worst: +Math.max.apply(null, hs).toFixed(3),
      target: t ? t.i : -1,
      targetH: t ? +t.h.toFixed(3) : null,
      band: [C.R, C.T],
      poured: g.poured, spilled: +g.spilled.toFixed(2),
      perfect: g.perfect, late: g.late, early: g.early, saved: g.saved,
      walking: (function () { var n = 0, k; for (k = 0; k < g.men.length; k++)
                              if (g.men[k].state === 'walk') n++; return n; })(),
      over: g.over, win: g.win,
      result: s.result || null
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
    setCrew: setCrew,
    dispose: dispose,
    state: state,
    skipTo: skipTo,
    simulate: simulate,
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
