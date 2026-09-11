(() => {
  'use strict';
  const E = JuniorTournament, KEY = 'junior-doubles-v1', DRAFT = KEY + '-setup';
  const app = document.getElementById('app');
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = null, tab = 'round', editing = null, storageBlocked = false;
  let setup = { names: '', courts: 2, duration: 90, game: 8, change: 2 };
  let wakeLock = null, wakePending = false, wakeFailed = false, audioContext = null;
  let keepAwake = true, sound = false;
  try { const prefs = JSON.parse(localStorage.getItem(KEY + '-preferences')); if (prefs) { keepAwake = prefs.keepAwake !== false; sound = prefs.sound === true; } } catch {}
  const running = () => !!state?.timer?.end && remaining() > 0 && state.current < state.rounds.length;
  function wakeStatus() {
    const el = document.getElementById('wake-status');
    if (el) el.textContent = !keepAwake ? 'Screen awake is off.' : !navigator.wakeLock ? 'Screen awake is unavailable in this browser.' : wakeLock && !wakeLock.released ? 'Keeping screen awake.' : wakeFailed ? 'Screen awake unavailable. Check battery-saving settings.' : 'Screen stays awake while the timer runs.';
  }
  async function syncWake() {
    const wanted = keepAwake && running() && document.visibilityState === 'visible';
    if (!wanted && wakeLock) { const lock = wakeLock; wakeLock = null; try { await lock.release(); } catch {} }
    if (wanted && navigator.wakeLock && !wakeLock && !wakePending && !wakeFailed) {
      wakePending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) { wakeLock = null; wakeFailed = true; } wakeStatus(); });
        if (!keepAwake || !running() || document.visibilityState !== 'visible') { wakeLock = null; await lock.release(); }
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
  function nextRoundView() {
    const next = state.rounds[state.current + 1];
    if (!next) return '<p class="help next-round">Final round. No more games after this one.</p>';
    return `<details class="card next-round"><summary>Up next: round ${state.current + 2}</summary>${next.matches.map((m, i) => `<div class="next-court"><span class="court-number">COURT ${i + 1}</span><p>${esc(names(m.teams[0]))}<br><span class="muted">vs</span> ${esc(names(m.teams[1]))}</p></div>`).join('')}<p class="help">Resting: ${next.resting.length ? esc(names(next.resting)) : 'Nobody'}</p></details>`;
  }
  function warning(message) { const el = document.getElementById('storage-warning'); el.textContent = message; el.hidden = false; }
  let storedTournament = null, storedSetup = null;
  try {
    storedTournament = localStorage.getItem(KEY);
    storedSetup = localStorage.getItem(DRAFT);
  } catch { warning('Browser storage is unavailable. You can still run a tournament, but keep this page open and export a backup before leaving.'); }
  if (storedTournament) {
    try { state = E.validate(JSON.parse(storedTournament)); }
    catch { storageBlocked = true; warning('Saved data could not be loaded. Download the stored data before replacing it, or import a valid backup.'); }
  }
  if (storedSetup) {
    try { const draft = JSON.parse(storedSetup); if (draft && typeof draft.names === 'string') setup = { ...setup, ...draft }; }
    catch { if (!storageBlocked) warning('The saved setup could not be read. Please enter the player list again.'); }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); document.getElementById('save-status').textContent = 'Saved on this device only.'; return true; }
    catch { warning('This browser could not save changes. Keep this page open and export a backup before leaving.'); document.getElementById('save-status').textContent = 'Changes are not saved.'; return false; }
  }
  function save() { if (state) store(KEY, state); }
  const names = ids => ids.map(id => state.players[id].name).join(' + ');
  const remaining = () => !state?.timer ? (state?.config.game || 0) * 60000 : state.timer.end === null ? state.timer.remaining : Math.max(0, state.timer.end - Date.now());
  function clockText(ms) { const s = Math.ceil(ms / 1000); return Math.floor(s / 60).toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0'); }
  function confirmAction(title, text, yes, action) {
    const dialog = document.getElementById('confirm');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    const confirmButton = dialog.querySelector('[value="yes"]');
    confirmButton.textContent = yes;
    confirmButton.className = ['Start new', 'Reset data', 'Restore backup'].includes(yes) ? 'primary danger-primary' : 'primary';
    dialog.querySelector('[value="cancel"]').textContent = 'Cancel';
    dialog.onclose = () => { if (dialog.returnValue === 'yes') action(); };
    dialog.showModal();
  }
  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function utilities() {
    const icon = kind => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      export: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
      import: '<path d="M12 16V4m-4 4 4-4 4 4M5 16v5h14v-5"/>',
      undo: '<path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12h-3"/>',
      add: '<path d="M12 5v14M5 12h14"/>'
    }[kind]}</svg>`;
    return `<details class="options-menu" id="tournament-options"><summary aria-label="Tournament options">${icon('more')}<span>Options</span></summary><div class="options-panel"><p class="menu-label">Tournament tools</p>${state ? `<button data-action="export">${icon('export')}Export backup</button>` : ''}<button data-action="import">${icon('import')}Import backup</button><input id="import" type="file" accept="application/json,.json" aria-label="Import tournament backup" hidden>${state?.current ? `<div class="menu-divider"></div><button data-action="undo">${icon('undo')}Undo last round</button>` : ''}${state ? `<div class="menu-divider"></div><button class="danger" data-action="new">${icon('add')}New tournament</button>` : ''}${storageBlocked ? `<button data-action="raw">${icon('export')}Download stored data</button><div class="menu-divider"></div><button class="danger" data-action="reset-corrupt">${icon('undo')}Reset saved data</button>` : ''}</div></details>`;
  }
  function setupView() {
    app.innerHTML = `<section class="card"><p class="eyebrow">LET’S GET PLAYING</p><h2>Set up your tournament</h2><label for="names">Who’s playing?</label><p class="help" id="names-help">One player per line. Optional grade: <b>Alex, 3.5</b><br>Grades run from 1 to 5, with 5 strongest. Half points are welcome. Leave the grade blank to use 3.</p><textarea id="names" rows="7" placeholder="Alex, 3.5&#10;Charlie, 2&#10;Harper&#10;Sam, 5" aria-describedby="names-help">${esc(setup.names)}</textarea><div class="grid" style="margin-top:20px"><label>Courts<select id="courts"><option value="2" ${Number(setup.courts) === 2 ? 'selected' : ''}>2 courts</option><option value="3" ${Number(setup.courts) === 3 ? 'selected' : ''}>3 courts</option></select></label><label>Total minutes<input id="duration" type="number" inputmode="numeric" min="5" max="480" value="${esc(setup.duration)}"></label><label>Game minutes<input id="game" type="number" inputmode="numeric" min="1" max="60" value="${esc(setup.game)}"></label><label>Changeover minutes<input id="change" type="number" inputmode="numeric" min="0" max="15" value="${esc(setup.change)}"></label></div><p class="help">Changeover covers scores, a drink and moving courts. Included between rounds.</p><div id="preview" class="preview" aria-live="polite"></div><p id="setup-error" class="error" role="alert" tabindex="-1" hidden></p><button id="create" class="primary wide" data-action="create">Create tournament</button><details><summary>How we keep it fair</summary><p>Every player finishes with exactly the same number of games. Turns rotate so nobody is double booked, and playing counts stay within one game of each other.</p><p>We try to vary partners and opponents and balance combined grades. Repeats can be unavoidable, especially with a small group.</p><p>Win: 2 points. Draw: 1. Loss: 0. Point difference breaks ties; players still tied share their place. All scores are final at the whistle, including draws.</p><p>The planned games and changeovers fit your time budget. Late starts, longer breaks or paused timers can extend the actual event.</p></details></section>`;
    for (const id of ['names', 'courts', 'duration', 'game', 'change']) document.getElementById(id).addEventListener('input', updatePreview);
    updatePreview();
  }
  function readSetup() {
    return { names: document.getElementById('names').value, ...Object.fromEntries(['courts', 'duration', 'game', 'change'].map(id => { const value = document.getElementById(id).value; return [id, value === '' ? NaN : Number(value)]; })) };
  }
  function updatePreview() {
    setup = readSetup();
    store(DRAFT, setup);
    const preview = document.getElementById('preview');
    document.getElementById('setup-error').hidden = true;
    try {
      const players = E.parsePlayers(setup.names), p = E.capacity(players.length, setup);
      preview.innerHTML = p.games ? `<strong>${p.games} games each</strong><p>${players.length} players · ${p.rounds} rounds · ${p.matches} court games</p><p>${p.minutes} of ${setup.duration} minutes planned. ${p.spare} minutes spare.</p>${p.usableCourts < setup.courts ? `<p>Only ${p.usableCourts} court can be used with this many players.</p>` : ''}<p>Exact equality can leave a court or some time unused.</p>` : '<p>Not enough time for everyone to play equally. Add time or shorten games or changeovers.</p>';
    } catch (error) { preview.textContent = error.message; }
  }
  function showSetupError(message) {
    const error = document.getElementById('setup-error');
    if (!error) { warning(message); return; }
    error.textContent = message; error.hidden = false; error.focus();
  }
  async function createTournament() {
    const button = document.getElementById('create');
    if (button.disabled) return;
    try {
      if (storageBlocked) throw Error('The saved tournament could not be read. Download the stored data, then use Reset saved data, or import a backup.');
      // Read the actual form again, including autofill and changes that did not
      // dispatch an input event. Never create from a stale preview snapshot.
      setup = readSetup();
      const players = E.parsePlayers(setup.names);
      const config = { courts: setup.courts, duration: setup.duration, game: setup.game, change: setup.change };
      const plan = E.capacity(players.length, config);
      if (!plan.games) throw Error('Not enough time for equal games. Add time or shorten each game/changeover.');
      button.disabled = true; button.textContent = 'Creating tournament…'; button.setAttribute('aria-busy', 'true');
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const generated = E.schedule(players, config, Date.now());
      state = { version: 1, players, config, ...generated, current: 0, timer: null, drafts: {}, startedAt: Date.now() };
      save(); tab = 'round'; render(); window.scrollTo(0, 0);
    } catch (error) {
      button.disabled = false; button.textContent = 'Create tournament'; button.removeAttribute('aria-busy');
      showSetupError(error.message);
    }
  }
  function scoreFields(m, prefix, draft) {
    return `<div class="score-row">${[0, 1].map(side => `${side ? '<span></span>' : ''}<label>Team ${side + 1} score<input id="${prefix}-${side}" data-score="${prefix}" data-side="${side}" aria-label="${esc(names(m.teams[side]))} score" type="number" inputmode="numeric" min="0" max="99" step="1" placeholder="–" value="${esc(draft?.[side] ?? m.score?.[side] ?? '')}"></label>`).join('')}</div>`;
  }
  function matchView(m) {
    return `<div class="match"><div class="team">${m.teams[0].map(playerLabel).join('')}</div><span class="versus">vs</span><div class="team">${m.teams[1].map(playerLabel).join('')}</div></div>`;
  }
  function playerLabel(id) {
    const p = state.players[id], defaultGrade = p.grade === '';
    const label = `Grade ${p.skill}${defaultGrade ? ', default because no grade was entered' : ''}`;
    return `<span class="player-label"><span class="player-name">${esc(p.name)}</span><small class="player-grade" title="${esc(label)}" aria-label="${esc(label)}">${p.skill}${defaultGrade ? '*' : ''}</small></span>`;
  }
  function playersView() {
    const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
    const totals = Object.fromEntries(E.standings(state.players, state.rounds).map(p => [p.id, p]));
    return `<section class="card"><h2>Players</h2><p class="help">A to Z. Tap a name to see their match history.</p>${players.map(p => {
      const history = [];
      state.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
        if (!E.validScore(m.score)) return;
        const side = m.teams.findIndex(team => team.includes(p.id));
        if (side < 0) return;
        const own = m.score[side], other = m.score[1 - side];
        const outcome = own > other ? 'Win' : own < other ? 'Loss' : 'Draw';
        const partner = m.teams[side].find(id => id !== p.id);
        history.push(`<article class="player-match" data-round="${ri}" data-court="${mi}"><div class="player-match-heading"><span class="court-number">ROUND ${ri + 1} · COURT ${mi + 1}</span><span class="match-outcome">${outcome} <b>${own}–${other}</b></span></div><p>With <strong>${esc(state.players[partner].name)}</strong><br><span class="muted">vs</span> ${esc(names(m.teams[1 - side]))}</p></article>`);
      }));
      const total = totals[p.id];
      return `<details class="player-entry" data-player-id="${p.id}"><summary>${playerLabel(p.id)}<span class="player-overview">${total.played}/${state.plan.games} played · ${total.wins}W ${total.draws}D ${total.losses}L</span></summary><div class="player-matches"><h3>Match history</h3>${history.length ? history.join('') : '<p class="help">No completed games yet.</p>'}</div></details>`;
    }).join('')}${state.players.some(p => p.grade === '') ? '<p class="help">* Grade 3 used where no grade was entered.</p>' : ''}</section>`;
  }
  function roundView() {
    if (state.current === state.rounds.length) return `<section class="card success"><p class="eyebrow">THAT’S A WRAP</p><strong>Everyone played ${state.plan.games} games</strong><p>Well played, team. Your final standings are ready.</p><button class="primary wide" data-tab="standings">See final standings</button></section>`;
    const r = state.rounds[state.current];
    return `<div class="round-heading"><h2>Round ${state.current + 1} <span class="muted">of ${state.rounds.length}</span></h2><span class="pill">${state.plan.games} games each</span></div><div class="progress"><div style="width:${state.current / state.rounds.length * 100}%"></div></div><section class="timer-card"><div class="timer-row"><div><div class="eyebrow" style="color:#d8efaa">ROUND TIMER</div><div id="clock" class="clock" role="timer">${clockText(remaining())}</div></div><button id="timer-toggle" data-action="timer">${state.timer?.end ? 'Pause' : state.timer ? 'Resume' : 'Start game'}</button></div><p id="timer-note" aria-live="polite"></p><p>${state.config.change} min changeover between rounds. Start when all courts are ready.</p>${timerTools()}</section>${r.matches.map((m, i) => `<section class="card"><div class="court-head"><span class="court-number">COURT ${i + 1}</span><span class="muted">Doubles</span></div>${matchView(m)}${scoreFields(m, 'court-' + i, state.drafts?.[i])}</section>`).join('')}<aside class="rest"><h3>${r.resting.length ? 'Resting this round' : 'Everyone is on court'}</h3><div class="rest-players">${r.resting.length ? r.resting.map(playerLabel).join('') : 'Grab your partner and enjoy the game.'}</div></aside>${state.players.some(p => p.grade === '') ? '<p class="help">* Grade 3 used where no grade was entered.</p>' : ''}<p id="result-error" class="error" role="alert"></p><button class="primary wide" data-action="advance">${state.current + 1 === state.rounds.length ? 'Save results & finish' : 'Save results & next round'}</button><p class="help">Enter both scores on every court. Draws are welcome. Scores save together when you advance.</p>${nextRoundView()}`;
  }
  function standingsView() {
    const complete = state.current === state.rounds.length;
    return `<section class="card"><p class="eyebrow">${complete ? 'FINAL RESULTS' : 'THE STORY SO FAR'}</p><h2>Individual standings</h2><p class="help">${complete ? 'All games complete.' : 'Provisional until everyone has played all their games.'} Win 2 · Draw 1 · Loss 0. Ties use point difference, then share a place.</p>${E.standings(state.players, state.rounds).map(p => `<div class="stand-row"><span class="rank">${p.rank}</span><div><span class="name">${esc(p.name)}</span><small>${p.played}/${state.plan.games} played · ${p.wins}W ${p.draws}D ${p.losses}L</small><small>For ${p.for} · Against ${p.against} · Difference ${p.diff > 0 ? '+' : ''}${p.diff}</small></div><div class="points">${p.points}<small>POINTS</small></div></div>`).join('')}</section>`;
  }
  function historyView() {
    return `<section class="card"><h2>Results & schedule</h2><p class="help">${state.plan.rounds} rounds · ${state.plan.minutes} minutes planned, including changeovers. Editing a result updates standings immediately.</p>${state.rounds.map((r, ri) => `<details ${ri === Math.max(0, state.current - 1) ? 'open' : ''}><summary>Round ${ri + 1} <span class="muted">${ri < state.current ? 'Completed' : ri === state.current ? 'Current' : 'Upcoming'}</span></summary>${r.matches.map((m, mi) => `<div class="history-match"><span class="court-number">COURT ${mi + 1}</span><p>${esc(names(m.teams[0]))}<br><span class="muted">vs</span> ${esc(names(m.teams[1]))}</p>${m.score ? `<b>${m.score[0]} : ${m.score[1]}</b> <button data-edit="${ri},${mi}">Edit score</button>` : '<span class="muted">Not played yet</span>'}${editing === ri + ',' + mi ? `${scoreFields(m, 'edit')}<p id="edit-error" class="error" role="alert"></p><div class="actions"><button class="primary" data-action="save-edit">Save correction</button><button data-action="cancel-edit">Cancel</button></div>` : ''}</div>`).join('')}<p class="help">Resting: ${r.resting.length ? r.resting.map(id => esc(state.players[id].name)).join(', ') : 'Nobody'}</p></details>`).join('')}</section>`;
  }
  function render() {
    syncWake();
    document.getElementById('options-slot').innerHTML = utilities();
    document.body.classList.toggle('running', !!state);
    if (!state) return setupView();
    app.innerHTML = `<nav class="tabs" aria-label="Tournament views">${[['round', 'Current round'], ['standings', 'Standings'], ['players', 'Players'], ['history', 'Results']].map(([id, label]) => `<button data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>${tab === 'round' ? roundView() : tab === 'standings' ? standingsView() : tab === 'players' ? playersView() : historyView()}`;
    tick();
  }
  function readScore(prefix) {
    const values = [0, 1].map(side => document.getElementById(prefix + '-' + side).value.trim());
    if (values.some(v => !/^\d{1,2}$/.test(v))) throw Error('Enter a whole score from 0 to 99 for both teams on every court.');
    return values.map(Number);
  }
  function advance() {
    let scores;
    try { scores = state.rounds[state.current].matches.map((_, i) => readScore('court-' + i)); }
    catch (error) { document.getElementById('result-error').textContent = error.message; return; }
    const finish = () => {
      state.rounds[state.current].matches.forEach((m, i) => { m.score = scores[i]; });
      state.current++; state.timer = null; state.readyAt = Date.now() + state.config.change * 60000; state.drafts = {}; editing = null; save(); render(); window.scrollTo(0, 0);
    };
    if (state.timer && remaining() > 0) confirmAction('Finish this round early?', 'There is still time on the round timer. Save these as the final scores?', 'Save round', finish);
    else finish();
  }
  function tick() {
    syncWake();
    if (state?.timer?.end && remaining() === 0 && !state.timer.alerted && document.visibilityState === 'visible') {
      state.timer.alerted = true; save();
      try { navigator.vibrate?.([200, 100, 200, 100, 400]); chime(); } catch {}
    }
    const clock = document.getElementById('clock');
    if (!clock || !state) return;
    const ms = remaining(); clock.textContent = clockText(ms);
    const note = document.getElementById('timer-note');
    const message = !state.timer ? 'Ready when you are.' : ms === 0 ? 'Time! Finish the rally, then enter final scores.' : state.timer.end === null ? 'Paused. Extra pauses can extend your event.' : 'Game on. Timer continues if you leave this page.';
    if (note.textContent !== message) note.textContent = message;
    const estimate = E.finishEstimate(state, Date.now());
    const time = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    document.getElementById('finish-time').textContent = `Estimated finish ${time(estimate.finish)}`;
    document.getElementById('finish-note').textContent = `${estimate.deadline ? `Budget ends ${time(estimate.deadline)}. ` : ''}${estimate.overrun >= 30000 ? `About ${Math.max(1, Math.round(estimate.overrun / 60000))} min over budget. ` : ''}Includes changeovers.`;
    document.querySelector('.finish-estimate').classList.toggle('over-budget', estimate.overrun >= 30000);
    document.getElementById('timer-toggle').disabled = !!state.timer && ms === 0;
  }
  app.addEventListener('input', event => {
    if (!state || !event.target.dataset.score?.startsWith('court-')) return;
    const i = Number(event.target.dataset.score.slice(6));
    state.drafts ||= {}; state.drafts[i] ||= ['', '']; state.drafts[i][Number(event.target.dataset.side)] = event.target.value; save();
  });
  document.addEventListener('click', event => {
    const menu = document.getElementById('tournament-options');
    if (menu && !menu.contains(event.target)) menu.open = false;
    const button = event.target.closest('button'); if (!button) return;
    if (menu?.contains(button)) menu.open = false;
    if (button.dataset.tab) { tab = button.dataset.tab; editing = null; render(); return; }
    if (button.dataset.edit) { editing = button.dataset.edit; render(); document.getElementById('edit-0').focus(); return; }
    switch (button.dataset.action) {
      case 'create': createTournament(); break;
      case 'timer': {
        prepareAudio(); wakeFailed = false;
        state.startedAt ||= Date.now();
        const ms = remaining(); state.timer = state.timer?.end ? { remaining: ms, end: null } : { remaining: ms, end: Date.now() + ms }; save(); render(); break;
      }
      case 'test-alert': prepareAudio(); try { navigator.vibrate?.([200, 100, 200]); } catch {} setTimeout(chime, 100); break;
      case 'advance': advance(); break;
      case 'undo': confirmAction('Reopen the previous round?', 'The previous round’s scores will become editable and its points will be removed until you save it again. Any unsaved scores in the current round will be discarded.', 'Reopen round', () => {
        state.current--; state.drafts = {}; state.rounds[state.current].matches.forEach((m, i) => { state.drafts[i] = m.score.map(String); m.score = null; }); state.timer = { remaining: 0, end: null }; tab = 'round'; save(); render();
      }); break;
      case 'save-edit': {
        try { const score = readScore('edit'); const [r, m] = editing.split(',').map(Number); state.rounds[r].matches[m].score = score; editing = null; save(); render(); }
        catch (error) { document.getElementById('edit-error').textContent = error.message; }
        break;
      }
      case 'cancel-edit': editing = null; render(); break;
      case 'export': download(JSON.stringify(state, null, 2), 'junior-doubles-backup.json'); break;
      case 'import': document.getElementById('import').click(); break;
      case 'raw': try { download(localStorage.getItem(KEY) || '{}', 'junior-doubles-recovery.json'); } catch { warning('The browser is blocking access to stored data.'); } break;
      case 'reset-corrupt': confirmAction('Reset unreadable saved data?', 'Download the stored data first if you want a recovery copy. This removes the unreadable tournament and setup from this browser.', 'Reset data', () => {
        try { localStorage.removeItem(KEY); localStorage.removeItem(DRAFT); } catch { warning('The browser is blocking access to stored data.'); return; }
        state = null; storageBlocked = false; document.getElementById('storage-warning').hidden = true; render();
      }); break;
      case 'new': confirmAction('Start a new tournament?', 'This replaces the tournament on this device. Export a backup first if you want to keep it.', 'Start new', () => {
        try { localStorage.removeItem(KEY); } catch { warning('Could not remove the saved tournament.'); return; }
        state = null; editing = null; render();
      }); break;
    }
  });
  document.addEventListener('keydown', event => {
    const menu = document.getElementById('tournament-options');
    if (event.key === 'Escape' && menu?.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  document.addEventListener('change', async event => {
    if (['keep-awake', 'sound-alert'].includes(event.target.id)) {
      keepAwake = document.getElementById('keep-awake').checked; sound = document.getElementById('sound-alert').checked;
      store(KEY + '-preferences', { keepAwake, sound }); wakeFailed = false; prepareAudio(); syncWake(); return;
    }
    if (event.target.id !== 'import') return;
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 2000000) throw Error('Backup is too large. Choose a Junior Doubles JSON backup.');
      const imported = E.validate(JSON.parse(await file.text()));
      confirmAction('Restore this tournament?', `${imported.players.length} players, ${imported.plan.games} games each. This replaces the tournament currently stored here.`, 'Restore backup', () => { state = imported; storageBlocked = false; document.getElementById('storage-warning').hidden = true; tab = 'round'; editing = null; save(); render(); });
    } catch (error) { warning('Could not import backup: ' + error.message); }
    event.target.value = '';
  });
  window.addEventListener('storage', event => { if (event.key === KEY) warning('This tournament changed in another tab. Reload before entering more results. Use one tab to run the event.'); });
  document.addEventListener('visibilitychange', () => { wakeFailed = false; tick(); });
  render(); setInterval(tick, 500);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').then(async registration => {
    await navigator.serviceWorker.ready;
    document.getElementById('offline-status').textContent = 'Ready for offline use.';
  }).catch(() => { document.getElementById('offline-status').textContent = 'Offline cache unavailable.'; });
})();
