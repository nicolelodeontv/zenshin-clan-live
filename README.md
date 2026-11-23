# Ninja Zenshin Clan Live

Live clan leaderboard dashboard for Ninja Zenshin, refreshing rankings every 5 seconds while the page is visible.

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
- `https://zenshin-clan-live.chaoszenshin.workers.dev/` — frontend
- `https://zenshin-clan-live.chaoszenshin.workers.dev/api/clans` — JSON API

A valid API response contains `clans` and `updatedAt`. A 502 means the upstream ranking page could not be retrieved or parsed. A 404 means the Workers deployment did not pick up the new Worker entrypoint and routing configuration.

## Local checks

```sh
npm test
npx wrangler dev
```

This is an unofficial, public-source polling tool, not a game-server streaming integration.

## Background tracking (Phase 3)

- The browser polls clan rankings and an open member popup **every 5 seconds**.
- A Cloudflare Cron Trigger runs **every 5 minutes** (`*/5 * * * *`) to capture CHAOS (clan ID 3).
- Every cron run also attempts to record **up to 8 different non-CHAOS ranked clans**, using only three simultaneous outbound requests. The next 5-minute run advances to the next group; with 86 other clans this is approximately **55 minutes per rotation**. This is not a 5-second sample per clan, and a failed batch may leave gaps.
- Non-CHAOS member data is saved in a season-specific, **daily aggregate KV record** (`all-clan-history:<season-namespace>:<YYYY-MM-DD>`) with a 7-day retention period. The aggregate is written at most once per scheduled batch, not once per clan. CHAOS retains its own 5-minute snapshots and daily baselines.
- The site does **not invent** historical data; member gain/hour remains unavailable until at least two eligible snapshots are stored. Non-CHAOS gains use the earliest daily scheduled baseline (or an earlier existing one).
- A confirmed season change separates storage namespaces. The previous CHAOS season's last-observed summary is retained in the season archive; this is **not** a permanent all-clan season archive.
- To minimize KV write usage, routine unchanged alert states are not rewritten and season-state checkpoint writes are throttled. Validate actual Cloudflare usage if running on a free plan.

Useful read-only endpoints: `/api/clans`, `/api/members?id=3`, `/api/performance?id=3`, `/api/performance?id=115`, `/api/all-clan-status`, `/api/tracking-status`, `/api/alerts`, `/api/season-archive`.

`/api/all-clan-status` shows **how many other ranked clans have actually been sampled today**, the latest batch's success/error counts, and the estimated rotation time. A newly deployed tracker initially shows partial coverage. The official game endpoints can fail or change without notice.

The tests in `functions/api/all-clans.test.js` check rotation, retry deduplication, season isolation, and sparse-history behavior. Run `npm test` before deployment.

## Tracking health dashboard

The homepage Tracking health panel reports:
- CHAOS five-minute scheduled snapshot freshness, last success and the number of **observed** sample gaps longer than ten minutes
- Rotating all-clan collection freshness, daily coverage and the latest batch
- Success/failure totals from the **last 24 recorded rotating batches**, plus fetch errors retained in those batch records
- Sampled clans whose most recent sample exceeds the expected rotation interval plus 15 minutes

The read-only `/api/monitoring-health` endpoint combines today's and yesterday's saved KV snapshots and recent batch records. These are **observations**, not proof of upstream downtime. A clan never sampled is not counted as having failed; a historical gap is only visible between recorded snapshots. Detailed batch diagnostics begin when the feature is deployed, so old failures cannot be reconstructed. The dashboard refreshes every 30 seconds while visible.

The batch recorder preserves previous good clan data even when an entire rotating batch fails. Keeping the last 24 batch records in the same daily all-clan KV value avoids an additional write per run. Automated tests are in `functions/api/monitoring-health.test.js`.

## Interactive REP charts (Minimal Dark)

The clan member drawer includes recorded REP history with selectable 1h/3h/6h/24h ranges, optional comparison between two members of the **same clan**, a timeline sample slider (keyboard accessible), click-to-inspect chart samples, and a clear legend. Comparisons use the saved values without interpolating missing intervals.

The Rankings section also includes **Compare clan REP history**. Pick two clans and a range; the browser fetches `/api/performance?id=<clan-id>` for each clan and plots the sum of observed member REP for each saved sample. These are totals of observed member REP values, **not guaranteed official ranked clan reputation**. CHAOS snapshots occur every five minutes, while other clans are sampled in rotation. Series with different sample schedules are not artificially aligned and gaps are not filled. A clan with no saved data displays an explicit unavailable state.

The chart calculation regression tests live in `tests/history-chart.test.js` and the UI smoke tests in `tests/ui-smoke.test.js`. Cloudflare's Browser Rendering daily limit can prevent live UI automation even when GitHub Actions and Wrangler deployment succeed.
