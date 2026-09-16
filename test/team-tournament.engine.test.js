'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../team-tournament/engine.js');
const roster = n => Array.from({ length: n }, (_, id) => ({ id, name: `Player ${id}`, grade: String(1 + (id % 9) / 2), skill: 1 + (id % 9) / 2 }));

test('fixed-team player input requires a complete, uniquely named set of pairs', () => {
  assert.equal(E.parsePlayers('Alex, 3.5\nSam, 2\nCharlie\nHarper, 5').length, 4);
  assert.throws(() => E.parsePlayers('Alex\nSam\nCharlie'), /even number/);
  assert.throws(() => E.parsePlayers('Alex\nAlex\nCharlie\nSam'), /same name/);
  assert.throws(() => E.parsePlayers('Alex, 2.7\nSam\nCharlie\nHarper'), /half-point/);
});

test('automatic pairs are complete, balanced and preserve requested locks', () => {
  const players = roster(12), pairs = E.makePairs(players, [[0, 1], [4, 7]], 123);
  assert.deepEqual(pairs[0].players, [0, 1]);
  assert.deepEqual(pairs[1].players, [4, 7]);
  assert.equal(pairs[0].locked, true);
  assert.deepEqual(new Set(pairs.flatMap(pair => pair.players)), new Set(players.map(player => player.id)));
  assert.equal(pairs.every(pair => pair.skill === pair.players.reduce((sum, id) => sum + players[id].skill, 0)), true);
});

test('capacity finds the maximum equal match count that fits each time budget', () => {
  for (let pairCount = 2; pairCount <= 30; pairCount++) for (const courts of [1, 3, 5]) for (const duration of [5, 30, 90, 480]) for (const game of [3, 8, 15]) for (const change of [0, 2]) {
    const config = { courts, duration, game, change }, plan = E.capacity(pairCount, config);
    assert.ok(plan.minutes <= duration);
    let expected = 0;
    const usableCourts = Math.min(courts, Math.floor(pairCount / 2));
    for (let games = 1; games <= Math.floor((duration + change) / (game + change)); games++) {
      if (pairCount * games % 2) continue;
      const rounds = Math.ceil(pairCount * games / 2 / usableCourts);
      if (rounds * game + (rounds - 1) * change <= duration) expected = games;
    }
    assert.equal(plan.games, expected, JSON.stringify({ pairCount, config }));
  }
});

test('court numbers reject zero, out-of-range and duplicate courts', () => {
  assert.deepEqual(E.courtNumbers('3, 5', 2), [3, 5]);
  for (const value of ['0, 2', '1, 1000', '4, 4', '1']) assert.throws(() => E.courtNumbers(value, 2), /court number/);
});

test('schedules guarantee equal matches, bounded duration and no double bookings', () => {
  for (let n = 4; n <= 60; n += 2) for (let courts = 1; courts <= 5; courts++) {
    const players = roster(n), pairs = E.makePairs(players, [], n * courts), config = { courts, duration: 480, game: 6, change: 1 };
    const result = E.schedule(pairs, config, n + courts), counts = Array(pairs.length).fill(0);
    for (const round of result.rounds) {
      const active = round.matches.flatMap(match => match.pairs);
      assert.equal(new Set(active).size, active.length, JSON.stringify({ n, courts }));
      active.forEach(id => counts[id]++);
    }
    assert.equal(new Set(counts).size, 1);
    assert.equal(counts[0], result.plan.games);
    assert.ok(result.plan.minutes <= config.duration);
  }
});

test('team standings score wins, draws and shared ranks', () => {
  const pairs = [{ id: 0, players: [0, 1], skill: 6 }, { id: 1, players: [2, 3], skill: 6 }, { id: 2, players: [4, 5], skill: 6 }, { id: 3, players: [6, 7], skill: 6 }];
  const rounds = [{ matches: [{ pairs: [0, 1], score: [15, 10] }, { pairs: [2, 3], score: [8, 8] }] }];
  const rows = E.standings(pairs, rounds);
  assert.equal(rows[0].id, 0); assert.equal(rows[0].points, 2);
  assert.equal(rows.find(row => row.id === 2).rank, rows.find(row => row.id === 3).rank);
});

