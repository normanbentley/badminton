'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const cleanupBrowser = require('../test-support/cleanup-browser.js');
const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && fs.existsSync(p));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROOT = path.resolve(__dirname, '..');

test('Junior Doubles works courtside, survives refresh, corrects results and loads offline', { timeout: 120000, skip: !browser && process.env.REQUIRE_BROWSER !== '1' ? 'no Chrome-like browser found' : false }, async t => {
  assert.ok(browser, 'REQUIRE_BROWSER=1 requires a real browser');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'junior-doubles-browser-'));
  let serveLegacyCache = false;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      // Simulate an existing v1 offline installation. The visible marker lets
      // the upgrade check prove that the old cached document was replaced.
      if (serveLegacyCache && pathname.endsWith('/sw.js')) data = String(data).replace("'junior-doubles-v3'", "'junior-doubles-v1'").replace('.then(() => self.skipWaiting())', '');
      if (serveLegacyCache && path.extname(file) === '.html') data = String(data).replace('<body>', '<body><div id="legacy-cache-marker" hidden>Previous cached version</div>');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.TOURNAMENT_TEST_BASE || `http://127.0.0.1:${server.address().port}`;
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket;
  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
      socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    }
    socket?.close(); if (child.exitCode === null) child.kill(); await new Promise(resolve => server.close(resolve));
    await delay(500);
    cleanupBrowser(profile);
  });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome must start and expose its debugging port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map(), errors = [], fileChoosers = [];
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Page.fileChooserOpened') fileChoosers.push(msg.params);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(Error(msg.error.message)); else p.resolve(msg.result); }
  };
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function js(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await js(expression)) return; await delay(50); } assert.fail('Timed out: ' + expression); }
  async function click(selector) {
    const needsMenu = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const menu = el?.closest('#tournament-options'); return !!menu && !menu.open && !el.closest('summary'); })()`);
    if (needsMenu) await click('#tournament-options > summary');
    const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing control: ' + ${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function fill(selector, value) {
    await click(selector);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp('Input.insertText', { text: String(value) });
  }
  const saved = () => js(`JSON.parse(localStorage.getItem('junior-doubles-v1'))`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  const viewport = { width: Number(process.env.ANDROID_VIEWPORT_WIDTH) || 390, height: Number(process.env.ANDROID_VIEWPORT_HEIGHT) || 844, deviceScaleFactor: 3, mobile: true };
  await cdp('Emulation.setDeviceMetricsOverride', viewport);
  await cdp('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', platform: 'Android' });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp('Page.navigate', { url: base + '/tournament/' });
  await until(`!!document.getElementById('names')`);

  await t.test('Create explains incomplete or invalid setup when tapped', async () => {
    for (const [list, reason] of [
      ['', /4.*60 players/],
      ['Alex\nSam\nCharlie', /4.*60 players/],
      ['Alex\nAlex\nCharlie\nSam', /same name/],
      ['Alex, 2.7\nHarper\nCharlie\nSam', /half-point steps/]
    ]) {
      if (list) await fill('#names', list);
      await click('#create');
      const error = await js(`document.getElementById('setup-error')?.textContent || ''`);
      assert.match(error, reason);
    }
    await fill('#names', 'Alex\nSam\nCharlie\nHarper\nJamie');
    await fill('#duration', 5);
    await click('#create');
    assert.match(await js(`document.getElementById('setup-error').textContent`), /Not enough time/);
  });

  await t.test('setup reacts immediately to numeric grades and changing game length', async () => {
    await fill('#names', 'Alex, 3.5\nSam, 5\nCharlie, 1\nHarper\nJamie, 2.5\nTaylor, 4\nRiley, 2\nJordan, 4.5');
    await fill('#duration', 17); await fill('#game', 5); await fill('#change', 1);
    assert.match(await js(`document.getElementById('preview').textContent`), /3 games each/);
    await fill('#game', 8);
    assert.match(await js(`document.getElementById('preview').textContent`), /2 games each/);
    await fill('#game', 5); await click('#create');
    await until(`!!document.getElementById('court-0-0')`);
    assert.equal((await saved()).players[0].skill, 3.5);
    assert.equal((await saved()).players.find(p => p.name === 'Harper').skill, 3);
    assert.equal(await js(`document.querySelectorAll('[data-score]').length`), 4);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-round.png'), Buffer.from(screenshot.data, 'base64'));
  });
  await t.test('round grades are small and the alphabetical player list opens empty match histories', async () => {
    assert.equal(await js(`document.querySelectorAll('.team .player-grade').length`), 8);
    assert.equal(await js(`Array.from(document.querySelectorAll('.team .player-label')).find(el => el.querySelector('.player-name').textContent === 'Alex').querySelector('.player-grade').textContent`), '3.5');
    assert.equal(await js(`Array.from(document.querySelectorAll('.team .player-label')).find(el => el.querySelector('.player-name').textContent === 'Harper').querySelector('.player-grade').textContent`), '3*');
    assert.ok(await js(`parseFloat(getComputedStyle(document.querySelector('.player-grade')).fontSize) < parseFloat(getComputedStyle(document.querySelector('.team')).fontSize)`));
    await click('[data-tab="players"]');
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('.player-entry summary .player-name')).map(el => el.textContent)`), ['Alex', 'Charlie', 'Harper', 'Jamie', 'Jordan', 'Riley', 'Sam', 'Taylor']);
    await click('[data-player-id="0"] > summary');
    assert.match(await js(`document.querySelector('[data-player-id="0"] .player-matches').textContent`), /No completed games yet/);
    await click('[data-tab="round"]');
  });
  await t.test('Android layout keeps management actions in Options with a styled import control', async () => {
    assert.equal(await js(`document.querySelectorAll('main [data-action="new"], main [data-action="export"], main input[type="file"]').length`), 0);
    assert.equal(await js(`document.getElementById('import').hidden`), true);
    await click('#tournament-options > summary');
    assert.equal(await js(`document.getElementById('tournament-options').open`), true);
    assert.equal(await js(`(() => { const r = document.querySelector('.options-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`), true);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-options.png'), Buffer.from(screenshot.data, 'base64'));
    await click('h1');
    assert.equal(await js(`document.getElementById('tournament-options').open`), false);
    await cdp('Emulation.setDeviceMetricsOverride', { ...viewport, width: 360, height: 800 });
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await click('[data-tab="players"]');
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await click('[data-tab="round"]');
    await cdp('Emulation.setDeviceMetricsOverride', viewport);
  });
  await t.test('blank scores are rejected; drafts and running timer survive reload', async () => {
    await click('[data-action="advance"]');
    assert.match(await js(`document.getElementById('result-error').textContent`), /Enter a whole score/);
    await fill('#court-0-0', 15); await fill('#court-0-1', 12);
    await fill('#court-1-0', 8); await fill('#court-1-1', 8);
    await click('[data-action="timer"]');
    const end = (await saved()).timer.end;
    await cdp('Page.reload'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal(await js(`document.getElementById('court-0-0').value`), '15');
    assert.equal((await saved()).timer.end, end);
    await click('[data-action="advance"]');
    assert.equal(await js(`document.getElementById('confirm').open`), true);
    await click('#confirm [value="yes"]'); await until(`document.body?.textContent.includes('Round 2')`);
    assert.equal((await saved()).current, 1);
    await click('[data-tab="standings"]');
    assert.equal(await js(`document.querySelectorAll('.stand-row').length`), 8);
    assert.match(await js(`document.querySelector('.stand-row').textContent`), /1\/3 played/);
  });
  await t.test('player history shows their partner, opponents, result and score from their side', async () => {
    const tournament = await saved();
    await click('[data-tab="players"]');
    for (const [court, match] of tournament.rounds[0].matches.entries()) {
      for (const side of [0, 1]) {
        const id = match.teams[side][0], partner = match.teams[side][1];
        await click(`[data-player-id="${id}"] > summary`);
        const text = await js(`document.querySelector('[data-player-id="${id}"] .player-matches').textContent`);
        assert.ok(text.includes(`ROUND 1 · COURT ${court + 1}`));
        assert.ok(text.includes(tournament.players[partner].name));
        for (const opponent of match.teams[1 - side]) assert.ok(text.includes(tournament.players[opponent].name));
        const [own, other] = [match.score[side], match.score[1 - side]];
        assert.ok(text.includes(own > other ? 'Win' : own < other ? 'Loss' : 'Draw'));
        assert.ok(text.includes(`${own}–${other}`));
        assert.equal(await js(`document.querySelectorAll('[data-player-id="${id}"] .player-match').length`), 1);
      }
    }
  });
  await t.test('editing a prior result updates standings, and undo preserves scores for re-entry', async () => {
    await click('[data-tab="history"]'); await click('[data-edit="0,0"]');
    await fill('#edit-0', 1); await fill('#edit-1', 20); await click('[data-action="save-edit"]');
    assert.deepEqual((await saved()).rounds[0].matches[0].score, [1, 20]);
    const correctedPlayer = (await saved()).rounds[0].matches[0].teams[0][0];
    await click('[data-tab="players"]'); await click(`[data-player-id="${correctedPlayer}"] > summary`);
    assert.match(await js(`document.querySelector('[data-player-id="${correctedPlayer}"] .match-outcome').textContent`), /Loss 1–20/);
    await click('[data-tab="round"]'); await click('[data-action="undo"]'); await click('#confirm [value="yes"]');
    await until(`!!document.getElementById('court-0-0') && document.getElementById('court-0-0').value === '1'`);
    assert.equal((await saved()).current, 0);
    assert.equal((await saved()).rounds[0].matches[0].score, null);
    await click('[data-tab="players"]'); await click(`[data-player-id="${correctedPlayer}"] > summary`);
    assert.match(await js(`document.querySelector('[data-player-id="${correctedPlayer}"] .player-matches').textContent`), /No completed games yet/);
    await click('[data-tab="round"]');
    await click('[data-action="advance"]');
  });
  await t.test('completion gives every player exactly three official games', async () => {
    for (let i = 0; i < 2; i++) {
      await fill('#court-0-0', 10); await fill('#court-0-1', 10);
      await fill('#court-1-0', 12); await fill('#court-1-1', 5);
      await click('[data-action="advance"]');
    }
    assert.match(await js(`document.querySelector('main').textContent`), /Everyone played 3 games/);
    await click('[data-tab="standings"]');
    assert.equal(await js(`Array.from(document.querySelectorAll('.stand-row')).every(el => el.textContent.includes('3/3 played'))`), true);
    await click('[data-tab="players"]'); await click('[data-player-id="0"] > summary');
    assert.equal(await js(`document.querySelectorAll('[data-player-id="0"] .player-match').length`), 3);
    const playerScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-players.png'), Buffer.from(playerScreenshot.data, 'base64'));
    await click('[data-tab="standings"]');
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-standings.png'), Buffer.from(screenshot.data, 'base64'));
  });
  await t.test('a cached app reloads offline with the completed tournament intact', async () => {
    await until(`document.getElementById('offline-status').textContent.includes('Ready')`);
    await cdp('Network.enable');
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await cdp('Page.reload');
    await until(`document.body?.textContent.includes('Everyone played 3 games')`);
    assert.equal((await saved()).current, 3);
    assert.deepEqual(errors, []);
  });
  await t.test('a backup restores a completed tournament and invalid imports preserve it', async () => {
    const backup = await saved();
    await click('[data-action="new"]'); await click('#confirm [value="yes"]');
    await until(`!!document.getElementById('names')`);
    async function importData(data) {
      const fixture = path.join(profile, 'import-backup.json');
      fs.writeFileSync(fixture, JSON.stringify(data));
      await cdp('Page.setInterceptFileChooserDialog', { enabled: true });
      const previous = fileChoosers.length;
      await click('[data-action="import"]');
      for (let i = 0; i < 100 && fileChoosers.length === previous; i++) await delay(50);
      assert.equal(fileChoosers.length, previous + 1, 'styled Import button must open the actual file chooser');
      await cdp('DOM.setFileInputFiles', { files: [fixture], backendNodeId: fileChoosers.at(-1).backendNodeId });
      await cdp('Page.setInterceptFileChooserDialog', { enabled: false });
    }
    await importData(backup); await until(`document.getElementById('confirm').open`);
    await click('#confirm [value="yes"]');
    await until(`document.body?.textContent.includes('Everyone played 3 games')`);
    assert.equal((await saved()).current, 3);
    await importData({ version: 99 });
    await until(`document.getElementById('storage-warning').textContent.includes('Could not import')`);
    assert.equal((await saved()).current, 3);
  });
  await t.test('Create works for small, odd and large groups on two and three courts', async () => {
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    for (const [count, courts] of [[4, 3], [9, 2], [12, 3], [17, 2], [60, 3]]) {
      await click('[data-action="new"]'); await click('#confirm [value="yes"]');
      await until(`!!document.getElementById('names')`);
      const list = Array.from({ length: count }, (_, i) => `Player ${i + 1}, ${1 + (i % 9) / 2}`).join('\n');
      await fill('#names', list); await fill('#duration', 240); await fill('#game', 6); await fill('#change', 1);
      await js(`document.getElementById('courts').focus()`);
      const key = courts === 3 ? 'End' : 'Home';
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: courts === 3 ? 35 : 36 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: courts === 3 ? 35 : 36 });
      assert.equal(await js(`document.getElementById('courts').value`), String(courts));
      await click('#create'); await until(`!!document.getElementById('court-0-0')`);
      const tournament = await saved();
      assert.equal(tournament.players.length, count);
      assert.equal(tournament.config.courts, courts);
      const counts = Array(count).fill(0);
      tournament.rounds.forEach(r => r.matches.forEach(m => m.teams.flat().forEach(id => counts[id]++)));
      assert.ok(counts.every(games => games === tournament.plan.games));
      assert.ok(tournament.plan.minutes <= 240);
      assert.equal(await js(`document.querySelectorAll('[data-score]').length`), tournament.rounds[0].matches.length * 2);
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    }
  });
  await t.test('Create reads the current form even when autofill does not dispatch input events', async () => {
    await click('[data-action="new"]'); await click('#confirm [value="yes"]');
    await until(`!!document.getElementById('names')`);
    await js(`document.getElementById('names').value = 'Alex\\nSam\\nCharlie\\nHarper\\nJamie\\nTaylor'; document.getElementById('game').value = '10'`);
    await click('#create'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal((await saved()).players.length, 6);
    assert.equal((await saved()).config.game, 10);
  });
  await t.test('blocked browser storage still permits play and exporting a recovery backup', async () => {
    const injection = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });` });
    await cdp('Page.reload'); await until(`!!document.getElementById('names')`);
    await fill('#names', 'Alex\nSam\nCharlie\nHarper');
    await click('#create'); await until(`!!document.getElementById('court-0-0')`);
    assert.match(await js(`document.getElementById('storage-warning').textContent`), /could not save/);
    const downloadPath = path.join(profile, 'downloads');
    await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
    await click('[data-action="export"]');
    const backupPath = path.join(downloadPath, 'junior-doubles-backup.json');
    for (let i = 0; i < 100 && !fs.existsSync(backupPath); i++) await delay(50);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.players.length, 4);
    assert.ok(backup.players.every(p => p.skill === 3));
    assert.doesNotThrow(() => require('../tournament/engine.js').validate(backup));
    await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await cdp('Page.reload'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal((await saved()).players.length, 6, 'the previous saved tournament is preserved');
  });
  await t.test('unreadable saved tournaments explain recovery instead of silently disabling Create', async () => {
    await js(`localStorage.setItem('junior-doubles-v1', '{invalid-json')`);
    await cdp('Page.reload'); await until(`!!document.getElementById('names')`);
    await click('#create');
    assert.match(await js(`document.getElementById('setup-error').textContent`), /Reset saved data/);
    assert.equal(await js(`localStorage.getItem('junior-doubles-v1')`), '{invalid-json');
    await click('[data-action="reset-corrupt"]'); await click('#confirm [value="yes"]');
    await until(`!document.querySelector('[data-action="reset-corrupt"]')`);
    await fill('#names', 'Alex\nSam\nCharlie\nHarper');
    await click('#create'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal((await saved()).players.length, 4);
    assert.deepEqual(errors, []);
  });
  await t.test('an existing v1 offline installation upgrades without losing its tournament', { skip: !!process.env.TOURNAMENT_TEST_BASE }, async () => {
    await js(`(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const name of await caches.keys()) await caches.delete(name); })()`);
    await cdp('Page.navigate', { url: 'about:blank' });
    serveLegacyCache = true;
    await cdp('Page.navigate', { url: base + '/tournament/' });
    await until(`!!document.getElementById('court-0-0') && !!navigator.serviceWorker.controller`);
    await until(`caches.has('junior-doubles-v1')`);
    await cdp('Page.reload'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal(await js(`!!document.getElementById('legacy-cache-marker')`), true);
    serveLegacyCache = false;
    await js(`navigator.serviceWorker.getRegistration().then(r => r.update())`);
    await until(`(async () => (await caches.has('junior-doubles-v3')) && !(await caches.has('junior-doubles-v1')))()`);
    await cdp('Page.reload'); await until(`!!document.getElementById('court-0-0')`);
    assert.equal(await js(`!!document.getElementById('legacy-cache-marker')`), false);
    assert.equal((await saved()).players.length, 4);
    assert.deepEqual(errors, []);
  });
});
