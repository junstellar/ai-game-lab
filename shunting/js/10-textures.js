/* ============================================================================
   조차장 / SHUNTING — 10-textures.js   →  SH.Tex
   절차적 텍스처 생성기. 외부 이미지 0개, 전부 <canvas> 로 굽는다.
   ============================================================================

   /* CONTRACT *\/  (SPEC.md §6 Tex)

   SH.Tex.build(quality)            // 부팅 시 1회. quality 0|1|2 → 기준 해상도 256/512/1024
   SH.Tex.sets.<name>               // { map, normalMap, roughnessMap, aoMap?, tile }
        names: ballast, sleeper, railSide, grass, cliff, soilTop, woodPlank, concrete,
               paintedSteel, rustSheet, tarpaulin, glassDirt, metalPlate, gravelFine,
               foliage        ← 수관·덤불 전용(잎 뭉치). tile 1.0 = repeat 1.
                                sets.grass 의 드롭인 대체품이라 Mat 은 tex 이름만 바꾸면 된다.
   SH.Tex.paint(hex, seed)          // -> { map, normalMap, roughnessMap }  (hex,seed 캐시)
   SH.Tex.decal(kind, opts)         // 'number'|'hazard'|'logo'|'stencil'|'panel' → 투명배경 RGBA
                                    //  'panel' = 판금 오버레이(패널 이음선·리벳열·루버·점검문)
   SH.Tex.skyGradient(t)            // equirect 하늘. t: 0 새벽 .5 정오 1 황혼 (기본 0.35)

   추가 공개 API (다른 모듈 편의용, 계약 상위집합):
   SH.Tex.ready                     // build() 완료 여부 (bool)
   SH.Tex.quality                   // 현재 품질
   SH.Tex.stats                     // { ms } 마지막 build 소요시간
   SH.Tex.sunDir()                  // skyGradient 가 그린 태양 방향 (THREE.Vector3, 정규화)
   SH.Tex.setAnisotropy(n)          // Render 가 늦게 올라온 경우 전체 텍스처 aniso 갱신
   SH.Tex.setRepeat(nameOrSet,u,v)  // 세트의 map/normal/rough/ao repeat 을 한 번에 조정
   SH.Tex.dispose()                 // 전부 해제

   ── 규약 (중요) ────────────────────────────────────────────────────────────
   • **UV 1 단위 = 1 미터** 를 가정한다. sets.<name>.tile 은 타일 한 장의 실제 크기(m)이고
     repeat 은 이미 1/tile 로 세팅되어 있다. 박스 UV(0..1)를 쓰는 메시라면
     Tex.setRepeat(name, u, v) 로 덮어써라. paint()/decal() 는 repeat(1,1) 로 준다.
   • 컬러맵 SRGBColorSpace / 노멀·러프니스·AO 는 NoColorSpace.
   • aoMap 은 .channel = 0 (첫 번째 uv) 으로 설정되어 있다. uv2 를 만들 필요 없다.
   • 모든 노멀맵은 **높이 캔버스 → U.normalFromHeight(…, wrap=true)** 로 유도한다.
     컬러/높이는 같은 시드·같은 난수 소비 순서로 그려서 정확히 겹친다.
   • Math.random 미사용. 전부 U.rng / U.hash 기반.
   ============================================================================ */

