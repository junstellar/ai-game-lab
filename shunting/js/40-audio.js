/* ============================================================================
   조차장 / SHUNTING — 40-audio.js   →  SH.Audio
   오디오 파일 0개. 전부 WebAudio 로 합성한다. 금속 + 야외 공기.
   ----------------------------------------------------------------------------
   CONTRACT (SPEC.md §6)
     Audio.init()                      // 유휴 초기화. AudioContext 는 아직 만들지 않음
     Audio.unlock()                    // 첫 제스처에서 호출 → ctx 생성/resume
     Audio.play(name, opts) -> voice|null
        name : 'clank'|'couple'|'hiss'|'squeal'|'points'|'horn'|'ui'|'win'|'fail'
               (별칭: 'click'→ui, 'error'→fail, 'brake'→hiss, 'impact'→clank)
        opts : { pos:{x,y,z}|Vector3, listener:Object3D|Vector3,
                 gain:Number(1), vel:Number(0..1), rate:Number(1),
                 delay:Number(sec), pan:Number(-1..1), speed:Number(0..1) }
     Audio.engine(on, load)            // 디젤. load 0..1, 0.6s 램프
     Audio.roll(speed)                 // 차륜 럼블. speed = m/s (0 이면 페이드아웃)
     Audio.ambience(on)                // 바람 + 새소리 배경
     Audio.mute(b) -> bool             // 인자 없으면 토글. 반환 = 현재 음소거 상태
   부가 API (다른 모듈이 써도 됨, 전부 안전하게 no-op 가능)
     Audio.setListener(objOrVec3)      // 이후 play() 의 기본 청취자
     Audio.setQuality(q)               // 0 low(리버브 off) | 1 | 2
     Audio.setVolume(v)                // 마스터 0..1
     Audio.suspend() / Audio.resume()  // 탭 비활성 처리
     Audio.dispose()
     Audio.isMuted() -> bool   Audio.ready -> bool   Audio.ctx -> AudioContext|null
     Audio.renderOffline(offlineCtx, name, opts) -> Promise<info>   // 테스트/검증용
        넘어온 OfflineAudioContext '안에' 그래프를 만들고 소리 하나를 스케줄한다.
        새 AudioContext 를 만들지 않는다. startRendering() 은 호출자가 부른다.
        name : play() 의 이름 전부 + 'engine' | 'roll' | 'ambience' | 'bird'
        opts : play() 의 opts + { seconds, load(engine), speed(roll), bird(bool), seed, tc }
        info : { name, seconds, muted, voices, scheduled }
   ----------------------------------------------------------------------------
   · Math.random() 사용 안 함 — 전부 SH.U.rng.
   · 동시 보이스 ≤ 24, 초과 시 우선순위 낮고 오래된 것부터 회수.
   · 마스터 체인: bus → compressor → limiter → destination.
   · 음소거 상태는 localStorage 'gamelab:shunting:mute'.
   ============================================================================ */
