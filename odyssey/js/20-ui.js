/* ============================================================================
   오디세이아 / ODYSSEY — 20-ui.js  →  OD.UI
   1편(타이밍 액션)용 최소 오버레이. #ui-root 안에 DOM 을 만들고 <style> 을 주입한다.
   모든 클래스는 od- 접두사. 액센트는 청동색 #c08a3e.

   ★ 이 모듈의 일은 "덜어내는 것"이다.
     - HUD 는 셋뿐: 남은 부하(크게) / 남은 양 수 / 다음 양의 크기 미리보기.
     - 규칙 설명 텍스트 없음. 화면이 가르친다. "지금!"은 첫 양에 한 번만.
     - 재시도 카운터·예산·격자·결과 미리보기 전부 없다.

   ★ 포인터 규칙 (이전 버전의 치명적 버그)
     #ui-root 와 HUD 는 pointer-events:none 이다. 탭은 언제나 캔버스에 닿는다.
     클릭을 먹는 것은 카드가 열려 있을 때의 .od-scrim 과 버튼뿐이고,
     카드가 닫히면 DOM 에서 사라진다.
   ----------------------------------------------------------------------------
   CONTRACT  (st1-cyclops 가 부르는 것들)

     OD.UI.init(hooks)          hooks = {onRetry, onNext}  — 카드 인자로 덮어쓸 수 있다
     OD.UI.hud(o)               부분 갱신(merge)
                                o = { crew, crewTotal, sheep, next }
                                next: 0|1|2 또는 's'|'m'|'l' 또는 null(양이 끝남)
     OD.UI.showHud(bool)
     OD.UI.story(lines, onOk)   상황 카드. lines = 문자열 | 문자열 배열(두 문장)
     OD.UI.result(o)            결과 카드
                                o = {win, text:[두 문장], fact:'사실 한 줄',
                                     onRetry, onNext, ok:'계속', alt:'다시'}
     OD.UI.card(o)              위 둘의 원형 (ok/alt/onOk/onAlt/tone/fact/text)
     OD.UI.closeCard() / OD.UI.isCardOpen()
     OD.UI.cue(text, kind, ms)  순간 표시. kind: now(청동 대) | ok | bad | close
                                text 를 비우면 즉시 감춘다.
     OD.UI.flash(kind)          화면 가장자리 번쩍 (bad|ok)
     OD.UI.destroy()
   ========================================================================== */
var OD = window.OD || (window.OD = {});

