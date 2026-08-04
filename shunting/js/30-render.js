/* ============================================================================
   조차장 / SHUNTING — 30-render.js
   렌더러 · 카메라 리그 · 라이팅 · 자체 구현 포스트프로세싱 체인
   → SH.Render
   ============================================================================ */

/* CONTRACT ===================================================================
   SPEC.md §6 Render 계약 + 확장. 이 파일의 공개 API 는 아래가 전부입니다.

   Render.init(canvasEl) -> { renderer, scene, camera }
   Render.scene / .camera / .renderer / .maxAniso / .sunDir / .quality / .info
   Render.frame(dt)                 // 한 프레임 렌더 (Game 이 매 rAF 호출)
   Render.setQuality(q)             // 0 low | 1 med | 2 high
   Render.autoQuality(dt)           // frame() 이 내부 호출. 저사양 자동 강등(최대 2단)
   Render.resize()
   Render.frameBounds(box3, opts)   // opts {margin, instant, azimuth, elevation, yBias}
   Render.orbit(dx,dy) / .zoom(dz) / .pan(dx,dy)      // 픽셀 델타
   Render.shake(strength)
   Render.setTimeOfDay(t)           // 0 dawn · .5 noon · 1 dusk
   Render.screenPos(vec3) -> {x,y,visible}            // CSS px, 캔버스 좌상단 기준
   Render.dispose()

   — 확장 API (다른 모듈이 써도 됨) —
   Render.setCam({azimuth,elevation,distance,target,instant})   // deg / 미터
   Render.getCam() -> {azimuth,elevation,distance,target}
   Render.setSceneBounds(box3)      // 그림자 ortho + 근/원평면 피팅 대상. World 가 호출 권장.
   Render.attachAO(root)            // root 이하 머티리얼에 SSAO/헤이즈 주입 (자동으로도 돌지만
                                    // World.build 직후 한 번 불러주면 첫 프레임부터 정확)
   Render.setExposure(v) / .setAO({radius,strength,power,bias,mix})
   Render.setPost({bloom,threshold,knee,vignette,grain,ca,sat,haze,hazeTop,hazeRange,
                   white,contrast,specAA})
     · white   = 이 **선형값**이 화면에서 순백(255)이 된다. 톤커브의 어깨 위치.
     · contrast= 필름 S커브 혼합량.  · specAA = 노멀 분산 → 러프니스(모아레 억제).
   Render.setEnvMap(tex)            // 외부 환경맵으로 교체(선택)
   Render.lampsOn -> bool           // 가로등 켜는 시각인가 (setTimeOfDay 가 결정)
   Render.timeOfDay -> number

   — 이벤트 —
   SH.Bus.emit('render:tod', {t, lampsOn, sunDir, keyColor})   // setTimeOfDay 마다
   SH.Bus.on('world:ready' | 'world:built', payload)           // payload.bounds(Box3) 있으면 사용
   SH.Bus.on('scene:dirty')                                    // 머티리얼 재스캔 요청

   — 다른 모듈이 알아야 할 것 —
   * renderer.toneMapping = NoToneMapping 입니다. ACES 는 **합성 패스에서 직접** 적용합니다
     (중간 RT 는 HalfFloat 선형 HDR 이어야 블룸 임계값이 의미를 가짐). 노출은 Render.setExposure().
   * 키 라이트 세기는 물리 스케일(태양 E ≈ π/sinθ)입니다. 화면이 어둡다고 머티리얼 albedo 를
     올리지 마세요 — 노출/라이트는 여기서 이미 맞춰져 있습니다.
   * setTimeOfDay() 는 SH.Mat.setEnvIntensity(scale) 를 시간대별로 호출합니다(있으면).
   * scene.background 는 null. 하늘은 씬 안에 들어있는 풀스크린 트라이앵글(renderOrder -100000,
     depthTest:false)이 그립니다. World.dispose() 로 씬을 비워도 매 프레임 자동 복구합니다.
   * MeshStandard/Physical/Phong/Lambert 머티리얼에는 onBeforeCompile 이 **체이닝**으로 주입됩니다
     (기존 onBeforeCompile 은 먼저 호출됨). 주입 내용: 화면공간 AO 를 indirect 항에만 곱하기 +
     섬 **밑동만** 구름 바다 색으로 녹이는 고도 기반 에어리얼(기본 y<−10 부터, 세기 0.22).
     상판·절벽 지층은 건드리지 않습니다. Render.setPost({haze,hazeTop,hazeRange}) 로 조정.
     → 머티리얼을 나중에 만들거나 갈아끼워도 자동 재스캔되지만, 즉시 반영하려면
       Render.attachAO(obj) 또는 SH.Bus.emit('scene:dirty').
   * 프리패스(깊이/노멀)에서 제외하고 싶은 오브젝트는 userData.noPrepass = true 로 표시.
     Points/Sprite/Line/transparent 머티리얼은 자동 제외됩니다.
   * Render.sunDir 은 **씬에서 태양을 향하는** 정규화 벡터(빛의 진행 방향이 아님).
   * 카메라 azimuth 는 "정남(+Z)에서 서(−X)쪽으로 잰 각(도)". 기본 −30°(= 남남동 쪽에서 봄).
     기본 elevation 은 **26°** — 이보다 높이면 섬이 납작해지고 옆면 지층이 안 보인다.
     클램프: azimuth −68..+8 · elevation 17..54 · distance 95..330(세로 화면은 최대 3배까지
     자동 확장 — fov 24 로는 세로 폰에서 야드 전체가 안 들어오기 때문).
   * setSceneBounds() 는 **카메라를 건드리지 않습니다**. 프레이밍은 Game/Input 의 frameBounds()
     담당. frameBounds 는 바운딩 스피어가 아니라 박스를 시점 축에 투영한 정확한 피팅입니다.
   * scene.fog 의 near/far 는 매 프레임 씬 바운즈 기준으로 재계산됩니다(가장 먼 지점 ≈ 8.5% 안개).
     고정값으로 덮어쓰지 마세요 — 카메라가 멀어지면 섬 전체가 안개에 먹힙니다.
   * PMREM 환경맵은 timeOfDay 로부터 이 모듈이 직접 만듭니다. Tex.skyGradient() 는 쓰지 않습니다
     (HDR + 시각 연동이 필요해서). 바꾸고 싶으면 Render.setEnvMap(tex).
   =========================================================================== */
