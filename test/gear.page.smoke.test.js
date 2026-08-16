"use strict";

/*
 * End to end checks for gear/index.html in a real browser.
 *
 * The unit tests prove the date maths. They cannot prove the page shows it:
 * the costs app has already demonstrated both ways that goes wrong (a dead
 * page with green unit tests, and the wrong figure rendered with green unit
 * tests). So this renders the real page, seeds known events dated relative to
 * today, and asserts on the ages and due dates a player would read off the
 * screen.
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

const GEAR_DIR = path.join(__dirname, "..", "gear");
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
 * `seed` is JavaScript appended after the page's own script. The page keeps
 * its state in a global `S` and repaints with `render()`, and its own
 * `isoDaysAgo` helper lets a seed date events relative to today, so the
 * assertions below hold whichever day the suite runs.
 */
function renderPage(browser, seed) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "racket-ready-"));
  try {
    fs.copyFileSync(path.join(GEAR_DIR, "calc.js"), path.join(work, "calc.js"));
    let html = fs.readFileSync(path.join(GEAR_DIR, "index.html"), "utf8");
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

describe("gear page, opened fresh", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  const dom = browser ? withoutScripts(renderPage(browser)) : "";

  test("shows both default rackets, so the script ran", () => {
    assert.match(dom, /Racket 1/);
    assert.match(dom, /Racket 2/);
  });

  test("says nothing has been logged yet", () => {
    assert.match(dom, /No restrings yet/);
    assert.match(dom, /No regrips yet/);
  });

  test("starts with a four week expected life for both items", () => {
    assert.match(dom, /id="life-strings"[^>]*value="28"/);
    assert.match(dom, /id="life-grip"[^>]*value="28"/);
  });

  test("keeps the log form hidden until asked for", () => {
    assert.match(dom, /id="logCard"[^>]*hidden/);
  });

  test("promises the data stays on the phone", () => {
    assert.match(dom, /saved on this phone only/);
  });
});

describe("gear page, a rotation in progress", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Racket 1: restrung 41 and 13 days ago, regripped 3 days ago.
  // Racket 2: restrung 30 days ago, so 2 days past the 28 day budget.
  const seed = `
    S = sanitizeState({ rackets: S.rackets, life: S.life, events: [
      { racketId: "r1", type: "strings", date: isoDaysAgo(41), string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets", cost: 25 },
      { racketId: "r1", type: "strings", date: isoDaysAgo(13), string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets", cost: 25 },
      { racketId: "r1", type: "grip", date: isoDaysAgo(3), brand: "Karakal PU", cost: 6 },
      { racketId: "r2", type: "strings", date: isoDaysAgo(30), string: "BG65", note: "felt dead early" }
    ]});
    render();`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("shows each item's age and days left", () => {
    assert.match(dom, /Restrung 13 days ago/);
    assert.match(dom, /15 days left/);
    assert.match(dom, /Regripped 3 days ago/);
    assert.match(dom, /25 days left/);
  });

  test("calls out the racket that is past its budget", () => {
    assert.match(dom, /Restrung 30 days ago/);
    assert.match(dom, /<span class="due">2 days overdue<\/span>/);
  });

  test("shows how long the replaced strings actually lasted, under a History label", () => {
    assert.match(dom, />History</);
    assert.match(dom, /lasted 28 days/);
  });

  test("marks the set still in use", () => {
    assert.match(dom, /in use · 13 days so far/);
  });

  test("shows the recorded details and note for asking why later", () => {
    assert.match(dom, /BG65 · 24 lbs · white · Straight Sets · \$25\.00/);
    assert.match(dom, /Karakal PU · \$6\.00/);
    assert.match(dom, /felt dead early/);
  });
});

