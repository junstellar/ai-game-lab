/* ============================================================
   공통 공유 기능 / share.js   →  window.GameShare
   모든 게임이 "결과 공유"에 재사용합니다. (바이럴 내장 장치)

   사용법:
     GameShare.share({
       text: "🎨 AI 그림 맞히기 — 오늘 4/5\n🟩🟩🟥🟩🟩",
       url:  "https://junstellar.github.io/games/guess-image/"
     });

   유틸:
     GameShare.grid([true,false,true])  ->  "🟩🟥🟩"
   ============================================================ */
(function(){
  function toast(msg){
    var t=document.createElement('div');
    t.className='toast';
    t.textContent=msg;
    document.body.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){
      t.classList.remove('show');
      setTimeout(function(){ t.remove(); },250);
    },1900);
  }

  window.GameShare={
    // 정답 여부 배열 -> 이모지 그리드 문자열
    grid:function(results, ok, no){
      ok=ok||'🟩'; no=no||'🟥';
      return results.map(function(r){ return r?ok:no; }).join('');
    },

    // 결과 공유: 지원 브라우저는 네이티브 공유, 아니면 클립보드 복사
    share:function(opts){
      var text=(opts.text||'') + (opts.url ? ('\n'+opts.url) : '');
      if(navigator.share){
        navigator.share({ text:text, url:opts.url }).catch(function(){});
        return;
      }
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){
          toast('결과가 복사됐어요! 어디든 붙여넣어 공유하세요 📋');
        }).catch(function(){ toast('복사 실패 — 화면을 캡처해 공유하세요'); });
      }else{
        toast('이 브라우저는 복사 미지원 — 화면을 캡처해 공유하세요');
      }
    },

    toast:toast
  };
})();
