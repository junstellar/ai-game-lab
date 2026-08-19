/* ============================================================================
   오디세이아 / ODYSSEY — st2-windbag.js  →  OD.St2
   2편 「아이올로스의 바람 자루」 — 한 버튼 '누르고 있다가 놓기' (STAGE2.md)
   ----------------------------------------------------------------------------
   1편과 같은 구조다. 이 파일 하나가 2편의 전부를 소유한다:
   장면 · 게임루프 · 입력 · 규칙 · 피드백.

   OD.St2.mount(root, ui, opts) -> stage    root = 캔버스 | DOM 요소 | THREE.Object3D
   OD.St2.press(down)                       true=누름 시작, false=놓음
                                            (스페이스·클릭·탭이 전부 이걸 부른다)
   OD.St2.update(dt)
   OD.St2.onEnd = fn(result)
   OD.St2.dispose()

   보조: init(root, ui, opts) / start() / pause() / reset() / resize() /
         state()        디버그 스냅샷
         simulate(o)    수치 검증용 순수 시뮬레이션 (실제 플레이와 같은 규칙을 쓴다)

   ── 규칙 (STAGE2.md §2·§3·§4) ────────────────────────────────────────────
   누르고 있으면 돛이 부풀어 배가 빨라지고 **돛 부하**가 오른다. 놓으면 내려간다.
   놓는 순간, **이번에 쌓은 부하** × 배율만큼 배가 앞으로 튀어 나간다.

     배율:  붉은 구간(부하 ≥ danger)      0.50   — 돛이 펄럭여 힘을 잃는다
            금색 띠(danger−gold ‥ danger) 2.20   — 최대 효율
            그 아래                       0.30 ‥ 1.65 (제곱으로 오른다)
     붉은 구간은 **벌이라야 한다.** 넘겨서 놓으면 안전하게 일찍 놓느니만 못하다.

   추진의 재료는 **이번에 쌓은 부하**(놓은 값 − 누른 값)다. 그래서 꼭대기에서
   연타로 금색 띠를 훑어 먹을 수 없다(MIN_BUILD 아래는 아예 없던 일이 된다).
   부하가 다 빠지길 기다렸다 길게 누르는 것이 언제나 낫다 — 그게 이 편의 맥박이다.

   붉은 구간에 머물면 매 순간 찢어질 위험이 쌓인다(깊을수록 급격히). 찢어지면
   진행이 뒤로 밀리고, 부하가 날아가고, 노잡이 둘이 쓸려 나가고, 돛을 꿰매는
   동안 아무것도 못 한다.
   → 그래서 계속 누르고 있을 수 없다. **참았다 놓고, 참았다 놓고.**

   구간이 셋. 위험대 시작이 0.75 → 0.60 → 0.50 으로 좁아지고, 2구간부터
   파도가 부하를 밀어 올린다(파도는 1.2초 전부터 눈에 보인다 — 게이지에 유령
   막대로도 보인다). 규칙 값(danger·gold·상승률)은 구간 경계에서 **부드럽게
   옮겨가고, 게이지는 그 값을 그대로 그린다.** 코드에만 있는 규칙은 없다.

   자루는 유한하다. 누르고 있는 동안에만 준다. 다 쓰면 배는 멈춘다(실패).

   진행 90% — 이타카의 모닥불이 보이고 졸음이 시작된다. 조작이 무거워진다.
   화면이 **요구한다: "버텨라".** 누르고 있으면 졸음이 느려지고(멈추지는 않는다)
   그동안 배가 더 나아간다 — 그 거리가 그대로 점수가 된다. 그러다 **잠든다
   (회피 불가).** 검은 화면에 문장이 뜨고, 오디세우스가 키를 놓고 무너진다.
   부하들이 자루를 열고 배가 되밀려 간다. 그때 갑판에서 사람이 쓸려 나간다.
   이건 실패가 아니라 이야기다. 얼마나 잘했는지는 **되밀린 뒤 선 자리(landed)**
   와 남은 부하로 남는다. 화면의 막대와 카드의 숫자는 언제나 같은 것을 가리킨다.

   ── 프로토타입 원칙 ──
   단색/플랫셰이딩. 절차적 텍스처·포스트프로세싱·그림자맵 없음.
   Math.random / console.log / 외부 에셋 / import·export 없음.
   ========================================================================== */

window.OD = window.OD || {};

