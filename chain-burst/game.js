(function () {
  'use strict';
  const E = window.ChainBurst, $ = id => document.getElementById(id);
  const canvas = $('arena'), ctx = canvas.getContext('2d');
  if (!ctx) { $('statusText').textContent = '이 브라우저에서는 게임 화면을 표시할 수 없어요.'; $('startBtn').disabled = true; return; }
  const GAME_ID = 'chain-burst';
  let W = E.WIDTH, H = E.HEIGHT;
  const COLORS = { cyan: '#84ebd9', gold: '#ffce7c', coral: '#ff927e' };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const pad = n => String(n).padStart(2, '0');
  const panels = ['introPanel', 'roundPanel', 'finishPanel', 'pausePanel'];
  let round = new E.Round(0), state = 'intro', paused = false, results = [];
  let particles = [], links = [], labels = [], shake = 0, messageUntil = 0, visualClock = 0;
  let pointer = { x: W / 2, y: H / 2, shown: false }, lastTime = 0, displayScore = 0;
  let lastAnnouncedSecond = -1, previousBest = 0, saved = false, audioCtx = null, lastSound = 0;
  let muted = false;
  try { muted = localStorage.getItem('gamelab:chain-burst:muted') === '1'; } catch (_) {}
  function stats() { return window.GameStats ? GameStats.get(GAME_ID) : { bestScore: 0, plays: 0 }; }
  function refreshStats() { const s = stats(); $('bestValue').textContent = fmt(s.bestScore); $('playsValue').textContent = fmt(s.plays); }
  function soundLabel() { $('soundBtn').textContent = muted ? '소리 꺼짐' : '소리 켜짐'; $('soundBtn').setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기'); $('soundBtn').setAttribute('aria-pressed', String(muted)); }
  function unlockAudio() {
    if (muted) return;
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
      if (!audioCtx) audioCtx = new Audio();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (_) {}
  }
  function tone(depth, gold, finish) {
    if (muted || !audioCtx || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    if (!finish && now - lastSound < 0.045) return;
    lastSound = now;
    try {
      const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain();
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const frequency = 220 * Math.pow(2, scale[Math.min(depth, 10)] / 12);
      oscillator.type = gold ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * (finish ? 1.5 : 0.98), now + 0.2);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(finish ? 0.055 : 0.032, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (finish ? 0.55 : 0.28));
      oscillator.connect(gain); gain.connect(audioCtx.destination); oscillator.start(now); oscillator.stop(now + 0.6);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch (_) {}
  }
  function showPanel(id, focus) {
    for (const name of panels) $(name).hidden = name !== id;
    if (focus) $(focus).focus({ preventScroll: true });
  }
  function setStatus(text) { if ($('statusText').textContent !== text) $('statusText').textContent = text; }
  function setText(id, text) { if ($(id).textContent !== text) $(id).textContent = text; }
  function clearEffects() { particles = []; links = []; labels = []; shake = 0; $('liveMessage').textContent = ''; messageUntil = 0; }
  function startGame() {
    unlockAudio(); results = []; saved = false; previousBest = stats().bestScore;
    displayScore = 0; newRound();
  }
  function newRound() {
    round = new E.Round(results.length, Math.random, W, H); state = 'playing'; paused = false; lastTime = performance.now();
    clearEffects(); pointer.shown = false; lastAnnouncedSecond = -1;
    $('roundValue').innerHTML = pad(results.length + 1) + ' <i>/ 03</i>';
    $('fieldLabel').textContent = ['FIND THE SPARK', 'BRIDGE THE DISTANCE', 'MAKE IT RIPPLE'][results.length];
    $('pauseBtn').disabled = false; showPanel(null); canvas.focus({ preventScroll: true });
    updateHUD();
  }
  function fire(x, y) {
    if (state !== 'playing' || paused) return;
    unlockAudio();
    if (round.fire(x, y)) { pointer.shown = false; processEvents(); updateHUD(); }
  }
  function togglePause(value) {
    if (state !== 'playing') return;
    paused = value;
    if (value) { showPanel('pausePanel', 'resumeBtn'); $('pauseBtn').textContent = '계속하기'; }
    else { unlockAudio(); showPanel(null); canvas.focus({ preventScroll: true }); $('pauseBtn').textContent = '일시정지'; lastTime = performance.now(); }
  }
  function burstEffects(e) {
    const color = e.gold ? COLORS.gold : COLORS.cyan;
    const count = reduced ? 3 : (e.gold ? 22 : 12);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, speed = 30 + Math.random() * (e.gold ? 160 : 100);
      particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.4 + Math.random() * 0.45, age: 0, color });
    }
    if (particles.length > 600) particles.splice(0, particles.length - 600);
    labels.push({ x: e.x, y: e.y - 12, text: '+' + e.points, age: 0, color });
    if (labels.length > 25) labels.shift();
    if (e.gold && !reduced) shake = 2.2;
    tone(e.depth, e.gold, false);
    if (e.depth >= 3 && e.depth === round.maxDepth) {
      $('liveMessage').textContent = e.depth >= 8 ? e.depth + '단계 · 멈출 수 없는 연쇄!' : e.depth + '단계 · 계속 이어지고 있어요';
      messageUntil = visualClock + 1.6;
    }
  }
  function processEvents() {
    for (const e of round.drainEvents()) {
      if (e.type === 'fire') { tone(0, false, false); if (!reduced) shake = 1.5; }
      if (e.type === 'link') links.push({ ...e, age: 0 });
      if (e.type === 'burst') burstEffects(e);
      if (e.type === 'done') endRound();
    }
  }
  function endRound() {
    if (state !== 'playing') return;
    state = 'between'; $('pauseBtn').disabled = true; $('pauseBtn').textContent = '일시정지';
    const result = round.result(); results.push(result); $('liveMessage').textContent = '';
    displayScore = results.reduce((s, r) => s + r.score, 0);
    if (results.length === 3) { finishGame(); return; }
    $('roundKicker').textContent = 'ROUND ' + pad(results.length) + ' COMPLETE';
    $('roundTitle').textContent = result.caught === 0 ? '다음 불씨를 찾아볼까요?' : result.depth >= 8 ? '하나의 탭이 여기까지.' : result.depth >= 4 ? '제대로 이어졌어요.' : '작은 불씨를 만들었어요.';
    $('roundScore').textContent = '+' + fmt(result.score);
    $('roundDetail').textContent = result.caught + ' / ' + result.total + '개 폭발 · 최장 ' + result.depth + '단계';
    $('roundTip').textContent = result.reason === 'missed' ? '8초가 지나 기회를 놓쳤어요. 다음에는 시간 안에 탭해 보세요.' : result.caught === 0 ? '빈 공간보다 빛알이 모여드는 자리를 노려보세요.' : result.depth < 4 ? '금빛 빛알을 끼워 넣으면 더 멀리 연결할 수 있어요.' : '다음 라운드에는 빛알이 더 많아집니다.';
    $('nextBtn').innerHTML = '라운드 ' + (results.length + 1) + ' 시작 <span aria-hidden="true">→</span>';
    showPanel('roundPanel', 'nextBtn'); tone(4, true, true);
  }
  function finishGame() {
    state = 'finished';
    const total = results.reduce((s, r) => s + r.score, 0);
    const caught = results.reduce((s, r) => s + r.caught, 0), maxDepth = Math.max(...results.map(r => r.depth));
    if (!saved) { saved = true; if (window.GameStats) GameStats.record(GAME_ID, { score: total }); }
    refreshStats();
    $('finishKicker').textContent = total > previousBest ? 'NEW PERSONAL BEST' : 'YOUR CHAIN REACTION';
    $('finishTitle').textContent = maxDepth >= 10 ? '당신이 만든 작은 빅뱅.' : maxDepth >= 5 ? '아름다운 연쇄였어요.' : total > 0 ? '다음엔 더 멀리, 더 크게.' : '다음 한 번을 기다리는 빛.';
    $('finalScore').textContent = fmt(total);
    $('finishDetail').textContent = '총 ' + caught + '개 폭발 · 최장 ' + maxDepth + '단계 연쇄';
    $('roundResults').replaceChildren();
    results.forEach((r, i) => {
      const card = document.createElement('div'); card.className = 'round-card';
      card.innerHTML = '<span>ROUND ' + pad(i + 1) + '</span><strong>' + fmt(r.score) + '</strong><small>' + (r.reason === 'missed' ? '시간 초과' : r.caught + '개 · ' + r.depth + '단계') + '</small>';
      $('roundResults').appendChild(card);
    });
    $('bestMessage').textContent = total > previousBest ? '내 최고 기록을 새로 썼어요. 다시 한 번 이어볼까요?' : '내 최고 ' + fmt(stats().bestScore) + '점 · 빛알의 배치는 매번 달라집니다.';
    showPanel('finishPanel', 'againBtn'); tone(7, true, true);
  }
  function updateHUD() {
    const base = results.reduce((s, r) => s + r.score, 0);
    const total = state === 'playing' ? base + round.score : base;
    displayScore += (total - displayScore) * 0.22;
    if (Math.abs(total - displayScore) < 1) displayScore = total;
    setText('scoreValue', fmt(displayScore));
    const chain = Math.max(round.maxDepth, 0, ...results.map(r => r.depth));
    if ($('chainValue').textContent !== chain + ' 단계') $('chainValue').innerHTML = chain + ' <i>단계</i>';
    setText('fieldCount', (round.orbs.length - round.caught) + ' LIGHTS');
    if (state !== 'playing') {
      $('shotLabel').classList.toggle('used', state !== 'intro');
      const shotText = state === 'intro' ? 'ONE TAP' : 'ROUND OVER';
      if ($('shotLabel').textContent !== shotText) $('shotLabel').innerHTML = '<i></i>' + shotText;
      setStatus(state === 'intro' ? '작은 시작이 큰 연쇄를 만듭니다.' : state === 'finished' ? '세 번의 불씨가 만든 나만의 기록.' : '잠시 감상하고, 다음 불씨를 준비하세요.');
      $('timerFill').style.transform = 'scaleX(' + (state === 'intro' ? 1 : 0) + ')';
      $('timerTrack').setAttribute('aria-valuenow', state === 'intro' ? '8' : '0');
      return;
    }
    const aiming = round.phase === 'aim';
    const remaining = Math.max(0, (aiming ? E.AIM_SECONDS : E.ROUND_SECONDS) - round.elapsed);
    $('timerFill').style.transform = 'scaleX(' + remaining / (aiming ? E.AIM_SECONDS : E.ROUND_SECONDS) + ')';
    $('timerTrack').classList.toggle('urgent', aiming && remaining <= 3);
    $('timerTrack').setAttribute('aria-label', aiming ? '조준 시간' : '라운드 남은 시간');
    $('timerTrack').setAttribute('aria-valuemax', aiming ? '8' : '20');
    $('timerTrack').setAttribute('aria-valuenow', String(Math.ceil(remaining)));
    $('shotLabel').classList.toggle('used', !aiming);
    if ($('shotLabel').textContent !== (aiming ? 'ONE TAP' : 'TAP USED')) $('shotLabel').innerHTML = '<i></i>' + (aiming ? 'ONE TAP' : 'TAP USED');
    if (aiming) {
      const sec = Math.ceil(remaining);
      if (sec !== lastAnnouncedSecond) { lastAnnouncedSecond = sec; setStatus('모이는 순간을 골라 탭하세요 · ' + sec + '초'); }
    } else setStatus('불씨를 보냈어요. 이제 연쇄를 지켜보세요.');
  }
  function circle(x, y, r, color, alpha = 1, line = 0) {
    if (r <= 0) return;
    ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (line) { ctx.strokeStyle = color; ctx.lineWidth = line; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  function draw() {
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0b151e'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#7cbec10b'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // Sparse crosshair markers anchor the field without external assets.
    ctx.strokeStyle = '#7cbec126';
    for (const x of [40, W - 40]) for (const y of [40, H - 40]) {
      ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
    }
    ctx.save();
    if (shake > 0 && !reduced) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    for (const blast of round.blasts) {
      const r = E.radius(blast), color = blast.gold ? COLORS.gold : blast.seed ? COLORS.coral : COLORS.cyan;
      const fade = Math.min(1, (blast.life - blast.age) * 2);
      circle(blast.x, blast.y, r, color, 0.055 * fade);
      circle(blast.x, blast.y, r, color, 0.55 * fade, 1.4);
      circle(blast.x, blast.y, r * 0.85, color, 0.12 * fade, 1);
      circle(blast.x, blast.y, 3, color, 0.8 * fade);
      if (blast.gold) { circle(blast.x, blast.y, r * 0.65, color, 0.18 * fade, 1); }
    }
    for (const link of links) {
      ctx.globalAlpha = Math.max(0, 1 - link.age / 0.38) * 0.65;
      ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(link.fromX, link.fromY); ctx.lineTo(link.x, link.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const orb of round.orbs) {
      if (orb.state === 'spent') continue;
      const primed = orb.state === 'primed', color = orb.gold ? COLORS.gold : COLORS.cyan;
      const pulse = 1 + Math.sin(visualClock * 2.5 + orb.id) * 0.08;
      circle(orb.x, orb.y, (orb.gold ? 15 : 11) * pulse, color, primed ? 0.24 : 0.06);
      if (orb.gold) {
        ctx.save(); ctx.translate(orb.x, orb.y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color; ctx.fillRect(-4.5, -4.5, 9, 9);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.38; ctx.strokeRect(-7.5, -7.5, 15, 15); ctx.restore();
      } else {
        ctx.strokeStyle = '#84ebd92b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(orb.x, orb.y); ctx.lineTo(orb.x - orb.vx * 0.13, orb.y - orb.vy * 0.13); ctx.stroke();
        circle(orb.x, orb.y, primed ? 7 : 4.2, primed ? '#f3fff9' : color, 0.95);
      }
      if (primed) circle(orb.x, orb.y, 11 + (0.16 - orb.fuse) * 30, color, 0.6, 1);
    }
    for (const p of particles) circle(p.x, p.y, 1.7 * (1 - p.age / p.life), p.color, Math.max(0, 1 - p.age / p.life));
    ctx.textAlign = 'center'; ctx.font = 'bold 14px Consolas, monospace';
    for (const label of labels) { ctx.globalAlpha = Math.max(0, 1 - label.age / 0.85); ctx.fillStyle = label.color; ctx.fillText(label.text, label.x, label.y - label.age * 30); }
    ctx.globalAlpha = 1;
    if (state === 'playing' && !paused && round.phase === 'aim' && pointer.shown) {
      circle(pointer.x, pointer.y, 59, COLORS.coral, 0.05);
      ctx.setLineDash([4, 5]); circle(pointer.x, pointer.y, 59, COLORS.coral, 0.65, 1); ctx.setLineDash([]);
      circle(pointer.x, pointer.y, 3, COLORS.coral, 1);
    }
    ctx.restore();
  }
  function animate(now) {
    const elapsed = Math.max(0, (now - (lastTime || now)) / 1000);
    const dt = Math.min(0.1, elapsed); lastTime = now;
    if (!paused && !document.hidden) {
      visualClock += dt;
      if (state === 'intro') { for (const orb of round.orbs) { orb.x += orb.vx * dt * 0.45; orb.y += orb.vy * dt * 0.45; if (orb.x < 12 || orb.x > W - 12) orb.vx *= -1; if (orb.y < 12 || orb.y > H - 12) orb.vy *= -1; } }
      // The round clock follows active real time, even on a slow renderer.
      if (state === 'playing') { round.update(elapsed); processEvents(); }
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt; }
      particles = particles.filter(p => p.age < p.life);
      for (const l of links) l.age += dt; links = links.filter(l => l.age < 0.38);
      for (const l of labels) l.age += dt; labels = labels.filter(l => l.age < 0.85);
      shake = Math.max(0, shake - dt * 10);
      if (messageUntil && visualClock > messageUntil) { $('liveMessage').textContent = ''; messageUntil = 0; }
      updateHUD(); draw();
    }
    requestAnimationFrame(animate);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    // Preserve playfield area/density, with round waves at every screen ratio.
    const area = E.WIDTH * E.HEIGHT, aspect = rect.width / rect.height;
    const nextW = Math.sqrt(area * aspect), nextH = Math.sqrt(area / aspect);
    const sx = nextW / W, sy = nextH / H;
    for (const item of [...round.orbs, ...round.blasts, ...particles, ...labels, ...links, pointer]) {
      item.x *= sx; item.y *= sy;
      if ('fromX' in item) { item.fromX *= sx; item.fromY *= sy; }
    }
    W = nextW; H = nextH; round.width = W; round.height = H;
    for (const orb of round.orbs) { orb.x = Math.max(12, Math.min(W - 12, orb.x)); orb.y = Math.max(12, Math.min(H - 12, orb.y)); }
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); draw();
  }
  function coordinates(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W, (event.clientX - rect.left) * W / rect.width)), y: Math.max(0, Math.min(H, (event.clientY - rect.top) * H / rect.height)) };
  }
  canvas.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') { pointer = { ...coordinates(event), shown: true }; } });
  canvas.addEventListener('pointerleave', () => { pointer.shown = false; });
  canvas.addEventListener('pointerdown', event => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); const p = coordinates(event); fire(p.x, p.y); });
  canvas.addEventListener('keydown', event => {
    if (state !== 'playing' || paused || round.phase !== 'aim') return;
    const moves = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
    if (moves[event.key]) { event.preventDefault(); pointer.shown = true; pointer.x = Math.max(0, Math.min(W, pointer.x + moves[event.key][0])); pointer.y = Math.max(0, Math.min(H, pointer.y + moves[event.key][1])); }
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); fire(pointer.x, pointer.y); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state === 'playing') { event.preventDefault(); togglePause(!paused); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(true); });
  $('startBtn').addEventListener('click', startGame); $('againBtn').addEventListener('click', startGame);
  $('nextBtn').addEventListener('click', () => { if (state === 'between') { unlockAudio(); newRound(); } });
  $('resumeBtn').addEventListener('click', () => togglePause(false)); $('pauseBtn').addEventListener('click', () => togglePause(!paused));
  $('soundBtn').addEventListener('click', () => { muted = !muted; try { localStorage.setItem('gamelab:chain-burst:muted', muted ? '1' : '0'); } catch (_) {} soundLabel(); if (!muted) { unlockAudio(); tone(2, true, false); } });
  $('shareBtn').addEventListener('click', () => {
    if (state !== 'finished' || !window.GameShare) return;
    const total = results.reduce((s, r) => s + r.score, 0), depth = Math.max(...results.map(r => r.depth));
    const rows = results.map((r, i) => pad(i + 1) + ' ' + '✦'.repeat(Math.min(5, Math.ceil(r.caught / r.total * 5))) + ' · ' + r.caught + '개 / ' + r.depth + '단계');
    GameShare.share({ text: '💥 연쇄 폭발 · ' + fmt(total) + '점\n' + rows.join('\n') + '\n한 번의 탭, 최장 ' + depth + '단계 연쇄!', url: 'https://junstellar.github.io/games/chain-burst/' });
  });
  window.addEventListener('resize', resize);
  soundLabel(); refreshStats(); resize(); requestAnimationFrame(animate);
})();
