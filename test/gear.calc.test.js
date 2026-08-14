"use strict";

/*
 * Tests for the Racket Ready date maths.
 *
 * Run with `node --test` from the repo root. No dependencies, no build step.
 *
 * The rules being protected:
 *   1. Ages and intervals are whole days between ISO dates, computed in UTC,
 *      so timezones and daylight saving can never shift a due date.
 *   2. Due is a hard boundary: the day age reaches the expected life. The
 *      app exists to stop money being spent before that day.
 *   3. Strings and grips are independent chains per racket. A regrip never
 *      splits a string interval, and rackets never see each other's events.
 *   4. Prefill copies habits (string, tension, stringer, cost), never the
 *      note, which describes a single event.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_LIFE,
  days,
  formatMoney,
  isIsoDate,
  daysBetween,
  formatDate,
  ageLabel,
  leftLabel,
  sanitizeState,
  status,
  history,
  prefill,
  detailsLine,
  summarize
} = require("../gear/calc.js");

/**
 * Table-driven test, the equivalent of xUnit's [Theory] with [InlineData].
 * Each case supplies its own name so a failure points at the exact row.
 */
function theory(title, cases, run) {
  describe(title, () => {
    for (const c of cases) test(c.name, () => run(c));
  });
}

/** Every scenario is pinned to this day, so nothing depends on the clock. */
const TODAY = "2026-08-14";