(function () {
  'use strict';

  var SH = window.SH;
  var U = SH.U;

  SH.Render = (function () {

    /* ══════════════════════════════════════════════════════════════════
       상수 / 품질 프리셋
       ══════════════════════════════════════════════════════════════════ */

    var DEG = Math.PI / 180;

    /* shadowRadius 는 **텍셀 단위** PCF 커널 반경입니다.
       ★ shadowMap.type = PCFShadowMap 을 씁니다(PCFSoftShadowMap 은 three 내부에서
         shadow.radius 를 **무시**하고 고정 1텍셀 텐트필터를 씁니다 — 즉 예전 코드의
         shadowRadius 값은 아무 일도 하지 않았습니다). PCF 는 17탭이라 페넘브라가
         부드럽고, radius 로 세계좌표 페넘브라 폭을 제어할 수 있습니다.
       fitShadow() 가 ortho 스팬을 카메라 초점거리로 클램프하므로 텍셀이 클로즈업에서
       0.5~1cm 까지 내려갑니다 → radius 1.6텍셀이면 접지는 1~2cm 로 또렷하고
       먼 캐스터는 자연히 부드러워집니다.
       fxaa 는 **전 품질에서 켭니다** — MSAA 는 지오메트리 엣지만 잡고, 후프 밴드·
       그릴·레일 두정면의 셰이딩/텍스처 에일리어싱은 못 잡습니다(합성 후 1패스). */
    var QUAL = [
      /* q0 — 저사양 */
      { res: 0.80, maxPx: 1.15e6, msaa: 0, ssao: false, aoSamples: 8,  prepass: 0.5,
        bloomLevels: 3, shadow: 1024, shadowRadius: 1.2, fxaa: true,  ca: false },
      /* q1 — 중간 */
      { res: 0.96, maxPx: 2.60e6, msaa: 2, ssao: true,  aoSamples: 12, prepass: 0.7,
        bloomLevels: 4, shadow: 2048, shadowRadius: 1.5, fxaa: true, ca: true },
      /* q2 — 전부 */
      { res: 1.00, maxPx: 4.60e6, msaa: 4, ssao: true,  aoSamples: 16, prepass: 1.0,
        bloomLevels: 5, shadow: 3072, shadowRadius: 1.6, fxaa: true, ca: true }
    ];

    /* 하루 키프레임 — t: 0 dawn · .5 noon · 1 dusk
       (연출 우선: 태양 방위는 SPEC §3.2 의 서남서 근처에서만 움직입니다)

       ki(키 라이트 세기)는 **물리 스케일**입니다. three r155+ 는 useLegacyLights=false 라
       diffuse = albedo/π · E · cosθ 이므로, 18% 그레이가 18% 로 찍히려면 태양 고도 28° 에서
       E ≈ π/sin(28°) ≈ 6.7 이 필요합니다. 예전 값(3.2)은 정확히 이 절반 — 그래서 섬 상판이
       2스톱 부족해 새까맣게 죽었습니다. 낮추지 마세요.

       gnd = **수평선 아래** 색. 떠 있는 섬이므로 흙색이 아니라 "밝은 구름 바다" 입니다.
       fov 24 / 부감 18~58° 라 진짜 지평선은 늘 화면 밖이고, 배경 전체가 이 영역입니다. */
    /* hi(반구광) / env(IBL) 를 낮추고 ki(키) 를 올린 이유 — R1 심사 D 항목:
       예전 값은 키:앰비언트가 대략 2:1 이라 방향성이 안 읽히고 "흐린 오후"로 보였다.
       지금은 지면 기준 키 조도 ≈ ki·sin(el) ≈ 4.1 대 앰비언트(반구 0.34 + IBL) ≈ 1.1
       → 약 4:1. 노출(exp)을 같이 낮췄으므로 **양지의 밝기는 그대로**이고
       그늘만 내려간다. ki 를 낮추면 다시 평평해지니 낮추지 말 것.
       hemiG(#c98f5a) 는 SPEC §3.2 의 아래쪽 웜 바운스 — 대차 밑이 0 에 붙지 않게 한다. */
    /* hi(반구광)를 1.6배로 올린 이유 — R2 심사 D: 그림자에 sky fill 도 warm bounce 도
       전혀 안 들어와 나무 그림자 실측이 #232623(S 0.08 / V 0.15) — 무채색 진흙이었다.
       그림자의 색은 전적으로 hemi(하늘 #9fc4ff / 지면 #c98f5a) 와 keyFill 이 만든다.
       섀도우맵 애크니를 없애 양지가 제대로 밝아졌으므로 필을 올려도 평평해지지 않는다. */
    /* ── A라운드 심사 D/G (전원 지적) 에 대한 재보정 ───────────────────────────
       실측: 하늘을 뺀 지오메트리 히스토그램이 establish p99=178 · closeup-track
       p99=158/max 204 인데 하늘은 p99=249. 즉 골든아워인데 **화면 어디에도 순광
       하이라이트가 없고** 피사체가 늘 배경보다 어두웠다(역광 실루엣 노출).
       인버스 톤커브로 역산하면 순광면의 선형 조도가 목표의 정확히 절반(약 1스톱)이었다.
         · ki  ×1.55 — 키(직사)를 한 스톱 가까이 올려 순광면을 245 대역까지 밀어 올린다.
         · hi  ×2.3  — 그림자/순광 휘도비 실측 0.117(선형) → 목표 0.22~0.26.
                       노출로 올리면 전체가 뜨기만 하므로 **필 세기로만** 올린다.
                       hemi 상반구(#9fc4ff)가 곧 그림자의 색이다 → 청록 그림자.
         · exp — 시간대별로 분리. 주간은 올리고(중간톤 유지) dusk 는 약 0.6스톱 내린다
                 (dusk 채널 클리핑 실측 18.75% → 목표 0.4% 이하).
         · glow — 하늘 광륜을 30~40% 낮춘다. 구름 시트가 피사체를 압도하지 않게. */
    var TOD = [
      { t: 0.00, el:  9, az: 56, key: '#ffbe92', ki:  9.05, zen: '#2c4f86', hor: '#f6c3a0',
        gnd: '#8ca0c2', sun: '#ffcb98', si: 10, hemiS: '#8fb4f0', hemiG: '#a8774f', hi: 2.25,
        exp: 0.99, env: 0.86, glow: 0.22 },
      { t: 0.35, el: 28, az: 70, key: '#ffd9a0', ki: 13.00, zen: '#3f6fa8', hor: '#f0c08a',
        gnd: '#86a2c6', sun: '#ffdcab', si: 16, hemiS: '#9fc4ff', hemiG: '#c98f5a', hi: 2.05,
        exp: 1.05, env: 0.92, glow: 0.17 },
      { t: 0.50, el: 47, az: 76, key: '#fff0d2', ki: 13.90, zen: '#3a74bd', hor: '#dce8ee',
        gnd: '#a2bcd6', sun: '#fff4de', si: 20, hemiS: '#aacdff', hemiG: '#c9976a', hi: 2.15,
        exp: 0.96, env: 0.94, glow: 0.07 },
      { t: 0.72, el: 19, az: 86, key: '#ffc07a', ki: 10.20, zen: '#2d5490', hor: '#f6a05a',
        gnd: '#6e6198', sun: '#ffb069', si: 15, hemiS: '#93b6ee', hemiG: '#b0713f', hi: 2.05,
        exp: 0.86, env: 0.88, glow: 0.24 },
      { t: 1.00, el:  8, az: 96, key: '#ff8f4c', ki:  6.35, zen: '#1c2c50', hor: '#f2853f',
        gnd: '#41406f', sun: '#ff8a42', si: 11, hemiS: '#7d93c8', hemiG: '#7d4f31', hi: 1.90,
        exp: 0.70, env: 0.76, glow: 0.30 }
    ];

    /* ══════════════════════════════════════════════════════════════════
       모듈 상태
       ══════════════════════════════════════════════════════════════════ */

    var renderer = null, scene = null, camera = null;
    var isGL2 = false, post = false, inited = false, disposed = false;

    var _w = 0, _h = 0, _cw = 0, _ch = 0, _needResize = true, _resizeTick = 0;
    var _quality = 2, _q = QUAL[2];
    var _t = 0, _frames = 0;

    /* 라이팅 */
    var key = null, keyFill = null, hemi = null;
    var sunDir = new THREE.Vector3(-0.816, 0.469, 0.338).normalize();
    var timeOfDay = 0.35, lampsOn = false;
    var sky = {                                   /* 현재 하늘 파라미터 (선형색) */
      zen: new THREE.Color(), hor: new THREE.Color(), gnd: new THREE.Color(),
      sun: new THREE.Color(), sunI: 16, haze: new THREE.Color(), deck: new THREE.Color()
    };
    var skyGlow = 0.15;                            /* 태양 방위 쪽 헤이즈 광륜 세기 */
    /* 노출로 하이라이트를 만들려던 시도(1.12 → 1.32)는 전부 실패했다. 커브 자체가
       선형 25.7 에서야 1.0 이 되는 물건이라 노출을 올리면 **화면 전체가 같이 떠서**
       뿌예질 뿐 순백은 끝내 안 나온다(실측 p99 179 / 클리핑 0.000%).
       화이트포인트(fx.white)로 어깨를 당기는 방식으로 바꿨으므로 노출은 SPEC §3.2 의
       1.05 로 되돌린다. 밝기가 모자라 보이면 exposure 가 아니라 white 를 만져라.
       → A라운드: white 를 3.0(=준선형 후 하드클립) 에서 5.0(=ACES 실제 압축 구간)으로
       옮겼으므로 중간톤이 6% 내려앉는다. exposureBase 로 그만큼 되돌린다. 나머지
       한 스톱은 TOD.ki(키 라이트)가 담당한다 — 노출로 올리면 하늘도 같이 뜬다. */
    var exposure = 1.34, exposureBase = 1.34;

    /* 환경맵 */
    var pmrem = null, envRT = null, envUser = null;

    /* 렌더 타겟 */
    var mainRT = null, nrmRT = null, aoRT = null, aoTmpRT = null, bloomRT = [];
    var whiteTex = null, noiseTex = null;

    /* 패스 머티리얼 */
    var fsGeo = null, quadScene = null, quadMesh = null, quadCam = null;
    var skyMesh = null, skyMat = null;
    var prepassMat = null;
    var ssaoMat = null, blurMat = null, preMat = null, downMat = null, upMat = null, compMat = null;

    /* 카메라 리그 */
    /* 기본 부감 26° — 이보다 높으면 섬이 납작한 팬케이크가 되고 옆면(지층)이 안 보인다.
       "떠 있는 섬"은 두께가 보여야 성립한다. */
    var rig = {
      azimuth: -30, azT: -30, elevation: 26, elT: 26, distance: 190, distT: 190,
      distRaw: 0,                                  /* 세로 보정 전 원본 거리 (setCam) */
      target: new THREE.Vector3(-16, 1.5, 2.5), targetT: new THREE.Vector3(-16, 1.5, 2.5)
    };
    var AZ_BASE = -30, AZ_SPAN = 38, EL_MIN = 17, EL_MAX = 54, D_MIN = 95, D_MAX = 330;
    var ZOOM_K = Math.log(1.10);                 /* 휠 1 노치 = 거리 10% (zoom() 참조) */
    /* 씬에서 가장 먼 지점의 안개 비율. 0.085 는 섬 본체까지 탈색시켜 잔디·도장색이
       회색으로 죽었다(R1 심사 G/D). 섬 밑동을 구름 바다에 녹이는 건 안개가 아니라
       post 의 haze/hazeTop(-10) 경로가 담당한다. */
    var FOG_FAR = 0.026;
    var camTouched = false;
    var _shakeAmp = 0, _shakeNoise = null;
    var panBox = new THREE.Box3(new THREE.Vector3(-90, -6, -26), new THREE.Vector3(52, 16, 32));

    /* 씬 바운즈 (그림자 · 근원평면) */
    var sceneBounds = new THREE.Box3(
      new THREE.Vector3(-128, -30, -36), new THREE.Vector3(88, 22, 42));
    var boundsSet = false, sceneRadius = 150;

    /* AO / 헤이즈 공유 유니폼 — 모든 lit 머티리얼이 같은 객체를 참조합니다 */
    var aoUni = {
      shAoMap:      { value: null },
      shAoTexel:    { value: new THREE.Vector2(1 / 1280, 1 / 720) },
      shAoStrength: { value: 1.0 },
      shAoOn:       { value: 0 },
      shViewInv:    { value: new THREE.Matrix4() },
      shHazeCol:    { value: new THREE.Color(0.5, 0.6, 0.75) },
      /* top, range, amount — 섬 상판(y=0)과 절벽 지층은 절대 건드리지 않고, 밑동 끝만
         구름 바다에 녹아들게 한다. 예전 값(−0.5, 27, 0.85)은 섬 전체를 씻어냈다. */
      shHazeP:      { value: new THREE.Vector3(-20.0, 13.0, 0.10) },
      /* 스페큘러 안티에일리어싱 세기 (노멀 분산 → 러프니스). 레일 두정면 참조. */
      shSpecAA:     { value: 0.90 }
    };
    var patchedCount = 0, scanTick = 0;

    /* 튜닝 값 */
    /* AO 는 **간접광에만** 곱해집니다(머티리얼 주입). 그래서 버퍼 자체는 세게 잡아도
       그림자를 시커멓게 뭉개지 않습니다. 크레비스 최저 ~0.35 목표. */
    /* mix = 합성 패스에서 화면 전체에 곱하는 AO 비율. 간접광에만 곱하면 햇빛 아래에서
       AO 가 사실상 사라져 버려서(Townscaper 의 핵심이 죽는다), 소량을 최종 이미지에도 건다. */
    /* radius 는 **미터**. 1.3m 는 이 미니어처 스케일(화차 폭 3m, 침목 두께 0.18m)에서
       접지·모서리 크레비스를 전부 놓치고 넓고 옅은 전역 디밍만 만든다 → SPEC §3.5 의
       0.6m 보다도 아래인 0.45m 로 좁히고 intensity/power 로 깊게 판다.
       minPx/maxPx 는 화면공간 반경 클램프(풀해상도 픽셀) — 원경에서 반경이 벌어져
       크레비스가 뭉개지는 걸 막는다. */
    /* maxPx(화면공간 반경 상한)가 결정적이다. 예전 13px 는 클로즈업에서 0.45m 반경을
       0.24m 로 다시 깎아버려서 침목-발라스트, 화차-지면, 곤돌라 안쪽 모서리 같은
       "큰 접합부"를 통째로 놓쳤다(좁은 골만 검게 죽었다). 반경을 SPEC §3.5 의 0.6m 위인
       0.85m 로 넓히고 상한을 40px 로 올려 실제로 그 반경이 쓰이게 한다.
       대신 intensity/power 를 낮춰 좁은 골이 순검정으로 뭉개지지 않게 한다. */
    /* wide/wideI = **광역 AO 탭**. 좁은 반경(0.85m)만으로는 기계 틈은 파이는데
       나무 둥치·울타리 기둥·벙커 벽이 잔디와 만나는 "큰 접합부"에 Townscaper 식
       음영 고임이 전혀 안 생긴다(A라운드 F). 반경 ×2.6(≈2.2m) 의 약한 탭을 하나 더
       돌려 곱셈 합성한다. 샘플은 절반만 써서 비용은 +50% 로 막는다. */
    var ao = { radius: 0.85, strength: 1.0, power: 1.15, bias: 0.018, intensity: 2.45,
               minPx: 5.0, maxPx: 40.0, mix: 0.75, wide: 2.6, wideI: 0.95 };
    /* ca: 화면 최외곽에서 ≈0.7px (uCA = ca·8/h, 오프셋은 r^5 → 중앙 60% 는 사실상 0).
       grain: 루마 가중이 걸려 밝은 평면에는 거의 안 얹힌다.
       threshold/knee: 헤드라이트가 하드 엣지 백색 원반으로 잘리지 않고 번지도록 낮춤. */
    /* white  = 이 선형값이 화면에서 정확히 순백(255)이 된다.
       ★ 3.0 은 실패였다(A라운드 G, 심사위원 전원). aces(3.0)=0.873 이라 어깨를 커브의
         **준선형 구간**에 박아 놓는 셈이 되어 위쪽은 하드클립이 된다 → dusk 는 화면의
         18.75% 가 채널 포화하고 closeup-track 은 반대로 245 초과가 0.000% 인 양방향 실패.
         5.0(aces=0.9306)이면 어깨가 실제 압축 구간에 들어가 필름처럼 롤오프한다.
         잃는 중간톤은 exposureBase(1.14→1.34)로 되돌린다.
       threshold= 블룸 임계값. **노출 전 선형** 단위다(블룸은 mainRT 를 직접 읽는다).
         순백선형 = white/exposure ≈ 3.7 이므로 1.35 는 그 36% — 램프 유리(2.2)·
         전조등 렌즈(2.2)·레일 두정 스페큘러·태양 글린트만 걸리고 순광 잔디(≈1.0)는 안 걸린다.
       grain  = **트랜스퍼 커브 이후**(sRGB 인코드 뒤) 진폭이다. 선형 HDR 에 더하면
         흑색 근처 기울기(12.92) 때문에 암부에서만 증폭돼 얼룩이 된다(A라운드 J).
       contrast= 필름 S커브 혼합량. */
    var fx = { bloom: 0.55, threshold: 1.35, knee: 0.55, vignette: 0.14,
               grain: 0.0055, ca: 0.30, sat: 1.09, white: 5.0, contrast: 0.19,
               /* 레일 두정면 스페큘러 모아레 억제(노멀 분산 → 러프니스). 0 이면 끔.
                  A/B 실측: 0.30 은 화면의 0.57% 만 바꿔 효과가 없었고, 0.90 이면
                  원경 레일·후프 밴드에서만 2~3% 가 바뀐다(클로즈업은 분산이 작아 무변화). */
               specAA: 0.90,
               /* 고도 기반 에어리얼: 섬 **밑동 끝**만 구름 바다에 녹인다.
                  예전 값(0.22 / −10 / 20)은 암반 스파이크와 지층까지 60~70% 지워
                  섬 아래가 종이 오려붙인 것처럼 보였다(가장 가까운 큰 덩어리인데 공중원근). */
               haze: 0.10, hazeTop: -20.0, hazeRange: 13.0 };

    /* info */
    var info = { fps: 60, tris: 0, calls: 0, quality: 2 };
    var _fpsAcc = 0, _fpsN = 0;
    var _histSum = 0, _histN = 0, _downgrades = 0, _cool = 0;

    /* 스크래치 */
    var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
    var _m1 = new THREE.Matrix4();
    var _q1 = new THREE.Quaternion();
    var _box = new THREE.Box3(), _fitBox = new THREE.Box3(), _sph = new THREE.Sphere();
    var _upY = new THREE.Vector3(0, 1, 0);
    var _hidden = [];
    var _corner = [], _rcvPts = [];
    for (var _ci = 0; _ci < 8; _ci++) { _corner.push(new THREE.Vector3()); _rcvPts.push(new THREE.Vector3()); }

    /* ══════════════════════════════════════════════════════════════════
       GLSL — 공용
       ══════════════════════════════════════════════════════════════════ */

    var VERT_FS = [
      'varying vec2 vUv;',
      'void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }'
    ].join('\n');

    var GLSL_HASH = [
      'float sh_hash12( vec2 p ){',
      '  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );',
      '  p3 += dot( p3, p3.yzx + 33.33 );',
      '  return fract( ( p3.x + p3.y ) * p3.z );',
      '}'
    ].join('\n');

    /* ── 하늘 (씬 안 풀스크린 트라이앵글) ───────────────────────── */

    var SKY_VERT = [
      'varying vec2 vNdc;',
      'void main(){ vNdc = position.xy; gl_Position = vec4( position.xy, 1.0, 1.0 ); }'
    ].join('\n');

    /* ══ 하늘 = 구름 바다 ═══════════════════════════════════════════════
       ★ 실측(mm.py): establish 구도에서 화면 네 모서리의 시선 방향은
           TL dy 0.293 / TR dy 0.293 / BL dy 0.635 / BR dy 0.635
           azd(태양 방위 정렬도) 왼쪽 0.85~0.88 · 오른쪽 0.50~0.55
         즉 **천정(uZen)은 화면에 단 한 픽셀도 나오지 않는다.** 화면 배경 100% 가
         "수평선 아래 dy 0.29~0.64" 대역이다. 지난 라운드들이 zen 을 파랗게 고쳐도
         화면이 안 변한 이유가 이것이다. 그러니 색·구조·방향성·하이라이트를 전부
         **이 대역 안에서** 만들어야 한다. 여기를 단색 램프로 두면 화면의 55~60% 가
         죽은 회색 판이 된다(= Townscaper 옆에서 지는 지점).

       설계:
         · 시선을 구름 갑판에 투영(P = dir.xz / dy)해 원근이 있는 뭉게구름 지형을 만든다.
         · 그 지형의 **태양 방향 기울기**로 lit 을 구해 꼭대기는 금빛, 골은 청색 그늘.
         · azd 로 좌(태양쪽 금빛) ↔ 우(서늘한 청색) 를 확실히 갈라 놓는다.
         · 태양 원반 자체는 방위 70° / 고도 28° 라 카메라 클램프(−68..+8) 안에서는
           절대 프레임에 못 들어온다. 대신 **프레임 왼쪽 밖의 태양에서 쏟아지는 광륜**과
           **햇빛 받는 구름 꼭대기의 스페큘러**를 HDR(>3)로 태워 블룸·클리핑을 만든다.
       ══════════════════════════════════════════════════════════════════ */
    var SKY_FRAG = [
      'varying vec2 vNdc;',
      'uniform mat4 uInvVP;',
      'uniform vec3 uCamPos, uZen, uHor, uGnd, uSun, uSunDir;',
      'uniform float uSunI, uTime, uDirect, uGlow, uWhiteN, uDetail;',
      GLSL_HASH,
      'float sh_vn( vec2 p ){',
      '  vec2 i = floor( p ), f = fract( p );',
      '  f = f * f * ( 3.0 - 2.0 * f );',
      '  float a = sh_hash12( i ), b = sh_hash12( i + vec2( 1.0, 0.0 ) );',
      '  float c = sh_hash12( i + vec2( 0.0, 1.0 ) ), d = sh_hash12( i + vec2( 1.0, 1.0 ) );',
      '  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );',
      '}',
      /* 평균이 0.5 가 되도록 정규화 (진폭 합 0.875 / 0.9375) */
      'float sh_fbm3( vec2 p ){',
      '  float v = 0.0, a = 0.5;',
      '  for ( int i = 0; i < 3; i ++ ) { v += a * sh_vn( p ); p *= 2.07; a *= 0.5; }',
      '  return v * 1.143;',
      '}',
      'float sh_fbm( vec2 p ){',
      '  float v = 0.0, a = 0.5;',
      '  for ( int i = 0; i < 4; i ++ ) { v += a * sh_vn( p ); p *= 2.03; a *= 0.5; }',
      '  return v * 1.067;',
      '}',
      'vec3 sh_aces( vec3 c ){',
      '  const mat3 mi = mat3( 0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777 );',
      '  const mat3 mo = mat3( 1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602 );',
      '  c = mi * c;',
      '  vec3 a = c * ( c + 0.0245786 ) - 0.000090537;',
      '  vec3 b = c * ( 0.983729 * c + 0.4329510 ) + 0.238081;',
      '  return clamp( mo * ( a / b ) * uWhiteN, 0.0, 1.0 );',
      '}',
      'void main(){',
      '  vec4 p = uInvVP * vec4( vNdc, 1.0, 1.0 );',
      '  vec3 dir = normalize( p.xyz / p.w - uCamPos );',
      '  float y = dir.y;',
      '  vec2 hd = dir.xz;',
      '  float hl = max( length( hd ), 1e-4 );',
      '  vec2 sh2 = uSunDir.xz;',
      '  float sl = max( length( sh2 ), 1e-4 );',
      '  vec2 sdir = sh2 / sl;',
      '  float azd = 0.5 + 0.5 * dot( hd / hl, sdir );',
      /* 화면에 실제로 들어오는 azd 는 0.50~0.88 뿐이다. 램프를 이 구간에 맞춘다. */
      '  float sunSide = smoothstep( 0.26, 0.98, azd );',
      '  float ss2 = sunSide * sunSide;',
      /* 지평선 색 — 태양 쪽은 금빛, 반대쪽은 서늘한 청색 */
      '  vec3 warmH = mix( uHor, uSun, 0.45 ) * 1.34;',
      '  vec3 coolH = mix( uGnd, uZen, 0.52 ) * 0.88;',
      '  vec3 horiz = mix( coolH, warmH, sunSide );',
      '  vec3 c;',
      '  float sd = max( dot( dir, uSunDir ), 0.0 );',
      '  if ( y > 0.0 ) {',
      /* ── 수평선 위 (화면 밖 · IBL 전용) ─────────────────────────── */
      '    c = mix( horiz, uZen, pow( min( y, 1.0 ), 0.42 ) );',
      '    float up = smoothstep( 0.02, 0.34, y );',
      '    if ( up > 0.001 ) {',
      '      vec2 cp = dir.xz / max( y, 0.055 );',
      '      cp = cp * vec2( 0.030, 0.115 ) + vec2( uTime * 0.0016, uTime * 0.0004 );',
      '      float f = sh_fbm( cp * 3.0 );',
      '      float cl = smoothstep( 0.48, 0.86, f ) * up * ( 1.0 - smoothstep( 0.55, 0.95, y ) );',
      '      vec3 clc = mix( uHor * 1.40, uZen * 0.55 + uHor * 0.35, 0.42 ) + uSun * pow( sd, 3.0 ) * 0.35;',
      '      c = mix( c, clc, cl * 0.50 );',
      '    }',
      '  } else {',
      /* ── 수평선 아래 = 화면 배경 전부. 구름 바다 ─────────────────── */
      '    float dy = -y;',
      '    float t = 1.0 / max( dy, 0.030 );',
      '    vec2 P = dir.xz * t;',                         /* 구름 갑판 투영(원근 포함) */
      '    vec2 dr = vec2( uTime * 0.012, uTime * 0.005 );',
      /* ★ 주파수가 전부다. 화면 전체에서 |P| 는 1.2~3.3 밖에 안 움직이므로 노이즈
         스케일을 작게 잡으면 **셀 한 칸 안에 화면이 통째로** 들어가 구름이 아니라
         그냥 단색 그라디언트가 된다(첫 시도가 정확히 그랬다 — 배경이 2.3배 어두운
         한 덩이 색으로 나옴). 3.2 면 큰 뭉게구름 5~7덩이가 화면을 채운다. */
      '    float hgt = sh_fbm( P * 5.4 + dr );',
      /* 태양 쪽으로 한 걸음 간 지점의 높이. 높이가 태양 쪽으로 **낮아지면** 그 면은
         태양을 향한다 → lit. (저주파만 필요하므로 3옥타브로 충분하다.) */
      '    float hs  = sh_fbm3( ( P + sdir * 0.070 ) * 5.4 + dr );',
      '    if ( uDetail > 0.5 ) hgt = hgt * 0.87 + sh_fbm3( P * 21.0 - dr * 1.7 ) * 0.13;',
      /* 문턱을 넓게 잡아야 구름이 **부드러운 뭉게덩어리**로 읽힌다. 좁게 잡으면
         lit 이 0/1 로 갈려 위성사진 같은 납작한 흰 얼룩 지도가 된다(실제로 그랬다). */
      '    float lit = smoothstep( -0.15, 0.15, hgt - hs );',
      /* 명암(shade)과 색조(tint)를 **분리**한다. 하나의 mix 로 처리하면 반대쪽 하늘이
         "어두운 금색"이 되어 버린다 — 파랑이 필요한 쪽은 파랑으로 남아야 한다.
         값 폭은 좁게. 배경이 섬보다 튀면 히어로가 뒤집힌다.
         ★ A라운드: 실측 하늘 평균휘도 161 vs 피사체 66 — 배경이 2.4배 밝았다.
         구름 대비(shade)와 전체 밝기(bri)를 함께 눌러 배경을 피사체 아래로 내린다. */
      '    float shade = mix( 0.80, 1.10, lit ) * ( 0.90 + 0.20 * hgt );',
      '    vec3 warmC = mix( uHor, uSun, 0.55 );',
      '    vec3 coolC = mix( uGnd, uZen, 0.55 );',
      '    float deep = smoothstep( 0.10, 0.95, dy );',
      '    vec3 tint = mix( mix( coolC, warmC, ss2 ), coolC * 0.62, deep * 0.85 );',
      /* ★ SPEC §3.3 의 "sky top → horizon" 세로 그라디언트. 이 구도에서 화면은 전부
         수평선 **아래**(dy 0.29~0.64)이므로 그라디언트를 zen↔hor 이 아니라 **deep**
         축 위에 만들어야 화면에 보인다. 1.06 → 0.44 의 램프가 화면 상단(지평선 쪽,
         따뜻하고 밝음) → 하단(깊은 청색, 어두움)의 단조 감소를 만든다.
         (실측 A라운드: 세로 프로파일에 추세가 전무하고 구름 노이즈만 있었다.) */
      '    float bri = mix( 0.56, 0.92, sunSide ) * mix( 1.06, 0.44, deep );',
      /* 수평선 쪽은 대기에 씻겨 지평선 색으로 (dy=0 에서 정확히 horiz — 이음매 없음).
         0.22 → 0.40 으로 넓혀 화면 맨 위가 지평선 온색을 확실히 물고 있게 한다. */
      '    c = mix( horiz, tint * shade * bri, smoothstep( 0.0, 0.40, dy ) );',
      /* 가로로 긴 구름 띠 2~3겹. atan 대신 태양 수직축 투영을 써서 방위 이음매가 없다. */
      '    vec2 bq = vec2( dot( hd / hl, vec2( -sdir.y, sdir.x ) ) * 2.9,',
      '                    log( max( dy, 0.02 ) ) * 3.2 ) + dr * 0.35;',
      '    c *= 1.0 + ( sh_fbm3( bq ) - 0.5 ) * 0.13 * smoothstep( 0.02, 0.26, dy );',
      /* 프레임 왼쪽 밖의 태양에서 쏟아지는 광륜 — 화면 왼쪽이 확실히 금빛이 된다 */
      '    float band = exp( -dy * 1.45 );',
      '    c += uSun * uGlow * band * ( pow( azd, 3.5 ) * 0.55 + pow( azd, 14.0 ) * 2.2 );',
      /* 햇빛 받는 구름 꼭대기의 스페큘러 — 화면에서 **유일하게 순백으로 타는** 곳.
         면적이 넓어지면 곧바로 "뿌연 화면"이 되므로 문턱을 높게 잡는다. */
      /* 코어는 태양색이 아니라 **흰색 쪽**으로 민다 — 웜 컬러만으로는 R 채널만 타고
         G/B 가 남아 순백(루마 255)이 영영 안 나온다(실측 clip 0.000%).
         cr^3 항이 "가장 밝은 꼭대기 몇 %" 만 순백으로 태워 클리핑을 0.05~0.3% 로 만든다. */
      /* 문턱 실측: hgt ~ N(0.5, 0.10) 이라 0.82 를 넘는 화소는 0.07% 뿐이고
         거기에 방위·고도 조건까지 곱하면 사실상 0 이 된다(실측 clip 0.000%).
         0.51~0.72 면 태양 쪽 하늘의 상위 몇 % 가 실제로 탄다. */
      /* ★ 여기가 dusk 채널 클리핑 18.75% 의 진원지였다. 크레스트 항을 절반 이하로
         낮추고 문턱을 올려 **면적을 줄인다** — 순백은 화면의 0.1% 안쪽에서만 나야 한다. */
      '    float cr = smoothstep( 0.57, 0.79, hgt ) * lit * ss2 * band * ( 1.0 - deep * 0.55 );',
      '    float cr2 = cr * cr;',
      '    c += mix( uSun, vec3( 1.0 ), 0.45 ) * cr * 2.4 + cr2 * cr2 * 12.0;',
      '  }',
      /* 수평선 웜 밴드 (화면 밖이지만 IBL 에 기여) */
      '  c += warmH * exp( -abs( y ) * 13.0 ) * 0.10;',
      /* 태양 광륜 + 디스크 (구도상 화면 밖이지만 IBL·스페큘러에 필수) */
      '  c += uSun * pow( sd, 4.0 ) * 0.22;',
      '  c += uSun * pow( sd, 150.0 ) * 0.75;',
      '  c += uSun * smoothstep( 0.99930, 0.99968, sd ) * uSunI;',
      '  if ( uDirect > 0.5 ) {',
      '    c = sh_aces( c );',
      '    c = mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );',
      '  }',
      '  gl_FragColor = vec4( c, 1.0 );',
      '}'
    ].join('\n');

    /* ── SSAO ───────────────────────────────────────────────────── */

    function ssaoFrag(n) {
      return [
        '#define AO_N ' + n,
        '#define AO_W ' + Math.max(2, n >> 1),
        'varying vec2 vUv;',
        'uniform sampler2D tDepth, tNormal, tNoise;',
        'uniform mat4 uProj, uProjInv;',
        'uniform vec3 uKernel[ AO_N ];',
        'uniform vec2 uNoiseScale, uRes;',
        'uniform float uRadius, uBias, uIntensity, uPower, uNear, uFar, uMinPx, uMaxPx;',
        'uniform float uWide, uWideI;',
        'vec3 viewPos( vec2 uv, float d ){',
        '  vec4 c = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );',
        '  return c.xyz / c.w;',
        '}',
        /* 표본 하나의 차폐량. 좁은 탭과 광역 탭이 같은 코드를 쓴다. */
        'float shOcc( vec3 P, vec3 sp, float R ){',
        '  vec4 o = uProj * vec4( sp, 1.0 );',
        '  vec2 suv = ( o.xy / o.w ) * 0.5 + 0.5;',
        '  vec2 cuv = clamp( suv, 0.0, 1.0 );',
        '  float inb = ( cuv.x == suv.x && cuv.y == suv.y ) ? 1.0 : 0.0;',
        '  float sd = texture2D( tDepth, cuv ).x;',
        '  float valid = inb * step( sd, 0.99999 );',
        '  float sz = viewPos( cuv, sd ).z;',
        '  float rc = smoothstep( 0.0, 1.0, R / max( abs( P.z - sz ), 1e-4 ) );',
        '  return valid * ( ( sz >= sp.z + uBias ) ? rc : 0.0 );',
        '}',
        'void main(){',
        '  float d = texture2D( tDepth, vUv ).x;',
        '  if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }',
        '  vec3 P = viewPos( vUv, d );',
        '  vec3 N = texture2D( tNormal, vUv ).xyz * 2.0 - 1.0;',
        '  float nl = length( N );',
        '  if ( nl < 0.2 ) { gl_FragColor = vec4( 1.0 ); return; }',
        '  N /= nl;',
        /* 화면공간 반경 클램프 — 미니어처 스케일에서 AO 가 사라지거나 번지는 걸 막음 */
        '  float projS = uProj[1][1] * 0.5 * uRes.y;',
        '  float z = max( -P.z, 0.001 );',
        '  float rMin = uMinPx * z / projS;',
        '  float rMax = uMaxPx * z / projS;',
        '  float R = clamp( uRadius, rMin, rMax );',
        /* 광역 탭의 반경. 상한을 3배로 열어 두어야 원경에서도 실제로 넓게 훑는다. */
        '  float RW = clamp( uRadius * uWide, rMin * 1.6, rMax * 3.0 );',
        '  vec3 rv = texture2D( tNoise, vUv * uNoiseScale ).xyz * 2.0 - 1.0;',
        '  vec3 T = normalize( rv - N * dot( rv, N ) );',
        '  vec3 B = cross( N, T );',
        '  mat3 TBN = mat3( T, B, N );',
        '  float occ = 0.0, occW = 0.0;',
        '  for ( int i = 0; i < AO_N; i ++ ) {',
        '    vec3 kv = TBN * uKernel[ i ];',
        '    occ += shOcc( P, P + kv * R, R );',
        '    if ( i < AO_W ) occW += shOcc( P, P + kv * RW, RW );',
        '  }',
        '  float a = 1.0 - ( occ / float( AO_N ) ) * uIntensity;',
        '  a = pow( clamp( a, 0.0, 1.0 ), uPower );',
        /* 광역 항은 곱셈 합성. 나무 둥치·기둥 밑동처럼 넓은 접합부에만 얕은 골을 판다.
           power 를 안 걸어야 좁은 골이 두 번 어두워지지 않는다. */
        '  float aw = clamp( 1.0 - ( occW / float( AO_W ) ) * uWideI, 0.0, 1.0 );',
        '  a *= mix( 1.0, aw, 0.85 );',
        '  gl_FragColor = vec4( a, a, a, 1.0 );',
        '}'
      ].join('\n');
    }

    var BLUR_FRAG = [
      'varying vec2 vUv;',
      'uniform sampler2D tAO, tDepth;',
      'uniform vec2 uDir;',
      'uniform float uNear, uFar, uSharp;',
      'float linZ( float d ){',
      '  float z = d * 2.0 - 1.0;',
      '  return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );',
      '}',
      /* 노이즈 타일이 8×8 이 되었으므로 커널 도달거리도 그만큼 넓혀야 회전 디더가
         완전히 지워진다(3탭 × step 1.75 = ±5.25 하프해상도 px = ±10.5 풀해상도 px). */
      'void main(){',
      '  float dc = linZ( texture2D( tDepth, vUv ).x );',
      '  float wsum = 0.204, acc = texture2D( tAO, vUv ).r * 0.204;',
      '  const float W1 = 0.180, W2 = 0.127, W3 = 0.091;',
      '  for ( int i = 1; i <= 3; i ++ ) {',
      '    float fi = float( i );',
      '    float gw = ( i == 1 ) ? W1 : ( ( i == 2 ) ? W2 : W3 );',
      '    vec2 o = uDir * fi;',
      '    vec2 ua = vUv + o, ub = vUv - o;',
      '    float da = linZ( texture2D( tDepth, ua ).x );',
      '    float db = linZ( texture2D( tDepth, ub ).x );',
      '    float wa = gw * exp( -abs( da - dc ) * uSharp );',
      '    float wb = gw * exp( -abs( db - dc ) * uSharp );',
      '    acc += texture2D( tAO, ua ).r * wa + texture2D( tAO, ub ).r * wb;',
      '    wsum += wa + wb;',
      '  }',
      '  float a = acc / max( wsum, 1e-4 );',
      '  gl_FragColor = vec4( a, a, a, 1.0 );',
      '}'
    ].join('\n');

    /* ── 블룸 ───────────────────────────────────────────────────── */

    var PREFILTER_FRAG = [
      'varying vec2 vUv;',
      'uniform sampler2D tSrc;',
      'uniform vec2 uTexel;',
      'uniform float uThreshold, uKnee, uClamp;',
      'vec3 tap( vec2 uv ){ return min( texture2D( tSrc, uv ).rgb, vec3( uClamp ) ); }',
      'float kw( vec3 c ){ return 1.0 / ( 1.0 + max( c.r, max( c.g, c.b ) ) ); }',
      'void main(){',
      '  vec2 t = uTexel;',
      '  vec3 a = tap( vUv + t * vec2( -2.0, -2.0 ) ), b = tap( vUv + t * vec2( 0.0, -2.0 ) );',
      '  vec3 c = tap( vUv + t * vec2(  2.0, -2.0 ) ), d = tap( vUv + t * vec2( -2.0, 0.0 ) );',
      '  vec3 e = tap( vUv ),                          f = tap( vUv + t * vec2(  2.0, 0.0 ) );',
      '  vec3 g = tap( vUv + t * vec2( -2.0,  2.0 ) ), h = tap( vUv + t * vec2( 0.0,  2.0 ) );',
      '  vec3 i = tap( vUv + t * vec2(  2.0,  2.0 ) );',
      '  vec3 j = tap( vUv + t * vec2( -1.0, -1.0 ) ), k = tap( vUv + t * vec2( 1.0, -1.0 ) );',
      '  vec3 l = tap( vUv + t * vec2( -1.0,  1.0 ) ), m = tap( vUv + t * vec2( 1.0,  1.0 ) );',
      /* Karis 가중 평균 — 반딧불이 억제 */
      '  float wj = kw( j ), wk = kw( k ), wl = kw( l ), wm = kw( m );',
      '  vec3 g0 = ( j * wj + k * wk + l * wl + m * wm ) / max( wj + wk + wl + wm, 1e-4 );',
      '  vec3 g1 = ( a + b + d + e ) * 0.25, g2 = ( b + c + e + f ) * 0.25;',
      '  vec3 g3 = ( d + e + g + h ) * 0.25, g4 = ( e + f + h + i ) * 0.25;',
      '  vec3 col = g0 * 0.5 + ( g1 + g2 + g3 + g4 ) * 0.125;',
      '  float br = max( col.r, max( col.g, col.b ) );',
      '  float soft = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );',
      '  soft = soft * soft / ( 4.0 * uKnee + 1e-4 );',
      '  float w = max( soft, br - uThreshold ) / max( br, 1e-4 );',
      '  gl_FragColor = vec4( col * w, 1.0 );',
      '}'
    ].join('\n');

    var DOWN_FRAG = [
      'varying vec2 vUv;',
      'uniform sampler2D tSrc;',
      'uniform vec2 uTexel;',
      'vec3 tap( vec2 uv ){ return texture2D( tSrc, uv ).rgb; }',
      'void main(){',
      '  vec2 t = uTexel;',
      '  vec3 a = tap( vUv + t * vec2( -2.0, -2.0 ) ), b = tap( vUv + t * vec2( 0.0, -2.0 ) );',
      '  vec3 c = tap( vUv + t * vec2(  2.0, -2.0 ) ), d = tap( vUv + t * vec2( -2.0, 0.0 ) );',
      '  vec3 e = tap( vUv ),                          f = tap( vUv + t * vec2(  2.0, 0.0 ) );',
      '  vec3 g = tap( vUv + t * vec2( -2.0,  2.0 ) ), h = tap( vUv + t * vec2( 0.0,  2.0 ) );',
      '  vec3 i = tap( vUv + t * vec2(  2.0,  2.0 ) );',
      '  vec3 j = tap( vUv + t * vec2( -1.0, -1.0 ) ), k = tap( vUv + t * vec2( 1.0, -1.0 ) );',
      '  vec3 l = tap( vUv + t * vec2( -1.0,  1.0 ) ), m = tap( vUv + t * vec2( 1.0,  1.0 ) );',
      '  vec3 col = ( j + k + l + m ) * 0.125;',
      '  col += ( a + b + d + e ) * 0.03125;',
      '  col += ( b + c + e + f ) * 0.03125;',
      '  col += ( d + e + g + h ) * 0.03125;',
      '  col += ( e + f + h + i ) * 0.03125;',
      '  gl_FragColor = vec4( col, 1.0 );',
      '}'
    ].join('\n');

    var UP_FRAG = [
      'varying vec2 vUv;',
      'uniform sampler2D tSrc;',
      'uniform vec2 uTexel;',
      'uniform float uRadius;',
      'void main(){',
      '  vec2 o = uTexel * uRadius;',
      '  vec3 s = texture2D( tSrc, vUv + vec2( -o.x, -o.y ) ).rgb;',
      '  s += texture2D( tSrc, vUv + vec2( 0.0, -o.y ) ).rgb * 2.0;',
      '  s += texture2D( tSrc, vUv + vec2(  o.x, -o.y ) ).rgb;',
      '  s += texture2D( tSrc, vUv + vec2( -o.x, 0.0 ) ).rgb * 2.0;',
      '  s += texture2D( tSrc, vUv ).rgb * 4.0;',
      '  s += texture2D( tSrc, vUv + vec2(  o.x, 0.0 ) ).rgb * 2.0;',
      '  s += texture2D( tSrc, vUv + vec2( -o.x,  o.y ) ).rgb;',
      '  s += texture2D( tSrc, vUv + vec2( 0.0,  o.y ) ).rgb * 2.0;',
      '  s += texture2D( tSrc, vUv + vec2(  o.x,  o.y ) ).rgb;',
      '  gl_FragColor = vec4( s * 0.0625, 1.0 );',
      '}'
    ].join('\n');

    /* ── 최종 합성 ──────────────────────────────────────────────── */

    var COMP_FRAG = [
      'varying vec2 vUv;',
      'uniform sampler2D tMain, tBloom, tAO;',
      'uniform vec2 uTexel;',
      'uniform vec3 uBloomTint, uShadTint, uHighTint;',
      'uniform float uExposure, uBloom, uCA, uVig, uGrain, uTime, uSat, uAOMix;',
      'uniform float uWhiteN, uContrast;',
      GLSL_HASH,
      'vec3 grab( vec2 uv ){',
      '  vec3 c;',
      '#ifdef SH_CA',
      /* 오프셋 크기 = r^5. 화면 중앙 60% 반경에서는 사실상 0 이고 최외곽에서만
         ~0.7px. r 선형/r^3 은 유개차 세로 리브마다 2~4px 프린지를 만들었다. */
      '  vec2 dd = uv - 0.5;',
      '  float r2 = dot( dd, dd );',
      '  vec2 off = dd * r2 * r2 * uCA;',
      '  c.r = texture2D( tMain, uv + off ).r;',
      '  c.g = texture2D( tMain, uv ).g;',
      '  c.b = texture2D( tMain, uv - off ).b;',
      '#else',
      '  c = texture2D( tMain, uv ).rgb;',
      '#endif',
      '#ifdef SH_AO',
      /* 화면공간 AO 를 최종 이미지에도 건다. 머티리얼 주입(간접광 전용)만으로는
         직사광 아래 크레비스가 전혀 파이지 않는다(Townscaper 의 핵심이 죽는다).
         하한 0.38 클램프로 검은 후광/뭉개짐을 막는다. */
      '  float aov = texture2D( tAO, uv ).r;',
      '  float lm = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
      /* 이미 어두운 곳(그림자 안)에는 화면 AO 를 걸지 않는다 — 걸면 그림자가
         두 번 곱해져 무채색 진흙이 되고(R2 심사 D/G) AO 는 정작 양지에서 안 보인다.
         AO 는 **빛이 닿는 면**의 접합부를 파는 데 쓴다. */
      '  float am = mix( 1.0, aov, uAOMix * smoothstep( 0.03, 0.22, lm ) );',
      '  c *= max( am, 0.38 );',
      '#endif',
      '  c += texture2D( tBloom, uv ).rgb * uBloomTint * uBloom;',
      /* ★ 비네트는 **톤매핑 앞**(= 노출 감쇠)에서 건다. 톤매핑 뒤에서 곱하면
         이미 1.0 으로 잘린 하이라이트까지 같이 깎여 화면에 순백이 영영 안 나온다
         (실측: p99 248 인데 clip255 0.000%). 렌즈의 코사인4승 감광도 원래 노출 쪽이다.
         ★ 감광 **모양**을 바꿨다. 예전 pow(1-r²·v, 1.4) 는 화면 중앙부터 완만하게
         떨어져 프레임의 66.6% 를 건드렸다(A라운드 J: "보이면 과한 것"). 코너에서
         정확히 1.0 이 되도록 정규화한 r⁴ 감쇠는 바깥 25% 밖에서만 실제로 떨어진다:
         반경 50% 지점 −0.9% · 코너 −14%. */
      '  vec2 vd = uv - 0.5;',
      '  float vr = clamp( dot( vd, vd ) * 2.0, 0.0, 1.0 );',
      '  return c * ( uExposure * ( 1.0 - uVig * vr * vr ) );',
      '}',
      /* ★ 화이트포인트 정규화 ACES.
         이 ACES 피팅(Hill)은 **선형 25.7 이 되어야 출력 1.0** 이 된다. 그래서 골든아워
         씬(가장 밝은 면이 선형 1.5~2.5)에서는 순백이 물리적으로 발생할 수 없었다
         — 실측 p99 179 / 클리핑 0.000%. 노출을 올려도 커브 전체가 같이 떠서 뿌예질 뿐이다.
         uWhiteN = 1/aces(uWhite) 로 곱해 **선형 uWhite 가 정확히 1.0** 이 되게 한다.
         중간톤은 거의 그대로 두고 어깨만 앞으로 당기는 방식이라 뿌예지지 않는다. */
      'vec3 aces( vec3 c ){',
      '  const mat3 mi = mat3( 0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777 );',
      '  const mat3 mo = mat3( 1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602 );',
      '  c = mi * c;',
      '  vec3 a = c * ( c + 0.0245786 ) - 0.000090537;',
      '  vec3 b = c * ( 0.983729 * c + 0.4329510 ) + 0.238081;',
      '  return clamp( mo * ( a / b ) * uWhiteN, 0.0, 1.0 );',
      '}',
      'vec3 grade( vec3 c ){',
      '  c = mix( c, c * c * ( 3.0 - 2.0 * c ), uContrast );', /* 부드러운 필름 콘트라스트 */
      '  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
      /* ★ 스플릿 토닝은 **곱셈**으로만 한다.
         예전 코드는 uLift(청 +0.010) + 암부 가산(청 +0.015) 이라 가장 어두운 픽셀조차
         G≈16 / B≈44 로 떠 있었고, 그게 실측 p1=15 의 정체다(= 검정이 없는 진흙 화면).
         곱셈이면 검정은 검정으로 남으면서 그림자 색조는 그대로 얻는다. */
      /* 0.40 → 0.52. 실측 shadowRGB 가 (23,22,22) 로 완전 중성이었다(A라운드 G).
         암부 가중을 넓히고 틴트 자체도 세게 잡아 SPEC §3.5 의 청록 그림자를 만든다. */
      '  float sh = 1.0 - smoothstep( 0.0, 0.52, l );',
      /* 최상단(l>0.88)에서는 웜 틴트를 다시 0 으로 되돌린다 — 안 그러면 청 채널이
         0.93 로 눌려 아무리 타도 루마 255 가 안 나온다(필름도 최고광은 백색이다). */
      '  float hi = smoothstep( 0.34, 0.86, l ) * ( 1.0 - smoothstep( 0.88, 1.00, l ) );',
      '  c *= mix( vec3( 1.0 ), uShadTint, sh );',      /* 그림자 = 청록 */
      '  c *= mix( vec3( 1.0 ), uHighTint, hi );',      /* 하이라이트 = 골든아워 웜 */
      '  c = clamp( c, 0.0, 1.0 );',
      '  l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
      /* 채도는 **중간톤에만** 더 얹는다. 전역 1.16 은 순광 잔디를 형광으로 만들면서
         정작 색이 없는 암부까지 같이 밀어 노이즈만 컬러로 만들었다. */
      '  float ms = uSat + 0.12 * ( 1.0 - abs( l * 2.0 - 1.0 ) );',
      '  return clamp( mix( vec3( l ), c, ms ), 0.0, 1.0 );',
      '}',
      'vec3 tone( vec2 uv ){ return grade( aces( grab( uv ) ) ); }',
      '#ifdef SH_FXAA',
      'float lumaAt( vec2 uv ){',
      '  vec3 c = texture2D( tMain, uv ).rgb * uExposure;',
      '  c = c / ( 1.0 + c );',
      '  return sqrt( dot( c, vec3( 0.299, 0.587, 0.114 ) ) );',
      '}',
      /* ★ **단일 반환**으로 쓴다. 예전의 다중 return 형태는 HLSL 로 번역될 때
         "warning X4000: use of potentially uninitialized variable (f_fxaa)" 를
         매 로드마다 뱉었다(A라운드 J). 결과 변수를 선언 즉시 초기화하고 분기는
         값 대입으로만 처리하면 경고가 사라진다(동작은 동일). */
      'vec3 fxaa( vec2 uv ){',
      '  vec3 outC = tone( uv );',
      '  vec2 t = uTexel;',
      '  float lNW = lumaAt( uv + vec2( -t.x, -t.y ) );',
      '  float lNE = lumaAt( uv + vec2(  t.x, -t.y ) );',
      '  float lSW = lumaAt( uv + vec2( -t.x,  t.y ) );',
      '  float lSE = lumaAt( uv + vec2(  t.x,  t.y ) );',
      '  float lM  = lumaAt( uv );',
      '  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );',
      '  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );',
      '  if ( lMax - lMin >= max( 0.028, lMax * 0.125 ) ) {',
      '    vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( ( lNW + lSW ) - ( lNE + lSE ) ) );',
      '    float red = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 0.0078125 );',
      '    float rcp = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + red );',
      '    dir = clamp( dir * rcp, -8.0, 8.0 ) * t;',
      '    vec3 A = 0.5 * ( tone( uv + dir * -0.1666 ) + tone( uv + dir * 0.1666 ) );',
      '    vec3 B = A * 0.5 + 0.25 * ( tone( uv + dir * -0.5 ) + tone( uv + dir * 0.5 ) );',
      '    float lB = dot( B, vec3( 0.299, 0.587, 0.114 ) );',
      '    outC = ( lB < lMin || lB > lMax ) ? A : B;',
      '  }',
      '  return outC;',
      '}',
      '#endif',
      'void main(){',
      '#ifdef SH_FXAA',
      '  vec3 c = fxaa( vUv );',
      '#else',
      '  vec3 c = tone( vUv );',
      '#endif',
      /* 비네트는 grab() 에서 노출 쪽에 이미 걸렸다 (주석 참조) */
      /* ★ 그레인·디더는 **트랜스퍼 커브 뒤**(= 화면 값 공간)에서 얹는다.
         선형 HDR 에 더하면 흑색 근처 sRGB 기울기(12.92)가 진폭을 13배로 증폭해서
         암부에만 얼룩이 생긴다(A라운드 J — 로코 평면 패널 라플라시안 std 18.3).
         여기서는 진폭이 화면 어디서나 동일한 uGrain(≈0.7/255)이고, 게다가
         루마 가중으로 암부(<0.10)와 최고광(>0.86)에서는 0 으로 수렴한다. */
      '  c = clamp( c, 0.0, 1.0 );',
      '  c = mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );',
      '  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );',
      '  float gw = smoothstep( 0.10, 0.42, lum ) * ( 1.0 - smoothstep( 0.86, 1.00, lum ) );',
      '  float gn = sh_hash12( gl_FragCoord.xy + vec2( fract( uTime * 13.7 ) * 137.0, fract( uTime * 7.3 ) * 311.0 ) ) - 0.5;',
      '  c += gn * uGrain * gw;',
      '  c += ( sh_hash12( gl_FragCoord.xy * 1.37 ) - 0.5 ) * ( 1.0 / 255.0 );',
      '  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );',
      '}'
    ].join('\n');

    /* ══════════════════════════════════════════════════════════════════
       머티리얼 주입 (SSAO → indirect only + 고도 기반 에어리얼)
       ══════════════════════════════════════════════════════════════════ */

    var AO_DECL = [
      'uniform sampler2D shAoMap;',
      'uniform vec2 shAoTexel;',
      'uniform float shAoStrength;',
      'uniform float shAoOn;',
      'uniform mat4 shViewInv;',
      'uniform vec3 shHazeCol;',
      'uniform vec3 shHazeP;',
      'uniform float shSpecAA;',
      ''
    ].join('\n');

    /* ── 스페큘러 안티에일리어싱 ────────────────────────────────────────
       레일 두정면(폭 4cm 의 매끈한 금속 띠)이 원경에서 점선처럼 끊기는 건 그림자나
       AA 문제가 아니라 **노멀맵 축소 + 낮은 러프니스** 조합의 스페큘러 에일리어싱이다.
       three 는 `lights_physical_fragment` 에서 기하 노멀의 미분만 러프니스에 더하므로
       (nonPerturbedNormal) 노멀맵이 만든 고주파는 잡지 못한다.
       여기서 **셰이딩 노멀**의 화면공간 분산을 러프니스에 합성해(Kaplanyan 식) 축소된
       화소일수록 자동으로 거칠어지게 한다. 클로즈업은 분산이 작아 그대로 남는다.
       머티리얼 파일을 못 고치므로 attachAO 와 같은 주입 경로를 쓴다. */
    var SPECAA_INJECT = [
      '{',
      '  vec3 shNx = dFdx( normal ), shNy = dFdy( normal );',
      '  float shNv = max( dot( shNx, shNx ), dot( shNy, shNy ) );',
      '  roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + shNv * shSpecAA ) );',
      '}',
      '#include <lights_physical_fragment>'
    ].join('\n');

    var AO_INJECT = [
      '{',
      '  float shAO = 1.0;',
      '  if ( shAoOn > 0.5 ) {',
      '    shAO = texture2D( shAoMap, gl_FragCoord.xy * shAoTexel ).r;',
      '    shAO = mix( 1.0, shAO, shAoStrength );',
      '  }',
      '  #if defined( RE_IndirectDiffuse )',
      '    irradiance *= shAO;',
      '    iblIrradiance *= shAO;',
      '  #endif',
      '  #if defined( RE_IndirectSpecular )',
      '    radiance *= mix( 1.0, shAO, 0.6 );',
      '    #ifdef USE_CLEARCOAT',
      '      clearcoatRadiance *= mix( 1.0, shAO, 0.6 );',
      '    #endif',
      '  #endif',
      /* 물리적으로는 틀리지만 Townscaper 의 크레바스가 읽히는 이유가 정확히 이것이다:
         골든아워라 키가 지배적이면 간접광에만 곱한 AO 는 화면에서 사라진다.
         직사광 확산항에도 35% 만 얹어 접합부가 "부드럽게 파인" 것처럼 보이게 한다. */
      '  reflectedLight.directDiffuse *= mix( 1.0, shAO, 0.35 );',
      '}',
      '#include <lights_fragment_end>'
    ].join('\n');

    /* pow 지수 2.4 — 1.55 는 hazeTop 바로 아래부터 벌써 절반이 녹아서 암반 스파이크와
       지층이 렌더 버그처럼 하늘색으로 사라졌다. 2.4 면 용해가 훨씬 아래에서 시작한다. */
    var HAZE_INJECT = [
      '{',
      '  vec3 shWP = ( shViewInv * vec4( -vViewPosition, 1.0 ) ).xyz;',
      '  float shH = clamp( ( shHazeP.x - shWP.y ) / max( shHazeP.y, 0.001 ), 0.0, 1.0 );',
      '  gl_FragColor.rgb = mix( gl_FragColor.rgb, shHazeCol, pow( shH, 2.4 ) * shHazeP.z );',
      '}',
      '#include <fog_fragment>'
    ].join('\n');

    function patchShader(shader) {
      var f = shader.fragmentShader;
      var didAO = false;
      if (f.indexOf('#include <lights_fragment_end>') >= 0) {
        f = f.replace('#include <lights_fragment_end>', AO_INJECT);
        didAO = true;
      }
      if (f.indexOf('#include <fog_fragment>') >= 0 && f.indexOf('vViewPosition') >= 0) {
        f = f.replace('#include <fog_fragment>', HAZE_INJECT);
      }
      if (fx.specAA > 0 && f.indexOf('#include <lights_physical_fragment>') >= 0 &&
        f.indexOf('roughnessFactor') >= 0) {
        f = f.replace('#include <lights_physical_fragment>', SPECAA_INJECT);
      }
      if (!didAO) return false;
      shader.fragmentShader = AO_DECL + f;
      shader.uniforms.shSpecAA = aoUni.shSpecAA;
      shader.uniforms.shAoMap = aoUni.shAoMap;
      shader.uniforms.shAoTexel = aoUni.shAoTexel;
      shader.uniforms.shAoStrength = aoUni.shAoStrength;
      shader.uniforms.shAoOn = aoUni.shAoOn;
      shader.uniforms.shViewInv = aoUni.shViewInv;
      shader.uniforms.shHazeCol = aoUni.shHazeCol;
      shader.uniforms.shHazeP = aoUni.shHazeP;
      return true;
    }

    function isLit(m) {
      return !!(m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial ||
        m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial));
    }

    function patchMaterial(m) {
      if (!isLit(m)) return false;
      var ud = m.userData || (m.userData = {});
      if (ud.__shAO === 1 && ud.__shAOfn === m.onBeforeCompile) return false;

      var prevOBC = (ud.__shAO === 1) ? ud.__shAOprev : m.onBeforeCompile;
      var keyBefore = '';
      try {
        keyBefore = (ud.__shAO === 1) ? (ud.__shAOkey || '')
          : (m.customProgramCacheKey ? String(m.customProgramCacheKey()) : '');
      } catch (e) { keyBefore = ''; }

      var wrapped = function (shader, r) {
        try { if (prevOBC) prevOBC.call(this, shader, r); } catch (e) { U.err(e); }
        try { patchShader(shader); } catch (e2) { U.err(e2); }
      };
      m.onBeforeCompile = wrapped;
      m.customProgramCacheKey = function () { return keyBefore + '|shAO2'; };
      ud.__shAO = 1;
      ud.__shAOfn = wrapped;
      ud.__shAOprev = prevOBC;
      ud.__shAOkey = keyBefore;
      m.needsUpdate = true;
      patchedCount++;
      return true;
    }

    function scanObject(o) {
      var m = o.material;
      if (!m) return;
      if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) patchMaterial(m[i]); }
      else patchMaterial(m);
    }

    function attachAO(root) {
      var r = root || scene;
      if (!r) return 0;
      var before = patchedCount;
      try { r.traverse(scanObject); } catch (e) { U.err(e); }
      if (patchedCount !== before) updateCompositeDefines();
      return patchedCount - before;
    }

    /* ══════════════════════════════════════════════════════════════════
       하늘 색 계산 (셰이더와 동일한 수식의 JS 판 — IBL 용)
       ══════════════════════════════════════════════════════════════════ */

    function todAt(t) {
      t = U.clamp01(t);
      var i = 0;
      while (i < TOD.length - 2 && t > TOD[i + 1].t) i++;
      var a = TOD[i], b = TOD[i + 1];
      var k = U.smooth((t - a.t) / Math.max(b.t - a.t, 1e-4));
      var out = {};
      out.el = U.lerp(a.el, b.el, k);
      out.az = U.lerp(a.az, b.az, k);
      out.ki = U.lerp(a.ki, b.ki, k);
      out.si = U.lerp(a.si, b.si, k);
      out.hi = U.lerp(a.hi, b.hi, k);
      out.exp = U.lerp(a.exp, b.exp, k);
      out.key = U.mixHex(a.key, b.key, k);
      out.zen = U.mixHex(a.zen, b.zen, k);
      out.hor = U.mixHex(a.hor, b.hor, k);
      out.gnd = U.mixHex(a.gnd, b.gnd, k);
      out.sun = U.mixHex(a.sun, b.sun, k);
      out.env = U.lerp(a.env, b.env, k);
      out.glow = U.lerp(a.glow, b.glow, k);
      out.hemiS = U.mixHex(a.hemiS, b.hemiS, k);
      out.hemiG = U.mixHex(a.hemiG, b.hemiG, k);
      return out;
    }

    /* 방향 → 선형 하늘색 (구름 노이즈는 제외 — PMREM 이 어차피 흐리고, hgt/lit 의
       기댓값 0.5 를 넣으면 평균이 셰이더와 일치한다).
       **SKY_FRAG 과 같은 골격이어야 한다** — 이게 곧 IBL 이라, 식이 어긋나면
       금속이 화면 배경과 다른 색을 반사한다. */
    var _skyC = [0, 0, 0];
    function skyAt(x, y, z, out) {
      var hl = Math.max(Math.sqrt(x * x + z * z), 1e-4);
      var sl = Math.max(Math.sqrt(sunDir.x * sunDir.x + sunDir.z * sunDir.z), 1e-4);
      var ad = 0.5 + 0.5 * ((x / hl) * (sunDir.x / sl) + (z / hl) * (sunDir.z / sl));
      var ss = U.smooth(U.clamp01((ad - 0.26) / 0.72));
      var ss2 = ss * ss;
      var dy = (y < 0) ? Math.min(-y, 1) : 0;
      var band = Math.exp(-Math.abs(y) * 13) * 0.10;
      var sd = x * sunDir.x + y * sunDir.y + z * sunDir.z;
      var sw = 0;
      if (sd > 0) {
        sw = Math.pow(sd, 4) * 0.22 + Math.pow(sd, 150) * 0.75;
        /* IBL 은 작은 디스크 대신 넓은 블롭이 스페큘러에 유리 */
        if (sd > 0.9985) sw += sky.sunI * 0.55;
      }
      /* ★ deep 은 crest 보다 **먼저** 계산해야 한다. var 호이스팅 때문에 순서를 바꾸면
         crest 가 NaN 이 되고 그 NaN 이 PMREM 환경맵 전체를 오염시켜 씬 조명이 통째로
         깨진다(실측: p5 1 / 순백 11.8%). 여기 순서를 건드리지 말 것. */
      var deep = U.smooth(U.clamp01((dy - 0.10) / 0.85));
      var glowW = 0, crest = 0;
      if (y <= 0) {
        var bandF = Math.exp(-dy * 1.45);
        glowW = skyGlow * bandF * (Math.pow(ad, 3.5) * 0.55 + Math.pow(ad, 14) * 2.2);
        /* 셰이더의 구름 꼭대기 스페큘러 — hgt/lit 기댓값에서의 평균 기여 */
        crest = (0.14 * ss2 * 2.4 + 0.0025 * 12.0) * bandF * (1 - deep * 0.55);
      }
      var ay = Math.pow(y > 1 ? 1 : (y > 0 ? y : 0), 0.42);
      var upA = U.smooth(U.clamp01(dy / 0.40));
      /* shade 기댓값 ≈ mix(0.80,1.10,0.5) * (0.90+0.10) = 0.95 */
      var bri = U.lerp(0.56, 0.92, ss) * U.lerp(1.06, 0.44, deep) * 0.95;
      for (var i = 0; i < 3; i++) {
        var zen = i === 0 ? sky.zen.r : i === 1 ? sky.zen.g : sky.zen.b;
        var hor = i === 0 ? sky.hor.r : i === 1 ? sky.hor.g : sky.hor.b;
        var gnd = i === 0 ? sky.gnd.r : i === 1 ? sky.gnd.g : sky.gnd.b;
        var sun = i === 0 ? sky.sun.r : i === 1 ? sky.sun.g : sky.sun.b;
        var warmH = U.lerp(hor, sun, 0.45) * 1.34;
        var coolH = U.lerp(gnd, zen, 0.52) * 0.88;
        var horiz = U.lerp(coolH, warmH, ss);
        var v;
        if (y > 0) {
          v = U.lerp(horiz, zen, ay);
        } else {
          var warmC = U.lerp(hor, sun, 0.55);
          var coolC = U.lerp(gnd, zen, 0.55);
          var tint = U.lerp(U.lerp(coolC, warmC, ss2), coolC * 0.62, deep * 0.85);
          v = U.lerp(horiz, tint * bri, upA);
          v += sun * (glowW + crest);
        }
        v += warmH * band + sun * sw;
        _skyC[i] = v;
      }
      out[0] = _skyC[0]; out[1] = _skyC[1]; out[2] = _skyC[2];
      return out;
    }

    /* 섬 뒤 배경(구름 바다)의 대표색. 태양 쪽/반대쪽을 하나씩 샘플해 평균한다. */
    var _dkA = [0, 0, 0], _dkB = [0, 0, 0];
    function updateDeckColor() {
      var slh = Math.max(Math.sqrt(sunDir.x * sunDir.x + sunDir.z * sunDir.z), 1e-4);
      var sx = sunDir.x / slh, sz = sunDir.z / slh;
      var px = -sz, pz = sx;
      var cs = 0.40, sn = Math.sqrt(1 - cs * cs);      /* azd 0.70 */
      var dyv = 0.58, hz = Math.sqrt(1 - dyv * dyv);
      skyAt((sx * cs + px * sn) * hz, -dyv, (sz * cs + pz * sn) * hz, _dkA);
      skyAt((sx * cs - px * sn) * hz, -dyv, (sz * cs - pz * sn) * hz, _dkB);
      sky.deck.setRGB(
        U.clamp((_dkA[0] + _dkB[0]) * 0.5, 0, 2.2),
        U.clamp((_dkA[1] + _dkB[1]) * 0.5, 0, 2.2),
        U.clamp((_dkA[2] + _dkB[2]) * 0.5, 0, 2.2));
      sky.haze.copy(sky.deck);
      aoUni.shHazeCol.value.copy(sky.haze);
      if (scene && scene.fog) scene.fog.color.copy(sky.deck);
    }

    function buildEnv() {
      if (!renderer) return;
      try {
        if (envUser) { scene.environment = envUser; return; }
        if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
        var W = 192, H = 96;
        var data = new Float32Array(W * H * 4);
        var c = [0, 0, 0];
        for (var j = 0; j < H; j++) {
          var v = (j + 0.5) / H;
          var yy = Math.sin((v - 0.5) * Math.PI);
          var rr = Math.sqrt(Math.max(0, 1 - yy * yy));
          for (var i = 0; i < W; i++) {
            var ang = ((i + 0.5) / W - 0.5) * Math.PI * 2;
            skyAt(rr * Math.cos(ang), yy, rr * Math.sin(ang), c);
            var o = (j * W + i) * 4;
            data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 1;
          }
        }
        var tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        var rt = pmrem.fromEquirectangular(tex);
        tex.dispose();
        if (envRT) envRT.dispose();
        envRT = rt;
        scene.environment = rt.texture;
      } catch (e) { U.err(e); }
    }

    function setEnvMap(tex) {
      envUser = tex || null;
      if (scene) {
        if (envUser) scene.environment = envUser;
        else buildEnv();
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       라이팅 / 시각
       ══════════════════════════════════════════════════════════════════ */

    function setTimeOfDay(t) {
      timeOfDay = U.clamp01(typeof t === 'number' ? t : 0.35);
      var p = todAt(timeOfDay);

      /* 태양 방향: 정남(+Z)에서 서(−X)쪽으로 az 도, 고도 el 도 */
      var el = p.el * DEG, az = p.az * DEG;
      var ce = Math.cos(el);
      sunDir.set(-Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce).normalize();

      sky.zen.copy(U.col(p.zen));
      sky.hor.copy(U.col(p.hor));
      sky.gnd.copy(U.col(p.gnd));
      sky.sun.copy(U.col(p.sun));
      sky.sunI = p.si;
      skyGlow = p.glow;
      /* 섬 밑동이 녹아드는 헤이즈 색 = **섬 뒤에 실제로 보이는 구름 바다 색**.
         추정하지 말고 하늘 식(skyAt)을 그 방향으로 직접 샘플한다 — 하늘을 바꾸면
         헤이즈·포그도 자동으로 따라온다. dy 0.58 / azd 0.70 = 실측된 화면 중앙 부근. */
      updateDeckColor();

      if (key) {
        key.color.copy(U.col(p.key));
        key.intensity = p.ki;
      }
      if (keyFill) {
        keyFill.color.copy(U.col(p.hemiS));
        /* 0.050 → 0.135. 예전 세기(≈0.42)는 키 8.4 에 완전히 묻혀 그림자가 청록이 아니라
           갈색-올리브로 나왔다. 방향은 태양 반대 + 위쪽 고정(SPEC §3.2 의 쿨 스카이 필).
           0.175 → 0.20: 그림자 안 **수직면**(화차 옆면·절벽)은 반구광을 절반밖에 못 받아
           그림자/순광 휘도비가 지면보다 훨씬 낮았다. 이 항이 그쪽을 들어올린다. */
        keyFill.intensity = p.ki * 0.20;
        keyFill.position.set(-sunDir.x, Math.abs(sunDir.y) * 0.45 + 0.55, -sunDir.z)
          .normalize().multiplyScalar(220);
      }
      if (hemi) {
        hemi.color.copy(U.col(p.hemiS));
        hemi.groundColor.copy(U.col(p.hemiG));
        hemi.intensity = p.hi;
      }
      exposure = exposureBase * (p.exp / 1.05);

      if (skyMat) {
        skyMat.uniforms.uZen.value.copy(sky.zen);
        skyMat.uniforms.uHor.value.copy(sky.hor);
        skyMat.uniforms.uGnd.value.copy(sky.gnd);
        skyMat.uniforms.uSun.value.copy(sky.sun);
        skyMat.uniforms.uSunDir.value.copy(sunDir);
        skyMat.uniforms.uSunI.value = sky.sunI;
        skyMat.uniforms.uGlow.value = skyGlow;
      }
      if (compMat) compMat.uniforms.uExposure.value = exposure;
      /* 헤이즈·포그 색은 updateDeckColor() 가 하늘 식에서 직접 뽑아 이미 넣었다. */

      /* 시간대에 따른 IBL 기여 (SPEC: Mat.setEnvIntensity 는 Render.setTimeOfDay 가 부른다) */
      try {
        if (SH.Mat && typeof SH.Mat.setEnvIntensity === 'function') SH.Mat.setEnvIntensity(p.env);
      } catch (e) { U.err(e); }

      lampsOn = (timeOfDay > 0.72 || timeOfDay < 0.10);
      applyLamps(p);

      fitShadow();
      buildEnv();

      try {
        SH.Bus.emit('render:tod', {
          t: timeOfDay, lampsOn: lampsOn,
          sunDir: sunDir.clone(), keyColor: p.key
        });
      } catch (e) { U.err(e); }
    }

    /* 램프 점등. 15-materials.js 의 lampGlass 는 emissiveIntensity 0 으로 만들어져 있고
       주석에 "밤에는 Render 가 올린다"고 적혀 있는데 아무도 올리지 않아 dusk 에서
       가로등·신호기가 전혀 빛나지 않았다(R2 심사 D). 여기서 시각에 맞춰 올린다.
       램프 유리는 블룸 임계값(1.02) 위로 올라가야 "번짐"이 생기므로 세기를 넉넉히 준다. */
    function applyLamps(p) {
      try {
        var m = SH.Mat && SH.Mat.lampGlass;
        if (!m) return;
        /* 해질녘(0.72) → 완전 야간(1.0) 사이에서 부드럽게 켠다. 새벽도 대칭으로. */
        var night = Math.max(U.smooth(U.clamp01((timeOfDay - 0.70) / 0.20)),
          U.smooth(U.clamp01((0.14 - timeOfDay) / 0.14)));
        var want = night * 3.4;
        if (Math.abs((m.emissiveIntensity || 0) - want) > 1e-3) {
          m.emissiveIntensity = want;
          m.needsUpdate = false;                 /* 유니폼만 바뀌므로 재컴파일 불필요 */
        }
      } catch (e) { U.err(e); }
    }

    /* 카메라 → 실제로 보고 있는 지점까지의 거리.
       rig.distance 는 하한 95m 로 클램프되어 있어 클로즈업 포즈(카메라를 직접 배치)에서는
       실제 거리의 3배가 넘는다 — 그걸 쓰면 그림자 ortho 가 200m 로 벌어져 텍셀이 6cm 가 되고,
       침목·기둥·바퀴 접지처럼 그보다 얇은 그림자는 통째로 사라진다. 실제 카메라 위치와
       주시점으로 다시 잰다. */
    function focusDistance() {
      if (!camera) return 160;
      var d = camera.position.distanceTo(rig.target);
      if (!isFinite(d) || d < 1) d = rig.distance;
      return U.clamp(d, 6, 900);
    }

    /* 카메라가 실제로 보고 있는 **지면 조각**의 코너 8개(월드 좌표)를 _rcvPts 에 채운다.
       예전 구현은 프러스텀의 **월드 AABB** 를 만든 뒤 그걸 다시 라이트 스페이스 AABB 로
       바꿔서 팽창이 두 번 일어났다 — 30m 클로즈업에서도 180m 짜리 박스가 나왔고,
       텍셀이 6cm 라 침목(0.18m)·기둥·바퀴 접지의 그림자가 통째로 사라졌다.
       여기서는 (a) 프러스텀 네 모서리 광선을 **주시 평면**(rig.target.y)까지만 늘리고
       (b) 각 점을 섬 박스로 clamp 한 뒤 (c) 그 8점을 그대로 라이트 스페이스로 보낸다.
       라이트 방향으로는 near 를 크게 열어 두므로 x/y 여유는 필요 없다 — 어떤 캐스터든
       자기 그림자가 떨어지는 지점과 같은 (x,y) 에 있기 때문. */
    function receiverPoints() {
      var tv = Math.tan(camera.fov * 0.5 * DEG);
      var th = tv * Math.max(camera.aspect, 0.05);
      var zn = Math.max(camera.near, 1);
      var zf = U.clamp(focusDistance() * 2.6 + 30, 40, Math.max(camera.far, 41));
      var planeY = rig.target.y;
      var cp = camera.position;
      for (var i = 0; i < 4; i++) {
        var sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1;
        _v3.set(sx * th, sy * tv, -1).normalize().transformDirection(camera.matrixWorld);
        var t = zf;
        if (_v3.y < -1e-3) {
          /* 이 모서리 광선이 주시 평면에 닿는 거리 (+25% 여유) */
          var tg = (planeY - cp.y) / _v3.y;
          if (tg > 0.5 && tg * 1.25 + 5 < t) t = tg * 1.25 + 5;
        }
        t = Math.max(t, zn + 2);
        _rcvPts[i].copy(_v3).multiplyScalar(zn).add(cp).clamp(_fitBox.min, _fitBox.max);
        _rcvPts[i + 4].copy(_v3).multiplyScalar(t).add(cp).clamp(_fitBox.min, _fitBox.max);
      }
    }

    /* 그림자 ortho 를 **화면에 보이는 영역**에 꽉 맞춘다.
       예전에는 섬 전체(약 230m)를 덮어 텍셀이 0.075m 였고, PCF 반경 2.2텍셀이면
       블러 폭이 0.33m — 울타리 기둥(0.12m)·드럼통·덤불의 그림자가 통째로 지워졌다.
       프러스텀에 맞추면 클로즈업/미드샷에서 텍셀이 0.02~0.03m 로 줄어 소품 접지
       그림자가 살아난다(사실상 1-캐스케이드 CSM). 매 프레임 호출한다. */
    function fitShadow() {
      if (!key) return;
      sceneRadius = sceneBounds.getBoundingSphere(_sph).radius;

      /* 그림자용 박스: 섬 윗면 기준 위쪽만 — 아래쪽(암반·뿌리)은 어차피 태양을 등지고 있고
         라이트 스페이스 범위를 키워 텍셀만 굵어진다. */
      _fitBox.copy(sceneBounds);
      _fitBox.min.y = Math.max(_fitBox.min.y, _fitBox.max.y - 34);

      /* 라이트 뷰의 원점은 **카메라와 무관하게 고정**한다. 그래야 아래의 텍셀 스냅이
         진짜 안정화가 되어 카메라가 움직여도 그림자 가장자리가 끓지 않는다. */
      var c0 = _fitBox.getCenter(_v1);
      var dist = Math.max(sceneRadius * 1.8, 160);
      key.position.copy(sunDir).multiplyScalar(dist).add(c0);
      key.target.position.copy(c0);
      key.target.updateMatrixWorld(true);
      key.updateMatrixWorld(true);

      /* 라이트 뷰 행렬(월드→라이트). Object3D.lookAt 은 +Z 를 향하므로 쓰면 안 되고,
         카메라와 같은 −Z 규약인 Matrix4.lookAt 으로 직접 만든다. */
      _m1.identity();
      _m1.lookAt(key.position, c0, _upY);
      _m1.setPosition(key.position);
      _m1.invert();

      if (camera) receiverPoints();
      else { for (var k = 0; k < 8; k++) _rcvPts[k].copy(_fitBox.max); }

      var lx = 1e9, hx = -1e9, ly = 1e9, hy = -1e9, lz = 1e9, hz = -1e9;
      for (var i = 0; i < 8; i++) {
        var p = _v3.copy(_rcvPts[i]).applyMatrix4(_m1);
        if (p.x < lx) lx = p.x; if (p.x > hx) hx = p.x;
        if (p.y < ly) ly = p.y; if (p.y > hy) hy = p.y;
        if (p.z < lz) lz = p.z; if (p.z > hz) hz = p.z;
      }

      /* 정사각 + 1/4옥타브로 양자화한 스팬 + 텍셀 격자 스냅 = 카메라가 움직여도
         그림자가 지글대지 않는다(스팬이 매 프레임 미세하게 변하면 전체가 끓는다). */
      var span = Math.max(hx - lx, hy - ly) * 1.10 + 1.5;

      /* 스팬 상한 = 초점거리에서의 화면 폭 × 4 (사실상 1-캐스케이드 CSM).
         부감이 낮으면 화면 위쪽의 지면이 초점거리의 3~5배까지 뻗는데, 거기까지 담으면
         텍셀이 3~6cm 로 굵어져 **가까운** 접지 그림자가 다시 뭉개진다. 리뷰어가 보는 건
         근경이므로 근경을 택하고, 잘릴 때는 ortho 중심을 주시점에 맞춰 잘린 쪽이
         화면 위 먼 배경으로만 가게 한다. */
      var thv = Math.tan(camera ? camera.fov * 0.5 * DEG : 0.21) *
        Math.max(camera ? camera.aspect : 1.7, 1.0);
      var spanCap = Math.max(16, 4.0 * focusDistance() * thv);
      var capped = spanCap < span;
      if (capped) span = spanCap;

      span = U.clamp(span, 10, 420);
      span = Math.pow(2, Math.ceil(Math.log(span) / Math.LN2 * 4) / 4);
      var texel = span / Math.max(1, _q.shadow);

      var mcx = (lx + hx) * 0.5, mcy = (ly + hy) * 0.5;
      if (capped) {
        _v3.copy(rig.target).applyMatrix4(_m1);
        if (isFinite(_v3.x)) { mcx = _v3.x; mcy = _v3.y; }
      }
      var cx = Math.round(mcx / texel) * texel;
      var cy = Math.round(mcy / texel) * texel;

      var sc = key.shadow.camera;
      sc.left = cx - span * 0.5; sc.right = cx + span * 0.5;
      sc.bottom = cy - span * 0.5; sc.top = cy + span * 0.5;
      /* near 를 태양 쪽으로 크게 열어 박스 밖의 캐스터(섬 전체)까지 그림자를 던지게 한다.
         x/y 를 넓히지 않으므로 텍셀 크기는 그대로다. */
      sc.near = Math.max(0.5, -hz - 150);
      sc.far = -lz + 12;
      sc.updateProjectionMatrix();

      /* 노멀 바이어스는 **텍셀에 비례**해야 한다. 0.85×텍셀은 PCF 커널(±1.6텍셀)이
         훑는 대각선 오차보다 작아서 평평한 잔디·발라스트 전면에 저주파 애크니가 남았고,
         그게 "그림자는 없는데 화면만 뿌옇게 어두운" 원인이었다. 2.0×텍셀이면 애크니가
         사라지고, 텍셀이 1cm 인 클로즈업에서는 오프셋이 2cm 라 접지 그림자가 그대로 붙는다. */
      /* 절대 상한(0.055)이 있으면 원경에서 오프셋이 모자라 애크니가 남는다.
         스팬이 초점거리에 비례하므로 2×텍셀은 **화면 픽셀 기준 항상 ~1.7px** 로 일정하다
         — 즉 스케일에 안전하다. 상한은 폭주 방지용으로만 둔다. */
      key.shadow.normalBias = U.clamp(texel * 2.0, 0.004, 0.14);
      key.shadow.bias = -0.00006;
      key.shadow.radius = _q.shadowRadius;
    }

    function setSceneBounds(box) {
      if (!box || !box.isBox3 || box.isEmpty()) return;
      sceneBounds.copy(box);
      /* 극단값 방어 */
      sceneBounds.min.max(new THREE.Vector3(-600, -400, -600));
      sceneBounds.max.min(new THREE.Vector3(600, 400, 600));
      /* 뿌리/파티클 여유 */
      sceneBounds.expandByScalar(2);
      boundsSet = true;
      fitShadow();
      /* 카메라는 건드리지 않는다 — 기본 프레이밍(SPEC 값)은 그대로 두고,
         프레이밍은 Game/Input 의 frameBounds() 가 담당한다. */
    }

    /* ── 세로 화면 확대율 ────────────────────────────────────────────────
       실측(mm.py, 430×932): 섬이 화면 **폭의 91.6%** 를 채우는데 **높이는 48.5%** 뿐이다.
       원인은 종횡비다 — 섬의 화면투영 가로:세로가 거의 1:1 인데 fov 24 의 가로 화각이
       세로에서 11° 로 좁아져 **가로가 프레임을 결정**해 버린다. 프레이밍(90-game 의
       frameHero)은 가로·세로 중 **큰 쪽**을 채우므로 세로는 그만큼 남는다.
       fov 를 넓혀도 NDC 점유율은 그대로다(원근만 세짐). 유일한 해법은 **섬의 양 끝을
       프레임 밖으로 흘리고 더 다가가는 것** — 어차피 양 끝은 빈 잔디다.
       거리에 이 계수를 곱해 세로 점유율을 48% → 65% 대로 끌어올린다. */
    function portraitZoom() {
      var a = camera ? Math.max(camera.aspect, 0.25) : 1.7;
      return U.lerp(1.0, 0.71, U.clamp01((0.86 - a) / 0.40));
    }

    /* 아직 아무도 카메라를 만지지 않았을 때의 기본 거리. 세로 화면이면 물러난다. */
    function defaultDistance() {
      var a = camera ? Math.max(camera.aspect, 0.25) : 1.7;
      return U.clamp(190 * U.clamp(1.70 / a, 1, 2.6) * portraitZoom(), D_MIN, maxDist());
    }

    /* ══════════════════════════════════════════════════════════════════
       렌더 타겟
       ══════════════════════════════════════════════════════════════════ */

    function rtOpts(extra) {
      var o = {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false
      };
      if (extra) for (var k in extra) o[k] = extra[k];
      return o;
    }

    function disposeRT(rt) { if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); } }

    function freeRTs() {
      disposeRT(mainRT); mainRT = null;
      disposeRT(nrmRT); nrmRT = null;
      disposeRT(aoRT); aoRT = null;
      disposeRT(aoTmpRT); aoTmpRT = null;
      for (var i = 0; i < bloomRT.length; i++) disposeRT(bloomRT[i]);
      bloomRT.length = 0;
    }

    function allocRTs() {
      if (!post) return;
      freeRTs();
      var w = Math.max(2, _w), h = Math.max(2, _h);

      /* MSAA 는 **생성 옵션으로** 넘긴다 — 나중에 대입하면 이미 초기화된 RT 에서는
         무시될 수 있다. 이게 실제로 켜져야 지오메트리 엣지 계단이 사라진다. */
      mainRT = new THREE.WebGLRenderTarget(w, h, rtOpts({
        depthBuffer: true, samples: isGL2 ? _q.msaa : 0
      }));
      mainRT.samples = isGL2 ? _q.msaa : 0;
      mainRT.texture.name = 'sh.main';

      if (_q.ssao) {
        var pw = Math.max(2, Math.round(w * _q.prepass)), ph = Math.max(2, Math.round(h * _q.prepass));
        var dt = new THREE.DepthTexture(pw, ph);
        dt.type = THREE.UnsignedIntType;
        dt.format = THREE.DepthFormat;
        dt.minFilter = THREE.NearestFilter;
        dt.magFilter = THREE.NearestFilter;
        dt.generateMipmaps = false;
        nrmRT = new THREE.WebGLRenderTarget(pw, ph, rtOpts({
          type: THREE.UnsignedByteType, depthBuffer: true,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: dt
        }));
        nrmRT.texture.name = 'sh.normal';

        var aw = Math.max(2, w >> 1), ah = Math.max(2, h >> 1);
        var aoOpt = rtOpts({ type: THREE.UnsignedByteType });
        aoRT = new THREE.WebGLRenderTarget(aw, ah, aoOpt);
        aoTmpRT = new THREE.WebGLRenderTarget(aw, ah, rtOpts({ type: THREE.UnsignedByteType }));
        aoRT.texture.name = 'sh.ao';
      }

      var bw = w, bh = h;
      for (var i = 0; i < _q.bloomLevels; i++) {
        bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
        var rt = new THREE.WebGLRenderTarget(bw, bh, rtOpts());
        rt.texture.name = 'sh.bloom' + i;
        bloomRT.push(rt);
      }

      aoUni.shAoTexel.value.set(1 / w, 1 / h);
      aoUni.shAoMap.value = (_q.ssao && aoRT) ? aoRT.texture : whiteTex;
      aoUni.shAoOn.value = _q.ssao ? 1 : 0;

      if (compMat) {
        compMat.uniforms.tMain.value = mainRT.texture;
        compMat.uniforms.tBloom.value = bloomRT.length ? bloomRT[0].texture : whiteTex;
        compMat.uniforms.tAO.value = aoRT ? aoRT.texture : whiteTex;
        compMat.uniforms.uTexel.value.set(1 / w, 1 / h);
        compMat.uniforms.uCA.value = _q.ca ? (fx.ca * 8.0 / Math.max(h, 1)) : 0;
      }
      if (ssaoMat) {
        ssaoMat.uniforms.tDepth.value = nrmRT ? nrmRT.depthTexture : null;
        ssaoMat.uniforms.tNormal.value = nrmRT ? nrmRT.texture : null;
        ssaoMat.uniforms.uRes.value.set(_w, _h);
        ssaoMat.uniforms.uNoiseScale.value.set(Math.max(2, w >> 1) / NOISE_N,
          Math.max(2, h >> 1) / NOISE_N);
      }
      if (blurMat) blurMat.uniforms.tDepth.value = nrmRT ? nrmRT.depthTexture : null;
    }

    /* ══════════════════════════════════════════════════════════════════
       패스 머티리얼 생성
       ══════════════════════════════════════════════════════════════════ */

    /* ACES(Hill) 스칼라 값 — 화이트포인트 정규화 계수를 CPU 에서 미리 구한다.
       aces(1.0) = 0.619 · aces(3.0) = 0.873 · aces(25.7) = 1.0 이 커브의 실제 모습이다. */
    function acesScalar(x) {
      var a = x * (x + 0.0245786) - 0.000090537;
      var b = x * (0.983729 * x + 0.432951) + 0.238081;
      return a / b;
    }
    function whiteNorm() {
      return 1 / Math.max(acesScalar(U.clamp(fx.white, 0.6, 40)), 1e-4);
    }

    function passMat(frag, uniforms, defines) {
      return new THREE.ShaderMaterial({
        uniforms: uniforms, vertexShader: VERT_FS, fragmentShader: frag,
        defines: defines || {}, depthTest: false, depthWrite: false, fog: false
      });
    }

    function buildKernel(n) {
      var r = U.rng('ssao-kernel');
      var arr = [];
      for (var i = 0; i < n; i++) {
        var v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 0.92 + 0.08).normalize();
        var s = i / n;
        v.multiplyScalar(U.lerp(0.10, 1.0, s * s));
        arr.push(v);
      }
      return arr;
    }

    /* 8×8 타일 + 황금각 저불일치 수열. 4×4 순수 랜덤은 이웃한 4픽셀이 같은 각을
       뽑는 일이 잦아 블러 뒤에도 얼룩(스페클)이 남았다(A라운드 E). 황금각을 쓰면
       어떤 3×3 이웃을 봐도 각이 고르게 흩어져 같은 블러 폭에서 훨씬 깨끗하다. */
    var NOISE_N = 8;
    function buildNoiseTex() {
      var r = U.rng('ssao-noise');
      var n = NOISE_N * NOISE_N;
      var d = new Uint8Array(n * 4);
      var GA = Math.PI * (3 - Math.sqrt(5));            /* 황금각 ≈ 2.39996 rad */
      for (var i = 0; i < n; i++) {
        var a = (i * GA + r() * 0.35) % (Math.PI * 2);
        d[i * 4] = Math.round((Math.cos(a) * 0.5 + 0.5) * 255);
        d[i * 4 + 1] = Math.round((Math.sin(a) * 0.5 + 0.5) * 255);
        d[i * 4 + 2] = 128;
        d[i * 4 + 3] = 255;
      }
      var t = new THREE.DataTexture(d, NOISE_N, NOISE_N, THREE.RGBAFormat);
      t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
      t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    }

    function buildSSAOMat() {
      if (ssaoMat) { ssaoMat.dispose(); ssaoMat = null; }
      var n = _q.aoSamples;
      ssaoMat = passMat(ssaoFrag(n), {
        tDepth: { value: null }, tNormal: { value: null }, tNoise: { value: noiseTex },
        uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
        uKernel: { value: buildKernel(n) },
        uNoiseScale: { value: new THREE.Vector2(160, 90) },
        uRes: { value: new THREE.Vector2(1280, 720) },
        uRadius: { value: ao.radius }, uBias: { value: ao.bias },
        uIntensity: { value: ao.intensity }, uPower: { value: ao.power },
        uNear: { value: 1 }, uFar: { value: 1000 },
        uMinPx: { value: ao.minPx }, uMaxPx: { value: ao.maxPx },
        uWide: { value: ao.wide }, uWideI: { value: ao.wideI }
      });
    }

    function buildPasses() {
      fsGeo = new THREE.BufferGeometry();
      fsGeo.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      fsGeo.setAttribute('uv', new THREE.BufferAttribute(
        new Float32Array([0, 0, 2, 0, 0, 2]), 2));
      fsGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

      quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      quadScene = new THREE.Scene();
      quadMesh = new THREE.Mesh(fsGeo, null);
      quadMesh.frustumCulled = false;
      quadMesh.matrixAutoUpdate = false;
      quadScene.add(quadMesh);

      noiseTex = buildNoiseTex();

      whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
      whiteTex.needsUpdate = true;
      aoUni.shAoMap.value = whiteTex;

      /* 하늘 — 씬 안에 산다 */
      skyMat = new THREE.ShaderMaterial({
        uniforms: {
          uInvVP: { value: new THREE.Matrix4() },
          uCamPos: { value: new THREE.Vector3() },
          uZen: { value: new THREE.Color(0.05, 0.15, 0.36) },
          uHor: { value: new THREE.Color(0.86, 0.53, 0.26) },
          uGnd: { value: new THREE.Color(0.13, 0.12, 0.10) },
          uSun: { value: new THREE.Color(1, 0.83, 0.55) },
          uSunDir: { value: new THREE.Vector3(-0.816, 0.469, 0.338) },
          uSunI: { value: 16 },
          uGlow: { value: 0.15 },
          uTime: { value: 0 },
          uDirect: { value: 0 },
          uWhiteN: { value: whiteNorm() },
          uDetail: { value: 1 }
        },
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
        depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
        toneMapped: false
      });
      skyMesh = new THREE.Mesh(fsGeo, skyMat);
      skyMesh.frustumCulled = false;
      skyMesh.matrixAutoUpdate = false;
      skyMesh.renderOrder = -100000;
      skyMesh.castShadow = false;
      skyMesh.receiveShadow = false;
      skyMesh.userData.noPrepass = true;
      skyMesh.userData.noPick = true;
      skyMesh.name = 'sh.sky';
      skyMesh.raycast = function () { };

      prepassMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

      if (!post) return;

      buildSSAOMat();

      blurMat = passMat(BLUR_FRAG, {
        tAO: { value: null }, tDepth: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uNear: { value: 1 }, uFar: { value: 1000 }, uSharp: { value: 1.6 }
      });

      preMat = passMat(PREFILTER_FRAG, {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: fx.threshold }, uKnee: { value: fx.knee }, uClamp: { value: 26 }
      });

      downMat = passMat(DOWN_FRAG, {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }
      });

      upMat = passMat(UP_FRAG, {
        tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 }
      });
      upMat.blending = THREE.AdditiveBlending;
      upMat.transparent = true;

      compMat = passMat(COMP_FRAG, {
        tMain: { value: null }, tBloom: { value: null }, tAO: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uBloomTint: { value: new THREE.Color(1.0, 0.93, 0.82) },
        /* 스플릿 토닝 — **곱셈**만 쓴다(가산 리프트 금지, grade() 주석 참조).
           그림자는 청록으로, 하이라이트는 골든아워 웜으로. */
        uShadTint: { value: new THREE.Color(0.828, 0.972, 1.235) },
        uHighTint: { value: new THREE.Color(1.050, 1.005, 0.930) },
        uWhiteN: { value: whiteNorm() }, uContrast: { value: fx.contrast },
        uExposure: { value: exposure }, uBloom: { value: fx.bloom },
        uCA: { value: 0 }, uVig: { value: fx.vignette },
        uGrain: { value: fx.grain }, uTime: { value: 0 }, uSat: { value: fx.sat },
        uAOMix: { value: ao.mix }
      });
      updateCompositeDefines();
    }

    function updateCompositeDefines() {
      if (!compMat) return;
      var d = {};
      if (_q.fxaa) d.SH_FXAA = '';
      if (_q.ca) d.SH_CA = '';
      if (_q.ssao) d.SH_AO = '';
      /* 머티리얼 주입이 아직 안 붙었으면 화면 AO 를 더 세게 (그때는 이게 유일한 AO) */
      compMat.uniforms.uAOMix.value = patchedCount === 0 ? Math.max(ao.mix, 0.55) : ao.mix;
      var oldKeys = Object.keys(compMat.defines || {}).sort().join(',');
      var newKeys = Object.keys(d).sort().join(',');
      if (oldKeys === newKeys) return;
      compMat.defines = d;
      compMat.needsUpdate = true;
    }

    /* ══════════════════════════════════════════════════════════════════
       init
       ══════════════════════════════════════════════════════════════════ */

    function init(canvasEl) {
      if (inited) return { renderer: renderer, scene: scene, camera: camera };
      try {
        isGL2 = (function () {
          try {
            var cv = document.createElement('canvas');
            return !!(cv.getContext('webgl2'));
          } catch (e) { return false; }
        })();

        var shotMode = /[?&](shot|debug)/.test(location.search);

        renderer = new THREE.WebGLRenderer({
          canvas: canvasEl,
          antialias: !isGL2,
          powerPreference: 'high-performance',
          stencil: false,
          alpha: false,
          depth: true,
          preserveDrawingBuffer: shotMode
        });
        renderer.setPixelRatio(1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        /* ACES 는 합성 패스에서 직접 — 중간 RT 는 선형 HDR 유지 (CONTRACT 참조) */
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 1);
        renderer.shadowMap.enabled = true;
        /* PCFSoftShadowMap 은 three 내부에서 shadow.radius 를 무시하고 고정 1텍셀
           텐트필터를 쓴다(9탭). PCF 는 17탭 + radius 로 페넘브라 폭을 제어할 수 있어
           접지는 또렷하고 먼 그림자는 부드럽게 만들 수 있다. */
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.shadowMap.autoUpdate = false;
        renderer.info.autoReset = false;

        API.maxAniso = renderer.capabilities.getMaxAnisotropy() || 4;
        post = isGL2;

        /* 기본 품질 */
        _quality = U.isTouch() ? 1 : 2;
        if (isGL2 && window.screen && Math.min(window.screen.width, window.screen.height) <= 400 &&
          (window.devicePixelRatio || 1) >= 2.5) _quality = 1;
        _q = QUAL[_quality];
        info.quality = _quality;

        scene = new THREE.Scene();
        scene.background = null;
        /* near/far 는 updateCamera() 가 매 프레임 씬 바운즈로 재계산한다(CONTRACT 참조).
           색은 setTimeOfDay 가 지평선 색 기준으로 덮어쓴다. 여기 값은 첫 프레임용. */
        scene.fog = new THREE.Fog(0xe4bf9b, 520, 2400);

        camera = new THREE.PerspectiveCamera(24, 1, 4, 1200);
        camera.position.set(0, 100, 200);
        scene.add(camera);

        /* ── 라이팅 ── */
        key = new THREE.DirectionalLight(0xffffff, 8.4);
        key.castShadow = true;
        key.shadow.mapSize.set(_q.shadow, _q.shadow);
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 800;
        key.shadow.bias = -0.00009;
        key.shadow.normalBias = 0.03;
        key.shadow.radius = _q.shadowRadius;
        key.name = 'sh.key';
        scene.add(key);
        scene.add(key.target);

        keyFill = new THREE.DirectionalLight(0x9fc4ff, 0.44);
        keyFill.castShadow = false;
        keyFill.name = 'sh.fill';
        scene.add(keyFill);

        hemi = new THREE.HemisphereLight(0x9fc4ff, 0xc98f5a, 0.55);
        hemi.name = 'sh.hemi';
        scene.add(hemi);

        _shakeNoise = U.noise2D(1337);

        buildPasses();
        scene.add(skyMesh);

        setTimeOfDay(0.35);

        _needResize = true;
        resize();

        SH.Bus.on('world:ready', onWorldEvent);
        SH.Bus.on('world:built', onWorldEvent);
        SH.Bus.on('scene:dirty', function () { attachAO(scene); });
        window.addEventListener('resize', markResize, false);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', markResize, false);

        inited = true;
        disposed = false;
      } catch (e) {
        U.err(e);
        U.fail('렌더러를 초기화하지 못했습니다.');
      }
      return { renderer: renderer, scene: scene, camera: camera };
    }

    function onWorldEvent(payload) {
      try {
        if (payload && payload.bounds && payload.bounds.isBox3) setSceneBounds(payload.bounds);
        else if (payload && payload.world && payload.world.bounds) setSceneBounds(payload.world.bounds);
        attachAO(scene);
      } catch (e) { U.err(e); }
    }

    function markResize() { _needResize = true; }

    /* ══════════════════════════════════════════════════════════════════
       resize / quality
       ══════════════════════════════════════════════════════════════════ */

    function resize() {
      if (!renderer) return;
      var el = renderer.domElement;
      var cw = el.clientWidth || window.innerWidth || 1;
      var ch = el.clientHeight || window.innerHeight || 1;
      var pr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(2, Math.round(cw * pr * _q.res));
      var h = Math.max(2, Math.round(ch * pr * _q.res));
      var px = w * h;
      if (px > _q.maxPx) {
        var s = Math.sqrt(_q.maxPx / px);
        w = Math.max(2, Math.round(w * s)); h = Math.max(2, Math.round(h * s));
      }
      if (w === _w && h === _h && cw === _cw && ch === _ch) { _needResize = false; return; }
      _w = w; _h = h; _cw = cw; _ch = ch;
      _needResize = false;

      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      /* 화면비가 바뀌면(폰 회전 등) 세로 보정을 다시 건다 — 그러지 않으면 회전 후
         프레이밍이 가로 기준으로 남아 세로에서 섬이 다시 손톱만 해진다. */
      if (!camTouched) { rig.distT = defaultDistance(); rig.distance = rig.distT; }
      else if (rig.distRaw > 0) {
        rig.distT = U.clamp(rig.distRaw * portraitZoom(), D_MIN, maxDist());
      }
      allocRTs();
    }

    function setQuality(q) {
      q = U.clamp(Math.round(q), 0, 2) | 0;
      if (!renderer) { _quality = q; _q = QUAL[q]; return; }
      var changedSamples = QUAL[q].aoSamples !== _q.aoSamples;
      _quality = q; _q = QUAL[q]; info.quality = q;

      if (key) {
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
        key.shadow.mapSize.set(_q.shadow, _q.shadow);
        key.shadow.radius = _q.shadowRadius;
      }
      if (post && changedSamples) buildSSAOMat();
      if (skyMat) skyMat.uniforms.uDetail.value = (q >= 1) ? 1 : 0;
      applyAOUniforms();
      updateCompositeDefines();
      _needResize = true;
      _w = -1;                     /* 강제 재할당 */
      resize();
      fitShadow();
    }

    function applyAOUniforms() {
      if (compMat && compMat.uniforms.uAOMix) {
        compMat.uniforms.uAOMix.value = patchedCount === 0 ? Math.max(ao.mix, 0.55) : ao.mix;
      }
      if (!ssaoMat) return;
      ssaoMat.uniforms.uRadius.value = ao.radius;
      ssaoMat.uniforms.uBias.value = ao.bias;
      ssaoMat.uniforms.uIntensity.value = ao.intensity;
      ssaoMat.uniforms.uPower.value = ao.power;
      ssaoMat.uniforms.uMinPx.value = ao.minPx;
      ssaoMat.uniforms.uMaxPx.value = ao.maxPx;
      ssaoMat.uniforms.uWide.value = ao.wide;
      ssaoMat.uniforms.uWideI.value = ao.wideI;
      ssaoMat.uniforms.tNoise.value = noiseTex;
      aoUni.shAoStrength.value = ao.strength;
      aoUni.shSpecAA.value = Math.max(fx.specAA, 0);
    }

    function autoQuality(dt) {
      if (!renderer || _downgrades >= 2 || _quality <= 0) return;
      if (_frames < 60) return;
      if (_cool > 0) { _cool--; return; }
      if (dt > 0.25 || dt <= 0) return;
      _histSum += dt; _histN++;
      if (_histN < 30) return;
      var fps = _histN / _histSum;
      _histSum = 0; _histN = 0;
      if (fps < 45) {
        _downgrades++;
        _cool = 180;
        setQuality(_quality - 1);
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       카메라 리그
       ══════════════════════════════════════════════════════════════════ */

    function clampRig() {
      rig.azT = U.clamp(rig.azT, AZ_BASE - AZ_SPAN, AZ_BASE + AZ_SPAN);
      rig.elT = U.clamp(rig.elT, EL_MIN, EL_MAX);
      rig.distT = U.clamp(rig.distT, D_MIN, maxDist());
      rig.targetT.x = U.clamp(rig.targetT.x, panBox.min.x, panBox.max.x);
      rig.targetT.y = U.clamp(rig.targetT.y, panBox.min.y, panBox.max.y);
      rig.targetT.z = U.clamp(rig.targetT.z, panBox.min.z, panBox.max.z);
    }

    function orbit(dx, dy) {
      camTouched = true;
      rig.azT += (dx || 0) * 0.20;
      rig.elT += (dy || 0) * 0.16;
      clampRig();
    }

    /**
     * 줌. dz 는 "휠 노치" 단위 — 1 노치 ≈ 거리 10% 변화.
     * ZOOM_K = ln(1.10). 이전 값 0.0012 는 노치당 0.12% 라 사실상 작동하지 않았다
     * (466 → 200 으로 좁히는 데 휠을 약 700번 굴려야 했다).
     */
    function zoom(dz) {
      camTouched = true;
      rig.distT *= Math.exp(U.clamp(dz || 0, -30, 30) * ZOOM_K);
      clampRig();
      rig.distRaw = rig.distT / Math.max(portraitZoom(), 1e-3);   /* 회전해도 유지 */
    }

    function pan(dx, dy) {
      if (!camera) return;
      camTouched = true;
      var k = 2 * Math.tan(camera.fov * 0.5 * DEG) * rig.distance / Math.max(_ch, 1);
      /* 화면 기준 오른쪽 / 지면 기준 전방 */
      var a = rig.azimuth * DEG;
      _v1.set(Math.cos(a), 0, Math.sin(a));            /* 화면 오른쪽 (지면 투영) */
      _v2.set(Math.sin(a), 0, -Math.cos(a));           /* 카메라→타깃 전방 (지면 투영) */
      rig.targetT.addScaledVector(_v1, -(dx || 0) * k);
      rig.targetT.addScaledVector(_v2, (dy || 0) * k);
      clampRig();
    }

    function shake(strength) {
      _shakeAmp = Math.min(_shakeAmp + Math.abs(strength == null ? 0.6 : strength), 2.4);
    }

    function setCam(o) {
      if (!o) return;
      camTouched = true;
      if (typeof o.azimuth === 'number') rig.azT = o.azimuth;
      if (typeof o.elevation === 'number') rig.elT = o.elevation;
      /* 호출자가 준 거리는 **가로 기준** 프레이밍이다. 세로 화면 보정은 여기서 건다
         (portraitZoom 주석 참조). 원본을 기억해 두어 화면 회전 시 다시 계산한다. */
      if (typeof o.distance === 'number') {
        rig.distRaw = o.distance;
        rig.distT = o.distance * portraitZoom();
      }
      if (o.target) {
        if (o.target.isVector3) rig.targetT.copy(o.target);
        else if (o.target.length >= 3) rig.targetT.set(o.target[0], o.target[1], o.target[2]);
      }
      clampRig();
      if (o.instant) {
        rig.azimuth = rig.azT; rig.elevation = rig.elT;
        rig.distance = rig.distT; rig.target.copy(rig.targetT);
        updateCamera(0);
      }
    }

    function getCam() {
      return {
        azimuth: rig.azimuth, elevation: rig.elevation,
        distance: rig.distance, target: rig.target.clone()
      };
    }

    /* 박스를 화면에 정확히 맞추는 거리. 바운딩 스피어를 쓰면 길쭉한 야드에서 과하게
       물러나므로, 목표 시점 기준 right/up/forward 축에 투영해 정확히 계산한다. */
    function fitDistance(box, margin, azDeg, elDeg) {
      var az = azDeg * DEG, el = elDeg * DEG, ce = Math.cos(el);
      _v1.set(-Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce);   /* target → camera */
      _v2.set(Math.cos(az), 0, Math.sin(az));                          /* right */
      _v3.crossVectors(_v1, _v2);                                      /* up */

      box.getCenter(_sph.center);
      var mn = box.min, mx = box.max, hw = 0, hh = 0, hd = 0, n = 0;
      for (var xi = 0; xi < 2; xi++) for (var yi = 0; yi < 2; yi++) for (var zi = 0; zi < 2; zi++) {
        var p = _corner[n++].set(xi ? mx.x : mn.x, yi ? mx.y : mn.y, zi ? mx.z : mn.z)
          .sub(_sph.center);
        hw = Math.max(hw, Math.abs(p.dot(_v2)));
        hh = Math.max(hh, Math.abs(p.dot(_v3)));
        hd = Math.max(hd, Math.abs(p.dot(_v1)));
      }
      var tv = Math.tan(camera.fov * 0.5 * DEG);
      var th = tv * Math.max(camera.aspect, 0.05);
      /* 깊이 패딩(hd)은 원근 때문에 앞쪽 모서리가 커지는 만큼만. 예전 0.6/0.3 은 과해서
         야드가 화면을 덜 채우고 하늘 여백이 40% 넘게 남았다. */
      return Math.max(hw / th, hh / tv) * margin + hd * 0.20;
    }

    /* 세로 화면에서는 fov 24 로 야드 길이를 담을 수 없어 최대 거리를 화면비에 맞춰 늘린다 */
    function maxDist() {
      var a = camera ? Math.max(camera.aspect, 0.25) : 1.7;
      return D_MAX * U.clamp(1.70 / a, 1, 3.0);
    }

    function frameBounds(box, opts) {
      if (!box || !box.isBox3 || box.isEmpty() || !camera) return;
      opts = opts || {};
      var margin = opts.margin == null ? 1.18 : opts.margin;
      var az = typeof opts.azimuth === 'number' ? opts.azimuth : rig.azT;
      var el = typeof opts.elevation === 'number' ? opts.elevation : rig.elT;
      var asp = Math.max(camera.aspect, 0.05);
      var yb = opts.yBias || 0;

      /* ── 넓은 프레이밍(야드 전체)에서의 부감 하한 ────────────────────
         야드 박스는 116m × 24m 라 가로 화면에서는 **폭**이 프레임을 결정한다.
         부감 26° 면 박스의 세로 투영이 화면 높이의 61% 밖에 안 되고 나머지 39% 가
         빈 하늘로 남는다(R2 심사 H: "화면의 38%가 죽은 공간"). 부감을 36° 로 올리면
         같은 거리에서 세로 투영이 82% 로 늘어 하늘 띠가 10% 아래로 줄고, 덤으로
         선로 축이 수평 대비 약 26° 로 누워 대각선이 화면을 반으로 가르지 않는다.
         (SPEC §6 은 부감 26~42° 를 허용한다. 클로즈업 포즈는 frameBounds 를 타지 않는다.) */
      /* 호출자가 부감을 지정하지 않은 넓은 프레이밍에서만 부감 하한을 건다.
         야드 박스는 116m × 24m 라 가로 화면에서는 폭이 프레임을 결정하고, 부감 26° 면
         세로 투영이 화면 높이의 61% 밖에 안 돼 나머지가 빈 하늘로 남는다(R2 심사 H).
         34° 면 82% 까지 차오르고 선로 축도 수평 대비 ~25° 로 눕는다.
         (명시 elevation 은 존중한다 — 80-ui 의 타이틀 프레이밍을 깨지 않기 위함.) */
      if (typeof opts.elevation !== 'number' && asp >= 0.85 &&
        Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > 55) {
        el = U.clamp(Math.max(el, 34), EL_MIN, EL_MAX);
      }
      /* ── 세로 화면(폰) 재프레이밍 ──────────────────────────────────
         230m × 85m 짜리 야드를 세로 프레임에 통째로 넣으면 화면 중앙의 얇은 띠가
         되어 화차 종류를 못 읽는다. fov 를 넓히면(원근이 강해져) 미니어처 느낌이
         죽으므로, fov 24 를 지키는 대신 **거리를 줄여 야드 양끝을 프레임 밖으로
         흘린다**. 부감을 더 주면 선로 간격이 벌어져 편성이 읽힌다. */
      if (asp < 0.85) {
        var k = U.clamp01((0.85 - asp) / 0.42);
        el = U.clamp(el + 12 * k, EL_MIN, EL_MAX);
        yb -= (box.max.y - box.min.y) * 0.10 * k;
      }
      var d = fitDistance(box, margin, az, el);

      /* 세로 보정은 portraitZoom() 하나로 통일 (예전의 margin 0.60 배 해킹을 대체) */
      rig.distRaw = d;
      rig.distT = U.clamp(d * portraitZoom(), D_MIN, maxDist());
      rig.targetT.copy(_sph.center);
      if (yb) rig.targetT.y += yb;
      if (typeof opts.azimuth === 'number') rig.azT = opts.azimuth;
      rig.elT = el;
      clampRig();
      if (opts.instant) {
        rig.azimuth = rig.azT; rig.elevation = rig.elT;
        rig.distance = rig.distT; rig.target.copy(rig.targetT);
        updateCamera(0);
      }
      if (!opts.keepTouch) camTouched = true;
    }

    function updateCamera(dt) {
      if (dt > 0) {
        rig.azimuth = U.damp(rig.azimuth, rig.azT, 9, dt);
        rig.elevation = U.damp(rig.elevation, rig.elT, 9, dt);
        rig.distance = U.damp(rig.distance, rig.distT, 7, dt);
        rig.target.x = U.damp(rig.target.x, rig.targetT.x, 6, dt);
        rig.target.y = U.damp(rig.target.y, rig.targetT.y, 6, dt);
        rig.target.z = U.damp(rig.target.z, rig.targetT.z, 6, dt);
      }
      var a = rig.azimuth * DEG, e = rig.elevation * DEG;
      var ce = Math.cos(e);
      _v1.set(-Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce).multiplyScalar(rig.distance);
      camera.position.copy(rig.target).add(_v1);
      camera.up.set(0, 1, 0);
      camera.lookAt(rig.target);

      /* 셰이크 — 위치에 조금, 회전에 미세하게 */
      if (_shakeAmp > 1e-4) {
        var s = _shakeAmp;
        var ox = _shakeNoise(_t * 21.0, 0.5);
        var oy = _shakeNoise(_t * 17.0, 5.5);
        var oz = _shakeNoise(_t * 27.0, 11.5);
        camera.updateMatrixWorld(true);
        _v2.setFromMatrixColumn(camera.matrixWorld, 0);      /* right */
        _v3.setFromMatrixColumn(camera.matrixWorld, 1);      /* up */
        camera.position.addScaledVector(_v2, ox * s * 0.42);
        camera.position.addScaledVector(_v3, oy * s * 0.30);
        _q1.setFromAxisAngle(_v3.set(0, 0, 1), oz * s * 0.0055);
        camera.quaternion.multiply(_q1);
      }

      /* 근/원 평면을 씬 바운즈에 타이트하게 — 깊이 정밀도 = SSAO 품질 */
      camera.updateMatrixWorld(true);
      _v2.set(0, 0, -1).applyQuaternion(camera.quaternion);
      var mn = sceneBounds.min, mx = sceneBounds.max, n = 0, lo = 1e9, hi = -1e9;
      for (var xi = 0; xi < 2; xi++) for (var yi = 0; yi < 2; yi++) for (var zi = 0; zi < 2; zi++) {
        _corner[n].set(xi ? mx.x : mn.x, yi ? mx.y : mn.y, zi ? mx.z : mn.z).sub(camera.position);
        var t = _corner[n].dot(_v2);
        if (t < lo) lo = t; if (t > hi) hi = t;
        n++;
      }
      var near = Math.max(1.0, lo - 6), far = Math.max(near + 10, hi + 20);
      if (Math.abs(near - camera.near) > camera.near * 0.02 ||
        Math.abs(far - camera.far) > camera.far * 0.02) {
        camera.near = near; camera.far = far;
        camera.updateProjectionMatrix();
      }
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

      /* 거리 포그는 **씬 크기 기준**으로 다시 잡는다. 고정 near/far 로 두면 세로 화면처럼
         카메라가 멀리 물러나는 상황에서 섬 전체가 안개에 먹힌다.
         섬의 가장 먼 지점에서 항상 FOG_FAR 만큼만 흐려지도록 정규화. */
      if (scene.fog) {
        var span = Math.max(hi - lo, 4);
        scene.fog.near = Math.max(0.1, lo);
        scene.fog.far = scene.fog.near + span / FOG_FAR;
      }
    }

    function screenPos(v) {
      if (!camera || !v) return { x: 0, y: 0, visible: false };
      _v3.copy(v).project(camera);
      var w = _cw || 1, h = _ch || 1;
      return {
        x: (_v3.x * 0.5 + 0.5) * w,
        y: (-_v3.y * 0.5 + 0.5) * h,
        visible: _v3.z > -1 && _v3.z < 1 && Math.abs(_v3.x) <= 1.2 && Math.abs(_v3.y) <= 1.2
      };
    }

    /* ══════════════════════════════════════════════════════════════════
       프레임
       ══════════════════════════════════════════════════════════════════ */

    function drawPass(mat, target, clear) {
      quadMesh.material = mat;
      renderer.setRenderTarget(target || null);
      renderer.autoClear = (clear !== false);
      renderer.render(quadScene, quadCam);
    }

    function ensureRig() {
      if (skyMesh && skyMesh.parent !== scene) scene.add(skyMesh);
      if (key && key.parent !== scene) scene.add(key);
      if (key && key.target.parent !== scene) scene.add(key.target);
      if (keyFill && keyFill.parent !== scene) scene.add(keyFill);
      if (hemi && hemi.parent !== scene) scene.add(hemi);
    }

    function hideForPrepass(o) {
      if (!o.visible) return;
      var hide = false;
      if (o.isPoints || o.isSprite || o.isLine) hide = true;
      else if (o.userData && (o.userData.noPrepass || o.userData.noAO)) hide = true;
      else if (o.isMesh) {
        var m = o.material;
        if (Array.isArray(m)) {
          for (var i = 0; i < m.length; i++) if (m[i] && m[i].transparent) { hide = true; break; }
        } else if (m && m.transparent) hide = true;
      }
      if (hide) { o.visible = false; _hidden.push(o); }
    }

    /* World 가 setSceneBounds() 를 불러주기 전까지, 씬에서 직접 바운즈를 추정해
       그림자 ortho 와 근/원평면을 맞춰 둡니다 (45프레임마다, 비용 무시할 수준). */
    function lazyBounds() {
      if (boundsSet || !scene) return;
      if (_frames % 45 !== 4) return;
      try {
        _box.makeEmpty();
        for (var i = 0; i < scene.children.length; i++) {
          var c = scene.children[i];
          if (c === skyMesh || c.isLight || c.isCamera) continue;
          if (c.isPoints || c.isSprite || c.isLine) continue;
          if (c.userData && (c.userData.noPrepass || c.userData.noBounds)) continue;
          _box.expandByObject(c);
        }
        if (!_box.isEmpty() && isFinite(_box.min.x) && isFinite(_box.max.x)) {
          setSceneBounds(_box);
          boundsSet = false;          /* 명시적 setSceneBounds 가 올 때까지 계속 추적 */
        }
      } catch (e) { U.err(e); }
    }

    function frame(dt) {
      if (!renderer || !scene || !camera || disposed) return;
      dt = (typeof dt === 'number' && isFinite(dt)) ? U.clamp(dt, 0, 0.1) : 0.0166;
      _t += dt;
      _frames++;

      try {
        if (_needResize || (++_resizeTick % 20 === 0 &&
          (renderer.domElement.clientWidth !== _cw || renderer.domElement.clientHeight !== _ch))) {
          resize();
        }
        ensureRig();
        lazyBounds();
        if (scanTick++ % 24 === 0) attachAO(scene);

        _shakeAmp *= Math.exp(-6.5 * dt);
        if (_shakeAmp < 1e-4) _shakeAmp = 0;
        updateCamera(dt);
        /* 그림자 ortho 를 매 프레임 카메라 프러스텀에 다시 맞춘다(코너 8개 변환 =
           사실상 공짜). 이게 소품 접지 그림자가 살아나는 이유다 — fitShadow 참조. */
        fitShadow();

        renderer.info.reset();

        /* 하늘 유니폼 */
        _m1.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
        skyMat.uniforms.uInvVP.value.copy(_m1);
        skyMat.uniforms.uCamPos.value.copy(camera.position);
        skyMat.uniforms.uSun.value.copy(sky.sun);
        skyMat.uniforms.uTime.value = _t;
        skyMat.uniforms.uDirect.value = post ? 0 : 1;

        /* 머티리얼 주입 유니폼 */
        aoUni.shViewInv.value.copy(camera.matrixWorld);

        if (!post) {
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = exposure;
          renderer.shadowMap.needsUpdate = true;
          renderer.autoClear = true;
          renderer.setRenderTarget(null);
          renderer.render(scene, camera);
          finishInfo(dt);
          return;
        }

        /* [1] 깊이 + 노멀 프리패스 */
        if (_q.ssao && nrmRT) {
          _hidden.length = 0;
          scene.traverse(hideForPrepass);
          scene.overrideMaterial = prepassMat;
          renderer.shadowMap.needsUpdate = false;
          renderer.autoClear = true;
          renderer.setRenderTarget(nrmRT);
          renderer.render(scene, camera);
          scene.overrideMaterial = null;
          for (var i = 0; i < _hidden.length; i++) _hidden[i].visible = true;
          _hidden.length = 0;

          /* [2] SSAO */
          ssaoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
          ssaoMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
          ssaoMat.uniforms.uNear.value = camera.near;
          ssaoMat.uniforms.uFar.value = camera.far;
          ssaoMat.uniforms.uRes.value.set(_w, _h);
          drawPass(ssaoMat, aoRT, true);

          /* [3] 깊이 가중 양방향 블러 (x → y). 최종본은 항상 aoRT */
          blurMat.uniforms.uNear.value = camera.near;
          blurMat.uniforms.uFar.value = camera.far;
          /* 스텝은 노이즈 타일(4px)보다 넓어야 4x4 회전 노이즈가 지워진다.
             1.35 는 ±2.7px 라 그림자 안쪽에 디더 얼룩이 그대로 남았다. */
          blurMat.uniforms.uSharp.value = 2.2;
          blurMat.uniforms.tAO.value = aoRT.texture;
          blurMat.uniforms.uDir.value.set(1.75 / aoRT.width, 0);
          drawPass(blurMat, aoTmpRT, true);
          blurMat.uniforms.tAO.value = aoTmpRT.texture;
          blurMat.uniforms.uDir.value.set(0, 1.75 / aoTmpRT.height);
          drawPass(blurMat, aoRT, true);
        }

        /* [4] 메인 패스 (MSAA) — AO 는 머티리얼 안에서 indirect 에만 곱해짐 */
        renderer.shadowMap.needsUpdate = true;
        renderer.autoClear = true;
        renderer.setRenderTarget(mainRT);
        renderer.render(scene, camera);

        /* [5] 블룸 */
        var n = bloomRT.length;
        if (n > 0 && fx.bloom > 0.0001) {
          preMat.uniforms.tSrc.value = mainRT.texture;
          preMat.uniforms.uTexel.value.set(1 / _w, 1 / _h);
          preMat.uniforms.uThreshold.value = fx.threshold;
          preMat.uniforms.uKnee.value = fx.knee;
          drawPass(preMat, bloomRT[0], true);
          for (var d = 1; d < n; d++) {
            downMat.uniforms.tSrc.value = bloomRT[d - 1].texture;
            downMat.uniforms.uTexel.value.set(1 / bloomRT[d - 1].width, 1 / bloomRT[d - 1].height);
            drawPass(downMat, bloomRT[d], true);
          }
          for (var u = n - 1; u > 0; u--) {
            upMat.uniforms.tSrc.value = bloomRT[u].texture;
            upMat.uniforms.uTexel.value.set(1 / bloomRT[u].width, 1 / bloomRT[u].height);
            upMat.uniforms.uRadius.value = 1.0;
            drawPass(upMat, bloomRT[u - 1], false);
          }
        }

        /* [6] 최종 합성 → 캔버스 */
        compMat.uniforms.tMain.value = mainRT.texture;
        compMat.uniforms.tBloom.value = n > 0 ? bloomRT[0].texture : whiteTex;
        compMat.uniforms.uBloom.value = n > 0 ? fx.bloom : 0;
        compMat.uniforms.uExposure.value = exposure;
        compMat.uniforms.uVig.value = fx.vignette;
        compMat.uniforms.uGrain.value = fx.grain;
        compMat.uniforms.uSat.value = fx.sat;
        compMat.uniforms.uTime.value = _t;
        compMat.uniforms.uTexel.value.set(1 / _w, 1 / _h);
        drawPass(compMat, null, true);
        renderer.setRenderTarget(null);

        finishInfo(dt);
      } catch (e) {
        U.err(e);
        try {
          scene.overrideMaterial = null;
          for (var hi = 0; hi < _hidden.length; hi++) _hidden[hi].visible = true;
          _hidden.length = 0;
          renderer.setRenderTarget(null);
        } catch (e2) { }
      }
    }

    function finishInfo(dt) {
      var r = renderer.info.render;
      info.tris = r.triangles;
      info.calls = r.calls;
      info.quality = _quality;
      _fpsAcc += dt; _fpsN++;
      if (_fpsN >= 20) { info.fps = Math.round(_fpsN / Math.max(_fpsAcc, 1e-4)); _fpsAcc = 0; _fpsN = 0; }
      autoQuality(dt);
    }

    /* ══════════════════════════════════════════════════════════════════
       튜닝 / 정리
       ══════════════════════════════════════════════════════════════════ */

    function setExposure(v) {
      exposureBase = U.clamp(typeof v === 'number' ? v : 1.12, 0.2, 4);
      setTimeOfDay(timeOfDay);
    }

    function setAO(o) {
      if (!o) return;
      for (var k in o) if (ao.hasOwnProperty(k) && typeof o[k] === 'number') ao[k] = o[k];
      applyAOUniforms();
    }

    function setPost(o) {
      if (!o) return;
      for (var k in o) if (fx.hasOwnProperty(k) && typeof o[k] === 'number') fx[k] = o[k];
      var wn = whiteNorm();
      if (compMat) {
        compMat.uniforms.uCA.value = _q.ca ? (fx.ca * 8.0 / Math.max(_h, 1)) : 0;
        compMat.uniforms.uVig.value = fx.vignette;
        compMat.uniforms.uGrain.value = fx.grain;
        compMat.uniforms.uSat.value = fx.sat;
        compMat.uniforms.uWhiteN.value = wn;
        compMat.uniforms.uContrast.value = fx.contrast;
      }
      if (skyMat) skyMat.uniforms.uWhiteN.value = wn;
      aoUni.shHazeP.value.set(fx.hazeTop, Math.max(fx.hazeRange, 0.001), fx.haze);
      aoUni.shSpecAA.value = Math.max(fx.specAA, 0);
    }

    function dispose() {
      if (!renderer) return;
      disposed = true;
      try {
        window.removeEventListener('resize', markResize, false);
        if (window.visualViewport) window.visualViewport.removeEventListener('resize', markResize, false);
        freeRTs();
        if (envRT) { envRT.dispose(); envRT = null; }
        if (pmrem) { pmrem.dispose(); pmrem = null; }
        if (whiteTex) { whiteTex.dispose(); whiteTex = null; }
        if (noiseTex) { noiseTex.dispose(); noiseTex = null; }
        if (fsGeo) { fsGeo.dispose(); fsGeo = null; }
        var mats = [skyMat, prepassMat, ssaoMat, blurMat, preMat, downMat, upMat, compMat];
        for (var i = 0; i < mats.length; i++) if (mats[i]) mats[i].dispose();
        skyMat = prepassMat = ssaoMat = blurMat = preMat = downMat = upMat = compMat = null;
        if (key && key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
        renderer.dispose();
      } catch (e) { U.err(e); }
      inited = false;
    }

    /* ══════════════════════════════════════════════════════════════════
       공개 API
       ══════════════════════════════════════════════════════════════════ */

    var API = {
      init: init,
      frame: frame,
      resize: resize,
      setQuality: setQuality,
      autoQuality: autoQuality,
      frameBounds: frameBounds,
      orbit: orbit,
      zoom: zoom,
      pan: pan,
      shake: shake,
      setTimeOfDay: setTimeOfDay,
      screenPos: screenPos,
      setCam: setCam,
      getCam: getCam,
      setSceneBounds: setSceneBounds,
      attachAO: attachAO,
      setExposure: setExposure,
      setAO: setAO,
      setPost: setPost,
      setEnvMap: setEnvMap,
      dispose: dispose,
      sunDir: sunDir,
      maxAniso: 4
    };

    Object.defineProperty(API, 'scene', { get: function () { return scene; } });
    Object.defineProperty(API, 'camera', { get: function () { return camera; } });
    Object.defineProperty(API, 'renderer', { get: function () { return renderer; } });
    Object.defineProperty(API, 'quality', { get: function () { return _quality; } });
    Object.defineProperty(API, 'info', { get: function () { return info; } });
    Object.defineProperty(API, 'lampsOn', { get: function () { return lampsOn; } });
    Object.defineProperty(API, 'timeOfDay', { get: function () { return timeOfDay; } });
    Object.defineProperty(API, 'post', { get: function () { return post; } });
    Object.defineProperty(API, 'time', { get: function () { return _t; } });

    return API;
  })();
})();
