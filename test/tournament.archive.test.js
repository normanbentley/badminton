'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../tournament/engine.js');
function event() {
  const players = E.parsePlayers('Alex\nSam\nCharlie\nHarper');
  const config = { courts: 1, courtNumbers: [5], duration: 15, game: 5, change: 0 };
  return { version: 1, players, config, ...E.schedule(players, config), current: 0, timer: null, drafts: {}, startedAt: 1000 };
}
test('archiving snapshots results without mutating the active event or older copies', () => {
  const s = event(), first = E.archiveTournament([], s, 2000, 'first');
  s.rounds[0].matches[0].score = [15, 12]; s.current = 1;
  const next = E.archiveTournament(first, s, 3000, 'second');
  assert.equal(next.length, 2); assert.equal(first[0].tournament.current, 0);
  assert.deepEqual(next[0].tournament.rounds[0].matches[0].score, [15, 12]);
  assert.deepEqual(next[0].tournament.config.courtNumbers, [5]);
  next.forEach(e => assert.doesNotThrow(() => E.validate(e.tournament)));
});
test('identical imports deduplicate, while older or corrected results stay separate', () => {
  const s = event(), first = E.archiveTournament([], s, 2000, 'first');
  assert.equal(E.archiveTournament(first, E.validate(JSON.parse(JSON.stringify(s))), 4000, 'duplicate'), first);
  const reordered = structuredClone(s); reordered.config = Object.fromEntries(Object.entries(reordered.config).reverse());
  assert.equal(E.archiveTournament(first, reordered, 4000, 'same'), first);
  s.drafts = { 0: ['15', '12'] };
  assert.equal(E.archiveTournament(first, s, 5000, 'draft').length, 2);
});
test('archiving a running timer freezes remaining time without changing the active clock', () => {
  const s = event(); s.timer = { remaining: 300000, end: 310000 };
  const entries = E.archiveTournament([], s, 110000, 'paused');
  assert.deepEqual(entries[0].tournament.timer, { remaining: 200000, end: null });
  assert.equal(s.timer.end, 310000);
  assert.equal(E.archiveTournament(entries, entries[0].tournament, 900000, 'duplicate'), entries);
});
