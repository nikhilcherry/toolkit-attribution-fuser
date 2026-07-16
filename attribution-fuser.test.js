import { AttributionFuser } from './attribution-fuser.js';

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} condition
 * @param {string} [detail]
 */
function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok - ${name}`);
  } else {
    failed++;
    console.log(`  FAIL - ${name}${detail ? `: ${detail}` : ''}`);
  }
}

function approx(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

function test(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ---------------------------------------------------------------------

test('single clear speaker across a window', () => {
  const fuser = new AttributionFuser();
  for (let t = 0; t < 1000; t += 100) {
    fuser.record(t, new Map([['a', 0.01], ['b', 0.0001]]), true);
  }
  const result = fuser.attribute(0, 900);
  assert('speaker is "a"', result.speaker === 'a', `got ${result.speaker}`);
  assert(
    'confidence near 1',
    approx(result.confidence, 1),
    `got ${result.confidence}`
  );
});

test('two faces with close energies within dominanceRatio -> multiple', () => {
  const fuser = new AttributionFuser({ dominanceRatio: 1.7 });
  for (let t = 0; t < 1000; t += 100) {
    fuser.record(t, new Map([['a', 0.01], ['b', 0.009]]), true);
  }
  const result = fuser.attribute(0, 900);
  assert(
    'speaker is "multiple"',
    result.speaker === 'multiple',
    `got ${result.speaker}`
  );
  assert(
    'confidence near 1 (all frames agree)',
    approx(result.confidence, 1),
    `got ${result.confidence}`
  );
});

test('vadActive false for entire window -> unknown, confidence 0', () => {
  const fuser = new AttributionFuser();
  for (let t = 0; t < 1000; t += 100) {
    fuser.record(t, new Map([['a', 0.01]]), false);
  }
  const result = fuser.attribute(0, 900);
  assert('speaker is "unknown"', result.speaker === 'unknown', `got ${result.speaker}`);
  assert('confidence is 0', result.confidence === 0, `got ${result.confidence}`);
});

test('speaker switches mid-window (60/40 split) -> majority, confidence ~0.6', () => {
  const fuser = new AttributionFuser();
  // 10 frames total: 6 for 'a', 4 for 'b'
  for (let t = 0; t < 600; t += 100) {
    fuser.record(t, new Map([['a', 0.01], ['b', 0.0001]]), true);
  }
  for (let t = 600; t < 1000; t += 100) {
    fuser.record(t, new Map([['a', 0.0001], ['b', 0.01]]), true);
  }
  const result = fuser.attribute(0, 900);
  assert('speaker is "a"', result.speaker === 'a', `got ${result.speaker}`);
  assert(
    'confidence approx 0.6',
    approx(result.confidence, 0.6),
    `got ${result.confidence}`
  );
});

test('vad on but all energies below minEnergy -> unknown', () => {
  const fuser = new AttributionFuser({ minEnergy: 0.00004 });
  for (let t = 0; t < 500; t += 100) {
    fuser.record(t, new Map([['a', 0.00001], ['b', 0.00002]]), true);
  }
  const result = fuser.attribute(0, 400);
  assert('speaker is "unknown"', result.speaker === 'unknown', `got ${result.speaker}`);
});

test('pruning: records older than historyMs are gone', () => {
  const fuser = new AttributionFuser({ historyMs: 1000 });
  fuser.record(0, new Map([['a', 0.01]]), true);
  fuser.record(100, new Map([['a', 0.01]]), true);
  // advance far beyond historyMs so the early frames get pruned
  fuser.record(5000, new Map([['a', 0.01]]), true);
  const result = fuser.attribute(0, 100);
  assert(
    'old range now unknown after pruning',
    result.speaker === 'unknown' && result.confidence === 0,
    `got ${JSON.stringify(result)}`
  );
});

test('faces appearing/disappearing between frames does not crash or misattribute', () => {
  const fuser = new AttributionFuser();
  assert(
    'record with empty map does not throw',
    (() => {
      try {
        fuser.record(0, new Map(), true);
        return true;
      } catch {
        return false;
      }
    })()
  );
  fuser.record(100, new Map([['a', 0.01]]), true);
  fuser.record(200, new Map([['a', 0.01], ['b', 0.0001], ['c', 0.0002]]), true);
  fuser.record(300, new Map([['b', 0.01]]), true);
  const result = fuser.attribute(0, 300);
  assert(
    'produces a valid result shape',
    typeof result.speaker !== 'undefined' && typeof result.confidence === 'number',
    `got ${JSON.stringify(result)}`
  );
  // frame 0 (empty map) -> unknown, frame 100 -> a, frame 200 -> a, frame 300 -> b
  // tally: unknown=1, a=2, b=1 -> majority "a"
  assert('majority speaker is "a"', result.speaker === 'a', `got ${result.speaker}`);
});

test("exact tie between two speakers' vote counts -> multiple", () => {
  const fuser = new AttributionFuser();
  fuser.record(0, new Map([['a', 0.01], ['b', 0.0001]]), true);
  fuser.record(100, new Map([['b', 0.01], ['a', 0.0001]]), true);
  const result = fuser.attribute(0, 100);
  assert(
    'tie resolves to "multiple"',
    result.speaker === 'multiple',
    `got ${result.speaker}`
  );
});

test('instantWinner reflects the latest recorded frame', () => {
  const fuser = new AttributionFuser();
  fuser.record(0, new Map([['a', 0.01]]), true);
  fuser.record(100, new Map([['b', 0.01]]), true);
  const live = fuser.instantWinner();
  assert('instantWinner is "b"', live.speaker === 'b', `got ${live.speaker}`);
  assert('confidence is 1', live.confidence === 1, `got ${live.confidence}`);
});

test('instantWinner returns unknown when latest frame is unvoiced', () => {
  const fuser = new AttributionFuser();
  fuser.record(0, new Map([['a', 0.01]]), true);
  fuser.record(100, new Map([['a', 0.01]]), false);
  const live = fuser.instantWinner();
  assert('speaker is "unknown"', live.speaker === 'unknown', `got ${live.speaker}`);
  assert('confidence is 0', live.confidence === 0, `got ${live.confidence}`);
});

test('instantWinner with no frames recorded -> unknown', () => {
  const fuser = new AttributionFuser();
  const live = fuser.instantWinner();
  assert('speaker is "unknown"', live.speaker === 'unknown', `got ${live.speaker}`);
  assert('confidence is 0', live.confidence === 0, `got ${live.confidence}`);
});

test('zero voiced frames in window -> unknown, confidence 0', () => {
  const fuser = new AttributionFuser();
  fuser.record(0, new Map([['a', 0.01]]), true);
  const result = fuser.attribute(5000, 6000);
  assert('speaker is "unknown"', result.speaker === 'unknown', `got ${result.speaker}`);
  assert('confidence is 0', result.confidence === 0, `got ${result.confidence}`);
});

test('record() with a non-Map energiesMap does not throw and votes unknown', () => {
  const fuser = new AttributionFuser();
  // e.g. a caller accidentally passing a plain object or undefined instead
  // of the Map the API documents.
  assert('record(plain object) does not throw', (() => {
    try { fuser.record(0, { a: 0.5 }, true); return true; } catch { return false; }
  })());
  assert('record(undefined) does not throw', (() => {
    try { fuser.record(100, undefined, true); return true; } catch { return false; }
  })());
  const result = fuser.attribute(0, 100);
  assert('speaker is "unknown" (no real energies were ever recorded)', result.speaker === 'unknown', `got ${result.speaker}`);
});

test('dominanceRatio boundary: top exactly runnerUp * dominanceRatio counts as an outright win', () => {
  // topEnergy >= runnerUpEnergy * dominanceRatio uses >=, so an exact
  // boundary match must win outright, not fall through to "multiple".
  const fuser = new AttributionFuser({ dominanceRatio: 2 });
  fuser.record(0, new Map([['a', 0.02], ['b', 0.01]]), true); // 0.02 === 0.01 * 2 exactly
  const result = fuser.attribute(0, 0);
  assert('speaker is "a" at the exact dominance boundary', result.speaker === 'a', `got ${result.speaker}`);
});

test('minEnergy boundary: energy exactly at the floor is NOT unknown', () => {
  // topEnergy < minEnergy returns unknown, so an exact match at the floor
  // must still count as speaking.
  const fuser = new AttributionFuser({ minEnergy: 0.01 });
  fuser.record(0, new Map([['a', 0.01]]), true);
  const result = fuser.attribute(0, 0);
  assert('speaker is "a" at the exact minEnergy floor', result.speaker === 'a', `got ${result.speaker}`);
});

test('a tie between a real speaker and an "unknown" vote resolves to multiple', () => {
  // computeFrameVote can itself return the string 'unknown' for a voiced
  // frame (everyone below minEnergy) or 'multiple' (close energies) --
  // those are valid votes in the majority count, not just faceIds, and a
  // tie against one of them must still resolve via the same "ties ->
  // multiple" rule as a tie between two faceIds.
  const fuser = new AttributionFuser({ minEnergy: 0.01 });
  fuser.record(0, new Map([['a', 0.02]]), true); // clear winner: 'a'
  fuser.record(100, new Map([['a', 0.001]]), true); // below floor: 'unknown'
  const result = fuser.attribute(0, 100);
  assert('speaker is "multiple" on an a/unknown tie', result.speaker === 'multiple', `got ${result.speaker}`);
});

test('reset() clears history but keeps configuration', () => {
  const fuser = new AttributionFuser({ minEnergy: 0.01 });
  for (let t = 0; t < 500; t += 100) {
    fuser.record(t, new Map([['a', 0.02]]), true);
  }
  fuser.reset();
  const result = fuser.attribute(0, 500);
  assert('speaker is "unknown" after reset', result.speaker === 'unknown', `got ${result.speaker}`);
  assert('confidence is 0 after reset', result.confidence === 0);
  assert('minEnergy option survives reset', fuser.minEnergy === 0.01);
  // The fuser is still usable after a reset.
  fuser.record(1000, new Map([['b', 0.02]]), true);
  assert('records again after reset', fuser.attribute(1000, 1000).speaker === 'b');
});

test('record() ignores non-finite timestamps instead of poisoning history', () => {
  const fuser = new AttributionFuser();
  fuser.record(0, new Map([['a', 0.01]]), true);
  fuser.record(NaN, new Map([['b', 0.01]]), true);
  fuser.record(Infinity, new Map([['b', 0.01]]), true);
  fuser.record(100, new Map([['a', 0.01]]), true);
  const result = fuser.attribute(0, 100);
  assert('speaker is "a" (bad-timestamp frames dropped)', result.speaker === 'a', `got ${result.speaker}`);
  assert('confidence is 1', approx(result.confidence, 1));
});

// ---------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
