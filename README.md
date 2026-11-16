# BUNCO Together

Family Bunco scorekeeping for game night over FaceTime. Everyone rolls real dice at home and keeps score together in the app on their own phone.

- **Modes:** Classic 21 (first to 21 wins the round) and Flash 10 (first to 10). Mini Bunco = 5, Bunco = 21 in both.
- **12 rounds:** 1 → 6, then 6 → 1. When a player (or team) reaches the target, everyone moves to the next number automatically, and the player who rolled the winning entry starts the new round; turns then follow the set order.
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
npm test                                   # engine unit tests
BASE=http://127.0.0.1:8790 node scripts/e2e.mjs   # 4-phone Playwright run of every mode (needs playwright-core + Chrome)
```

## Hosting
Render free web service (`render.yaml`), health check `/healthz`. No database: games are kept in memory and in `data/games.json`, and expire after 24 hours. Render's free disk is wiped on restart/deploy, so every phone keeps a copy of the game and puts it back automatically if the server forgot it (the host stays the host).

Free-plan note: the service sleeps after ~15 minutes with no visitors; the first visit after that takes ~20–30 seconds. While a game is open, phones ping it every 4 minutes so it stays awake during play.

## Files
- `server/index.js` – Express API, SSE, persistence, restore
- `public/engine.js` – game rules (shared by server and phones)
- `public/app.js`, `public/app.css`, `public/mock.css` – the app (styles from the approved mockups)
- `branding/` – icon master source (`icon-src.html`, `render-icon.mjs`) and `icon-roll-bunco-1024.png`
