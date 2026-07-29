/* ============================================================================
   조차장 / SHUNTING — 00-util.js
   공용 유틸 + 이벤트 버스.  모든 모듈이 이 파일에 의존합니다.
   → window.SH, SH.U, SH.Bus
   CONTRACT: SPEC.md §6 참조. 이 파일은 orchestrator 소유.
   ============================================================================ */
(function () {
  'use strict';

  var SH = (window.SH = window.SH || {});
  SH.VERSION = '1.0.0';

  /* ── 이벤트 버스 ────────────────────────────────────────────── */
  var handlers = Object.create(null);
  SH.Bus = {
    on: function (evt, fn) { (handlers[evt] || (handlers[evt] = [])).push(fn); return fn; },
    off: function (evt, fn) {
      var a = handlers[evt]; if (!a) return;
      var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    emit: function (evt, payload) {
      var a = handlers[evt]; if (!a) return;
      for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) { SH.U.err(e); } }
    }
  };

  /* ── 수학 ───────────────────────────────────────────────────── */
  var PI = Math.PI, TAU = PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function invLerp(a, b, v) { return b === a ? 0 : (v - a) / (b - a); }
  function remap(v, a, b, c, d) { return lerp(c, d, clamp01(invLerp(a, b, v))); }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function smootherstep(t) { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); }
  function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }
  function mod(a, n) { return ((a % n) + n) % n; }
  /** 프레임레이트 독립 감쇠 보간 (Game Programming Gems / Lisa Nolan) */
  function damp(cur, tgt, lambda, dt) { return lerp(tgt, cur, Math.exp(-lambda * dt)); }
  function dampAngle(cur, tgt, lambda, dt) {
    var d = mod(tgt - cur + PI, TAU) - PI;
    return cur + d * (1 - Math.exp(-lambda * dt));
  }
  function approach(cur, tgt, maxDelta) {
    var d = tgt - cur;
    if (Math.abs(d) <= maxDelta) return tgt;
    return cur + sign(d) * maxDelta;
  }

  var ease = {
    linear:      function (t) { return t; },
    inQuad:      function (t) { return t * t; },
    outQuad:     function (t) { return t * (2 - t); },
    inOutQuad:   function (t) { return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    inCubic:     function (t) { return t * t * t; },
    outCubic:    function (t) { return (--t) * t * t + 1; },
    inOutCubic:  function (t) { return t < .5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; },
    outQuart:    function (t) { return 1 - (--t) * t * t * t; },
    inOutQuart:  function (t) { return t < .5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t; },
    outExpo:     function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    inOutExpo:   function (t) {
      if (t === 0 || t === 1) return t;
      return t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    },
    outBack:     function (t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic:  function (t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (TAU / 3)) + 1;
    },
    outBounce:   function (t) {
      var n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
      return n * (t -= 2.625 / d) * t + .984375;
    }
  };

  /* ── 난수 (전부 시드 기반 — Math.random 금지) ───────────────── */

  /** xmur3: 문자열 → 32bit 시드 */
  function hash(str) {
    str = String(str);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  /** mulberry32 — 빠르고 품질 충분한 PRNG */
  function rng(seed) {
    var a = (typeof seed === 'number') ? (seed >>> 0) : hash(seed == null ? 'shunting' : seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randRange(r, a, b) { return a + (b - a) * r(); }
  function randInt(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function shuffle(r, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  /** 가우시안 (Box–Muller) */
  function gauss(r, mean, sd) {
    var u = 1 - r(), v = r();
    return (mean || 0) + (sd == null ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  /* ── 노이즈 ─────────────────────────────────────────────────── */

  /**
   * 타일링 가능한 2D value noise.
   * period 를 주면 그 주기로 이음매 없이 반복됩니다 (텍스처용).
   * 반환: (x, y) => [-1, 1]
   */
  function noise2D(seed, period) {
    var P = period || 0;
    var s = (typeof seed === 'number') ? seed >>> 0 : hash(seed);
    function h2(ix, iy) {
      if (P) { ix = mod(ix, P); iy = mod(iy, P); }
      var n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ s;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1;
    }
    return function (x, y) {
      var ix = Math.floor(x), iy = Math.floor(y);
      var fx = smootherstep(x - ix), fy = smootherstep(y - iy);
      var a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
      return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    };
  }

  /** 옥타브 합성. noiseFn 은 noise2D 결과. period 를 쓰면 lacunarity 는 정수여야 타일링 유지. */
  function fbm(noiseFn, x, y, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2; gain = gain == null ? 0.5 : gain;
    var v = 0, amp = 1, freq = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      v += amp * noiseFn(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lac;
    }
    return v / (norm || 1);
  }

  /** 능선 노이즈 — 암반 지층·긁힘 자국에 좋음 */
  function ridge(noiseFn, x, y, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2; gain = gain == null ? 0.5 : gain;
    var v = 0, amp = 1, freq = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      var n = 1 - Math.abs(noiseFn(x * freq, y * freq));
      v += amp * n * n; norm += amp; amp *= gain; freq *= lac;
    }
    return v / (norm || 1) * 2 - 1;
  }

  /** 보로노이 — 자갈(발라스트)·갈라진 바위용. 반환 {f1, f2, id} */
  function voronoi2D(seed, period) {
    var s = (typeof seed === 'number') ? seed >>> 0 : hash(seed), P = period || 0;
    function pt(ix, iy) {
      if (P) { ix = mod(ix, P); iy = mod(iy, P); }
      var n = Math.imul(ix, 1597334677) ^ Math.imul(iy, 3812015801) ^ s;
      n = Math.imul(n ^ (n >>> 15), 2246822519);
      var a = ((n ^ (n >>> 13)) >>> 0) / 4294967296;
      n = Math.imul(n ^ (n >>> 7), 3266489917);
      var b = ((n ^ (n >>> 11)) >>> 0) / 4294967296;
      return [a, b, (n >>> 0)];
    }
    return function (x, y) {
      var ix = Math.floor(x), iy = Math.floor(y);
      var f1 = 1e9, f2 = 1e9, id = 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var p = pt(ix + ox, iy + oy);
        var dx = (ix + ox + p[0]) - x, dy = (iy + oy + p[1]) - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = p[2]; }
        else if (d < f2) { f2 = d; }
      }
      return { f1: f1, f2: f2, id: id };
    };
  }

  /* ── 캔버스 / 텍스처 헬퍼 ───────────────────────────────────── */

  function canvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h || w;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    return { cv: cv, ctx: ctx, w: cv.width, h: cv.height };
  }

  /**
   * 높이맵 캔버스 → 노멀맵 캔버스 (Sobel). 모든 텍스처 모듈이 이걸 씁니다.
   * @param src  height 정보를 담은 canvas (grayscale, R 채널 사용)
   * @param strength  1 = 보통, 2~4 = 강함
   * @param wrap  true면 가장자리를 감싸서 타일링 유지
   */
  function normalFromHeight(src, strength, wrap) {
    strength = strength == null ? 1.6 : strength;
    var w = src.width, h = src.height;
    var sctx = src.getContext('2d');
    var sd = sctx.getImageData(0, 0, w, h).data;
    var out = canvas(w, h);
    var od = out.ctx.createImageData(w, h);
    var D = od.data;

    function H(x, y) {
      if (wrap) { x = mod(x, w); y = mod(y, h); }
      else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
      return sd[((y * w + x) << 2)] / 255;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var tl = H(x - 1, y - 1), t = H(x, y - 1), tr = H(x + 1, y - 1);
        var l = H(x - 1, y), r = H(x + 1, y);
        var bl = H(x - 1, y + 1), b = H(x, y + 1), br = H(x + 1, y + 1);
        var dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        var dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        var nx = -dx * strength, ny = -dy * strength, nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var i = (y * w + x) << 2;
        D[i]     = ((nx / len) * .5 + .5) * 255;
        D[i + 1] = ((ny / len) * .5 + .5) * 255;
        D[i + 2] = ((nz / len) * .5 + .5) * 255;
        D[i + 3] = 255;
      }
    }
    out.ctx.putImageData(od, 0, 0);
    return out.cv;
  }

  /** 캔버스 전체를 픽셀 단위로 채우는 헬퍼. fn(x,y) -> [r,g,b,a] (0..255) */
  function fillPixels(c, fn) {
    var w = c.width, h = c.height, ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h), D = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var p = fn(x, y), i = (y * w + x) << 2;
      D[i] = p[0]; D[i + 1] = p[1]; D[i + 2] = p[2]; D[i + 3] = p.length > 3 ? p[3] : 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ── 색 ─────────────────────────────────────────────────────── */

  /** hex(또는 #rrggbb 문자열/숫자) → THREE.Color (sRGB로 해석) */
  function col(hex) {
    var c = new THREE.Color();
    if (typeof hex === 'string') c.setStyle(hex, THREE.SRGBColorSpace);
    else c.setHex(hex, THREE.SRGBColorSpace);
    return c;
  }
  /** '#rrggbb' → {r,g,b} 0..255 */
  function rgb(hex) {
    if (typeof hex === 'number') return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
    var s = hex.replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function hex(r, g, b) {
    function p(v) { v = clamp(Math.round(v), 0, 255).toString(16); return v.length < 2 ? '0' + v : v; }
    return '#' + p(r) + p(g) + p(b);
  }
  /** 색 밝기/채도 조절 — 텍스처 생성에서 많이 씁니다 */
  function shade(hexStr, amt) {           // amt -1..1
    var c = rgb(hexStr);
    if (amt >= 0) return hex(lerp(c.r, 255, amt), lerp(c.g, 255, amt), lerp(c.b, 255, amt));
    return hex(c.r * (1 + amt), c.g * (1 + amt), c.b * (1 + amt));
  }
  function mixHex(a, b, t) {
    var A = rgb(a), B = rgb(b);
    return hex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
  }
  function hsl(h, s, l) {                 // h 0..1
    var c = new THREE.Color(); c.setHSL(h, s, l, THREE.SRGBColorSpace);
    return '#' + c.getHexString();
  }

  /* ── 부팅 화면 제어 / 로깅 ──────────────────────────────────── */
  var bootBar = null, bootMsg = null, bootEl = null, bootErrEl = null;
  function bootRefs() {
    if (!bootEl) {
      bootEl = document.getElementById('boot');
      bootBar = document.getElementById('bootBar');
      bootMsg = document.getElementById('bootMsg');
      bootErrEl = document.getElementById('bootErr');
    }
  }
  function boot(pct, msg) {
    bootRefs();
    if (bootBar) bootBar.style.width = clamp01(pct) * 100 + '%';
    if (bootMsg && msg != null) bootMsg.textContent = msg;
  }
  function bootDone() {
    bootRefs();
    if (bootEl) { bootEl.classList.add('gone'); setTimeout(function () { bootEl.style.display = 'none'; }, 550); }
  }
  function fail(msg) {
    bootRefs();
    if (bootErrEl) bootErrEl.textContent = msg;
    if (bootMsg) bootMsg.textContent = '';
  }
  var DEBUG = /[?&]debug/.test(location.search);
  function err(e) {
    if (DEBUG && window.console) console.error(e);
    SH.U._errors.push(String((e && e.stack) || e));
  }

  /* ── 기타 ───────────────────────────────────────────────────── */
  function now() { return (performance && performance.now) ? performance.now() : Date.now(); }
  function isTouch() { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0; }
  function store(key, val) {
    try {
      if (val === undefined) { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
      localStorage.setItem(key, JSON.stringify(val)); return val;
    } catch (e) { return null; }
  }
  /** 배열 동등 비교 (승리 판정·솔버에서 사용) */
  function eqArr(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  SH.U = {
    PI: PI, TAU: TAU, DEG: PI / 180,
    clamp: clamp, clamp01: clamp01, lerp: lerp, invLerp: invLerp, remap: remap,
    smooth: smooth, smootherstep: smootherstep, sign: sign, mod: mod,
    damp: damp, dampAngle: dampAngle, approach: approach, ease: ease,
    hash: hash, rng: rng, randRange: randRange, randInt: randInt,
    pick: pick, shuffle: shuffle, gauss: gauss,
    noise2D: noise2D, fbm: fbm, ridge: ridge, voronoi2D: voronoi2D,
    canvas: canvas, normalFromHeight: normalFromHeight, fillPixels: fillPixels,
    col: col, rgb: rgb, hex: hex, shade: shade, mixHex: mixHex, hsl: hsl,
    boot: boot, bootDone: bootDone, fail: fail, err: err, DEBUG: DEBUG,
    now: now, isTouch: isTouch, store: store, eqArr: eqArr,
    _errors: []
  };
})();
