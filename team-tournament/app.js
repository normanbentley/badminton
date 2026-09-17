'use strict';
(() => {
  const E = window.JuniorTeamTournament, app = document.getElementById('app'), options = document.getElementById('options-slot');
  const STORE = 'junior-team-doubles-v1', DRAFT = 'junior-team-doubles-setup-v1';
  const defaults = { names: '', mode: 'equal', maxGame: 10, courts: 2, duration: 90, game: 10, change: 2, courtNumbers: '' };
  let state = null, setup = { ...defaults, ...load(DRAFT) }, pairing = null, previousPairs = [], selected = null, tab = 'round';
  const HISTORY = STORE + '-history';
  let archive = [], archiveBlocked = false, showingArchive = false, installPrompt = null;
  let storedSnapshot = null, historySnapshot = null, stale = false;
  try { storedSnapshot = localStorage.getItem(STORE); historySnapshot = localStorage.getItem(HISTORY); } catch {}
  function storageCurrent() {
    try { if (localStorage.getItem(STORE) !== storedSnapshot || localStorage.getItem(HISTORY) !== historySnapshot) stale = true; } catch { return !stale; }
    if (!stale) return true;
    warning('Tournament data changed in another tab. Reload before making changes.');
    const button = document.createElement('button'); button.textContent = 'Reload latest'; button.dataset.action = 'reload-latest';
    document.getElementById('storage-warning').append(' ', button);
    return false;
  }
  let wakeLock = null, wakePending = false, wakeFailed = false, audioContext = null;
  let keepAwake = true, sound = false;
  try { const prefs = JSON.parse(localStorage.getItem(STORE + '-preferences')); if (prefs) { keepAwake = prefs.keepAwake !== false; sound = prefs.sound === true; } } catch {}
  const running = () => !!state?.timer?.end && remaining() > 0 && state.current < state.rounds.length;
  function wakeStatus() {
    const el = document.getElementById('wake-status');
    if (el) el.textContent = !keepAwake ? 'Screen awake is off.' : !navigator.wakeLock ? 'Screen awake is unavailable in this browser.' : wakeLock && !wakeLock.released ? 'Keeping screen awake.' : wakeFailed ? 'Screen awake unavailable. Check battery-saving settings.' : 'Screen stays awake while the timer runs.';
  }
  async function syncWake() {
    const wanted = !stale && keepAwake && running() && document.visibilityState === 'visible';
    if (!wanted && wakeLock) { const lock = wakeLock; wakeLock = null; try { await lock.release(); } catch {} }
    if (wanted && navigator.wakeLock && !wakeLock && !wakePending && !wakeFailed) {
      wakePending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) { wakeLock = null; wakeFailed = true; } wakeStatus(); });
        if (stale || !keepAwake || !running() || document.visibilityState !== 'visible') { wakeLock = null; await lock.release(); }
      } catch { wakeFailed = true; }
      finally { wakePending = false; }
    }
    wakeStatus();
  }
  function prepareAudio() {
    if (!sound) return;
    try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch {}
  }
  function chime() {
    if (!sound || audioContext?.state !== 'running') return;
    for (let i = 0; i < 3; i++) {
      const tone = audioContext.createOscillator(), gain = audioContext.createGain();
      const start = audioContext.currentTime + i * .3;
      tone.frequency.value = 880; gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.2, start + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .22);
      tone.connect(gain); gain.connect(audioContext.destination); tone.start(start); tone.stop(start + .25);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    }
  }
  function timerTools() {
    return `<details class="timer-tools"><summary>Timer settings</summary><label><input type="checkbox" id="keep-awake" ${keepAwake ? 'checked' : ''}> Keep screen awake</label><label><input type="checkbox" id="sound-alert" ${sound ? 'checked' : ''}> Sound at end of round</label><button data-action="test-alert">Test alert</button><p>Vibration where supported. Keep the app visible for alerts; sound uses your media volume. Finish estimates include changeovers and update as you wait or pause.</p><p id="wake-status"></p></details><div class="finish-estimate"><strong id="finish-time"></strong><p id="finish-note"></p></div>`;
  }

  const esc = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function warning(message) { const el = document.getElementById('storage-warning'); el.textContent = message; el.hidden = !message; }
  function save() {
    if (!storageCurrent()) return false;
    try { const raw = JSON.stringify(state); localStorage.setItem(STORE, raw); storedSnapshot = raw; warning(''); document.getElementById('save-status').textContent = 'Saved on this device only.'; return true; }
    catch { warning('This tournament could not be saved. Export a backup now and keep this page open.'); document.getElementById('save-status').textContent = 'Save failed.'; return false; }
  }
  function storeDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(setup)); } catch { warning('Your setup could not be saved on this device.'); } }
  function pairName(pair) { return pair.players.map(id => state.players[id].name).join(' + '); }
  function setupView() {
    syncWake(); document.body.classList.remove('running');
    options.innerHTML = menu();
    app.innerHTML = `<section class="card">
      <p class="eyebrow">STEP 1 OF 2</p><h2>Add the players</h2>
      <label for="names">Who's playing?</label>
      <p class="help">Paste one player per line. Add an optional grade after a comma. Grades run from 1 to 5 and may use half points.</p>
      <textarea id="names" rows="9" placeholder="Alex, 3.5&#10;Charlie, 2&#10;Harper, 4&#10;Sam, 3">${esc(setup.names)}</textarea>
      <fieldset class="schedule-modes"><legend>Match schedule</legend>
        <label><input id="mode-equal" name="mode" type="radio" value="equal" ${setup.mode !== 'round-robin' ? 'checked' : ''}><span>Equal matches<small>Fit equal games into the time available. Opponents may repeat.</small></span></label>
        <label><input id="mode-round-robin" name="mode" type="radio" value="round-robin" ${setup.mode === 'round-robin' ? 'checked' : ''} aria-describedby="round-robin-status"><span>Round robin<small>Each team plays every other team once.</small></span></label>
      </fieldset>
      <p id="round-robin-status" class="help" aria-live="polite"></p>
      <div class="grid">
        <label>Courts<select id="courts">${[1,2,3,4,5].map(n => `<option ${Number(setup.courts) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Available (min)<input id="duration" type="number" min="5" max="480" value="${esc(setup.duration)}"></label>
        <label id="game-field">Game (min)<input id="game" type="number" min="1" max="60" value="${esc(setup.game)}"></label>
        <label id="max-game-field">Game cap (min)<input id="max-game" type="number" min="5" max="60" value="${esc(setup.maxGame)}" aria-describedby="game-cap-help"></label>
        <label>Changeover (min)<input id="change" type="number" min="0" max="15" value="${esc(setup.change)}"></label>
      </div>
      <p id="game-cap-help" class="help">Round robin uses games of at least 5 minutes, up to your cap. Spare time stays free.</p>
      <label class="court-numbers-label">Court numbers <span class="muted">(optional)</span><input id="court-numbers" value="${esc(setup.courtNumbers)}" placeholder="e.g. 3, 4"></label>
      <div id="preview" class="preview" aria-live="polite"></div>
      <p id="setup-error" class="error" role="alert" tabindex="-1"></p>
      <button class="primary wide" data-action="suggest">Suggest balanced pairs</button>
    </section>`;
    ['names','courts','duration','game','max-game','change','court-numbers','mode-equal','mode-round-robin'].forEach(id => document.getElementById(id).addEventListener('input', updateSetup));
    updateSetup();
  }
  function readSetup() {
    return {
      names: document.getElementById('names').value,
      mode: document.querySelector('input[name="mode"]:checked').value,
      courts: Number(document.getElementById('courts').value), duration: Number(document.getElementById('duration').value),
      game: Number(document.getElementById('game').value), maxGame: Number(document.getElementById('max-game').value),
      change: Number(document.getElementById('change').value), courtNumbers: document.getElementById('court-numbers').value
    };
  }
  function updateSetup() {
    setup = readSetup(); storeDraft();
    const robin = setup.mode === 'round-robin', option = document.getElementById('mode-round-robin');
    const status = document.getElementById('round-robin-status'), preview = document.getElementById('preview');
    document.getElementById('game-field').hidden = robin;
    document.getElementById('max-game-field').hidden = !robin;
    document.getElementById('game-cap-help').hidden = !robin;
    document.getElementById('setup-error').textContent = '';
    document.querySelector('[data-action="suggest"]').disabled = false;
    option.disabled = false;
    status.textContent = 'Add players and available time to check whether round robin fits.';
    try {
      const players = E.parsePlayers(setup.names);
      const eligibility = E.capacity(players.length / 2, { ...setup, mode: 'round-robin', maxGame: 10 });
      option.disabled = !eligibility.feasible;
      status.textContent = eligibility.feasible
        ? `Round robin fits: ${eligibility.games} matches each across ${eligibility.rounds} rounds.`
        : robin ? 'Round robin cannot fit 5-minute games yet.' : E.roundRobinError(eligibility);
      E.courtNumbers(setup.courtNumbers, setup.courts);
      const plan = E.capacity(players.length / 2, setup);
      if (robin && !plan.feasible) {
        preview.textContent = E.roundRobinError(plan);
        document.querySelector('[data-action="suggest"]').disabled = true;
        return;
      }
      preview.innerHTML = plan.games
        ? `<strong>${players.length / 2} fixed teams · ${plan.games} matches each</strong><p>${plan.rounds} rounds · ${robin ? `${plan.game}-minute games · ` : ''}${plan.minutes} of ${setup.duration} minutes planned.</p>${robin ? `<p>${plan.spare} minutes spare for warm-up, breaks or friendly games.</p>` : ''}`
        : '<p>Not enough time for every team to play equally.</p>';
    } catch (error) { preview.textContent = error.message; }
  }
  function suggest() {
    try {
      setup = readSetup(); storeDraft();
      const players = E.parsePlayers(setup.names);
      const config = { mode: setup.mode, courts: setup.courts, duration: setup.duration, game: setup.game, change: setup.change, courtNumbers: E.courtNumbers(setup.courtNumbers, setup.courts) };
      if (config.mode === 'round-robin') config.maxGame = setup.maxGame;
      const plan = E.capacity(players.length / 2, config);
      if (config.mode === 'round-robin') {
        if (!plan.feasible) throw Error(E.roundRobinError(plan));
        config.game = plan.game;
      } else if (!plan.games) throw Error('Not enough time for every team to play equally.');
      pairing = { players, config, pairs: E.makePairs(players, [], Date.now()) }; previousPairs = []; selected = null; renderPairs();
    } catch (error) { const el = document.getElementById('setup-error'); el.textContent = error.message; el.focus(); }
  }
  function balance() { const totals = pairing.pairs.map(pair => pair.skill), spread = Math.max(...totals) - Math.min(...totals); return { spread, label: spread <= .5 ? 'Very balanced' : spread <= 1 ? 'Balanced' : spread <= 2 ? 'Some grade difference' : 'Large grade difference' }; }
  function renderPairs() {
    options.innerHTML = '';
    const quality = balance(), plan = E.capacity(pairing.pairs.length, pairing.config);
    app.innerHTML = `<section class="card"><p class="eyebrow">STEP 2 OF 2</p><h2>Choose the fixed teams</h2><p class="pairing-plan">${pairing.config.mode === 'round-robin' ? 'Round robin' : 'Equal matches'} · ${plan.games} matches each · ${pairing.config.game}-minute games · ${plan.minutes} minutes planned</p><p class="help">Tap two players to swap them. Lock requested teams, then shuffle the rest until you are happy.</p><div class="balance"><strong>${quality.label}</strong><br><span class="compact">Strongest ${Math.max(...pairing.pairs.map(p => p.skill))} · Weakest ${Math.min(...pairing.pairs.map(p => p.skill))} · Difference ${quality.spread}</span></div><div class="pair-builder">${pairing.pairs.map((pair, index) => `<article class="pair-card ${pair.locked ? 'locked' : ''}"><div class="pair-card-head"><strong>Team ${index + 1}</strong><span class="pair-strength">Combined ${pair.skill}</span></div><div class="pair-members">${pair.players.map((id, member) => `${member ? '<span class="pair-plus">+</span>' : ''}<button class="player-choice ${selected === id ? 'selected' : ''}" data-player="${id}">${esc(pairing.players[id].name)}<small>Grade ${pairing.players[id].skill}${pairing.players[id].grade ? '' : '*'}</small></button>`).join('')}</div><button class="wide" data-lock="${index}">${pair.locked ? 'Unlock team' : 'Lock requested team'}</button></article>`).join('')}</div><p class="help">* Grade 3 used where no grade was entered.</p><div class="pair-actions"><button data-action="back-setup">Back</button><button data-action="shuffle">Shuffle unlocked</button><button data-action="undo-pairs" ${previousPairs.length ? '' : 'disabled'}>Undo</button><button data-action="reset-pairs">Best balance</button></div><button class="primary wide" data-action="confirm-pairs">Confirm teams and create tournament</button></section>`;
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
  function menu() {
    return '<details class="options-menu" id="tournament-options"><summary aria-label="Tournament options">•••</summary><div class="options-panel">'
      + '<button data-action="archive">Tournament history</button>'
      + (state ? '<button data-action="export">Export backup</button>' : '')
      + '<button data-action="import">Import backup</button><input id="import-file" type="file" accept="application/json,.json" hidden>'
      + (state?.current ? '<button data-action="undo-round">Undo last round</button>' : '')
      + '<button data-action="install">Install app</button>'
      + (state ? '<button class="danger" data-action="new">New tournament</button>' : '') + '</div></details>';
  }
  function nextRoundView() {
    const next = state.rounds[state.current + 1];
    if (!next) return '<p class="help next-round">Final round. No more games after this one.</p>';
    return '<details class="card next-round"><summary>Up next: round ' + (state.current + 2) + '</summary>'
      + next.matches.map((match, i) => '<div class="next-court"><span class="court-number">COURT ' + state.config.courtNumbers[i] + '</span>' + matchView(match) + '</div>').join('')
      + '<p class="help">Resting: ' + (next.resting.length ? next.resting.map(id => esc(pairName(state.pairs[id]))).join(' · ') : 'Nobody') + '</p></details>';
  }
  function storeHistory(next) {
    if (!storageCurrent()) return false;
    try { const raw = JSON.stringify(next); localStorage.setItem(HISTORY, raw); historySnapshot = raw; archive = next; return true; }
    catch { warning('Tournament history could not be saved. Export a backup before switching tournaments.'); return false; }
  }
  function preserveCurrent() {
    if (!state) return true;
    if (archiveBlocked) { warning('Tournament history is unavailable. Export your current tournament before leaving.'); return false; }
    return storeHistory(E.archiveTournament(archive, state, Date.now(), crypto.randomUUID()));
  }
  function restoreTournament(tournament, fromHistory = false) {
    if (!preserveCurrent()) return;
    const copy = structuredClone(tournament);
    if (copy.timer?.end) copy.timer = { remaining: Math.max(0, copy.timer.end - Date.now()), end: null };
    try { const raw = JSON.stringify(copy); localStorage.setItem(STORE, raw); storedSnapshot = raw; }
    catch { warning('The restored tournament could not be saved. Your current tournament is unchanged.'); return; }
    state = copy; showingArchive = false; pairing = null; tab = fromHistory && state.current === state.rounds.length ? 'standings' : 'round';
    warning(''); render(); window.scrollTo(0, 0);
  }
  function archiveView() {
    const date = stamp => new Date(stamp).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return '<section class="card"><div class="archive-heading"><h2>Tournament history</h2><button data-action="close-archive">Back</button></div><p class="help">Saved on this browser. Previous versions stay separate.</p>'
      + (archive.length ? archive.map((entry, index) => '<article class="archive-entry"><h3>' + esc(date(entry.tournament.startedAt || entry.savedAt)) + '</h3><p class="help">' + entry.tournament.pairs.length + ' fixed teams · ' + entry.tournament.current + '/' + entry.tournament.rounds.length + ' rounds completed</p><p class="archive-roster">' + esc(entry.tournament.players.slice(0, 4).map(p => p.name).join(', ')) + '</p><div class="actions"><button data-open-archive="' + index + '">' + (entry.tournament.current === entry.tournament.rounds.length ? 'View results' : 'Resume') + '</button><button data-export-archive="' + index + '">Export</button><button class="danger" data-delete-archive="' + index + '">Delete</button></div></article>').join('') : '<p class="help archive-empty">No saved tournaments yet. Events are kept here when completed, replaced or opened in history.</p>') + '</section>';
  }
  function download(data, filename) {
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function installApp() {
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null;
      try { await prompt.prompt(); await prompt.userChoice; } catch { document.getElementById('install-help').showModal(); }
    } else document.getElementById('install-help').showModal();
  }
  function roundView() {
    if (state.current === state.rounds.length) return `<section class="card success"><p class="eyebrow">THAT’S A WRAP</p><strong>${state.plan.games} matches each</strong><p>The final team standings are ready.</p><button class="primary wide" data-tab="standings">See final standings</button></section>`;
    const round = state.rounds[state.current];
    return `${state.config.mode === 'round-robin' ? '<p class="help">Round robin: each opponent once.</p>' : ''}<div class="round-heading"><h2>Round ${state.current + 1} <span class="muted">of ${state.rounds.length}</span></h2><span class="pill">${state.plan.games} each</span></div><div class="progress"><div style="width:${state.current / state.rounds.length * 100}%"></div></div><section class="timer-card"><div class="timer-row"><div><div class="eyebrow" style="color:#dbeafe">ROUND TIMER</div><div id="clock" class="clock">${clockText()}</div></div><button data-action="timer">${state.timer?.end ? 'Pause' : state.timer ? 'Resume' : 'Start game'}</button></div><p id="timer-note" aria-live="polite"></p><p>${state.config.change} min changeover between rounds.</p>${timerTools()}</section>${round.matches.map((match, index) => `<section class="card court-card"><div class="court-head"><span class="court-number">COURT ${state.config.courtNumbers[index]}</span><span class="muted">Fixed teams</span></div>${matchView(match, 'court-' + index)}</section>`).join('')}<aside class="rest"><h3>${round.resting.length ? 'Resting this round' : 'Every team is on court'}</h3><p>${round.resting.map(id => esc(pairName(state.pairs[id]))).join(' · ')}</p></aside><p id="result-error" class="error" role="alert"></p><button class="primary wide" data-action="advance">${state.current + 1 === state.rounds.length ? 'Save results and finish' : 'Save results and next round'}</button>${nextRoundView()}`;
  }
  function standingsView() { return `<section class="card"><p class="eyebrow">TEAM STANDINGS</p><h2>${state.current === state.rounds.length ? 'Final results' : 'The story so far'}</h2>${E.standings(state.pairs, state.rounds).map(row => `<div class="stand-row"><span class="rank">${row.rank}</span><div><span class="name">${esc(pairName(row))}</span><small>${row.played}/${state.plan.games} played · ${row.wins}W ${row.draws}D ${row.losses}L</small><small>For ${row.for} · Against ${row.against} · Difference ${row.diff > 0 ? '+' : ''}${row.diff}</small></div><div class="points">${row.points}<small>POINTS</small></div></div>`).join('')}</section>`; }
  function teamsView() { return `<section class="card"><h2>Fixed teams</h2><p class="help">These partners stay together for the whole tournament.</p>${state.pairs.map((pair, i) => `<article class="history-match"><strong>Team ${i + 1}</strong>${teamView(pair.id)}</article>`).join('')}</section>`; }
  function historyView() { return `<section class="card"><h2>Matches and scores</h2>${state.rounds.map((round, ri) => `<details ${ri === Math.max(0, state.current - 1) ? 'open' : ''}><summary>Round ${ri + 1}</summary>${round.matches.map((match, mi) => `<div class="history-match"><span class="court-number">COURT ${state.config.courtNumbers[mi]}</span>${matchView(match)}${match.score ? `<button data-edit="${ri},${mi}">Edit score</button>` : '<span class="muted">Not played yet</span>'}</div>`).join('')}</details>`).join('')}</section>`; }
  function sheetView() {
    const rows = E.scoreSheet(state.players, state.pairs, state.rounds);
    return `<section class="card score-sheet-card">
      <div class="sheet-heading"><h2>Score sheet</h2><details class="sheet-help"><summary aria-label="How to read the score sheet">How to read</summary><div><p id="sheet-legend">Large number: competition points (win 2, draw 1, loss 0). Small box: rally points scored. Blank: not played. REST: no match.</p><p>Pairs A to Z, using the first name shown. Totals count competition points from saved results. Enter or correct scores in Current round or Matches.</p><p id="sheet-scroll-hint">Swipe sideways for later rounds. Pair names stay visible.</p></div></details></div>
      <div class="score-sheet-scroll" role="region" aria-label="Tournament score sheet" aria-describedby="sheet-scroll-hint" tabindex="0">
        <table class="score-sheet" aria-describedby="sheet-legend">
          <caption class="sr-only">Competition points and rally scores for each pair, by round</caption>
          <thead><tr><th scope="col" class="sheet-pair">Pair</th>${state.rounds.map((_, index) => `<th scope="col">Round ${index + 1}</th>`).join('')}<th scope="col" class="sheet-total">Total</th></tr></thead>
          <tbody>${rows.map(row => `<tr data-sheet-pair="${row.id}">
            <th scope="row" class="sheet-pair"><span>${esc(row.name)}</span></th>
            ${row.cells.map((cell, index) => `<td data-sheet-round="${index}" class="sheet-${cell.status}">${cell.status === 'rest'
              ? '<span class="sheet-rest">REST</span>'
              : cell.status === 'pending'
                ? '<div class="sheet-result"><span class="sr-only">Not played</span><span class="sheet-score" aria-hidden="true"></span></div>'
                : `<div class="sheet-result"><span class="sr-only">Competition points: </span><strong class="sheet-points">${cell.points}</strong><span class="sheet-score"><span class="sr-only">Rally points: </span><span class="sheet-rally-points">${cell.score}</span></span></div>`}</td>`).join('')}
            <td class="sheet-total"><strong>${row.total}</strong></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`;
  }
  function standingsSwitch() {
    return '<div class="standings-switch" role="group" aria-label="Standings view"><button data-tab="standings" aria-pressed="' + (tab === 'standings') + '">Ranking</button><button data-tab="sheet" aria-pressed="' + (tab === 'sheet') + '">Score sheet</button></div>';
  }
  function render() {
    syncWake(); options.innerHTML = menu(); document.body.classList.toggle('running', !!state);
    if (showingArchive) { app.innerHTML = archiveView(); return; }
    if (!state) { setupView(); return; }
    const summary = tab === 'standings' || tab === 'sheet';
    app.innerHTML = '<nav class="tabs" aria-label="Tournament views">' + [['round','Current round'],['standings','Standings'],['teams','Teams'],['history','Matches']].map(([id,label]) => '<button data-tab="' + id + '" ' + (tab === id || id === 'standings' && summary ? 'aria-current="page"' : '') + '>' + label + '</button>').join('') + '</nav>'
      + (summary ? standingsSwitch() : '') + (tab === 'round' ? roundView() : tab === 'standings' ? standingsView() : tab === 'teams' ? teamsView() : tab === 'sheet' ? sheetView() : historyView());
    updateClock();
  }
  function remaining() { return state.timer?.end ? Math.max(0, state.timer.end - Date.now()) : state.timer?.remaining ?? state.config.game * 60000; }
  function clockText() { const seconds = Math.ceil(remaining() / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; }
  function updateClock() {
    syncWake();
    if (!stale && state?.timer?.end && state.current < state.rounds.length && remaining() === 0 && !state.timer.alerted && document.visibilityState === 'visible') {
      state.timer.alerted = true; save();
      try { navigator.vibrate?.([200, 100, 200, 100, 400]); chime(); } catch {}
    }
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
  function toggleTimer() { prepareAudio(); wakeFailed = false; state.startedAt ||= Date.now(); if (state.timer?.end) state.timer = { remaining: remaining(), end: null }; else state.timer = { remaining: remaining(), end: Date.now() + remaining() }; save(); render(); }
  function advance() {
    const round = state.rounds[state.current], scores = [];
    for (let i = 0; i < round.matches.length; i++) {
      const inputs = [0, 1].map(side => document.getElementById(`court-${i}-${side}`).value);
      const values = inputs.map(Number);
      if (inputs.some(value => value.trim() === '') || values.some(value => !Number.isInteger(value) || value < 0 || value > 99)) { document.getElementById('result-error').textContent = 'Enter a whole score from 0 to 99 for every team.'; return; }
      scores.push(values);
    }
    const finish = () => {
      round.matches.forEach((match, index) => { match.score = scores[index]; }); state.current++; state.timer = null; state.drafts = {}; state.readyAt = Date.now() + state.config.change * 60000; save(); if (state.current === state.rounds.length) preserveCurrent(); render(); window.scrollTo(0, 0);
    };
    if (state.timer && remaining() > 0) confirmAction('Finish this round early?', 'The timer still has time remaining. Save these scores and move on?', finish);
    else finish();
  }
  function exportBackup() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `junior-team-doubles-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  function confirmAction(title, text, action) { const dialog = document.getElementById('confirm'); document.getElementById('confirm-title').textContent = title; document.getElementById('confirm-text').textContent = text; dialog.returnValue = ''; dialog.showModal(); dialog.onclose = () => { if (dialog.returnValue === 'yes' && storageCurrent()) action(); }; }
  async function importBackup(file) { try { const imported = E.validate(JSON.parse(await file.text())); confirmAction('Restore this tournament?', `${imported.pairs.length} fixed teams and ${imported.rounds.length} rounds. Your current tournament will be kept in Tournament history.`, () => restoreTournament(imported)); } catch (error) { warning(error.message); } }
  document.addEventListener('input', event => { if (!state || !event.target.matches('[data-score]') || !storageCurrent()) return; const key = event.target.dataset.score; state.drafts[key] ||= ['', '']; state.drafts[key][Number(event.target.dataset.side)] = event.target.value; save(); });
  document.addEventListener('click', event => {
    const menu = document.getElementById('tournament-options');
    if (menu && (!menu.contains(event.target) || event.target.closest('button'))) menu.open = false;
    const action = event.target.closest('[data-action]')?.dataset.action;
    const tabTarget = event.target.closest('[data-tab]')?.dataset.tab;
    if (tabTarget) { tab = tabTarget; render(); return; }
    if (action === 'reload-latest') { location.reload(); return; }
    if (!storageCurrent() && action !== 'export' && action !== 'install') return;
    const historyButton = event.target.closest('[data-open-archive],[data-export-archive],[data-delete-archive]');
    if (historyButton) {
      const data = historyButton.dataset, index = Number(data.openArchive ?? data.exportArchive ?? data.deleteArchive), entry = archive[index];
      if (!entry) return;
      if (data.openArchive !== undefined) confirmAction('Open saved tournament?', 'Your current event will be kept in history. Any saved timer resumes paused.', () => restoreTournament(entry.tournament, true));
      if (data.exportArchive !== undefined) download(JSON.stringify(entry.tournament, null, 2), 'junior-team-doubles-' + entry.id + '.json');
      if (data.deleteArchive !== undefined) confirmAction('Delete saved copy?', 'Only this history copy will be deleted. Your current tournament is unchanged.', () => { if (storeHistory(archive.filter(item => item.id !== entry.id))) render(); });
      return;
    }
    if (event.target.closest('[data-player]')) { const id = Number(event.target.closest('[data-player]').dataset.player); if (selected === null) selected = id; else if (selected === id) selected = null; else { snapshotPairs(); const a = pairing.pairs.find(p => p.players.includes(selected)), b = pairing.pairs.find(p => p.players.includes(id)); const ai = a.players.indexOf(selected), bi = b.players.indexOf(id); [a.players[ai], b.players[bi]] = [b.players[bi], a.players[ai]]; a.locked = b.locked = false; selected = null; recalcPairs(); } renderPairs(); return; }
    if (event.target.matches('[data-lock]')) { snapshotPairs(); const pair = pairing.pairs[Number(event.target.dataset.lock)]; pair.locked = !pair.locked; selected = null; renderPairs(); return; }
    if (event.target.matches('[data-edit]')) { const [ri, mi] = event.target.dataset.edit.split(',').map(Number), match = state.rounds[ri].matches[mi], value = prompt(`Correct score for ${pairName(state.pairs[match.pairs[0]])} then ${pairName(state.pairs[match.pairs[1]])}`, match.score.join('-')); if (value !== null) { const parts = value.trim().match(/^(\d{1,2})\s*[-,:]\s*(\d{1,2})$/), score = parts ? parts.slice(1).map(Number) : null; if (E.validScore(score)) { match.score = score; save(); render(); } else warning('Enter two scores from 0 to 99, such as 15-12.'); } return; }
    if (!action) return;
    if (action === 'archive') { preserveCurrent(); showingArchive = true; render(); window.scrollTo(0, 0); }
    if (action === 'close-archive') { showingArchive = false; render(); }
    if (action === 'install') installApp();
    if (action === 'test-alert') { prepareAudio(); try { navigator.vibrate?.([200, 100, 200]); } catch {} setTimeout(chime, 100); }
    if (action === 'undo-round' && state.current) confirmAction('Reopen the previous round?', 'Its scores become editable and are removed from standings until saved again. Unsaved scores in the current round will be discarded.', () => { state = E.reopenLastRound(state); save(); tab = 'round'; render(); });
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
    if (action === 'new') confirmAction('Start a new tournament?', 'Your current tournament will be kept in Tournament history on this browser.', () => { if (!preserveCurrent()) return; try { localStorage.removeItem(STORE); storedSnapshot = null; } catch { warning('This tournament could not be cleared. Export a backup and try again.'); return; } state = null; showingArchive = false; warning(''); setupView(); });
  });
  document.addEventListener('change', event => {
    if (['keep-awake', 'sound-alert'].includes(event.target.id)) {
      keepAwake = document.getElementById('keep-awake').checked; sound = document.getElementById('sound-alert').checked;
      try { localStorage.setItem(STORE + '-preferences', JSON.stringify({ keepAwake, sound })); } catch { warning('Timer preferences could not be saved on this device.'); }
      wakeFailed = false; prepareAudio(); syncWake(); return;
    }
    if (event.target.id === 'import-file' && event.target.files[0]) importBackup(event.target.files[0]); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => { document.getElementById('offline-status').textContent = 'Ready for offline use.'; }).catch(() => { document.getElementById('offline-status').textContent = 'Offline setup unavailable.'; });
  window.addEventListener('storage', event => { if ([STORE, HISTORY, null].includes(event.key)) { storageCurrent(); syncWake(); } });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
  window.addEventListener('appinstalled', () => { installPrompt = null; });
  document.addEventListener('visibilitychange', () => { wakeFailed = false; updateClock(); });
  try {
    const entries = JSON.parse(localStorage.getItem(HISTORY) || '[]');
    if (!Array.isArray(entries)) throw Error('Invalid history');
    archive = entries.map(entry => { if (!entry || typeof entry.id !== 'string' || !Number.isFinite(entry.savedAt)) throw Error('Invalid history entry'); return { ...entry, tournament: E.validate(entry.tournament) }; });
  } catch { archiveBlocked = true; warning('Tournament history could not be loaded. Export your current tournament before leaving.'); }
  setInterval(updateClock, 500);
  const saved = load(STORE); if (saved) { try { state = E.validate(saved); render(); } catch (error) { warning(`${error.message} Export or reset the stored data.`); setupView(); } } else setupView();
})();