test('saved tournaments reject broken partnerships and schedules', () => {
  const players = roster(8), pairs = E.makePairs(players), config = { courts: 2, duration: 30, game: 5, change: 1, courtNumbers: [1, 2] };
  const original = { version: 1, kind: 'fixed-pairs', players, pairs, config, ...E.schedule(pairs, config), current: 0, timer: null, drafts: {} };
  assert.equal(E.validate(structuredClone(original)).plan.games, original.plan.games);
  const duplicate = structuredClone(original); duplicate.pairs[1].players[0] = duplicate.pairs[0].players[0];
  assert.throws(() => E.validate(duplicate), /Invalid saved pairs/);
  const booked = structuredClone(original); booked.rounds[0].matches[1].pairs[0] = booked.rounds[0].matches[0].pairs[0];
  assert.throws(() => E.validate(booked), /double booked/);
});

function eventState(n = 8, config = { courts: 2, duration: 30, game: 5, change: 1, courtNumbers: [1, 2] }) {
  const players = roster(n), pairs = E.makePairs(players);
  return { version: 1, kind: 'fixed-pairs', players, pairs, config, ...E.schedule(pairs, config), current: 0, timer: null, drafts: {}, startedAt: 1000000 };
}

test('large rosters receive balanced pairs and neutral grades are preserved', () => {
  const players = E.parsePlayers(Array.from({ length: 60 }, (_, i) => `Player ${i},${i < 30 ? 1 : 5}`).join('\n'));
  for (const seed of [1, 42, 123]) assert.ok(E.makePairs(players, [], seed).every(pair => pair.skill === 6));
  const neutral = E.parsePlayers('A\nB\nC\nD');
  assert.ok(neutral.every(player => player.skill === 3 && player.grade === ''));
});

test('balanced shuffle offers variety while retaining locked partnerships and every player', () => {
  const players = roster(20), signatures = new Set();
  const locks = [[0, 1], [2, 3]];
  const baseline = E.makePairs(players, locks).slice(2).map(pair => pair.skill);
  const spread = Math.max(...baseline) - Math.min(...baseline);
  for (let seed = 1; seed <= 20; seed++) {
    const pairs = E.makePairs(players, locks, seed, true);
    assert.deepEqual(pairs.slice(0, 2).map(pair => pair.players), locks);
    assert.equal(pairs.flatMap(pair => pair.players).length, players.length);
    assert.equal(new Set(pairs.flatMap(pair => pair.players)).size, players.length);
    const totals = pairs.slice(2).map(pair => pair.skill);
    assert.ok(Math.max(...totals) - Math.min(...totals) <= spread + 1);
    signatures.add(pairs.map(pair => pair.players.slice().sort((a, b) => a - b).join(':')).sort().join('|'));
  }
  assert.ok(signatures.size > 1);
  for (const locks of [[[0, 0]], [[0, 1], [1, 2]], [[0, 99]]]) assert.throws(() => E.makePairs(players, locks), /Invalid locked pairs/);
});

test('short schedules either include all pairs equally or reject creation', () => {
  for (let n = 4; n <= 60; n += 2) for (let courts = 1; courts <= 5; courts++) for (const duration of [5, 17, 30]) {
    const pairs = E.makePairs(roster(n)), config = { courts, duration, game: 5, change: 1 }, plan = E.capacity(pairs.length, config);
    if (!plan.games) { assert.throws(() => E.schedule(pairs, config), /Not enough time/); continue; }
    const original = structuredClone(pairs), result = E.schedule(pairs, config), counts = pairs.map(() => 0);
    for (const round of result.rounds) {
      const active = round.matches.flatMap(match => match.pairs);
      assert.equal(new Set(active).size, active.length);
      active.forEach(id => counts[id]++);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    }
    assert.ok(counts.every(count => count === plan.games));
    assert.deepEqual(pairs, original, 'scheduling never changes confirmed partnerships');
    assert.ok(result.plan.minutes <= duration);
  }
});

