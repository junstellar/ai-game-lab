/* ============================================================================
   오디세이아 / ODYSSEY — 90-boot.js  →  OD.Boot
   ----------------------------------------------------------------------------
   여섯 편, 여섯 엔진. 각 편은 자기 파일 하나가 통째로 소유한다:
     1편 OD.St1 (st1-cyclops)  순간에 탭
     2편 OD.St2 (st2-windbag)  누르고 있다가 놓기
     3편 OD.St3 (st3-sirens)   버티기
     4편 OD.St4 (st4-scylla)   틈에 연타
     5편 OD.St5 (st5-cattle)   배분 탭
     6편 OD.St6 (st6-bow)      당겼다 정확히 놓기

   보트는 캔버스·루프·입력·결과 카드·부하 장부만 붙여주고 규칙에는 손대지 않는다.

   ★ 엔진마다 캔버스가 따로다.
     하나의 캔버스에 WebGL 컨텍스트를 두 번 물리면 전환할 때 화면이 죽는다
     (이미 겪은 문제다). 그래서 1편은 #gl 을 쓰고, 2~6편은 처음 들어설 때
     #gl-st2 … #gl-st6 을 만든다. showEngine() 이 상호 배타로 하나만 켠다.

   ★ 부하는 여섯 편을 관통한다. 600명으로 출항해서
     각 편의 손실이 Core.crew 에 남고 다음 편이 그 인원으로 시작한다
     (Core.crew → StN.setCrew). 5편에서 배가 쪼개지면 6편은 혼자다.
     그게 이 게임의 서사 장치이고, 에필로그가 그 수를 되돌려 준다.

   window.__SHOT = { ready, press(down), state(), stage(i), skipTo(sec,…) }
     + hold() auto() next() retry() tap() card() errors()      ← 자동 플레이용
   ========================================================================== */

window.OD = window.OD || {};

