'use strict';
/*
 * Serveur de la salle de jeux (aucune dépendance à installer, Node.js suffit).
 *  - une "salle" = une partie affichée sur une TV, avec ses joueurs (téléphones) ;
 *  - la TV et les téléphones restent synchronisés par un flux temps réel (Server-Sent Events) ;
 *  - chaque jeu vit dans le dossier jeux/ et expose la même interface (voir jeux/pepites.js).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const GAMES = {
  pepites: require('./jeux/pepites'),
};

const MAX_ROOMS = 200;
const MAX_PLAYERS = 200;
const ROOM_IDLE_MS = 8 * 60 * 60 * 1000;
const LOBBY_GRACE_MS = 60 * 1000;

const rooms = new Map();

/* ---------- utilitaires ---------- */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const token = (n = 8) => crypto.randomBytes(n).toString('hex');

function makeCode() {
  for (let i = 0; i < 1000; i++) {
    let code = '';
    for (let k = 0; k < 4; k++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Plus de codes de salle disponibles');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lanIps() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  const isPrivate = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const fail = (res, code, message) => json(res, code, { error: message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20000) {
        reject(new Error('Requête trop volumineuse'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('Requête illisible'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------- salles ---------- */

function purgeRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.subs.size === 0 && now - room.lastActivity > ROOM_IDLE_MS) closeRoom(code);
  }
}
setInterval(purgeRooms, 10 * 60 * 1000).unref();

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.game) room.game.dispose();
  clearTimeout(room.pushTimer);
  for (const sub of room.subs) {
    try {
      sub.res.end();
    } catch (e) {
      /* ignoré */
    }
  }
  rooms.delete(code);
}

function createRoom(gameId) {
  if (rooms.size >= MAX_ROOMS) purgeRooms();
  if (rooms.size >= MAX_ROOMS) throw new Error('Le serveur est plein, réessayez plus tard.');
  const room = {
    code: makeCode(),
    hostKey: token(8),
    gameId,
    settings: Object.assign({}, GAMES[gameId].defaults),
    players: new Map(),
    game: null,
    subs: new Set(),
    used: new Set(),
    nextPlayerNumber: 1,
    pushTimer: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function connectedIds(room) {
  const ids = new Set();
  for (const sub of room.subs) if (sub.pid) ids.add(sub.pid);
  return ids;
}

function tvView(room) {
  const conn = connectedIds(room);
  return {
    code: room.code,
    gameId: room.gameId,
    gameName: GAMES[room.gameId].name,
    phase: room.game ? 'game' : 'lobby',
    settings: room.settings,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, connected: conn.has(p.id) })),
    game: room.game ? room.game.viewTV() : null,
  };
}

function playerView(room, pid) {
  const p = room.players.get(pid);
  if (!p) return null;
  return {
    code: room.code,
    gameId: room.gameId,
    gameName: GAMES[room.gameId].name,
    phase: room.game ? 'game' : 'lobby',
    me: { id: p.id, name: p.name },
    playersCount: room.players.size,
    game: room.game ? room.game.viewPlayer(pid) : null,
  };
}

function push(room, sub) {
  if (sub.role === 'tv') {
    sub.res.write('event: state\ndata: ' + JSON.stringify(tvView(room)) + '\n\n');
    return;
  }
  const view = playerView(room, sub.pid);
  if (!view) {
    sub.res.write('event: gone\ndata: {}\n\n');
    return;
  }
  sub.res.write('event: state\ndata: ' + JSON.stringify(view) + '\n\n');
}

function broadcast(room) {
  for (const sub of room.subs) {
    try {
      push(room, sub);
    } catch (e) {
      /* connexion fermée, ignorée */
    }
  }
}

function broadcastSoon(room) {
  if (room.pushTimer) return;
  room.pushTimer = setTimeout(() => {
    room.pushTimer = null;
    broadcast(room);
  }, 60);
}

function gameContext(room) {
  return {
    players: () => [...room.players.values()].map((p) => ({ id: p.id, name: p.name })),
    broadcast: () => broadcast(room),
    broadcastSoon: () => broadcastSoon(room),
    used: room.used,
  };
}

function cleanName(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, 14).join('');
}

function uniqueName(room, wanted) {
  const taken = (n) => [...room.players.values()].some((p) => p.name.toLowerCase() === n.toLowerCase());
  const base = wanted || 'Joueur ' + room.nextPlayerNumber++;
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) {
    if (!taken(base + ' ' + i)) return base + ' ' + i;
  }
  return base + ' ' + token(2);
}

/* ---------- flux temps réel ---------- */

function openStream(req, res, room, url) {
  const role = url.searchParams.get('role') === 'player' ? 'player' : 'tv';
  let pid = null;
  if (role === 'player') {
    pid = url.searchParams.get('pid');
    const p = room.players.get(pid);
    if (!p || !safeEqual(p.token, url.searchParams.get('token'))) return fail(res, 401, 'Joueur inconnu');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  const sub = { res, role, pid };
  room.subs.add(sub);
  room.lastActivity = Date.now();
  push(room, sub);
  if (role === 'player') broadcastSoon(room);

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      /* ignoré */
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(beat);
    room.subs.delete(sub);
    room.lastActivity = Date.now();
    if (role === 'player') {
      broadcastSoon(room);
      // En salle d'attente, un joueur déconnecté trop longtemps est retiré de la liste.
      setTimeout(() => {
        if (!rooms.has(room.code) || room.game) return;
        if (room.players.has(pid) && !connectedIds(room).has(pid)) {
          room.players.delete(pid);
          broadcast(room);
        }
      }, LOBBY_GRACE_MS).unref();
    }
  });
}

