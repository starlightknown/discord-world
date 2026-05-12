# Discord World — Phase 1: 3D World Skeleton

Building Phase 1 from the spec: a static Three.js scene with placeholder
floating islands, WASD + mouse-look movement, third-person camera, sprint
(Shift), jump (Space), and collision against islands. No Discord
integration yet — that's Phase 2.

Single self-contained `index.html` using Three.js via CDN (r160) and
PointerLockControls. Procedurally-generated low-poly islands seeded by
deterministic IDs so the layout is consistent. Open `index.html` in a
browser — no install required, matching the spec.

### [x] Step: Build phase 1 skeleton (index.html)
- Three.js scene, sky, lighting, ocean plane
- Procedurally generated low-poly islands (seeded)
- Third-person character with WASD + mouse-look (PointerLock)
- Sprint, jump, gravity, ground + island collision
- HUD overlay (controls hint, FPS)

### [x] Step: Phase 2 — Discord OAuth + island generation
- Node.js Express backend (`server.js`) proxying Discord API
- OAuth2 flow with `identify` + `guilds` scopes
- Session-based auth; access token never leaves the server
- `/api/me` and `/api/guilds` endpoints with 30s in-memory cache
- Client login screen with "Login with Discord" + "Try demo"
- Islands generated procedurally per real guild (seeded by guild id, sized by member count, placed in concentric rings)
- User pill (avatar + name + logout) in HUD
- `package.json`, `.env.example`, `.gitignore`

