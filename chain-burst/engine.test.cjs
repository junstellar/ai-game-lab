const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Round, seeded, radius, ROUND_SECONDS } = require('./engine.js');

function fixture(points) {
  const r = new Round(0, seeded(7));
  r.orbs = points.map((p, id) => ({ id, x: p[0], y: p[1], gold: !!p[2],
    vx: 0, vy: 0, state: 'live', depth: 0, fuse: 0 }));
  return r;
}
function complete(r) { for (let i = 0; i < 2400 && r.phase !== 'done'; i++) r.update(1 / 120); }
test('one tap propagates across multiple generations and scores each orb once', () => {
  const r = fixture([[130, 200], [194, 200], [258, 200], [650, 460]]);
  assert.equal(r.fire(80, 200), true);
  assert.equal(r.fire(650, 460), false);
  complete(r);
  assert.equal(r.caught, 3); assert.equal(r.maxDepth, 3);
  assert.equal(r.score, 100 + 140 + 180);
  r.update(20); assert.equal(r.score, 420);
});
test('gold relays bridge a gap a normal orb cannot reach', () => {
  const normal = fixture([[130, 200], [210, 200]]);
  const gold = fixture([[130, 200, true], [210, 200]]);
  normal.fire(80, 200); gold.fire(80, 200); complete(normal); complete(gold);
  assert.equal(normal.caught, 1); assert.equal(gold.caught, 2);
});
test('missing the aiming window costs the shot, with no automatic explosion', () => {
  const r = new Round(0, seeded(1)); r.update(8);
  assert.equal(r.reason, 'missed'); assert.equal(r.score, 0);
  assert.equal(r.fire(100, 100), false); assert.equal(r.blasts.length, 0);
});
test('an empty shot ends cleanly and awards no points', () => {
  const r = fixture([[650, 460]]); r.fire(60, 60); complete(r);
  assert.equal(r.reason, 'settled'); assert.equal(r.score, 0);
});
test('simulation gives identical results at 2, 30, 60 and 120 fps', () => {
  const results = [2, 30, 60, 120].map(fps => {
    const r = new Round(2, seeded(20)); r.fire(360, 260);
    while (r.phase !== 'done') r.update(1 / fps);
    return r.result();
  });
  results.slice(1).forEach(result => assert.deepEqual(results[0], result));
});
test('every random round stays bounded and finishes inside its time budget', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const r = new Round(seed % 3, seeded(seed)); r.update(7.8); r.fire(360, 260); complete(r);
    assert.equal(r.phase, 'done'); assert.ok(r.elapsed <= ROUND_SECONDS + 1e-7);
    assert.ok(r.caught <= r.orbs.length); assert.ok(r.score >= 0);
    assert.ok(r.orbs.every(p => p.x >= 12 && p.x <= 708 && p.y >= 12 && p.y <= 508));
  }
});
test('invalid inputs cannot poison simulation state', () => {
  const r = new Round(0, seeded(1));
  assert.equal(r.fire(NaN, 0), false); r.update(NaN); r.update(-1);
  assert.equal(r.elapsed, 0); assert.equal(radius({ age: 2, life: 1, maxRadius: 40 }), 0);
});
test('portrait playfields retain their bounds and finish with the same rules', () => {
  const width = 600, height = 624;
  const r = new Round(1, seeded(5), width, height);
  r.update(4); r.fire(width / 2, height / 2); complete(r);
  assert.equal(r.phase, 'done'); assert.ok(r.elapsed <= ROUND_SECONDS + 1e-7);
  assert.ok(r.orbs.every(p => p.x >= 12 && p.x <= width - 12 && p.y >= 12 && p.y <= height - 12));
});
