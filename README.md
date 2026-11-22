# Ninja Zenshin Clan Live

Unofficial real-time clan ranking dashboard for https://ninjazenshin.online/?panel=clan-ranking.

## Deploy to Cloudflare Pages

1. In Cloudflare dashboard open Workers & Pages → Create → Pages → Connect to Git.
2. Connect `nicolelodeontv/zenshin-clan-live`, branch `main`.
3. Set framework **None**, build command **blank**, build output directory **public**.
4. Save and Deploy. Cloudflare automatically deploys future commits.

The `functions/api/clans.js` Pages Function retrieves the ranking server-side and the frontend polls `/api/clans` every 30 seconds. If the source layout or bot protection changes, the endpoint reports a 502 rather than providing fabricated results.

## Run tests

`npm test`

Cloudflare Pages free-tier usage limits apply. This is an unofficial fan project.