/* ---------- API ---------- */

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (method === 'GET' && parts[1] === 'info' && parts.length === 2) {
    return json(res, 200, {
      ips: lanIps(),
      port: PORT,
      publicUrl: PUBLIC_URL || null,
      needsPassword: !!ADMIN_PASSWORD,
      games: Object.values(GAMES).map((g) => ({ id: g.id, name: g.name })),
    });
  }

  if (method === 'POST' && parts[1] === 'rooms' && parts.length === 2) {
    const body = await readBody(req);
    if (ADMIN_PASSWORD && !safeEqual(ADMIN_PASSWORD, body.password)) return fail(res, 401, 'Mot de passe animateur requis.');
    const gameId = GAMES[body.gameId] ? body.gameId : 'pepites';
    const room = createRoom(gameId);
    return json(res, 200, { code: room.code, hostKey: room.hostKey });
  }

  if (parts[1] !== 'rooms' || !parts[2]) return fail(res, 404, 'Introuvable');
  const room = rooms.get(String(parts[2]).toUpperCase());
  if (!room) return fail(res, 404, 'Cette salle n’existe pas ou est terminée.');
  room.lastActivity = Date.now();
  const action = parts[3];

  if (method === 'GET' && action === 'exists') return json(res, 200, { ok: true });
  if (method === 'GET' && action === 'stream') return openStream(req, res, room, url);

  if (method === 'POST' && action === 'join') {
    const body = await readBody(req);
    if (body.pid && body.token) {
      const known = room.players.get(body.pid);
      if (known && safeEqual(known.token, body.token)) {
        return json(res, 200, { pid: known.id, token: known.token, name: known.name });
      }
    }
    if (room.players.size >= MAX_PLAYERS) return fail(res, 403, 'La salle est pleine.');
    const player = { id: token(4), token: token(8), name: uniqueName(room, cleanName(body.name)) };
    room.players.set(player.id, player);
    broadcast(room);
    return json(res, 200, { pid: player.id, token: player.token, name: player.name });
  }

  if (method === 'POST' && action === 'act') {
    const body = await readBody(req);
    const p = room.players.get(body.pid);
    if (!p || !safeEqual(p.token, body.token)) return fail(res, 401, 'Joueur inconnu');
    if (!room.game) return fail(res, 409, 'La partie n’a pas commencé.');
    const result = room.game.action(p.id, body.type, body.data) || {};
    return result.error ? fail(res, 400, result.error) : json(res, 200, { ok: true });
  }

  if (method === 'POST' && action === 'host') {
    const body = await readBody(req);
    if (!safeEqual(room.hostKey, body.key)) return fail(res, 403, 'Clé animateur invalide');
    switch (body.type) {
      case 'settings': {
        if (room.game) return fail(res, 409, 'Impossible de changer les réglages en cours de partie.');
        room.settings = GAMES[room.gameId].sanitizeSettings(Object.assign({}, room.settings, body));
        broadcast(room);
        return json(res, 200, { ok: true });
      }
      case 'start': {
        if (room.game && room.game.phase !== 'finished') return fail(res, 409, 'Une partie est déjà en cours.');
        if (room.game) {
          room.game.dispose();
          room.game = null;
        }
        if (room.players.size < 1) return fail(res, 409, 'Aucun joueur n’a encore rejoint la salle.');
        room.game = GAMES[room.gameId].create(gameContext(room), room.settings);
        const r = room.game.start();
        if (r && r.error) {
          room.game.dispose();
          room.game = null;
          broadcast(room);
          return fail(res, 500, r.error);
        }
        return json(res, 200, { ok: true });
      }
      case 'restart': {
        if (room.game) room.game.dispose();
        room.game = null;
        broadcast(room);
        return json(res, 200, { ok: true });
      }
      case 'kick': {
        if (room.game) return fail(res, 409, 'On ne retire un joueur qu’en salle d’attente.');
        room.players.delete(body.pid);
        broadcast(room);
        return json(res, 200, { ok: true });
      }
      case 'next':
      case 'end': {
        if (!room.game) return fail(res, 409, 'Aucune partie en cours.');
        const r = room.game.hostAction(body.type);
        return r && r.error ? fail(res, 409, r.error) : json(res, 200, { ok: true });
      }
      default:
        return fail(res, 400, 'Action inconnue');
    }
  }

  return fail(res, 404, 'Introuvable');
}

/* ---------- fichiers du site ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  else if (rel === '/tv') rel = '/tv.html';
  else if (rel === '/host') rel = '/host.html';
  else if (/^\/j\/[A-Za-z]{4}\/?$/.test(rel) || rel === '/jouer') rel = '/play.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Interdit');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page introuvable');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) fail(res, 400, e.message || 'Erreur');
    else res.end();
  }
});

function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { server, start, rooms };

if (require.main === module) {
  start().then(() => {
    const ips = lanIps();
    console.log('');
    console.log('  ✦ Salle de jeux prête ✦');
    console.log('');
    console.log('  Sur l’ordinateur branché à la TV, ouvrez :');
    console.log('    http://localhost:' + PORT + '/tv');
    if (ips.length) {
      console.log('');
      console.log('  Les téléphones doivent être sur le même Wi-Fi que cet ordinateur.');
      console.log('  Adresse sur le réseau local : http://' + ips[0] + ':' + PORT);
    }
    console.log('');
    console.log('  (Pour arrêter : fermez cette fenêtre ou appuyez sur Ctrl + C)');
    console.log('');
    try {
      const { questions, problems } = GAMES.pepites.loadBank();
      console.log('  Banque de questions : ' + questions.length + ' question(s) valide(s).');
      problems.forEach((p) => console.log('  ⚠ ' + p));
    } catch (e) {
      console.log('  ⚠ ' + e.message);
    }
    console.log('');
  });
}
