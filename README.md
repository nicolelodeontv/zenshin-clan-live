# Ninja Zenshin Clan Live

Live clan leaderboard dashboard for Ninja Zenshin, refreshing every 30 seconds.

## Cloudflare Workers deployment

This repository is configured for **Cloudflare Workers with Static Assets**, not Cloudflare Pages Functions. The `workers.dev` domain serves the frontend from `public/` and handles the ranking API through `src/worker.js`.

Cloudflare → Workers & Pages → **zenshin-clan-live** → Settings → Builds (Git integration):
- Repository: `nicolelodeontv/zenshin-clan-live`
- Production branch: `main`
- Root directory: repository root
- Build command: leave blank (if required, `npm test`)
- Deploy command: `npx wrangler deploy`

The deployment should use the checked-in `wrangler.jsonc` (Worker name, entrypoint, static assets and `/api/*` routing). For a build configured with `npm run deploy`, that script runs the same Wrangler command.

Check:
- `https://zenshin-clan-live.njuandelacruz.workers.dev/` — frontend
- `https://zenshin-clan-live.njuandelacruz.workers.dev/api/clans` — JSON API

A valid API response contains `clans` and `updatedAt`. A 502 means the upstream ranking page could not be retrieved or parsed. A 404 means the Workers deployment did not pick up the new Worker entrypoint and routing configuration.

## Local checks

```sh
npm test
npx wrangler dev
```

This is an unofficial, public-source polling tool, not a game-server streaming integration.
