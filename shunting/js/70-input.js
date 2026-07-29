/* ============================================================================
   조차장 / SHUNTING — 70-input.js
   포인터/터치 입력 · 피킹 · 카메라 조작 · 키보드 접근성
   → SH.Input
   ============================================================================ */

/* CONTRACT ───────────────────────────────────────────────────────────────────
 *
 * SH.Input.init(canvasEl, hooks)
 *   hooks = {
 *     onTrack(id),          // 트랙(레일/발라스트/차막이/그 위 차량) 탭
 *     onCoupler(k),         // 연결기 탭. k = Puzzle.cut(k) 의 k (consist[k] 서쪽 연결부)
 *     onEmpty(),            // 아무것도 못 맞춤 → 선택 해제용
 *     onHoverTrack(id|null),// 데스크톱 호버. 지면 글로우 + 차량 살짝 띄우기 연출용
 *     // ↓ 접근성 키보드용 (선택). 없으면 Bus 이벤트만 발행됨.
 *     onUndo(), onRestart(), onHint(), onAdvance()
 *   }
 *
 * SH.Input.pickables(world, state)   // 이동/컷 직후마다 호출 → 레이캐스트 프록시 갱신
 * SH.Input.setEnabled(bool)          // false 여도 카메라 조작은 계속 동작 (애니메이션 감상)
 * SH.Input.isEnabled() -> bool
 * SH.Input.update(dt)                // (선택) 게임 루프에서 호출하면 내부 rAF 를 끔
 * SH.Input.dispose()
 * SH.Input.sensitivity = { orbit, pan, zoom, pinch }   // Render 로 넘기는 값의 배율
 * SH.Input.trackKeys -> ['S1','S2','S3','EXIT','HEAD'] // 숫자키 1..5 매핑 (world 에 있는 것만)
 *
 * 발행하는 Bus 이벤트
 *   'coupler:hover'  { index:Number|null, worldPos:THREE.Vector3|null }
 *   'input:tap'      { kind:'track'|'coupler'|'empty', id?, index?, worldPos? }
 *   'input:hoverTrack' { id:String|null }
 *   'input:undo' | 'input:restart' | 'input:hint' | 'input:advance'   (payload 없음)
 *   'input:camera'   { type:'orbit'|'pan'|'zoom' }   // 오토프레임 억제 등에 쓰라고
 *
 * Render 에 요구하는 것 (SPEC §6)
 *   Render.camera, Render.scene, Render.orbit(dx,dy), Render.pan(dx,dy), Render.zoom(dz)
 *   dx,dy 는 CSS 픽셀 델타. dz 는 휠 한 칸 ≈ 1.0 (양수 = 줌 아웃). 클램프는 Render 담당.
 *
 * 피킹 방식
 *   보이지 않는 "뚱뚱한" 프록시에만 레이캐스트한다. 프록시는 전용 레이어(1: 트랙/차량,
 *   2: 연결기)에 올라가고 camera.layers 에는 없으므로 렌더되지 않는다. 추가로
 *   object.visible = false 를 걸어 두는데, THREE 의 Raycaster 는 visible 을 보지 않으므로
 *   (r160 기준) 레이캐스트는 정상 동작한다. → overrideMaterial 프리패스에도 안 찍힘.
 *   트랙 프록시는 CurvePath 를 등간격 샘플링해 만든 박스 띠. 목(throat)에서 갈라지는
 *   구간은 제외한다(트랙의 홈 z 에서 0.75m 이상 벗어난 세그먼트를 버림).
 *
 * 다른 모듈이 알아야 할 것
 *   · 차량/연결기 프록시는 vehicle group 의 자식으로 붙는다. World.dispose() 전에
 *     Input.dispose() 또는 Input.pickables(null) 을 부르면 깨끗이 떨어진다.
 *   · 첫 포인터 입력에서 SH.Audio.unlock() 을 한 번 호출한다(있을 때만, try/catch).
 * ─────────────────────────────────────────────────────────────────────────── */

