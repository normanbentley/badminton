/*
 * Racket Ready date maths.
 *
 * Pure: no DOM, no storage, no clock. "Today" always arrives as an argument,
 * so a test can pin it and the answers never depend on when the suite runs.
 * The page loads this with a plain script tag and the test suite requires it
 * directly in Node. Keep it free of all three.
 */
"use strict";

// Wrapped so the page gets exactly one global, RacketReady. Top-level
// declarations in a plain script are global, and would collide with the
// page's own names.
const RacketReady = (function () {

const TYPES = Object.freeze(["strings", "grip"]);

// How long each item is budgeted to last, in days. The app exists to notice
// when something dies before this, or is due for replacement after it.
const DEFAULT_LIFE = Object.freeze({ strings: 28, grip: 28 });

const DEFAULT_RACKETS = Object.freeze([
  Object.freeze({ id: "r1", name: "Racket 1" }),
  Object.freeze({ id: "r2", name: "Racket 2" })
]);

// The free-text detail fields each event type carries. These are the "why did
// it die early" suspects, and they prefill from the previous event.
const DETAIL_FIELDS = Object.freeze({
  strings: Object.freeze(["string", "tension", "color", "stringer"]),
  grip: Object.freeze(["brand"])
});

const VERBS = Object.freeze({ strings: "Restrung", grip: "Regripped" });

const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

const MS_PER_DAY = 86400000;
const round2 = n => Math.round(n * 100) / 100;
const formatMoney = n => "$" + n.toFixed(2);
const days = n => n + " day" + (n === 1 ? "" : "s");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// True only for a real calendar date in YYYY-MM-DD form. The round trip
// rejects days that roll over, like 2026-02-31 becoming the 3rd of March.
function isIsoDate(v) {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

// Whole days from one ISO date to another. Computed in UTC so a daylight
// saving change can never make a restring look a day older or younger.
function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / MS_PER_DAY);
}

// "2026-08-14" reads as "14 Aug 2026". Hand-rolled so the output never
// depends on the browser's locale, which the page tests assert against.
function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return d + " " + MONTHS[m - 1] + " " + y;
}

function ageLabel(ageDays) {
  if (ageDays === 0) return "today";
  if (ageDays === 1) return "yesterday";
  return days(ageDays) + " ago";
}

function leftLabel(leftDays) {
  if (leftDays > 0) return days(leftDays) + " left";
  if (leftDays === 0) return "Due today";
  return days(-leftDays) + " overdue";
}

function cleanText(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 80) : "";
}

// A cost is optional: dollars as a number, or null when not recorded.
function toCost(v) {
  return typeof v === "number" && isFinite(v) && v >= 0 ? round2(v) : null;
}

/*
 * Takes anything (parsed localStorage, a hand-edited blob) and returns a
 * state object that is safe to calculate with: known rackets, valid dated
 * events in their original order, and sensible expected-life settings.
 */
function sanitizeState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const s = { rackets: [], events: [], life: Object.assign({}, DEFAULT_LIFE) };

  for (const r of Array.isArray(src.rackets) ? src.rackets : []) {
    if (!r || typeof r !== "object") continue;
    const id = cleanText(r.id);
    const name = cleanText(r.name, 40);
    if (id && name && !s.rackets.some(x => x.id === id)) s.rackets.push({ id, name });
  }
  if (!s.rackets.length) s.rackets = DEFAULT_RACKETS.map(r => ({ id: r.id, name: r.name }));

  const rawLife = src.life && typeof src.life === "object" ? src.life : {};
  for (const t of TYPES) {
    if (Number.isInteger(rawLife[t]) && rawLife[t] >= 1 && rawLife[t] <= 3650) s.life[t] = rawLife[t];
  }

  // Ids must be unique or deleting one entry could take an unrelated one
  // with it, so colliding or missing ids are reassigned.
  const usedIds = new Set();
  let seq = 0;
  for (const e of Array.isArray(src.events) ? src.events : []) {
    if (!e || typeof e !== "object") continue;
    if (!TYPES.includes(e.type) || !isIsoDate(e.date)) continue;
    if (!s.rackets.some(r => r.id === e.racketId)) continue;
    let id = cleanText(e.id);
    while (!id || usedIds.has(id)) id = "e" + ++seq;
    usedIds.add(id);
    const clean = {
      id,
      racketId: e.racketId,
      type: e.type,
      date: e.date,
      cost: toCost(e.cost),
      note: cleanText(e.note, 500)
    };
    for (const f of DETAIL_FIELDS[e.type]) clean[f] = cleanText(e[f]);
    s.events.push(clean);
  }
  return s;
}