test('one-court schedules can vary opponents between roster cycles', () => {
  const pairs = E.makePairs(roster(8));
  const { rounds } = E.schedule(pairs, { courts: 1, duration: 90, game: 5, change: 1 });
  const opponents = new Set(rounds.flatMap(round => round.matches.filter(match => match.pairs.includes(0)).flatMap(match => match.pairs.filter(id => id !== 0))));
  assert.ok(opponents.size > 1);
});

test('standings update every statistic when a score is corrected', () => {
  const state = eventState();
  const match = state.rounds[0].matches[0], [a, b] = match.pairs;
  match.score = [15, 10];
  let rows = E.standings(state.pairs, state.rounds), winner = rows.find(row => row.id === a);
  assert.deepEqual([winner.played, winner.wins, winner.draws, winner.losses, winner.for, winner.against, winner.diff, winner.points], [1, 1, 0, 0, 15, 10, 5, 2]);
  match.score = [8, 8]; rows = E.standings(state.pairs, state.rounds);
  for (const id of [a, b]) {
    const row = rows.find(row => row.id === id);
    assert.deepEqual([row.played, row.wins, row.draws, row.losses, row.for, row.against, row.diff, row.points, row.rank], [1, 0, 1, 0, 8, 8, 0, 1, 1]);
  }
});

test('backup validation rejects malformed team sizes, unfinished results and invalid data', () => {
  const mutations = [
    state => { state.pairs[0].players.push(state.pairs[1].players.pop()); state.pairs.forEach(pair => { pair.skill = pair.players.reduce((sum, id) => sum + state.players[id].skill, 0); }); },
    state => { state.rounds[0].matches[0].score = [10, 11]; },
    state => { state.current = 1; },
    state => { state.startedAt = 'yesterday'; },
    state => { state.config.courtNumbers = [3, 3]; },
    state => { state.timer = { remaining: -1, end: null }; },
    state => { state.drafts = []; },
    state => { state.drafts['court-5'] = ['1', '2']; },
    state => { state.drafts['court-0'] = [{}, '2']; },
    state => { state.kind = 'rotating'; }
  ];
  for (const mutate of mutations) { const state = eventState(); mutate(state); assert.throws(() => E.validate(state)); }
  const state = eventState(); delete state.drafts; assert.deepEqual(E.validate(state).drafts, {});
  state.drafts['court-0'] = ['-1', '2.5']; assert.deepEqual(E.validate(state).drafts['court-0'], ['-1', '2.5'], 'unfinished input remains editable');
});

test('finish estimates include changeovers, delayed starts, pause time and overruns', () => {
  const state = eventState(), now = state.startedAt;
  let estimate = E.finishEstimate(state, now);
  assert.equal(estimate.finish, now + state.plan.minutes * 60000);
  assert.equal(estimate.deadline, now + state.config.duration * 60000);
  state.timer = { remaining: 120000, end: now + 120000 };
  assert.equal(E.finishEstimate(state, now + 60000).finish, E.finishEstimate(state, now).finish);
  state.timer.end = null;
  assert.equal(E.finishEstimate(state, now + 60000).finish - E.finishEstimate(state, now).finish, 60000);
  state.timer = null; state.current++; state.readyAt = now + 60000;
  assert.equal(E.finishEstimate(state, now).finish, now + 60000 + (state.rounds.length - state.current) * 300000 + (state.rounds.length - state.current - 1) * 60000);
  assert.ok(E.finishEstimate(state, now + 3600000).overrun > 0);
  state.current = state.rounds.length; assert.equal(E.finishEstimate(state, now), null);
});

