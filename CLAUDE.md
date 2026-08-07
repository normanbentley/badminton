# Badminton club apps

Static, dependency-free HTML apps served by GitHub Pages. No build step, no npm
packages. Each app is a self-contained page under its own directory:

- `costs/` Shuttle Split, works out what each player owes for a session
- `grading/` Player Grading
- `coach/` Session Coach
- `index.html` the hub linking to them

## Always run the tests before pushing

```
node --test
```

Run it from the repo root and make sure everything passes **before every push**.
Never push with a failing or unrun suite. `costs/` handles real money that
changes hands at a club night, so a wrong number is worse than a missing
feature. CI runs the same command, but do not use CI as the first place the
tests run.

The suite needs nothing installed: Node's built-in test runner, no packages.

This is enforced by a `pre-push` hook in `.githooks/`, which runs the suite and
refuses the push if anything fails. Hooks are per clone, so on a fresh clone
enable it once with:

```
git config core.hooksPath .githooks
```

`git push --no-verify` skips it, which is fine for a README typo and not fine
for anything under `costs/`.

Pages publishes straight from `main`, so a push goes live immediately. There is
no deploy gate on purpose: branch-based publishing has no moving parts, and the
failure worth fearing here is not a broken page (obvious in seconds) but subtly
wrong numbers (silent, and what the tests are for).

## Where the tests live

- `test/calc.test.js` the money maths, table-driven in the style of xUnit's
  `[Theory]` so each combination of inputs is its own named case
- `test/page.smoke.test.js` renders `costs/index.html` in headless Chrome, seeds
  a known club night, and asserts the amounts actually on screen. It skips when
  no browser is found, unless `REQUIRE_BROWSER=1`, which CI sets.

Unit tests alone are not enough here, and two real failures prove it. Extracting
the maths into `costs/calc.js` once broke the page completely while every unit
test passed. Separately, rendering `exact` instead of `share` undercharges
everybody and no unit test can see it. Anything that changes what the page
displays needs a page test, not just a module test.

## Rules for the cost app

- All money maths lives in `costs/calc.js`. Keep it pure: no DOM, no
  `localStorage`, no clock. That is what makes it testable in Node.
- `calc.js` is a plain script, not an ES module, so the page still opens from
  `file://`. It exposes exactly one global, `ShuttleSplit`, and everything else
  stays inside the wrapper. Top-level declarations there are global and will
  collide with the page.
- Shares always round **up** to the next 50c. The organiser must never be left
  out of pocket. Any change to the splitting rules needs a case in
  `test/calc.test.js`.
- The copied group-chat message carries no total on purpose: rounded shares add
  up to more than the session cost, and a mismatched total reads like someone
  skimming.

## Writing

No em dashes anywhere, including UI copy.
