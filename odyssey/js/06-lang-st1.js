/* ==========================================================================
   오디세이아 / ODYSSEY — 06-lang-st1.js

   1편(키클롭스의 동굴)과 공통 화면 문구의 4개국어 대응표.

   ── 번역할 때 지킨 것 ────────────────────────────────────────────────────
   1. **길이.** 게이지 옆·화면 한가운데에 뜨는 문구는 한국어가 짧다.
      영어가 길어지면 줄이 넘어가므로, 뜻을 줄이더라도 짧게 잡았다.
      (예: '아슬아슬하게 놓쳤다' → 'So close' — 'Missed it by a hair' 는 넘친다)
   2. **명령형.** 화면이 시키는 말은 명령형으로 통일한다.
      1편에서 배운 것 — 안내가 규칙을 가르치지 못하면 그 판은 실패다.
   3. **결과 문구는 서술형.** 이야기 카드는 신화를 읽는 어조를 유지한다.

   2~6편은 아직 등록하지 않았다. 등록 안 된 키는 한국어로 떨어진다.
   ========================================================================== */

(function () {
  'use strict';
  if (!window.OD || !OD.I18N) return;

  OD.I18N.add({

    /* ── 한국어 (원본) ────────────────────────────────────────────────── */
    ko: {
      /* 공통 화면 */
      'ui.period': '.',
      'ui.next': '계속',
      'ui.retry': '다시',
      'ui.start': '시작',
      'ui.restart': '처음부터',
      'ui.crew': '부하',
      'ui.upcoming': '다음',
      'ui.tapAnywhere': '아무 곳이나 탭',
      'ui.spaceClick': '스페이스 · 클릭',
      'ui.carry': '남은 부하 {n}명 — 이 인원으로 항해는 이어진다.',

      /* 1편 — 진행 중 화면 */
      'st1.cue': '지금!',
      'st1.hint': '스페이스 또는 화면을 눌러 내보낸다',
      'st1.noCrew': '남은 부하가 없다',
      'st1.noSheep': '아직 양이 없다',
      'st1.escaped': '빠져나갔다',
      'st1.grazed': '아슬아슬하게 놓쳤다',
      'st1.caught': '붙잡혔다',
      'st1.late': '너무 늦었다',
      'st1.early': '너무 일렀다',

      /* 1편 — 판 안의 결과 패널 */
      'st1.endAll': '여섯 모두 나왔다',
      'st1.endNone': '아무도 나오지 못했다',
      'st1.endSome': '동굴을 벗어났다',
      'st1.endLine': '빠져나간 부하 <b>{out}</b>명 · 붙잡힘 {caught}명',
      'st1.endTrapped': ' · 갇힘 {trapped}명',

      /* 1편 — 이야기 결과 카드 */
      'st1.cardAll': '여섯 모두 빠져나갔다.',
      'st1.cardNone': '아무도 빠져나가지 못했다.',
      'st1.cardSome': '{n}명이 양 배에 매달려 빠져나갔다.',
      'st1.cardCaught': '붙잡힘 {n}명',
      'st1.cardTrapped': ' · 동굴에 갇힘 {n}명',
      'st1.fact': '오디세우스는 스스로 가장 큰 숫양의 배에 매달려 나왔습니다.'
    },

    /* ── English ──────────────────────────────────────────────────────── */
    en: {
      'ui.period': '.',
      'ui.next': 'Continue',
      'ui.retry': 'Again',
      'ui.start': 'Start',
      'ui.restart': 'From the top',
      'ui.crew': 'crew',
      'ui.upcoming': 'next',
      'ui.tapAnywhere': 'Tap anywhere',
      'ui.spaceClick': 'Space · click',
      'ui.carry': '{n} crew left — the voyage goes on with these.',

      'st1.cue': 'Now!',
      'st1.hint': 'Press space or tap the screen to send one out',
      'st1.noCrew': 'No one left to send',
      'st1.noSheep': 'No sheep yet',
      'st1.escaped': 'Out!',
      'st1.grazed': 'So close',
      'st1.caught': 'Caught',
      'st1.late': 'Too late',
      'st1.early': 'Too early',

      'st1.endAll': 'All six got out',
      'st1.endNone': 'No one got out',
      'st1.endSome': 'Out of the cave',
      'st1.endLine': '<b>{out}</b> out · {caught} caught',
      'st1.endTrapped': ' · {trapped} trapped',

      'st1.cardAll': 'All six got out.',
      'st1.cardNone': 'No one got out.',
      'st1.cardSome': '{n} slipped out clinging to a sheep’s belly.',
      'st1.cardCaught': '{n} caught',
      'st1.cardTrapped': ' · {n} left behind in the cave',
      'st1.fact': 'Odysseus himself went out clinging to the belly of the largest ram.'
    },

    /* ── 日本語 ───────────────────────────────────────────────────────── */
    ja: {
      'ui.period': '。',
      'ui.next': '続ける',
      'ui.retry': 'もう一度',
      'ui.start': '開始',
      'ui.restart': '最初から',
      'ui.crew': '部下',
      'ui.upcoming': '次',
      'ui.tapAnywhere': 'どこでもタップ',
      'ui.spaceClick': 'スペース・クリック',
      'ui.carry': '残る部下 {n}人 — この人数で航海は続く。',

      'st1.cue': '今！',
      'st1.hint': 'スペースか画面を押して逃がす',
      'st1.noCrew': '送り出す者がいない',
      'st1.noSheep': 'まだ羊がいない',
      'st1.escaped': '逃げた',
      'st1.grazed': '惜しかった',
      'st1.caught': '捕まった',
      'st1.late': '遅すぎた',
      'st1.early': '早すぎた',

      'st1.endAll': '六人とも出た',
      'st1.endNone': '誰も出られなかった',
      'st1.endSome': '洞窟を出た',
      'st1.endLine': '脱出 <b>{out}</b>人 · 捕縛 {caught}人',
      'st1.endTrapped': ' · 取り残し {trapped}人',

      'st1.cardAll': '六人とも逃げ延びた。',
      'st1.cardNone': '誰も逃げられなかった。',
      'st1.cardSome': '{n}人が羊の腹にしがみついて逃げ延びた。',
      'st1.cardCaught': '捕縛 {n}人',
      'st1.cardTrapped': ' · 洞窟に取り残し {n}人',
      'st1.fact': 'オデュッセウス自身は、最も大きな牡羊の腹にしがみついて出ました。'
    },

    /* ── 中文 ─────────────────────────────────────────────────────────── */
    zh: {
      'ui.period': '。',
      'ui.next': '继续',
      'ui.retry': '再来',
      'ui.start': '开始',
      'ui.restart': '从头开始',
      'ui.crew': '部下',
      'ui.upcoming': '下一只',
      'ui.tapAnywhere': '点击任意处',
      'ui.spaceClick': '空格 · 点击',
      'ui.carry': '剩余部下 {n} 人 — 航程带着这些人继续。',

      'st1.cue': '就是现在！',
      'st1.hint': '按空格或点击屏幕送一个出去',
      'st1.noCrew': '没有人可以送了',
      'st1.noSheep': '还没有羊',
      'st1.escaped': '出去了',
      'st1.grazed': '就差一点',
      'st1.caught': '被抓住了',
      'st1.late': '太晚了',
      'st1.early': '太早了',

      'st1.endAll': '六个人全都出来了',
      'st1.endNone': '没有人出得来',
      'st1.endSome': '离开了洞穴',
      'st1.endLine': '逃出 <b>{out}</b> 人 · 被抓 {caught} 人',
      'st1.endTrapped': ' · 困住 {trapped} 人',

      'st1.cardAll': '六个人全都逃了出来。',
      'st1.cardNone': '没有一个人逃出来。',
      'st1.cardSome': '{n} 人抓着羊肚子逃了出来。',
      'st1.cardCaught': '被抓 {n} 人',
      'st1.cardTrapped': ' · 被困在洞穴里 {n} 人',
      'st1.fact': '奥德修斯自己是抓着最大那只公羊的肚子出来的。'
    }
  });
})();
