'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../tournament/engine.js');
const minute = 60000, now = 10000000;
const event = () => ({ current: 0, rounds: [{}, {}, {}], config: { game: 5, change: 1, duration: 20 }, startedAt: now, timer: null });
test('finish estimate includes all games and only intervening changeovers', () => {
  assert.deepEqual(E.finishEstimate(event(), now), { finish: now + 17 * minute, deadline: now + 20 * minute, overrun: 0 });
});
test('waiting and pausing move the estimate beyond the original budget', () => {
  const s = event();
  assert.equal(E.finishEstimate(s, now + 5 * minute).overrun, 2 * minute);
  s.timer = { remaining: 2 * minute, end: null };
  assert.equal(E.finishEstimate(s, now + 8 * minute).finish, now + 22 * minute);
});
test('a running timer keeps a stable finish estimate, with overdue scoring extending it', () => {
  const s = event(); s.timer = { end: now + 5 * minute };
  assert.equal(E.finishEstimate(s, now + minute).finish, now + 17 * minute);
  assert.equal(E.finishEstimate(s, now + 7 * minute).finish, now + 19 * minute);
});
test('changeover counts only the time still left before the next start', () => {
  const s = event(); s.current = 1; s.readyAt = now + minute;
  assert.equal(E.finishEstimate(s, now).finish, now + 12 * minute);
  assert.equal(E.finishEstimate(s, now + 2 * minute).finish, now + 13 * minute);
  s.current = 3; assert.equal(E.finishEstimate(s, now), null);
});
test('older backups can estimate a finish without inventing a booking deadline', () => {
  const s = event(); delete s.startedAt;
  assert.equal(E.finishEstimate(s, now).deadline, null);
});