SH.Input = (function () {
  'use strict';

  var U = SH.U, Bus = SH.Bus;

  /* ── 상수 ──────────────────────────────────────────────────── */
  var LAYER_PICK = 1;          // 트랙 + 차량 프록시
  var LAYER_COUP = 2;          // 연결기 프록시

  var TAP_PX = 8;              // 탭 판정 이동 허용치 (CSS px)
  var TAP_MS = 300;            // 탭 판정 시간
  var HOVER_HZ = 32;           // 호버 레이캐스트 throttle

  /* 프록시 치수 — "넉넉하되 남의 트랙을 가리지 않을 만큼만".
     선로 중심 간격이 5.0m 이므로 폭 4.2 는 0.8m 여유만 남긴다. 높이는 실제 실루엣을
     넘지 않게 잡는다(넘으면 뒤쪽 측선을 가려서 탭이 엉뚱한 트랙으로 샌다 — 치명적).
     손가락 크기 보정은 3D 부피가 아니라 화면공간 링 샘플링(ringCast)으로 한다.
     높이 상한은 최소 앙각(18°)에서 결정된다: 옆 트랙 박스 가장자리까지의 Δz(≈2.9m)에
     tan(18°)=0.325 를 곱한 0.94m 보다 낮아야 뒤쪽 트랙이 가려지지 않는다. → 0.8 로 잡음. */
  var TRK_W = 4.2, TRK_Y0 = -0.7, TRK_Y1 = 0.8, TRK_SEG = 4.0;
  // 차량 프록시 박스 (실제 차체: 폭 3.0, 길이 12.0, 상단 y≈4.95, 연결 피치 13.0)
  var VEH_W = 3.6, VEH_H = 4.9, VEH_YC = 2.25, VEH_TRIM = 1.0;
  // 연결기 프록시 구
  var COUP_R_MOUSE = 1.15, COUP_R_TOUCH = 1.55;

  /* ── 모듈 상태 ─────────────────────────────────────────────── */
  var cv = null, H = null, inited = false, enabled = true;
  var touchy = false;                       // 터치 기기 → 넉넉한 타깃
  var ray = null, ndc = null, tmpV = null, tmpV2 = null, tmpQ = null, tmpM = null;

  var pickRoot = null, proxyMat = null;
  var trackProxies = [];                    // {mesh, id}
  var vehProxies = [];                      // {mesh, parent}
  var coupProxies = [];                     // {mesh, parent, index}
  var unitBox = null, unitSphere = null, boxTmpl = null;
  var curWorld = null, curState = null;
  var vehTrack = Object.create(null);       // vehId -> trackId
  var matrixDirty = true;

  var hoverTrack = null, hoverCoup = null, lastHoverT = 0;
  var rect = null, rectT = 0;

  /* 포인터 / 제스처 */
  var pointers = new Map();
  var mode = 'none';                        // 'none'|'tap'|'orbit'|'pan'|'pinch'
  var tapCand = null;                       // {x,y,t,id}
  var suppressTapUntil = 0;
  var pinch = { dist: 0, mx: 0, my: 0 };
  var vel = { ox: 0, oy: 0, px: 0, py: 0 }; // 관성 속도 (px/s)
  var lastMoveT = 0;
  var zoomAccum = 0;

  /* 루프 */
  var rafId = 0, lastT = 0, extDriven = false, disposed = false;
  var audioUnlocked = false;
  var prevCursor = '', prevOverscrollH = '', prevOverscrollB = '';

  var sensitivity = { orbit: 1, pan: 1, zoom: 1, pinch: 1 };
  var trackKeys = ['S1', 'S2', 'S3', 'EXIT', 'HEAD'];

  /* ── 작은 헬퍼 ─────────────────────────────────────────────── */
  function noop() {}
  function R() { return SH.Render || null; }
  function cam() { var r = R(); return (r && r.camera) || null; }
  function scn() { var r = R(); return (r && r.scene) || null; }

  function getRect() {
    var t = U.now();
    if (!rect || t - rectT > 250) { rect = cv.getBoundingClientRect(); rectT = t; }
    return rect;
  }

  function emit(evt, payload) { try { Bus.emit(evt, payload); } catch (e) { U.err(e); } }

  /* ── 프록시 만들기 ─────────────────────────────────────────── */

  function ensureShared() {
    if (!proxyMat) {
      proxyMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
      proxyMat.visible = false;
    }
    if (!unitBox) unitBox = new THREE.BoxGeometry(1, 1, 1);
    if (!unitSphere) unitSphere = new THREE.SphereGeometry(1, 10, 8);
    if (!boxTmpl) {
      var g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      boxTmpl = Float32Array.from(g.attributes.position.array);
      g.dispose();
    }
  }

  function markProxy(obj, layer) {
    obj.layers.set(layer);
    obj.visible = false;          // 렌더 제외. Raycaster 는 visible 을 보지 않음.
    obj.matrixAutoUpdate = true;
    obj.frustumCulled = false;
    obj.renderOrder = -1000;
  }

  /** 단위 박스를 m4 로 변환해 out(Array) 에 36개 정점으로 밀어 넣는다 */
  function appendBox(out, m4, sx, sy, sz) {
    var t = boxTmpl, v = tmpV;
    for (var i = 0; i < t.length; i += 3) {
      v.set(t[i] * sx, t[i + 1] * sy, t[i + 2] * sz).applyMatrix4(m4);
      out.push(v.x, v.y, v.z);
    }
  }

  /** CurvePath 를 등간격 샘플링해 트랙별 뚱뚱한 박스 띠를 만든다 */
  function buildTrackProxy(track) {
    var curve = track.curve;
    if (!curve || typeof curve.getSpacedPoints !== 'function') return null;

    var L = track.length || (curve.getLength ? curve.getLength() : 0);
    if (!(L > 1)) return null;

    var n = Math.max(2, Math.min(220, Math.round(L / TRK_SEG)));
    var pts = curve.getSpacedPoints(n);
    if (!pts || pts.length < 2) return null;

    // 동쪽 끝(차막이 쪽)의 z 를 "홈 z" 로 보고, 목에서 갈라지는 구간은 버린다.
    var homeZ = pts[pts.length - 1].z;
    var pos = [], kept = 0, i;
    var yMid = (TRK_Y0 + TRK_Y1) * 0.5, yH = (TRK_Y1 - TRK_Y0);

    for (var pass = 0; pass < 2; pass++) {
      pos.length = 0; kept = 0;
      for (i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var mz = (a.z + b.z) * 0.5;
        if (pass === 0 && Math.abs(mz - homeZ) > 0.75) continue;
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        var seg = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (seg < 1e-4) continue;
        var yaw = Math.atan2(-dz, dx);
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        tmpV2.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5 + yMid, (a.z + b.z) * 0.5);
        tmpM.compose(tmpV2, tmpQ, new THREE.Vector3(1, 1, 1));
        appendBox(pos, tmpM, seg * 1.06, yH, TRK_W);
        kept++;
      }
      if (kept >= 3) break;       // 1패스에서 충분하면 끝, 아니면 클리핑 없이 재시도
    }
    if (!kept) return null;

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.computeBoundingSphere();

    var mesh = new THREE.Mesh(geo, proxyMat);
    markProxy(mesh, LAYER_PICK);
    mesh.userData.pickKind = 'track';
    mesh.userData.trackId = track.id;
    return mesh;
  }

  function buildTrackProxies(world) {
    if (!world || !world.tracks) return;
    var root = pickRoot;
    world.tracks.forEach(function (t) {
      var m = null;
      try { m = buildTrackProxy(t); } catch (e) { U.err(e); }
      if (m) { root.add(m); trackProxies.push({ mesh: m, id: t.id }); }
    });
  }

  function addVehProxy(v) {
    if (!v || !v.group) return;
    var len = v.len || (v.rig && v.rig.length) || 13.0;
    var m = new THREE.Mesh(unitBox, proxyMat);
    m.scale.set(Math.max(4, len - VEH_TRIM), VEH_H, VEH_W);
    m.position.set(0, VEH_YC, 0);
    markProxy(m, LAYER_PICK);
    m.userData.pickKind = 'veh';
    m.userData.vehId = v.id;
    v.group.add(m);
    vehProxies.push({ mesh: m, parent: v.group });
  }

  function buildVehProxies(world) {
    if (!world) return;
    if (world.vehicles && world.vehicles.forEach) world.vehicles.forEach(function (v) { addVehProxy(v); });
    if (world.loco) addVehProxy(world.loco);
  }

  function clearTrackProxies() {
    for (var i = 0; i < trackProxies.length; i++) {
      var m = trackProxies[i].mesh;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    trackProxies.length = 0;
  }

  function clearVehProxies() {
    for (var i = 0; i < vehProxies.length; i++) {
      var p = vehProxies[i];
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    }
    vehProxies.length = 0;
  }

  function clearCoupProxies() {
    for (var i = 0; i < coupProxies.length; i++) {
      var p = coupProxies[i];
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    }
    coupProxies.length = 0;
    if (hoverCoup !== null) { hoverCoup = null; emit('coupler:hover', { index: null, worldPos: null }); }
  }

  /** consist 의 연결부마다 작은 프록시 구. index k = Puzzle.cut(k) 의 k */
  function buildCoupProxies(world, state) {
    if (!world || !state || !state.consist || !state.consist.length) return;
    var radius = touchy ? COUP_R_TOUCH : COUP_R_MOUSE;

    for (var k = 0; k < state.consist.length; k++) {
      var v = world.vehicles && world.vehicles.get ? world.vehicles.get(state.consist[k]) : null;
      if (!v || !v.group) continue;

      var rig = v.rig || v.group.userData.rig || null;
      var host = (rig && rig.couplers && rig.couplers.w) ? rig.couplers.w : v.group;
      var m = new THREE.Mesh(unitSphere, proxyMat);
      m.scale.setScalar(radius);
      if (host === v.group) {
        var len = v.len || (rig && rig.length) || 13.0;
        m.position.set(-len * 0.5 + 0.35, 0.95, 0);
      } else {
        m.position.set(0, 0, 0);
      }
      markProxy(m, LAYER_COUP);
      m.userData.pickKind = 'coupler';
      m.userData.index = k;
      host.add(m);
      coupProxies.push({ mesh: m, parent: host, index: k });
    }
  }

  function rebuildVehTrackMap(world, state) {
    vehTrack = Object.create(null);
    if (!state) return;
    var t = state.tracks || {};
    for (var id in t) {
      var arr = t[id];
      if (!arr) continue;
      for (var i = 0; i < arr.length; i++) vehTrack[arr[i]] = id;
    }
    var at = state.at;
    if (at && state.consist) for (var j = 0; j < state.consist.length; j++) vehTrack[state.consist[j]] = at;
    if (at && world && world.loco) vehTrack[world.loco.id] = at;
  }

  /** SPEC §6: 매 이동 후 호출. world 를 null 로 주면 프록시를 전부 제거한다. */
  function pickables(world, state) {
    try {
      ensureShared();
      var sc = scn();
      if (!pickRoot) { pickRoot = new THREE.Group(); pickRoot.name = 'SH.Input.pick'; }
      if (sc && pickRoot.parent !== sc) sc.add(pickRoot);

      if (world !== curWorld) {
        clearCoupProxies(); clearVehProxies(); clearTrackProxies();
        curWorld = world || null;
        if (curWorld) { buildTrackProxies(curWorld); buildVehProxies(curWorld); }
      } else {
        clearCoupProxies();
      }
      curState = state || null;
      rebuildVehTrackMap(curWorld, curState);
      if (curWorld && curState) buildCoupProxies(curWorld, curState);
      matrixDirty = true;

      if (curWorld && curWorld.tracks) {
        var have = [];
        for (var i = 0; i < trackKeys.length; i++) if (curWorld.tracks.get(trackKeys[i])) have.push(trackKeys[i]);
        if (have.length) API.trackKeys = have;
      }
    } catch (e) { U.err(e); }
  }

  /* ── 레이캐스트 ────────────────────────────────────────────── */

  function castLayer(px, py, layer) {
    var c = cam();
    if (!c) return null;
    var rc = getRect();
    if (!rc.width || !rc.height) return null;
    ndc.x = ((px - rc.left) / rc.width) * 2 - 1;
    ndc.y = -((py - rc.top) / rc.height) * 2 + 1;
    if (ndc.x < -1.02 || ndc.x > 1.02 || ndc.y < -1.02 || ndc.y > 1.02) return null;

    if (matrixDirty) {
      var sc = scn();
      if (sc) sc.updateMatrixWorld(true);
      else if (pickRoot) pickRoot.updateMatrixWorld(true);
      matrixDirty = false;
    }
    ray.layers.set(layer);
    ray.setFromCamera(ndc, c);

    var targets = (layer === LAYER_COUP) ? coupList() : pickList();
    if (!targets.length) return null;
    var hits = ray.intersectObjects(targets, false);
    return hits.length ? hits[0] : null;
  }

  var _pickList = [], _coupList = [];
  function pickList() {
    _pickList.length = 0;
    var i;
    for (i = 0; i < trackProxies.length; i++) _pickList.push(trackProxies[i].mesh);
    for (i = 0; i < vehProxies.length; i++) _pickList.push(vehProxies[i].mesh);
    return _pickList;
  }
  function coupList() {
    _coupList.length = 0;
    for (var i = 0; i < coupProxies.length; i++) _coupList.push(coupProxies[i].mesh);
    return _coupList;
  }

  var RING = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
              [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

  /** 손가락 크기 보정: 중심이 빗나가면 주변 링을 훑어 가장 가까운 히트를 고른다 */
  function ringCast(px, py, r, layer) {
    if (r <= 0) return null;
    var best = null;
    for (var i = 0; i < RING.length; i++) {
      var h = castLayer(px + RING[i][0] * r, py + RING[i][1] * r, layer);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  }

  /**
   * @returns {kind:'coupler', index, worldPos} | {kind:'track', id, worldPos} | null
   */
  function pickAt(px, py, forgiving) {
    var h;
    // 1) 연결기 우선 (차량 박스보다 안쪽에 있으므로 별도 레이어에서 먼저 본다)
    if (coupProxies.length) {
      h = castLayer(px, py, LAYER_COUP);
      if (!h && forgiving) h = ringCast(px, py, touchy ? 14 : 6, LAYER_COUP);
      if (h) return { kind: 'coupler', index: h.object.userData.index | 0, worldPos: h.point.clone() };
    }
    // 2) 트랙 / 차량. 빗나가면 반경을 넓혀 가며 링 샘플링 — 화면에서 가까운 쪽이 먼저 이긴다.
    h = castLayer(px, py, LAYER_PICK);
    if (!h && forgiving) {
      var r = touchy ? 24 : 10;
      h = ringCast(px, py, r * 0.25, LAYER_PICK) ||
          ringCast(px, py, r * 0.55, LAYER_PICK) ||
          ringCast(px, py, r, LAYER_PICK) ||
          ringCast(px, py, r * 1.9, LAYER_PICK);
    }
    if (h) {
      var ud = h.object.userData;
      var id = (ud.pickKind === 'veh') ? vehTrack[ud.vehId] : ud.trackId;
      if (id) return { kind: 'track', id: id, worldPos: h.point.clone() };
    }
    return null;
  }

  /* ── 호버 (데스크톱) ───────────────────────────────────────── */

  function setHoverTrack(id) {
    if (id === hoverTrack) return;
    hoverTrack = id;
    try { H.onHoverTrack(id || null); } catch (e) { U.err(e); }
    emit('input:hoverTrack', { id: id || null });
  }

  function setHoverCoupler(index, worldPos) {
    if (index === hoverCoup) return;
    hoverCoup = index;
    emit('coupler:hover', { index: (index == null ? null : index), worldPos: worldPos || null });
  }

  function clearHover() {
    setHoverTrack(null);
    setHoverCoupler(null, null);
    if (cv) cv.style.cursor = 'grab';
  }

  function doHover(e) {
    var t = U.now();
    if (t - lastHoverT < 1000 / HOVER_HZ) return;
    lastHoverT = t;
    if (!enabled) { clearHover(); return; }

    var p = pickAt(e.clientX, e.clientY, false);
    if (p && p.kind === 'coupler') {
      setHoverTrack(null);
      setHoverCoupler(p.index, p.worldPos);
      cv.style.cursor = 'pointer';
    } else if (p && p.kind === 'track') {
      setHoverCoupler(null, null);
      setHoverTrack(p.id);
      cv.style.cursor = 'pointer';
    } else {
      setHoverCoupler(null, null);
      setHoverTrack(null);
      cv.style.cursor = 'grab';
    }
  }

  /* ── 탭 처리 ───────────────────────────────────────────────── */

  function doTap(px, py) {
    if (!enabled) return;
    var p = pickAt(px, py, true);
    if (!p) {
      try { H.onEmpty(); } catch (e) { U.err(e); }
      emit('input:tap', { kind: 'empty' });
      return;
    }
    if (p.kind === 'coupler') {
      try { H.onCoupler(p.index); } catch (e2) { U.err(e2); }
      emit('input:tap', { kind: 'coupler', index: p.index, worldPos: p.worldPos });
    } else {
      try { H.onTrack(p.id); } catch (e3) { U.err(e3); }
      emit('input:tap', { kind: 'track', id: p.id, worldPos: p.worldPos });
    }
  }

  /* ── 카메라 조작 ───────────────────────────────────────────── */

  function camOrbit(dx, dy) {
    var r = R(); if (!r || !r.orbit) return;
    try { r.orbit(dx * sensitivity.orbit, dy * sensitivity.orbit); } catch (e) { U.err(e); }
  }
  function camPan(dx, dy) {
    var r = R(); if (!r || !r.pan) return;
    try { r.pan(dx * sensitivity.pan, dy * sensitivity.pan); } catch (e) { U.err(e); }
  }
  function camZoom(dz) {
    var r = R(); if (!r || !r.zoom) return;
    try { r.zoom(dz * sensitivity.zoom); } catch (e) { U.err(e); }
  }

  /* ── 포인터 이벤트 ─────────────────────────────────────────── */

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { if (SH.Audio && SH.Audio.unlock) SH.Audio.unlock(); } catch (e) { U.err(e); }
  }

  function pinchState() {
    var a = null, b = null;
    pointers.forEach(function (p) { if (!a) a = p; else if (!b) b = p; });
    if (!a || !b) return null;
    var dx = b.x - a.x, dy = b.y - a.y;
    return { dist: Math.sqrt(dx * dx + dy * dy) || 1, mx: (a.x + b.x) * 0.5, my: (a.y + b.y) * 0.5 };
  }

  function onDown(e) {
    if (disposed) return;
    unlockAudio();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 불가 = 무시 */ }
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body &&
        document.activeElement.blur && document.activeElement !== cv) {
      // HUD 버튼에 포커스가 남아 스페이스가 두 번 먹는 것 방지
      try { document.activeElement.blur(); } catch (err2) { /* noop */ }
    }

    pointers.set(e.pointerId, {
      id: e.pointerId, x: e.clientX, y: e.clientY,
      lx: e.clientX, ly: e.clientY, t: U.now(), type: e.pointerType, button: e.button
    });
    vel.ox = vel.oy = vel.px = vel.py = 0;   // 관성 즉시 정지
    lastMoveT = U.now();

    if (pointers.size === 1) {
      var right = (e.button === 2 || e.button === 1 || (e.button === 0 && e.ctrlKey && e.pointerType === 'mouse'));
      mode = right ? 'pan' : 'tap';
      tapCand = right ? null : { x: e.clientX, y: e.clientY, t: U.now(), id: e.pointerId, travel: 0 };
      cv.style.cursor = right ? 'move' : 'grabbing';
    } else if (pointers.size === 2) {
      mode = 'pinch';
      tapCand = null;
      var ps = pinchState();
      if (ps) { pinch.dist = ps.dist; pinch.mx = ps.mx; pinch.my = ps.my; }
      cv.style.cursor = 'move';
    } else {
      mode = 'pinch';
      tapCand = null;
    }
    if (mode !== 'tap') clearHover();
  }

  function onMove(e) {
    if (disposed) return;
    var p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && pointers.size === 0) doHover(e);
      return;
    }
    e.preventDefault();

    var now = U.now();
    var dt = Math.max(0.001, (now - lastMoveT) / 1000);
    var dx = e.clientX - p.lx, dy = e.clientY - p.ly;
    p.lx = e.clientX; p.ly = e.clientY; p.x = e.clientX; p.y = e.clientY;
    lastMoveT = now;

    if (mode === 'pinch' || pointers.size >= 2) {
      var ps = pinchState();
      if (ps) {
        var dz = (pinch.dist - ps.dist) / 55 * sensitivity.pinch;
        if (dz) camZoom(U.clamp(dz, -2.5, 2.5));
        var mdx = ps.mx - pinch.mx, mdy = ps.my - pinch.my;
        if (mdx || mdy) {
          camPan(mdx, mdy);
          vel.px = U.lerp(vel.px, mdx / dt, 0.35);
          vel.py = U.lerp(vel.py, mdy / dt, 0.35);
        }
        pinch.dist = ps.dist; pinch.mx = ps.mx; pinch.my = ps.my;
        emit('input:camera', { type: 'zoom' });
      }
      return;
    }

    if (mode === 'tap' && tapCand) {
      var tdx = e.clientX - tapCand.x, tdy = e.clientY - tapCand.y;
      tapCand.travel = Math.sqrt(tdx * tdx + tdy * tdy);
      if (tapCand.travel <= TAP_PX && (now - tapCand.t) <= TAP_MS) return;   // 아직 탭 후보
      mode = 'orbit';                       // 8px 넘김 → 카메라 조작으로 승격
      tapCand = null;
      cv.style.cursor = 'grabbing';
    }

    if (mode === 'orbit') {
      camOrbit(dx, dy);
      vel.ox = U.lerp(vel.ox, dx / dt, 0.35);
      vel.oy = U.lerp(vel.oy, dy / dt, 0.35);
      emit('input:camera', { type: 'orbit' });
    } else if (mode === 'pan') {
      camPan(dx, dy);
      vel.px = U.lerp(vel.px, dx / dt, 0.35);
      vel.py = U.lerp(vel.py, dy / dt, 0.35);
      emit('input:camera', { type: 'pan' });
    }
  }

  function endPointer(e, cancelled) {
    if (disposed) return;
    var p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }

    var now = U.now();

    if (pointers.size >= 1) {
      // 멀티터치 → 손가락 하나 뗌. 남은 포인터 기준을 다시 잡아 점프 방지.
      var ps = pinchState();
      if (ps) { pinch.dist = ps.dist; pinch.mx = ps.mx; pinch.my = ps.my; mode = 'pinch'; }
      else {
        pointers.forEach(function (q) { q.lx = q.x; q.ly = q.y; });
        mode = 'orbit';
      }
      suppressTapUntil = now + 350;
      tapCand = null;
      return;
    }

    // 마지막 포인터
    var wasTap = !cancelled && mode === 'tap' && tapCand &&
                 tapCand.travel <= TAP_PX && (now - tapCand.t) <= TAP_MS &&
                 now >= suppressTapUntil;

    if (wasTap) {
      vel.ox = vel.oy = vel.px = vel.py = 0;
      doTap(e.clientX, e.clientY);
    } else if (!cancelled) {
      // 관성: 손을 뗀 직전에 실제로 움직이고 있었을 때만
      if (now - lastMoveT > 110) { vel.ox = vel.oy = vel.px = vel.py = 0; }
    } else {
      vel.ox = vel.oy = vel.px = vel.py = 0;
    }

    mode = 'none';
    tapCand = null;
    cv.style.cursor = (e.pointerType === 'mouse') ? 'grab' : '';
    if (e.pointerType === 'mouse') doHover(e);
  }

  function onUp(e) { endPointer(e, false); }
  function onCancel(e) { endPointer(e, true); }

  function onLeave(e) {
    if (pointers.size === 0) clearHover();
  }

  function onWheel(e) {
    if (disposed) return;
    e.preventDefault();
    var m = (e.deltaMode === 1) ? 16 : (e.deltaMode === 2 ? 100 : 1);
    if (e.shiftKey && !e.ctrlKey) {          // shift+휠 = 가로 팬
      camPan(-e.deltaY * m * 0.6, 0);
      emit('input:camera', { type: 'pan' });
      return;
    }
    var d = e.deltaY * m / 100;
    if (e.ctrlKey) d *= 2.2;                 // 트랙패드 핀치 제스처
    zoomAccum = U.clamp(zoomAccum + U.clamp(d, -3, 3), -9, 9);
    emit('input:camera', { type: 'zoom' });
  }

  function onContext(e) { e.preventDefault(); return false; }
  function onGesture(e) { e.preventDefault(); }
  function onTouchMove(e) { if (e.cancelable) e.preventDefault(); }   // 스크롤 바운스 차단
  function onDblClick(e) { e.preventDefault(); }                      // 더블탭 줌 차단

  function onBlur() {
    pointers.clear();
    mode = 'none'; tapCand = null;
    vel.ox = vel.oy = vel.px = vel.py = 0;
    clearHover();
  }

  /* ── 키보드 (접근성) ───────────────────────────────────────── */

  function typingTarget(t) {
    if (!t || !t.tagName) return false;
    var n = t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable === true;
  }

  function onKey(e) {
    if (disposed) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typingTarget(e.target)) return;

    var k = e.key;
    var handled = true;

    if (k >= '1' && k <= '9') {
      if (!enabled) return;
      var idx = parseInt(k, 10) - 1;
      var list = API.trackKeys;
      if (idx < list.length) {
        try { H.onTrack(list[idx]); } catch (err) { U.err(err); }
        emit('input:tap', { kind: 'track', id: list[idx], via: 'key' });
      }
    } else if (k === 'z' || k === 'Z' || k === 'ㅋ') {
      try { H.onUndo(); } catch (e1) { U.err(e1); }
      emit('input:undo');
    } else if (k === 'r' || k === 'R' || k === 'ㄱ') {
      try { H.onRestart(); } catch (e2) { U.err(e2); }
      emit('input:restart');
    } else if (k === 'h' || k === 'H' || k === 'ㅗ') {
      try { H.onHint(); } catch (e3) { U.err(e3); }
      emit('input:hint');
    } else if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      try { H.onAdvance(); } catch (e4) { U.err(e4); }
      emit('input:advance');
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  }

  /* ── 루프 (관성 · 줌 스무딩) ───────────────────────────────── */

  function update(dt) {
    if (disposed) return;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;

    // 줌은 항상 부드럽게 흘려보낸다
    if (Math.abs(zoomAccum) > 1e-4) {
      var step = zoomAccum * (1 - Math.exp(-14 * dt));
      zoomAccum -= step;
      camZoom(step);
      if (Math.abs(zoomAccum) < 1e-4) zoomAccum = 0;
    }

    if (pointers.size > 0) return;           // 드래그 중엔 관성 없음

    var decay = Math.exp(-5.2 * dt);
    if (Math.abs(vel.ox) > 2 || Math.abs(vel.oy) > 2) {
      camOrbit(vel.ox * dt, vel.oy * dt);
      vel.ox *= decay; vel.oy *= decay;
      if (Math.abs(vel.ox) <= 2) vel.ox = 0;
      if (Math.abs(vel.oy) <= 2) vel.oy = 0;
    }
    var pdecay = Math.exp(-6.0 * dt);
    if (Math.abs(vel.px) > 2 || Math.abs(vel.py) > 2) {
      camPan(vel.px * dt, vel.py * dt);
      vel.px *= pdecay; vel.py *= pdecay;
      if (Math.abs(vel.px) <= 2) vel.px = 0;
      if (Math.abs(vel.py) <= 2) vel.py = 0;
    }
  }

  function tick() {
    rafId = 0;
    if (disposed || extDriven) return;
    var t = U.now();
    var dt = lastT ? (t - lastT) / 1000 : 0.016;
    lastT = t;
    try { update(dt); } catch (e) { U.err(e); }
    rafId = requestAnimationFrame(tick);
  }

  /* ── init / dispose ────────────────────────────────────────── */

  var LISTENERS = [];
  function on(target, evt, fn, opts) {
    target.addEventListener(evt, fn, opts);
    LISTENERS.push([target, evt, fn, opts]);
  }

  function init(canvasEl, hooks) {
    if (inited) dispose();
    disposed = false;
    cv = canvasEl;
    if (!cv) { U.err(new Error('Input.init: canvas 없음')); return API; }

    hooks = hooks || {};
    H = {
      onTrack: hooks.onTrack || noop,
      onCoupler: hooks.onCoupler || noop,
      onEmpty: hooks.onEmpty || noop,
      onHoverTrack: hooks.onHoverTrack || noop,
      onUndo: hooks.onUndo || noop,
      onRestart: hooks.onRestart || noop,
      onHint: hooks.onHint || noop,
      onAdvance: hooks.onAdvance || noop
    };

    touchy = U.isTouch();
    ray = new THREE.Raycaster();
    ray.layers.set(LAYER_PICK);
    ndc = new THREE.Vector2();
    tmpV = new THREE.Vector3(); tmpV2 = new THREE.Vector3();
    tmpQ = new THREE.Quaternion(); tmpM = new THREE.Matrix4();
    ensureShared();

    // 브라우저 기본 동작 차단
    prevCursor = cv.style.cursor;
    cv.style.touchAction = 'none';
    cv.style.userSelect = 'none';
    cv.style.webkitUserSelect = 'none';
    cv.style.webkitTapHighlightColor = 'rgba(0,0,0,0)';
    cv.style.webkitTouchCallout = 'none';
    cv.style.overscrollBehavior = 'none';
    cv.style.cursor = touchy ? '' : 'grab';
    try {
      prevOverscrollH = document.documentElement.style.overscrollBehavior;
      prevOverscrollB = document.body.style.overscrollBehavior;
      document.documentElement.style.overscrollBehavior = 'none';
      document.body.style.overscrollBehavior = 'none';
    } catch (e) { U.err(e); }

    on(cv, 'pointerdown', onDown);
    on(cv, 'pointermove', onMove);
    on(cv, 'pointerup', onUp);
    on(cv, 'pointercancel', onCancel);
    on(cv, 'lostpointercapture', onCancel);
    on(cv, 'pointerleave', onLeave);
    on(cv, 'wheel', onWheel, { passive: false });
    on(cv, 'contextmenu', onContext);
    on(cv, 'dblclick', onDblClick);
    on(cv, 'touchmove', onTouchMove, { passive: false });
    on(cv, 'gesturestart', onGesture);
    on(cv, 'gesturechange', onGesture);
    on(cv, 'gestureend', onGesture);
    on(window, 'keydown', onKey);
    on(window, 'blur', onBlur);
    on(window, 'resize', function () { rect = null; });
    on(window, 'scroll', function () { rect = null; }, true);

    inited = true;
    enabled = true;
    lastT = 0;
    if (!extDriven && !rafId) rafId = requestAnimationFrame(tick);
    return API;
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) clearHover();
    return enabled;
  }

  function dispose() {
    disposed = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

    for (var i = 0; i < LISTENERS.length; i++) {
      var L = LISTENERS[i];
      try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) { /* noop */ }
    }
    LISTENERS.length = 0;

    clearCoupProxies(); clearVehProxies(); clearTrackProxies();
    if (pickRoot && pickRoot.parent) pickRoot.parent.remove(pickRoot);
    pickRoot = null;

    if (unitBox) { unitBox.dispose(); unitBox = null; }
    if (unitSphere) { unitSphere.dispose(); unitSphere = null; }
    if (proxyMat) { proxyMat.dispose(); proxyMat = null; }
    boxTmpl = null;

    if (cv) {
      try {
        cv.style.cursor = prevCursor;
        document.documentElement.style.overscrollBehavior = prevOverscrollH;
        document.body.style.overscrollBehavior = prevOverscrollB;
      } catch (e2) { /* noop */ }
    }

    pointers.clear();
    curWorld = null; curState = null; vehTrack = Object.create(null);
    hoverTrack = null; hoverCoup = null;
    mode = 'none'; tapCand = null;
    vel.ox = vel.oy = vel.px = vel.py = 0; zoomAccum = 0;
    inited = false; cv = null; H = null;
  }

  /* ── 공개 API ──────────────────────────────────────────────── */
  var API = {
    init: init,
    pickables: pickables,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    update: function (dt) {
      if (!extDriven) { extDriven = true; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
      update(dt);
    },
    dispose: dispose,
    sensitivity: sensitivity,
    trackKeys: trackKeys,
    LAYER_PICK: LAYER_PICK,
    LAYER_COUP: LAYER_COUP
  };
  return API;
})();
