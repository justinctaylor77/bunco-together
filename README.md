# BUNCO Together

Family Bunco scorekeeping for game night over FaceTime. Everyone rolls real dice at home and keeps score together in the app on their own phone.

- **Modes:** Classic 21 (first to 21, 12 rounds), Family Favorite (Flash 10: first to 10, 12 rounds — the highlighted default), and Lightning (first to 10, 6 rounds through 1–6 once). Mini Bunco (three of a kind that is not the round number) = 5, Bunco (three of the round number) = 21 in all modes.
- **Rounds:** Classic and Family Favorite go 1 → 6, then 6 → 1. Lightning goes 1 → 6 once. When a player (or team) reaches the target, everyone moves to the next number automatically, and the player who rolled the winning entry starts the new round; turns then follow the set order.
- **End game:** anyone in the game can end it for everyone, after a confirm. If no rounds were won yet, everyone goes home; otherwise you see the results.
- **Holiday Season:** Thanksgiving (Nov 26, 2026) through Christmas (Dec 25, 2026), America/Denver. A leaderboard on the home screen ranks players by games won, then rounds, then points (names match case-insensitively). After Christmas, the leader is crowned Christmas Bunco Champion.
- **One tap per turn:** Nothing, 1–21 (or 1–10), Mini Bunco, Bunco. Undo for mis-taps.
- **Setup:** players & names → who enters scores (everyone / one scorekeeper) → individual or teams → teams (swap, rename, auto-split) → turn order (drag, arrows, shuffle).
- **Live sync:** host gets a 6-character room code + link; others join from their phones, pick who they are, and see every roll live (Server-Sent Events).
- **End of game:** four winners (most rounds, most points, most Buncos, most Mini Buncos), standings, Rematch.

## Run locally
```
npm install
npm start            # http://localhost:8790  (PORT to change)
```

## Tests
```
npm test                                   # engine + season unit tests
BASE=http://127.0.0.1:8790 node scripts/e2e.mjs   # 4-phone Playwright run of every mode (needs playwright-core + Chrome)
```

## Hosting
Render free web service (`render.yaml`), health check `/healthz`. No database: games are kept in memory and in `data/games.json`, and expire after 24 hours. Render's free disk is wiped on restart/deploy, so every phone keeps a copy of the game and puts it back automatically if the server forgot it (the host stays the host).

Holiday Season standings work the same way: the server keeps them in memory and in `data/season.json`, and every phone also stores a copy and merges it back if the server was wiped. Optionally, set `SEASON_GITHUB_TOKEN` (and optionally `SEASON_GITHUB_REPO`, `SEASON_GITHUB_PATH`) so standings are also saved to a JSON file in the GitHub repo and survive every restart without relying on a phone.

Free-plan note: the service sleeps after ~15 minutes with no visitors; the first visit after that takes ~20–30 seconds. While a game is open, phones ping it every 4 minutes so it stays awake during play.

## Files
- `server/index.js` – Express API, SSE, persistence, restore
- `server/season.js` – Holiday Season leaderboard
- `public/engine.js` – game rules (shared by server and phones)
- `public/app.js`, `public/app.css`, `public/mock.css` – the app (styles from the approved mockups)
- `branding/` – icon master source (`icon-src.html`, `render-icon.mjs`) and `icon-roll-bunco-1024.png`
