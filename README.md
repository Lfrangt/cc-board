# cc-board

**One window for every Claude Code session you're running.**
Delivered work comes up sharp and in front. Sessions still working sit blurred behind. When one stops, its card says why.

> macOS (Apple Silicon) · Node 22, zero npm dependencies · MIT
> Independent project. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are Anthropic's trademarks.

https://github.com/user-attachments/assets/7762fc75-473b-4fbf-aecc-2832c3b4d52b

<sub>The video was recorded on an earlier build of the UI, before stop-reason pills, project columns, zoom, archive and next-step suggestions. [Download it](docs/media/cc-board-launch.mp4) (6 MB, with sound).</sub>

## The problem

Run four or five Claude Code sessions at once and your day turns into watching terminals. Which one finished? Which one is waiting on me? Which one hit the rate limit twenty minutes ago and has been sitting there ever since?

cc-board turns each session into a card and shows three things only: what you asked, what it delivered, and, if it stopped, why.

## Native Claude Code. Not a harness.

cc-board never runs an agent loop and never replaces your CLI.

- **Every session is a real `claude` process in a real terminal**: a tab you already have open in Ghostty, or a tmux session cc-board starts for you (`tmux -L ccboard`). You can attach to it and drive it yourself at any time.
- **It reads what Claude Code already writes**: `~/.claude/sessions/*.json` and the transcripts under `~/.claude/projects`, read-only. No SDK, no `claude -p`, no API proxy. Your login, settings, hooks and `CLAUDE.md` stay exactly as they are.
- **It types the way you would**: paste, then Enter. It refuses to type into a session that is showing a selection dialog, so it can't answer a permission prompt for you by accident.
- **Local only**: the server binds to `127.0.0.1`, every endpoint needs a token, and nothing leaves your machine. No telemetry, no outbound requests, no remote assets in the UI.
- **Delete it and nothing changes** in your Claude Code setup.

## What you see

- **Cover view** (default): the session that most needs you is front and sharp; running ones fade back. Reply, press Return, and the next delivery comes up. **Wall view**: everything at a glance, one column per project.
- **Why it stopped**, written on the card: running (with how long), or stopped because the quota ran out, the login expired, the model's safeguards blocked the message, the API errored, you interrupted it, it never finished, or its process exited. A session that is "running" but has been silent for 20 minutes says so. You also get a system notification and a Dock badge when you're not looking.
- **What it delivered**: a one-line conclusion and the single thing it wants from you. *Needs follow-up* (it wants a decision) is separate from *ready to review* (here is a result) and *no action needed*.
- **Start and tidy up from the board**: new tasks (⌘N, or the "+ New task" in a project column), image and file attachments, zoom a card (⌘O or double-click), archive (empty sessions are deleted, the rest are kept with a note, undo for 8 seconds).
- **Next-step suggestions in the reply box**: for sessions in cc-board's own tmux, the ghost-text suggestion Claude Code shows in its prompt, and the numbered next steps a next-steps plugin draws above it, are read off the terminal screen (read-only) and shown on the card. Press Tab in the empty box to take the suggestion, or click a step (or press 1–3 on the card you are looking at) to drop it into the box as a draft. Nothing is sent until you press Return. Step 1 uses the full suggestion; steps 2 and 3 use their short label, because that is all the screen shows.
- English and Chinese UI; it follows the system language, or add `?lang=en` to the URL.

| Card says | Evidence in the transcript |
|---|---|
| Stopped · quota used up | assistant message flagged `isApiErrorMessage` with `error: rate_limit` |
| Stopped · login expired | the same, `authentication_failed` |
| Stopped · blocked by safeguards | assistant message flagged `isApiErrorMessage` with `stop_reason: refusal`. The card also shows Claude Code's own advice: press Esc twice to edit your last message, or switch models with `/model` |
| Stopped · error | any other API error (context too long, for example) |
| Stopped · interrupted | `[Request interrupted by user]` in the middle of a turn |
| Stopped · unfinished | idle, did work this turn, never wrote a closing message |
| Running · N min quiet | busy, but no new transcript or subagent activity for 20 minutes |
| Stopped · process exited | was busy or waiting, then the process vanished and cc-board didn't stop it |

## Install