describe("gear page, logging a restring", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Opening the form prefills the previous restring's details, so the usual
  // same-string-same-tension case is two taps.
  const seed = `
    S = sanitizeState({ rackets: S.rackets, life: S.life, events: [
      { racketId: "r1", type: "strings", date: isoDaysAgo(13), string: "BG65", tension: "24 lbs", color: "white", stringer: "Straight Sets", cost: 25 }
    ]});
    render();
    openLog("r1", "strings");
    // The hidden attribute alone once left rows visible because .frow's
    // display: flex overrode the browser's [hidden] rule. Only the computed
    // style proves what a player actually sees, so it is copied somewhere a
    // DOM dump keeps.
    document.body.dataset.gripRowDisplay = getComputedStyle(document.querySelector('[data-for="grip"]')).display;
    document.body.dataset.stringRowDisplay = getComputedStyle(document.querySelector('[data-for="strings"]')).display;`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("titles the form with the action and the racket", () => {
    assert.match(dom, /Restring Racket 1/);
  });

  test("opens inside the tapped racket's strings slot, not below the page", () => {
    assert.match(dom, /id="slot-r1-strings"><div class="logform" id="logCard">/);
    assert.match(dom, /id="slot-r1-grip"><\/div>/, "the other slots stay empty");
  });

  test("puts no upper limit on the date, so a pickup next week can be logged now", () => {
    assert.doesNotMatch(dom, /id="f-date"[^>]*max=/);
  });

  test("prefills the previous details but never the note", () => {
    assert.match(dom, /id="f-string"[^>]*value="BG65"/);
    assert.match(dom, /id="f-tension"[^>]*value="24 lbs"/);
    assert.match(dom, /id="f-color"[^>]*value="white"/);
    assert.match(dom, /id="f-stringer"[^>]*value="Straight Sets"/);
    assert.match(dom, /id="f-cost"[^>]*value="25"/);
    assert.match(dom, /id="f-note"[^>]*value=""/);
  });

  test("hides the grip fields on a restring, and really renders none of them", () => {
    assert.match(dom, /data-for="grip"[^>]*hidden/);
    assert.match(dom, /data-grip-row-display="none"/);
    assert.match(dom, /data-string-row-display="flex"/);
  });
});

describe("gear page, editing a logged restring", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Edit must load the entry's own values (note and date included), and Save
  // must replace it rather than add a second event. sanitizeState names an
  // event without an id "e1".
  const seed = `
    S = sanitizeState({ rackets: S.rackets, life: S.life, events: [
      { racketId: "r1", type: "strings", date: isoDaysAgo(13), string: "BG65", tension: "24 lbs", note: "felt dead early" }
    ]});
    render();
    editEvent("e1");
    document.body.dataset.editNote = document.getElementById("f-note").value;
    document.getElementById("f-tension").value = "26 lbs";
    saveLog();`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("titles the form as an edit of that racket", () => {
    assert.match(dom, /Edit restring, Racket 1/);
  });

  test("loads the entry's own note, which a fresh log never does", () => {
    assert.match(dom, /data-edit-note="felt dead early"/);
  });

  test("saves in place: new tension, same date, no duplicate entry", () => {
    // The detail line, not the bare value: the closed form's inputs still
    // carry their load-time value attributes in a serialized DOM.
    assert.match(dom, /BG65 · 26 lbs/);
    assert.doesNotMatch(dom, /BG65 · 24 lbs/);
    assert.match(dom, /Restrung 13 days ago/);
    assert.doesNotMatch(dom, /lasted/, "a second event would show a lasted interval");
    assert.match(dom, /felt dead early/);
  });
});

describe("gear page, a restring waiting for pickup", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Paid for already, dated at pickup day next week. Until then the headline
  // must not claim the racket was restrung today.
  const seed = `
    S = sanitizeState({ rackets: S.rackets, life: S.life, events: [
      { racketId: "r1", type: "strings", date: isoDaysAgo(13), string: "BG65" },
      { racketId: "r1", type: "strings", date: isoDaysAgo(-7), string: "BG80" }
    ]});
    render();`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("shows the waiting set as starting on pickup day, not as restrung today", () => {
    assert.match(dom, /New strings from/);
    assert.match(dom, /starts in 7 days/);
    assert.doesNotMatch(dom, /Restrung today/);
  });

  test("the old strings run until the swap on pickup day", () => {
    assert.match(dom, /lasted 20 days/);
  });
});

describe("gear page, saving a regrip", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Drives the full save path: open the form, type a brand and cost, save.
  const seed = `
    openLog("r2", "grip");
    document.getElementById("f-brand").value = "Karakal PU";
    document.getElementById("f-cost").value = "8";
    saveLog();`;
  const dom = browser ? withoutScripts(renderPage(browser, seed)) : "";

  test("the new grip shows as regripped today and in use", () => {
    assert.match(dom, /Regripped today/);
    assert.match(dom, /28 days left/);
    assert.match(dom, /in use · 0 days so far/);
  });

  test("the typed details land in the history", () => {
    assert.match(dom, /Karakal PU · \$8\.00/);
  });

  test("the form closes after saving", () => {
    assert.match(dom, /id="logCard"[^>]*hidden/);
  });
});