// A racket's events of one type, oldest first. Array order breaks date ties,
// so of two entries on the same day the one logged last counts as newest.
function eventsFor(events, racketId, type) {
  return events
    .filter(e => e.racketId === racketId && e.type === type)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/*
 * The headline for one item on one racket: how old the current strings or
 * grip are, and how that compares with how long they are expected to last.
 * Null when nothing has been logged yet. A future-dated event is one waiting
 * to enter play, like a restring sitting at the shop until pickup day: it
 * carries startsInDays and counts as age zero until that day arrives.
 */
function status(state, racketId, type, todayISO) {
  const list = eventsFor(state.events, racketId, type);
  if (!list.length) return null;
  const event = list[list.length - 1];
  const rawAge = daysBetween(event.date, todayISO);
  const ageDays = Math.max(0, rawAge);
  const leftDays = state.life[type] - ageDays;
  return {
    event,
    ageDays,
    leftDays,
    due: leftDays <= 0,
    startsInDays: rawAge < 0 ? -rawAge : null
  };
}

/*
 * A racket's full log, newest first. Each replaced entry knows how long it
 * lasted (the gap to the event that replaced it); the entry still in use
 * carries how many days it has done so far instead. Strings and grip are
 * independent chains: a regrip never splits a string interval.
 */
function history(state, racketId, todayISO) {
  const out = [];
  for (const type of TYPES) {
    const list = eventsFor(state.events, racketId, type);
    list.forEach((event, i) => {
      const current = i === list.length - 1;
      const rawSoFar = current ? daysBetween(event.date, todayISO) : null;
      out.push({
        event,
        type,
        current,
        lastedDays: current ? null : daysBetween(event.date, list[i + 1].date),
        soFarDays: current ? Math.max(0, rawSoFar) : null,
        startsInDays: current && rawSoFar < 0 ? -rawSoFar : null
      });
    });
  }
  return out.sort((a, b) => (a.event.date < b.event.date ? 1 : a.event.date > b.event.date ? -1 : 0));
}

/*
 * What the log form starts out holding: the previous event's details, so the
 * usual "same string, same tension, same stringer" case is two taps. The
 * note is deliberately not carried over: it describes one event, not a habit.
 */
function prefill(state, racketId, type) {
  const list = eventsFor(state.events, racketId, type);
  const last = list.length ? list[list.length - 1] : null;
  const out = { cost: last ? last.cost : null };
  for (const f of DETAIL_FIELDS[type]) out[f] = last ? last[f] : "";
  return out;
}

// One line summing up an event's details, e.g. "BG65 · 24 lbs · white · $25.00".
function detailsLine(event) {
  const parts = DETAIL_FIELDS[event.type].map(f => event[f]).filter(Boolean);
  if (typeof event.cost === "number") parts.push(formatMoney(event.cost));
  return parts.join(" · ");
}

// Everything the page needs to paint, derived in one place.
function summarize(state, todayISO) {
  return {
    life: Object.assign({}, state.life),
    rackets: state.rackets.map(r => ({
      id: r.id,
      name: r.name,
      strings: status(state, r.id, "strings", todayISO),
      grip: status(state, r.id, "grip", todayISO),
      history: history(state, r.id, todayISO)
    }))
  };
}

return {
  TYPES,
  DEFAULT_LIFE,
  DETAIL_FIELDS,
  VERBS,
  round2,
  formatMoney,
  days,
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
};

})();

// Browsers ignore this; Node uses it to require the module in tests.
if (typeof module !== "undefined") module.exports = RacketReady;
