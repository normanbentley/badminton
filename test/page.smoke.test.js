"use strict";

/*
 * End to end checks for costs/index.html in a real browser.
 *
 * The unit tests prove the maths. They cannot prove the page shows it. Both
 * failures below have actually happened here:
 *   - the page died completely (a duplicate global) while every unit test passed
 *   - swapping the rendered `share` for `exact` undercharged everyone, and every
 *     unit test still passed
 * So this renders the real page, seeds a known session, and asserts on the
 * amounts a player would read off the screen.
 *
 * Skips when no Chrome-like browser is available, unless REQUIRE_BROWSER=1,
 * which CI sets so a missing browser fails loudly instead of quietly skipping.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const COSTS_DIR = path.join(__dirname, "..", "costs");
const RENDER_TIMEOUT_MS = 60_000;

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  const absolute = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  for (const p of absolute) if (fs.existsSync(p)) return p;

  for (const cmd of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "ignore" });
      return cmd;
    } catch { /* not on PATH */ }
  }
  return null;
}

/**
 * Render the real page and return the DOM after its scripts have run.
 *
 * `seed` is JavaScript appended after the page's own script. The page keeps its
 * state in a global `S` and repaints with `render()`, so this drives the same
 * code path as a person typing into the form, which no browser flag can do.
 * The page is copied next to a copy of calc.js so the real script tag resolves.
 */
function renderPage(browser, seed) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "shuttle-split-"));
  try {
    fs.copyFileSync(path.join(COSTS_DIR, "calc.js"), path.join(work, "calc.js"));
    let html = fs.readFileSync(path.join(COSTS_DIR, "index.html"), "utf8");
    if (seed) html = html.replace("</body>", `<script>${seed}</script></body>`);
    const page = path.join(work, "index.html");
    fs.writeFileSync(page, html);

    return execFileSync(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        // Its own profile, so a running Chrome is neither disturbed nor blocking.
        "--user-data-dir=" + path.join(work, "profile"),
        "--dump-dom",
        "file:///" + page.replace(/\\/g, "/")
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 16 * 1024 * 1024,
        timeout: RENDER_TIMEOUT_MS
      }
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Script bodies are stripped from assertions, otherwise the page's own source
// satisfies them whether or not a single line of it ran.
const withoutScripts = dom => dom.replace(/<script[\s\S]*?<\/script>/g, "");

const browser = findBrowser();
const browserRequired = process.env.REQUIRE_BROWSER === "1";

test("a browser is available", { skip: browserRequired ? false : "REQUIRE_BROWSER is not set" }, () => {
  assert.ok(browser, "REQUIRE_BROWSER=1 but no Chrome-like browser was found, so the page is untested");
});

describe("costs page, opened fresh", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser)) : "";

  test("fills in the cost breakdown, so the script ran", () => {
    assert.match(dom, /2 courts × 3h × \$0\.00 = \$0\.00/);
    assert.match(dom, /0 × \$0\.00 = \$0\.00/);
  });

  test("builds a row for every hour bucket of a three hour session", () => {
    assert.match(dom, /id="in-p3"[\s\S]*id="in-p2"[\s\S]*id="in-p1"/);
  });

  test("starts on a three hour session", () => {
    assert.match(dom, /id="h3"[^>]*class="on"/);
  });

  test("prompts for players and hides the copy button until there are some", () => {
    assert.match(dom, /No players yet/);
    assert.match(dom, /Add who played to see shares/);
    assert.match(dom, /id="copyBtn"[^>]*hidden/);
  });
});

describe("costs page, a real club night", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // The usual night: 2 courts, 3 hours at $21, 8 shuttles at $5, 9 players for
  // the whole session and 3 for two hours. Costs $166.00 over 33 player-hours.
  const seed = `Object.assign(S, { hours: 3, courts: 2, rate: 21, shuttles: 8, sprice: 5, p3: 9, p2: 3 }); render();`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("shows the rounded share as the amount to pay, not the exact one", () => {
    // The mutation this exists to catch: rendering `exact` here instead of
    // `share` undercharges everyone and no unit test notices.
    assert.match(dom, /class="amt">\$15\.50 <small>each<\/small>/);
    assert.match(dom, /class="amt">\$10\.50 <small>each<\/small>/);
  });

  test("shows the unrounded amount underneath for checking", () => {
    assert.match(dom, /exact \$15\.09/);
    assert.match(dom, /exact \$10\.06/);
  });

  test("labels each bucket with who it covers", () => {
    assert.match(dom, /3 hours<small>× 9 players<\/small>/);
    assert.match(dom, /2 hours<small>× 3 players<\/small>/);
  });

  test("totals the session and the squad", () => {
    assert.match(dom, /Total \$166\.00/);
    assert.match(dom, /12 players · 33 player-hours/);
  });

  test("explains the rounding without claiming a total that does not add up", () => {
    assert.match(dom, /\$126\.00 courts \+ \$40\.00 shuttles/);
    assert.match(dom, /33 player-hours/);
    assert.match(dom, /Collects <b>\$171\.00<\/b> \(\$5\.00 rounding difference\)/);
  });

  test("offers the copy button once there are players", () => {
    assert.doesNotMatch(dom, /id="copyBtn"[^>]*hidden/);
  });
});

describe("costs page, session shortened to two hours", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Same night, then the organiser switches to a 2 hour session. The 9 who
  // stayed the whole time must move down into the 2 hour bucket, giving 24
  // player-hours rather than 6.
  const seed = `Object.assign(S, { hours: 3, courts: 2, rate: 21, shuttles: 8, sprice: 5, p3: 9, p2: 3 }); render(); setHours(2);`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("keeps every player on the bill", () => {
    assert.match(dom, /12 players · 24 player-hours/);
    assert.match(dom, /2 hours<small>× 12 players<\/small>/);
  });

  test("reprices the shorter session", () => {
    assert.match(dom, /class="amt">\$10\.50 <small>each<\/small>/);
    assert.match(dom, /2 courts × 2h × \$21\.00 = \$84\.00/);
  });
});
