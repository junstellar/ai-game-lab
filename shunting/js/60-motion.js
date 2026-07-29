/* ============================================================================
   조차장 / SHUNTING — 60-motion.js
   열차의 물리적 움직임.  대차 단위 배치 · 유격(slack) 파동 · 서스펜션 · 연결 충격.
   → SH.Motion
   ============================================================================

   /* CONTRACT */
   /*
     SH.Motion — 공개 API (SPEC.md §6 Motion)

       Motion.init(world)                 // World.build() 결과를 받아 런타임 레코드 구성
       Motion.snap(state)                 // 애니메이션 없이 즉시 정확 배치 (레벨 로드 / __SHOT)
       Motion.execute(state, move, done)  // 이동 1회를 애니메이션. 정지하면 done() 1회 호출
       Motion.update(dt)                  // 매 프레임 (Game 이 호출). dt 초 단위
       Motion.isBusy   -> bool            // getter
       Motion.speed    -> number          // 현재 속도의 크기 (m/s). Audio.roll / FX 용
       Motion.velocity -> number          // 부호 있는 동쪽 방향 속도 (서쪽이면 음수)
       Motion.setSpeedScale(x)            // 재생 배속 (1 = 기본, 3 = 빨리감기). __SHOT 용
       Motion.speedScale -> number        // getter
       Motion.cancel()                    // 진행 중 이동을 즉시 종료(최종 위치로 스냅 + done 호출)
       Motion.poseOf(vehKey) -> {track,s} // 현재 논리 위치 (Input/UI 가 참고 가능). null 가능
       Motion.LOCO     -> '@loco'         // 기관차의 내부 키

     move 는 { type:'go', track:'S2' } / { type:'cut', k:2 } 또는 트랙 id 문자열.
     state 는 이동 '전' 또는 '후' 어느 쪽이 와도 된다 (내부 lastState 로 판별).
     done() 은 정확히 1회만 호출된다 (예외가 나도 보장).

     ── 배치 규칙 (다른 모듈이 위치를 예측해야 할 때) ──
       트랙마다 동쪽(버퍼) 끝부터 채운다. 최동단 차량의 동쪽 끝면은 s = length − 0.5,
       차체 끝면 사이 간격은 1.0 → 화차끼리 피치 13.0, 기관차–화차 14.0.
       at 트랙의 물리 배열은 [LOCO, ...consist, ...tracks[at]] (서→동).
       연결기 유격 ±0.125 (총 0.25) 범위에서만 이 간격이 변한다.

     ── 총 소요시간 ──
       고정 0.86s(준비·정지·분기기·히트스톱·정차) + 주행 1.35~2.55s = 2.2 ~ 3.4s.
       prefers-reduced-motion 이면 ×0.6, 흔들림/셰이크/히트스톱 없음.

     ── 다른 모듈에 대한 기대 (없으면 조용히 무시하고 계속 동작) ──
       SH.World.point(trackId, s) -> { pos:Vector3, tan:Vector3 }
       SH.World.railPath(from, to) -> { segs:[{track,from,to}], total }
       world.tracks   : Map<id,{ id, capacity, curve, length, group }>  (평범한 객체도 허용)
       world.vehicles : Map<id,{ id, type, livery, group, rig, len }>
       world.loco     : 같은 모양
       rig = { bogies:[o,o], wheels:[o…], bodyPivot:o, buffers:{w,e}, couplers:{w,e},
               length:Number, exhaust:o|null, lights:[o] }
       SH.Audio.play/engine/roll · SH.FX.impact/dust/exhaust · SH.Render.shake

     ── Geo 에게 주는 선택적 훅 (있으면 쓰고, 없으면 기본값) ──
       wheel.userData.spinAxis : 'x'|'y'|'z'   (기본 'x' — SPEC §6 "wheels spin about local X")
       wheel.userData.spinSign : ±1            (좌우 대칭 휠 미러링용, 기본 +1)
       turnout blades: userData.setThrow(t01) 함수 / userData.throwY(라디안) / 기본 0.020rad
       world.turnouts : Map|Object<trackId, group|{blades}>  (있으면 분기기 탐색이 정확해짐)
   */