OD.UI = (function () {
  'use strict';

  var ACC = '#c08a3e';
  var root = null, elHud = null, elCue = null, elScrim = null, elCard = null, elFlash = null;
  var hooks = {}, cueTimer = 0, openedAt = 0, cur = null, keyHandler = null;

  var state = { crew: 6, crewTotal: 6, sheep: 0, next: null };

  /* 스테이지가 어느 이름으로 부르든 받아준다 (모듈이 따로 쓰여진다) */
  var ALIAS = { crewLeft: 'crew', left: 'crew', total: 'crewTotal', crewMax: 'crewTotal',
                sheepLeft: 'sheep', remaining: 'sheep', flock: 'sheep',
                nextSize: 'next', size: 'next' };

  var TOUCH = (function () {
    try { return !!(window.matchMedia && window.matchMedia('(hover:none)').matches); }
    catch (e) { return false; }
  })();

  /* ── 양 실루엣 (외부 에셋 0 — 인라인 SVG) ────────────────────────────── */
  function sheepSVG(extra) {
    return '<svg class="od-sheep ' + (extra || '') + '" viewBox="0 0 46 34" aria-hidden="true">' +
      '<g fill="currentColor">' +
      '<rect x="13" y="23" width="3.4" height="9" rx="1.4"/>' +
      '<rect x="25" y="23" width="3.4" height="9" rx="1.4"/>' +
      '<ellipse cx="20" cy="17" rx="13" ry="9"/>' +
      '<circle cx="11" cy="11.5" r="5.4"/>' +
      '<circle cx="20" cy="9" r="5.8"/>' +
      '<circle cx="28.5" cy="11.5" r="5.4"/>' +
      '</g>' +
      '<g fill="currentColor" opacity=".55">' +
      '<ellipse cx="36" cy="15.5" rx="5" ry="5.6"/>' +
      '<ellipse cx="40.5" cy="11" rx="3.2" ry="2" transform="rotate(-24 40.5 11)"/>' +
      '</g></svg>';
  }

  function sizeIndex(v) {
    if (v == null) return -1;
    if (typeof v === 'number') return Math.max(0, Math.min(2, v | 0));
    var s = String(v).toLowerCase().charAt(0);
    return s === 's' ? 0 : (s === 'm' ? 1 : 2);
  }

  /* ── 스타일 ─────────────────────────────────────────────────────────── */
  var CSS = [
    '.od-root{position:absolute;inset:0;pointer-events:none;',
    '  font-family:-apple-system,"Segoe UI","Malgun Gothic",sans-serif;color:#e9ecf2;}',
    '.od-root *{box-sizing:border-box;}',

    /* HUD ------------------------------------------------------------ */
    '.od-hud{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;',
    '  justify-content:space-between;padding:14px 18px 0;pointer-events:none;',
    '  opacity:0;transition:opacity .45s ease;}',
    '.od-hud.on{opacity:1;}',
    '.od-crew{display:flex;flex-direction:column;gap:5px;}',
    '.od-crew-row{display:flex;align-items:baseline;gap:6px;}',
    '.od-crew-n{font-size:2.5rem;font-weight:800;line-height:.9;color:' + ACC + ';',
    '  letter-spacing:-.03em;text-shadow:0 2px 14px rgba(0,0,0,.7);transition:transform .18s ease;}',
    '.od-crew-n.bump{transform:scale(1.28);}',
    '.od-cap{font-size:.62rem;font-weight:700;letter-spacing:.22em;color:#8d95a3;}',
    '.od-pips{display:flex;gap:5px;}',
    '.od-pip{width:7px;height:11px;border-radius:3px 3px 2px 2px;background:' + ACC + ';',
    '  box-shadow:0 1px 6px rgba(0,0,0,.6);transition:background .3s ease,opacity .3s ease;}',
    '.od-pip.off{background:#39404d;opacity:.55;}',

    '.od-flock{display:flex;flex-direction:column;align-items:flex-end;gap:7px;}',
    '.od-flock-row{display:flex;align-items:center;gap:7px;}',
    '.od-flock-n{font-size:1.15rem;font-weight:700;color:#dfe4ec;line-height:1;',
    '  text-shadow:0 2px 10px rgba(0,0,0,.7);}',
    '.od-sheep{display:block;height:100%;width:auto;}',
    '.od-flock-row .od-sheep{height:17px;color:#aeb6c4;}',
    '.od-next{display:flex;align-items:flex-end;gap:8px;transition:opacity .35s ease;}',
    '.od-next .od-cap{padding-bottom:3px;}',
    '.od-next-box{position:relative;width:56px;height:40px;}',
    '.od-next-box .od-ghost,.od-next-box .od-solid{position:absolute;left:0;right:0;bottom:0;',
    '  height:100%;transform-origin:50% 100%;transition:transform .3s ease,opacity .3s ease;}',
    '.od-next-box .od-ghost{color:#ffffff;opacity:.2;}',   /* 크기 비교용 잔상 */
    '.od-next-box.l .od-ghost{opacity:0;}',                /* 제일 큰 양이면 비교가 필요없다 */
    '.od-next-box .od-solid{color:#e9ecf2;}',
    '.od-next-box.s .od-solid{transform:scale(.56);}',
    '.od-next-box.m .od-solid{transform:scale(.78);}',
    '.od-next-box.l .od-solid{transform:scale(1);}',
    '.od-next-box.none .od-solid{opacity:0;transform:scale(.4);}',

    /* 순간 표시 ------------------------------------------------------- */
    '.od-cue{position:absolute;left:0;right:0;top:58%;text-align:center;pointer-events:none;',
    '  font-weight:800;letter-spacing:-.01em;opacity:0;transform:translateY(8px) scale(.94);',
    '  transition:opacity .16s ease,transform .16s ease;text-shadow:0 3px 22px rgba(0,0,0,.85);}',
    '.od-cue.on{opacity:1;transform:translateY(0) scale(1);}',
    '.od-cue.now{font-size:clamp(2.2rem,8vw,3.4rem);color:' + ACC + ';}',
    '.od-cue.ok{font-size:clamp(1.1rem,3.6vw,1.5rem);color:#cfe6c4;}',
    '.od-cue.bad{font-size:clamp(1.4rem,5vw,2rem);color:#e8695e;}',
    '.od-cue.close{font-size:clamp(1rem,3.4vw,1.35rem);color:#e9ecf2;opacity:.9;}',

    '.od-flash{position:absolute;inset:0;pointer-events:none;opacity:0;',
    '  transition:opacity .28s ease;}',
    '.od-flash.bad{background:radial-gradient(120% 90% at 50% 50%,rgba(0,0,0,0) 42%,rgba(190,45,35,.62) 100%);}',
    '.od-flash.ok{background:radial-gradient(120% 90% at 50% 50%,rgba(0,0,0,0) 46%,rgba(192,138,62,.35) 100%);}',
    '.od-flash.on{opacity:1;transition-duration:.06s;}',

    /* 카드 ------------------------------------------------------------ */
    '.od-scrim{position:absolute;inset:0;pointer-events:auto;display:flex;',
    '  align-items:flex-end;justify-content:center;padding:0 16px 6vh;',
    '  background:linear-gradient(180deg,rgba(5,7,11,0) 30%,rgba(5,7,11,.55) 100%);',
    '  opacity:0;transition:opacity .3s ease;}',
    '.od-scrim.on{opacity:1;}',
    '.od-card{width:min(520px,100%);background:rgba(9,11,16,.74);',
    '  -webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);',
    '  border:1px solid rgba(192,138,62,.28);border-radius:14px;padding:20px 20px 16px;',
    '  box-shadow:0 18px 50px rgba(0,0,0,.55);transform:translateY(14px);',
    '  transition:transform .32s cubic-bezier(.2,.9,.3,1);}',
    '.od-scrim.on .od-card{transform:translateY(0);}',
    '.od-card .od-tone{display:block;width:26px;height:2px;border-radius:2px;background:' + ACC + ';',
    '  margin-bottom:13px;}',
    '.od-card.win .od-tone{background:#7fc08a;} .od-card.lose .od-tone{background:#c05a4e;}',
    '.od-line{margin:0 0 6px;font-size:clamp(.98rem,2.5vw,1.1rem);line-height:1.62;',
    '  color:#e9ecf2;letter-spacing:-.01em;}',
    '.od-line:last-of-type{margin-bottom:0;}',
    '.od-fact{margin:13px 0 0;padding-top:11px;border-top:1px solid rgba(255,255,255,.09);',
    '  font-size:.8rem;line-height:1.55;color:#98a1b1;}',
    '.od-btns{display:flex;gap:9px;margin-top:16px;}',
    '.od-btn{flex:1;pointer-events:auto;appearance:none;border:1px solid rgba(255,255,255,.16);',
    '  background:rgba(255,255,255,.05);color:#e9ecf2;font:inherit;font-weight:700;',
    '  font-size:.95rem;padding:13px 10px;border-radius:10px;cursor:pointer;',
    '  -webkit-tap-highlight-color:transparent;transition:background .15s ease,transform .1s ease;}',
    '.od-btn:active{transform:translateY(1px);}',
    '.od-btn.pri{background:' + ACC + ';border-color:' + ACC + ';color:#17130b;}',
    '.od-btn.pri:hover{background:#d29a4c;}',
    '.od-hint{margin:14px 0 0;text-align:center;font-size:.74rem;letter-spacing:.16em;',
    '  color:#8d95a3;animation:od-blink 1.9s ease-in-out infinite;}',
    '@keyframes od-blink{0%,100%{opacity:.35}50%{opacity:.95}}',

    '@media (max-width:520px){',
    '  .od-hud{padding:10px 14px 0;} .od-crew-n{font-size:2.1rem;}',
    '  .od-next-box{width:44px;height:32px;} .od-scrim{padding-bottom:4vh;}',
    '  .od-card{padding:17px 16px 14px;}',
    '}'
  ].join('');

  /* ── 조립 ───────────────────────────────────────────────────────────── */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function ensure() {
    if (root) return root;
    var host = document.getElementById('ui-root') || document.body;
    if (!document.getElementById('od-ui-style')) {
      var st = document.createElement('style');
      st.id = 'od-ui-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    root = el('div', 'od-root');

    elHud = el('div', 'od-hud',
      '<div class="od-crew">' +
        '<div class="od-crew-row"><span class="od-crew-n">6</span>' +
        '<span class="od-cap">부하</span></div>' +
        '<div class="od-pips"></div>' +
      '</div>' +
      '<div class="od-flock">' +
        '<div class="od-flock-row">' + sheepSVG('') + '<span class="od-flock-n">0</span></div>' +
        '<div class="od-next"><span class="od-cap">다음</span>' +
          '<div class="od-next-box none">' +
            sheepSVG('od-ghost') + sheepSVG('od-solid') +
          '</div>' +
        '</div>' +
      '</div>');

    elCue = el('div', 'od-cue');
    elFlash = el('div', 'od-flash');

    root.appendChild(elFlash);
    root.appendChild(elHud);
    root.appendChild(elCue);
    host.appendChild(root);

    paintHud();
    return root;
  }

  /* ── HUD ────────────────────────────────────────────────────────────── */
  var lastCrew = null;

  function paintHud() {
    if (!elHud) return;
    var n = elHud.querySelector('.od-crew-n');
    var pips = elHud.querySelector('.od-pips');
    var flock = elHud.querySelector('.od-flock-n');
    var box = elHud.querySelector('.od-next-box');

    n.textContent = String(state.crew);
    if (lastCrew !== null && lastCrew !== state.crew) {
      n.classList.add('bump');
      setTimeout(function () { n.classList.remove('bump'); }, 190);
    }
    lastCrew = state.crew;

    if (pips.childElementCount !== state.crewTotal) {
      pips.innerHTML = '';
      for (var i = 0; i < state.crewTotal; i++) pips.appendChild(el('i', 'od-pip'));
    }
    for (var j = 0; j < pips.children.length; j++) {
      pips.children[j].className = 'od-pip' + (j < state.crew ? '' : ' off');
    }

    flock.textContent = String(state.sheep);
    var k = sizeIndex(state.next);
    box.className = 'od-next-box ' + (k < 0 ? 'none' : ['s', 'm', 'l'][k]);
    /* 다음 양이 없으면 미리보기 자체를 지운다 — 빈 실루엣이 남아 있으면 거짓말이 된다 */
    elHud.querySelector('.od-next').style.opacity = (k < 0) ? '0' : '1';
  }

  function hud(o) {
    ensure();
    if (o) for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var key = (k in state) ? k : ALIAS[k];
      if (key) state[key] = o[k];
    }
    paintHud();
    return state;
  }

  function showHud(on) {
    ensure();
    elHud.classList[on === false ? 'remove' : 'add']('on');
  }

  /* ── 순간 표시 ──────────────────────────────────────────────────────── */
  function cue(text, kind, ms) {
    ensure();
    if (cueTimer) { clearTimeout(cueTimer); cueTimer = 0; }
    if (!text) { elCue.className = 'od-cue'; elCue.textContent = ''; return; }
    elCue.textContent = text;
    elCue.className = 'od-cue ' + (kind || 'now') + ' on';
    cueTimer = setTimeout(function () {
      elCue.className = 'od-cue ' + (kind || 'now');
      cueTimer = 0;
    }, ms || 1100);
  }

  function flash(kind) {
    ensure();
    elFlash.className = 'od-flash ' + (kind || 'bad') + ' on';
    setTimeout(function () { elFlash.className = 'od-flash ' + (kind || 'bad'); }, 90);
  }

  /* ── 카드 ───────────────────────────────────────────────────────────── */
  function lines(t) {
    if (t == null) return [];
    return (Object.prototype.toString.call(t) === '[object Array]') ? t : String(t).split('\n');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function card(o) {
    ensure();
    closeCard();
    o = o || {};
    cur = o;

    var html = '<div class="od-card' + (o.tone ? ' ' + o.tone : '') + '">';
    html += '<span class="od-tone"></span>';
    var L = lines(o.text);
    for (var i = 0; i < L.length; i++) html += '<p class="od-line">' + esc(L[i]) + '</p>';
    if (o.fact) html += '<p class="od-fact">' + esc(o.fact) + '</p>';

    var hasAlt = !!o.onAlt;
    html += '<div class="od-btns">';
    if (hasAlt) html += '<button class="od-btn" data-a="alt">' + esc(o.alt || '다시') + '</button>';
    html += '<button class="od-btn pri" data-a="ok">' + esc(o.ok || '계속') + '</button>';
    html += '</div>';
    /* 조작을 문장으로 설명하지 않는다 — 그 기기에서 되는 입력만 나열한다 */
    if (!hasAlt) html += '<p class="od-hint">' + (TOUCH ? '아무 곳이나 탭' : '스페이스 · 클릭') + '</p>';
    html += '</div>';

    elScrim = el('div', 'od-scrim', html);
    elCard = elScrim.firstChild;
    root.appendChild(elScrim);
    openedAt = Date.now();
    /* 다음 프레임에 켜야 트랜지션이 산다 */
    requestAnimationFrame(function () { if (elScrim) elScrim.classList.add('on'); });

    elScrim.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('.od-btn') : null;
      ev.stopPropagation();
      if (Date.now() - openedAt < 380) return;          /* 죽은 그 탭이 카드를 넘기지 않게 */
      if (b) { act(b.getAttribute('data-a')); return; }
      if (!hasAlt) act('ok');                            /* 선택지가 없을 때만 아무 곳이나 */
    });

    keyHandler = function (ev) {
      if (ev.key !== ' ' && ev.key !== 'Enter' && ev.code !== 'Space') return;
      ev.preventDefault();
      ev.stopPropagation();                              /* 스테이지 입력으로 새지 않게 */
      if (Date.now() - openedAt < 380) return;
      act('ok');
    };
    window.addEventListener('keydown', keyHandler, true);
    return elCard;
  }

  function act(which) {
    var o = cur;
    if (!o) return;
    var fn = (which === 'alt') ? o.onAlt : o.onOk;
    closeCard();
    if (typeof fn === 'function') { try { fn(); } catch (e) { /* 게임은 계속 */ } }
  }

  function closeCard() {
    if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    if (elScrim && elScrim.parentNode) elScrim.parentNode.removeChild(elScrim);
    elScrim = null; elCard = null; cur = null;
  }

  function isCardOpen() { return !!elScrim; }

  function story(text, onOk) {
    return card({ text: text, ok: '시작', onOk: onOk || hooks.onNext });
  }

  function result(o) {
    o = o || {};
    return card({
      text: o.text,
      fact: o.fact,
      tone: o.win ? 'win' : 'lose',
      ok: o.ok || '계속',
      onOk: o.onNext || hooks.onNext,
      alt: o.alt || '다시',
      onAlt: o.onRetry || hooks.onRetry
    });
  }

  function init(h) {
    hooks = h || {};
    destroy();
    ensure();
    return OD.UI;
  }

  function destroy() {
    closeCard();
    if (cueTimer) { clearTimeout(cueTimer); cueTimer = 0; }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = elHud = elCue = elFlash = null;
    lastCrew = null;
  }

  return {
    init: init, hud: hud, showHud: showHud, cue: cue, flash: flash,
    card: card, story: story, result: result,
    closeCard: closeCard, isCardOpen: isCardOpen, destroy: destroy,
    state: function () { return state; },
    /* 옛 이름 몇 개는 살려둔다 — 스테이지 모듈이 어느 쪽으로 부르든 깨지지 않게 */
    storyCard: function (t, f, cb) { return card({ text: t, fact: f, ok: '시작', onOk: cb }); },
    toast: function (m) { return cue(m, 'close', 1400); }
  };
})();
