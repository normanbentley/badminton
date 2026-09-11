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
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
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
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(Error(msg.error.message)); else p.resolve(msg.result); }
  };
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function js(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await js(expression)) return; await delay(50); } assert.fail('Timed out: ' + expression); }
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const saved = () => js(`JSON.parse(localStorage.getItem('junior-doubles-v1'))`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp('Page.navigate', { url: base + '/tournament/' });
  await until(`!!document.getElementById('names')`);

  await t.test('setup reacts immediately to numeric grades and changing game length', async () => {
    await fill('#names', 'Alex, 3.5\nSam, 5\nCharlie, 1\nHarper\nJamie, 2.5\nTaylor, 4\nRiley, 2\nJordan, 4.5');
    await fill('#duration', 17); await fill('#game', 5); await fill('#change', 1);
    assert.match(await js(`document.getElementById('preview').textContent`), /3 games each/);
    await fill('#game', 8);
    assert.match(await js(`document.getElementById('preview').textContent`), /2 games each/);
    await fill('#game', 5); await click('#create');
    assert.equal((await saved()).players[0].skill, 3.5);
    assert.equal(await js(`document.querySelectorAll('[data-score]').length`), 4);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-round.png'), Buffer.from(screenshot.data, 'base64'));
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
    await click('#confirm [value="yes"]'); await until(`document.body.textContent.includes('Round 2')`);
    assert.equal((await saved()).current, 1);
    await click('[data-tab="standings"]');
    assert.equal(await js(`document.querySelectorAll('.stand-row').length`), 8);
    assert.match(await js(`document.querySelector('.stand-row').textContent`), /1\/3 played/);
  });
  await t.test('editing a prior result updates standings, and undo preserves scores for re-entry', async () => {
    await click('[data-tab="history"]'); await click('[data-edit="0,0"]');
    await fill('#edit-0', 1); await fill('#edit-1', 20); await click('[data-action="save-edit"]');
    assert.deepEqual((await saved()).rounds[0].matches[0].score, [1, 20]);
    await click('[data-tab="round"]'); await click('[data-action="undo"]'); await click('#confirm [value="yes"]');
    await until(`!!document.getElementById('court-0-0') && document.getElementById('court-0-0').value === '1'`);
    assert.equal((await saved()).current, 0);
    assert.equal((await saved()).rounds[0].matches[0].score, null);
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
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(os.tmpdir(), 'junior-doubles-standings.png'), Buffer.from(screenshot.data, 'base64'));
  });
  await t.test('a cached app reloads offline with the completed tournament intact', async () => {
    await until(`document.getElementById('offline-status').textContent.includes('Ready')`);
    await cdp('Network.enable');
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await cdp('Page.reload');
    await until(`document.body.textContent.includes('Everyone played 3 games')`);
    assert.equal((await saved()).current, 3);
    assert.deepEqual(errors, []);
  });
  await t.test('a backup restores a completed tournament and invalid imports preserve it', async () => {
    const backup = await saved();
    await click('[data-action="new"]'); await click('#confirm [value="yes"]');
    await until(`!!document.getElementById('names')`);
    async function importData(data) {
      await js(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(JSON.stringify(data))}], 'backup.json', { type: 'application/json' })); const input = document.getElementById('import'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    }
    await importData(backup); await until(`document.getElementById('confirm').open`);
    await click('#confirm [value="yes"]');
    await until(`document.body.textContent.includes('Everyone played 3 games')`);
    assert.equal((await saved()).current, 3);
    await importData({ version: 99 });
    await until(`document.getElementById('storage-warning').textContent.includes('Could not import')`);
    assert.equal((await saved()).current, 3);
  });
});
