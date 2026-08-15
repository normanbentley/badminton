"use strict";

/*
 * End to end checks for drills/index.html in a real browser.
 *
 * Drill Deck has no maths module to unit test: it is all state and rendering,
 * so a page test is the only test worth having. What matters to a coach is
 * that the deck deals a card, that a right swipe keeps the drill and a left
 * one does not, and that tonight's list shows what was kept.
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

const DRILLS_DIR = path.join(__dirname, "..", "drills");
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
 * `seed` is JavaScript appended after the page's own script. The deck is
 * shuffled at load, so every seed pins `deck` to a known order first and then
 * repaints, which drives the same code path as a coach swiping.
 */
function renderPage(browser, seed) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "drill-deck-"));
  try {
    let html = fs.readFileSync(path.join(DRILLS_DIR, "index.html"), "utf8");
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

// Script bodies are stripped from assertions, otherwise the drill library in
// the page's own source satisfies them whether or not a line of it ran.
const withoutScripts = dom => dom.replace(/<script[\s\S]*?<\/script>/g, "");

// Pin the deck to a known order. The page shuffles on load, so without this
// no assertion about which card is showing can be stable.
const stackDeck = (...keys) =>
  `deck = { keys: ${JSON.stringify(keys)}, pos: 0, history: [] }; renderDeck();`;

const browser = findBrowser();
const browserRequired = process.env.REQUIRE_BROWSER === "1";

test("a browser is available", { skip: browserRequired ? false : "REQUIRE_BROWSER is not set" }, () => {
  assert.ok(browser, "REQUIRE_BROWSER=1 but no Chrome-like browser was found, so the page is untested");
});

describe("drill deck, opened fresh", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser)) : "";

  test("deals a card, so the script ran", () => {
    assert.match(dom, /class="drill swipecard"/);
    assert.match(dom, /Coaching points/);
  });

  test("opens on the swipe tab", () => {
    assert.match(dom, /id="tab-deck" class="on"/);
    assert.match(dom, /id="view-all" class="hidden"/);
  });

  test("deals the whole core library, one card in", () => {
    assert.match(dom, /1 of 20/);
  });

  test("offers keep, skip and a disabled undo", () => {
    assert.match(dom, /Keep it<\/button>/);
    assert.match(dom, />Skip<\/button>/);
    assert.match(dom, /class="undo"[^>]*disabled/);
  });

  test("carries no warm-up or warm-down drills, they live in Session Coach", () => {
    assert.doesNotMatch(dom, /Warm-up/);
    assert.doesNotMatch(dom, /Warm-down/);
  });

  test("starts with nothing on tonight's list", () => {
    assert.match(dom, /id="tab-night"[^>]*>Tonight<\/button>/);
  });
});

describe("drill deck, a right swipe", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser
    ? withoutScripts(renderPage(browser, `${stackDeck("corners", "fan")} swipe(1); renderDeck();`))
    : "";

  test("keeps the drill and counts it on the tab", () => {
    assert.match(dom, /Tonight \(1\)/);
  });

  test("moves on to the next card", () => {
    assert.match(dom, /Shuttle fan runs/);
    assert.match(dom, /2 of 2/);
  });

  test("enables undo once there is something to take back", () => {
    assert.doesNotMatch(dom, /class="undo"[^>]*disabled/);
  });
});

describe("drill deck, a left swipe", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser
    ? withoutScripts(renderPage(browser, `${stackDeck("corners", "fan")} swipe(-1); setTab("night");`))
    : "";

  test("keeps nothing", () => {
    assert.match(dom, /Nothing picked yet/);
    assert.match(dom, /id="tab-night"[^>]*>Tonight<\/button>/);
  });
});

describe("drill deck, undoing a keep", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser
    ? withoutScripts(renderPage(browser, `${stackDeck("corners", "fan")} swipe(1); undoSwipe();`))
    : "";

  test("puts the card back and takes it off tonight's list", () => {
    assert.match(dom, /Six-corner shadow/);
    assert.match(dom, /1 of 2/);
    assert.match(dom, /id="tab-night"[^>]*>Tonight<\/button>/);
  });
});

describe("tonight's list, three drills kept", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // A footwork drill, a net drill and a game: 8 + 6 + 10 minutes, 3 types.
  const seed = `picked = ["corners", "netkill", "kotc"]; persist(); labelTabs(); setTab("night");`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("lists every drill kept, not just one", () => {
    assert.match(dom, /Six-corner shadow/);
    assert.match(dom, /Net-kill reaction/);
    assert.match(dom, /King of the court 2v2/);
  });

  test("totals the material so the night can be sized up", () => {
    assert.match(dom, /<b>3<\/b><small>drills<\/small>/);
    assert.match(dom, /<b>24m<\/b><small>of material<\/small>/);
    assert.match(dom, /<b>3<\/b><small>types covered<\/small>/);
  });

  test("counts them on the tab", () => {
    assert.match(dom, /Tonight \(3\)/);
  });

  test("offers to copy the list and to clear it", () => {
    assert.match(dom, /Copy the list/);
    assert.match(dom, /Clear all/);
  });
});

describe("drill deck, filtered to one type", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser, `setFilter("cat", "net");`)) : "";

  test("deals only that type", () => {
    assert.match(dom, /1 of 3/);
  });
});

describe("drill deck, a drill already kept", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `picked = ["corners"]; ${stackDeck("corners", "fan")}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("is stepped over rather than dealt again", () => {
    assert.match(dom, /Shuttle fan runs/);
    assert.doesNotMatch(dom, /class="drill swipecard"[\s\S]*?Six-corner shadow/);
  });
});
