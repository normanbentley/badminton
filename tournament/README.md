# Junior Doubles

A phone-first tournament app for junior doubles, linked from the club tools hub.
Open `index.html` to use it locally. There are no dependencies or build commands.
To use offline caching and installation, serve this directory over HTTPS or
localhost and open it once while online. Wait for “Ready for offline use.”
Installation is available through the browser's install/add-to-home-screen menu
where supported. No hosting or repository settings are changed by this app.

## Running an event

1. Enter 4 to 60 players, one per line. Optional numeric grades use half-point
   steps from 1 to 5, with 5 strongest: `Alex, 3.5`. Ungraded players use 3.
2. Set two or three courts, the total time, game length and changeover allowance.
   The preview immediately shows the maximum equal number of games per player.
3. Create the tournament. Start each round's timer when all courts are ready.
4. Enter each court's final score and save the round. Draws, including 0–0, are
   valid. Finishing a running or paused timer early requires confirmation.
5. Use Results to correct scores. Undo reopens the most recently completed round
   and removes its standings points until it is saved again.

## Fairness and time

For N players each playing G games, N × G must be divisible by four. The app
finds the largest G that can fit in the available waves and court capacity.
For R rounds, planned time is R × game minutes + (R − 1) × changeover minutes.
No generated schedule exceeds the configured budget. Small groups may use fewer
courts, and exact equality can leave spare time or an empty court.

Playing slots follow a shuffled cyclic roster. Nobody is double booked, each
player finishes with exactly G games, and completed playing counts differ by at
most one game after each round. Teams are chosen from those slots using repeated
candidate searches that penalize repeated partners, repeated opponents and skill
imbalance. These preferences are best effort, not guaranteed optimal pairings.
The full schedule is reserved before play, so score corrections cannot change
future playing opportunities.

The configured budget covers planned play and changeovers. Human delays or
pausing the timer can extend the actual event. The timer uses a persisted wall
clock deadline, so switching apps or refreshing does not reset it. Keep the
screen visible to see the finish prompt; background alarms are not guaranteed.

Each player receives their team's result: win 2 points, draw 1, loss 0. Standings
use competition points then point difference. Remaining ties share a rank;
alphabetical display order within a tie does not award a better place.

## Data and verification

Data stays in this browser's local storage. It is not synced between phones or
sent to a server. Export a JSON backup before clearing browser data, changing
devices or replacing a tournament. Import validates the schedule and results.
Use one tab/device to operate an event.

Run `node --test` from the repository root. The tournament tests cover capacity,
equal participation, double bookings, numeric grades, standings, result edits,
saved drafts/timers, and offline reload in a real Chrome-like browser. Set
`REQUIRE_BROWSER=1` to require the browser checks, as CI does.
