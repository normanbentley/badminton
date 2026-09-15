# Junior Team Doubles

A phone-first fixed-partner doubles tournament app. Paste an even number of
players with optional grades, such as `Alex, 3.5`. The app suggests balanced
teams by combined grade. Coaches can lock requested partnerships, shuffle the
remaining players repeatedly, swap any two players, undo changes and review the
balance before confirming the teams.

Confirmed partners stay together throughout the tournament. The schedule gives
every team the same number of official matches, never double books a team and
fits the configured game and changeover time inside the available budget.
Opponent variety and match skill balance are best-effort optimizations.

Results and standings belong to teams. A win earns 2 points, a draw earns 1 and
a loss earns 0. Point difference breaks ties, with remaining ties sharing rank.

Data stays in this browser. Tournament backups can be exported and imported,
and save failures are shown visibly. The app has its own storage and offline
cache, separate from the rotating-partner Junior Doubles app.

Run `node --test` from the repository root to verify the app.

## Pairing and running an event

Grades use half-point steps from 1 to 5. Missing grades use 3. The roster must
contain 4 to 60 uniquely named players, with nobody left out. Initial suggestions
pair high and low grades; equal grades are shuffled. Shuffle unlocked allows a
small grade difference to offer alternative teams. Best balance restores the
most even grade totals possible for the unlocked players. Requested locks can
force a wider overall difference, which is shown before confirmation.

Tap two player buttons to swap their places. A manual swap unlocks affected
teams; Undo restores the previous pairings and locks. Confirmed teams cannot be
edited during a tournament. Custom court numbers appear in scoring and results.

Start or pause the round timer when courts are ready. It persists across refresh.
Finishing a running or paused round early requires confirmation. Estimated finish
includes remaining games and changeovers and updates with delays or pauses.
The configured budget starts at confirmation; real-world delays may extend it.
The timer shows a visible message at time. Keep the page visible to see it.

Results shows the current tournament's round history and lets you correct scores.
A new tournament or restored backup replaces the current event. Export each
completed event you want to keep; this app does not maintain a separate archive
of previous tournaments. Single-event backups include fixed teams, results,
score drafts, court numbers and timer state. Data does not sync between devices.

## Installation and verification

The application includes the SVG favicon and the supplied 192 and 512 pixel PNG
application icons. The Apple touch icon, manifest and offline cache reference
present files. Serve over HTTPS or localhost and wait for Ready for offline use
before going offline. It also opens directly from a local file without caching.

Run the focused checks from the repository root:

```sh
node -c team-tournament/engine.js
node -c team-tournament/app.js
node -c team-tournament/sw.js
node --test test/team-tournament.engine.test.js
node --test test/team-tournament.page.smoke.test.js
node --test
```

Set `REQUIRE_BROWSER=1` when running the page tests to require Chrome or Edge
instead of skipping if no browser is found. Set `CHROME_PATH` if needed. In
PowerShell, use `$env:REQUIRE_BROWSER='1'` before the command. Tests exercise
phone touch controls, locked shuffles, swaps and undo, scoring and corrections,
save failures, backups, refresh and offline reload. Screenshots are written to
the system temporary directory, outside the repository.
