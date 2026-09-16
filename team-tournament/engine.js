(function (root) {
  'use strict';
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  function parsePlayers(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 4 || lines.length > 60 || lines.length % 2) throw Error('Enter an even number of players between 4 and 60.');
    const seen = new Set();
    return lines.map((line, id) => {
      const parts = line.split(',').map(part => part.trim()), name = parts[0], grade = parts[1] || '';
      if (!name || name.length > 50 || parts.length > 2 || (grade && (!/^[1-5](?:\.0|\.5)?$/.test(grade) || Number(grade) > 5))) throw Error('Use a name, optionally followed by a grade from 1 to 5 in half-point steps.');
      if (seen.has(name.toLowerCase())) throw Error('Two players have the same name. Add a surname or initial.');
      seen.add(name.toLowerCase());
      return { id, name, grade, skill: grade ? Number(grade) : 3 };
    });
  }
  function random(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(values, rng) {
    const result = values.slice();
    for (let i = result.length - 1; i; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function makePairs(players, locked = [], seed = 42, vary = false) {
    const used = new Set();
    for (const pair of locked) {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(id => !integer(id, 0, players.length - 1) || used.has(id)) || pair[0] === pair[1]) throw Error('Invalid locked pairs.');
      pair.forEach(id => used.add(id));
    }
    const available = players.map(player => player.id).filter(id => !used.has(id));
    if (available.length % 2) throw Error('Every player needs a partner.');
    const rng = random(seed), skill = id => players[id].skill;
    // Pair opposite ends of the grade order. Randomize equal grades first so
    // equally balanced alternatives remain available even for large rosters.
    const sorted = shuffle(available, rng).sort((a, b) => skill(a) - skill(b));
    const best = locked.map(pair => pair.slice());
    for (let i = 0; i < sorted.length / 2; i++) best.push([sorted[i], sorted[sorted.length - 1 - i]]);
    if (vary && available.length >= 4) {
      const totals = best.slice(locked.length).map(pair => skill(pair[0]) + skill(pair[1]));
      const spread = Math.max(...totals) - Math.min(...totals);
      const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
      const variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0);
      for (let trial = 0; trial < 100; trial++) {
        const a = locked.length + Math.floor(rng() * totals.length), b = locked.length + Math.floor(rng() * totals.length);
        if (a === b) continue;
        const ai = Math.floor(rng() * 2), bi = Math.floor(rng() * 2);
        [best[a][ai], best[b][bi]] = [best[b][bi], best[a][ai]];
        const next = best.slice(locked.length).map(pair => skill(pair[0]) + skill(pair[1]));
        // Allow a small, visible tradeoff for new suggestions, never a random
        // unbalanced roster. Locked teams do not widen this allowance.
        if (Math.max(...next) - Math.min(...next) > spread + 1 || next.reduce((sum, value) => sum + (value - mean) ** 2, 0) > variance + 1) {
          [best[a][ai], best[b][bi]] = [best[b][bi], best[a][ai]];
        }
      }
    }
    return best.map((members, id) => ({ id, players: members, skill: skill(members[0]) + skill(members[1]), locked: id < locked.length }));
  }

  function capacity(pairCount, config) {
    const { courts, duration, game, change } = config;
    if (!integer(pairCount, 2, 30) || !integer(courts, 1, 5) || !integer(duration, 5, 480) || !integer(game, 1, 60) || !integer(change, 0, 15)) throw Error('Use 1–5 courts, 5–480 minutes total, 1–60 minutes per game and 0–15 minutes changeover.');
    const usableCourts = Math.min(courts, Math.floor(pairCount / 2));
    const maxRounds = Math.floor((duration + change) / (game + change));
    let games = Math.min(maxRounds, Math.floor(maxRounds * usableCourts * 2 / pairCount));
    while (games > 0 && (pairCount * games % 2 || Math.ceil(pairCount * games / 2 / usableCourts) > maxRounds)) games--;
    const matches = pairCount * games / 2, rounds = Math.ceil(matches / usableCourts);
    const minutes = rounds ? rounds * game + (rounds - 1) * change : 0;
    return { games, matches, rounds, minutes, spare: duration - minutes, usableCourts };
  }
  function courtNumbers(text, count) {
    if (!integer(count, 1, 5)) throw Error('Choose between 1 and 5 courts.');
    if (!text.trim()) return Array.from({ length: count }, (_, index) => index + 1);
    const parts = text.trim().split(/[\s,]+/), numbers = parts.map(Number);
    if (parts.length !== count || parts.some(part => !/^\d{1,3}$/.test(part)) || numbers.some(number => !integer(number, 1, 999)) || new Set(numbers).size !== count) throw Error(`Enter ${count} different court number${count === 1 ? '' : 's'} from 1 to 999, separated by commas.`);
    return numbers;
  }
  const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  function schedule(pairs, config, seed = 42) {
    const plan = capacity(pairs.length, config);
    if (!plan.games) throw Error('Not enough time for equal matches. Add time or shorten each game/changeover.');
    const rng = random(seed), opponents = {}, rounds = [], courtUse = pairs.map(() => Array(plan.usableCourts).fill(0));
    let order = shuffle(pairs.map(pair => pair.id), rng);
    let cursor = 0;
    for (let round = 0; round < plan.rounds; round++) {
      // Reorder only after a complete roster cycle to keep participation equal.
      if (cursor && cursor % order.length === 0) order = shuffle(order, rng);
      const count = Math.floor((round + 1) * plan.matches / plan.rounds) - Math.floor(round * plan.matches / plan.rounds);
      const active = Array.from({ length: count * 2 }, () => order[cursor++ % order.length]);
      let best, bestCost = Infinity;
      for (let trial = 0; trial < 200; trial++) {
        const candidate = shuffle(active, rng), matches = [];
        let cost = 0;
        for (let i = 0; i < candidate.length; i += 2) {
          const a = candidate[i], b = candidate[i + 1];
          cost += 20 * (opponents[key(a, b)] || 0) ** 2 + Math.abs(pairs[a].skill - pairs[b].skill) + (courtUse[a][i / 2] + courtUse[b][i / 2]) / 4;
          matches.push({ pairs: [a, b], score: null });
        }
        if (cost < bestCost) { bestCost = cost; best = matches; }
      }
      best.forEach((match, court) => { opponents[key(...match.pairs)] = (opponents[key(...match.pairs)] || 0) + 1; match.pairs.forEach(id => courtUse[id][court]++); });
      rounds.push({ matches: best, resting: order.filter(id => !active.includes(id)) });
    }
    return { plan, rounds };
  }
  function validScore(score) { return Array.isArray(score) && score.length === 2 && score.every(value => integer(value, 0, 99)); }
  function standings(pairs, rounds) {
    const rows = pairs.map(pair => ({ ...pair, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
    for (const round of rounds) for (const match of round.matches) if (validScore(match.score)) match.pairs.forEach((id, side) => {
      const row = rows[id], own = match.score[side], other = match.score[1 - side];
      row.played++; row.for += own; row.against += other; row.diff = row.for - row.against;
      if (own > other) { row.wins++; row.points += 2; } else if (own === other) { row.draws++; row.points++; } else row.losses++;
    });
    rows.sort((a, b) => b.points - a.points || b.diff - a.diff || a.id - b.id);
    rows.forEach((row, index) => { row.rank = index && row.points === rows[index - 1].points && row.diff === rows[index - 1].diff ? rows[index - 1].rank : index + 1; });
    return rows;
  }
  function validate(state) {
    if (!state || state.version !== 1 || state.kind !== 'fixed-pairs' || !Array.isArray(state.players) || !Array.isArray(state.pairs) || !Array.isArray(state.rounds)) throw Error('Unrecognised fixed-pair tournament.');
    const players = parsePlayers(state.players.map(player => player.name + (player.grade ? `,${player.grade}` : '')).join('\n'));
    if (players.some((player, index) => state.players[index].id !== index || state.players[index].skill !== player.skill || state.players[index].name !== player.name || typeof state.players[index].grade !== 'string' || state.players[index].grade !== player.grade)) throw Error('Invalid saved players.');
    if (state.pairs.some(pair => !pair || !Array.isArray(pair.players) || pair.players.length !== 2)) throw Error('Invalid saved pairs.');
    const ids = state.pairs.flatMap(pair => pair.players || []);
    if (state.pairs.length !== players.length / 2 || ids.length !== players.length || new Set(ids).size !== players.length || ids.some(id => !integer(id, 0, players.length - 1))) throw Error('Invalid saved pairs.');
    state.pairs.forEach((pair, id) => { if (pair.id !== id || pair.skill !== pair.players.reduce((sum, player) => sum + players[player].skill, 0)) throw Error('Invalid saved pairs.'); });
    const plan = capacity(state.pairs.length, state.config), counts = state.pairs.map(() => 0);
    if (!Array.isArray(state.config.courtNumbers) || state.config.courtNumbers.length !== state.config.courts) throw Error('Invalid saved court numbers.');
    courtNumbers(state.config.courtNumbers.join(','), state.config.courts);
    if (!plan.games || state.rounds.length !== plan.rounds || !integer(state.current, 0, plan.rounds)) throw Error('Invalid saved schedule.');
    state.rounds.forEach((round, roundIndex) => {
      const active = [];
      if (!Array.isArray(round.matches) || !round.matches.length || round.matches.length > plan.usableCourts) throw Error('Invalid courts.');
      round.matches.forEach(match => {
        if (!Array.isArray(match.pairs) || match.pairs.length !== 2 || match.pairs.some(id => !integer(id, 0, state.pairs.length - 1))) throw Error('Invalid match.');
        active.push(...match.pairs);
        if (match.score !== null && !validScore(match.score)) throw Error('Invalid score.');
        if (roundIndex < state.current && !validScore(match.score)) throw Error('Missing completed result.');
        if (roundIndex >= state.current && match.score !== null) throw Error('Unexpected future result.');
      });
      if (new Set(active).size !== active.length) throw Error('A pair is double booked.');
      active.forEach(id => counts[id]++);
      round.resting = state.pairs.map(pair => pair.id).filter(id => !active.includes(id));
    });
    if (counts.some(count => count !== plan.games)) throw Error('Unequal saved schedule.');
    if (state.timer !== null && (!state.timer || !Number.isFinite(state.timer.remaining) || state.timer.remaining < 0 || state.timer.remaining > state.config.game * 60000 || (state.timer.end !== null && (!Number.isFinite(state.timer.end) || state.timer.end < 0)))) throw Error('Invalid saved timer.');
    for (const field of ['startedAt', 'readyAt']) if (state[field] !== undefined && (!Number.isFinite(state[field]) || state[field] < 0 || state[field] > 8640000000000000)) throw Error('Invalid saved event time.');
    state.drafts ??= {};
    if (typeof state.drafts !== 'object' || Array.isArray(state.drafts)) throw Error('Invalid saved score drafts.');
    for (const [key, values] of Object.entries(state.drafts)) {
      if (!/^court-[0-4]$/.test(key) || !state.rounds[state.current]?.matches[Number(key.slice(6))] || !Array.isArray(values) || values.length !== 2 || values.some(value => typeof value !== 'string' || value.length > 32)) throw Error('Invalid saved score drafts.');
    }
    state.plan = plan;
    return state;
  }
  function finishEstimate(s, now) {
    if (s.current >= s.rounds.length) return null;
    const future = s.rounds.length - s.current - 1;
    const currentEnd = s.timer?.end != null ? Math.max(now, s.timer.end)
      : Math.max(now, s.readyAt || now) + (s.timer ? s.timer.remaining : s.config.game * 60000);
    const finish = currentEnd + future * (s.config.game + s.config.change) * 60000;
    const deadline = s.startedAt ? s.startedAt + s.config.duration * 60000 : null;
    return { finish, deadline, overrun: deadline ? Math.max(0, finish - deadline) : 0 };
  }
  const api = { parsePlayers, makePairs, capacity, courtNumbers, schedule, standings, validScore, validate, finishEstimate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.JuniorTeamTournament = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
