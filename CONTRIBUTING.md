# Contributing

cc-board is built in the open, mostly by people driving Claude Code sessions. People and agents follow the same rules.

## Workflow

- One branch per topic, small commits, pull request into `main`. CI (server and UI tests on macOS) must be green.
- Working on several things at once? Use a git worktree per topic: `git worktree add ../cc-board-wt/<topic> -b <topic>`.
- Maintainers deploy to their own app from `main` only, with `./build.sh update`. Plain `./build.sh` recompiles the app and resets its macOS permissions, so run it only when `app/main.swift` changed.

## Ground rules

1. **Tests never touch real sessions.** No test may call the live service's `/api/send`, `/api/answer`, `/api/archive` or `/api/delete`. Typing into a session that shows a dialog answers it for the user.
2. **The sandbox guard stays.** The server treats a non-default port, data directory or home as a sandbox and touches neither Ghostty nor notifications. Don't add a switch that bypasses it.
3. **No runtime dependencies.** The service is Node's standard library; the UI is one HTML file. `playwright-core` is a test-only dependency.
4. **Strings.** Chinese is the source language; English lives between `/* i18n:start */` and `/* i18n:end */` in `ui.html`. Every new Chinese string needs an English entry; `test/ui-check.mjs` checks for gaps.
5. **Change a rule, change the tests.** If you edit a line that `test/mutants.mjs` replaces, update the original text there. Each mutant must still turn the suite red.
6. **Tests must not start a real agent.** The service finds binaries through a login shell (`zsh -lc 'command -v codex'`), so on a developer machine it can reach a real Codex. Tests of the Codex path always send a malformed model name so the request stops before anything launches. Keep it that way.
7. **Layout changes** must keep the number of cards visible per screen no lower than the flat grid; there is a test for it.
8. **File headers** (`[INPUT]` / `[OUTPUT]` / `[POS]`) and the member lists in `CLAUDE.md` files describe what the code does. Update them in the same commit.

## Where to start

Look for issues labelled `good first issue`. The Known limits in the README are a good map: English status tags, more terminals than Ghostty, a universal (Intel) build, an English note for new sessions.