(function () {
  'use strict';

  var SH = (window.SH = window.SH || {});
  var U = SH.U;
  var PI = Math.PI, TAU = PI * 2;

  /* ── 물리/연출 상수 ──────────────────────────────────────────── */
  var LOCO_KEY    = '@loco';
  var WHEEL_R     = 0.48;      // SPEC §5
  var BOGIE_OFF   = 4.2;       // 대차 중심 오프셋 (rig 에서 실측되면 덮어씀)
  var BODY_GAP    = 1.00;      // 완충기 접촉 시 차체 끝면 사이 거리 → 화차 피치 13.0
  var END_CLEAR   = 0.50;      // 버퍼스톱과 최동단 차량 끝면 사이
  var SLACK       = 0.25;      // 연결기 총 유격 (SPEC §3.6)
  var SLACK_H     = SLACK * 0.5;
  var BUF_MAX     = 0.25;      // 완충기 최대 행정
  var RAIL_Y      = 0.30;      // 레일 상면 (World.point 가 y=0 을 주면 이만큼 올림)

  var PITCH_N     = 0.030;     // 최대 가속도에서의 피치각 (rad ≈ 1.7°)
  var SLACK_W     = 26.0;      // 유격 스프링 각진동수
  var SLACK_Z     = 0.52;      // 유격 감쇠비 (<1 → 살짝 출렁)
  var JOLT_W      = 19.0;      // 충격 전달 스프링
  var JOLT_Z      = 0.30;

  var PITCH_MAX   = 0.045;
  var PITCH_W     = 11.5;
  var PITCH_Z     = 0.42;
  var ROLL_K      = 0.0085;    // rad per m/s²  (곡선 원심력)
  var ROLL_MAX    = 0.040;
  var ROLL_W      = 9.5;
  var ROLL_Z      = 0.50;

  var BOUNCE_A    = 0.011;     // 선로 요철 상하 진폭 (m)
  var BOUNCE_R    = 0.013;     // 요철에서 오는 롤 (rad)

  /* 시간 예산 — SPEC §6 "총 2.2~3.4초, 거리에 비례" */
  var T_PREP      = 0.18;
  var T_DWELL     = 0.08;
  var T_POINTS    = 0.20;      // 분기기 정지 대기 (블레이드 회전은 이보다 길게 이어진다)
  var T_BLADE     = 0.35;      // 포인트 블레이드 회전 시간 (SPEC §3.6)
  var T_HITSTOP   = 0.060;
  var T_SETTLE    = 0.34;
  /* 고정 오버헤드 0.86s + 주행 [1.35, 2.55]s → 총 2.21 ~ 3.41s (SPEC §6) */
  var T_RUN_MIN   = 1.35;
  var T_RUN_MAX   = 2.55;
  var D_KNEE      = 95.0;      // 거리에 따라 부드럽게 길어지는 무릎 (하드 클램프 금지)

  var PHYS_DT     = 1 / 240;   // 스프링 서브스텝
  var MAX_DT      = 0.05;      // 탭 전환 등으로 dt 가 튀는 것 방지

  /* ── 모듈 상태 ──────────────────────────────────────────────── */
  var world = null;
  var rt = null;               // key -> 런타임 레코드
  var pose = null;             // key -> { track, s }
  var lastState = null;        // 마지막으로 확정된 논리 상태 (before/after 판별용)
  var railLift = 0;            // World.point 가 y=0 을 주면 RAIL_Y
  var bumpNoise = null;
  var reduced = false;
  var speedScale = 1;
  var accScale = 0.15;         // 1 / (현재 구간의 최고 가속도) — 피치·유격 정규화용
  var busy = false;
  var curSpeed = 0;
  var curVel = 0;              // 부호 있는 동쪽 방향 속도
  var idleDecay = 0;           // 정지 후 스프링이 잦아드는 동안만 갱신
  var job = null;              // 진행 중인 이동 job
  var profCache = Object.create(null);

  /* 스크래치 */
  var _pe = new THREE.Vector3(), _pw = new THREE.Vector3();
  var _te = new THREE.Vector3(), _tw = new THREE.Vector3();
  var _mid = new THREE.Vector3(), _dir = new THREE.Vector3();

  /* ── 잡동사니 헬퍼 ──────────────────────────────────────────── */
  function mapGet(m, k) {
    if (!m) return null;
    return (typeof m.get === 'function') ? m.get(k) : m[k];
  }
  function wrapPi(a) { return U.mod(a + PI, TAU) - PI; }
  function yawOf(x, z) { return Math.atan2(-z, x); }

  function A(name, opts) {
    try { if (SH.Audio && SH.Audio.play) SH.Audio.play(name, opts); } catch (e) { U.err(e); }
  }
  function Aengine(on, load) {
    try { if (SH.Audio && SH.Audio.engine) SH.Audio.engine(on, load); } catch (e) { U.err(e); }
  }
  function Aroll(v) {
    try { if (SH.Audio && SH.Audio.roll) SH.Audio.roll(v); } catch (e) { U.err(e); }
  }
  function FXdust(p, amt, dir) {
    try { if (SH.FX && SH.FX.dust) SH.FX.dust(p, amt, dir); } catch (e) { U.err(e); }
  }
  function FXimpact(p) {
    try { if (SH.FX && SH.FX.impact) SH.FX.impact(p); } catch (e) { U.err(e); }
  }
  function FXexhaust(anchor, load) {
    try { if (SH.FX && SH.FX.exhaust && anchor) SH.FX.exhaust(anchor, load); } catch (e) { U.err(e); }
  }
  function shake(s) {
    if (reduced) return;
    try { if (SH.Render && SH.Render.shake) SH.Render.shake(s); } catch (e) { U.err(e); }
  }

  /** World.point 안전 래퍼 — 실패하면 마지막 유효값을 반환 */
  var _lastPt = { pos: new THREE.Vector3(), tan: new THREE.Vector3(1, 0, 0) };
  function pt(track, s) {
    try {
      var r = SH.World && SH.World.point ? SH.World.point(track, s) : null;
      if (r && r.pos) { _lastPt = r; return r; }
    } catch (e) { U.err(e); }
    return _lastPt;
  }

  function trackLen(id) {
    var tr = mapGet(world && world.tracks, id);
    if (tr && typeof tr.length === 'number' && tr.length > 1) return tr.length;
    if (tr && tr.curve && typeof tr.curve.getLength === 'function') {
      try { return tr.curve.getLength(); } catch (e) { U.err(e); }
    }
    return 70;
  }

  function entOf(key) {
    if (!world) return null;
    if (key === LOCO_KEY) return world.loco;
    return mapGet(world.vehicles, key);
  }

  function vehLen(key) {
    var r = rt && rt[key];
    if (r) return r.len;
    var e = entOf(key);
    if (e) {
      if (typeof e.len === 'number' && e.len > 0) return e.len;
      if (e.rig && typeof e.rig.length === 'number' && e.rig.length > 0) return e.rig.length;
    }
    return key === LOCO_KEY ? 14.0 : 12.0;
  }

  /* ── 런타임 레코드 ──────────────────────────────────────────── */

  function makeRecord(key, idx) {
    var e = entOf(key);
    if (!e || !e.group) return null;
    var rig = e.rig || (e.group.userData && e.group.userData.rig) || {};
    var r = {
      key: key, ent: e, group: e.group, rig: rig,
      len: (typeof e.len === 'number' && e.len > 0) ? e.len
         : (typeof rig.length === 'number' && rig.length > 0) ? rig.length
         : (key === LOCO_KEY ? 14.0 : 12.0),
      bogieOff: BOGIE_OFF,
      track: null, s: 0, prevS: 0,
      yaw: 0, prevYaw: 0, kappa: 0,
      vEast: 0, aEast: 0,
      wheelAng: 0,
      pitch: 0, pitchV: 0, roll: 0, rollV: 0,
      jolt: 0, joltV: 0, joltWait: 0, joltAmp: 0,
      bufW: 0, bufE: 0,           // 각 면의 현재 압축량
      bufWT: 0, bufET: 0,         // 각 면의 목표 압축량
      row: (idx * 7.31) % 97,     // 요철 노이즈 위상 (차량마다 다르게)
      bodyBase: { x: 0, y: 0, z: 0 },
      bufBaseW: 0, bufBaseE: 0,
      wheels: [], bogieW: null, bogieE: null,
      dustT: 0
    };

    /* 대차: position.x 부호로 서/동을 판별하고 실제 오프셋을 실측 */
    var bg = rig.bogies;
    if (bg && bg.length >= 2 && bg[0] && bg[1]) {
      var x0 = bg[0].position ? bg[0].position.x : -BOGIE_OFF;
      var x1 = bg[1].position ? bg[1].position.x : BOGIE_OFF;
      r.bogieW = (x0 <= x1) ? bg[0] : bg[1];
      r.bogieE = (x0 <= x1) ? bg[1] : bg[0];
      var off = (Math.abs(x0) + Math.abs(x1)) * 0.5;
      if (off > 0.5 && off < r.len * 0.5) r.bogieOff = off;
    } else if (bg && bg.length === 1 && bg[0]) {
      r.bogieW = r.bogieE = bg[0];
    }

    if (rig.wheels && rig.wheels.length) {
      for (var i = 0; i < rig.wheels.length; i++) if (rig.wheels[i]) r.wheels.push(rig.wheels[i]);
    }
    if (rig.bodyPivot && rig.bodyPivot.rotation) {
      r.bodyBase.x = rig.bodyPivot.rotation.x;
      r.bodyBase.y = rig.bodyPivot.rotation.y;
      r.bodyBase.z = rig.bodyPivot.rotation.z;
    }
    if (rig.buffers) {
      if (rig.buffers.w && rig.buffers.w.position) r.bufBaseW = rig.buffers.w.position.x;
      if (rig.buffers.e && rig.buffers.e.position) r.bufBaseE = rig.buffers.e.position.x;
    }
    return r;
  }

  /* ── 편성 배치 계산 ─────────────────────────────────────────── */

  /** 원점→완충면 거리. Geometry 계약(20-geometry.js 머리말):
      두 차량의 올바른 중심간 거리 = A.halfLength + B.halfLength.
      화차는 6.5(=len/2+0.5)라 옛 식 len/2+BODY_GAP/2 와 같은 값이지만,
      기관차는 7.0(=len/2)이라 옛 식이면 0.5 를 더 벌려 완충기·연결기 사이에
      구멍이 생겼다 (closeup-coupler 포즈가 그 구멍을 정면으로 겨눴다). */
  function vehHalf(key) {
    var r = rt && rt[key];
    var rig = r ? r.rig : null;
    if (!rig) { var e = entOf(key); rig = e && e.rig; }
    if (rig && typeof rig.halfLength === 'number' && rig.halfLength > 0)
      return rig.halfLength;
    return vehLen(key) * 0.5 + BODY_GAP * 0.5;
  }

  /** 트랙 동쪽(버퍼) 끝부터 채운다. keys 는 서→동 순서. 반환: 각 차량 중심 s */
  function packEast(trackId, keys) {
    var L = trackLen(trackId);
    var n = keys.length;
    var out = new Array(n);
    if (!n) return out;
    // 최동단 차량은 종전대로 '동쪽 끝면이 버퍼스톱에서 END_CLEAR' 로 앉힌다.
    out[n - 1] = L - END_CLEAR - vehLen(keys[n - 1]) * 0.5;
    for (var i = n - 2; i >= 0; i--) {
      out[i] = out[i + 1] - (vehHalf(keys[i]) + vehHalf(keys[i + 1]));
    }
    return out;
  }

  /** 트랙 위 물리적 배열: at 트랙은 [LOCO, ...consist, ...tracks[at]] */
  function orderOn(state, trackId) {
    var base = (state.tracks && state.tracks[trackId]) ? state.tracks[trackId] : [];
    if (state.at === trackId) return [LOCO_KEY].concat(state.consist || [], base);
    return base.slice();
  }

  /** 논리 상태 → 전 차량의 { track, s } */
  function posesFor(state) {
    var out = Object.create(null);
    if (!state || !state.tracks) return out;
    var ids = Object.keys(state.tracks);
    if (state.at && ids.indexOf(state.at) < 0) ids.push(state.at);
    for (var t = 0; t < ids.length; t++) {
      var id = ids[t];
      var keys = orderOn(state, id);
      if (!keys.length) continue;
      var cs = packEast(id, keys);
      for (var i = 0; i < keys.length; i++) {
        if (rt[keys[i]]) out[keys[i]] = { track: id, s: cs[i] };
      }
    }
    return out;
  }

  /* ── 배치 (대차 단위) ───────────────────────────────────────── */

  /**
   * 차량 하나를 트랙 위 s 에 놓는다.
   * 앞뒤 대차의 s(중심 ±bogieOff)를 각각 구해 두 점의 중점에 차체를 놓고,
   * 두 점을 잇는 방향으로 yaw 를 정한다 → 곡선에서 차체가 선로 안쪽으로 오프셋된다.
   */
  function placeVehicle(r, track, s, dsHint, dt, moving) {
    var off = r.bogieOff;
    var pE = pt(track, s + off), pW = pt(track, s - off);
    _pe.copy(pE.pos); _te.copy(pE.tan);
    _pw.copy(pW.pos); _tw.copy(pW.tan);

    _mid.addVectors(_pe, _pw).multiplyScalar(0.5);
    _dir.subVectors(_pe, _pw);
    if (_dir.lengthSq() < 1e-8) _dir.copy(_te);
    var yaw = yawOf(_dir.x, _dir.z);

    var ds;
    if (dsHint != null) ds = dsHint;
    else ds = (r.track === track) ? (s - r.prevS) : 0;
    r.prevS = s; r.track = track; r.s = s;

    /* 종/횡 운동학 */
    if (dt > 1e-6) {
      var v = ds / dt;
      var a = (v - r.vEast) / dt;
      r.vEast = v;
      r.aEast = U.damp(r.aEast, a, 24, dt);
      var dyaw = wrapPi(yaw - r.prevYaw);
      var kRaw = Math.abs(ds) > 1e-4 ? U.clamp(dyaw / ds, -0.25, 0.25) : r.kappa;
      r.kappa = U.damp(r.kappa, kRaw, 14, dt);
    }
    r.prevYaw = yaw;

    /* 차륜 회전 — angle += ds / R (정확해야 한다) */
    if (ds !== 0) {
      r.wheelAng += ds / WHEEL_R;
      if (r.wheelAng > 1e6 || r.wheelAng < -1e6) r.wheelAng = U.mod(r.wheelAng, TAU);
      for (var w = 0; w < r.wheels.length; w++) {
        var wh = r.wheels[w], ud = wh.userData || null;
        var ang = r.wheelAng * ((ud && ud.spinSign) || 1);
        var ax = (ud && ud.spinAxis) || 'x';
        wh.rotation[ax] = ang;
      }
    }

    /* 선로 요철 — s 에 대한 저주파 노이즈, 차량마다 위상이 다르다 */
    var spd = Math.min(1, Math.abs(r.vEast) / 6);
    var bump = 0, bumpR = 0;
    if (!reduced && bumpNoise) {
      var n1 = bumpNoise(s * 0.085, r.row);
      var n2 = bumpNoise(s * 0.24 + 13.7, r.row + 5.5);
      bump = (n1 * 0.72 + n2 * 0.28) * BOUNCE_A * (0.25 + 0.75 * spd);
      bumpR = n2 * BOUNCE_R * spd;
    }

    r.group.position.set(_mid.x, _mid.y + railLift + bump, _mid.z);
    r.group.rotation.y = yaw;
    r.yaw = yaw;

    /* 대차는 각자의 접선을 향한다 (차체 yaw 기준 상대각) */
    if (r.bogieW) r.bogieW.rotation.y = wrapPi(yawOf(_tw.x, _tw.z) - yaw);
    if (r.bogieE) r.bogieE.rotation.y = wrapPi(yawOf(_te.x, _te.z) - yaw);

    /* 차체 서스펜션 — 피치(가감속) / 롤(원심력), 스프링-댐퍼 */
    var bp = r.rig.bodyPivot;
    if (bp) {
      var tP = U.clamp(PITCH_N * r.aEast * accScale, -PITCH_MAX, PITCH_MAX);
      var aLat = r.vEast * r.vEast * r.kappa;
      var tR = U.clamp(-ROLL_K * aLat, -ROLL_MAX, ROLL_MAX);
      if (reduced) { tP *= 0.25; tR *= 0.25; }
      springTo(r, 'pitch', 'pitchV', tP, PITCH_W, PITCH_Z, dt);
      springTo(r, 'roll', 'rollV', tR, ROLL_W, ROLL_Z, dt);
      bp.rotation.z = r.bodyBase.z + r.pitch;
      bp.rotation.x = r.bodyBase.x + r.roll + bumpR;
    }

    /* 완충기 — 압축량만큼 로컬 X 로 밀려 들어간다 */
    var bf = r.rig.buffers;
    if (bf) {
      if (bf.w && bf.w.position) bf.w.position.x = r.bufBaseW + Math.min(r.bufW, BUF_MAX);
      if (bf.e && bf.e.position) bf.e.position.x = r.bufBaseE - Math.min(r.bufE, BUF_MAX);
    }

    /* 압축 중 + 이동 중이면 완충기 근처에 먼지 */
    if (moving && !reduced && dt > 0) {
      r.dustT -= dt;
      var comp = Math.max(r.bufW, r.bufE);
      if (comp > 0.10 && r.dustT <= 0 && Math.abs(r.vEast) > 1.5) {
        r.dustT = 0.09;
        FXdust(_mid.clone().setY(_mid.y + railLift + 0.55),
               U.clamp(comp * 2.4, 0, 1), null);
      }
    }
    return yaw;
  }

  function springTo(r, pk, vk, target, w, z, dt) {
    if (dt <= 0) { r[pk] = target; r[vk] = 0; return; }
    var left = dt, k = w * w, c = 2 * z * w;
    while (left > 1e-6) {
      var h = left > PHYS_DT ? PHYS_DT : left; left -= h;
      r[vk] += (k * (target - r[pk]) - c * r[vk]) * h;
      r[pk] += r[vk] * h;
    }
  }

  /* ── 즉시 배치 ──────────────────────────────────────────────── */

  function applyPose(key, dt, moving) {
    var r = rt[key], p = pose[key];
    if (!r || !p) return;
    var s = p.s + r.jolt;
    var ds = (r.track === p.track) ? (s - r.prevS) : 0;
    placeVehicle(r, p.track, s, ds, dt, moving);
  }

  function snap(state) {
    if (!world || !rt) return;
    try {
      if (state) {
        lastState = cloneState(state);
        pose = posesFor(state);
        /* 레벨 로드 — 전환되어 있던 분기기를 원위치로 */
        if (lastBlades) { applyBlades(lastBlades, 0); lastBlades = null; }
      }
      for (var k in pose) {
        var r = rt[k];
        if (!r) continue;
        /* 애니메이션 없이 정확히 — 속도/스프링 상태를 모두 0 으로 */
        r.track = null; r.prevS = pose[k].s;
        r.vEast = 0; r.aEast = 0; r.kappa = 0;
        r.pitch = 0; r.pitchV = 0; r.roll = 0; r.rollV = 0;
        r.jolt = 0; r.joltV = 0; r.joltWait = 0; r.joltAmp = 0;
        r.bufW = 0; r.bufE = 0; r.bufWT = 0; r.bufET = 0;
        r.prevYaw = 0;
        placeVehicle(r, pose[k].track, pose[k].s, 0, 0, false);
        r.prevYaw = r.yaw;
      }
      curSpeed = 0; idleDecay = 0;
      Aroll(0);
      Aengine(true, 0);
    } catch (e) { U.err(e); }
  }

  function cloneState(s) {
    var t = {};
    if (s.tracks) for (var k in s.tracks) t[k] = (s.tracks[k] || []).slice();
    return { tracks: t, at: s.at, consist: (s.consist || []).slice(), moves: s.moves };
  }

  /* ── 프레임 전 동역학 (완충기 복원 · 충격 전달) ─────────────── */

  function preDyn(r, dt) {
    if (dt <= 0) return;
    /* 충격 대기열 */
    if (r.joltWait > 0) {
      r.joltWait -= dt;
      if (r.joltWait <= 0) { r.joltV += r.joltAmp * JOLT_W; r.joltAmp = 0; }
    }
    if (r.jolt !== 0 || r.joltV !== 0) {
      springTo(r, 'jolt', 'joltV', 0, JOLT_W, JOLT_Z, dt);
      if (Math.abs(r.jolt) < 1e-5 && Math.abs(r.joltV) < 1e-4) { r.jolt = 0; r.joltV = 0; }
    }
    /* 완충기: 목표 압축량으로 빠르게 수렴 (충격 직후엔 값을 직접 밀어넣는다) */
    r.bufW = U.damp(r.bufW, r.bufWT, 15, dt);
    r.bufE = U.damp(r.bufE, r.bufET, 15, dt);
  }

  /* ── 경로 (railPath → run 목록) ─────────────────────────────── */

  function recalc(run) {
    run.total = 0;
    for (var i = 0; i < run.segs.length; i++) {
      var sg = run.segs[i];
      sg.sgn = sg.b >= sg.a ? 1 : -1;
      sg.len = Math.abs(sg.b - sg.a);
      sg.c = run.total;
      run.total += sg.len;
    }
    return run;
  }

  /** run 안의 이동거리 u → { track, s }.  u<0 / u>total 은 양 끝 세그먼트에서 외삽된다 */
  function runPos(run, u, out) {
    var segs = run.segs, k = 0;
    for (var i = 1; i < segs.length; i++) { if (u >= segs[i].c) k = i; else break; }
    var sg = segs[k];
    out.track = sg.track;
    out.s = sg.a + sg.sgn * (u - sg.c);
    return out;
  }

  function buildRuns(fromTrack, target, startS, endS) {
    var rp = null;
    try { rp = (SH.World && SH.World.railPath) ? SH.World.railPath(fromTrack, target) : null; }
    catch (e) { U.err(e); }
    var src = (rp && rp.segs && rp.segs.length) ? rp.segs : null;
    if (!src) return null;

    var raw = [];
    for (var i = 0; i < src.length; i++) {
      var sg = src[i];
      if (!sg || sg.track == null) continue;
      var a = +sg.from, b = +sg.to;
      if (!isFinite(a) || !isFinite(b) || Math.abs(b - a) < 1e-3) continue;
      raw.push({ track: sg.track, a: a, b: b });
    }
    if (!raw.length) return null;

    /* 시작/끝은 우리가 계산한 패킹 위치로 덮어쓴다 → 항상 정확히 안착한다 */
    var f = raw[0], l = raw[raw.length - 1];
    if ((f.b - startS) * (f.b - f.a) > 0) f.a = startS;
    l.b = endS;
    if (Math.abs(f.b - f.a) < 1e-3 && raw.length > 1) raw.shift();
    if (Math.abs(l.b - l.a) < 1e-3 && raw.length > 1) raw.pop();

    var runs = [], cur = null;
    for (i = 0; i < raw.length; i++) {
      var d = raw[i].b >= raw[i].a ? 1 : -1;
      if (!cur || cur.dir !== d) { cur = { dir: d, segs: [], total: 0 }; runs.push(cur); }
      cur.segs.push({ track: raw[i].track, a: raw[i].a, b: raw[i].b });
    }
    for (i = 0; i < runs.length; i++) recalc(runs[i]);
    return runs;
  }

  /* ── 속도 프로파일 ──────────────────────────────────────────── */

  /**
   * 정규화 위치 테이블을 만든다.  속도 곡선은
   *   [0,r1]  smootherstep 상승  (저크 제한 S-curve — 양 끝에서 저크 0)
   *   [r1,r2] 순항
   *   [r2,1]  긴 감속 꼬리 + 크리프 항 (마지막 구간은 아주 천천히)
   */
  function profile(r1, r2, tailPow, creep) {
    var key = r1 + '|' + r2 + '|' + tailPow + '|' + creep;
    if (profCache[key]) return profCache[key];
    var N = 256, v = new Float32Array(N + 1), p = new Float32Array(N + 1), i;
    for (i = 0; i <= N; i++) {
      var tau = i / N, vv;
      if (tau < r1) vv = U.smootherstep(tau / r1);
      else if (tau < r2) vv = 1;
      else {
        var u = (tau - r2) / (1 - r2);
        var q = Math.max(0, 1 - u);
        vv = Math.pow(q, tailPow) * (1 - creep) + creep * Math.pow(q, 0.34);
      }
      v[i] = vv;
    }
    var acc = 0;
    p[0] = 0;
    for (i = 1; i <= N; i++) { acc += (v[i - 1] + v[i]) * 0.5 / N; p[i] = acc; }
    if (acc > 1e-6) for (i = 0; i <= N; i++) p[i] /= acc;
    p[N] = 1;
    /* I = ∫v dτ → 최고속도 = 거리/(시간·I).  r1 은 가속 램프 길이 (최대 저크 계산용) */
    var prof = { p: p, I: Math.max(acc, 1e-3), r1: r1 };
    profCache[key] = prof;
    return prof;
  }

  function profAt(prof, tau) {
    if (tau <= 0) return 0;
    if (tau >= 1) return 1;
    var p = prof.p, N = p.length - 1, f = tau * N, i = f | 0;
    if (i >= N) return 1;
    return p[i] + (p[i + 1] - p[i]) * (f - i);
  }

  /** 이 구간에서 나올 최고 가속도 — 피치/유격을 이 값으로 정규화해야 saturate 하지 않는다 */
  function peakAccel(prof, dist, dur) {
    var vPeak = dist / Math.max(dur * prof.I, 1e-3);
    return Math.max(1e-3, 1.875 * vPeak / Math.max(prof.r1 * dur, 1e-3));
  }

  var PROF_PULL   = [0.20, 0.66, 1.50, 0.09];
  var PROF_PROPEL = [0.18, 0.56, 2.00, 0.15];

  /* ── 분기기 블레이드 ────────────────────────────────────────── */

  var bladeBase = Object.create(null);
  var lastBlades = null;        // 현재 전환되어 있는 분기기 (다음 전환 때 원위치로 돌아간다)

  function findBlades(trackId) {
    try {
      if (!world) return null;
      var cand = null;
      if (world.turnouts) {
        var t = mapGet(world.turnouts, trackId);
        if (t) cand = t.blades || (t.userData && t.userData.blades) || t;
      }
      if (!cand) {
        var tr = mapGet(world.tracks, trackId);
        if (tr && tr.group && tr.group.traverse) {
          tr.group.traverse(function (o) {
            if (cand) return;
            if (o.userData && o.userData.blades) cand = o.userData.blades;
            else if (o.name === 'blades' || o.name === 'pointBlades' || o.name === 'points') cand = o;
          });
        }
      }
      if (cand && bladeBase[cand.uuid] == null) {
        bladeBase[cand.uuid] = cand.rotation ? cand.rotation.y : 0;
      }
      return cand || null;
    } catch (e) { U.err(e); return null; }
  }

  function applyBlades(b, t) {
    if (!b) return;
    try {
      var ud = b.userData || {};
      if (typeof ud.setThrow === 'function') { ud.setThrow(t); return; }
      var amt = (typeof ud.throwY === 'number') ? ud.throwY : 0.020;
      if (b.rotation) b.rotation.y = (bladeBase[b.uuid] || 0) + amt * t;
    } catch (e) { U.err(e); }
  }

  /* ── 이동 실행 ──────────────────────────────────────────────── */

  function once(fn) {
    var called = false;
    return function () {
      if (called) return; called = true;
      try { if (fn) fn(); } catch (e) { U.err(e); }
    };
  }

  function normMove(m) {
    if (m == null) return null;
    if (typeof m === 'string') return { type: 'go', track: m };
    if (m.type === 'cut') return { type: 'cut', k: m.k | 0 };
    var t = m.track || m.to || m.trackId || m.id;
    return t ? { type: 'go', track: t } : null;
  }

  function afterGo(before, target) {
    var st = cloneState(before);
    var picked = (st.tracks[target] || []).slice();
    st.consist = (st.consist || []).concat(picked);
    st.tracks[target] = [];
    st.at = target;
    return st;
  }

  /** state 가 이동 '전'인지 '후'인지 판별해서 '전' 상태를 돌려준다 */
  function resolveBefore(state, target) {
    if (state && state.tracks && state.at && state.at !== target) return cloneState(state);
    if (lastState && lastState.at && lastState.at !== target) return cloneState(lastState);
    return state && state.tracks ? cloneState(state) : (lastState ? cloneState(lastState) : null);
  }

  function execute(state, move, doneCb) {
    var fin = once(doneCb);
    try {
      if (!world || !rt) { fin(); return; }
      if (job) { cancel(); }
      var mv = normMove(move);
      if (!mv) { if (state) snap(state); fin(); return; }
      if (mv.type === 'cut') { doCut(state, fin); return; }
      startGo(state, mv.track, fin);
    } catch (e) { U.err(e); try { if (state) snap(state); } catch (e2) { U.err(e2); } fin(); }
  }

  /* 분리(cut)는 무료·즉시. 위치는 변하지 않고 작은 금속음 + 잔진동만 남긴다. */
  function doCut(state, fin) {
    if (state) { lastState = cloneState(state); pose = posesFor(state); }
    A('clank', { gain: 0.55 });
    var keys = state ? orderOn(state, state.at) : [];
    var k0 = 1 + ((state && state.consist) ? state.consist.length : 0);
    for (var i = k0; i < keys.length; i++) {
      var r = rt[keys[i]];
      if (!r) continue;
      r.joltAmp = 0.035 * Math.pow(0.7, i - k0);
      r.joltWait = 0.03 * (i - k0);
    }
    idleDecay = Math.max(idleDecay, 1.1);
    fin();
  }

  function startGo(state, target, fin) {
    var before = resolveBefore(state, target);
    if (!before || !before.at || !before.tracks) { if (state) snap(state); fin(); return; }
    var from = before.at;
    if (from === target) { snap(before); fin(); return; }

    var after = afterGo(before, target);
    var startPose = posesFor(before);
    var finalPose = posesFor(after);
    var sp = startPose[LOCO_KEY], fp = finalPose[LOCO_KEY];
    if (!sp || !fp) { pose = finalPose; lastState = after; snap(null); fin(); return; }

    var rake = [LOCO_KEY].concat(before.consist || []).filter(function (k) { return !!rt[k]; });
    var standing = (before.tracks[target] || []).filter(function (k) { return !!rt[k]; });

    var runs = buildRuns(from, target, sp.s, fp.s);
    if (!runs || !runs.length) {
      /* 경로를 못 구했으면 조용히 정확 배치 — 절대 깨진 화면을 보이지 않는다 */
      pose = finalPose; lastState = after; snap(null); fin(); return;
    }

    /* runA = 서쪽 견인, runB = 동쪽 추진.
       마지막 run 은 반드시 목표 지점에서 끝나므로(위에서 l.b=endS 로 고정) runB 로 삼는다. */
    var i;
    var runA = runs[0].dir < 0 ? runs[0] : null;
    var runB = runs[runs.length - 1];
    if (runB === runA) runB = null;

    /* 반전 지점에서 기관차가 트랙 서쪽 끝을 벗어나지 않게 */
    if (runA) {
      var lastSeg = runA.segs[runA.segs.length - 1];
      var minS = vehLen(LOCO_KEY) * 0.5 + 0.6;
      if (lastSeg.b < minS) { lastSeg.b = minS; recalc(runA); }
    }
    /* runA 끝 == runB 시작 이 되도록 강제 (경로 불연속 방지) */
    if (runA && runB) {
      var e = runPos(runA, runA.total, { track: null, s: 0 });
      if (runB.segs[0].track === e.track) { runB.segs[0].a = e.s; recalc(runB); }
    }

    var n = rake.length;
    var pitchN = [0];
    for (i = 1; i < n; i++) pitchN[i] = vehHalf(rake[i - 1]) + vehHalf(rake[i]);

    var dA = runA ? runA.total : 0, dB = runB ? runB.total : 0;
    var tScale = reduced ? 0.6 : 1;
    /* 거리에 따라 부드럽게 길어진다. 짧은 이동도 지루하지 않고 긴 이동도 싸구려로 안 보이게 */
    var Trun = (T_RUN_MIN + (T_RUN_MAX - T_RUN_MIN) *
                (1 - Math.exp(-(dA + dB) / D_KNEE))) * tScale;
    /* 거리 비례로 나누되 상수항을 더해 짧은 구간이 폭력적으로 빨라지지 않게.
       추진(runB)에 15% 가중 — 접촉으로 이어지는 구간이라 여유가 필요하다. */
    var wA = dA + 12, wB = (dB + 12) * 1.15;
    var TA, TB;
    if (runA && runB) {
      TA = Math.max(0.35 * tScale, Trun * wA / (wA + wB));
      TB = Math.max(0.50 * tScale, Trun - TA);
    } else if (runA) { TA = Trun; TB = 0; } else { TA = 0; TB = Trun; }

    var plan = [{ p: 'prep', d: T_PREP * tScale }];
    if (runA) {
      plan.push({ p: 'pull', d: TA, run: runA, prof: profile(PROF_PULL[0], PROF_PULL[1], PROF_PULL[2], PROF_PULL[3]) });
      plan.push({ p: 'dwell', d: T_DWELL * tScale });
    }
    if (runB) {
      plan.push({ p: 'points', d: T_POINTS * tScale });
      plan.push({ p: 'propel', d: TB, run: runB, prof: profile(PROF_PROPEL[0], PROF_PROPEL[1], PROF_PROPEL[2], PROF_PROPEL[3]) });
      plan.push({ p: 'impact', d: reduced ? 0.012 : T_HITSTOP });
    }
    plan.push({ p: 'settle', d: T_SETTLE * tScale });

    pose = startPose;
    job = {
      fin: fin, plan: plan, pi: -1, ph: '', t: 0, dur: 1,
      rake: rake, standing: standing, pitchN: pitchN, n: n,
      runA: runA, runB: runB, run: null, prof: null, runEnd: 0,
      u: 0, du: 0, ddu: 0, warm: false, uEffPrev: null,
      sig: new Float64Array(n), sigV: new Float64Array(n), sigT: 0,
      finalPose: finalPose, after: after, target: target,
      blades: findBlades(target), bladesPrev: null, bladeT: 0, bladeRun: false, bladeTime: 0,
      load: 0, squealed: false, impacted: false, dustT: 0
    };
    for (i = 0; i < n; i++) { var rr = rt[rake[i]]; if (rr) rr.prevBack = 0; }
    busy = true;
    idleDecay = 0;
    advance();
  }

  function advance() {
    var j = job;
    if (!j) return;
    j.pi++;
    if (j.pi >= j.plan.length) { finishJob(); return; }
    var st = j.plan[j.pi];
    var prevRun = j.run;
    j.ph = st.p; j.dur = Math.max(1e-4, st.d); j.t = 0;
    j.prof = st.prof || null;

    switch (j.ph) {
      case 'prep':
        j.run = j.runA || j.runB; j.u = 0; j.runEnd = 0;
        A('hiss');                                   // 브레이크 해제
        break;
      case 'pull':
        j.run = j.runA; j.u = 0; j.runEnd = j.runA.total;
        break;
      case 'dwell':
        j.run = j.runA; j.u = j.runA.total;
        A('squeal', { gain: 0.5 });
        break;
      case 'points':
        j.run = j.runA || j.runB;
        j.u = j.runA ? j.runA.total : 0;
        A('points');
        j.bladeRun = true; j.bladeTime = 0;   // 블레이드 회전은 추진 시작까지 이어진다
        j.bladesPrev = (lastBlades && lastBlades !== j.blades) ? lastBlades : null;
        break;
      case 'propel':
        j.run = j.runB; j.u = 0; j.runEnd = j.runB.total;
        A('hiss', { gain: 0.4 });
        break;
      case 'impact':
        j.run = j.runB; j.u = j.runB.total;
        doImpact();
        break;
      case 'settle':
        j.run = j.runB || j.runA;
        j.runEnd = j.run ? j.run.total : 0;
        j.u = j.runEnd;
        break;
    }
    if (j.run !== prevRun) j.uEffPrev = null;    // 경로가 바뀌면 속도 미분을 한 프레임 건너뛴다
    /* 이 구간의 최고 가속도로 피치·유격을 정규화한다 (시간 압축과 무관하게 같은 느낌) */
    if (j.prof && j.runEnd > 0) accScale = 1 / peakAccel(j.prof, j.runEnd, j.dur);
  }

  function doImpact() {
    var j = job, i;
    var r = rt[j.rake[j.n - 1]];
    var p = new THREE.Vector3();
    if (r) {
      p.copy(r.group.position);
      var half = r.len * 0.5;
      p.x += Math.cos(r.yaw) * half;
      p.z -= Math.sin(r.yaw) * half;
      p.y += 0.62;
      r.bufE = r.bufET = 0.22;
    }
    A('couple');
    A('clank', { gain: 0.85 });
    FXimpact(p);
    FXdust(p, 0.95, null);
    shake(0.6);

    /* 서 있던 차량들: 서쪽부터 차례로 밀려간다 */
    for (i = 0; i < j.standing.length; i++) {
      var q = rt[j.standing[i]];
      if (!q) continue;
      q.joltAmp = 0.17 * Math.pow(0.58, i);
      q.joltWait = 0.042 * i;
      if (i === 0) { q.bufW = q.bufWT = 0.22; }
    }
    /* 편성: 뒤쪽으로 압축 파동 */
    j.sigT = -SLACK_H;
    for (i = 1; i < j.n; i++) j.sigV[i] -= 0.85 * SLACK_W * SLACK_H * Math.pow(0.87, i - 1);
    j.impacted = true;
  }

  function finishJob() {
    var j = job;
    job = null;
    busy = false;
    if (j) {
      pose = j.finalPose;
      lastState = j.after;
      applyBlades(j.blades, 1);
      if (j.bladesPrev) applyBlades(j.bladesPrev, 0);
      lastBlades = j.blades;
    }
    curSpeed = 0; curVel = 0;
    idleDecay = 1.0;                  // 스프링이 잦아들 때까지만 계속 갱신
    Aroll(0);
    Aengine(true, 0.05);
    var lr = rt[LOCO_KEY];
    FXexhaust(lr && lr.rig ? lr.rig.exhaust : null, 0.08);
    if (j) j.fin();
  }

  function cancel() {
    if (!job) return;
    var j = job;
    job = null; busy = false;
    pose = j.finalPose; lastState = j.after;
    applyBlades(j.blades, 1);
    snap(null);
    curSpeed = 0; curVel = 0;
    j.fin();
  }

  /* ── 프레임 진행 ────────────────────────────────────────────── */

  function stepJob(dt) {
    var j = job;
    var d = dt * speedScale;
    j.t += d;

    /* 히트스톱 — 접촉 프레임에서 모든 것이 완전히 멈춘다 */
    if (j.ph === 'impact') {
      if (j.t >= j.dur) advance();
      return;
    }

    var frac = U.clamp01(j.t / j.dur);
    var moving = false;
    var u0 = j.u;

    if (j.prof) {
      j.u = j.runEnd * profAt(j.prof, frac);
      var v = d > 1e-6 ? (j.u - u0) / d : 0;
      var a = d > 1e-6 ? (v - j.du) / d : 0;
      j.du = v;
      j.ddu = U.damp(j.ddu, a, 22, d);
      moving = true;
      /* 견인(draft)=+, 압축(buff)=− :  σ = −runDir · â · SLACK/2   (â = 정규화 가속도) */
      j.sigT = -j.run.dir * U.clamp(j.ddu * accScale, -1, 1) * SLACK_H;
      if (j.ph === 'pull' && !j.squealed && frac > 0.74) { j.squealed = true; A('squeal'); }
    } else if (j.ph === 'prep') {
      /* 움직이기 전에 유격부터 풀린다 — 엔진이 부하를 받는 소리와 함께 */
      var dir0 = j.run ? j.run.dir : -1;
      j.sigT = -dir0 * SLACK_H * 0.6 * U.smooth(frac);
      j.du = 0; j.ddu = 0;
    } else if (j.ph === 'settle') {
      /* 유격이 중립으로 돌아오면서 기관차가 압축분만큼 뒤로 밀려난다 = 완충기 반동 */
      j.du = U.damp(j.du, 0, 14, d);
      j.ddu = U.damp(j.ddu, 0, 10, d);
      j.sigT = U.damp(j.sigT, 0, 11, d);
    } else {
      j.du = U.damp(j.du, 0, 16, d);
      j.ddu = U.damp(j.ddu, 0, 16, d);
      j.sigT = U.damp(j.sigT, 0, 9, d);
    }

    /* 분기기 블레이드 — 0.35초에 걸쳐 회전 (points 단계에서 시작해 추진 초반까지) */
    if (j.bladeRun) {
      j.bladeTime += d;
      j.bladeT = U.ease.inOutCubic(U.clamp01(j.bladeTime / (T_BLADE * (reduced ? 0.6 : 1))));
      applyBlades(j.blades, j.bladeT);
      if (j.bladesPrev) applyBlades(j.bladesPrev, 1 - j.bladeT);   // 직전 분기기는 원위치로
      if (j.bladeT >= 1) { j.bladeRun = false; j.bladesPrev = null; }
    }

    var du = j.u - u0;
    curVel = (j.run ? j.run.dir : 1) * (d > 1e-6 ? du / d : 0);
    curSpeed = Math.abs(curVel);

    /* 유격 파동 — 캐스케이드 스프링. 뒤 칸일수록 한 단계씩 늦게 반응한다 */
    var n = j.n, i, left = d, k = SLACK_W * SLACK_W, c = 2 * SLACK_Z * SLACK_W;
    while (left > 1e-6 && n > 1) {
      var h = left > PHYS_DT ? PHYS_DT : left; left -= h;
      for (i = n - 1; i >= 1; i--) {                 // 내림차순 → 한 스텝씩 지연되며 파동이 흐른다
        var src = (i === 1) ? j.sigT : j.sig[i - 1];
        j.sigV[i] += (k * (src - j.sig[i]) - c * j.sigV[i]) * h;
        j.sig[i] += j.sigV[i] * h;
        if (j.sig[i] > SLACK_H) { j.sig[i] = SLACK_H; if (j.sigV[i] > 0) j.sigV[i] *= -0.25; }
        else if (j.sig[i] < -SLACK_H) { j.sig[i] = -SLACK_H; if (j.sigV[i] < 0) j.sigV[i] *= -0.25; }
      }
    }
    /* 정차 단계에서는 유격을 정확히 0 으로 수렴시킨다 → 최종 위치가 패킹 결과와 완전히 일치 */
    if (j.ph === 'settle') {
      var keep = 1 - U.smootherstep(frac);
      for (i = 1; i < n; i++) { j.sig[i] *= keep; j.sigV[i] *= keep; }
    }

    /* 편성 배치.
       유격 총량(sigSum)을 기관차 쪽에서 흡수한다 → 편성 뒤쪽(반대 끝)이 매끄러운
       프로파일을 그대로 따르고, 유격이 풀리는 동안 기관차만 먼저 움직인다.
       중간 차량들은 자기 앞 유격이 풀린 만큼만 끌려오므로 파동이 눈에 보인다. */
    var run = j.run || j.runB || j.runA;
    if (!run) { finishJob(); return; }
    var sigSum = 0;
    for (i = 1; i < n; i++) sigSum += j.sig[i];
    var uEff = j.u - run.dir * sigSum;
    var duEff = (j.uEffPrev == null) ? 0 : (uEff - j.uEffPrev);
    j.uEffPrev = uEff;

    var back = 0, probe = { track: null, s: 0 };
    for (i = 0; i < n; i++) {
      if (i > 0) back += j.pitchN[i] + j.sig[i];
      var r = rt[j.rake[i]];
      if (!r) continue;
      if (!j.warm) r.prevBack = back;
      var db = back - r.prevBack;
      r.prevBack = back;
      preDyn(r, d);
      /* 완충기 목표: 압축(σ<0)량을 조금 과장해서 보이게 한다 (디오라마 거리에서 읽히도록) */
      var cmp = Math.min(Math.max(0, -j.sig[i]) * 1.6, BUF_MAX);
      if (i > 0) {
        r.bufWT = cmp;
        var pr = rt[j.rake[i - 1]];
        if (pr) pr.bufET = cmp;
      } else { r.bufWT = 0; }
      if (i === n - 1) {
        /* 최동단 차량의 동쪽 면은 접촉 순간에만 눌린다 */
        r.bufET = j.impacted ? Math.max(0, r.bufET - d * 0.75) : 0;
      }
      runPos(run, uEff + run.dir * back, probe);
      placeVehicle(r, probe.track, probe.s, run.dir * duEff + db, d, moving);
    }
    j.warm = true;

    /* 서 있는 차량 · 다른 트랙 차량 — 충격 여진만 갱신 */
    for (var key in pose) {
      if (j.rake.indexOf(key) >= 0) continue;
      var q = rt[key];
      if (!q) continue;
      if (q.jolt === 0 && q.joltV === 0 && q.joltWait <= 0 &&
          q.bufW < 1e-4 && q.bufE < 1e-4 && q.pitch === 0 && q.roll === 0) continue;
      q.bufWT = 0; q.bufET = 0;
      preDyn(q, d);
      applyPose(key, d, false);
    }

    /* 엔진 · 배기 · 롤링 사운드 */
    var accN = U.clamp(Math.max(0, j.ddu) * accScale, 0, 1);
    var spdN = U.clamp(curSpeed / 45, 0, 1);
    var loadT = (j.ph === 'prep') ? 0.62 * U.smooth(frac)
              : (j.ph === 'pull' || j.ph === 'propel') ? U.clamp(0.28 + spdN * 0.45 + accN * 0.55, 0, 1)
              : (j.ph === 'settle') ? 0.07 : 0.20;
    j.load = U.damp(j.load, loadT, 6.0, d);
    Aengine(true, j.load);
    Aroll(curSpeed);
    var lr = rt[LOCO_KEY];
    FXexhaust(lr && lr.rig ? lr.rig.exhaust : null, j.load);

    /* 강한 가속 중에는 동륜 근처에서 먼지가 인다 */
    if (!reduced && lr && moving) {
      j.dustT -= d;
      if (j.dustT <= 0 && accN > 0.45 && curSpeed > 2) {
        j.dustT = 0.075;
        FXdust(lr.group.position.clone().setY(lr.group.position.y + 0.28),
               U.clamp(accN * 0.7, 0, 1), null);
      }
    }

    if (j.t >= j.dur) advance();
  }

  function stepIdle(dt) {
    /* 정지 중에도 아이들 엔진과 배기는 계속 살아 있어야 한다 */
    var lr = rt[LOCO_KEY];
    Aengine(true, 0.05);
    FXexhaust(lr && lr.rig ? lr.rig.exhaust : null, 0.08);
    if (idleDecay <= 0) return;
    idleDecay -= dt;
    for (var key in pose) {
      var r = rt[key];
      if (!r) continue;
      r.bufWT = 0; r.bufET = 0;
      preDyn(r, dt);
      applyPose(key, dt, false);
    }
  }

  function update(dt) {
    try {
      if (!world || !rt) return;
      dt = +dt;
      if (!isFinite(dt) || dt <= 0) return;
      if (dt > MAX_DT) dt = MAX_DT;
      if (job) stepJob(dt);
      else stepIdle(dt);
    } catch (e) {
      U.err(e);
      if (job) { try { cancel(); } catch (e2) { U.err(e2); } }
    }
  }

  /* ── 초기화 ────────────────────────────────────────────────── */

  function init(w) {
    try {
      world = w || null;
      rt = Object.create(null);
      pose = Object.create(null);
      lastState = null;
      job = null; busy = false; curSpeed = 0; curVel = 0; idleDecay = 0;
      bumpNoise = U.noise2D('shunting-track-bumps');
      try {
        reduced = !!(window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { reduced = false; }
      if (!world) return;

      var idx = 0, r;
      r = makeRecord(LOCO_KEY, idx++); if (r) rt[LOCO_KEY] = r;
      var vs = world.vehicles;
      if (vs) {
        if (typeof vs.forEach === 'function' && typeof vs.get === 'function') {
          vs.forEach(function (v, id) { var q = makeRecord(id, idx++); if (q) rt[id] = q; });
        } else {
          for (var id in vs) { var q2 = makeRecord(id, idx++); if (q2) rt[id] = q2; }
        }
      }

      /* World.point 가 y=0(노반 상면)을 주면 레일 상면까지 올려 준다 */
      railLift = 0;
      var firstTrack = null;
      var tks = world.tracks;
      if (tks) {
        if (typeof tks.forEach === 'function' && typeof tks.get === 'function') {
          tks.forEach(function (t, id) { if (!firstTrack) firstTrack = id; });
        } else { for (var tid in tks) { firstTrack = tid; break; } }
      }
      if (firstTrack) {
        var p0 = pt(firstTrack, Math.min(10, trackLen(firstTrack) * 0.5));
        if (p0 && p0.pos && p0.pos.y < RAIL_Y * 0.5) railLift = RAIL_Y;
      }
    } catch (e) { U.err(e); }
  }

  function setSpeedScale(x) {
    x = +x;
    speedScale = (isFinite(x) && x > 0) ? U.clamp(x, 0.05, 20) : 1;
    return speedScale;
  }

  function poseOf(key) {
    var p = pose && pose[key];
    return p ? { track: p.track, s: p.s } : null;
  }

  /* ── 공개 API ──────────────────────────────────────────────── */
  var Motion = {
    LOCO: LOCO_KEY,
    init: init,
    snap: snap,
    execute: execute,
    update: update,
    cancel: cancel,
    setSpeedScale: setSpeedScale,
    poseOf: poseOf
  };
  Object.defineProperty(Motion, 'isBusy', { get: function () { return busy; }, enumerable: true });
  Object.defineProperty(Motion, 'speed', { get: function () { return curSpeed; }, enumerable: true });
  Object.defineProperty(Motion, 'velocity', { get: function () { return curVel; }, enumerable: true });
  Object.defineProperty(Motion, 'speedScale', { get: function () { return speedScale; }, enumerable: true });

  SH.Motion = Motion;
})();
