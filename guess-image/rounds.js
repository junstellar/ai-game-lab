/* ============================================================
   guess-image 문제 풀 / rounds.js   →  window.ROUNDS
   ─────────────────────────────────────────────────────────
   한 판에 이 풀에서 무작위 5문제가 출제됩니다. (index.html 참고)
   문제 추가 = 아래 배열에 객체 하나 + img 이미지 1장(img/<name>.webp).

     img     : ./img/<name>.webp  (draw-local 로 뽑아 webp 변환)
     answer  : 모범 정답(표시용)
     hint    : 1차 실패 후 힌트(답을 흘리지 않게)
     need    : 주관식 인정 규칙 [그룹...] 모두 만족 = 정답.
               그룹=[동의어들] 중 하나라도 포함(띄어쓰기·대소문자 무시·부분일치).
     options : 3차(객관식) 보기 4개 — 반드시 answer 포함.
   ============================================================ */
window.ROUNDS = [
  { img:"img/astro-cat.webp", answer:"우주복 입은 고양이",
    hint:"🐾 야옹 우는 그 동물이 헬멧 쓰고 저 위로 갔어요",
    need:[["고양이","냥","야옹","cat"],["우주","우주복","astronaut","space","스페이스"]],
    options:["우주복 입은 고양이","잠수복 입은 강아지","로봇 펭귄","우주비행사 곰"] },

  { img:"img/sushi-dragon.webp", answer:"초밥으로 만든 용",
    hint:"🍣 먹는 걸로 빚어낸 상상 속 동물",
    need:[["용","드래곤","dragon"],["초밥","스시","sushi","사시미","sashimi"]],
    options:["초밥으로 만든 용","케이크로 만든 성","도넛으로 만든 뱀","라면으로 만든 문어"] },

  { img:"img/neon-seoul.webp", answer:"네온 빛 사이버펑크 밤거리",
    hint:"🌃 비 젖은 밤, 네온사인 가득한 미래 도시",
    need:[["사이버펑크","cyberpunk","네온","neon","미래도시","야경","밤거리"]],
    options:["네온 빛 사이버펑크 밤거리","물속의 도시","우주 정거장 내부","사막 한가운데 도시"] },

  { img:"img/coffee-storm.webp", answer:"커피잔 속 바다 폭풍",
    hint:"☕ 작은 잔 안에서 🌊 가 몰아쳐요",
    need:[["커피","컵","잔","coffee","cup"],["바다","바닷","파도","ocean","sea","wave"]],
    options:["커피잔 속 바다 폭풍","유리병 속 은하수","어항 속 작은 숲","손바닥 위 화산"] },

  { img:"img/broccoli-town.webp", answer:"브로콜리 나무가 있는 마을",
    hint:"🥦 초록 채소가 나무처럼 서 있는 미니 동네",
    need:[["브로콜리","broccoli"],["마을","동네","집","village","town","house"]],
    options:["브로콜리 나무가 있는 마을","버섯으로 된 도시","사탕으로 만든 궁전","얼음으로 된 성"] },

  { img:"img/sky-whale.webp", answer:"하늘을 나는 고래",
    hint:"🐳 바다에 있어야 할 거대한 동물이 하늘에 둥둥",
    need:[["고래","whale"],["하늘","공중","날","풍선","sky","fly","float"]],
    options:["하늘을 나는 고래","바다 속 열기구","구름 위의 코끼리","날아다니는 잠수함"] },

  { img:"img/book-tree.webp", answer:"책으로 만든 나무",
    hint:"📚 읽는 것들이 잎사귀처럼 달린 나무",
    need:[["책","도서","book"],["나무","tree"]],
    options:["책으로 만든 나무","종이로 접은 숲","신문지로 지은 집","연필 정원"] },

  { img:"img/rain-robot.webp", answer:"우산 쓴 로봇",
    hint:"🤖 비 오는 날, 기계가 우산을 챙겼네요",
    need:[["로봇","기계","robot"],["우산","umbrella","비","rain"]],
    options:["우산 쓴 로봇","비 맞는 허수아비","우비 입은 강아지","우산 파는 고양이"] },

  { img:"img/watermelon-sea.webp", answer:"수박 속 바다",
    hint:"🍉 여름 과일을 갈랐더니 안에 파도가?",
    need:[["수박","watermelon"],["바다","파도","해변","ocean","sea","beach"]],
    options:["수박 속 바다","오렌지 속 사막","멜론 속 우주","사과 속 도시"] },

  { img:"img/candy-city.webp", answer:"사탕으로 만든 도시",
    hint:"🍬 알록달록 달달한 걸로 지은 빌딩숲",
    need:[["사탕","캔디","젤리","candy"],["도시","마을","빌딩","건물","city","town"]],
    options:["사탕으로 만든 도시","블록으로 쌓은 성","얼음 왕국","꽃밭 마을"] },

  { img:"img/origami-fox.webp", answer:"종이접기 여우",
    hint:"🦊 색종이를 접어서 만든 동물",
    need:[["여우","fox"],["종이","접","오리가미","origami","paper"]],
    options:["종이접기 여우","털실로 짠 늑대","나무 조각 고양이","점토 강아지"] },

  { img:"img/glass-deer.webp", answer:"유리로 된 사슴",
    hint:"🦌 투명하게 빛이 통과하는 사슴",
    need:[["사슴","deer"],["유리","크리스탈","크리스털","투명","glass","crystal"]],
    options:["유리로 된 사슴","얼음 토끼","금속 말","수정 늑대"] },

  { img:"img/burning-piano.webp", answer:"불타는 피아노",
    hint:"🔥🎹 건반 악기가 활활 타고 있어요",
    need:[["피아노","piano"],["불","화염","불타","타오","flame","fire","burning"]],
    options:["불타는 피아노","물에 잠긴 기타","얼어붙은 드럼","꽃이 핀 바이올린"] },

  { img:"img/cloud-sheep.webp", answer:"구름으로 만든 양",
    hint:"☁️🐑 뭉게뭉게 하늘에 뜬 폭신한 동물",
    need:[["양","sheep"],["구름","cloud"]],
    options:["구름으로 만든 양","솜사탕 강아지","눈사람 소","안개 고양이"] },

  { img:"img/donut-station.webp", answer:"도넛 모양 우주정거장",
    hint:"🍩🛰️ 우주에 떠 있는 고리 모양 구조물",
    need:[["도넛","donut","고리","링","ring"],["우주","정거장","스테이션","궤도","space","station"]],
    options:["도넛 모양 우주정거장","바퀴 모양 잠수함","반지 모양 등대","튜브 모양 비행선"] },

  { img:"img/moss-robot.webp", answer:"이끼로 뒤덮인 로봇",
    hint:"🤖🌿 숲에 버려져 식물이 뒤덮은 기계",
    need:[["로봇","기계","robot"],["이끼","식물","풀","넝쿨","숲","moss","plant"]],
    options:["이끼로 뒤덮인 로봇","녹슨 자동차","꽃 핀 갑옷","넝쿨 감긴 동상"] },

  { img:"img/crystal-dragon.webp", answer:"수정 동굴 속 용",
    hint:"💎🐉 반짝이는 광물 동굴에 사는 상상 동물",
    need:[["용","드래곤","dragon"],["수정","크리스탈","크리스털","보석","동굴","crystal","cave"]],
    options:["수정 동굴 속 용","용암 속 뱀","얼음 성의 곰","황금 사원의 호랑이"] },

  { img:"img/bottled-lightning.webp", answer:"병 속에 담긴 번개",
    hint:"⚡🫙 유리병 안에 갇힌 번개",
    need:[["번개","전기","라이트닝","lightning","electric"],["병","유리병","항아리","jar","bottle"]],
    options:["병 속에 담긴 번개","항아리 속 태양","컵 속 오로라","상자 속 별"] },

  { img:"img/mushroom-village.webp", answer:"버섯 집 마을",
    hint:"🍄 동화 속, 큰 버섯이 집이 된 동네",
    need:[["버섯","mushroom"],["집","마을","동네","house","village"]],
    options:["버섯 집 마을","호박 마을","조개껍데기 마을","벌집 도시"] },

  { img:"img/cat-cloud.webp", answer:"고양이 모양 구름",
    hint:"☁️🐱 하늘을 올려다보니 이 동물 모양",
    need:[["고양이","냥","cat"],["구름","cloud"]],
    options:["고양이 모양 구름","강아지 모양 연기","토끼 모양 안개","곰 모양 노을"] },

  { img:"img/droplet-galaxy.webp", answer:"물방울 속 은하수",
    hint:"💧🌌 작은 물방울 안에 우주가 통째로",
    need:[["물방울","이슬","방울","눈물","droplet","drop"],["은하","우주","별","갤럭시","성운","galaxy","universe","star"]],
    options:["물방울 속 은하수","비눗방울 속 도시","눈물 속 바다","이슬 속 숲"] },

  { img:"img/ice-swan.webp", answer:"얼음으로 조각한 백조",
    hint:"🦢🧊 차갑게 깎아 만든 우아한 새",
    need:[["백조","고니","swan"],["얼음","ice","얼린","조각"]],
    options:["얼음으로 조각한 백조","유리로 된 학","눈으로 만든 독수리","크리스탈 오리"] },

  { img:"img/flower-lion.webp", answer:"꽃으로 뒤덮인 사자",
    hint:"🌸🦁 갈기가 꽃밭인 밀림의 왕",
    need:[["사자","lion"],["꽃","플라워","flower"]],
    options:["꽃으로 뒤덮인 사자","나뭇잎으로 된 곰","깃털로 된 말","불꽃 갈기 늑대"] },

  { img:"img/octopus-band.webp", answer:"악기를 연주하는 문어",
    hint:"🐙🎷 다리 여러 개로 악기를 동시에",
    need:[["문어","옥토","octopus"],["악기","연주","음악","밴드","기타","드럼","트럼펫","music","instrument","band"]],
    options:["악기를 연주하는 문어","춤추는 불가사리","노래하는 조개","그림 그리는 게"] },

  { img:"img/clock-city.webp", answer:"시계 속 도시",
    hint:"🕰️⚙️ 톱니바퀴 사이에 지어진 작은 도시",
    need:[["시계","clock","톱니","기어","gear"],["도시","마을","city","town"]],
    options:["시계 속 도시","라디오 속 마을","전구 속 정원","자물쇠 속 성"] },

  { img:"img/paper-planes.webp", answer:"하늘을 나는 종이비행기 떼",
    hint:"✈️📄 접어서 날린 게 하늘을 가득 메움",
    need:[["종이","paper"],["비행기","plane","airplane"]],
    options:["하늘을 나는 종이비행기 떼","날아가는 새 떼","연 날리기 축제","풍선 무리"] },

  { img:"img/chocolate-waterfall.webp", answer:"초콜릿 폭포",
    hint:"🍫💧 갈색으로 쏟아지는 달콤한 폭포",
    need:[["초콜릿","초콜렛","chocolate"],["폭포","waterfall","강","분수"]],
    options:["초콜릿 폭포","용암 강","커피 분수","꿀 호수"] },

  { img:"img/neon-jellyfish.webp", answer:"빛나는 네온 해파리",
    hint:"🪼✨ 깊은 바다에서 형광으로 빛나는 생물",
    need:[["해파리","jellyfish"],["네온","빛","형광","야광","발광","neon","glow","light"]],
    options:["빛나는 네온 해파리","야광 문어","전기 뱀장어","빛나는 산호"] },

  { img:"img/lego-car.webp", answer:"레고로 만든 자동차",
    hint:"🧱🚗 알록달록 블록을 쌓아 만든 탈것",
    need:[["레고","블록","lego","brick"],["자동차","car"]],
    options:["레고로 만든 자동차","골판지 로켓","성냥개비 배","풍선 오토바이"] },

  { img:"img/kaiju-cat.webp", answer:"도시를 걷는 거대 고양이",
    hint:"🐱🏙️ 빌딩만 한 고양이가 도시를 어슬렁",
    need:[["고양이","냥","cat"],["거대","빌딩","도시","괴수","괴물","giant","city"]],
    options:["도시를 걷는 거대 고양이","하늘을 나는 강아지","바다 괴수","로봇 공룡"] }
];
