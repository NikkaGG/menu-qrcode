# Local Bot and Vercel Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if droids available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Telegram bot locally and deploy the public site plus admin panel to an isolated Vercel preview connected through Cloudflare Quick Tunnel.

**Architecture:** Vercel serves the static ordering site, `admin-dist`, and `api/router.js`. The local Python bot handles Telegram polling and its authenticated internal API on port 8080, while a temporary Cloudflare HTTPS tunnel makes only that local HTTP service reachable from the Vercel preview.

**Tech Stack:** Node.js 20.19.x, npm, Vite/React, Vercel, Python virtual environment, aiogram, aiohttp, Cloudflare Quick Tunnel

---

## File Map

No production source files should change. Operational environment overrides stay
in process memory or Vercel Preview configuration and must not be written to
`.env`.

- Reference: `package.json` for JavaScript checks and build commands.
- Reference: `vercel.json` for preview routing.
- Reference: `bot/main.py` for the local process entry point.
- Reference: `bot/internal_api.py` for health and authenticated order routes.
- Reference: `.env` and `bot/.env` for local values, never print or stage them.

## Chunk 1: Local Release Gate

### Task 1: Protect Existing State and Select Runtimes

**Files:**
- Inspect: repository working tree and environment key presence
- Modify: none

- [ ] **Step 1: Inspect repository state**

Run:

```powershell
git status --short
```

Expected: only the user's known untracked screenshots may appear. Do not stage,
move, clean, or delete them.

- [ ] **Step 2: confirm environment shape without printing values**

Check that root and bot environment files contain every required key, that the
shared internal secret matches, and that `APP_URL` is HTTPS. Report booleans
only.

Expected: both configurations are complete, the secrets match, and application
URLs are valid.

- [ ] **Step 3: select Node 20.19.x**

No local version manager or Node 20 installation exists. Use npm's official
`node@20.19.5` package as an ephemeral executable; this changes only the npm
cache and does not change repository dependencies.

Run:

```powershell
npx --yes --package node@20.19.5 --call "node --version"
```

Expected: Node `v20.19.5`.

### Task 2: Run the Existing Test and Build Gates

**Files:**
- Build output: `admin-dist/`
- Modify source: none

- [ ] **Step 1: run JavaScript contract, legacy, and unit tests**

Run:

```powershell
npx --yes --package node@20.19.5 --call "npm test"
```

Expected: exit code 0.

- [ ] **Step 2: run TypeScript checks**

Run:

```powershell
npx --yes --package node@20.19.5 --call "npm run typecheck"
```

Expected: exit code 0.

- [ ] **Step 3: build the admin application**

Run:

```powershell
npx --yes --package node@20.19.5 --call "npm run build"
```

Expected: exit code 0 and `admin-dist/index.html` exists.

- [ ] **Step 4: run bot tests**

Run:

```powershell
.\bot\.venv\Scripts\python.exe -m unittest discover -s bot\tests
```

Expected: all tests pass.

- [ ] **Step 5: validate Python dependencies**

Run:

```powershell
.\bot\.venv\Scripts\python.exe -m pip check
```

Expected: `No broken requirements found.`

- [ ] **Step 6: inspect generated changes**

Run:

```powershell
git status --short
git diff -- admin-dist
```

Expected: no unexpected source or credential changes. If the build updates
tracked output, inspect it before proceeding and do not commit unless required
for the Vercel preview.

## Chunk 2: Tunnel and Preview Deployment

### Task 3: Start the Temporary HTTPS Tunnel

**Files:**
- Modify: none
- Runtime log: Factory-managed temporary log outside the repository

- [ ] **Step 1: start Cloudflare Quick Tunnel in the background**

Use Factory `Execute` with `fireAndForget=true`, a 3-8 word summary, and this
command:

```powershell
cloudflared tunnel --url http://localhost:8080
```

Expected: Factory returns a PID and an external temporary log path. Wait up to
30 seconds, then read the log and extract one
`https://*.trycloudflare.com` URL. If no URL appears or the process exits, stop.

- [ ] **Step 2: retain runtime identifiers**

Record the local process ID and temporary log path in the session only. Never
write the tunnel URL or secrets into tracked files.

- [ ] **Step 3: confirm the tunnel is isolated**

Expected before bot startup: the public URL may return a temporary origin error,
but the tunnel process remains alive.