SH.Tex = (function () {
  'use strict';

  var U = SH.U;
  var TAU = Math.PI * 2;

  /* ── 상태 ──────────────────────────────────────────────────────────────── */
  var Q = 1;              // 품질 0/1/2
  var BASE = 512;         // 256 << Q
  var ANISO = 4;
  var built = false;
  var texReg = [];        // 만든 THREE.Texture 전부 (dispose 용)
  var sets = {};
  var paintCache = Object.create(null);
  var structCache = Object.create(null);
  var decalCache = Object.create(null);
  var skyCache = Object.create(null);
  var scratchPool = Object.create(null);
  var SUN = null;         // {x,y,z}

  /* ── 크기 ──────────────────────────────────────────────────────────────── */
  function sz(mul, cap) { return U.clamp(Math.round(BASE * mul), 32, cap || 1024); }
  /**
   * 스칼라 필드(마스크) 해상도. 0 저주파 / 1 중간 / 2 고주파.
   * 마스크는 어차피 확대 합성되므로 컬러맵보다 훨씬 작게 굽는 것이 예산의 핵심이다.
   */
  function fres(t) {
    var m = t === 0 ? 0.078 : (t === 1 ? 0.109 : 0.156);
    return U.clamp(Math.round(BASE * m), 48, t === 0 ? 80 : (t === 1 ? 112 : 160));
  }

  /* ── 노이즈 (축별 주기 독립 — U.noise2D 는 단일 주기만 지원) ───────────── */
  /**
   * 타일링 value noise. px, py 는 정수 주기(칸 수). U.noise2D 와 같은 격자/보간이지만
   * x 축과 y 축의 주기를 따로 줄 수 있어 결(방향성) 있는 텍스처를 이음매 없이 만들 수 있다.
   * U.fbm / U.ridge 에 그대로 넘겨 쓸 수 있다(옥타브 배율이 정수면 타일링 유지).
   */
  function nz(seed, px, py) {
    var s = (typeof seed === 'number') ? (seed >>> 0) : U.hash(seed);
    px = Math.max(1, px | 0); py = Math.max(1, py | 0);
    var sm = U.smootherstep, md = U.mod, lp = U.lerp;
    function h2(ix, iy) {
      ix = md(ix, px); iy = md(iy, py);
      var n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ s;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1;
    }
    return function (x, y) {
      var ix = Math.floor(x), iy = Math.floor(y);
      var fx = sm(x - ix), fy = sm(y - iy);
      var a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
      return lp(lp(a, b, fx), lp(c, d, fx), fy);
    };
  }
  /** fbm 필드 팩토리 → (u,v)=>0..1 */
  function fbmF(seed, px, py, oct, gain) {
    var n = nz(seed, px, py);
    oct = oct || 4; gain = gain == null ? 0.5 : gain;
    return function (u, v) { return U.fbm(n, u * px, v * py, oct, 2, gain) * 0.5 + 0.5; };
  }
  /** ridge 필드 팩토리 → (u,v)=>0..1 */
  function ridgeF(seed, px, py, oct, gain) {
    var n = nz(seed, px, py);
    oct = oct || 4; gain = gain == null ? 0.5 : gain;
    return function (u, v) { return U.ridge(n, u * px, v * py, oct, 2, gain) * 0.5 + 0.5; };
  }
  /** 레벨 보정 */
  function lv(v, lo, hi, g) {
    var t = (v - lo) / ((hi - lo) || 1e-5);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return (g && g !== 1) ? Math.pow(t, g) : t;
  }

  /* ── 캔버스 레이어 엔진 ────────────────────────────────────────────────── */
  function scr(w, h, slot) {
    var k = w + 'x' + h + '#' + (slot || 0), o = scratchPool[k];
    if (!o) o = scratchPool[k] = U.canvas(w, h);
    var c = o.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    return o;
  }
  function newCv(w, h) {
    var o = U.canvas(w, h);
    o.ctx.imageSmoothingEnabled = true;
    try { o.ctx.imageSmoothingQuality = 'high'; } catch (e) { /* 구형 */ }
    return o;
  }
  function fillC(ctx, w, h, color, alpha, op) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = op || 'source-over';
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function drawC(ctx, src, w, h, alpha, op) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = op || 'source-over';
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  }
  /**
   * 알파 마스크를 색으로 물들여 합성.
   * 물들이기는 마스크의 원래 해상도(작다)에서 하고, 확대는 마지막 drawImage 한 번만.
   * 전면 해상도로 3번 그리면 예산이 날아간다.
   */
  function stamp(ctx, w, h, color, maskCv, alpha, op, slot) {
    var mw = maskCv.width, mh = maskCv.height;
    var s = scr(mw, mh, slot == null ? 7 : slot);
    s.ctx.drawImage(maskCv, 0, 0);
    s.ctx.globalCompositeOperation = 'source-in';
    s.ctx.fillStyle = color; s.ctx.fillRect(0, 0, mw, mh);
    s.ctx.globalCompositeOperation = 'source-over';
    drawC(ctx, s.cv, w, h, alpha, op);
  }
  function gradFill(ctx, w, h, x0, y0, x1, y1, stops, alpha, op) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = op || 'source-over';
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  /**
   * (u,v)->0..1 스칼라 필드를 작은 캔버스로 굽는다. tint 를 주면 알파 마스크.
   * 결(방향성) 있는 필드는 rw≠rh 로 구워라 — 픽셀 루프가 전체 예산의 대부분이다.
   */
  function fieldCv(rw, rh, fn, tint) {
    var c = U.canvas(rw, rh);
    var r = 255, g = 255, b = 255;
    if (tint) { var t = U.rgb(tint); r = t.r; g = t.g; b = t.b; }
    var iw = 1 / rw, ih = 1 / rh;
    if (tint) {
      U.fillPixels(c.cv, function (x, y) {
        var v = fn((x + 0.5) * iw, (y + 0.5) * ih);
        return [r, g, b, (v < 0 ? 0 : v > 1 ? 1 : v) * 255];
      });
    } else {
      U.fillPixels(c.cv, function (x, y) {
        var v = fn((x + 0.5) * iw, (y + 0.5) * ih);
        v = (v < 0 ? 0 : v > 1 ? 1 : v) * 255;
        return [v, v, v, 255];
      });
    }
    return c.cv;
  }
  /**
   * (u,v)->[r,g,b] 를 작은 캔버스로 굽는다. **여러 주파수의 색 얼룩**을 만드는 유일한
   * 올바른 방법이다 — 반투명 stamp 를 여러 장 겹치면 마스크가 중간 알파로 뭉개져
   * 결국 한 가지 색으로 수렴한다(잔디가 "형광 라임 플라스틱 시트"가 된 원인).
   */
  function fieldRGB(rw, rh, fn) {
    var c = U.canvas(rw, rh), iw = 1 / rw, ih = 1 / rh, o = [0, 0, 0];
    U.fillPixels(c.cv, function (x, y) {
      fn((x + 0.5) * iw, (y + 0.5) * ih, o);
      return [o[0], o[1], o[2], 255];
    });
    return c.cv;
  }
  /** hex → [r,g,b] (매 픽셀 파싱을 피하려고 미리 뽑아 둔다) */
  function rgbA(h) { var c = U.rgb(h); return [c.r, c.g, c.b]; }
  /**
   * **채도를 지키는 밝기 올리기.** U.shade(h,+amt) 는 흰색으로 lerp 해서 값과 채도를 같이
   * 올린다 — 볕바램·리벳 하이라이트·홈 입술을 전부 그걸로 칠했더니 코발트 곤돌라 측면이
   * 회보라로 표백됐다 (R3 심사 B). 여기서는 **RGB 비율을 유지한 채 배율만** 올리고,
   * 상한을 넘는 만큼만 눌러 준다. desat 은 "볕에 실제로 바랜" 정도(0.05~0.2)만 준다.
   */
  function liftC(h, amt, desat) {
    var c = U.rgb(h), k = 1 + amt;
    var r = c.r * k, g = c.g * k, b = c.b * k;
    var over = Math.max(r, g, b) / 255;
    if (over > 1) { r /= over; g /= over; b /= over; }
    if (desat) {
      var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = U.lerp(r, L, desat); g = U.lerp(g, L, desat); b = U.lerp(b, L, desat);
    }
    return U.hex(r, g, b);
  }
  /** a,b 두 [r,g,b] 를 t 로 섞어 out 에 쓴다 */
  function mixA(a, b, t, out) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  function mask(res, fn) { return fieldCv(res, res, fn, '#ffffff'); }
  /** 비등방 마스크 — 결이 한 축으로 길게 늘어난 재질(목재·압연·주름)용 */
  function mask2(rw, rh, fn) { return fieldCv(rw, rh, fn, '#ffffff'); }
  /** 필드를 Float32Array 로 한 번만 계산 → 서로 다른 레벨의 마스크 여러 장을 싸게 뽑는다 */
  function fieldArr(res, fn) {
    var a = new Float32Array(res * res), inv = 1 / res, i = 0;
    for (var y = 0; y < res; y++) for (var x = 0; x < res; x++) a[i++] = fn((x + 0.5) * inv, (y + 0.5) * inv);
    return a;
  }
  function arrMask(a, res, lo, hi, gamma) {
    var c = U.canvas(res, res);
    U.fillPixels(c.cv, function (x, y) { return [255, 255, 255, lv(a[y * res + x], lo, hi, gamma) * 255]; });
    return c.cv;
  }
  /**
   * 픽셀 단위 백색 잡음 타일 → createPattern 으로 전면에 뿌린다 (고주파 그레인).
   * 어차피 반복되는 잡음이라 대비값별로 캐시해서 재사용한다.
   */
  var grainCache = Object.create(null);
  function grainTile(res, seed, lo, hi) {
    var key = res + '|' + Math.round(lo * 100) + '|' + Math.round(hi * 100) + '|' + (U.hash(seed) & 3);
    if (grainCache[key]) return grainCache[key];
    var r = U.rng(seed);
    var c = U.canvas(res, res);
    U.fillPixels(c.cv, function () {
      var v = (lo + (hi - lo) * r()) * 255;
      return [v, v, v, 255];
    });
    grainCache[key] = c.cv;
    return c.cv;
  }
  function patternFill(ctx, w, h, tileCv, alpha, op) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = op || 'overlay';
    var p = ctx.createPattern(tileCv, 'repeat');
    ctx.fillStyle = p; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  /** 경계를 넘는 도형을 반대편에도 그려 이음매를 없앤다 */
  function wrapDraw(S, x, y, rad, fn) {
    fn(x, y);
    var dx = x < rad ? S : (x > S - rad ? -S : 0);
    var dy = y < rad ? S : (y > S - rad ? -S : 0);
    if (dx) fn(x + dx, y);
    if (dy) fn(x, y + dy);
    if (dx && dy) fn(x + dx, y + dy);
  }

  /* ── THREE 텍스처 만들기 ───────────────────────────────────────────────── */
  /**
   * 이방성 필터링. 원경 레일·골판·그레이팅이 뜨거운 점으로 부서지는 걸 막는 1차 방어선이다.
   * 상한을 8 → 16 으로 올렸다 (Render.maxAniso 가 허용하는 만큼). 비용은 사실상 없다.
   */
  function anisoVal() {
    var m = (SH.Render && SH.Render.maxAniso) ? SH.Render.maxAniso : ANISO;
    return Math.max(1, Math.min(16, m));
  }
  function mkTex(cvEl, srgb, rep) {
    var t = new THREE.CanvasTexture(cvEl);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisoVal();
    /* 밉맵을 명시적으로 못박는다 — 하나라도 빠지면 그 세트만 원경에서 지글거린다 */
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    if (rep) t.repeat.set(rep, rep);
    t.needsUpdate = true;
    texReg.push(t);
    return t;
  }

  /** 절반씩 줄여 상자평균으로 축소 — drawImage 한 번에 크게 줄이면 표본추출이 되어버린다 */
  function downTo(src, w, h) {
    var cw = src.width, ch = src.height;
    var cur = src;
    while (cw > w * 2 || ch > h * 2) {
      var nw = Math.max(w, cw >> 1), nh = Math.max(h, ch >> 1);
      var t = scr(nw, nh, 15);
      t.ctx.imageSmoothingEnabled = true;
      t.ctx.drawImage(cur, 0, 0, nw, nh);
      var keep = newCv(nw, nh);
      keep.ctx.drawImage(t.cv, 0, 0);
      cur = keep.cv; cw = nw; ch = nh;
    }
    var o = newCv(w, h);
    o.ctx.imageSmoothingEnabled = true;
    o.ctx.drawImage(cur, 0, 0, w, h);
    return o.cv;
  }

  /**
   * Toksvig — 노멀맵의 고주파 분산을 러프니스로 흡수한다.
   * 노멀맵을 러프니스 해상도까지 상자평균으로 줄이면 요철이 심한 곳일수록 평균 법선이
   * 짧아진다(|N̄|<1). 그 부족분을 거칠기에 더해주면 밉 단계가 내려가도 하이라이트가
   * 좁게 살아남지 않는다 = **스페큘러 에일리어싱이 사라진다**.
   * 레일 두정면·골판·그레이팅·자갈처럼 노멀이 거친 셋에 반드시 걸어야 한다.
   */
  function toksvigBake(normCv, roughCv, amount) {
    if (!amount) return roughCv;
    var w = roughCv.width, h = roughCv.height;
    /* 지글거림은 밉 3단쯤 아래에서 터진다 — 러프니스 해상도가 아니라 **그 스케일**의
       평균 법선을 봐야 한다. 같은 해상도로만 줄이면 체커플레이트처럼 규칙적인 요철은
       평균이 거의 안 짧아져서 보정이 걸리지 않는다. */
    var vw = Math.max(4, Math.min(w, normCv.width >> 3));
    var vh = Math.max(4, Math.min(h, normCv.height >> 3));
    var small = downTo(normCv, vw, vh);
    var up = scr(w, h, 16);
    up.ctx.imageSmoothingEnabled = true;
    up.ctx.drawImage(small, 0, 0, w, h);
    var nd = up.ctx.getImageData(0, 0, w, h).data;
    var rctx = roughCv.getContext('2d');
    var img = rctx.getImageData(0, 0, w, h), D = img.data;
    for (var i = 0, n = w * h; i < n; i++) {
      var j = i << 2;
      var nx = nd[j] / 127.5 - 1, ny = nd[j + 1] / 127.5 - 1, nz = nd[j + 2] / 127.5 - 1;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1) len = 1;
      var v = D[j] / 255;
      /* 분산(1-|N̄|)을 거칠기 제곱에 더한다 — 물리적으로 맞는 합성 방식 */
      var o = Math.sqrt(Math.min(1, v * v + (1 - len) * amount)) * 255;
      D[j] = o; D[j + 1] = o; D[j + 2] = o;
    }
    rctx.putImageData(img, 0, 0);
    return roughCv;
  }
  /**
   * 높이 캔버스의 픽셀 단위 잡음만 깎아낸다 (형태는 남기고). 소벨 전에 반드시 필요 —
   * 안 하면 자갈 노멀이 자갈이 아니라 사포처럼 보인다.
   * 축소/확대를 3×3 타일 위에서 해서 이음매를 보존한다.
   */
  function softenCv(src, keepSharp) {
    var w = src.width, h = src.height;
    var sw = Math.max(8, w >> 1), sh = Math.max(8, h >> 1);
    var t = scr(sw * 3, sh * 3, 12);
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) t.ctx.drawImage(src, a * sw, b * sh, sw, sh);
    var o = newCv(w, h);
    o.ctx.drawImage(src, 0, 0, w, h);
    o.ctx.globalAlpha = 1 - (keepSharp == null ? 0.35 : keepSharp);
    o.ctx.drawImage(t.cv, sw, sh, sw, sh, 0, 0, w, h);
    o.ctx.globalAlpha = 1;
    return o.cv;
  }
  function normalCv(heightCv, strength, soften) {
    var src = soften ? softenCv(heightCv, soften) : heightCv;
    return U.normalFromHeight(src, strength == null ? 1.8 : strength, true);
  }
  function normalTex(heightCv, strength, rep, soften) {
    return mkTex(normalCv(heightCv, strength, soften), false, rep);
  }
  /** 높이 캔버스에서 AO(크레비스 그늘) 유도 */
  function aoTex(heightCv, size, amount, rep) {
    var s = scr(size, size, 9);
    s.ctx.drawImage(heightCv, 0, 0, size, size);
    var d = s.ctx.getImageData(0, 0, size, size).data;
    var out = U.canvas(size, size);
    var a = amount == null ? 0.85 : amount;
    U.fillPixels(out.cv, function (x, y) {
      var v = d[((y * size + x) << 2)] / 255;
      var ao = U.lerp(1 - a, 1, U.smooth(lv(v, 0.10, 0.72, 1)));
      var g = ao * 255;
      return [g, g, g, 255];
    });
    var t = mkTex(out.cv, false, rep);
    t.channel = 0;
    return t;
  }
  function finishSet(name, colorCv, heightCv, roughCv, opt) {
    opt = opt || {};
    var tile = opt.tile || 2;
    var rep = 1 / tile;
    var nCv = normalCv(heightCv, opt.strength, opt.soften);
    /* 노멀이 거친 셋일수록 크게. 0 이면 끔 (유리처럼 노멀이 평탄한 셋) */
    toksvigBake(nCv, roughCv, opt.toks == null ? 0.22 : opt.toks);
    var s = {
      tile: tile,
      map: mkTex(colorCv, true, rep),
      normalMap: mkTex(nCv, false, rep),
      roughnessMap: mkTex(roughCv, false, rep)
    };
    if (opt.ao) s.aoMap = aoTex(heightCv, Math.min(heightCv.width, 128), opt.ao, rep);
    if (opt.normalScale) s.normalScale = opt.normalScale;
    sets[name] = s;
    return s;
  }

  /* ── 공용 팔레트 ───────────────────────────────────────────────────────── */
  var P = {
    ballastLo: '#5d5245', ballastHi: '#8a7861',
    sleeper: '#4a3b2f', sleeperSun: '#8b8175',
    railRust: '#6b5f57', railHead: '#cfc9c0',
    grassLo: '#5f7440', grassHi: '#7d8f52', grassDry: '#9a8f5a',
    soil: '#7a5c43', strataA: '#8f7355', strataB: '#63483a',
    primer: '#8a5a3a', rust: '#6e3b23', rustDark: '#3a2318', rustHi: '#a06a3a',
    dirt: '#4a4038', dust: '#a89880'
  };

  /* ── 자갈(돌) 그리기 — 컬러/높이 두 패스가 완전히 같은 난수열을 쓴다 ───── */
  var STONE_COLS = null;
  function stoneCols() {
    if (STONE_COLS) return STONE_COLS;
    var r = U.rng('ballast-cols'), a = [];
    for (var i = 0; i < 48; i++) {
      var t = r();
      /* SPEC 팔레트 #8a7861 → #5d5245 를 그대로. 몸통색이 곧 알베도이므로 넘어가지 않는다 */
      var c = U.mixHex(P.ballastHi, P.ballastLo, t);
      if (t > 0.90) c = U.mixHex(c, '#453b31', (t - 0.90) * 4);      /* 검게 탄 돌 몇 개 */
      if (t < 0.08) c = U.mixHex(c, '#b0a488', 0.45);                /* 갓 깬 석회암 몇 개 */
      var w = (r() - 0.5) * 0.30;
      c = w > 0 ? U.mixHex(c, '#a89066', w) : U.mixHex(c, '#6a6a6e', -w);
      a.push(c);
    }
    STONE_COLS = a; return a;
  }
  var SOIL_COLS = null;
  function soilPebbleCols() {
    if (SOIL_COLS) return SOIL_COLS;
    var r = U.rng('soil-peb'), a = [];
    for (var i = 0; i < 20; i++) {
      var c = U.mixHex('#6e6154', '#3f352b', r());
      a.push(U.mixHex(c, '#8a7a63', r() * 0.35));
    }
    SOIL_COLS = a; return a;
  }
  function stonePath(ctx, x, y, rad, asp, rot, jit) {
    var nv = jit.length;
    ctx.beginPath();
    for (var i = 0; i < nv; i++) {
      var a = rot + i / nv * TAU, rr = rad * jit[i];
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * asp;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function rgbStr(v) { v = Math.round(U.clamp(v, 0, 255)); return 'rgb(' + v + ',' + v + ',' + v + ')'; }
  /**
   * 쇄석 밭. mode: 'color' | 'height' | 'rough'
   * 세 패스가 **완전히 같은 난수열**을 소비하므로 색·노멀·러프니스가 정확히 겹친다.
   * 자갈은 겹쳐 깔려야 자갈로 보인다 — 피복률 200% 이상을 목표로 한다.
   */
  function drawStones(ctx, S, o) {
    var r = U.rng(o.seed), cols = o.colors || stoneCols();
    var n = o.count, mode = o.mode;
    var gapCol = o.gap || '#241e19';
    for (var i = 0; i < n; i++) {
      var px = r() * S, py = r() * S;
      var rad = U.lerp(o.rmin, o.rmax, Math.pow(r(), 1.7)) * S;
      var asp = U.lerp(0.58, 1.0, r()), rot = r() * TAU;
      var vN = 5 + Math.floor(r() * 3);
      var jit = [];
      for (var k = 0; k < 7; k++) { var jv = 0.68 + 0.50 * r(); if (k < vN) jit.push(jv); }
      var col = cols[Math.floor(r() * cols.length) % cols.length];
      var hi = 0.42 + 0.58 * r();
      var gx = (r() - 0.5) * 0.60, gy = (r() - 0.5) * 0.60;
      drawStone(ctx, S, px, py, rad, asp, rot, jit, col, hi, gx, gy, mode, gapCol);
    }
  }
  /**
   * 돌 한 개. 세 겹(틈 그늘 → 몸통 → 볕 받는 패싯)으로 그린다.
   * **볕 받는 패싯이 핵심이다** — 이게 없으면 아무리 촘촘히 깔아도 갈색 얼룩으로 뭉친다.
   * 패싯은 돌마다 다른 방향(gx,gy)으로 치우쳐 있어 셀별 독립 노멀처럼 읽힌다.
   */
  function drawStone(ctx, S, x, y, rad, asp, rot, jit, col, hi, gx, gy, mode, gapCol) {
    var ox = gx * rad * 0.46, oy = gy * rad * 0.46;
    function one(px, py) {
      if (mode === 'height') {
        var top = 96 + hi * 152;
        ctx.fillStyle = '#000';                                   /* 틈 = 최저점 */
        stonePath(ctx, px, py, rad * 1.16, asp, rot, jit); ctx.fill();
        ctx.fillStyle = rgbStr(top * 0.46);
        stonePath(ctx, px, py, rad, asp, rot, jit); ctx.fill();
        ctx.fillStyle = rgbStr(top);
        stonePath(ctx, px + ox, py + oy, rad * 0.56, asp, rot, jit); ctx.fill();
      } else if (mode === 'rough') {
        /* 돌 하나하나가 다른 거칠기 (0.79~1.0). 틈의 세립 먼지는 바탕값 그대로 최대 */
        ctx.fillStyle = rgbStr(255 - hi * 54);
        stonePath(ctx, px, py, rad, asp, rot, jit); ctx.fill();
      } else {
        /* 1) 겹칠수록 진해지는 틈 그늘 = 셀 경계 AO */
        ctx.globalAlpha = 0.46; ctx.fillStyle = gapCol;
        stonePath(ctx, px, py, rad * 1.16, asp, rot, jit); ctx.fill();
        /* 2) 몸통 */
        ctx.globalAlpha = 1; ctx.fillStyle = col;
        stonePath(ctx, px, py, rad, asp, rot, jit); ctx.fill();
        /* 3) 볕 받아 닳은 윗 패싯 */
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = U.mixHex(col, '#ded6c0', 0.26 + 0.26 * hi);
        stonePath(ctx, px + ox, py + oy, rad * 0.56, asp, rot, jit); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    wrapDraw(S, x, y, rad * 1.25, one);
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. 발라스트 — 각진 쇄석. 셀별 색조, 셀 경계 그늘, 미세 먼지 레이어
     ══════════════════════════════════════════════════════════════════════ */
  /**
   * 발라스트 타일 한 장이 덮는 실제 거리(m). 자갈 한 알이 3~6 cm 로 읽혀야 하고
   * 1024px 타일이면 1.35 m 가 그 접점이다(≈1.3 mm/px, 돌 반경 16~42px).
   */
  var BALLAST_TILE_M = 1.35;
  /**
   * 20-geometry 의 발라스트 메시(sweepXZ)는 **1 UV = 1 m 규약을 따르지 않는다.**
   *   u = 단면 프로파일 파라미터  → 노반 상면에서 약 0.117 / m
   *   v = 호길이 × vScale(0.28)   → 0.28 / m
   * 그래서 finishSet 의 등방 repeat(1/tile) 로는 가로 19 m · 세로 11 m 짜리 타일이 되어
   * 자갈이 통째로 뭉갠 갈색 얼룩이 됐다. 여기서 축별 repeat 을 직접 못박는다.
   */
  var BALLAST_U_PER_M = 0.117, BALLAST_V_PER_M = 0.28;

  function buildBallast() {
    var S = sz(0.625, 1024), N = sz(0.375, 512), R = sz(0.25, 256);
    var T = BALLAST_TILE_M;
    /* 반경 2.1~5.5 cm 의 각진 쇄석. 타일 비율로 환산해서 해상도와 무관하게 크기가 고정된다 */
    var rmin = 0.021 / T, rmax = 0.055 / T;
    var ravg = rmin + (rmax - rmin) * 0.37;                 /* pow(r,1.7) 편향 반영 */
    var cnt = Math.round(2.95 / (Math.PI * ravg * ravg * 0.8));  /* 피복률 ≈295% — 맨바닥 구멍이 남으면 흙으로 읽힌다 */
    var stoneOpt = { seed: 2202, count: cnt, rmin: rmin, rmax: rmax, gap: '#241d16' };

    /* 저주파 얼룩. 타일이 1.35 m 마다 반복되므로 **약하게** — 세면 반복이 그대로 드러난다 */
    var blotF = fbmF('bal-blot', 3, 3, 3, 0.55);
    var blotA = fieldArr(fres(0), blotF);
    var blot = arrMask(blotA, fres(0), 0.50, 0.92, 1.1);
    var wet = arrMask(blotA, fres(0), 0.70, 0.99, 1.4);
    /* 자갈 사이 세립(모래·석분) — voronoi 로 틈을 잡아 어둡게 굽는다. 셀 ≈ 4.5 cm */
    var VC = Math.max(8, Math.round(T / 0.045));
    var vor = U.voronoi2D('bal-vor', VC);
    var dustM = mask(fres(2), function (u, v) {
      var d = vor(u * VC, v * VC);
      return lv(d.f2 - d.f1, 0.00, 0.16, 1.0);
    });

    /* ── 컬러 ── */
    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#4c4136');                                   /* 틈 바닥 = 그늘진 석분 */
    stoneOpt.mode = 'color'; drawStones(x, S, stoneOpt);
    stamp(x, S, S, '#2f271e', dustM, 0.30, 'multiply');          /* 셀 경계 홈을 0.6배로 */
    stamp(x, S, S, P.dust, dustM, 0.22, 'soft-light');
    stamp(x, S, S, '#6d5f4d', blot, 0.16, 'overlay');
    patternFill(x, S, S, grainTile(64, 'bal-g', 0.36, 0.64), 0.22, 'overlay');

    /* ── 높이 ── */
    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#101010');
    stoneOpt.mode = 'height'; drawStones(hx, N, stoneOpt);
    stamp(hx, N, N, '#000000', dustM, 0.35, 'source-over');
    patternFill(hx, N, N, grainTile(64, 'bal-gh', 0.40, 0.60), 0.24, 'overlay');

    /* ── 러프니스 : 돌마다 0.79~1.0, 틈의 석분은 최대, 젖은 자리만 확 낮게 ── */
    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#ffffff');
    stoneOpt.mode = 'rough'; drawStones(rx, R, stoneOpt);
    stamp(rx, R, R, '#ffffff', dustM, 0.45, 'source-over');
    stamp(rx, R, R, '#6e6e6e', wet, 0.55, 'source-over');
    patternFill(rx, R, R, grainTile(64, 'bal-gr', 0.40, 0.60), 0.24, 'overlay');

    finishSet('ballast', c.cv, hc.cv, rc.cv,
      { tile: T, strength: 2.5, ao: 0.70, soften: 0.62, toks: 0.26 });
    setRepeat('ballast', 1 / (T * BALLAST_U_PER_M), 1 / (T * BALLAST_V_PER_M));
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. 고운 자갈 / 재 깔린 통로 — voronoi 셀 직접 채색
     ══════════════════════════════════════════════════════════════════════ */
  function buildGravelFine() {
    var S = sz(0.125, 128), N = S, R = sz(0.09, 96);
    var CELLS = 22;
    var vor = U.voronoi2D('gvf', CELLS);
    var tintF = fbmF('gvf-t', 4, 4, 3, 0.55);
    var cols = stoneCols();
    /* voronoi 는 한 번만 돌리고 색/높이 두 장에 나눠 쓴다 */
    var edgeA = new Float32Array(S * S), colA = new Uint8Array(S * S * 3);
    var i = 0, j = 0, px, py;
    for (py = 0; py < S; py++) {
      for (px = 0; px < S; px++) {
        var u = (px + 0.5) / S, v = (py + 0.5) / S;
        var d = vor(u * CELLS, v * CELLS);
        var base = U.rgb(cols[Math.floor(((d.id % 4096) / 4096) * cols.length) % cols.length]);
        var edge = U.smooth(lv(d.f2 - d.f1, 0.0, 0.34, 0.85));
        var dome = 0.44 + 0.62 * edge, t = tintF(u, v) * 0.4 + 0.8;
        edgeA[i++] = edge;
        colA[j++] = U.clamp(base.r * dome * t, 0, 255);
        colA[j++] = U.clamp(base.g * dome * t, 0, 255);
        colA[j++] = U.clamp(base.b * dome * t * 0.98, 0, 255);
      }
    }
    var c = newCv(S, S);
    U.fillPixels(c.cv, function (x, y) {
      var k = (y * S + x) * 3;
      return [colA[k], colA[k + 1], colA[k + 2], 255];
    });
    patternFill(c.ctx, S, S, grainTile(64, 'gvf-g', 0.34, 0.66), 0.34, 'overlay');

    var hc = newCv(N, N);
    U.fillPixels(hc.cv, function (x, y) {
      var g = 40 + 205 * edgeA[y * S + x];
      return [g, g, g, 255];
    });
    patternFill(hc.ctx, N, N, grainTile(64, 'gvf-gh', 0.38, 0.62), 0.34, 'overlay');

    var rc = newCv(R, R);
    fillC(rc.ctx, R, R, '#e8e8e8');
    drawC(rc.ctx, hc.cv, R, R, 0.22, 'multiply');
    finishSet('gravelFine', c.cv, hc.cv, rc.cv, { tile: 1.6, strength: 1.4, soften: 0.55 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. 겉흙 — 잔돌·뿌리·덩어리
     ══════════════════════════════════════════════════════════════════════ */
  function buildSoilTop() {
    var S = sz(0.5), N = sz(0.125, 128), R = sz(0.125, 128);
    var clodF = fbmF('soil-c', 5, 5, 4, 0.55);
    var clod = mask(fres(1), function (u, v) { return lv(clodF(u, v), 0.42, 0.86, 1.0); });
    var dryF = fbmF('soil-d', 3, 3, 3, 0.6);
    var dry = mask(fres(0), function (u, v) { return lv(dryF(u, v), 0.55, 0.92, 1.2); });
    var crackF = ridgeF('soil-k', 6, 6, 4, 0.55);
    var crack = mask(fres(1), function (u, v) { return lv(crackF(u, v), 0.80, 0.99, 1.6); });

    /* cliff 와 마찬가지로 정점색이 흙색을 곱해도 살아남도록 값을 확실히 올렸다.
       말라 부슬한 곳 ↔ 눅눅한 덩어리의 명도 대비가 흙을 흙으로 보이게 한다 */
    var pebble = { seed: 'soil-st', count: Math.round(S * S / 900), rmin: 0.0035, rmax: 0.014, gap: '#4a3d2e' };
    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#a08863');
    stamp(x, S, S, '#6d5a44', clod, 0.62, 'multiply');             /* 눅눅한 덩어리 */
    stamp(x, S, S, '#d6c396', dry, 0.62, 'source-over');           /* 말라 하얗게 뜬 곳 */
    stamp(x, S, S, '#3a2c20', crack, 0.72, 'source-over');         /* 갈라진 틈 */
    pebble.mode = 'color'; pebble.colors = soilPebbleCols(); drawStones(x, S, pebble);
    patternFill(x, S, S, grainTile(64, 'soil-g', 0.32, 0.68), 0.36, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#8a8a8a');
    stamp(hx, N, N, '#ffffff', clod, 0.55, 'source-over');
    stamp(hx, N, N, '#000000', crack, 0.75, 'source-over');
    pebble.count = Math.round(N * N / 900); pebble.mode = 'height';
    drawStones(hx, N, pebble);
    patternFill(hx, N, N, grainTile(64, 'soil-gh', 0.34, 0.66), 0.34, 'overlay');

    /* 러프니스 0.40~1.0 : 마른 먼지는 최대, 눅눅한 덩어리와 반들반들 밟힌 잔돌은 확실히 낮게 */
    var rc = newCv(R, R);
    fillC(rc.ctx, R, R, '#ffffff');
    stamp(rc.ctx, R, R, '#8e8e8e', dry, 0.55, 'source-over');
    stamp(rc.ctx, R, R, '#6a6a6a', clod, 0.70, 'source-over');
    pebble.count = Math.round(R * R / 900); pebble.mode = 'rough';
    drawStones(rc.ctx, R, pebble);
    patternFill(rc.ctx, R, R, grainTile(64, 'soil-gr', 0.34, 0.66), 0.34, 'overlay');
    finishSet('soilTop', c.cv, hc.cv, rc.cv, { tile: 3.0, strength: 1.8, ao: 0.6, soften: 0.58 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. 풀 — 위에서 본 마른 올리브. 뭉치별 잎 방향, 흙 비침, 마른 패치
     ══════════════════════════════════════════════════════════════════════ */
  /**
   * ⚠ 값(밝기) 기준선에 관한 중요한 메모.
   * 섬 윗면(20-geometry islandTop)은 **정점색으로 SPEC 팔레트의 풀색(#7d8f52/#5f7440)을 이미
   * 곱한다**. 즉 이 컬러맵은 "절대 색"이 아니라 **값·결 디테일 맵**이다. 여기에 팔레트 색을
   * 그대로 구우면 팔레트가 두 번 곱해져(선형 0.2×0.2) 섬 전체가 새까매진다 — 실제로 그랬다.
   * 그래서 컬러맵은 **밝은 마른 올리브(평균 sRGB ≈ 190)** 로 굽고, 채도는 정점색이 준다.
   * 텍스처 단독 사용처(풀 다발 프롭·나뭇잎 Mat.leaf tint #cfe0a8)에서도 볕에 바랜 마른 풀로
   * 읽히도록 채도를 완전히 빼지는 않았다.
   */
  /* 잎 색 램프는 SPEC §3.3 의 **마른 올리브 #7d8f52 → #5f7440** 안에서만 움직인다.
     예전 램프는 #f2eec6 같은 크림·라임까지 올라가서 (a) 근접에서 형광 라임옐로로 보이고
     (b) 정규화된 알베도의 노란 성분이 튀어 SPEC 팔레트를 벗어났다 (R2 심사 C/G).
     밝기 폭은 유지하되 **색상 폭을 좁힌다** — 값(명도)으로 잎을 읽히게 한다. */
  /* 볕에 바랜 잎일수록 **채도가 빠진다**. 예전 램프는 밝아질수록 초록이 같이 세져서
     근접에서 형광 라임으로 읽혔다. 지금은 밝은 쪽이 카키(채도 0.28)로 빠지고
     그늘 쪽만 짙은 올리브(채도 0.45)로 남는다 — 이것이 "마른 올리브"의 실체다. */
  var GRASS_COLS = ['#8e9364', '#979a6f', '#868f5d', '#9e9d78', '#8b9161', '#94976a', '#818c58', '#a3a17c'];
  var GRASS_SHADE = ['#485a2e', '#516138', '#405029', '#57683e', '#44552c', '#5c6c42', '#4b5c33', '#3a4a24'];

  /**
   * 잎 획. dirFreq 는 잎이 같은 방향으로 눕는 **뭉치의 크기**를 정한다.
   * 5 는 타일(월드 3.2 m) 안에 0.64 m 짜리 소용돌이를 만들어, 타일이 반복될 때
   * 그 소용돌이가 통째로 알아볼 수 있는 무늬가 됐다 (심사: 평행 줄무늬 타일링).
   * 16~20 이면 뭉치가 16~20 cm — 실제 잔디 다발 크기이고, 반복해도 눈이 못 잡는다.
   */
  function bladeStrokes(ctx, S, o) {
    var r = U.rng(o.seed);
    var df = o.dirFreq || 17;
    var dirN = nz(o.seed + '-dir', df, df);
    var jit = o.dirJit == null ? 1.9 : o.dirJit;
    var paths = [], i;
    for (i = 0; i < o.cols.length; i++) paths.push(new Path2D());
    function add(p, x, y, mx, my, ex, ey) { p.moveTo(x, y); p.quadraticCurveTo(mx, my, ex, ey); }
    for (i = 0; i < o.count; i++) {
      var x = r() * S, y = r() * S;
      var d = dirN(x / S * df, y / S * df) * 3.0 + (r() - 0.5) * jit;
      var len = U.lerp(o.lmin, o.lmax, Math.pow(r(), 0.8)) * S;
      var bend = (r() - 0.5) * 0.85;
      var bi = Math.floor(r() * paths.length) % paths.length;
      var ex = x + Math.cos(d) * len, ey = y + Math.sin(d) * len;
      var mx = (x + ex) * 0.5 - Math.sin(d) * len * bend;
      var my = (y + ey) * 0.5 + Math.cos(d) * len * bend;
      var p = paths[bi];
      add(p, x, y, mx, my, ex, ey);
      var ox = x < len ? S : (x > S - len ? -S : 0);
      var oy = y < len ? S : (y > S - len ? -S : 0);
      if (ox) add(p, x + ox, y, mx + ox, my, ex + ox, ey);
      if (oy) add(p, x, y + oy, mx, my + oy, ex, ey + oy);
      if (ox && oy) add(p, x + ox, y + oy, mx + ox, my + oy, ex + ox, ey + oy);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = o.lw;
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    for (i = 0; i < paths.length; i++) { ctx.strokeStyle = o.cols[i]; ctx.stroke(paths[i]); }
    ctx.restore();
  }

  function buildGrass() {
    /* ⚠ 이 타일이 덮는 실제 거리는 **3.2 m** 다 (25-world 의 GRASS_M_PER_TILE 이
       tile/repeat 을 정규화해서 못박는다 — 여기서 repeat 을 무엇으로 두든 주기는 3.2 m).
       768 px / 3.2 m = 240 px/m (4 mm/texel) 이라 해상도는 넉넉하다. 문제는 주기다:
       섬은 길이 178 m 라 이 타일이 **56번 반복**된다. 따라서
         · 타일 하나를 덮는 저주파 얼룩을 넣으면 그게 곧 3.2 m 격자 무늬가 된다
         · 알아볼 수 있는 큰 무늬(예전 0.64 m 짜리 잎 소용돌이)는 절대 금지
       → 텍스처 안의 최대 특징 크기를 1 m 이하로 묶고, 그보다 큰 변화는
         25-world 의 정점색(주기 ≈100 m)에 맡긴다. */
    var S = sz(0.75, 768), N = sz(0.375, 384), R = sz(0.1875, 192);
    var TILE_M = 3.2;
    var FR = fres(1);

    /* ── 색 필드 3주파수 (1.07 m / 0.46 m / 0.21 m) ────────────────────
       "마름 정도" 하나로 물빠진 저지대 ↔ 볕에 탄 마른 패치를 잇는다.
       예전에는 반투명 stamp 6장을 겹쳤는데, 마스크가 전부 중간 알파라
       결국 균일한 라임 한 겹으로 수렴했다 (형광 플라스틱 시트). */
    var nDry = nz('gr-dry', 4, 4), nVar = nz('gr-var', 9, 9), nFin = nz('gr-fin', 19, 19);
    var nBare = nz('gr-bare', 9, 9), nStraw = nz('gr-straw', 6, 6);
    /* ⚠ 15-materials 의 mk('grass', {norm:'#7d8f52'}) 가 이 맵을 **평균으로 나눠**
       팔레트 색을 곱한다. 즉 화면에 나오는 것은 절대색이 아니라 **평균 대비 비율**이다.
       → 밝은 쪽을 평균의 1.5배까지 올리면 팔레트 초록이 그만큼 증폭돼 형광 라임이 된다.
         밝은 쪽을 1.3배 이하로 눌러 두는 것이 "마른 올리브"의 핵심이다. */
    var C_WET = rgbA('#5b6a3e'), C_MID = rgbA('#79855a'), C_DRY = rgbA('#9a9163');
    var C_STRAW = rgbA('#b0a578'), C_SOIL = rgbA('#6e5c46');
    var tmpA = [0, 0, 0], tmpB = [0, 0, 0];
    /** 마름 정도 0..1 — 컬러/러프니스/높이가 같은 필드를 쓴다 */
    function dryness(u, v) {
      return U.clamp01(0.5
        + U.fbm(nDry, u * 4, v * 4, 3, 2, 0.52) * 0.58
        + U.fbm(nVar, u * 9, v * 9, 2, 2, 0.5) * 0.30
        + nFin(u * 19, v * 19) * 0.15);
    }
    function bareAt(u, v) {
      return U.smooth(U.clamp01((U.fbm(nBare, u * 9, v * 9, 3, 2, 0.55) * 0.5 + 0.5 - 0.755) / 0.115));
    }
    function strawAt(u, v) {
      return U.smooth(U.clamp01((U.fbm(nStraw, u * 6, v * 6, 2, 2, 0.5) * 0.5 + 0.5 - 0.66) / 0.20));
    }
    var baseCv = fieldRGB(Math.round(FR * 1.3), Math.round(FR * 1.3), function (u, v, o) {
      var t = dryness(u, v);
      if (t < 0.5) mixA(C_WET, C_MID, t * 2, o);
      else mixA(C_MID, C_DRY, (t - 0.5) * 2, o);
      var s = strawAt(u, v) * U.clamp01((t - 0.42) * 2.4);
      if (s > 0) mixA(o, C_STRAW, s * 0.72, o);
      var b = bareAt(u, v);
      if (b > 0) mixA(o, C_SOIL, b * 0.80, o);
      return o;
    });
    /* 마스크들 — 잎·뭉치 층이 색 필드와 정확히 겹치도록 같은 필드에서 뽑는다.
       필드는 한 번만 돌리고 임계값만 달리해 세 장을 낸다 (픽셀 루프가 이 함수 예산의 대부분). */
    var bare = arrMask(fieldArr(FR, bareAt), FR, 0, 1, 1);
    var dryA = fieldArr(FR, dryness);
    var dry = arrMask(dryA, FR, 0.55, 0.9346, 1.0);
    var wet = arrMask(dryA, FR, 0.45, 0.0654, 1.0);
    /* 뭉치: 잎보다 한 단계 큰 0.21 m 짜리 다발. **원경에서 잔디로 읽히는 것은 잎이 아니라
       이 다발이다** — 24 px/m 인 화면에서 잎 하나는 0.5 px 라 잡음으로만 남는다.
       밝은 꼬리/어두운 꼬리를 따로 뽑아 다발에 볕과 그늘을 준다. */
    var clumpA = fieldArr(FR, fbmF('gr-c', 15, 15, 2, 0.5));
    var clump = arrMask(clumpA, FR, 0.34, 0.86, 1.0);
    var clumpHi = arrMask(clumpA, FR, 0.50, 0.90, 1.0);
    var clumpLo = arrMask(clumpA, FR, 0.50, 0.10, 1.0);
    /* 한 단계 더 잔 다발(0.10 m). 클로즈업(closeup-track)에서 잔디가 "저주파 얼룩"으로
       보인 이유는 0.21 m 다발과 3 cm 잎 사이가 비어 있었기 때문이다 — 그 사이를 메운다.
       발라스트(상대대비 31.5%) 옆에서 급이 떨어지지 않으려면 이 층이 필요하다. */
    var fineA = fieldArr(FR, fbmF('gr-cf', 31, 31, 2, 0.5));
    var fineHi = arrMask(fineA, FR, 0.50, 0.88, 1.0);
    var fineLo = arrMask(fineA, FR, 0.50, 0.12, 1.0);

    /* 잎 밀도는 **월드 면적** 기준 (해상도를 바꿔도 잎 굵기가 실제 치수로 고정된다) */
    var AREA = TILE_M * TILE_M;
    function nBlade(res, perM2, perPx) { return Math.max(24, Math.min(Math.round(AREA * perM2), Math.round(res * res / perPx))); }
    var nTop = nBlade(S, 470, 115), nSub = nBlade(S, 330, 180);
    var nTopH = nBlade(N, 470, 115), nSubH = nBlade(N, 330, 180);
    /* 잔디 사이에 흩어진 자갈·마른 부스러기 — 선로 옆에서 발라스트로 자연스럽게 번진다 */
    var scatter = {
      seed: 'gr-peb', count: Math.round(AREA * 16),
      rmin: 0.0018, rmax: 0.0060, gap: '#3a4426', colors: soilPebbleCols()
    };

    /* ── 컬러 ── */
    var c = newCv(S, S), x = c.ctx;
    drawC(x, baseCv, S, S, 1, 'source-over');
    var lw = Math.max(1, Math.round(S / 340));
    /* 다발 볕/그늘 — 잎보다 먼저. 원경에서 잔디의 덩어리감을 만드는 층이다.
       **밝은 쪽은 초록이 아니라 따뜻한 카키로** 간다 (마른 잎 끝) — 이래야 대비를 키워도
       순광부가 형광 샤르트뢰즈로 튀지 않는다. 어두운 쪽만 짙은 올리브로 남긴다. */
    stamp(x, S, S, '#aeb07c', clumpHi, 0.46, 'source-over');
    stamp(x, S, S, '#495630', clumpLo, 0.48, 'source-over');
    stamp(x, S, S, '#a5a473', fineHi, 0.24, 'source-over');
    stamp(x, S, S, '#515e36', fineLo, 0.26, 'source-over');
    /* 그늘진 아래층 잎 → 밝은 윗층 잎. 두 겹이라야 잔디가 두께를 갖는다.
       잎 길이 2~7 cm · 굵기 1 cm — 위에서 내려다본 잔디의 실제 치수다.
       (더 짧게 잡으면 24 px/m 화면에서 1 px 이하가 되어 그냥 잡음이 된다) */
    bladeStrokes(x, S, {
      seed: 'gr-blade0', count: nSub, cols: GRASS_SHADE, dirFreq: 19, dirJit: 2.1,
      lmin: 0.008, lmax: 0.026, lw: lw + 1, alpha: 0.82
    });
    bladeStrokes(x, S, {
      seed: 'gr-blade', count: nTop, cols: GRASS_COLS, dirFreq: 17, dirJit: 2.0,
      lmin: 0.007, lmax: 0.022, lw: lw, alpha: 0.94
    });
    /* 흙 노출을 **잎 위에 다시 한 번** — 땅이 드러난 자리는 잎이 없어야 흙으로 읽힌다 */
    stamp(x, S, S, '#6f5842', bare, 0.62, 'source-over');
    stamp(x, S, S, '#7f8b5e', clump, 0.24, 'multiply');             /* 뭉치 사이 그늘 */
    scatter.mode = 'color';
    drawStones(x, S, scatter);
    patternFill(x, S, S, grainTile(64, 'gr-g', 0.40, 0.60), 0.22, 'overlay');

    /* 높이 — 뭉치 볼록 + 잎 하이라이트 */
    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#4f4f4f');
    stamp(hx, N, N, '#d6d6d6', clump, 0.85, 'source-over');
    stamp(hx, N, N, '#8f8f8f', fineHi, 0.40, 'source-over');
    stamp(hx, N, N, '#2f2f2f', fineLo, 0.34, 'source-over');
    stamp(hx, N, N, '#242424', bare, 0.70, 'source-over');
    bladeStrokes(hx, N, {
      seed: 'gr-blade0', count: nSubH, dirFreq: 19, dirJit: 2.1,
      cols: ['#343434', '#404040', '#2a2a2a', '#484848', '#303030', '#4c4c4c', '#383838', '#242424'],
      lmin: 0.008, lmax: 0.026, lw: Math.max(1, Math.round(N / 340)) + 1, alpha: 0.62
    });
    bladeStrokes(hx, N, {
      seed: 'gr-blade', count: nTopH, dirFreq: 17, dirJit: 2.0,
      cols: ['#f0f0f0', '#d8d8d8', '#fafafa', '#cacaca', '#e6e6e6', '#f4f4f4', '#e0e0e0', '#d0d0d0'],
      lmin: 0.007, lmax: 0.022, lw: Math.max(1, Math.round(N / 340)), alpha: 0.74
    });
    scatter.mode = 'height';
    drawStones(hx, N, scatter);

    /* 러프니스 — 잎은 거의 1.0, 드러난 흙·마른 잎은 눈에 띄게 덜.
       (균일 러프니스가 평평해 보이는 가장 큰 원인이다) */
    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#ffffff');
    stamp(rx, R, R, '#a4a4a4', wet, 0.62, 'source-over');     /* 저지대는 눅눅 → 덜 거침 */
    stamp(rx, R, R, '#909090', dry, 0.78, 'source-over');
    stamp(rx, R, R, '#7a7a7a', bare, 0.88, 'source-over');    /* 다져진 흙길 = 광이 남는다 */
    stamp(rx, R, R, '#dcdcdc', clump, 0.58, 'source-over');
    stamp(rx, R, R, '#b6b6b6', fineHi, 0.34, 'source-over');
    scatter.mode = 'rough'; drawStones(rx, R, scatter);
    patternFill(rx, R, R, grainTile(64, 'gr-gr', 0.32, 0.68), 0.44, 'overlay');

    /* tile 은 25-world 가 GRASS_M_PER_TILE(3.2 m) 로 정규화하므로 값 자체는 중립이면 된다.
       여기 1.0 을 유지하는 이유는 grassTuft·나뭇잎 카드처럼 이 세트를 직접 쓰는
       프롭들이 repeat 1 을 기대하기 때문이다. */
    finishSet('grass', c.cv, hc.cv, rc.cv, { tile: 1.0, strength: 2.1, ao: 0.52, soften: 0.62 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4b. 식생(수관·덤불) — Tex.sets.foliage
     ══════════════════════════════════════════════════════════════════════
     나무와 덤불은 지금까지 sets.grass 를 빌려 썼다. 위에서 내려다본 잔디는
     **한 방향으로 누운 얇은 잎**이고 수관은 **겹쳐 쌓인 잎 뭉치**라서, 잔디 맵을
     구에 붙이면 어느 각도에서 봐도 "매끈한 캡슐에 초록 얼룩"이 된다 (R3 심사 C).
     여기서는 수관 전용으로 굽는다:
       · 잎 뭉치 클러스터 2옥타브 → 높이 → 소벨 노멀 (뭉치 단위가 실루엣 안에서 읽힌다)
       · 3단 값 분리: 볕에 바랜 윗면 → 중간 → 속그늘. 값 차 40~60 (심사 요구치)
       · 뭉치 사이 **구멍**(하늘이 비치는 자리) — 이게 있어야 잎이 잎으로 읽힌다
       · 러프니스 0.55(왁스 낀 윗잎) → 0.88(속잎)
     tile 1.0 = repeat 1 — 수관 로브 UV(0..1) 에 한 장이 정확히 덮이도록. */
  /* 값(명도)만 벌리고 색상 폭은 좁게 — SPEC §3.3 "마른 올리브" 를 벗어나지 않는다.
     심사 지시의 #a8b45c 는 순수 샤르트뢰즈라 살짝 카키 쪽으로 당겼다 (#a6ae5f, 휘도 166).
     휘도 166 / 120 / 68 → 인접 단 차 46·52 로 요구치 40~60 안. */
  var FOL_SUN = '#a6ae5f', FOL_MID = '#6f8040', FOL_DEEP = '#3a4a26';
  var FOL_LEAF_HI = ['#b6bc70', '#a2ab5c', '#c0c47e', '#96a154', '#adb268', '#8e9b4e'];
  var FOL_LEAF_LO = ['#41522a', '#354523', '#4b5c31', '#2c3a1c', '#455636', '#384925'];

  function buildFoliage() {
    var S = sz(0.5, 512), N = sz(0.25, 256), R = sz(0.1875, 192);
    var FR = fres(1);

    /* 클러스터 2옥타브: 큰 잎뭉치(주기 6) + 잔 뭉치(주기 15) + 저주파 블로치(주기 3) */
    var nClu = nz('fol-clu', 6, 6), nFin = nz('fol-fin', 15, 15), nBlo = nz('fol-blo', 3, 3);
    function cluster(u, v) {
      return U.clamp01(0.5
        + U.fbm(nClu, u * 6, v * 6, 2, 2, 0.55) * 0.72
        + nFin(u * 15, v * 15) * 0.34);
    }
    function blotch(u, v) { return U.clamp01(nBlo(u * 3, v * 3) * 0.5 + 0.5); }

    var C_SUN = rgbA(FOL_SUN), C_MID = rgbA(FOL_MID), C_DEEP = rgbA(FOL_DEEP);
    var baseCv = fieldRGB(Math.round(FR * 1.3), Math.round(FR * 1.3), function (u, v, o) {
      /* 뭉치 꼭대기(=볕) ↔ 뭉치 사이(=속그늘) 를 값으로 잇고, 저주파 블로치로
         균일색을 깬다. 블로치를 안 넣으면 클러스터가 규칙적인 물방울무늬가 된다. */
      var t = U.clamp01(cluster(u, v) * 0.82 + blotch(u, v) * 0.26 - 0.06);
      if (t < 0.5) mixA(C_DEEP, C_MID, t * 2, o);
      else mixA(C_MID, C_SUN, (t - 0.5) * 2, o);
      return o;
    });

    var cluA = fieldArr(FR, cluster);
    var cluHi = arrMask(cluA, FR, 0.56, 0.92, 1.0);      /* 볕 받는 뭉치 꼭대기 */
    var cluLo = arrMask(cluA, FR, 0.46, 0.06, 1.0);      /* 뭉치 사이 속그늘 */
    var gap = arrMask(cluA, FR, 0.20, 0.045, 1.0);       /* 잎이 아예 없는 구멍 */
    var bloM = arrMask(fieldArr(FR, blotch), FR, 0.44, 0.92, 1.0);

    /* 잎 획 — 잔디보다 굵고 짧고 방향이 제각각(뭉치라서). lw ≈ S/85 = 6 px @512 */
    var lwL = Math.max(2, Math.round(S / 85));
    function leaves(ctx, sz2, cols, cnt, alpha, seed, lwm) {
      bladeStrokes(ctx, sz2, {
        seed: seed, count: cnt, cols: cols, dirFreq: 9, dirJit: 3.1,
        lmin: 0.014, lmax: 0.048, lw: Math.max(2, Math.round(sz2 / 85 * (lwm || 1))), alpha: alpha
      });
    }

    /* ── 컬러 ── */
    var c = newCv(S, S), x = c.ctx;
    drawC(x, baseCv, S, S, 1, 'source-over');
    stamp(x, S, S, '#b9bf78', cluHi, 0.40, 'source-over');
    stamp(x, S, S, '#2f3d20', cluLo, 0.46, 'source-over');
    stamp(x, S, S, '#9aa35a', bloM, 0.20, 'source-over');
    leaves(x, S, FOL_LEAF_LO, 900, 0.72, 'fol-lf0', 1.15);
    leaves(x, S, FOL_LEAF_HI, 760, 0.80, 'fol-lf1', 0.85);
    stamp(x, S, S, '#222c17', gap, 0.85, 'source-over');   /* 뭉치 사이 구멍 */
    patternFill(x, S, S, grainTile(64, 'fol-g', 0.40, 0.60), 0.20, 'overlay');

    /* ── 높이 ── */
    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#585858');
    stamp(hx, N, N, '#e2e2e2', cluHi, 0.90, 'source-over');
    stamp(hx, N, N, '#242424', cluLo, 0.80, 'source-over');
    stamp(hx, N, N, '#050505', gap, 0.95, 'source-over');
    leaves(hx, N, ['#2e2e2e', '#3a3a3a', '#262626', '#424242', '#323232', '#1e1e1e'], 900, 0.55, 'fol-lf0', 1.15);
    leaves(hx, N, ['#f2f2f2', '#dcdcdc', '#fafafa', '#cccccc', '#e8e8e8', '#f6f6f6'], 760, 0.70, 'fol-lf1', 0.85);

    /* ── 러프니스 ── 윗잎은 큐티클 층이 있어 왁스처럼 반들, 속잎은 완전 무광.
       Mat.leaf 가 roughness 0.85 를 곱하므로 여기 165→255 가 실효 0.55→0.85 다. */
    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#dcdcdc');
    stamp(rx, R, R, '#a5a5a5', cluHi, 0.85, 'source-over');   /* 0.65×0.85 ≈ 0.55 */
    stamp(rx, R, R, '#ffffff', cluLo, 0.90, 'source-over');
    stamp(rx, R, R, '#ffffff', gap, 1.0, 'source-over');
    patternFill(rx, R, R, grainTile(64, 'fol-gr', 0.36, 0.64), 0.36, 'overlay');

    finishSet('foliage', c.cv, hc.cv, rc.cv, { tile: 1.0, strength: 2.4, ao: 0.60, soften: 0.55 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. 절벽 / 지층 — 수평 밴드 7개 + ridge 로 부서진 면 + 세로 균열
     ══════════════════════════════════════════════════════════════════════ */
  /**
   * ⚠ 풀과 같은 이유로 **값 디테일 맵**이다 — 섬 옆면(islandWall)은 정점색으로 지층 색을
   * 이미 곱한다. 예전 STRATA 는 짙은 갈색이라 두 번 곱해져 옆면이 새까맸다.
   * 여기서는 색조는 살짝만 주고 **명도 대비**로 지층을 만든다 (최명 210 ↔ 최암 107, 약 2:1).
   * 다만 섬 밑에 매달린 암반(islandRocks)은 **정점색이 흰색**이라 이 맵이 그대로 나온다.
   * 그래서 완전한 흰 디테일 맵으로는 못 올린다 — 그러면 암반이 석고처럼 하얘진다.
   * 평균 sRGB 165 전후의 따뜻한 석회암 값이 두 용도의 접점이다.
   */
  var STRATA = ['#d2c4a8', '#8a7c68', '#bfae92', '#6b6052', '#c8bb9e', '#988a74', '#ab9c84',
    '#786c5c', '#bcae92'];
  /** 밴드 두께 비율 — 균등하면 줄무늬 벽지가 된다. 실제 퇴적층은 두께가 제각각이다. */
  var STRATA_H = [1.00, 0.42, 0.66, 0.30, 1.35, 0.52, 0.86, 0.34, 0.60];

  function strataBands(ctx, S, seed, isHeight) {
    var r = U.rng(seed);
    var wob = nz(seed + '-w', 6, 6);
    var NB = STRATA.length, i, xx;
    var step = Math.max(2, Math.round(S / 128));
    var tot = 0, cum = [0];
    for (i = 0; i < NB; i++) { tot += STRATA_H[i]; cum.push(tot); }
    for (i = 0; i <= NB; i++) cum[i] /= tot;
    for (i = 0; i < NB; i++) {
      var y0 = cum[i], y1 = cum[i + 1];
      var amp = 0.006 + r() * 0.020;
      var ph = r() * 6;
      var ph2 = ph + 1.7;
      /* 높이도 밴드마다 확실히 다른 단(段)이 되게 — 단단한 층이 튀어나오고 무른 층은 파인다 */
      ctx.fillStyle = isHeight ? rgbStr(58 + Math.round(r() * 178)) : STRATA[i % STRATA.length];
      ctx.beginPath();
      ctx.moveTo(0, (y0 + wob(0, ph) * amp) * S);
      for (xx = step; xx <= S; xx += step) ctx.lineTo(xx, (y0 + wob(xx / S * 6, ph) * amp) * S);
      ctx.lineTo(S, (y1 + wob(6, ph2) * amp) * S);
      for (xx = S - step; xx >= 0; xx -= step) ctx.lineTo(xx, (y1 + wob(xx / S * 6, ph2) * amp) * S);
      ctx.closePath();
      ctx.fill();
      /* 층 경계 = 깊이 파인 이음매. 아래로 진한 그늘 + 위로 밝은 입술(빛 받는 단의 윗면).
         이 두 줄이 있어야 원경에서도 "지층"으로 읽힌다 — 한 줄짜리 실선은 벽지처럼 보인다 */
      ctx.save();
      ctx.lineCap = 'round';
      function edgeLine(dy, w, col) {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, w);
        ctx.beginPath();
        ctx.moveTo(0, (y0 + wob(0, ph) * amp) * S + dy);
        for (var q = step; q <= S; q += step) ctx.lineTo(q, (y0 + wob(q / S * 6, ph) * amp) * S + dy);
        ctx.stroke();
      }
      var lwB = Math.max(1, S / 240);
      edgeLine(lwB * 0.9, lwB * 1.7, isHeight ? 'rgba(0,0,0,0.95)' : 'rgba(24,16,10,0.62)');
      edgeLine(-lwB * 0.6, lwB * 0.9, isHeight ? 'rgba(255,255,255,0.55)' : 'rgba(255,246,226,0.38)');
      ctx.restore();
    }
  }

  function fractures(ctx, S, seed, col, wMul, isHeight) {
    var r = U.rng(seed);
    var n = Math.round(10 + S / 46);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    for (var i = 0; i < n; i++) {
      var px = r() * S, py = r() * S;
      var len = U.lerp(0.06, 0.34, Math.pow(r(), 1.5)) * S;
      var ang = (r() - 0.5) * 0.7 + Math.PI * 0.5;          /* 대체로 수직 */
      ctx.lineWidth = Math.max(1, (0.4 + r() * 1.5) * wMul);
      ctx.globalAlpha = isHeight ? 0.85 : (0.30 + r() * 0.45);
      var segs = 4 + Math.floor(r() * 4);
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (var k = 0; k < segs; k++) {
        ang += (r() - 0.5) * 0.55;
        px += Math.cos(ang) * len / segs; py += Math.sin(ang) * len / segs;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function buildCliff() {
    var S = sz(0.5), N = sz(0.25, 256), R = sz(0.125, 128);
    var rockF = ridgeF('cl-r', 8, 8, 4, 0.5);
    var rock = mask(fres(1), function (u, v) { return lv(rockF(u, v), 0.35, 0.95, 1.0); });
    var stainF = fbmF('cl-s', 3, 3, 4, 0.6);
    var stain = mask(fres(0), function (u, v) { return lv(stainF(u, v), 0.55, 0.95, 1.2); });

    var flakeF = ridgeF('cl-fk', 20, 20, 3, 0.5);
    var flake = mask(fres(2), function (u, v) { return lv(flakeF(u, v), 0.66, 0.98, 1.1); });

    var c = newCv(S, S), x = c.ctx;
    strataBands(x, S, 'cl-band', false);
    /* 부서진 면: 그늘/광량 두 방향으로 모두 세게 — 명도 폭이 좁으면 원경에서 밋밋한 판이 된다 */
    stamp(x, S, S, '#4a382a', rock, 0.44, 'multiply');
    stamp(x, S, S, '#fff4e0', rock, 0.42, 'screen');
    stamp(x, S, S, '#3b2c20', flake, 0.30, 'multiply');       /* 부서진 면의 잔결 */
    stamp(x, S, S, '#f2e2c6', flake, 0.34, 'screen');
    stamp(x, S, S, '#31261c', stain, 0.34, 'multiply');       /* 물 흘러내린 자국 */
    fractures(x, S, 'cl-fr', 'rgba(26,18,12,1)', S / 250, false);
    fractures(x, S, 'cl-fr2', 'rgba(246,236,214,1)', S / 400, false);
    patternFill(x, S, S, grainTile(64, 'cl-g', 0.28, 0.72), 0.46, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    strataBands(hx, N, 'cl-band', true);
    stamp(hx, N, N, '#ffffff', rock, 0.62, 'source-over');
    stamp(hx, N, N, '#151515', flake, 0.48, 'source-over');
    stamp(hx, N, N, '#f0f0f0', flake, 0.26, 'source-over');
    stamp(hx, N, N, '#101010', stain, 0.20, 'source-over');
    fractures(hx, N, 'cl-fr', 'rgba(0,0,0,1)', N / 250, true);
    patternFill(hx, N, N, grainTile(64, 'cl-gh', 0.34, 0.66), 0.38, 'overlay');

    /* 러프니스 0.34~1.0 — 갓 부서진 면은 결정면이 남아 덜 거칠고, 오래 삭은 면·때는 최대로 거칠다 */
    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#ffffff');
    stamp(rx, R, R, '#7a7a7a', rock, 0.70, 'source-over');
    stamp(rx, R, R, '#575757', flake, 0.60, 'source-over');
    stamp(rx, R, R, '#e2e2e2', stain, 0.70, 'source-over');
    patternFill(rx, R, R, grainTile(64, 'cl-gr', 0.32, 0.68), 0.36, 'overlay');
    finishSet('cliff', c.cv, hc.cv, rc.cv, { tile: 6.0, strength: 2.6, ao: 0.7, soften: 0.62 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. 나뭇결 공용 — U 축을 따라 결이 흐른다 (px 작게, py 크게)
     ══════════════════════════════════════════════════════════════════════ */
  /**
   * 결 + 갈라짐 마스크 묶음. cell 은 결의 굵기(클수록 촘촘).
   * 결은 U 축으로 길게 늘어나므로 마스크를 세로로 긴 비등방 캔버스에 굽는다.
   * 최고 옥타브가 마스크 해상도를 넘지 않게 유지해야 지글거리지 않는다 —
   * 진짜 고주파는 아래 grain 패턴이 전면 해상도로 담당한다.
   */
  function woodFields(seed, cell, res) {
    var w = Math.max(32, Math.round(res * 0.32)), h = Math.max(96, Math.round(res * 1.4));
    var gF = fbmF(seed + '-g', 4, cell, 3, 0.55);          /* 길게 늘어난 저주파 결 */
    var fF = fbmF(seed + '-f', 8, cell * 2, 2, 0.5);       /* 미세 결 */
    var kF = ridgeF(seed + '-k', 3, Math.round(cell * 0.7), 3, 0.5);   /* 갈라짐 */
    return {
      grain: mask2(w, h, function (u, v) { return lv(gF(u, v) * 0.7 + fF(u, v) * 0.3, 0.30, 0.80, 1.0); }),
      fine: mask2(w, h, function (u, v) { return lv(fF(u, v), 0.42, 0.72, 1.0); }),
      split: mask2(w, h, function (u, v) { return lv(kF(u, v), 0.86, 1.00, 1.4); })
    };
  }
  /**
   * 나뭇결 선 — 마스크 옥타브로는 절대 이만큼 또렷해지지 않는다.
   * U 축을 따라 흐르는 긴 곡선을 전면 해상도로 직접 긋는다 (캔버스 네이티브라 싸다).
   */
  function grainStrokes(ctx, S, o) {
    var r = U.rng(o.seed);
    var wob = nz(o.seed + '-w', 4, 4);
    var n = o.count, i, k;
    var segs = 8;
    var vert = !!o.vert;                       /* true 면 결이 캔버스 세로로 흐른다 */
    var w0 = o.lw0 == null ? 0.25 : o.lw0;
    var w1 = o.lw1 == null ? 1.6 : o.lw1;
    ctx.save();
    ctx.lineCap = 'round';
    for (i = 0; i < n; i++) {
      var y = r() * S;
      var amp = (0.004 + r() * 0.020) * S;
      var ph = r() * 4;
      var lw = (w0 + Math.pow(r(), 2) * w1) * (S / 256);
      var a = o.alphaMin + (o.alphaMax - o.alphaMin) * r();
      ctx.lineWidth = Math.max(0.6, lw);
      ctx.globalAlpha = a;
      ctx.strokeStyle = o.cols[Math.floor(r() * o.cols.length) % o.cols.length];
      /* 결은 폭 전체를 가로지르고 wob 의 주기가 4라서 양 끝이 저절로 맞는다 */
      var edge = amp + ctx.lineWidth;
      var offs = (y < edge) ? [0, S] : (y > S - edge ? [0, -S] : [0]);
      for (var q = 0; q < offs.length; q++) {
        ctx.beginPath();
        for (k = 0; k <= segs; k++) {
          var t = k / segs;
          var yy = y + offs[q] + wob(t * 4, ph) * amp;
          if (vert) { if (k === 0) ctx.moveTo(yy, 0); else ctx.lineTo(yy, t * S); }
          else { if (k === 0) ctx.moveTo(0, yy); else ctx.lineTo(t * S, yy); }
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 못/스파이크 자국 */
  function nailMarks(ctx, S, pts, isHeight, rad) {
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0] * S, y = pts[i][1] * S, r = rad * S;
      ctx.save();
      if (isHeight) {
        var g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.9);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
        g.addColorStop(0.80, 'rgba(255,255,255,0.30)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
      } else {
        var g2 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 1.7);
        g2.addColorStop(0, 'rgba(58,44,34,0.95)');
        g2.addColorStop(0.5, 'rgba(40,30,22,0.60)');
        g2.addColorStop(1, 'rgba(30,22,16,0)');
        ctx.fillStyle = g2;
      }
      ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /* 6a. 침목 — 크레오소트 짙은 갈색, 상면은 햇빛에 은빛으로 바램
     ⚠ 축 규약 (여기가 전부다):
       20-geometry 의 침목은 BoxGeometry(WID 0.26, TH, LEN 2.6) 이고 상면 UV 는
       **u = 폭 0.26 m · v = 길이 2.6 m**, repeat 0.385 → 텍셀 197×197 이 그 면을 덮는다.
       화면에서 침목은 길이 ≈180 px · 폭 ≈28 px 이므로
         · v(길이) 축은 거의 1:1 — 이 축의 디테일은 그대로 살아남는다
         · u(폭) 축은 7:1 로 축소 — 이 축으로 촘촘한 것은 전부 밉맵에 지워진다
       나뭇결은 침목 **길이 방향**으로 흘러야 하므로 캔버스에서는 **세로선**이고,
       결 사이 간격은 u 축이라 **20 텍셀 이상**이어야 화면에 남는다.
       예전 코드는 결을 캔버스 가로로 2.2 텍셀 간격으로 그었다 — 방향도 틀렸고
       주파수도 7배 높아서 화면에서는 저주파 얼룩만 남았다. */
  var SLP_WIN = 1 / 2.6;                       /* 침목 한 면이 쓰는 UV 창 */
  function buildSleeper() {
    var S = sz(0.5), N = sz(0.25, 256), R = sz(0.125, 128);
    /* 결 필드는 u 로 촘촘 · v 로 성기게 → 무늬가 길이 방향으로 길게 늘어난다 */
    var FW = fres(2), FH = Math.max(24, Math.round(fres(2) * 0.34));
    var gF = fbmF('slp-g', 26, 4, 3, 0.55);
    var fF = fbmF('slp-f', 58, 6, 2, 0.5);
    var kF = ridgeF('slp-k', 15, 3, 3, 0.5);
    var grain = mask2(FW, FH, function (u, v) { return lv(gF(u, v) * 0.72 + fF(u, v) * 0.28, 0.30, 0.80, 1.0); });
    var fine = mask2(FW, FH, function (u, v) { return lv(fF(u, v), 0.42, 0.74, 1.0); });
    var split = mask2(FW, FH, function (u, v) { return lv(kF(u, v), 0.83, 1.00, 1.5); });
    /* 은빛 바램은 **폭 방향으로 완만하게** — 길이 방향으로 얼룩지면 침목마다
       같은 얼룩이 같은 자리에 박혀 반복이 그대로 드러난다 (심사 지적) */
    var bleachF = fbmF('slp-b', 7, 2, 3, 0.6);
    var bleach = mask2(FW, Math.max(16, FH >> 1), function (u, v) { return lv(bleachF(u, v), 0.38, 0.86, 1.0); });
    var tarF = fbmF('slp-t', 11, 3, 3, 0.6);
    var tar = mask2(FW, FH, function (u, v) { return lv(tarF(u, v), 0.56, 0.95, 1.3); });

    /** 침목 긴 모서리(u = k·SLP_WIN)는 볕과 자갈에 닳아 밝고 둥글다 */
    function edgeBands(ctx, T, col, aMax) {
      ctx.save();
      for (var k = 0; k * SLP_WIN < 1.001; k++) {
        var px = k * SLP_WIN * T, w = SLP_WIN * T * 0.16;
        var g = ctx.createLinearGradient(px - w, 0, px + w, 0);
        g.addColorStop(0.0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, aMax)); g.addColorStop(1.0, hexA(col, 0));
        ctx.fillStyle = g; ctx.fillRect(px - w, 0, w * 2, T);
      }
      ctx.restore();
    }

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, P.sleeper);
    stamp(x, S, S, '#2b2018', grain, 0.58, 'multiply');
    stamp(x, S, S, '#6d5a48', fine, 0.34, 'screen');
    /* 은빛: 크레오소트가 자외선에 날아가 회백색 목질이 드러난다. 예전 #8b8175 는
       따뜻해서 "볕 든 갈색"으로 읽혔다 — 청회색 쪽으로 8% 밀고 면적을 넓혔다 */
    stamp(x, S, S, '#9c968c', bleach, 0.64, 'source-over');
    stamp(x, S, S, '#150e0a', tar, 0.56, 'multiply');             /* 크레오소트 얼룩 */
    /* 결 — 세로(침목 길이 방향), 간격 ≈24 텍셀, 굵기 4~22 텍셀 */
    grainStrokes(x, S, {
      vert: true, seed: 'slp-gs', count: Math.round(S / 24), lw0: 1.8, lw1: 9.0,
      alphaMin: 0.10, alphaMax: 0.42,
      cols: ['#241a13', '#33251b', '#1a120d', '#6a5c4e', '#8b8076', '#2c2018']
    });
    stamp(x, S, S, '#17110c', split, 0.80, 'source-over');        /* 갈라짐 */
    /* 큰 갈라짐 2~3줄 — 침목마다 확실히 보이는 검은 세로 균열 */
    grainStrokes(x, S, {
      vert: true, seed: 'slp-crk', count: Math.round(S / 90), lw0: 1.4, lw1: 4.2,
      alphaMin: 0.62, alphaMax: 0.95, cols: ['#100b07', '#1b120c']
    });
    edgeBands(x, S, '#a2907a', 0.24);
    patternFill(x, S, S, grainTile(64, 'slp-g', 0.38, 0.62), 0.22, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#7a7a7a');
    stamp(hx, N, N, '#ffffff', grain, 0.40, 'source-over');
    stamp(hx, N, N, '#3a3a3a', fine, 0.32, 'source-over');
    grainStrokes(hx, N, {
      vert: true, seed: 'slp-gs', count: Math.round(N / 24), lw0: 1.8, lw1: 9.0,
      alphaMin: 0.10, alphaMax: 0.40,
      cols: ['#2a2a2a', '#3c3c3c', '#1e1e1e', '#c8c8c8', '#e2e2e2', '#343434']
    });
    stamp(hx, N, N, '#000000', split, 0.95, 'source-over');
    grainStrokes(hx, N, {
      vert: true, seed: 'slp-crk', count: Math.round(N / 90), lw0: 1.4, lw1: 4.2,
      alphaMin: 0.70, alphaMax: 1.0, cols: ['#000000', '#0a0a0a']
    });
    edgeBands(hx, N, '#c8c8c8', 0.30);
    patternFill(hx, N, N, grainTile(64, 'slp-gh', 0.40, 0.60), 0.28, 'overlay');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#cdcdcd');                                    /* 목재 기본 0.80 */
    stamp(rx, R, R, '#ffffff', bleach, 0.80, 'source-over');        /* 바랜 곳 더 거침 */
    stamp(rx, R, R, '#767676', tar, 0.75, 'source-over');           /* 타르 젖은 곳 매끈 */
    stamp(rx, R, R, '#ffffff', split, 0.85, 'source-over');
    stamp(rx, R, R, '#9a9a9a', grain, 0.35, 'source-over');
    finishSet('sleeper', c.cv, hc.cv, rc.cv, { tile: 2.6, strength: 2.1, ao: 0.5, soften: 0.60, toks: 0.34 });
  }

  /* 6b. 판재 — 널빤지 3장, 옹이, 못머리, 모따기
     ⚠ 모아레 주의: 창고 벽은 **판자 13장이 실제 지오메트리**로 쌓여 있고, 판자 한 장의
     앞면은 5.6 m × 0.24 m 인데 이 텍스처가 uv 0..1 로 통째로 붙는다(창 0.417).
     즉 캔버스 세로 213 텍셀이 화면 7 px 로 눌린다(30:1). 여기에 판 경계선을 5줄이나
     그으면 판자마다 2줄이 7 px 안에 접혀 들어가 **그늘진 벽에서 모아레**가 된다.
     → 경계 줄 수를 3으로 낮추고, 딱딱한 1 px 검은 선을 넓은 소프트 밴드로 바꾸고,
       높이맵 홈의 진폭을 절반으로 줄인 뒤 Toksvig 로 남은 고주파를 거칠기에 흡수시킨다. */
  function buildWoodPlank() {
    var S = sz(0.5), N = sz(0.125, 128), R = sz(0.125, 128);
    var NB = 3;
    var W = woodFields('wp', 20, fres(2));
    var greyF = fbmF('wp-y', 5, 14, 3, 0.6);
    var grey = mask(fres(1), function (u, v) { return lv(greyF(u, v), 0.44, 0.90, 1.1); });

    function boards(ctx, S2, isHeight) {
      var r = U.rng('wp-boards');
      for (var i = 0; i < NB; i++) {
        var y0 = i / NB * S2, y1 = (i + 1) / NB * S2;
        var t = r();
        if (isHeight) {
          ctx.fillStyle = rgbStr(118 + t * 60);
          ctx.fillRect(0, y0, S2, y1 - y0);
          /* 모따기: 판 경계 홈. 진폭 0.95 → 0.52, 폭 3 → 5 (모아레 억제) */
          var gw = Math.max(1.5, S2 / 150);
          var g = ctx.createLinearGradient(0, y0, 0, y0 + gw * 5);
          g.addColorStop(0, 'rgba(0,0,0,0.52)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, y0, S2, gw * 5);
          var g2 = ctx.createLinearGradient(0, y1 - gw * 5, 0, y1);
          g2.addColorStop(0, 'rgba(0,0,0,0)');
          g2.addColorStop(1, 'rgba(0,0,0,0.52)');
          ctx.fillStyle = g2; ctx.fillRect(0, y1 - gw * 5, S2, gw * 5);
        } else {
          ctx.fillStyle = U.mixHex('#8a6c4a', '#6d5539', t);
          ctx.fillRect(0, y0, S2, y1 - y0);
          /* 딱딱한 1 px 선 대신 넓은 소프트 밴드 — 축소되면 그냥 옅은 그늘로 평균난다 */
          var sw = Math.max(2, S2 / 90);
          var gs = ctx.createLinearGradient(0, y0 - sw * 0.35, 0, y0 + sw);
          gs.addColorStop(0.00, 'rgba(32,24,17,0)');
          gs.addColorStop(0.32, 'rgba(32,24,17,0.52)');
          gs.addColorStop(1.00, 'rgba(32,24,17,0)');
          ctx.fillStyle = gs; ctx.fillRect(0, y0 - sw * 0.35, S2, sw * 1.35);
        }
        /* 옹이 1~2개 */
        var kn = r() < 0.75 ? 1 : 2;
        for (var k = 0; k < kn; k++) {
          var kx = r() * S2, ky = U.lerp(y0 + (y1 - y0) * 0.25, y1 - (y1 - y0) * 0.25, r());
          var kr = (0.010 + r() * 0.014) * S2;
          ctx.save();
          for (var ring = 5; ring >= 1; ring--) {
            var rr = kr * (0.35 + ring * 0.32);
            ctx.beginPath(); ctx.ellipse(kx, ky, rr, rr * 0.62, 0, 0, TAU);
            if (isHeight) { ctx.strokeStyle = ring % 2 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)'; }
            else { ctx.strokeStyle = ring % 2 ? 'rgba(44,30,18,0.55)' : 'rgba(120,92,60,0.40)'; }
            ctx.lineWidth = Math.max(1, S2 / 300); ctx.stroke();
          }
          ctx.beginPath(); ctx.ellipse(kx, ky, kr * 0.36, kr * 0.24, 0, 0, TAU);
          ctx.fillStyle = isHeight ? 'rgba(0,0,0,0.75)' : 'rgba(38,25,15,0.9)';
          ctx.fill();
          ctx.restore();
        }
      }
    }

    var c = newCv(S, S), x = c.ctx;
    boards(x, S, false);
    stamp(x, S, S, '#3d2c1d', W.grain, 0.45, 'multiply');
    stamp(x, S, S, '#a8875f', W.fine, 0.35, 'screen');
    stamp(x, S, S, '#9b937f', grey, 0.40, 'source-over');
    /* 결 밀도를 1/4 로. 캔버스 세로가 30:1 로 눌리는 사용처(창고 벽)에서 2.6 텍셀 간격
       결은 전부 밉맵에 지워지면서 지글거림만 남긴다. 대신 굵기를 3배로 키운다. */
    grainStrokes(x, S, {
      seed: 'wp-gs', count: Math.round(S / 10), lw0: 0.7, lw1: 4.0,
      alphaMin: 0.06, alphaMax: 0.30,
      cols: ['#4a3826', '#5c452f', '#3a2b1c', '#a08a63', '#b09a76', '#6b5237']
    });
    stamp(x, S, S, '#221812', W.split, 0.70, 'source-over');
    nailMarks(x, S, [[0.09, 0.10], [0.09, 0.50], [0.09, 0.90], [0.91, 0.30], [0.91, 0.70]], false, 0.011);
    patternFill(x, S, S, grainTile(64, 'wp-g', 0.40, 0.60), 0.22, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    boards(hx, N, true);
    stamp(hx, N, N, '#ffffff', W.grain, 0.28, 'source-over');
    grainStrokes(hx, N, {
      seed: 'wp-gs', count: Math.round(N / 10), lw0: 0.7, lw1: 4.0,
      alphaMin: 0.05, alphaMax: 0.26,
      cols: ['#2e2e2e', '#404040', '#222222', '#d2d2d2', '#e6e6e6', '#383838']
    });
    stamp(hx, N, N, '#000000', W.split, 0.85, 'source-over');
    nailMarks(hx, N, [[0.09, 0.10], [0.09, 0.50], [0.09, 0.90], [0.91, 0.30], [0.91, 0.70]], true, 0.011);
    patternFill(hx, N, N, grainTile(64, 'wp-gh', 0.42, 0.58), 0.26, 'overlay');

    var rc = newCv(R, R);
    fillC(rc.ctx, R, R, '#c0c0c0');
    stamp(rc.ctx, R, R, '#ffffff', grey, 0.80, 'source-over');       /* 은빛으로 삭은 곳 = 거침 */
    stamp(rc.ctx, R, R, '#7e7e7e', W.grain, 0.55, 'source-over');    /* 결이 살아있는 곳 = 매끈 */
    stamp(rc.ctx, R, R, '#ffffff', W.split, 0.80, 'source-over');
    finishSet('woodPlank', c.cv, hc.cv, rc.cv, { tile: 2.4, strength: 1.4, ao: 0.45, soften: 0.84, toks: 0.52 });
  }

  /* 6c. 레일 옆면(복부) — 압연 자국 + 녹 흘러내림 + 발밑 기름때
     ⚠ 축 규약: 20-geometry 의 레일 sweep 은 **u = 단면 파라미터(0=저부 → 0.5=두정면 → 0.84=저부),
     v = 호길이×0.5 (레일을 따라)** 다. 즉 이 캔버스의 **가로가 단면, 세로가 레일 길이**다.
     예전 코드는 이걸 반대로 알고 있어서 (a) 압연 줄무늬가 레일을 가로지르고
     (b) "발밑 기름때" 세로 그라데이션이 레일 길이 방향으로 걸려 **2 m 마다 어두운 띠**가
     생겼다. 근접 촬영에서 레일이 점선으로 보이던 두 번째 원인이다. 전부 축을 바로잡았다. */
  function buildRailSide() {
    var S = sz(0.25, 256), N = sz(0.125, 128), R = sz(0.125, 128);
    /* 녹·곰보는 레일 길이 방향으로 길게 늘어난 얼룩이어야 한다 (px≫py 는 u 축 고주파) */
    var rustF = fbmF('rs-r', 7, 3, 4, 0.55);
    var rust = mask(fres(1), function (u, v) { return lv(rustF(u, v), 0.42, 0.86, 1.0); });
    var pitF = fbmF('rs-p', 20, 20, 2, 0.5);
    var pit = mask(fres(2), function (u, v) { return lv(pitF(u, v), 0.70, 0.95, 1.3); });
    /* 압연 줄무늬 = 레일 길이 방향 = 세로. u(가로)로 촘촘, v(세로)로 성기게 */
    var rollF = fbmF('rs-l', 26, 3, 2, 0.5);
    var roll = mask2(fres(1), Math.round(fres(1) * 0.4), function (u, v) { return lv(rollF(u, v), 0.40, 0.72, 1.0); });

    /** 단면 방향 때 프로파일: 양쪽 끝(저부·레일 발) 이 가장 더럽고 가운데(머리)가 깨끗하다 */
    function footGrime(ctx, T, col, aMax) {
      var g = ctx.createLinearGradient(0, 0, T, 0);
      g.addColorStop(0.00, hexA(col, aMax));
      g.addColorStop(0.18, hexA(col, aMax * 0.62));
      g.addColorStop(0.40, hexA(col, 0));
      g.addColorStop(0.60, hexA(col, 0));
      g.addColorStop(0.80, hexA(col, aMax * 0.62));
      g.addColorStop(1.00, hexA(col, aMax));
      ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
    }

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, P.railRust);
    stamp(x, S, S, '#4a423c', roll, 0.35, 'multiply');
    stamp(x, S, S, P.rust, rust, 0.70, 'source-over');
    stamp(x, S, S, P.rustHi, pit, 0.45, 'source-over');
    stamp(x, S, S, P.rustDark, pit, 0.30, 'multiply');
    dripStreaks(x, S, 'rs-drip', 'rgba(78,42,24,0.55)', 30, 0.26, 1.0, true);  /* 단면을 따라 흘러내린다 */
    footGrime(x, S, '#16120f', 0.72);
    patternFill(x, S, S, grainTile(64, 'rs-g', 0.40, 0.60), 0.26, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#909090');
    stamp(hx, N, N, '#c8c8c8', roll, 0.30, 'source-over');
    stamp(hx, N, N, '#e0e0e0', rust, 0.35, 'source-over');
    stamp(hx, N, N, '#151515', pit, 0.70, 'source-over');
    patternFill(hx, N, N, grainTile(64, 'rs-gh', 0.40, 0.60), 0.30, 'overlay');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#8c8c8c');                            /* 압연 그대로인 강재 ≈0.55 */
    stamp(rx, R, R, '#ffffff', rust, 0.85, 'source-over');  /* 녹 = 아주 거침 */
    stamp(rx, R, R, '#ffffff', pit, 0.70, 'source-over');
    stamp(rx, R, R, '#6e6e6e', roll, 0.40, 'source-over');
    footGrime(rx, R, '#606060', 0.72);
    finishSet('railSide', c.cv, hc.cv, rc.cv, { tile: 1.0, strength: 1.5, soften: 0.62, toks: 0.32 });
    /* 레일 방향(v) 반복을 0.4/m 로 낮춘다 — 예전 0.5/m(2 m 주기)는 침목 간격의 정수배라
       주기성이 화면에서 바로 읽혔다. 2.5 m 주기 + 무리수적 어긋남으로 눈에 안 띈다. */
    setRepeat('railSide', 1.0, 0.4);
  }

  /* 6d. 레일 두정면(크라운) — 바퀴가 닦아 놓은 **연속** 강철 밴드.
     15-materials 가 tex:'railHead' 로 갈아타면 곧바로 쓰인다(현재는 metalPlate 의
     레인이 같은 일을 한다). 어떤 u 를 잡아도 크라운으로 읽히도록 가로는 거의 균일하게,
     변주는 레일 길이(v) 방향 저주파 fbm 으로만 준다 — dash 금지. */
  function buildRailHead() {
    var S = sz(0.25, 256), N = sz(0.125, 128), R = sz(0.125, 128);
    var wearN = nz('rh-wear', 3, 7);
    function wearAt(v) { return U.fbm(wearN, 1.3, v * 7, 2, 2, 0.5) * 0.5 + 0.5; }
    /* 아주 얕은 길이방향 연마 자국. 가로 고주파 / 세로 저주파 = 결이 레일을 따라 흐른다 */
    var grindF = fbmF('rh-gr', 30, 2, 2, 0.5);
    var grind = mask2(fres(1), Math.round(fres(1) * 0.3), function (u, v) { return lv(grindF(u, v), 0.42, 0.74, 1.0); });

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, P.railHead);
    for (var y0 = 0; y0 < S; y0 += 2) {
      var w = wearAt((y0 + 0.5) / S);
      x.globalAlpha = 0.34;
      x.fillStyle = U.mixHex('#9a958c', '#e2ded4', w);
      x.fillRect(0, y0, S, 2);
    }
    x.globalAlpha = 1;
    stamp(x, S, S, '#8d877e', grind, 0.30, 'source-over');
    /* 게이지 코너(가장자리) 는 바퀴가 안 닿아 녹이 남는다 — 가로 양 끝만 */
    gradFill(x, S, S, 0, 0, S, 0,
      [[0, hexA(P.rust, 0.85)], [0.13, hexA(P.rust, 0.10)], [0.87, hexA(P.rust, 0.10)], [1, hexA(P.rust, 0.85)]], 1);
    patternFill(x, S, S, grainTile(64, 'rh-g', 0.46, 0.54), 0.12, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#808080');
    stamp(hx, N, N, '#909090', grind, 0.40, 'source-over');       /* 진폭 극소 — 크라운은 평탄해야 한다 */

    var rc = newCv(R, R), rx = rc.ctx;
    for (var ry = 0; ry < R; ry++) {
      var vv = (wearAt((ry + 0.5) / R) - 0.5) * 0.16;
      for (var cx2 = 0; cx2 < R; cx2++) {
        var d = Math.abs((cx2 + 0.5) / R - 0.5) * 2;                  /* 0 중심 → 1 가장자리 */
        var rr = U.lerp(0.50 + vv, 0.94, U.smooth(lv(d, 0.55, 1.0, 1.0)));
        rx.fillStyle = rgbStr(rr * 255);
        rx.fillRect(cx2, ry, 1, 1);
      }
    }
    finishSet('railHead', c.cv, hc.cv, rc.cv, { tile: 1.0, strength: 0.35, soften: 0.85, toks: 0.10 });
    setRepeat('railHead', 1.0, 0.25);
  }

  /* 세로로 흘러내린 자국 (녹물·때) — 여러 텍스처에서 재사용.
     horiz=true 면 가로 방향으로 흐른다 (UV 축이 뒤바뀐 스윕 메시용: 레일 단면 등) */
  function dripStreaks(ctx, S, seed, col, count, maxLen, wMul, horiz) {
    var r = U.rng(seed);
    ctx.save();
    for (var i = 0; i < count; i++) {
      var x = r() * S;
      var y0 = r() * S * 0.75;
      var len = U.lerp(0.05, maxLen, Math.pow(r(), 1.4)) * S;
      var w = Math.max(1, (0.6 + r() * 2.4) * (wMul || 1) * S / 256);
      var g = horiz ? ctx.createLinearGradient(y0, 0, y0 + len, 0)
                    : ctx.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, col);
      g.addColorStop(0.15, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.35 + r() * 0.5;
      ctx.fillStyle = g;
      if (horiz) {
        ctx.fillRect(y0, x, len, w);
        if (x > S - w) ctx.fillRect(y0, x - S, len, w);
      } else {
        ctx.fillRect(x, y0, w, len);
        if (x > S - w) ctx.fillRect(x - S, y0, w, len);
      }
    }
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. 콘크리트 — 골재 반점, 거푸집 자국, 모서리 깨짐, 흘러내린 얼룩
     ══════════════════════════════════════════════════════════════════════ */
  function buildConcrete() {
    var S = sz(0.5), N = sz(0.125, 128), R = sz(0.125, 128);
    var blotF = fbmF('cc-b', 4, 4, 4, 0.6);
    var blot = mask(fres(0), function (u, v) { return lv(blotF(u, v), 0.40, 0.86, 1.0); });
    var FR = fres(1);
    var aggPit = fieldArr(FR, function (u, v) {
      return U.fbm(nz('cc-ap', 20, 20), u * 20, v * 20, 3, 2, 0.5) * 0.5 + 0.5;
    });
    var pit = arrMask(aggPit, FR, 0.74, 0.97, 1.4);
    var agg = arrMask(aggPit, FR, 0.42, 0.62, 1.0);
    var stainF = fbmF('cc-s', 3, 8, 3, 0.6);
    var stain = mask2(Math.round(fres(1) * 0.5), fres(1), function (u, v) { return lv(stainF(u, v), 0.56, 0.95, 1.3); });

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#9a978f');
    stamp(x, S, S, '#7e7b73', blot, 0.55, 'source-over');
    stamp(x, S, S, '#b3b0a6', agg, 0.35, 'source-over');
    stamp(x, S, S, '#54514a', pit, 0.55, 'source-over');
    stamp(x, S, S, '#5c5850', stain, 0.35, 'multiply');
    formLines(x, S, false);
    dripStreaks(x, S, 'cc-drip', 'rgba(70,66,58,0.40)', 26, 0.42, 1.6);
    chippedCorners(x, S, 'cc-chip', '#c3bfb4', false);
    patternFill(x, S, S, grainTile(64, 'cc-g', 0.42, 0.58), 0.26, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#a0a0a0');
    stamp(hx, N, N, '#cccccc', agg, 0.35, 'source-over');
    stamp(hx, N, N, '#101010', pit, 0.85, 'source-over');
    stamp(hx, N, N, '#8a8a8a', blot, 0.25, 'source-over');
    formLines(hx, N, true);
    chippedCorners(hx, N, 'cc-chip', '#2a2a2a', true);
    patternFill(hx, N, N, grainTile(64, 'cc-gh', 0.42, 0.58), 0.30, 'overlay');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#b4b4b4');                                  /* 매끈하게 마감된 면 ≈0.70 */
    stamp(rx, R, R, '#ffffff', pit, 0.90, 'source-over');        /* 곰보 = 거침 */
    stamp(rx, R, R, '#8a8a8a', stain, 0.60, 'source-over');      /* 물 흐른 자국 = 매끈 */
    stamp(rx, R, R, '#e6e6e6', blot, 0.45, 'source-over');
    stamp(rx, R, R, '#f4f4f4', agg, 0.35, 'source-over');
    finishSet('concrete', c.cv, hc.cv, rc.cv, { tile: 2.5, strength: 1.4, ao: 0.5, soften: 0.70 });
  }
  /** 거푸집 판재 자국 — 가로 3줄 */
  function formLines(ctx, S, isHeight) {
    ctx.save();
    for (var i = 1; i < 3; i++) {
      var y = i / 3 * S;
      ctx.fillStyle = isHeight ? 'rgba(0,0,0,0.55)' : 'rgba(70,66,58,0.45)';
      ctx.fillRect(0, y - Math.max(1, S / 380), S, Math.max(1.5, S / 190));
      ctx.fillStyle = isHeight ? 'rgba(255,255,255,0.30)' : 'rgba(180,176,166,0.22)';
      ctx.fillRect(0, y + Math.max(1, S / 190), S, Math.max(1, S / 380));
    }
    ctx.restore();
  }
  /** UV 가장자리 근처가 깨져 속살이 드러난 자국 */
  function chippedCorners(ctx, S, seed, col, isHeight) {
    var r = U.rng(seed), n = 14;
    ctx.save();
    ctx.fillStyle = col;
    for (var i = 0; i < n; i++) {
      var edge = Math.floor(r() * 4);
      var t = r();
      var d = Math.pow(r(), 2.2) * 0.06 * S;
      var px = edge === 0 ? t * S : (edge === 1 ? S - d : (edge === 2 ? t * S : d));
      var py = edge === 0 ? d : (edge === 1 ? t * S : (edge === 2 ? S - d : t * S));
      var rad = (0.006 + r() * 0.020) * S;
      var jit = []; for (var k = 0; k < 6; k++) jit.push(0.55 + 0.7 * r());
      ctx.globalAlpha = isHeight ? 0.75 : (0.45 + r() * 0.45);
      stonePath(ctx, px, py, rad, 0.8, r() * TAU, jit);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. 부식 강판 — 딱지처럼 일어난 녹, 곰보, 흘러내린 자국
     ══════════════════════════════════════════════════════════════════════ */
  function buildRustSheet() {
    var S = sz(0.5), N = sz(0.125, 128), R = sz(0.125, 128);
    /* 딱지/파임은 한 필드에서 임계값만 달리해 세 장 뽑는다 (픽셀 루프 1회) */
    var rustA = fieldArr(fres(2), function (u, v) {
      var n = nz('rt-a', 10, 10);
      return U.fbm(n, u * 10, v * 10, 4, 2, 0.52) * 0.5 + 0.5;
    });
    var scab = arrMask(rustA, fres(2), 0.30, 0.62, 1.0);
    var deep = arrMask(rustA, fres(2), 0.56, 0.86, 1.1);
    var pit = arrMask(rustA, fres(2), 0.78, 0.96, 1.5);
    var flakeF = ridgeF('rt-f', 9, 9, 3, 0.5);
    var flake = mask(fres(1), function (u, v) { return lv(flakeF(u, v), 0.78, 0.99, 1.2); });

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, P.rust);
    stamp(x, S, S, P.rustHi, scab, 0.70, 'source-over');
    stamp(x, S, S, P.rustDark, deep, 0.65, 'source-over');
    stamp(x, S, S, '#c08a4e', flake, 0.42, 'source-over');       /* 일어난 딱지 가장자리 */
    stamp(x, S, S, '#25160e', pit, 0.55, 'source-over');
    dripStreaks(x, S, 'rt-drip', 'rgba(96,50,26,0.6)', 40, 0.55, 1.4);
    gradFill(x, S, S, 0, S * 0.6, 0, S, [[0, 'rgba(40,30,24,0)'], [1, 'rgba(38,30,24,0.55)']], 1);
    patternFill(x, S, S, grainTile(64, 'rt-g', 0.38, 0.62), 0.30, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#8c8c8c');
    stamp(hx, N, N, '#e2e2e2', scab, 0.45, 'source-over');
    stamp(hx, N, N, '#f2f2f2', flake, 0.55, 'source-over');
    stamp(hx, N, N, '#1a1a1a', pit, 0.60, 'source-over');
    stamp(hx, N, N, '#3a3a3a', deep, 0.35, 'source-over');
    patternFill(hx, N, N, grainTile(64, 'rt-gh', 0.42, 0.58), 0.20, 'overlay');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#e2e2e2');
    stamp(rx, R, R, '#a8a8a8', scab, 0.55, 'source-over');   /* 아직 단단한 딱지는 덜 거침 */
    stamp(rx, R, R, '#ffffff', pit, 0.85, 'source-over');
    stamp(rx, R, R, '#ffffff', deep, 0.45, 'source-over');
    finishSet('rustSheet', c.cv, hc.cv, rc.cv, { tile: 2.0, strength: 2.0, ao: 0.55, soften: 0.60 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. 체커 플레이트 — 다이아몬드 돌기. 윗면만 닳아 반들반들
     ══════════════════════════════════════════════════════════════════════ */
  function buildMetalPlate() {
    var S = sz(0.25, 256), N = sz(0.25, 256), R = sz(0.125, 128);
    var CELLS = 8;

    function tread(ctx, T, isHeight) {
      var cw = T / CELLS;
      for (var gy = 0; gy < CELLS; gy++) {
        for (var gx = 0; gx < CELLS; gx++) {
          var cx = (gx + 0.5) * cw, cy = (gy + 0.5) * cw;
          for (var k = 0; k < 2; k++) {
            var ang = (gy % 2 === 0 ? 1 : -1) * (k === 0 ? 0.62 : -0.62);
            var ox = (k === 0 ? -0.22 : 0.22) * cw;
            var oy = (k === 0 ? -0.18 : 0.18) * cw;
            ctx.save();
            ctx.translate(cx + ox, cy + oy);
            ctx.rotate(ang);
            var w = cw * 0.52, h = cw * 0.16;
            if (isHeight) {
              var g = ctx.createLinearGradient(0, -h, 0, h);
              g.addColorStop(0, 'rgba(255,255,255,0.10)');
              g.addColorStop(0.42, 'rgba(255,255,255,0.95)');
              g.addColorStop(1, 'rgba(0,0,0,0.55)');
              ctx.fillStyle = g;
            } else {
              var g2 = ctx.createLinearGradient(0, -h, 0, h);
              g2.addColorStop(0, 'rgba(196,200,205,0.85)');
              g2.addColorStop(0.45, 'rgba(168,172,178,0.85)');
              g2.addColorStop(1, 'rgba(74,78,84,0.85)');
              ctx.fillStyle = g2;
            }
            ctx.beginPath();
            ctx.moveTo(-w * 0.5, 0); ctx.lineTo(0, -h); ctx.lineTo(w * 0.5, 0); ctx.lineTo(0, h);
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
        }
      }
    }
    var grimeF = fbmF('mp-g', 5, 5, 4, 0.6);
    var grime = mask(fres(1), function (u, v) { return lv(grimeF(u, v), 0.48, 0.92, 1.1); });
    var wearF = fbmF('mp-w', 3, 3, 3, 0.55);
    var wear = mask(fres(0), function (u, v) { return lv(wearF(u, v), 0.42, 0.86, 1.0); });

    /* ── 레일 두정면 레인 ────────────────────────────────────────────────
       20-geometry 의 레일 단면은 **크라운(머리 상면)에 u ∈ [0.43, 0.57] 만** 할당한다
       (railProfile: g=1 구간). 즉 이 맵의 가로 14% 짜리 세로 띠가 곧 레일 상면이고,
       세로축 v = 호길이 × 0.5 로 레일을 따라 흐른다.
       거기에 다이아 돌기가 실리면 크라운의 노멀·AO·Toksvig 가 전부 0.25 m 주기로
       끊겨 **흰 구슬 목걸이**가 된다 (R2 심사 C: 화면에서 가장 눈에 띄는 결함).
       → 그 띠만 돌기를 지우고 v 방향으로 완전히 연속인 닦인 강철 밴드로 바꾼다.
       다이아플레이트를 쓰는 통로판에서는 사람이 다닌 자리가 닳아 반들해진 것으로 읽힌다. */
    var LANE_C = 0.50, LANE_HW = 0.105, LANE_FE = 0.055;   /* 중심 / 반폭 / 페더 */
    /** 레인 알파 프로파일 (가로 그라데이션) */
    function laneGrad(ctx, T, col, aIn) {
      var x0 = (LANE_C - LANE_HW - LANE_FE) * T, x1 = (LANE_C + LANE_HW + LANE_FE) * T;
      var f = LANE_FE / (LANE_HW + LANE_FE) * 0.5;
      var g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, hexA(col, 0));
      g.addColorStop(f, hexA(col, aIn));
      g.addColorStop(1 - f, hexA(col, aIn));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0, 0, x1 - x0, T);
    }
    /** 레일 길이방향 저주파 마모 변주 (옥타브 2) — dash 대신 이것이 변주를 준다 */
    var laneN = nz('mp-lane', 3, 5);
    function laneVar(v) { return U.fbm(laneN, 1.7, v * 5, 2, 2, 0.5) * 0.5 + 0.5; }

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#7c8085');
    tread(x, S, false);
    stamp(x, S, S, '#b9bcc0', wear, 0.32, 'source-over');
    stamp(x, S, S, '#3f3a33', grime, 0.42, 'multiply');
    stamp(x, S, S, P.rust, grime, 0.16, 'source-over');
    patternFill(x, S, S, grainTile(64, 'mp-g2', 0.44, 0.56), 0.22, 'overlay');
    /* 레인 = 닦인 강철. v 방향 연속 밴드 위에 저주파 마모만 얹는다 */
    laneGrad(x, S, '#b5b8bb', 0.92);
    x.save();
    for (var ly = 0; ly < S; ly += 2) {
      var lvv = laneVar((ly + 0.5) / S);
      x.globalAlpha = 0.30;
      x.fillStyle = U.mixHex('#8d9095', '#d6d3cc', lvv);
      x.fillRect((LANE_C - LANE_HW) * S, ly, LANE_HW * 2 * S, 2);
    }
    x.restore();

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#5a5a5a');
    tread(hx, N, true);
    patternFill(hx, N, N, grainTile(64, 'mp-gh', 0.46, 0.54), 0.22, 'overlay');
    /* 레인은 평탄 — 노멀 진폭 0. AO 맵과 Toksvig 도 같은 높이맵에서 유도되므로
       여기서 눌러 두면 세 경로가 동시에 조용해진다. */
    laneGrad(hx, N, '#5a5a5a', 1.0);

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#b0b0b0');
    stamp(rx, R, R, '#8e8e8e', wear, 0.60, 'source-over');       /* 닳은 돌기 = 매끈 (바닥값을 0.36→0.56 로
                                                                    올렸다: railHead 가 실효 0.065 까지
                                                                    내려가 레일 두정면이 점선으로 부서졌다) */
    stamp(rx, R, R, '#f0f0f0', grime, 0.60, 'source-over');      /* 때 낀 골 = 거침 */
    /* 레인 거칠기: 중심 0.52(→ 실효 0.12) 에서 필렛 쪽 0.90 까지 선형 롤오프.
       변주는 dash 가 아니라 저주파 fbm(진폭 0.08)으로만 준다 → 하이라이트가 이어진다. */
    (function () {
      var x0 = Math.floor((LANE_C - LANE_HW - LANE_FE) * R);
      var x1 = Math.ceil((LANE_C + LANE_HW + LANE_FE) * R);
      for (var ry = 0; ry < R; ry++) {
        var vv = (laneVar((ry + 0.5) / R) - 0.5) * 0.16;
        for (var rx2 = x0; rx2 < x1; rx2++) {
          var d = Math.abs((rx2 + 0.5) / R - LANE_C);
          var w = 1 - U.smooth(U.clamp01((d - LANE_HW * 0.35) / (LANE_HW + LANE_FE - LANE_HW * 0.35)));
          var g = U.clamp((0.52 + vv) * 255, 0, 255);
          rx.globalAlpha = w;
          rx.fillStyle = rgbStr(g);
          rx.fillRect(rx2, ry, 1, 1);
        }
      }
      rx.globalAlpha = 1;
    })();
    /* 다이아 돌기는 노멀 주파수가 이 파일에서 가장 높다. railHead(거칠기 0.18) ·
       plate(0.4) 가 같은 맵을 쓰기 때문에 소프트닝 + 강한 Toksvig 가 없으면
       급수탑 골판과 통로 그레이팅이 원경에서 소금후추 밭이 된다. */
    finishSet('metalPlate', c.cv, hc.cv, rc.cv,
      { tile: 1.0, strength: 2.2, ao: 0.5, soften: 0.46, toks: 0.55 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     10. 방수포 — 성긴 직조 + 접힌 주름 + 아래쪽 때
     ══════════════════════════════════════════════════════════════════════ */
  function weaveTile(res, a, b) {
    var c = U.canvas(res, res), t = res / 2;
    var ctx = c.ctx;
    ctx.fillStyle = a; ctx.fillRect(0, 0, res, res);
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, t, t); ctx.fillRect(t, t, t, t);
    return c.cv;
  }
  function buildTarpaulin() {
    var S = sz(0.25, 256), N = sz(0.125, 128), R = sz(0.09, 96);
    var foldF = fbmF('tp-f', 3, 5, 3, 0.6);
    var fold = mask(fres(1), function (u, v) { return lv(foldF(u, v), 0.40, 0.80, 1.0); });
    var creaseF = ridgeF('tp-c', 4, 6, 3, 0.5);
    var crease = mask(fres(1), function (u, v) { return lv(creaseF(u, v), 0.72, 0.98, 1.2); });
    var dirtF = fbmF('tp-d', 6, 6, 3, 0.6);
    var dirt = mask(fres(1), function (u, v) { return lv(dirtF(u, v), 0.52, 0.92, 1.2); });
    var wv = weaveTile(8, '#5a6150', '#4c5344');

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#525a49');
    patternFill(x, S, S, wv, 0.55, 'source-over');
    stamp(x, S, S, '#39402f', fold, 0.42, 'multiply');
    stamp(x, S, S, '#7c8369', crease, 0.45, 'source-over');       /* 접힌 능선은 색이 바램 */
    stamp(x, S, S, '#3a3327', dirt, 0.40, 'multiply');
    gradFill(x, S, S, 0, S * 0.62, 0, S, [[0, 'rgba(52,45,36,0)'], [1, 'rgba(52,45,36,0.62)']], 1);
    patternFill(x, S, S, grainTile(64, 'tp-g', 0.42, 0.58), 0.24, 'overlay');

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#808080');
    patternFill(hx, N, N, weaveTile(8, '#8e8e8e', '#6e6e6e'), 0.85, 'source-over');
    stamp(hx, N, N, '#3c3c3c', fold, 0.55, 'source-over');
    stamp(hx, N, N, '#e4e4e4', crease, 0.65, 'source-over');
    patternFill(hx, N, N, grainTile(64, 'tp-gh', 0.42, 0.58), 0.26, 'overlay');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#e2e2e2');
    stamp(rx, R, R, '#bdbdbd', crease, 0.45, 'source-over');
    stamp(rx, R, R, '#ffffff', dirt, 0.55, 'source-over');
    finishSet('tarpaulin', c.cv, hc.cv, rc.cv, { tile: 2.0, strength: 1.5, ao: 0.4, soften: 0.70, toks: 0.34 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     11. 더러운 유리 — 대부분 매끈, 때 낀 곳만 거칠다
     ══════════════════════════════════════════════════════════════════════ */
  function buildGlassDirt() {
    var S = sz(0.25, 256), N = sz(0.09, 96), R = sz(0.125, 128);
    var grimeF = fbmF('gl-g', 4, 4, 4, 0.6);
    var grime = mask(fres(1), function (u, v) {
      var e = 1 - U.smooth(U.clamp01(Math.min(u, 1 - u, v, 1 - v) / 0.22));   /* 가장자리에 때 */
      return lv(grimeF(u, v) * 0.65 + e * 0.5, 0.46, 0.86, 1.1);
    });
    var spotF = fbmF('gl-s', 18, 18, 2, 0.5);
    var spot = mask(fres(1), function (u, v) { return lv(spotF(u, v), 0.66, 0.90, 1.4); });

    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, '#e9edf0');
    stamp(x, S, S, '#b6b2a6', grime, 0.55, 'source-over');
    stamp(x, S, S, '#cfd6da', spot, 0.40, 'source-over');
    dripStreaks(x, S, 'gl-drip', 'rgba(150,146,132,0.35)', 22, 0.55, 0.8);
    gradFill(x, S, S, 0, S * 0.72, 0, S, [[0, 'rgba(140,134,120,0)'], [1, 'rgba(140,134,120,0.45)']], 1);

    var hc = newCv(N, N), hx = hc.ctx;
    fillC(hx, N, N, '#808080');
    stamp(hx, N, N, '#9a9a9a', grime, 0.45, 'source-over');
    stamp(hx, N, N, '#6c6c6c', spot, 0.40, 'source-over');

    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#0d0d0d');                                   /* 깨끗한 유리 ≈ 0.05 */
    stamp(rx, R, R, '#8a8a8a', grime, 0.85, 'source-over');
    stamp(rx, R, R, '#5a5a5a', spot, 0.60, 'source-over');
    dripStreaks(rx, R, 'gl-drip', 'rgba(120,120,120,0.55)', 22, 0.55, 0.8);
    finishSet('glassDirt', c.cv, hc.cv, rc.cv, { tile: 1.5, strength: 0.7, toks: 0 });
  }

  /* ══════════════════════════════════════════════════════════════════════
     12. 도장 강판 — Tex.paint(hex, seed)
     구조(패널 리브 / 용접 비드 / 리벳)는 시드 변종당 1회만 굽고 색상별로 공유한다.
     구조는 색과 무관하고, 벗겨진 도장은 0.1mm 라 노멀에 기여하지 않는다.
     ══════════════════════════════════════════════════════════════════════ */

  /**
   * 패널 이음 홈 — 높이맵에 눌린 홈 + 양옆 융기. vert=true 면 u 축 위치, false 면 v 축.
   * **두 축 모두 긋는 것이 핵심이다.** 스윕 메시(기관차 후드·탱크 배럴)는 단면 파라미터
   * 축이 10배 늘어나 한 축만 그으면 그쪽이 통째로 뭉개져 "무텍스처 회색 슬래브"가 된다.
   */
  function grooveH(ctx, PN, vert, t, gw, deep) {
    var p = t * PN, w = gw * 2.4;
    var g = vert ? ctx.createLinearGradient(p - w, 0, p + w, 0)
      : ctx.createLinearGradient(0, p - w, 0, p + w);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.20, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.36, 'rgba(0,0,0,' + deep + ')');
    g.addColorStop(0.64, 'rgba(0,0,0,' + deep + ')');
    g.addColorStop(0.80, 'rgba(255,255,255,0.34)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    if (vert) ctx.fillRect(p - w, 0, w * 2, PN);
    else ctx.fillRect(0, p - w, PN, w * 2);
  }
  /** 같은 자리를 알파 마스크로. lit=true 면 홈 옆 밝은 입술, false 면 홈 안쪽 그늘 */
  function grooveMask(ctx, PN, vert, t, gw, lit) {
    var p = t * PN, w = gw * 2.4;
    var g = vert ? ctx.createLinearGradient(p - w, 0, p + w, 0)
      : ctx.createLinearGradient(0, p - w, 0, p + w);
    if (lit) {
      g.addColorStop(0.00, 'rgba(255,255,255,0)');
      g.addColorStop(0.19, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.33, 'rgba(255,255,255,0)');
      g.addColorStop(0.67, 'rgba(255,255,255,0)');
      g.addColorStop(0.81, 'rgba(255,255,255,0.95)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0.00, 'rgba(255,255,255,0)');
      g.addColorStop(0.34, 'rgba(255,255,255,1)');
      g.addColorStop(0.66, 'rgba(255,255,255,1)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = g;
    if (vert) ctx.fillRect(p - w, 0, w * 2, PN);
    else ctx.fillRect(0, p - w, PN, w * 2);
  }

  /**
   * 구조 높이맵 + 정렬용 알파 마스크. variant 0..1.
   * 리벳 색조를 예전처럼 paint() 안에서 수백 개의 radialGradient 로 그리면 화차 한 대마다
   * 그 비용을 다시 낸다 → 여기서 **밝은면/그늘면 마스크 두 장으로 구워** 두고
   * paint() 는 drawImage 두 번으로 끝낸다. 덕분에 리벳을 3배 촘촘히 박을 수 있다.
   */
  function paintStruct(variant) {
    var key = 'v' + variant + '_' + Q;
    if (structCache[key]) return structCache[key];
    var PN = sz(0.5, 512);
    var r = U.rng('paint-struct-' + variant);
    var h = newCv(PN, PN), hx = h.ctx;
    fillC(hx, PN, PN, '#808080');

    var gw = Math.max(1.5, PN / 165);
    var i, k, j;

    /* 1) 패널 격자 — u 축 6줄 / v 축 4줄. 어느 쪽으로 늘어나도 최소 한 축은 살아남는다 */
    var NU = 6, NV = 4;
    var ribX = [], seamY = [];
    for (i = 0; i < NU; i++) ribX.push((i + 0.5 + (r() - 0.5) * 0.16) / NU);
    for (i = 0; i < NV; i++) seamY.push((i + 0.5 + (r() - 0.5) * 0.16) / NV);
    for (i = 0; i < NU; i++) grooveH(hx, PN, true, ribX[i], gw, 0.50);
    for (i = 0; i < NV; i++) grooveH(hx, PN, false, seamY[i], gw, 0.44);

    /* 2) 용접 비드 1~2줄 — 울퉁불퉁한 돌출 */
    var beads = 1 + (r() < 0.5 ? 1 : 0);
    var beadY = [];
    for (i = 0; i < beads; i++) {
      var by = (0.16 + r() * 0.68) * PN;
      beadY.push(by / PN);
      var bw = Math.max(2.0, PN / 165);
      var step = Math.max(2, PN / 190);
      for (var xx = 0; xx <= PN; xx += step) {
        var wob = Math.sin(xx / PN * 46 + variant) * bw * 0.55 + (r() - 0.5) * bw * 0.7;
        var rr = bw * (0.85 + r() * 0.55);
        var bg = hx.createRadialGradient(xx, by + wob, 0, xx, by + wob, rr * 1.7);
        bg.addColorStop(0, 'rgba(255,255,255,0.85)');
        bg.addColorStop(0.55, 'rgba(255,255,255,0.42)');
        bg.addColorStop(1, 'rgba(255,255,255,0)');
        hx.fillStyle = bg;
        hx.beginPath(); hx.arc(xx, by + wob, rr * 1.7, 0, TAU); hx.fill();
      }
      var sg = hx.createLinearGradient(0, by + bw, 0, by + bw * 3.4);
      sg.addColorStop(0, 'rgba(0,0,0,0.42)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      hx.fillStyle = sg; hx.fillRect(0, by + bw, PN, bw * 2.4);
    }

    /* 3) 리벳 — 모든 이음선을 따라 한 줄씩 + 가장자리 둘레. 지오메트리가 아니라 높이맵. */
    var rivU = 28, rivV = 24;
    var rivR = Math.max(1.3, PN / 210);
    var rivPts = [];
    var edgeIn = 0.030;
    for (i = 0; i < rivU; i++) {
      var t = (i + 0.5) / rivU;
      rivPts.push([t, edgeIn], [t, 1 - edgeIn]);
      for (j = 0; j < NV; j++) rivPts.push([t, seamY[j]]);
    }
    for (i = 0; i < rivV; i++) {
      var t2 = (i + 0.5) / rivV;
      rivPts.push([edgeIn, t2], [1 - edgeIn, t2]);
      for (j = 0; j < NU; j++) rivPts.push([ribX[j], t2]);
    }
    /* 밝은면 / 그늘면을 따로 구워 색상별 합성 때 재사용한다 */
    var rHi = newCv(PN, PN), rLo = newCv(PN, PN);
    for (i = 0; i < rivPts.length; i++) {
      var rx2 = rivPts[i][0] * PN, ry2 = rivPts[i][1] * PN;
      var rg = hx.createRadialGradient(rx2 - rivR * 0.35, ry2 - rivR * 0.35, 0, rx2, ry2, rivR * 1.55);
      rg.addColorStop(0.00, 'rgba(255,255,255,0.72)');
      rg.addColorStop(0.52, 'rgba(255,255,255,0.40)');
      rg.addColorStop(0.74, 'rgba(128,128,128,0.10)');
      rg.addColorStop(0.90, 'rgba(0,0,0,0.24)');
      rg.addColorStop(1.00, 'rgba(0,0,0,0)');
      hx.fillStyle = rg;
      hx.beginPath(); hx.arc(rx2, ry2, rivR * 1.6, 0, TAU); hx.fill();

      var gh = rHi.ctx.createRadialGradient(rx2 - rivR * 0.4, ry2 - rivR * 0.4, 0, rx2, ry2, rivR * 1.1);
      gh.addColorStop(0, 'rgba(255,255,255,1)');
      gh.addColorStop(1, 'rgba(255,255,255,0)');
      rHi.ctx.fillStyle = gh;
      rHi.ctx.beginPath(); rHi.ctx.arc(rx2, ry2, rivR * 1.1, 0, TAU); rHi.ctx.fill();

      var gl = rLo.ctx.createRadialGradient(rx2, ry2, rivR * 0.7, rx2, ry2, rivR * 1.7);
      gl.addColorStop(0, 'rgba(255,255,255,0)');
      gl.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      gl.addColorStop(1, 'rgba(255,255,255,0)');
      rLo.ctx.fillStyle = gl;
      rLo.ctx.beginPath(); rLo.ctx.arc(rx2, ry2, rivR * 1.7, 0, TAU); rLo.ctx.fill();
    }

    /* 4) 오렌지필 — 도장면 미세 요철 */
    var peelF = fbmF('paint-peel-' + variant, 20, 20, 2, 0.5);
    var peel = mask(fres(1), peelF);
    stamp(hx, PN, PN, '#ffffff', peel, 0.10, 'overlay');
    patternFill(hx, PN, PN, grainTile(64, 'paint-g' + variant, 0.46, 0.54), 0.16, 'overlay');

    /* 정렬용 마스크 — 홈 그늘 / 홈 옆 입술 (컬러·러프니스 패스에서 재사용) */
    var pDark = newCv(PN, PN), pLite = newCv(PN, PN);
    for (i = 0; i < NU; i++) {
      grooveMask(pDark.ctx, PN, true, ribX[i], gw, false);
      grooveMask(pLite.ctx, PN, true, ribX[i], gw, true);
    }
    for (i = 0; i < NV; i++) {
      grooveMask(pDark.ctx, PN, false, seamY[i], gw, false);
      grooveMask(pLite.ctx, PN, false, seamY[i], gw, true);
    }
    var beadM = mask(fres(2), function (u, v) {
      var best = 0;
      for (var q = 0; q < beadY.length; q++) {
        var d = Math.abs(v - beadY[q]); d = Math.min(d, 1 - d);
        best = Math.max(best, 1 - U.smooth(U.clamp01(d / 0.012)));
      }
      return best;
    });
    void k;

    var st = {
      size: PN, height: h.cv, ribX: ribX, seamY: seamY, beadY: beadY, rivR: rivR,
      ribMask: pDark.cv, liteMask: pLite.cv, beadMask: beadM,
      rivHi: rHi.cv, rivLo: rLo.cv,
      normal: normalTex(h.cv, 1.55, 1)
    };
    structCache[key] = st;
    return st;
  }

  /**
   * 벗겨진 도장 자국 — **직접 그린다.**
   *
   * 예전에는 fbm 필드에 좁은 임계값을 걸어 마스크를 뽑았다. 그 결과 자국 하나가
   * 3~5 텍셀짜리 점이 되었고, 화차 측면은 텍스처 512 px 가 12 m 를 덮으므로
   * 자국 하나가 화면에서 1 px 이하 → 밉맵 첫 단에서 통째로 지워졌다.
   * (4배 확대 스크린샷에서 칩 0개 · 드립 0개 — R3 심사 최대 결함.)
   *
   * 여기서는 지름 **14~70 텍셀** 의 찢어진 다각형을 직접 찍는다. 화차 측면 기준
   * 폭 0.10~0.55 m · 높이 0.07~0.40 m 로, 근접에서 10~30 화면픽셀이 된다.
   * 캔버스가 u 로 3.5배 늘어나 붙으므로(12 m × 3.4 m → 정사각 텍스처) 다각형을
   * 세로로 길게(asp≈2.4) 그려야 월드에서 동그란 자국이 된다.
   *
   * 3장으로 나눠 굽는다:
   *   lip   도장이 들뜬 밝은 테두리 (자국을 실루엣으로 만든다 — 이게 가독성의 절반)
   *   chip  프라이머가 드러난 면
   *   deep  그 안쪽 녹
   * @returns {{chip,deep,lip,pts}}  pts = 녹물이 흘러내릴 시작점 [u,v,rad]
   */
  function chipShapes(S, seed, ribX, seamY) {
    var r = U.rng(seed + '-chips');
    var outer = newCv(S, S), inner = newCv(S, S), core = newCv(S, S), lip = newCv(S, S);
    var ox = outer.ctx, ix = inner.ctx, kx = core.ctx, lx = lip.ctx;
    ox.fillStyle = '#ffffff'; ix.fillStyle = '#ffffff'; kx.fillStyle = '#ffffff';
    lx.strokeStyle = '#ffffff'; lx.lineJoin = 'round'; lx.lineCap = 'round';
    var pts = [];
    /* ── 배치: **90% 가 볼록 모서리 위**(SPEC 3.4). ────────────────────────
       도장은 판 한복판에서 벗겨지지 않는다 — 사람·화물·다른 차량이 스치는
       모서리에서 벗겨진다. 판 중앙은 녹꽃 10% 만 남긴다.
       모서리 종류가 곧 **자국의 방향**을 정한다: 세로 모서리를 따라 까진 자국은
       세로로 길고, 가로 이음선을 따라 까진 자국은 가로로 길다. 예전에는 전부
       asp 1.6~2.3 의 같은 방향 타원이라 "노이즈로 뿌린 얼룩"으로 읽혔다. */
    var N = 46;
    for (var i = 0; i < N; i++) {
      var u, v, m = r(), e, d, j, asp;
      if (m < 0.30 && ribX.length) {                 /* 세로 리브/후프 밴드 가장자리 */
        u = ribX[(r() * ribX.length) | 0] + (r() - 0.5) * 0.026;
        v = r();
        asp = 2.6 + r() * 1.1;                       /* 모서리를 따라 세로로 길게 */
      } else if (m < 0.56 && seamY.length) {         /* 가로 이음선 / 리벳 열 */
        u = r();
        v = seamY[(r() * seamY.length) | 0] + (r() - 0.5) * 0.028;
        asp = 0.42 + r() * 0.42;                     /* 이음선을 따라 가로로 길게 */
      } else if (m < 0.90) {                         /* UV 가장자리 = 차체 볼록 모서리 */
        e = (r() * 4) | 0; d = Math.pow(r(), 2.6) * 0.036;
        u = (e === 0 || e === 2) ? r() : (e === 1 ? 1 - d : d);
        v = (e === 0) ? d : (e === 2 ? 1 - d : r());
        asp = (e === 0 || e === 2) ? (0.36 + r() * 0.34) : (2.8 + r() * 1.2);
      } else {                                       /* 판 한가운데 녹꽃 (10%) */
        u = r(); v = r(); asp = 1.5 + r() * 0.8;
      }
      u = U.mod(u, 1); v = U.mod(v, 1);
      /* 큰 자국 몇 개가 있어야 원경에서도 "칠이 벗겨진 화차"로 읽힌다 */
      var big = r() < 0.16;
      var rad = S * (big ? (0.028 + 0.024 * r()) : (0.011 + 0.020 * Math.pow(r(), 1.8)));
      var rot = (r() - 0.5) * 0.42;
      var nv = 8 + ((r() * 4) | 0);
      var jit = [], k;
      for (k = 0; k < 12; k++) jit.push(k < nv ? (0.44 + 0.96 * r()) : 1);
      jit.length = nv;
      var px = u * S, py = v * S;
      var rx = rad * 0.60, ry = rx * asp;
      pts.push([px, py, ry]);
      chipBlob(S, ox, ix, kx, lx, px, py, rx, asp, rot, jit);
      /* 본 자국 둘레의 잔 부스러기 — 없으면 도려낸 스티커처럼 보인다 */
      var sat = 1 + ((r() * 3) | 0);
      for (k = 0; k < sat; k++) {
        var sa = r() * TAU, sd = rad * (0.9 + r() * 1.6);
        var sxp = U.mod(px + Math.cos(sa) * sd, S);
        var syp = U.mod(py + Math.sin(sa) * sd * asp, S);
        var sr = rx * (0.14 + 0.24 * r());
        var sj = [];
        for (j = 0; j < 6; j++) sj.push(0.5 + 0.9 * r());
        chipBlob(S, ox, null, null, lx, sxp, syp, sr, asp, r() * TAU, sj);
      }
    }
    return { chip: outer.cv, deep: inner.cv, rust: core.cv, lip: lip.cv, pts: pts };
  }
  /**
   * 자국 하나. **4단 계조**로 굽는다 — 이래야 "구멍"이 아니라 깨져 나간 도장이 된다:
   *   lip   들뜬 도장 밑에서 드러난 얇은 **맨금속 선** (자국의 실루엣)
   *   chip  회색 프라이머 면
   *   deep  그 안쪽 검은 강재
   *   core  가장 안쪽 주황 녹
   * 세 안쪽 층은 조금씩 어긋나게 찍어 동심원이 되지 않게 한다.
   */
  function chipBlob(S, ox, ix, kx, lx, cx, cy, rx, asp, rot, jit) {
    wrapDraw(S, cx, cy, rx * asp * 1.5, function (qx, qy) {
      lx.lineWidth = Math.max(1, S / 400);
      lx.globalAlpha = 0.85;
      stonePath(lx, qx, qy, rx * 1.10, asp, rot, jit); lx.stroke();
      ox.globalAlpha = 1;
      stonePath(ox, qx, qy, rx, asp, rot, jit); ox.fill();
      if (ix) {
        ix.globalAlpha = 1;
        stonePath(ix, qx + rx * 0.13, qy + rx * asp * 0.15, rx * 0.62, asp, rot, jit); ix.fill();
      }
      if (kx) {
        kx.globalAlpha = 1;
        stonePath(kx, qx + rx * 0.22, qy + rx * asp * 0.26, rx * 0.31, asp, rot, jit); kx.fill();
      }
    });
  }

  /**
   * 벗겨진 자국 아래로 흘러내린 녹물. **자국에서 시작해야** 인과가 읽힌다 —
   * 예전처럼 무작위 x 에서 시작하면 그냥 세로 얼룩이라 눈이 무시한다.
   * 캔버스 y+ 가 월드 아래쪽이다 (CanvasTexture flipY).
   */
  function chipRuns(ctx, S, pts, hex, a0, seed, mul) {
    var r = U.rng(seed);
    ctx.save();
    for (var i = 0; i < pts.length; i++) {
      if (r() > 0.72) continue;
      var x = pts[i][0], y = pts[i][1] + pts[i][2] * 0.55;
      var n = 1 + ((r() * 3) | 0);
      for (var k = 0; k < n; k++) {
        var w = Math.max(1.6, (1.4 + r() * 3.4) * (S / 512) * (mul || 1));
        var len = (0.09 + Math.pow(r(), 1.25) * 0.40) * S;
        var xx = x + (r() - 0.5) * pts[i][2] * 1.0;
        var g = ctx.createLinearGradient(0, y, 0, y + len);
        g.addColorStop(0.00, hexA(hex, a0));
        g.addColorStop(0.12, hexA(hex, a0));
        g.addColorStop(0.55, hexA(hex, a0 * 0.45));
        g.addColorStop(1.00, hexA(hex, 0));
        ctx.globalAlpha = 0.55 + r() * 0.45;
        ctx.fillStyle = g;
        ctx.fillRect(xx - w * 0.5, y, w, len);
        if (xx < w) ctx.fillRect(xx - w * 0.5 + S, y, w, len);
        if (xx > S - w) ctx.fillRect(xx - w * 0.5 - S, y, w, len);
      }
    }
    ctx.restore();
  }

  /**
   * 도장 강판 한 벌. (hex, seed) 로 캐시.
   * @returns {map, normalMap, roughnessMap, tile}
   */
  function paint(hex, seed) {
    hex = hex || '#4b5560';
    seed = seed == null ? 0 : seed;
    var key = hex + '|' + seed + '|' + Q;
    if (paintCache[key]) return paintCache[key];

    /* 구조 변종은 최대 2개. 512px 소벨을 여러 번 도는 것이 부팅 예산에서 가장 비싸고,
       리벳/리브 배치는 색·마모·리피트가 다 다르면 눈에 띄지 않는다. */
    var variant = (typeof seed === 'number' ? (seed >>> 0) : U.hash(seed)) & (Q >= 2 ? 1 : 0);
    var st = paintStruct(variant);
    var S = sz(0.5), R = sz(0.25, 256);
    var sd = 'pt-' + hex + '-' + seed;
    var r = U.rng(sd);

    /* 마스크들 */
    var bleachF = fbmF(sd + '-bl', 4, 4, 4, 0.6);
    var bleachA = fieldArr(fres(0), bleachF);
    var bleach = arrMask(bleachA, fres(0), 0.40, 0.88, 1.0);
    var dull = arrMask(bleachA, fres(0), 0.52, 0.14, 1.0);        /* 반대쪽 꼬리 = 광택 남은 면 */
    var grimeF = fbmF(sd + '-gr', 7, 7, 4, 0.6);
    var grime = mask(fres(1), function (u, v) { return lv(grimeF(u, v), 0.44, 0.90, 1.1); });
    /* 압연 결 — u 축 주기 26. 후드·배럴처럼 u 가 10배 늘어나는 면에서도 세밀함이 남는 유일한 층.
       결이 v 축으로 길게 흐르므로 비등방 캔버스(가로만 촘촘)에 굽는다 — 픽셀 루프가 1/5 로 준다 */
    var rollF = fbmF(sd + '-rl', 26, 3, 2, 0.5);
    var rw = fres(2), rh = Math.max(24, Math.round(rw * 0.30));
    var rollHi = mask2(rw, rh, function (u, v) { return lv(rollF(u, v), 0.52, 0.86, 1.0); });
    var rollLo = mask2(rw, rh, function (u, v) { return lv(rollF(u, v), 0.48, 0.14, 1.0); });
    var cm = chipShapes(S, sd, st.ribX, st.seamY);
    var chip = cm.chip, deepChip = cm.deep, coreChip = cm.rust, chipLip = cm.lip;
    /* 도장색이 어두우면(기관차 #2b3440) 검정 위 검정이 되어 자국이 안 보인다 —
       프라이머·녹을 밝은 쪽으로 끌어올린다. 15-materials 의 edgeWear 와 같은 처리다. */
    var lum0 = 0;
    try { var c0 = U.rgb(hex); lum0 = (0.2126 * c0.r + 0.7152 * c0.g + 0.0722 * c0.b) / 255; } catch (e0) { }
    var darkK = U.clamp((0.34 - lum0) / 0.26, 0, 1);
    /* ⚠ 프라이머는 **회색**이다. 예전 #b28d68 은 따뜻한 탠이라 산화철 적색 탱크 위에서
       "올리브카키 이끼 얼룩"으로 읽혔다 (R3 심사 B). 도장이 깨지면 나오는 것은
       회색 프라이머 → 검은 강재 → 주황 녹, 그리고 깨진 테두리의 **맨금속 선** 이다. */
    var primerC = U.mixHex('#8d8b86', '#a8a49c', darkK);       /* 회색 프라이머/아연 */
    var steelC = U.mixHex('#332f2b', '#4a453e', darkK);        /* 그 안쪽 검은 강재 */
    var rustC = U.mixHex('#9c4f1c', '#b8672a', darkK);         /* 가장 안쪽 주황 녹 */
    var lipC = U.mixHex('#cdc6b8', '#e0d9cb', darkK);          /* 깨진 테두리의 맨금속 */

    /* ── 컬러 ── */
    var c = newCv(S, S), x = c.ctx;
    fillC(x, S, S, hex);
    /* 1) 저주파 얼룩 + 위쪽이 더 바램 (햇빛).
          ⚠ 전부 liftC — U.shade 로 흰색에 lerp 하면 값이 오를수록 **채도가 빠져**
          코발트 곤돌라(#2f5d97) 측면이 회보라 표백면이 된다 (R3 심사 B). */
    stamp(x, S, S, liftC(hex, 0.44, 0.16), bleach, 0.60, 'source-over');
    stamp(x, S, S, U.shade(hex, -0.22), grime, 0.34, 'source-over');
    stamp(x, S, S, liftC(hex, 0.26, 0.08), rollHi, 0.30, 'source-over');
    stamp(x, S, S, U.shade(hex, -0.16), rollLo, 0.30, 'source-over');
    gradFill(x, S, S, 0, 0, 0, S, [
      [0, 'rgba(255,246,228,0.09)'], [0.45, 'rgba(255,246,228,0.02)'], [1, 'rgba(0,0,0,0.06)']
    ], 1, 'source-over');
    /* 2) 패널 격자 — 홈 안쪽은 어둡고 그 옆 입술은 밝다. 두 줄이라야 판이 판으로 읽힌다 */
    stamp(x, S, S, U.shade(hex, -0.44), st.ribMask, 0.70, 'source-over');
    stamp(x, S, S, liftC(hex, 0.48, 0.10), st.liteMask, 0.46, 'source-over');
    /* 3) 용접 비드 — 도장이 얇게 먹어 살짝 다른 광택 */
    stamp(x, S, S, liftC(hex, 0.22, 0.05), st.beadMask, 0.40, 'source-over');
    /* 4) 리벳 — 머리에 도료가 두껍고 둘레에 미세한 그늘 (마스크 2장, 구조에서 재사용) */
    stamp(x, S, S, liftC(hex, 0.50, 0.10), st.rivHi, 0.62, 'source-over');
    stamp(x, S, S, U.shade(hex, -0.44), st.rivLo, 0.52, 'source-over');
    /* 5) 모서리 벗겨짐 **4단 계조**: 맨금속 테두리 → 회색 프라이머 → 검은 강재 → 주황 녹.
          도장색과 무관한 고정색을 쓴다 — 예전엔 프라이머가 주황 탱크차 위에서
          도장과 같은 색상·명도라 94% 를 칠해도 화면에서 아무 일도 안 일어났다. */
    stamp(x, S, S, lipC, chipLip, 0.72, 'source-over');
    stamp(x, S, S, primerC, chip, 0.97, 'source-over');
    stamp(x, S, S, steelC, deepChip, 0.95, 'source-over');
    stamp(x, S, S, rustC, coreChip, 0.94, 'source-over');
    /* 6) 흘러내린 녹물 — **까진 자리에서 시작해** 0.3~1.4 m 아래로 번진다 */
    chipRuns(x, S, cm.pts, '#5e3018', 0.72, sd + '-run', 1.0);
    chipRuns(x, S, cm.pts, '#3b3128', 0.30, sd + '-run2', 2.2);
    dripStreaks(x, S, sd + '-drip2', 'rgba(64,52,42,0.30)', Math.round(12 + r() * 8), 0.26, 1.1);
    /* 7) 아래쪽 때 */
    gradFill(x, S, S, 0, S * 0.66, 0, S, [[0, 'rgba(58,48,40,0)'], [1, 'rgba(56,46,38,0.66)']], 1);
    stamp(x, S, S, P.dirt, grime, 0.22, 'multiply');
    patternFill(x, S, S, grainTile(64, sd + '-g', 0.44, 0.56), 0.20, 'overlay');

    /* ── 러프니스 3레이어 ──────────────────────────────────────────────
       Mat.paint 이 material.roughness = 0.72 를 곱하므로 여기 값 × 0.72 가 실제 거칠기다.
       예전 바탕 0.43 은 실효 0.31 — 탱크차가 사탕처럼 반들거린 직접 원인이다.
         (1) fbm 저주파 얼룩 0.78~1.0   → 실효 0.56~0.72
         (2) 하단 34% 상향 때 그라데이션 → 실효 0.72
         (3) 칩·녹·홈은 최대                                             */
    var rc = newCv(R, R), rx = rc.ctx;
    fillC(rx, R, R, '#a8a8a8');                                    /* ≈0.66 → 실효 0.47 */
    stamp(rx, R, R, '#fafafa', bleach, 0.80, 'source-over');        /* 볕에 바랜 도장 = 무광 */
    stamp(rx, R, R, '#7e7e7e', dull, 0.75, 'source-over');          /* 아직 광 남은 면 = 실효 0.35 */
    stamp(rx, R, R, '#909090', st.beadMask, 0.40, 'source-over');
    stamp(rx, R, R, '#f0f0f0', st.ribMask, 0.50, 'source-over');    /* 홈 안에 때가 앉는다 */
    stamp(rx, R, R, '#6c6c6c', chipLip, 0.70, 'source-over');       /* 깨진 테두리 = 맨금속, 반짝인다 */
    stamp(rx, R, R, '#f4f4f4', chip, 0.98, 'source-over');          /* 프라이머 = 완전 무광 */
    stamp(rx, R, R, '#bcbcbc', deepChip, 0.95, 'source-over');      /* 강재 = 중간 */
    stamp(rx, R, R, '#ffffff', coreChip, 1.0, 'source-over');       /* 녹 = 최대 */
    stamp(rx, R, R, '#e2e2e2', grime, 0.60, 'source-over');
    stamp(rx, R, R, '#c8c8c8', rollHi, 0.35, 'source-over');   /* 결마다 광택이 다르다 */
    gradFill(rx, R, R, 0, R * 0.66, 0, R, [[0, 'rgba(250,250,250,0)'], [1, 'rgba(250,250,250,0.88)']], 1);
    patternFill(rx, R, R, grainTile(64, sd + '-gr2', 0.44, 0.56), 0.22, 'overlay');

    /* 리벳 노멀의 고주파를 거칠기로 흡수 — 화차가 원경에서 반짝이 밭이 되는 걸 막는다 */
    toksvigBake(st.normal.image, rc.cv, 0.12);

    var out = {
      tile: 2.0,
      map: mkTex(c.cv, true, 1),
      normalMap: st.normal,
      roughnessMap: mkTex(rc.cv, false, 1)
    };
    paintCache[key] = out;
    return out;
  }

  function hexA(h, a) {
    var c = U.rgb(h);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  /* ══════════════════════════════════════════════════════════════════════
     13. 데칼 — 투명 배경 RGBA. 'number' | 'hazard' | 'logo' | 'stencil'
     ══════════════════════════════════════════════════════════════════════ */
  var FONT = '"Arial Black", "Helvetica Neue", Arial, "Malgun Gothic", sans-serif';

  /** 도장이 벗겨진 것처럼 마스크로 갉아먹기 */
  function weather(ctx, w, h, seed, amount) {
    if (amount <= 0) return;
    var m = mask(Math.min(128, Math.max(64, w >> 1)), function (u, v) {
      var f = fbmF(seed + '-w', 14, 14, 3, 0.5)(u, v);
      var f2 = fbmF(seed + '-w2', 42, 42, 2, 0.5)(u, v);
      return lv(f * 0.6 + f2 * 0.4, 0.50 - amount * 0.18, 0.62, 1.0);
    });
    var s = scr(w, h, 5);
    s.ctx.drawImage(m, 0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = U.clamp01(amount);
    ctx.drawImage(s.cv, 0, 0, w, h);
    ctx.restore();
  }
  function decalTex(cvEl) {
    var t = new THREE.CanvasTexture(cvEl);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisoVal();
    t.needsUpdate = true;
    texReg.push(t);
    return t;
  }

  function decal(kind, opts) {
    opts = opts || {};
    var key = kind + '|' + JSON.stringify(opts) + '|' + Q;
    if (decalCache[key]) return decalCache[key];
    var W = U.clamp(opts.w || sz(0.25, 256), 32, 1024);
    var H = U.clamp(opts.h || W, 32, 1024);
    var c = newCv(W, H), x = c.ctx;
    var wear = opts.wear == null ? 0.35 : opts.wear;
    var seed = opts.seed == null ? kind : ('' + opts.seed);
    var col = opts.color || '#e6e1d4';
    var i;

    if (kind === 'number') {
      var txt = String(opts.text == null ? '4271' : opts.text);
      x.fillStyle = col;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      var fs = H * (opts.fontScale || 0.62);
      x.font = '700 ' + fs + 'px ' + FONT;
      /* 자간 넓힌 철도식 번호 */
      var chars = txt.split(''), gap = fs * 0.10;
      var wTot = 0, ws = [];
      for (i = 0; i < chars.length; i++) { ws[i] = x.measureText(chars[i]).width; wTot += ws[i] + gap; }
      wTot -= gap;
      var sx = W * 0.5 - wTot * 0.5;
      for (i = 0; i < chars.length; i++) {
        x.fillText(chars[i], sx + ws[i] * 0.5, H * 0.5);
        sx += ws[i] + gap;
      }
      weather(x, W, H, seed, wear * 0.8);

    } else if (kind === 'panel') {
      /**
       * 차체 판금 — 수평 패널 이음선 + 이음선을 따라간 리벳열 + 루버 그릴 + 점검문 외곽선.
       * 투명 배경이므로 도장 위에 곱해 덮는 오버레이로 쓴다.
       * opts.mPerV : 세로 1.0 UV 가 덮는 실제 높이(m). 이음선 0.9 m · 리벳 0.12 m 간격을
       *              실제 치수로 계산해 넣기 위한 값 (기본 3.4 m = SPEC 차체 높이).
       */
      var mv = opts.mPerV || 3.4, mu = opts.mPerU || (mv * W / H);
      var seamN = Math.max(1, Math.round(mv / 0.9));
      var rivN2 = Math.max(4, Math.round(mu / 0.12));
      var lw2 = Math.max(1, H / (mv * 90));                    /* ≈1.1 cm 선폭 */
      var rr2 = Math.max(1, W / (mu * 55));                    /* ≈1.8 cm 리벳 */
      x.save();
      for (i = 1; i <= seamN; i++) {
        var sy2 = H * i / (seamN + 1);
        x.fillStyle = 'rgba(18,16,14,0.72)';
        x.fillRect(0, sy2 - lw2, W, lw2 * 2);
        x.fillStyle = 'rgba(255,248,232,0.26)';
        x.fillRect(0, sy2 + lw2, W, lw2);
        for (var q2 = 0; q2 < rivN2; q2++) {
          var rx3 = W * (q2 + 0.5) / rivN2;
          var rg2 = x.createRadialGradient(rx3 - rr2 * 0.4, sy2 - lw2 * 2.6 - rr2 * 0.4, 0,
            rx3, sy2 - lw2 * 2.6, rr2 * 1.5);
          rg2.addColorStop(0.00, 'rgba(255,250,238,0.55)');
          rg2.addColorStop(0.55, 'rgba(180,172,158,0.20)');
          rg2.addColorStop(0.88, 'rgba(16,14,12,0.45)');
          rg2.addColorStop(1.00, 'rgba(16,14,12,0)');
          x.fillStyle = rg2;
          x.beginPath(); x.arc(rx3, sy2 - lw2 * 2.6, rr2 * 1.5, 0, TAU); x.fill();
        }
      }
      /* 루버 그릴 2개 — 가로 슬랫 7장 */
      for (i = 0; i < 2; i++) {
        var gx2 = W * (0.10 + i * 0.46), gy2 = H * 0.30, gw2 = W * 0.28, gh2 = H * 0.34;
        x.strokeStyle = 'rgba(20,17,15,0.80)'; x.lineWidth = lw2 * 1.4;
        x.strokeRect(gx2, gy2, gw2, gh2);
        for (var sl = 1; sl < 8; sl++) {
          var ly = gy2 + gh2 * sl / 8;
          x.fillStyle = 'rgba(12,11,10,0.86)'; x.fillRect(gx2, ly - lw2 * 1.2, gw2, lw2 * 2.4);
          x.fillStyle = 'rgba(255,246,226,0.30)'; x.fillRect(gx2, ly + lw2 * 1.2, gw2, lw2);
        }
      }
      /* 점검문 외곽선 */
      var dx2 = W * 0.66, dy2 = H * 0.18, dw2 = W * 0.26, dh2 = H * 0.68;
      x.strokeStyle = 'rgba(18,16,14,0.78)'; x.lineWidth = lw2 * 1.6;
      x.strokeRect(dx2, dy2, dw2, dh2);
      x.strokeStyle = 'rgba(255,248,232,0.24)'; x.lineWidth = lw2;
      x.strokeRect(dx2 + lw2 * 2, dy2 + lw2 * 2, dw2 - lw2 * 4, dh2 - lw2 * 4);
      x.restore();
      weather(x, W, H, seed, wear * 0.5);

    } else if (kind === 'hazard') {
      var a = opts.a || '#d9a441', b = opts.b || '#1c1f24';
      var stripes = opts.stripes || 8;
      x.fillStyle = a; x.fillRect(0, 0, W, H);
      x.save();
      x.fillStyle = b;
      var sw = (W + H) / stripes;
      for (i = -stripes; i < stripes * 2; i++) {
        x.beginPath();
        var x0 = i * sw;
        x.moveTo(x0, 0); x.lineTo(x0 + sw * 0.5, 0);
        x.lineTo(x0 + sw * 0.5 - H, H); x.lineTo(x0 - H, H);
        x.closePath(); x.fill();
      }
      x.restore();
      /* 테두리 어둡게 + 마모 */
      x.strokeStyle = 'rgba(20,18,16,0.55)';
      x.lineWidth = Math.max(2, H * 0.05);
      x.strokeRect(0, 0, W, H);
      weather(x, W, H, seed, wear);

    } else if (kind === 'logo') {
      /* 유익차 소유 표기 스타일의 원형 마크 — 링 + 가로바 + 셰브런 */
      var cx = W * 0.5, cy = H * 0.5, rad = Math.min(W, H) * 0.40;
      x.strokeStyle = col; x.fillStyle = col;
      x.lineWidth = Math.max(2, rad * 0.13);
      x.beginPath(); x.arc(cx, cy, rad, 0, TAU); x.stroke();
      x.beginPath(); x.arc(cx, cy, rad * 0.62, 0, TAU);
      x.lineWidth = Math.max(1.5, rad * 0.07); x.stroke();
      x.fillRect(cx - rad * 1.18, cy - rad * 0.11, rad * 2.36, rad * 0.22);
      x.save();
      x.translate(cx, cy);
      for (i = 0; i < 2; i++) {
        x.beginPath();
        var o = (i - 0.5) * rad * 0.46;
        x.moveTo(-rad * 0.30, o - rad * 0.20);
        x.lineTo(0, o + rad * 0.06);
        x.lineTo(rad * 0.30, o - rad * 0.20);
        x.lineWidth = Math.max(2, rad * 0.12);
        x.lineJoin = 'round'; x.lineCap = 'round';
        x.stroke();
      }
      x.restore();
      weather(x, W, H, seed, wear * 0.7);

    } else { /* stencil */
      var st = String(opts.text == null ? 'TARE 12.5t' : opts.text);
      x.fillStyle = col;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      var fs2 = H * (opts.fontScale || 0.34);
      x.font = '700 ' + fs2 + 'px ' + FONT;
      var lines = st.split('\n');
      for (i = 0; i < lines.length; i++) {
        x.fillText(lines[i], W * 0.5, H * (0.5 + (i - (lines.length - 1) * 0.5) * 0.42));
      }
      /* 스텐실 브리지 — 가로로 얇게 도려낸다 */
      x.save();
      x.globalCompositeOperation = 'destination-out';
      x.fillStyle = '#000';
      var br = U.rng(seed + '-br');
      var nb = 3 + Math.floor(br() * 3);
      for (i = 0; i < nb; i++) {
        var by = H * (0.18 + br() * 0.64);
        x.fillRect(0, by, W, Math.max(1.5, H * 0.022));
      }
      x.restore();
      weather(x, W, H, seed, wear);
    }

    var t = decalTex(c.cv);
    decalCache[key] = t;
    return t;
  }

  /* ══════════════════════════════════════════════════════════════════════
     14. 하늘 (equirect) — environment / PMREM 용
     ══════════════════════════════════════════════════════════════════════ */
  /**
   * 시각 t 에 따른 하늘 색 세트. 0 새벽 / .5 정오 / 1 황혼.
   * 키프레임 테이블 방식 — 예전엔 0↔.5↔1 세 점만 선형보간해서 **기본값 t=0.35 가 정오 쪽으로
   * 70% 끌려가** 지평선이 창백한 회색(#d9d2c9)이 되어버렸다. 골든아워가 통째로 사라진 것이다.
   * 이제 t=0.35 에 SPEC §3.3 의 황금시간대 키프레임(천정 #3f6fa8 · 지평선 #f0c08a · 고도 28°)을
   * 직접 못박아 둔다.
   */
  var SKY_KEYS = [
    /* t     zen        hor        sun        gnd        elev */
    [0.00, '#1d3f74', '#f09a63', '#ffb974', '#4a3f33', 8],
    [0.18, '#2c5590', '#f4b478', '#ffca8c', '#57493a', 17],
    [0.35, '#3f6fa8', '#f0c08a', '#ffd9a0', '#6b5a45', 28],
    [0.50, '#3d78bc', '#cfe0ea', '#fff4dd', '#7a6a56', 62],
    [0.68, '#3a6dae', '#e8cfa8', '#ffe6bc', '#6f5f4b', 42],
    [0.86, '#33578f', '#f0b478', '#ffc98a', '#5e4e3e', 18],
    [1.00, '#22406f', '#e8874e', '#ff9f5e', '#463a2f', 6]
  ];
  function skyPalette(t) {
    var i = 0;
    while (i < SKY_KEYS.length - 2 && t > SKY_KEYS[i + 1][0]) i++;
    var a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    var k = U.smooth(U.clamp01((t - a[0]) / Math.max(b[0] - a[0], 1e-4)));
    return {
      zen: U.mixHex(a[1], b[1], k),
      hor: U.mixHex(a[2], b[2], k),
      sun: U.mixHex(a[3], b[3], k),
      gnd: U.mixHex(a[4], b[4], k),
      elev: U.lerp(a[5], b[5], k)
    };
  }

  function skyGradient(t) {
    t = t == null ? 0.35 : U.clamp01(t);
    var key = 'sky' + Math.round(t * 20) + '_' + Q;
    if (skyCache[key]) return skyCache[key];

    var W = U.clamp(BASE, 256, 1024), H = W >> 1;
    var pal = skyPalette(t);
    /* 황금시간대: 고도 28°, 서남서 방위 */
    var elev = pal.elev * U.DEG;
    var az = -2.678;                                   /* atan2(z,x), 서남서 */
    var dir = { x: Math.cos(elev) * Math.cos(az), y: Math.sin(elev), z: Math.cos(elev) * Math.sin(az) };
    SUN = dir;
    var su = (Math.atan2(dir.z, dir.x) / TAU + 0.5);
    var sv = (Math.asin(U.clamp(dir.y, -1, 1)) / Math.PI + 0.5);
    var sx = su * W, sy = (1 - sv) * H;                /* 캔버스 y=0 이 천정 */

    var c = newCv(W, H), x = c.ctx;
    /* 1) 3-stop: **천정 #3f6fa8(파랑) → 중간대 #7fa3cf → 지평선 #f0c08a**.
       예전에는 천정을 −46% 로 눌러 놓고 지평선 헤이즈를 넓게 얹어서 파란색이 통째로
       사라진 베이지→모브 진흙 그라데이션이 나왔다 (R2 심사 G). 파랑을 지키는 것이
       IBL 에도 중요하다 — 이 텍스처가 그대로 금속의 반사색이 된다.
       중간대는 천정과 지평선의 단순 보간이 아니라 **하늘색 계열의 독립 stop** 이어야
       위는 차갑고 아래는 따뜻한 진짜 하늘이 된다. */
    var mid = U.mixHex(U.mixHex(pal.zen, '#7fa3cf', 0.72), pal.hor, 0.10);
    gradFill(x, W, H, 0, 0, 0, H, [
      [0.00, U.shade(pal.zen, -0.20)],
      [0.14, U.shade(pal.zen, -0.08)],
      [0.30, pal.zen],
      [0.40, mid],
      [0.455, U.mixHex(mid, pal.hor, 0.45)],
      [0.487, U.mixHex(mid, pal.hor, 0.86)],
      [0.500, pal.hor],
      [0.512, U.mixHex(pal.gnd, pal.hor, 0.20)],
      [0.545, pal.gnd],
      [1.00, U.shade(pal.gnd, -0.58)]
    ], 1);

    /* 2) 지평선 헤이즈 — 하늘쪽 아주 좁게. 이걸 넓게 깔면 파랑이 죽는다.
       (예전에는 H*0.30 부터 0.38 알파로 깔아 하늘 절반을 베이지로 덮었다) */
    gradFill(x, W, H, 0, H * 0.415, 0, H * 0.50,
      [[0, hexA(pal.hor, 0)], [0.62, hexA(pal.hor, 0.10)], [1, hexA(pal.hor, 0.34)]], 1, 'source-over');

    /* 3) 지평선 위 8~22° 가로 구름 띠 2줄. 얇고 옅게(0.06~0.12) — 이게 있어야 하늘이
       "칠한 그라데이션"이 아니라 대기로 읽힌다. v: 0.5 가 지평선, 위로 갈수록 작아진다. */
    var cloudF = fbmF('sky-cl', 9, 3, 4, 0.55);
    function cloudBand(elDeg, thickDeg, alpha, seedMul) {
      var vc = 0.5 - elDeg / 180, vt = thickDeg / 180;
      var m = mask2(192, 96, function (u, v) {
        var band = 1 - U.smooth(U.clamp01(Math.abs(v - vc) / vt));
        return lv(cloudF(u * seedMul, v * 3.0), 0.50, 0.86, 1.15) * band;
      });
      stamp(x, W, H, U.mixHex(pal.sun, '#ffffff', 0.55), m, alpha, 'source-over');
      stamp(x, W, H, U.shade(pal.zen, -0.10), m, alpha * 0.5, 'multiply');
    }
    cloudBand(11, 8.5, 0.20, 1.0);
    cloudBand(20, 6.0, 0.13, 1.7);

    /* 4) 태양: 반경 2.5° 의 warm disc(선형 8.0 상당) + 훈륜.
       광륜은 하늘 반구에만 — 지면 반구까지 번지면 PMREM 의 아래쪽 바운스가 하얗게 뜬다 */
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.beginPath(); x.rect(0, 0, W, H * 0.502); x.clip();
    var hc2 = U.rgb(pal.sun);
    function rgbaS(a) { return 'rgba(' + hc2.r + ',' + hc2.g + ',' + hc2.b + ',' + a + ')'; }
    function haloAt(cx) {
      var g = x.createRadialGradient(cx, sy, 0, cx, sy, W * 0.34);
      g.addColorStop(0.00, rgbaS(0.40));
      g.addColorStop(0.06, rgbaS(0.20));
      g.addColorStop(0.30, rgbaS(0.055));
      g.addColorStop(1.00, rgbaS(0));
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      var g2 = x.createRadialGradient(cx, sy, 0, cx, sy, W * 0.070);
      g2.addColorStop(0.00, rgbaS(0.66));
      g2.addColorStop(0.35, rgbaS(0.22));
      g2.addColorStop(1.00, rgbaS(0));
      x.fillStyle = g2; x.fillRect(cx - W * 0.08, sy - W * 0.08, W * 0.16, W * 0.16);
    }
    haloAt(sx);
    if (sx < W * 0.34) haloAt(sx + W);          /* 좌우 이음매를 넘어가는 광륜 */
    if (sx > W * 0.66) haloAt(sx - W);
    /* 원반 자체: equirect 는 가로 360° 이므로 2.5° = W*2.5/360 = W/144.
       sRGB 로 저장하므로 1.0 이 상한 — 코어를 완전히 태워서 PMREM 이 8.0 급의
       하이라이트를 뽑게 하고, 감마 보정된 가장자리 1 px 로 계단을 없앤다. */
    var sunR = W * 2.5 / 360;
    var disc = x.createRadialGradient(sx, sy, 0, sx, sy, sunR * 1.5);
    disc.addColorStop(0.00, 'rgba(255,255,255,1)');
    disc.addColorStop(0.62, 'rgba(255,250,236,1)');
    disc.addColorStop(0.70, rgbaS(0.72));
    disc.addColorStop(1.00, rgbaS(0));
    x.fillStyle = disc;
    x.beginPath(); x.arc(sx, sy, sunR * 1.5, 0, TAU); x.fill();
    x.restore();

    var tex = new THREE.CanvasTexture(c.cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    texReg.push(tex);
    skyCache[key] = tex;
    return tex;
  }

  /* ══════════════════════════════════════════════════════════════════════
     빌드 / 정리 / 공개 API
     ══════════════════════════════════════════════════════════════════════ */
  function build(quality) {
    var t0 = U.now();
    Q = U.clamp(quality == null ? 1 : (quality | 0), 0, 2);
    BASE = 256 << Q;
    API.quality = Q;
    var parts = API.stats.parts = {};
    function step(name, fn) { var a = U.now(); fn(); parts[name] = Math.round(U.now() - a); }
    try {
      step('ballast', buildBallast);
      step('gravelFine', buildGravelFine);
      step('soilTop', buildSoilTop);
      step('grass', buildGrass);
      step('foliage', buildFoliage);
      step('cliff', buildCliff);
      step('sleeper', buildSleeper);
      step('woodPlank', buildWoodPlank);
      step('railSide', buildRailSide);
      step('railHead', buildRailHead);
      step('concrete', buildConcrete);
      step('rustSheet', buildRustSheet);
      step('metalPlate', buildMetalPlate);
      step('tarpaulin', buildTarpaulin);
      step('glassDirt', buildGlassDirt);
      var ps;
      step('paintedSteel', function () { ps = paint('#4b5560', 7); });
      sets.paintedSteel = {
        tile: ps.tile, map: ps.map, normalMap: ps.normalMap, roughnessMap: ps.roughnessMap
      };
      built = true;
      API.ready = true;
    } catch (e) {
      SH.U.err(e);
    }
    API.stats.ms = Math.round(U.now() - t0);
    SH.Bus.emit('tex:built', { quality: Q, ms: API.stats.ms });
    return sets;
  }

  function setAnisotropy(n) {
    var v = Math.max(1, Math.min(16, n | 0));
    for (var i = 0; i < texReg.length; i++) {
      if (texReg[i].mapping === THREE.EquirectangularReflectionMapping) continue;
      texReg[i].anisotropy = v;
      texReg[i].needsUpdate = true;
    }
  }
  function setRepeat(nameOrSet, u, v) {
    var s = (typeof nameOrSet === 'string') ? sets[nameOrSet] : nameOrSet;
    if (!s) return null;
    v = v == null ? u : v;
    var keys = ['map', 'normalMap', 'roughnessMap', 'aoMap'];
    for (var i = 0; i < keys.length; i++) {
      if (s[keys[i]]) s[keys[i]].repeat.set(u, v);
    }
    return s;
  }
  function dispose() {
    for (var i = 0; i < texReg.length; i++) { try { texReg[i].dispose(); } catch (e) { SH.U.err(e); } }
    texReg.length = 0;
    for (var k in sets) if (Object.prototype.hasOwnProperty.call(sets, k)) delete sets[k];
    paintCache = Object.create(null);
    structCache = Object.create(null);
    decalCache = Object.create(null);
    skyCache = Object.create(null);
    scratchPool = Object.create(null);
    grainCache = Object.create(null);
    built = false;
    API.ready = false;
  }

  var API = {
    sets: sets,
    ready: false,
    quality: 1,
    stats: { ms: 0 },
    build: build,
    paint: paint,
    decal: decal,
    skyGradient: skyGradient,
    sunDir: function () {
      if (!SUN) skyGradient();
      return new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize();
    },
    tile: function (name) { return sets[name] ? sets[name].tile : 1; },
    setAnisotropy: setAnisotropy,
    setRepeat: setRepeat,
    dispose: dispose,
    isBuilt: function () { return built; }
  };
  return API;
})();

