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
    assert.match(dom, /Keep for Grade 1<\/button>/);
    assert.match(dom, />Skip<\/button>/);
    assert.match(dom, /class="undo"[^>]*disabled/);
  });

  test("names the grade a keep will drop into", () => {
    assert.match(dom, /class="al">Adding to<\/span>/);
    assert.match(dom, /class="on"[^>]*onclick="setAddTo\(0\)">Grade 1</);
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

// Tonight's list holds { k: drill key, g: group index } and is grouped in
// array order, so seeds set it directly and repaint.
const seedNight = (...items) =>
  `night.items = ${JSON.stringify(items)}; normalize(); persist(); labelTabs(); setTab("night");`;

describe("tonight's list, split across two grades", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Grade 1: a footwork drill and a net drill, 8 + 6 minutes.
  // Grade 2: one game, 10 minutes.
  const dom = browser ? withoutScripts(renderPage(browser,
    seedNight({ k: "corners", g: 0 }, { k: "netkill", g: 0 }, { k: "kotc", g: 1 }))) : "";

  test("shows both grades, named", () => {
    assert.match(dom, /class="gname"[^>]*>Grade 1</);
    assert.match(dom, /class="gname"[^>]*>Grade 2</);
  });

  test("lists every drill kept, not just one", () => {
    assert.match(dom, /Six-corner shadow/);
    assert.match(dom, /Net-kill reaction/);
    assert.match(dom, /King of the court 2v2/);
  });

  test("totals each grade separately, so the two nights can be balanced", () => {
    assert.match(dom, /<span class="gsum">2 drills · 14m<\/span>/);
    assert.match(dom, /<span class="gsum">1 drill · 10m<\/span>/);
  });

  test("puts each drill under the grade it belongs to", () => {
    const g1 = dom.slice(dom.indexOf('data-g="0"'), dom.indexOf('data-g="1"'));
    assert.match(g1, /Six-corner shadow/);
    assert.match(g1, /Net-kill reaction/);
    assert.doesNotMatch(g1, /King of the court/);
  });

  test("gives every row a drag handle and a group chip", () => {
    assert.match(dom, /class="grip"/);
    assert.match(dom, /class="gnum"[^>]*>1<\/button>/);
    assert.match(dom, /class="gnum"[^>]*>2<\/button>/);
  });

  test("counts them all on the tab", () => {
    assert.match(dom, /Tonight \(3\)/);
  });

  test("offers to copy the list and to clear it", () => {
    assert.match(dom, /Copy the list/);
    assert.match(dom, /Clear all/);
  });
});

describe("tonight's list, one grade still empty", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser, seedNight({ k: "corners", g: 0 }))) : "";

  test("offers the empty grade as somewhere to drop", () => {
    assert.match(dom, /Drag a drill here, or tap its number chip/);
    assert.match(dom, /<span class="gsum">empty<\/span>/);
  });
});

describe("tonight's list, moving a drill between grades", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `${seedNight({ k: "corners", g: 0 }, { k: "kotc", g: 1 })} swapGroup("corners");`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("the chip sends it across, and it joins the end of the other grade", () => {
    const g2 = dom.slice(dom.indexOf('data-g="1"'));
    assert.ok(g2.indexOf("King of the court") < g2.indexOf("Six-corner shadow"),
      "the moved drill should land after the drill already there");
    assert.match(dom, /<span class="gsum">empty<\/span>/);
    assert.match(dom, /<span class="gsum">2 drills · 18m<\/span>/);
  });
});

/*
 * Drag a row by its grip into another group's list and drop it.
 *
 * The grabbed row leaves the DOM on pointerdown, so the target list moves up
 * the page: its rectangle is measured after the grab, not before, exactly as
 * a finger would find it.
 */
const dragInto = (key, targetGroup, where) => `
  const grip = document.querySelector('[data-key="${key}"] .grip');
  const from = grip.getBoundingClientRect();
  grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: from.left + 5, clientY: from.top + 5 }));
  const to = document.querySelector('.glist[data-g="${targetGroup}"]').getBoundingClientRect();
  const y = ${where === "top" ? "to.top + 4" : "to.bottom - 4"};
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: from.left + 5, clientY: y }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: from.left + 5, clientY: y }));
`;

