(function (root) {
  'use strict';
  const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  function parsePlayers(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < 4 || lines.length > 60) throw Error('Enter between 4 and 60 players, one per line.');
    const seen = new Set();
    return lines.map((line, id) => {
      const parts = line.split(',').map(s => s.trim());
      const name = parts[0];
      const grade = parts[1] || '';
      if (!name || name.length > 50 || parts.length > 2 || (grade && (!/^[1-5](?:\.0|\.5)?$/.test(grade) || Number(grade) > 5))) throw Error('Use a name, optionally followed by a comma and grade 1 to 5, in half-point steps.');
      if (seen.has(name.toLowerCase())) throw Error('Two players have the same name. Add a surname or initial.');
      seen.add(name.toLowerCase());
      return { id, name, grade, skill: grade ? Number(grade) : 3 };
    });
  }
  function capacity(n, config) {
    const { courts, duration, game, change } = config;
    if (!integer(n, 4, 60) || !integer(courts, 1, 5) || !integer(duration, 5, 480) || !integer(game, 1, 60) || !integer(change, 0, 15)) throw Error('Use 1–5 courts, 5–480 minutes total, 1–60 minutes per game and 0–15 minutes changeover.');
    const usableCourts = Math.min(courts, Math.floor(n / 4));
    const maxRounds = Math.floor((duration + change) / (game + change));
    let games = Math.min(maxRounds, Math.floor(maxRounds * usableCourts * 4 / n));
    while (games > 0 && (n * games % 4 !== 0 || Math.ceil(n * games / 4 / usableCourts) > maxRounds)) games--;
    const matches = n * games / 4;
    const rounds = Math.ceil(matches / usableCourts);
    const minutes = rounds ? rounds * game + (rounds - 1) * change : 0;
    return { games, matches, rounds, minutes, spare: duration - minutes, usableCourts };
  }
  function random(seed) {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function courtNumbers(text, count) {
    if (!integer(count, 1, 5)) throw Error('Choose between 1 and 5 courts.');
    if (!text.trim()) return Array.from({ length: count }, (_, i) => i + 1);
    const parts = text.trim().split(/[\s,]+/);
    const numbers = parts.map(Number);
    if (parts.length !== count || parts.some(p => !/^\d{1,3}$/.test(p)) || numbers.some(n => !integer(n, 1, 999)) || new Set(numbers).size !== count) throw Error(`Enter ${count} different court number${count === 1 ? '' : 's'} from 1 to 999, separated by commas.`);
    return numbers;
  }
  function shuffle(a, rng) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const key = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  function schedule(players, config, seed = 42) {
    const plan = capacity(players.length, config);
    if (!plan.games) throw Error('Not enough time for equal games. Add time or shorten each game/changeover.');
    const rng = random(seed), order = shuffle(players.map(p => p.id), rng);
    const partners = {}, opponents = {}, rounds = [];
    const skill = Object.fromEntries(players.map(p => [p.id, p.skill]));
    let cursor = 0;
    for (let r = 0; r < plan.rounds; r++) {
      // Spread court use evenly. Consecutive cyclic slots guarantee equal final
      // counts, at most one game difference during play, and no double booking.
      const count = Math.floor((r + 1) * plan.matches / plan.rounds) - Math.floor(r * plan.matches / plan.rounds);
      const active = Array.from({ length: count * 4 }, () => order[cursor++ % order.length]);
      let best, bestCost = Infinity;
      for (let trial = 0; trial < 160; trial++) {
        const candidate = shuffle(active, rng), matches = [];
        let cost = 0;
        for (let i = 0; i < candidate.length; i += 4) {
          const [a, b, c, d] = candidate.slice(i, i + 4);
          cost += 25 * ((partners[key(a, b)] || 0) ** 2 + (partners[key(c, d)] || 0) ** 2);
          for (const x of [a, b]) for (const y of [c, d]) cost += 3 * (opponents[key(x, y)] || 0) ** 2;
          cost += 4 * Math.abs(skill[a] + skill[b] - skill[c] - skill[d]);
          matches.push({ teams: [[a, b], [c, d]], score: null });
        }
        if (cost < bestCost) { bestCost = cost; best = matches; }
      }
      for (const m of best) {
        for (const [a, b] of m.teams) partners[key(a, b)] = (partners[key(a, b)] || 0) + 1;
        for (const a of m.teams[0]) for (const b of m.teams[1]) opponents[key(a, b)] = (opponents[key(a, b)] || 0) + 1;
      }
      rounds.push({ matches: best, resting: order.filter(id => !active.includes(id)) });
    }
    return { plan, rounds };
  }
  function validScore(score) { return Array.isArray(score) && score.length === 2 && score.every(v => integer(v, 0, 99)); }
  function standings(players, rounds) {
    const rows = players.map(p => ({ ...p, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
    const byId = Object.fromEntries(rows.map(p => [p.id, p]));
    for (const r of rounds) for (const m of r.matches) {
      if (!validScore(m.score)) continue;
      m.teams.forEach((team, side) => team.forEach(id => {
        const p = byId[id], own = m.score[side], other = m.score[1 - side];
        p.played++; p.for += own; p.against += other; p.diff = p.for - p.against;
        if (own > other) { p.wins++; p.points += 2; } else if (own === other) { p.draws++; p.points++; } else p.losses++;
      }));
    }
    rows.sort((a, b) => b.points - a.points || b.diff - a.diff || a.name.localeCompare(b.name));
    rows.forEach((p, i) => { p.rank = i && p.points === rows[i - 1].points && p.diff === rows[i - 1].diff ? rows[i - 1].rank : i + 1; });
    return rows;
  }
  function validate(s) {
    if (!s || s.version !== 1 || !Array.isArray(s.players) || !Array.isArray(s.rounds)) throw Error('Unrecognised saved tournament.');
    const parsed = parsePlayers(s.players.map(p => p.name + (p.grade ? ',' + p.grade : '')).join('\n'));
    if (s.players.some((p, i) => p.id !== i || p.skill !== parsed[i].skill)) throw Error('Invalid saved players.');
    const plan = capacity(s.players.length, s.config);
    if (s.config.courtNumbers !== undefined) {
      if (!Array.isArray(s.config.courtNumbers) || s.config.courtNumbers.length !== s.config.courts || s.config.courtNumbers.some(n => !integer(n, 1, 999))) throw Error('Invalid saved court numbers.');
      courtNumbers(s.config.courtNumbers.join(','), s.config.courts);
    }
    if (!plan.games || s.rounds.length !== plan.rounds || !integer(s.current, 0, plan.rounds)) throw Error('Invalid saved schedule.');
    const counts = s.players.map(() => 0);
    s.rounds.forEach((r, ri) => {
      if (!Array.isArray(r.matches) || r.matches.length < 1 || r.matches.length > plan.usableCourts) throw Error('Invalid courts.');
      const ids = [];
      r.matches.forEach(m => {
        if (!Array.isArray(m.teams) || m.teams.length !== 2 || m.teams.some(t => !Array.isArray(t) || t.length !== 2)) throw Error('Invalid teams.');
        ids.push(...m.teams.flat());
        if (m.score !== null && !validScore(m.score)) throw Error('Invalid score.');
        if (ri < s.current && !validScore(m.score)) throw Error('Missing completed result.');
        if (ri > s.current && m.score !== null) throw Error('Unexpected future result.');
      });
      if (new Set(ids).size !== ids.length || ids.some(id => !integer(id, 0, counts.length - 1))) throw Error('Invalid playing slots.');
      ids.forEach(id => counts[id]++);
      r.resting = s.players.map(p => p.id).filter(id => !ids.includes(id));
    });
    if (counts.some(c => c !== plan.games)) throw Error('Unequal saved schedule.');
    if (s.timer !== null && (!s.timer || !Number.isFinite(s.timer.remaining) || s.timer.remaining < 0 || s.timer.remaining > s.config.game * 60000 || (s.timer.end !== null && (!Number.isFinite(s.timer.end) || s.timer.end < 0)))) throw Error('Invalid saved timer.');
    for (const field of ['startedAt', 'readyAt']) if (s[field] !== undefined && (!Number.isFinite(s[field]) || s[field] < 0 || s[field] > 8640000000000000)) throw Error('Invalid saved event time.');
    if (s.timer?.alerted !== undefined && typeof s.timer.alerted !== 'boolean') throw Error('Invalid saved alert.');
    s.plan = plan;
    return s;
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
  const api = { parsePlayers, capacity, schedule, standings, validScore, validate, finishEstimate, courtNumbers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JuniorTournament = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