SH.Audio = (function () {
  'use strict';

  var U = SH.U;
  var EPS = 0.0008;                 // exponentialRamp 하한 (0 은 불가)
  var MAXV = 24;                    // 동시 보이스 상한
  var STORE_KEY = 'gamelab:shunting:mute';

  var ctx = null;
  var master = null, comp = null, limiter = null;
  var busSfx = null, busBed = null, busAmb = null;
  var revIn = null, revNode = null, revOut = null;
  var noise = null, curveSoft = null, curveHard = null;
  var pulseWave = null;

  var voices = [];                  // 살아 있는 보이스
  var dying = [];                   // 회수 중(짧게 페이드아웃) — 상한 계산에서 제외
  var lastAt = Object.create(null);
  var rnd = U.rng('shunting:audio');       // 실행 중 미세 편차용 (시드 고정)
  var quality = 2;
  var muted = false;
  var volume = 1;
  var started = false;                     // ctx 생성 여부
  var inited = false;
  var listenerRef = null;
  var tickTimer = 0;

  /* 오프라인 렌더 세션 중에는 true. 실시간 전용 동작(resume 등)을 건너뛰고,
     지속음의 램프 시간상수를 tcScale 로 압축해 짧은 렌더에서도 정상 상태에 도달시킨다. */
  var renderMode = false;
  var tcScale = 1;

  /* 아직 ctx 가 없을 때 들어온 요청을 보관했다가 unlock 후 반영 */
  var want = { engOn: false, engLoad: 0, roll: 0, amb: false };

  /* 소리별 최소 간격(초) — 난사 방지 */
  var THROTTLE = {
    clank: 0.035, couple: 0.06, hiss: 0.14, squeal: 0.40,
    points: 0.10, horn: 0.35, ui: 0.035, win: 1.0, fail: 0.5
  };

  /* ══════════════════════════════════════════════════════════════════════
     0. 초기화
     ══════════════════════════════════════════════════════════════════════ */

  function init() {
    if (inited) return;
    inited = true;
    var m = U.store(STORE_KEY);
    muted = (m === true);
    // 첫 제스처를 잡아 둔다 (한 번만).
    var evts = ['pointerdown', 'touchend', 'keydown', 'mousedown'];
    var once = function () {
      for (var j = 0; j < evts.length; j++) {
        try { window.removeEventListener(evts[j], once, true); } catch (e) {}
      }
      unlock();
    };
    for (var i = 0; i < evts.length; i++) {
      window.addEventListener(evts[i], once, { passive: true, capture: true });
    }
    try {
      document.addEventListener('visibilitychange', function () {
        if (!ctx) return;
        if (document.hidden) suspend(); else resume();
      });
    } catch (e) { U.err(e); }
  }

  /** AudioContext 를 실제로 만든다. 반드시 사용자 제스처 이후에 불려야 함. */
  function ensure() {
    if (ctx) return true;
    if (started) return false;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { started = true; return false; }
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) { U.err(e); started = true; return false; }
    started = true;
    try {
      buildGraph();
      buildNoise();
      buildReverb();
      applyWant();
      if (!tickTimer) tickTimer = setInterval(tick, 220);
    } catch (e) { U.err(e); }
    return true;
  }

  function unlock() {
    if (!inited) init();
    if (!ensure()) return;
    if (renderMode) return;                   // OfflineAudioContext 는 resume 대상이 아니다
    if (ctx.state !== 'running') {
      try {
        var p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { U.err(e); }
    }
  }

  function buildGraph() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 14;
    comp.ratio.value = 3.6;
    comp.attack.value = 0.006;
    comp.release.value = 0.20;

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.07;

    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);

    busSfx = ctx.createGain(); busSfx.gain.value = 0.85; busSfx.connect(master);
    busBed = ctx.createGain(); busBed.gain.value = 0.70; busBed.connect(master);
    busAmb = ctx.createGain(); busAmb.gain.value = 0.55; busAmb.connect(master);

    curveSoft = shaperCurve(1.9);
    curveHard = shaperCurve(4.2);
    pulseWave = makePulseWave(5);
  }

  function shaperCurve(drive) {
    var n = 1024, c = new Float32Array(n), k = Math.tanh(drive) || 1;
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * drive) / k;
    }
    return c;
  }

  /** 코사인 하모닉 합 = 뾰족한 펄스열 (디젤 실린더 발화 LFO 용) */
  function makePulseWave(harm) {
    var n = harm + 1;
    var re = new Float32Array(n), im = new Float32Array(n);
    for (var i = 1; i < n; i++) { re[i] = 1 / Math.pow(i, 0.35); im[i] = 0; }
    try { return ctx.createPeriodicWave(re, im, { disableNormalization: false }); }
    catch (e) { return null; }
  }

  /* ── 노이즈 버퍼 (white / pink / brown) ────────────────────────────── */
  function buildNoise() {
    var sr = ctx.sampleRate;
    var r = U.rng('shunting:audio:noise');

    function buf(sec) { return ctx.createBuffer(1, Math.max(256, Math.floor(sr * sec)), sr); }

    var w = buf(2.0), dw = w.getChannelData(0), i;
    for (i = 0; i < dw.length; i++) dw[i] = r() * 2 - 1;

    // Paul Kellet 핑크 근사
    var p = buf(4.0), dp = p.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (i = 0; i < dp.length; i++) {
      var wn = r() * 2 - 1;
      b0 = 0.99886 * b0 + wn * 0.0555179;
      b1 = 0.99332 * b1 + wn * 0.0750759;
      b2 = 0.96900 * b2 + wn * 0.1538520;
      b3 = 0.86650 * b3 + wn * 0.3104856;
      b4 = 0.55000 * b4 + wn * 0.5329522;
      b5 = -0.7616 * b5 - wn * 0.0168980;
      dp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362) * 0.11;
      b6 = wn * 0.115926;
    }

    // 브라운 (적분 + 누설)
    var br = buf(4.0), db = br.getChannelData(0), last = 0;
    for (i = 0; i < db.length; i++) {
      last = (last + 0.021 * (r() * 2 - 1)) / 1.021;
      db[i] = last;
    }

    // DC 제거 + 정규화 — 안 하면 브라운/핑크 레벨이 시드에 따라 널뛴다.
    normalise(dp, 0.9, false);
    normalise(db, 0.9, true);

    noise = { white: w, pink: p, brown: br };
  }

  function normalise(d, peak, removeDC) {
    var i, mean = 0, mx = 0;
    if (removeDC) {
      for (i = 0; i < d.length; i++) mean += d[i];
      mean /= d.length;
      for (i = 0; i < d.length; i++) d[i] -= mean;
    }
    for (i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > mx) mx = a; }
    if (mx < 1e-6) return;
    var k = peak / mx;
    for (i = 0; i < d.length; i++) d[i] *= k;
  }

  /* ── 짧은 야외 리버브 IR (직접 합성) ──────────────────────────────── */
  function buildReverb() {
    revIn = ctx.createGain(); revIn.gain.value = 1;
    revOut = ctx.createGain(); revOut.gain.value = 0.5;
    revOut.connect(master);
    if (quality <= 0) return;                 // 저품질: 리버브 없음 (send 는 그냥 무시됨)

    var sr = ctx.sampleRate, sec = 1.15;
    var len = Math.floor(sr * sec);
    var b = ctx.createBuffer(2, len, sr);
    var r = U.rng('shunting:audio:ir');
    // 초기 반사 탭 (야외 — 밀도 낮게, 몇 개만)
    var taps = [0.011, 0.019, 0.031, 0.047, 0.068, 0.091];
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var e = Math.pow(1 - t, 2.6);
        var s = (r() * 2 - 1) * e * 0.55;
        lp += (s - lp) * 0.38;              // 살짝 어둡게
        d[i] = lp;
      }
      for (var k = 0; k < taps.length; k++) {
        var idx = Math.floor(taps[k] * sr * (1 + ch * 0.07));
        if (idx < len) d[idx] += (r() * 2 - 1) * 0.42 * (1 - k / taps.length);
      }
    }
    revNode = ctx.createConvolver();
    revNode.normalize = true;
    revNode.buffer = b;
    revIn.connect(revNode);
    revNode.connect(revOut);
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. 보이스 관리
     ══════════════════════════════════════════════════════════════════════ */

  function T() { return ctx.currentTime; }

  /**
   * 보이스 = 게인 하나 + 그 뒤에 붙는 (거리 로우패스 / 팬) 체인.
   * opts.pos + listener 가 있으면 수동 3D 감쇠를 건다.
   */
  function mkVoice(opts, bus, prio, send) {
    var v = {
      out: ctx.createGain(), nodes: [], srcs: [],
      t0: T(), end: T() + 0.2, prio: prio || 0, dead: false
    };
    var g = 1, tail = v.out;

    if (opts && opts.pos) {
      var sp = spatial(opts);
      g *= sp.gain;
      if (sp.cut < 16000) {
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = sp.cut; f.Q.value = 0.4;
        tail.connect(f); tail = f; v.nodes.push(f);
      }
      if (Math.abs(sp.pan) > 0.02 && ctx.createStereoPanner) {
        var pn = ctx.createStereoPanner();
        pn.pan.value = sp.pan;
        tail.connect(pn); tail = pn; v.nodes.push(pn);
      }
    } else if (opts && opts.pan != null && ctx.createStereoPanner) {
      var pn2 = ctx.createStereoPanner();
      pn2.pan.value = U.clamp(opts.pan, -1, 1);
      tail.connect(pn2); tail = pn2; v.nodes.push(pn2);
    }
    if (opts && opts.gain != null) g *= opts.gain;
    v.out.gain.value = g;

    tail.connect(bus || busSfx);
    if (send > 0 && revIn) {
      var s = ctx.createGain(); s.gain.value = send * (quality > 0 ? 1 : 0.35);
      tail.connect(s); s.connect(revIn); v.nodes.push(s);
    }
    v.tail = tail;
    sweep(v.t0);                    // 타이머 스로틀링에 의존하지 않는다
    voices.push(v);
    if (voices.length > MAXV) reclaim();
    return v;
  }

  /** 소스/오실레이터 등록 + 자동 정리 */
  function vSrc(v, node, t0, t1) {
    v.srcs.push(node);
    try { node.start(t0); } catch (e) { U.err(e); }
    if (t1 != null) { try { node.stop(t1); } catch (e) { U.err(e); } }
    node.onended = function () { try { node.disconnect(); } catch (e) {} };
    if (t1 != null && t1 > v.end) v.end = t1;
    return node;
  }

  function vKill(v) {
    if (v.dead) return;
    v.dead = true;
    var i;
    for (i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(); } catch (e) {} try { v.srcs[i].disconnect(); } catch (e) {} }
    for (i = 0; i < v.nodes.length; i++) { try { v.nodes[i].disconnect(); } catch (e) {} }
    try { v.out.disconnect(); } catch (e) {}
    var k = voices.indexOf(v);
    if (k >= 0) voices.splice(k, 1);
    k = dying.indexOf(v);
    if (k >= 0) dying.splice(k, 1);
  }

  /** 만료된 보이스 정리. 타이머와 mkVoice 양쪽에서 호출된다. */
  function sweep(t) {
    var i;
    for (i = voices.length - 1; i >= 0; i--) if (t > voices[i].end + 0.06) vKill(voices[i]);
    for (i = dying.length - 1; i >= 0; i--) if (t > dying[i].end) vKill(dying[i]);
  }

  /**
   * 상한 초과 시 회수. 우선순위가 낮고 오래된 것부터 30ms 페이드 후 폐기.
   * 회수 대상은 즉시 voices 에서 빼서 dying 으로 옮긴다 — 안 그러면
   * 같은 보이스를 반복 선택해 상한이 실제로 지켜지지 않는다.
   */
  function reclaim() {
    var t = T(), guard = 0;
    while (voices.length > MAXV && guard++ < 64) {
      var best = null, bi = -1;
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v.dead) continue;
        if (v.prio >= 9 && voices.length <= MAXV + 8) continue;   // 승리음 등은 최후에만
        if (!best || v.prio < best.prio || (v.prio === best.prio && v.t0 < best.t0)) { best = v; bi = i; }
      }
      if (!best) { best = voices[0]; bi = 0; }
      voices.splice(bi, 1);
      try {
        best.out.gain.cancelScheduledValues(t);
        best.out.gain.setValueAtTime(Math.max(EPS, best.out.gain.value), t);
        best.out.gain.exponentialRampToValueAtTime(EPS, t + 0.03);
      } catch (e) {}
      best.end = t + 0.05;
      dying.push(best);
    }
  }

  /* 주기 작업: 죽은 보이스 회수 · 새소리 스케줄 · 유휴 베드 정리 */
  function tick() {
    if (!ctx) return;
    var t = T();
    sweep(t);
    if (amb && amb.on && t >= amb.nextBird) scheduleBird(t);
    if (roller && roller.idleSince && t - roller.idleSince > 1.6) teardownRoll();
    if (eng && eng.offSince && t - eng.offSince > 1.4) teardownEngine();
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 3D 감쇠 (PannerNode 없이 수동)
     ══════════════════════════════════════════════════════════════════════ */

  function vecOf(o) {
    if (!o) return null;
    if (o.isVector3 || (o.x != null && o.y != null && o.z != null)) return o;
    if (o.position) return o.position;
    return null;
  }

  function setListener(o) { listenerRef = o || null; }

  function spatial(opts) {
    var p = vecOf(opts.pos);
    var l = vecOf(opts.listener) || vecOf(listenerRef);
    if (!p || !l) return { gain: 1, cut: 20000, pan: opts.pan || 0 };
    var dx = p.x - l.x, dy = p.y - l.y, dz = p.z - l.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // 카메라가 150~260 유닛 밖에 있는 미니어처 뷰라 근거리 기준을 크게 잡는다.
    var NEAR = 70, REF = 130;
    var over = Math.max(0, d - NEAR);
    var g = REF / (REF + over);
    g *= g * 0.5 + 0.5;                       // 살짝 더 가파르게
    var cut = U.lerp(16500, 2200, U.clamp01(over / 300));
    var pan = opts.pan != null ? opts.pan : U.clamp((p.x - l.x) / 75, -0.66, 0.66);
    return { gain: U.clamp(g, 0.05, 1), cut: cut, pan: pan };
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 합성 프리미티브
     ══════════════════════════════════════════════════════════════════════ */

  function nz(kind) {
    var s = ctx.createBufferSource();
    s.buffer = noise[kind || 'white'];
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = s.buffer.duration;
    return s;
  }

  /** 노이즈 버스트 → 병렬 밴드패스(금속 공진). bands = [{f,q,g,dec}] */
  function noiseBurst(v, t0, opts) {
    var src = nz(opts.kind || 'white');
    src.playbackRate.value = opts.rate || 1;
    // 버퍼 안 임의 지점에서 시작 → 같은 소리 반복 방지
    var off = rnd() * (src.buffer.duration - 0.3);
    var ex = ctx.createGain();
    ex.gain.setValueAtTime(EPS, t0);
    ex.gain.exponentialRampToValueAtTime(opts.exAmp == null ? 1 : opts.exAmp, t0 + (opts.atk || 0.001));
    ex.gain.exponentialRampToValueAtTime(EPS, t0 + (opts.exDec || 0.06));
    src.connect(ex);
    v.nodes.push(ex);

    /* 접촉 순간의 광대역 '딱'.
       밴드패스 Q 가 7~24 라 opts.bands 만으로는 감쇠 사인이 겹친 것에 가깝다 —
       즉 종소리처럼 들린다. 실제 타격은 공진이 울리기 전에 짧은 광대역 클릭이
       먼저 온다. 이게 없으면 '금속을 때렸다' 가 아니라 '신스가 울린다' 가 된다. */
    if (opts.click > 0) {
      var chp = ctx.createBiquadFilter();
      chp.type = 'highpass'; chp.frequency.value = opts.clickHp || 700; chp.Q.value = 0.6;
      var ck = ctx.createGain();
      ck.gain.setValueAtTime(EPS, t0);
      ck.gain.exponentialRampToValueAtTime(opts.click, t0 + 0.0014);
      ck.gain.exponentialRampToValueAtTime(EPS, t0 + (opts.clickDec || 0.007));
      ex.connect(chp); chp.connect(ck); ck.connect(v.out);
      v.nodes.push(chp, ck);
    }

    var bands = opts.bands, longest = 0;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = b.f;
      bp.Q.value = b.q;
      var bg = ctx.createGain();
      bg.gain.setValueAtTime(EPS, t0);
      bg.gain.exponentialRampToValueAtTime(b.g, t0 + 0.002);
      bg.gain.exponentialRampToValueAtTime(EPS, t0 + b.dec);
      ex.connect(bp); bp.connect(bg); bg.connect(v.out);
      v.nodes.push(bp, bg);
      if (b.dec > longest) longest = b.dec;
    }
    var stop = t0 + Math.max(longest, opts.exDec || 0.06) + 0.03;
    try { src.start(t0, off); } catch (e) { try { src.start(t0); } catch (e2) { U.err(e2); } }
    v.srcs.push(src);
    try { src.stop(stop); } catch (e) {}
    src.onended = function () { try { src.disconnect(); } catch (e) {} };
    if (stop > v.end) v.end = stop;
    return stop;
  }

  /**
   * 모달 링잉 — 감쇠 사인 파샬. 금속의 "댕—" 을 만드는 부분.
   * 각 파샬은 살짝 디튠된 쌍으로 만들어 맥놀이(beating)를 준다.
   */
  function modes(v, t0, list, amp, detune) {
    detune = detune == null ? 0.006 : detune;
    var last = t0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      for (var k = 0; k < 2; k++) {
        var f = m.f * (k ? 1 + detune * (0.6 + rnd() * 0.8) : 1);
        var a = m.a * amp * (k ? 0.55 : 1);
        if (a < 0.0015) continue;
        var o = ctx.createOscillator();
        o.type = m.type || 'sine';
        // 타격 직후 살짝 높다가 내려앉는다 — 두들긴 금속의 특징
        o.frequency.setValueAtTime(f * 1.028, t0);
        o.frequency.exponentialRampToValueAtTime(f, t0 + 0.035);
        var g = ctx.createGain();
        g.gain.setValueAtTime(EPS, t0);
        g.gain.exponentialRampToValueAtTime(a, t0 + 0.0012);
        g.gain.exponentialRampToValueAtTime(EPS, t0 + m.d);
        o.connect(g); g.connect(v.out);
        v.nodes.push(g);
        vSrc(v, o, t0, t0 + m.d + 0.02);
        if (t0 + m.d > last) last = t0 + m.d;
      }
    }
    return last;
  }

  /** 저역 '쿵' — 완충기/대차가 받는 충격 */
  function thump(v, t0, f, amp, dec) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.9, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(amp, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dec);
    o.connect(g); g.connect(v.out);
    v.nodes.push(g);
    vSrc(v, o, t0, t0 + dec + 0.02);
    return t0 + dec;
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 개별 효과음
     ══════════════════════════════════════════════════════════════════════ */

  /** 연결 충격 — 짧은 노이즈 버스트 + 3밴드 공진 + 모달 링 + 저역 쿵 */
  function sfxClank(opts) {
    var vel = U.clamp01(opts.vel == null ? 0.8 : opts.vel);
    var v = mkVoice(opts, busSfx, 3, 0.16);
    var t0 = T() + (opts.delay || 0);
    var p = 0.88 + rnd() * 0.30;                       // 개체 편차
    var A = 0.78 + vel * 0.71;

    // 저역을 깎고 중·고역 공진을 올린다 — 안 그러면 '쿵' 이지 '철컹' 이 아니다.
    noiseBurst(v, t0, {
      rate: 0.85 + rnd() * 0.4, exAmp: 0.9 * A, atk: 0.001, exDec: 0.050 + rnd() * 0.025,
      click: 0.62 * A, clickHp: 700, clickDec: 0.0075,
      bands: [
        { f: 340 * p, q: 11 + rnd() * 6, g: 0.24 * A, dec: 0.145 + rnd() * 0.05 },
        { f: 820 * p, q: 15 + rnd() * 8, g: 0.46 * A, dec: 0.155 + rnd() * 0.06 },
        { f: 1900 * p, q: 19 + rnd() * 10, g: 0.40 * A, dec: 0.115 + rnd() * 0.05 },
        { f: 3650 * p, q: 22 + rnd() * 12, g: 0.24 * A, dec: 0.075 + rnd() * 0.03 }
      ]
    });
    modes(v, t0, [
      { f: 340 * p, a: 0.15, d: 0.19 + rnd() * 0.04 },
      { f: 820 * p * (1 + rnd() * 0.02), a: 0.20, d: 0.20 },
      { f: 1900 * p * (1 - rnd() * 0.02), a: 0.15, d: 0.135 },
      { f: 3050 * p, a: 0.085, d: 0.090 },
      { f: 4620 * p * (1 + rnd() * 0.03), a: 0.040, d: 0.060 }
    ], A);
    thump(v, t0, 62 * (0.92 + rnd() * 0.16), 0.24 * A, 0.115 + rnd() * 0.03);
    v.end = t0 + 0.42;
    return v;
  }

  /** 연결(커플링) — clank 보다 무겁고 길게 + 뒤에 체인 짤랑임 */
  function sfxCouple(opts) {
    var vel = U.clamp01(opts.vel == null ? 0.9 : opts.vel);
    var v = mkVoice(opts, busSfx, 6, 0.22);
    var t0 = T() + (opts.delay || 0);
    var p = 0.72 + rnd() * 0.16;
    var A = 0.68 + vel * 0.60;

    noiseBurst(v, t0, {
      rate: 0.7 + rnd() * 0.25, exAmp: 1.0 * A, atk: 0.0015, exDec: 0.10,
      click: 0.62 * A, clickHp: 620, clickDec: 0.010,
      bands: [
        { f: 300 * p, q: 9 + rnd() * 5, g: 0.20 * A, dec: 0.34 },
        { f: 700 * p, q: 13 + rnd() * 6, g: 0.55 * A, dec: 0.30 },
        { f: 1620 * p, q: 17 + rnd() * 8, g: 0.52 * A, dec: 0.21 },
        { f: 3200 * p, q: 20 + rnd() * 10, g: 0.38 * A, dec: 0.13 }
      ]
    });
    modes(v, t0, [
      { f: 226 * p, a: 0.13, d: 0.36 },
      { f: 402 * p, a: 0.17, d: 0.34 },
      { f: 735 * p, a: 0.26, d: 0.33 },
      { f: 1610 * p, a: 0.20, d: 0.26 },
      { f: 2740 * p, a: 0.13, d: 0.16 },
      { f: 4180 * p, a: 0.07, d: 0.10 }
    ], A, 0.009);
    thump(v, t0, 52, 0.26 * A, 0.20);
    thump(v, t0 + 0.055, 74, 0.14 * A, 0.13);          // 2차 완충기 접촉

    // 체인 짤랑임 — 짧은 고역 노이즈 그레인 3~5개. 이게 들려야 '쇠사슬' 이 된다.
    var n = 3 + Math.floor(rnd() * 3);
    for (var i = 0; i < n; i++) {
      var tt = t0 + 0.09 + rnd() * 0.28;
      noiseBurst(v, tt, {
        rate: 1.1 + rnd() * 0.6, exAmp: 0.55 * A, atk: 0.001, exDec: 0.020,
        bands: [
          { f: 2600 + rnd() * 1600, q: 12 + rnd() * 10, g: 0.46 * A, dec: 0.05 + rnd() * 0.05 },
          { f: 4700 + rnd() * 2400, q: 14 + rnd() * 12, g: 0.30 * A, dec: 0.035 },
          { f: 7600 + rnd() * 2600, q: 16 + rnd() * 10, g: 0.14 * A, dec: 0.022 }
        ]
      });
    }
    v.end = t0 + 0.80;
    return v;
  }

  /** 제동 공기 — 하이패스 스윕 2k→6k + 끝에 밸브 '툭' */
  function sfxHiss(opts) {
    var v = mkVoice(opts, busSfx, 4, 0.10);
    var t0 = T() + (opts.delay || 0);
    var dur = 0.42 + rnd() * 0.22;
    var A = 0.115 * (opts.vel == null ? 1 : 0.5 + opts.vel * 0.7);

    // 압축공기는 '치---' 가 아니라 몸통이 있는 바람이다. 하이패스를 낮게 시작해
    // 600Hz~3kHz 몸통을 남기고, 위쪽은 로우패스로 잘라 테이프 히스처럼 안 들리게.
    var src = nz('white');
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.Q.value = 0.8;
    hp.frequency.setValueAtTime(430, t0);
    hp.frequency.exponentialRampToValueAtTime(2300, t0 + dur);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = 7800;
    var bp = ctx.createBiquadFilter();
    bp.type = 'peaking'; bp.frequency.value = 1750; bp.Q.value = 1.0; bp.gain.value = 7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(A, t0 + 0.018);
    g.gain.exponentialRampToValueAtTime(A * 0.5, t0 + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    src.connect(hp); hp.connect(lp); lp.connect(bp); bp.connect(g); g.connect(v.out);
    v.nodes.push(hp, lp, bp, g);
    vSrc(v, src, t0, t0 + dur + 0.02);

    // 밸브 '툭'
    var tv = t0 + dur - 0.01;
    thump(v, tv, 165, 0.12, 0.070);
    noiseBurst(v, tv, {
      rate: 0.8, exAmp: 0.16, atk: 0.001, exDec: 0.012,
      bands: [{ f: 620, q: 6, g: 0.13, dec: 0.06 }, { f: 1450, q: 9, g: 0.07, dec: 0.04 }]
    });
    v.end = t0 + dur + 0.15;
    return v;
  }

  /** 차륜 마찰 — 톱니 + 밴드패스 + 미세 비브라토. 아주 짧게. */
  function sfxSqueal(opts) {
    var sp = U.clamp01(opts.speed == null ? 0.5 : opts.speed);
    var v = mkVoice(opts, busSfx, 2, 0.14);
    var t0 = T() + (opts.delay || 0);
    var dur = 0.26 + rnd() * 0.26;
    var f = U.lerp(880, 1760, sp) * (0.9 + rnd() * 0.2);
    var A = 0.15 + sp * 0.10;

    var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    var o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    o2.frequency.value = f * 1.007; o2.detune.value = 7;
    // 미끄러지며 피치가 올라간다
    o.frequency.setValueAtTime(f * 0.93, t0);
    o.frequency.exponentialRampToValueAtTime(f * 1.06, t0 + dur);
    o2.frequency.setValueAtTime(f * 0.935, t0);
    o2.frequency.exponentialRampToValueAtTime(f * 1.072, t0 + dur);

    var vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.5 + rnd() * 3.5;
    var vibG = ctx.createGain(); vibG.gain.value = f * 0.012;
    vib.connect(vibG); vibG.connect(o.frequency); vibG.connect(o2.frequency);

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f * 1.9; bp.Q.value = 7;
    var bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = f * 3.4; bp2.Q.value = 11;
    var g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(A, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(A * 0.7, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);

    o.connect(bp); o2.connect(bp); bp.connect(g);
    o.connect(bp2); bp2.connect(g);
    g.connect(v.out);
    v.nodes.push(bp, bp2, g, vibG);
    vSrc(v, o, t0, t0 + dur + 0.02);
    vSrc(v, o2, t0, t0 + dur + 0.02);
    vSrc(v, vib, t0, t0 + dur + 0.02);

    // 마찰 잡음 — 이게 없으면 톱니 두 개짜리 신스 리드가 된다.
    // 강모래를 비비는 듯한 광대역 성분을 공진 위에 얹는다.
    var nsrc = nz('white');
    nsrc.playbackRate.value = 0.9 + rnd() * 0.35;
    var nb = ctx.createBiquadFilter();
    nb.type = 'bandpass'; nb.Q.value = 2.2;
    nb.frequency.setValueAtTime(f * 1.5, t0);
    nb.frequency.exponentialRampToValueAtTime(f * 2.4, t0 + dur);
    var nb2 = ctx.createBiquadFilter();
    nb2.type = 'bandpass'; nb2.frequency.value = f * 0.55; nb2.Q.value = 1.6;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(EPS, t0);
    ng.gain.exponentialRampToValueAtTime(A * 0.62, t0 + 0.03);
    ng.gain.exponentialRampToValueAtTime(A * 0.30, t0 + dur * 0.7);
    ng.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    nsrc.connect(nb); nb.connect(ng);
    nsrc.connect(nb2); nb2.connect(ng);
    ng.connect(v.out);
    v.nodes.push(nb, nb2, ng);
    vSrc(v, nsrc, t0, t0 + dur + 0.02);

    v.end = t0 + dur + 0.1;
    return v;
  }

  /** 분기기 전환 — 묵직한 '철컹' 2단 (레버 + 블레이드 착지) */
  function sfxPoints(opts) {
    var v = mkVoice(opts, busSfx, 5, 0.18);
    var t0 = T() + (opts.delay || 0);
    var A = 0.30;                 // 0.76 은 단독 peak 0.82 로 리미터를 때렸다

    // 1단: 레버 — 둔탁하고 나무/무쇠 섞인 소리
    noiseBurst(v, t0, {
      rate: 0.75, exAmp: 0.95 * A, atk: 0.001, exDec: 0.05,
      click: 1.70 * A, clickHp: 620, clickDec: 0.011,
      bands: [
        { f: 190, q: 8, g: 0.5 * A, dec: 0.20 },
        { f: 470, q: 11, g: 0.32 * A, dec: 0.15 },
        { f: 1050, q: 14, g: 0.16 * A, dec: 0.09 }
      ]
    });
    modes(v, t0, [{ f: 188, a: 0.26, d: 0.22 }, { f: 466, a: 0.14, d: 0.16 }], A);
    thump(v, t0, 58, 0.36 * A, 0.15);

    // 2단: 블레이드 착지 — 더 밝고 금속적
    var t1 = t0 + 0.125 + rnd() * 0.035;
    noiseBurst(v, t1, {
      rate: 1.0, exAmp: 0.85 * A, atk: 0.001, exDec: 0.05,
      click: 1.05 * A, clickHp: 950, clickDec: 0.0060,
      bands: [
        { f: 360, q: 13, g: 0.52 * A, dec: 0.30 },
        { f: 880, q: 18, g: 0.46 * A, dec: 0.24 },
        { f: 2050, q: 22, g: 0.34 * A, dec: 0.14 },
        { f: 3900, q: 24, g: 0.20 * A, dec: 0.085 }
      ]
    });
    modes(v, t1, [
      { f: 358, a: 0.24, d: 0.34 },
      { f: 884, a: 0.18, d: 0.25 },
      { f: 2080, a: 0.11, d: 0.15 },
      { f: 3540, a: 0.05, d: 0.09 }
    ], A * 1.05);
    thump(v, t1, 70, 0.34 * A, 0.18);
    v.end = t1 + 0.55;
    return v;
  }

  /** 경적 — 3화음 사각/톱니 + 어택 램프 + 리버브 테일 */
  function sfxHorn(opts) {
    var v = mkVoice(opts, busSfx, 8, 0.42);
    var t0 = T() + (opts.delay || 0);
    var len = opts.len || 0.85;
    var A = (opts.gainMul == null ? 1 : opts.gainMul) * 0.42;
    var freqs = [311.1, 370.0, 466.2];
    var det = [-6, 4, -3];

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(2500, t0 + 0.13);
    lp.frequency.exponentialRampToValueAtTime(1700, t0 + len);
    var ws = ctx.createWaveShaper(); ws.curve = curveSoft; ws.oversample = '2x';
    var g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(A, t0 + 0.075);       // 램프 어택
    g.gain.setValueAtTime(A, t0 + len - 0.22);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + len);
    lp.connect(ws); ws.connect(g); g.connect(v.out);
    v.nodes.push(lp, ws, g);

    for (var i = 0; i < freqs.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ctx.createOscillator();
        o.type = k ? 'square' : 'sawtooth';
        o.frequency.value = freqs[i];
        o.detune.value = det[i] + (k ? 5.5 : -2.5) + (rnd() * 3 - 1.5);
        var og = ctx.createGain();
        og.gain.value = (k ? 0.30 : 0.55) / freqs.length;
        // 시작할 때 살짝 아래에서 붙는다 (공기가 밀려나오는 느낌)
        o.frequency.setValueAtTime(freqs[i] * 0.975, t0);
        o.frequency.exponentialRampToValueAtTime(freqs[i], t0 + 0.09);
        o.connect(og); og.connect(lp);
        v.nodes.push(og);
        vSrc(v, o, t0, t0 + len + 0.03);
      }
    }
    // 공기 노이즈 살짝
    var src = nz('pink');
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(EPS, t0);
    ng.gain.exponentialRampToValueAtTime(A * 0.14, t0 + 0.05);
    ng.gain.exponentialRampToValueAtTime(EPS, t0 + len);
    src.connect(hp); hp.connect(ng); ng.connect(v.out);
    v.nodes.push(hp, ng);
    vSrc(v, src, t0, t0 + len + 0.02);
    v.end = t0 + len + 0.9;                                    // 리버브 테일
    return v;
  }

  /** UI — 아주 짧고 부드러운 나무 두드림.
      UI 는 야드 공간이 아니라 인터페이스 소리다 → 리버브 센드 0 (꼬리 없음). */
  function sfxUi(opts) {
    var v = mkVoice(opts, busSfx, 1, 0);
    var t0 = T() + (opts.delay || 0);
    var f = (opts.freq || 560) * (opts.rate || 1);
    var A = 1.08;                       // 측정 기준: 단독 peak ≈ 0.11
    modes(v, t0, [
      { f: f, a: 0.42, d: 0.070 },
      { f: f * 2.61, a: 0.17, d: 0.042 },
      { f: f * 4.8, a: 0.06, d: 0.026 }
    ], A, 0.004);
    // 손끝이 나무에 닿는 순간의 잡음 — 없으면 순수 사인 '삑' 이 된다
    noiseBurst(v, t0, {
      rate: 1.2, exAmp: 1.10 * A, atk: 0.0006, exDec: 0.009,
      click: 1.95 * A, clickHp: 760, clickDec: 0.0048,
      bands: [
        { f: f * 3.2, q: 4.5, g: 0.16 * A, dec: 0.022 },
        { f: f * 7.0, q: 6, g: 0.07 * A, dec: 0.012 }
      ]
    });
    v.end = t0 + 0.14;
    return v;
  }

  /**
   * 실패 — 죽은 쇳덩이를 두 번 때린 듯한 하강 '텅-텅'.
   * (순수 사인 2음이면 신스 효과음이 된다. 감쇠 강한 공진 + 타격 잡음을 섞는다.)
   */
  function sfxFail(opts) {
    var v = mkVoice(opts, busSfx, 7, 0.14);
    var t0 = T() + (opts.delay || 0);
    var A = 0.35;

    function hit(t, p, amp) {
      noiseBurst(v, t, {
        rate: 0.65, exAmp: 0.85 * amp, atk: 0.0012, exDec: 0.045,
        click: 1.25 * amp, clickHp: 700, clickDec: 0.010,
        bands: [
          { f: 196 * p, q: 7, g: 0.50 * amp, dec: 0.24 },
          { f: 470 * p, q: 9, g: 0.50 * amp, dec: 0.18 },
          { f: 1020 * p, q: 11, g: 0.34 * amp, dec: 0.11 },
          { f: 2150 * p, q: 13, g: 0.16 * amp, dec: 0.060 }
        ]
      });
      // 감쇠가 빠른 파샬 = 울리지 않는 둔한 금속
      modes(v, t, [
        { f: 196 * p, a: 0.26, d: 0.24 },
        { f: 293 * p, a: 0.17, d: 0.19 },
        { f: 466 * p, a: 0.13, d: 0.13 },
        { f: 830 * p, a: 0.06, d: 0.085 }
      ], amp, 0.012);
      thump(v, t, 56 * p, 0.24 * amp, 0.15);
    }

    hit(t0, 1.0, A);
    hit(t0 + 0.155, 0.79, A * 0.92);      // 단3도 아래로 — 명확히 '아니오'
    v.end = t0 + 0.70;
    return v;
  }

  /** 승리 — 경적 + 종 + 상승 3음. 과하지 않게, 따뜻하게. */
  function sfxWin(opts) {
    var t0 = T() + (opts.delay || 0);
    sfxHorn({ delay: (opts.delay || 0), len: 1.05, gainMul: 0.75, pos: opts.pos, listener: opts.listener });

    var v = mkVoice(opts, busSfx, 9, 0.5);
    // 종 (비조화 파샬)
    var bell = [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011];
    var bAmp = [0.34, 0.42, 0.22, 0.15, 0.13, 0.07, 0.05, 0.035];
    var bDec = [2.2, 1.9, 1.35, 1.05, 0.85, 0.6, 0.5, 0.38];
    var base = 523.25;
    var ml = [], i;
    for (i = 0; i < bell.length; i++) ml.push({ f: base * bell[i], a: bAmp[i], d: bDec[i] });
    modes(v, t0 + 0.28, ml, 0.16, 0.003);

    // 상승 3음 (따뜻한 삼각파 + 살짝 톱니)
    var notes = [392.0, 523.25, 659.25];
    for (i = 0; i < notes.length; i++) {
      var tt = t0 + 0.10 + i * 0.16;
      var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = notes[i];
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = notes[i]; o2.detune.value = 6;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = notes[i] * 5; lp.Q.value = 0.6;
      var g = ctx.createGain();
      g.gain.setValueAtTime(EPS, tt);
      g.gain.exponentialRampToValueAtTime(0.11, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(EPS, tt + 0.55);
      var g2 = ctx.createGain(); g2.gain.value = 0.28;
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(v.out);
      v.nodes.push(lp, g, g2);
      vSrc(v, o, tt, tt + 0.6);
      vSrc(v, o2, tt, tt + 0.6);
    }
    v.end = t0 + 3.0;
    return v;
  }

  var SFX = {
    clank: sfxClank, couple: sfxCouple, hiss: sfxHiss, squeal: sfxSqueal,
    points: sfxPoints, horn: sfxHorn, ui: sfxUi, win: sfxWin, fail: sfxFail
  };
  var ALIAS = { click: 'ui', tap: 'ui', error: 'fail', brake: 'hiss', impact: 'clank', bump: 'clank' };

  function play(name, opts) {
    if (!inited) init();
    if (!ensure() || !ctx) return null;
    if (!renderMode && ctx.state === 'suspended') unlock();
    if (muted) return null;                    // 노드 낭비 방지
    opts = opts || {};
    name = ALIAS[name] || name;
    var fn = SFX[name];
    if (!fn) return null;
    var t = T(), gap = THROTTLE[name] || 0.03;
    if (lastAt[name] != null && t - lastAt[name] < gap && !opts.force) return null;
    lastAt[name] = t;
    try { return fn(opts); } catch (e) { U.err(e); return null; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 디젤 엔진
     ══════════════════════════════════════════════════════════════════════ */

  var eng = null;

  /* 실린더 파샬 비. 기본파에만 저역이 몰리면 폰 스피커에서 엔진이 안 들린다.
     buildEngine 과 engine() 이 반드시 같은 배열을 봐야 한다 — 따로 두면
     오실레이터 수와 비율 수가 어긋나 setTargetAtTime 이 NaN 을 받는다. */
  var ENG_RATIOS = [1, 1.5, 2, 3];

  function buildEngine() {
    var t = T();
    var e = {
      oscs: [], gains: [], offSince: 0,
      out: ctx.createGain(),
      lp: ctx.createBiquadFilter(),
      ws: ctx.createWaveShaper(),
      am: ctx.createGain(),
      lfo: ctx.createOscillator(),
      lfoG: ctx.createGain(),
      rumSrc: nz('brown'),
      rumLp: ctx.createBiquadFilter(),
      rumG: ctx.createGain(),
      cmbSrc: nz('pink'),
      cmbBp: ctx.createBiquadFilter(),
      cmbG: ctx.createGain(),
      mix: ctx.createGain()
    };
    e.out.gain.value = EPS;
    e.lp.type = 'lowpass'; e.lp.frequency.value = 420; e.lp.Q.value = 1.15;
    e.ws.curve = curveHard; e.ws.oversample = '2x';

    // 실린더 발화 리듬 — 뾰족한 펄스 LFO 로 진폭 변조
    if (pulseWave) e.lfo.setPeriodicWave(pulseWave); else e.lfo.type = 'sawtooth';
    e.lfo.frequency.value = 9;
    e.lfoG.gain.value = 0.44;
    e.am.gain.value = 0.58;
    e.lfo.connect(e.lfoG); e.lfoG.connect(e.am.gain);

    var ratios = ENG_RATIOS;
    var amps = [0.40, 0.32, 0.26, 0.15];
    var dets = [-7, 6, -4, 9];
    for (var i = 0; i < ratios.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 58 * ratios[i];
      o.detune.value = dets[i];
      var g = ctx.createGain(); g.gain.value = amps[i];
      o.connect(g); g.connect(e.lp);
      e.oscs.push(o); e.gains.push(g);
    }
    e.lp.connect(e.ws); e.ws.connect(e.am); e.am.connect(e.mix);

    // 연소 잡음 — 톱니 스택만으로는 '드론' 이지 디젤이 아니다.
    // 발화 리듬(am)을 같이 타는 중역 잡음이 있어야 배기음처럼 들린다.
    e.cmbBp.type = 'bandpass'; e.cmbBp.frequency.value = 420; e.cmbBp.Q.value = 0.8;
    e.cmbG.gain.value = 0.8;
    e.cmbSrc.connect(e.cmbBp); e.cmbBp.connect(e.cmbG); e.cmbG.connect(e.am);

    // 낮은 럼블 — 이것도 am 을 태워야 엔진 전체가 같이 고동친다
    e.rumLp.type = 'lowpass'; e.rumLp.frequency.value = 110; e.rumLp.Q.value = 0.8;
    e.rumG.gain.value = 0.26;
    e.rumSrc.connect(e.rumLp); e.rumLp.connect(e.rumG); e.rumG.connect(e.am);

    e.mix.gain.value = 0.85;
    e.mix.connect(e.out);
    e.out.connect(busBed);

    for (i = 0; i < e.oscs.length; i++) { try { e.oscs[i].start(t); } catch (er) { U.err(er); } }
    try { e.lfo.start(t); } catch (er2) { U.err(er2); }
    try { e.rumSrc.start(t, rnd() * 2); } catch (er3) { try { e.rumSrc.start(t); } catch (er4) { U.err(er4); } }
    try { e.cmbSrc.start(t, rnd() * 3); } catch (er5) { try { e.cmbSrc.start(t); } catch (er6) { U.err(er6); } }
    eng = e;
  }

  function teardownEngine() {
    if (!eng) return;
    var e = eng; eng = null;
    var i;
    for (i = 0; i < e.oscs.length; i++) { try { e.oscs[i].stop(); } catch (er) {} try { e.oscs[i].disconnect(); } catch (er) {} }
    try { e.lfo.stop(); } catch (er) {} try { e.lfo.disconnect(); } catch (er) {}
    try { e.rumSrc.stop(); } catch (er) {} try { e.rumSrc.disconnect(); } catch (er) {}
    try { e.cmbSrc.stop(); } catch (er) {} try { e.cmbSrc.disconnect(); } catch (er) {}
    var nodes = [e.lp, e.ws, e.am, e.lfoG, e.rumLp, e.rumG, e.cmbBp, e.cmbG, e.mix, e.out];
    for (i = 0; i < e.gains.length; i++) nodes.push(e.gains[i]);
    for (i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (er) {} }
  }

  function engine(on, load) {
    want.engOn = !!on;
    want.engLoad = U.clamp01(load == null ? 0 : load);
    if (!ctx) return;
    if (!on && !eng) return;
    if (!eng) buildEngine();
    if (!eng) return;

    var t = T(), L = want.engLoad, TC = 0.20 * tcScale;   // ≈0.6s 램프
    var e = eng;

    if (on) {
      e.offSince = 0;
      var f0 = U.lerp(56, 104, L);
      for (var i = 0; i < e.oscs.length; i++) {
        e.oscs[i].frequency.setTargetAtTime(f0 * ENG_RATIOS[i], t, TC);
      }
      e.lp.frequency.setTargetAtTime(U.lerp(430, 2400, L * L * 0.4 + L * 0.6), t, TC);
      e.lfo.frequency.setTargetAtTime(U.lerp(8.5, 14.5, L), t, TC);
      e.lfoG.gain.setTargetAtTime(U.lerp(0.50, 0.36, L), t, TC);
      e.am.gain.setTargetAtTime(U.lerp(0.54, 0.66, L), t, TC);
      e.rumLp.frequency.setTargetAtTime(U.lerp(95, 175, L), t, TC);
      e.rumG.gain.setTargetAtTime(U.lerp(0.26, 0.55, L), t, TC);
      e.cmbBp.frequency.setTargetAtTime(U.lerp(420, 1150, L), t, TC);
      e.cmbBp.Q.setTargetAtTime(U.lerp(0.8, 0.5, L), t, TC);
      e.cmbG.gain.setTargetAtTime(U.lerp(0.80, 1.45, L), t, TC);
      e.out.gain.setTargetAtTime(U.lerp(0.095, 0.195, L), t, TC);
    } else {
      e.out.gain.setTargetAtTime(EPS, t, 0.18 * tcScale);
      e.offSince = t;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. 차륜 럼블 (roll)
     ══════════════════════════════════════════════════════════════════════ */

  var roller = null;
  /* 속도 정규화. 호출자(60-motion / 90-game)가 넘기는 값의 스케일이 통일돼 있지 않다
     — Motion 은 curSpeed/45 로 정규화하고 Game 은 speed/5.5 를 쓴다. 그래서 하드
     상한 대신 소프트 니를 쓴다: 어떤 스케일이 와도 포화하지 않고 계속 변한다.
       s=1→0.12  s=3→0.32  s=6→0.53  s=9→0.69  s=15→0.89  s≥24→1 */
  var ROLL_K = 12;
  function rollNorm(s) { return U.clamp01(1.6 * s / (s + ROLL_K)); }

  function buildRoll() {
    var t = T();
    var r = {
      src: nz('pink'), lp: ctx.createBiquadFilter(), hp: ctx.createBiquadFilter(),
      pre: ctx.createGain(), dly: ctx.createDelay(0.05), fb: ctx.createGain(),
      combMix: ctx.createGain(), jointLfo: ctx.createOscillator(), jointG: ctx.createGain(),
      am: ctx.createGain(), out: ctx.createGain(), idleSince: 0
    };
    r.lp.type = 'lowpass'; r.lp.frequency.value = 420; r.lp.Q.value = 0.75;
    r.hp.type = 'highpass'; r.hp.frequency.value = 55; r.hp.Q.value = 0.5;
    r.pre.gain.value = 1;

    // 짧은 콤 — 레일 이음매/차륜 공진의 반복감
    r.dly.delayTime.value = 0.0125;
    r.fb.gain.value = 0.55;
    r.combMix.gain.value = 0.45;

    // 느린 이음매 흔들림
    r.jointLfo.type = 'sine'; r.jointLfo.frequency.value = 1.2;
    r.jointG.gain.value = 0.13;
    r.am.gain.value = 0.87;
    r.jointLfo.connect(r.jointG); r.jointG.connect(r.am.gain);

    r.src.connect(r.hp); r.hp.connect(r.lp); r.lp.connect(r.pre);
    r.pre.connect(r.am);
    r.pre.connect(r.dly); r.dly.connect(r.fb); r.fb.connect(r.dly);
    r.dly.connect(r.combMix); r.combMix.connect(r.am);
    r.am.connect(r.out);
    r.out.gain.value = EPS;
    r.out.connect(busBed);

    try { r.src.start(t, rnd() * 2); } catch (e) { try { r.src.start(t); } catch (e2) { U.err(e2); } }
    try { r.jointLfo.start(t); } catch (e3) { U.err(e3); }
    roller = r;
  }

  function teardownRoll() {
    if (!roller) return;
    var r = roller; roller = null;
    try { r.src.stop(); } catch (e) {}
    try { r.jointLfo.stop(); } catch (e) {}
    var nodes = [r.src, r.lp, r.hp, r.pre, r.dly, r.fb, r.combMix, r.jointLfo, r.jointG, r.am, r.out];
    for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) {} }
  }

  function roll(speed) {
    var s = Math.abs(speed || 0);
    want.roll = s;
    if (!ctx) return;
    if (s < 0.02 && !roller) return;
    if (!roller) buildRoll();
    if (!roller) return;

    var t = T(), r = roller;
    var n = rollNorm(s);
    if (s < 0.02) {
      r.out.gain.setTargetAtTime(EPS, t, 0.12 * tcScale);
      if (!r.idleSince) r.idleSince = t;
      return;
    }
    r.idleSince = 0;
    var TC = 0.10 * tcScale;
    r.lp.frequency.setTargetAtTime(U.lerp(430, 3400, n * n * 0.55 + n * 0.45), t, TC);
    r.hp.frequency.setTargetAtTime(U.lerp(48, 105, n), t, TC);
    r.dly.delayTime.setTargetAtTime(U.lerp(0.0165, 0.0072, n), t, TC);
    r.fb.gain.setTargetAtTime(U.lerp(0.42, 0.62, n), t, TC);
    r.jointLfo.frequency.setTargetAtTime(U.clamp(0.55 + s * 0.42, 0.4, 9), t, TC);
    r.jointG.gain.setTargetAtTime(U.lerp(0.17, 0.07, n), t, TC);
    r.out.gain.setTargetAtTime(U.lerp(0.028, 0.150, Math.pow(n, 0.8)), t, TC);
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 앰비언스 (바람 + 새)
     ══════════════════════════════════════════════════════════════════════ */

  var amb = null;

  function buildAmbience() {
    var t = T();
    var a = {
      on: false, nextBird: t + 4,
      src: nz('brown'), lp: ctx.createBiquadFilter(), hp: ctx.createBiquadFilter(),
      lfo: ctx.createOscillator(), lfoG: ctx.createGain(),
      lfo2: ctx.createOscillator(), lfo2G: ctx.createGain(),
      airSrc: nz('pink'), airHp: ctx.createBiquadFilter(),
      airLp: ctx.createBiquadFilter(), airG: ctx.createGain(),
      lowG: ctx.createGain(), am: ctx.createGain(), out: ctx.createGain()
    };
    a.lp.type = 'lowpass'; a.lp.frequency.value = 380; a.lp.Q.value = 0.6;
    a.hp.type = 'highpass'; a.hp.frequency.value = 38; a.hp.Q.value = 0.5;

    a.lfo.type = 'sine'; a.lfo.frequency.value = 0.063;   // 컷오프 흔들림
    a.lfoG.gain.value = 150;
    a.lfo.connect(a.lfoG); a.lfoG.connect(a.lp.frequency);

    a.lfo2.type = 'sine'; a.lfo2.frequency.value = 0.041; // 세기 흔들림
    a.lfo2G.gain.value = 0.30;
    a.am.gain.value = 0.7;
    a.lfo2.connect(a.lfo2G); a.lfo2G.connect(a.am.gain);

    a.lowG.gain.value = 0.62;
    a.src.connect(a.hp); a.hp.connect(a.lp); a.lp.connect(a.lowG); a.lowG.connect(a.am);

    // 저역 럼블만으로는 '야외' 가 아니라 그냥 저주파 소음이다.
    // 나뭇잎/풀을 스치는 옅은 중고역 바람을 같은 LFO 로 흔들어 얹는다.
    a.airHp.type = 'highpass'; a.airHp.frequency.value = 700; a.airHp.Q.value = 0.5;
    a.airLp.type = 'lowpass'; a.airLp.frequency.value = 5200; a.airLp.Q.value = 0.5;
    a.airG.gain.value = 0.72;
    a.lfoG.connect(a.airLp.frequency);            // 컷오프도 같이 흔들린다
    a.airSrc.connect(a.airHp); a.airHp.connect(a.airLp);
    a.airLp.connect(a.airG); a.airG.connect(a.am);

    a.am.connect(a.out);
    a.out.gain.value = EPS;
    a.out.connect(busAmb);

    try { a.src.start(t, rnd() * 2); } catch (e) { try { a.src.start(t); } catch (e2) { U.err(e2); } }
    try { a.airSrc.start(t, rnd() * 3); } catch (e4) { try { a.airSrc.start(t); } catch (e5) { U.err(e5); } }
    try { a.lfo.start(t); a.lfo2.start(t); } catch (e3) { U.err(e3); }
    amb = a;
  }

  function ambience(on) {
    want.amb = !!on;
    if (!ctx) return;
    if (!on && !amb) return;
    if (!amb) buildAmbience();
    if (!amb) return;
    amb.on = !!on;
    var t = T();
    amb.out.gain.setTargetAtTime(on ? 0.115 : EPS, t, (on ? 1.6 : 0.7) * tcScale);
    if (on) amb.nextBird = t + 3 + rnd() * 6;
  }

  /** 새소리 — 짧은 FM 처프 2~3음. 배경에만 있어야 한다. */
  function scheduleBird(t) {
    amb.nextBird = t + 8 + rnd() * 12;
    if (muted) return;
    var v = mkVoice({ pan: (rnd() * 2 - 1) * 0.6 }, busAmb, 0, 0.6);
    var n = 2 + Math.floor(rnd() * 2);
    var base = 2500 + rnd() * 1300;
    var t0 = t + 0.12;
    for (var i = 0; i < n; i++) {
      var tt = t0 + i * (0.085 + rnd() * 0.075);
      var dur = 0.055 + rnd() * 0.045;
      var f = base * (1 + (rnd() - 0.5) * 0.25);

      var car = ctx.createOscillator(); car.type = 'sine';
      car.frequency.setValueAtTime(f * 0.82, tt);
      car.frequency.exponentialRampToValueAtTime(f * 1.18, tt + dur * 0.45);
      car.frequency.exponentialRampToValueAtTime(f * 0.94, tt + dur);

      var mod = ctx.createOscillator(); mod.type = 'sine';
      mod.frequency.value = f * (1.4 + rnd() * 0.9);
      var modG = ctx.createGain(); modG.gain.value = f * (0.18 + rnd() * 0.22);
      mod.connect(modG); modG.connect(car.frequency);

      var g = ctx.createGain();
      g.gain.setValueAtTime(EPS, tt);
      g.gain.exponentialRampToValueAtTime(0.10, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(EPS, tt + dur);
      car.connect(g); g.connect(v.out);
      v.nodes.push(g, modG);
      vSrc(v, car, tt, tt + dur + 0.02);
      vSrc(v, mod, tt, tt + dur + 0.02);
    }
    v.end = t0 + 0.9;
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 마스터 제어
     ══════════════════════════════════════════════════════════════════════ */

  function applyWant() {
    if (want.engOn) engine(true, want.engLoad);
    if (want.roll > 0.02) roll(want.roll);
    if (want.amb) ambience(true);
  }

  function applyMasterGain(fast) {
    if (!master) return;
    var t = T();
    var g = muted ? EPS : Math.max(EPS, volume);
    try {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(EPS, master.gain.value), t);
      master.gain.exponentialRampToValueAtTime(g, t + (fast ? 0.03 : 0.09));
    } catch (e) { master.gain.value = muted ? 0 : volume; }
  }

  function mute(b) {
    muted = (b === undefined || b === null) ? !muted : !!b;
    U.store(STORE_KEY, muted);
    applyMasterGain(false);
    try { SH.Bus.emit('audio:mute', muted); } catch (e) {}
    return muted;
  }
  function isMuted() { return muted; }

  function setVolume(v) {
    volume = U.clamp01(v == null ? 1 : v);
    applyMasterGain(false);
    return volume;
  }

  function setQuality(q) {
    quality = U.clamp(q | 0, 0, 2);
    if (revOut) revOut.gain.value = quality > 0 ? 0.5 : 0.18;
  }

  function suspend() {
    if (!ctx || ctx.state === 'suspended') return;
    try { var p = ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function resume() {
    if (!ctx || ctx.state === 'running') return;
    try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  function dispose() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; }
    for (var i = voices.length - 1; i >= 0; i--) vKill(voices[i]);
    for (i = dying.length - 1; i >= 0; i--) vKill(dying[i]);
    voices.length = 0; dying.length = 0;
    teardownEngine();
    teardownRoll();
    if (amb) {
      try { amb.src.stop(); amb.lfo.stop(); amb.lfo2.stop(); } catch (e) {}
      try { amb.airSrc.stop(); } catch (e) {}
      var an = [amb.src, amb.lp, amb.hp, amb.lfo, amb.lfoG, amb.lfo2, amb.lfo2G,
                amb.airSrc, amb.airHp, amb.airLp, amb.airG, amb.lowG, amb.am, amb.out];
      for (i = 0; i < an.length; i++) { try { an[i].disconnect(); } catch (e) {} }
      amb = null;
    }
    if (ctx) { try { var p = ctx.close(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
    ctx = null; started = false; master = null;
  }

  /* update(dt) 는 필요 없지만(내부 타이머로 자체 구동) 호출돼도 안전하게 둔다. */
  function update() { }

  /* ══════════════════════════════════════════════════════════════════════
     9. 오프라인 렌더 훅 — 소리를 "측정 가능"하게 만드는 부분
     ----------------------------------------------------------------------
     합성 코드는 전부 모듈 스코프의 ctx / 버스 / 노이즈 버퍼를 통해 그래프를
     만든다. 그래서 오프라인 렌더는 그 바인딩 전체를 넘어온 OfflineAudioContext
     로 바꿔 끼우고(스케줄은 전부 동기 실행이라 중간에 아무도 끼어들 수 없다)
     끝나면 원래 실시간 바인딩을 되돌리는 방식으로 구현한다.
     → 새 AudioContext 를 만들지 않는다. 모든 노드는 인자로 받은 oc 소속이다.
     ══════════════════════════════════════════════════════════════════════ */

  var RENDER_ALIAS = { amb: 'ambience', bed: 'ambience', diesel: 'engine', rumble: 'roll' };

  function snapState() {
    return {
      ctx: ctx, master: master, comp: comp, limiter: limiter,
      busSfx: busSfx, busBed: busBed, busAmb: busAmb,
      revIn: revIn, revNode: revNode, revOut: revOut,
      noise: noise, curveSoft: curveSoft, curveHard: curveHard, pulseWave: pulseWave,
      voices: voices, dying: dying, lastAt: lastAt, rnd: rnd,
      eng: eng, roller: roller, amb: amb,
      started: started, want: want, tcScale: tcScale
    };
  }

  function useState(s) {
    ctx = s.ctx; master = s.master; comp = s.comp; limiter = s.limiter;
    busSfx = s.busSfx; busBed = s.busBed; busAmb = s.busAmb;
    revIn = s.revIn; revNode = s.revNode; revOut = s.revOut;
    noise = s.noise; curveSoft = s.curveSoft; curveHard = s.curveHard; pulseWave = s.pulseWave;
    voices = s.voices; dying = s.dying; lastAt = s.lastAt; rnd = s.rnd;
    eng = s.eng; roller = s.roller; amb = s.amb;
    started = s.started; want = s.want; tcScale = s.tcScale;
  }

  /** 모듈 전체를 oc 에 바인딩하고 새 그래프를 세운다. */
  function bindRender(oc, opts) {
    ctx = oc;
    master = comp = limiter = null;
    busSfx = busBed = busAmb = null;
    revIn = revNode = revOut = null;
    noise = null; curveSoft = curveHard = null; pulseWave = null;
    eng = null; roller = null; amb = null;
    voices = []; dying = []; lastAt = Object.create(null);
    want = { engOn: false, engLoad: 0, roll: 0, amb: false };
    // 렌더는 재현 가능해야 한다 — 같은 인자면 같은 파형.
    rnd = U.rng(opts.seed == null ? 'shunting:audio:offline' : String(opts.seed));
    // 지속음이 2초짜리 렌더 안에서 정상 상태에 도달하도록 램프를 압축한다.
    tcScale = opts.tc == null ? 0.02 : Math.max(1e-4, opts.tc);
    started = true;
    buildGraph();
    buildNoise();
    buildReverb();
  }

  function scheduleRender(name, opts) {
    var key = RENDER_ALIAS[name] || ALIAS[name] || name;
    var made = false, i, n;

    if (key === 'engine') {
      engine(true, opts.load == null ? 0.5 : opts.load);
      made = !!eng;
    } else if (key === 'roll') {
      roll(opts.speed == null ? 4 : opts.speed);
      made = !!roller;
    } else if (key === 'ambience') {
      ambience(true);
      made = !!amb;
      if (opts.bird && amb && !muted) scheduleBird(T() + 0.05);
    } else if (key === 'bird') {
      if (!amb) buildAmbience();
      if (amb) {
        amb.on = true;
        amb.out.gain.cancelScheduledValues(T());
        amb.out.gain.setValueAtTime(EPS, T());          // 바람 없이 새소리만
        if (!muted) { scheduleBird(T() + 0.05); made = true; }
      }
    } else if (SFX[key]) {
      var o = {};
      for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
      o.force = true;                                    // 스로틀 우회 (렌더는 매번 새 ctx)
      made = !!play(key, o);
    } else {
      throw new Error('SH.Audio.renderOffline: 알 수 없는 이름 "' + name + '"');
    }

    return {
      name: key, muted: muted, scheduled: made,
      voices: voices.length,
      seconds: opts.seconds != null ? opts.seconds : ctx.length / ctx.sampleRate
    };
  }

  /**
   * 효과음/지속음 하나를 주어진 OfflineAudioContext 안에 스케줄한다.
   * startRendering() 은 부르지 않는다 — 호출자가 직접 부른다.
   *   await SH.Audio.renderOffline(oc, 'clank');
   *   await SH.Audio.renderOffline(oc, 'engine', { load: 0.7, seconds: 2 });
   *   const buf = await oc.startRendering();
   */
  function renderOffline(oc, name, opts) {
    opts = opts || {};
    if (!oc || typeof oc.createGain !== 'function' || typeof oc.startRendering !== 'function') {
      return Promise.reject(new Error('SH.Audio.renderOffline: OfflineAudioContext 가 필요합니다'));
    }
    if (!inited) {
      // init() 의 부작용(제스처 리스너) 없이 저장된 음소거 상태만 반영한다.
      muted = (U.store(STORE_KEY) === true);
    }
    var saved = snapState(), info = null, error = null;
    renderMode = true;
    try {
      bindRender(oc, opts);
      info = scheduleRender(name, opts);
    } catch (e) {
      error = e;
    } finally {
      // 오프라인 그래프는 oc 와 함께 GC 된다. 실시간 바인딩만 되돌린다.
      renderMode = false;
      useState(saved);
    }
    return error ? Promise.reject(error) : Promise.resolve(info);
  }

  return {
    init: init,
    unlock: unlock,
    play: play,
    engine: engine,
    roll: roll,
    ambience: ambience,
    mute: mute,
    isMuted: isMuted,
    setListener: setListener,
    setVolume: setVolume,
    setQuality: setQuality,
    suspend: suspend,
    resume: resume,
    update: update,
    dispose: dispose,
    renderOffline: renderOffline,
    get ready() { return !!ctx && ctx.state === 'running'; },
    get ctx() { return ctx; },
    get voices() { return voices.length; },
    get voicesTotal() { return voices.length + dying.length; }
  };
})();