test('manifest, HTML and offline cache refer to present assets including both original icons', () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = path.join(__dirname, '../team-tournament');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(manifest.icons.map(icon => icon.src), ['icon-192.png', 'icon-512.png']);
  for (const [index, size] of [192, 512].entries()) {
    const data = fs.readFileSync(path.join(root, manifest.icons[index].src));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, asset] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for (const [, asset] of sw.matchAll(/'\.\/([^']*)'/g)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
});

function robinConfig(overrides = {}) {
  return { mode: 'round-robin', courts: 2, duration: 30, change: 2, maxGame: 10, courtNumbers: [3, 5], ...overrides };
}
function robinState(n = 8, overrides = {}) {
  const players = roster(n), pairs = E.makePairs(players), config = robinConfig(overrides);
  const generated = E.schedule(pairs, config);
  config.game = generated.plan.game;
  return { version: 1, kind: 'fixed-pairs', players, pairs, config, ...generated, current: 0, timer: null, drafts: {}, startedAt: 1000000 };
}

test('round robin fits whole-minute games and leaves spare time when the cap is reached', () => {
  for (const [teams, config, expected] of [
    [4, {}, [3, 3, 8, 28, 2]],
    [4, { duration: 60 }, [3, 3, 10, 34, 26]],
    [4, { duration: 60, maxGame: 8 }, [3, 3, 8, 28, 32]],
    [4, { duration: 60, maxGame: 12 }, [3, 3, 12, 40, 20]],
    [2, { duration: 60 }, [1, 1, 10, 10, 50]],
    [5, { duration: 60 }, [4, 5, 10, 58, 2]],
    [6, { duration: 60 }, [5, 8, 5, 54, 6]],
    [4, { duration: 19 }, [3, 3, 5, 19, 0]]
  ]) {
    const plan = E.capacity(teams, robinConfig(config));
    assert.equal(plan.feasible, true);
    assert.deepEqual([plan.games, plan.rounds, plan.game, plan.minutes, plan.spare], expected);
  }
});

test('round robin refuses three-minute games and reports the actual minimum time needed', () => {
  const config = robinConfig({ duration: 13 }), plan = E.capacity(4, config);
  assert.equal(plan.game, 3); assert.equal(plan.feasible, false); assert.equal(plan.minDuration, 19);
  assert.throws(() => E.schedule(E.makePairs(roster(8)), config), /at least 19 minutes.*5-minute games/);
  assert.equal(E.capacity(4, robinConfig({ duration: 18 })).feasible, false);
  assert.equal(E.capacity(4, robinConfig({ duration: 19 })).feasible, true);
  for (const maxGame of [0, 3, 4, 5.5, 61, NaN]) assert.throws(() => E.capacity(4, robinConfig({ maxGame })), /game cap/);
  const defaults = robinConfig({ duration: 60 }); delete defaults.maxGame;
  assert.equal(E.capacity(4, defaults).game, 10);
});

test('round robin uses each matchup exactly once with equal participation and no double booking', () => {
  for (let n = 4; n <= 60; n += 2) for (let courts = 1; courts <= 5; courts++) for (const seed of [1, 42, 123]) {
    const players = roster(n), pairs = E.makePairs(players), original = structuredClone(pairs);
    const config = robinConfig({ courts, duration: 480, maxGame: 5, change: 0, courtNumbers: Array.from({ length: courts }, (_, i) => i + 1) });
    const plan = E.capacity(pairs.length, config);
    if (!plan.feasible) { assert.throws(() => E.schedule(pairs, config), /at least/); continue; }
    const result = E.schedule(pairs, config, seed), matchups = new Set(), counts = pairs.map(() => 0);
    assert.equal(result.rounds.length, Math.max(pairs.length % 2 ? pairs.length : pairs.length - 1, Math.ceil(pairs.length * (pairs.length - 1) / 2 / Math.min(courts, Math.floor(pairs.length / 2)))));
    for (const round of result.rounds) {
      assert.ok(round.matches.length >= 1 && round.matches.length <= courts);
      const active = round.matches.flatMap(match => match.pairs);
      assert.equal(new Set(active).size, active.length, JSON.stringify({ n, courts, seed }));
      assert.deepEqual(round.resting.slice().sort((a, b) => a - b), pairs.map(pair => pair.id).filter(id => !active.includes(id)));
      for (const match of round.matches) {
        const key = match.pairs.slice().sort((a, b) => a - b).join(':');
        assert.ok(!matchups.has(key), 'no repeat opponents'); matchups.add(key);
        match.pairs.forEach(id => counts[id]++);
      }
    }
    assert.equal(matchups.size, pairs.length * (pairs.length - 1) / 2);
    assert.ok(counts.every(count => count === pairs.length - 1));
    assert.equal(result.plan.minutes, result.rounds.length * result.plan.game + (result.rounds.length - 1) * config.change);
    assert.ok(result.plan.minutes <= config.duration);
    assert.deepEqual(pairs, original);
    assert.doesNotThrow(() => E.validate({ version: 1, kind: 'fixed-pairs', players, pairs, config: { ...config, game: plan.game }, ...result, current: 0, timer: null, drafts: {} }));
  }
});

