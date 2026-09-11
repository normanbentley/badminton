'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../tournament/engine.js');
const roster = n => E.parsePlayers(Array.from({ length: n }, (_, i) => `Player ${i + 1}, ${1 + (i % 9) / 2}`).join('\n'));

test('numeric grades support half points, with neutral defaults and unambiguous names', () => {
  assert.deepEqual(E.parsePlayers('Alex, 3.5\nSam, 5\nCharlie, 1\nHarper').map(p => p.skill), [3.5, 5, 1, 3]);
  for (const grade of ['A', '0', '5.5', '2.2', 'NaN']) assert.throws(() => E.parsePlayers(`A, ${grade}\nB\nC\nD`));
  assert.throws(() => E.parsePlayers('Alex\nalex\nB\nC'), /same name/);
});

test('capacity finds the maximum feasible equal game count across group sizes and budgets', () => {
  for (let n = 4; n <= 60; n++) for (const courts of [2, 3]) for (const duration of [5, 30, 90, 180]) for (const game of [3, 8, 15]) for (const change of [0, 2]) {
    const config = { courts, duration, game, change }, p = E.capacity(n, config);
    assert.ok(p.minutes <= duration);
    let expected = 0;
    for (let g = 1; g <= Math.floor((duration + change) / (game + change)); g++) {
      if (n * g % 4) continue;
      const rounds = Math.ceil(n * g / 4 / Math.min(courts, Math.floor(n / 4)));
      if (rounds >= g && rounds * game + (rounds - 1) * change <= duration) expected = g;
    }
    assert.equal(p.games, expected, JSON.stringify({ n, config }));
  }
});

test('schedules guarantee equal games, bounded duration and no double bookings for 4 to 60 players', () => {
  for (let n = 4; n <= 60; n++) for (const courts of [2, 3]) {
    const players = roster(n), config = { courts, duration: 240, game: 6, change: 1 };
    const result = E.schedule(players, config, n * 13);
    const counts = Array(n).fill(0);
    for (const round of result.rounds) {
      assert.ok(round.matches.length <= courts);
      const active = round.matches.flatMap(m => m.teams.flat());
      assert.equal(new Set(active).size, active.length);
      assert.equal(new Set([...active, ...round.resting]).size, n);
      active.forEach(id => counts[id]++);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    }
    assert.ok(counts.every(c => c === result.plan.games));
    assert.ok(result.plan.minutes <= config.duration);
    assert.doesNotThrow(() => E.validate({ version: 1, players, config, ...result, current: 0, timer: null }));
  }
});

test('small groups rotate partners and balance skill when alternatives exist', () => {
  const players = E.parsePlayers('A, 5\nB, 5\nC, 1\nD, 1');
  const { rounds } = E.schedule(players, { courts: 2, duration: 15, game: 5, change: 0 });
  const partnerships = rounds.map(r => r.matches[0].teams.find(t => t.includes(0)).find(id => id !== 0));
  assert.equal(new Set(partnerships).size, 3);
  const first = rounds[0].matches[0].teams.map(team => team.reduce((sum, id) => sum + players[id].skill, 0));
  assert.equal(first[0], first[1]);
});

test('standings calculate wins, draws, losses, differential, shared ties and corrected results', () => {
  const players = roster(4);
  const rounds = [{ matches: [{ teams: [[0, 1], [2, 3]], score: [15, 12] }] }, { matches: [{ teams: [[0, 2], [1, 3]], score: [8, 8] }] }];
  let rows = E.standings(players, rounds);
  assert.deepEqual(rows.map(p => [p.id, p.points, p.rank]), [[0, 3, 1], [1, 3, 1], [2, 1, 3], [3, 1, 3]]);
  assert.deepEqual([rows[0].played, rows[0].wins, rows[0].draws, rows[0].losses, rows[0].for, rows[0].against, rows[0].diff], [2, 1, 1, 0, 23, 20, 3]);
  rounds[0].matches[0].score = [0, 2];
  rows = E.standings(players, rounds);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[0].points, 3);
  rounds[0].matches[0].score = null;
  assert.ok(E.standings(players, rounds).every(p => p.played === 1 && p.points === 1));
});

test('restoring rejects corrupt scores, schedules and timers', () => {
  const players = roster(8), config = { courts: 2, duration: 30, game: 5, change: 1 };
  const s = { version: 1, players, config, ...E.schedule(players, config), current: 0, timer: null };
  for (const mutate of [
    t => { t.rounds[0].matches[0].teams[0][0] = t.rounds[0].matches[0].teams[0][1]; },
    t => { t.rounds[0].matches[0].score = [-1, 2]; },
    t => { t.current = 1; },
    t => { t.timer = { remaining: -2, end: null }; },
    t => { t.rounds.pop(); }
  ]) { const copy = JSON.parse(JSON.stringify(s)); mutate(copy); assert.throws(() => E.validate(copy)); }
});
