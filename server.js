import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client as DJSClient, GatewayIntentBits, Partials, Events } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Persistent creds — when CREDS_DIR is set (e.g. on Fly's mounted volume
// at /data), keep the file there so it survives restarts/deploys. Falls
// back to project root for local dev.
const CREDS_DIR = process.env.CREDS_DIR && fs.existsSync(process.env.CREDS_DIR)
  ? process.env.CREDS_DIR
  : __dirname;
const CREDS_FILE = path.join(CREDS_DIR, '.discord-creds.json');

const {
  PUBLIC_URL = '',
  SESSION_SECRET = 'dev-secret-change-me',
  PORT = 3000,
} = process.env;
// In prod, derive the OAuth redirect URI from PUBLIC_URL so it matches
// the Fly hostname automatically.
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI
  || (PUBLIC_URL ? `${PUBLIC_URL.replace(/\/$/, '')}/auth/callback` : 'http://localhost:3000/auth/callback');

// In-memory OAuth credentials. Seeded from env if present, but can also be
// set at runtime through the /api/oauth-config endpoint so the user never
// has to touch a .env file.
const oauthCreds = {
  client_id:     process.env.DISCORD_CLIENT_ID     || '',
  client_secret: process.env.DISCORD_CLIENT_SECRET || '',
  bot_token:     process.env.DISCORD_BOT_TOKEN     || '',
};
// Hydrate from on-disk cache so creds survive a server restart. Env vars
// always win — only fields that aren't set from env get loaded from disk.
try {
  if (fs.existsSync(CREDS_FILE)){
    const saved = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    if (!oauthCreds.client_id     && saved.client_id)     oauthCreds.client_id     = saved.client_id;
    if (!oauthCreds.client_secret && saved.client_secret) oauthCreds.client_secret = saved.client_secret;
    if (!oauthCreds.bot_token     && saved.bot_token)     oauthCreds.bot_token     = saved.bot_token;
    console.log('[discord-world] Loaded saved Discord creds from .discord-creds.json');
  }
} catch (e){ console.warn('[discord-world] Failed to read .discord-creds.json:', e.message); }
function saveCreds(){
  try {
    fs.writeFileSync(CREDS_FILE, JSON.stringify(oauthCreds, null, 2), { mode: 0o600 });
  } catch (e){ console.warn('[discord-world] Failed to save creds:', e.message); }
}

// ---------- Discord gateway: live presence + members ----------
// presenceMap[guildId][userId] = 'online' | 'idle' | 'dnd' | 'offline'
const presenceMap = new Map();
let gatewayClient = null;
let gatewayReady = false;

function setGuildPresence(guildId, userId, status){
  let g = presenceMap.get(guildId);
  if (!g){ g = new Map(); presenceMap.set(guildId, g); }
  g.set(userId, status);
}

async function startGateway(){
  if (!oauthCreds.bot_token) return;
  if (gatewayClient){
    try { gatewayClient.destroy(); } catch {}
    gatewayClient = null; gatewayReady = false;
    presenceMap.clear();
  }
  const c = new DJSClient({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });

  c.once(Events.ClientReady, async (cli) => {
    gatewayReady = true;
    console.log('[gateway] ready as', cli.user.tag, '— guilds:', cli.guilds.cache.size);
    // Pull every member of every guild so presence cache is populated.
    for (const [, g] of cli.guilds.cache){
      try {
        const members = await g.members.fetch({ withPresences: true });
        for (const [, m] of members){
          setGuildPresence(g.id, m.user.id, m.presence?.status || 'offline');
        }
        console.log('[gateway] cached', members.size, 'members for', g.name);
      } catch (e){ console.warn('[gateway] member fetch failed for', g.name, e.message); }
    }
  });

  c.on(Events.PresenceUpdate, (oldP, newP) => {
    if (!newP || !newP.guild || !newP.userId) return;
    setGuildPresence(newP.guild.id, newP.userId, newP.status || 'offline');
  });

  c.on(Events.GuildMemberAdd, (m) => {
    setGuildPresence(m.guild.id, m.user.id, m.presence?.status || 'offline');
  });

  c.on('error', (e) => console.warn('[gateway] error:', e.message));
  c.on('shardError', (e) => console.warn('[gateway] shard error:', e.message));

  try {
    await c.login(oauthCreds.bot_token);
    gatewayClient = c;
  } catch (e){
    console.warn('[gateway] login failed (presence will be disabled):', e.message);
    gatewayClient = null; gatewayReady = false;
  }
}

if (!oauthCreds.client_id || !oauthCreds.client_secret) {
  console.warn('[discord-world] Discord OAuth not configured yet — paste Client ID / Secret in the in-app setup dialog, or copy .env.example to .env.');
}
if (!oauthCreds.bot_token) {
  console.warn('[discord-world] Discord Bot Token not set — channel listing & messaging will fail. Paste it in the in-app setup dialog.');
}

const SCOPES = ['identify', 'guilds'];
const DISCORD_API = 'https://discord.com/api/v10';

const app = express();
app.use(cookieParser());
// Trust the Fly proxy so secure cookies + req.protocol work behind HTTPS.
app.set('trust proxy', 1);
app.use(session({
  name: 'dw.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7*24*60*60*1000,
  },
}));

