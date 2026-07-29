/* ============================================================================
   조차장 / SHUNTING — 80-ui.js   →  SH.UI
   DOM 오버레이 UI 전부. #ui-root 안에 JS로 DOM 을 만들고 <style> 을 주입한다.
   index.html 은 건드리지 않는다. 모든 클래스는 sh- 접두사.
   ============================================================================ */

/* CONTRACT ---------------------------------------------------------------------
   SH.UI.init(hooks)
     hooks = {
       onRestart(), onUndo(), onLevel(i), onNext(),
       onHint(),                  // 문자열 반환 → 그대로 토스트 / false 반환 → UI 침묵
                                  //   (그 외에는 levelDef.hint 로 폴백)
       onShare(payload)->bool?,   // true 를 반환하면 UI 기본 공유를 생략
       onMute(muted),             // 스피커 버튼을 눌렀을 때. UI 가 먼저 자기 상태를 바꾼다
       onCoupler(index)           // 화면 위 연결기 마커를 탭했을 때
     }
     · 저장된 음소거 설정이 true 면 init 다음 프레임에 hooks.onMute(true) 를 1회 호출한다.
     · 두 번 호출하면 기존 DOM 을 destroy 후 재생성한다.

   SH.UI.setLevel(def, index)   // levelDef. index 생략 시 SH.Levels.pack 에서 추론
   SH.UI.setState(state)        // Puzzle state {tracks, at, consist, moves}
   SH.UI.setMoves(n, par)       // 숫자 카운트업 + 상단 별 예상치 갱신
   SH.UI.setBusy(b)             // 애니메이션 중 버튼 잠금
   SH.UI.target(list)           // 목표 편성 칩 렌더 (id 배열 또는 {id,type,livery} 배열)
   SH.UI.toast(msg, kind)       // kind: 'info'(기본) | 'warn' | 'good'.
                                //  msg 가 Puzzle 의 reason-code 면 한국어로 번역해 준다.
   SH.UI.flash(msg)             // 화면 중앙 상단 큰 글씨 1초
   SH.UI.win(result | null)     // null/false 면 닫기.
        result = {stars, moves, par, best, prevBest, newRecord, index, name,
                  hasNext, totalStars}   — 전부 선택. 없으면 현재 레벨에서 추론.
        · 승리 시 GameStats.record('shunting', {score: 총 별 수}) 를 UI 가 호출한다.
          Game 쪽에서 중복 호출하지 말 것.
   SH.UI.levelSelect(open)      // 하단 시트 열기/닫기
   SH.UI.tutorial(step)         // step: number | {id,text,anchor|at,dir} | null.
                                //  이미 본 단계면 false 반환하고 표시하지 않는다.
   SH.UI.setStars(n)            // 상단 별 강제 지정 (setLevel 시 해제)
   SH.UI.showCoupler(pos, i)    // pos={x,y,visible} (뷰포트 px). pos 없으면 숨김.
                                //  i 생략 + pos 없음 → 전체 숨김
   SH.UI.setMuted(b)            // 스피커 아이콘/저장값 동기화
   SH.UI.setLevels(arr)         // (선택) 레벨 목록 주입. 없으면 SH.Levels.pack 사용
   SH.UI.destroy()
   SH.UI.el                     // 루트 엘리먼트 (디버그/스크린샷용)
   SH.UI.hide(b)                // __SHOT.hideUI 용 — 오버레이 전체 숨김
---------------------------------------------------------------------------- */