function daysAgo(n) {
  const t = Date.parse(TODAY + "T00:00:00Z") - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** A state with the default two rackets and the given events. */
function state(events, life) {
  return sanitizeState({ events, life });
}

function restring(n, extra) {
  return Object.assign({ racketId: "r1", type: "strings", date: daysAgo(n) }, extra);
}
function regrip(n, extra) {
  return Object.assign({ racketId: "r1", type: "grip", date: daysAgo(n) }, extra);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

theory("daysBetween", [
  { name: "the same day is zero", from: "2026-08-14", to: "2026-08-14", expected: 0 },
  { name: "the next day is one", from: "2026-08-13", to: "2026-08-14", expected: 1 },
  { name: "crosses a month boundary", from: "2026-07-31", to: "2026-08-01", expected: 1 },
  { name: "crosses a year boundary", from: "2025-12-31", to: "2026-01-01", expected: 1 },
  { name: "counts the leap day in a leap year", from: "2024-02-28", to: "2024-03-01", expected: 2 },
  { name: "no leap day in an ordinary year", from: "2025-02-28", to: "2025-03-01", expected: 1 },
  { name: "four weeks is 28 days", from: "2026-07-17", to: "2026-08-14", expected: 28 },
  { name: "a reversed pair goes negative", from: "2026-08-14", to: "2026-08-13", expected: -1 }
], c => assert.equal(daysBetween(c.from, c.to), c.expected));

theory("isIsoDate", [
  { name: "accepts a real date", input: "2026-08-14", expected: true },
  { name: "accepts a leap day", input: "2024-02-29", expected: true },
  { name: "rejects a leap day outside a leap year", input: "2025-02-29", expected: false },
  { name: "rejects a day that rolls over", input: "2026-02-31", expected: false },
  { name: "rejects a thirteenth month", input: "2026-13-01", expected: false },
  { name: "rejects slashes", input: "14/08/2026", expected: false },
  { name: "rejects unpadded parts", input: "2026-8-14", expected: false },
  { name: "rejects a number", input: 20260814, expected: false },
  { name: "rejects null", input: null, expected: false }
], c => assert.equal(isIsoDate(c.input), c.expected));

theory("formatDate", [
  { name: "an August date", input: "2026-08-14", expected: "14 Aug 2026" },
  { name: "a single digit day is not padded", input: "2026-01-01", expected: "1 Jan 2026" },
  { name: "the end of a year", input: "2025-12-31", expected: "31 Dec 2025" }
], c => assert.equal(formatDate(c.input), c.expected));

theory("days pluralizes", [
  { name: "zero", input: 0, expected: "0 days" },
  { name: "one", input: 1, expected: "1 day" },
  { name: "many", input: 28, expected: "28 days" }
], c => assert.equal(days(c.input), c.expected));

theory("ageLabel", [
  { name: "zero days is today", input: 0, expected: "today" },
  { name: "one day is yesterday", input: 1, expected: "yesterday" },
  { name: "otherwise counts days", input: 13, expected: "13 days ago" }
], c => assert.equal(ageLabel(c.input), c.expected));

theory("leftLabel", [
  { name: "days remaining", input: 15, expected: "15 days left" },
  { name: "one day remaining", input: 1, expected: "1 day left" },
  { name: "the boundary day is due", input: 0, expected: "Due today" },
  { name: "one day past", input: -1, expected: "1 day overdue" },
  { name: "well past", input: -13, expected: "13 days overdue" }
], c => assert.equal(leftLabel(c.input), c.expected));

theory("formatMoney", [
  { name: "pads to two decimals", input: 25, expected: "$25.00" },
  { name: "keeps cents", input: 7.5, expected: "$7.50" }
], c => assert.equal(formatMoney(c.input), c.expected));

// ---------------------------------------------------------------------------
// Restoring saved state
// ---------------------------------------------------------------------------

const DEFAULTS = {
  rackets: [{ id: "r1", name: "Racket 1" }, { id: "r2", name: "Racket 2" }],
  events: [],
  life: { strings: 28, grip: 28 }
};

theory("sanitizeState rejects junk", [
  { name: "null becomes the defaults", raw: null },
  { name: "undefined becomes the defaults", raw: undefined },
  { name: "a string becomes the defaults", raw: "not a state" },
  { name: "a number becomes the defaults", raw: 42 },
  { name: "an empty object becomes the defaults", raw: {} }
], c => assert.deepEqual(sanitizeState(c.raw), DEFAULTS));

describe("sanitizeState rackets", () => {
  test("keeps renamed rackets", () => {
    const s = sanitizeState({ rackets: [{ id: "r1", name: "Astrox" }, { id: "r2", name: "Nanoflare" }] });
    assert.deepEqual(s.rackets.map(r => r.name), ["Astrox", "Nanoflare"]);
  });

  test("trims names", () => {
    const s = sanitizeState({ rackets: [{ id: "r1", name: "  Astrox  " }] });
    assert.equal(s.rackets[0].name, "Astrox");
  });

  test("drops a racket without a name and falls back to defaults when none survive", () => {
    const s = sanitizeState({ rackets: [{ id: "r1" }, { name: "ghost" }, "junk"] });
    assert.deepEqual(s.rackets, DEFAULTS.rackets);
  });

  test("dedupes racket ids, keeping the first", () => {
    const s = sanitizeState({ rackets: [{ id: "r1", name: "First" }, { id: "r1", name: "Second" }] });
    assert.deepEqual(s.rackets, [{ id: "r1", name: "First" }]);
  });
});

theory("sanitizeState expected life", [
  { name: "keeps a custom life", life: { strings: 21 }, field: "strings", expected: 21 },
  { name: "rejects zero", life: { strings: 0 }, field: "strings", expected: 28 },
  { name: "rejects negatives", life: { grip: -7 }, field: "grip", expected: 28 },
  { name: "rejects fractions", life: { strings: 2.5 }, field: "strings", expected: 28 },
  { name: "rejects strings", life: { strings: "28" }, field: "strings", expected: 28 },
  { name: "rejects a silly horizon", life: { grip: 9999 }, field: "grip", expected: 28 }
], c => assert.equal(sanitizeState({ life: c.life }).life[c.field], c.expected));

describe("sanitizeState events", () => {
  test("drops events that cannot be trusted", () => {
    const s = state([
      restring(1),
      { racketId: "r1", type: "shoes", date: daysAgo(1) },
      { racketId: "r9", type: "strings", date: daysAgo(1) },
      restring(1, { date: "2026-02-31" }),
      "junk",
      null
    ]);
    assert.equal(s.events.length, 1);
  });

  test("trims detail fields and the note", () => {
    const s = state([restring(1, { string: "  BG65 ", note: "  felt dead early " })]);
    assert.equal(s.events[0].string, "BG65");
    assert.equal(s.events[0].note, "felt dead early");
  });

  test("caps a runaway note", () => {
    const s = state([restring(1, { note: "x".repeat(600) })]);
    assert.equal(s.events[0].note.length, 500);
  });

  test("snaps a cost to cents and rejects rubbish costs", () => {
    const s = state([
      restring(3, { cost: 24.999 }),
      restring(2, { cost: -5 }),
      restring(1, { cost: "25" })
    ]);
    assert.deepEqual(s.events.map(e => e.cost), [25, null, null]);
  });

  test("a grip event does not carry string fields", () => {
    const s = state([regrip(1, { brand: "Karakal", tension: "24 lbs" })]);
    assert.equal(s.events[0].brand, "Karakal");
    assert.equal("tension" in s.events[0], false);
  });

  test("assigns missing ids and reassigns duplicates so deletes stay precise", () => {
    const s = state([restring(2, { id: "a" }), restring(1, { id: "a" }), restring(0)]);
    const ids = s.events.map(e => e.id);
    assert.equal(new Set(ids).size, 3);
    assert.equal(ids[0], "a");
  });

  test("shrugs off a prototype pollution attempt", () => {
    const hostile = JSON.parse('{"life":{"strings":21},"__proto__":{"pwned":true}}');
    const s = sanitizeState(hostile);
    assert.equal(s.life.strings, 21);
    assert.equal({}.pwned, undefined, "Object.prototype must not be polluted");
  });
});

// ---------------------------------------------------------------------------
// Status: the headline glance
// ---------------------------------------------------------------------------

describe("status", () => {
  test("nothing logged means no status", () => {
    assert.equal(status(state([]), "r1", "strings", TODAY), null);
  });

  test("counts age and days left against the expected life", () => {
    const st = status(state([restring(13)]), "r1", "strings", TODAY);
    assert.equal(st.ageDays, 13);
    assert.equal(st.leftDays, 15);
    assert.equal(st.due, false);
  });

  test("the day age reaches the expected life is due, not one day later", () => {
    const st = status(state([restring(28)]), "r1", "strings", TODAY);
    assert.equal(st.leftDays, 0);
    assert.equal(st.due, true);
  });

  test("overdue keeps counting", () => {
    const st = status(state([restring(30)]), "r1", "strings", TODAY);
    assert.equal(st.leftDays, -2);
    assert.equal(st.due, true);
  });

  test("a custom expected life moves the boundary", () => {
    const st = status(state([restring(21)], { strings: 21 }), "r1", "strings", TODAY);
    assert.equal(st.due, true);
  });

  test("only the newest event counts", () => {
    const st = status(state([restring(41), restring(13)]), "r1", "strings", TODAY);
    assert.equal(st.ageDays, 13);
  });

  test("of two events on the same day, the one logged last wins", () => {
    const st = status(state([restring(5, { string: "first" }), restring(5, { string: "second" })]),
      "r1", "strings", TODAY);
    assert.equal(st.event.string, "second");
  });

  test("a future-dated event counts as age zero, not negative", () => {
    const st = status(state([restring(-3)]), "r1", "strings", TODAY);
    assert.equal(st.ageDays, 0);
    assert.equal(st.leftDays, 28);
  });

  test("another racket's restrings do not count", () => {
    assert.equal(status(state([restring(13)]), "r2", "strings", TODAY), null);
  });

  test("a regrip does not restring anything", () => {
    assert.equal(status(state([regrip(13)]), "r1", "strings", TODAY), null);
  });
});

// ---------------------------------------------------------------------------
// History: how long each set actually lasted
// ---------------------------------------------------------------------------

describe("history", () => {
  const h = history(state([restring(41), restring(13), regrip(3)]), "r1", TODAY);

  test("lists newest first across both types", () => {
    assert.deepEqual(h.map(x => [x.type, x.event.date]), [
      ["grip", daysAgo(3)],
      ["strings", daysAgo(13)],
      ["strings", daysAgo(41)]
    ]);
  });

  test("a replaced set knows how long it lasted", () => {
    const replaced = h[2];
    assert.equal(replaced.current, false);
    assert.equal(replaced.lastedDays, 28);
    assert.equal(replaced.soFarDays, null);
  });

  test("the set still in use counts days so far instead", () => {
    const current = h[1];
    assert.equal(current.current, true);
    assert.equal(current.lastedDays, null);
    assert.equal(current.soFarDays, 13);
  });

  test("a regrip in between does not split a string interval", () => {
    const withGrip = history(state([restring(41), regrip(20), restring(13)]), "r1", TODAY);
    const replaced = withGrip.find(x => x.type === "strings" && !x.current);
    assert.equal(replaced.lastedDays, 28);
  });

  test("rackets never see each other's events", () => {
    assert.deepEqual(history(state([restring(13)]), "r2", TODAY), []);
  });
});

// ---------------------------------------------------------------------------
// Prefill: the two-tap repeat entry
// ---------------------------------------------------------------------------

describe("prefill", () => {
  const habits = { string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets", cost: 25 };

  test("with no events, everything starts blank", () => {
    assert.deepEqual(prefill(state([]), "r1", "strings"),
      { cost: null, string: "", tension: "", color: "", stringer: "" });
  });

  test("copies the previous event's details and cost", () => {
    const p = prefill(state([restring(13, habits)]), "r1", "strings");
    assert.deepEqual(p, { cost: 25, string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets" });
  });

  test("uses the newest event when there are several", () => {
    const p = prefill(state([restring(41, { string: "old" }), restring(13, { string: "new" })]), "r1", "strings");
    assert.equal(p.string, "new");
  });

  test("never carries the note over", () => {
    const p = prefill(state([restring(13, { note: "felt dead early" })]), "r1", "strings");
    assert.equal("note" in p, false);
  });

  test("a grip prefill offers only grip fields", () => {
    const p = prefill(state([regrip(3, { brand: "Karakal PU", cost: 6 })]), "r1", "grip");
    assert.deepEqual(p, { cost: 6, brand: "Karakal PU" });
  });
});

// ---------------------------------------------------------------------------
// The detail line under each history entry
// ---------------------------------------------------------------------------

theory("detailsLine", [
  {
    name: "joins every recorded detail with the cost last",
    event: restring(1, { string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets", cost: 25 }),
    expected: "BG65 · 24 lbs · white · Straight Sets · $25.00"
  },
  {
    name: "skips blanks",
    event: restring(1, { tension: "24 lbs" }),
    expected: "24 lbs"
  },
  {
    name: "a cost alone still shows",
    event: restring(1, { cost: 25 }),
    expected: "$25.00"
  },
  {
    name: "nothing recorded means an empty line",
    event: restring(1),
    expected: ""
  },
  {
    name: "a grip shows its brand and cost",
    event: regrip(1, { brand: "Karakal PU", cost: 6 }),
    expected: "Karakal PU · $6.00"
  }
], c => assert.equal(detailsLine(state([c.event]).events[0]), c.expected));

// ---------------------------------------------------------------------------
// The whole rotation, end to end
// ---------------------------------------------------------------------------

describe("summarize: a two racket rotation", () => {
  // Racket 1 was restrung 41 and 13 days ago and regripped 3 days ago.
  // Racket 2 was restrung 30 days ago and is overdue for the swap.
  const view = summarize(state([
    restring(41, { string: "BG65", cost: 25 }),
    restring(13, { string: "BG65", cost: 25 }),
    regrip(3, { brand: "Karakal PU" }),
    { racketId: "r2", type: "strings", date: daysAgo(30), note: "felt dead early" }
  ]), TODAY);

  test("covers both rackets by name", () => {
    assert.deepEqual(view.rackets.map(r => r.name), ["Racket 1", "Racket 2"]);
  });

  test("racket 1 has springy strings and a fresh grip", () => {
    const [r1] = view.rackets;
    assert.equal(r1.strings.ageDays, 13);
    assert.equal(r1.strings.leftDays, 15);
    assert.equal(r1.strings.due, false);
    assert.equal(r1.grip.ageDays, 3);
  });

  test("racket 2 is past its four weeks and due", () => {
    const r2 = view.rackets[1];
    assert.equal(r2.strings.due, true);
    assert.equal(r2.strings.leftDays, -2);
  });

  test("the replaced set on racket 1 lasted 28 days", () => {
    const replaced = view.rackets[0].history.find(x => x.type === "strings" && !x.current);
    assert.equal(replaced.lastedDays, 28);
  });

  test("the note survives to be asked about later", () => {
    assert.equal(view.rackets[1].history[0].event.note, "felt dead early");
  });

  test("hands back a copy of the life settings, not the originals", () => {
    const s = state([]);
    const v = summarize(s, TODAY);
    v.life.strings = 99;
    assert.equal(s.life.strings, DEFAULT_LIFE.strings);
  });
});
