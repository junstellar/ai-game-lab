/* ============================================================================
   조차장 / SHUNTING — 35-fx.js
   파티클 · 이펙트 · 지면 데칼.  SPEC.md §3.7 / §6 (SH.FX)
   → SH.FX
   ============================================================================ */

/* CONTRACT ────────────────────────────────────────────────────────────────────
   SH.FX  — 파티클 & 데칼. 외부 파일 로드 없음, 전부 캔버스 생성. Math.random 미사용.

   FX.init(scene)                     // 반드시 THREE/Render 준비 후 1회. 재호출 시 무시.
   FX.update(dt, camera)              // 매 프레임. camera 생략 시 SH.Render.camera 사용.
   FX.exhaust(anchorObj3D, load)      // 연속 배기. 매 프레임 호출(부하 0..1).
                                      //   0.25s 이상 미호출 시 자동으로 서서히 꺼짐.
                                      //   anchor 로컬 +Y 가 배기 방향.
   FX.dust(pos, amount, dir)          // 바퀴/제동 먼지. amount≈1 기본, dir 생략 가능.
   FX.sparks(pos, dir)                // 불똥 (가산 합성).
   FX.steam(pos, amount)              // 브레이크 에어 배기 (흰 증기).
   FX.impact(pos)                     // 연결 충격: 링 먼지 + 불똥.
   FX.pollen(bounds)                  // 부유 미세입자. bounds: THREE.Box3 | {min,max}.
                                      //   재호출하면 영역만 갱신. 역광에서 반짝임.
   FX.setQuality(q)                   // 0 low | 1 med | 2 high. init 전 호출 가능.
   FX.clear()                         // 모든 파티클/데칼 제거 (레벨 로드 시).
   FX.decal(kind, pos, opts)          // 'oil' | 'mark' | 'grime'.
                                      //   opts {size, rot, seed} — 반환 true/false.
   FX.clearDecals(kind?)
   FX.dispose()
   FX.setAuto(bool)                   // 자동 구동 on/off (기본 on). 아래 참조.
   FX.count -> {soft, additive, ambient, decals}   // 디버그/__SHOT 용 (getter)
   FX.group -> THREE.Group | null                  // 씬에 추가된 루트

   ── 자동 구동 (self-drive) ────────────────────────────────────────────────
   FX.update 는 매 프레임 `SH.World.current` 를 직접 읽어 **두 가지를 스스로 켠다**.
   호출자가 아무것도 안 해도 동작하며, 다른 모듈의 명시적 호출을 절대 덮어쓰지 않는다.
     1) 디젤 배기 — 기관차 `rig.exhaust` 앵커에 붙어 항상 공회전 플룸을 올린다.
        자동값은 **바닥값(floor)** 이라, Motion 이 FX.exhaust(anchor, load) 로 더 큰
        부하를 주면 그쪽이 이긴다. 부하 = 공회전 0.26 + 속도비례, Motion.isBusy 면 ≥0.46.
     2) 바퀴 접지 먼지 — 차량 그룹의 **실제 월드 이동량**으로 차량별 속도를 재서,
        움직인 차량의 대차(bogie) 접지점에만 속도 비례로 먼지를 뿌린다. 정지한 측선
        화차에는 뿌리지 않는다. 급감속(제동) 시 한 번 더 크게 터뜨리고, 정지 후에도
        ~1.2s 동안 먼지가 남는다(포즈 스크린샷이 정지 순간을 잡아도 비지 않게).
   Motion/Game 이 이미 하는 일을 중복시키지 않으려면 FX.setAuto(false).

   ── 다른 모듈이 알아야 할 것 ────────────────────────────────────────────────
   · 소프트 파티클: `SH.Render.depthTexture` 가 있으면 씬 깊이와 교차부를 페이드한다.
     없으면 자동으로 생략된다(널 체크). depthTexture 는 드로잉버퍼 전체 해상도라고
     가정한다. 다른 해상도면 `SH.Render.depthSize = {x,y}` 를 노출해 주면 그걸 쓴다.
   · `SH.Render.sunDir` 이 있으면 화분(pollen) 역광 반짝임에 쓴다. 태양을 "향하는"
     방향으로 가정하며, y<0 이면 부호를 자동 반전한다. 없으면 기본 골든아워 방향.
   · 화분 모트는 **하늘 위에서 알파 0 으로 페이드**한다. 카메라→입자 광선을 섬 AABB 와
     교차시켜 판정하며, AABB 는 `SH.World.current.islandBounds` → `FX.pollen(bounds)` 인자 →
     이전 값 순으로 잡는다. 셋 다 없으면 페이드가 꺼진다(하늘에 점이 남으니 피할 것).
     화면 크기도 ~3px(디바이스 픽셀 보정)로 클램프된다 — 원반처럼 보이면 안 되기 때문.
   · `scene.fog.color` 를 하늘색으로 읽어 배기 연기의 **소멸 색**으로 쓴다. 안개가 없으면
     기본 회청색. Render 가 시간대마다 fog.color 를 지평선 색으로 갱신하므로 자동 추종.
   · FX 오브젝트는 전부 `object.userData.fx = true` 이고 `frustumCulled = false`,
     `renderOrder = 10` 이다. 깊이 프리패스에서 제외하려면 이 플래그로 거른다.
   · 모든 파티클 머티리얼은 ShaderMaterial 이지만 `<tonemapping_fragment>` /
     `<colorspace_fragment>` 를 포함하므로 씬의 톤매핑/색공간과 일치한다.
   · scene.fog(Fog / FogExp2)를 자동으로 따라간다.
   ────────────────────────────────────────────────────────────────────────── */

