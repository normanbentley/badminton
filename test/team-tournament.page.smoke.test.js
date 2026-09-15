'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const renderBrowser = require('../test-support/render-browser.js');
const cleanupBrowser = require('../test-support/cleanup-browser.js');
const SOURCE = path.join(__dirname, '..', 'team-tournament');
const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && fs.existsSync(p));
const required = process.env.REQUIRE_BROWSER === '1';
const roster = 'Alex, 5\nSam, 1\nCharlie, 4.5\nHarper, 1.5\nJamie, 4\nTaylor, 2\nRiley, 3.5\nJordan, 2.5';
function render(seed = '') {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'junior-doubles-browser-team-'));
  try {
    for (const file of ['index.html', 'style.css', 'engine.js', 'app.js']) fs.copyFileSync(path.join(SOURCE, file), path.join(work, file));
    const page = path.join(work, 'index.html');
    let html = fs.readFileSync(page, 'utf8');
    if (seed) html = html.replace('</body>', `<script>document.addEventListener('DOMContentLoaded',()=>{${seed}})</script></body>`);
    fs.writeFileSync(page, html);
    return renderBrowser(browser, page, path.join(work, 'profile'), 60000).replace(/<script[\s\S]*?<\/script>/g, '');
  } finally { cleanupBrowser(work); }
}
test('a browser is available for fixed-pair UI checks', { skip: required ? false : 'REQUIRE_BROWSER is not set' }, () => assert.ok(browser, 'REQUIRE_BROWSER=1 requires a real browser'));
describe('Junior Team Doubles in a real browser', { skip: browser ? false : 'no Chrome-like browser found' }, () => {
  test('renders the paste-first setup with a distinct fixed-team promise', () => {
    const dom = render();
    assert.match(dom, /Balanced teams\. Fixed partners\. Better teamwork\./);
    assert.match(dom, /Suggest balanced pairs/);
    assert.match(dom, /id="names"/);
  });
  test('generates balanced teams, locks a request and shuffles only unlocked players', () => {
    const dom = render(`
      const names=document.getElementById('names'); names.value=${JSON.stringify(roster)}; names.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="suggest"]').click();
      document.querySelector('[data-lock="0"]').click();
      document.querySelector('[data-action="shuffle"]').click();
    `);
    assert.match(dom, /Very balanced|Balanced/);
    assert.match(dom, /class="pair-card locked"/);
    assert.match(dom, /Unlock team/);
    assert.equal((dom.match(/class="player-choice/g) || []).length, 8);
  });
  test('confirms teams and displays pair-based courts and standings', () => {
    const dom = render(`
      const names=document.getElementById('names'); names.value=${JSON.stringify(roster)}; names.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="suggest"]').click(); document.querySelector('[data-action="confirm-pairs"]').click(); document.querySelector('[data-tab="standings"]').click();
    `);
    assert.match(dom, /TEAM STANDINGS/);
    assert.match(dom, /0\/\d+ played/);
    assert.equal((dom.match(/class="stand-row/g) || []).length, 4);
  });
  test('does not silently save blank scores as nil-all results', () => {
    const dom = render(`
      const names=document.getElementById('names'); names.value=${JSON.stringify(roster)}; names.dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('[data-action="suggest"]').click(); document.querySelector('[data-action="confirm-pairs"]').click(); document.querySelector('[data-action="advance"]').click();
    `);
    assert.match(dom, /Enter a whole score from 0 to 99 for every team/);
    assert.match(dom, /Round 1/);
  });
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('fixed-team courtside workflow, persistence, backup and offline use', { timeout: 120000, skip: !browser && !required ? 'no Chrome-like browser found' : false }, async t => {
  assert.ok(browser, 'REQUIRE_BROWSER=1 requires a real browser');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'junior-doubles-browser-team-'));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(SOURCE, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(SOURCE + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket, launchError;
  child.on('error', error => { launchError = error; });
  t.after(async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
      socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    }
    socket?.close(); if (child.exitCode === null) child.kill(); await new Promise(resolve => server.close(resolve));
    await delay(500); cleanupBrowser(profile);
  });
  let port;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, 'Chrome must expose its debugging port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(Error(msg.error.message)); else p.resolve(msg.result); }
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
    if (selector.startsWith('#confirm ')) await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  async function fill(selector, value) {
    await click(selector);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp('Input.insertText', { text: String(value) });
  }
  async function screenshot(name) {
    await js('window.scrollTo(0,0)');
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(os.tmpdir(), `junior-team-doubles-${name}.png`), Buffer.from(shot.data, 'base64'));
  }
  const saved = () => js("JSON.parse(localStorage.getItem('junior-team-doubles-v1'))");
  const pairs = () => js("Array.from(document.querySelectorAll('.pair-card')).map(card => Array.from(card.querySelectorAll('[data-player]')).map(el => Number(el.dataset.player)))");
  await cdp('Runtime.enable'); await cdp('Page.enable');
  const downloadPath = path.join(profile, 'exports');
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
  const viewport = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
  await cdp('Emulation.setDeviceMetricsOverride', viewport);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp('Page.navigate', { url: base + '/' });
  await until("!!document.getElementById('names')");
  await js("localStorage.setItem('junior-doubles-v1', 'other-app-sentinel'); caches.open('junior-doubles-v6')");

  await t.test('validates setup and shows complete balanced teams on a narrow phone', async () => {
    await fill('#names', 'Alex\nSam\nCharlie'); await click('[data-action="suggest"]');
    assert.match(await js("document.getElementById('setup-error').textContent"), /even number/);
    await fill('#names', roster); await fill('#duration', 17); await fill('#game', 5); await fill('#change', 1); await fill('#court-numbers', '3, 5');
    await screenshot('setup');
    await click('[data-action="suggest"]');
    assert.equal((await pairs()).flat().length, 8);
    assert.match(await js("document.querySelector('.balance').textContent"), /Difference 0$/);
    await cdp('Emulation.setDeviceMetricsOverride', { ...viewport, width: 360, height: 800 });
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await screenshot('pairing');
  });
  let fixed;
  await t.test('locks, repeatedly shuffles, swaps by tapping a grade, and undoes', async () => {
    const before = await pairs();
    await click('[data-lock="0"]');
    const versions = new Set();
    for (let i = 0; i < 5; i++) {
      await click('[data-action="shuffle"]');
      const current = await pairs();
      assert.deepEqual(current[0], before[0]);
      assert.equal(new Set(current.flat()).size, 8);
      versions.add(current.map(p => p.slice().sort().join(':')).sort().join('|'));
    }
    assert.ok(versions.size > 1, 'shuffles should offer alternatives');
    const current = await pairs(), [a, b] = [current[1][0], current[2][0]];
    await click(`[data-player="${a}"] small`); await click(`[data-player="${b}"] small`);
    const swapped = await pairs(); assert.equal(swapped[1][0], b); assert.equal(swapped[2][0], a);
    await click('[data-action="undo-pairs"]'); assert.deepEqual(await pairs(), current);
    await click('[data-action="confirm-pairs"]');
    fixed = (await saved()).pairs;
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.court-head .court-number')).map(el => el.textContent)"), ['COURT 3', 'COURT 5']);
    assert.match(await js("document.getElementById('finish-time').textContent"), /\d{1,2}:\d{2}\s*(am|pm)/i);
    await screenshot('round');
  });
  await t.test('drafts and running or paused timers survive refresh, early finish needs confirmation', async () => {
    await fill('#court-0-0', 15); await fill('#court-0-1', 10); await fill('#court-1-0', 8); await fill('#court-1-1', 8);
    await click('[data-action="timer"]'); const deadline = (await saved()).timer.end;
    await cdp('Page.reload'); await until("!!document.getElementById('clock')");
    assert.equal((await saved()).timer.end, deadline);
    assert.equal(await js("document.getElementById('court-0-0').value"), '15');
    await click('[data-action="timer"]'); const paused = (await saved()).timer.remaining;
    await cdp('Page.reload'); await until("!!document.getElementById('clock')");
    assert.equal((await saved()).timer.remaining, paused);
    await click('[data-action="advance"]'); assert.equal(await js("document.getElementById('confirm').open"), true);
    await click('#confirm [value="cancel"]'); assert.equal((await saved()).current, 0);
    await click('[data-action="advance"]'); await click('#confirm [value="yes"]'); assert.equal((await saved()).current, 1);
    assert.deepEqual((await saved()).pairs, fixed);
  });
  await t.test('corrects recorded scores and calculates team standings', async () => {
    await click('[data-tab="history"]');
    await js("window.prompt = () => '-12'"); await click('[data-edit="0,0"]');
    assert.deepEqual((await saved()).rounds[0].matches[0].score, [15, 10]);
    await js("window.prompt = () => '11-16'"); await click('[data-edit="0,0"]');
    assert.deepEqual((await saved()).rounds[0].matches[0].score, [11, 16]);
    await click('[data-tab="standings"]');
    assert.equal(await js("document.querySelectorAll('.stand-row').length"), 4);
    assert.match(await js("document.querySelector('.stand-row').textContent"), /1W 0D 0L.*For 16.*Against 11.*Difference \+5/);
    await screenshot('standings');
  });
  let backup;
  await t.test('exports and restores an independent backup and rejects rotating-player backups', async () => {
    await js("window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = blob => { window.exported = blob; return originalCreateURL(blob); }");
    await click('[data-action="export"]'); backup = await js('exported.text()');
    assert.equal(JSON.parse(backup).kind, 'fixed-pairs');
    let download;
    for (let i = 0; i < 100; i++) {
      download = fs.existsSync(downloadPath) && fs.readdirSync(downloadPath).find(name => /^junior-team-doubles-.*\.json$/.test(name));
      if (download) break;
      await delay(50);
    }
    assert.ok(download, 'the export button must download an actual JSON backup');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(downloadPath, download), 'utf8')), JSON.parse(backup));
    await js(`(() => { const input = document.getElementById('import-file'), data = new DataTransfer(); data.items.add(new File([JSON.stringify({version:1,kind:'rotating'})], 'wrong.json', {type:'application/json'})); input.files = data.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until("!document.getElementById('storage-warning').hidden");
    assert.deepEqual((await saved()).pairs, fixed);
    await js(`(() => { const input = document.getElementById('import-file'), data = new DataTransfer(); data.items.add(new File([${JSON.stringify(backup)}], 'backup.json', {type:'application/json'})); input.files = data.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await until("document.getElementById('confirm').open"); await click('#confirm [value="yes"]');
    assert.deepEqual((await saved()).pairs, fixed);
    assert.equal((await saved()).current, 1);
    assert.equal(await js("localStorage.getItem('junior-doubles-v1')"), 'other-app-sentinel');
  });
  await t.test('shows save and clear failures and keeps an exportable in-memory tournament', async () => {
    await js("window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){throw Error('quota');}");
    await fill('#court-0-0', 9);
    assert.equal(await js("document.getElementById('storage-warning').hidden"), false);
    await click('[data-action="export"]');
    assert.equal((JSON.parse(await js('exported.text()'))).drafts['court-0'][0], '9');
    await js('Storage.prototype.setItem = originalSet');
    await js("window.originalRemove = Storage.prototype.removeItem; Storage.prototype.removeItem = function(){throw Error('blocked');}");
    await click('[data-action="new"]'); await click('#confirm [value="yes"]');
    assert.equal(await js("!!document.querySelector('[data-action=advance]')"), true);
    assert.match(await js("document.getElementById('storage-warning').textContent"), /could not be cleared/);
    await js('Storage.prototype.removeItem = originalRemove');
    await fill('#court-0-0', 9);
  });
  await t.test('finishes with unchanged partners and survives a genuinely offline reload', async () => {
    while ((await saved()).current < (await saved()).rounds.length) {
      await js("document.querySelectorAll('[data-score]').forEach(input => { input.value='10'; input.dispatchEvent(new Event('input',{bubbles:true})); })");
      await click('[data-action="advance"]');
    }
    assert.deepEqual((await saved()).pairs, fixed);
    await click('[data-tab="standings"]'); assert.match(await js('document.body.textContent'), /Final results/);
    await until("!!navigator.serviceWorker.controller && document.getElementById('offline-status').textContent === 'Ready for offline use.'");
    const cached = await js("caches.open('junior-team-doubles-v1').then(cache => cache.keys()).then(keys=>keys.map(key=>new URL(key.url).pathname))");
    for (const asset of ['/', '/engine.js', '/app.js', '/icon.svg', '/icon-192.png', '/icon-512.png']) assert.ok(cached.includes(asset), asset);
    assert.ok((await js('caches.keys()')).includes('junior-doubles-v6'));
    await cdp('Network.enable');
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await cdp('Page.reload'); await until("!!document.querySelector('[data-tab=standings]')");
    await click('[data-tab="standings"]'); assert.match(await js('document.body.textContent'), /Final results/);
    assert.deepEqual((await saved()).pairs, fixed);
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });
  await t.test('long names fit and failed first save still allows export', async () => {
    await click('[data-action="new"]'); await click('#confirm [value="yes"]');
    await until("!!document.getElementById('names')");
    await fill('#names', ['A'.repeat(50), 'B'.repeat(50), 'C'.repeat(50), 'D'.repeat(50)].join('\n'));
    await click('[data-action="suggest"]'); assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await js("window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){throw Error('quota');}; window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = blob => { window.exported = blob; return originalCreateURL(blob); }");
    await click('[data-action="confirm-pairs"]');
    assert.equal(await js("document.getElementById('storage-warning').hidden"), false);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    await click('[data-action="export"]'); assert.equal((JSON.parse(await js('exported.text()'))).players.length, 4);
    await js('Storage.prototype.setItem = originalSet');
    await screenshot('long-names');
  });
  assert.deepEqual(errors, []);
});
