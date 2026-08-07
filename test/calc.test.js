"use strict";

/*
 * Tests for the Shuttle Split cost maths.
 *
 * Run with `node --test` from the repo root. No dependencies, no build step.
 *
 * The rules being protected here are the ones that matter when real money
 * changes hands at the end of a club night:
 *   1. Everything splits by player-hours.
 *   2. A share is always rounded UP to the next 50c, never down, so the
 *      organiser is never left out of pocket.
 *   3. What gets pasted into the group chat matches what is on screen.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  round2,
  formatMoney,
  hourBuckets,
  sanitizeState,
  calcSession,
  summaryLines,
  DEFAULT_STATE
} = require("../costs/calc.js");

/**
 * Table-driven test, the equivalent of xUnit's [Theory] with [InlineData].
 * Each case supplies its own name so a failure points at the exact row.
 */
function theory(title, cases, run) {
  describe(title, () => {
    for (const c of cases) test(c.name, () => run(c));
  });
}

/** A session state, with a realistic club night as the starting point. */
function session(overrides) {
  return Object.assign(
    { hours: 3, courts: 2, rate: 21, shuttles: 0, sprice: 5, p1: 0, p2: 0, p3: 0 },
    overrides
  );
}

/** A session whose whole cost is a single figure, for exercising the maths. */
function costingExactly(dollars, players) {
  return session(Object.assign({ courts: 1, rate: 0, shuttles: 1, sprice: dollars }, players));
}

// ---------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------

theory("round2", [
  { name: "leaves whole cents alone", input: 16.5, expected: 16.5 },
  { name: "rounds half a cent up", input: 21.005, expected: 21.01 },
  { name: "rounds sub-cent noise away", input: 20.6659999, expected: 20.67 },
  { name: "clears binary float drift", input: 0.1 + 0.2, expected: 0.3 },
  { name: "handles zero", input: 0, expected: 0 }
], c => assert.equal(round2(c.input), c.expected));

theory("formatMoney", [
  { name: "pads to two decimals", input: 17, expected: "$17.00" },
  { name: "keeps cents", input: 16.29, expected: "$16.29" },
  { name: "shows a half step", input: 15.5, expected: "$15.50" },
  { name: "handles zero", input: 0, expected: "$0.00" }
], c => assert.equal(formatMoney(c.input), c.expected));

theory("hourBuckets", [
  { name: "a three hour session offers 3, 2 and 1", hours: 3, expected: [3, 2, 1] },
  { name: "a two hour session offers 2 and 1", hours: 2, expected: [2, 1] }
], c => assert.deepEqual(hourBuckets(c.hours), c.expected));

// ---------------------------------------------------------------------------
// Restoring saved state
// ---------------------------------------------------------------------------

theory("sanitizeState rejects junk", [
  { name: "null becomes the defaults", raw: null },
  { name: "undefined becomes the defaults", raw: undefined },
  { name: "a string becomes the defaults", raw: "not a session" },
  { name: "a number becomes the defaults", raw: 42 },
  { name: "an empty object becomes the defaults", raw: {} }
], c => assert.deepEqual(sanitizeState(c.raw), DEFAULT_STATE));