### Task 4: Configure and Redeploy the Vercel Preview

**Files:**
- Remote Preview environment: `BOT_INTERNAL_API_URL`
- Remote Preview environment: `BOT_INTERNAL_API_SECRET`
- Production environment: read-only verification
- Modify repository source: none

- [ ] **Step 1: confirm Vercel identity and baseline**

Use:

- `vercel___get_project` with project
  `prj_CguA6Hs777MczJG3bJuk4HWM063F`;
- `vercel___list_deployments` for the same project and team
  `team_fMMQuk2Bd5rcrnfLtpDQmmNj`.

Expected: project `menu-qrcode`, Node `20.x`, current production deployment
`dpl_CRSh3C19RvK4ThsKraw1BT5W1hXz`, and production URL
`menu-qrcode.vercel.app`. Record the production deployment ID as read-only
rollback evidence.

- [ ] **Step 2: confirm the preview source is current**

Compare local `HEAD` to deployed source commit `841a5b2`. Expected: only
documentation files differ, so preview deployment
`dpl_2hKb78n8NdbuC1afnzzXgj6V8iM5` contains the same production source files
being tested locally.

- [ ] **Step 3: have the user inspect Preview variable state**

Vercel MCP exposes project and deployment reads but no environment-variable
management. The user opens the `menu-qrcode` Vercel Dashboard and inspects
`BOT_INTERNAL_API_URL` and `BOT_INTERNAL_API_SECRET` under Project Settings →
Environment Variables.

Before editing, the user reports only whether each variable already has a
Preview-scoped entry, never its value. Also record whether any existing entry
includes Production scope. If either required variable already has Preview
scope, stop: do not replace it because its hidden prior value cannot be safely
restored. Existing entries that include Production scope must never be edited.
Proceed only by creating separate Preview-only entries when Vercel permits it.
Record which entries are newly created so cleanup never removes pre-existing
configuration.

- [ ] **Step 4: have the user configure Preview-only connectivity**

The user sets:

- `BOT_INTERNAL_API_URL` to the temporary tunnel URL, scope Preview only;
- `BOT_INTERNAL_API_SECRET` by copying the value locally from root `.env`,
  scope Preview only.

The user must not paste the secret into chat, a command line, tracked files, or
logs. Production scope remains unchecked. Before saving, the user confirms in
Dashboard that neither new entry includes Production.

- [ ] **Step 5: have the user redeploy the existing preview**

In Vercel Dashboard, open preview deployment
`dpl_2hKb78n8NdbuC1afnzzXgj6V8iM5` and choose Redeploy without promoting it.
The user returns only the new preview URL or deployment ID.

- [ ] **Step 6: verify deployment and production isolation**

Use `vercel___get_deployment` for the returned preview and
`vercel___get_project` for the project.

Expected: preview reaches `READY` with `target: null`; production remains
`dpl_CRSh3C19RvK4ThsKraw1BT5W1hXz`. The user then reopens Dashboard Environment
Variables and confirms the same Production-scoped entries and scopes observed
before the change are still present and unchanged, while only the two new
Preview-only entries were added.

## Chunk 3: Bot Startup and Read-Only Smoke

### Task 5: Start the Local Bot Against the Preview

**Files:**
- Modify: none
- Runtime log: Factory-managed temporary log outside the repository

- [ ] **Step 1: load bot environment into an isolated process**

Use one Factory `Execute` call with `fireAndForget=true`. Each Factory command
runs in a new shell, so loaded values cannot leak back into the parent session.
The preview URL is non-secret. Run:

```powershell
$root='C:\Users\STARLINECOMP\Desktop\menu-qrcode\menu'
Get-Content -LiteralPath "$root\bot\.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1],$matches[2].Trim(),'Process')
  }
}
$env:APP_URL='https://<preview-url>'
$env:PORT='8080'
Set-Location -LiteralPath $root
& "$root\bot\.venv\Scripts\python.exe" -m bot
```

Do not echo the environment or include any secret value directly in the
command.

- [ ] **Step 2: start the bot in the background**

Expected: Factory returns a PID and external temporary log path. Wait 10
seconds, inspect the log once, and confirm the process stays alive and aiohttp
listens on port 8080.

- [ ] **Step 3: detect polling conflicts**

Inspect the startup log for Telegram `409 Conflict` or repeated polling errors.

