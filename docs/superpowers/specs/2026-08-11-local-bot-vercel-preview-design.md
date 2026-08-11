# Local Bot and Vercel Preview Design

**Date:** 2026-08-11

## Goal

Bring up the existing system without changing production:

- deploy the public ordering site and React admin panel as a Vercel preview;
- run the Telegram bot on the local Windows machine;
- connect the preview API to the local bot through a temporary HTTPS tunnel.

## Architecture

The `menu` repository remains the Vercel project root. Vercel serves the
repository's public ordering files, the built `admin-dist` application, and the
single `api/router.js` function according to `vercel.json`.

The bot runs from `bot/.venv` with `python -m bot`. It uses Telegram long
polling and exposes its internal HTTP API on local port `8080`.

The current token may already be used by an unknown bot instance. The local
process must therefore be watched during startup. A Telegram `409 Conflict`
means another poller exists; in that case stop the local process immediately
and do not continue until the user supplies a dedicated token or confirms the
other poller can be stopped.

Cloudflare Quick Tunnel publishes port `8080` at a temporary HTTPS URL. The
Vercel preview environment uses that URL as `BOT_INTERNAL_API_URL`. The shared
`BOT_INTERNAL_API_SECRET` authenticates requests between the Vercel API and the
bot. Both values are scoped only to the Vercel Preview environment, and their
production values are verified unchanged before deployment. The local bot
receives the generated preview deployment URL as its process-level `APP_URL`;
the checked-in and local `.env` files are not rewritten.

Only `GET /health` is intentionally public and returns a fixed
`{"status":"ok"}` response without configuration or runtime details.
`POST /internal/orders/new` requires the shared bearer secret. Every request
without the correct secret must return `401`.

## Release Flow

1. Select Node 20.19.x, then run `npm run test`, `npm run typecheck`, and
   `npm run build` from the repository root.
2. Run `bot/.venv/Scripts/python.exe -m unittest discover -s bot/tests` and
   `bot/.venv/Scripts/python.exe -m pip check`.
3. Start `cloudflared tunnel --url http://localhost:8080` and capture the
   assigned HTTPS URL without exposing secrets. The origin may remain
   temporarily unavailable while the preview is prepared.
4. Authenticate the Vercel integration. Set `BOT_INTERNAL_API_URL` to the
   tunnel URL and set the existing `BOT_INTERNAL_API_SECRET` for Preview only.
   Confirm Production environment values were not changed, then create the
   preview deployment.
5. Start `bot/.venv/Scripts/python.exe -m bot` with process-level `APP_URL`
   equal to the generated preview URL. Monitor startup for a polling conflict.
6. Verify `GET http://localhost:8080/health` and the tunnel `/health` return
   HTTP `200` with `{"status":"ok"}`. Verify unauthenticated
   `POST /internal/orders/new` returns HTTP `401`.
7. Verify the preview root and `/admin` return HTTP `200`, admin assets load,
   and API requests remain on the preview hostname.
8. With explicit user approval, submit one test order through the preview and
   confirm its Telegram notification and successful API response.

## Safety and Recovery

Production is not promoted or modified. Environment values and credentials
must not be printed, committed, or copied into documentation.

Cloudflare Quick Tunnel is temporary and remains available only while its
local process is running. Stopping the bot and tunnel disconnects order
notifications. The preview deployment can be removed independently, while the
current production deployment remains the rollback baseline.

If any build, deployment, route, tunnel, authentication, or bot check fails,
stop before the end-to-end order. Cleanup stops the local bot and tunnel,
removes the temporary Preview-only callback value, and deletes or disables the
preview deployment. Production variables and deployment are never changed.

## Validation

Validation covers:

- existing contract, unit, type-check, and build commands;
- Python bot tests and dependency health;
- local bot health over loopback and through the HTTPS tunnel;
- successful loading of the preview public site and admin routes;
- API connectivity and one explicitly authorized test order.

Any failing build, health check, or route check blocks further rollout.