window.SH.UI = (function () {
  'use strict';

  var SH = window.SH, U = SH.U;

  /* ── 상수 ────────────────────────────────────────────────────── */
  var ACCENT = '#d99a26';
  var TUT_KEY = 'gamelab:shunting:tut';
  var MUTE_KEY = 'gamelab:shunting:muted';
  var FALLBACK_URL = 'https://junstellar.github.io/games/shunting/';

  var TYPE_KO = {
    box: '유개차', open: '무개차', tank: '유조차',
    flat: '평판차', hopper: '호퍼차', brake: '차장차'
  };
  var LIVERY = {
    oxide: '#9e3b2c', red: '#9e3b2c', mustard: '#d99a26', yellow: '#d99a26',
    pine: '#3f6b4e', green: '#3f6b4e', cobalt: '#2f5d97', blue: '#2f5d97',
    cream: '#d9cbb0', slate: '#4b5560', grey: '#4b5560', gray: '#4b5560'
  };

  /* ── 내부 상태 ───────────────────────────────────────────────── */
  var hooks = {}, root = null, styleEl = null, built = false;
  var level = null, levelIdx = 0, levelList = null;
  var wagonMap = {};          // id -> {id,type,livery}
  var targetIds = [];         // 목표 순서 (id)
  var chipEls = [];
  var curState = null;
  var curMoves = 0, curPar = 0, starOverride = -1;
  var busy = false, muted = false, uid = 0;
  var els = {};               // 주요 엘리먼트 캐시
  var couplers = {};          // index -> element
  var tutStep = null, tutSeen = null, lastWin = null;
  var ro = null, onResize = null, onKey = null;

  /* ── 작은 유틸 ───────────────────────────────────────────────── */
  function reduced() {
    try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function on(node, evt, fn) {
    if (!node) return;
    node.addEventListener(evt, function (e) { try { fn(e); } catch (er) { U.err(er); } }, false);
  }
  function call(name) {
    var fn = hooks && hooks[name];
    if (typeof fn !== 'function') return undefined;
    var a = Array.prototype.slice.call(arguments, 1);
    try { return fn.apply(null, a); } catch (e) { U.err(e); return undefined; }
  }
  function sfx(name) {
    try { if (SH.Audio && SH.Audio.play) SH.Audio.play(name); } catch (e) { /* 오디오 미준비 */ }
  }
  function safeHex(h) {
    if (typeof h === 'number' && isFinite(h)) return U.hex((h >> 16) & 255, (h >> 8) & 255, h & 255);
    if (typeof h === 'string') {
      var s = h.trim();
      if (LIVERY[s.toLowerCase()]) return LIVERY[s.toLowerCase()];
      if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
      if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    }
    return ACCENT;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad2(n) { n = Math.max(0, Math.floor(n)); return (n < 10 ? '0' : '') + n; }

  /* 레이어 표시/숨김 — 트랜지션이 끝난 뒤 display:none 으로 접근성 트리에서 제거 */
  function show(node, isOn, ms) {
    if (!node) return;
    clearTimeout(node.__ht);
    if (isOn) {
      node.style.display = '';
      node.removeAttribute('aria-hidden');
      void node.offsetWidth;                 // reflow — 트랜지션 시작 보장
      node.classList.add('is-on');
    } else {
      node.classList.remove('is-on');
      node.setAttribute('aria-hidden', 'true');
      node.__ht = setTimeout(function () { node.style.display = 'none'; }, reduced() ? 0 : (ms || 380));
    }
  }

  /* ── 초소형 트윈 (카운트업·별 팝) ────────────────────────────── */
  var tweens = [], rafId = 0;
  function pump() {
    rafId = 0;
    var t = U.now();
    for (var i = tweens.length - 1; i >= 0; i--) {
      var tw = tweens[i];
      var k = tw.d <= 0 ? 1 : U.clamp01((t - tw.t0) / tw.d);
      try { tw.fn(tw.e ? tw.e(k) : k, k); } catch (e) { U.err(e); }
      if (k >= 1) {
        tweens.splice(i, 1);
        if (tw.done) { try { tw.done(); } catch (e2) { U.err(e2); } }
      }
    }
    if (tweens.length) rafId = requestAnimationFrame(pump);
  }
  function killTween(key) {
    for (var i = tweens.length - 1; i >= 0; i--) if (tweens[i].k === key) tweens.splice(i, 1);
  }
  function tween(key, dur, fn, ease, done) {
    killTween(key);
    if (reduced()) dur = 0;
    tweens.push({ k: key, t0: U.now(), d: dur, fn: fn, e: ease, done: done });
    if (!rafId) rafId = requestAnimationFrame(pump);
  }
  function countTo(node, to, dur) {
    if (!node) return;
    to = Math.round(to || 0);
    var from = parseFloat(node.getAttribute('data-v'));
    if (!isFinite(from)) from = to;
    node.setAttribute('data-v', to);
    if (!node.__k) node.__k = 'n' + (++uid);
    if (from === to) { node.textContent = String(to); return; }
    tween(node.__k, dur == null ? 380 : dur, function (t) {
      node.textContent = String(Math.round(U.lerp(from, to, t)));
    }, U.ease.outCubic);
  }

  /* ── 아이콘 (전부 인라인 SVG — 이모지 금지) ──────────────────── */
  function svgIco(body, vb) {
    return '<svg viewBox="' + (vb || '0 0 24 24') + '" fill="none" stroke="currentColor" ' +
      'stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
      'focusable="false" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
  }
  var ICON = {
    back:    svgIco('<polyline points="15 18 9 12 15 6"/>'),
    next:    svgIco('<polyline points="9 18 15 12 9 6"/>'),
    undo:    svgIco('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4.6"/>'),
    hint:    svgIco('<path d="M9.4 17.4h5.2"/><path d="M10.3 20.4h3.4"/>' +
                    '<path d="M12 3.2a6.1 6.1 0 0 0-3.6 11.05c.63.46 1.03 1.1 1.13 1.85h4.94c.1-.75.5-1.39 1.13-1.85A6.1 6.1 0 0 0 12 3.2z"/>'),
    restart: svgIco('<polyline points="20.6 4.4 20.6 10.2 14.8 10.2"/>' +
                    '<path d="M18.3 15.1a7.6 7.6 0 1 1-1.79-7.9l4.09 3"/>'),
    menu:    svgIco('<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.6"/>' +
                    '<rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.6"/>' +
                    '<rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.6"/>' +
                    '<rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.6"/>'),
    soundOn: svgIco('<path d="M11 4.8 6.4 8.7H2.9v6.6h3.5L11 19.2z" fill="currentColor" stroke-linejoin="round"/>' +
                    '<path d="M15.1 9.1a4.1 4.1 0 0 1 0 5.8"/><path d="M18 6.2a8.2 8.2 0 0 1 0 11.6"/>'),
    soundOff:svgIco('<path d="M11 4.8 6.4 8.7H2.9v6.6h3.5L11 19.2z" fill="currentColor" stroke-linejoin="round"/>' +
                    '<line x1="16" y1="9.4" x2="21.2" y2="14.6"/><line x1="21.2" y1="9.4" x2="16" y2="14.6"/>'),
    share:   svgIco('<circle cx="17.6" cy="5.6" r="2.7"/><circle cx="6.4" cy="12" r="2.7"/>' +
                    '<circle cx="17.6" cy="18.4" r="2.7"/>' +
                    '<line x1="8.75" y1="13.4" x2="15.3" y2="17.1"/>' +
                    '<line x1="15.3" y1="6.9" x2="8.75" y2="10.6"/>'),
    close:   svgIco('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    lock:    svgIco('<rect x="4.2" y="10.6" width="15.6" height="9.6" rx="2.4"/>' +
                    '<path d="M7.8 10.6V7.9a4.2 4.2 0 0 1 8.4 0v2.7"/>'),
    check:   svgIco('<polyline points="20 6.4 9.2 17.4 4 12.2"/>'),
    coupler: svgIco('<path d="M9.7 8.1H7.4a3.9 3.9 0 0 0 0 7.8h2.3"/>' +
                    '<path d="M14.3 8.1h2.3a3.9 3.9 0 0 1 0 7.8h-2.3"/>' +
                    '<path d="M10.7 12h2.6"/>'),
    /* 칩 사이 간격에 들어가는 초소형 연결기 — 15px 에서도 형태가 살도록
       선이 아니라 면으로 그린다(너클 두 개 + 사이의 바). */
    link:    '<svg viewBox="0 0 26 12" fill="currentColor" aria-hidden="true" focusable="false" ' +
             'xmlns="http://www.w3.org/2000/svg">' +
             '<rect x="6.2" y="4.1" width="13.6" height="3.8" rx="1.9"/>' +
             '<circle cx="4.7" cy="6" r="4.1"/><circle cx="21.3" cy="6" r="4.1"/>' +
             '<circle cx="4.7" cy="6" r="1.35" fill="#1d1406"/>' +
             '<circle cx="21.3" cy="6" r="1.35" fill="#1d1406"/></svg>',
    hand:    svgIco('<path d="M11 15.4V6.4a2.6 2.6 0 1 1 5.2 0v6.4"/>' +
                    '<path d="M16.2 13.4l4.7 1.5a4 4 0 0 1 2.7 4.4l-.6 3.1a4.4 4.4 0 0 1-4.3 3.5h-3.4a4.4 4.4 0 0 1-3.4-1.6l-4.3-5.3a2 2 0 0 1 2.9-2.7l2.5 2.4"/>',
                    '0 0 32 32')
  };
  /* 별 꼭짓점 (정오각별). 중심은 (12, 13.16) */
  var STAR_PT = [[12, 2.6], [15.1, 8.9], [22.1, 9.9], [17.05, 14.8], [18.24, 21.7],
                 [12, 18.44], [5.76, 21.7], [6.95, 14.8], [1.9, 9.9], [8.9, 8.9]];
  function starPts(k, dy) {
    var cx = 12, cy = 13.16, out = [], i;
    for (i = 0; i < STAR_PT.length; i++) {
      out.push((cx + (STAR_PT[i][0] - cx) * k).toFixed(2) + ' ' +
               (cy + (STAR_PT[i][1] - cy) * k + (dy || 0)).toFixed(2));
    }
    return out.join(' ');
  }
  function star(filled) {
    return '<svg viewBox="0 0 24 24" class="sh-st ' + (filled ? 'on' : '') + '" aria-hidden="true" ' +
      'focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      '<polygon stroke-linejoin="round" points="' + starPts(1, 0) + '"/></svg>';
  }
  /* 승리 오버레이용 큰 별 — 클립아트가 아니라 도장된 금속처럼 보이게 4겹으로 그린다.
     b 본체(금 그라디언트) · f 상단 스페큘러+하단 웜 바운스 · c 안쪽 코어 · o 얇은 어두운 앰버 림 */
  function bigStar() {
    var p = starPts(1, 0);
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' +
      'xmlns="http://www.w3.org/2000/svg">' +
      '<polygon class="b" stroke-linejoin="round" points="' + p + '"/>' +
      '<polygon class="f" points="' + p + '"/>' +
      '<polygon class="c" points="' + starPts(.52, -.35) + '"/>' +
      '<polygon class="o" points="' + p + '"/></svg>';
  }

  /* ── 스타일 (JS 에서 <style> 주입) ──────────────────────────── */
  var CSS = [
'#ui-root{',
'  --sh-a:#d99a26; --sh-a2:#f2c476; --sh-a-dk:#a8730f;',
/* 보조 텍스트는 유리 위에서 읽혀야 한다 — 회색 대신 밝기를 낮춘 흰색 */
'  --sh-txt:#eef0f4; --sh-mut:rgba(238,242,248,.62);',
'  --sh-glass:rgba(14,17,22,.60);',
'  --sh-glass2:rgba(15,18,24,.82);',
/* 골든아워 하늘이 유리 윗면에 얹히는 느낌 — 위는 따뜻하게, 아래는 두껍게.
   평평한 하늘 앞에서는 블러만으로 유리가 읽히지 않는다(번질 것이 없으므로).
   그래서 판 자체에 '방향'을 준다: 키 라이트 쪽(좌상) 따뜻한 스펙큘러 sheen,
   반대 모서리(우하)에 하늘 필의 차가운 반사, 그 위에 세로 두께 그라디언트. */
'  --sh-tint:radial-gradient(126% 112% at 13% -24%,rgba(255,226,182,.125),transparent 56%),',
'    radial-gradient(96% 132% at 106% 126%,rgba(126,172,236,.062),transparent 60%),',
'    linear-gradient(180deg,rgba(255,224,182,.085),rgba(255,255,255,.014) 34%,rgba(0,0,0,.23));',
/* 원형 버튼은 평면이 아니라 유리 돔이다 — 좌상 하이라이트에서 우하로 떨어지는 구면 음영 */
'  --sh-tint-r:radial-gradient(82% 78% at 29% 17%,rgba(255,233,198,.17),',
'    rgba(255,255,255,.022) 47%,rgba(0,0,0,.27));',
'  --sh-bd:1px solid rgba(255,255,255,.09);',
'  --sh-bd-c:rgba(255,255,255,.09);',
/* 유리 두께: 상단 웜 스페큘러 헤어라인 → 좌우 모서리(밝은 쪽/어두운 쪽) → 하단 립 → 바닥 그림자 */
'  --sh-hi:inset 0 1px 0 rgba(255,240,219,.26), inset 0 4px 7px -5px rgba(255,236,208,.24),',
'    inset 1px 0 0 rgba(255,240,219,.07), inset -1px 0 0 rgba(0,0,0,.26),',
'    inset 0 -1px 0 rgba(0,0,0,.46), inset 0 -14px 20px -16px rgba(0,0,0,.7);',
'  --sh-sh:0 24px 48px rgba(0,0,0,.55), 0 6px 16px -8px rgba(0,0,0,.6);',
'  --sh-sh-s:0 12px 26px -10px rgba(0,0,0,.72), 0 2px 6px -2px rgba(0,0,0,.5);',
'  --sh-e:cubic-bezier(.22,1,.36,1);',
'  --sh-chip-w:44px; --sh-chip-gap:6px; --sh-strip-h:96px;',
'  --sh-pad:12px;',
'  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",',
'    "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif;',
'  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;',
'  color:var(--sh-txt); font-variant-numeric:tabular-nums; letter-spacing:-.008em;',
'}',
'#ui-root>.sh-root{ position:absolute; inset:0; pointer-events:none; }',
'.sh-root, .sh-root *{ box-sizing:border-box; }',
'.sh-root.is-hidden{ opacity:0 !important; pointer-events:none !important; }',
'.sh-root button{ font:inherit; color:inherit; background:none; border:0; margin:0; cursor:pointer;',
'  -webkit-tap-highlight-color:transparent; }',
'.sh-root a{ color:inherit; text-decoration:none; -webkit-tap-highlight-color:transparent; }',
'.sh-root :focus{ outline:none; }',
'.sh-root :focus-visible{ outline:2px solid var(--sh-a2); outline-offset:3px; }',
/* .sh-root button 리셋(0,1,1)보다 높은 특이도로 배경을 되살린다 */
/* position 은 절대 건드리지 않는다 — .sh-strip/.sh-sheet 의 absolute/fixed 를 덮어쓴다 */
'.sh-root .sh-glass{ background-color:var(--sh-glass);',
'  background-image:var(--sh-tint);',
/* saturate 를 크게 — 뒤의 골든아워 섬 색이 유리에 배어 나와야 웹 모달이 아니라 유리로 읽힌다 */
'  -webkit-backdrop-filter:blur(18px) saturate(1.45) brightness(1.04);',
'  backdrop-filter:blur(18px) saturate(1.45) brightness(1.04);',
'  border:var(--sh-bd); border-top-color:rgba(255,238,214,.26);',
'  box-shadow:var(--sh-sh),var(--sh-hi); }',
'.sh-root .sh-rb.sh-glass{ background-image:var(--sh-tint-r);',
'  box-shadow:var(--sh-sh-s),var(--sh-hi); }',
/* 원형 버튼의 테두리를 '방향 있는 림'으로 바꾼다 — 좌상은 따뜻한 스페큘러, 우하는 어두운 그림자.
   균일한 1px 흰 테두리가 UI 를 웹 버튼으로 만드는 가장 큰 원인이다.
   1px 링만 남기는 마스크 트릭이라, 마스크 합성을 못 하면 원 전체가 칠해진다 → @supports 로 막는다. */
'@supports ((-webkit-mask-composite:xor) or (mask-composite:exclude)){',
'  .sh-root .sh-rb.sh-glass{ border-color:transparent; }',
'  .sh-root .sh-rb.sh-glass::after{ content:""; position:absolute; inset:-1px; border-radius:50%;',
'    pointer-events:none; padding:1px;',
'    background:conic-gradient(from 200deg,rgba(255,241,216,.44),rgba(255,246,230,.10) 22%,',
'      rgba(0,0,0,.40) 50%,rgba(255,232,198,.12) 78%,rgba(255,241,216,.44));',
'    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
'    mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);',
'    -webkit-mask-composite:xor; mask-composite:exclude;',
'    transition:opacity .2s, filter .2s; }',
'  .sh-root .sh-rb.sh-glass:hover::after{ filter:brightness(1.45); }',
'}',

/* ── 상단 바 ───────────────────────────────────────────────── */
'.sh-top{ position:absolute; left:var(--sh-pad); right:var(--sh-pad); top:var(--sh-pad);',
'  display:flex; align-items:center; gap:8px; z-index:10;',
'  transform:translateY(0); opacity:1; transition:transform .5s var(--sh-e), opacity .4s; }',
'.sh-root.is-intro .sh-top{ transform:translateY(-14px); opacity:0; }',
'.sh-rb{ flex:0 0 auto; width:40px; height:40px; border-radius:50%; display:grid; place-items:center;',
'  pointer-events:auto; color:var(--sh-txt); position:relative;',
'  transition:transform .24s var(--sh-e), background .2s, border-color .2s, opacity .24s, color .2s; }',
'.sh-rb svg{ width:19px; height:19px; display:block; }',
'.sh-rb:hover{ transform:translateY(-2px); color:#fff; border-color:rgba(255,255,255,.2); }',
'.sh-rb:active{ transform:translateY(0) scale(.93); }',
'.sh-rb[aria-disabled="true"]{ opacity:.3; pointer-events:none; }',
'.sh-bar{ flex:1 1 auto; min-width:0; height:40px; border-radius:20px; padding:0 4px 0 12px;',
'  display:flex; align-items:center; gap:9px; overflow:hidden; position:relative; pointer-events:auto; }',
'.sh-bar::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:2px; opacity:0;',
'  background:linear-gradient(90deg,transparent,var(--sh-a),transparent); transform:translateX(-100%); }',
'.sh-root.is-busy .sh-bar::after{ opacity:.95; animation:sh-sweep 1.1s linear infinite; }',
'@keyframes sh-sweep{ from{transform:translateX(-100%)} to{transform:translateX(100%)} }',
'.sh-lv{ display:flex; align-items:baseline; gap:7px; min-width:0; flex:1 1 auto; }',
/* 타이포 위계 — 숫자는 800 + 음의 자간(덩어리로 읽힌다),
   라벨/캡션은 600~700 + 양의 자간(옆으로 퍼져 배경으로 물러난다). */
'.sh-lv-num{ font-size:.79rem; font-weight:700; color:var(--sh-a); letter-spacing:.075em;',
'  flex:0 0 auto; text-shadow:0 0 14px rgba(217,154,38,.4); }',
'.sh-lv-name{ font-size:.83rem; font-weight:600; color:var(--sh-txt); white-space:nowrap;',
'  overflow:hidden; text-overflow:ellipsis; min-width:0; opacity:.92; letter-spacing:-.012em; }',
'.sh-sep{ flex:0 0 auto; width:1px; height:17px; background:rgba(255,255,255,.11); }',
'.sh-moves{ flex:0 0 auto; display:flex; align-items:baseline; gap:4px; }',
'.sh-mv-n{ font-size:1.06rem; font-weight:800; line-height:1; letter-spacing:-.03em;',
'  transition:color .3s; }',
'.sh-moves.over .sh-mv-n{ color:#e9a08f; }',
'.sh-mv-p{ font-size:.655rem; font-weight:600; color:var(--sh-mut); letter-spacing:.03em; }',
/* 숫자가 들어가는 곳은 전부 고정폭 라이닝 숫자 — 카운트업할 때 폭이 흔들리지 않는다 */
'.sh-mv-n,.sh-mv-p,.sh-strip-p,.sh-chip .sh-idx,.sh-win-cell b,.sh-win-kicker,',
'.sh-card-num,.sh-card-best,.sh-sheet-tot{',
'  font-variant-numeric:tabular-nums lining-nums;',
'  font-feature-settings:"tnum" 1,"lnum" 1; }',
'.sh-stars{ flex:0 0 auto; display:flex; gap:1px; align-items:center; padding-right:6px; }',
'.sh-st{ width:12px; height:12px; display:block; fill:rgba(255,255,255,.16);',
'  transition:fill .35s var(--sh-e), transform .35s var(--sh-e), filter .35s; }',
'.sh-st.on{ fill:var(--sh-a); filter:drop-shadow(0 0 5px rgba(217,154,38,.55)); }',
'.sh-st.bump{ animation:sh-bump .42s var(--sh-e); }',
'@keyframes sh-bump{ 0%{transform:scale(1)} 40%{transform:scale(1.42)} 100%{transform:scale(1)} }',

/* ── 하단 목표 스트립 ──────────────────────────────────────── */
/* 아래 패딩이 위보다 두꺼운 이유: 서/동 방위 라벨이 패널의 라운드 코너(반지름 17px)
   안쪽으로 들어가면 '잘릴 뻔한' 느낌이 난다. 라벨 중심을 코너 반지름 바깥에 둔다. */
'.sh-strip{ position:absolute; left:var(--sh-pad); right:var(--sh-pad); bottom:var(--sh-pad);',
'  margin-inline:auto; max-width:var(--sh-strip-w,600px); border-radius:17px; padding:9px 12px 12px;',
'  pointer-events:auto; z-index:10;',
'  transform:translateY(0); opacity:1; transition:transform .55s var(--sh-e), opacity .45s; }',
'.sh-root.is-intro .sh-strip{ transform:translateY(22px); opacity:0; }',
'.sh-strip-head{ display:flex; align-items:center; justify-content:space-between; gap:10px;',
'  margin-bottom:7px; }',
'.sh-strip-t{ font-size:.645rem; font-weight:600; letter-spacing:.2em;',
'  color:rgba(255,255,255,.52); text-transform:uppercase; }',
'.sh-strip-p{ font-size:.66rem; font-weight:600; color:rgba(255,255,255,.5); display:flex; gap:2px;',
'  align-items:baseline; transition:color .3s; }',
'.sh-strip-p b{ font-weight:800; color:var(--sh-txt); font-size:.78rem; letter-spacing:-.02em; }',
'.sh-strip.done .sh-strip-p, .sh-strip.done .sh-strip-p b{ color:var(--sh-a); }',
'.sh-strip.bad .sh-strip-p, .sh-strip.bad .sh-strip-p b{ color:#e9a08f; }',
'.sh-chips{ width:100%; display:flex; align-items:flex-end; justify-content:center;',
'  gap:var(--sh-chip-gap); }',
/* 칩 상태는 셋뿐이고 서로 다른 시각 언어를 쓴다 —
   is-done  : 체크 배지 + 앰버 언더글로우  (이미 출발선에 맞게 놓임)
   is-next  : 앰버 '실선' 링 1개           (지금 놓아야 할 다음 한 량 — 화면에 언제나 최대 1개)
   is-hand  : 연결기 배지                  (지금 기관차에 물려 있음, 여러 개 가능)
   디밍은 칩이 아니라 SVG 에만 걸어 슬롯 번호가 같이 흐려지지 않게 한다. */
'.sh-chip{ position:relative; width:var(--sh-chip-w); flex:0 0 auto; transform:scale(.95);',
'  transition:transform .38s var(--sh-e); }',
'.sh-chip svg.sh-wag{ display:block; width:100%; height:auto; opacity:.72;',
'  filter:grayscale(.34) brightness(.8) drop-shadow(0 2px 3px rgba(0,0,0,.5));',
'  transition:opacity .38s var(--sh-e), filter .38s var(--sh-e); }',
'.sh-chip.is-hand{ transform:translateY(-2px) scale(1); }',
'.sh-chip.is-hand svg.sh-wag{ opacity:1;',
'  filter:grayscale(0) brightness(1) drop-shadow(0 3px 5px rgba(0,0,0,.55)); }',
'.sh-chip.is-done{ transform:scale(1); }',
'.sh-chip.is-done svg.sh-wag{ opacity:1; filter:drop-shadow(0 2px 4px rgba(0,0,0,.5)); }',
'.sh-chip.is-done::before{ content:""; position:absolute; left:-5px; right:-5px; top:-4px; bottom:-2px;',
'  border-radius:9px; background:radial-gradient(62% 74% at 50% 62%,rgba(217,154,38,.24),transparent 72%); }',
'.sh-chip.is-next{ transform:translateY(-3px) scale(1.04); }',
'.sh-chip.is-next svg.sh-wag{ opacity:1;',
'  filter:grayscale(0) brightness(1.07) drop-shadow(0 4px 7px rgba(0,0,0,.6)); }',
'.sh-chip.is-next::before{ content:""; position:absolute; left:-7px; right:-7px; top:-7px; bottom:-4px;',
'  border-radius:12px; background:radial-gradient(60% 72% at 50% 56%,rgba(217,154,38,.26),transparent 74%); }',
'.sh-chip.is-next::after{ content:""; position:absolute; left:-4px; right:-4px; top:-4px; bottom:-1px;',
'  border-radius:9px; border:1.5px solid rgba(244,199,122,.95);',
'  box-shadow:0 0 0 1px rgba(0,0,0,.34), 0 0 13px rgba(217,154,38,.5),',
'    inset 0 0 12px rgba(217,154,38,.16); }',
'.sh-chk{ position:absolute; right:-4px; top:-5px; width:15px; height:15px; border-radius:50%;',
'  background:linear-gradient(180deg,#f6cd85,#d99a26); color:#1d1406; display:grid; place-items:center;',
'  opacity:0; transform:scale(.35); box-shadow:0 2px 7px rgba(0,0,0,.5),',
'    inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(120,74,10,.5);',
'  transition:opacity .3s var(--sh-e), transform .46s var(--sh-e); }',
'.sh-chk svg{ width:10px; height:10px; stroke-width:3.4; }',
'.sh-chip.is-done .sh-chk{ opacity:1; transform:scale(1); }',
/* 연결 표시(=지금 기관차에 물려 있는 량)는 칩 '위'가 아니라 칩과 칩 사이 간격 정중앙,
   차체 높이에 베이스라인을 맞춰 놓는다. 배지가 아니라 실제 연결기처럼 생긴 링크 —
   칩 상단을 침범하지 않고, 이웃한 두 칩 사이에 놓이면 "여기가 이어져 있다"로 읽힌다. */
'.sh-hk{ position:absolute; left:calc(-1 * var(--sh-chip-gap) / 2 - 6px); top:53%;',
'  width:15px; height:11px; display:grid; place-items:center; color:#f7cd8b;',
'  opacity:0; transform:translateY(-50%) scale(.45);',
'  filter:drop-shadow(0 1px 2px rgba(0,0,0,.9)) drop-shadow(0 0 6px rgba(217,154,38,.75));',
'  transition:opacity .3s var(--sh-e), transform .46s var(--sh-e); }',
'.sh-hk svg{ width:15px; height:auto; display:block; }',
'.sh-chip.is-hand .sh-hk{ opacity:1; transform:translateY(-50%) scale(1); }',
'.sh-chip .sh-idx{ position:absolute; left:0; right:0; top:100%; margin-top:3px; text-align:center;',
'  font-size:9.5px; font-weight:800; color:rgba(255,255,255,.7); letter-spacing:0;',
'  text-shadow:0 1px 2px rgba(0,0,0,.7); transition:color .3s; }',
'.sh-chip.is-done .sh-idx{ color:var(--sh-a2); }',
'.sh-chip.is-next .sh-idx{ color:#ffe9c4; text-shadow:0 1px 3px rgba(0,0,0,.8),0 0 9px rgba(217,154,38,.6); }',
'.sh-rail{ position:relative; height:9px; margin:15px 2px 0; }',
'.sh-rail::before{ content:""; position:absolute; left:22px; right:22px; top:3.5px; height:1.6px;',
'  border-radius:1px; background:linear-gradient(90deg,transparent,rgba(207,201,192,.36) 7%,',
'  rgba(207,201,192,.36) 93%,transparent); }',
'.sh-rail::after{ content:""; position:absolute; left:22px; right:22px; top:0; height:8px;',
'  background:repeating-linear-gradient(90deg,rgba(74,59,47,.9) 0 3px,transparent 3px 11px);',
'  opacity:.55; -webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);',
'  mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent); }',
/* 한글은 9px 에서 획이 뭉개진다(동→등). 10.5px + letter-spacing 0 이 최소 가독선.
   방위 라벨은 패널 라운드 코너에 붙으면 잘려 보인다 — 안쪽으로 안전 여백을 준다. */
'.sh-rail span{ position:absolute; top:-2px; font-size:10.5px; line-height:11px; font-weight:600;',
'  letter-spacing:0; color:rgba(255,255,255,.66); text-shadow:0 1px 3px rgba(0,0,0,.7); }',
'.sh-rail .w{ left:0; } .sh-rail .e{ right:0; }',
'.sh-strip-empty{ text-align:center; font-size:.74rem; color:var(--sh-mut); padding:6px 0 2px; }',

/* ── 우하단 버튼 클러스터 ──────────────────────────────────── */
'.sh-cluster{ position:absolute; right:var(--sh-pad); z-index:11;',
'  bottom:calc(var(--sh-strip-h) + var(--sh-pad) + 10px);',
'  display:flex; flex-direction:row; gap:8px;',
'  transform:translateY(0); opacity:1; transition:transform .55s var(--sh-e) .06s, opacity .45s .06s; }',
'.sh-root.is-intro .sh-cluster{ transform:translateY(16px); opacity:0; }',
'.sh-cluster .sh-rb{ width:44px; height:44px; }',
'.sh-cluster .sh-rb svg{ width:20px; height:20px; }',
'.sh-rb.sh-accent{ color:var(--sh-a2); }',

/* ── 승리 중에는 플레이 HUD 를 '완전히' 내린다 ────────────────
   승리 veil 은 backdrop-filter 로 뒤를 흐리는데, 그 뒤에 반투명 유리판이
   그대로 남아 있으면 화면 아래 1/3 에 칩·버튼이 비치는 '유령 잔상 띠'가 생긴다.
   투명도만 0 으로 내리는 것으로는 부족하다 — 여기서 먼저 밀어내고,
   트랜지션이 끝나면 JS 가 display:none 으로 아예 언마운트한다. */
'.sh-root.is-won .sh-strip{ transform:translateY(30px); opacity:0; pointer-events:none; }',
'.sh-root.is-won .sh-cluster{ transform:translateY(18px); opacity:0; pointer-events:none; }',
'.sh-root.is-won .sh-couplers{ opacity:0; pointer-events:none; }',

/* ── 토스트 / 플래시 ───────────────────────────────────────── */
'.sh-toasts{ position:fixed; left:0; right:0; top:0; z-index:70; pointer-events:none;',
'  display:flex; flex-direction:column; align-items:center; gap:7px;',
'  padding:calc(env(safe-area-inset-top) + 60px) 14px 0; }',
'.sh-toast{ max-width:min(420px,92vw); border-radius:13px; padding:9px 14px 9px 13px;',
'  font-size:.8rem; font-weight:600; line-height:1.45; letter-spacing:-.005em;',
'  background-color:var(--sh-glass2); background-image:var(--sh-tint);',
'  -webkit-backdrop-filter:blur(16px) saturate(1.4); backdrop-filter:blur(16px) saturate(1.4);',
'  border:var(--sh-bd); border-top-color:rgba(255,255,255,.20);',
'  box-shadow:var(--sh-sh),var(--sh-hi); position:relative; overflow:hidden;',
'  opacity:0; transform:translateY(-13px) scale(.96);',
'  transition:opacity .28s var(--sh-e), transform .38s var(--sh-e); }',
'.sh-toast::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px;',
'  background:var(--sh-a); }',
'.sh-toast.warn::before{ background:#e5534b; }',
'.sh-toast.good::before{ background:#3fa76a; }',
'.sh-toast.in{ opacity:1; transform:translateY(0) scale(1); }',
'.sh-flash{ position:fixed; left:0; right:0; top:0; bottom:0; z-index:36; pointer-events:none;',
'  display:grid; place-items:center; align-content:center; }',
'.sh-flash span{ font-size:clamp(1.4rem,5.2vw,2.3rem); font-weight:800; letter-spacing:-.03em;',
'  color:#fff; text-shadow:0 4px 26px rgba(0,0,0,.75), 0 0 44px rgba(217,154,38,.45);',
'  opacity:0; transform:translateY(-14vh) scale(.86); }',
'.sh-flash.go span{ animation:sh-flash 1.15s var(--sh-e) forwards; }',
'@keyframes sh-flash{',
'  0%{opacity:0; transform:translateY(-14vh) scale(.86)}',
'  18%{opacity:1; transform:translateY(-14vh) scale(1.02)}',
'  70%{opacity:1; transform:translateY(-14vh) scale(1)}',
'  100%{opacity:0; transform:translateY(-17vh) scale(1.06)} }',

/* ── 연결기 마커 ───────────────────────────────────────────── */
'.sh-couplers{ position:fixed; inset:0; z-index:12; pointer-events:none; }',
'.sh-root .sh-cpl{ position:absolute; width:38px; height:38px; margin:-19px 0 0 -19px; border-radius:50%;',
'  pointer-events:auto; display:grid; place-items:center; color:#1d1406;',
'  background:linear-gradient(180deg,#f6cd85,#d99a26); border:1.5px solid rgba(255,255,255,.5);',
'  box-shadow:0 6px 18px -4px rgba(0,0,0,.7), 0 0 24px rgba(217,154,38,.45);',
'  opacity:0; transform:scale(.5); transition:opacity .26s var(--sh-e), transform .34s var(--sh-e); }',
'.sh-cpl.in{ opacity:1; transform:scale(1); }',
'.sh-cpl svg{ width:20px; height:20px; stroke-width:2.1; }',
'.sh-cpl::before{ content:""; position:absolute; inset:-5px; border-radius:50%;',
'  border:2px solid rgba(242,196,118,.75); animation:sh-ping 1.7s var(--sh-e) infinite; }',
'@keyframes sh-ping{ 0%{transform:scale(.86); opacity:.85} 70%{transform:scale(1.5); opacity:0}',
'  100%{transform:scale(1.5); opacity:0} }',
'.sh-cpl:active{ transform:scale(.9); }',

/* ── 튜토리얼 코치마크 ─────────────────────────────────────── */
'.sh-coach{ position:fixed; inset:0; z-index:30; pointer-events:none; opacity:0;',
'  display:block; transition:opacity .34s var(--sh-e); }',
'.sh-coach.is-on{ opacity:1; }',
'.sh-coach-pt{ position:absolute; width:0; height:0; }',
'.sh-coach-ring{ position:absolute; left:-27px; top:-27px; width:54px; height:54px; border-radius:50%;',
'  border:2px solid rgba(242,196,118,.85); animation:sh-ping 1.9s var(--sh-e) infinite; }',
'.sh-coach-ring.b{ animation-delay:.65s; }',
'.sh-coach-dot{ position:absolute; left:-6px; top:-6px; width:12px; height:12px; border-radius:50%;',
'  background:var(--sh-a2); box-shadow:0 0 18px rgba(242,196,118,.8); }',
'.sh-coach-hand{ position:absolute; left:-2px; top:3px; width:34px; height:34px; color:#f6e2bd;',
'  filter:drop-shadow(0 4px 10px rgba(0,0,0,.7)); animation:sh-tap 1.9s var(--sh-e) infinite; }',
'.sh-coach-hand svg{ width:100%; height:100%; stroke-width:1.7; }',
'@keyframes sh-tap{ 0%,100%{transform:translate(6px,6px) scale(1)} 12%{transform:translate(0,0) scale(.9)}',
'  30%{transform:translate(6px,6px) scale(1)} }',
'.sh-coach-bub{ position:absolute; max-width:min(280px,84vw); border-radius:15px; padding:12px 14px;',
'  background-color:var(--sh-glass2); background-image:var(--sh-tint);',
'  -webkit-backdrop-filter:blur(16px) saturate(1.4); backdrop-filter:blur(16px) saturate(1.4);',
'  border:var(--sh-bd); border-top-color:rgba(255,255,255,.20);',
'  box-shadow:var(--sh-sh),var(--sh-hi); pointer-events:auto; }',
'.sh-coach-bub p{ margin:0; font-size:.81rem; font-weight:600; line-height:1.55; color:var(--sh-txt); }',
'.sh-coach-bub .k{ display:block; font-size:.6rem; font-weight:800; letter-spacing:.18em;',
'  color:var(--sh-a); margin-bottom:5px; text-transform:uppercase; }',
'.sh-coach-bub button{ margin-top:9px; font-size:.72rem; font-weight:700; color:#1d1406;',
'  background:linear-gradient(180deg,#f0c176,#d99a26); border-radius:9px; padding:6px 13px; }',
'.sh-coach-arw{ position:absolute; width:12px; height:12px; background:var(--sh-glass2);',
'  -webkit-backdrop-filter:blur(16px) saturate(1.4); backdrop-filter:blur(16px) saturate(1.4);',
'  border-left:var(--sh-bd); border-top:var(--sh-bd); transform:rotate(45deg); }',

'@media (prefers-reduced-motion: reduce){',
'  .sh-root *, .sh-toast, .sh-coach, .sh-sheet, .sh-win, .sh-scrim{',
'    transition-duration:.01ms !important; animation-duration:.01ms !important;',
'    animation-iteration-count:1 !important; }',
'}',
''
  ].join('\n');

  var CSS2 = [
/* ── 스크림 / 레벨 선택 시트 ───────────────────────────────── */
/* 스크림·승리 veil 은 회색이 아니라 '어두운 앰버' — 뒤의 골든아워 씬이 탈색되면 안 된다 */
'.sh-scrim{ position:fixed; inset:0; z-index:50; display:block; opacity:0; pointer-events:auto;',
'  background:radial-gradient(122% 84% at 50% 100%,rgba(38,25,11,.58),rgba(11,9,6,.80));',
'  -webkit-backdrop-filter:blur(4px) saturate(1.18); backdrop-filter:blur(4px) saturate(1.18);',
'  transition:opacity .34s var(--sh-e); }',
'.sh-scrim.is-on{ opacity:1; }',
'.sh-sheet{ position:fixed; left:0; right:0; bottom:0; z-index:51;',
'  max-height:min(80vh,660px); border-radius:22px 22px 0 0; border-bottom:0;',
'  padding:8px 0 calc(env(safe-area-inset-bottom) + 6px);',
'  transform:translateY(101%); transition:transform .46s var(--sh-e);',
'  display:flex; flex-direction:column; pointer-events:auto; }',
'.sh-sheet.is-on{ transform:translateY(0); }',
'.sh-grab{ width:38px; height:4px; border-radius:2px; background:rgba(255,255,255,.2);',
'  margin:2px auto 10px; flex:0 0 auto; }',
'.sh-sheet-head{ display:flex; align-items:center; gap:10px; padding:0 18px 12px; flex:0 0 auto;',
'  border-bottom:1px solid rgba(255,255,255,.06); }',
'.sh-sheet-head h2{ margin:0; font-size:1.02rem; font-weight:800; letter-spacing:-.02em; flex:1 1 auto; }',
'.sh-sheet-tot{ font-size:.74rem; font-weight:700; color:var(--sh-a); display:flex; align-items:center;',
'  gap:4px; }',
'.sh-sheet-tot svg{ width:12px; height:12px; fill:var(--sh-a); }',
'.sh-sheet-body{ overflow-y:auto; -webkit-overflow-scrolling:touch; padding:14px 16px 16px;',
'  display:grid; gap:9px; grid-template-columns:repeat(auto-fill,minmax(148px,1fr)); flex:1 1 auto; }',
'.sh-root .sh-card{ position:relative; text-align:left; padding:11px 12px 10px; border-radius:14px;',
'  background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08);',
'  box-shadow:var(--sh-hi); overflow:hidden; min-height:84px;',
'  transition:transform .22s var(--sh-e), background .2s, border-color .2s; }',
'.sh-root .sh-card:hover{ transform:translateY(-2px); background:rgba(255,255,255,.085);',
'  border-color:rgba(255,255,255,.17); }',
'.sh-root .sh-card:active{ transform:translateY(0) scale(.985); }',
'.sh-card-num{ font-size:.66rem; font-weight:600; letter-spacing:.16em; color:var(--sh-a); }',
'.sh-card-name{ display:block; font-size:.86rem; font-weight:700; margin:2px 0 7px;',
'  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
'.sh-card-foot{ display:flex; align-items:center; justify-content:space-between; gap:8px; }',
'.sh-card-foot .sh-stars{ padding:0; }',
'.sh-card-best{ font-size:.66rem; font-weight:700; color:var(--sh-mut); }',
'.sh-card.is-cur{ border-color:rgba(217,154,38,.55); background:rgba(217,154,38,.09); }',
'.sh-card.is-cur::after{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px;',
'  background:var(--sh-a); }',
'.sh-card.is-locked{ pointer-events:none; }',
'.sh-card.is-locked{ background:rgba(255,255,255,.022); }',
'.sh-card.is-locked .sh-card-num, .sh-card.is-locked .sh-card-foot{ opacity:.22; }',
'.sh-card-lock{ position:absolute; inset:0; display:grid; place-items:center; color:var(--sh-mut); }',
'.sh-card-lock svg{ width:20px; height:20px; opacity:.55; }',

/* ── 승리 오버레이 ─────────────────────────────────────────── */
/* 승리 화면은 '결과 발표'지 모달 팝업이 아니다 — 화면 위쪽 2/3 는 거의 손대지 않고
   (완성된 편성이 보여야 한다) 아래쪽에만 따뜻한 어둠을 깔아 카드를 앉힌다.
   블러는 4px 까지만: 뒤가 진흙이 되면 무엇을 완성했는지 읽히지 않는다. */
'.sh-win{ position:fixed; inset:0; z-index:60; display:flex; opacity:0;',
'  align-items:center; justify-content:center; padding:20px; overflow:auto;',
'  background:linear-gradient(180deg,rgba(22,14,7,.04) 0%,rgba(22,14,7,.02) 34%,',
'    rgba(22,14,7,.10) 66%,rgba(14,10,5,.24) 100%);',
'  transition:opacity .4s var(--sh-e); pointer-events:auto; }',
'.sh-win.is-on{ opacity:1; }',
/* 블러는 화면 전체가 아니라 카드가 앉는 아래쪽에만, 그것도 위로 갈수록 사라지게(마스크).
   위쪽 절반은 손대지 않으므로 완성된 편성이 또렷하게 남는다. */
'.sh-win-veil{ position:absolute; left:0; right:0; bottom:0; height:min(66%,580px);',
'  pointer-events:none;',
'  -webkit-backdrop-filter:blur(7px) saturate(1.24); backdrop-filter:blur(7px) saturate(1.24);',
'  background:linear-gradient(180deg,transparent,rgba(32,20,9,.44) 50%,rgba(12,8,4,.88)),',
'    radial-gradient(128% 74% at 50% 122%,rgba(217,154,38,.26),transparent 64%);',
'  -webkit-mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.22) 24%,',
'    rgba(0,0,0,.72) 50%,#000 72%,#000 100%);',
'  mask-image:linear-gradient(180deg,transparent 0%,rgba(0,0,0,.22) 24%,',
'    rgba(0,0,0,.72) 50%,#000 72%,#000 100%); }',
/* 다이얼로그 컨테이너에 포커스를 준다(주 버튼에 주면 굵은 링이 위계를 흐린다) */
'.sh-root .sh-win:focus, .sh-root .sh-win:focus-visible{ outline:none; }',
/* 카드는 아래로 — 위쪽 절반은 히어로 카메라가 잡은 완성 편성 자리다.
   카드가 확실히 들어가는 높이에서만 (min-height 가드) 정렬을 바꿔 잘림을 막는다. */
'@media (min-height:640px){ .sh-win{ align-items:flex-end;',
'  padding-bottom:clamp(20px,7vh,66px); } }',
'.sh-win-card{ position:relative; width:min(372px,100%); border-radius:20px; padding:22px 20px 18px;',
'  text-align:center; overflow:hidden; transform:translateY(16px) scale(.96);',
'  transition:transform .55s var(--sh-e); }',
'.sh-win.is-on .sh-win-card{ transform:translateY(0) scale(1); }',
'.sh-win-card::before{ content:""; position:absolute; left:-40%; top:-60%; width:60%; height:220%;',
'  background:linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent);',
'  transform:rotate(14deg) translateX(-40px); opacity:0; }',
'.sh-win.is-on .sh-win-card::before{ animation:sh-shine 1.5s var(--sh-e) .35s 1; }',
'@keyframes sh-shine{ 0%{opacity:0; transform:rotate(14deg) translateX(-120px)}',
'  25%{opacity:1} 100%{opacity:0; transform:rotate(14deg) translateX(420px)} }',
'.sh-win-glow{ position:absolute; left:50%; top:-6px; width:250px; height:162px; margin-left:-125px;',
'  border-radius:50%; pointer-events:none; opacity:0;',
'  background:radial-gradient(closest-side,rgba(217,154,38,.26),transparent 72%);',
'  transition:opacity .8s var(--sh-e); }',
'.sh-win-card.g1 .sh-win-glow{ opacity:.44 } .sh-win-card.g2 .sh-win-glow{ opacity:.68 }',
'.sh-win-card.g3 .sh-win-glow{ opacity:.86 }',
'.sh-win-kicker{ position:relative; font-size:.6rem; font-weight:600; letter-spacing:.21em;',
'  color:var(--sh-a); text-transform:uppercase; opacity:.9; }',
'.sh-win-title{ position:relative; margin:5px 0 2px; font-size:1.42rem; font-weight:800;',
'  letter-spacing:-.035em; }',
'.sh-win-sub{ position:relative; font-size:.76rem; font-weight:600; color:var(--sh-mut); }',
/* 별은 카드에서 가장 큰 요소가 아니다 — 제목이 주인공이고 별은 그 아래 놓인 '검인'이다.
   44px 광택 금별은 절제된 골든아워 디오라마와 충돌한다 → 36px, 낮은 채도/명도의 황동. */
'.sh-win-stars{ position:relative; display:flex; justify-content:center; gap:8px; margin:12px 0 10px; }',
'.sh-wst{ width:36px; height:36px; position:relative; opacity:.5; transform:scale(.74);',
'  transition:opacity .3s, transform .3s; }',
'.sh-wst svg{ width:100%; height:100%; display:block; overflow:visible; }',
/* 빈 슬롯 = 파인 홈. 채워진 별 = 금속 도장: 금 그라디언트 + 위 스페큘러 + 아래 웜 바운스 */
'.sh-wst .b{ fill:rgba(255,255,255,.05); }',
'.sh-wst .f, .sh-wst .c{ fill:none; }',
'.sh-wst .o{ fill:none; stroke:rgba(255,255,255,.14); stroke-width:.7; stroke-linejoin:round; }',
'.sh-wst.on{ opacity:1; transform:scale(1); }',
'.sh-wst.on svg{ filter:drop-shadow(0 3px 8px rgba(217,154,38,.3)); }',
'.sh-wst.on .b{ fill:url(#shGold); }',
'.sh-wst.on .f{ fill:url(#shGloss); }',
'.sh-wst.on .c{ fill:url(#shCore); }',
/* 작아진 만큼 윤곽선이 형태를 잡아 준다 — 어두운 앰버 림 (밝은 테두리는 금지) */
'.sh-wst.on .o{ stroke:rgba(84,54,10,.72); stroke-width:.62; }',
'.sh-wst.pop{ animation:sh-pop .62s var(--sh-e) forwards; }',
'@keyframes sh-pop{ 0%{transform:scale(.4) rotate(-22deg); opacity:0}',
'  55%{transform:scale(1.24) rotate(6deg); opacity:1} 100%{transform:scale(1) rotate(0); opacity:1} }',
'.sh-wst i{ position:absolute; inset:-8px; border-radius:50%; border:2px solid rgba(242,196,118,.8);',
'  opacity:0; }',
'.sh-wst.pop i{ animation:sh-burst .62s var(--sh-e) forwards; }',
'@keyframes sh-burst{ 0%{opacity:.9; transform:scale(.45)} 100%{opacity:0; transform:scale(1.9)} }',
/* 완성된 편성 — 승리 화면에서 "내가 무엇을 만들었나"가 카드 안에서도 읽혀야 한다.
   목표 스트립과 같은 실루엣을 쓰되 전부 '완료' 상태(풀컬러)로. */
'.sh-win-consist{ position:relative; display:flex; align-items:flex-end; justify-content:center;',
'  gap:3px; margin:0 0 3px; padding:8px 9px 7px; border-radius:12px;',
'  background:linear-gradient(180deg,rgba(0,0,0,.30),rgba(0,0,0,.10));',
'  border:1px solid rgba(255,255,255,.055);',
'  box-shadow:inset 0 1px 0 rgba(255,255,255,.05), inset 0 -8px 12px -10px rgba(0,0,0,.65); }',
'.sh-win-consist::after{ content:""; position:absolute; left:11px; right:11px; bottom:4px; height:1.4px;',
'  border-radius:1px; background:linear-gradient(90deg,transparent,rgba(207,201,192,.30) 8%,',
'  rgba(207,201,192,.30) 92%,transparent); }',
'.sh-wc{ flex:0 1 auto; min-width:0; width:31px; }',
'.sh-wc svg{ display:block; width:100%; height:auto;',
'  filter:drop-shadow(0 2px 3px rgba(0,0,0,.6)); }',
'.sh-win-stat{ position:relative; display:flex; align-items:center; justify-content:center; gap:14px;',
'  padding:11px 0 3px; border-top:1px solid rgba(255,255,255,.07); margin-top:9px; }',
'.sh-win-cell{ text-align:center; min-width:62px; }',
'.sh-win-cell b{ display:block; font-size:1.34rem; font-weight:800; line-height:1.1;',
'  letter-spacing:-.035em; }',
'.sh-win-cell span{ display:block; font-size:.6rem; font-weight:600; letter-spacing:.17em;',
'  color:rgba(238,242,248,.54); text-transform:uppercase; margin-top:4px; }',
'.sh-win-cell.acc b{ color:var(--sh-a2); }',
'.sh-win-cell.over b{ color:#e9a08f; }',
'.sh-win-vs{ width:1px; height:30px; background:rgba(255,255,255,.1); }',
'.sh-win-rec{ position:relative; display:inline-flex; align-items:center; gap:5px; margin-top:10px;',
'  font-size:.66rem; font-weight:800; letter-spacing:.06em; color:#1d1406; padding:4px 10px;',
'  border-radius:999px; background:linear-gradient(180deg,#f6cd85,#d99a26);',
'  box-shadow:0 4px 14px -4px rgba(217,154,38,.8); }',
'.sh-win-btns{ position:relative; display:grid; gap:8px; margin-top:16px; }',
'.sh-win-row{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }',
'.sh-root .sh-pb{ display:flex; align-items:center; justify-content:center; gap:7px; padding:13px 16px;',
'  border-radius:13px; font-size:.9rem; font-weight:800; letter-spacing:-.01em; color:#20160a;',
/* 별을 낮췄으니 주 버튼이 대신 튀면 의미가 없다 — 네온이 아니라 '도장된 놋쇠판'.
   광량은 줄이고 위/아래 립으로 두께를 준다. */
'  background:linear-gradient(180deg,#e3aa46,#bb7c16);',
'  box-shadow:0 10px 22px -14px rgba(217,154,38,.55), 0 6px 16px -10px rgba(0,0,0,.5),',
'    inset 0 1px 0 rgba(255,242,218,.36), inset 0 -1px 0 rgba(86,53,5,.45);',
'  transition:transform .2s var(--sh-e), filter .2s; }',
'.sh-root .sh-pb:hover{ filter:brightness(1.07); transform:translateY(-1px); }',
'.sh-root .sh-pb:active{ transform:translateY(0) scale(.985); }',
'.sh-root .sh-pb svg{ width:17px; height:17px; stroke-width:2.4; }',
'.sh-root .sh-sb{ display:flex; align-items:center; justify-content:center; gap:6px; padding:11px 12px;',
'  border-radius:13px; font-size:.82rem; font-weight:700; color:var(--sh-txt);',
'  background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.11);',
'  box-shadow:var(--sh-hi); transition:transform .2s var(--sh-e), background .2s; }',
'.sh-root .sh-sb:hover{ background:rgba(255,255,255,.12); transform:translateY(-1px); }',
'.sh-root .sh-sb:active{ transform:translateY(0) scale(.985); }',
'.sh-root .sh-sb svg{ width:15px; height:15px; }',
'.sh-root .sh-tb{ font-size:.72rem; font-weight:700; color:var(--sh-mut); padding:7px; }',
'.sh-root .sh-tb:hover{ color:var(--sh-txt); }',
/* 마지막 판이라 "다음 레벨"이 없을 때 — '다시'가 채워진 주 동작으로 승격된다.
   두 버튼이 같은 외곽선이면 위계가 사라진다. 행 안에서는 두 버튼 높이를 맞춘다. */
'.sh-root .sh-win-row .sh-pb{ padding:11px 12px; font-size:.86rem; }',
'.sh-root .sh-win-row .sh-pb svg{ width:15px; height:15px; }',

/* 큰 패널은 유리를 조금 더 두껍게 — 밝은 골든아워 배경 위에서도 글자가 읽혀야 한다.
   (블러/채도는 .sh-glass 가 담당. 여기서는 두께감만 더한다) */
'.sh-root .sh-bar, .sh-root .sh-strip, .sh-root .sh-win-card, .sh-root .sh-sheet{',
'  background-color:rgba(14,17,22,.62); }',
'.sh-root .sh-win-card{ border-top-color:rgba(255,228,186,.30);',
'  box-shadow:0 34px 70px rgba(0,0,0,.62), 0 10px 24px -12px rgba(0,0,0,.7),',
'    0 0 0 1px rgba(217,154,38,.1), var(--sh-hi); }',

/* ── 반응형 ────────────────────────────────────────────────── */
'@media (min-width:720px){',
'  #ui-root{ --sh-pad:16px; }',
'  .sh-strip{ right:132px; padding:11px 14px 14px; border-radius:19px; }',
'  .sh-strip-t{ font-size:.66rem; } .sh-strip-p b{ font-size:.8rem; }',
'  .sh-chip .sh-idx{ font-size:9px; }',
'  .sh-toast{ font-size:.84rem; padding:10px 16px 10px 14px; }',
'  .sh-coach-bub p{ font-size:.85rem; }',
'  .sh-cluster{ bottom:var(--sh-pad); display:grid; grid-template-columns:repeat(2,44px); gap:9px; }',
'  .sh-rb{ width:42px; height:42px; }',
/* 데스크톱: 상단 바를 내용 폭으로 줄여 가운데 띄운다 (양쪽 여백이 비지 않도록) */
'  .sh-top{ justify-content:space-between; }',
'  .sh-bar{ flex:0 1 auto; height:44px; border-radius:22px; margin-inline:auto;',
'    max-width:min(560px,58vw); padding-right:6px; }',
'  .sh-lv{ flex:0 1 auto; }',
'  .sh-lv-name{ font-size:.88rem; max-width:26vw; }',
'  .sh-mv-n{ font-size:1.1rem; }',
'  .sh-st{ width:13px; height:13px; }',
'}',
'@media (max-width:719px){',
'  .sh-lv-name{ max-width:34vw; }',
'}',
'@media (max-width:400px){',
'  #ui-root{ --sh-pad:9px; }',
'  .sh-bar{ padding-left:10px; gap:7px; }',
'  .sh-lv-name{ font-size:.78rem; max-width:26vw; }',
'  .sh-rb{ width:37px; height:37px; }',
'  .sh-rb svg{ width:17px; height:17px; }',
'  .sh-cluster .sh-rb{ width:41px; height:41px; }',
'  .sh-strip{ padding:8px 10px 11px; border-radius:15px; }',
'}',
/* 세로 폰: 슬롯 번호와 침목 눈금이 같은 띠에 겹쳐 둘 다 안 읽혔다.
   번호는 칩 '위'로 올려 순서 눈금자로 분리하고(칩은 레일 위에 그대로 선다),
   아래 띠에는 레일 한 줄과 서/동 방위만 남긴다 — 눈금은 세로에서 끈다. */
'@media (max-width:480px) and (orientation:portrait){',
'  .sh-strip-head{ margin-bottom:19px; }',
'  .sh-chip .sh-idx{ top:auto; bottom:100%; margin:0 0 6px; font-size:9px;',
'    color:rgba(255,255,255,.58); }',
'  .sh-chip.is-done .sh-idx{ color:rgba(242,196,118,.88); }',
/* 칩이 들리면(연결 중·다음 차례) 번호까지 같이 올라가 눈금자 행이 들쭉날쭉해지고
   진행 표시(0/8)에 부딪힌다 — 칩의 리프트만큼 번호를 되돌려 한 줄에 고정한다. */
'  .sh-chip.is-hand .sh-idx{ transform:translateY(2px); }',
'  .sh-chip.is-next .sh-idx{ transform:translateY(3.6px); }',
'  .sh-rail{ margin-top:5px; }',
'  .sh-rail::after{ display:none; }',
'  .sh-rail::before{ left:26px; right:26px; }',
'}',
'@media (orientation:landscape) and (max-height:520px){',
'  .sh-strip{ left:74px; right:74px; bottom:8px; padding:6px 10px 9px; }',
'  .sh-strip-head{ margin-bottom:5px; }',
'  .sh-rail{ margin-top:6px; height:8px; }',
'  .sh-cluster{ right:8px; bottom:auto; top:50%; transform:translateY(-50%);',
'    display:flex; flex-direction:column; gap:7px; }',
'  .sh-root.is-intro .sh-cluster{ transform:translateY(-46%); }',
'  .sh-cluster .sh-rb{ width:38px; height:38px; }',
'  .sh-cluster .sh-rb svg{ width:17px; height:17px; }',
'  .sh-sheet{ max-height:92vh; }',
'  .sh-win-card{ padding:16px 18px 14px; }',
'  .sh-win-stars{ margin:9px 0 7px; } .sh-wst{ width:30px; height:30px; }',
'  .sh-win-title{ font-size:1.2rem; }',
'  .sh-win-consist{ padding:5px 7px 5px; gap:2px; } .sh-wc{ width:24px; }',
'  .sh-win-stat{ margin-top:6px; padding-top:8px; }',
'}',

/* ── backdrop-filter 폴백 ──────────────────────────────────────
   블러가 없는 브라우저에서는 반투명 판이 밝은 골든아워 하늘 위에서 그냥 흐려질 뿐이라
   글자 대비가 무너진다. 그럴 때는 유리를 포기하고 '불투명한 판'으로 확실히 전환한다.
   (반쪽짜리 반투명이 제일 나쁘다.) */
'@supports not ((-webkit-backdrop-filter:blur(2px)) or (backdrop-filter:blur(2px))){',
'  #ui-root{ --sh-glass:rgba(12,15,20,.90); --sh-glass2:rgba(14,17,23,.95); }',
'  .sh-root .sh-bar, .sh-root .sh-strip, .sh-root .sh-win-card, .sh-root .sh-sheet{',
'    background-color:rgba(12,15,20,.92); }',
'  .sh-win-veil{ background:linear-gradient(180deg,transparent,rgba(30,19,8,.66) 48%,',
'    rgba(10,7,3,.93)),radial-gradient(128% 74% at 50% 122%,rgba(217,154,38,.2),transparent 64%); }',
'  .sh-scrim{ background:radial-gradient(122% 84% at 50% 100%,rgba(38,25,11,.80),rgba(9,7,5,.93)); }',
'  .sh-coach-bub, .sh-coach-arw{ background-color:rgba(14,17,23,.95); }',
'}',
''
  ].join('\n');

  /* ── 화차 칩 실루엣 (인라인 SVG) ────────────────────────────── */
  function wagonSVG(type, livery) {
    var c = safeHex(livery);
    var hi = U.shade(c, .30), lo = U.shade(c, -.34), lo2 = U.shade(c, -.58);
    var frame = '#20242b', wheel = '#2a2f38', hub = '#5c636d';
    var base =
      '<rect x="4.4" y="21.3" width="37.2" height="2.2" rx="1.1" fill="' + frame + '"/>' +
      '<circle cx="12.6" cy="25.1" r="2.75" fill="' + wheel + '"/>' +
      '<circle cx="33.4" cy="25.1" r="2.75" fill="' + wheel + '"/>' +
      '<circle cx="12.6" cy="25.1" r="0.95" fill="' + hub + '"/>' +
      '<circle cx="33.4" cy="25.1" r="0.95" fill="' + hub + '"/>' +
      '<rect x="1.4" y="20.4" width="3" height="2.2" rx="1.1" fill="' + lo2 + '"/>' +
      '<rect x="41.6" y="20.4" width="3" height="2.2" rx="1.1" fill="' + lo2 + '"/>';
    var b = '';
    switch (type) {
      case 'open':
        b = '<path d="M5.4 11.6H40.6v9.7H5.4z" fill="' + c + '"/>' +
            '<path d="M5.4 11.6H40.6v1.6H5.4z" fill="' + hi + '"/>' +
            '<path d="M7.8 11.6C10.1 8.8 12.5 9.9 14.3 10.5C16.7 8.3 19.5 9.1 21.3 10.3C24.1 7.9 27.5 8.9 29.5 10.6' +
            'C31.5 9.1 33.9 9.7 35.3 11.6Z" fill="#3a352d"/>' +
            '<path d="M12.4 10.2l1.5-.8.9 1.1zM24.6 9.6l1.6-.7.8 1.2z" fill="#5b5347"/>' +
            '<path d="M5.4 17.3H40.6" stroke="' + lo2 + '" stroke-width=".8" opacity=".55"/>';
        break;
      case 'tank':
        b = '<rect x="5.2" y="19.1" width="35.6" height="2.4" rx="1.2" fill="' + lo2 + '"/>' +
            '<rect x="6.2" y="9.5" width="33.6" height="10.6" rx="5.3" fill="' + c + '"/>' +
            '<rect x="7.4" y="10.2" width="31.2" height="2.9" rx="1.45" fill="' + hi + '" opacity=".55"/>' +
            '<rect x="19.4" y="6.4" width="6.8" height="3.4" rx="1.5" fill="' + lo + '"/>' +
            '<rect x="20.6" y="5.3" width="4.4" height="1.7" rx=".85" fill="' + hi + '"/>' +
            '<path d="M14.6 9.7v10.2M29.4 9.7v10.2" stroke="' + lo2 + '" stroke-width=".8" opacity=".5"/>' +
            '<path d="M34.6 10.1v9.4M37.4 10.1v9.4M34.6 12.6h2.8M34.6 15h2.8M34.6 17.4h2.8" ' +
            'stroke="' + lo2 + '" stroke-width=".85" fill="none"/>';
        break;
      case 'flat':
        var crate = U.mixHex(c, '#7d6042', .6), crateHi = U.shade(crate, .24);
        b = '<rect x="4.2" y="18.2" width="37.6" height="3.2" rx="1.1" fill="' + c + '"/>' +
            '<rect x="4.2" y="18.2" width="37.6" height="1.1" rx=".55" fill="' + hi + '" opacity=".75"/>' +
            '<rect x="13.2" y="10" width="19.6" height="8.2" rx=".9" fill="' + crate + '"/>' +
            '<rect x="13.2" y="10" width="19.6" height="1.6" rx=".7" fill="' + crateHi + '"/>' +
            '<path d="M18.4 10v8.2M27.6 10v8.2" stroke="#2b2620" stroke-width="1.1" opacity=".85"/>' +
            '<path d="M5.4 18.2v-2.6M40.6 18.2v-2.6M23 18.2v-2.2" stroke="' + lo2 + '" stroke-width="1.1"/>';
        break;
      case 'hopper':
        b = '<path d="M5.2 8.8H40.8L34.6 19.1H11.4Z" fill="' + c + '"/>' +
            '<rect x="5.2" y="8.8" width="35.6" height="1.7" rx=".8" fill="' + hi + '"/>' +
            '<path d="M11.4 19.1h6.2v2.6h-6.2zM28.4 19.1h6.2v2.6h-6.2z" fill="' + lo2 + '"/>' +
            '<path d="M17.4 9.6L14.8 19.1M28.6 9.6L31.2 19.1" stroke="' + lo + '" stroke-width=".85" opacity=".8"/>' +
            '<path d="M23 9.6v9.5" stroke="' + lo2 + '" stroke-width=".7" opacity=".5"/>';
        break;
      case 'brake':
        b = '<rect x="33.4" y="20.3" width="8.4" height="1.2" rx=".6" fill="' + lo2 + '"/>' +
            '<path d="M34.6 20.3v-5.2M38 20.3v-5.2M41.4 20.3v-5.2M34.6 15.1h6.8" ' +
            'stroke="' + lo + '" stroke-width=".9" fill="none"/>' +
            '<rect x="10.4" y="8.9" width="23.2" height="12.4" rx="1.1" fill="' + c + '"/>' +
            '<rect x="8.8" y="7" width="26.4" height="2.2" rx="1.1" fill="' + hi + '"/>' +
            '<rect x="13" y="3.8" width="2.8" height="3.3" rx=".7" fill="' + lo2 + '"/>' +
            '<rect x="19" y="11.6" width="7.6" height="5.2" rx=".8" fill="#a6c9db" opacity=".85"/>' +
            '<rect x="19" y="11.6" width="7.6" height="5.2" rx=".8" fill="none" stroke="' + lo2 + '" stroke-width=".8"/>' +
            '<path d="M12.6 12v8.4" stroke="' + lo2 + '" stroke-width=".8" opacity=".55"/>';
        break;
      default: /* box */
        b = '<path d="M5.2 9.5Q23 6.4 40.8 9.5V21.3H5.2Z" fill="' + c + '"/>' +
            '<path d="M5.2 9.5Q23 6.4 40.8 9.5V11.2Q23 8.1 5.2 11.2Z" fill="' + hi + '"/>' +
            '<rect x="17.2" y="11.7" width="11.6" height="9.6" fill="' + lo + '"/>' +
            '<path d="M23 11.7v9.6" stroke="' + lo2 + '" stroke-width=".9"/>' +
            '<path d="M20.4 16.4h1.7M23.9 16.4h1.7" stroke="' + hi + '" stroke-width=".9" opacity=".75"/>' +
            '<path d="M5.2 19.9H40.8" stroke="' + lo2 + '" stroke-width=".7" opacity=".5"/>' +
            '<path d="M10.4 11.9v9.4M35.6 11.9v9.4" stroke="' + lo2 + '" stroke-width=".7" opacity=".4"/>';
        break;
    }
    return '<svg class="sh-wag" viewBox="0 0 46 30" xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true" focusable="false">' + base + b + '</svg>';
  }

  /* ── DOM 조립 ────────────────────────────────────────────────── */
  function rb(cls, label, icon, extraCls) {
    var b = el('button', 'sh-rb sh-glass ' + (extraCls || '') + ' ' + cls, icon);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  function build() {
    var host = document.getElementById('ui-root');
    if (!host) return false;

    if (!styleEl) {
      styleEl = el('style');
      styleEl.id = 'sh-ui-style';
      styleEl.textContent = CSS + CSS2;
      document.head.appendChild(styleEl);
    }

    root = el('div', 'sh-root is-intro');
    /* 별 그라디언트 정의 (승리 오버레이용) */
    root.appendChild(el('div', 'sh-defs',
      '<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">' +
      '<defs>' +
      /* 광택 금이 아니라 '오래 쓴 황동'. 흰색으로 날아가는 하이라이트를 없애고
         명도 폭을 좁혀(0.91 → 0.49) 액센트 #d99a26 와 같은 톤에 머무르게 한다. */
      '<linearGradient id="shGold" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#e8d3a6"/><stop offset=".38" stop-color="#d0a851"/>' +
      '<stop offset=".66" stop-color="#b78421"/><stop offset="1" stop-color="#7d5410"/>' +
      '</linearGradient>' +
      /* 위 스페큘러 → 중간 소멸 → 아래 따뜻한 반사광 (SPEC 3.2 의 키/필/바운스와 같은 순서) */
      '<linearGradient id="shGloss" x1=".18" y1="0" x2=".82" y2="1">' +
      '<stop offset="0" stop-color="#fff3dd" stop-opacity=".3"/>' +
      '<stop offset=".3" stop-color="#ffe6bd" stop-opacity=".05"/>' +
      '<stop offset=".64" stop-color="#5c3907" stop-opacity=".28"/>' +
      '<stop offset="1" stop-color="#ffdca6" stop-opacity=".17"/>' +
      '</linearGradient>' +
      '<linearGradient id="shCore" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fff4d8" stop-opacity=".27"/>' +
      '<stop offset=".85" stop-color="#fff4d8" stop-opacity="0"/>' +
      '</linearGradient>' +
      '</defs></svg>'));

    /* ── 상단 바 ── */
    var top = el('div', 'sh-top');
    var home = el('a', 'sh-rb sh-glass sh-home', ICON.back);
    home.href = '../';
    home.setAttribute('aria-label', '게임 랩으로 돌아가기');
    home.title = '게임 랩';
    var bar = el('div', 'sh-bar sh-glass');
    var lv = el('div', 'sh-lv',
      '<span class="sh-lv-num">--</span><span class="sh-lv-name">불러오는 중</span>');
    var moves = el('div', 'sh-moves',
      '<span class="sh-mv-n" data-v="0">0</span><span class="sh-mv-p">/ par —</span>');
    var stars = el('div', 'sh-stars');
    stars.setAttribute('role', 'img');
    bar.appendChild(lv);
    bar.appendChild(el('span', 'sh-sep'));
    bar.appendChild(moves);
    bar.appendChild(stars);
    var sound = rb('sh-sound', '소리 끄기', ICON.soundOn);
    sound.setAttribute('aria-pressed', 'false');
    top.appendChild(home); top.appendChild(bar); top.appendChild(sound);
    root.appendChild(top);

    /* ── 하단 목표 스트립 ── */
    var strip = el('div', 'sh-strip sh-glass');
    strip.setAttribute('aria-label', '편성 목표');
    var head = el('div', 'sh-strip-head',
      '<span class="sh-strip-t">편성 목표</span>' +
      '<span class="sh-strip-p"><b class="a">0</b><i>/</i><b class="b">0</b></span>');
    var chips = el('div', 'sh-chips');
    var rail = el('div', 'sh-rail', '<span class="w">서</span><span class="e">동</span>');
    strip.appendChild(head); strip.appendChild(chips); strip.appendChild(rail);
    root.appendChild(strip);

    /* ── 버튼 클러스터 ── */
    var cluster = el('div', 'sh-cluster');
    var bUndo = rb('sh-undo', '되돌리기', ICON.undo);
    var bHint = rb('sh-hint', '힌트', ICON.hint);
    var bRest = rb('sh-restart', '레벨 재시작', ICON.restart);
    var bMenu = rb('sh-menu', '레벨 선택', ICON.menu);
    cluster.appendChild(bUndo); cluster.appendChild(bHint);
    cluster.appendChild(bRest); cluster.appendChild(bMenu);
    root.appendChild(cluster);

    /* ── 토스트 / 플래시 / 연결기 / 코치마크 ── */
    var toasts = el('div', 'sh-toasts');
    toasts.setAttribute('aria-live', 'polite');
    var flash = el('div', 'sh-flash', '<span></span>');
    var cpls = el('div', 'sh-couplers');
    var coach = el('div', 'sh-coach');
    coach.style.display = 'none';
    var cpt = el('div', 'sh-coach-pt',
      '<span class="sh-coach-ring"></span><span class="sh-coach-ring b"></span>' +
      '<span class="sh-coach-dot"></span><span class="sh-coach-hand">' + ICON.hand + '</span>');
    var cbub = el('div', 'sh-coach-bub',
      '<span class="k">도움말</span><p></p><button type="button">알겠어요</button>');
    var carw = el('div', 'sh-coach-arw');
    coach.appendChild(carw); coach.appendChild(cpt); coach.appendChild(cbub);
    root.appendChild(toasts); root.appendChild(flash);
    root.appendChild(cpls); root.appendChild(coach);

    /* ── 레벨 선택 시트 ── */
    var scrim = el('div', 'sh-scrim');
    scrim.style.display = 'none';
    var sheet = el('div', 'sh-sheet sh-glass');
    sheet.style.display = 'none';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '레벨 선택');
    var sHead = el('div', 'sh-sheet-head',
      '<h2>레벨 선택</h2><span class="sh-sheet-tot">' + star(true) + '<b>0</b></span>');
    var sClose = rb('sh-sheet-x', '닫기', ICON.close);
    sClose.classList.remove('sh-glass');
    sClose.style.width = '34px'; sClose.style.height = '34px';
    sClose.style.background = 'rgba(255,255,255,.06)';
    sClose.style.border = '1px solid rgba(255,255,255,.09)';
    sHead.appendChild(sClose);
    var sBody = el('div', 'sh-sheet-body');
    sheet.appendChild(el('div', 'sh-grab'));
    sheet.appendChild(sHead);
    sheet.appendChild(sBody);
    root.appendChild(scrim); root.appendChild(sheet);

    /* ── 승리 오버레이 ── */
    var win = el('div', 'sh-win');
    win.style.display = 'none';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', '레벨 완료');
    win.tabIndex = -1;
    var wCard = el('div', 'sh-win-card sh-glass',
      '<span class="sh-win-glow"></span>' +
      '<div class="sh-win-kicker">Level 01</div>' +
      '<h2 class="sh-win-title">편성 완료</h2>' +
      '<div class="sh-win-sub"></div>' +
      '<div class="sh-win-stars"></div>' +
      '<div class="sh-win-consist" aria-label="완성된 편성"></div>' +
      '<div class="sh-win-stat">' +
        '<div class="sh-win-cell mv"><b>0</b><span>이동</span></div>' +
        '<div class="sh-win-vs"></div>' +
        '<div class="sh-win-cell pr"><b>0</b><span>par</span></div>' +
        '<div class="sh-win-vs"></div>' +
        '<div class="sh-win-cell bs acc"><b>0</b><span>최고</span></div>' +
      '</div>' +
      '<div class="sh-win-recwrap"></div>' +
      '<div class="sh-win-btns"></div>');
    win.appendChild(el('span', 'sh-win-veil'));   /* 카드보다 먼저 = 카드 아래로 깔린다 */
    win.appendChild(wCard);
    root.appendChild(win);

    var wBtns = wCard.querySelector('.sh-win-btns');
    var bNext = el('button', 'sh-pb sh-next', '다음 레벨' + ICON.next);
    bNext.type = 'button';
    var wRow = el('div', 'sh-win-row');
    var bAgain = el('button', 'sh-sb sh-again', ICON.restart + '다시');
    bAgain.type = 'button';
    var bShare = el('button', 'sh-sb sh-share', ICON.share + '공유');
    bShare.type = 'button';
    wRow.appendChild(bAgain); wRow.appendChild(bShare);
    var bList = el('button', 'sh-tb sh-list', '레벨 선택');
    bList.type = 'button';
    wBtns.appendChild(bNext); wBtns.appendChild(wRow); wBtns.appendChild(bList);

    host.appendChild(root);

    els = {
      host: host, top: top, bar: bar, home: home, sound: sound,
      lvNum: lv.querySelector('.sh-lv-num'), lvName: lv.querySelector('.sh-lv-name'),
      moves: moves, mvN: moves.querySelector('.sh-mv-n'), mvP: moves.querySelector('.sh-mv-p'),
      stars: stars,
      strip: strip, chips: chips, progA: head.querySelector('.a'), progB: head.querySelector('.b'),
      cluster: cluster, bUndo: bUndo, bHint: bHint, bRest: bRest, bMenu: bMenu,
      toasts: toasts, flash: flash, flashT: flash.querySelector('span'),
      cpls: cpls, coach: coach, cpt: cpt, cbub: cbub, carw: carw,
      cbubP: cbub.querySelector('p'), cbubK: cbub.querySelector('.k'),
      cbubB: cbub.querySelector('button'),
      scrim: scrim, sheet: sheet, sBody: sBody, sTot: sHead.querySelector('.sh-sheet-tot b'),
      win: win, wCard: wCard,
      wKick: wCard.querySelector('.sh-win-kicker'), wTitle: wCard.querySelector('.sh-win-title'),
      wSub: wCard.querySelector('.sh-win-sub'), wStars: wCard.querySelector('.sh-win-stars'),
      wCons: wCard.querySelector('.sh-win-consist'),
      wMv: wCard.querySelector('.mv b'), wPr: wCard.querySelector('.pr b'),
      wBs: wCard.querySelector('.bs b'), wMvCell: wCard.querySelector('.mv'),
      wRec: wCard.querySelector('.sh-win-recwrap'),
      bNext: bNext, bAgain: bAgain, bShare: bShare, bList: bList
    };

    renderStars(els.stars, 3, 3, false);
    wire(sClose);
    built = true;
    setTimeout(function () { if (root) root.classList.remove('is-intro'); }, 60);
    return true;
  }

  /* ── 이벤트 배선 ─────────────────────────────────────────────── */
  function wire(sClose) {
    on(els.bUndo, 'click', function () { sfx('ui'); call('onUndo'); });
    on(els.bRest, 'click', function () { sfx('ui'); call('onRestart'); });
    on(els.bMenu, 'click', function () { sfx('ui'); api.levelSelect(true); });
    on(els.bHint, 'click', function () {
      sfx('ui');
      var r = call('onHint');
      /* 훅이 문자열을 주면 그대로, false 를 주면 침묵(Game 이 직접 처리),
         그 외에는 레벨의 hint 문구로 폴백한다. */
      if (typeof r === 'string' && r) api.toast(r, 'info');
      else if (r !== false && level && level.hint) api.toast(level.hint, 'info');
    });
    on(els.sound, 'click', function () { sfx('ui'); api.setMuted(!muted); call('onMute', muted); });

    on(sClose, 'click', function () { api.levelSelect(false); });
    on(els.scrim, 'click', function () { api.levelSelect(false); });

    on(els.bNext, 'click', function () { sfx('ui'); api.win(null); call('onNext'); });
    on(els.bAgain, 'click', function () { sfx('ui'); api.win(null); call('onRestart'); });
    on(els.bShare, 'click', function () { sfx('ui'); doShare(); });
    on(els.bList, 'click', function () { sfx('ui'); api.win(null); api.levelSelect(true); });

    on(els.cbubB, 'click', function () { sfx('ui'); api.tutorial(null); });

    onKey = function (e) {
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      if (els.sheet && els.sheet.classList.contains('is-on')) { api.levelSelect(false); e.preventDefault(); }
      else if (els.coach && els.coach.classList.contains('is-on')) { api.tutorial(null); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey, false);

    onResize = function () { measure(); };
    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);
    try {
      if (window.ResizeObserver) {
        ro = new ResizeObserver(function () { measure(); });
        ro.observe(els.strip);
      }
    } catch (e) { /* 미지원 브라우저 — resize 이벤트로 충분 */ }
  }

  /* ── 레이아웃 측정 (칩 크기 · 스트립 높이) ──────────────────── */
  function measure() {
    if (!built || !els.strip) return;
    try {
      var n = targetIds.length || 1;
      /* 스트립 자신이 아니라 '루트'에서 가용 폭을 잰다 — 순환 참조 방지 */
      var pad = parseFloat(getComputedStyle(els.host).getPropertyValue('--sh-pad')) || 12;
      var wide = window.innerWidth >= 720;
      var band = (root ? root.clientWidth : window.innerWidth) - pad - (wide ? 132 : pad);
      var cap = U.clamp(band, 180, 620);
      var gap = n > 9 ? 3 : (n > 6 ? 4 : (wide ? 8 : 6));
      var padH = wide ? 28 : 24;                  // 스트립 좌우 패딩
      /* 썸네일은 '실루엣으로 화차 종류를 읽는' UI 다 — 작아지면 그냥 색 점이 된다.
         상한을 올려 4~6량 레벨에서 확실히 크게, 하한을 올려 10량 이상에서도 형태가 남게. */
      var w = U.clamp(Math.floor((cap - padH - gap * (n - 1)) / n), 26, wide ? 70 : 58);
      var need = padH + n * w + gap * (n - 1);
      els.host.style.setProperty('--sh-chip-w', w + 'px');
      els.host.style.setProperty('--sh-chip-gap', gap + 'px');
      els.host.style.setProperty('--sh-strip-w', Math.min(cap, Math.max(240, need)) + 'px');
      /* 승리 중에는 스트립이 언마운트되어 높이가 0 이다 — 그때 갱신하면
         버튼 클러스터가 화면 아래로 내려앉았다가 되돌아올 때 튄다. 마지막 값을 유지한다. */
      var sh = els.strip.offsetHeight;
      if (sh) els.host.style.setProperty('--sh-strip-h', sh + 'px');
    } catch (e) { U.err(e); }
  }

  /* ── 별 렌더 ─────────────────────────────────────────────────── */
  function renderStars(box, n, total, animate) {
    if (!box) return;
    total = total || 3; n = U.clamp(n == null ? 0 : n, 0, total);
    if (box.children.length !== total) {
      box.innerHTML = '';
      for (var i = 0; i < total; i++) box.insertAdjacentHTML('beforeend', star(false));
    }
    for (var j = 0; j < total; j++) {
      var s = box.children[j], want = j < n, had = s.classList.contains('on');
      s.classList.toggle('on', want);
      if (animate && want && !had) {
        s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
      }
    }
    box.setAttribute('aria-label', '별 ' + total + '개 중 ' + n + '개');
  }
  function starsFor(moves, par) {
    if (!par) return 3;
    if (moves <= par) return 3;
    if (moves <= par + 2) return 2;
    return 1;
  }

  /* ── 목표 칩 ─────────────────────────────────────────────────── */
  function resolveWagon(x) {
    if (x && typeof x === 'object') {
      var o = { id: x.id, type: x.type || 'box', livery: x.livery };
      if (o.id != null && wagonMap[o.id]) {
        o.type = x.type || wagonMap[o.id].type;
        o.livery = x.livery || wagonMap[o.id].livery;
      }
      return o;
    }
    var w = wagonMap[x];
    return w ? w : { id: x, type: 'box', livery: ACCENT };
  }

  function renderTarget(list) {
    if (!built) return;
    list = list || [];
    targetIds = [];
    chipEls = [];
    els.chips.innerHTML = '';
    if (!list.length) {
      els.chips.appendChild(el('div', 'sh-strip-empty', '목표 편성이 없습니다'));
      els.progA.textContent = '0'; els.progB.textContent = '0';
      measure();
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var w = resolveWagon(list[i]);
      targetIds.push(w.id);
      var chip = el('div', 'sh-chip');
      chip.innerHTML = wagonSVG(w.type, w.livery) +
        '<span class="sh-chk">' + ICON.check + '</span>' +
        '<span class="sh-hk">' + ICON.link + '</span>' +
        '<span class="sh-idx">' + (i + 1) + '</span>';
      chip.__type = w.type;
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('aria-label', (i + 1) + '번째 ' + (TYPE_KO[w.type] || '화차'));
      chip.style.transition = 'none';
      els.chips.appendChild(chip);
      chipEls.push(chip);
    }
    els.chips.setAttribute('role', 'list');
    els.progB.textContent = String(list.length);
    els.progA.textContent = '0';
    els.progA.setAttribute('data-v', '0');
    measure();
    /* 등장 스태거 */
    var d = reduced() ? 0 : 1;
    chipEls.forEach(function (c, i) {
      if (!d) { c.style.transition = ''; return; }
      c.style.opacity = '0';
      c.style.transform = 'translateY(9px) scale(.9)';
      setTimeout(function () {
        c.style.transition = '';
        c.style.opacity = ''; c.style.transform = '';
      }, 30 + i * 34);
    });
    refreshProgress();
  }

  /** EXIT 는 동쪽부터 채워진다 — 동쪽 정렬로 맞은 칩 수를 센다 */
  function refreshProgress() {
    if (!built || !chipEls.length) return;
    var st = curState, tgt = targetIds;
    var exit = (st && st.tracks && st.tracks.EXIT) ? st.tracks.EXIT : [];
    var hand = {};
    if (st && st.consist) for (var h = 0; h < st.consist.length; h++) hand[st.consist[h]] = 1;

    var k = 0;                            // 동쪽부터 연속으로 맞은 개수
    while (k < exit.length && k < tgt.length &&
           exit[exit.length - 1 - k] === tgt[tgt.length - 1 - k]) k++;
    var bad = exit.length > k;            // EXIT 에 잘못 놓인 화차가 있다
    var doneFrom = tgt.length - k;
    /* 출발선은 동쪽부터 채워지므로 '다음에 놓아야 할 한 량' 은 항상 doneFrom-1 하나뿐이다.
       앰버 실선 링은 오직 이 칩에만 — 여러 칩이 동시에 강조되어 의미가 흐려지지 않게. */
    var nextIdx = (k < tgt.length) ? (doneFrom - 1) : -1;

    for (var i = 0; i < chipEls.length; i++) {
      var c = chipEls[i], isDone = i >= doneFrom, inHand = !isDone && !!hand[tgt[i]];
      c.classList.toggle('is-done', isDone);
      c.classList.toggle('is-hand', inHand);
      c.classList.toggle('is-next', i === nextIdx);
      if (i === nextIdx) c.setAttribute('aria-current', 'step');
      else c.removeAttribute('aria-current');
      c.setAttribute('aria-label', (i + 1) + '번째 ' + (TYPE_KO[c.__type] || '화차') +
        (isDone ? ' — 완료' : (i === nextIdx ? ' — 다음 차례' : (inHand ? ' — 연결 중' : ''))));
    }
    els.strip.classList.toggle('bad', bad);
    els.strip.classList.toggle('done', k > 0 && k === tgt.length);
    countTo(els.progA, k, 300);
    els.strip.setAttribute('aria-label', '편성 목표 ' + tgt.length + '량 중 ' + k + '량 완료');
  }

  /* ── 토스트 ──────────────────────────────────────────────────── */
  var REASONS = [
    [/^same$|^here$|^already/i, '이미 그 선로에 있습니다.'],
    [/head/i, null],                                    // 동적: 인상선 용량
    [/cap|full|overflow|space/i, '그 선로에 자리가 부족합니다.'],
    [/busy|moving|anim/i, '열차가 움직이는 중입니다.'],
    [/lock|blocked/i, '지금은 그 선로로 갈 수 없습니다.']
  ];
  function headCap() {
    try {
      if (level && level.tracks) {
        for (var i = 0; i < level.tracks.length; i++) {
          var t = level.tracks[i];
          if (t && (t.id === 'HEAD' || t.kind === 'head')) return t.capacity | 0;
        }
      }
    } catch (e) { U.err(e); }
    return 0;
  }
  function translate(msg) {
    if (msg == null) return '';
    var s = String(msg);
    /* 공백이나 한글이 있으면 이미 완성된 문구다 */
    if (/[\s가-힣]/.test(s)) return s;
    for (var i = 0; i < REASONS.length; i++) {
      if (REASONS[i][0].test(s)) {
        if (REASONS[i][1]) return REASONS[i][1];
        var c = headCap();
        return c ? ('인상선에는 기관차 포함 ' + c + '량까지만 들어갑니다.')
                 : '인상선 용량을 넘습니다.';
      }
    }
    return s;
  }

  var toastQ = [];
  function toast(msg, kind) {
    if (!built) return;
    var text = translate(msg);
    if (!text) return;
    /* 같은 문구가 이미 떠 있으면 타이머만 연장 */
    for (var i = 0; i < toastQ.length; i++) {
      if (toastQ[i].__msg === text) {
        clearTimeout(toastQ[i].__t);
        toastQ[i].__t = setTimeout(function (n) { return function () { dropToast(n); }; }(toastQ[i]), 2400);
        return;
      }
    }
    var t = el('div', 'sh-toast ' + (kind || 'info'), esc(text));
    t.__msg = text;
    els.toasts.appendChild(t);
    toastQ.push(t);
    while (toastQ.length > 3) dropToast(toastQ[0]);
    requestAnimationFrame(function () { t.classList.add('in'); });
    t.__t = setTimeout(function () { dropToast(t); }, 2400);
  }
  function dropToast(t) {
    if (!t || t.__gone) return;
    t.__gone = true;
    clearTimeout(t.__t);
    var i = toastQ.indexOf(t); if (i >= 0) toastQ.splice(i, 1);
    t.classList.remove('in');
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, reduced() ? 0 : 320);
  }

  function flash(msg) {
    if (!built || !msg) return;
    els.flashT.textContent = String(msg);
    els.flash.classList.remove('go');
    void els.flash.offsetWidth;
    els.flash.classList.add('go');
    clearTimeout(els.flash.__t);
    els.flash.__t = setTimeout(function () { els.flash.classList.remove('go'); }, 1300);
  }

  /* ── 공유 (이모지 그리드) ────────────────────────────────────── */
  function sq(hexc) {
    var c = U.rgb(safeHex(hexc));
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var l = (mx + mn) / 2, s = d === 0 ? 0 : (l > .5 ? d / (2 - mx - mn) : d / (mx + mn));
    var h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    if (l > .72 && s < .55) return '⬜';
    if (s < .17) return l < .55 ? '⬛' : '⬜';
    if (l < .17) return '⬛';
    if (h >= 12 && h < 48 && l < .34) return '🟫';
    if (h < 17 || h >= 330) return '🟥';
    if (h < 34) return '🟧';
    if (h < 68) return '🟨';
    if (h < 168) return '🟩';
    if (h < 262) return '🟦';
    return '🟪';
  }
  function pageURL() {
    try {
      if (/^https?:/.test(location.protocol)) return location.href.split('#')[0].split('?')[0];
    } catch (e) { /* file:// */ }
    return FALLBACK_URL;
  }
  function shareText(res) {
    var n = (res.index == null ? levelIdx : res.index) + 1;
    var nm = res.name || (level && level.name) || '';
    var st = U.clamp(res.stars | 0, 0, 3);
    var grid = targetIds.map(function (id) { return sq(resolveWagon(id).livery); }).join('');
    var line1 = '🚂 조차장 #' + n + (nm ? ' · ' + nm : '');
    var line2 = '★'.repeat(st) + '☆'.repeat(3 - st) + '  ' + (res.moves | 0) + '수 (par ' + (res.par | 0) + ')';
    return line1 + '\n' + line2 + (grid ? '\n' + grid : '');
  }
  function doShare() {
    var res = lastWin || { stars: 0, moves: curMoves, par: curPar, index: levelIdx };
    var payload = { text: shareText(res), url: pageURL() };
    var handled = call('onShare', payload);
    if (handled === true) return;
    try {
      if (window.GameShare && GameShare.share) GameShare.share(payload);
      else if (navigator.clipboard) navigator.clipboard.writeText(payload.text + '\n' + payload.url);
    } catch (e) { U.err(e); }
  }

  /* ── 레벨 목록 / 진행도 ──────────────────────────────────────── */
  function levels() {
    if (levelList) return levelList;
    try { if (SH.Levels && SH.Levels.pack) return SH.Levels.pack; } catch (e) { /* 아직 미로드 */ }
    return [];
  }
  function prog(id) {
    if (id == null) return null;
    try {
      if (SH.Levels && SH.Levels.progress && SH.Levels.progress.get) return SH.Levels.progress.get(id) || null;
    } catch (e) { /* 아직 미로드 */ }
    return null;
  }
  function indexOfLevel(def) {
    if (!def) return levelIdx;
    var pack = levels();
    for (var i = 0; i < pack.length; i++) if (pack[i] === def || (def.id != null && pack[i].id === def.id)) return i;
    return levelIdx;
  }
  function totalStars() {
    var pack = levels(), t = 0;
    for (var i = 0; i < pack.length; i++) { var p = prog(pack[i].id); if (p && p.stars) t += p.stars | 0; }
    return t;
  }

  function renderSheet() {
    if (!built) return;
    var pack = levels();
    els.sBody.innerHTML = '';
    if (!pack.length) {
      els.sBody.appendChild(el('div', 'sh-strip-empty', '레벨을 불러오는 중입니다'));
      return;
    }
    var prevCleared = true, tot = 0;
    for (var i = 0; i < pack.length; i++) {
      var d = pack[i] || {}, p = prog(d.id) || {}, st = p.stars | 0;
      tot += st;
      var unlocked = (i === 0) || prevCleared || i <= levelIdx;
      var card = el('button', 'sh-card' + (unlocked ? '' : ' is-locked') + (i === levelIdx ? ' is-cur' : ''));
      card.type = 'button';
      card.innerHTML =
        '<span class="sh-card-num">LV ' + pad2(i + 1) + '</span>' +
        '<span class="sh-card-name">' + (unlocked ? esc(d.name || ('레벨 ' + (i + 1))) : '&nbsp;') + '</span>' +
        '<span class="sh-card-foot"><span class="sh-stars"></span>' +
        '<span class="sh-card-best">' + (p.best ? ('최고 ' + (p.best | 0) + '수') : ('par ' + (d.par | 0))) + '</span></span>';
      renderStars(card.querySelector('.sh-stars'), st, 3, false);
      if (!unlocked) {
        card.insertAdjacentHTML('beforeend', '<span class="sh-card-lock">' + ICON.lock + '</span>');
        card.disabled = true;
        card.setAttribute('aria-disabled', 'true');
        card.setAttribute('aria-label', (i + 1) + '번 레벨 — 잠김');
      } else {
        card.setAttribute('aria-label',
          (i + 1) + '번 ' + (d.name || '') + ' — 별 ' + st + '개' + (p.best ? (', 최고 ' + p.best + '수') : ''));
        on(card, 'click', (function (idx) {
          return function () { sfx('ui'); api.levelSelect(false); call('onLevel', idx); };
        })(i));
      }
      els.sBody.appendChild(card);
      prevCleared = st > 0;
    }
    els.sTot.textContent = tot + ' / ' + (pack.length * 3);
  }

  /* ── 승리 오버레이 ───────────────────────────────────────────── */
  var winTimers = [];
  function clearWinTimers() { for (var i = 0; i < winTimers.length; i++) clearTimeout(winTimers[i]); winTimers = []; }

  /** 승리 중 플레이 HUD(목표 스트립·버튼 클러스터·연결기 마커) 언마운트.
      opacity 만 0 으로 두면 승리 veil 의 backdrop-filter 가 그 반투명 판을
      다시 끌어올려 화면 아래쪽에 흐릿한 잔상 띠를 만든다. 트랜지션이 끝나면
      display:none 으로 DOM 렌더 트리에서 아예 뺀다. */
  var hudT = 0;
  function hudForWin(on) {
    if (!built || !root) return;
    clearTimeout(hudT);
    var list = [els.strip, els.cluster, els.cpls], i;
    root.classList.toggle('is-won', !!on);
    if (on) {
      hudT = setTimeout(function () {
        if (!root || !root.classList.contains('is-won')) return;
        for (var k = 0; k < list.length; k++) {
          if (!list[k]) continue;
          list[k].style.display = 'none';
          list[k].setAttribute('aria-hidden', 'true');
        }
      }, reduced() ? 0 : 340);
    } else {
      for (i = 0; i < list.length; i++) {
        if (!list[i]) continue;
        list[i].style.display = '';
        list[i].removeAttribute('aria-hidden');
      }
      measure();
    }
  }

  /** 출발선(EXIT)에 남은 완성 편성의 id 목록. 없으면 목표 순서로 폴백. */
  function exitIds() {
    var st = curState || (SH.Game && SH.Game.state) || null;
    if (st && st.tracks && st.tracks.EXIT && st.tracks.EXIT.length) return st.tracks.EXIT;
    return targetIds && targetIds.length ? targetIds : null;
  }
  function heroReady() {
    try {
      var W = SH.World && SH.World.current;
      return !!(window.THREE && SH.Render && typeof SH.Render.frameBounds === 'function' &&
                W && W.vehicles && exitIds());
    } catch (e) { return false; }
  }
  /** 승리 순간 카메라를 완성된 편성 쪽으로 3/4 히어로 앵글로 밀어 준다.
      Render.frameBounds 는 감쇠 보간이라 약 1초에 걸쳐 부드럽게 도착한다.
      Game.presentWin() 이 UI.win() 직후 frameYard() 를 부르므로 반드시 그 뒤 틱에 실행할 것. */
  function heroCam() {
    try {
      var W = SH.World.current, ids = exitIds();
      if (!ids) return;
      var box = new THREE.Box3(), got = 0, i, v, g;
      for (i = 0; i < ids.length; i++) {
        v = (typeof W.vehicles.get === 'function') ? W.vehicles.get(ids[i]) : W.vehicles[ids[i]];
        g = v && v.group;
        if (!g) continue;
        box.expandByObject(g);
        got++;
      }
      if (!got || box.isEmpty()) return;
      box.expandByScalar(3.5);
      SH.Render.frameBounds(box, { margin: 1.38, azimuth: -22, elevation: 30, yBias: -9 });
    } catch (e) { U.err(e); }
  }

  /** 카드 안에 완성된 편성을 목표 스트립과 같은 실루엣으로 다시 그린다 */
  function renderWinConsist() {
    var box = els.wCons;
    if (!box) return;
    box.innerHTML = '';
    var ids = exitIds();
    if (!ids || !ids.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    for (var i = 0; i < ids.length; i++) {
      var w = resolveWagon(ids[i]);
      var c = el('span', 'sh-wc', wagonSVG(w.type, w.livery));
      c.setAttribute('title', (i + 1) + '. ' + (TYPE_KO[w.type] || '화차'));
      box.appendChild(c);
    }
  }

  function doWin(res) {
    if (!built) return;
    if (!res) {
      clearWinTimers();
      show(els.win, false, 400);
      hudForWin(false);
      els.wCard.classList.remove('g1', 'g2', 'g3');
      return;
    }
    /* 카드보다 먼저 HUD 를 내린다 — 히어로 카메라가 도는 동안 완성된 편성이
       스트립에 가리지 않고, veil 이 켜질 때 아래에 비칠 판이 남아 있지 않다. */
    hudForWin(true);
    var moves = res.moves != null ? (res.moves | 0) : curMoves;
    var par = res.par != null ? (res.par | 0) : curPar;
    var stars = res.stars != null ? U.clamp(res.stars | 0, 0, 3) : starsFor(moves, par);
    var idx = res.index != null ? (res.index | 0) : levelIdx;
    var name = res.name || (level && level.name) || '';
    var p = prog(level && level.id) || {};
    var best = res.best != null ? (res.best | 0) : (p.best != null ? (p.best | 0) : moves);
    if (!best || moves < best) best = moves;
    var newRec = res.newRecord != null ? !!res.newRecord
      : (res.prevBest != null ? (moves < (res.prevBest | 0)) : (p.best == null || moves < (p.best | 0)));
    var hasNext = res.hasNext != null ? !!res.hasNext : (idx + 1 < levels().length);
    lastWin = { moves: moves, par: par, stars: stars, index: idx, name: name,
                best: best, newRecord: newRec, hasNext: hasNext, totalStars: res.totalStars };

    els.wKick.textContent = 'Level ' + pad2(idx + 1) + (name ? ' · ' + name : '');
    els.wTitle.textContent = stars >= 3 ? '완벽한 편성' : '편성 완료';
    els.wSub.textContent = stars >= 3 ? '최소 이동으로 끝냈습니다'
      : (stars === 2 ? 'par 를 조금 넘겼어요' : '조금 더 짧게 갈 수 있습니다');
    els.wMv.setAttribute('data-v', moves); els.wMv.textContent = String(moves);
    els.wPr.textContent = String(par);
    els.wBs.textContent = String(best);
    els.wMvCell.classList.toggle('over', par > 0 && moves > par);
    els.wRec.innerHTML = newRec ? '<span class="sh-win-rec">신기록</span>' : '';
    els.bNext.style.display = hasNext ? '' : 'none';
    /* 버튼 위계: 다음 레벨이 있으면 그것이 주 동작, 마지막 판이면 '다시'가 주 동작이 된다.
       두 버튼이 같은 외곽선 스타일로 남는 상태를 만들지 않는다. */
    els.bAgain.className = (hasNext ? 'sh-sb' : 'sh-pb') + ' sh-again';
    renderWinConsist();

    /* 별 슬롯 */
    els.wStars.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var slot = el('div', 'sh-wst', bigStar() + '<i></i>');
      els.wStars.appendChild(slot);
    }
    els.wCard.classList.remove('g1', 'g2', 'g3');
    clearWinTimers();

    var slots = els.wStars.children, quick = reduced();
    /* 카드보다 카메라가 먼저 — 완성된 편성으로 밀어 놓고 그 다음에 결과를 올린다. */
    var hero = !quick && heroReady();
    if (hero) winTimers.push(setTimeout(heroCam, 20));

    function reveal() {
      show(els.win, true, 400);
      for (var k = 0; k < stars; k++) {
        (function (n) {
          winTimers.push(setTimeout(function () {
            var s = slots[n];
            if (!s) return;
            s.classList.add('on');
            if (!quick) s.classList.add('pop');
            els.wCard.classList.add('g' + (n + 1));
            sfx(n === stars - 1 ? 'win' : 'ui');
          }, quick ? 0 : 300 + n * 215));
        })(k);
      }
      if (!stars) sfx('win');
      winTimers.push(setTimeout(function () {
        try { els.win.focus({ preventScroll: true }); } catch (e) { /* 구형 브라우저 */ }
      }, quick ? 30 : 360));
    }
    if (hero) winTimers.push(setTimeout(reveal, 360));
    else reveal();

    /* 누적 기록 (게임 랩 공통 통계) — Game 에서 중복 호출하지 말 것 */
    try {
      if (window.GameStats && GameStats.record) {
        var tot = res.totalStars != null ? (res.totalStars | 0) : totalStars();
        GameStats.record('shunting', { score: tot, maxScore: Math.max(3, levels().length * 3) });
      }
    } catch (e) { U.err(e); }
  }

  /* ── 튜토리얼 코치마크 ───────────────────────────────────────── */
  var TUT = [
    { id: 't-track', k: '1 / 5', text: '측선을 탭하면 기관차가 그 선로로 들어가, 거기 서 있던 화차를 전부 연결합니다.', anchor: 'yard' },
    { id: 't-cut', k: '2 / 5', text: '빛나는 연결기를 탭하면 그 자리에서 화차를 떼어 놓습니다. 분리는 이동 수를 쓰지 않아요.', anchor: 'yard' },
    { id: 't-goal', k: '3 / 5', text: '아래 목표 순서대로 출발선에 화차를 남기면 성공. 출발선은 동쪽 끝부터 채워집니다.', anchor: 'strip' },
    { id: 't-head', k: '4 / 5', text: '인상선은 기관차를 포함해 정해진 량수까지만 들어갑니다. 한 번에 끌 수 있는 양이 곧 난이도예요.', anchor: 'yard-left' },
    { id: 't-undo', k: '5 / 5', text: '꼬였다면 되돌리기로 한 수 전으로. 힌트는 최적 경로의 다음 수를 알려줍니다.', anchor: 'cluster' }
  ];
  function seen() {
    if (!tutSeen) tutSeen = U.store(TUT_KEY) || {};
    return tutSeen;
  }
  function markSeen(id) {
    if (!id) return;
    var s = seen(); s[id] = 1;
    U.store(TUT_KEY, s);
  }
  function anchorPos(a) {
    var W = window.innerWidth, H = window.innerHeight, r;
    if (a && typeof a === 'object' && a.x != null) return { x: a.x, y: a.y };
    switch (a) {
      case 'strip':
        r = els.strip.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + 8 };
      case 'cluster':
        r = els.cluster.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      case 'top':
        r = els.bar.getBoundingClientRect();
        return { x: r.left + r.width * .55, y: r.bottom };
      case 'yard-left': return { x: W * .27, y: H * .5 };
      default: return { x: W * .5, y: H * .55 };
    }
  }
  function placeCoach(pt) {
    var W = window.innerWidth, H = window.innerHeight;
    els.cpt.style.left = Math.round(pt.x) + 'px';
    els.cpt.style.top = Math.round(pt.y) + 'px';
    var b = els.cbub;
    b.style.left = '-9999px'; b.style.top = '0px';
    var br = b.getBoundingClientRect(), bw = br.width, bh = br.height;
    var above = pt.y > H * .48;
    var bx = U.clamp(pt.x - bw / 2, 12, Math.max(12, W - bw - 12));
    var by = above ? (pt.y - 56 - bh) : (pt.y + 56);
    by = U.clamp(by, 12, Math.max(12, H - bh - 12));
    b.style.left = Math.round(bx) + 'px';
    b.style.top = Math.round(by) + 'px';
    var ax = U.clamp(pt.x - 6, bx + 16, bx + bw - 28);
    els.carw.style.left = Math.round(ax) + 'px';
    els.carw.style.top = Math.round(above ? by + bh - 6 : by - 6) + 'px';
    els.carw.style.transform = 'rotate(' + (above ? 225 : 45) + 'deg)';
  }
  function doTutorial(step) {
    if (!built) return false;
    if (step == null || step === false) {
      if (tutStep && tutStep.id) markSeen(tutStep.id);
      tutStep = null;
      show(els.coach, false, 360);
      return false;
    }
    var def = (typeof step === 'number') ? TUT[step] : step;
    if (!def) return false;
    if (def.id && seen()[def.id] && !def.force) return false;
    tutStep = def;
    els.cbubK.textContent = def.k || '도움말';
    els.cbubP.textContent = def.text || '';
    show(els.coach, true, 360);
    var pt = anchorPos(def.at || def.anchor);
    placeCoach(pt);
    requestAnimationFrame(function () { if (tutStep === def) placeCoach(anchorPos(def.at || def.anchor)); });
    return true;
  }

  /* ── 연결기 마커 ─────────────────────────────────────────────── */
  function mkCoupler(i) {
    var b = el('button', 'sh-cpl', ICON.coupler);
    b.type = 'button';
    b.setAttribute('aria-label', '여기서 화차 분리');
    b.title = '여기서 분리';
    on(b, 'pointerdown', function (e) { e.stopPropagation(); });
    on(b, 'click', function (e) { e.stopPropagation(); sfx('ui'); call('onCoupler', i); });
    els.cpls.appendChild(b);
    return b;
  }
  function hideCoupler(i) {
    var m = couplers[i];
    if (!m) return;
    m.classList.remove('in');
    clearTimeout(m.__rm);
    m.__rm = setTimeout(function () {
      if (m.parentNode) m.parentNode.removeChild(m);
      delete couplers[i];
    }, reduced() ? 0 : 300);
  }

  /* ── 공개 API ────────────────────────────────────────────────── */
  var api = {
    el: null,

    init: function (h) {
      try {
        if (built) api.destroy();
        hooks = h || {};
        if (!build()) return api;
        api.el = root;
        muted = !!U.store(MUTE_KEY);
        applyMute();
        if (muted) requestAnimationFrame(function () { call('onMute', true); });
        measure();
      } catch (e) { U.err(e); }
      return api;
    },

    setLevel: function (def, index) {
      if (!built) return;
      try {
        level = def || null;
        wagonMap = {};
        if (def && def.wagons) {
          for (var i = 0; i < def.wagons.length; i++) {
            var w = def.wagons[i];
            if (w && w.id != null) wagonMap[w.id] = { id: w.id, type: w.type || 'box', livery: w.livery };
          }
        }
        levelIdx = (index != null) ? (index | 0) : indexOfLevel(def);
        starOverride = -1;
        curState = null;
        lastWin = null;
        els.lvNum.textContent = 'LV ' + pad2(levelIdx + 1);
        els.lvName.textContent = (def && def.name) ? def.name : '';
        curPar = (def && def.par) ? (def.par | 0) : 0;
        api.setMoves(0, curPar);
        renderTarget(def && def.target);
        doWin(null);
      } catch (e) { U.err(e); }
    },

    setState: function (state) {
      if (!built) return;
      curState = state || null;
      if (state && typeof state.moves === 'number') api.setMoves(state.moves, curPar);
      refreshProgress();
    },

    setMoves: function (n, par) {
      if (!built) return;
      curMoves = n | 0;
      if (par != null) curPar = par | 0;
      countTo(els.mvN, curMoves, 360);
      els.mvP.textContent = curPar ? ('/ par ' + curPar) : '/ par —';
      els.moves.classList.toggle('over', curPar > 0 && curMoves > curPar);
      if (starOverride < 0) renderStars(els.stars, starsFor(curMoves, curPar), 3, false);
    },

    setStars: function (n) {
      if (!built) return;
      starOverride = U.clamp(n | 0, 0, 3);
      renderStars(els.stars, starOverride, 3, true);
    },

    setBusy: function (b) {
      if (!built) return;
      busy = !!b;
      root.classList.toggle('is-busy', busy);
      var list = [els.bUndo, els.bHint, els.bRest];
      for (var i = 0; i < list.length; i++) {
        list[i].setAttribute('aria-disabled', busy ? 'true' : 'false');
        list[i].disabled = busy;          // 키보드 Enter 도 막는다
      }
      root.setAttribute('aria-busy', busy ? 'true' : 'false');
    },

    target: function (list) { try { renderTarget(list); } catch (e) { U.err(e); } },

    toast: function (msg, kind) { try { toast(msg, kind); } catch (e) { U.err(e); } },
    flash: function (msg) { try { flash(msg); } catch (e) { U.err(e); } },

    win: function (res) { try { doWin(res || null); } catch (e) { U.err(e); } },

    levelSelect: function (open) {
      if (!built) return;
      try {
        if (open) { renderSheet(); show(els.scrim, true, 360); show(els.sheet, true, 460); }
        else { show(els.scrim, false, 360); show(els.sheet, false, 460); }
      } catch (e) { U.err(e); }
    },

    tutorial: function (step) { try { return doTutorial(step); } catch (e) { U.err(e); return false; } },

    showCoupler: function (pos, index) {
      if (!built) return;
      try {
        if (pos == null && index == null) { for (var k in couplers) hideCoupler(k); return; }
        var i = (index == null) ? 0 : index;
        if (!pos || pos.visible === false) { hideCoupler(i); return; }
        var m = couplers[i] || (couplers[i] = mkCoupler(i));
        clearTimeout(m.__rm);
        m.style.left = Math.round(pos.x) + 'px';
        m.style.top = Math.round(pos.y) + 'px';
        if (!m.classList.contains('in')) {
          requestAnimationFrame(function () { m.classList.add('in'); });
        }
      } catch (e) { U.err(e); }
    },

    setMuted: function (b) {
      muted = !!b;
      U.store(MUTE_KEY, muted);
      applyMute();
      return muted;
    },

    setLevels: function (arr) {
      levelList = (arr && arr.length) ? arr : null;
      if (built && els.sheet && els.sheet.classList.contains('is-on')) renderSheet();
    },

    hide: function (b) { if (root) root.classList.toggle('is-hidden', !!b); },

    destroy: function () {
      try {
        clearWinTimers();
        clearTimeout(hudT);
        for (var i = toastQ.length - 1; i >= 0; i--) dropToast(toastQ[i]);
        if (onKey) document.removeEventListener('keydown', onKey, false);
        if (onResize) {
          window.removeEventListener('resize', onResize, false);
          window.removeEventListener('orientationchange', onResize, false);
        }
        if (ro) { ro.disconnect(); ro = null; }
        if (root && root.parentNode) root.parentNode.removeChild(root);
      } catch (e) { U.err(e); }
      root = null; built = false; els = {}; couplers = {}; chipEls = []; api.el = null;
    }
  };

  function applyMute() {
    if (!built) return;
    els.sound.innerHTML = muted ? ICON.soundOff : ICON.soundOn;
    els.sound.setAttribute('aria-pressed', muted ? 'true' : 'false');
    els.sound.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
    els.sound.title = muted ? '소리 켜기' : '소리 끄기';
    els.sound.classList.toggle('sh-accent', !muted);
  }

  return api;
})();
