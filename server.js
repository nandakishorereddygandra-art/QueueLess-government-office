const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const LEGACY_STORE = path.join(DATA, 'store.json');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/govqueue';
const MONGODB_DATABASE = process.env.MONGODB_DATABASE;
const PORT = Number(process.env.PORT || 4173);
const COLLECTIONS = ['offices', 'services', 'tokens', 'staff', 'notifications', 'audit'];
const KNOWN_OFFICE_DETAILS = {
  'rajkot-rmc-zone-central': { latitude: 22.2922152217612, longitude: 70.8024406163114, servicesAvailable: ['Aadhaar Centre'] },
  'rajkot-rmc-zone-west': { latitude: 22.2794468490036, longitude: 70.7745920882892, servicesAvailable: ['Aadhaar Centre'] },
  'rajkot-rmc-zone-east': { latitude: 22.2961610836897, longitude: 70.8172456773099, servicesAvailable: ['Aadhaar Centre'] },
  'rajkot-rmc-civic-central': { latitude: 22.2922152217612, longitude: 70.8024406163114 },
  'rajkot-rmc-civic-west': { latitude: 22.2794468490036, longitude: 70.7745920882892 },
  'rajkot-rmc-civic-east': { latitude: 22.2961610836897, longitude: 70.8172456773099 },
  'rajkot-rmc-civic-amin-marg': { latitude: 22.2879665646068, longitude: 70.7818527931579 },
  'rajkot-rmc-civic-krishnanagar': { latitude: 22.2648728167313, longitude: 70.7933010907307 },
  'rajkot-rmc-civic-kothariya': { latitude: 22.2746177310847, longitude: 70.8122157929178 }
};

const emptyState = Object.fromEntries(COLLECTIONS.map(name => [name, []]));

// In-memory state and SSE clients
let db = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
let mongoClient = null;
let mongoDb = null;
const sseClients = new Set();
const officerSessions = new Map();
const loginAttempts = new Map();
const staticCache = new Map();
const citizenAccounts = () => mongoDb.collection('citizens');

const officers = [
  { name: process.env.ADMIN_NAME, role: 'admin', pin: process.env.ADMIN_PIN },
  { name: process.env.STAFF_NAME, role: 'staff', pin: process.env.STAFF_PIN }
].filter(officer => officer.name && officer.pin);

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)gq_session=([a-f0-9]{64})(?:;|$)/);
  if (!match) return null;
  const session = officerSessions.get(match[1]);
  if (!session || session.expiresAt < Date.now()) {
    officerSessions.delete(match[1]);
    return null;
  }
  session.expiresAt = Date.now() + (session.role === 'citizen' ? 30 : 8) * 60 * 60 * 1000;
  return session;
}

function verifyCitizenPassword(account, password) {
  const salt = account?.salt || 'unknown-account-salt';
  const expected = Buffer.from(account?.passwordHash || '0'.repeat(128), 'hex');
  const supplied = crypto.scryptSync(password, salt, 64);
  return Boolean(account && expected.length === supplied.length && crypto.timingSafeEqual(supplied, expected));
}

function requireOfficer(req, res, roles) {
  const session = getSession(req);
  if (!session || !roles.includes(session.role)) {
    send(res, 401, { error: 'Sign in with an authorized officer account to perform this action.' });
    return null;
  }
  return session;
}

async function loadStore() {
  if (!process.env.VERCEL) fs.mkdirSync(DATA, { recursive: true });
  mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await mongoClient.connect();
  mongoDb = mongoClient.db(MONGODB_DATABASE);
  await citizenAccounts().createIndex({ email: 1 }, { unique: true });

  const existing = await Promise.all(COLLECTIONS.map(name => mongoDb.collection(name).findOne({}, { projection: { _id: 1 } })));
  if (!existing.some(Boolean)) {
    if (fs.existsSync(LEGACY_STORE)) {
      try {
        db = JSON.parse(fs.readFileSync(LEGACY_STORE, 'utf8'));
        console.log('Migrating data/store.json into MongoDB.');
      } catch (err) {
        console.warn('Could not read legacy store.json, starting with empty collections:', err.message);
        db = JSON.parse(JSON.stringify(emptyState));
      }
    } else {
      db = JSON.parse(JSON.stringify(emptyState));
    }
    await persistStore();
  } else {
    db = {};
    for (const name of COLLECTIONS) {
      db[name] = await mongoDb.collection(name).find({}, { projection: { _id: 0 } }).toArray();
    }
  }

  let changed = false;
  for (const office of db.offices || []) {
    const known = KNOWN_OFFICE_DETAILS[office.id];
    if (!known) continue;
    if (office.latitude == null || office.longitude == null) {
      office.latitude = known.latitude;
      office.longitude = known.longitude;
      changed = true;
    }
    if (known.servicesAvailable?.length) {
      const current = Array.isArray(office.servicesAvailable) ? office.servicesAvailable : [];
      const merged = [...new Set([...current, ...known.servicesAvailable])];
      if (merged.length !== current.length) {
        office.servicesAvailable = merged;
        office.servicesNote = 'RMC lists an Aadhaar Centre at this zone location. Confirm current service availability and hours before visiting.';
        changed = true;
      }
    }
  }
  for (const token of db.tokens || []) {
    if (token.status === 'waiting' && !token.etaAt) {
      token.etaAt = Date.now() + Math.max(0, Number(token.wait) || 0) * 60000;
      changed = true;
    }
  }
  if (changed) scheduleSave();
}

