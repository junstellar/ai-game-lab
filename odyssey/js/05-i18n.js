/* ==========================================================================
   오디세이아 / ODYSSEY — 05-i18n.js  →  OD.I18N

   게임 안 문자열을 언어별로 갈아 끼운다.

   ── 왜 이렇게 만들었나 ────────────────────────────────────────────────────
   이 게임의 문자열은 원래 HTML 템플릿 안에 그대로 박혀 있었다.
       '<div class="cue">지금!</div>'
   그래서 번역하려면 마크업에서 문자열을 뜯어내는 일부터 해야 한다.
   한 번에 6편을 다 뜯으면 어디서 깨졌는지 알 수 없으므로 **1편만 먼저** 한다.

   ── 쓰는 법 ──────────────────────────────────────────────────────────────
   OD.I18N.add({ ko:{ 'st1.cue':'지금!' }, en:{ 'st1.cue':'Now!' }, … })
   OD.I18N.t('st1.cue')                       → 현재 언어의 문자열
   OD.I18N.t('st1.out', { n: 5 })             → '{n}' 자리를 채운다
   OD.I18N.set('en')                          → 언어를 바꾸고 onChange 를 부른다
   OD.I18N.onChange(fn)

   키가 없으면 **한국어로 떨어진다.** 2~6편은 아직 등록을 안 했으므로
   언어를 바꿔도 한국어 그대로 나온다 — 빈 화면이 되는 것보다 낫다.

   ── 언어를 정하는 순서 ───────────────────────────────────────────────────
   1. ?lang=en                     (주소로 지정 — 검증 하네스가 쓴다)
   2. localStorage                 (지난번 선택)
   3. 들어온 블로그 글의 경로      (/en/ /ja/ /zh/ 에서 왔으면 그 언어)
   4. 브라우저 언어
   5. 한국어
   ========================================================================== */

window.OD = window.OD || {};

OD.I18N = (function () {
  'use strict';

  var LANGS = ['ko', 'en', 'ja', 'zh'];
  var LABEL = { ko: '한국어', en: 'English', ja: '日本語', zh: '中文' };
  var KEY = 'gamelab:odyssey:lang';

  var dict = { ko: {}, en: {}, ja: {}, zh: {} };
  var listeners = [];
  var lang = 'ko';

  function known(v) {
    if (!v) return null;
    v = String(v).toLowerCase();
    if (v.indexOf('ko') === 0) return 'ko';
    if (v.indexOf('ja') === 0) return 'ja';
    if (v.indexOf('zh') === 0) return 'zh';
    if (v.indexOf('en') === 0) return 'en';
    return null;
  }

  function fromQuery() {
    try {
      var m = /[?&]lang=([a-zA-Z-]+)/.exec(location.search || '');
      return m ? known(m[1]) : null;
    } catch (e) { return null; }
  }
  function fromStore() {
    try { return known(localStorage.getItem(KEY)); } catch (e) { return null; }
  }
  /* 블로그 번역글(/en/p/…)에서 넘어왔으면 그 언어로 시작한다.
     영어 글을 읽고 들어온 사람에게 한국어 화면을 내미는 게 이 작업의 발단이었다. */
  function fromReferrer() {
    try {
      var r = document.referrer || '';
      if (!r) return null;
      var m = /^https?:\/\/[^/]+\/(en|ja|zh)(\/|$)/.exec(r);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function fromNavigator() {
    try { return known(navigator.language || (navigator.languages || [])[0]); }
    catch (e) { return null; }
  }

  function resolve() {
    return fromQuery() || fromStore() || fromReferrer() || fromNavigator() || 'ko';
  }

  /* '{n}' 같은 자리를 채운다. 값이 없으면 자리표시자를 그대로 두지 않고 지운다 */
  function fill(s, vars) {
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (_, k) {
      return (vars[k] == null) ? '' : String(vars[k]);
    });
  }

  var API = {
    LANGS: LANGS,
    LABEL: LABEL,

    get lang() { return lang; },

    /** {ko:{k:v}, en:{k:v}, …} 를 합친다. 같은 키는 나중 것이 이긴다. */
    add: function (packs) {
      if (!packs) return;
      for (var i = 0; i < LANGS.length; i++) {
        var L = LANGS[i], src = packs[L];
        if (!src) continue;
        for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) {
          dict[L][k] = src[k];
        }
      }
    },

    /** 현재 언어의 문자열. 없으면 한국어, 그것도 없으면 키 자체를 돌려준다. */
    t: function (key, vars) {
      var v = dict[lang] && dict[lang][key];
      if (v == null) v = dict.ko && dict.ko[key];
      if (v == null) return key;
      return fill(v, vars);
    },

    /** 이 언어에 이 키가 실제로 있는가 (섞임 여부를 재는 데 쓴다) */
    has: function (key, l) {
      var d = dict[l || lang];
      return !!(d && d[key] != null);
    },

    set: function (v) {
      var next = known(v);
      if (!next || next === lang) return lang;
      lang = next;
      try { localStorage.setItem(KEY, lang); } catch (e) { }
      try { document.documentElement.setAttribute('lang', lang); } catch (e) { }
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](lang); } catch (e) { }
      }
      return lang;
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /** 계측용 — 언어별로 몇 개가 등록됐나 */
    stats: function () {
      var o = {};
      for (var i = 0; i < LANGS.length; i++) {
        var L = LANGS[i], n = 0;
        for (var k in dict[L]) if (Object.prototype.hasOwnProperty.call(dict[L], k)) n++;
        o[L] = n;
      }
      return o;
    }
  };

  lang = resolve();
  try { document.documentElement.setAttribute('lang', lang); } catch (e) { }

  return API;
})();