You need macOS 13+ on Apple Silicon, Node 22+, `tmux`, the Xcode Command Line Tools (for `swiftc`) and Claude Code. [Ghostty](https://ghostty.org) is optional: it is only needed to reply into sessions you started yourself in a terminal tab. Sessions started from cc-board work without it.

```sh
git clone https://github.com/Lfrangt/cc-board.git
cd cc-board
./build.sh                       # compiles the small Swift/WKWebView shell, installs ~/Applications/总控台.app
open ~/Applications/总控台.app
```

The app bundle is still called 总控台 ("main console" in Chinese); an English name is an open question. Node is looked up at `~/.local/node/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. On first launch macOS asks whether the app may control Ghostty. Every rebuild changes the ad-hoc signature, so it asks again.

After you pull changes, `./build.sh update` swaps in the new `ui.html`, `server.mjs`, `projects.mjs` and `suggest.mjs` and restarts the service. No recompile, no new permission prompt.

Want a look without building anything?

```sh
node server.mjs
open "http://127.0.0.1:4747/?k=$(cat ~/Library/Application\ Support/cc-board/.token)"
```

## Configuration

One optional file: `config.json` in the data directory (`~/Library/Application Support/cc-board`, or `$CCBOARD_DATA`). It is read once at startup; run `./build.sh update` to restart the service after editing. A missing file, invalid JSON, a wrongly typed key or a bad regex means the whole file is ignored: defaults apply and one line is logged.

| Key | Default | What it does |
|---|---|---|
| `projects` | `[]` | Names for your project columns: `{ "key", "name", "dir", "word" }`. `dir` matches the folders a session touched, `word` matches its title and your messages; both are case-insensitive regex strings and either may be omitted. Folders you never list still get a column named after the folder. |
| `neutral` | `"^Projects/shared$"` | Regex for folder roots that don't count as evidence of a project (shared locks, scratch space). |
| `roots` | `["Projects", "Desktop"]` | Parent folders, relative to your home, whose direct subfolders count as evidence of a project. Longest match wins; list `Projects/shared` next to `Projects` if you want both. |
| `autoTrust` | `false` | For Claude sessions cc-board itself starts in your home directory, answer Claude Code's one-time "trust this folder" prompt for you, only when the option reads exactly `Yes, I trust this folder`. Sessions in any other folder are never answered for you. Off means the dialog stays on the card and you choose. |
| `codex` | `false` | Experimental: also list and start Codex CLI sessions. Everything else in this README is about Claude Code. |

## Known limits

- **Follow-up detection is Chinese-first.** The reliable signal is a last line the agent writes itself: `【待跟进】…` (needs you), `【待审阅】…` (ready to review), `【进展】…` (progress). Without it, cc-board guesses from the text; the guesses are tuned for Chinese and cover only a few English phrasings ("please confirm", "your call"). English status tags are the first thing we want to add.
- **Replying into a session you started in a terminal tab works for Ghostty only.** Sessions started from cc-board work without it.
- **New sessions start in your home directory** with a short note (in Chinese, for now) telling Claude to find or create the right project folder under `~/Projects`.
- **Apple Silicon only** (`-target arm64-apple-macos13`).
- Safari-engine rendering (the real app) has had less testing than Chrome-engine rendering (the UI tests).

## Develop

```sh
npm install                       # only for the UI tests (playwright-core)
node test/projects.test.mjs       # project-grouping rules, under a second
node test/state.test.mjs          # the server, in a throwaway fake $HOME, about 90 s
node test/mutants.mjs             # deliberately broken servers; each must turn the suite red, about 7 min
node test/state.test.mjs --ui &   # then:
node test/ui-check.mjs            # headless Chromium against the fixture
```

The tests never touch your real `~/.claude`, tmux or Ghostty. The server treats any non-default port, data directory or home as a sandbox and leaves the real ones alone.

```
server.mjs     the service: reads sessions, works out each card's state, serves /api
ui.html        the whole interface, one file
projects.mjs   project grouping (pure functions)
suggest.mjs    reads Claude Code's ghost-text suggestion and next-step options off the tmux screen (pure function)
app/           the native shell (Swift, WKWebView)
test/          isolated tests
CLAUDE.md      long-form design notes in Chinese: each rule, why it is that way, and the feedback behind it
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) for the code. The launch video and preview in `docs/media/` are not covered by it: the soundtrack uses Apple Loops from GarageBand, which Apple licenses for use in finished works, not for redistribution on their own.