theory("sanitizeState field validation", [
  { name: "keeps a two hour session", raw: { hours: 2 }, field: "hours", expected: 2 },
  { name: "keeps a three hour session", raw: { hours: 3 }, field: "hours", expected: 3 },
  { name: "rejects an unsupported session length", raw: { hours: 4 }, field: "hours", expected: 3 },
  { name: "rejects a string session length", raw: { hours: "3" }, field: "hours", expected: 3 },

  { name: "keeps a sensible court count", raw: { courts: 4 }, field: "courts", expected: 4 },
  { name: "rejects zero courts", raw: { courts: 0 }, field: "courts", expected: 2 },
  { name: "rejects negative courts", raw: { courts: -3 }, field: "courts", expected: 2 },
  { name: "rejects fractional courts", raw: { courts: 2.5 }, field: "courts", expected: 2 },

  { name: "allows no shuttles", raw: { shuttles: 0 }, field: "shuttles", expected: 0 },
  { name: "allows a big shuttle count", raw: { shuttles: 47 }, field: "shuttles", expected: 47 },
  { name: "rejects negative shuttles", raw: { shuttles: -1 }, field: "shuttles", expected: 0 },

  { name: "keeps a player count", raw: { p3: 9 }, field: "p3", expected: 9 },
  { name: "rejects negative players", raw: { p2: -4 }, field: "p2", expected: 0 },
  { name: "rejects fractional players", raw: { p1: 1.5 }, field: "p1", expected: 0 },

  { name: "keeps a court rate", raw: { rate: 21 }, field: "rate", expected: 21 },
  { name: "snaps a rate to cents", raw: { rate: 21.005 }, field: "rate", expected: 21.01 },
  { name: "rejects a negative rate", raw: { rate: -21 }, field: "rate", expected: 0 },
  { name: "rejects a string rate", raw: { rate: "21" }, field: "rate", expected: 0 },
  { name: "rejects NaN", raw: { rate: NaN }, field: "rate", expected: 0 },
  { name: "rejects Infinity", raw: { rate: Infinity }, field: "rate", expected: 0 },
  { name: "keeps a shuttle price", raw: { sprice: 5 }, field: "sprice", expected: 5 }
], c => assert.equal(sanitizeState(c.raw)[c.field], c.expected));

test("sanitizeState ignores unknown keys", () => {
  const cleaned = sanitizeState({ hours: 3, nonsense: "x", __proto__: { evil: true } });
  assert.deepEqual(Object.keys(cleaned).sort(), Object.keys(DEFAULT_STATE).sort());
});

test("sanitizeState does not mutate the defaults", () => {
  const cleaned = sanitizeState({ courts: 4 });
  cleaned.courts = 99;
  assert.equal(DEFAULT_STATE.courts, 2);
});

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

theory("court and shuttle costs", [
  {
    name: "two courts for three hours at $21",
    state: session({ courts: 2, hours: 3, rate: 21 }),
    courtCost: 126, shuttleCost: 0, total: 126
  },
  {
    name: "one court for two hours at $23",
    state: session({ courts: 1, hours: 2, rate: 23 }),
    courtCost: 46, shuttleCost: 0, total: 46
  },
  {
    name: "eight shuttles at $5",
    state: session({ courts: 1, rate: 0, shuttles: 8, sprice: 5 }),
    courtCost: 0, shuttleCost: 40, total: 40
  },
  {
    name: "shuttles priced in odd cents stay exact",
    state: session({ courts: 1, rate: 0, shuttles: 3, sprice: 1.17 }),
    courtCost: 0, shuttleCost: 3.51, total: 3.51
  },
  {
    name: "courts and shuttles are pooled",
    state: session({ courts: 2, hours: 3, rate: 21, shuttles: 8, sprice: 5 }),
    courtCost: 126, shuttleCost: 40, total: 166
  },
  {
    name: "a free session costs nothing",
    state: session({ rate: 0, shuttles: 0 }),
    courtCost: 0, shuttleCost: 0, total: 0
  }
], c => {
  const r = calcSession(c.state);
  assert.equal(r.courtCost, c.courtCost, "court cost");
  assert.equal(r.shuttleCost, c.shuttleCost, "shuttle cost");
  assert.equal(r.total, c.total, "total");
  assert.equal(r.totalCents, Math.round(c.total * 100), "total in cents");
});

// ---------------------------------------------------------------------------
// Who played
// ---------------------------------------------------------------------------

theory("player hours", [
  { name: "nine full and three short", state: session({ p3: 9, p2: 3 }), players: 12, hours: 33 },
  { name: "seven full and three short", state: session({ p3: 7, p2: 3 }), players: 10, hours: 27 },
  { name: "a two hour session", state: session({ hours: 2, p2: 6, p1: 2 }), players: 8, hours: 14 },
  { name: "one lonely player", state: session({ p3: 1 }), players: 1, hours: 3 },
  { name: "nobody played", state: session({}), players: 0, hours: 0 }
], c => {
  const r = calcSession(c.state);
  assert.equal(r.playerCount, c.players, "player count");
  assert.equal(r.playerHours, c.hours, "player-hours");
});

