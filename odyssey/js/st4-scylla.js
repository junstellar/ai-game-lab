/* ============================================================================
   오디세이아 / ODYSSEY — st4-scylla.js  →  OD.St4
   4편 「스킬라와 카리브디스」 — 한 버튼 리듬 액션 (STAGES-3-6.md 「4편」)
   ----------------------------------------------------------------------------
   이 파일 하나가 4편의 전부를 소유한다: 장면 · 게임루프 · 입력 · 규칙 · 피드백.

   OD.St4.mount(root, ui, opts) -> stage     root = canvas | DOM | THREE.Object3D
   OD.St4.press(down)                        down!==false 면 한 번 젓는다 (탭 전용)
   OD.St4.update(dt) / start() / pause() / reset() / dispose() / resize(w,h)
   OD.St4.setCrew(n)                         이전 편에서 이어받은 부하 수
   OD.St4.onEnd = fn({win, lost, survived, taken, ...})

   ── 동사: 틈에 연타 ────────────────────────────────────────────────────
   1·2·3편이 "한 번 잘 누르기"였다면 4편은 **연속으로 여러 번**이다.
   스킬라의 머리 여섯이 각자 리듬으로 내려온다. 내려와 있는 동안 저으면
   한 명이 끌려 올라간다. 그런데 **쉴 수가 없다** — 젓지 않으면 카리브디스가
   배를 끌어당긴다. 그래서 "틈이 열리면 몰아치고, 닫히면 참는다"가 된다.

   ── 손실 0이 불가능한 이유 (설계) ──────────────────────────────────────
   진행도 0.30 / 0.60 / 0.86 지점에서 카리브디스가 **숨을 들이켠다**(서지).
   그동안 여섯 머리가 전부 내려와 틈이 아예 없고, 흡인력은 0.46/초다.
   서지 하나가 먹는 거리는 0.97 · 1.04 · 1.06 — **게이지 최대치(1.0)보다 크다.**
   즉 가득 채워 두고 버텨도 두 번은 반드시 머리 아래로 노를 넣어야 한다.
   완벽하면 2~3명, 못하면 여섯 이상. 결과 카드가 그 차이를 말한다.

   ── 게이지가 규칙을 가르친다 (1편과 같은 언어) ─────────────────────────
   1) 뱃머리 앞 물 위의 **타이밍 막대** — 초록이 남은 안전 시간(오른쪽 끝이
      틈이 닫히는 순간), 빨강이 다시 열릴 때까지. 1편의 안전 창 게이지 그대로.
   2) 갑판의 **붉은 자국** — 머리가 내려오기 0.46초 전부터 자리에 미리 그려진다.
      1편의 "손이 훑을 자리" 붉은 범위와 같은 언어.
   3) 오른쪽 세로 **소용돌이 거리** — 안 저으면 계속 줄어든다. 배가 실제로
      화면 아래(소용돌이)로 미끄러진다. 쉬는 것에 대가가 있다.
   4) 위쪽 **남은 거리** — 한 번 저을 때마다 눈에 띄게 찬다.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St4 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — 밸런스는 전부 여기서 바뀐다
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    nRow: 8,              // 스킬라가 닿는 쪽 노잡이 (한 명씩 잡혀 간다)

    cool: 0.14,           // 연타 상한 (≈7회/초)
    step: 0.0082,         // 한 번 젓기 = 진행 0.82% (≈122회로 완주)
    gain: 0.112,          // 한 번 젓기 = 소용돌이 거리 회복
    surgeGain: 0.34,      // ★ 서지 중 한 번 젓기 = 한 명을 내주고 크게 물러난다
    drain0: 0.125,        // 기본 흡인 (진행 0) — 손 놓으면 8초
    drainK: 0.28,         // 깊이 들어갈수록 세진다 (진행 1 → 0.160/초, 6.3초)
    surgeDrain: 0.46,     // 서지 동안의 흡인 — 게이지 하나를 통째로 먹는다
    powMin: 0.70,         // 노잡이를 잃으면 배가 느려진다 (0.70 + 0.30·생존율)

    stun: 0.62,           // 서지 중에 잡혔을 때 — 이건 실수가 아니라 거래다. 짧게.
    stunBad: 0.88,        // 그냥 연타하다 잡혔을 때 — 노를 못 잡는 시간이 길다.
                          // 연타를 막는 벽은 손실 숫자가 아니라 **이 정지**여야 한다.
                          // (손실로 막으면 신화의 '여섯'이 50이 되어 장면이 망가진다)
    freeze: 0.20,         // 잡히는 순간의 정지
    leadIn: 1.15,         // 시작 직후 리듬을 멈춰 두는 시간. 이만큼은 머리가 안 내려온다.
                          // 첫 틈이 0.95초뿐이라 "저어라"를 읽기도 전에 "멈춰라"로
                          // 넘어갔다 — 첫 수업이 눈에 들어올 시간을 준다.
    tel: 0.46,            // 머리가 내려오기 전 예고 시간
    back: 0.24,           // 물러가는 시간 — 짧아야 "아직 있다"로 안 읽힌다

    gSec: 1.5,            // 타이밍 게이지가 보여주는 시간 폭
    gPx: 4.10,            // 1초 = 4.10 유닛 (얇고 작아서 안 읽힌다는 지적 — 키웠다)
    gH: 0.70,             // 막대 두께
    gZ: 2.95,             // 뱃머리 앞 (카메라 쪽)

    // 여섯 머리는 늘 배 위에 떠 있다 — 어느 자리가 누구 것인지 한눈에 보이게
    hoverY: 6.2,          // 평소 떠 있는 높이
    hoverZ: -1.2,         // 배보다 살짝 절벽 쪽 — 갑판 자리와 가로로 맞아 보이게
    strikeY: 2.46,        // 갑판에 박는 높이 — 배가 가려지지 않을 만큼만
    rearY: 3.00,          // 예고 때 더 치켜드는 높이 — 치켜들면 온다

    // 배의 가로 위치 = 소용돌이 거리 그 자체
    lanNear: -3.0,        // 거리 1.0 — 절벽에 붙었다
    lanFar: 5.4,          // 거리 0   — 소용돌이 아가리
    cliffZ: -11.0,
    vortZ: 11.0,
    vortR: 6.4,
    deckY: 1.16,

    // 여섯 머리가 내려오는 자리 (배 위 x)
    hx: [-3.25, -1.95, -0.65, 0.65, 1.95, 3.25],
    // 노잡이 여덟 (스킬라 쪽 = 카메라 쪽 뱃전)
    rx: [-3.60, -2.57, -1.54, -0.51, 0.51, 1.54, 2.57, 3.60],
    rowZ: 0.46,

    // 카메라 — 배를 옆으로 보고, 위에 절벽 아래에 소용돌이
    camL: { fov: 44, halfH: 9.8, halfW: 7.0, ty: 3.0, tz: -0.4, el: 0.435 },
    camP: { fov: 60, halfH: 12.4, halfW: 6.1, ty: 3.4, tz: -0.8, el: 0.400 },

    scroll: 262           // 진행 1.0 당 배경이 흐르는 거리
  };

  /* ── 리듬 — 진행도에 따라 마디가 바뀐다. 머리가 하나씩 깨어난다 ────────
     각 마디: M = 마디 길이, s = [머리번호, 시작, 내려와 있는 시간]
     설계 의도: **깨끗한 틈 둘 + 벽 둘.** 틈이 잘게 쪼개지면 연타가 안 된다.  */
  var SEC = [
    { at: 0.00, M: 3.00, s: [[0, 0.00, 0.58], [3, 1.55, 0.55]] },
    { at: 0.18, M: 3.20, s: [[0, 0.00, 0.55], [3, 0.55, 0.50], [1, 2.10, 0.55]] },
    { at: 0.38, M: 3.40, s: [[0, 0.00, 0.52], [3, 0.52, 0.50],
                             [1, 2.00, 0.48], [4, 2.48, 0.46]] },
    { at: 0.58, M: 3.90, s: [[0, 0.00, 0.50], [3, 0.50, 0.48], [1, 0.98, 0.46],
                             [4, 2.35, 0.48], [2, 2.83, 0.46]] },
    { at: 0.78, M: 4.30, s: [[0, 0.00, 0.48], [3, 0.48, 0.46], [1, 0.94, 0.44],
                             [5, 2.25, 0.46], [4, 2.71, 0.44], [2, 3.15, 0.42]] }
  ];
  /* 안전 비율: 0.62 → 0.50 → 0.42 → 0.39 → 0.37 */

  /* 카리브디스가 숨을 들이켜는 순간 — 여섯이 한꺼번에 내려온다.
     먹는 거리 = len × surgeDrain. 게이지 최대치(1.0)와의 차이가 곧 최소 희생이다. */
  var SURGE = [
    { at: 0.30, len: 2.10 },   // 0.97 — 가득 채워 왔다면 딱 한 번 넘길 수 있다
    { at: 0.60, len: 2.30 },   // 1.06 — 가득 채워 와도 한 명은 반드시 내준다
    { at: 0.86, len: 2.45 }    // 1.13 — 여기서도 한 명
  ];

  var COL = {
    bg: 0x0d1620,
    sky: 0x1d2a3c, skyLow: 0x3a4a5e,
    sea: 0x14303c, seaLit: 0x1d4553, foam: 0xbcd8dc,
    cliff: 0x272533, cliffLit: 0x3d3a4c, cliffFar: 0x2b3648,
    grot: 0x08070c,
    hull: 0x4b3625, hullDark: 0x2c1f15, deck: 0x6d5237, trim: 0x93602e,
    oar: 0x7a5c3a, blade: 0x5d452b,
    skin: 0xc59a6d, tunic: 0xc4593f, tunic2: 0xa8823f,
    sSkin: 0x8fa07e, sDark: 0x5c6b52, maw: 0x4a121a, tooth: 0xf3eeda,
    eye: 0xffcf4a,
    danger: 0xff3a24, safe: 0x63e79b, amber: 0xffcf8a
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
  function mod(a, m) { return ((a % m) + m) % m; }
  function approach(cur, want, dt, k) { return lerp(cur, want, 1 - Math.pow(k, dt)); }

  /* ══════════════════════════════════════════════════════════════════════
     2. 순수 모델 — 위험 구간은 마디의 함수다. 게이지·판정·시뮬레이션이
        전부 이 하나에서 나온다.
     ════════════════════════════════════════════════════════════════════ */
  (function prepare() {
    for (var i = 0; i < SEC.length; i++) {
      var sec = SEC[i], raw = [], j, a, b;
      sec.heads = [];
      for (j = 0; j < sec.s.length; j++) {
        a = sec.s[j][1]; b = a + sec.s[j][2];
        if (sec.heads.indexOf(sec.s[j][0]) < 0) sec.heads.push(sec.s[j][0]);
        if (b <= sec.M) raw.push([a, b]);
        else { raw.push([a, sec.M]); raw.push([0, b - sec.M]); }
      }
      raw.sort(function (p, q) { return p[0] - q[0]; });
      sec.iv = mergeIv(raw);
      // 조회는 두 마디를 이어 붙인 목록에서 한다 (마디를 넘겨 다음 위험을 찾을 수 있게)
      var dbl = [], k;
      for (k = 0; k < sec.iv.length; k++) dbl.push([sec.iv[k][0], sec.iv[k][1]]);
      for (k = 0; k < sec.iv.length; k++) dbl.push([sec.iv[k][0] + sec.M, sec.iv[k][1] + sec.M]);
      sec.iv2 = mergeIv(dbl);
      var safe = 0;
      for (k = 0; k < sec.iv.length; k++) safe += sec.iv[k][1] - sec.iv[k][0];
      sec.safeFrac = 1 - safe / sec.M;
    }
  })();

  function mergeIv(raw) {
    var out = [], i;
    for (i = 0; i < raw.length; i++) {
      if (out.length && raw[i][0] <= out[out.length - 1][1] + 1e-4) {
        if (raw[i][1] > out[out.length - 1][1]) out[out.length - 1][1] = raw[i][1];
      } else out.push([raw[i][0], raw[i][1]]);
    }
    return out;
  }

  /* 마디 시각 u 에서의 진실 — 1편 probe() 와 같은 자리 */
  function probePat(sec, u) {
    var iv = sec.iv2, k;
    for (k = 0; k < iv.length; k++) {
      if (u < iv[k][0]) return { safe: true, remain: iv[k][0] - u, toExit: 0 };
      if (u < iv[k][1]) return { safe: false, remain: 0, toExit: iv[k][1] - u };
    }
    return { safe: true, remain: sec.M, toExit: 0 };
  }

  /* 지금 내려와 있는 머리들 */
  function headsDownAt(sec, u) {
    var out = [], j, a, d;
    for (j = 0; j < sec.s.length; j++) {
      a = sec.s[j][1]; d = sec.s[j][2];
      var r = mod(u - a, sec.M);
      if (r < d) out.push(sec.s[j][0]);
    }
    return out;
  }

  /* 머리 하나의 자세 — ext 0 배 위에 떠 있음 / 1 갑판에 박음,
     rear 는 내려오기 직전 치켜드는 정도(예고). 치켜들면 온다. 이게 예고선이다. */
  var POSE = { ext: 0, rear: 0 };
  function headPose(sec, u, head) {
    var out = POSE, j, a, d, r, p;
    out.ext = 0; out.rear = 0;
    for (j = 0; j < sec.s.length; j++) {
      if (sec.s[j][0] !== head) continue;
      a = sec.s[j][1]; d = sec.s[j][2];
      r = mod(u - a, sec.M);
      if (r < d) { out.ext = 1; out.rear = 0; }
      else if (r < d + C.back) {
        p = (r - d) / C.back;
        if (1 - p > out.ext) { out.ext = 1 - p; out.rear = 0.55 * p; }
      } else if (r > sec.M - C.tel) {
        p = (r - (sec.M - C.tel)) / C.tel;
        var rr = Math.sin(p * Math.PI * 0.5);
        if (rr > out.rear && out.ext <= 0.001) out.rear = rr;
      }
    }
    return out;
  }
  /* 예고/위험의 붉은 자국 세기 — 예고 동안 0→0.60, 내려와 있는 동안 1, 끝나면 즉시 0.
     ★ 자국이 게이지와 한 프레임도 어긋나면 안 된다. 붉은데 초록이면 거짓말이 된다. */
  function headHeat(sec, u, head) {
    var best = 0, j, a, d, r, e;
    for (j = 0; j < sec.s.length; j++) {
      if (sec.s[j][0] !== head) continue;
      a = sec.s[j][1]; d = sec.s[j][2];
      r = mod(u - a, sec.M);
      if (r < d) e = 1;
      else if (r > sec.M - C.tel) e = 0.60 * ((r - (sec.M - C.tel)) / C.tel);
      else e = 0;
      if (e > best) best = e;
    }
    return best;
  }

  function drainAt(g) {
    return g.surge ? C.surgeDrain : C.drain0 * (1 + C.drainK * g.prog);
  }
  function powerOf(g) {
    if (g.alive <= 0) return 0;
    return C.powMin + (1 - C.powMin) * (g.alive / g.nRow);
  }
  /* 서지 중에 넣는 노는 한 명을 내주는 대신 크게 물러난다 —
     "여섯을 내주고 배를 지켰다"가 규칙 자체가 되는 자리 */
  function gainOf(g) { return (g.surge ? C.surgeGain : C.gain) * powerOf(g); }
  /* 지금 이 순간의 위험 — 서지면 마디를 무시하고 통째로 위험이다 */
  function danger(g) {
    if (g.surge) {
      return { safe: false, remain: 0, toExit: Math.max(0, g.surge.end - g.t), surge: true };
    }
    var sec = SEC[g.sec];
    var p = probePat(sec, mod(g.pt, sec.M));
    p.surge = false;
    return p;
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 순수 상태 — 실제 플레이와 시뮬레이션이 같은 함수를 쓴다
     ════════════════════════════════════════════════════════════════════ */
  function newGame(crewIn, nRow) {
    return {
      // 첫 마디는 틈이 막 열린 자리에서 시작한다 — 시작하자마자 머리가 박혀 있으면 억울하다
      t: 0, pt: 0.60, prog: 0, grip: 1,
      lead: C.leadIn,                        // 이 동안 pt 가 멈춰 있다 = 머리도 멈춰 있다
      sec: 0, surge: null, surgeN: 0,
      stun: 0, cd: 0,
      nRow: nRow, alive: nRow, taken: 0,
      strokes: 0, wasted: 0, combo: 0, bestCombo: 0,
      crewIn: crewIn,
      over: null, minGrip: 1
    };
  }

  /* 세계를 dt 만큼 굴린다. 연출과 무관한 규칙만 여기 있다. */
  function stepWorld(g, dt) {
    if (g.over) return;
    g.t += dt;
    /* 도입부에는 마디 시계(pt)만 멈춘다 — 판정·게이지·머리 그림이 전부 pt 하나에서
       나오므로, 이것만 멈추면 셋이 저절로 맞는다(따로 예외를 두면 어긋난다). */
    if (g.lead > 0) g.lead = Math.max(0, g.lead - dt);
    else g.pt += dt;
    if (g.cd > 0) g.cd = Math.max(0, g.cd - dt);
    if (g.stun > 0) g.stun = Math.max(0, g.stun - dt);

    // 서지가 끝났나
    if (g.surge && g.t >= g.surge.end) g.surge = null;

    if (!g.surge) {
      // 마디 전환 — 머리가 하나 깨어난다
      while (g.sec + 1 < SEC.length && g.prog >= SEC[g.sec + 1].at) {
        g.sec++; g.woke = SEC[g.sec].heads[SEC[g.sec].heads.length - 1];
      }
      // 카리브디스가 숨을 들이켠다
      if (g.surgeN < SURGE.length && g.prog >= SURGE[g.surgeN].at) {
        g.surge = { t0: g.t, end: g.t + SURGE[g.surgeN].len, n: g.surgeN };
        g.surgeN++;
      }
    }

    g.grip -= drainAt(g) * dt;
    if (g.grip < g.minGrip) g.minGrip = g.grip;
    if (g.grip <= 0) {
      g.grip = 0;
      // 지는 길은 하나뿐이다 — 소용돌이. 노잡이를 잃어서 지는 규칙은 설계에 없다
      // (STAGES-3-6.md 4편: "잘하면 2~3명, 못하면 여섯 이상"). 손실은 점수지 사망이 아니다.
      g.over = { win: false, reason: 'charybdis' };
      return;
    }
    if (g.prog >= 1) { g.prog = 1; g.over = { win: true, reason: 'strait' }; }
  }

  /* 한 번 젓는다. 반환: 'row' | 'caught' | 'stun' | 'cool' | 'none' | 'dead' */
  function tryStroke(g) {
    if (g.over) return 'none';
    if (g.cd > 0) return 'cool';
    if (g.stun > 0) return 'stun';
    if (g.alive <= 0) return 'dead';
    g.cd = C.cool;
    var d = danger(g);
    var pw = powerOf(g);
    g.prog = Math.min(1, g.prog + C.step * pw);
    g.grip = Math.min(1, g.grip + gainOf(g));
    g.strokes++;
    if (d.safe) { g.combo++; if (g.combo > g.bestCombo) g.bestCombo = g.combo; return 'row'; }
    // 머리 아래로 노를 넣었다 — 배는 나아가지만 한 명이 끌려 올라간다
    // 머리 아래로 노를 넣었다 — 배는 나아가지만 한 명이 끌려 올라간다.
    // 빈 자리는 곧바로 다른 부하가 채운다. 배에는 아직 수백 명이 타고 있다 —
    // 노 여덟 자리가 비었다고 배가 죽는 건 말이 안 되고, 설계에도 없다.
    g.combo = 0; g.taken++; g.wasted++;
    g.stun = d.surge ? C.stun : C.stunBad;
    g.alive = Math.max(0, Math.min(g.nRow, g.crewIn - g.taken));
    if (g.prog >= 1) { g.prog = 1; g.over = { win: true, reason: 'strait' }; }
    return 'caught';
  }

  /* ── 사람의 판단을 흉내낸다 ─────────────────────────────────────────
     안전하면 젓는다. 위험하면 참되, **끝까지 기다리면 빨려 들어갈 때**만
     머리 밑으로 노를 넣는다. 게이지가 아직 넉넉하면 더 참는다
     (가득 찬 채로 넣는 건 회복분이 잘려 나가는 낭비다).                   */
  function mustRow(g, d, hold, slack) {
    if (d.safe) return true;
    if (slack == null) slack = 0.02;
    if (slack < -1) return false;               // 절대 강행하지 않는 겁쟁이
    var dr = drainAt(g);
    if (g.grip - dr * Math.min(d.toExit, 8) > slack) return false;
    return g.grip <= dr * ((hold == null) ? 0.75 : hold) + slack;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 시뮬레이션 — "완벽해도 2~3명"을 숫자로 확인한다
     ════════════════════════════════════════════════════════════════════ */
  function simulate(o) {
    o = o || {};
    var rate = o.rate || 5.0;
    var perfect = o.perfect !== false;
    var slack = (o.slack == null) ? 0.02 : o.slack;
    var jitter = (o.jitter == null) ? 0 : o.jitter;
    var rnd = makeRng(o.seed || 4004);
    var g = newGame(o.crew || 8, C.nRow);
    var dt = 1 / 240, gapT = Math.max(C.cool, 1 / rate), last = -9;
    var guard = 0;
    while (!g.over && guard++ < 240 * 400) {
      var d = danger(g);
      var ready = (g.t - last) >= gapT * (1 + (jitter ? (rnd() * 2 - 1) * jitter : 0)) &&
                  g.cd <= 0 && g.stun <= 0 && g.alive > 0;
      if (ready) {
        var go = perfect ? mustRow(g, d, o.hold, slack) : true;
        if (go) { tryStroke(g); last = g.t; }
      }
      stepWorld(g, dt);
    }
    return {
      rate: rate, perfect: perfect,
      win: !!(g.over && g.over.win), reason: g.over ? g.over.reason : 'timeout',
      taken: g.taken, alive: g.alive,
      time: +g.t.toFixed(1), prog: +g.prog.toFixed(3),
      strokes: g.strokes, minGrip: +g.minGrip.toFixed(3),
      surges: g.surgeN, sec: g.sec
    };
  }

  /* 마디별 안전 비율 — 밸런스 확인용 */
  function tuning() {
    var out = [], i;
    for (i = 0; i < SEC.length; i++) {
      out.push({ at: SEC[i].at, M: SEC[i].M, heads: SEC[i].heads.length,
                 safe: +SEC[i].safeFrac.toFixed(3),
                 iv: SEC[i].iv.map(function (v) { return [+v[0].toFixed(2), +v[1].toFixed(2)]; }) });
    }
    var s = [], k;
    for (k = 0; k < SURGE.length; k++) s.push(+(SURGE[k].len * C.surgeDrain).toFixed(3));
    return { sections: out, surgeCost: s, gripMax: 1,
             gain: C.gain, surgeGain: C.surgeGain,
             needRate0: +(C.drain0 / C.gain).toFixed(2),
             needRate1: +(C.drain0 * (1 + C.drainK) / C.gain).toFixed(2),
             restSec0: +(1 / C.drain0).toFixed(1),
             restSec1: +(1 / (C.drain0 * (1 + C.drainK))).toFixed(1),
             strokesToEnd: Math.ceil(1 / C.step) };
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 지오메트리 헬퍼
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

  function M4(x, y, z, sx, sy, sz, rx, ry, rz) {
    var m = new T3.Matrix4();
    var q = new T3.Quaternion().setFromEuler(new T3.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(new T3.Vector3(x, y, z), q,
              new T3.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return m;
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. 소리 — WebAudio 최소 합성
     ════════════════════════════════════════════════════════════════════ */
  function makeAudio(rnd) {
    var ctx = null, master = null, noise = null;
    var swG = null, swF = null, on = true, ready = false;

    function ensure() {
      if (ctx || !on) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return null; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.5;
        master.connect(ctx.destination);

        var len = Math.floor(ctx.sampleRate * 1.6);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        var sw = ctx.createBufferSource();
        sw.buffer = noise; sw.loop = true;
        swF = ctx.createBiquadFilter();
        swF.type = 'lowpass'; swF.frequency.value = 240; swF.Q.value = 1.0;
        swG = ctx.createGain(); swG.gain.value = 0.03;
        sw.connect(swF); swF.connect(swG); swG.connect(master);
        sw.start();
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
        g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(bp); bp.connect(g); g.connect(master);
        s.start(t); s.stop(t + dur + 0.02);
      } catch (e) { }
    }
    return {
      resume: resume,
      get ready() { return ready; },
      /* 소용돌이 — 가까울수록 커진다 */
      swirl: function (lv) {
        if (!ctx || !swG) return;
        try {
          swG.gain.setTargetAtTime(0.025 + 0.34 * lv * lv, now(), 0.08);
          swF.frequency.setTargetAtTime(200 + 520 * lv, now(), 0.12);
        } catch (e) { }
      },
      row: function (n) {
        var p = 1 + Math.min(n, 8) * 0.035;
        tone('triangle', 190 * p, 96 * p, 0.10, 0.13);
        burst(1500, 1.4, 0.09, 0.055);
      },
      hiss: function () { burst(3100, 1.6, 0.16, 0.045); },
      bite: function () {
        tone('square', 240, 60, 0.16, 0.20);
        burst(520, 0.7, 0.24, 0.16);
        tone('sawtooth', 720, 180, 0.42, 0.11);
      },
      scream: function () {
        tone('sawtooth', 880, 210, 0.55, 0.10);
        tone('sine', 640, 190, 0.50, 0.07);
      },
      inhale: function () {
        tone('sine', 70, 30, 1.5, 0.34);
        burst(180, 0.5, 1.6, 0.20);
      },
      wake: function () { tone('sine', 150, 78, 0.70, 0.18); burst(420, 0.9, 0.5, 0.08); },
      good: function () { tone('sine', 560, 1080, 0.30, 0.20); tone('triangle', 840, 1620, 0.26, 0.09); },
      doom: function () { tone('sine', 120, 34, 1.4, 0.34); burst(240, 0.6, 1.6, 0.18); },
      tick: function () { burst(400, 1.2, 0.05, 0.04); },
      mute: function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () { try { if (ctx) ctx.close(); } catch (e) { } ctx = null; }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. HUD — 최소한만. 설명 문장 대신 막대가 말한다.
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st4-css';
  var CSS = [
    '.st4{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#e9eef2;-webkit-user-select:none;user-select:none;z-index:5}',
    '.st4 .bar{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;',
    'align-items:flex-start;padding:14px 16px;gap:14px}',
    '.st4 .crew{display:flex;align-items:baseline;gap:8px}',
    '.st4 .crew b{font-size:2.1rem;line-height:1;font-weight:800;letter-spacing:-.03em;',
    'text-shadow:0 2px 10px #000;transition:color .18s ease}',
    /* 여섯이 신화의 선이다 — 넘어가면 색이 바뀐다 */
    '.st4 .crew.over b{color:#ff6a3c}',
    '.st4 .crew .lab{font-size:.74rem;font-weight:700;letter-spacing:.02em;color:#93a0aa;',
    'text-shadow:0 1px 6px #000}',
    '.st4 .pips{display:flex;gap:5px;flex-wrap:wrap;max-width:120px}',
    '.st4 .pip{width:9px;height:9px;border-radius:50%;background:#e9eef2;',
    'box-shadow:0 0 6px rgba(0,0,0,.8);transition:background .2s,transform .25s}',
    '.st4 .pip.lost{background:#3a1d1a;box-shadow:inset 0 0 0 1.5px #a3392a;transform:scale(.82)}',
    /* 남은 거리 — 저을 때마다 눈에 띄게 찬다 */
    '.st4 .road{position:relative;width:40%;max-width:262px;min-width:128px;margin-top:9px;',
    'padding-right:20px}',
    '.st4 .road .trk{position:relative;height:13px;border-radius:99px;background:rgba(6,13,19,.78);',
    'box-shadow:inset 0 0 0 1.5px rgba(190,215,225,.30),0 2px 10px rgba(0,0,0,.6)}',
    '.st4 .road .fil{position:absolute;left:2px;top:2px;bottom:2px;border-radius:99px;',
    'background:linear-gradient(90deg,#3f7f95,#9ee2ef);transition:width .16s ease-out;',
    'box-shadow:0 0 10px rgba(120,210,235,.5)}',
    '.st4 .road .shp{position:absolute;top:-8px;width:0;height:0;margin-left:-7px;',
    'border-left:7px solid transparent;border-right:7px solid transparent;',
    'border-bottom:11px solid #ffe6bd;transition:left .16s ease-out;filter:drop-shadow(0 1px 3px #000)}',
    '.st4 .road .gt{position:absolute;right:0;top:-2px;font-size:1rem;opacity:.9;',
    'line-height:1;letter-spacing:-2px;text-shadow:0 2px 6px #000}',
    /* 소용돌이 거리 — 오른쪽 세로. 줄이 짧아질수록 아가리에 가깝다. */
    '.st4 .pull{position:absolute;right:14px;top:22%;bottom:12%;width:26px;',
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-end}',
    '.st4 .pull .rail{position:absolute;left:11px;top:0;bottom:26px;width:4px;border-radius:3px;',
    'background:rgba(8,16,22,.55)}',
    '.st4 .pull .gap{position:absolute;left:9px;bottom:26px;width:8px;border-radius:5px;',
    'background:#63c9e7;box-shadow:0 0 10px rgba(99,201,231,.6)}',
    '.st4 .pull .boat{position:absolute;left:1px;width:24px;height:0;',
    'border-left:9px solid transparent;border-right:9px solid transparent;',
    'border-top:11px solid #ffe6bd;margin-bottom:-4px;filter:drop-shadow(0 1px 3px #000)}',
    '.st4 .pull .eye{position:absolute;bottom:0;left:1px;width:24px;height:24px;border-radius:50%;',
    'background:radial-gradient(circle at 50% 50%,#0b0d10 22%,#5c2418 55%,#c2451f 100%);',
    'box-shadow:0 0 12px rgba(200,70,30,.55)}',
    '.st4 .pull.warn .gap{background:#ff6a3c;box-shadow:0 0 16px rgba(255,80,40,.85)}',
    '.st4 .pull.warn .eye{animation:st4sp .7s linear infinite}',
    '@keyframes st4sp{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
    /* 화면 가장자리 — 소용돌이가 가까워지면 붉어진다 */
    '.st4 .vig{position:absolute;inset:0;opacity:0;transition:opacity .3s;',
    'box-shadow:inset 0 0 130px 26px rgba(190,45,20,.85)}',
    '.st4 .cue{position:absolute;left:50%;top:85%;transform:translate(-50%,-50%) scale(.82);',
    'font-size:2.3rem;font-weight:900;letter-spacing:-.02em;opacity:0;color:#ffd98c;',
    'text-shadow:0 0 26px rgba(0,0,0,.95),0 3px 12px #000;transition:opacity .12s}',
    '.st4 .cue.on{opacity:1;transform:translate(-50%,-50%) scale(1);transition:opacity .1s,transform .2s}',
    '.st4 .cue.stop{color:#ff6a3c}',
    /* 결과 문구는 화면 위쪽 — 배·게이지·소용돌이 어느 것과도 겹치지 않는 유일한 띠 */
    '.st4 .flash{position:absolute;left:50%;top:17%;transform:translate(-50%,-50%);',
    'font-size:1.22rem;font-weight:800;opacity:0;white-space:nowrap;text-align:center;',
    'text-shadow:0 2px 12px #000,0 0 20px rgba(0,0,0,.95);transition:opacity .2s,top .4s}',
    '.st4 .flash.on{opacity:1;top:14%}',
    '.st4 .flash u{display:block;margin-top:3px;font-size:.9rem;font-weight:700;',
    'text-decoration:none;letter-spacing:.02em;opacity:.9}',
    '.st4 .flash.on.soft{opacity:.8;font-size:1rem;font-weight:700}',
    '.st4 .hint{position:absolute;left:50%;bottom:3.4%;transform:translateX(-50%);',
    'font-size:.9rem;font-weight:600;color:#cfdbe2;opacity:0;white-space:nowrap;',
    'padding:7px 15px;border-radius:999px;background:rgba(8,14,20,.45);',
    'text-shadow:0 2px 10px #000;transition:opacity .5s}',
    '.st4 .hint.on{opacity:.9}',
    '.st4 .hint b{color:#63e79b;font-weight:800}',
    '.st4 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:14px;background:rgba(5,10,14,.88);',
    'opacity:0;pointer-events:none;visibility:hidden;',
    'transition:opacity .35s;text-align:center;padding:26px}',
    '.st4 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st4 .end h2{font-size:1.65rem;font-weight:800;margin:0}',
    '.st4 .end p{font-size:1rem;color:#adb9c2;margin:0;line-height:1.75;max-width:24em}',
    '.st4 .end em{display:block;margin-top:10px;font-style:italic;color:#8f9aa4;font-size:.95rem}',
    '.st4 .end b{color:#ffd88f}',
    '.st4 .end button{margin-top:8px;padding:11px 26px;border-radius:999px;',
    'border:1px solid #3d4c56;background:#131b21;color:#e9eef2;font-size:1rem;font-weight:700;',
    'cursor:pointer;font-family:inherit}',
    '.st4 .end button:active{transform:translateY(1px)}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function makeHud(host, nRow) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'st4';
    el.innerHTML =
      '<div class="bar">' +
        '<div class="crew"><b>0</b><span class="lab">스킬라에게 잃음</span></div>' +
        '<div class="road"><div class="trk"><i class="fil"></i><s class="shp"></s></div>' +
        '<span class="gt">▮▮</span></div>' +
      '</div>' +
      '<div class="pull"><i class="rail"></i><i class="gap"></i><i class="boat"></i>' +
        '<i class="eye"></i></div>' +
      '<div class="vig"></div>' +
      '<div class="cue">저어라</div>' +
      '<div class="flash"><span></span><u></u></div>' +
      /* 이 한 줄이 사람을 죽이고 있었다 — "연타해 젓는다"만 읽고 계속 누르면
         머리 밑으로 노를 넣어 부하가 줄줄이 끌려간다. 규칙의 나머지 절반을 적는다. */
      '<div class="hint">머리가 <b>물러난 사이</b>에만 연타 · 내려오면 멈춘다</div>' +
      '<div class="end"><h2></h2><p></p><button type="button">다시</button></div>';
    host.appendChild(el);

    var big = el.querySelector('.crew b'),
        crewBox = el.querySelector('.crew'),
        fil = el.querySelector('.road .fil'),
        shp = el.querySelector('.road .shp'),
        pull = el.querySelector('.pull'),
        gap = el.querySelector('.pull .gap'),
        boat = el.querySelector('.pull .boat'),
        vig = el.querySelector('.vig'),
        cue = el.querySelector('.cue'),
        flash = el.querySelector('.flash'),
        fT1 = el.querySelector('.flash span'),
        fT2 = el.querySelector('.flash u'),
        hint = el.querySelector('.hint'),
        end = el.querySelector('.end'),
        endH = el.querySelector('.end h2'),
        endP = el.querySelector('.end p'),
        endB = el.querySelector('.end button');

    var flashT = 0, lastCrew = -1, lastProg = -1, lastWarn = null;

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },
      /* 올라가는 숫자다 — 잃은 수. 여섯을 넘으면 붉어진다(신화의 선) */
      crew: function (taken) {
        if (taken === lastCrew) return;
        lastCrew = taken;
        big.textContent = String(taken);
        crewBox.className = taken > 6 ? 'crew over' : 'crew';
      },
      road: function (p) {
        var q = Math.round(p * 1000);
        if (q === lastProg) return;
        lastProg = q;
        fil.style.width = (p * 100).toFixed(1) + '%';
        shp.style.left = (p * 100).toFixed(1) + '%';
      },
      /* 소용돌이까지 남은 줄 — 짧아질수록 아가리에 붙는다 */
      pullBar: function (grip) {
        var h = clamp(grip, 0, 1);
        gap.style.height = 'calc((100% - 34px) * ' + h.toFixed(3) + ')';
        boat.style.bottom = 'calc(26px + (100% - 34px) * ' + h.toFixed(3) + ')';
        var warn = h < 0.32;
        if (warn !== lastWarn) { lastWarn = warn; pull.className = warn ? 'pull warn' : 'pull'; }
        vig.style.opacity = h < 0.34 ? ((0.34 - h) / 0.34 * 0.6).toFixed(2) : '0';
      },
      /* 규칙의 양쪽을 다 가르친다. 예전엔 "저어라"만 띄우고 멈추라는 말을
         한 번도 안 해서, 안내를 그대로 따른 사람이 연타하다 전멸했다. */
      cue: function (on, stop) {
        cue.textContent = stop ? '멈춰라' : '저어라';
        cue.className = on ? (stop ? 'cue on stop' : 'cue on') : 'cue';
      },
      hint: function (on) { hint.className = on ? 'hint on' : 'hint'; },
      flash: function (txt, col, why, soft) {
        if (!txt) { flash.className = 'flash'; flashT = 0; return; }
        fT1.textContent = txt;
        fT2.textContent = why || '';
        flash.style.color = col;
        flash.className = soft ? 'flash on soft' : 'flash on';
        flashT = soft ? 0.6 : 1.15;
      },
      tick: function (dt) {
        if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.className = 'flash'; }
      },
      end: function (r) {
        if (!r) { end.className = 'end'; return; }
        endH.textContent = r.head;
        endP.innerHTML = r.body + '<em>' + r.em + '</em>';
        end.className = 'end on';
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 장면
     ════════════════════════════════════════════════════════════════════ */

  /* ── 노잡이 한 명 (앉아서 노를 쥔 자세) ── */
  function rowerGroup(tunicCol) {
    var g = new T3.Group();
    var mS = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var mC = new T3.MeshLambertMaterial({ color: tunicCol, flatShading: true });
    var torso = new T3.Mesh(new T3.SphereGeometry(0.19, 8, 6), mC);
    torso.scale.set(0.92, 1.15, 0.86); torso.position.y = 0.34;
    var head = new T3.Mesh(new T3.SphereGeometry(0.115, 8, 6), mS);
    head.position.set(0.02, 0.60, 0);
    var armL = new T3.Mesh(new T3.BoxGeometry(0.40, 0.085, 0.085), mS);
    armL.position.set(0.22, 0.40, 0.12); armL.rotation.z = -0.30;
    var armR = new T3.Mesh(new T3.BoxGeometry(0.40, 0.085, 0.085), mS);
    armR.position.set(0.22, 0.40, -0.12); armR.rotation.z = -0.30;
    var leg = new T3.Mesh(new T3.BoxGeometry(0.34, 0.10, 0.10), mS);
    leg.position.set(0.20, 0.13, 0.09);
    var leg2 = leg.clone(); leg2.position.z = -0.09;
    var body = new T3.Group();
    body.add(torso, head, armL, armR, leg, leg2);
    g.add(body);

    // 노 — 뱃전에 걸쳐 물로 뻗는다
    var oar = new T3.Group();
    var shaft = new T3.Mesh(new T3.CylinderGeometry(0.055, 0.045, 2.9, 6),
                            new T3.MeshLambertMaterial({ color: COL.oar, flatShading: true }));
    shaft.rotation.z = Math.PI / 2; shaft.position.x = 1.30;
    var blade = new T3.Mesh(new T3.BoxGeometry(0.62, 0.05, 0.24),
                            new T3.MeshLambertMaterial({ color: COL.blade, flatShading: true }));
    blade.position.x = 2.90;
    oar.add(shaft, blade);
    oar.position.set(0.30, 0.44, 0.30);
    oar.rotation.z = -0.34;
    g.add(oar);

    g.userData.body = body;
    g.userData.oar = oar;
    return g;
  }

  /* ── 배 — 그리스 갤리. 돛대는 눕혔다(노를 젓는 중) ── */
  function shipGeo() {
    var p = [], i;
    var sph = new T3.SphereGeometry(0.5, 14, 10);
    var box = new T3.BoxGeometry(1, 1, 1);
    var cyl = new T3.CylinderGeometry(1, 1, 1, 8);

    // 선체
    p.push({ g: sph, m: M4(0, 0.52, 0, 9.6, 1.30, 1.90), c: COL.hull });
    p.push({ g: sph, m: M4(0, 0.30, 0, 8.6, 0.90, 1.55), c: COL.hullDark });
    // 갑판
    p.push({ g: box, m: M4(0, C.deckY - 0.07, 0, 8.9, 0.14, 1.62), c: COL.deck });
    // 뱃전 (양쪽)
    p.push({ g: box, m: M4(0, C.deckY + 0.10, 0.86, 8.9, 0.30, 0.13), c: COL.trim });
    p.push({ g: box, m: M4(0, C.deckY + 0.10, -0.86, 8.9, 0.30, 0.13), c: COL.trim });
    // 이물 기둥 (오른쪽) — 눈이 그려진 뱃머리
    p.push({ g: cyl, m: M4(4.62, 1.35, 0, 0.26, 1.50, 0.26, 0, 0, -0.30), c: COL.hull });
    p.push({ g: sph, m: M4(4.95, 2.10, 0, 0.55, 0.62, 0.42), c: COL.trim });
    p.push({ g: sph, m: M4(4.35, 1.35, 0.62, 0.42, 0.42, 0.12), c: 0xf0e7d2 });
    p.push({ g: sph, m: M4(4.35, 1.35, -0.62, 0.42, 0.42, 0.12), c: 0xf0e7d2 });
    p.push({ g: sph, m: M4(4.33, 1.35, 0.68, 0.19, 0.19, 0.10), c: 0x16181c });
    p.push({ g: sph, m: M4(4.33, 1.35, -0.68, 0.19, 0.19, 0.10), c: 0x16181c });
    // 충각
    p.push({ g: box, m: M4(5.30, 0.28, 0, 1.20, 0.24, 0.34), c: COL.hullDark });
    // 고물 기둥 (왼쪽) — 말려 올라간다
    p.push({ g: cyl, m: M4(-4.62, 1.50, 0, 0.24, 1.80, 0.24, 0, 0, 0.34), c: COL.hull });
    p.push({ g: sph, m: M4(-5.10, 2.30, 0, 0.44, 0.44, 0.34), c: COL.trim });
    // 눕힌 돛대 + 받침
    p.push({ g: cyl, m: M4(-0.4, C.deckY + 0.30, 0, 0.17, 6.6, 0.17, 0, 0, Math.PI / 2), c: 0x5f4a30 });
    for (i = -1; i <= 1; i++)
      p.push({ g: box, m: M4(i * 2.3, C.deckY + 0.16, 0, 0.22, 0.34, 0.30), c: 0x4b3a26 });
    // 노 젓는 자리 (가로대)
    for (i = 0; i < 8; i++)
      p.push({ g: box, m: M4(C.rx[i], C.deckY + 0.10, 0, 0.22, 0.13, 1.60), c: 0x594227 });

    var g = merge(p);
    sph.dispose(); box.dispose(); cyl.dispose();
    return g;
  }

  /* ── 스킬라의 머리 하나 ── */
  function headGroup() {
    var g = new T3.Group();
    var mS = new T3.MeshLambertMaterial({ color: COL.sSkin, flatShading: true });
    var mD = new T3.MeshLambertMaterial({ color: COL.sDark, flatShading: true });
    var mM = new T3.MeshBasicMaterial({ color: COL.maw });
    var mT = new T3.MeshLambertMaterial({ color: COL.tooth, flatShading: true });
    var mE = new T3.MeshBasicMaterial({ color: COL.eye });

    var ico = new T3.IcosahedronGeometry(1, 0);
    var box = new T3.BoxGeometry(1, 1, 1);

    // 두개골 — +x 가 주둥이 방향
    var skull = new T3.Mesh(ico, mS);
    skull.scale.set(0.78, 0.52, 0.56);
    g.add(skull);
    var snout = new T3.Mesh(ico, mS);
    snout.scale.set(0.62, 0.32, 0.34); snout.position.set(0.78, -0.08, 0);
    g.add(snout);
    var crest = new T3.Mesh(ico, mD);
    crest.scale.set(0.52, 0.26, 0.30); crest.position.set(-0.28, 0.44, 0);
    g.add(crest);

    // 아래턱 — 벌어진다
    var jaw = new T3.Group();
    jaw.position.set(0.10, -0.22, 0);
    var jm = new T3.Mesh(ico, mD);
    jm.scale.set(0.66, 0.20, 0.40); jm.position.set(0.46, -0.06, 0);
    jaw.add(jm);
    g.add(jaw);

    // 목구멍
    var maw = new T3.Mesh(box, mM);
    maw.scale.set(0.72, 0.26, 0.52); maw.position.set(0.52, -0.14, 0);
    g.add(maw);

    // 이빨
    var t, tt;
    for (t = 0; t < 5; t++) {
      tt = new T3.Mesh(box, mT);
      tt.scale.set(0.09, 0.20, 0.09);
      tt.position.set(0.34 + t * 0.20, -0.10, 0.20 - (t % 2) * 0.40);
      g.add(tt);
      var tb = new T3.Mesh(box, mT);
      tb.scale.set(0.08, 0.17, 0.08);
      tb.position.set(0.40 + t * 0.19, -0.02, 0.18 - (t % 2) * 0.36);
      jaw.add(tb);
    }
    // 눈 둘
    var e1 = new T3.Mesh(ico, mE);
    e1.scale.setScalar(0.11); e1.position.set(0.30, 0.18, 0.34);
    var e2 = e1.clone(); e2.position.z = -0.34;
    g.add(e1, e2);

    g.userData.jaw = jaw;
    g.userData.eyes = [e1, e2];
    g.userData.geos = [ico, box];
    g.userData.mats = [mS, mD, mM, mT, mE];
    return g;
  }

  /* ── 절벽 · 굴 · 먼 배경 ── */
  function buildStrait(root, rnd) {
    var out = { mats: [], geos: [], scrollers: [] };
    function mat(m) { out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }

    // 하늘
    var sky = new T3.Mesh(geo(new T3.PlaneGeometry(260, 90)),
                          mat(new T3.MeshBasicMaterial({ color: COL.sky })));
    sky.position.set(0, 22, -46); root.add(sky);
    var skyLow = new T3.Mesh(geo(new T3.PlaneGeometry(260, 16)),
                             mat(new T3.MeshBasicMaterial({ color: COL.skyLow })));
    skyLow.position.set(0, 5.5, -45.6); root.add(skyLow);

    // 바다
    var seaG = geo(new T3.PlaneGeometry(300, 130));
    var sea = new T3.Mesh(seaG, mat(new T3.MeshLambertMaterial({ color: COL.sea })));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0, -6); root.add(sea);

    // 먼 이탈리아 쪽 능선
    var farG = geo(new T3.IcosahedronGeometry(1, 0));
    var farM = mat(new T3.MeshLambertMaterial({ color: COL.cliffFar, flatShading: true }));
    var farGrp = new T3.Group(); root.add(farGrp);
    var i;
    for (i = 0; i < 22; i++) {
      var fm = new T3.Mesh(farG, farM);
      fm.position.set(-110 + i * 11 + rnd() * 4, 2 + rnd() * 5, -34 - rnd() * 5);
      fm.scale.set(6 + rnd() * 5, 7 + rnd() * 9, 5);
      fm.rotation.set(rnd(), rnd() * 3, rnd() * 0.3);
      farGrp.add(fm);
    }
    out.scrollers.push({ grp: farGrp, k: 0.22, span: 242 });

    // 스킬라 쪽 절벽 — 고정 (굴이 배를 따라온다). 위로 하늘이 보이게 낮춘다.
    var clG = geo(new T3.IcosahedronGeometry(1, 0));
    var clM = mat(new T3.MeshLambertMaterial({ color: COL.cliff, flatShading: true }));
    var clM2 = mat(new T3.MeshLambertMaterial({ color: COL.cliffLit, flatShading: true }));
    var wall = new T3.Mesh(geo(new T3.BoxGeometry(220, 26, 6)), clM);
    wall.position.set(0, 7.5, C.cliffZ - 3.6); root.add(wall);

    var spur = new T3.Group(); root.add(spur);
    for (i = 0; i < 30; i++) {
      var sm = new T3.Mesh(clG, (i % 3 === 0) ? clM2 : clM);
      sm.position.set(-96 + i * 6.4 + rnd() * 2.2, 2.0 + rnd() * 11, C.cliffZ + 0.6 + rnd() * 1.4);
      sm.scale.set(2.4 + rnd() * 2.4, 4.0 + rnd() * 7.5, 2.0 + rnd() * 1.4);
      sm.rotation.set(rnd() * 0.4, rnd() * 3, rnd() * 0.5);
      spur.add(sm);
    }
    out.scrollers.push({ grp: spur, k: 1.0, span: 192 });

    // 굴 — 여섯 목이 나오는 아가리
    var grot = new T3.Group();
    grot.position.set(-1.2, 8.4, C.cliffZ + 0.9);
    root.add(grot);
    var mouth = new T3.Mesh(geo(new T3.CircleGeometry(1, 24)),
                            mat(new T3.MeshBasicMaterial({ color: COL.grot })));
    mouth.scale.set(11.5, 4.4, 1); grot.add(mouth);
    var lip = new T3.Mesh(clG, clM2);
    lip.scale.set(13.5, 2.0, 2.2); lip.position.set(0, 4.7, 0.6); grot.add(lip);
    var lip2 = new T3.Mesh(clG, clM);
    lip2.scale.set(12.6, 2.1, 2.1); lip2.position.set(0, -4.4, 0.5); grot.add(lip2);
    out.grot = grot;

    // 물 위를 흐르는 물살 — 진행이 눈에 보이게. 배와 절벽 사이에만 둔다.
    var stripG = geo(new T3.PlaneGeometry(1, 1));
    var stripM = mat(new T3.MeshBasicMaterial({ color: COL.foam, transparent: true,
                                                opacity: 0.11, depthWrite: false,
                                                blending: T3.AdditiveBlending }));
    var strips = new T3.InstancedMesh(stripG, stripM, 46);
    strips.frustumCulled = false;
    strips.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    strips.renderOrder = -3;
    root.add(strips);
    out.strips = strips;
    out.stripSeed = [];
    for (i = 0; i < 46; i++)
      out.stripSeed.push([rnd() * 130 - 65, -9.5 + rnd() * 9.5, 1.2 + rnd() * 2.2, rnd()]);

    /* 해협의 출구 — 진행 0.6 부터 오른쪽에서 다가온다. 두 기둥 사이로 빛이 든다.
       배 앞을 가로막지 않게 절벽 쪽과 소용돌이 바깥쪽에 하나씩만 세운다. */
    var gate = new T3.Group(); root.add(gate);
    var gm = new T3.Mesh(clG, clM2);
    gm.position.set(-1.0, 6.5, C.cliffZ + 2.2); gm.scale.set(3.2, 9.0, 3.0);
    gm.rotation.set(0.2, 1.1, 0.1);
    var gm2 = new T3.Mesh(clG, clM);
    gm2.position.set(3.0, 4.6, C.vortZ + 4.5); gm2.scale.set(4.2, 7.0, 3.6);
    gm2.rotation.set(0.3, 0.6, 0.2);
    var glow = new T3.Mesh(geo(new T3.CircleGeometry(8, 30)),
                           mat(new T3.MeshBasicMaterial({ color: 0xffe3b0, transparent: true,
                                                          opacity: 0.0, depthWrite: false,
                                                          blending: T3.AdditiveBlending })));
    glow.position.set(1.4, 3.2, C.cliffZ + 3.4);
    glow.scale.set(1.0, 0.92, 1);
    glow.renderOrder = -4;
    gate.add(gm, gm2, glow);
    out.gate = gate; out.gateGlow = glow;

    return out;
  }

  /* ── 카리브디스 ── */
  function buildVortex(root) {
    var out = { mats: [], geos: [], rings: [] };
    var grp = new T3.Group();
    grp.position.set(0, 0.02, C.vortZ);
    root.add(grp);

    var i;
    /* 동심원이면 과녁으로 보인다. **끊긴 호**를 조금씩 돌려 겹쳐야 소용돌이가 된다. */
    var specs = [   // [안, 밖, 불투명도, 시작각(회전), 호 길이]
      [6.0, 7.5, 0.26, 0.00, 4.5], [5.0, 6.2, 0.32, 1.10, 4.2],
      [4.0, 5.0, 0.40, 2.40, 4.0], [3.1, 3.9, 0.48, 3.70, 3.8],
      [2.3, 2.95, 0.58, 5.00, 3.6], [1.6, 2.15, 0.70, 0.40, 3.4],
      [1.0, 1.45, 0.82, 2.00, 3.2]
    ];
    for (i = 0; i < specs.length; i++) {
      var rg = new T3.RingGeometry(specs[i][0], specs[i][1], 40, 1,
                                   specs[i][3], specs[i][4]);
      var rm = new T3.MeshBasicMaterial({ color: i < 3 ? 0x76aebd : COL.foam,
                                          transparent: true, opacity: specs[i][2],
                                          depthWrite: false, blending: T3.AdditiveBlending,
                                          side: T3.DoubleSide });
      var rr = new T3.Mesh(rg, rm);
      rr.rotation.x = -Math.PI / 2;
      rr.scale.set(1, 1.16, 1);
      rr.renderOrder = 1;
      grp.add(rr);
      out.rings.push({ mesh: rr, sp: 0.26 + i * 0.20, base: specs[i][2] });
      out.geos.push(rg); out.mats.push(rm);
    }
    // 물이 꺼져 어두워지는 접시
    var bg = new T3.CircleGeometry(7.8, 40);
    var bm = new T3.MeshBasicMaterial({ color: 0x04121a, transparent: true,
                                        opacity: 0.55, depthWrite: false });
    var basin = new T3.Mesh(bg, bm);
    basin.rotation.x = -Math.PI / 2; basin.position.y = 0.012;
    basin.scale.set(1, 1.16, 1);
    basin.renderOrder = -2;
    grp.add(basin);
    out.geos.push(bg); out.mats.push(bm);
    // 아가리 — 물이 꺼지는 구멍
    var cg = new T3.ConeGeometry(2.2, 5.2, 26, 1, true);
    var cm = new T3.MeshLambertMaterial({ color: 0x081419, flatShading: true,
                                          side: T3.DoubleSide });
    var cone = new T3.Mesh(cg, cm);
    cone.position.y = -2.6; cone.rotation.x = Math.PI;
    grp.add(cone);
    out.geos.push(cg); out.mats.push(cm);

    var dg = new T3.CircleGeometry(2.3, 26);
    var dm = new T3.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85,
                                        depthWrite: false });
    var disc = new T3.Mesh(dg, dm);
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.03;
    disc.renderOrder = 2;
    grp.add(disc);
    out.geos.push(dg); out.mats.push(dm);

    out.grp = grp; out.cone = cone; out.disc = disc;
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. 스테이지 본체
     ════════════════════════════════════════════════════════════════════ */
  var S = null;

  function init(root, ui, opts) {
    opts = opts || {};
    T3 = window.THREE;
    if (!T3) throw new Error('THREE 를 찾을 수 없습니다.');
    if (S) dispose();

    var rnd = makeRng(opts.seed || 20260814);
    var world = new T3.Group();
    (root || opts.scene).add(world);

    var crewIn = (typeof opts.crew === 'number' && isFinite(opts.crew))
      ? Math.max(0, Math.round(opts.crew)) : C.nRow;
    var nRow = clamp(Math.min(C.nRow, crewIn || C.nRow), 3, C.nRow);

    var s = {
      root: root, world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, snd: makeAudio(makeRng(4421)),
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      hud: null,
      phase: 'ready',
      wall: 0, freeze: 0, shake: 0,
      crewIn: crewIn, nRow: nRow,
      g: newGame(crewIn, nRow),
      shipZ: C.lanNear, shipRoll: 0, shipPitch: 0, lunge: 0,
      scrollX: 0, scrollWant: 0,
      cuedGo: false, cuedStop: false, stopCueT: null, cueOn: false, gotOne: false,
      surgeFlashed: -1, wokeFlashed: -1,
      heads: [], rowers: [], pools: [], carries: [],
      result: null,
      disposables: { geos: [], mats: [] }
    };

    /* ── 조명 ── */
    var amb = new T3.AmbientLight(0x2b3a4a, 1.25);
    var key = new T3.DirectionalLight(0xdfe9f2, 1.55);
    key.position.set(6, 12, 14);
    var rim = new T3.DirectionalLight(0x6f88a8, 1.0);
    rim.position.set(-8, 7, -12);
    var glow = new T3.PointLight(0xff6a34, 0, 22, 2);
    glow.position.set(0, 2.0, C.vortZ - 4);
    world.add(amb, key, rim, glow);
    s.vortLight = glow;

    /* ── 해협 · 소용돌이 ── */
    var st = buildStrait(world, rnd);
    s.strait = st;
    s.disposables.geos = s.disposables.geos.concat(st.geos);
    s.disposables.mats = s.disposables.mats.concat(st.mats);
    var vx = buildVortex(world);
    s.vortex = vx;
    s.disposables.geos = s.disposables.geos.concat(vx.geos);
    s.disposables.mats = s.disposables.mats.concat(vx.mats);

    /* ── 배 ── */
    s.ship = new T3.Group();
    world.add(s.ship);
    var hullGeo = shipGeo();
    var hullMat = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    s.disposables.geos.push(hullGeo); s.disposables.mats.push(hullMat);
    s.ship.add(new T3.Mesh(hullGeo, hullMat));

    // 배 아래 그림자 (물에 지는 어둠)
    var shG = new T3.CircleGeometry(1, 30);
    var shM = new T3.MeshBasicMaterial({ color: 0x000000, transparent: true,
                                         opacity: 0.34, depthWrite: false });
    s.hullShadow = new T3.Mesh(shG, shM);
    s.hullShadow.rotation.x = -Math.PI / 2;
    s.hullShadow.scale.set(5.0, 1.15, 1);
    s.hullShadow.position.y = 0.05;
    world.add(s.hullShadow);
    s.disposables.geos.push(shG); s.disposables.mats.push(shM);

    /* ── 노잡이 ── */
    var i;
    for (i = 0; i < C.nRow; i++) {
      var near = rowerGroup(i % 2 ? COL.tunic : COL.tunic2);
      near.position.set(C.rx[i], C.deckY, C.rowZ);
      near.rotation.y = Math.PI;              // 고물을 보고 앉는다(노는 카메라 쪽 밖으로)
      near.userData.alive = i < nRow;
      near.userData.ph = rnd() * 6.28;
      near.userData.seat = i;                 // 끌려간 뒤 이 자리로 새 사람이 앉는다
      near.visible = i < nRow;
      s.ship.add(near);
      s.rowers.push(near);

      var far = rowerGroup(i % 2 ? COL.tunic2 : COL.tunic);
      far.position.set(C.rx[i], C.deckY, -C.rowZ);
      far.rotation.y = 0;
      far.userData.ph = rnd() * 6.28;
      far.userData.far = true;
      s.ship.add(far);
      s.rowers.push(far);
    }

    /* ── 갑판의 붉은 자국 — 머리가 내려올 자리 (1편의 붉은 범위와 같은 언어) ── */
    var poolG = new T3.CircleGeometry(1, 30);
    s.disposables.geos.push(poolG);
    for (i = 0; i < 6; i++) {
      var grp = new T3.Group();
      grp.position.set(C.hx[i], C.deckY + 0.06, C.rowZ * 0.4);
      s.ship.add(grp);
      var rings = [[0.50, 0.86], [0.76, 0.34], [1.08, 0.13]];
      var meshes = [];
      for (var j = 0; j < rings.length; j++) {
        var pm = new T3.MeshBasicMaterial({ color: COL.danger, transparent: true,
                                            opacity: 0, depthWrite: false,
                                            blending: T3.AdditiveBlending });
        var pmesh = new T3.Mesh(poolG, pm);
        pmesh.rotation.x = -Math.PI / 2;
        pmesh.scale.set(rings[j][0], rings[j][0] * 1.5, 1);
        pmesh.renderOrder = 5;
        grp.add(pmesh);
        meshes.push({ mesh: pmesh, mat: pm, base: rings[j][1], r: rings[j][0] });
        s.disposables.mats.push(pm);
      }
      s.pools.push({ grp: grp, rings: meshes });
    }

    /* ── 여섯 머리 + 목 ── */
    var segG = new T3.SphereGeometry(0.5, 10, 8);
    s.disposables.geos.push(segG);
    var neckM = new T3.MeshLambertMaterial({ color: COL.sSkin, flatShading: true });
    var neckM2 = new T3.MeshLambertMaterial({ color: COL.sDark, flatShading: true });
    s.disposables.mats.push(neckM, neckM2);
    for (i = 0; i < 6; i++) {
      var hg = headGroup();
      hg.scale.setScalar(1.12);
      world.add(hg);
      var segs = [];
      for (var k = 0; k < 30; k++) {
        var sm = new T3.Mesh(segG, k % 2 ? neckM2 : neckM);
        world.add(sm);
        segs.push(sm);
      }
      s.heads.push({
        i: i, grp: hg, segs: segs, ext: 0, rear: 0, heat: 0,
        carry: null, carryT: 0, jaw: 0, ph: i * 1.07,
        base: new T3.Vector3(-0.9 + (i - 2.5) * 1.85, 8.2 + Math.sin(i * 1.9) * 1.1,
                             C.cliffZ + 1.4)
      });
      s.disposables.geos.push.apply(s.disposables.geos, hg.userData.geos);
      s.disposables.mats.push.apply(s.disposables.mats, hg.userData.mats);
    }

    /* ── 타이밍 게이지 — 뱃머리 앞 물 위 (1편 게이지 그대로) ── */
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
    world.add(ggrp);
    s.gauge = {
      grp: ggrp,
      back: gpart(0x060b0e, 0.60, false, 20),
      track: gpart(COL.amber, 0.30, true, 21),
      fill: gpart(COL.safe, 0.92, false, 22),
      capL: gpart(0xffe6bd, 0.55, true, 23),
      capR: gpart(0xffe6bd, 0.55, true, 23),
      mark: gpart(0xfff3d2, 0.95, false, 24),
      len: C.gSec * C.gPx, fillL: 0, fillC: 0, danger: 0,
      alpha: 0, markOn: 0, markX: 0, markCol: 0xfff3d2, over: 0
    };
    ggrp.add(s.gauge.back, s.gauge.track, s.gauge.fill,
             s.gauge.capL, s.gauge.capR, s.gauge.mark);
    // 배 위에서도 읽히도록 화면 앞쪽(카메라 쪽)에 눕힌다
    ggrp.rotation.x = -Math.PI / 2;

    /* ── HUD ── */
    var host = opts.hudHost ||
               (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host && host.style && !host.style.position && host === document.body)
      host.style.position = 'relative';
    s.hud = makeHud(host, nRow);
    s.hud.onRestart(function () { reset(); start(); });

    if (opts.bindInput !== false) bindInput(s);

    s.dummy = new T3.Object3D();
    s.v = { a: new T3.Vector3(), b: new T3.Vector3(), c: new T3.Vector3(),
            d: new T3.Vector3(), up: new T3.Vector3(0, 1, 0) };
    S = s;
    layout(s);
    syncHud(s);
    frame(s, 0);
    return api;
  }

  function bindInput(s) {
    var target = s.canvas || document;
    s.onKey = function (e) {
      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        if (!e.repeat) press(true);
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
     10. 카메라 — 배를 옆에서. 위에 절벽, 아래에 소용돌이.
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
    var dist = clamp(vHalf / Math.tan(cam.fov * Math.PI / 360), 12, 70);
    var e = k.el;
    s.camTarget = new T3.Vector3(0, k.ty, k.tz);
    s.camDist = dist;
    s.camEl = e;
    cam.position.set(0, k.ty + dist * Math.sin(e), k.tz + dist * Math.cos(e));
    cam.lookAt(s.camTarget);
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
     11. 입력 → 규칙
     ════════════════════════════════════════════════════════════════════ */
  function press(down) {
    var s = S;
    if (!s) return 'none';
    if (down === false) return 'up';
    s.snd.resume();
    if (s.phase === 'ready') { start(); return 'start'; }
    if (s.phase !== 'run') return 'idle';

    var g = s.g;
    var before = { down: null };
    var d = danger(g);
    if (!d.safe) before.down = pickHead(s, g);

    var r = tryStroke(g);

    if (r === 'cool') return 'cool';
    if (r === 'stun') {
      s.hud.flash('노를 놓쳤다', '#c3cdd4', '', true);
      return 'stun';
    }
    if (r === 'dead') {
      s.hud.flash('노를 잡을 사람이 없다', '#c3cdd4', '', true);
      s.snd.tick();
      return 'dead';
    }
    if (r === 'none') return 'none';

    s.lunge = 1;
    s.strokeAnim = 0;
    /* 저은 순간 "저어라"는 할 일을 다했으니 지운다. 그러나 "멈춰라"는 지우지 않는다 —
       바로 그때가 사람이 연타하는 순간이라, 그 말이 화면에 남아 있어야 한다. */
    s.cuedGo = true;
    if (s.cueOn) s.hud.cue(false);
    /* 안내는 첫 위험 구간을 겪고 나서야 내린다. 예전엔 6번만 저으면 사라졌는데,
       연타하는 사람은 1초 만에 6번을 채워서 규칙을 배우기 전에 안내를 잃었다. */
    if (!s.gotOne && g.strokes >= 6 && s.cuedStop) { s.gotOne = true; s.hud.hint(false); }

    if (r === 'row') {
      s.snd.row(g.combo);
      syncHud(s);
      markGauge(s, true);
      return 'row';
    }

    /* 잡혔다 — 왜인지 화면에 뜬다.
       서지 중에는 이게 실수가 아니라 **거래**다. 한 명을 내주고 배가 물러난다. */
    var hd = before.down;
    takeMan(s, hd);
    s.freeze = C.freeze;
    s.shake = 1;
    s.snd.bite(); s.snd.scream();
    if (d.surge) s.hud.flash('한 명을 내주었다', '#ff8a68', '배가 소용돌이에서 물러났다');
    else s.hud.flash('한 명이 끌려 올라갔다', '#ff8a68', '머리가 내려와 있었다');
    markGauge(s, false);
    syncHud(s);
    return 'caught';
  }

  /* 지금 내려와 있는 머리 중 하나 — 아직 물지 않은 쪽을 먼저 */
  function pickHead(s, g) {
    var list;
    if (g.surge) list = SEC[g.sec].heads.slice();
    else list = headsDownAt(SEC[g.sec], mod(g.pt, SEC[g.sec].M));
    if (!list.length) return null;
    var i, free = [];
    for (i = 0; i < list.length; i++) if (!s.heads[list[i]].carry) free.push(list[i]);
    var pool = free.length ? free : list;
    // 배 한가운데에 가장 가까운 머리가 문다 — 화면에서 잘 보이는 자리
    var best = pool[0], bd = 99;
    for (i = 0; i < pool.length; i++) {
      var dd = Math.abs(C.hx[pool[i]]);
      if (dd < bd) { bd = dd; best = pool[i]; }
    }
    return s.heads[best];
  }

  /* 머리가 노잡이 하나를 물고 올라간다 */
  function takeMan(s, hd) {
    if (!hd) return;
    var want = C.hx[hd.i], best = null, bd = 99, i;
    for (i = 0; i < C.nRow; i++) {
      var r = s.rowers[i * 2];
      if (!r.userData.alive) continue;
      var dd = Math.abs(C.rx[i] - want);
      if (dd < bd) { bd = dd; best = r; }
    }
    if (!best) return;
    best.userData.alive = false;
    hd.carry = best;
    hd.carryT = 0;
    best.userData.oar.visible = false;
  }

  function syncHud(s) {
    var g = s.g;
    s.hud.crew(g.taken);
    s.hud.road(g.prog);
    s.hud.pullBar(g.grip);
  }

  /* ══════════════════════════════════════════════════════════════════════
     12. 루프
     ════════════════════════════════════════════════════════════════════ */
  function update(dt, quiet) {
    var s = S;
    if (!s) return;
    dt = clamp(dt || 0, 0, 0.05);
    s.wall += dt;
    s.hud.tick(dt);

    if (s.phase === 'run') {
      var g = s.g;
      if (s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
      else {
        var wasSurge = !!g.surge, wasSec = g.sec;
        stepWorld(g, dt);

        // 카리브디스가 숨을 들이켠다 — 틈이 사라진다
        if (g.surge && !wasSurge) {
          s.snd.inhale();
          s.shake = Math.max(s.shake, 0.8);
          if (s.surgeFlashed !== g.surge.n) {
            s.surgeFlashed = g.surge.n;
            s.hud.flash('틈이 없다', '#ff6a3c', '카리브디스가 숨을 들이켠다');
          }
        }
        // 머리가 하나 더 깨어난다
        if (g.sec !== wasSec) {
          s.snd.wake();
          if (s.wokeFlashed !== g.sec) {
            s.wokeFlashed = g.sec;
            s.hud.flash('머리가 하나 더', '#e4c8a0', '', true);
          }
        }
        if (g.over) finish(s);
      }

      /* 규칙을 두 박자로 가르친다 — 첫 틈에서 "저어라", 머리가 처음 내려올 때
         "멈춰라". 둘 다 한 번씩 보여준 뒤로는 침묵하고 게이지에 맡긴다.
         멈추라는 말을 안 해서 사용자가 연타로 전멸했다 — 그 절반이 빠져 있었다. */
      if (!s.cuedStop) {
        var ok = danger(g).safe;
        if (ok !== s.cueOn) {
          s.cueOn = ok;
          if (ok) { s.hud.cue(!s.cuedGo, false); }
          else {
            s.cuedGo = true;
            s.hud.cue(true, true);              // 머리가 내려왔다 — 멈추라고 말한다
            s.stopCueT = 0;
          }
        }
        // "멈춰라"는 위험이 끝날 때까지, 최소 한 박자는 보여준다
        if (!ok && s.stopCueT != null) {
          s.stopCueT += dt;
          if (s.stopCueT > 1.1) { s.cuedStop = true; s.hud.cue(false); }
        }
      }
      s.snd.swirl(clamp(1 - g.grip, 0, 1));
      syncHud(s);
    } else if (s.phase === 'over' && s.overT != null) {
      s.overT += dt;
      s.snd.swirl(s.result && !s.result.win ? clamp(1 - s.overT * 0.6, 0, 1) : 0);
      if (s.overT >= s.outroLen) {
        s.overT = null;
        if (s.outroCard) s.hud.end(s.outroCard);
      }
    }

    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  function finish(s) {
    var g = s.g;
    s.phase = 'over';
    s.snd.swirl(0);
    s.hud.hint(false);
    s.hud.cue(false);
    var win = g.over.win;
    var res = {
      win: win,
      taken: g.taken,
      lost: win ? g.taken : s.crewIn,
      crewLost: win ? g.taken : s.crewIn,
      survived: win ? Math.max(0, s.crewIn - g.taken) : 0,
      crew: win ? Math.max(0, s.crewIn - g.taken) : 0,
      wiped: !win,
      reason: g.over.reason,
      prog: +g.prog.toFixed(3),
      time: +g.t.toFixed(1),
      strokes: g.strokes,
      bestCombo: g.bestCombo
    };
    s.result = res;
    if (win) s.snd.good(); else { s.snd.doom(); s.shake = 1.2; }

    var handled = false;
    if (typeof api.onEnd === 'function') {
      try { api.onEnd(res); handled = true; } catch (e) { handled = false; }
    }
    /* 카드는 곧바로 덮지 않는다 — 삼켜지는 장면을 보여주고 나서 띄운다 */
    s.overT = 0;
    s.outroLen = win ? 0.9 : 1.6;
    s.outroCard = (!handled || s.opts.endPanel === true) ? cardOf(res) : null;
  }

  /* 결과 카드 — 잃은 수가 곧 문장이다 */
  function cardOf(r) {
    if (!r.win) {
      /* 지는 길은 하나다 — 소용돌이. 그러니 이유도 하나만 말한다.
         예전엔 연타로 노잡이를 다 잃고 죽으면서 "쉬면 끌려간다"고 나무랐다 —
         쉰 적이 없는 사람에게. 그 거짓말을 없앴다. */
      return {
        head: '카리브디스가 삼켰다',
        body: '배가 소용돌이 아가리에 닿았다. 노가 배를 앞으로 밀어내지 못했다.',
        em: '멈추면 빨려 들어간다 — 머리가 물러난 틈에 몰아쳐야 한다.'
      };
    }
    var n = r.taken;
    var body = '스킬라가 <b>' + n + '명</b>을 데려갔다. ' +
               '그는 이 선택을 부하들에게 미리 말하지 않았다.';
    if (n <= 3) body = '스킬라가 <b>' + n + '명</b>을 데려갔다. 키르케가 말한 여섯보다 적었다. ' +
                       '그래도 그는 이 선택을 부하들에게 미리 말하지 않았다.';
    else if (n >= 6) body = '스킬라가 <b>' + n + '명</b>을 데려갔다. 신화가 말한 여섯, 혹은 그 이상이다. ' +
                            '그는 이 선택을 부하들에게 미리 말하지 않았다.';
    return { head: '해협을 지났다', body: body,
             em: '말했다면 아무도 노를 젓지 않았을 것이다.' };
  }

  /* ══════════════════════════════════════════════════════════════════════
     13. 한 프레임 그리기
     ════════════════════════════════════════════════════════════════════ */
  function frame(s, dt) {
    dt = dt || 0.016;
    var g = s.g, i, k;
    var sec = SEC[g.sec];
    var u = mod(g.pt, sec.M);

    /* 배 — 소용돌이 거리가 곧 가로 위치다 */
    var wantZ = lerp(C.lanFar, C.lanNear, clamp(g.grip, 0, 1));
    s.shipZ = approach(s.shipZ, wantZ, dt, 0.0015);
    s.lunge = Math.max(0, s.lunge - dt * 4.2);
    var bob = Math.sin(s.wall * 1.6) * 0.055;
    var lunge = s.lunge * s.lunge;
    s.ship.position.set(lunge * 0.34, bob, s.shipZ);
    s.ship.rotation.z = Math.sin(s.wall * 1.15) * 0.020 - lunge * 0.035;
    s.ship.rotation.y = (1 - clamp(g.grip, 0, 1)) * 0.15 + Math.sin(s.wall * 0.9) * 0.012;
    // 소용돌이에 가까우면 기울어 끌린다
    s.ship.rotation.x = (1 - clamp(g.grip, 0, 1)) * 0.16;

    /* 삼켜지는 장면 — 배가 돌면서 아가리로 빨려 든다 */
    if (s.phase === 'over' && s.result && !s.result.win) {
      var sk = clamp((s.sinkT = (s.sinkT || 0) + dt) / 2.0, 0, 1);
      var e2 = sk * sk;
      s.ship.position.z = lerp(s.shipZ, C.vortZ - 1.2, e2);
      s.ship.position.x = Math.sin(sk * 5.0) * 1.6 * e2;
      s.ship.position.y = bob - 4.2 * e2;
      s.ship.rotation.y += dt * (1.4 + sk * 3.4);
      s.ship.rotation.z = 0.9 * e2;
      s.ship.rotation.x = 0.16 + 0.5 * e2;
      s.ship.scale.setScalar(1 - 0.42 * e2);
    }
    s.hullShadow.position.set(s.ship.position.x, 0.05, s.ship.position.z + 0.1);
    s.hullShadow.visible = s.ship.scale.x > 0.92;

    /* 노잡이 · 노 */
    s.strokeAnim = (s.strokeAnim == null) ? 1 : Math.min(1, s.strokeAnim + dt * 3.4);
    var sw = 1 - s.strokeAnim;
    var swing = Math.sin(smooth(s.strokeAnim) * Math.PI) * 0.85;
    for (i = 0; i < C.nRow; i++) {
      var near = s.rowers[i * 2], far = s.rowers[i * 2 + 1];
      if (near.userData.alive) {
        near.visible = true;
        near.userData.body.rotation.z = -0.34 * swing;
        near.userData.oar.rotation.z = -0.34 + swing * 0.62;
        near.userData.oar.rotation.y = swing * 0.24;
      } else if (!near.userData.gone) near.visible = true;
      far.visible = true;
      far.userData.body.rotation.z = -0.30 * swing;
      far.userData.oar.rotation.z = -0.34 + swing * 0.58;
    }
    void sw;

    /* 여섯 머리 */
    for (i = 0; i < 6; i++) {
      var hd = s.heads[i];
      var active = sec.heads.indexOf(i) >= 0 && s.phase === 'run';
      var wantExt = 0, wantRear = 0, wantHeat = 0;
      if (active) {
        if (g.surge) {
          var el = g.t - g.surge.t0;
          var su = clamp((el - 0.22) / 0.22, 0, 1);          // 치켜들었다가 한꺼번에 박는다
          var sd = clamp((g.surge.end - g.t) / C.back, 0, 1);
          wantExt = Math.min(su, sd);
          wantRear = clamp(1 - el / 0.24, 0, 1) * 1.0;
          wantHeat = Math.max(wantExt, clamp(el / 0.16, 0, 1) * 0.7);
        } else {
          var po = headPose(sec, u, i);
          wantExt = po.ext; wantRear = po.rear;
          wantHeat = headHeat(sec, u, i);
        }
      }
      hd.ext = approach(hd.ext, wantExt, dt, 0.00003);
      hd.rear = approach(hd.rear, wantRear, dt, 0.0004);
      // 붉은 자국은 **켜질 때만** 부드럽고, 꺼질 때는 즉시 꺼진다 (게이지와 어긋나지 않게)
      hd.heat = wantHeat < hd.heat ? approach(hd.heat, wantHeat, dt, 1e-9)
                                   : approach(hd.heat, wantHeat, dt, 0.0006);
      drawHead(s, hd, dt);

      // 갑판의 붉은 자국 — 예고부터 자리에 그려진다
      var pool = s.pools[i];
      var hv = hd.heat;
      for (k = 0; k < pool.rings.length; k++) {
        var rr = pool.rings[k];
        rr.mat.opacity = rr.base * hv * (0.75 + 0.25 * Math.sin(s.wall * 9 + k));
        var scl = rr.r * (1.0 + (1 - hv) * 0.45);
        rr.mesh.scale.set(scl, scl * 1.4, 1);
      }
    }

    /* 타이밍 게이지 */
    updateGauge(s, dt);

    /* 소용돌이 */
    var vx = s.vortex;
    var near1 = clamp(1 - g.grip, 0, 1);
    var big = 1 + near1 * 0.30 + (g.surge ? 0.26 : 0);
    vx.grp.scale.setScalar(approach(vx.grp.scale.x, big, dt, 0.002));
    for (i = 0; i < vx.rings.length; i++) {
      var rg = vx.rings[i];
      rg.mesh.rotation.z -= rg.sp * dt * (1 + near1 * 1.6 + (g.surge ? 1.4 : 0));
      rg.mesh.material.opacity = rg.base * (0.98 + 0.42 * near1 + (g.surge ? 0.35 : 0));
    }
    vx.cone.rotation.y += dt * 1.4;
    if (s.vortLight) s.vortLight.intensity = 6 + near1 * 26 + (g.surge ? 22 : 0);

    /* 배경 흐름 — 저을 때마다 세계가 밀린다 */
    s.scrollWant = g.prog * C.scroll;
    s.scrollX = approach(s.scrollX, s.scrollWant, dt, 0.0009);
    var sc = s.strait.scrollers;
    for (i = 0; i < sc.length; i++) {
      sc[i].grp.position.x = -mod(s.scrollX * sc[i].k, sc[i].span);
    }
    // 물보라 띠
    var dm = s.dummy, strips = s.strait.strips, seeds = s.strait.stripSeed;
    for (i = 0; i < seeds.length; i++) {
      var sd2 = seeds[i];
      var x = mod(sd2[0] - s.scrollX * 1.35 - s.wall * 2.2, 150) - 75;
      dm.position.set(x, 0.06, sd2[1]);
      dm.rotation.set(-Math.PI / 2, 0, 0);
      dm.scale.set(sd2[2], 0.16 + sd2[3] * 0.14, 1);
      dm.updateMatrix();
      strips.setMatrixAt(i, dm.matrix);
    }
    strips.instanceMatrix.needsUpdate = true;

    /* 해협의 출구 — 마지막 40% 에 오른쪽에서 다가온다 */
    var gx = 62 - 62 * g.prog;
    s.strait.gate.position.x = gx;
    s.strait.gate.visible = gx < 46;
    s.strait.gateGlow.material.opacity = clamp((g.prog - 0.55) / 0.45, 0, 1) * 0.34;

    /* 카메라 — 배를 조금만 따라간다. 미끄러지는 게 보여야 한다. */
    if (s.camera && s.camBase) {
      var follow = (s.shipZ - C.lanNear) * 0.26;
      var bx = s.camBase.x, by = s.camBase.y, bz = s.camBase.z + follow;
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt * 2.2);
        var m = s.shake * s.shake * 0.55;
        bx += (s.rnd() * 2 - 1) * m;
        by += (s.rnd() * 2 - 1) * m;
        bz += (s.rnd() * 2 - 1) * m * 0.5;
      }
      s.camera.position.set(bx, by, bz);
      s.camera.lookAt(s.camTarget.x, s.camTarget.y + follow * 0.20,
                      s.camTarget.z + follow * 0.55);
    }
  }

  /* 목 하나를 곡선으로 그린다 — 굴에서 나와 배 위에 떠 있다가 갑판으로 내리꽂는다 */
  function drawHead(s, hd, dt) {
    var V = s.v;
    var e = smooth(clamp(hd.ext, 0, 1));
    var rr = clamp(hd.rear, 0, 1);
    var shipX = s.ship.position.x, shipZ = s.shipZ;
    var sway = Math.sin(s.wall * 1.15 + hd.ph);

    var P0 = V.a.copy(hd.base);
    // 배 위에 떠 있는 자리 — 자기 몫의 갑판 바로 위
    var hx = shipX + C.hx[hd.i] + sway * 0.30;
    var hy = C.hoverY + sway * 0.34 + rr * C.rearY;
    var hz = shipZ + C.hoverZ + Math.cos(s.wall * 0.9 + hd.ph) * 0.30;
    // 내리꽂은 자리 — 노잡이의 목덜미. 카메라 쪽으로 조금 나와야 옆얼굴이 보인다.
    var tx = shipX + C.hx[hd.i];
    var ty = C.strikeY;
    var tz = shipZ + C.rowZ + 0.70;
    var P2 = V.b.set(lerp(hx, tx, e), lerp(hy, ty, e), lerp(hz, tz, e));
    // 물고 올라가는 중이면 굴 쪽으로 끌어 올린다
    if (hd.carry) {
      hd.carryT += dt;
      var cu = smooth(clamp(hd.carryT / 1.15, 0, 1));
      P2.x = lerp(P2.x, P0.x, cu * 0.55);
      P2.y = lerp(P2.y, P0.y + 1.4, cu);
      P2.z = lerp(P2.z, P0.z + 1.6, cu * 0.7);
    }
    // 목은 절벽에서 나와 위로 크게 휘었다가 내려온다.
    // 제어점을 절벽 쪽으로 당겨야 마지막 접선이 카메라 쪽을 향한다 — 옆얼굴로 문다.
    var P1 = V.c.set((P0.x + P2.x) * 0.5 - 0.4,
                     Math.max(P0.y, hy) + 2.2 + 3.6 * e,
                     lerp((P0.z + P2.z) * 0.5 - 1.4, P0.z + 1.0, e));

    // 목이 길어질수록 마디가 굵어야 구슬 목걸이처럼 끊겨 보이지 않는다
    var arc = P0.distanceTo(P1) + P1.distanceTo(P2);
    var thick = clamp(arc / 17, 0.92, 1.34);

    var n = hd.segs.length, i, t, mt;
    var px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (i = 0; i < n; i++) {
      t = (i + 1) / n;
      mt = 1 - t;
      px = mt * mt * P0.x + 2 * mt * t * P1.x + t * t * P2.x;
      py = mt * mt * P0.y + 2 * mt * t * P1.y + t * t * P2.y;
      pz = mt * mt * P0.z + 2 * mt * t * P1.z + t * t * P2.z;
      var r = lerp(0.62, 0.30, t) * thick;
      hd.segs[i].position.set(px, py, pz);
      hd.segs[i].scale.setScalar(r * 2);
      if (i === n - 2) { qx = px; qy = py; qz = pz; }
    }
    // 머리 — 목 끝의 접선 방향을 본다
    var H = hd.grp;
    H.position.set(px, py, pz);
    var dx = px - qx, dy = py - qy, dz = pz - qz;
    var len = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy + dz * dz));
    V.d.set(dx / len, dy / len, dz / len);
    H.quaternion.setFromUnitVectors(new T3.Vector3(1, 0, 0), V.d);
    // 턱 — 치켜들 때 크게 벌어진다 (예고), 물면 다문다
    var jawWant = hd.carry ? 0.08 : (0.08 + rr * 0.72 + e * 0.42);
    hd.jaw = approach(hd.jaw, jawWant, dt, 0.0002);
    H.userData.jaw.rotation.z = -hd.jaw;
    var eyeLv = 0.30 + Math.max(rr, e) * 0.70;
    H.userData.eyes[0].scale.setScalar(0.10 + eyeLv * 0.06);
    H.userData.eyes[1].scale.setScalar(0.10 + eyeLv * 0.06);

    /* 물고 올라가는 사람 — 크게, 버둥거리게. 여기가 안 보이면 대가가 안 보인다. */
    if (hd.carry) {
      var man = hd.carry;
      var cu2 = clamp(hd.carryT / 1.5, 0, 1);
      if (man.parent !== s.world) s.world.add(man);
      man.position.set(px + V.d.x * 1.15, py + V.d.y * 1.15 - 0.28, pz + V.d.z * 1.15 + 0.30);
      man.rotation.set(-0.6 - cu2 * 2.6,
                       cu2 * 5.0,
                       0.8 * cu2 + Math.sin(hd.carryT * 26) * 0.30 * (1 - cu2));
      man.scale.setScalar(1.5 - cu2 * 0.55);
      if (cu2 >= 1) {
        /* 물려 올라간 사람은 사라지고, 그 자리에 **다른 부하가 올라와 앉는다.**
           배에는 아직 수백 명이 타고 있다 — 노 자리가 비는 일은 없다.
           (부하 수는 이미 g.taken 으로 줄었다. 여기서는 자리만 채운다.) */
        var seat = man.userData.seat | 0;
        s.ship.add(man);                       // s.world 로 옮겨졌던 것을 되돌린다
        man.position.set(C.rx[seat], C.deckY, C.rowZ);
        man.rotation.set(0, Math.PI, 0);
        man.scale.setScalar(1);
        man.userData.alive = true;
        if (man.userData.oar) man.userData.oar.visible = true;
        man.visible = s.g ? (seat < s.g.alive) : true;
        hd.carry = null;
      }
    }
  }

  /* ── 타이밍 게이지 (1편의 언어 그대로) ────────────────────────────────
     트랙 = 앞으로 gSec 초. 초록이 오른쪽 끝에 붙어 "남은 안전 시간"을,
     위험일 때는 붉은 토막이 왼쪽 끝에서 줄어들며 "다시 열릴 때까지"를 말한다.
     붉은 토막이 트랙보다 길면(서지) 양끝이 함께 번쩍인다 — "기다릴 수 없다". */
  function updateGauge(s, dt) {
    var G = s.gauge, g = s.g;
    var L = C.gSec * C.gPx;
    G.len = L;
    G.grp.position.set(s.ship.position.x, 0.10, s.shipZ + C.gZ);

    if (s.phase !== 'run') G.alpha = Math.max(0, G.alpha - dt * 4);
    else G.alpha = Math.min(1, G.alpha + dt * 6);

    var d = danger(g);
    if (d.safe) {
      G.fillL = clamp(d.remain, 0, C.gSec) * C.gPx;
      G.fillC = L * 0.5 - G.fillL * 0.5;
      G.danger = 0; G.over = 0;
    } else {
      var rl = Math.min(d.toExit, C.gSec) * C.gPx;
      G.fillL = rl; G.fillC = -L * 0.5 + rl * 0.5;
      G.danger = 1; G.over = d.toExit > C.gSec ? 1 : 0;
    }
    G.markOn = Math.max(0, G.markOn - dt * (G.markCol === 0xff5a34 ? 1.1 : 3.4));

    var a = G.alpha;
    G.grp.visible = a > 0.012;
    if (!G.grp.visible) return;
    var pulse = G.over ? (0.72 + 0.28 * Math.sin(s.wall * 11)) : 1;

    G.back.scale.set(L + 0.30, C.gH * 2.2, 1);
    G.back.material.opacity = 0.86 * a;
    G.track.scale.set(L, C.gH, 1);
    G.track.material.opacity = (G.danger ? 0.30 : 0.20) * a;
    G.track.material.color.setHex(G.danger ? 0xff7a52 : COL.amber);
    G.capL.position.x = -L * 0.5; G.capR.position.x = L * 0.5;
    G.capL.scale.set(0.07, C.gH * 2.3, 1);
    G.capR.scale.set(0.07, C.gH * 2.3, 1);
    G.capL.material.opacity = G.capR.material.opacity = 0.62 * a * pulse;
    G.capL.material.color.setHex(G.over ? COL.danger : 0xffe6bd);
    G.capR.material.color.setHex(G.over ? COL.danger : 0xffe6bd);

    G.fill.visible = G.fillL > 0.006;
    if (G.fill.visible) {
      G.fill.position.x = G.fillC;
      G.fill.scale.set(G.fillL, C.gH * 0.76, 1);
      G.fill.material.color.setHex(G.danger ? COL.danger : COL.safe);
      G.fill.material.opacity = (G.danger ? 0.88 * pulse : 0.95) * a;
    }
    G.mark.visible = G.markOn > 0.02;
    if (G.mark.visible) {
      G.mark.position.x = G.markX;
      G.mark.scale.set(0.09, C.gH * 2.6, 1);
      G.mark.material.color.setHex(G.markCol);
      G.mark.material.opacity = 0.96 * a * Math.min(1, G.markOn * 2.2);
    }
  }

  /* 누른 자리를 게이지에 찍는다 — 안전이면 흰 눈금, 잡혔으면 붉은 눈금 */
  function markGauge(s, safe) {
    var G = s.gauge, g = s.g, L = C.gSec * C.gPx;
    var d = danger(g);
    if (safe) {
      G.markX = L * 0.5 - clamp(d.remain, 0, C.gSec) * C.gPx;
      G.markCol = 0xfff3d2; G.markOn = 1;
    } else {
      G.markX = -L * 0.5 + Math.min(d.toExit, C.gSec) * C.gPx;
      G.markCol = 0xff5a34; G.markOn = 1;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     14. 흐름 제어
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

  function setCrew(n) {
    var s = S;
    if (!s) return null;
    if (typeof n === 'number' && isFinite(n)) {
      s.crewIn = Math.max(0, Math.round(n));
      s.opts.crew = s.crewIn;
      if (s.phase === 'ready') {
        s.nRow = clamp(Math.min(C.nRow, s.crewIn || C.nRow), 3, C.nRow);
        s.g = newGame(s.crewIn, s.nRow);
        resetRowers(s);
        syncHud(s);
      }
    }
    return s.crewIn;
  }

  function resetRowers(s) {
    for (var i = 0; i < C.nRow; i++) {
      var near = s.rowers[i * 2];
      if (near.parent !== s.ship) s.ship.add(near);
      near.position.set(C.rx[i], C.deckY, C.rowZ);
      near.rotation.set(0, Math.PI, 0);
      near.scale.setScalar(1);
      near.userData.alive = i < s.nRow;
      near.userData.gone = false;
      near.visible = i < s.nRow;
      near.userData.oar.visible = true;
      near.userData.body.rotation.set(0, 0, 0);
      var far = s.rowers[i * 2 + 1];
      far.position.set(C.rx[i], C.deckY, -C.rowZ);
      far.visible = true;
    }
  }

  function reset() {
    var s = S;
    if (!s) return;
    s.g = newGame(s.crewIn, s.nRow);
    s.freeze = 0; s.shake = 0; s.lunge = 0; s.strokeAnim = 1;
    s.shipZ = C.lanNear; s.scrollX = 0; s.scrollWant = 0;
    s.cuedGo = false; s.cuedStop = false; s.stopCueT = null;
    s.cueOn = false; s.gotOne = false;
    s.surgeFlashed = -1; s.wokeFlashed = -1;
    s.result = null; s.overT = null; s.sinkT = 0; s.outroCard = null;
    s.ship.scale.setScalar(1);
    s.ship.rotation.set(0, 0, 0);
    s.hullShadow.visible = true;
    for (var i = 0; i < s.heads.length; i++) {
      s.heads[i].ext = 0; s.heads[i].rear = 0; s.heads[i].heat = 0;
      s.heads[i].carry = null; s.heads[i].carryT = 0; s.heads[i].jaw = 0;
    }
    resetRowers(s);
    s.gauge.alpha = 0; s.gauge.markOn = 0; s.gauge.fillL = 0; s.gauge.danger = 0;
    s.hud.end(null); s.hud.cue(false); s.hud.hint(false); s.hud.flash('');
    s.phase = 'ready';
    syncHud(s);
    frame(s, 0);
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try { if (s.onKey) window.removeEventListener('keydown', s.onKey, false); } catch (e) { }
    try { if (s.onDown && s.inputTarget) s.inputTarget.removeEventListener('pointerdown', s.onDown, false); } catch (e) { }
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
     15. 단독 실행
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
    renderer.setClearColor(COL.bg, 1);
    var scene = new T3.Scene();
    scene.background = new T3.Color(COL.bg);
    scene.fog = new T3.Fog(COL.bg, 46, 150);
    var camera = new T3.PerspectiveCamera(46, 1, 0.5, 400);
    scene.add(camera);
    var r3 = new T3.Group();
    scene.add(r3);

    var stg = init(r3, ui, {
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
    return stg;
  }

  /* ══════════════════════════════════════════════════════════════════════
     16. 계측 · 디버그
     ════════════════════════════════════════════════════════════════════ */
  /* 조건이 참이 될 때까지 굴린다. tap: true | false | fn(g)->bool */
  function drive(sec, tap, stopFn) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var dt = 1 / 120, n = Math.round((sec || 10) / dt), i;
    for (i = 0; i < n; i++) {
      if (s.phase !== 'run') break;
      var want = (typeof tap === 'function') ? tap(s.g) : !!tap;
      if (want) press(true);
      update(dt, true);
      if (stopFn && stopFn(s.g)) break;
    }
    return state();
  }
  /* 완벽한 봇 — 안전할 때만 젓고, 기다리면 죽는 순간에만 머리 밑으로 넣는다 */
  function auto(rate, maxSec, stopFn) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var gapT = Math.max(C.cool, 1 / (rate || 5));
    var last = -9;
    return drive(maxSec || 200, function (g) {
      if (g.t - last < gapT || g.cd > 0 || g.stun > 0 || g.alive <= 0) return false;
      var go = mustRow(g, danger(g), null, 0.02);
      if (go) last = g.t;
      return go;
    }, stopFn);
  }

  function state() {
    var s = S;
    if (!s) return { ready: false };
    var g = s.g;
    var d = danger(g);
    var sec = SEC[g.sec];
    return {
      ready: true, phase: s.phase,
      t: +g.t.toFixed(2), prog: +g.prog.toFixed(3), grip: +g.grip.toFixed(3),
      sec: g.sec, safeFrac: +sec.safeFrac.toFixed(3), heads: sec.heads.length,
      surge: g.surge ? +(g.surge.end - g.t).toFixed(2) : 0, surgeN: g.surgeN,
      safe: !!d.safe,
      remain: +(d.remain || 0).toFixed(2), toExit: +(d.toExit || 0).toFixed(2),
      alive: g.alive, taken: g.taken, nRow: g.nRow,
      strokes: g.strokes, combo: g.combo, stun: +g.stun.toFixed(2),
      power: +powerOf(g).toFixed(3), drain: +drainAt(g).toFixed(3),
      shipZ: +s.shipZ.toFixed(2),
      gauge: { len: +s.gauge.len.toFixed(2), fill: +s.gauge.fillL.toFixed(2),
               danger: s.gauge.danger, over: s.gauge.over,
               alpha: +s.gauge.alpha.toFixed(2), mark: +s.gauge.markX.toFixed(2) },
      down: g.surge ? sec.heads.slice() : headsDownAt(sec, mod(g.pt, sec.M)),
      result: s.result || null
    };
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
    drive: drive,
    auto: auto,
    simulate: simulate,
    tuning: tuning,
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
