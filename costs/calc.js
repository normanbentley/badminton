/*
 * Shuttle Split cost maths.
 *
 * Pure: no DOM, no storage, no clock. The page loads this with a plain script
 * tag and the test suite requires it directly in Node, so the money logic can
 * be exercised without a browser. Keep it free of both.
 */
"use strict";

// Wrapped so the page gets exactly one global, ShuttleSplit. Top-level
// declarations in a plain script are global, and would collide with the
// page's own names.
const ShuttleSplit = (function () {

// Shares are rounded up to whole 50 cent steps.
const STEP_CENTS = 50;

const round2 = n => Math.round(n * 100) / 100;
const formatMoney = n => "$" + n.toFixed(2);

const DEFAULT_STATE = { hours: 3, courts: 2, rate: 0, shuttles: 0, sprice: 0, p1: 0, p2: 0, p3: 0 };

// Whole-number fields, and the lowest value each may hold.
const COUNT_MINIMUMS = { courts: 1, shuttles: 0, p1: 0, p2: 0, p3: 0 };

// The hour buckets a session offers, longest first.
function hourBuckets(sessionHours) {
  return sessionHours === 3 ? [3, 2, 1] : [2, 1];
}

function toMoney(v) {
  return typeof v === "number" && isFinite(v) && v >= 0 ? round2(v) : 0;
}

// Takes anything (parsed localStorage, a hand-edited blob) and returns a state
// object that is safe to calculate with.
function sanitizeState(raw) {
  const s = Object.assign({}, DEFAULT_STATE);
  if (!raw || typeof raw !== "object") return s;
  if (raw.hours === 2 || raw.hours === 3) s.hours = raw.hours;
  for (const key of Object.keys(COUNT_MINIMUMS)) {
    const v = raw[key];
    s[key] = Number.isInteger(v) && v >= COUNT_MINIMUMS[key] ? v : DEFAULT_STATE[key];
  }
  s.rate = toMoney(raw.rate);
  s.sprice = toMoney(raw.sprice);
  return s;
}

/*
 * Work out what each group of players owes.
 *
 * Courts and shuttles are pooled into one cost and split by player-hours, so
 * someone who stayed twice as long pays twice as much. Buckets come back
 * longest session first, each carrying the rounded share people actually pay
 * and the unrounded share for anyone checking the maths.
 */
function calcSession(state) {
  const s = state || DEFAULT_STATE;
  const courtCost = round2(s.courts * s.hours * s.rate);
  const shuttleCost = round2(s.shuttles * s.sprice);
  // These are real prices, so snap to whole cents before dividing anything.
  const totalCents = Math.round(courtCost * 100) + Math.round(shuttleCost * 100);

  const present = hourBuckets(s.hours)
    .map(hours => ({ hours, count: s["p" + hours] || 0 }))
    .filter(b => b.count > 0);

  const playerHours = present.reduce((a, b) => a + b.hours * b.count, 0);
  const playerCount = present.reduce((a, b) => a + b.count, 0);

  // Ceiling in integer cents. The quotient is rational with denominator
  // playerHours * STEP_CENTS, so Math.ceil is exact here and a share can only
  // ever round up, never down.
  const shareFor = hours =>
    playerHours ? Math.ceil(totalCents * hours / (playerHours * STEP_CENTS)) * STEP_CENTS / 100 : 0;
  const exactFor = hours =>
    playerHours ? round2(totalCents * hours / playerHours / 100) : 0;

  const buckets = present.map(b => ({
    hours: b.hours,
    count: b.count,
    share: shareFor(b.hours),
    exact: exactFor(b.hours)
  }));

  const collected = buckets.reduce((a, b) => a + b.share * b.count, 0);

  return {
    courtCost,
    shuttleCost,
    totalCents,
    total: totalCents / 100,
    buckets,
    playerHours,
    playerCount,
    ratePerHour: playerHours ? totalCents / 100 / playerHours : 0,
    collected,
    // Only meaningful once somebody has played; without players nothing is
    // being collected, so report no difference rather than the whole cost.
    roundingDifference: playerHours ? round2(collected - totalCents / 100) : 0
  };
}

/*
 * The lines pasted into the group chat: the date, then what each group owes.
 * Deliberately carries no total, because rounded shares add up to more than
 * the session cost and a mismatched total reads like someone skimming.
 */
function summaryLines(session, dateLabel) {
  if (!session || !session.buckets.length) return [];
  const lines = ["Badminton " + dateLabel];
  for (const b of session.buckets) {
    lines.push(`${b.hours}h: ${formatMoney(b.share)} each (×${b.count})`);
  }
  return lines;
}

return {
  STEP_CENTS,
  DEFAULT_STATE,
  COUNT_MINIMUMS,
  round2,
  formatMoney,
  hourBuckets,
  sanitizeState,
  calcSession,
  summaryLines
};

})();

// Browsers ignore this; Node uses it to require the module in tests.
if (typeof module !== "undefined") module.exports = ShuttleSplit;