test("buckets are ordered longest session first", () => {
  const r = calcSession(session({ p3: 2, p2: 3, p1: 4 }));
  assert.deepEqual(r.buckets.map(b => b.hours), [3, 2, 1]);
});

test("buckets with nobody in them are dropped", () => {
  const r = calcSession(session({ p3: 4, p2: 0, p1: 2 }));
  assert.deepEqual(r.buckets.map(b => b.hours), [3, 1]);
});

test("a two hour session has no three hour bucket", () => {
  const r = calcSession(session({ hours: 2, p3: 5, p2: 6, p1: 2 }));
  assert.deepEqual(r.buckets.map(b => b.hours), [2, 1]);
  assert.equal(r.playerHours, 14, "the stale p3 count is ignored");
});

// ---------------------------------------------------------------------------
// Share rounding: the part that decides what people actually hand over
// ---------------------------------------------------------------------------

theory("shares round up to the next 50c", [
  {
    name: "regression: a share a hair over a 50c step rounds up, it must not round down",
    state: costingExactly(198.05, { p1: 12 }),
    hours: 1, share: 17.0, exact: 16.5
  },
  {
    name: "regression: $49.51 across three players rounds up",
    state: session({ hours: 2, courts: 1, rate: 23, shuttles: 3, sprice: 1.17, p1: 3 }),
    hours: 1, share: 17.0, exact: 16.5
  },
  {
    name: "a share landing exactly on a 50c step is left alone",
    state: costingExactly(198.0, { p1: 12 }),
    hours: 1, share: 16.5, exact: 16.5
  },
  {
    name: "float drift does not push an exact step up",
    state: session({ courts: 1, rate: 0, shuttles: 3, sprice: 5.5, p1: 1 }),
    hours: 1, share: 16.5, exact: 16.5
  },
  {
    name: "a whole dollar share is left alone",
    state: costingExactly(60.0, { p3: 4 }),
    hours: 3, share: 15.0, exact: 15.0
  },
  {
    name: "one cent over a step still rounds a full step up",
    state: costingExactly(16.51, { p1: 1 }),
    hours: 1, share: 17.0, exact: 16.51
  },
  {
    name: "a cost of nothing costs nothing",
    state: session({ rate: 0, shuttles: 0, p3: 4 }),
    hours: 3, share: 0, exact: 0
  }
], c => {
  const r = calcSession(c.state);
  const bucket = r.buckets.find(b => b.hours === c.hours);
  assert.ok(bucket, `expected a ${c.hours}h bucket`);
  assert.equal(bucket.share, c.share, "rounded share");
  assert.equal(bucket.exact, c.exact, "exact share");
});

