# One-Click Local Bot Launcher Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if droids available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Windows batch file that starts and supervises the local Telegram bot, Cloudflare Quick Tunnel, Vercel callback update, and Production redeploy.

**Architecture:** `start-all.bat` is a stable double-click entry point. A dependency-injected CommonJS orchestrator in `scripts/start-all.js` owns validation, process startup, health checks, tunnel parsing, Vercel CLI calls, runtime state, and cleanup while exposing pure helpers for Node tests.

**Tech Stack:** Windows batch, Node.js 20 CommonJS, Python venv, cloudflared, Vercel CLI 58.9.2, Node test runner

---

## File Map

- Create: `start-all.bat` — operator-facing double-click entry point.
- Create: `scripts/start-all.js` — orchestration and exported testable helpers.
- Create: `tests/start-all.test.js` — unit and fake-process integration coverage.
- Modify: `.gitignore` — ignore `.runtime/`.
- Modify: `package.json` — add `start:all` and focused launcher test commands.

## Chunk 1: Launcher Contract and Configuration

### Task 1: Batch Entry Point and Configuration Validation

**Files:**
- Create: `start-all.bat`
- Create: `scripts/start-all.js`
- Create: `tests/start-all.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: write failing launcher contract tests**

Test that:

- `start-all.bat` changes to `%~dp0`, invokes Node on
  `scripts\start-all.js`, preserves the exit code, and pauses on failure;
- `start-all.bat` checks `where node` first and prints one installation action
  when Node is unavailable;
- `.runtime/` is ignored;
- package scripts expose `start:all` and `test:launcher`;
- `parseEnv` accepts comments and first-`=` values without logging values;
- `validateConfiguration` reports missing key names only.

Run:

```powershell
node --test tests/start-all.test.js
```

Expected: FAIL because launcher files and exports do not exist.

- [ ] **Step 2: implement the minimal entry point and helpers**

`start-all.bat`:

```bat
@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 20 and try again.
  pause
  exit /b 1
)
node "scripts\start-all.js"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
```

Export `parseEnv`, `validateConfiguration`, and `main` from
`scripts/start-all.js`. Add `.runtime/` to `.gitignore` and package scripts:

```json
"start:all": "node scripts/start-all.js",
"test:launcher": "node --test tests/start-all.test.js"
```

- [ ] **Step 3: run focused tests**

Run: `node --test tests/start-all.test.js`

Expected: PASS.

## Chunk 2: Local Process Lifecycle

### Task 2: Bot, Tunnel, Health, and Cleanup

**Files:**
- Modify: `scripts/start-all.js`
- Modify: `tests/start-all.test.js`

- [ ] **Step 1: write failing lifecycle tests**

Cover:

- Quick Tunnel URL parsing only accepts HTTPS `trycloudflare.com`;
- bot child receives bot secrets while tunnel child does not;
- bot health is awaited before tunnel startup;
- tunnel health is awaited before Vercel operations;
- startup timeout stops all proven child process trees;
- PID metadata includes PID, executable, and start timestamp;
- Windows process inspection obtains PID, executable path, creation time, and
  command line through a fixed PowerShell `Get-CimInstance Win32_Process`
  adapter;
- stale reconciliation checks port ownership with `Get-NetTCPConnection`,
  rejects malformed/missing/access-denied metadata, detects PID reuse, and
  never kills unrelated `python.exe` or `cloudflared.exe` processes.

Use injected `spawn`, `fetch`, clock, filesystem, and `killTree` fakes.

Run: `node --test tests/start-all.test.js`

Expected: FAIL on missing lifecycle functions.

- [ ] **Step 2: implement minimal lifecycle adapters**

Implement exported pure helpers and `createLauncher(dependencies)`. Use
`child_process.spawn` with argument arrays, no shell, and allowlisted child
environments for Python and cloudflared. Windows `.cmd` tools use a dedicated
adapter that launches:

```text
cmd.exe /d /s /c "<fixed npx command>"
```

Only fixed command tokens, repository paths quoted by the adapter, and a tunnel
URL validated against `^https://[a-z0-9-]+\.trycloudflare\.com$` may enter that
command. Dynamic Vercel output may enter a later command only after validating
a deployment hostname against `^[a-z0-9-]+\.vercel\.app$` or an ID against
`^dpl_[A-Za-z0-9]+$`. Use bounded condition polling for health.

- [ ] **Step 3: run focused tests**

Run: `node --test tests/start-all.test.js`

Expected: PASS.

## Chunk 3: Vercel Automation

### Task 3: Project Linking, Environment Update, and Production Redeploy

**Files:**
- Modify: `scripts/start-all.js`
- Modify: `tests/start-all.test.js`

- [ ] **Step 1: write failing Vercel command tests**

Cover exact command arrays for:

- `npx --yes vercel@58.9.2 login`;
- link to project `menu-qrcode` and scope `wsscodes-projects`;
- project ID validation against
  `prj_CguA6Hs777MczJG3bJuk4HWM063F`;
- separate ordered idempotent updates through stdin:
  `vercel env add BOT_INTERNAL_API_URL production --force --sensitive --yes --non-interactive`,
  then
  `vercel env add BOT_INTERNAL_API_URL preview --force --sensitive --yes --non-interactive`;
