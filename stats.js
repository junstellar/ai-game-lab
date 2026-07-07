/* ============================================================
   공통 기록(누적 점수·연속 출석) / stats.js   →  window.GameStats
   계정·서버 없이 브라우저(localStorage)에 기록을 쌓습니다. (Wordle 방식)
   게임별로 gameId 키를 나눠 저장하므로, 모든 게임이 재사용 가능.

   사용법(게임 끝났을 때 1번 호출):
     var s = GameStats.record("guess-image", { score: 9, maxScore: 15 });
     // s = { plays, totalScore, bestScore, streak, bestStreak, lastPlayed }
   조회:  GameStats.get("guess-image")
   초기화: GameStats.reset("guess-image")
   ============================================================ */
(function(){
  var PREFIX='gamelab:stats:';

  function todayStr(){
    var d=new Date();
    var m=d.getMonth()+1, day=d.getDate();
    return d.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(day<10?'0':'')+day;
  }
  // "YYYY-MM-DD" 두 날짜의 일수 차이 (b - a)
  function dayDiff(a,b){
    var da=new Date(a+'T00:00:00'), db=new Date(b+'T00:00:00');
    return Math.round((db-da)/86400000);
  }
  function blank(){
    return { plays:0, totalScore:0, bestScore:0, streak:0, bestStreak:0, lastPlayed:null };
  }
  function read(gameId){
    try{
      var raw=localStorage.getItem(PREFIX+gameId);
      if(raw){ var s=JSON.parse(raw); return Object.assign(blank(), s); }
    }catch(e){}
    return blank();
  }
  function write(gameId, s){
    try{ localStorage.setItem(PREFIX+gameId, JSON.stringify(s)); }catch(e){}
  }

  window.GameStats={
    get: read,

    record: function(gameId, res){
      var s=read(gameId);
      var score=(res && res.score)||0;
      s.plays     += 1;
      s.totalScore += score;
      if(score > s.bestScore) s.bestScore = score;

      var today=todayStr();
      if(s.lastPlayed===today){
        // 같은 날 재도전 → 연속일수 변화 없음
      } else if(s.lastPlayed && dayDiff(s.lastPlayed, today)===1){
        s.streak += 1;                 // 어제도 했음 → 연속 +1
      } else {
        s.streak = 1;                  // 첫 플레이 or 하루 이상 공백 → 리셋
      }
      if(s.streak > s.bestStreak) s.bestStreak = s.streak;
      s.lastPlayed = today;

      write(gameId, s);
      return s;
    },

    reset: function(gameId){ write(gameId, blank()); }
  };
})();
