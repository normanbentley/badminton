# Badminton club apps

This is the owner's private GitHub repository. Preserve its visibility. Do not
push, publish or deploy without the owner's instruction. Publishing main can
make the apps live, as described in the existing project notes.

Read and follow CLAUDE.md for the established architecture, testing requirements,
cost calculation rules and writing conventions. Those rules remain applicable
regardless of which coding agent is used.

Apps are static and dependency-free, each under its own directory. The root
index.html is the app launcher. Use node --test for verification; UI changes
need real browser tests as well as any relevant pure logic tests.

Junior Doubles lives in tournament/. Its pure scheduling and standings logic is
in engine.js. Equal official game counts, no double booking and a planned
duration within the configured budget are mandatory scheduling invariants.
Partner variety and skill balance are best-effort optimizations. Local data
belongs to this browser; retain export/import and visible save failure feedback.