describe("tonight's list, dragging a drill to the end of the other grade", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `${seedNight({ k: "corners", g: 0 }, { k: "kotc", g: 1 })} ${dragInto("corners", 1, "bottom")}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("lands in the grade it was dropped on, after the drill already there", () => {
    const g2 = dom.slice(dom.indexOf('data-g="1"'));
    assert.match(g2, /Six-corner shadow/);
    assert.ok(g2.indexOf("King of the court") < g2.indexOf("Six-corner shadow"),
      "dropping at the bottom should put it last");
  });

  test("leaves the grade it came from", () => {
    const g1 = dom.slice(dom.indexOf('data-g="0"'), dom.indexOf('data-g="1"'));
    assert.doesNotMatch(g1, /Six-corner shadow/);
    assert.match(g1, /Drag a drill here/);
  });

  test("retotals both grades", () => {
    assert.match(dom, /<span class="gsum">empty<\/span>/);
    assert.match(dom, /<span class="gsum">2 drills · 18m<\/span>/);
  });

  test("clears the ghost row away once dropped", () => {
    assert.doesNotMatch(dom, /class="drill ghost"/);
    assert.doesNotMatch(dom, /class="ph"/);
  });
});

describe("tonight's list, dragging above a drill", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `${seedNight({ k: "corners", g: 0 }, { k: "kotc", g: 1 })} ${dragInto("corners", 1, "top")}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("drops in above it, so order within a grade is the coach's own", () => {
    const g2 = dom.slice(dom.indexOf('data-g="1"'));
    assert.ok(g2.indexOf("Six-corner shadow") < g2.indexOf("King of the court"),
      "dropping at the top should put it first");
  });
});

describe("tonight's list, dragging into an empty grade", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `${seedNight({ k: "corners", g: 0 })} ${dragInto("corners", 1, "top")}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("the empty drop zone accepts it", () => {
    const g2 = dom.slice(dom.indexOf('data-g="1"'));
    assert.match(g2, /Six-corner shadow/);
    assert.match(dom, /<span class="gsum">1 drill · 8m<\/span>/);
  });
});

describe("tonight's list, renamed grades", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `night.names = ["Tuesday juniors", "Thursday seniors"]; ${seedNight({ k: "corners", g: 0 })}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("uses the coach's own names", () => {
    assert.match(dom, /class="gname"[^>]*>Tuesday juniors</);
    assert.match(dom, /class="gname"[^>]*>Thursday seniors</);
  });
});

describe("drill deck, filtered to one type", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser, `setFilter("cat", "net");`)) : "";

  test("deals only that type", () => {
    assert.match(dom, /1 of 3/);
  });
});

describe("drill deck, a drill already kept", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `night.items = [{ k: "corners", g: 0 }]; ${stackDeck("corners", "fan")}`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("is stepped over rather than dealt again", () => {
    assert.match(dom, /Shuttle fan runs/);
    assert.doesNotMatch(dom, /class="drill swipecard"[\s\S]*?Six-corner shadow/);
  });

  test("stays out of the deck whichever grade it was kept for", () => {
    const other = `night.items = [{ k: "corners", g: 1 }]; ${stackDeck("corners", "fan")}`;
    const dom2 = withoutScripts(renderPage(browser, other));
    assert.match(dom2, /Shuttle fan runs/);
  });
});

describe("drill deck, keeping for the second grade", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const seed = `setAddTo(1); ${stackDeck("corners", "fan")} swipe(1); setTab("night");`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("drops the drill into the grade being added to", () => {
    const g2 = dom.slice(dom.indexOf('data-g="1"'));
    assert.match(g2, /Six-corner shadow/);
  });

  test("leaves the first grade empty", () => {
    const g1 = dom.slice(dom.indexOf('data-g="0"'), dom.indexOf('data-g="1"'));
    assert.match(g1, /Drag a drill here/);
  });
});