// Health check for Fly's HTTP checks.
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.use(express.json());

// ---------- tiny in-memory cache so we don't hammer Discord ----------
const cache = new Map(); // key -> { exp, data }
function cacheGet(key){
  const v = cache.get(key);
  if (!v) return null;
  if (v.exp < Date.now()){ cache.delete(key); return null; }
  return v.data;
}
function cacheSet(key, data, ttlMs){ cache.set(key, { exp: Date.now()+ttlMs, data }); }

// ---------- helpers ----------
function requireAuth(req, res, next){
  if (!req.session.access_token) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

async function discord(req, urlPath){
  const cacheKey = `${req.session.user_id}:${urlPath}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  const r = await fetch(`${DISCORD_API}${urlPath}`, {
    headers: { Authorization: `Bearer ${req.session.access_token}` },
  });
  if (!r.ok){
    const text = await r.text().catch(()=>'');
    const err = new Error(`discord_${r.status}`);
    err.status = r.status; err.body = text;
    throw err;
  }
  const data = await r.json();
  cacheSet(cacheKey, data, 30_000);
  return data;
}

// Bot-token-authenticated call (channels, messages, members — endpoints
// the user OAuth Bearer can't touch). Cached briefly to avoid spamming
// the Discord API while the player wanders past portals.
async function discordBot(urlPath, opts = {}){
  if (!oauthCreds.bot_token){
    const err = new Error('bot_not_configured');
    err.status = 503; throw err;
  }
  const cacheable = !opts.method || opts.method === 'GET';
  const cacheKey = `bot:${urlPath}`;
  if (cacheable){
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }
  const r = await fetch(`${DISCORD_API}${urlPath}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bot ${oauthCreds.bot_token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok){
    const text = await r.text().catch(()=>'');
    const err = new Error(`discord_bot_${r.status}`);
    err.status = r.status; err.body = text;
    throw err;
  }
  const data = await r.json();
  if (cacheable) cacheSet(cacheKey, data, 15_000);
  return data;
}

// ---------- OAuth ----------
app.get('/auth/login', (req, res) => {
  // Don't bounce the user to Discord with an empty client_id — Discord
  // responds with "Invalid Form Body" which is a confusing dead end.
  // Instead, send them back home with an error flag so the client can
  // show a friendly notice + a clear path to the demo realm.
  if (!oauthCreds.client_id || !oauthCreds.client_secret){
    return res.redirect('/?oauth=unconfigured');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauth_state = state;
  const params = new URLSearchParams({
    client_id: oauthCreds.client_id,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauth_state){
      return res.status(400).send('Invalid OAuth state');
    }
    delete req.session.oauth_state;

    const body = new URLSearchParams({
      client_id: oauthCreds.client_id,
      client_secret: oauthCreds.client_secret,
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: DISCORD_REDIRECT_URI,
    });

    const tokRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokRes.ok){
      const t = await tokRes.text();
      return res.status(500).send(`Token exchange failed: ${t}`);
    }
    const tok = await tokRes.json();

    req.session.access_token  = tok.access_token;
    req.session.refresh_token = tok.refresh_token;
    req.session.token_expires = Date.now() + tok.expires_in*1000;

    // who am I
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    req.session.user_id = me.id;
    req.session.username = me.global_name || me.username;
    req.session.avatar = me.avatar;

    res.redirect('/');
  } catch (e){
    console.error(e);
    res.status(500).send('OAuth error');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

// ---------- in-app OAuth setup (no .env editing needed) ----------
app.get('/api/oauth-config', (req, res) => {
  res.json({
    configured: !!(oauthCreds.client_id && oauthCreds.client_secret),
    bot_configured: !!oauthCreds.bot_token,
    client_id: oauthCreds.client_id || '',         // public — safe to expose
    redirect_uri: DISCORD_REDIRECT_URI,            // user must whitelist this in Discord dev portal
  });
});

app.post('/api/oauth-config', (req, res) => {
  const cid = String(req.body?.client_id || '').trim();
  const sec = String(req.body?.client_secret || '').trim();
  const bot = String(req.body?.bot_token || '').trim();
  if (!/^\d{15,25}$/.test(cid)){
    return res.status(400).json({ error: 'Client ID should be a 15-25 digit numeric Discord application ID.' });
  }
  if (sec.length < 20){
    return res.status(400).json({ error: 'Client Secret looks too short.' });
  }
  oauthCreds.client_id = cid;
  oauthCreds.client_secret = sec;
  if (bot){
    if (bot.length < 50){
      return res.status(400).json({ error: 'Bot token looks too short.' });
    }
    oauthCreds.bot_token = bot;
  }
  saveCreds();
  console.log('[discord-world] OAuth credentials updated via /api/oauth-config (bot=' + (!!oauthCreds.bot_token) + ')');
  // Reconnect gateway with the new bot token so live presence works.
  startGateway().catch(e => console.warn('[gateway] restart failed:', e.message));
  res.json({ ok:true, configured:true, bot_configured: !!oauthCreds.bot_token, client_id: cid, redirect_uri: DISCORD_REDIRECT_URI });
});

// ---------- API (proxied; token never leaves the server) ----------
app.get('/api/me', requireAuth, async (req, res) => {
  res.json({
    id: req.session.user_id,
    username: req.session.username,
    avatar: req.session.avatar
      ? `https://cdn.discordapp.com/avatars/${req.session.user_id}/${req.session.avatar}.png?size=128`
      : null,
  });
});

app.get('/api/guilds', requireAuth, async (req, res) => {
  try {
    const guilds = await discord(req, '/users/@me/guilds');
    // Intersect with the bot's guild list — only show servers where the
    // bot is actually present (otherwise channel/messages/members would
    // 401 and the island would be useless).
    let botGuildIds = null;
    if (oauthCreds.bot_token){
      try {
        const botGuilds = await discordBot('/users/@me/guilds');
        botGuildIds = new Set(botGuilds.map(g => g.id));
      } catch (e){ console.warn('[discord-world] bot /users/@me/guilds failed:', e.message); }
    }
    const filtered = botGuildIds
      ? guilds.filter(g => botGuildIds.has(g.id))
      : guilds;
    res.json(filtered.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
      owner: !!g.owner,
      member_count_hint: typeof g.approximate_member_count === 'number' ? g.approximate_member_count : null,
    })));
  } catch (e){
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/guilds/:id/channels', requireAuth, async (req, res) => {
  try {
    // Use the bot token — user OAuth Bearer can't list guild channels.
    // Bot must be in the guild for this to succeed.
    const channels = await discordBot(`/guilds/${req.params.id}/channels`);
    res.json(channels.map(c => ({
      id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, position: c.position,
    })));
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

app.get('/api/guilds/:id/members', requireAuth, async (req, res) => {
  try {
    // Bot token + Server Members Intent required.
    const members = await discordBot(`/guilds/${req.params.id}/members?limit=100`);
    const presences = presenceMap.get(req.params.id);
    res.json(members.map(m => ({
      id: m.user?.id,
      username: m.user?.global_name || m.user?.username,
      nick: m.nick || null,
      bot: !!m.user?.bot,
      status: presences?.get(m.user?.id) || 'offline',
      avatar: m.user?.avatar
        ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64`
        : null,
    })));
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

// Lightweight presence-only feed — clients poll this every few seconds.
app.get('/api/guilds/:id/presences', requireAuth, (req, res) => {
  const g = presenceMap.get(req.params.id);
  if (!g) return res.json({ ready: gatewayReady, presences: {} });
  const out = {};
  for (const [uid, st] of g) out[uid] = st;
  res.json({ ready: gatewayReady, presences: out });
});

app.get('/api/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const msgs = await discordBot(`/channels/${req.params.id}/messages?limit=30`);
    res.json(msgs.map(m => ({
      id: m.id,
      content: m.content,
      author: { id: m.author?.id, username: m.author?.global_name || m.author?.username, avatar: m.author?.avatar
        ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64` : null },
      timestamp: m.timestamp,
    })));
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

app.post('/api/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const content = String(req.body?.content || '').slice(0, 2000);
    // Prefix with the player's display name so messages posted by the bot
    // are still attributable in real Discord.
    const prefixed = req.session.username
      ? `**${req.session.username}** (via Discord World): ${content}`
      : content;
    const m = await discordBot(`/channels/${req.params.id}/messages`, {
      method: 'POST',
      body: { content: prefixed },
    });
    res.json({
      id: m.id,
      content: m.content,
      author: { id: m.author?.id, username: m.author?.global_name || m.author?.username, avatar: m.author?.avatar
        ? `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=64` : null },
      timestamp: m.timestamp,
    });
  } catch (e){
    res.status(e.status || 500).json({ error: e.message, body: e.body });
  }
});

// ---------- static client ----------
app.use(express.static(__dirname, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Discord World listening on http://localhost:${PORT}`);
  // Boot the gateway so presence is live from the start (if a bot token exists).
  startGateway().catch(e => console.warn('[gateway] boot failed:', e.message));
});
