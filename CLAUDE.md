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

## Where the tests live

- `test/calc.test.js` the money maths, table-driven in the style of xUnit's
  `[Theory]` so each combination of inputs is its own named case
- `test/page.smoke.test.js` loads `costs/index.html` in headless Chrome and
  checks the page actually rendered. It skips itself if no browser is found.

Unit tests alone are not enough here. Extracting the maths into `costs/calc.js`
once broke the page completely while all the unit tests still passed, which is
why the smoke test exists. Keep both green.

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
