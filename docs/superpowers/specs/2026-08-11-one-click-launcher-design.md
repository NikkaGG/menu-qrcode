# One-Click Local Bot Launcher Design

**Date:** 2026-08-11

## Goal

Provide one Windows batch file that the operator can open by double-clicking.
The launcher must bring the local Telegram bot online, expose it through a
Cloudflare Quick Tunnel, connect Vercel Production and Preview to the current
tunnel URL, and leave the system running without manual commands.

## Entry Point and Components

`start-all.bat` is the only operator-facing entry point. It selects the
repository directory, checks that Node is available, and runs
`scripts/start-all.js`. The batch window remains open so the operator can see
status and errors.

The Node orchestrator owns the lifecycle of:

- the existing Python bot from `bot/.venv/Scripts/python.exe -m bot`;
- `cloudflared tunnel --url http://localhost:8080`;
- Vercel CLI commands executed through the official npm package.

Vercel CLI is pinned to `vercel@58.9.2` and invoked as
`npx --yes vercel@58.9.2` with the repository root as its working directory.
If `.vercel/project.json` is missing, the launcher runs interactive
`vercel login` with inherited console I/O and then
`vercel link --yes --project menu-qrcode --scope wsscodes-projects`. It verifies
that the linked `projectId` is `prj_CguA6Hs777MczJG3bJuk4HWM063F` before any
remote mutation.

Pure parsing, validation, command construction, and state transitions remain
separate from process and network adapters so they can be tested without
starting Telegram, Cloudflare, or Vercel.

## Startup Flow

1. Resolve all paths from the launcher location rather than the current shell
   directory.
2. Validate required files and executables, and validate environment files
   without printing values.
3. Refuse to start if port 8080 is already owned by an unrelated process. If
   launcher PID files identify a healthy existing session, report that the
   system is already running instead of starting duplicates.
4. Start the bot with values loaded from `bot/.env`.
5. Wait for `http://localhost:8080/health` to return HTTP 200.
6. Start Cloudflare Quick Tunnel, parse its generated
   `https://*.trycloudflare.com` URL, and verify the external `/health`.
7. Use Vercel CLI for the linked `menu-qrcode` project to update
   `BOT_INTERNAL_API_URL` separately for Production and Preview. Values are
   provided through standard input, never command arguments. The existing
   `BOT_INTERNAL_API_SECRET` remains unchanged.
8. Redeploy the current Production deployment with the latest project
   settings, wait for completion, and verify `https://menu-qrcode.vercel.app`.
9. Print a short green success summary and keep supervising both local
   processes.

The first run may open Vercel's browser login. Authentication and project
linking are persisted by Vercel CLI, so later runs are unattended. Updating
Preview prepares future Preview deployments; the launcher does not redeploy old
Preview deployments because the operator-facing site is Production.

## Runtime State and Logs

The ignored `.runtime/` directory stores:

- bot and tunnel PID metadata;
- non-secret bot, tunnel, and launcher logs;
- the current tunnel URL for diagnostics.

No secret value, authorization header, environment-file content, or Vercel
credential may be written to logs or command lines. Environment values are
passed only through child-process environment objects or standard input.
Captured output is redacted before it is persisted.

Each child receives an allowlisted environment. Bot secrets are added only to
the Python bot child. Cloudflared receives no bot or Vercel secret. `npx` and
Vercel receive only the normal user/runtime environment needed for npm and
Vercel authentication; they never inherit the bot-enriched environment.

## Shutdown and Recovery

`Ctrl+C` triggers graceful child shutdown, followed by
`taskkill.exe /PID <pid> /T /F` when a process tree does not exit within the
timeout. Closing a Windows console cannot guarantee Node cleanup handlers will
run, so all children remain attached to the launcher console and the next run
performs stale-state reconciliation. It validates recorded PIDs, executable
names, start times, port ownership, and health before reusing or terminating
anything. Proven orphan process trees are terminated with `taskkill /T /F`;
unrelated processes are never killed.

If startup fails before Vercel is updated, no remote change occurs. Production
is updated first, Preview second, and each successful step is recorded in
runtime state. Failed updates are retried once. A partial Production/Preview
update is safe because the same live tunnel URL is used, and the next run
resumes the missing step rather than attempting to restore an unavailable prior
value. If Production redeploy fails after the URL update, the launcher keeps the
tunnel alive, reports the exact failure, and retries the redeploy on the next
run. It never promotes a Preview deployment or changes any other variable.

## User Experience

The normal output is limited to these stages:

1. checking configuration;
2. starting bot;
3. opening secure tunnel;
4. connecting Vercel;
5. site and bot are online.

Errors include one actionable instruction. The window never prints secrets and
does not disappear immediately on failure.

## Testing

Node tests cover:

- environment parsing and required-key validation;
- Quick Tunnel URL parsing;
- Vercel command construction for Production and Preview;
- startup state transitions, timeouts, and cleanup;
- duplicate-session and occupied-port behavior;
- redaction of command output and error messages;
- the batch entry point calling the orchestrator from its own directory.

Integration validation uses dependency-injected fake processes and HTTP
responses. A final manual smoke starts the real launcher, verifies local and
external health, confirms the Vercel Production deployment is ready, and then
stops the launcher cleanly.
