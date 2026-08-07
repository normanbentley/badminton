"use strict";

/*
 * Smoke test for costs/index.html.
 *
 * The unit tests cover the maths, but they cannot tell whether the page still
 * wires itself up. When the maths moved into calc.js the whole page stopped
 * rendering (a duplicate global declaration threw) while every unit test kept
 * passing, so this loads the real file in a real browser and checks that the
 * app actually drew itself.
 *
 * Skips itself when no Chrome-like browser is available.
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = path.join(__dirname, "..", "costs", "index.html");

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

/** Serialized DOM after the page's scripts have run. */
function renderPage(browser) {
  const url = "file:///" + PAGE.replace(/\\/g, "/");
  return execFileSync(
    browser,
    ["--headless", "--disable-gpu", "--no-sandbox", "--dump-dom", url],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }
  );
}

const browser = findBrowser();

describe("costs page renders", { skip: browser ? false : "no Chrome-like browser found" }, () => {
  // Script bodies are stripped, otherwise the page's own source satisfies the
  // assertions whether or not anything actually ran.
  const dom = browser ? renderPage(browser).replace(/<script[\s\S]*?<\/script>/g, "") : "";

  test("fills in the cost breakdown, so the script ran", () => {
    assert.match(dom, /2 courts × 3h × \$0\.00 = \$0\.00/);
    assert.match(dom, /0 × \$0\.00 = \$0\.00/);
  });

  test("builds a row for every hour bucket of a three hour session", () => {
    assert.match(dom, /id="in-p3"[\s\S]*id="in-p2"[\s\S]*id="in-p1"/);
  });

  test("restores the saved session length", () => {
    assert.match(dom, /id="h3"[^>]*class="on"/);
  });

  test("prompts for players and hides the copy button until there are some", () => {
    assert.match(dom, /No players yet/);
    assert.match(dom, /Add who played to see shares/);
    assert.match(dom, /id="copyBtn"[^>]*hidden/);
  });

  test("loads the calculation module", () => {
    const withScripts = renderPage(browser);
    assert.match(withScripts, /src="calc\.js"/);
  });
});