Expected: no conflict. If a conflict appears, stop the bot immediately and ask
for a dedicated token or authorization to stop the competing instance. Stop
the full Windows process tree with:

```powershell
taskkill.exe /PID <factory-bot-pid> /T /F
```

Then confirm `Get-Process -Id <factory-bot-pid> -ErrorAction SilentlyContinue`
returns nothing and no process listens on port 8080.

- [ ] **Step 4: verify local health with a timeout**

Run:

```powershell
$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri 'http://localhost:8080/health'
if ($r.StatusCode -ne 200 -or $r.Content -ne '{"status": "ok"}') { throw 'Local health failed' }
```

Expected: HTTP 200 and `{"status":"ok"}`.

- [ ] **Step 5: verify tunneled health with a timeout**

```powershell
$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri 'https://<temporary-tunnel>/health'
if ($r.StatusCode -ne 200 -or $r.Content -ne '{"status": "ok"}') { throw 'Tunnel health failed' }
```

Expected: HTTP 200 and `{"status":"ok"}`.

- [ ] **Step 6: verify unauthenticated rejection**

Run this PowerShell 5.1-compatible assertion:

```powershell
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Method Post -ContentType 'application/json' -Body '{}' -Uri 'https://<temporary-tunnel>/internal/orders/new'
  throw 'Expected HTTP 401'
} catch [Microsoft.PowerShell.Commands.HttpResponseException] {
  if ([int]$_.Exception.Response.StatusCode -ne 401) { throw }
} catch [System.Net.WebException] {
  $response=$_.Exception.Response
  if ($null -eq $response -or [int]$response.StatusCode -ne 401) { throw }
}
```

Expected: HTTP 401 and no Telegram message.

### Task 6: Verify the Vercel Preview

**Files:**
- Modify: none

- [ ] **Step 1: inspect the preview root**

Open the unique preview URL in an isolated browser context.

Expected: HTTP 200, menu content loads, and no blocking console or asset errors
appear.

- [ ] **Step 2: inspect the admin route**

Open `<preview-url>/admin`.

Expected: HTTP 200, `admin-dist` assets load, and the login UI renders.

- [ ] **Step 3: inspect API routing**

Use read-only network inspection while loading the public and admin pages.

Expected: API requests stay on the preview hostname and no request targets
production unexpectedly.

- [ ] **Step 4: report the running endpoints**

Report the preview URL, bot health status, tunnel health status, and local
process IDs. Do not report secrets.

## Chunk 4: Explicitly Authorized End-to-End Test

### Task 7: Send One Test Order

**Files:**
- Remote preview data: one test order
- Telegram: one bot notification

- [ ] **Step 1: prove preview database isolation or skip**

In Vercel Dashboard, the user checks whether `DATABASE_URL` has a separate
Preview-only entry that is known to target a non-production database. The user
reports only a boolean, never the value.

If database isolation cannot be positively confirmed, skip all remaining steps
in Task 7. Read-only preview and bot health checks are still sufficient for this
launch.

- [ ] **Step 2: request explicit authorization**

Explain that this will create preview data and send a real Telegram message.
Wait for the user's approval before interacting with the order form.

- [ ] **Step 3: submit one clearly labeled test order**

Use the preview public ordering flow with non-sensitive test customer data.

Expected: the preview API accepts the order and the bot receives one
authenticated callback.

- [ ] **Step 4: verify Telegram delivery**

Expected: exactly one order notification appears in the configured kitchen
chat, with no duplicate polling or callback errors.

- [ ] **Step 5: report lifecycle expectations**

Tell the user the preview-to-bot connection remains available only while both
local background processes are running.

## Cleanup or Failure Procedure

If a required check fails, stop before the next consequential step:

1. stop the local bot process tree with
   `taskkill.exe /PID <factory-bot-pid> /T /F`;
2. stop the Cloudflare tunnel process tree with
   `taskkill.exe /PID <factory-tunnel-pid> /T /F`;
3. verify both Factory PIDs are gone, `cloudflared` and the launched Python
   process are no longer running, and no process listens on port 8080;
4. ask the user to remove only Preview entries created during this session;
   never remove or replace a pre-existing secret;
5. delete or disable the preview deployment if the user requests cleanup;
6. verify production deployment and Production-scoped variables remain
   unchanged;
7. preserve logs containing no secrets for diagnosis, and report the exact
   failed check.
