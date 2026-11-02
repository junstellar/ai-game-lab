/* Chain Burst: deterministic simulation, shared by the browser and balance checks. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChainBurst = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 720, HEIGHT = 520, AIM_SECONDS = 8, ROUND_SECONDS = 20;
  const STEP = 1 / 120;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
      n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }
  function radius(blast) {
    const t = blast.age / blast.life;
    if (t >= 1) return 0;
    if (t < 0.2) return blast.maxRadius * Math.sin(t / 0.2 * Math.PI / 2);
    if (t < 0.55) return blast.maxRadius;
    return blast.maxRadius * (1 - (t - 0.55) / 0.45);
  }
  class Round {
    constructor(index, rng = Math.random, width = WIDTH, height = HEIGHT) {
      this.index = clamp(index, 0, 2);
      this.width = width; this.height = height;
      this.rng = rng;
      this.phase = 'aim'; this.elapsed = 0; this.carry = 0;
      this.score = 0; this.caught = 0; this.maxDepth = 0;
      this.blasts = []; this.events = []; this.reason = '';
      this.orbs = Array.from({ length: 40 + this.index * 8 }, (_, id) => {
        const angle = rng() * Math.PI * 2, speed = 30 + rng() * 36 + this.index * 4;
        return { id, x: 22 + rng() * (this.width - 44), y: 22 + rng() * (this.height - 44),
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          gold: id % 9 === 4, state: 'live', depth: 0, fuse: 0 };
      });
    }
    fire(x, y) {
      if (this.phase !== 'aim' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      this.phase = 'cascade';
      this.blasts.push({ x: clamp(x, 0, this.width), y: clamp(y, 0, this.height),
        age: 0, life: 1.65, maxRadius: 59, depth: 0, gold: false, seed: true });
      this.events.push({ type: 'fire', x: clamp(x, 0, this.width), y: clamp(y, 0, this.height) });
      return true;
    }
    finish(reason) {
      if (this.phase === 'done') return;
      this.phase = 'done'; this.reason = reason;
      this.events.push({ type: 'done', reason });
    }
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0 || this.phase === 'done') return;
      this.carry += Math.min(dt, ROUND_SECONDS);
      while (this.carry + 1e-9 >= STEP && this.phase !== 'done') {
        this.tick(STEP); this.carry = Math.max(0, this.carry - STEP);
      }
    }
    tick(dt) {
      this.elapsed += dt;
      if (this.elapsed + 1e-8 >= ROUND_SECONDS) { this.finish('time'); return; }
      if (this.phase === 'aim' && this.elapsed + 1e-8 >= AIM_SECONDS) {
        this.finish('missed'); return;
      }
      for (const orb of this.orbs) {
        if (orb.state === 'live') {
          orb.x += orb.vx * dt; orb.y += orb.vy * dt;
          if (orb.x < 12 || orb.x > this.width - 12) {
            orb.x = clamp(orb.x, 12, this.width - 12); orb.vx *= -1;
          }
          if (orb.y < 12 || orb.y > this.height - 12) {
            orb.y = clamp(orb.y, 12, this.height - 12); orb.vy *= -1;
          }
        } else if (orb.state === 'primed') {
          orb.fuse -= dt;
          if (orb.fuse <= 0) this.explode(orb);
        }
      }
      for (const blast of this.blasts) blast.age += dt;
      this.blasts = this.blasts.filter(blast => blast.age < blast.life);
      if (this.phase !== 'cascade') return;
      for (const orb of this.orbs) {
        if (orb.state !== 'live') continue;
        // An orb belongs to the first wave that reaches it, never scores twice.
        for (const blast of this.blasts) {
          if (Math.hypot(orb.x - blast.x, orb.y - blast.y) <= radius(blast) + 5) {
            orb.state = 'primed'; orb.depth = blast.depth + 1; orb.fuse = 0.16;
            this.events.push({ type: 'link', x: orb.x, y: orb.y, fromX: blast.x, fromY: blast.y });
            break;
          }
        }
      }
      if (!this.blasts.length && !this.orbs.some(orb => orb.state === 'primed')) this.finish('settled');
    }
    explode(orb) {
      orb.state = 'spent'; this.caught++;
      this.maxDepth = Math.max(this.maxDepth, orb.depth);
      const points = (orb.gold ? 180 : 100) + (Math.min(orb.depth, 8) - 1) * 40;
      this.score += points;
      this.blasts.push({ x: orb.x, y: orb.y, age: 0,
        life: orb.gold ? 2.3 : 2.1, maxRadius: orb.gold ? 90 : 60 + this.index,
        depth: orb.depth, gold: orb.gold, seed: false });
      this.events.push({ type: 'burst', x: orb.x, y: orb.y, gold: orb.gold, depth: orb.depth, points });
    }
    drainEvents() { return this.events.splice(0); }
    result() { return { score: this.score, caught: this.caught, total: this.orbs.length,
      depth: this.maxDepth, elapsed: this.elapsed, reason: this.reason }; }
  }
  return { Round, seeded, radius, WIDTH, HEIGHT, AIM_SECONDS, ROUND_SECONDS };
});