test('round-robin feasibility covers every time budget with and without changeovers', () => {
  for (let teams = 2; teams <= 30; teams++) for (const courts of [1, 2, 5]) for (const change of [0, 2, 15]) for (let duration = 5; duration <= 480; duration++) {
    const plan = E.capacity(teams, robinConfig({ courts, change, duration }));
    assert.equal(plan.feasible, plan.minDuration <= duration);
    if (!plan.feasible) continue;
    assert.ok(plan.game >= 5 && plan.game <= 10 && Number.isInteger(plan.game));
    assert.ok(plan.minutes <= duration);
    assert.equal(plan.spare, duration - plan.minutes);
    if (plan.game < 10) assert.ok(plan.minutes + plan.rounds > duration, 'the next whole minute would exceed the budget');
  }
});

test('round-robin backups preserve calculated timers and reject repeated opponents or altered timing', () => {
  const state = robinState();
  state.timer = { remaining: 8 * 60000, end: state.startedAt + 8 * 60000 };
  state.drafts = { 'court-0': ['40', '2'] };
  assert.deepEqual(E.validate(structuredClone(state)), state);
  assert.equal(E.finishEstimate(state, state.startedAt).finish, state.startedAt + 28 * 60000);
  const duplicate = structuredClone(state); duplicate.rounds[1] = structuredClone(duplicate.rounds[0]);
  assert.throws(() => E.validate(duplicate), /Repeated opponent/);
  const timing = structuredClone(state); timing.config.game = 10;
  assert.throws(() => E.validate(timing), /round-robin timing/);
  const tooShort = structuredClone(state); tooShort.config.duration = 13;
  assert.throws(() => E.validate(tooShort), /round-robin timing/);
  const unknown = structuredClone(state); unknown.config.mode = 'anything';
  assert.throws(() => E.validate(unknown), /Unknown scheduling mode/);
  assert.equal(E.validScore([40, 2]), true, 'game-duration caps do not change scoring rules');
});

test('existing equal-match saves and drafts remain compatible without scheduling mode metadata', () => {
  const state = eventState();
  assert.equal(state.config.mode, undefined);
  assert.deepEqual(E.validate(structuredClone(state)), state);
  const explicit = structuredClone(state); explicit.config.mode = 'equal';
  assert.deepEqual(E.validate(explicit).plan, state.plan);
  assert.deepEqual(E.schedule(state.pairs, explicit.config), E.schedule(state.pairs, state.config));
});

function sheetFixture() {
  const players = ['Zoe', 'Amy', 'ben', 'Will', 'Tim', 'John'].map((name, id) => ({ id, name }));
  const pairs = [{ id: 0, players: [0, 1] }, { id: 1, players: [2, 3] }, { id: 2, players: [4, 5] }];
  const rounds = [
    { matches: [{ pairs: [0, 1], score: [21, 17] }] },
    { matches: [{ pairs: [1, 2], score: [0, 0] }] },
    { matches: [{ pairs: [0, 2], score: null }] }
  ];
  return { players, pairs, rounds };
}