OD.Boot = (function () {
  'use strict';

  var Core = null, UI = null;
  var cvMain = null;            // 1편 캔버스 (#gl)
  var engine = null;            // 'st1' … 'st6' | null
  var raf = 0, lastT = 0;
  var booted = false, dead = false, stepping = false;
  var errors = [];
  var cardKind = null;          // 'result' | 'epilogue' | null

  /* ══════════════════════════════════════════════════════════════════════
     여섯 편의 명부 — 이 표가 곧 항해다
       hold   : 누르고 있는 편(press(true)/press(false))인가, 탭인가
       repeat : 키 자동반복을 살릴 것인가 (1편만 살린다 — 승인된 감각 그대로)
     ════════════════════════════════════════════════════════════════════ */
  var ENG = [
    { key: 'st1', name: 'St1', id: 'cyclops', title: '키클롭스의 동굴',      hold: false, repeat: true },
    { key: 'st2', name: 'St2', id: 'windbag', title: '아이올로스의 바람 자루', hold: true,  repeat: false },
    { key: 'st3', name: 'St3', id: 'sirens',  title: '세이렌의 노래',        hold: true,  repeat: false },
    { key: 'st4', name: 'St4', id: 'scylla',  title: '스킬라와 카리브디스',   hold: false, repeat: false },
    { key: 'st5', name: 'St5', id: 'cattle',  title: '헬리오스의 소',        hold: false, repeat: false },
    { key: 'st6', name: 'St6', id: 'bow',     title: '이타카의 활',          hold: true,  repeat: false }
  ];
  var byKey = {}, byId = {}, live = [];   // live = 실제로 불려온 편만

  /* ── 에러 안전망 ────────────────────────────────────────────────────── */
  function note(where, e) {
    var m = '[' + where + '] ' + ((e && (e.stack || e.message)) || String(e));
    errors.push(m);
    if (errors.length > 60) errors.shift();
    if (!booted) bootErr(m);
    return m;
  }
  function guard(where, fn) {
    return function () {
      if (dead) return null;
      try { return fn.apply(this, arguments); }
      catch (e) { note(where, e); return null; }
    };
  }

  /* ── 부팅 화면 ──────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function bootMsg(txt, pct) {
    var m = $('bootMsg'), b = $('bootBar');
    if (m && txt != null) m.textContent = txt;
    if (b && pct != null) b.style.width = pct + '%';
  }
  function bootErr(txt) {
    var e = $('bootErr');
    if (e) e.textContent = String(txt).slice(0, 240);
  }
  function bootHide() {
    var b = $('boot');
    if (!b) return;
    b.className = 'gone';
    setTimeout(function () { if (b) b.style.display = 'none'; }, 450);
  }

  /* ── 작은 도우미 ────────────────────────────────────────────────────── */
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function uiHost() { return $('ui-root') || document.body; }
  function cur() { return (engine && byKey[engine]) ? byKey[engine] : null; }

  /* ══════════════════════════════════════════════════════════════════════
     캔버스와 HUD 층 — 엔진마다 하나씩, 상호 배타
     ════════════════════════════════════════════════════════════════════ */
  function engCanvas(E) {
    if (E.cv) return E.cv;
    if (E.key === 'st1') { E.cv = cvMain; return E.cv; }
    var c = document.createElement('canvas');
    c.id = 'gl-' + E.key;
    c.style.cssText = 'position:absolute;inset:0;display:none;width:100%;' +
                      'height:100%;touch-action:none;outline:none;';
    (cvMain.parentNode || document.body).insertBefore(c, cvMain.nextSibling);
    E.cv = c;
    return c;
  }

  /* 판이 소유한 HUD 층. z-index 를 박아 **스택 문맥을 가둔다** —
     .stN 안쪽이 z-index:5 라, 가두지 않으면 결과 카드(.od-scrim)가
     게이지 뒤로 숨는다. 카드를 든 .od-root 는 boot() 에서 더 위로 올린다. */
  function engLayer(E) {
    if (E.layer) return E.layer;
    var d = document.createElement('div');
    d.id = 'od-' + E.key + '-layer';
    d.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;';
    uiHost().appendChild(d);
    E.layer = d;
    return d;
  }

  /* 들어서는 엔진 것만 켜고 나머지는 전부 끈다 —
     WebGL 컨텍스트가 붙은 캔버스를 겹쳐 두면 위에 것만 보이고 아래가 죽는다. */
  function showEngine(which) {
    for (var i = 0; i < live.length; i++) {
      var E = live[i], on = (E.key === which);
      if (E.cv) E.cv.style.display = on ? 'block' : 'none';
      if (E.layer) E.layer.style.display = on ? '' : 'none';
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     엔진 하나를 붙이고 / 들어서고 / 떠난다
     ════════════════════════════════════════════════════════════════════ */
  function engMount(E) {
    if (E.ready) return true;
    var cv = engCanvas(E), layer = engLayer(E);
    cv.style.display = 'block';        // 렌더러가 크기를 재려면 먼저 보여야 한다
    var opts = {
      hudHost: layer,
      crew: Core.crew,      // 앞 편에서 살아 남은 인원으로 이어 간다
      loop: false,          // 루프는 보트가 돌린다 (엔진이 여섯이므로)
      onResize: false,      // 리사이즈도 보트가 준다
      autoStart: false,
      bindInput: false,     // 입력도 보트가 준다 (오버레이가 탭을 먹지 못하게)
      endPanel: false       // 끝 화면은 결과 카드로
    };
    /* 1편만 mount(canvas, opts), 2~6편은 mount(root, ui, opts) 다 */
    if (E.key === 'st1') E.mod.mount(cv, opts);
    else E.mod.mount(cv, null, opts);
    E.mod.onEnd = guard(E.key + ':end', function (res) { onEnd(E, res); });
    E.ready = true;
    return true;
  }

  function engPress(E, down) {
    if (!E || !E.ready) return null;
    if (E.hold) return E.mod.press(down);
    if (!down) return null;              // 탭 전용 — 놓는 건 규칙에 없다
    return E.mod.press(true);            // 1편 press() 는 인자를 무시한다
  }

  function engRelease(E) {
    if (!E || !E.ready || !E.hold) return;
    if (E.mod.phase !== 'run') return;   // 아직 시작 전이면 손대지 않는다
    E.mod.press(false);
  }

  function enter(E, p) {
    leaveAll(E);
    engine = E.key;
    E.res = null;
    engMount(E);
    showEngine(E.key);
    UI.showHud(false);
    UI.closeCard(); cardKind = null;
    E.crewIn = Core.crew;
    if (!p || !p.retry) E.runs = 0;
    /* ★ 앞 편에서 잃은 부하가 여기로 이어진다. reset() 이 이 수로 판을 다시 짠다 */
    if (typeof E.mod.setCrew === 'function') E.mod.setCrew(Core.crew);
    E.mod.reset();
    E.mod.resize(E.cv.clientWidth, E.cv.clientHeight);
    /* 설명 카드는 없다 — 규칙은 화면이 가르친다(STAGE1.md §7, STAGES-3-6.md).
       바로 흐르기 시작해야 2초 안에 무엇을 하는 게임인지 안다. */
    E.mod.start();
  }

  function leaveAll(except) {
    for (var i = 0; i < live.length; i++) {
      var E = live[i];
      if (E === except || !E.ready) continue;
      try { engRelease(E); E.mod.pause(); } catch (e) { note(E.key + ':pause', e); }
      if (E.layer) E.layer.style.display = 'none';
      if (E.cv) E.cv.style.display = 'none';
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     결과 → Core 장부 → 카드
     잃은 부하가 다음 편으로 이어지는 자리다. 여기가 이 게임의 서사다.
     ════════════════════════════════════════════════════════════════════ */
  function lostOf(E, res) {
    if (E.key === 'st1') return Math.max(0, (res.caught || 0) + (res.trapped || 0));
    if (E.key === 'st2') return Math.max(0, res.crewLost || 0);
    return Math.max(0, num(res.lost, 0));
  }

  function starsOf(E, res) {
    if (E.key === 'st1') return res.perfect ? 3 : (res.escaped >= 4 ? 2 : (res.escaped > 0 ? 1 : 0));
    if (E.key === 'st2') {
      var pct = Math.round((res.reached || 0) * 100);
      return pct >= 90 ? 3 : (pct >= 60 ? 2 : (pct >= 30 ? 1 : 0));
    }
    if (E.key === 'st4') return res.win ? (res.taken <= 3 ? 3 : (res.taken <= 6 ? 2 : 1)) : 0;
    if (E.key === 'st6') return res.win ? 3 : 0;
    return res.win ? 3 : 0;
  }

  function onEnd(E, res) {
    E.res = res;
    E.runs++;
    var lost = Math.min(E.crewIn, lostOf(E, res));
    Core.crew = Math.max(0, E.crewIn - lost);
    Core.results[E.index] = {
      id: E.id, lost: lost, runs: E.runs,
      win: !!(E.key === 'st1' ? res.perfect : (E.key === 'st2' ? (res.reached || 0) >= 0.9 : res.win)),
      stars: starsOf(E, res)
    };
    try { Core.save(); } catch (e) { note(E.key + ':save', e); }
    showCard(E, res, lost);
  }

  function retryNow() { cardKind = null; Core.retryStage(); }
  function nextNow() { cardKind = null; Core.nextStage(); }

  /* 이어지는 인원을 매번 마지막 줄에 적는다 — 안 보이면 이어진 게 아니다 */
  function carry() { return '남은 부하 ' + Core.crew + '명 — 이 인원으로 항해는 이어진다.'; }

  function showCard(E, res, lost) {
    var o = cardOf(E, res, lost);
    cardKind = 'result';
    UI.card({
      text: o.text, fact: o.fact, tone: o.tone,
      alt: o.again ? '다시' : null,
      onAlt: o.again ? guard(E.key + ':retry', retryNow) : null,
      ok: o.go ? '계속' : '다시',
      onOk: o.go ? guard(E.key + ':next', nextNow) : guard(E.key + ':retry2', retryNow)
    });
  }

  /* 편마다의 결과 문장. go=진행 가능, again=다시 버튼을 함께 둘 것인가 */
  function cardOf(E, r, lost) {
    var pct, ord = ['첫', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째',
                    '여덟째', '아홉째', '열째', '열한째', '열두째'];

    if (E.key === 'st1') {
      return {
        text: [r.perfect ? '여섯 모두 빠져나갔다.'
                         : (r.escaped === 0 ? '아무도 빠져나가지 못했다.'
                                            : r.escaped + '명이 양 배에 매달려 빠져나갔다.'),
               '붙잡힘 ' + r.caught + '명' +
                 (r.trapped ? ' · 동굴에 갇힘 ' + r.trapped + '명' : '') + '.',
               carry()],
        fact: '오디세우스는 스스로 가장 큰 숫양의 배에 매달려 나왔습니다.',
        tone: r.escaped > 0 ? 'win' : 'lose', go: true, again: true
      };
    }

    if (E.key === 'st2') {
      pct = Math.round((r.reached || 0) * 100);
      var t2;
      if (r.slept) {
        t2 = ['아흐레를 깨어 있었다. 열흘째 새벽, 이타카의 모닥불이 보였다.',
              '그리고 그는 잠들었다.',
              '되밀려 간 뒤 남은 거리 ' + Math.round((r.remain || 0) * 100) + '%.'];
      } else if (r.ranOut) {
        t2 = ['자루가 비었다. 바람이 남지 않았다.', '이타카까지 ' + pct + '% 를 왔다.'];
      } else {
        t2 = ['항해가 끝났다.', '이타카까지 ' + pct + '%.'];
      }
      t2.push(carry());
      return { text: t2, fact: '부하들은 자루 안에 금은보화가 있다고 믿었습니다.',
               tone: pct >= 60 ? 'win' : 'lose', go: true, again: true };
    }

    if (E.key === 'st3') {
      if (r.win) {
        return {
          text: ['그는 들었다. 그리고 살아남았다.',
                 '노래를 듣고 살아남은 사람은 그가 처음이었다.',
                 '파도 ' + r.total + '번을 버텼다 · ' + carry()],
          fact: '세이렌이 부른 것은 미인이 아니라 지식이었습니다 — "네가 모르는 것을 알려주마."',
          tone: 'win', go: true, again: false
        };
      }
      return {
        text: ['밧줄이 풀렸다. 그는 바다로 뛰어들었다.',
               r.reason === 'slip' ? '악력이 바닥난 사이 노래가 밀려들었다.'
                                   : '노래가 밀려오는 동안 손을 놓았다.',
               '파도 ' + (r.waves + 1) + '/' + r.total + ' 에서 놓쳤다.'],
        fact: '붙잡을 수 있는 시간은 유한합니다. 잦아든 사이에 놓아 악력을 되찾아야 합니다.',
        tone: 'lose', go: false, again: false
      };
    }

    if (E.key === 'st4') {
      if (r.win) {
        /* 제일 큰 숫자가 칭찬으로 읽히면 안 된다 — 신화의 '여섯'을 기준선으로 놓고
           그보다 많이 잃었으면 그렇게 말한다. 2편에서 배운 것과 같은 규칙이다. */
        var tk = r.taken || 0;
        var line = tk <= 3
          ? tk + '명만 내주고 해협을 빠져나왔다. 키르케가 말한 여섯보다 적다.'
          : (tk <= 8
            ? tk + '명을 내주고 배를 지켰다. 신화가 말한 여섯쯤이다.'
            : '신화의 스킬라는 여섯을 물어 갔다. 당신은 ' + tk + '명을 내주었다.');
        return {
          text: [line, '해협을 빠져나왔다 · ' + carry()],
          fact: '그는 이 선택을 부하들에게 미리 말하지 않았습니다. ' +
                '말했다면 아무도 노를 젓지 않았을 것입니다.',
          tone: 'win', go: true, again: true
        };
      }
      /* 왜 졌는지를 정확히 말한다. 예전 문구는 "쉬면 끌려간다"였는데,
         연타하다 진 사람에게는 거짓말이었다 — 그는 쉰 적이 없다.
         진짜 이유는 머리 밑에 노를 넣어 정지를 먹은 만큼 못 나아간 것이다. */
      return {
        text: ['카리브디스가 입을 열었다. 배가 통째로 빨려 들어갔다.',
               '노가 배를 밀어내지 못했다 — 머리가 물러난 틈에만 저어야 한다.'],
        fact: '키르케의 조언은 냉정했습니다 — "여섯을 잃더라도 스킬라 쪽에 붙어라."',
        tone: 'lose', go: false, again: false
      };
    }

    if (E.key === 'st5') {
      if (r.win) {
        return {
          text: ['엿새를 버텼다. 이레째 새벽에 바람이 돌아왔다.',
                 '소는 언덕에 그대로 있다 · ' + carry()],
          fact: '호메로스에서는 일어나지 않은 일입니다. 당신은 신화를 이겼습니다.',
          tone: 'win', go: true, again: false
        };
      }
      return {
        text: [(r.dayName ? r.dayName + ' 날' : (r.day + '일째')) +
                 ', 오디세우스가 잠든 사이 부하들이 소를 잡았다.',
               '제우스의 벼락이 배를 쪼갰다. 살아남은 것은 그 하나였다.',
               '남은 부하 0명 — 여기서부터 그는 혼자다.'],
        fact: '그가 혼자 돌아온 이유입니다.',
        tone: 'lose', go: true, again: true
      };
    }

    /* 6편 — 이기면 '계속' 이 에필로그를 연다 */
    if (r.win) {
      return {
        text: ['화살이 열두 자루를 소리 없이 지났다. 홀이 조용해졌다.',
               '그는 누더기를 벗고 두 번째 화살을 메겼다.'],
        fact: '그 활에 시위를 얹을 수 있는 사람은 그 하나뿐이었습니다.',
        tone: 'win', go: true, again: false
      };
    }
    return {
      text: ['화살이 떨어졌다.',
             '가장 멀리 간 화살은 ' + ord[Math.max(0, Math.min(11, (r.best || 1) - 1))] +
               ' 도끼까지였다.',
             '구혼자들이 다시 떠들기 시작했다.'],
      fact: '힘은 충분하고 떨림은 아직 작은 그 찰나 — 거기서 놓아야 합니다.',
      tone: 'lose', go: false, again: false
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     에필로그 — 6편을 지나면 항해가 끝난다
     ════════════════════════════════════════════════════════════════════ */
  /* 여섯 줄은 **당신의 항해**를 적는다. 남의 이야기를 요약하면 에필로그가 아니다. */
  function res(key) { return byKey[key] ? byKey[key].res : null; }

  function summary() {
    var r1 = res('st1'), r2 = res('st2'), r4 = res('st4'), r5 = res('st5');
    var L = [];
    L.push('1 · 키클롭스의 동굴에서 ' +
           (r1 ? (r1.perfect ? '여섯 모두' : '여섯 중 ' + (r1.escaped || 0) + '명이')
               : '부하들이') + ' 양 배에 매달려 나왔다.');
    L.push(r2 && r2.slept
           ? '2 · 이타카가 보이는 새벽에 잠들었고, 자루가 열려 되밀렸다.'
           : (r2 && r2.ranOut
              ? '2 · 아이올로스의 바람이 이타카에 닿기 전에 다 떨어졌다.'
              : '2 · 아이올로스의 바람 자루로 이타카 앞까지 갔다.'));
    L.push('3 · 세이렌의 노래를 듣고 살아남은 첫 사람이 되었다.');
    L.push('4 · 스킬라에게 ' + (r4 ? (r4.taken || 0) : 6) + '명을 내주고 배를 지켰다.');
    L.push(r5 && r5.win
           ? '5 · 헬리오스의 소를 끝내 건드리지 않았다. 이레째에 바람이 돌아왔다.'
           : '5 · 헬리오스의 소에 손댄 대가로 배가 쪼개졌다.');
    L.push('6 · 이십 년 만에 돌아와, 아무도 못 당긴 활을 당겼다.');
    return L;
  }

  function epilogue(crew) {
    cardKind = 'epilogue';
    UI.card({
      text: ['호메로스의 오디세우스는 혼자 돌아왔습니다.',
             crew > 0 ? '당신은 ' + crew + '명을 데려왔습니다.'
                      : '당신도 혼자였습니다.'].concat(summary()),
      fact: '이 이야기의 나머지는 극장에서 이어집니다.',
      tone: 'win',
      ok: '처음부터',
      onOk: guard('epilogue', function () { hooks.onRestart(); })
    });
  }

  /* ── 훅 ─────────────────────────────────────────────────────────────── */
  var hooks = {
    onRetry: guard('onRetry', retryNow),
    onNext: guard('onNext', nextNow),
    onRestart: guard('onRestart', function () {
      cardKind = null;
      UI.closeCard();
      Core.reset(); Core.begin();
    })
  };

  /* ── 버스 → 화면 ────────────────────────────────────────────────────── */
  function subscribe() {
    OD.Bus.on('stage:enter', guard('stage:enter', function (p) {
      var E = byId[p.stage && p.stage.id] || live[p.index];
      if (!E) {
        cardKind = 'result';
        UI.card({ text: ['이 편을 불러오지 못했습니다.'], ok: '처음부터',
                  onOk: guard('missing', function () { hooks.onRestart(); }) });
        return;
      }
      enter(E, p);
      devSync();                  // 선택 바의 현재 편 표시를 맞춘다
    }));

    OD.Bus.on('game:end', guard('game:end', function (p) {
      epilogue(p.crew);
    }));
  }

  /* ══════════════════════════════════════════════════════════════════════
     입력 — 창(window)에서 받는다. 오버레이가 탭을 삼키지 못하게.
     ════════════════════════════════════════════════════════════════════ */
  /* 지금 실제로 떠 있는 UI 만 입력을 가져간다.
     숨은 오버레이까지 세면 캔버스 탭이 통째로 죽는다. */
  function fromUI(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('.od-scrim, .st1 .end.on, .st2 .end.on, .st3 .end.on, ' +
                       '.st4 .end.on, .st5 .end.on, .st6 .end.on');
  }
  function isSpace(e) {
    return e.code === 'Space' || e.key === ' ' || e.keyCode === 32;
  }
  /* 놓는 순간이 규칙의 절반인 편들이 있다(2·3·6) — 손을 뗀 곳이 어디든 반드시
     놓아야 한다. 그래서 release 는 창에서 조건 없이 받는다. */
  function releaseNow() { engRelease(cur()); }

  function bindGlobalInput() {
    window.addEventListener('keydown', guard('key', function (e) {
      var E = cur();
      if (!E) return;
      if (!isSpace(e)) return;
      if (UI.isCardOpen()) return;          // 카드는 UI 가 먼저 가져간다
      e.preventDefault();
      if (e.repeat && !E.repeat) return;    // 자동반복으로 연타가 되면 규칙이 죽는다
      engPress(E, true);
    }), false);

    window.addEventListener('keyup', guard('keyup', function (e) {
      if (!isSpace(e)) return;
      releaseNow();
    }), false);

    window.addEventListener('pointerdown', guard('tap', function (e) {
      var E = cur();
      if (!E) return;
      if (e.button != null && e.button !== 0) return;
      if (UI.isCardOpen() || fromUI(e.target)) return;
      engPress(E, true);
    }), false);

    window.addEventListener('pointerup', guard('tapup', releaseNow), false);
    window.addEventListener('pointercancel', guard('tapcancel', releaseNow), false);
    /* 창을 떠나면 누른 채로 남지 않게 — 돌아왔을 때 이미 져 있으면 억울하다 */
    window.addEventListener('blur', guard('blur', releaseNow), false);

    window.addEventListener('resize', guard('resize', function () {
      var E = cur();
      if (E && E.ready) E.mod.resize(E.cv.clientWidth, E.cv.clientHeight);
    }), false);

    window.addEventListener('error', function (ev) {
      errors.push('[window] ' + (ev && (ev.message || ev.type)));
    }, false);
  }

  /* ── 루프 ───────────────────────────────────────────────────────────── */
  function loop(t) {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    var dt = lastT ? (t - lastT) / 1000 : 0.016;
    lastT = t;
    if (stepping) return;                    // __SHOT 이 손으로 돌리는 중
    try {
      var E = cur();
      if (E && E.ready) E.mod.update(dt);
    } catch (e) {
      note('frame', e);
      if (errors.length > 30) { dead = true; cancelAnimationFrame(raf); raf = 0; }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     개발용 편 선택 바 — 상단에 1~6 을 띄우고 눌러서 바로 그 편으로 간다.
     ─────────────────────────────────────────────────────────────────────
     **공개된 블로그에서는 뜨지 않는다.** localhost·127.0.0.1·file: 에서만,
     또는 주소에 ?dev=1 을 붙였을 때만 나온다. ?dev=0 으로 끌 수 있다.
     개발 중에는 매번 1편부터 다시 하지 않아도 되게 하는 것이 전부다.
     ════════════════════════════════════════════════════════════════════ */
  var devBar = null;

  function devWanted() {
    var q = '';
    try { q = String(location.search || ''); } catch (e) { q = ''; }
    if (/[?&]dev=0/.test(q)) return false;         // 명시적으로 끄기
    if (/[?&]dev=1/.test(q)) return true;          // 명시적으로 켜기
    var h = '';
    try { h = String(location.hostname || ''); } catch (e) { h = ''; }
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '::1';
  }

  function devCss() {
    if (document.getElementById('od-devbar-css')) return;
    var s = document.createElement('style');
    s.id = 'od-devbar-css';
    s.textContent = [
      '.od-devbar{position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:80;',
      'display:flex;gap:4px;align-items:center;padding:5px 8px;',
      'background:rgba(8,12,18,.82);border:1px solid rgba(255,255,255,.14);',
      'border-top:0;border-radius:0 0 10px 10px;backdrop-filter:blur(6px);',
      'font-family:-apple-system,"Segoe UI","Malgun Gothic",system-ui,sans-serif;',
      'pointer-events:auto;-webkit-user-select:none;user-select:none}',
      '.od-devbar .tag{font-size:.62rem;font-weight:800;letter-spacing:.09em;',
      'color:#6f7d8a;margin-right:3px}',
      '.od-devbar button{all:unset;cursor:pointer;min-width:26px;height:24px;',
      'padding:0 6px;border-radius:6px;text-align:center;font-size:.82rem;',
      'font-weight:800;color:#c8d3dc;background:rgba(255,255,255,.07);',
      'border:1px solid transparent;line-height:24px}',
      '.od-devbar button:hover{background:rgba(255,255,255,.16);color:#fff}',
      '.od-devbar button.on{background:#c08a3e;color:#12161c;border-color:#e0ae63}',
      '.od-devbar button.wide{min-width:auto;font-size:.7rem;font-weight:700;color:#93a0aa}',
      /* 세로 화면에서는 더 작게 — 게임 화면을 가리지 않아야 한다 */
      '@media (max-width:560px){.od-devbar{gap:3px;padding:4px 6px}',
      '.od-devbar .tag{display:none}',
      '.od-devbar button{min-width:22px;height:21px;line-height:21px;font-size:.74rem}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* 편을 처음부터 시작한다. 부하 수는 그 편에 들어갈 때의 값으로 되돌린다 —
     6편만 눌러 보다가 부하가 0 인 채로 시작되면 시험이 안 된다. */
  function devGo(i) {
    try {
      cardKind = null;
      if (UI && UI.closeCard) UI.closeCard();
      Core.start(i);
      devSync();
    } catch (e) { note('dev:go', e); }
  }

  function devSync() {
    if (!devBar) return;
    var cur = Core && Core.current ? Core.current.index : -1;
    var bs = devBar.querySelectorAll('button[data-i]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].className = (+bs[i].getAttribute('data-i') === cur) ? 'on' : '';
    }
  }

  function devMount() {
    if (devBar || !devWanted()) return;
    devCss();
    var el = document.createElement('div');
    el.className = 'od-devbar';
    var html = ['<span class="tag">편</span>'], i;
    for (i = 0; i < live.length; i++) {
      html.push('<button type="button" data-i="' + i + '" title="' +
                live[i].title + '">' + (i + 1) + '</button>');
    }
    html.push('<button type="button" class="wide" data-act="reset">처음부터</button>');
    el.innerHTML = html.join('');
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button') : null;
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      if (b.getAttribute('data-act') === 'reset') {
        try { Core.reset(); cardKind = null; if (UI && UI.closeCard) UI.closeCard();
              Core.begin(); devSync(); } catch (e) { note('dev:reset', e); }
        return;
      }
      devGo(+b.getAttribute('data-i'));
    }, false);
    /* 이 바에서 스페이스·클릭이 게임으로 새어 들어가면 안 된다 */
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); }, false);
    el.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ') e.preventDefault();
    }, false);
    document.body.appendChild(el);
    devBar = el;
    devSync();
  }

  /* ── 부팅 ───────────────────────────────────────────────────────────── */
  function collect() {
    live = []; byKey = {}; byId = {};
    for (var i = 0; i < ENG.length; i++) {
      var E = ENG[i];
      E.mod = OD[E.name] || null;
      if (!E.mod || typeof E.mod.mount !== 'function') continue;
      E.index = live.length;
      E.ready = false; E.runs = 0; E.crewIn = 0; E.res = null;
      E.cv = null; E.layer = null;
      live.push(E);
      byKey[E.key] = E; byId[E.id] = E;
    }
    return live;
  }

  function boot(cv) {
    if (booted) return true;
    cvMain = cv || $('gl');
    try {
      bootMsg('모듈 확인…', 12);
      if (!window.THREE) throw new Error('Three.js 를 불러오지 못했습니다.');
      Core = OD.Core; UI = OD.UI;
      if (!Core) throw new Error('Core 모듈을 찾을 수 없습니다.');
      if (!UI) throw new Error('UI 모듈을 찾을 수 없습니다.');
      if (!cvMain) throw new Error('캔버스를 찾을 수 없습니다.');

      collect();
      if (!live.length) throw new Error('스테이지 모듈을 찾을 수 없습니다.');
      /* ★ 하나라도 빠지면 부팅을 세운다.
         예전엔 빠진 편을 조용히 건너뛰고 남은 것만으로 항로를 짰다. 그래서 캐시에
         옛 파일이 남아 st2~st6 을 못 읽으면 **1편짜리 항해**가 만들어지고,
         1편을 깨자마자 endGame() 이 불려 에필로그("극장에서 이어집니다")가 떴다.
         모자란 채로 굴러가느니 무엇이 없는지 말하고 멈추는 편이 낫다. */
      if (live.length !== ENG.length) {
        var miss = [];
        for (i = 0; i < ENG.length; i++) if (!byKey[ENG[i].key]) miss.push(ENG[i].key);
        throw new Error('스테이지 모듈이 모자랍니다 (' + live.length + '/' + ENG.length +
                        ') — 없는 것: ' + miss.join(', ') +
                        '. 브라우저 캐시를 비우고 새로고침하세요.');
      }

      /* 항로는 여기서 짠다 — 옛 30-stages.js 는 더는 쓰지 않는다.
         편마다 규칙은 자기 파일이 소유하니 Core 에겐 순서와 이름만 필요하다. */
      var defs = [], i;
      for (i = 0; i < live.length; i++) {
        defs.push({ id: live[i].id, index: i, title: live[i].title, budget: null });
      }
      OD.Stages = { all: defs };

      bootMsg('갑판을 정리합니다…', 40);
      UI.init(hooks);
      UI.showHud(false);
      /* 결과 카드는 언제나 판의 HUD 위에 있어야 한다 (engLayer 주석 참고) */
      var uiRoot = document.querySelector('.od-root');
      if (uiRoot) uiRoot.style.zIndex = '10';

      bootMsg('항로를 확인합니다…', 70);
      Core.init();
      if (!Core.stages || !Core.stages.length) throw new Error('스테이지가 비어 있습니다.');

      subscribe();
      bindGlobalInput();
      raf = requestAnimationFrame(loop);

      bootMsg('출항', 100);
      booted = true;
      Core.begin();
      bootHide();
      devMount();                 // 개발 중에만 뜨는 편 선택 바 (공개 페이지에선 안 뜬다)
      SHOT.ready = true;
      return true;
    } catch (e) {
      var m = note('boot', e);
      bootErr(m);
      bootMsg('출항하지 못했습니다', 100);
      return false;
    }
  }

  function dispose() {
    dead = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    for (var i = 0; i < live.length; i++) {
      try { if (live[i].ready) live[i].mod.dispose(); }
      catch (e) { note('dispose:' + live[i].key, e); }
    }
    try { UI && UI.destroy(); } catch (e) { note('dispose:ui', e); }
  }

  /* ══════════════════════════════════════════════════════════════════════
     __SHOT — 자동 플레이/디버그 API
       { ready, press(down), state(), stage(i), skipTo(sec, …) }
     ════════════════════════════════════════════════════════════════════ */
  var SKIP_KEEP = { ready: 1, engine: 1, key: 1, index: 1, id: 1, title: 1,
                    stages: 1, crew: 1, card: 1, cardOpen: 1, finished: 1,
                    errors: 1, errorList: 1, runs: 1 };

  function snapshot() {
    var c = Core && Core.current;
    var stage = c ? c.stage : null;
    var E = cur();
    var out = {
      ready: SHOT.ready,
      engine: engine,
      index: c ? c.index : -1,
      id: stage ? stage.id : null,
      title: stage ? stage.title : null,
      stages: Core ? Core.stages.length : 0,
      crew: Core ? Core.crew : null,
      card: cardKind,
      cardOpen: UI ? UI.isCardOpen() : false,
      finished: Core ? !!Core.finished : false,
      errors: errors.length,
      errorList: errors.slice(0, 6)
    };
    var st = null;
    if (E && E.ready) { try { st = E.mod.state(); } catch (e) { note('state', e); } }
    if (st) {
      for (var k in st) {
        if (!Object.prototype.hasOwnProperty.call(st, k)) continue;
        if (SKIP_KEEP[k]) continue;
        out[k] = st[k];
      }
      out.stCrew = st.crew;             // 판이 들고 있는 수 (Core.crew 와 맞아야 한다)
      out.result = E.res || st.result || null;
      out.runs = E.runs;
    }
    return out;
  }

  var SHOT = {
    ready: false,

    /** 스페이스·클릭·탭과 완전히 같은 입력.
        누르는 편(2·3·6): press(true)=누름 / press(false)=놓음.
        탭 편(1·4·5): press() 한 번의 탭. */
    press: guard('__SHOT.press', function (down) {
      return engPress(cur(), down === undefined ? true : !!down);
    }),

    /** sec 초 동안 누른 채(또는 놓은 채) 세계를 민다.
        누름 상태는 호출이 끝나도 그대로 남는다 — 매 스텝 press 를 다시 주는
        봇 루프를 그대로 돌리기 위해서다. */
    hold: guard('__SHOT.hold', function (sec, down) {
      var E = cur();
      if (!E || !E.ready) return snapshot();
      var n = Math.max(0, Math.round((+sec || 0) / 0.02)), i;
      engPress(E, down === undefined ? true : !!down);
      stepping = true;
      try {
        for (i = 0; i < n; i++) E.mod.update(0.02, true);
        E.mod.update(0, false);
      } finally { stepping = false; lastT = 0; }
      return snapshot();
    }),

    state: function () {
      try { return snapshot(); } catch (e) { return { ready: false, err: String(e) }; }
    },

    /** 게임 시간을 sec(초)까지 밀어붙인다. 루프는 잠시 멈추고 손으로 돌린다.
        두 번째 인자는 편에 따라 hold(bool|fn) 또는 정책 문자열이다. */
    skipTo: guard('__SHOT.skipTo', function (sec, how) {
      var E = cur();
      if (!E || !E.ready) return snapshot();
      var target = +sec || 0;
      stepping = true;
      try {
        if (E.key === 'st1') {                    // 1편엔 skipTo 가 없다 — 손으로 민다
          if (E.mod.state().phase === 'ready') E.mod.start();
          var n = 0;
          while (E.mod.state().gt < target && n++ < 8000) E.mod.update(0.02, true);
          E.mod.update(0, false);
        } else if (typeof E.mod.skipTo === 'function') {
          E.mod.skipTo(target, how);
        } else if (typeof E.mod.drive === 'function') {   // 4편
          var t0 = num(E.mod.state().t, 0);
          E.mod.drive(Math.max(0, target - t0), how === undefined ? false : how);
        }
      } finally { stepping = false; lastT = 0; }
      return snapshot();
    }),

    /** 자동 플레이 — 편마다 자기 봇을 쓴다.
        1편 kinds(['big','mid','sml']) · 2·3편 정책 문자열 · 4편 초당 젓는 횟수
        5편 정책 문자열 · 6편 없음(옵션) */
    auto: guard('__SHOT.auto', function (a, maxSec) {
      var E = cur();
      if (!E || !E.ready) return snapshot();
      E.res = null;
      stepping = true;
      try {
        if (E.key === 'st1') {
          var kinds = isArr(a) ? a : ['big', 'mid', 'sml'];
          var n = Math.round((maxSec || 95) / 0.02), i, st;
          E.mod.start();
          for (i = 0; i < n; i++) {
            st = E.mod.state();
            if (st.phase !== 'run') break;
            if (st.active && !st.pending && st.safeNow && kinds.indexOf(st.active.k) >= 0) E.mod.press();
            E.mod.update(0.02, true);
          }
          E.mod.update(0, false);
        } else if (E.key === 'st2') {
          E.mod.auto(typeof a === 'string' ? a : 'gold', maxSec || 300, true);
        } else if (E.key === 'st3') {
          E.mod.auto(typeof a === 'string' ? a : 'smart', maxSec || 200, true);
        } else if (E.key === 'st4') {
          E.mod.auto(num(a, 6), maxSec || 260);
        } else if (E.key === 'st5') {
          E.mod.skipTo(maxSec || 200, typeof a === 'string' ? a : 'band');
        } else if (E.key === 'st6') {
          E.mod.auto({ maxSec: maxSec || 120, sigma: num(a, undefined) });
        }
        /* 연출(벼락·침몰·정적)이 끝나야 결과가 나온다 — 거기까지 마저 민다 */
        var d = 0;
        while (E.mod.phase !== 'over' && d++ < 500) E.mod.update(0.02, true);
        E.mod.update(0, false);
      } finally { stepping = false; lastT = 0; }
      return snapshot();
    }),

    /** i 번째 판으로 바로 이동(0-based) */
    stage: guard('__SHOT.stage', function (i) {
      if (!Core) return null;
      i = Math.max(0, Math.min(Core.stages.length - 1, i | 0));
      UI.closeCard(); cardKind = null;
      Core.start(i);
      return snapshot();
    }),

    /** 열려 있는 카드의 기본 버튼을 누른 것과 같다 */
    next: guard('__SHOT.next', function () {
      var n = document.querySelector('.od-scrim .od-btn.pri');
      if (n) { n.click(); return snapshot(); }
      return snapshot();
    }),

    retry: guard('__SHOT.retry', function () {
      var n = document.querySelector('.od-scrim .od-btn:not(.pri)');
      if (n) { n.click(); return snapshot(); }
      UI.closeCard(); cardKind = null; Core.retryStage();
      return snapshot();
    }),

    tap: guard('__SHOT.tap', function () {
      var E = cur();
      if (!E) return null;
      engPress(E, true);
      if (E.hold) engPress(E, false);
      return 'press';
    }),

    card: guard('__SHOT.card', function () {
      var n = document.querySelector('.od-scrim');
      return { kind: cardKind, open: !!n, text: n ? n.innerText : '' };
    }),

    /** 이 판의 부하 수를 손으로 갈아 끼운다 (이월 확인용) */
    crew: guard('__SHOT.crew', function (n) {
      if (typeof n === 'number' && Core) Core.crew = Math.max(0, n | 0);
      return Core ? Core.crew : null;
    }),

    errors: function () { return errors.slice(); },
    dispose: function () { dispose(); }
  };

  window.__SHOT = SHOT;

  return {
    boot: boot,
    start: boot,
    init: boot,
    dispose: dispose,
    shot: SHOT,
    get errors() { return errors.slice(); }
  };
})();
