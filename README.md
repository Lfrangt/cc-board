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

- **Every session is a real `claude` process in a real terminal**: a tab you already have open in Ghostty, or a tmux session cc-board starts for you (each one on its own tmux server under `~/.cc-board/tmux/`, so a crash takes no other session with it; `tmux -S ~/.cc-board/tmux/<name>.sock attach -t <name>`). You can attach to it and drive it yourself at any time.
- **It reads what Claude Code already writes**: `~/.claude/sessions/*.json` and the transcripts under `~/.claude/projects`, read-only. No SDK, no API proxy, and your sessions never run through `claude -p`. The only `claude -p` calls come from two optional helpers, both off by default: auto-continue and the tidy-up check (`tidyJudge`), each a single `claude -p --model haiku` with no tools, no MCP servers and none of your settings files. Your login, settings, hooks and `CLAUDE.md` stay exactly as they are.
- **It types the way you would**: paste, then Enter. It refuses to type into a session that is showing a selection dialog, so it can't answer a permission prompt for you by accident.
- **Local only**: the server binds to `127.0.0.1`, every endpoint needs a token, and nothing leaves your machine. No telemetry, no outbound requests, no remote assets in the UI.
- **Delete it and nothing changes** in your Claude Code setup.

## What you see

- **Cover view** (default): the session that most needs you is front and sharp; running ones fade back. Reply, press Return, and the next delivery comes up. **Wall view**: everything at a glance, one column per project; cards that need you stay full size, while the rest collapse into expandable strips.
- **Why it stopped**, written on the card: running (with how long), or stopped because the quota ran out, the login expired, the model's safeguards blocked the message, the API errored, you interrupted it, it never finished, or its process exited. A session that is "running" but has been silent for 20 minutes says so. You also get a system notification and a Dock badge when you're not looking.
- **What it delivered**: a one-line conclusion and the single thing it wants from you. *Needs follow-up* (it wants a decision) is separate from *ready to review* (here is a result) and *no action needed*.
- **Start and tidy up from the board**: new tasks (⌘N, or the "+ New task" in a project column), image and file attachments, zoom a card (⌘O or double-click), jump to any window by name (⌘K), drafts you have not sent survive a reload, archive (empty sessions are deleted, the rest are kept with a note, undo for 8 seconds); ⌘Z undoes "Reviewed" / "Later", and ↑ in an empty reply box brings back what you last sent.
- **Previews inside the board**: click a local path in a delivery and web pages, PDFs, images, video, audio, Markdown and plain text open in a near-full-window preview. A folder that is mostly images or video opens as a gallery (click one to enlarge, ← → to flip, Esc goes back to the grid), and a delivery that mentions two or more images gets a "Gallery" button at the top of its text, so a batch of screenshots is one click instead of one per file. Other folders and files a browser cannot show (Word, Keynote, apps) still go to macOS as before, and ⌘-click (or "Open in browser" / "Show in Finder") always does. Pages and media are served read-only from a second local port (main port + 1000), so a page's scripts cannot reach the board's token or `/api`; each preview URL opens only its own folder (a fixed list of web file types, no dot-folders, no symlinks leading out). Esc closes the preview even after you click into a page.
- **Next-step suggestions in the reply box**: for sessions in cc-board's own tmux, the ghost-text suggestion Claude Code shows in its prompt, and the numbered next steps a next-steps plugin draws above it, are read off the terminal screen (read-only) and shown on the card. Press Tab in the empty box to take the suggestion, or click a step (or press 1–3 on the card you are looking at) to drop it into the box as a draft. Nothing is sent until you press Return. Step 1 uses the full suggestion; steps 2 and 3 use their short label, because that is all the screen shows.
- **Auto-continue** (off by default, `autoContinue` below): when a session in cc-board's own tmux finishes a turn that needs nothing from you (not *needs review*, not *needs follow-up*) and its prompt shows a ghost-text suggestion, cc-board can tell it to carry on with the next step it proposed itself. The suggestion is only used to decide and is never sent: it is the CLI's guess at what you would say, and it can claim things you never did. A keyword gate stops anything that posts, pays, submits for review, signs in, deletes or pushes; those become *needs follow-up*. It also stops shell and built-in slash commands, and any suggestion that speaks for you ("I listened to it", "looks good, ship it"): those are simply not sent, the card stays as it is and says why, because a guess is no reason to change what you see. The rest goes to one `claude -p --model haiku` call that answers go, wait or yours. On go the card counts down 30 seconds with *Send* and *Cancel*; typing in that card also cancels. What gets sent is one fixed sentence that starts with a marker saying you did not type it and tells the session to stop at anything that needs you. It stops after five automatic turns in a row without a word from you, and when that account's 5-hour or weekly usage passes its limit.
- **Subscription usage in the top bar**: one grey pill per subscription showing its weekly limit, for example `Claude · ben 1%` and `Codex 34%`. A pill turns amber once any of its windows reaches 85%. Hover for each window's usage, when it resets and how old the number is. Codex's numbers come from the rate limits Codex writes into its own session logs (only when the `codex` option is on). Claude Code only reports usage to a status-line command, so a Claude pill stays empty (`—`) until you set that up, see [Usage in the top bar](#usage-in-the-top-bar-optional).
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
CCBOARD_APP_NAME=cc-board ./build.sh   # compiles the small Swift/WKWebView shell, installs ~/Applications/cc-board.app
open ~/Applications/cc-board.app
```

Without `CCBOARD_APP_NAME` the bundle is called 总控台 ("main console" in Chinese), which is the author's own build. The app looks for Node 22 or later in this order: a path you write into `~/Library/Application Support/cc-board/node`, then `~/.local/node/bin`, `/opt/homebrew/bin` and `/usr/local/bin`, then Homebrew's `node@NN` kegs, then nvm, fnm, Volta, mise, asdf and nodenv (newest version first), then your login shell's `PATH`. On first launch macOS asks whether the app may control Ghostty. Every rebuild changes the ad-hoc signature, so it asks again.

After you pull changes, `./build.sh update` swaps in the new `ui.html`, `server.mjs`, `projects.mjs`, `suggest.mjs`, `limits.mjs`, `statusline-tap.mjs` and `accounts.mjs` and restarts the service. No recompile, no new permission prompt.

Want a look without building anything?

```sh
node server.mjs
open "http://127.0.0.1:4747/?k=$(cat ~/Library/Application\ Support/cc-board/.token)"
```

## Configuration

One optional file: `config.json` in the data directory (`~/Library/Application Support/cc-board`, or `$CCBOARD_DATA`). It is read once at startup (only `autoContinue` is re-read every 10 seconds); run `./build.sh update` to restart the service after editing. A missing file, invalid JSON, a wrongly typed key or a bad regex means the whole file is ignored: defaults apply and one line is logged.

| Key | Default | What it does |
|---|---|---|
| `projects` | `[]` | Names for your project columns: `{ "key", "name", "dir", "word" }`. `dir` matches the folders a session touched, `word` matches its title and your messages; both are case-insensitive regex strings and either may be omitted. Folders you never list still get a column named after the folder. |
| `neutral` | `"^Projects/shared$"` | Regex for folder roots that don't count as evidence of a project (shared locks, scratch space). |
| `roots` | `["Projects", "Desktop"]` | Parent folders, relative to your home, whose direct subfolders count as evidence of a project. Longest match wins; list `Projects/shared` next to `Projects` if you want both. |
| `autoTrust` | `false` | For Claude sessions cc-board itself starts, in whatever folder (including ones an agent opens through `/api/new`), answer Claude Code's "trust this folder" prompt for you, only when the option reads exactly `Yes, I trust this folder`. Any other dialog is left alone. Off means the dialog stays on the card and you choose. |
| `autoContinue` | `false` | Auto-continue (see above). Re-read every 10 seconds, so removing it or setting it to `false` stops it without a restart. `true` turns it on with the defaults; an object turns it on and changes some of them: `{ "weekMax": 90, "fiveMax": 85, "maxRun": 5, "skip": "<regex>" }` (stop at this weekly / 5-hour usage %, at most this many automatic turns in a row, never for sessions whose title or name matches `skip`). Each check costs one small Haiku call on your default sign-in. |
| `autoTidy` | `false` | Archive finished sessions for you, the same way the Archive button does. Only idle sessions whose turn finished with a delivery; never one that is running, waiting on a choice, stopped, or *needs follow-up*, never one the Org view shows as the chief of staff, a project lead or a branch lead, and never one whose own sessions (opened through `/api/new`) are still on the board. A *ready to review* delivery goes 10 minutes after you mark it reviewed and it stays quiet, or after 24 hours if you never mark it; a *no action needed* delivery goes after 24 hours with nobody touching it. Nothing is archived while you are looking at the board. |
| `tidyJudge` | `false` | With `autoTidy` on: before any of those rules archives a session, one `claude -p --model haiku` call (no tools, no MCP servers, none of your settings files) reads that delivery, once per delivery, and a *no action needed* delivery is checked after 4 hours of quiet instead of 24. Only *done* archives it. *Waiting* (the session still has its own follow-up: it is waiting on another session or a set time, or it scheduled something itself) keeps it, and that follow-up is remembered until a later delivery is judged done. *Yours* keeps it and turns a *no action needed* card into *needs follow-up*. If the call fails or the answer is unclear, nothing is archived and it asks again an hour later. Answers are saved to `judged.json` in the data folder, so a restart keeps them. |
| `codex` | `false` | Experimental: also list and start Codex CLI sessions. Everything else in this README is about Claude Code. |
| `accounts` | `[]` | Extra Claude subscriptions a new task can run on: `{ "id", "name" }`. `id` is letters, digits, `_ . -`, up to 40 characters. Each one needs a long-lived token from `claude setup-token`, stored in your Keychain under the service `ccboard-account-<id>` (see below). Listed accounts appear as an **Account** menu in the new-task dialog; **Default** is whoever Claude Code is signed in as. |

### Running a task on another Claude subscription

Claude Code keeps one sign-in per machine, shared by every session. To start one session on a different subscription, cc-board sets `CLAUDE_CODE_OAUTH_TOKEN` (and `CCBOARD_ACCOUNT=<id>`, which labels its usage pill) for that session only. Settings, memory and transcripts stay shared. The token never appears in `config.json`, a command line or the service log: the session's own shell reads it from the Keychain just before it starts `claude`.

```bash
claude setup-token                      # sign in with the other account in the browser; it prints a token
security add-generic-password -U -a "$USER" -s ccboard-account-<id> -w    # paste the token at the prompt
```

Then add `{ "id": "<id>", "name": "<label>" }` to `accounts` and run `./build.sh update`. An account whose Keychain item is missing is shown greyed out. cc-board only checks that the item exists; a revoked or expired token shows up in the session itself.

## Usage in the top bar (optional)

Claude Code does not write its 5-hour and weekly usage anywhere on disk. It only hands them to a status-line command, and only for claude.ai Pro, Max and Ultra subscriptions, after the session's first reply. `statusline-tap.mjs` is that command: it keeps just the two rate-limit windows (percentage and reset time, no paths, models or conversation), one small file per session under `<data directory>/limits/`, and prints one line such as `5h 6% · 7d 1%` under the prompt. It reads no credentials and makes no network calls. Add it to `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "node \"$HOME/Library/Application Support/cc-board/app/statusline-tap.mjs\"" } }
```

Pills appear after any session replies. If you run several Claude accounts, set `CCBOARD_ACCOUNT=<short name>` in the environment a session is started with and its pill is labelled with that name; without it, accounts are told apart by their weekly reset time. A window that has passed its reset time is dropped rather than shown stale.

## Known limits

- **Usage numbers are as fresh as the last session that spoke.** Claude's come from status-line updates, Codex's from its last turn; the hover text says how old they are.

- **Follow-up detection without a status tag is heuristic.** For reliable status, have the agent end its reply with `[Needs you] …` (`【待跟进】…`), `[Review] …` (`【待审阅】…`), or `[FYI] …` (`【进展】…`). Without a tag, cc-board looks for wording such as “I need your approval” or “no reply is required.”
- **Replying into a session you started in a terminal tab works for Ghostty only.** Sessions started from cc-board work without it.
- **New sessions start in your home directory** with a short note (in Chinese, for now) telling Claude to find or create the right project folder under `~/Projects`.
- **Apple Silicon only** (`-target arm64-apple-macos13`).
- Safari-engine rendering (the real app) has had less testing than Chrome-engine rendering (the UI tests).

## Develop

```sh
npm install                       # only for the UI tests (playwright-core)
node test/projects.test.mjs       # project-grouping rules, under a second
node test/app-shell.test.mjs      # the native shell: where it looks for Node, how a release bundle installs its code; about 8 s
node test/limits.test.mjs         # usage-limit parsing and the status-line tap, under a second
node test/org.test.mjs            # who-reports-to-whom rules, under a second
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
limits.mjs     weekly usage per subscription: Codex's session logs, plus the files the status-line tap wrote
statusline-tap.mjs   the status-line command that saves Claude Code's rate limits for limits.mjs
accounts.mjs   which Claude subscription a new task runs on (token read from the Keychain)
org.mjs        who reports to whom (pure function): /api/state's `org` field, built from the messages sessions sent each other and which session opened which
autopilot.mjs  auto-continue (pure functions): whether an idle session's own ghost-text suggestion may be sent for you, after a keyword gate and a Haiku check
app/           the native shell (Swift, WKWebView)
test/          isolated tests
CLAUDE.md      long-form design notes in Chinese: each rule, why it is that way, and the feedback behind it
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE) for the code. The launch video and preview in `docs/media/` are not covered by it: the soundtrack uses Apple Loops from GarageBand, which Apple licenses for use in finished works, not for redistribution on their own.