### [x] Step: Phase 3 — Channels, chat, and whimsical fairyland aesthetic
- Pastel sky gradient dome, magic-hour sun + pink-teal hemi lighting
- Animated turquoise lagoon with sine-wave displacement, lily pads
- Two-tone vertex-colored islands (grass top, rocky bottom)
- Cascading waterfalls with scrolling UV gradient texture
- Instanced grass blades (180+ per island), mushrooms, pom-pom trees, flowers
- 60 hand-drawn pastel butterflies orbiting + fluttering
- 350 additive-blended firefly points twinkling
- Fairy avatar (pink capsule + peach head + translucent flapping wings)
- Glowing Discord-blurple channel portal rings on each island
- `T` key opens chat overlay when near a portal; `Esc` closes
- Pastel chat overlay with sidebar (channel list) + messages + composer
- Backend `/api/channels/:id/messages` GET + POST routes
- Lazy channel loading per-island with stub fallback (#general / #art / etc.)
- Graceful 403 notice when bot lacks permissions to read/send

### [x] Step: Phase 4 — Sunset fairy-village environment + real 3D assets
- Sunset sky gradient (orange horizon → magenta → indigo) with deep purple fog
- Snow-capped mountain ring around the world
- Deep twilight lagoon with metallic sheen
- Glowing additive cyan waterfalls with sparkles, back-haze, and glow pool
- Fairy houses (cottage + pointy maroon roof + glowing windows)
- Edge-lining glowing lanterns
- Dense multi-color flower carpets per island
- Chibi fairy avatar (cone dress, big head with sparkly anime face, iridescent flapping wings, hair clip)
- Real PBR mushroom asset (OBJ + albedo/normal/roughness textures)
- Hero GLB model placed at each island center
- Extra OBJ used as variety prop
- UnrealBloom postprocessing pass for the magic glow look

### [x] Step: Phase 5 — Genshin sky-island feel + permanent flight
- Bloom dialed down (0.22 strength); Esc no longer kicks user back to login
- On-screen Enter button + 3D portal proximity so flying users can join channels
- Genshin palette: gold/teal sky, mossy mountains, deep teal sea, mist banks
- Tall cliff-pillar islands floating high in the air
- Pine + cherry-blossom trees, mushrooms, fairy houses, lanterns
- Fairy is permanently airborne (no F toggle); Space=rise, Ctrl=descend, Shift=dash
- Islands are the only solid ground — solid horizontal collision and top landing in flight
- Removed character-shaped GLB/OBJ from island scenery (was rendering as broken purple/pink blob)

### [x] Step: Phase 8 — Fix waterfall poking through island surface
- Waterfalls were placed at `islandRadius*0.96` which is INSIDE the cylinder's actual top radius (`radius*0.95`), causing the top of each waterfall plane to slice through the island top as a thin vertical streak.
- Now placed at `radius * 1.02` (just outside the rim) and the top edge dropped 1.5 units below the rim so it's hidden by the grass.

### [x] Step: Phase 7 — Magical breeze: flowy grass, swaying trees, smoother mountains
- Animated grass: shader-injected wind sway via shared `WIND` uniform; bend masked by tip height; per-instance phase via instanceMatrix translation
- Higher-resolution multi-vertex grass blade so the tip can curl without snapping
- Denser grass carpet (280 + 12·radius blades) and slightly varied tilt
- Trees registered to `swayTrees` and gently rotate in X/Z each frame with per-tree phase + amplitude
- Mountains rebuilt with smooth deterministic angular ridges (no jagged random spikes), higher tessellation, smooth shading
- `clearIslands` also clears `swayTrees` so re-generation doesn't accumulate stale references

### [x] Step: Phase 11 — In-app Discord OAuth setup (no .env editing)
- Server holds OAuth creds in an `oauthCreds` in-memory object, seeded from env if present
- New endpoints: `GET /api/oauth-config` (returns `configured`, `client_id`, `redirect_uri`) and `POST /api/oauth-config` (validates + stores Client ID + Secret)
- New "⚙ Setup Discord login" link on the login panel opens a modal with step-by-step instructions, the redirect URL pre-filled (selectable), and Client ID + Secret inputs
- On save, credentials are POSTed to the server and the user is sent straight to `/auth/login` — no .env file required, secrets never persisted to disk

### [x] Step: Phase 10 — OAuth fallback + reliable demo button
- Server `/auth/login` no longer redirects to Discord with an empty `client_id` (which produced the "Invalid Form Body" error). Missing creds → bounce home with `?oauth=unconfigured`.
- Login panel shows a friendly amber notice when `?oauth=unconfigured` is present, pointing the user at the demo realm.
- Demo button: `type="button"`, `e.preventDefault() + stopPropagation()`, defensive `try/catch` with console error + alert; resets the panel state in case a stale flow had hidden the login panel.

### [x] Step: Phase 9 — Smooth, unbroken island bodies
- Bumped cylinder tessellation to 36 radial × 6 height for a true round rim (was 18×5 polygonal)
- Replaced random per-vertex jitter on the cliff sides with smooth deterministic angular sine waves (no jagged spikes)
- Bottom tip now droplets softly instead of shattering downward
- Removed `flatShading:true` from the island body — smooth normals so the cliff flows continuously instead of looking faceted/cracked

### [x] Step: Phase 13 — User-supplied character + house GLBs, non-overlapping props
- Loaded `assets/models/character.glb` and `assets/models/house.glb` via `GLTFLoader`, with `ASSET_CALLBACKS` so they swap in once ready.
- `avatarGroup` now hosts the user's character GLB (procedural chibi fairy parts removed when the GLB lands); position/rotation/camera code unchanged so flight + portal proximity still work.
- `buildIsland` uses `ASSETS.house.clone(true)` for fairy houses, falling back to the procedural `makeFairyHouse` only if the GLB hasn't loaded.
- New per-island `tryPlace(rMin, rMax, footprint)` helper records placed footprints and rejects new positions whose center is within the sum of radii — applied to houses, trees, cherry trees, and mushrooms so they stop overlapping.

### [x] Step: Phase 19 — Random butterfly color + 7 magical world systems
- **Random butterfly tint**: player butterfly material `color` is set per session via `setHSL(seed, 0.85, 0.62)` and stored on `window.__bfSeed` so the same session always reads the same hue. Tints the monarch albedo so every "user" appears as a different color.
- **Drifting pollen / petals**: 600-point additive `THREE.Points` cloud sprinkled across a 1400-unit volume; each particle drifts with per-seed sine offsets and slowly rises, wrapping back to the underworld.
- **Wisp guide**: small additive sprite + halo that hovers ahead of the player along the path to the nearest unvisited island, hides itself when every island has been visited.
- **Time-of-day cycle**: 4-phase lerp (dawn → noon → magic-hour → twilight) over a ~6-minute loop, animating sun color/intensity, fog color, ambient + hemi intensities (lights cached on first frame).
- **Whoosh shockwave**: ring sprite spawned at the player on Shift keydown, scales 0.5→14× and fades over 0.6s; capped at 6 concurrent rings.
- **Island arrival chime + sparkle burst**: `visitedIslands` Set tracks first landing per island. On a new landing: spawns 40 outward-velocity sparkle points (single shared 80-point Points pool, gravity-affected) and triggers a 3-note WebAudio sine-arpeggio chime (880 → 1320 → 1760 Hz).
- **Aurora ribbons**: 3 large additive curved planes 360-420 units up with a custom flowing shader (band-shaped alpha + animated mix between two colors), shared `AURORA_UNIFORMS` time uniform.
- **Resting butterflies**: each island spawns 4-7 perched butterfly sprites; per-frame distance check against the player triggers takeoff (re-parented to scene, flies along randomized direction for 4.5s, then disposed).
- `clearIslands()` also clears `restingButterflies` and `visitedIslands` so re-generation doesn't accumulate stale references.

### [x] Step: Phase 18 — Faster flying + magical sparkle trail
- Bumped `SPEED` 7→14 and `SPRINT` 12→26 (flight multiplier ×1.4 still applied) so cruising and dashing through the sky feels brisk.
- Added a magical sparkle trail behind the butterfly: 80-point additive `THREE.Points` cloud reusing the firefly texture in soft pink (`0xffd9f2`).
- Per-frame emission cadence adapts to motion (≈55Hz when moving, ≈12Hz when idle) with small XYZ jitter so the trail isn't a tight line; sparkles fade over ~1.5s and drift gently upward before being parked off-screen.

### [x] Step: Phase 29 — Render deploy prep
- Added `render.yaml` blueprint (free plan, Node runtime, `npm install` build, `node server.js` start, `/healthz` health check, auto-generated `SESSION_SECRET`, manually-set `PUBLIC_URL` + Discord credentials).
- Render free tier has no persistent disk, so creds should be set as env vars in the dashboard rather than relying on `.discord-creds.json`. The existing setup modal still works as a fallback.

### [x] Step: Phase 28 — Fly.io deploy prep
- Added `Dockerfile` (Node 20 alpine, `npm ci --omit=dev`, exposes 3000, default `CREDS_DIR=/data`).
- Added `.dockerignore` (excludes node_modules, .env, creds, .zenflow).
- Added `fly.toml` (1× shared-cpu, 512MB, persistent volume `discord_world_data` mounted at `/data`, `/healthz` http check, force_https, auto_start machines).
- `server.js`: `CREDS_FILE` now resolves to `CREDS_DIR/.discord-creds.json` when the dir exists (so creds persist on the Fly volume). `DISCORD_REDIRECT_URI` derives from `PUBLIC_URL` when set. Added `app.set('trust proxy', 1)`, `cookie.secure = NODE_ENV==='production'`, and `GET /healthz`.

### [x] Step: Phase 27 — Member butterflies use the player's 3D model
- Refactored the butterfly OBJ loader to populate a shared `BUTTERFLY_SRC` (geometry + textures + flap params) and added a `makeButterflyInstance(hueSeed, targetSize)` factory that builds a new `THREE.Mesh` with its own `MeshStandardMaterial` + per-instance `flapUniform`.
- The player avatar still uses this factory (with `window.__bfSeed`).
- `loadMembersForIsland` now spawns `makeButterflyInstance(hash(userId), 2.0)` per member instead of a 2D sprite, falls back to the old sprite if the OBJ hasn't loaded yet.
- Per-frame loop now drives each member butterfly's `flapUniform` (0.9·sin(t·14)·flapMul) and rotates `mesh.rotation.y` so it faces the orbit tangent.
- `clearIslands` disposes only per-instance materials, not the shared geometry.

### [x] Step: Phase 26 — Stop sidebar channels from disappearing
- `loadChannelsForIsland` now de-dupes concurrent callers via an `island._channelsPromise` so the proximity preloader and `openChat` don't both fetch + overwrite each other.
- `openChat` no longer blanks `chatChannels` synchronously; renders cached channels first (if any), awaits the load, then renders again. A generation token (`openChatGen`) makes a slow first call abort if a newer `openChat` has already taken over.
- `renderChannelSidebar` helper guards against rendering an empty list, so the sidebar never visibly empties between renders.

### [x] Step: Phase 6 — Solid islands & higher spawn
- Player now spawns high in the sky (y=90) so islands are immediately reachable
- Island top displacement reduced (no more spike artifacts) — surface is flat
- Snap-up collision: descending into the cliff from above auto-lands on top
- Removed PBR mushroom (it loaded huge and clipped through island) — only procedural mushrooms
