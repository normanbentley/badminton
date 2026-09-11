'use strict';
// Chrome's Windows launcher can return before --dump-dom writes its output or
// closes its profile. Read the real DOM through DevTools, then close Chrome
// explicitly before the calling test removes its own temporary directory.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = function renderBrowser(browser, page, profile, timeout) {
  return execFileSync(process.execPath, [__filename, browser, page, profile], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout
  });
};

async function main() {
  const [browser, page, profile] = process.argv.slice(2);
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket, launchError;
  child.on('error', error => { launchError = error; });
  try {
    let port;
    for (let i = 0; i < 150; i++) {
      if (launchError) throw launchError;
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
    }
    if (!port) throw Error('Chrome did not start its debugging endpoint.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let seq = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const msg = JSON.parse(event.data), p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); if (msg.error) p.reject(Error(msg.error.message)); else p.resolve(msg.result); }
    };
    function cdp(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
    await cdp('Page.enable');
    await cdp('Page.navigate', { url: pathToFileURL(page).href });
    let ready = false;
    for (let i = 0; i < 200; i++) {
      const status = await cdp('Runtime.evaluate', { expression: "location.protocol === 'file:' && document.readyState === 'complete'", returnByValue: true });
      if (status.result.value) { ready = true; break; }
      await delay(50);
    }
    if (!ready) throw Error('The browser did not finish loading the test page.');
    const dom = await cdp('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true });
    if (!dom.result.value) throw Error('Chrome returned an empty DOM.');
    process.stdout.write(dom.result.value);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
      socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    }
    socket?.close();
    if (child.exitCode === null) child.kill();
    await delay(500);
  }
}
if (require.main === module) main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
