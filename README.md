# Discord World

A 3D social explorer where your Discord servers become floating islands in the sky and every member is a butterfly orbiting their island.

Land on an island, fly into a glowing portal, and you're chatting in that Discord channel — for real, with attribution.

> *"Touch grass, but it's still Discord."*

## Features

- **Servers as floating islands.** Each guild you're in becomes a Genshin-style cliff-pillar island, procedurally generated and placed in concentric rings.
- **Members as butterflies.** Every server member orbits their island as a 3D butterfly, color-hashed from their user ID. Vertex-shader wing flap (no skeleton) so 60+ butterflies stay smooth.
- **Live presence-aware.** discord.js holds an open Gateway socket; presence drives orbit speed and opacity. **Online** flies fast, **idle** flies slow + dim, **DND** flies very slow + reddish, **offline** perches on the island.
- **Real chat.** Walk into a glowing channel portal, press **T** or click *Enter*, and you're in the Discord channel. Messages post via a bot token, prefixed with your display name so attribution is preserved.
- **Whimsical world.** Time-of-day cycle (dawn → noon → magic-hour → twilight), aurora ribbons at altitude, drifting pollen, wisp guide to nearest unvisited island, sparkle bursts on first landing, resting butterflies on flowers that take off when you fly past.

## Controls

| Key | Action |
|---|---|
| `WASD` | Glide |
| `Mouse` | Look |
| `Shift` | Sprint dash |
| `Space` | Rise |
| `Ctrl` | Descend |
| `T` | Enter nearest portal |
| `Esc` | Free cursor (chat stays open) |

The fairy is permanently airborne — islands are the only solid ground.

## Stack

- **Frontend:** single `index.html`, Three.js r160 via CDN, custom vertex shader for butterfly wing flap, UnrealBloom postprocessing
- **Backend:** Node 20, Express, `express-session`, `discord.js` v14
- **Discord:** OAuth2 (`identify` + `guilds`) for the user, Bot token for channels/messages/members, Gateway intents (`Guilds`, `GuildMembers`, `GuildPresences`) for live presence

## Run locally

```bash
npm install
node server.js
# open http://localhost:3000
```

You can either set credentials as env vars (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`) or paste them into the in-app **⚙ Setup Discord login** modal — they get written to `.discord-creds.json` (gitignored, mode 0o600).

There's also a **Demo Realm** button on the login screen that skips auth and gives you a procedurally generated world to explore.

## Discord setup

1. https://discord.com/developers/applications → **New Application**
2. **OAuth2** → add redirect: `http://localhost:3000/auth/callback` (and your prod URL once deployed)
3. Copy **Client ID** + **Reset Secret**
4. **Bot** tab → **Add Bot** → enable **Server Members Intent** + **Message Content Intent** → copy the **Bot Token**
5. **OAuth2 → URL Generator** → scope `bot` → permissions: `View Channels`, `Read Message History`, `Send Messages` → open the URL → invite the bot to your server

## Deploy

The repo includes deploy configs for three platforms:

- **Render** (`render.yaml`) — recommended, free tier, no credit card. Push to GitHub → New Blueprint → set `PUBLIC_URL` + Discord secrets → done.
- **Fly.io** (`fly.toml` + `Dockerfile`) — `fly launch --copy-config` then `fly deploy`. Persistent volume for cred storage.
- **Vercel** — not supported; the Discord Gateway needs a long-lived WebSocket, which serverless functions can't host.

After deploy, set `PUBLIC_URL` to your production URL and whitelist `<PUBLIC_URL>/auth/callback` in the Discord Developer Portal.

## Why

Because Discord is a list of grey rectangles, and floating islands aren't.