OD.St2 = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
     0. 수치 — STAGE2.md §2/§4 를 그대로 옮긴 곳. 여기만 고치면 밸런스가 바뀐다.
     ════════════════════════════════════════════════════════════════════ */
  var C = {
    /* ── 속도 · 추진 (단위: 진행도/초. 진행도는 0=출항, 1=이타카) ──
       놓는 순간의 추진(K)이 배를 움직이는 주된 힘이다. 누르고만 있어서 가는
       거리(V1)를 작게 잡아야 **게이지가 곧 게임**이 된다.                    */
    /* ★ 길이를 절반으로 (약 112초 → 약 56초). 난이도는 그대로 두라는 요청이라
       게이지 쪽 수치(DOWN·FILL·up·danger·gold)는 하나도 건드리지 않았다.
       추진만 두 배 — 같은 리듬으로 두 배씩 나아간다. */
    V0: 0.00118,          // 돛이 누웠을 때의 표류
    V1: 0.00623,          // 돛이 가득 찼을 때 더해지는 속도
    K:  0.0311,           // 놓는 순간의 추진 계수 (쌓은 부하 × 배율)

    /* ── 돛 부하 ── */
    DOWN:   0.86,         // 놓았을 때 내려가는 속도 (/s)
    FILL_UP: 3.6,         // 돛이 부푸는 빠르기
    FILL_DN: 2.1,         // 돛이 눕는 빠르기
    GLIDE:  1.35,         // 잘 놓았을 때 미끄러지는 시간 (돛이 천천히 눕는다)
    /* 붉은 구간 위험률: 살짝 걸치면 버틸 만하고, 깊이 들어가면 순식간이다.
       over=0.1 → 0.26/s · over=0.3 → 1.1/s · over=0.6 → 2.8/s               */
    HAZ:   5.50,
    HAZP:  1.35,

    /* ── 자루 ── */
    BAG_DRAIN: 1 / 32,    // 누르고 있는 동안 (→ 자루 전체 = 32초치)
                          // 항해가 절반이 됐으니 자루도 절반이어야 여전히 빠듯하다
    BAG_TEAR:  0.018,     // 찢어질 때 새어 나가는 양

    /* ── 찢어짐 ── */
    TEAR_BACK: 0.060,     // 진행 손실 (속도가 두 배가 됐으니 손실도 두 배라야
                          //            찢어짐이 예전과 같은 '몇 초'로 아프다)
    TEAR_LOAD: 0.15,      // 부하 손실 (여기까지 떨어진다)
    TEAR_FIX:  1.15,      // 꿰매는 동안 (이 동안은 눌러도 안 나간다)
    TEAR_CREW: 2,         // 이때 휩쓸리는 부하 수
    FREEZE:    0.22,      // 짧은 정지

    /* ── 구간 (STAGE2.md §4) ──
       to     : 이 구간이 끝나는 진행도
       danger : 위험대 시작 (게이지에 붉게 그려진다)
       gold   : 위험대 직전 금색 띠의 폭
       up     : 부하 상승 속도 (/s) → 금색 띠 통과 시간 = gold/up
       wave   : 파도 간격(초). 0 이면 파도 없음.                              */
    SEG: [
      { to: 0.34, danger: 0.75, gold: 0.12, up: 0.34, wave: 0,    amp: 0     },
      { to: 0.68, danger: 0.60, gold: 0.11, up: 0.40, wave: 3.10, amp: 0.075 },
      { to: 9.99, danger: 0.50, gold: 0.10, up: 0.47, wave: 2.30, amp: 0.105 }
    ],
    TAU: 0.35,            // 구간이 바뀔 때 규칙 값이 옮겨가는 시간상수
    WAVE_LEAD: 1.20,      // 파도가 눈에 보이기 시작하는 시간

    /* ── 배율 (놓는 순간) ── */
    /* 붉은 구간은 **벌이라야 한다.** 여기서 놓으면 금색은 물론 그 아래보다도
       못 간다(0.80 에서 놓기 < 0.60 에서 놓기). 넘긴 건 이득이 아니다. */
    M_FLAP: 0.50,         // 붉은 구간 — 펄럭인다
    M_GOLD: 2.20,         // 금색 띠 — 최대 효율
    M_LO:   0.30,         // 바닥
    M_RISE: 1.35,         // 금색 직전까지 제곱으로 오른다 (LO+RISE = 1.65)
    NEAR:   0.055,        // 이만큼 모자랐으면 "아깝다"
    MIN_BUILD: 0.10,      // 이만큼도 안 쌓고 놓으면 '놓았다'로 치지 않는다
                          // (연타로 금색 띠를 훑어 먹는 짓을 여기서 막는다)

    /* ── 마지막 (STAGE2.md §5) ── */
    FIRE_AT:  0.880,      // 수평선에 모닥불이 보이기 시작
    SLEEP_AT: 0.900,      // 졸음 시작
    DROWSE:   8.0,        // 아무것도 안 하면 이만큼 만에 잠든다
    /* ★ 버티는 동안은 졸음이 **느려진다**(멈추진 않는다 — 잠드는 건 신화다).
       처음엔 크게 늦출 수 있지만 끝에 갈수록 손아귀가 풀린다.
       끝까지 붙잡으면 8초가 12초 남짓이 된다 — 그동안 간 거리가 점수로 남는다. */
    GRIP0:    0.40,       // 졸음 초입에서 버틸 때의 진행 배속
    GRIP1:    0.88,       // 다 감길 무렵의 배속 (거의 못 막는다)
    LAG:      0.45,       // 졸음 최대치에서의 조작 지연
    CAP:      0.995,      // 아무리 잘해도 닿지는 못한다
    SLEEP_T:  2.90,       // 잠드는 연출 (이 동안 화면에 문장이 뜬다)
    PUSH_T:   3.40,       // 되밀리는 연출
    /* 되밀림 절정 문구가 뜨는 시각(push 시작 기준). 잠드는 문장이 다 걷힌
       뒤라야 한다 — 같은 자리에 겹쳐 그리면 둘 다 안 읽힌다. 순서대로. */
    CLIMAX_AT: 0.62,
    DRIFT_T:  2.60,       // 자루가 빈 뒤 멈추기까지

    /* ── 되밀린 뒤 남는 자리 (0=출항, 1=이타카) ──
       모닥불을 보고도 얼마나 더 밀었는지(push) + 아낀 바람(bag)이 남는다.
       졸음 구간에서 1% 더 간 것이 여기서 3%p 넘게 벌어진다.            */
    LAND0:     0.045,
    LAND_PUSH: 0.34,
    LAND_BAG:  0.13,
    /* 자루가 터질 때 갑판에서 쓸려 나가는 부하 (남은 인원 대비 비율).
       잘했으면 적게, 못했으면 많게. */
    LOST_HI:   0.055,
    LOST_LO:   0.008,

    CREW: 594             // 이 판에 걸린 부하 수 (opts.crew 로 덮어쓴다)
  };

  /* 색 — 단색 팔레트. 구간마다 하늘·바다가 바뀐다(새벽 → 낮 → 노을). */
  var SKY = [
    { sky: 0x2a2f56, sea: 0x1b2742, hz: 0xe8956b, sun: 0xffc98a, lit: 0xffd2a6, amb: 0x2b3454 },
    { sky: 0x4f88c8, sea: 0x18517e, hz: 0xbfe2f2, sun: 0xfff6d8, lit: 0xfff2d8, amb: 0x3a5a80 },
    { sky: 0xc9633f, sea: 0x263457, hz: 0xffb070, sun: 0xff9a4d, lit: 0xffb578, amb: 0x50385a }
  ];
  var COL = {
    hull:   0x6b4326,
    hullD:  0x4a2d19,
    deck:   0x8a5c33,
    rail:   0x3a2314,
    mast:   0x7a5230,
    sail:   0xf0e3cc,
    sailD:  0xd8c6a8,
    oar:    0x5d3d22,
    skin:   0xc59a6d,
    tunic:  0xb44f36,
    king:   0x8e3b52,
    bag:    0xe3d2a4,
    bagD:   0xa08a5c,
    wake:   0xffffff,
    fire:   0xffa23a,
    isle:   0x2a2620
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
        그래서 시뮬레이션 수치가 곧 게임의 수치다.
     ════════════════════════════════════════════════════════════════════ */
  function segAt(prog) {
    for (var i = 0; i < C.SEG.length - 1; i++) if (prog < C.SEG[i].to) return i;
    return C.SEG.length - 1;
  }

  /* 놓는 순간의 배율 — 게이지가 가르치는 규칙 그 자체 */
  function multOf(load, danger, gold) {
    var lo = danger - gold;
    if (load >= danger) return C.M_FLAP;
    if (load >= lo) return C.M_GOLD;
    var x = load / Math.max(0.06, lo);
    return C.M_LO + C.M_RISE * x * x;
  }
  function kindOf(load, danger, gold) {
    var lo = danger - gold;
    if (load >= danger) return 'flap';
    if (load >= lo) return 'gold';
    if (load >= lo - C.NEAR) return 'near';
    return 'early';
  }

  function newGame(seed, crew) {
    var g = {
      seed: (seed >>> 0) || 20260813,
      rnd: makeRng(seed || 20260813),
      t: 0, phase: 'run',        // run | drowse | sleep | push | over
      prog: 0, load: 0, fill: 0, bag: 1, glide: 0,
      danger: C.SEG[0].danger, gold: C.SEG[0].gold, up: C.SEG[0].up,
      seg: 0, segShown: 0,
      want: false, wantEff: false, lagAcc: 0,
      holding: false, pressLoad: 0, holdT: 0, restT: 0,
      risk: 0, tearRoll: 1, fix: 0, freeze: 0,
      waveT: -1, waveAmp: 0, waveIn: 9,
      tears: 0, golds: 0, cycles: 0, flaps: 0,
      crew: crew == null ? C.CREW : crew, crew0: crew == null ? C.CREW : crew,
      drowse: 0, drowseF: 1, gripping: false, sleepT: 0, pushT: 0, driftT: 0,
      /* reached = 모닥불을 본 뒤 가장 멀리 간 자리
         landed  = 되밀린 뒤 남은 자리 (= 여기까지 왔다)
         remain  = 거기서 이타카까지 **남은** 거리 (= 1 - landed)     */
      reached: 0, landed: 0, remain: 1, grade: 0, swept: 0,
      ranOut: false, slept: false,
      lastKind: '', lastGain: 0, lastMult: 0, lastLoad: 0,
      evt: '', evt2: '', blocked: '', best: 0, rock: 0
    };
    return g;
  }

  /* 놓는 순간 — **이번에 쌓은 부하**가 배를 민다.
     쌓은 게 없으면(연타) 아무 일도 없다 — 금색 띠를 훑어 먹지 못한다.
     ★ 졸음 구간(drowse)부터는 추진도 없다. 거기서 화면은 "누르고 버텨라"
       라고 요구한다 — 놓는 쪽에 상이 붙어 있으면 그 요구가 거짓말이 된다. */
  function release(g) {
    var d = g.phase === 'run' ? Math.max(0, g.load - g.pressLoad) : 0;
    var kind = d < C.MIN_BUILD ? 'tap' : kindOf(g.load, g.danger, g.gold);
    var mult = kind === 'tap' ? C.M_LO : multOf(g.load, g.danger, g.gold);
    var gain = C.K * d * mult;
    g.prog += gain;
    g.glide = kind === 'tap' ? 0 : clamp((mult - 0.9) / 1.3, 0, 1);
    g.lastKind = kind; g.lastMult = mult; g.lastGain = gain; g.lastLoad = g.load;
    if (kind !== 'tap') {
      g.cycles++;
      if (kind === 'gold') g.golds++;
      if (kind === 'flap') g.flaps++;
    }
    g.evt = 'rel:' + kind;
    g.holding = false;
    g.risk = 0;
    g.restT = 0;
  }

  function tear(g) {
    g.tears++;
    g.prog = Math.max(0, g.prog - C.TEAR_BACK);
    g.load = C.TEAR_LOAD;
    g.bag = Math.max(0, g.bag - C.BAG_TEAR);
    g.fill = Math.min(g.fill, 0.12);
    g.crew = Math.max(0, g.crew - C.TEAR_CREW);
    g.fix = C.TEAR_FIX;
    g.freeze = C.FREEZE;
    g.holding = false;
    g.glide = 0;
    g.risk = 0;
    g.evt = 'tear';
  }

  /* ── 한 걸음. want = 지금 버튼이 눌려 있나 ── */
  function advance(g, dt, want) {
    if (g.phase === 'over') return g;
    dt = clamp(dt || 0, 0, 0.05);
    g.want = !!want;

    /* 찢어진 직후의 짧은 정지 — 세계가 멈춘다 */
    if (g.freeze > 0) { g.freeze = Math.max(0, g.freeze - dt); return g; }
    g.t += dt;

    /* 졸음 — 조작이 무거워진다(입력이 늦게 먹는다) */
    if (g.phase === 'drowse') {
      var lag = C.LAG * smooth(g.drowse);
      if (g.want !== g.wantEff) {
        g.lagAcc += dt;
        if (g.lagAcc >= lag) { g.wantEff = g.want; g.lagAcc = 0; }
      } else g.lagAcc = 0;
    } else { g.wantEff = g.want; g.lagAcc = 0; }
    var raw = g.wantEff && (g.phase === 'run' || g.phase === 'drowse');
    /* ★ calm = 돛의 규칙이 물러난 구간(졸음부터). 아래 두 군데가 이걸 본다:
       파도가 부하를 밀어 올리지 않고, 부하가 오르지도 찢어지지도 않는다. */
    var calm = g.phase !== 'run';

    /* 구간 규칙 — 값이 부드럽게 옮겨간다. 게이지는 이 값을 그대로 그린다. */
    var si = segAt(g.prog), sg = C.SEG[si];
    /* 되밀릴 때는 구간이 거꾸로 지나간다 — 그때 "거칠어진다"고 말하면 거짓말이다 */
    if (si !== g.seg) { if (si > g.seg && g.phase === 'run') g.evt2 = 'seg'; g.seg = si; }
    g.danger = ease(g.danger, sg.danger, dt, C.TAU);
    g.gold   = ease(g.gold,   sg.gold,   dt, C.TAU);
    g.up     = ease(g.up,     sg.up,     dt, C.TAU);

    /* 돛을 꿰매는 중 · 자루가 빔 → 눌러도 안 나간다 (왜인지 화면에 쓴다) */
    if (g.fix > 0) g.fix = Math.max(0, g.fix - dt);
    var can = g.bag > 0 && g.fix <= 0;
    g.blocked = (raw && !can) ? (g.bag <= 0 ? 'bag' : 'fix') : '';
    var hold = raw && can;

    /* 누름/놓음 경계 */
    if (hold && !g.holding) {
      g.holding = true; g.pressLoad = g.load; g.holdT = 0;
      g.risk = 0; g.tearRoll = g.rnd(); g.evt = 'press';
    } else if (!hold && g.holding) {
      release(g);
    }

    /* 파도 — 2구간부터. 1.2초 전부터 보인다(화면에도, 게이지에도).
       졸음 구간에서는 파도도 잔다 — 부하를 밀어 올릴 게이지가 없다. */
    if (sg.wave > 0 && !calm) {
      if (g.waveT < 0) g.waveT = g.t + sg.wave * (0.60 + 0.80 * g.rnd());
      g.waveIn = g.waveT - g.t;
      if (g.waveAmp <= 0) g.waveAmp = sg.amp * (0.75 + 0.55 * g.rnd());
      if (g.waveIn <= 0) {
        g.load += g.waveAmp * (0.30 + 0.70 * g.fill);
        g.rock = 1;
        g.evt2 = 'wave';
        g.waveT = g.t + sg.wave * (0.60 + 0.80 * g.rnd());
        g.waveAmp = sg.amp * (0.75 + 0.55 * g.rnd());
        g.waveIn = g.waveT - g.t;
      }
    } else { g.waveIn = 9; g.waveAmp = 0; g.waveT = -1; }

    /* 부하
       ★ 졸음 구간부터는 **돛 부하가 죽는다**(calm). 화면이 금색 큰 글씨로
       "버텨라 · 누르고 있어라" 라고 요구하는 동안, 그 요구를 따르면 돛이
       찢어져 부하가 죽고 진행이 밀리는 규칙이 살아 있으면 게임이 플레이어에게
       거짓말을 하는 것이다. 여기서부터 싸울 상대는 졸음 하나뿐이다.
       (게이지도 같이 물러난다 — frame() 의 hud.rules 를 보라.)             */
    if (hold) {
      g.holdT += dt;
      g.bag = Math.max(0, g.bag - C.BAG_DRAIN * dt);
      if (calm) {
        g.load = Math.max(0, g.load - C.DOWN * dt);
        g.risk = 0;
      } else {
        g.load += g.up * dt * (0.35 + 0.65 * g.drowseF);
        if (g.load >= g.danger) {
          var over = (g.load - g.danger) / Math.max(0.10, 1 - g.danger);
          g.risk += C.HAZ * Math.pow(clamp(over, 0, 1.4), C.HAZP) * dt;
          if (g.load >= 1 || (1 - Math.exp(-g.risk)) >= g.tearRoll) tear(g);
        }
      }
    } else {
      g.restT += dt;
      g.load = Math.max(0, g.load - C.DOWN * dt);
    }

    /* 돛 · 속도 */
    if (hold) g.fill = ease(g.fill, 1, dt, 1 / C.FILL_UP);
    else g.fill = ease(g.fill, 0.05, dt, 1 / (C.FILL_DN * (1 - 0.62 * g.glide)));
    g.glide = Math.max(0, g.glide - dt / C.GLIDE);
    g.rock = Math.max(0, g.rock - dt * 1.6);

    g.prog += (C.V0 + C.V1 * g.fill) * dt;
    if (g.prog > g.best) g.best = g.prog;

    /* ── 마지막 (STAGE2.md §5) ─────────────────────────────────────── */
    if (g.phase === 'run') {
      if (g.prog >= C.SLEEP_AT) { g.phase = 'drowse'; g.drowse = 0; g.evt2 = 'fire'; }
      else if (g.bag <= 0 && g.fill < 0.12) {
        g.driftT += dt;
        if (g.driftT >= C.DRIFT_T) { g.ranOut = true; finishGame(g); }
      } else g.driftT = 0;
    } else if (g.phase === 'drowse') {
      /* ★ 버티는 손이 실제로 무언가를 한다 — 졸음이 느려진다.
         멈추진 않는다. 눌러도 잠들지만, 그때까지 배는 더 나아간다.       */
      g.gripping = !!raw;
      var grip = raw ? lerp(C.GRIP0, C.GRIP1, smooth(g.drowse)) : 1;
      g.drowse += dt / C.DROWSE * grip;
      g.drowseF = 1 - smooth(g.drowse);
      if (g.prog > C.CAP) g.prog = C.CAP;
      if (g.drowse >= 1) {
        g.phase = 'sleep'; g.sleepT = 0; g.slept = true;
        g.gripping = false;
        g.reached = Math.max(g.prog, g.best);
        g.holding = false; g.fill = Math.min(g.fill, 0.35);
        g.evt2 = 'sleep';
      }
    } else if (g.phase === 'sleep') {
      g.sleepT += dt;
      g.fill = ease(g.fill, 0, dt, 0.5);
      g.load = Math.max(0, g.load - C.DOWN * dt);
      if (g.sleepT >= C.SLEEP_T) {
        g.phase = 'push'; g.pushT = 0;
        landAfterPush(g);
        g.evt2 = 'burst';
      }
    } else if (g.phase === 'push') {
      g.pushT += dt;
      var u = clamp(g.pushT / C.PUSH_T, 0, 1);
      g.prog = lerp(g.reached, g.landed, 1 - Math.pow(1 - u, 2.4));
      g.load = 0; g.fill = 0;
      if (u >= 1) finishGame(g);
    }
    return g;
  }

  /* ── 자루가 터진다 — 어디까지 되밀리고, 누가 쓸려 나가는가 ──
     졸음 구간에서 더 민 거리(push)와 아낀 바람(bag)이 여기서 값을 치른다.
     이 판의 유일한 인명 손실이 여기 있다 — 항해를 통째로 날렸는데
     아무도 잃지 않는 재앙은 없다.                                        */
  function landAfterPush(g) {
    var push = clamp((g.reached - C.SLEEP_AT) / Math.max(0.01, C.CAP - C.SLEEP_AT), 0, 1);
    var save = clamp(g.bag, 0, 1);
    g.grade  = clamp(0.72 * push + 0.28 * save, 0, 1);
    g.landed = clamp(C.LAND0 + C.LAND_PUSH * push + C.LAND_BAG * save, 0.03, 0.55);
    g.remain = clamp(1 - g.landed, 0, 1);
    var swept = Math.round(g.crew * lerp(C.LOST_HI, C.LOST_LO, g.grade));
    swept = Math.max(0, Math.min(g.crew, swept));
    g.crew -= swept;
    g.swept = swept;
  }

  function finishGame(g) {
    g.phase = 'over';
    /* 잠들지 못하고 끝났다면(자루가 빔) 배가 실제로 선 자리가 전부다 —
       화면의 막대도 그 자리를 가리킨다. 둘이 다른 수를 말하면 안 된다. */
    if (!g.slept) {
      g.reached = g.prog;
      g.landed = g.prog;
      g.remain = clamp(1 - g.prog, 0, 1);
    }
  }

  function resultOf(g) {
    return {
      stage: 'windbag',
      slept: g.slept, ranOut: g.ranOut,
      reached: +g.reached.toFixed(4),
      /* landed = 여기까지 왔다 · remain = 이타카까지 남은 거리.
         둘은 서로 뒤집힌 값이다. 화면의 막대는 landed 를 가리킨다. */
      landed: +g.landed.toFixed(4),
      remain: +g.remain.toFixed(4),
      swept: g.swept,
      bag: +g.bag.toFixed(3),
      tears: g.tears, golds: g.golds, cycles: g.cycles, flaps: g.flaps,
      crew: g.crew, crewLost: (g.crew0 - g.crew),
      time: +g.t.toFixed(1)
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 시뮬레이션 — "2~3분, 시도 2~4회" 를 숫자로 확인한다.
        policy: 'gold'(금색 띠를 노린다) | 'safe'(겁먹고 일찍 놓는다)
                | 'greedy'(붉은 구간에서 버틴다) | 'hold'(계속 누른다)
        lat = 사람의 반응 지연, jit = 조준이 흔들리는 폭(부하 단위)
     ════════════════════════════════════════════════════════════════════ */
  /* 정책 봇 — simulate() 와 auto()(실제 입력 경로) 가 **같은 걸** 쓴다.
     사람처럼 lat 초 전의 화면을 보고, 게이지가 다 빠진 뒤에 다시 누른다.

     drowse = **졸음 구간에서 손이 하는 일**. 화면은 거기서 "버텨라 ·
     누르고 있어라" 라고 **요구한다**. 그 요구를 따른 손이 정말로 가장
     좋은 결과를 내는지 — 그걸 재려고 여기를 따로 둔다.
       'let'   손을 뗀다
       'obey'  시키는 대로 계속 누른다
       'avoid' 누르되 게이지가 붉어지면 놓았다 다시 누른다
       'band'  본편의 맥박(금색 띠에 닿으면 놓기)을 졸음 구간까지 그대로   */
  function makeBot(o) {
    o = o || {};
    var policy = o.policy || 'gold';
    var dz = o.drowse || 'obey';
    var lat = o.lat == null ? 0.16 : o.lat;
    var jit = o.jit == null ? 0.035 : o.jit;
    var rest = o.rest == null ? 0.06 : o.rest;   // 부하가 여기까지 내려오면 다시 누른다
    var rnd = makeRng((o.seed || 4242) ^ 0x5bd1);
    var lagN = Math.max(1, Math.round(lat * 60));
    var buf = [], want = false, target = 0, dzH = 0, dzR = 0;
    return function (g) {
      /* ── 졸음 구간 — 화면의 요구를 따랐는지만 재는 자리 ── */
      if (g.phase === 'drowse') {
        if (dz === 'let') { want = false; return false; }
        if (dz === 'obey') { want = true; return true; }
        if (dz === 'avoid') {
          if (want) { if (g.load >= g.danger - 0.03) want = false; }
          else if (g.load <= 0.10) want = true;
          return want;
        }
        /* band — 금색 띠에 닿으면 놓고, 다 빠지면 다시 누른다.
           부하가 움직이지 않으면(고친 뒤) 같은 리듬을 시계로 지킨다. */
        var blo = g.danger - g.gold;
        if (want) { dzH++; if (g.load >= blo || dzH >= 70) { want = false; dzH = 0; dzR = 0; } }
        else { dzR++; if ((g.load <= rest && dzR >= 8) || dzR >= 58) { want = true; dzH = 0; dzR = 0; } }
        return want;
      }
      buf.push({ load: g.load, danger: g.danger, gold: g.gold, up: g.up, fix: g.fix,
                 bag: g.bag, wIn: g.waveIn, wAmp: g.waveAmp, fill: g.fill });
      if (buf.length > lagN) buf.shift();
      var v = buf[0];
      if (!want) {
        if (v.fix <= 0 && v.bag > 0 && v.load <= rest) {
          var lo = v.danger - v.gold;
          var aim = policy === 'safe' ? lo * 0.72
                  : policy === 'greedy' ? 0.985
                  : policy === 'hold' ? 9
                  : policy === 'push' ? v.danger + 0.025   // 붉은 구간을 살짝 밟는다
                  : lo + v.gold * 0.55;
          /* 반응 지연만큼 미리 놓아야 한다는 걸 아는 플레이어 */
          target = aim - ((policy === 'gold' || policy === 'push') ? v.up * lat : 0)
                       + (rnd() * 2 - 1) * jit;
          want = true;
        }
      } else {
        var pred = v.load;
        /* 곧 파도가 오면 그만큼 미리 본다 — 화면에 보이니까 */
        if ((policy === 'gold' || policy === 'push') && v.wIn < 0.35)
          pred += v.wAmp * (0.30 + 0.70 * v.fill);
        if (pred >= target) want = false;
        if (g.fix > 0) want = false;              // 찢어졌다 → 손을 뗀다
      }
      return want;
    };
  }

  function simulate(o) {
    o = o || {};
    var g = newGame(o.seed || 4242, o.crew);
    var bot = makeBot(o);
    var dt = 1 / 60, i, n = Math.round((o.maxSec || 400) / dt);
    for (i = 0; i < n && g.phase !== 'over'; i++) advance(g, dt, bot(g));
    var r = resultOf(g);
    r.policy = o.policy || 'gold';
    r.drowse = o.drowse || 'obey';
    r.lat = o.lat == null ? 0.16 : o.lat;
    r.jit = o.jit == null ? 0.035 : o.jit;
    r.progAtEnd = +g.prog.toFixed(3);
    r.steps = i;
    return r;
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
      if (gs[i].attributes.normal) nrm.set(gs[i].attributes.normal.array, o * 3);
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
    out.computeVertexNormals();
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
    var wind = null, windG = null, windF = null;
    var luff = null, luffG = null, luffF = null, luffLfo = null, luffLg = null;
    var on = true, ready = false;

    function ensure() {
      if (ctx || !on) return ctx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);

        var len = Math.floor(ctx.sampleRate * 1.6);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noise.getChannelData(0), i;
        for (i = 0; i < len; i++) d[i] = rnd() * 2 - 1;

        /* 바람 — 돛이 부풀수록 커지고 밝아진다 */
        wind = ctx.createBufferSource(); wind.buffer = noise; wind.loop = true;
        windF = ctx.createBiquadFilter();
        windF.type = 'bandpass'; windF.frequency.value = 430; windF.Q.value = 0.7;
        windG = ctx.createGain(); windG.gain.value = 0.02;
        wind.connect(windF); windF.connect(windG); windG.connect(master);
        wind.start();

        /* 돛 떨림 — 붉은 구간에서만 (진폭이 흔들린다) */
        luff = ctx.createBufferSource(); luff.buffer = noise; luff.loop = true;
        luffF = ctx.createBiquadFilter();
        luffF.type = 'bandpass'; luffF.frequency.value = 220; luffF.Q.value = 1.6;
        luffG = ctx.createGain(); luffG.gain.value = 0;
        luffLfo = ctx.createOscillator(); luffLfo.type = 'sine'; luffLfo.frequency.value = 11;
        luffLg = ctx.createGain(); luffLg.gain.value = 0;
        luffLfo.connect(luffLg); luffLg.connect(luffG.gain);
        luff.connect(luffF); luffF.connect(luffG); luffG.connect(master);
        luff.start(); luffLfo.start();
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
    function burst(f0, f1, q, dur, vol, type) {
      if (!ctx) return;
      try {
        var s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(),
            g = ctx.createGain(), t = now();
        s.buffer = noise; s.loop = true;
        bp.type = type || 'bandpass'; bp.Q.value = q;
        bp.frequency.setValueAtTime(f0, t);
        bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
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
      /* 바람 — fill 0..1 */
      wind: function (lv, danger) {
        if (!ctx || !windG) return;
        try {
          windG.gain.setTargetAtTime(0.015 + 0.16 * lv, now(), 0.10);
          windF.frequency.setTargetAtTime(320 + 620 * lv, now(), 0.12);
          luffG.gain.setTargetAtTime(0.13 * danger, now(), 0.06);
          luffLg.gain.setTargetAtTime(0.10 * danger, now(), 0.06);
          luffLfo.frequency.setTargetAtTime(9 + 13 * danger, now(), 0.10);
        } catch (e) { }
      },
      open:  function () { burst(180, 520, 0.5, 0.45, 0.10); },
      /* 금색 띠에서 놓았다 — 밝게 */
      good:  function () {
        tone('sine', 660, 1320, 0.26, 0.20);
        tone('triangle', 990, 1760, 0.18, 0.09);
        burst(1800, 3200, 1.6, 0.16, 0.05);
      },
      soft:  function () { tone('sine', 380, 520, 0.16, 0.07); },
      flap:  function () { burst(300, 140, 0.9, 0.34, 0.13); },
      /* 천이 찢어진다 */
      rip:   function () {
        burst(2600, 300, 0.35, 0.42, 0.30, 'highpass');
        burst(900, 120, 0.8, 0.55, 0.20);
        tone('sawtooth', 260, 60, 0.42, 0.13);
      },
      wave:  function () { tone('sine', 120, 52, 0.42, 0.17); burst(420, 160, 0.8, 0.36, 0.09); },
      tick:  function (p) { tone('sine', 1180 + p * 260, 1180 + p * 260, 0.045, 0.045); },
      fire:  function () { tone('sine', 420, 700, 0.7, 0.13); tone('sine', 630, 1050, 0.9, 0.08); },
      sleep: function () { tone('sine', 240, 70, 1.5, 0.20); tone('sine', 180, 55, 1.9, 0.13); },
      burstOut: function () {
        burst(160, 1400, 0.4, 1.4, 0.26);
        tone('sawtooth', 90, 340, 1.2, 0.12);
      },
      dead:  function () { tone('sine', 200, 60, 0.9, 0.16); },
      mute:  function () { on = false; try { if (master) master.gain.value = 0; } catch (e) { } },
      dispose: function () {
        try { if (wind) wind.stop(); } catch (e) { }
        try { if (luff) luff.stop(); } catch (e) { }
        try { if (luffLfo) luffLfo.stop(); } catch (e) { }
        try { if (ctx) ctx.close(); } catch (e) { }
        ctx = null;
      }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. HUD — 게이지가 규칙을 가르친다 (STAGE2.md §3)
     ════════════════════════════════════════════════════════════════════ */
  var CSS_ID = 'od-st2-css';
  var CSS = [
    '.st2{position:absolute;inset:0;pointer-events:none;',
    'font-family:-apple-system,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;',
    'color:#eef1f6;-webkit-user-select:none;user-select:none;z-index:5}',

    /* ── 위: 진행 게이지 (이타카까지) ── */
    '.st2 .top{position:absolute;left:0;right:0;top:0;padding:15px 16px 0;',
    'display:flex;align-items:center;gap:11px}',
    '.st2 .top>em{font-style:normal;font-size:.62rem;letter-spacing:.18em;font-weight:700;',
    'opacity:.55;text-shadow:0 2px 8px #000;white-space:nowrap}',
    '.st2 .ptrack{position:relative;flex:1;height:12px;border-radius:7px;',
    'background:rgba(6,10,18,.6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}',
    '.st2 .ptrack i,.st2 .ptrack b,.st2 .ptrack u{position:absolute;top:0;bottom:0;display:block}',
    '.st2 .pghost{left:0;background:#e2705f;opacity:0;border-radius:6px;transition:opacity .5s}',
    '.st2 .pghost.on{opacity:.55;transition:opacity .05s}',
    '.st2 .pfill{left:0;border-radius:6px;background:linear-gradient(90deg,#4f9bd8,#8fe0c6)}',
    '.st2 .phead{width:3px;margin-left:-1.5px;background:#fff;border-radius:2px;',
    'box-shadow:0 0 8px rgba(255,255,255,.8)}',
    '.st2 .ptick{width:1px;background:rgba(255,255,255,.30)}',
    '.st2 .pfire{position:absolute;right:-4px;top:50%;width:13px;height:13px;margin-top:-6.5px;',
    'border-radius:50%;background:#3a3f4a;display:block;transition:background .6s,box-shadow .6s}',
    '.st2 .pfire.on{background:#ffa23a;box-shadow:0 0 16px 4px rgba(255,150,50,.9)}',
    '.st2 .crew{display:flex;align-items:center;gap:6px;font-size:.9rem;font-weight:700;',
    'opacity:.85;text-shadow:0 2px 8px #000;font-variant-numeric:tabular-nums}',
    '.st2 .crew em{font-style:normal;opacity:.6;font-size:.72rem;font-weight:600}',
    '.st2 .crew span{transition:color .5s,text-shadow .5s}',
    '.st2 .crew.hit span{color:#ff7a55;text-shadow:0 0 14px rgba(255,90,60,.85)}',
    /* 끝난 뒤 — 막대가 가리키는 것과 **같은 것**을 숫자로 말한다 */
    '.st2 .pnum{font-size:.86rem;font-weight:800;color:#ffd88f;opacity:0;',
    'transition:opacity .45s;font-variant-numeric:tabular-nums;white-space:nowrap;',
    'text-shadow:0 2px 8px #000}',
    '.st2 .pnum.on{opacity:1}',

    /* ── 아래: 자루 + 돛 부하 게이지 ── */
    '.st2 .bottom{position:absolute;left:0;right:0;bottom:0;padding:0 0 5.5%;',
    'display:flex;flex-direction:column;align-items:center;gap:13px;',
    'transition:opacity .55s}',
    '.st2 .bagrow{display:flex;align-items:center;gap:8px;',
    'width:min(78vw,540px);justify-content:flex-start}',
    '.st2 .bagrow em{font-style:normal;font-size:.62rem;letter-spacing:.18em;',
    'font-weight:700;opacity:.55;text-shadow:0 2px 8px #000}',
    '.st2 .bag{position:relative;width:min(26vw,170px);height:6px;border-radius:4px;',
    'background:rgba(6,10,18,.55);box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}',
    '.st2 .bag i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;',
    'background:linear-gradient(90deg,#8a7550,#e6d3a2)}',
    '.st2 .bag.low i{background:linear-gradient(90deg,#a2472e,#e2705f)}',

    '.st2 .load{position:relative;width:min(78vw,540px)}',
    '.st2 .ltrack{position:relative;height:30px;border-radius:8px;overflow:hidden;',
    'background:rgba(5,9,16,.72);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.16),',
    '0 6px 22px rgba(0,0,0,.5)}',
    '.st2 .ltrack i,.st2 .ltrack b{position:absolute;top:0;bottom:0;display:block}',
    /* 위험대 — 언제 찢어질지 모르는 곳 */
    '.st2 .danger{right:0;background:repeating-linear-gradient(115deg,',
    'rgba(226,66,42,.60) 0 9px,rgba(180,44,26,.60) 9px 18px);',
    'box-shadow:inset 2px 0 0 rgba(255,120,90,.9)}',
    /* 금색 띠 — 최대 효율 */
    '.st2 .gold{background:linear-gradient(180deg,#ffe9a8,#f0b429);opacity:.9;',
    'box-shadow:inset 2px 0 0 rgba(255,255,255,.85)}',
    '.st2 .lfill{left:0;background:linear-gradient(90deg,#3f7fb8,#7fd4e8);opacity:.95}',
    /* 다가오는 파도가 부하를 어디까지 밀어 올리는지 — 게이지 위쪽에 띠로 */
    '.st2 .lghost{top:0;height:7px;bottom:auto;border-radius:0 3px 3px 0;',
    'box-shadow:2px 0 0 rgba(255,255,255,.9)}',
    '.st2 .lhead{width:4px;margin-left:-2px;background:#fff;border-radius:2px;',
    'box-shadow:0 0 10px 2px rgba(255,255,255,.7)}',
    '.st2 .load.hot .ltrack{box-shadow:inset 0 0 0 1.5px rgba(255,150,120,.85),',
    '0 6px 26px rgba(190,40,20,.55)}',
    '.st2 .load.win .ltrack{box-shadow:inset 0 0 0 2px rgba(255,226,150,.95),',
    '0 6px 30px rgba(240,180,60,.6)}',
    /* 금색 띠 바로 위에 붙는 표시 — 어디서 놓아야 하는지를 가리킨다 */
    '.st2 .now{position:absolute;top:-21px;transform:translateX(-50%);',
    'font-size:.72rem;letter-spacing:.14em;font-weight:900;color:#ffd98c;opacity:0;',
    'text-shadow:0 2px 10px #000;transition:opacity .12s;white-space:nowrap}',
    '.st2 .now:after{content:"";position:absolute;left:50%;bottom:-7px;margin-left:-4px;',
    'border:4px solid transparent;border-top-color:#ffd98c}',
    '.st2 .load.win .now{opacity:1}',
    /* 붉은 구간 — 막대는 벌을 주는데 캐럿이 "지금"이면 거짓말이다 */
    '.st2 .load.hot .now{opacity:1;color:#ff8a63}',
    '.st2 .load.hot .now:after{border-top-color:#ff8a63}',

    /* ── 한마디 ── */
    /* 좁은 화면에서는 접힌다 — 인명 손실 같은 건 잘려선 안 된다 */
    '.st2 .flash{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);',
    'width:max-content;max-width:88vw;',
    'font-size:1.5rem;font-weight:900;opacity:0;text-align:center;',
    'text-shadow:0 2px 14px #000,0 0 24px rgba(0,0,0,.7);transition:opacity .2s,top .5s}',
    '.st2 .flash.on{opacity:1;top:48%}',
    /* ★ 되밀림 절정 문구 — 잠드는 문장(.slept, 화면 정중앙)과 **같은 자리에
       그리지 않는다.** 순서도 어긋나게 두고(CLIMAX_AT) 자리도 어긋나게 둔다.
       게이지가 물러난 아래쪽이 비어 있으므로 거기로 내려 보낸다. */
    '.st2 .flash.low.on{top:66%}',
    '.st2 .flash.low{font-size:1.62rem}',
    '.st2 .flash u{display:block;margin-top:4px;font-size:.86rem;font-weight:700;',
    'text-decoration:none;letter-spacing:.02em;opacity:.9}',
    '.st2 .hint{position:absolute;left:50%;bottom:19%;transform:translateX(-50%);',
    'font-size:.95rem;font-weight:700;color:#dfe6f0;opacity:0;white-space:nowrap;',
    'padding:8px 17px;border-radius:999px;background:rgba(6,10,18,.5);',
    'text-shadow:0 2px 10px #000;transition:opacity .5s}',
    '.st2 .hint.on{opacity:.92}',

    /* ── 졸음 — 요구와 게이지 (STAGE2.md §5) ──
       눈꺼풀만 내려오면 "컷신"으로 읽힌다. 요구를 글자로 띄우고,
       얼마나 남았는지를 숫자로 보여야 잠들 때 '내가 못 버텼다'가 된다. */
    '@keyframes st2beat{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}',
    /* 놓았을 때의 한마디(.flash)와 겹치지 않게 게이지 바로 위에 둔다 —
       플레이어의 눈이 이미 거기 있다. */
    '.st2 .dz{position:absolute;left:50%;bottom:17%;transform:translateX(-50%);',
    'display:flex;flex-direction:column;align-items:center;gap:10px;',
    'opacity:0;transition:opacity .35s;pointer-events:none}',
    '.st2 .dz.on{opacity:1}',
    '.st2 .dzcall{font-size:1.62rem;font-weight:900;letter-spacing:.10em;color:#ffd0a0;',
    'text-shadow:0 2px 14px #000,0 0 28px rgba(0,0,0,.85);text-align:center}',
    '.st2 .dz.on .dzcall{animation:st2beat 1.05s ease-in-out infinite}',
    '.st2 .dzcall u{display:block;margin-top:6px;font-size:.85rem;font-weight:700;',
    'text-decoration:none;color:#e8eef7;opacity:.92;letter-spacing:.02em;',
    'animation:none;text-shadow:0 2px 10px #000}',
    '.st2 .dzrow{display:flex;align-items:center;gap:8px;width:min(56vw,330px)}',
    '.st2 .dzrow em{font-style:normal;font-size:.62rem;letter-spacing:.18em;',
    'font-weight:700;opacity:.7;text-shadow:0 2px 8px #000}',
    '.st2 .dbar{position:relative;flex:1;height:9px;border-radius:5px;',
    'background:rgba(6,10,18,.7);box-shadow:inset 0 0 0 1px rgba(255,255,255,.20)}',
    '.st2 .dbar i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;',
    'background:linear-gradient(90deg,#7a5aa8,#e2705f)}',
    '.st2 .dbar.grip i{background:linear-gradient(90deg,#3f7fb8,#7fd4e8)}',
    '.st2 .dzpct{font-size:.74rem;font-weight:800;opacity:.85;',
    'font-variant-numeric:tabular-nums;text-shadow:0 2px 8px #000;min-width:2.6em}',

    /* ── 잠드는 순간 — 검은 화면을 비워두지 않는다 ── */
    '.st2 .slept{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
    'width:86%;max-width:32em;text-align:center;opacity:0;transition:opacity .5s;',
    'font-size:1.05rem;line-height:1.9;color:#c6d0de;text-shadow:0 2px 16px #000}',
    '.st2 .slept b{display:block;margin-top:8px;font-size:1.36rem;font-weight:900;',
    'color:#f2e2c4;letter-spacing:.02em}',

    /* ── 가장자리 붉은 기운 · 졸음 ── */
    '.st2 .edge{position:absolute;inset:0;opacity:0;',
    'background:radial-gradient(88% 62% at 50% 50%,rgba(0,0,0,0) 30%,rgba(196,32,14,.92) 100%)}',
    '.st2 .doze{position:absolute;inset:0;opacity:0;background:rgba(3,5,10,1)}',
    '.st2 .lid{position:absolute;left:-5%;right:-5%;height:52%;background:#04060b;',
    'transform:translateY(-100%)}',
    '.st2 .lid.t{top:0;box-shadow:0 14px 40px rgba(0,0,0,.9)}',
    '.st2 .lid.b{bottom:0;top:auto;transform:translateY(100%);box-shadow:0 -14px 40px rgba(0,0,0,.9)}',

    /* ── 결과 카드 ── */
    '.st2 .end{position:absolute;inset:0;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:14px;background:rgba(4,7,13,.9);',
    'opacity:0;pointer-events:none;visibility:hidden;',
    'transition:opacity .5s;text-align:center;padding:26px}',
    '.st2 .end.on{opacity:1;pointer-events:auto;visibility:visible}',
    '.st2 .end h2{font-size:1.55rem;font-weight:800;margin:0;letter-spacing:-.02em}',
    '.st2 .end p{font-size:1rem;color:#c3cbd8;margin:0;line-height:1.85;max-width:30em}',
    '.st2 .end .fact{font-size:.9rem;color:#8d96a6;font-style:italic}',
    '.st2 .end .stat{font-size:.92rem;color:#9fb4cc;font-variant-numeric:tabular-nums}',
    '.st2 .end b{color:#ffd88f}',
    '.st2 .end button{margin-top:8px;padding:12px 28px;border-radius:999px;',
    'border:1px solid #46536b;background:#141a26;color:#eef1f6;font-size:1rem;font-weight:700;',
    'cursor:pointer;font-family:inherit}',
    '.st2 .end button:active{transform:translateY(1px)}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function pc(v) { return (v * 100).toFixed(2) + '%'; }

  function makeHud(host, crew0) {
    ensureCss();
    var el = document.createElement('div');
    el.className = 'st2';
    /* 붉은 기운·졸음 장막이 먼저 깔리고, 게이지는 그 위에 남는다 —
       눈이 감기는 동안에도 규칙은 보여야 한다. */
    el.innerHTML =
      '<div class="edge"></div>' +
      '<div class="doze"></div><div class="lid t"></div><div class="lid b"></div>' +
      '<div class="top">' +
        '<em>이타카</em><span class="pnum"></span>' +
        '<div class="ptrack">' +
          '<i class="pghost"></i><i class="pfill"></i>' +
          '<u class="ptick t1"></u><u class="ptick t2"></u>' +
          '<b class="phead"></b><s class="pfire"></s>' +
        '</div>' +
        '<div class="crew"><em>부하</em><span>' + crew0 + '</span></div>' +
      '</div>' +
      '<div class="bottom">' +
        '<div class="bagrow"><em>자루</em><div class="bag"><i></i></div></div>' +
        '<div class="load"><span class="now">지금</span><div class="ltrack">' +
          '<i class="danger"></i><i class="gold"></i>' +
          '<i class="lfill"></i><i class="lghost"></i><b class="lhead"></b>' +
        '</div></div>' +
      '</div>' +
      '<div class="dz"><div class="dzcall"><span>버텨라</span><u></u></div>' +
        '<div class="dzrow"><em>졸음</em><div class="dbar"><i></i></div>' +
        '<span class="dzpct">0%</span></div></div>' +
      '<div class="flash"><span></span><u></u></div>' +
      '<div class="hint">누르고 있으면 바람이 나온다</div>' +
      '<div class="slept">아흐레를 깨어 있었다.<b>그리고 그는 잠들었다.</b></div>' +
      '<div class="end"><h2></h2><p></p><div class="fact"></div>' +
        '<div class="stat"></div><button type="button">다시</button></div>';
    host.appendChild(el);

    var q = function (s) { return el.querySelector(s); };
    var pfill = q('.pfill'), phead = q('.phead'), pghost = q('.pghost'),
        pfire = q('.pfire'), t1 = q('.ptick.t1'), t2 = q('.ptick.t2'),
        topLbl = q('.top>em'), pnum = q('.pnum'),
        crewBox = q('.crew'), crewN = q('.crew span'),
        botBox = q('.bottom'),
        dz = q('.dz'), dzT = q('.dzcall span'), dzU = q('.dzcall u'),
        dbar = q('.dbar'), dbarI = q('.dbar i'), dzP = q('.dzpct'),
        sleptEl = q('.slept'),
        bagBar = q('.bag'), bagFill = q('.bag i'),
        load = q('.load'), now = q('.now'), dgr = q('.danger'), gold = q('.gold'),
        lfill = q('.lfill'), lghost = q('.lghost'), lhead = q('.lhead'),
        edge = q('.edge'), doze = q('.doze'), lidT = q('.lid.t'), lidB = q('.lid.b'),
        flash = q('.flash'), fT = q('.flash span'), fW = q('.flash u'),
        hint = q('.hint'), end = q('.end'),
        endH = q('.end h2'), endP = q('.end p'), endF = q('.end .fact'),
        endS = q('.end .stat'), endB = q('.end button');

    t1.style.left = pc(C.SEG[0].to);
    t2.style.left = pc(C.SEG[1].to);

    var last = {}, flashT = 0, flashP = 0;
    function set(node, prop, v) {
      var k = node.__k || (node.__k = {});
      if (k[prop] === v) return;
      k[prop] = v; node.style[prop] = v;
    }

    return {
      el: el,
      onRestart: function (fn) { endB.addEventListener('click', fn); },

      /* ★ 게이지 — 이 함수가 이 편의 규칙을 전부 그린다 */
      gauge: function (g, fireOn) {
        var lo = Math.max(0, g.danger - g.gold);
        set(dgr, 'left', pc(g.danger));
        set(gold, 'left', pc(lo));
        set(gold, 'width', pc(g.gold));
        var L = clamp(g.load, 0, 1);
        set(lfill, 'width', pc(L));
        set(lhead, 'left', pc(L));
        var kind = kindOf(L, g.danger, g.gold);
        var hot = L >= g.danger;
        var cls = 'load' + (hot ? ' hot' : (kind === 'gold' ? ' win' : ''));
        if (load.className !== cls) load.className = cls;
        /* 캐럿은 막대와 **같은 말**을 해야 한다 — 금색에선 "지금",
           붉은 구간에 들어가면 그 자리에서 "늦었다". */
        if (hot) {
          if (last.now !== 'late') { last.now = 'late'; now.textContent = '늦었다'; }
          set(now, 'left', pc(clamp(L, 0, 0.95)));
        } else {
          if (last.now !== 'now') { last.now = 'now'; now.textContent = '지금'; }
          set(now, 'left', pc(lo + g.gold * 0.5));
        }
        set(lfill, 'background', hot ? 'linear-gradient(90deg,#c8402a,#ff8b5e)'
             : (kind === 'gold' ? 'linear-gradient(90deg,#e8a83c,#ffe9a8)'
                                : 'linear-gradient(90deg,#3f7fb8,#7fd4e8)'));
        /* 다가오는 파도가 부하를 어디까지 밀어 올리는지 — 미리 보여준다 */
        var gh = (g.waveIn < C.WAVE_LEAD && g.waveAmp > 0)
                 ? g.waveAmp * (0.30 + 0.70 * g.fill) : 0;
        if (gh > 0.004) {
          set(lghost, 'left', pc(L));
          set(lghost, 'width', pc(Math.min(gh, 1 - L)));
          set(lghost, 'opacity', String(0.45 + 0.55 * (1 - g.waveIn / C.WAVE_LEAD)));
          set(lghost, 'background', (L + gh >= g.danger)
              ? 'rgba(255,96,64,.92)' : 'rgba(255,255,255,.62)');
        } else set(lghost, 'width', '0%');

        set(bagFill, 'width', pc(clamp(g.bag, 0, 1)));
        if ((g.bag < 0.22) !== (bagBar.className === 'bag low'))
          bagBar.className = g.bag < 0.22 ? 'bag low' : 'bag';

        var p = clamp(g.prog, 0, 1);
        set(pfill, 'width', pc(p));
        set(phead, 'left', pc(p));
        if ((pfire.className === 'pfire on') !== !!fireOn)
          pfire.className = fireOn ? 'pfire on' : 'pfire';

        set(edge, 'opacity',
            hot ? (0.26 + clamp((L - g.danger) / 0.16, 0, 1) * 0.52).toFixed(2) : '0');
      },
      crew: function (n) { if (last.crew !== n) { last.crew = n; crewN.textContent = String(n); } },
      /* 사람이 줄었다는 걸 숫자만 조용히 바꾸고 넘어가지 않는다 */
      crewHit: function () {
        crewBox.className = 'crew hit';
        setTimeout(function () { crewBox.className = 'crew'; }, 1100);
      },
      /* ★ 졸음 — 요구(글자)와 남은 양(수치)을 화면에 둔다 */
      drowse: function (on, v, grip) {
        if (last.dz !== on) { last.dz = on; dz.className = on ? 'dz on' : 'dz'; }
        if (!on) return;
        v = clamp(v, 0, 1);
        set(dbarI, 'width', pc(v));
        var bc = grip ? 'dbar grip' : 'dbar';
        if (dbar.className !== bc) dbar.className = bc;
        var call = v < 0.50 ? '버텨라' : (v < 0.82 ? '조금만 더' : '눈이 감긴다');
        /* 화면이 요구하는 것과 규칙이 주는 것이 같아야 한다.
           여기서 누르는 손은 졸음을 늦추고 배를 더 밀어 준다 — 잃는 건 없다. */
        var sub = grip ? '버티는 중 — 졸음이 느려지고 배가 더 나아간다'
                       : '누르고 있어라 — 누른 만큼 더 간다';
        if (last.dzT !== call) { last.dzT = call; dzT.textContent = call; }
        if (last.dzU !== sub) { last.dzU = sub; dzU.textContent = sub; }
        var p = Math.round(v * 100) + '%';
        if (last.dzP !== p) { last.dzP = p; dzP.textContent = p; }
      },
      /* ★ 잠드는 순간 — 검은 화면 위에 문장이 뜬다.
         이때 규칙 게이지는 물러난다. 잠든 사람에게 요구할 것은 없다. */
      slept: function (v) {
        v = clamp(v, 0, 1);
        if (last.slept === v) return;
        last.slept = v;
        sleptEl.style.opacity = String(v);
      },
      rules: function (on) {
        if (last.rules === on) return;
        last.rules = on;
        botBox.style.opacity = on ? '1' : '0';
      },
      /* 끝난 뒤 — 위 막대가 가리키는 자리를 그 옆에 숫자로 못 박는다.
         "여기까지 왔다 20%" 와 20% 에 선 막대가 같은 것을 말한다.      */
      done: function (landed) {
        if (landed == null) {
          topLbl.textContent = '이타카';
          pnum.className = 'pnum';
          return;
        }
        topLbl.textContent = '여기까지 왔다';
        pnum.textContent = Math.round(clamp(landed, 0, 1) * 100) + '%';
        pnum.className = 'pnum on';
      },
      /* 찢어졌을 때 '어디까지 갔었는지'를 잠깐 남긴다 */
      ghost: function (from) {
        pghost.style.width = pc(clamp(from, 0, 1));
        pghost.className = 'pghost on';
        setTimeout(function () { pghost.className = 'pghost'; }, 850);
      },
      doze: function (v, blink) {
        set(doze, 'opacity', String(clamp(v, 0, 1) * 0.55));
        var h = clamp(blink, 0, 1);
        set(lidT, 'transform', 'translateY(' + (-100 + h * 100) + '%)');
        set(lidB, 'transform', 'translateY(' + (100 - h * 100) + '%)');
      },
      /* ★ 한마디 — **우선순위**가 있다.
         prio 가 낮은 말은 떠 있는 높은 말을 밀어내지 못한다. 그래서 절정 문구
         (prio 9)는 무엇에도 가려지지 않는다. 같은 말을 다시 부르면 타이머를
         늘리지 않는다 — 연타로 배너가 눌어붙던 자리가 여기였다.
         opt: { prio, dur, low }                                            */
      flash: function (txt, col, why, opt) {
        if (!txt) {
          flash.className = 'flash'; flashT = 0; flashP = 0; last.flashTxt = '';
          return false;
        }
        opt = opt || {};
        var prio = opt.prio || 1;
        if (flashT > 0 && (prio < flashP || last.flashTxt === txt)) return false;
        last.flashTxt = txt;
        fT.textContent = txt;
        fW.textContent = why || '';
        flash.style.color = col;
        flash.className = 'flash on' + (opt.low ? ' low' : '');
        flashT = opt.dur || 1.25;
        flashP = prio;
        return true;
      },
      /* prio 가 이보다 낮은 말은 **즉시** 지운다. 절정 구간에 잡소리가
         살아 들어오지 못하게 하는 문. */
      hush: function (minPrio) {
        if (flashT <= 0) return;
        if (flashP >= (minPrio || 99)) return;
        flash.className = 'flash'; flashT = 0; flashP = 0; last.flashTxt = '';
      },
      hint: function (on) { hint.className = on ? 'hint on' : 'hint'; },
      tick: function (dt) {
        if (flashT > 0) {
          flashT -= dt;
          if (flashT <= 0) { flash.className = 'flash'; flashP = 0; last.flashTxt = ''; }
        }
      },
      end: function (r) {
        if (!r) { end.className = 'end'; return; }
        /* 두 결말이 **같은 축**으로 말한다 — 언제나 "여기까지 왔다".
           위 막대가 선 자리와 카드의 숫자가 서로 다른 축이면 거짓말이다.
           그리고 잃은 사람 수를 반드시 적는다 — 남은 수만 적으면 손실이 숨는다. */
        var lostLine = '부하 <b>' + r.crewLost + '명</b>을 잃었다' +
                       (r.tears ? ' (돛이 ' + r.tears + '번 찢어졌다)' : '') +
                       ' · 남은 부하 ' + r.crew + '명';
        if (r.ranOut) {
          endH.textContent = '바람이 다 떨어졌다';
          endP.innerHTML = '자루가 비었다. 돛은 늘어졌고,<br>' +
                           '배는 파도에 실려 흔들릴 뿐이었다.';
          endF.textContent = '아이올로스는 두 번은 돕지 않았다.';
          endS.innerHTML = '여기까지 왔다 <b>' + Math.round(r.landed * 100) + '%</b>' +
                           ' · 이타카까지 ' + Math.round(r.remain * 100) + '% 남았다<br>' +
                           lostLine;
        } else {
          endH.textContent = '그리고 그는 잠들었다';
          endP.innerHTML = '아흐레를 깨어 있었다. 열흘째 새벽,<br>' +
                           '이타카의 모닥불이 보였다.<br>그리고 그는 잠들었다.';
          endF.textContent = '부하들은 자루 안에 금은보화가 있다고 믿었다.';
          /* 막대와 같은 것을 가리킨다 — 둘 다 '여기까지 왔다'.
             남은 거리는 그 뒤집힌 값으로 따로 적는다. */
          endS.innerHTML =
            '모닥불이 보인 곳 ' + Math.round(r.reached * 100) + '%' +
            '<br>되밀린 뒤 — 여기까지 왔다 <b>' + Math.round(r.landed * 100) + '%</b>' +
            ' · 이타카까지 ' + Math.round(r.remain * 100) + '% 남았다<br>' +
            (r.landed >= 0.25 ? '그래도 다시 갈 수 있는 거리다.'
                              : '처음으로 돌아갔다.') +
            '<br>' + lostLine;
        }
        end.className = 'end on';
      },
      dispose: function () { if (el.parentNode) el.parentNode.removeChild(el); }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 장면 (STAGE2.md §6)
     ════════════════════════════════════════════════════════════════════ */

  /* ── 저폴리 갤리선 선체 — 옆 윤곽을 뽑아내고 양 끝을 꼬집는다 ── */
  function hullGeo() {
    var sh = new T3.Shape();
    sh.moveTo(-4.10, 1.02);
    sh.lineTo(-4.62, 1.72);          // 말려 올라간 고물
    sh.lineTo(-4.16, 2.16);
    sh.lineTo(-3.62, 1.52);
    sh.lineTo(-3.50, 1.06);
    sh.lineTo( 3.86, 1.02);
    sh.lineTo( 4.62, 0.86);          // 이물
    sh.lineTo( 5.28, 0.30);          // 충각
    sh.lineTo( 4.30,-0.06);
    sh.lineTo( 3.10,-0.48);
    sh.lineTo(-2.70,-0.50);
    sh.lineTo(-3.90, 0.10);
    sh.closePath();

    var g = new T3.ExtrudeGeometry(sh, { depth: 2.34, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -1.17);
    /* 앞뒤로 갈수록 좁아지고(k), 아래로 갈수록 좁아진다(v) — V 자 선체 */
    var p = g.attributes.position, i, x, y, z, k, v;
    for (i = 0; i < p.count; i++) {
      x = p.getX(i); y = p.getY(i); z = p.getZ(i);
      k = clamp((x + 0.30) / 5.30, -1.2, 1.2);
      v = 0.42 + 0.58 * clamp((y + 0.55) / 1.45, 0, 1);
      p.setZ(i, z * (1 - 0.78 * Math.pow(Math.abs(k), 2.6)) * v);
    }
    g.computeVertexNormals();
    return g;
  }

  /* ── 노잡이 한 명 (앉아서 젓는다) ── */
  function rowerGeo() {
    var sph = new T3.SphereGeometry(0.5, 7, 5);
    var box = new T3.BoxGeometry(1, 1, 1);
    var p = [];
    p.push({ g: sph, m: M(0, 0.30, 0, 0.46, 0.52, 0.40), c: COL.tunic });
    p.push({ g: sph, m: M(0, 0.62, 0, 0.24, 0.26, 0.23), c: COL.skin });
    p.push({ g: box, m: M(0.20, 0.36, 0, 0.44, 0.11, 0.11, 0, 0, -0.35), c: COL.skin });
    var g = merge(p);
    sph.dispose(); box.dispose();
    return g;
  }

  /* ── 오디세우스 + 자루 ── */
  function buildKing(root) {
    var G = new T3.Group();
    var skin = new T3.MeshLambertMaterial({ color: COL.skin, flatShading: true });
    var robe = new T3.MeshLambertMaterial({ color: COL.king, flatShading: true });
    var sphG = new T3.SphereGeometry(0.5, 9, 7);
    var boxG = new T3.BoxGeometry(1, 1, 1);
    var cylG = new T3.CylinderGeometry(1, 1, 1, 9);

    function add(g, m, x, y, z, sx, sy, sz, rx, ry, rz) {
      var o = new T3.Mesh(g, m);
      o.position.set(x, y, z);
      o.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      G.add(o); return o;
    }
    var hairM = new T3.MeshLambertMaterial({ color: 0x3a2a1e, flatShading: true });
    add(boxG, robe, 0, 0.44, 0, 0.44, 0.90, 0.50);          // 다리·옷자락
    var torso = add(sphG, robe, 0, 1.16, 0, 0.94, 1.10, 0.80);
    add(sphG, skin, 0.05, 1.76, 0, 0.44, 0.48, 0.42);       // 머리
    add(sphG, hairM, -0.02, 1.92, -0.02, 0.46, 0.30, 0.44); // 머리칼
    add(sphG, hairM, -0.14, 1.66, 0, 0.30, 0.34, 0.36);     // 뒤통수·수염 그림자
    /* 팔 — 자루를 품에 안는다 */
    var armL = add(boxG, skin, 0.34, 1.18, 0.36, 0.62, 0.16, 0.16, 0, -0.55, 0.30);
    var armR = add(boxG, skin, 0.34, 0.94, 0.34, 0.62, 0.16, 0.16, 0, -0.40, 0.10);

    /* 자루 — 품에 안고 있다. 누르면 주둥이가 벌어진다. */
    var bag = new T3.Group();
    bag.position.set(0.46, 0.88, 0.62);
    G.add(bag);
    var bagMat = new T3.MeshLambertMaterial({ color: COL.bag, flatShading: true });
    var bagMat2 = new T3.MeshLambertMaterial({ color: COL.bagD, flatShading: true });
    var body = new T3.Mesh(sphG, bagMat);
    body.scale.set(1.16, 1.30, 1.10);
    bag.add(body);
    var neck = new T3.Mesh(cylG, bagMat2);
    neck.scale.set(0.22, 0.42, 0.22);
    neck.position.set(0.24, 0.66, 0);
    neck.rotation.z = -0.55;
    bag.add(neck);
    var mouth = new T3.Mesh(cylG, new T3.MeshBasicMaterial({ color: 0x14100a }));
    mouth.scale.set(0.20, 0.06, 0.20);
    mouth.position.set(0.44, 0.86, 0);
    mouth.rotation.z = -0.55;
    bag.add(mouth);

    root.add(G);
    return { grp: G, bag: bag, body: body, mouth: mouth, torso: torso,
             armL: armL, armR: armR,
             geos: [sphG, boxG, cylG],
             mats: [skin, robe, hairM, bagMat, bagMat2, mouth.material] };
  }

  /* ── 돛 — 실제로 부풀고 눕고 찢어진다 ── */
  function buildSail(root, W, H) {
    var seg = 9, segY = 7;
    var g = new T3.PlaneGeometry(W, H, seg, segY);
    /* 평면을 y-z 로 세운다: 폭 = z, 높이 = y, 부푸는 방향 = +x */
    g.rotateY(-Math.PI / 2);
    var mat = new T3.MeshLambertMaterial({
      color: COL.sail, emissive: 0x2a2318, flatShading: true, side: T3.DoubleSide
    });
    var mesh = new T3.Mesh(g, mat);
    mesh.frustumCulled = false;
    root.add(mesh);
    var base = g.attributes.position.array.slice(0);
    return { mesh: mesh, geo: g, mat: mat, base: base, W: W, H: H };
  }

  function shapeSail(S2, fill, t, rip, wob) {
    var g = S2.geo, p = g.attributes.position, base = S2.base, i;
    var W = S2.W, H = S2.H;
    var bulge = 0.35 + 1.55 * fill;
    for (i = 0; i < p.count; i++) {
      var by = base[i * 3 + 1], bz = base[i * 3 + 2];
      var u = clamp((bz + W * 0.5) / W, 0, 1);          // 0..1 폭
      var v = clamp((H * 0.5 - by) / H, 0, 1);          // 0 위 .. 1 아래
      var sway = Math.sin(Math.PI * u);
      var drop = Math.sin(Math.PI * clamp(v * 0.94 + 0.06, 0, 1));
      var x = bulge * sway * drop;
      /* 늘어졌을 때: 아래가 접히고 흔들린다 */
      var slackY = by + (1 - fill) * (v * v) * H * 0.22;
      var flut = (1 - fill) * 0.16 * Math.sin(t * 7.2 + u * 5.4 + v * 3.1) * v;
      x += flut + wob * 0.10 * Math.sin(t * 9.5 + u * 7.0);
      /* 눕힌 돛은 좌우로 오므라든다 — 부풀 때와 실루엣이 달라야 한다 */
      var z = bz * (0.74 + 0.26 * fill);
      if (rip > 0) {
        /* 가운데가 갈라진다 */
        var d = u - 0.54;
        var near = Math.exp(-(d * d) / 0.010);
        z += (d >= 0 ? 1 : -1) * near * rip * 0.62 * (0.35 + v);
        x += near * rip * 0.5 * Math.sin(t * 15 + v * 9) * (0.3 + v);
        slackY += near * rip * 0.30 * v;
      }
      p.setXYZ(i, x, slackY, z);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
  }

  /* ── 바다 · 하늘 ── */
  function buildSea(root, rnd, out) {
    function mat(m) { out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }

    var sea = new T3.Mesh(geo(new T3.PlaneGeometry(900, 620)),
                          mat(new T3.MeshLambertMaterial({ color: SKY[0].sea })));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(120, 0, 0);
    root.add(sea);

    /* 파도 띠 — 속도에 따라 빨라진다 */
    var bandG = geo(new T3.PlaneGeometry(1, 1));
    var bandM = mat(new T3.MeshBasicMaterial({ color: 0xa8cfe8, transparent: true,
                                               opacity: 0.085, depthWrite: false }));
    var N = 64;
    var bands = new T3.InstancedMesh(bandG, bandM, N);
    bands.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    bands.frustumCulled = false;
    root.add(bands);
    var info = [], i;
    for (i = 0; i < N; i++) {
      info.push({
        x: -60 + rnd() * 300,
        z: (rnd() * 2 - 1) * 46,
        w: 1.4 + rnd() * 3.2,
        d: 0.06 + rnd() * 0.11,
        ph: rnd() * 6.28,
        sp: 0.75 + rnd() * 0.6
      });
    }

    /* 큰 너울 — 다가오는 파도(2구간부터). 물 위로 솟은 마루라야 '다가온다'가 읽힌다. */
    var swell = new T3.Group();
    swell.position.set(40, 0, 0);
    root.add(swell);
    var swellM = mat(new T3.MeshBasicMaterial({ color: 0x7fb0d8, transparent: true,
                                                opacity: 0.0, depthWrite: false }));
    var ridge = new T3.Mesh(geo(new T3.BoxGeometry(1, 1, 1)), swellM);
    ridge.scale.set(2.6, 0.62, 62);
    ridge.position.y = 0.20;
    swell.add(ridge);
    var foamM = mat(new T3.MeshBasicMaterial({ color: 0xf2fbff, transparent: true,
                                               opacity: 0.0, depthWrite: false }));
    var foam = new T3.Mesh(geo(new T3.PlaneGeometry(1, 1)), foamM);
    foam.rotation.x = -Math.PI / 2;
    foam.scale.set(1.1, 62, 1);
    foam.position.set(-0.7, 0.53, 0);
    swell.add(foam);

    return { sea: sea, bands: bands, info: info,
             swell: swell, swellM: swellM, foamM: foamM };
  }

  /* 하늘·수평선의 것들은 안개를 받지 않는다 — 안 그러면 이타카가 하늘에 녹는다 */
  function buildSky(root, rnd, out) {
    function mat(m) { m.fog = false; out.mats.push(m); return m; }
    function geo(g) { out.geos.push(g); return g; }
    var G = new T3.Group();
    root.add(G);

    /* 수평선 빛 — 얇게. 바다와 하늘이 맞닿는 자리에만. */
    var hz = new T3.Mesh(geo(new T3.PlaneGeometry(900, 4.2)),
                         mat(new T3.MeshBasicMaterial({ color: SKY[0].hz, transparent: true,
                                                        opacity: 0.42, depthWrite: false })));
    hz.position.set(300, 1.6, -1);
    hz.rotation.y = -Math.PI / 2;
    G.add(hz);

    /* 해 */
    var sun = new T3.Mesh(geo(new T3.CircleGeometry(6.4, 24)),
                          mat(new T3.MeshBasicMaterial({ color: SKY[0].sun, transparent: true,
                                                         opacity: 0.82, depthWrite: false })));
    sun.position.set(298, 20, -40);
    sun.rotation.y = -Math.PI / 2;
    G.add(sun);

    /* 이타카 — 90% 에서 나타나는 섬과 모닥불.
       하늘 그룹(G)은 layout() 에서 시선 쪽으로 통째로 돌린다. 그래서
       가로·세로 어느 화면에서도 수평선 한가운데쯤에 뜬다.                 */
    var isle = new T3.Group();
    isle.position.set(205, 0, 0);
    isle.rotation.y = -Math.PI / 2;
    G.add(isle);
    var isleM = mat(new T3.MeshBasicMaterial({ color: COL.isle, transparent: true, opacity: 0 }));
    var triG = geo(new T3.CircleGeometry(1, 3));
    var peaks = [[-14, 0, 11, 7], [-2, 0, 15, 10], [12, 0, 9, 6], [22, 0, 6, 4]];
    for (var i = 0; i < peaks.length; i++) {
      var m = new T3.Mesh(triG, isleM);
      m.position.set(peaks[i][0], peaks[i][1], 0);
      m.scale.set(peaks[i][2], peaks[i][3], 1);
      m.rotation.z = Math.PI / 2;
      isle.add(m);
    }
    /* 모닥불 — 노을 하늘 위에서도 읽히도록 더하기 합성이 아니라 밝은 단색 */
    var fireM = mat(new T3.MeshBasicMaterial({ color: 0xfff0c4, transparent: true, opacity: 0,
                                               depthWrite: false }));
    var fire = new T3.Mesh(geo(new T3.CircleGeometry(1, 14)), fireM);
    fire.position.set(-2, 8.6, 0.5);
    fire.scale.setScalar(1.9);
    isle.add(fire);
    var glowM = mat(new T3.MeshBasicMaterial({ color: COL.fire, transparent: true, opacity: 0,
                                               blending: T3.AdditiveBlending, depthWrite: false }));
    var glow = new T3.Mesh(geo(new T3.CircleGeometry(1, 18)), glowM);
    glow.position.set(-2, 8.6, 0.2);
    glow.scale.setScalar(6.4);
    isle.add(glow);

    return { grp: G, hz: hz, sun: sun, isle: isle, isleM: isleM,
             fire: fire, fireM: fireM, glow: glow, glowM: glowM };
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

    var rnd = makeRng(opts.seed || 20260813);
    var world = new T3.Group();
    (root3 || opts.scene).add(world);

    var s = {
      world: world, ui: ui || null, opts: opts,
      scene: opts.scene || null,
      camera: opts.camera || null,
      renderer: opts.renderer || null,
      canvas: opts.canvas || (opts.renderer && opts.renderer.domElement) || null,
      selfRender: !!(opts.renderer && opts.scene && opts.camera),
      rnd: rnd, snd: makeAudio(makeRng(3313)),
      crew0: opts.crew == null ? C.CREW : opts.crew,
      g: null, phase: 'ready',
      wall: 0, shake: 0, rip: 0, ripT: 0, wob: 0, slump: 0,
      want: false, gotOne: false, sawFire: false, tickAt: 0,
      blink: 0, blinkT: 1.6, result: null,
      climaxT: 0, crewHold: null, warnAt: {},
      disposables: { geos: [], mats: [] }
    };
    s.g = newGame(opts.seed || 20260813, s.crew0);

    /* ── 조명 — 단색 플랫셰이딩이 살도록 최소한만.
       주광은 **카메라 쪽 위**에서 온다. 돛의 보이는 면(뒷면)이 밝아야
       부풀고 눕는 게 읽힌다. 앞쪽(해)에서는 테두리광만 넣는다.            */
    var amb = new T3.AmbientLight(SKY[0].amb, 2.15);
    var key = new T3.DirectionalLight(SKY[0].lit, 1.75);
    key.position.set(-34, 30, 26);
    var rim = new T3.DirectionalLight(0xffc48a, 0.85);
    rim.position.set(60, 14, -18);
    world.add(amb, key, rim);
    s.amb = amb; s.key = key;

    /* ── 바다 · 하늘 ── */
    s.sea = buildSea(world, rnd, s.disposables);
    s.sky = buildSky(world, rnd, s.disposables);

    /* ── 배 ── */
    var ship = new T3.Group();
    world.add(ship);
    s.ship = ship;

    var hull = hullGeo();
    s.disposables.geos.push(hull);
    var hullM = new T3.MeshLambertMaterial({ color: COL.hull, flatShading: true });
    s.disposables.mats.push(hullM);
    ship.add(new T3.Mesh(hull, hullM));

    var boxG = new T3.BoxGeometry(1, 1, 1);
    var cylG = new T3.CylinderGeometry(1, 1, 1, 10);
    var sphG = new T3.SphereGeometry(0.5, 10, 7);
    s.disposables.geos.push(boxG, cylG, sphG);
    var deckM = new T3.MeshLambertMaterial({ color: COL.deck, flatShading: true });
    var railM = new T3.MeshLambertMaterial({ color: COL.rail, flatShading: true });
    var mastM = new T3.MeshLambertMaterial({ color: COL.mast, flatShading: true });
    var oarM = new T3.MeshLambertMaterial({ color: COL.oar, flatShading: true });
    s.disposables.mats.push(deckM, railM, mastM, oarM);

    function put(parent, g, m, x, y, z, sx, sy, sz, rx, ry, rz) {
      var o = new T3.Mesh(g, m);
      o.position.set(x, y, z);
      o.scale.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
      o.rotation.set(rx || 0, ry || 0, rz || 0);
      parent.add(o); return o;
    }
    put(ship, boxG, deckM, 0.0, 1.00, 0, 6.5, 0.10, 1.62);          // 갑판
    put(ship, boxG, railM, 0.0, 1.12, 0.84, 6.6, 0.18, 0.12);       // 뱃전
    put(ship, boxG, railM, 0.0, 1.12, -0.84, 6.6, 0.18, 0.12);
    put(ship, cylG, mastM, 0.15, 4.30, 0, 0.15, 6.60, 0.15);        // 돛대
    var yard = put(ship, cylG, mastM, 0.15, 7.35, 0, 0.10, 5.60, 0.10, Math.PI / 2, 0, 0);
    s.yard = yard;

    /* 돛 */
    var sail = buildSail(ship, 5.30, 4.10);
    sail.mesh.position.set(0.15, 5.10, 0);
    s.sail = sail;
    s.disposables.geos.push(sail.geo);
    s.disposables.mats.push(sail.mat);

    /* 노 + 노잡이 */
    var rowG = rowerGeo();
    s.disposables.geos.push(rowG);
    var rowM = new T3.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    s.disposables.mats.push(rowM);
    s.rowers = new T3.InstancedMesh(rowG, rowM, 10);
    s.rowers.instanceMatrix.setUsage(T3.DynamicDrawUsage);
    s.rowers.frustumCulled = false;
    ship.add(s.rowers);

    /* 노 — 뱃전에서 물로 비스듬히 내려간다. 노깃이 실제로 수면에 닿아야
       젓는 것처럼 보인다(피벗 y=1.05, 길이 2.9, 기울기 0.36rad). */
    s.oars = [];
    var oi, side, xs = [-2.1, -1.05, 0.0, 1.05, 2.1];
    for (side = 0; side < 2; side++) {
      for (oi = 0; oi < xs.length; oi++) {
        var sgn = side ? 1 : -1;
        var piv = new T3.Group();
        piv.position.set(xs[oi], 1.05, sgn * 0.86);
        piv.rotation.x = 0.24 * sgn;
        ship.add(piv);
        put(piv, boxG, oarM, 0, 0, sgn * 1.30, 0.10, 0.10, 2.60);
        put(piv, boxG, oarM, 0, 0, sgn * 2.58, 0.09, 0.28, 0.66);
        s.oars.push({ p: piv, side: sgn, base: 0.24 * sgn, ph: oi * 0.34 });
      }
    }

    /* 오디세우스 + 자루 */
    s.king = buildKing(ship);
    s.king.grp.position.set(-2.90, 1.00, -0.18);
    s.king.grp.rotation.y = 0.55;
    s.disposables.geos = s.disposables.geos.concat(s.king.geos);
    s.disposables.mats = s.disposables.mats.concat(s.king.mats);

    /* 자루에서 돛으로 흐르는 바람 줄기 — 짧고 옅게. 갇힌 바람이 새는 것뿐이다. */
    var streakM = new T3.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0,
                                             depthWrite: false, blending: T3.AdditiveBlending });
    s.disposables.mats.push(streakM);
    s.streaks = [];
    for (var q = 0; q < 5; q++) {
      var st = put(ship, boxG, streakM, -1.5, 3.4, 0, 1.2, 0.04, 0.04);
      st.userData.ph = rnd();
      st.userData.y = 2.1 + q * 0.72;
      st.userData.z = (rnd() * 2 - 1) * 1.1;
      s.streaks.push(st);
    }

    /* 항적 — 고물 뒤로 옅게 흩어진다 */
    var wakeM = new T3.MeshBasicMaterial({ color: COL.wake, transparent: true, opacity: 0.0,
                                           depthWrite: false });
    s.disposables.mats.push(wakeM);
    s.wake = [];
    for (var wi = 0; wi < 4; wi++) {
      var wq = new T3.Mesh(new T3.PlaneGeometry(1, 1), wakeM);
      wq.rotation.x = -Math.PI / 2;
      wq.position.set(-6.4 - wi * 2.3, 0.05, (wi % 2 ? 1 : -1) * (0.9 + wi * 0.22));
      wq.scale.set(2.4, 0.30, 1);
      wq.userData.k = 1 - wi * 0.22;
      world.add(wq);
      s.disposables.geos.push(wq.geometry);
      s.wake.push(wq);
    }

    /* ── HUD ── */
    var host = opts.hudHost ||
               (s.canvas && s.canvas.parentNode) ||
               document.getElementById('ui-root') || document.body;
    if (host === document.body && host.style && !host.style.position) host.style.position = 'relative';
    s.hud = makeHud(host, s.crew0);
    s.hud.onRestart(function () { reset(); start(); });

    if (opts.bindInput !== false) bindInput(s);

    s.dummy = new T3.Object3D();
    s.cA = new T3.Color(); s.cB = new T3.Color();
    S = s;
    layout(s);
    frame(s, 0);
    return api;
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
     9. 카메라 — 배를 뒤 옆에서. 세로 화면도 함께.
     ════════════════════════════════════════════════════════════════════ */
  /* 가로: 배를 뒤 옆에서 비스듬히. 세로: 뱃길을 따라 뒤에서 —
     세로 화면에서는 배를 옆으로 담을 수 없다. 축 방향으로 봐야 들어간다. */
  var CAM = {
    L: { fov: 42, pos: [-13.5, 7.0, 13.0], look: [0.6, 3.1, 0.0] },
    P: { fov: 60, pos: [-14.2, 6.6, 5.6],  look: [1.0, 3.5, -0.3] }
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
    cam.near = 0.5; cam.far = 900;
    cam.position.set(k.pos[0], k.pos[1], k.pos[2]);
    cam.lookAt(k.look[0], k.look[1], k.look[2]);
    cam.updateProjectionMatrix();
    s.camBase = cam.position.clone();
    s.camLook = new T3.Vector3(k.look[0], k.look[1], k.look[2]);

    /* 해·수평선·이타카를 시선 쪽으로 돌려 놓는다 — 배의 뱃머리 방향이 아니라
       **화면 안**에 있어야 모닥불이 보이는 순간이 성립한다. 화면 중앙에서
       살짝 오른쪽(뱃머리 쪽)에 오도록 0.30rad 만큼 비켜 둔다.             */
    if (s.sky) {
      var az = Math.atan2(k.look[2] - k.pos[2], k.look[0] - k.pos[0]);
      s.sky.grp.rotation.y = -(az + 0.21);
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
  /* 같은 경고를 쉬지 않고 다시 띄우지 않는다. 누르는 손이 답답해서 연타하면
     '자루가 비었다' 배너가 화면에 눌어붙어 절정을 통째로 먹는다 — 그 자리다.
     자루가 빈 사실은 어차피 자루 게이지가 붉게 계속 말하고 있다.            */
  function warn(s, key, txt, col, why) {
    var at = s.warnAt || (s.warnAt = {});
    if (at[key] != null && s.wall - at[key] < 3.2) return;
    at[key] = s.wall;
    s.hud.flash(txt, col, why, { prio: 2 });
  }

  function press(down) {
    var s = S;
    if (!s) return 'none';
    s.snd.resume();
    if (down === undefined) down = !s.want;
    if (s.phase === 'ready') { start(); if (!down) return 'start'; }
    if (s.phase !== 'run') return 'idle';
    s.want = !!down;
    /* ★ 경고는 **본편 바다에서만**. 졸음이 시작된 뒤로는 화면에 뜰 수 있는 말이
       절정 문구뿐이다 — 잠드는 문장을 가로막던 붉은 배너가 여기서 끊긴다. */
    if (down && s.g.phase === 'run') {
      if (s.g.bag <= 0) warn(s, 'bag', '자루가 비었다', '#e2705f', '바람이 남지 않았다');
      else if (s.g.fix > 0) warn(s, 'fix', '돛을 꿰매는 중', '#e2b25f', '조금만 기다린다');
      else if (!s.gotOne) s.hud.hint(false);
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
      var before = g.prog;
      advance(g, dt, s.want);
      digest(s, g, before, dt);
      if (g.phase === 'over' && !s.result) finish(s);
    }
    frame(s, dt);
    if (s.selfRender && !quiet) s.renderer.render(s.scene, s.camera);
  }

  /* ── 규칙이 낸 사건을 화면·소리로 옮긴다 (STAGE2.md §7) ── */
  function digest(s, g, before, dt) {
    var e = g.evt; g.evt = '';
    var e2 = g.evt2; g.evt2 = '';

    if (e === 'press') { s.snd.open(); s.wob = 0.5; }
    else if (e === 'tear') {
      s.snd.rip();
      s.shake = 1; s.rip = 1; s.ripT = 0;
      s.hud.ghost(before);
      /* 사람이 죽었으면 화면이 말한다 — 6편까지 가는 자원이 조용히 새면 안 된다 */
      s.hud.flash('돛이 찢어졌다 · 부하 ' + C.TEAR_CREW + '명을 잃었다', '#ff6a45',
                  '붉은 구간에서 너무 오래 버텼다 — 활대에 쓸려 나갔다',
                  { prio: 3 });
      s.hud.crew(g.crew);
      s.hud.crewHit();
    } else if (e === 'rel:tap') {
      /* 쌓은 게 없다 — 아무 일도 없었다. 연타에 반응하지 않는다. */
    } else if (e.indexOf('rel:') === 0) {
      var k = e.slice(4);
      s.wob = 1;
      if (k === 'gold') {
        s.snd.good();
        s.hud.flash('좋다', '#ffd98c');
        s.gotOne = true; s.hud.hint(false);
      } else if (k === 'flap') {
        s.snd.flap();
        s.hud.flash('펄럭였다', '#ff9a6a', '한계를 넘겨 힘을 잃었다');
      } else if (k === 'near') {
        s.snd.soft();
        s.hud.flash('조금 모자랐다', '#9fc6e8', '금색 띠 직전이었다');
      } else {
        s.snd.soft();
        /* 금색 띠를 한 번도 못 맞혔으면 계속 말해 준다. 한 번 맞히면 침묵. */
        if (g.golds === 0 && g.cycles <= 8)
          s.hud.flash('너무 일찍 놓았다', '#8fa6bd', '더 참으면 더 나아간다');
      }
    }

    if (e2 === 'wave') { s.snd.wave(); }
    else if (e2 === 'seg') {
      s.hud.flash(g.seg === 1 ? '바다가 거칠어진다' : '이타카 근해다', '#9fd8e8',
                  '위험대가 넓어졌다');
    } else if (e2 === 'fire') {
      s.snd.fire();
      /* ★ 졸음 구간에 들어서는 순간 — 떠 있던 배너를 **통째로 지운다.**
         '자루가 비었다' 가 여기서 살아남아 잠드는 문장을 관통했다.
         그리고 여기서부터 규칙이 바뀌었다는 걸 말로 못 박는다.            */
      s.hud.flash('');
      s.hud.flash('이타카의 모닥불이다', '#ffb35a',
                  '눈이 감긴다 — 돛은 이제 찢어지지 않는다. 누르고 버텨라',
                  { prio: 4, dur: 2.2 });
      s.sawFire = true;
    } else if (e2 === 'sleep') {
      s.snd.sleep();
      s.hud.flash('');
    } else if (e2 === 'burst') {
      /* 소리와 흔들림은 지금(자루가 터지는 순간). 문구는 잠드는 문장이 다
         걷힌 뒤에 — 아래 CLIMAX 블록에서. 둘을 겹쳐 그리면 둘 다 안 읽힌다. */
      s.snd.burstOut();
      s.shake = 1.4;
      s.climaxT = C.CLIMAX_AT;
      s.crewHold = g.crew + g.swept;    // 숫자는 문구가 뜰 때 함께 떨어진다
    }

    /* ★ 되밀림 절정 — 최우선 순위(9). 아무 토스트도 이걸 밀어내지 못하고,
       되밀리는 내내 떠 있다. 그동안 부하 숫자가 눈앞에서 떨어진다.       */
    if (s.climaxT > 0) {
      s.climaxT -= dt;
      if (s.climaxT <= 0) {
        s.climaxT = 0;
        s.hud.flash('부하들이 자루를 열었다', '#9fd8e8',
                    '갇혀 있던 바람이 전부 터져 나왔다 · 부하 ' + g.swept + '명이 쓸려 나갔다',
                    { prio: 9, dur: C.PUSH_T, low: true });
        s.crewHold = null;
        s.hud.crew(g.crew);
        s.hud.crewHit();
      }
    }

    /* 금색 띠 안에 있는 동안의 똑딱 소리 — "지금" 을 글자 없이 가르친다 */
    var lo = g.danger - g.gold;
    if (g.holding && g.load >= lo && g.load < g.danger) {
      s.tickAt -= dt;
      if (s.tickAt <= 0) { s.tickAt = 0.085; s.snd.tick((g.load - lo) / Math.max(0.01, g.gold)); }
    } else s.tickAt = 0;

    /* 바람 · 돛 떨림 */
    var over = g.load >= g.danger ? clamp((g.load - g.danger) / 0.25, 0, 1) : 0;
    s.snd.wind(g.fill, over);
  }

  function finish(s) {
    var r = resultOf(s.g);
    s.result = r;
    s.phase = 'over';
    s.want = false;
    s.snd.wind(0, 0);
    s.hud.hint(false);
    s.hud.drowse(false, 0, false);
    /* ★ 결과 카드 위에 배너가 남지 않게 — 카드가 뜨는 순간 화면을 비운다.
       (.st2 는 z-index:5 라, 지우지 않으면 카드를 뚫고 그 위에 남는다.) */
    s.climaxT = 0; s.crewHold = null;
    s.hud.flash('');
    s.hud.crew(s.g.crew);
    /* 위 막대가 선 자리를 그 옆에 글자로 못 박는다 — 막대와 숫자가 같은 말을 한다 */
    s.hud.done(r.landed);
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
    dt = dt || 0.016;
    var g = s.g, t = s.wall;

    /* ── 게이지 (규칙 그 자체) ── */
    s.hud.gauge(g, g.prog >= C.FIRE_AT);
    /* 부하 수 — 자루가 터질 때는 **절정 문구가 뜨는 순간에** 함께 떨어진다.
       숫자만 조용히 바뀌고 지나가면 사람이 죽은 걸 아무도 못 본다. */
    s.hud.crew(s.crewHold == null ? g.crew : s.crewHold);
    s.hud.doze(g.phase === 'drowse' ? g.drowse : (g.phase === 'run' ? 0 : 1),
               dozeLid(s, g, dt));
    /* ★ 졸음 — 요구와 수치를 띄운다. 잠든 뒤엔 문장이 검은 화면을 채운다. */
    s.hud.drowse(g.phase === 'drowse' && s.phase === 'run', g.drowse, g.gripping);
    s.hud.slept(g.phase === 'sleep' ? clamp((g.sleepT - 0.30) / 0.55, 0, 1) : 0);
    /* ★ 졸음부터는 돛의 규칙이 없다 — 그러니 돛 게이지도 물러난다.
       규칙이 죽은 게이지를 계속 그려 두면 그것도 거짓말이다. */
    s.hud.rules(g.phase === 'run');
    /* ★ 절정 구간의 문(門) — 우선순위 4 미만의 잡소리는 여기서 끊긴다.
       '자루가 비었다' 붉은 배너가 잠드는 문장을 관통하던 자리다. */
    if (g.phase !== 'run') s.hud.hush(4);

    /* ── 하늘·바다 색 (구간마다 새벽→낮→노을) ── */
    var i0, i1, u;
    if (g.prog < 0.34) { i0 = 0; i1 = 0; u = 0; }
    else if (g.prog < 0.42) { i0 = 0; i1 = 1; u = (g.prog - 0.34) / 0.08; }
    else if (g.prog < 0.68) { i0 = 1; i1 = 1; u = 0; }
    else if (g.prog < 0.76) { i0 = 1; i1 = 2; u = (g.prog - 0.68) / 0.08; }
    else { i0 = 2; i1 = 2; u = 0; }
    u = smooth(u);
    var CA = s.cA, CB = s.cB;                 // 매 프레임 Color 를 새로 만들지 않는다
    var mix = function (key) {
      CA.setHex(SKY[i0][key]); CB.setHex(SKY[i1][key]);
      return CA.lerp(CB, u);
    };
    var cSky = mix('sky');
    if (s.scene) {
      if (!s.scene.background || !s.scene.background.isColor) s.scene.background = new T3.Color();
      s.scene.background.copy(cSky);
      if (s.scene.fog) s.scene.fog.color.copy(cSky);
    }
    s.sea.sea.material.color.copy(mix('sea'));
    s.sky.hz.material.color.copy(mix('hz'));
    s.sky.sun.material.color.copy(mix('sun'));
    s.amb.color.copy(mix('amb'));
    s.key.color.copy(mix('lit'));
    /* 해가 뜨고 진다 = 열흘이 흐른다 */
    var sunU = clamp(g.prog, 0, 1);
    s.sky.sun.position.set(298, 4.5 + Math.sin(sunU * Math.PI) * 27, -62 + sunU * 108);

    /* ── 이타카 ── */
    var fv = clamp((g.prog - C.FIRE_AT) / 0.030, 0, 1);
    s.sky.isleM.opacity = fv * 0.9;
    var pulse = 0.72 + 0.28 * Math.sin(t * 4.1);
    s.sky.fireM.opacity = fv * pulse;
    s.sky.glowM.opacity = fv * 0.34 * pulse;
    s.sky.glow.scale.setScalar(4.4 + Math.sin(t * 3.3) * 0.5);
    var near = clamp((g.prog - C.FIRE_AT) / 0.12, 0, 1);
    s.sky.isle.scale.setScalar(1 + near * 0.55);

    /* ── 돛 ── */
    if (s.rip > 0) {
      s.ripT += dt;
      s.rip = Math.max(0, 1 - s.ripT / (C.TEAR_FIX + 0.25));
    }
    s.wob = Math.max(0, s.wob - dt * 2.2);
    /* 붉은 구간에서는 돛이 눈에 띄게 떤다 — 소리보다 이게 먼저 보인다 */
    var strain = g.load >= g.danger ? clamp((g.load - g.danger) / 0.20, 0, 1) : 0;
    shapeSail(s.sail, g.fill, t, s.rip, s.wob + strain * 1.5);
    s.sail.mat.color.setHex(g.fill > 0.5 ? COL.sail : COL.sailD);
    /* 활대가 바람에 눌린다 */
    s.yard.rotation.z = Math.PI / 2 * 0 + 0;
    s.yard.position.x = 0.15 + g.fill * 0.22;

    /* ── 되밀림 — 바다가 거꾸로 흐르고 배가 떠밀린다 ── */
    var pu = g.phase === 'push' ? clamp(g.pushT / C.PUSH_T, 0, 1) : -1;
    var back = pu >= 0 ? (1 - pu * pu) : 0;

    /* ── 배 — 부하가 클수록 기운다 ── */
    var heel = -(0.03 + 0.16 * g.load * g.fill) - back * 0.22 * Math.sin(t * 2.1);
    var pitch = Math.sin(t * 1.35) * 0.022 + g.rock * Math.sin(t * 12) * 0.05
                - back * 0.10;
    s.ship.rotation.set(pitch, back * 0.20 * Math.sin(t * 1.4), heel + Math.sin(t * 0.9) * 0.012);
    s.ship.position.y = Math.sin(t * 1.1) * 0.07 + g.rock * 0.14 + back * 0.22;

    /* ── 자루 — 누르면 주둥이가 벌어진다. 잔량만큼 쪼그라든다.
           되밀릴 때는 부하들이 활짝 열어젖힌 채다. ── */
    var open = (g.holding || back > 0) ? 1 : 0;
    s.bagOpen = s.bagOpen == null ? 0 : ease(s.bagOpen, open, dt, 0.10);
    var bagS = (0.55 + 0.45 * clamp(g.bag, 0, 1)) * (pu >= 0 ? (1 - 0.55 * pu) : 1);
    s.king.bag.scale.set(bagS, bagS, bagS);
    s.king.mouth.scale.set(0.20 + s.bagOpen * 0.34, 0.06 + s.bagOpen * 0.14,
                           0.20 + s.bagOpen * 0.34);
    s.king.bag.rotation.z = -s.bagOpen * 0.30 + Math.sin(t * 1.6) * 0.03;
    /* ★ 잠든다 — 오디세우스가 키를 놓고 무너진다. 자루가 품에서 흘러내린다.
       되밀리는 3초 동안 눈꺼풀이 걷힌 화면에 이 모습이 그대로 남는다. */
    var down = (g.phase === 'sleep' || g.phase === 'push' ||
                (g.phase === 'over' && g.slept)) ? 1 : 0;
    s.slump = ease(s.slump == null ? 0 : s.slump, down, dt, 0.34);
    var sl = s.slump;
    s.king.grp.rotation.x = sl * 1.02;
    s.king.grp.rotation.z = -s.bagOpen * 0.06 - sl * 0.34;
    s.king.grp.position.y = 1.00 - sl * 0.44;
    s.king.bag.position.set(0.46 + sl * 0.34, 0.88 - sl * 0.62, 0.62 + sl * 0.18);
    /* 자루를 여는 동안 몸을 젖히고 팔로 안는다. 잠들면 팔이 풀린다. */
    s.king.torso.rotation.z = -s.bagOpen * 0.12 - sl * 0.26;
    s.king.armL.rotation.z = 0.30 + s.bagOpen * 0.26 - sl * 0.62;
    s.king.armR.rotation.z = 0.10 + s.bagOpen * 0.20 - sl * 0.50;
    /* 바람 줄기 — 자루에서 돛으로. 터져 나올 때는 고물 쪽으로 쏟아진다. */
    for (var q = 0; q < s.streaks.length; q++) {
      var st = s.streaks[q];
      var ph = (t * (0.55 + g.fill * 0.75 + back * 3.2) + st.userData.ph) % 1;
      st.position.set(back > 0 ? (-2.4 - ph * 7.0) : (-2.5 + ph * 3.0),
                      st.userData.y + Math.sin(t * 2 + q) * 0.08 + back * ph * 1.6,
                      st.userData.z * (1 + back * ph * 2.2));
      st.scale.set(0.8 + g.fill * 0.9 + back * 1.6, 0.04, 0.04);
    }
    s.streaks[0].material.opacity = back > 0 ? (0.55 * back)
                                             : (0.05 + 0.26 * s.bagOpen * g.fill);

    /* ── 노 · 노잡이 ── */
    var spd = C.V0 + C.V1 * g.fill;
    var rate = 1.15 + spd * 190;
    s.rowPh = (s.rowPh || 0) + dt * rate;
    var dm = s.dummy, ri;
    for (ri = 0; ri < s.oars.length; ri++) {
      var o = s.oars[ri];
      var a = Math.sin(s.rowPh * 2 + o.ph);
      var lift = Math.cos(s.rowPh * 2 + o.ph);
      o.p.rotation.y = a * 0.26 * o.side;
      /* 물에서 밀 때는 잠기고, 되돌릴 때만 살짝 들린다 */
      o.p.rotation.x = o.base - (lift > 0 ? lift * 0.20 : 0) * o.side;
    }
    for (ri = 0; ri < 10; ri++) {
      var side = ri < 5 ? -1 : 1;
      var idx = ri % 5;
      var lean = Math.sin(s.rowPh * 2 + idx * 0.34) * 0.30;
      dm.position.set(-2.1 + idx * 1.05 - lean * 0.22, 1.10, side * 0.50);
      dm.rotation.set(0, side > 0 ? -1.57 : 1.57, lean * 0.5);
      dm.scale.setScalar(0.90);
      dm.updateMatrix();
      s.rowers.setMatrixAt(ri, dm.matrix);
    }
    s.rowers.instanceMatrix.needsUpdate = true;

    /* ── 바다 — 속도에 따라 빨라진다. 되밀릴 때는 거꾸로, 아주 빠르게. ── */
    var scroll = back > 0 ? (-16 - 96 * back) : (6 + spd * 2600);
    s.scroll = (s.scroll || 0) + dt * scroll;
    var B = s.sea, info = B.info;
    for (ri = 0; ri < info.length; ri++) {
      var w = info[ri];
      /* 앞으로도 뒤로도 흘러야 하므로 양쪽으로 감기게 접는다 */
      var x = ((w.x - s.scroll * w.sp + 80) % 340 + 340) % 340 - 80;
      dm.position.set(x, 0.04, w.z + Math.sin(t * 0.7 + w.ph) * 0.6);
      dm.rotation.set(-Math.PI / 2, 0, 0);
      dm.scale.set(w.w, w.d, 1);
      dm.updateMatrix();
      B.bands.setMatrixAt(ri, dm.matrix);
    }
    B.bands.instanceMatrix.needsUpdate = true;

    /* 다가오는 너울 — 부딪히기 1.9초 전부터 보인다 */
    if (g.waveIn < C.WAVE_LEAD * 1.6 && g.waveAmp > 0) {
      var wu = clamp(1 - g.waveIn / (C.WAVE_LEAD * 1.6), 0, 1);
      B.swell.position.x = lerp(52, 4.2, wu * wu);
      B.swell.scale.set(1, 0.55 + 0.85 * wu, 1);
      B.swellM.opacity = 0.28 + 0.42 * wu;
      B.foamM.opacity = 0.20 + 0.55 * wu;
    } else {
      B.swellM.opacity = Math.max(0, B.swellM.opacity - dt * 2.4);
      B.foamM.opacity = Math.max(0, B.foamM.opacity - dt * 2.4);
    }

    /* 항적 */
    s.wake[0].material.opacity = 0.03 + 0.13 * g.fill;
    for (ri = 0; ri < s.wake.length; ri++) {
      var wk = s.wake[ri].userData.k;
      s.wake[ri].scale.set((1.6 + g.fill * 2.6) * wk, (0.20 + g.fill * 0.22) * wk, 1);
    }

    /* ── 화면 흔들림 ── */
    if (s.camera && s.camBase) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt * 2.2);
        var m = s.shake * s.shake * 0.55;
        s.camera.position.set(
          s.camBase.x + (s.rnd() * 2 - 1) * m,
          s.camBase.y + (s.rnd() * 2 - 1) * m,
          s.camBase.z + (s.rnd() * 2 - 1) * m * 0.6);
        s.camera.lookAt(s.camLook);
      } else if (s.camDirty !== false) {
        s.camera.position.copy(s.camBase);
        s.camera.lookAt(s.camLook);
      }
    }
  }

  /* 졸음 — 눈꺼풀이 내려왔다 번쩍 뜬다. 그러다 끝내 감긴다. */
  function dozeLid(s, g, dt) {
    if (g.phase === 'run') { s.blink = 0; s.blinkT = 1.6; return 0; }
    /* 눈꺼풀이 조금 천천히 감긴다 — 무너지는 모습이 보일 틈을 준다 */
    if (g.phase === 'sleep') return clamp(g.sleepT / 1.15, 0, 1);
    if (g.phase === 'push' || g.phase === 'over') return 0;
    s.blinkT -= dt;
    if (s.blinkT <= 0) { s.blinkT = lerp(2.4, 0.9, g.drowse); s.blink = 1; }
    s.blink = Math.max(0, s.blink - dt * 1.5);
    /* 눈꺼풀이 곧 졸음 게이지다 — 얼마나 남았는지가 눈 감김으로 보인다 */
    return clamp(g.drowse * 0.58 + s.blink * (0.22 + 0.36 * g.drowse), 0, 0.96);
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
    s.g = newGame(s.opts.seed || 20260813, s.crew0);
    s.want = false; s.result = null; s.shake = 0; s.rip = 0; s.ripT = 0;
    s.wob = 0; s.gotOne = false; s.sawFire = false; s.bagOpen = 0; s.slump = 0;
    s.blink = 0; s.blinkT = 1.6; s.scroll = 0; s.rowPh = 0;
    s.climaxT = 0; s.crewHold = null; s.warnAt = {};
    s.hud.end(null); s.hud.flash(''); s.hud.hint(false); s.hud.crew(s.crew0);
    s.hud.drowse(false, 0, false); s.hud.slept(0); s.hud.done(null); s.hud.rules(true);
    s.phase = 'ready';
    frame(s, 0);
  }

  function dispose() {
    var s = S;
    if (!s) return;
    try {
      if (s.onKey) window.removeEventListener('keydown', s.onKey, false);
      if (s.onKeyUp) window.removeEventListener('keyup', s.onKeyUp, false);
      if (s.onUp) { window.removeEventListener('pointerup', s.onUp, false);
                    window.removeEventListener('pointercancel', s.onUp, false); }
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

    /* THREE 루트를 주면 1편처럼 씬 안에 붙기만 한다 */
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
    scene.background = new T3.Color(SKY[0].sky);
    scene.fog = new T3.Fog(SKY[0].sky, 90, 460);
    var camera = new T3.PerspectiveCamera(46, 1, 0.5, 900);
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
     15. 디버그 스냅샷
     ════════════════════════════════════════════════════════════════════ */
  function state() {
    var s = S;
    if (!s) return { ready: false };
    var g = s.g;
    var lo = g.danger - g.gold;
    return {
      ready: true, phase: s.phase, gphase: g.phase,
      t: +g.t.toFixed(2),
      prog: +g.prog.toFixed(4), load: +g.load.toFixed(3), bag: +g.bag.toFixed(3),
      fill: +g.fill.toFixed(3),
      seg: g.seg, danger: +g.danger.toFixed(3), gold: +g.gold.toFixed(3),
      up: +g.up.toFixed(3),
      band: [+lo.toFixed(3), +g.danger.toFixed(3)],
      inGold: g.load >= lo && g.load < g.danger,
      inRed: g.load >= g.danger,
      mult: +multOf(g.load, g.danger, g.gold).toFixed(2),
      kind: kindOf(g.load, g.danger, g.gold),
      holding: g.holding, want: s.want, blocked: g.blocked,
      fix: +g.fix.toFixed(2), waveIn: +g.waveIn.toFixed(2),
      waveAmp: +g.waveAmp.toFixed(3),
      tears: g.tears, golds: g.golds, cycles: g.cycles, flaps: g.flaps,
      crew: g.crew, drowse: +g.drowse.toFixed(3), gripping: g.gripping,
      sleepT: +g.sleepT.toFixed(2), pushT: +g.pushT.toFixed(2),
      reached: +g.reached.toFixed(3),
      landed: +g.landed.toFixed(3), remain: +g.remain.toFixed(3),
      swept: g.swept,
      result: s.result || null
    };
  }

  /* 세계를 원하는 시각까지 조용히 민다 (스크린샷용) */
  function skipTo(sec, hold) {
    var s = S;
    if (!s) return null;
    if (s.phase === 'ready') start();
    var n = 0;
    while (s.g.t < sec && n++ < 30000) {
      s.want = typeof hold === 'function' ? !!hold(s.g) : !!hold;
      update(0.02, true);
    }
    s.want = false;
    update(0, false);
    return state();
  }

  /* 자동 플레이 — simulate() 와 같은 봇을, 실제 입력 경로로 돌린다.
     둘의 결과가 어긋나면 화면과 규칙이 어긋났다는 뜻이다. */
  function auto(policy, maxSec, quiet, opts) {
    var s = S;
    if (!s) return null;
    reset(); start();
    var bot = makeBot({ policy: policy, seed: s.opts.seed || 20260813,
                        jit: opts && opts.jit, lat: opts && opts.lat,
                        drowse: opts && opts.drowse });
    var dt = 1 / 60, n = Math.round((maxSec || 300) / dt), i;
    for (i = 0; i < n && s.phase === 'run'; i++) {
      s.want = bot(s.g);
      update(dt, quiet !== false);
    }
    s.want = false;
    update(0, false);
    var st = state();
    st.result = s.result;
    return st;
  }

  /* 이 판에 걸린 부하 수를 갈아 끼운다 — 1편에서 잃은 부하가 그대로 이어져 와야
     하는데, 그 수는 mount 시점이 아니라 **판에 들어설 때** 정해진다.
     다음 reset() 이 이 값으로 판을 새로 만든다. */
  function setCrew(n) {
    var s = S;
    if (!s) return null;
    if (typeof n === 'number' && isFinite(n)) {
      s.crew0 = Math.max(0, Math.round(n));
      s.opts.crew = s.crew0;
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
    onEnd: null,
    CFG: C,
    get phase() { return S ? S.phase : 'none'; }
  };
  return api;
})();
