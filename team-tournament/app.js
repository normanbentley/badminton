'use strict';
(() => {
  const E = window.JuniorTeamTournament, app = document.getElementById('app'), options = document.getElementById('options-slot');
  const STORE = 'junior-team-doubles-v1', DRAFT = 'junior-team-doubles-setup-v1';
  const defaults = { names: '', courts: 2, duration: 90, game: 10, change: 2, courtNumbers: '' };
  let state = null, setup = { ...defaults, ...load(DRAFT) }, pairing = null, previousPairs = [], selected = null, tab = 'round', tick;
  const esc = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function warning(message) { const el = document.getElementById('storage-warning'); el.textContent = message; el.hidden = !message; }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); warning(''); document.getElementById('save-status').textContent = 'Saved on this device only.'; return true; }
    catch { warning('This tournament could not be saved. Export a backup now and keep this page open.'); document.getElementById('save-status').textContent = 'Save failed.'; return false; }
  }
  function storeDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(setup)); } catch { warning('Your setup could not be saved on this device.'); } }
  function pairName(pair) { return pair.players.map(id => state.players[id].name).join(' + '); }
  function setupView() {
    clearInterval(tick); document.body.classList.remove('running');
    options.innerHTML = `<button data-action="import" aria-label="Import tournament backup">Import backup</button><input id="import-file" type="file" accept="application/json,.json" hidden>`;
    app.innerHTML = `<section class="card"><p class="eyebrow">STEP 1 OF 2</p><h2>Add the players</h2><label for="names">Who’s playing?</label><p class="help">Paste one player per line. Add an optional grade after a comma. Grades run from 1 to 5 and may use half points.</p><textarea id="names" rows="9" placeholder="Alex, 3.5&#10;Charlie, 2&#10;Harper, 4&#10;Sam, 3">${esc(setup.names)}</textarea><div class="grid" style="margin-top:20px"><label>Courts<select id="courts">${[1,2,3,4,5].map(n => `<option ${Number(setup.courts) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label>Total (min)<input id="duration" type="number" min="5" max="480" value="${esc(setup.duration)}"></label><label>Game (min)<input id="game" type="number" min="1" max="60" value="${esc(setup.game)}"></label><label>Changeover<input id="change" type="number" min="0" max="15" value="${esc(setup.change)}"></label></div><label style="margin-top:16px">Court numbers <span class="muted">(optional)</span><input id="court-numbers" value="${esc(setup.courtNumbers)}" placeholder="e.g. 3, 4"></label><div id="preview" class="preview" aria-live="polite"></div><p id="setup-error" class="error" role="alert" tabindex="-1"></p><button class="primary wide" data-action="suggest">Suggest balanced pairs</button></section>`;
    ['names','courts','duration','game','change','court-numbers'].forEach(id => document.getElementById(id).addEventListener('input', updateSetup));
    updateSetup();
  }
  function readSetup() { return { names: document.getElementById('names').value, courts: Number(document.getElementById('courts').value), duration: Number(document.getElementById('duration').value), game: Number(document.getElementById('game').value), change: Number(document.getElementById('change').value), courtNumbers: document.getElementById('court-numbers').value } }
  function updateSetup() {
    setup = readSetup(); storeDraft();
    try { const players = E.parsePlayers(setup.names), plan = E.capacity(players.length / 2, setup); E.courtNumbers(setup.courtNumbers, setup.courts); document.getElementById('preview').innerHTML = plan.games ? `<strong>${players.length / 2} fixed teams · ${plan.games} matches each</strong><p>${plan.rounds} rounds · ${plan.minutes} of ${setup.duration} minutes planned.</p>` : '<p>Not enough time for every team to play equally.</p>'; document.getElementById('setup-error').textContent = ''; }
    catch (error) { document.getElementById('preview').textContent = error.message; }
  }
  function suggest() {
    try {
      setup = readSetup(); const players = E.parsePlayers(setup.names), config = { courts: setup.courts, duration: setup.duration, game: setup.game, change: setup.change, courtNumbers: E.courtNumbers(setup.courtNumbers, setup.courts) };
      if (!E.capacity(players.length / 2, config).games) throw Error('Not enough time for every team to play equally.');
      pairing = { players, config, pairs: E.makePairs(players, [], Date.now()) }; previousPairs = []; selected = null; renderPairs();
    } catch (error) { const el = document.getElementById('setup-error'); el.textContent = error.message; el.focus(); }
  }
  function balance() { const totals = pairing.pairs.map(pair => pair.skill), spread = Math.max(...totals) - Math.min(...totals); return { spread, label: spread <= .5 ? 'Very balanced' : spread <= 1 ? 'Balanced' : spread <= 2 ? 'Some grade difference' : 'Large grade difference' }; }
  function renderPairs() {
    options.innerHTML = '';
    const quality = balance();
    app.innerHTML = `<section class="card"><p class="eyebrow">STEP 2 OF 2</p><h2>Choose the fixed teams</h2><p class="help">Tap two players to swap them. Lock requested teams, then shuffle the rest until you are happy.</p><div class="balance"><strong>${quality.label}</strong><br><span class="compact">Strongest ${Math.max(...pairing.pairs.map(p => p.skill))} · Weakest ${Math.min(...pairing.pairs.map(p => p.skill))} · Difference ${quality.spread}</span></div><div class="pair-builder">${pairing.pairs.map((pair, index) => `<article class="pair-card ${pair.locked ? 'locked' : ''}"><div class="pair-card-head"><strong>Team ${index + 1}</strong><span class="pair-strength">Combined ${pair.skill}</span></div><div class="pair-members">${pair.players.map((id, member) => `${member ? '<span class="pair-plus">+</span>' : ''}<button class="player-choice ${selected === id ? 'selected' : ''}" data-player="${id}">${esc(pairing.players[id].name)}<small>Grade ${pairing.players[id].skill}${pairing.players[id].grade ? '' : '*'}</small></button>`).join('')}</div><button class="wide" data-lock="${index}">${pair.locked ? 'Unlock team' : 'Lock requested team'}</button></article>`).join('')}</div><p class="help">* Grade 3 used where no grade was entered.</p><div class="pair-actions"><button data-action="back-setup">Back</button><button data-action="shuffle">Shuffle unlocked</button><button data-action="undo-pairs" ${previousPairs.length ? '' : 'disabled'}>Undo</button><button data-action="reset-pairs">Best balance</button></div><button class="primary wide" data-action="confirm-pairs">Confirm teams and create tournament</button></section>`;
  }
  function snapshotPairs() { previousPairs.push(JSON.parse(JSON.stringify(pairing.pairs))); if (previousPairs.length > 20) previousPairs.shift(); }
  function recalcPairs() { pairing.pairs.forEach((pair, id) => { pair.id = id; pair.skill = pair.players.reduce((sum, player) => sum + pairing.players[player].skill, 0); }); }
  function shufflePairs(bestOnly = false) {
    snapshotPairs();
    const locked = pairing.pairs.filter(pair => pair.locked).map(pair => pair.players);
    const signature = pairs => pairs.map(pair => pair.players.slice().sort((a, b) => a - b).join(':')).sort().join('|');
    const current = signature(pairing.pairs);
    let candidate;
    for (let attempt = 0; attempt < 12; attempt++) {
      candidate = E.makePairs(pairing.players, locked, bestOnly ? 42 : Date.now() + Math.random() * 100000 + attempt, !bestOnly);
      if (bestOnly || signature(candidate) !== current) break;
    }
    pairing.pairs = candidate; selected = null; renderPairs();
  }
  function confirmPairs() {
    const generated = E.schedule(pairing.pairs, pairing.config, Date.now());
    state = { version: 1, kind: 'fixed-pairs', players: pairing.players, pairs: pairing.pairs.map(pair => ({ ...pair, locked: !!pair.locked })), config: pairing.config, ...generated, current: 0, drafts: {}, timer: null, startedAt: Date.now() };
    save(); pairing = null; tab = 'round'; render(); window.scrollTo(0, 0);
  }
  function playerLabel(id) { const p = state.players[id]; return `<span class="player-label"><span class="player-name">${esc(p.name)}</span><small class="player-grade">${p.skill}${p.grade ? '' : '*'}</small></span>`; }
  function teamView(pairId) { const pair = state.pairs[pairId]; return `<div class="team"><span class="team-name">${pair.players.map(playerLabel).join('<span class="pair-plus">+</span>')}</span><small class="team-grade">Combined grade ${pair.skill}</small></div>`; }
  function matchView(match, prefix) { return `<div class="match-list">${match.pairs.map((id, side) => `<div class="pair-row">${teamView(id)}${prefix ? `<label class="pair-score"><span class="sr-only">${esc(pairName(state.pairs[id]))} score</span><input id="${prefix}-${side}" data-score="${prefix}" data-side="${side}" type="number" min="0" max="99" value="${esc(state.drafts[prefix]?.[side] ?? match.score?.[side] ?? '')}"></label>` : match.score ? `<b class="pair-result">${match.score[side]}</b>` : ''}</div>`).join('')}</div>`; }
  function menu() { return `<details class="options-menu" id="tournament-options"><summary aria-label="Tournament options">•••</summary><div class="options-panel"><button data-action="export">Export backup</button><button data-action="import">Import backup</button><input id="import-file" type="file" accept="application/json,.json" hidden><button class="danger" data-action="new">New tournament</button></div></details>`; }
  function roundView() {
    if (state.current === state.rounds.length) return `<section class="card success"><p class="eyebrow">THAT’S A WRAP</p><strong>${state.plan.games} matches each</strong><p>The final team standings are ready.</p><button class="primary wide" data-tab="standings">See final standings</button></section>`;
    const round = state.rounds[state.current];
    return `<div class="round-heading"><h2>Round ${state.current + 1} <span class="muted">of ${state.rounds.length}</span></h2><span class="pill">${state.plan.games} each</span></div><div class="progress"><div style="width:${state.current / state.rounds.length * 100}%"></div></div><section class="timer-card"><div class="timer-row"><div><div class="eyebrow" style="color:#dbeafe">ROUND TIMER</div><div id="clock" class="clock">${clockText()}</div></div><button data-action="timer">${state.timer?.end ? 'Pause' : state.timer ? 'Resume' : 'Start game'}</button></div><p id="timer-note" aria-live="polite"></p><p>${state.config.change} min changeover between rounds.</p><div class="finish-estimate"><strong id="finish-time"></strong><p id="finish-note"></p></div></section>${round.matches.map((match, index) => `<section class="card court-card"><div class="court-head"><span class="court-number">COURT ${state.config.courtNumbers[index]}</span><span class="muted">Fixed teams</span></div>${matchView(match, 'court-' + index)}</section>`).join('')}<aside class="rest"><h3>${round.resting.length ? 'Resting this round' : 'Every team is on court'}</h3><p>${round.resting.map(id => esc(pairName(state.pairs[id]))).join(' · ')}</p></aside><p id="result-error" class="error" role="alert"></p><button class="primary wide" data-action="advance">${state.current + 1 === state.rounds.length ? 'Save results and finish' : 'Save results and next round'}</button>`;
  }
  function standingsView() { return `<section class="card"><p class="eyebrow">TEAM STANDINGS</p><h2>${state.current === state.rounds.length ? 'Final results' : 'The story so far'}</h2>${E.standings(state.pairs, state.rounds).map(row => `<div class="stand-row"><span class="rank">${row.rank}</span><div><span class="name">${esc(pairName(row))}</span><small>${row.played}/${state.plan.games} played · ${row.wins}W ${row.draws}D ${row.losses}L</small><small>For ${row.for} · Against ${row.against} · Difference ${row.diff > 0 ? '+' : ''}${row.diff}</small></div><div class="points">${row.points}<small>POINTS</small></div></div>`).join('')}</section>`; }
  function teamsView() { return `<section class="card"><h2>Fixed teams</h2><p class="help">These partners stay together for the whole tournament.</p>${state.pairs.map((pair, i) => `<article class="history-match"><strong>Team ${i + 1}</strong>${teamView(pair.id)}</article>`).join('')}</section>`; }
  function historyView() { return `<section class="card"><h2>Results and schedule</h2>${state.rounds.map((round, ri) => `<details ${ri === Math.max(0, state.current - 1) ? 'open' : ''}><summary>Round ${ri + 1}</summary>${round.matches.map((match, mi) => `<div class="history-match"><span class="court-number">COURT ${state.config.courtNumbers[mi]}</span>${matchView(match)}${match.score ? `<button data-edit="${ri},${mi}">Edit score</button>` : '<span class="muted">Not played yet</span>'}</div>`).join('')}</details>`).join('')}</section>`; }
  function render() { clearInterval(tick); document.body.classList.add('running'); options.innerHTML = menu(); app.innerHTML = `<nav class="tabs">${[['round','Current round'],['standings','Standings'],['teams','Teams'],['history','Results']].map(([id,label]) => `<button data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>${tab === 'round' ? roundView() : tab === 'standings' ? standingsView() : tab === 'teams' ? teamsView() : historyView()}`; if (tab === 'round' && state.current < state.rounds.length) { updateClock(); tick = setInterval(updateClock, 250); } }
  function remaining() { return state.timer?.end ? Math.max(0, state.timer.end - Date.now()) : state.timer?.remaining ?? state.config.game * 60000; }
  function clockText() { const seconds = Math.ceil(remaining() / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; }
  function updateClock() {
    const el = document.getElementById('clock'); if (!el || !state) return;
    const ms = remaining(); el.textContent = clockText();
    document.getElementById('timer-note').textContent = !state.timer ? 'Ready when you are.' : ms === 0 ? 'Time! Finish the rally, then enter final scores.' : state.timer.end === null ? 'Paused. Extra pauses can extend your event.' : 'Game on. Timer continues if you leave this page.';
    const estimate = E.finishEstimate(state, Date.now());
    const time = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    document.getElementById('finish-time').textContent = 'Estimated finish ' + time(estimate.finish);
    document.getElementById('finish-note').textContent = (estimate.deadline ? 'Budget ends ' + time(estimate.deadline) + '. ' : '') + (estimate.overrun >= 30000 ? 'About ' + Math.max(1, Math.round(estimate.overrun / 60000)) + ' min over budget. ' : '') + 'Includes changeovers.';
    document.querySelector('.finish-estimate').classList.toggle('over-budget', estimate.overrun >= 30000);
    document.querySelector('[data-action="timer"]').disabled = !!state.timer && ms === 0;
  }
  function toggleTimer() { state.startedAt ||= Date.now(); if (state.timer?.end) state.timer = { remaining: remaining(), end: null }; else state.timer = { remaining: remaining(), end: Date.now() + remaining() }; save(); render(); }
  function advance() {
    const round = state.rounds[state.current], scores = [];
    for (let i = 0; i < round.matches.length; i++) {
      const inputs = [0, 1].map(side => document.getElementById(`court-${i}-${side}`).value);
      const values = inputs.map(Number);
      if (inputs.some(value => value.trim() === '') || values.some(value => !Number.isInteger(value) || value < 0 || value > 99)) { document.getElementById('result-error').textContent = 'Enter a whole score from 0 to 99 for every team.'; return; }
      scores.push(values);
    }
    const finish = () => {
      round.matches.forEach((match, index) => { match.score = scores[index]; }); state.current++; state.timer = null; state.drafts = {}; state.readyAt = Date.now() + state.config.change * 60000; save(); render(); window.scrollTo(0, 0);
    };
    if (state.timer && remaining() > 0) confirmAction('Finish this round early?', 'The timer still has time remaining. Save these scores and move on?', finish);
    else finish();
  }
  function exportBackup() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `junior-team-doubles-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function confirmAction(title, text, action) { const dialog = document.getElementById('confirm'); document.getElementById('confirm-title').textContent = title; document.getElementById('confirm-text').textContent = text; dialog.returnValue = ''; dialog.showModal(); dialog.onclose = () => { if (dialog.returnValue === 'yes') action(); }; }
  async function importBackup(file) { try { const imported = E.validate(JSON.parse(await file.text())); confirmAction('Restore this tournament?', `${imported.pairs.length} fixed teams and ${imported.rounds.length} rounds. This replaces the current tournament. Export it first if you want to keep it.`, () => { state = imported; save(); tab = 'round'; render(); }); } catch (error) { warning(error.message); } }
  document.addEventListener('input', event => { if (!state || !event.target.matches('[data-score]')) return; const key = event.target.dataset.score; state.drafts[key] ||= ['', '']; state.drafts[key][Number(event.target.dataset.side)] = event.target.value; save(); });
  document.addEventListener('click', event => {
    const menu = document.getElementById('tournament-options');
    if (menu && (!menu.contains(event.target) || event.target.closest('button'))) menu.open = false;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const tabTarget = event.target.closest('[data-tab]')?.dataset.tab;
    if (tabTarget) { tab = tabTarget; render(); return; }
    if (event.target.closest('[data-player]')) { const id = Number(event.target.closest('[data-player]').dataset.player); if (selected === null) selected = id; else if (selected === id) selected = null; else { snapshotPairs(); const a = pairing.pairs.find(p => p.players.includes(selected)), b = pairing.pairs.find(p => p.players.includes(id)); const ai = a.players.indexOf(selected), bi = b.players.indexOf(id); [a.players[ai], b.players[bi]] = [b.players[bi], a.players[ai]]; a.locked = b.locked = false; selected = null; recalcPairs(); } renderPairs(); return; }
    if (event.target.matches('[data-lock]')) { snapshotPairs(); const pair = pairing.pairs[Number(event.target.dataset.lock)]; pair.locked = !pair.locked; selected = null; renderPairs(); return; }
    if (event.target.matches('[data-edit]')) { const [ri, mi] = event.target.dataset.edit.split(',').map(Number), match = state.rounds[ri].matches[mi], value = prompt(`Correct score for ${pairName(state.pairs[match.pairs[0]])} then ${pairName(state.pairs[match.pairs[1]])}`, match.score.join('-')); if (value !== null) { const parts = value.trim().match(/^(\d{1,2})\s*[-,:]\s*(\d{1,2})$/), score = parts ? parts.slice(1).map(Number) : null; if (E.validScore(score)) { match.score = score; save(); render(); } else warning('Enter two scores from 0 to 99, such as 15-12.'); } return; }
    if (!action) return;
    if (action === 'suggest') suggest();
    if (action === 'back-setup') { pairing = null; setupView(); }
    if (action === 'shuffle') shufflePairs(false);
    if (action === 'reset-pairs') shufflePairs(true);
    if (action === 'undo-pairs' && previousPairs.length) { pairing.pairs = previousPairs.pop(); selected = null; renderPairs(); }
    if (action === 'confirm-pairs') confirmPairs();
    if (action === 'timer') toggleTimer();
    if (action === 'advance') advance();
    if (action === 'export') exportBackup();
    if (action === 'import') document.getElementById('import-file').click();
    if (action === 'new') confirmAction('Start a new tournament?', 'Export a backup first if you want to keep these results.', () => { try { localStorage.removeItem(STORE); } catch { warning('This tournament could not be cleared. Export a backup and try again.'); return; } state = null; warning(''); setupView(); });
  });
  document.addEventListener('change', event => { if (event.target.id === 'import-file' && event.target.files[0]) importBackup(event.target.files[0]); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => { document.getElementById('offline-status').textContent = 'Ready for offline use.'; }).catch(() => { document.getElementById('offline-status').textContent = 'Offline setup unavailable.'; });
  const saved = load(STORE); if (saved) { try { state = E.validate(saved); render(); } catch (error) { warning(`${error.message} Export or reset the stored data.`); setupView(); } } else setupView();
})();
