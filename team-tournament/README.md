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
Timer settings can keep the screen awake while running and enable a three-tone
end alert with vibration where supported. Keep the page visible for alerts and
use Test alert to check media volume. Settings stay on this browser. Screen-awake
failures are shown and do not stop the timer. Alerts also work on the other app
views, and do not repeat after refresh.

Matches shows round history and lets you correct scores. Up next previews the
following round, including courts and resting pairs. Undo last round is in the
options menu; it returns recorded scores to editable drafts and removes those
points from standings until saved again.

Tournament history in the options menu keeps events when you finish them, start
a new one, import a backup or open history. Saved copies can be resumed, exported
or deleted without changing the active event. Saved timers resume paused.
Distinct versions of imported events remain separate. Export backups for copies
outside this browser. A history save failure blocks replacing the current event.

Single-event backups include fixed teams, results, score drafts, court numbers
and timer state. Data does not sync between devices. If another tab changes the
current event or history, this tab blocks writes and offers Reload latest.

## Choosing the schedule

Equal matches is the default. Set game length and available time as before;
the app fits the largest equal match count it can, and opponents may repeat.
Existing tournaments and backups without a mode keep this behavior.

Round robin schedules every fixed team against every other team exactly once.
Every team gets one match per opponent. Odd team counts have rests, and limited
courts can require extra rounds. Matchups are spread across the smallest number
of rounds that fits both the teams and court capacity.

For round robin, set the available time, changeovers and a game cap. The cap
defaults to 10 minutes and accepts whole minutes from 5 to 60. Game length is the
largest whole number of minutes that fits all rounds and changeovers, up to the
cap. Available time is a maximum; the app shows the planned duration and spare
time rather than stretching games or adding repeat matches to fill the booking.

Games must last at least 5 minutes. If those games cannot fit, the round-robin
option is unavailable and the page states the minimum time needed. Increase
time, add courts or choose Equal matches. If an already selected round robin
stops fitting after an edit, it stays selected with an explanation and tournament
creation is blocked until the settings fit again or another mode is chosen.

For example, 4 teams on 2 courts need 3 rounds. With 2-minute changeovers:

- 30 minutes available gives 8-minute games, 28 minutes planned and 2 spare.
- 60 minutes available with the default cap gives 10-minute games, 34 minutes
  planned and 26 spare.
- 13 minutes available would require 3-minute games, so round robin is unavailable.
  The minimum is 19 minutes for 5-minute games.

The pairing review repeats the chosen format, game length and planned duration.
Confirmed tournaments, timers and backups keep the calculated game length and
scheduling mode. Scoring and standings work the same in both formats.

## Paper score sheet

Open Standings, then Score sheet after confirming the teams to see the grid to copy
onto paper. It has one row per fixed pair and a column for every scheduled
round, followed by a total. Rows are alphabetical by the displayed pair name;
the order of partners within each pair stays unchanged.

Each saved result shows large competition points (win 2, draw 1, loss 0), with
the team's rally points in a small outlined box. For example, a 21-12 win shows
2 with 21 in the box. A nil-all draw shows 1 with 0 in the box. REST marks a
round without a match; scheduled games without saved results stay blank.
Totals add competition points only. Score drafts do not appear as results.

Ranking and Score sheet share the Standings tab. How to read reveals the legend
and guidance; it stays collapsed by default so the grid is immediately visible.
The grid reflects score corrections immediately when reopened. It uses the
same saved tournament as the scoring and standings screens, including after
backup import, refresh and offline use. Enter or correct scores through Current
round or Matches. On a phone, swipe sideways to see later rounds; pair names
stay visible, and column headings stay visible when scrolling down a long list.

## Installation and verification

The application includes the SVG favicon and the supplied 192 and 512 pixel PNG
application icons. The Apple touch icon, manifest and offline cache reference
present files. Install app in the options menu uses the browser installation
prompt when available, otherwise it explains home-screen installation.
Serve over HTTPS or localhost and wait for Ready for offline use
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
save failures, backups, refresh and offline reload. Round-robin checks cover
unique opponents, court limits, odd team counts, minimum and capped game lengths,
mode switching, saved settings and upgrades from the previous offline cache.
Score-sheet tests cover alphabetical names, wins, draws, losses, rests, blanks,
corrections, totals, mobile scrolling, long names and the maximum-size grid.
Screenshots are written to the system temporary directory, outside the repository.

Additional tests cover the combined views, collapsed help, installation guidance,
timer preferences, audio graph creation, wake-lock requests and failures, alerts
away from the round view, undo, history and stale-tab write protection. Browser
tests substitute wake-lock and vibration APIs; physical device wake behavior,
audibility and operating-system installation UI need a device check.