async function persistStore() {
  for (const name of COLLECTIONS) {
    const collection = mongoDb.collection(name);
    await collection.deleteMany({});
    if (db[name]?.length) await collection.insertMany(db[name]);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveQueue = saveQueue.then(persistStore).catch(err => {
      console.error('Failed to write app state to MongoDB:', err);
    });
  }, 100);
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...headers
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function body(req) {
  // Vercel's Node runtime may parse request bodies before invoking the function.
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 65536) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function stamp() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function todayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// In Vercel, each request invokes this handler; local development still starts
// the same HTTP server through the start script below.
const databaseReady = loadStore().then(() => {
  console.log(`Connected to MongoDB database "${mongoDb.databaseName}".`);
}).catch(err => {
  console.error('Could not connect to MongoDB:', err.message);
  throw err;
});

// SSE Heartbeat interval
const heartbeatTimer = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 25000);
heartbeatTimer.unref?.();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // API Routes
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && ['/api/citizens/signup', '/api/citizens/login'].includes(url.pathname)) {
        const ip = `citizen:${req.socket.remoteAddress || 'unknown'}`;
        const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        if (attempts.resetAt <= Date.now()) {
          attempts.count = 0;
          attempts.resetAt = Date.now() + 15 * 60 * 1000;
        }
        if (attempts.count >= 10) return send(res, 429, { error: 'Too many attempts. Please try again in 15 minutes.' });
        const input = await body(req);
        const email = String(input.email || '').trim().toLowerCase();
        const password = String(input.password || '');
        const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
        if (!validEmail || password.length < 8 || password.length > 128) {
          attempts.count++;
          loginAttempts.set(ip, attempts);
          return send(res, 400, { error: 'Enter a valid email and a password between 8 and 128 characters.' });
        }

        let account;
        let created = false;
        if (url.pathname.endsWith('/signup')) {
          const name = String(input.name || '').trim();
          account = await citizenAccounts().findOne({ email });
          if (account) {
            if (!verifyCitizenPassword(account, password)) {
              attempts.count++;
              loginAttempts.set(ip, attempts);
              return send(res, 401, { error: 'This email already has an account, but the password did not match. Sign in with the correct password.' });
            }
          } else {
            if (name.length < 2 || name.length > 80) {
              attempts.count++;
              loginAttempts.set(ip, attempts);
              return send(res, 400, { error: 'Enter your name (2 to 80 characters) to create a new account.' });
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
            account = { id: crypto.randomUUID(), name, email, salt, passwordHash, createdAt: new Date().toISOString() };
            try {
              await citizenAccounts().insertOne(account);
              created = true;
            } catch (error) {
              if (error.code !== 11000) throw error;
              account = await citizenAccounts().findOne({ email });
              if (!verifyCitizenPassword(account, password)) {
                return send(res, 409, { error: 'An account with this email already exists. Please sign in.' });
              }
            }
          }
        } else {
          account = await citizenAccounts().findOne({ email });
          if (!verifyCitizenPassword(account, password)) {
            attempts.count++;
            loginAttempts.set(ip, attempts);
            return send(res, 401, { error: 'Email or password is incorrect.' });
          }
        }

        loginAttempts.delete(ip);
        const sessionId = crypto.randomBytes(32).toString('hex');
        const maxAge = 30 * 24 * 60 * 60;
        officerSessions.set(sessionId, { role: 'citizen', name: account.name, email: account.email, citizenId: account.id, expiresAt: Date.now() + maxAge * 1000 });
        return send(res, 200, { role: 'citizen', id: account.id, name: account.name, email: account.email, authenticated: true, created }, 'application/json; charset=utf-8', {
          'Set-Cookie': `gq_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/session') {
        const ip = req.socket.remoteAddress || 'unknown';
        const attempts = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
        if (attempts.resetAt <= Date.now()) {
          attempts.count = 0;
          attempts.resetAt = Date.now() + 15 * 60 * 1000;
        }
        if (attempts.count >= 10) return send(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
        const input = await body(req);
        const username = String(input.username || '').trim().toLowerCase();
        const pin = String(input.pin || '');
        if (!officers.length) return send(res, 503, { error: 'Officer accounts have not been configured.' });
        const officer = officers.find(item => username === item.name.trim().toLowerCase() || username === item.role);
        const expected = officer ? Buffer.from(officer.pin) : Buffer.from('invalid');
        const supplied = Buffer.from(pin);
        const valid = officer && /^\d{6}$/.test(pin) && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        if (!valid) {
          attempts.count++;
          loginAttempts.set(ip, attempts);
          return send(res, 401, { error: 'Officer name or PIN is incorrect.' });
        }
        loginAttempts.delete(ip);
        const sessionId = crypto.randomBytes(32).toString('hex');
        officerSessions.set(sessionId, { role: officer.role, name: officer.name, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
        return send(res, 200, { role: officer.role, name: officer.name }, 'application/json; charset=utf-8', {
          'Set-Cookie': `gq_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/session') {
        const session = getSession(req);
        const configuredRoles = {
          admin: officers.some(officer => officer.role === 'admin'),
          staff: officers.some(officer => officer.role === 'staff')
        };
        return send(res, 200, session ? { role: session.role, id: session.citizenId || null, name: session.name, email: session.email || null, authenticated: session.role === 'citizen', configuredRoles } : { role: 'citizen', id: null, authenticated: false, configuredRoles });
      }

      if (req.method === 'POST' && url.pathname === '/api/session/logout') {
        const match = (req.headers.cookie || '').match(/(?:^|;\s*)gq_session=([a-f0-9]{64})(?:;|$)/);
        if (match) officerSessions.delete(match[1]);
        return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
          'Set-Cookie': 'gq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        });
      }

      // Server-Sent Events endpoint
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no'
        });
        if (res.flushHeaders) res.flushHeaders();
        res.write(`event: init\ndata: ${JSON.stringify(db)}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/data') {
        return send(res, 200, db);
      }

      if (req.method === 'POST' && url.pathname === '/api/tokens') {
        const input = await body(req);
        const svc = db.services.find(s => s.id === input.serviceId);
        const office = db.offices.find(o => o.id === input.officeId);
        const service = typeof input.service === 'string' ? input.service.trim() : (svc?.name || '');
        const citizen = typeof input.citizen === 'string' ? input.citizen.trim() : '';
        const slot = typeof input.slot === 'string' ? input.slot.trim() : '';
        const date = typeof input.date === 'string' ? input.date.trim() : '';
        const validSlots = ['11:30 AM', '11:45 AM', '12:00 PM', '12:15 PM', '12:30 PM', '12:45 PM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM', '03:00 PM'];
        if (!office || service.length < 2 || service.length > 100 || citizen.length < 2 || citizen.length > 80 || date !== todayISO() || !validSlots.includes(slot)) {
          return send(res, 400, { error: 'Enter your request and name, choose an office and a valid time today.' });
        }

        const prefix = ({
          'Aadhaar update': 'A',
          'Income certificate': 'I',
          'Birth certificate': 'B',
          'Driving licence renewal': 'L',
          'Property tax payment': 'P'
        })[service] || 'G';

        const count = db.tokens.filter(t => t.date === 'Today' || t.date === date).length + 127;
        const ahead = db.tokens.filter(t => t.officeId === office.id && t.status === 'waiting').length;
        const wait = Math.max(Number(office.wait) || 10, ahead * 3 + (Number(svc?.duration) || 15));
        const bookedAt = Date.now();
        const token = {
          id: `tok-${crypto.randomUUID()}`,
          number: `${prefix}-${count}`,
          citizen,
          citizenId: getSession(req)?.citizenId || null,
          service,
          serviceId: svc?.id || null,
          requestOnly: true,
          office: office.name,
          officeId: office.id,
          date: 'Today',
          slot: slot || '12:30 PM',
          status: 'waiting',
          ahead,
          wait,
          bookedAt,
          etaAt: bookedAt + wait * 60000,
          counter: 'Unassigned',
          createdAt: stamp()
        };

        db.tokens.unshift(token);
        db.notifications.unshift({
          id: `n-${Date.now()}`,
          title: 'Your Tap Token request is ready',
          text: `${token.number} · ${service} · ${office.short}`,
          time: 'Just now',
          unread: true
        });

        scheduleSave();
        broadcast('update', { db, lastAction: 'book', token });
        return send(res, 201, token);
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/tokens/')) {
        const id = url.pathname.split('/').pop();
        const input = await body(req);
        const token = db.tokens.find(t => t.id === id);
        if (!token) return send(res, 404, { error: 'Token not found.' });

        const staffActions = ['call', 'serve', 'complete'];
        const adminActions = ['call', 'serve', 'complete', 'skip', 'cancel', 'reschedule'];
        const allowedRoles = staffActions.includes(input.action) ? ['staff', 'admin']
            : adminActions.includes(input.action) ? ['admin'] : [];
        let actor = 'Citizen';
        if (input.action !== 'checkin' && allowedRoles.length) {
          const session = requireOfficer(req, res, allowedRoles);
          if (!session) return;
          actor = session.name;
        } else if (input.action !== 'checkin') {
          return send(res, 400, { error: 'Unsupported action.' });
        }
        if (['skip', 'cancel', 'reschedule'].includes(input.action) && (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 300)) {
          return send(res, 400, { error: 'Provide a reason of 1 to 300 characters.' });
        }
        if (input.action === 'reschedule' && (typeof input.slot !== 'string' || !['12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM', '03:00 PM'].includes(input.slot))) {
          return send(res, 400, { error: 'Choose a valid appointment time.' });
        }

        const oldSlot = token.slot;
        if (input.action === 'call') {
          token.status = 'called';
          token.ahead = 0;
          token.wait = 0;
          token.counter = input.counter || token.counter || 'Counter';
        } else if (input.action === 'complete') {
          token.status = 'completed';
        } else if (input.action === 'skip') {
          token.status = 'skipped';
        } else if (input.action === 'cancel') {
          token.status = 'cancelled';
        } else if (input.action === 'reschedule') {
          token.slot = input.slot || token.slot;
        } else if (input.action === 'serve') {
          token.status = 'serving';
          token.ahead = 0;
          token.wait = 0;
        } else if (input.action === 'checkin') {
          token.checkedIn = true;
        } else {
          return send(res, 400, { error: 'Unsupported action.' });
        }

        db.audit.unshift({
          id: `a-${Date.now()}`,
          actor,
          action: `${input.action[0].toUpperCase()}${input.action.slice(1)} token`,
          token: token.number,
          reason: input.reason || 'Updated from queue management',
          time: stamp()
        });

        const title = input.action === 'reschedule' ? 'Your appointment was rescheduled' : `Token ${token.number} updated`;
        db.notifications.unshift({
          id: `n-${Date.now()}`,
          title,
          text: input.action === 'reschedule' ? `${oldSlot} → ${token.slot}. ${input.reason || ''}` : `${token.service} · ${token.status}`,
          time: 'Just now',
          unread: true
        });

        if (['call', 'serve', 'complete', 'skip'].includes(input.action)) {
          const queue = db.tokens
            .filter(t => t.officeId === token.officeId && t.status === 'waiting')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          queue.forEach((t, i) => {
            t.ahead = i + 1;
            t.wait = 10 + i * 3;
            t.etaAt = Date.now() + t.wait * 60000;
          });
        }

        scheduleSave();
        broadcast('update', { db, lastAction: input.action, token });
        return send(res, 200, token);
      }

      if (req.method === 'POST' && url.pathname === '/api/notifications/read') {
        db.notifications.forEach(n => n.unread = false);
        scheduleSave();
        broadcast('update', { db, lastAction: 'read-notifications' });
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: 'API route not found.' });
    }

    // Static File Serving with in-memory caching
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(ROOT, `.${requested}`);

    if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'index.html')) {
      return send(res, 403, 'Forbidden', 'text/plain');
    }

    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return send(res, 404, 'Not found', 'text/plain');
    }

    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8'
    }[path.extname(target)] || 'application/octet-stream';

    // In-memory cache for static files
    let cached = staticCache.get(target);
    const stat = fs.statSync(target);
    if (!cached || cached.mtime !== stat.mtimeMs) {
      cached = {
        buffer: fs.readFileSync(target),
        mtime: stat.mtimeMs
      };
      staticCache.set(target, cached);
    }

    const cacheHeader = target.endsWith('.html') ? 'no-cache' : 'public, max-age=300';
    send(res, 200, cached.buffer, mime, { 'Cache-Control': cacheHeader });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

async function handler(req, res) {
  try {
    await databaseReady;
    server.emit('request', req, res);
  } catch (error) {
    console.error('Request could not connect to MongoDB:', error.message);
    if (!res.headersSent) send(res, 503, { error: 'The database is unavailable. Please try again shortly.' });
    else res.end();
  }
}

if (require.main === module) {
  databaseReady.then(() => {
    server.listen(PORT, () => console.log(`Tap Token is running at http://localhost:${PORT}`));
  }).catch(() => process.exitCode = 1);
}

module.exports = handler;