describe("rounding invariants", () => {
  // Enough combinations to cover every remainder against a range of squad
  // sizes, without turning the suite into a long-running job.
  const costsInCents = [];
  for (let cents = 1; cents <= 30000; cents += 7) costsInCents.push(cents);
  const squads = [1, 2, 3, 5, 7, 8, 10, 12, 17, 24, 29, 33];

  test("a share is never less than the exact amount owed", () => {
    for (const cents of costsInCents) {
      for (const ph of squads) {
        const r = calcSession(costingExactly(cents / 100, { p1: ph }));
        const trueShare = r.totalCents / ph / 100;
        const share = r.buckets[0].share;
        assert.ok(share >= trueShare - 1e-9, `${cents}c over ${ph}: ${share} < ${trueShare}`);
      }
    }
  });

  test("a share never overshoots by a whole 50c step", () => {
    for (const cents of costsInCents) {
      for (const ph of squads) {
        const r = calcSession(costingExactly(cents / 100, { p1: ph }));
        const trueShare = r.totalCents / ph / 100;
        const share = r.buckets[0].share;
        assert.ok(share - trueShare < 0.5, `${cents}c over ${ph} overshot: ${share} vs ${trueShare}`);
      }
    }
  });

  test("every share is a whole number of 50c steps", () => {
    for (const cents of costsInCents) {
      for (const ph of squads) {
        const share = calcSession(costingExactly(cents / 100, { p1: ph })).buckets[0].share;
        assert.equal(Math.round(share * 100) % 50, 0, `${share} is not a 50c step`);
      }
    }
  });

  test("the pot always covers the cost, so the organiser is never short", () => {
    for (const cents of costsInCents) {
      for (const ph of squads) {
        const r = calcSession(costingExactly(cents / 100, { p1: ph }));
        assert.ok(r.collected >= r.total, `${cents}c over ${ph}: collected ${r.collected} < ${r.total}`);
        assert.ok(r.roundingDifference >= 0, `negative rounding difference ${r.roundingDifference}`);
      }
    }
  });

  test("collected always equals the shares people are told to pay", () => {
    for (const cents of costsInCents) {
      const r = calcSession(session({ courts: 1, rate: 0, shuttles: 1, sprice: cents / 100, p3: 9, p2: 3, p1: 2 }));
      const summed = r.buckets.reduce((a, b) => a + b.share * b.count, 0);
      assert.equal(round2(summed), round2(r.collected));
    }
  });

  test("playing longer never costs less", () => {
    for (const cents of costsInCents) {
      const r = calcSession(session({ courts: 1, rate: 0, shuttles: 1, sprice: cents / 100, p3: 4, p2: 4, p1: 4 }));
      const [three, two, one] = r.buckets.map(b => b.share);
      assert.ok(three >= two && two >= one, `${cents}c produced ${three}/${two}/${one}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Whole club nights, end to end
// ---------------------------------------------------------------------------

theory("real club nights", [
  {
    name: "the usual night: 12 players, 2 courts, 3 hours, 8 shuttles",
    state: session({ hours: 3, courts: 2, rate: 21, shuttles: 8, sprice: 5, p3: 9, p2: 3 }),
    expected: {
      courtCost: 126, shuttleCost: 40, total: 166,
      playerCount: 12, playerHours: 33,
      buckets: [
        { hours: 3, count: 9, share: 15.5, exact: 15.09 },
        { hours: 2, count: 3, share: 10.5, exact: 10.06 }
      ],
      collected: 171, roundingDifference: 5
    }
  },
  {
    name: "a thin last hour: 10 players, 2 courts, 3 hours, 10 shuttles",
    state: session({ hours: 3, courts: 2, rate: 21, shuttles: 10, sprice: 5, p3: 7, p2: 3 }),
    expected: {
      courtCost: 126, shuttleCost: 50, total: 176,
      playerCount: 10, playerHours: 27,
      buckets: [
        { hours: 3, count: 7, share: 20, exact: 19.56 },
        { hours: 2, count: 3, share: 13.5, exact: 13.04 }
      ],
      collected: 180.5, roundingDifference: 4.5
    }
  },
  {
    name: "a short night: 8 players, 2 courts, 2 hours, 6 shuttles",
    state: session({ hours: 2, courts: 2, rate: 21, shuttles: 6, sprice: 5, p2: 6, p1: 2 }),
    expected: {
      courtCost: 84, shuttleCost: 30, total: 114,
      playerCount: 8, playerHours: 14,
      buckets: [
        { hours: 2, count: 6, share: 16.5, exact: 16.29 },
        { hours: 1, count: 2, share: 8.5, exact: 8.14 }
      ],
      collected: 116, roundingDifference: 2
    }
  },
  {
    name: "everyone stays the whole time and it divides evenly",
    state: session({ hours: 3, courts: 1, rate: 20, shuttles: 0, sprice: 5, p3: 4 }),
    expected: {
      courtCost: 60, shuttleCost: 0, total: 60,
      playerCount: 4, playerHours: 12,
      buckets: [{ hours: 3, count: 4, share: 15, exact: 15 }],
      collected: 60, roundingDifference: 0
    }
  }
], c => {
  const r = calcSession(c.state);
  const e = c.expected;
  assert.equal(r.courtCost, e.courtCost, "court cost");
  assert.equal(r.shuttleCost, e.shuttleCost, "shuttle cost");
  assert.equal(r.total, e.total, "total");
  assert.equal(r.playerCount, e.playerCount, "player count");
  assert.equal(r.playerHours, e.playerHours, "player-hours");
  assert.deepEqual(r.buckets, e.buckets, "per-bucket shares");
  assert.equal(r.collected, e.collected, "collected");
  assert.equal(r.roundingDifference, e.roundingDifference, "rounding difference");
  // The promise the screen makes: rounding never leaves the organiser short.
  assert.ok(r.collected >= r.total);
});

test("the per-hour rate is the total spread over player-hours", () => {
  const r = calcSession(session({ courts: 2, hours: 3, rate: 21, shuttles: 8, sprice: 5, p3: 9, p2: 3 }));
  assert.equal(round2(r.ratePerHour), 5.03);
  assert.equal(round2(r.ratePerHour * r.playerHours), r.total);
});

// ---------------------------------------------------------------------------
// The message pasted into the group chat
// ---------------------------------------------------------------------------

describe("summaryLines", () => {
  const night = calcSession(session({ courts: 2, hours: 3, rate: 21, shuttles: 8, sprice: 5, p3: 9, p2: 3 }));

  test("reads as the date then what each group owes", () => {
    assert.deepEqual(summaryLines(night, "Thu 7 Aug"), [
      "Badminton Thu 7 Aug",
      "3h: $15.50 each (×9)",
      "2h: $10.50 each (×3)"
    ]);
  });

  test("carries no total, since rounded shares would not add up to it", () => {
    const body = summaryLines(night, "Thu 7 Aug").join("\n");
    assert.ok(!/total/i.test(body), "the message must not mention a total");
    assert.equal(body.match(/\$/g).length, night.buckets.length, "one amount per group, nothing more");
  });

  test("quotes the same amounts the screen shows", () => {
    const lines = summaryLines(night, "Thu 7 Aug").slice(1);
    night.buckets.forEach((b, i) => {
      assert.ok(lines[i].includes(formatMoney(b.share)), `line ${i} should quote ${formatMoney(b.share)}`);
    });
  });

  test("lists the longest session first", () => {
    const lines = summaryLines(calcSession(session({ p3: 2, p2: 3, p1: 4 })), "Thu 7 Aug");
    assert.deepEqual(lines.slice(1).map(l => l.slice(0, 2)), ["3h", "2h", "1h"]);
  });

  test("says nothing when nobody has played", () => {
    assert.deepEqual(summaryLines(calcSession(session({})), "Thu 7 Aug"), []);
    assert.deepEqual(summaryLines(null, "Thu 7 Aug"), []);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("guards", () => {
  test("a session with no players divides by nothing", () => {
    const r = calcSession(session({ shuttles: 8, p3: 0, p2: 0, p1: 0 }));
    assert.equal(r.playerHours, 0);
    assert.equal(r.ratePerHour, 0);
    assert.equal(r.collected, 0);
    assert.equal(r.roundingDifference, 0);
    assert.deepEqual(r.buckets, []);
    assert.ok(Number.isFinite(r.total));
  });

  test("calcSession copes with no state at all", () => {
    const r = calcSession(undefined);
    assert.equal(r.total, 0);
    assert.deepEqual(r.buckets, []);
  });

  test("restored junk still calculates", () => {
    const r = calcSession(sanitizeState({ courts: -5, rate: "free", p3: 2.5, shuttles: 3, sprice: 5 }));
    assert.equal(r.courtCost, 0, "a rejected rate means no court cost");
    assert.equal(r.shuttleCost, 15);
    assert.deepEqual(r.buckets, [], "a fractional player count is dropped");
  });

  test("no share is ever NaN", () => {
    for (const state of [session({}), session({ rate: 0, shuttles: 0, p3: 3 }), sanitizeState(null)]) {
      const r = calcSession(state);
      for (const b of r.buckets) {
        assert.ok(Number.isFinite(b.share) && Number.isFinite(b.exact), "share must be a real number");
      }
      assert.ok(Number.isFinite(r.total) && Number.isFinite(r.collected));
    }
  });
});