- current Production discovery:
  `vercel inspect menu-qrcode.vercel.app --json --non-interactive`;
- exact redeploy:
  `vercel redeploy <current-production-url> --target production --non-interactive`;
- readiness:
  `vercel inspect <new-url> --wait --timeout 5m --json --non-interactive`;
- final alias verification:
  `vercel inspect menu-qrcode.vercel.app --json --non-interactive`, requiring
  the deployment ID to match the new READY deployment;
- command timeout and non-zero/invalid-JSON failures;
- independent `productionUpdated` and `previewUpdated` state markers bound to
  the project ID and tunnel URL, with one retry per target and Production
  always attempted before Preview;
- update behavior when the variable is missing, duplicated, or
  branch-specific: `env add --force` must create/replace only the
  all-branches Production and Preview targets and leave branch-specific entries
  untouched;
- unexpected prompt detection as an immediate failure;
- no mutation of `BOT_INTERNAL_API_SECRET`;
- redaction before logs are written.

Login and linking are explicit exceptions:

```text
npx --yes vercel@58.9.2 login
npx --yes vercel@58.9.2 link --yes --project menu-qrcode --scope wsscodes-projects --cwd <repository-root>
```

Every post-link Vercel command is prefixed with
`npx --yes vercel@58.9.2` and includes
`--project prj_CguA6Hs777MczJG3bJuk4HWM063F`,
`--scope wsscodes-projects`, `--cwd <repository-root>`, and `--no-color`.

Run: `node --test tests/start-all.test.js`

Expected: FAIL on missing Vercel workflow.

- [ ] **Step 2: implement minimal Vercel workflow**

Run Vercel CLI with inherited console I/O only for authentication/linking.
Normal commands use fixed `cmd.exe` invocation and pass the validated tunnel URL
plus one trailing newline through stdin. Capture stdout/stderr, redact before
writing, and parse JSON where required. Persist project ID, tunnel URL,
Production-update state, Preview-update state, deployment ID, and timestamp in
`.runtime/state.json`. A new tunnel URL invalidates every remote completion
marker. Each idempotent target update runs when its matching URL-bound marker is
absent, including after a crash between remote success and state persistence.

- [ ] **Step 3: run focused tests**

Run: `node --test tests/start-all.test.js`

Expected: PASS.

## Chunk 4: Supervision and End-to-End Validation

### Task 4: Idempotent Main Flow and Release Gate

**Files:**
- Modify: `scripts/start-all.js`
- Modify: `tests/start-all.test.js`

- [ ] **Step 1: write failing main-flow tests**

Cover ordered status output, already-running behavior, unexpected child exit,
`Ctrl+C`, restart after partial Vercel state, and failure messages that contain
one action without secrets. Cleanup expectations are stage-specific:

- pre-mutation failure stops both children;
- environment-update failure retries once, then keeps a healthy bot/tunnel
  alive and reports retry guidance;
- redeploy/readiness/alias failure keeps a healthy bot/tunnel alive;
- bot or tunnel exit during Vercel work stops the other child and aborts;
- `Ctrl+C` always stops both in-memory-owned process trees with
  `taskkill /T /F` fallback.

Separately assert allowlisted environments for Python, cloudflared, and
Vercel/npm, plus redaction of bot/tunnel stderr and serialized exceptions.

Run: `node --test tests/start-all.test.js`

Expected: FAIL on incomplete main flow.

- [ ] **Step 2: complete the orchestrator**

Wire validation, stale reconciliation, bot health, tunnel health, Vercel
updates, Production redeploy, status output, supervision, and cleanup.

- [ ] **Step 3: run focused tests**

Run: `node --test tests/start-all.test.js`

Expected: PASS.

- [ ] **Step 4: run repository release gates**

Run:

```powershell
npx --yes --package node@20.19.5 --call "npm test"
npx --yes --package node@20.19.5 --call "npm run typecheck"
npx --yes --package node@20.19.5 --call "npm run build"
C:\Users\STARLINECOMP\Desktop\menu-qrcode\menu\bot\.venv\Scripts\python.exe -m unittest discover -s bot\tests
C:\Users\STARLINECOMP\Desktop\menu-qrcode\menu\bot\.venv\Scripts\python.exe -m pip check
```

Expected: all commands exit 0 and tracked build output remains unchanged.

- [ ] **Step 5: perform real launcher smoke**

Stop only the currently recorded bot and tunnel process trees from this
session. Double-run `start-all.bat` from outside the repository directory.

Expected:

- first run starts bot and tunnel, updates Vercel Production and Preview, and
  Production reaches READY;
- second run reports the existing healthy session and starts no duplicates;
- local and tunnel `/health` return 200;
- `menu-qrcode.vercel.app` remains reachable;
- Vercel CLI confirms the alias points to the new READY deployment and the
  Production/Preview variable targets exist. This is the strongest safe
  connectivity check available without creating production order data or
  sending a real Telegram message; the launcher must not create such data
  automatically;
- shutdown removes launcher-owned process trees and runtime PID metadata.

- [ ] **Step 6: inspect final repository state**

Run:

```powershell
git status --short
git diff --check
```

Expected: only the five intended launcher files plus the plan/spec commits;
user screenshots remain untouched.