SH.FX = (function () {
  'use strict';

  var U = SH.U;

  /* ── 상태 ─────────────────────────────────────────────────────── */
  var inited = false;
  var scene = null;
  var root = null;                 // THREE.Group
  var quality = 2;
  var T = 0;                       // 누적 시간
  var rnd = U.rng('shunting-fx');
  var windNoise = null;

  var sysSoft = null, sysAdd = null, sysAmb = null;
  var texSoft = null, texAdd = null;
  var fallbackDepth = null;

  var decalKinds = null;           // { kind: {mesh, tex, mat, n} }
  var pollenBox = null;            // {x0,y0,z0,x1,y1,z1}
  var isleMin = null, isleMax = null;   // 하늘 페이드용 섬 AABB (init 에서 생성)
  var isleOn = false;
  var pollenWanted = false;
  var pendingBounds = null;        // init 전에 들어온 pollen(bounds)

  var exhausts = [];               // 등록된 배기 앵커

  /* 품질 티어별 총 파티클 수 (SPEC: q2 2000 / q1 900 / q0 300) */
  var CAPS = [
    { soft: 170,  add: 60,  amb: 28,  emit: 0.32, sort: false, tex: 64  },
    { soft: 500,  add: 180, amb: 88,  emit: 0.62, sort: true,  tex: 128 },
    { soft: 1100, add: 400, amb: 200, emit: 1.0,  sort: true,  tex: 128 }
  ];
  var MAXCAP = CAPS[2];

  /* 스프라이트 채널 선택 (원-핫) — soft: 0 매끈 / 1 퍼프 / 2 먼지
     add: 0 글로우 / 1 점 / 2 별 */
  var SEL_A = [1, 0, 0], SEL_B = [0, 1, 0], SEL_C = [0, 0, 1];

  /* 색 (선형 공간). init 에서 채움. */
  var C = {};

  /* 스크래치 */
  var v3a = new THREE.Vector3(), v3b = new THREE.Vector3(), v3c = new THREE.Vector3();
  var v2a = new THREE.Vector2();
  var mtx = new THREE.Matrix4(), qtn = new THREE.Quaternion(), sclV = new THREE.Vector3();
  var defSun = new THREE.Vector3(-0.62, 0.47, 0.63).normalize();

  /* 방출 파라미터 스크래치 (GC 방지) */
  var E = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1,
    s0: 1, s1: 1, a0: 1, life: 1,
    drag: 1, windK: 0, grav: 0, turb: 0,
    rot: 0, rotV: 0, fadeIn: 0.12, decayPow: 1.5, colPow: 1, floorY: -1e9,
    e0: 1, e1: 0, e2: 0
  };

  /* ── 셰이더 ───────────────────────────────────────────────────── */

  var VERT = [
    'uniform float uPixScale;',
    'uniform float uMaxPoint;',
    'uniform float uBacklight;',
    'uniform float uSkyFade;',
    'uniform vec3  uIsleMin;',
    'uniform vec3  uIsleMax;',
    'uniform vec3  uSunDir;',
    'uniform vec3  uCamPos;',
    'attribute float aSize;',
    'attribute vec3  aColor;',
    'attribute float aAlpha;',
    'attribute float aRot;',
    'attribute vec3  aSel;',
    'varying vec3  vColor;',
    'varying float vAlpha;',
    'varying float vRot;',
    'varying vec3  vSel;',
    'varying float vViewZ;',
    'varying float vGlint;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
    '  vec4 mv = viewMatrix * wp;',
    '  gl_Position = projectionMatrix * mv;',
    /* 역광 글린트: 시선이 태양과 정렬될수록 커지고 밝아진다 (부유 입자 전용) */
    /* 카메라가 위에서 내려다보므로 dot 의 실효 범위는 대략 -0.3..0.6 이다.
       그 구간을 펴서 매핑해야 태양 방위로 돌렸을 때 확실히 반짝인다. */
    '  float g = 0.0;',
    '  if ( uBacklight > 0.5 ) {',
    '    float bl = dot( normalize( wp.xyz - uCamPos ), uSunDir );',
    '    float k  = smoothstep( 0.02, 0.58, bl );',
    '    g = k * k;',
    '  }',
    '  vGlint = g;',
    /* 하늘 위로 삐져나온 모트는 지운다 (SPEC §3.7: 모트는 "빛 속을" 떠다니는 것이지
       하늘에 뿌려진 흰 점이 아니다). 카메라→입자 광선을 섬 AABB 와 교차시켜, 입자
       **뒤쪽**을 지나는 현(chord) 길이로 페이드한다. 현 길이로 재면 실루엣 경계에서
       자연히 0 으로 수렴하므로 AABB 모서리가 직선으로 잘려 보이지 않는다. */
    '  float vis = 1.0;',
    '  if ( uSkyFade > 0.5 ) {',
    '    vec3 rd = wp.xyz - uCamPos;',
    '    vec3 ar = max( abs( rd ), vec3( 1e-4 ) );',
    '    vec3 sg = vec3( rd.x < 0.0 ? -1.0 : 1.0, rd.y < 0.0 ? -1.0 : 1.0, rd.z < 0.0 ? -1.0 : 1.0 );',
    '    vec3 inv = 1.0 / ( ar * sg );',
    '    vec3 t0 = ( uIsleMin - uCamPos ) * inv;',
    '    vec3 t1 = ( uIsleMax - uCamPos ) * inv;',
    '    vec3 tn = min( t0, t1 ), tf = max( t0, t1 );',
    '    float tNear = max( max( tn.x, tn.y ), tn.z );',
    '    float tFar  = min( min( tf.x, tf.y ), tf.z );',
    '    float chord = max( tFar - max( tNear, 1.0 ), 0.0 ) * length( rd );',
    '    vis = smoothstep( 0.0, 11.0, chord );',
    '  }',
    '  float ps = aSize * ( 1.0 + 0.55 * g ) * uPixScale / max( -mv.z, 0.02 );',
    /* 1px 미만은 알파로 보상 — 멀리서 반짝이며 깜빡이는 현상 방지 */
    '  float shrink = clamp( ps, 0.0, 1.0 );',
    '  gl_PointSize = clamp( ps, 1.0, uMaxPoint );',
    '  vColor = aColor; vAlpha = aAlpha * shrink * shrink * vis; vRot = aRot; vSel = aSel;',
    '  vViewZ = mv.z;',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D uTex;',
    'uniform sampler2D uDepth;',
    'uniform vec2  uInvRes;',
    'uniform float uSoftOn;',
    'uniform float uSoftRange;',
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform float uAdditive;',
    'uniform float uBacklight;',
    'uniform vec3  uFogColor;',
    'uniform float uFogMode;',   // 0 off, 1 linear, 2 exp2
    'uniform float uFogA;',
    'uniform float uFogB;',
    'varying vec3  vColor;',
    'varying float vAlpha;',
    'varying float vRot;',
    'varying vec3  vSel;',
    'varying float vViewZ;',
    'varying float vGlint;',
    /* three 의 perspectiveDepthToViewZ 와 동일 (자체 구현: packing 청크 의존 제거) */
    'float fxViewZ( float d ) { return ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ); }',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float s = sin( vRot ), c = cos( vRot );',
    '  uv = vec2( c * uv.x - s * uv.y, s * uv.x + c * uv.y ) + 0.5;',
    '  if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) discard;',
    '  vec3 t = texture2D( uTex, uv ).rgb;',
    '  float a = dot( t, vSel ) * vAlpha;',
    '  vec3 col = vColor;',
    /* 역광 반짝임 — 시선과 태양이 정렬될수록 강해진다 (화분/먼지 모트).
       부스트는 의도적으로 약하다: 강하면 알파가 포화되어 "딱딱한 흰 원반"이 된다. */
    '  if ( uBacklight > 0.5 ) {',
    '    a  *= 0.75 + 0.80 * vGlint;',
    '    col = mix( col, vec3( 1.0, 0.84, 0.58 ), 0.55 * vGlint );',   // 흰색이 아니라 태양광 색
    '  }',
    /* 소프트 파티클 — 씬 깊이와 교차하는 부분을 페이드 */
    '  if ( uSoftOn > 0.5 ) {',
    '    float d  = texture2D( uDepth, gl_FragCoord.xy * uInvRes ).x;',
    '    float sz = fxViewZ( d );',
    '    a *= clamp( ( vViewZ - sz ) / uSoftRange, 0.0, 1.0 );',
    '  }',
    /* 근평면 페이드 — 카메라를 스치고 지나갈 때 팝 방지 */
    '  a *= smoothstep( uNear, uNear + 2.5, -vViewZ );',
    '  if ( uFogMode > 0.5 ) {',
    '    float f;',
    '    if ( uFogMode < 1.5 ) { f = smoothstep( uFogA, uFogB, -vViewZ ); }',
    '    else { float dd = -vViewZ * uFogA; f = 1.0 - exp( -dd * dd ); }',
    '    f = clamp( f, 0.0, 1.0 );',
    '    if ( uAdditive > 0.5 ) { a *= ( 1.0 - f ); }',
    '    else { col = mix( col, uFogColor, f ); }',
    '  }',
    '  if ( a < 0.004 ) discard;',
    '  gl_FragColor = vec4( col, a );',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  /* ── 스프라이트 텍스처 (캔버스 생성) ──────────────────────────── */

  function makeSoftSprite(N) {
    var o = U.canvas(N, N);
    var nz = U.noise2D('fx-puff', 0);
    U.fillPixels(o.cv, function (x, y) {
      var u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      var d = Math.sqrt(u * u + v * v);
      var rim = U.smooth(U.clamp01((1.0 - d) * 2.6));      // 가장자리를 확실히 0으로
      if (d >= 1.0) return [0, 0, 0, 255];

      var n = U.fbm(nz, x / N * 4.2, y / N * 4.2, 5, 2, 0.58);   // -1..1
      var nf = U.fbm(nz, x / N * 11.0 + 31.7, y / N * 11.0 - 8.3, 3, 2, 0.5);
      var n01 = n * 0.5 + 0.5;

      /* R — 매끈한 원 (증기·일반) */
      var r = Math.pow(U.smooth(U.clamp01(1.0 - d)), 1.30);

      /* G — 노이즈가 낀 퍼프 (연기·배기). 윤곽을 뜯고 내부 밀도도 흔든다. */
      var dp = d * (1.0 + 0.42 * n + 0.14 * nf);
      var g = U.smooth(U.clamp01(1.12 - dp * 1.14));
      g *= U.clamp01(0.30 + 0.90 * n01 + 0.22 * nf);
      g = U.clamp01(g) * rim;

      /* B — 먼지: 더 넓고 평평하게, 대비 낮게 */
      var b = Math.pow(U.smooth(U.clamp01(1.0 - d * 0.94)), 0.80) * (0.66 + 0.30 * n01 + 0.12 * nf);
      b = U.clamp01(b) * rim;

      return [r * 255, g * 255, b * 255, 255];
    });
    return o.cv;
  }

  function makeAddSprite(N) {
    var o = U.canvas(N, N);
    U.fillPixels(o.cv, function (x, y) {
      var u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      var d2 = u * u + v * v, d = Math.sqrt(d2);
      var rim = U.smooth(U.clamp01((1.0 - d) * 3.2));
      if (d >= 1.0) return [0, 0, 0, 255];

      /* R — 불똥 글로우: 뜨거운 코어 + 넓은 헤일로 */
      var r = Math.exp(-d2 * 7.0) * 0.95 + Math.exp(-d2 * 1.7) * 0.30;

      /* G — 화분 모트. 가우시안은 코어가 평평해서 알파가 조금만 올라가도 "원반"이
         된다. smoothstep 을 세제곱해 중심에서 가장자리까지 계속 떨어지게 굽는다. */
      var gg = U.smooth(U.clamp01((1.0 - d) * 1.12));
      var g = gg * gg * gg;

      /* B — 4각 스타 글린트 (역광 반짝임) */
      var streak = Math.exp(-(v * v) * 340.0) + Math.exp(-(u * u) * 340.0);
      var diag = Math.exp(-((u - v) * (u - v)) * 900.0) + Math.exp(-((u + v) * (u + v)) * 900.0);
      var b = Math.exp(-d2 * 16.0) + (streak * 0.50 + diag * 0.22) * Math.exp(-d2 * 2.4);

      return [U.clamp01(r) * rim * 255, U.clamp01(g) * rim * 255, U.clamp01(b) * rim * 255, 255];
    });
    return o.cv;
  }

  function mkTex(cv, srgb) {
    var t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = (SH.Render && SH.Render.maxAniso) ? Math.min(8, SH.Render.maxAniso) : 4;
    t.needsUpdate = true;
    return t;
  }

  /** FX 오브젝트는 레이캐스트 대상이 되면 안 된다 (Input 이 트랙을 못 집게 됨) */
  function noRaycast() { /* no-op */ }

  /* ── 파티클 시스템 ────────────────────────────────────────────── */

  function System(name, cap, tex, additive, backlight, ambient, sorted) {
    var n = cap;
    this.name = name;
    this.max = n;
    this.cap = n;
    this.count = 0;
    this.ambient = !!ambient;
    this.sorted = !!sorted;

    /* 어트리뷰트 버퍼 */
    var pos = new Float32Array(n * 3);
    var col = new Float32Array(n * 3);
    var sel = new Float32Array(n * 3);
    var siz = new Float32Array(n);
    var alp = new Float32Array(n);
    var rot = new Float32Array(n);

    /* 시뮬 전용 */
    var vel = new Float32Array(n * 3);
    var c0 = new Float32Array(n * 3);
    var c1 = new Float32Array(n * 3);
    var s0 = new Float32Array(n), s1 = new Float32Array(n), a0 = new Float32Array(n);
    var life = new Float32Array(n), maxLife = new Float32Array(n);
    var drag = new Float32Array(n), windK = new Float32Array(n), grav = new Float32Array(n);
    var turb = new Float32Array(n), rotV = new Float32Array(n);
    var fadeIn = new Float32Array(n), decayP = new Float32Array(n);
    var colP = new Float32Array(n);
    var floorY = new Float32Array(n), seed = new Float32Array(n);

    this.pos = pos; this.col = col; this.sel = sel;
    this.siz = siz; this.alp = alp; this.rot = rot;
    this.vel = vel; this.c0 = c0; this.c1 = c1;
    this.s0 = s0; this.s1 = s1; this.a0 = a0;
    this.life = life; this.maxLife = maxLife;
    this.drag = drag; this.windK = windK; this.grav = grav;
    this.turb = turb; this.rotV = rotV;
    this.fadeIn = fadeIn; this.decayP = decayP; this.colP = colP;
    this.floorY = floorY; this.seed = seed;

    this._arrs = [
      [pos, 3], [col, 3], [sel, 3], [vel, 3], [c0, 3], [c1, 3],
      [siz, 1], [alp, 1], [rot, 1], [s0, 1], [s1, 1], [a0, 1],
      [life, 1], [maxLife, 1], [drag, 1], [windK, 1], [grav, 1],
      [turb, 1], [rotV, 1], [fadeIn, 1], [decayP, 1], [colP, 1],
      [floorY, 1], [seed, 1]
    ];

    var g = new THREE.BufferGeometry();
    function attr(arr, itemSize) {
      var a = new THREE.BufferAttribute(arr, itemSize);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    }
    g.setAttribute('position', attr(pos, 3));
    g.setAttribute('aColor', attr(col, 3));
    g.setAttribute('aSel', attr(sel, 3));
    g.setAttribute('aSize', attr(siz, 1));
    g.setAttribute('aAlpha', attr(alp, 1));
    g.setAttribute('aRot', attr(rot, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    if (this.sorted) {
      this.order = [];
      this.dist = new Float32Array(n);
      this.idx = new Uint16Array(n);
      var dd = this.dist;
      this.cmp = function (a, b) { return dd[b] - dd[a]; };   // 먼 것부터 (back-to-front)
      g.setIndex(new THREE.BufferAttribute(this.idx, 1));
      g.index.setUsage(THREE.DynamicDrawUsage);
    }

    var m = new THREE.ShaderMaterial({
      uniforms: {
        uTex:       { value: tex },
        uDepth:     { value: fallbackDepth },
        uInvRes:    { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uSoftOn:    { value: 0 },
        /* 교차부 페이드 폭. 너무 넓으면 접촉 먼지가 통째로 지워진다 */
        uSoftRange: { value: additive ? 0.35 : 0.85 },
        uNear:      { value: 0.5 },
        uFar:       { value: 1000 },
        uPixScale:  { value: 800 },
        uMaxPoint:  { value: 255 },
        uAdditive:  { value: additive ? 1 : 0 },
        uBacklight: { value: backlight ? 1 : 0 },
        uSkyFade:   { value: 0 },
        uIsleMin:   { value: new THREE.Vector3(-1e5, -1e5, -1e5) },
        uIsleMax:   { value: new THREE.Vector3(1e5, 1e5, 1e5) },
        uSunDir:    { value: defSun.clone() },
        uCamPos:    { value: new THREE.Vector3() },
        uFogColor:  { value: new THREE.Color(0.5, 0.6, 0.7) },
        uFogMode:   { value: 0 },
        uFogA:      { value: 1 },
        uFogB:      { value: 2000 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });

    var p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = additive ? 12 : 10;
    p.name = 'fx-' + name;
    p.userData.fx = true;
    p.matrixAutoUpdate = false;
    p.raycast = noRaycast;          // SH.Input 의 피킹을 절대 가로막지 않는다

    this.geo = g; this.mat = m; this.points = p;
  }

  System.prototype.swap = function (i, j) {
    if (i === j) return;
    var A = this._arrs;
    for (var k = 0; k < A.length; k++) {
      var arr = A[k][0], st = A[k][1], bi = i * st, bj = j * st;
      for (var c = 0; c < st; c++) arr[bi + c] = arr[bj + c];
    }
  };

  System.prototype.kill = function (i) {
    this.count--;
    this.swap(i, this.count);
  };

  System.prototype.clear = function () { this.count = 0; };

  /** E 스크래치에서 파티클 1개 생성. 가득 차면 -1. */
  System.prototype.spawn = function () {
    if (this.count >= this.cap) return -1;
    var i = this.count++;
    var i3 = i * 3;
    this.pos[i3] = E.x; this.pos[i3 + 1] = E.y; this.pos[i3 + 2] = E.z;
    this.vel[i3] = E.vx; this.vel[i3 + 1] = E.vy; this.vel[i3 + 2] = E.vz;
    this.c0[i3] = E.r0; this.c0[i3 + 1] = E.g0; this.c0[i3 + 2] = E.b0;
    this.c1[i3] = E.r1; this.c1[i3 + 1] = E.g1; this.c1[i3 + 2] = E.b1;
    this.col[i3] = E.r0; this.col[i3 + 1] = E.g0; this.col[i3 + 2] = E.b0;
    this.sel[i3] = E.e0; this.sel[i3 + 1] = E.e1; this.sel[i3 + 2] = E.e2;
    this.s0[i] = E.s0; this.s1[i] = E.s1; this.a0[i] = E.a0;
    this.life[i] = E.life; this.maxLife[i] = E.life;
    this.drag[i] = E.drag; this.windK[i] = E.windK; this.grav[i] = E.grav;
    this.turb[i] = E.turb; this.rotV[i] = E.rotV;
    this.fadeIn[i] = E.fadeIn; this.decayP[i] = E.decayPow;
    this.colP[i] = E.colPow;
    this.floorY[i] = E.floorY; this.seed[i] = rnd();
    this.siz[i] = E.s0; this.alp[i] = 0; this.rot[i] = E.rot;
    return i;
  };

  /* ── 시뮬레이션 ───────────────────────────────────────────────── */

  var windV = new THREE.Vector3();

  function updateWind(dt) {
    /* 아주 느리게 흔들리는 서풍 (동쪽으로 흐름) */
    var a = windNoise(T * 0.11, 0.0);
    var b = windNoise(0.0, T * 0.09);
    windV.set(2.75 + a * 1.35, 0.10 * b, 0.85 * b + 0.55 * a);
  }

  function stepSystem(sys, dt) {
    if (sys.ambient) return stepAmbient(sys, dt);

    var pos = sys.pos, vel = sys.vel, col = sys.col, c0 = sys.c0, c1 = sys.c1;
    var i = 0;
    while (i < sys.count) {
      sys.life[i] -= dt;
      if (sys.life[i] <= 0) { sys.kill(i); continue; }

      var i3 = i * 3;
      var age = 1 - sys.life[i] / sys.maxLife[i];

      /* 항력 + 바람: 속도를 바람 속도로 끌어당긴다 */
      var k = 1 - Math.exp(-sys.drag[i] * dt);
      var wk = sys.windK[i];
      vel[i3]     += (windV.x * wk - vel[i3]) * k;
      vel[i3 + 1] += (windV.y * wk - vel[i3 + 1]) * k;
      vel[i3 + 2] += (windV.z * wk - vel[i3 + 2]) * k;
      vel[i3 + 1] += sys.grav[i] * dt;

      /* 난류 — 싸구려 컬 노이즈 대용 */
      var tb = sys.turb[i];
      if (tb > 0) {
        var sd = sys.seed[i] * 6.2831853;
        vel[i3]     += tb * Math.sin(pos[i3 + 1] * 0.62 + sd + T * 1.05) * dt;
        vel[i3 + 1] += tb * 0.45 * Math.sin(pos[i3] * 0.38 + sd * 1.7 + T * 0.83) * dt;
        vel[i3 + 2] += tb * Math.cos(pos[i3] * 0.47 + sd * 2.3 + T * 0.77) * dt;
      }

      pos[i3]     += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      /* 지면 밀착 (먼지) */
      var fy = sys.floorY[i];
      if (pos[i3 + 1] < fy) {
        pos[i3 + 1] = fy;
        if (vel[i3 + 1] < 0) vel[i3 + 1] *= -0.12;
      }

      /* 크기 / 색 / 알파 */
      var ex = Math.pow(age, 0.62);
      sys.siz[i] = sys.s0[i] + (sys.s1[i] - sys.s0[i]) * ex;
      /* 색 보간 커브. colP=1 이면 기존과 동일한 smoothstep.
         colP>1 이면 **오래 원래 색을 유지**한다 — 디젤 매연이 굴뚝 근처에서
         계속 검게 남아 있다가 위에서야 회색으로 풀리는 실제 거동. */
      var cp = sys.colP[i];
      var cm = U.smooth(age);
      if (cp !== 1) cm = Math.pow(cm, cp);
      col[i3]     = c0[i3]     + (c1[i3]     - c0[i3])     * cm;
      col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * cm;
      col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * cm;

      var fin = sys.fadeIn[i];
      var f = fin > 0 ? Math.min(1, age / fin) : 1;
      sys.alp[i] = sys.a0[i] * f * Math.pow(1 - age, sys.decayP[i]);

      sys.rot[i] += sys.rotV[i] * dt;
      i++;
    }
  }

  function stepAmbient(sys, dt) {
    if (!pollenBox) { sys.count = 0; return; }
    var B = pollenBox;
    var pos = sys.pos, vel = sys.vel;
    var sx = B.x1 - B.x0, sy = B.y1 - B.y0, sz = B.z1 - B.z0;
    for (var i = 0; i < sys.count; i++) {
      var i3 = i * 3;
      var sd = sys.seed[i] * 6.2831853;

      /* 아주 느린 부유 — 바람 15% + 개별 흔들림 */
      var tx = Math.sin(T * 0.42 + sd) * 0.16 + windV.x * 0.13;
      var ty = Math.sin(T * 0.61 + sd * 1.7) * 0.10 - 0.012;
      var tz = Math.cos(T * 0.37 + sd * 2.3) * 0.16 + windV.z * 0.13;
      var k = 1 - Math.exp(-1.6 * dt);
      vel[i3]     += (tx - vel[i3]) * k;
      vel[i3 + 1] += (ty - vel[i3 + 1]) * k;
      vel[i3 + 2] += (tz - vel[i3 + 2]) * k;

      pos[i3]     += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      /* 영역 랩 */
      if (pos[i3] < B.x0) pos[i3] += sx; else if (pos[i3] > B.x1) pos[i3] -= sx;
      if (pos[i3 + 1] < B.y0) pos[i3 + 1] += sy; else if (pos[i3 + 1] > B.y1) pos[i3 + 1] -= sy;
      if (pos[i3 + 2] < B.z0) pos[i3 + 2] += sz; else if (pos[i3 + 2] > B.z1) pos[i3 + 2] -= sz;

      /* 반짝임 */
      var tw = 0.55 + 0.45 * Math.sin(T * (1.7 + sys.seed[i] * 2.3) + sd * 3.1);
      sys.alp[i] = sys.a0[i] * tw;
      sys.siz[i] = sys.s0[i] * (0.85 + 0.30 * tw);
      sys.rot[i] += sys.rotV[i] * dt;
    }
  }

  /* ── 업로드 (+ 소프트 시스템 백투프론트 정렬) ─────────────────── */

  function uploadSystem(sys, cam) {
    var n = sys.count;
    var g = sys.geo;
    sys.points.visible = n > 0;                     // 빈 시스템은 드로우콜조차 내지 않는다
    if (n === 0) { g.setDrawRange(0, 0); return; }

    if (sys.sorted) {
      var idx = sys.idx, dist = sys.dist, order = sys.order, pos = sys.pos, i;
      if (CAPS[quality].sort && cam) {
        var cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
        for (i = 0; i < n; i++) {
          var i3 = i * 3;
          var dx = pos[i3] - cx, dy = pos[i3 + 1] - cy, dz = pos[i3 + 2] - cz;
          dist[i] = dx * dx + dy * dy + dz * dz;
        }
        order.length = n;
        for (i = 0; i < n; i++) order[i] = i;
        order.sort(sys.cmp);
        for (i = 0; i < n; i++) idx[i] = order[i];
      } else {
        for (i = 0; i < n; i++) idx[i] = i;
      }
      g.index.needsUpdate = true;
    }

    var at = g.attributes;
    at.position.needsUpdate = true;
    at.aColor.needsUpdate = true;
    at.aSel.needsUpdate = true;
    at.aSize.needsUpdate = true;
    at.aAlpha.needsUpdate = true;
    at.aRot.needsUpdate = true;
    g.setDrawRange(0, n);
  }

  /* ── 유니폼 갱신 ──────────────────────────────────────────────── */

  function updateUniforms(cam) {
    var R = SH.Render || null;
    var renderer = R && R.renderer ? R.renderer : null;

    var bw = 1280, bh = 720;
    if (renderer && renderer.getDrawingBufferSize) {
      renderer.getDrawingBufferSize(v2a);
      if (v2a.x > 0 && v2a.y > 0) { bw = v2a.x; bh = v2a.y; }
    } else {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      bw = Math.max(1, Math.round(window.innerWidth * dpr));
      bh = Math.max(1, Math.round(window.innerHeight * dpr));
    }

    /* 깊이 텍스처 해상도가 따로 있으면 그걸 쓴다 */
    var dw = bw, dh = bh;
    if (R && R.depthSize && R.depthSize.x > 0 && R.depthSize.y > 0) {
      dw = R.depthSize.x; dh = R.depthSize.y;
    }

    var fov = cam && cam.isPerspectiveCamera ? cam.fov : 24;
    var pixScale = bh / (2 * Math.tan(fov * 0.5 * U.DEG));
    var near = cam ? cam.near : 0.5, far = cam ? cam.far : 1000;

    var depthTex = (R && R.depthTexture) ? R.depthTexture : null;
    var softOn = depthTex ? 1 : 0;

    /* 태양 방향 — 태양을 "향하는" 방향으로 정규화 (y<0 이면 반전) */
    v3c.copy((R && R.sunDir && R.sunDir.isVector3) ? R.sunDir : defSun);
    if (v3c.lengthSq() < 1e-8) v3c.copy(defSun);
    v3c.normalize();
    if (v3c.y < 0) v3c.negate();

    /* 안개 */
    var fogMode = 0, fogA = 1, fogB = 2000, fogCol = null;
    var fog = scene ? scene.fog : null;
    if (fog) {
      fogCol = fog.color;
      if (fog.isFogExp2) { fogMode = 2; fogA = fog.density; }
      else { fogMode = 1; fogA = fog.near; fogB = fog.far; }
      /* 배기 끝색이 수렴할 하늘색 — Render 가 시간대마다 지평선 색으로 갱신한다 */
      skyLin[0] = fogCol.r; skyLin[1] = fogCol.g; skyLin[2] = fogCol.b;
    }

    /* 부유 모트의 화면 크기 상한 — 3px 안팎(디바이스 픽셀 보정) */
    var cssH = (renderer && renderer.domElement) ? renderer.domElement.clientHeight : 0;
    var dpr = cssH > 4 ? U.clamp(bh / cssH, 0.5, 3) : 1;
    var ambMaxPt = U.clamp(3.2 * dpr, 2, 8);

    var list = [sysSoft, sysAdd, sysAmb];
    for (var i = 0; i < list.length; i++) {
      var s = list[i]; if (!s) continue;
      var u = s.mat.uniforms;
      u.uPixScale.value = pixScale;
      u.uNear.value = near;
      u.uFar.value = far;
      u.uInvRes.value.set(1 / dw, 1 / dh);
      u.uSoftOn.value = (s.ambient ? 0 : softOn);
      u.uDepth.value = depthTex || fallbackDepth;
      u.uSunDir.value.copy(v3c);
      if (cam) u.uCamPos.value.copy(cam.position);
      u.uFogMode.value = fogMode;
      u.uFogA.value = fogA;
      u.uFogB.value = fogB;
      if (fogCol) u.uFogColor.value.set(fogCol.r, fogCol.g, fogCol.b);
      if (s.ambient) {
        u.uMaxPoint.value = ambMaxPt;
        u.uSkyFade.value = (isleOn && isleMin) ? 1 : 0;
        if (isleMin) { u.uIsleMin.value.copy(isleMin); u.uIsleMax.value.copy(isleMax); }
      }
    }
  }

  /* ── 배기 (연속) ──────────────────────────────────────────────── */

  function findExhaust(obj) {
    for (var i = 0; i < exhausts.length; i++) if (exhausts[i].obj === obj) return exhausts[i];
    return null;
  }

  /** 앵커의 배기 엔트리를 얻거나 만든다. 슬롯이 없으면 null. */
  function touchExhaust(obj) {
    var e = findExhaust(obj);
    if (!e) {
      if (exhausts.length > 6) return null;
      e = { obj: obj, load: 0, target: 0, floor: 0, soot: 0,
            accum: 0, idle: 0, seq: 0, primed: 0 };
      exhausts.push(e);
    }
    return e;
  }

  /* 배기 플룸은 **3개 레이어**로 만든다. 단일 빌보드 스트림은 내부 구조가 없어
     "회색 얼룩" 으로 읽힌다(R1 심사 지적). 각 레이어는 크기·수명·상승속도·회전속도가
     달라서, 노이즈가 구워진 퍼프 스프라이트가 서로 다른 속도로 스크롤하는 것과 같은
     효과를 낸다 — 코어는 굴뚝에 붙어 빠르게 흐르고, 위스프는 느리게 퍼지며 하늘로 녹는다.

     R2 심사: "굴뚝 위 아무것도 없음". 실제로는 나오고 있었지만 (a) 입자가 너무 작고
     (b) 시작색이 곧바로 밝은 회색으로 풀려서, 원경(75~260유닛)에서 창백한 얼룩으로
     사라지고 있었다. 그래서 이번엔:
       · 시작 크기 0.34~0.95m → 끝 1.35~3.2m (원경에서 20~60px 로 읽힘)
       · 코어 시작색을 #3a3630 근방에 고정하고 colP 로 **오래 어둡게 유지**
       · 수명 상한 2.7s · 월드 크기 상한 3.4m — 그 이상은 R1 의 "30m 검은 덩어리"
     끝색은 항상 하늘색으로 lerp 해 배경에 녹인다(회색 판이 남지 않게).           */
  /* 각 레이어의 색은 **연기 값 램프** 위의 위치(k0 시작 · k1 끝)로 지정한다.
     0 = 매연 검정 · 1/3 = 굴뚝 회색 · 2/3 = 중간 회색 · 1 = 햇빛 받은 밝은 회색.
     R2 에서 안 보였던 진짜 이유: 플룸이 대부분 **어두운 잔디 언덕 위**에 겹치는데
     연기까지 거의 검정이라 대비가 0 이었다. 그래서 코어만 어둡게 남기고 몸통·위스프는
     중간톤으로 올렸다 — 창백한 하늘 위(어두워서 읽힘)와 그늘진 잔디 위(밝아서 읽힘)
     양쪽에서 동시에 읽히는 값은 중간톤뿐이다. */
  var EXL = [
    /* 0 core — 굴뚝에 꽂힌 짙은 심. 플룸을 기관차에 "연결" 하는 역할. */
    { s0: 0.36, s0r: 0.26, s1: 1.60, s1r: 0.55, life: 1.40, lifeR: 0.55,
      a: 0.74, aL: 0.16, aS: 0.30, k0: 0.46, k1: 0.80, soot: 0.40, sky: 0.15,
      drag: 0.75, grav: 1.05, turb: 0.42, rotV: 1.25, decay: 1.20, colP: 2.4,
      jr: 0.10, sp: 0.78, jit: 0.34 },
    /* 1 body — 부피. 상승하며 옆으로 부푼다. 플룸에서 실제로 "읽히는" 레이어라
       스카이라인 위로 올라가야 한다. */
    { s0: 0.64, s0r: 0.40, s1: 2.65, s1r: 0.60, life: 2.05, lifeR: 0.70,
      a: 0.58, aL: 0.14, aS: 0.24, k0: 0.66, k1: 0.92, soot: 0.30, sky: 0.70,
      drag: 0.85, grav: 1.25, turb: 0.90, rotV: 0.55, decay: 1.45, colP: 1.5,
      jr: 0.22, sp: 0.86, jit: 0.90 },
    /* 2 wisp — 바깥 껍질. 거의 투명하고 하늘색으로 사라진다. */
    { s0: 1.00, s0r: 0.55, s1: 3.40, s1r: 0.00, life: 2.45, lifeR: 0.50,
      a: 0.26, aL: 0.06, aS: 0.08, k0: 0.84, k1: 1.00, soot: 0.14, sky: 0.92,
      drag: 1.05, grav: 0.90, turb: 1.30, rotV: 0.26, decay: 1.85, colP: 0.9,
      jr: 0.38, sp: 0.64, jit: 1.35 }
  ];

  /* 연기 값 램프 (선형 공간). buildColors 에서 채운다. */
  var RAMP = null;
  var rampTmp = [0, 0, 0];
  function rampSmoke(k, out) {
    var t = U.clamp01(k) * 3;
    var i = Math.min(2, Math.floor(t)), f = t - i;
    var a = RAMP[i], b = RAMP[i + 1];
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  }
  /* 코어를 많이 뿌려 기둥이 끊기지 않게 한다 */
  var EXSEQ = [0, 0, 1, 0, 2, 0, 1, 2];

  /* 하늘색(선형) — 배기 끝색이 여기로 수렴한다. update() 에서 scene.fog 로 갱신. */
  var skyLin = [0.42, 0.50, 0.58];

  function stepExhausts(dt) {
    var em = CAPS[quality].emit;
    for (var i = exhausts.length - 1; i >= 0; i--) {
      var e = exhausts[i];
      e.idle += dt;

      /* 0.25s 이상 갱신이 없으면 스스로 꺼진다.
         자동 구동이 깐 바닥값(floor)은 명시 호출값을 **올리기만** 한다 — 한 프레임만
         유효하므로 읽고 즉시 비운다(setAuto(false) 하면 다음 프레임에 사라짐). */
      var tgt = (e.idle > 0.25) ? 0 : e.target;
      if (e.floor > tgt) tgt = e.floor;
      e.floor = 0;
      var prev = e.load;
      e.load = U.damp(e.load, tgt, 5.5, dt);

      /* 부하 상승 → 검은 매연 버스트. 상한을 낮춰 화면을 덮는 검은 덩어리를 막는다. */
      var rise = (e.load - prev) / Math.max(dt, 1e-4);
      if (rise > 0.35) e.soot = Math.min(0.62, e.soot + rise * dt * 2.6);
      e.soot = U.damp(e.soot, 0, 1.7, dt);

      if (e.load < 0.004 && e.soot < 0.004 && e.idle > 0.4) { exhausts.splice(i, 1); continue; }

      e.obj.updateWorldMatrix(true, false);
      v3a.setFromMatrixPosition(e.obj.matrixWorld);
      v3b.set(0, 1, 0).transformDirection(e.obj.matrixWorld).normalize();

      /* 방출률. R1 은 (2.2/34/62) 에 수명 4.1s · 폭 10m 라 화면을 덮는 30m 매연
         덩어리가 됐다. 화면 점유는 (방출률 × 수명 × 폭²) 이므로, 폭 상한을 10m→3.4m,
         수명을 4.1s→2.7s 로 줄인 지금은 방출률을 이만큼 둬도 점유 면적이 R1 의
         5% 수준이다 — 그러면서도 기둥이 끊기지 않는다.
         상수항 4.0 은 **공회전에서도 기둥이 보이게** 하는 값(정지 포즈 대응). */
      var rate = (6.5 + 32 * e.load + 32 * e.soot) * em;
      e.accum += rate * dt;
      var guard = 0;
      while (e.accum >= 1 && guard++ < 24) {
        /* 간격을 흔든다 — 등간격으로 뿜으면 달리는 기관차 뒤에 **염주알 같은**
           일정 간격 퍼프 행렬이 남아서 스프라이트 반복이 눈에 띈다. */
        e.accum -= 0.55 + rnd() * 0.9;
        /* 프레임 안에서의 방출 시각을 되짚어 기둥을 이어 붙인다(프레임당 뭉침 방지) */
        var back = Math.min(dt, Math.max(e.accum, 0) / Math.max(rate, 1e-4));
        emitExhaust(v3a, v3b, e.load, e.soot, EXL[EXSEQ[(e.seq++) & 7]], back);
      }
      if (e.accum > 3) e.accum = 3;
    }
  }

  function emitExhaust(p, up, load, soot, L, back) {
    var s = soot, l = load;
    /* 시작색 = 램프 위 k0. 매연(soot)이 짙을수록 램프 아래(검정)로 끌어내린다. */
    var c = rampSmoke(L.k0 - s * L.soot, rampTmp);
    E.r0 = c[0]; E.g0 = c[1]; E.b0 = c[2];
    /* 끝색 = 램프 위 k1 을 하늘색 쪽으로. 늙은 연기가 배경에 녹아 "회색 판"이 안 남는다. */
    c = rampSmoke(L.k1, rampTmp);
    E.r1 = U.lerp(c[0], skyLin[0], L.sky);
    E.g1 = U.lerp(c[1], skyLin[1], L.sky);
    E.b1 = U.lerp(c[2], skyLin[2], L.sky);

    var sp = (3.2 + 3.6 * l + 3.0 * s + rnd() * 0.9) * L.sp;

    /* 배기관 지름만큼 흩뿌리고, back 만큼 이미 흘러간 위치에서 시작한다 */
    var jr = L.jr * (1 + 0.45 * s);
    E.x = p.x + (rnd() - 0.5) * jr + up.x * sp * back;
    E.y = p.y + (rnd() - 0.5) * jr * 0.4 + up.y * sp * back;
    E.z = p.z + (rnd() - 0.5) * jr + up.z * sp * back;

    var jt = L.jit;
    E.vx = up.x * sp + (rnd() - 0.5) * jt;
    E.vy = up.y * sp + (rnd() - 0.5) * jt * 0.35;
    E.vz = up.z * sp + (rnd() - 0.5) * jt;

    E.s0 = L.s0 + rnd() * L.s0r;
    E.s1 = Math.min(3.4, L.s1 + rnd() * L.s1r + s * 0.30);        // 월드 크기 상한 3.4m
    E.a0 = (L.a + L.aL * l + L.aS * s) * (0.74 + 0.52 * rnd());
    E.life = Math.min(2.7, L.life + rnd() * L.lifeR + s * 0.25);  // 수명 상한 2.7s
    E.drag = L.drag;
    E.windK = 1.0;
    E.grav = L.grav - s * 0.10;        // 뜨거운 배기는 뜬다, 무거운 매연은 덜
    E.turb = L.turb;
    E.rot = rnd() * 6.2831853;
    E.rotV = (rnd() - 0.5) * L.rotV;   // 레이어마다 회전(=노이즈 스크롤) 속도가 다르다
    E.fadeIn = 0.05;
    E.decayPow = L.decay;
    E.colPow = L.colP;                 // 코어는 오래 검게, 위스프는 금방 하늘색으로
    E.floorY = -1e9;
    E.e0 = SEL_B[0]; E.e1 = SEL_B[1]; E.e2 = SEL_B[2];   // 노이즈가 구워진 퍼프
    sysSoft.spawn();
  }

  /* ── 자동 구동 (self-drive) ───────────────────────────────────────
     R2 심사 지적: "mid-move 포즈에 디젤 배기도 바퀴 먼지도 전혀 없다".
     원인은 파티클이 안 나온 게 아니라, **Motion 이 배기를 켜 주는 구간이 좁고**
     (정지·포즈 스냅·points 대기에서는 부하 0.07~0.20) 스크린샷이 하필 그 순간을
     잡기 때문이었다. 그래서 FX 가 World 를 직접 읽어 스스로 굴린다.
       · 배기: 기관차 rig.exhaust 에 바인딩. 자동값은 바닥값이라 Motion 이 이긴다.
       · 먼지: 차량 그룹의 실제 월드 이동량으로 차량별 속도를 재고, 움직인 차량의
         대차 접지점에만 뿌린다. 정지 측선 화차에는 안 뿌린다.
     Motion 이나 World 가 없어도(테스트 하네스) 조용히 아무것도 안 한다.        */

  var autoOn = true;
  var autoLoco = null;          // 마지막으로 스캔한 World.loco (Veh)
  var autoAnchor = null;        // 기관차 배기 앵커
  var autoVeh = [];             // [{ g, bogies, px, pz, spd, acc, seen }]
  var autoRescan = 0;
  var autoWork = 0;             // 최근에 일했는가 (0..1) — 천천히 식는다

  function autoPush(v) {
    if (!v || !v.group) return;
    var bg = (v.rig && v.rig.bogies && v.rig.bogies.length) ? v.rig.bogies : null;
    autoVeh.push({ g: v.group, bogies: bg, px: 0, pz: 0, spd: 0, acc: 0, seen: 0 });
  }

  function autoScan() {
    var w = null;
    try { w = (SH.World && SH.World.current) || null; } catch (e) { w = null; }
    if (!w || !w.loco) {
      if (autoLoco) { autoLoco = null; autoAnchor = null; autoVeh.length = 0; }
      return;
    }
    if (autoLoco === w.loco) return;         // 이미 잡아둔 월드
    autoLoco = w.loco;
    autoAnchor = (w.loco.rig && w.loco.rig.exhaust) ? w.loco.rig.exhaust : null;
    autoVeh.length = 0;
    autoPush(w.loco);
    var vs = w.vehicles;
    if (vs) {
      if (typeof vs.forEach === 'function') vs.forEach(function (v) { autoPush(v); });
      else for (var k in vs) autoPush(vs[k]);
    }
  }

  /** 대차 접지점에 먼지 한 줌. amt 는 0..1 (속도 비례). */
  function dustAtBogie(v, which, amt) {
    var b = v.bogies ? v.bogies[which % v.bogies.length] : null;
    var o = b || v.g;
    o.updateWorldMatrix(true, false);
    v3b.setFromMatrixPosition(o.matrixWorld);
    /* 레일 상면이 차량 그룹 원점이다 — 대차 y 를 그대로 쓰면 접지 높이가 정확하다.
       살짝만 띄워 도상 위에서 시작하게 한다. */
    v3b.y += 0.05;
    v3b.z += (rnd() - 0.5) * 1.5;
    emitDust(v3b, amt, null, 1);
  }

  function autoDrive(dt) {
    if (!autoOn || dt <= 0) return;
    autoRescan -= dt;
    if (autoRescan <= 0 || !autoLoco) { autoRescan = 0.5; autoScan(); }

    var M = null;
    try { M = SH.Motion || null; } catch (e) { M = null; }
    var busy = !!(M && M.isBusy);
    var mspd = (M && typeof M.speed === 'number' && isFinite(M.speed)) ? Math.abs(M.speed) : 0;

    /* 방금 일한 엔진은 바로 안 식는다. 이동이 끝나도 몇 초는 플룸이 굵게 남아야
       "정지 순간"을 잡은 스크린샷에서도 굴뚝이 비지 않는다. */
    var work = (busy || mspd > 0.5) ? 1 : 0;
    autoWork = (work > autoWork) ? 1 : autoWork * Math.exp(-dt * 0.22);

    /* ── 배기 바닥값 ── 디젤은 대기 중에도 공회전한다. 입환 중(busy)이면 노치업. */
    if (autoAnchor && autoAnchor.parent) {
      var f = 0.34 + 0.46 * U.clamp01(mspd / 16) + 0.28 * autoWork;
      if (busy) f = Math.max(f, 0.58);
      var e = touchExhaust(autoAnchor);
      if (e) {
        /* 풀이 통째로 비었는데 엔진은 돌아야 하는 상태 = 플룸이 죽은 것.
           (레벨 로드·clear 직후) 다시 프라이밍한다. */
        if (sysSoft.count === 0) e.primed = 0;
        if (!e.primed) {
          e.primed = 1;
          e.load = Math.max(f, e.target);
          primePlume(e, e.load);
        }
        if (f > e.floor) e.floor = f;
        e.idle = 0;
      }
    }

    /* ── 바퀴 접지 먼지 ── 차량별 실제 이동량으로 속도를 재서 움직인 차량만.
       편성 전체(최대 9량)가 동시에 뿜으면 소프트 풀이 포화돼 **배기가 굶는다**.
       그래서 (a) 차량당 방출률을 낮게 잡고 (b) 풀의 55% 를 넘으면 먼지를 멈춘다. */
    var em = CAPS[quality].emit;
    var dustRoom = Math.floor(sysSoft.cap * 0.55);
    for (var i = 0; i < autoVeh.length; i++) {
      var v = autoVeh[i], g = v.g;
      if (!g || !g.parent) continue;
      g.updateWorldMatrix(true, false);
      v3a.setFromMatrixPosition(g.matrixWorld);
      var dx = v3a.x - v.px, dz = v3a.z - v.pz;
      var inst = v.seen ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
      v.px = v3a.x; v.pz = v3a.z; v.seen = 1;
      if (inst < 0.6) inst = 0;                  // 바닥 노이즈 컷

      /* 급감속 = 제동. 한 번 크게 터뜨려 정지 후에도 먼지가 남게 한다(SPEC §3.7). */
      if (v.spd > 7 && inst < v.spd * 0.55 && sysSoft.count < dustRoom) {
        dustAtBogie(v, (v.acc | 0) + 1, 0.55);
      }

      /* 붙었다 천천히 빠지는 속도 — 정지 직후 ~1.2s 동안 먼지가 계속 인다 */
      v.spd = (inst > v.spd) ? inst : v.spd * Math.exp(-dt * 1.35);
      if (v.spd < 0.35) { v.spd = 0; v.acc = 0; continue; }
      if (sysSoft.count >= dustRoom) { v.acc = 0; continue; }

      var k = U.clamp01(v.spd / 11);
      v.acc += (0.30 + 1.55 * k) * em * dt;      // 초당 방출 횟수
      var guard = 0;
      while (v.acc >= 1 && guard++ < 2) {
        v.acc -= 1;
        dustAtBogie(v, guard + (i & 1), 0.12 + 0.18 * k);
      }
      if (v.acc > 1.5) v.acc = 1.5;
    }
  }

  /* 플룸 프라이밍 — 앵커를 처음 잡은 프레임에 ~1.6초치 배기를 미리 적분해 둔다.
     레벨 로드 직후·포즈 스냅 직후처럼 "방금 켠" 순간을 스크린샷이 잡아도 굴뚝 위가
     비지 않는다 (R2 심사: mid-move 에 플룸이 0개). 이 시점의 소프트 풀은 거의
     비어 있으므로 stepSystem 을 같이 돌려도 다른 이펙트를 해치지 않는다. */
  function primePlume(e, load) {
    if (!sysSoft || !e || !e.obj) return;
    var em = CAPS[quality].emit;
    var rate = (6.5 + 32 * U.clamp01(load)) * em;
    var dt = 1 / 30, steps = 48;                 // 1.6s
    e.obj.updateWorldMatrix(true, false);
    v3a.setFromMatrixPosition(e.obj.matrixWorld);
    v3b.set(0, 1, 0).transformDirection(e.obj.matrixWorld).normalize();
    var acc = 0, seq = e.seq | 0;
    for (var k = 0; k < steps; k++) {
      acc += rate * dt;
      var guard = 0;
      while (acc >= 1 && guard++ < 8) {
        acc -= 1;
        emitExhaust(v3a, v3b, load, 0, EXL[EXSEQ[(seq++) & 7]], 0);
      }
      stepSystem(sysSoft, dt);                   // 이미 뿌린 것들을 그만큼 늙힌다
    }
    e.seq = seq; e.accum = acc;
  }

  function autoReset() {
    autoLoco = null; autoAnchor = null; autoVeh.length = 0; autoRescan = 0; autoWork = 0;
  }

  /* ── 공개 이미터 ──────────────────────────────────────────────── */

  function toVec(p) {
    if (!p) return null;
    if (p.isVector3) return p;
    if (typeof p.x === 'number') return v3a.set(p.x, p.y || 0, p.z || 0);
    return null;
  }

  /** tight: 0..1 — 1 이면 바퀴 접지용 **좁은** 먼지(대차 디테일을 덮지 않게).
      공개 API(FX.dust)는 항상 tight=0 이라 Motion 쪽 연출은 그대로다. */
  function emitDust(pos, amount, dir, tight) {
    var p = toVec(pos); if (!p || !sysSoft) return;
    var am = (amount == null ? 1 : amount);
    var tg = tight ? U.clamp01(tight) : 0;
    var szK = 1 - 0.46 * tg;
    var n = Math.round(U.clamp(am * 7, 1, 34) * CAPS[quality].emit);
    if (n < 1) n = 1;
    var dx = 0, dz = 0;
    if (dir) {
      var d = dir.isVector3 ? dir : null;
      if (d) { var L = Math.sqrt(d.x * d.x + d.z * d.z) || 1; dx = d.x / L; dz = d.z / L; }
    }
    var base = C.dust0, tip = C.dust1;
    for (var i = 0; i < n; i++) {
      var ang = rnd() * 6.2831853, rad = rnd() * 0.55;
      E.x = p.x + Math.cos(ang) * rad + dx * 0.2;
      E.y = p.y + rnd() * 0.16;
      E.z = p.z + Math.sin(ang) * rad + dz * 0.2;
      var sp = 0.9 + rnd() * 2.0 * am;
      E.vx = dx * sp + Math.cos(ang) * (0.5 + rnd() * 1.1);
      E.vy = 0.35 + rnd() * 0.95;
      E.vz = dz * sp + Math.sin(ang) * (0.5 + rnd() * 1.1);
      E.r0 = base[0]; E.g0 = base[1]; E.b0 = base[2];
      E.r1 = tip[0]; E.g1 = tip[1]; E.b1 = tip[2];
      E.s0 = (0.45 + rnd() * 0.55) * szK;
      E.s1 = (2.4 + rnd() * 2.2) * szK;
      E.a0 = (0.26 + 0.22 * U.clamp01(am)) * (1 - 0.20 * tg);
      E.life = (1.0 + rnd() * 1.15) * (1 - 0.22 * tg);
      E.drag = 2.3 + 1.1 * tg;
      E.windK = 0.55;
      E.grav = -0.62;
      E.turb = 0.28;
      E.rot = rnd() * 6.2831853;
      E.rotV = (rnd() - 0.5) * 0.9;
      E.fadeIn = 0.06;
      E.decayPow = 1.7;
      /* 자갈 먼지는 따뜻한 색을 좀 더 오래 유지해야 한다 — 곧바로 밝게 풀리면
         흙먼지가 아니라 흰 증기로 읽힌다(§3.3 팔레트). */
      E.colPow = 1.45;
      E.floorY = p.y + 0.05;                 // 지면에 붙어 낮게 퍼진다
      E.e0 = SEL_C[0]; E.e1 = SEL_C[1]; E.e2 = SEL_C[2];
      sysSoft.spawn();
    }
  }

  function emitSparks(pos, dir, countOverride) {
    var p = toVec(pos); if (!p || !sysAdd) return;
    var px = p.x, py = p.y, pz = p.z;
    var n = Math.round((countOverride || 9) * CAPS[quality].emit);
    if (n < 2) n = 2;
    var dx = 0, dy = 0.4, dz = 0;
    if (dir && dir.isVector3) {
      var L = dir.length() || 1; dx = dir.x / L; dy = dir.y / L; dz = dir.z / L;
    }
    var h0 = C.spark0, h1 = C.spark1;
    for (var i = 0; i < n; i++) {
      E.x = px + (rnd() - 0.5) * 0.14;
      E.y = py + (rnd() - 0.5) * 0.14;
      E.z = pz + (rnd() - 0.5) * 0.14;
      var sp = 1.8 + rnd() * 4.6;
      E.vx = dx * sp + (rnd() - 0.5) * 3.2;
      E.vy = dy * sp + rnd() * 2.6 + 0.6;
      E.vz = dz * sp + (rnd() - 0.5) * 3.2;
      E.r0 = h0[0]; E.g0 = h0[1]; E.b0 = h0[2];
      E.r1 = h1[0]; E.g1 = h1[1]; E.b1 = h1[2];
      E.s0 = 0.085 + rnd() * 0.075;
      E.s1 = 0.018;
      E.a0 = 1.0;
      E.life = 0.32 + rnd() * 0.48;
      E.drag = 0.85;
      E.windK = 0.12;
      E.grav = -8.4;
      E.turb = 0.5;
      E.rot = rnd() * 6.2831853;
      E.rotV = (rnd() - 0.5) * 3.0;
      E.fadeIn = 0.02;
      E.decayPow = 0.9;
      E.colPow = 1;
      E.floorY = -1e9;
      var star = rnd() < 0.22;
      E.e0 = star ? 0 : 1; E.e1 = 0; E.e2 = star ? 1 : 0;
      sysAdd.spawn();
    }
  }

  function emitSteam(pos, amount) {
    var p = toVec(pos); if (!p || !sysSoft) return;
    var am = (amount == null ? 1 : amount);
    var n = Math.round(U.clamp(am * 13, 3, 40) * CAPS[quality].emit);
    if (n < 2) n = 2;
    var w0 = C.steam0, w1 = C.steam1;
    for (var i = 0; i < n; i++) {
      /* 반구 방향으로 확 뿜는다 */
      var a = rnd() * 6.2831853;
      var e = rnd() * 0.9 - 0.15;
      var ce = Math.cos(e);
      E.x = p.x + (rnd() - 0.5) * 0.1;
      E.y = p.y + (rnd() - 0.5) * 0.1;
      E.z = p.z + (rnd() - 0.5) * 0.1;
      var sp = (2.6 + rnd() * 3.4) * (0.6 + 0.6 * am);
      E.vx = Math.cos(a) * ce * sp;
      E.vy = Math.sin(e) * sp * 0.7 + 0.6;
      E.vz = Math.sin(a) * ce * sp;
      E.r0 = w0[0]; E.g0 = w0[1]; E.b0 = w0[2];
      E.r1 = w1[0]; E.g1 = w1[1]; E.b1 = w1[2];
      E.s0 = 0.20 + rnd() * 0.20;
      E.s1 = 2.1 + rnd() * 1.5;
      E.a0 = 0.30 + 0.20 * U.clamp01(am);
      E.life = 0.48 + rnd() * 0.62;
      E.drag = 3.6;
      E.windK = 0.8;
      E.grav = 0.75;
      E.turb = 0.4;
      E.rot = rnd() * 6.2831853;
      E.rotV = (rnd() - 0.5) * 1.5;
      E.fadeIn = 0.05;
      E.decayPow = 1.35;
      E.colPow = 1;
      E.floorY = -1e9;
      E.e0 = SEL_A[0]; E.e1 = SEL_A[1]; E.e2 = SEL_A[2];   // 매끈한 원
      sysSoft.spawn();
    }
  }

  function emitImpact(pos) {
    var p = toVec(pos); if (!p || !sysSoft) return;
    var px = p.x, py = p.y, pz = p.z;
    var n = Math.round(16 * CAPS[quality].emit); if (n < 4) n = 4;
    var base = C.dust0, tip = C.dust1;
    var phase = rnd() * 6.2831853;
    for (var i = 0; i < n; i++) {
      /* 링 — 수평으로 고르게 퍼지는 먼지 고리 */
      var a = phase + (i / n) * 6.2831853 + (rnd() - 0.5) * 0.25;
      var sp = 2.1 + rnd() * 1.7;
      E.x = px + Math.cos(a) * 0.28;
      E.y = py + rnd() * 0.22;
      E.z = pz + Math.sin(a) * 0.28;
      E.vx = Math.cos(a) * sp;
      E.vy = 0.55 + rnd() * 0.8;
      E.vz = Math.sin(a) * sp;
      E.r0 = base[0]; E.g0 = base[1]; E.b0 = base[2];
      E.r1 = tip[0]; E.g1 = tip[1]; E.b1 = tip[2];
      E.s0 = 0.32 + rnd() * 0.36;
      E.s1 = 2.0 + rnd() * 1.7;
      E.a0 = 0.40;
      E.life = 0.7 + rnd() * 0.7;
      E.drag = 2.9;
      E.windK = 0.5;
      E.grav = -0.8;
      E.turb = 0.22;
      E.rot = rnd() * 6.2831853;
      E.rotV = (rnd() - 0.5) * 1.2;
      E.fadeIn = 0.05;
      E.decayPow = 1.6;
      E.colPow = 1;
      E.floorY = py - 0.18;
      E.e0 = SEL_C[0]; E.e1 = SEL_C[1]; E.e2 = SEL_C[2];
      sysSoft.spawn();
    }
    v3b.set(0, 1, 0);
    emitSparks(v3c.set(px, py, pz), v3b, 7);
  }

  /** 하늘 페이드용 섬 AABB 를 잡는다. World 가 있으면 실제 섬 상자, 없으면 씬 바운즈. */
  function updateIsleBox(box) {
    var ib = null;
    try {
      var w = SH.World && SH.World.current;
      if (w && w.islandBounds && w.islandBounds.min) ib = w.islandBounds;
    } catch (e) { /* noop */ }
    var mn = ib ? ib.min : (box ? (box.min || box.mn) : null);
    var mx = ib ? ib.max : (box ? (box.max || box.mx) : null);
    if ((!mn || !mx) && pollenBox) {         // 최후 수단: 화분 영역을 섬 발자국으로 간주
      mn = { x: pollenBox.x0 + 2, y: -30, z: pollenBox.z0 + 2 };
      mx = { x: pollenBox.x1 - 2, y: 1.0, z: pollenBox.z1 - 2 };
    }
    if (!mn || !mx || !isleMin) return;      // 정보가 없으면 직전 값을 유지
    /* Geo.island 이 XZ 로 더 패딩하지만 여기서는 **작게** 잡는다 —
       넘치면 하늘에 흰 점이 남고, 모자라면 가장자리 모트만 조금 옅어질 뿐이다. */
    isleMin.set(mn.x - 4, Math.min(mn.y, -26), mn.z - 4);
    isleMax.set(mx.x + 4, Math.max(mx.y, 1.6), mx.z + 4);
    isleOn = (isleMax.x > isleMin.x + 1 && isleMax.z > isleMin.z + 1);
  }

  function seedPollen(box) {
    if (!sysAmb) return;
    if (box) {
      var mn = box.min || box.mn, mx = box.max || box.mx;
      if (mn && mx) {
        var top = mx.y;
        pollenBox = {
          x0: mn.x - 2, x1: mx.x + 2,
          y0: Math.max(mn.y, top - 5.0), y1: top + 9.0,
          z0: mn.z - 2, z1: mx.z + 2
        };
      }
    }
    if (!pollenBox) pollenBox = { x0: -100, x1: 64, y0: 0.3, y1: 15, z0: -14, z1: 20 };
    updateIsleBox(box);
    var B = pollenBox;
    var warm = C.pollen;
    sysAmb.count = 0;
    var n = sysAmb.cap;
    for (var i = 0; i < n; i++) {
      E.x = U.lerp(B.x0, B.x1, rnd());
      E.y = U.lerp(B.y0, B.y1, Math.pow(rnd(), 1.45));   // 아래쪽에 더 촘촘히
      E.z = U.lerp(B.z0, B.z1, rnd());
      E.vx = 0; E.vy = 0; E.vz = 0;
      E.r0 = warm[0]; E.g0 = warm[1]; E.b0 = warm[2];
      E.r1 = warm[0]; E.g1 = warm[1]; E.b1 = warm[2];
      /* 화면 크기는 uMaxPoint 로 ~3px 에 묶여 있으므로, 월드 크기는 **먼 쪽**에서
         1~3px 이 나오도록 잡는다(가까운 것은 어차피 클램프된다).
         알파는 0.13 이하 — 이보다 크면 하늘에서 "딱딱한 흰 원반" 으로 읽힌다. */
      E.s0 = 0.26 + rnd() * 0.34;
      E.s1 = E.s0;
      E.a0 = 0.145 + rnd() * 0.165;
      E.life = 1e9;
      E.drag = 1.6; E.windK = 0.13; E.grav = 0; E.turb = 0;
      E.rot = rnd() * 6.2831853;
      E.rotV = (rnd() - 0.5) * 0.4;
      E.fadeIn = 0; E.decayPow = 0; E.colPow = 1; E.floorY = -1e9;
      var star = rnd() < 0.06;                 // 소수만 스타 글린트 — 과하면 반딧불이가 된다
      E.e0 = 0; E.e1 = star ? 0 : 1; E.e2 = star ? 1 : 0;
      var k = sysAmb.spawn();
      if (k < 0) break;
      sysAmb.col[k * 3] = warm[0];
      sysAmb.col[k * 3 + 1] = warm[1];
      sysAmb.col[k * 3 + 2] = warm[2];
      sysAmb.alp[k] = E.a0;
      sysAmb.siz[k] = E.s0;
    }
    pollenWanted = true;
  }

  /* ── 지면 데칼 ────────────────────────────────────────────────── */

  var DECAL_CAP = 48;

  function makeDecalTex(kind, N) {
    var o = U.canvas(N, N);
    var nz = U.noise2D('fx-decal-' + kind, 0);
    var vor = U.voronoi2D('fx-decal-v-' + kind, 0);

    U.fillPixels(o.cv, function (x, y) {
      var u = (x + 0.5) / N, v = (y + 0.5) / N;
      var cu = u * 2 - 1, cv2 = v * 2 - 1;
      var d = Math.sqrt(cu * cu + cv2 * cv2);
      var edge = U.smooth(U.clamp01((1.0 - d) * 1.8));
      var n = U.fbm(nz, u * 4.5, v * 4.5, 3, 2, 0.55);
      var a = 0, r = 0, g = 0, b = 0;

      if (kind === 'oil') {
        /* 기름 얼룩 — 거의 검고 가장자리에 무지개빛 */
        var m = U.clamp01((0.42 + n * 0.55) * edge);
        a = U.smooth(U.clamp01((m - 0.24) * 2.6));
        var irid = U.clamp01(1.0 - Math.abs(m - 0.34) * 6.0);
        r = 0.035 + irid * 0.16;
        g = 0.038 + irid * 0.09;
        b = 0.050 + irid * 0.22;
        a *= 0.92;
      } else if (kind === 'mark') {
        /* 바퀴/제동 자국 — U 축을 따라 두 줄 */
        var band = Math.exp(-Math.pow((v - 0.34) / 0.075, 2)) +
                   Math.exp(-Math.pow((v - 0.66) / 0.075, 2));
        var along = U.smooth(U.clamp01((1.0 - Math.abs(cu)) * 1.5));
        var brk = 0.55 + 0.60 * (U.fbm(nz, u * 9.0, v * 2.0, 2, 2, 0.5) * 0.5 + 0.5);
        a = U.clamp01(band * along * brk) * 0.62;
        r = 0.055; g = 0.050; b = 0.046;
      } else {
        /* 기름때/그을음 얼룩 — 넓고 부드럽게 */
        var vv = vor(u * 5.0, v * 5.0);
        var blot = U.clamp01(0.55 + n * 0.6 - vv.f1 * 0.35);
        a = U.smooth(U.clamp01((blot - 0.30) * 2.2)) * edge * 0.5;
        r = 0.085; g = 0.068; b = 0.052;
      }

      return [
        U.clamp01(Math.pow(r, 1 / 2.2)) * 255,
        U.clamp01(Math.pow(g, 1 / 2.2)) * 255,
        U.clamp01(Math.pow(b, 1 / 2.2)) * 255,
        U.clamp01(a) * 255
      ];
    });
    return o.cv;
  }

  function buildDecals() {
    decalKinds = {};
    var geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    var specs = [
      { k: 'oil',   rough: 0.20, metal: 0.06, op: 0.95 },
      { k: 'mark',  rough: 0.88, metal: 0.0,  op: 0.85 },
      { k: 'grime', rough: 0.95, metal: 0.0,  op: 0.8 }
    ];
    var N = quality > 0 ? 192 : 128;

    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      var tex = mkTex(makeDecalTex(s.k, N), true);
      var mat = new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        opacity: s.op,
        depthWrite: false,
        roughness: s.rough,
        metalness: s.metal,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
        side: THREE.FrontSide
      });
      var mesh = new THREE.InstancedMesh(geo, mat, DECAL_CAP);
      mesh.count = 0;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.fx = true;
      mesh.raycast = noRaycast;
      mesh.name = 'fx-decal-' + s.k;
      root.add(mesh);
      decalKinds[s.k] = { mesh: mesh, tex: tex, mat: mat, geo: geo };
    }
    decalKinds._geo = geo;
  }

  function addDecal(kind, pos, opts) {
    if (!inited || !decalKinds) return false;
    var d = decalKinds[kind] || decalKinds.grime;
    if (!d) return false;
    var p = toVec(pos); if (!p) return false;
    opts = opts || {};
    var r = opts.seed != null ? U.rng(opts.seed) : rnd;
    var sz = opts.size != null ? opts.size : (2.2 + r() * 2.4);
    var rot = opts.rot != null ? opts.rot : r() * 6.2831853;
    var m = d.mesh;
    if (m.count >= DECAL_CAP) return false;
    var aspect = kind === 'mark' ? (2.6 + r() * 1.4) : (0.85 + r() * 0.35);
    qtn.setFromAxisAngle(v3b.set(0, 1, 0), rot);
    sclV.set(sz * aspect, 1, sz);
    mtx.compose(v3c.set(p.x, p.y + 0.012, p.z), qtn, sclV);
    m.setMatrixAt(m.count, mtx);
    m.count++;
    m.visible = true;
    m.instanceMatrix.needsUpdate = true;
    return true;
  }

  /* ── 초기화 / 해제 ────────────────────────────────────────────── */

  function buildColors() {
    function lin(hex, mul) {
      var c = U.col(hex);
      var k = mul == null ? 1 : mul;
      return [c.r * k, c.g * k, c.b * k];
    }
    C.sootDark  = lin('#171412');
    C.smokeMid  = lin('#3c352f');
    C.sootMid   = lin('#6d675f');
    C.sootLight = lin('#cbc0ac');            // 골든아워 햇빛을 받은 연기 (따뜻한 밝은 회색)
    RAMP = [C.sootDark, C.smokeMid, C.sootMid, C.sootLight];
    C.dust0     = lin('#a89377');
    C.dust1     = lin('#dbcfb6');
    C.steam0    = lin('#f2f4f7');
    C.steam1    = lin('#cfd6df');
    C.spark0    = lin('#ffd9a0', 5.2);      // HDR — 블룸 임계 넘김
    C.spark1    = lin('#b8380f', 1.1);
    C.pollen    = lin('#ffe6bb', 0.90);     // 흰색이 아니라 골든아워 빛 색
  }

  function init(sc) {
    if (inited) return;
    if (!sc || !window.THREE) return;
    try {
      scene = sc;
      windNoise = U.noise2D('fx-wind', 0);
      isleMin = new THREE.Vector3(-1e5, -1e5, -1e5);
      isleMax = new THREE.Vector3(1e5, 1e5, 1e5);
      buildColors();

      /* uDepth 기본 바인딩 (실제 깊이 텍스처가 없어도 샘플러가 유효해야 함) */
      var one = new Uint8Array([255, 255, 255, 255]);
      fallbackDepth = new THREE.DataTexture(one, 1, 1, THREE.RGBAFormat);
      fallbackDepth.needsUpdate = true;

      var texN = CAPS[quality].tex;
      texSoft = mkTex(makeSoftSprite(texN), false);
      texAdd = mkTex(makeAddSprite(texN), false);

      root = new THREE.Group();
      root.name = 'FX';
      root.userData.fx = true;
      root.matrixAutoUpdate = false;

      sysSoft = new System('soft', MAXCAP.soft, texSoft, false, false, false, true);
      sysAdd = new System('additive', MAXCAP.add, texAdd, true, false, false, false);
      sysAmb = new System('ambient', MAXCAP.amb, texAdd, true, true, true, false);

      root.add(sysSoft.points);
      root.add(sysAdd.points);
      root.add(sysAmb.points);

      /* 최대 포인트 크기 조회 */
      var maxPt = 255;
      try {
        var gl = SH.Render && SH.Render.renderer ? SH.Render.renderer.getContext() : null;
        if (gl) {
          var rg = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
          if (rg && rg[1] > 1) maxPt = Math.min(1024, rg[1]);
        }
      } catch (e) { /* noop */ }
      sysSoft.mat.uniforms.uMaxPoint.value = maxPt;
      sysAdd.mat.uniforms.uMaxPoint.value = maxPt;
      sysAmb.mat.uniforms.uMaxPoint.value = maxPt;

      buildDecals();
      scene.add(root);

      inited = true;
      applyCaps();
      if (pollenWanted) { seedPollen(pendingBounds); pendingBounds = null; }
    } catch (e) {
      SH.U.err(e);
    }
  }

  function applyCaps() {
    if (!inited) return;
    var c = CAPS[quality];
    sysSoft.cap = Math.min(c.soft, sysSoft.max);
    sysAdd.cap = Math.min(c.add, sysAdd.max);
    sysAmb.cap = Math.min(c.amb, sysAmb.max);
    if (sysSoft.count > sysSoft.cap) sysSoft.count = sysSoft.cap;
    if (sysAdd.count > sysAdd.cap) sysAdd.count = sysAdd.cap;
    if (sysAmb.count > sysAmb.cap) sysAmb.count = sysAmb.cap;
    else if (pollenWanted && sysAmb.count < sysAmb.cap) seedPollen(null);
  }

  function update(dt, camera) {
    if (!inited) return;
    try {
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;           // 탭 전환 후 폭주 방지
      T += dt;

      var cam = camera || (SH.Render ? SH.Render.camera : null) || null;

      updateWind(dt);
      autoDrive(dt);                      // stepExhausts 보다 먼저 — 바닥값을 깔아둔다
      stepExhausts(dt);
      stepSystem(sysSoft, dt);
      stepSystem(sysAdd, dt);
      stepSystem(sysAmb, dt);

      updateUniforms(cam);
      uploadSystem(sysSoft, cam);
      uploadSystem(sysAdd, cam);
      uploadSystem(sysAmb, cam);
    } catch (e) {
      SH.U.err(e);
    }
  }

  function clearAll() {
    if (!inited) return;
    sysSoft.clear(); sysAdd.clear();
    exhausts.length = 0;
    autoReset();                          // 레벨이 바뀌면 기관차 앵커를 다시 잡는다
    if (pollenWanted) seedPollen(null); else sysAmb.clear();
    clearDecals();
  }

  function clearDecals(kind) {
    if (!decalKinds) return;
    for (var k in decalKinds) {
      if (k === '_geo') continue;
      if (kind && k !== kind) continue;
      decalKinds[k].mesh.count = 0;
      decalKinds[k].mesh.visible = false;
      decalKinds[k].mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    if (!inited) return;
    try {
      var list = [sysSoft, sysAdd, sysAmb];
      for (var i = 0; i < list.length; i++) {
        var s = list[i]; if (!s) continue;
        if (s.points.parent) s.points.parent.remove(s.points);
        s.geo.dispose();
        s.mat.dispose();
      }
      if (texSoft) texSoft.dispose();
      if (texAdd) texAdd.dispose();
      if (fallbackDepth) fallbackDepth.dispose();
      if (decalKinds) {
        for (var k in decalKinds) {
          if (k === '_geo') continue;
          var d = decalKinds[k];
          if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
          d.mesh.dispose();
          d.mat.dispose();
          d.tex.dispose();
        }
        if (decalKinds._geo) decalKinds._geo.dispose();
      }
      if (root && root.parent) root.parent.remove(root);
    } catch (e) { SH.U.err(e); }
    sysSoft = sysAdd = sysAmb = null;
    texSoft = texAdd = fallbackDepth = null;
    decalKinds = null; root = null; scene = null;
    isleMin = isleMax = null; isleOn = false;
    exhausts.length = 0;
    autoReset();
    inited = false;
  }

  /* ── 공개 API ─────────────────────────────────────────────────── */

  var API = {
    init: init,
    update: update,

    exhaust: function (anchor, load) {
      if (!inited || !anchor) return;
      var e = touchExhaust(anchor);
      if (!e) return;
      e.target = U.clamp01(load == null ? 0 : load);
      e.idle = 0;
    },

    dust: function (pos, amount, dir) { if (inited) emitDust(pos, amount, dir); },
    sparks: function (pos, dir) { if (inited) emitSparks(pos, dir); },
    steam: function (pos, amount) { if (inited) emitSteam(pos, amount); },
    impact: function (pos) { if (inited) emitImpact(pos); },

    pollen: function (bounds) {
      pollenWanted = true;
      if (inited) seedPollen(bounds || null);
      else pendingBounds = bounds || null;   // init 시점에 시딩
    },

    setQuality: function (q) {
      quality = U.clamp(Math.round(q == null ? 2 : q), 0, 2);
      applyCaps();
    },

    /** 자동 구동(배기·바퀴 먼지) on/off. 기본 on. */
    setAuto: function (b) {
      autoOn = (b !== false);
      if (!autoOn) autoReset();
      return autoOn;
    },

    clear: clearAll,
    decal: addDecal,
    clearDecals: clearDecals,
    dispose: dispose,

    get group() { return root; },
    get quality() { return quality; },
    get ready() { return inited; },
    get count() {
      return {
        soft: sysSoft ? sysSoft.count : 0,
        additive: sysAdd ? sysAdd.count : 0,
        ambient: sysAmb ? sysAmb.count : 0,
        decals: (function () {
          var n = 0;
          if (decalKinds) for (var k in decalKinds) { if (k !== '_geo') n += decalKinds[k].mesh.count; }
          return n;
        })()
      };
    }
  };

  return API;
})();