test('score sheet sorts by displayed pair names without reversing partners or ranking by points', () => {
  const { players, pairs, rounds } = sheetFixture(), before = structuredClone({ players, pairs, rounds });
  const rows = E.scoreSheet(players, pairs, rounds);
  assert.deepEqual(rows.map(row => row.name), ['ben + Will', 'Tim + John', 'Zoe + Amy']);
  assert.deepEqual(rows.map(row => row.id), [1, 2, 0]);
  assert.deepEqual(rows.map(row => row.total), [1, 1, 2]);
  assert.deepEqual({ players, pairs, rounds }, before);
});

test('score sheet distinguishes wins, losses, nil-all draws, rests and unplayed cells', () => {
  const { players, pairs, rounds } = sheetFixture(), rows = E.scoreSheet(players, pairs, rounds);
  assert.deepEqual(rows[0].cells, [
    { status: 'played', points: 0, score: 17 },
    { status: 'played', points: 1, score: 0 },
    { status: 'rest', points: null, score: null }
  ]);
  assert.deepEqual(rows[2].cells, [
    { status: 'played', points: 2, score: 21 },
    { status: 'rest', points: null, score: null },
    { status: 'pending', points: null, score: null }
  ]);
  assert.deepEqual(rows[1].cells[1], { status: 'played', points: 1, score: 0 });
  assert.deepEqual(rows[1].cells[2], { status: 'pending', points: null, score: null });
});

test('score-sheet corrections update each side and totals without changing alphabetical row order', () => {
  const { players, pairs, rounds } = sheetFixture();
  const before = E.scoreSheet(players, pairs, rounds);
  rounds[0].matches[0].score = [11, 16];
  const after = E.scoreSheet(players, pairs, rounds);
  assert.deepEqual(after.map(row => row.name), before.map(row => row.name));
  assert.deepEqual(after[0].cells[0], { status: 'played', points: 2, score: 16 });
  assert.equal(after[0].total, 3);
  assert.deepEqual(after[2].cells[0], { status: 'played', points: 0, score: 11 });
  assert.equal(after[2].total, 0);
  assert.equal(before[2].total, 2, 'earlier snapshots are not mutated');
});

test('empty and incomplete score sheets never invent results', () => {
  const { players, pairs, rounds } = sheetFixture();
  assert.ok(E.scoreSheet(players, pairs, []).every(row => row.total === 0 && row.cells.length === 0));
  rounds.forEach(round => { round.matches[0].score = [null, 2]; });
  assert.ok(E.scoreSheet(players, pairs, rounds).every(row => row.total === 0 && row.cells.every(cell => cell.points === null && cell.score === null)));
});

test('score sheets agree with standings for both scheduling modes and large groups', () => {
  for (const mode of ['equal', 'round-robin']) for (const n of [4, 6, 12, 60]) {
    const players = roster(n), pairs = E.makePairs(players);
    const config = { mode, courts: 5, duration: 480, game: 5, maxGame: 5, change: 0 };
    const { rounds } = E.schedule(pairs, config);
    let scored = 0;
    rounds.forEach((round, ri) => { if (ri % 3 !== 2) round.matches.forEach((match, mi) => { match.score = [[21, 15], [0, 0], [2, 40]][(ri + mi) % 3].slice(); scored++; }); });
    const rows = E.scoreSheet(players, pairs, rounds), standings = E.standings(pairs, rounds);
    assert.equal(rows.reduce((sum, row) => sum + row.total, 0), scored * 2);
    for (const row of rows) {
      const standing = standings.find(s => s.id === row.id);
      assert.equal(row.total, standing.points);
      assert.equal(row.cells.reduce((sum, cell) => sum + (cell.score ?? 0), 0), standing.for);
      assert.equal(row.cells.filter(cell => cell.status === 'played').length, standing.played);
      assert.equal(row.cells.length, rounds.length);
    }
  }
});
