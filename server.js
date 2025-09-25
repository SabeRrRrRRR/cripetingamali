/**
 * Prototype backend with cached exchange rate (in-memory) and API key placeholder.
 *
 * Rate caching:
 * - Cached in-memory (cachedRate, lastFetch)
 * - Freshness window: CACHE_TTL_MS (default 60 seconds)
 *
 * Where to add API key in future:
 * - If you use a paid API that requires a key, set the environment variable `CRYPTO_API_KEY`
 * - Update fetchRate() to include the key in request headers or URL as required by the provider.
 *
 * File: backend/server.js
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

const TOKEN_ID = process.env.TOKEN_ID || 'tether'; // CoinGecko id for token, default 'tether' (USDT)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60 * 1000; // default 60s

// NOTE: If you later use a paid provider, put your key in CRYPTO_API_KEY env var.
// Example: process.env.CRYPTO_API_KEY
const CRYPTO_API_KEY = process.env.CRYPTO_API_KEY || null;

const COINGECKO_URL = `https://api.coingecko.com/api/v3/simple/price?ids=${TOKEN_ID}&vs_currencies=usd`;

const db = new sqlite3.Database(DB_PATH);

// Initialize DB and create default admin and settings if missing
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    balance INTEGER DEFAULT 0,
    frozen INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    target_address TEXT,
    status TEXT DEFAULT 'pending',
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    admin_id INTEGER,
    note TEXT,
    amount_usd REAL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT,
    amount INTEGER,
    meta TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // default settings: minimum withdrawal USD = 40
  db.get('SELECT value FROM settings WHERE key = ?', ['min_withdrawal_usd'], (e, r) => {
    if (!r) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['min_withdrawal_usd', '40']);
      console.log('Inserted default min_withdrawal_usd = 40');
    }
  });

  // Insert default admin if not exists
  db.get('SELECT * FROM users WHERE username = ?', ['admin'], async (err, row) => {
    if (err) {
      console.error('DB error checking admin:', err);
      return;
    }
    if (!row) {
      try {
        const hash = bcrypt.hashSync('123456', 10);
        db.run('INSERT INTO users (username, password, is_admin, balance, frozen) VALUES (?, ?, ?, ?, ?)', ['admin', hash, 1, 0, 0], function(err2) {
          if (err2) console.error('Error creating default admin:', err2);
          else console.log('Default admin created: username=admin password=123456');
        });
      } catch (e) {
        console.error('Error hashing admin password:', e);
      }
    } else {
      console.log('Default admin already exists.');
    }
  });
});

const app = express();
app.use(express.json());
app.use(cors());

// Helper: create JWT
function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '12h' });
}

// Middleware: auth
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// In-memory rate cache
let cachedRate = null; // USD per token
let lastFetch = 0;

// Fetch rate with caching
async function fetchRateCached() {
  const now = Date.now();
  if (cachedRate && (now - lastFetch) < CACHE_TTL_MS) {
    return cachedRate;
  }

  // If using CoinGecko (no API key needed)
  try {
    // If you replace this with a provider requiring an API key, include CRYPTO_API_KEY in headers here.
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) throw new Error(`rate fetch failed ${res.status}`);
    const json = await res.json();
    const rate = json[TOKEN_ID] && json[TOKEN_ID].usd ? json[TOKEN_ID].usd : null;
    if (rate === null) throw new Error('rate missing in response');

    cachedRate = rate;
    lastFetch = now;
    return rate;
  } catch (err) {
    console.error('Rate fetch error:', err.message);
    // fallback to last cached value if available
    if (cachedRate) return cachedRate;
    return null;
  }
}

// Helper: get/set setting
function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}
function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)], function(err) {
      if (err) return reject(err);
      resolve(true);
    });
  });
}

// ROUTES

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const hash = await bcrypt.hash(password, 10);
  const stmt = db.prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)');
  stmt.run(username, hash, 0, function(err) {
    if (err) {
      return res.status(400).json({ error: 'username taken or db error', details: err.message });
    }
    const user = { id: this.lastID, username, is_admin: 0 };
    const token = createToken(user);
    return res.json({ token, user: { id: user.id, username: user.username, balance: 0, frozen: 0 } });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = createToken(row);
    return res.json({ token, user: { id: row.id, username: row.username, balance: row.balance, frozen: row.frozen, is_admin: row.is_admin } });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get('SELECT id, username, balance, frozen, is_admin FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'db error or user not found' });
    res.json({ user: row });
  });
});

// Admin middleware
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'admin required' });
  next();
}

// Admin: get/set min withdrawal USD
app.get('/api/admin/min_withdrawal', auth, requireAdmin, async (req, res) => {
  try {
    const val = await getSetting('min_withdrawal_usd');
    res.json({ min_withdrawal_usd: Number(val) });
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

app.post('/api/admin/min_withdrawal', auth, requireAdmin, async (req, res) => {
  const { value } = req.body;
  if (typeof value !== 'number') return res.status(400).json({ error: 'value must be a number' });
  try {
    await setSetting('min_withdrawal_usd', value);
    res.json({ ok: true, min_withdrawal_usd: value });
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

// Endpoint to get current token->USD rate (uses cached fetch)
app.get('/api/rate', async (req, res) => {
  const rate = await fetchRateCached();
  if (rate === null) return res.status(500).json({ error: 'rate fetch failed' });
  res.json({ token_id: TOKEN_ID, usd: rate, cached_at: lastFetch });
});

// The rest of endpoints (withdrawals, deposits, admin flows) reuse previous logic
// For brevity we'll implement key endpoints similar to prior version but using fetchRateCached where needed

// List users
app.get('/api/admin/users', auth, requireAdmin, (req, res) => {
  db.all('SELECT id, username, balance, frozen, is_admin FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ users: rows });
  });
});

// Freeze/unfreeze
app.post('/api/admin/freeze', auth, requireAdmin, (req, res) => {
  const { username } = req.body;
  db.run('UPDATE users SET frozen = 1 WHERE username = ?', [username], function(err) {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ ok: true, message: 'user frozen' });
  });
});
app.post('/api/admin/unfreeze', auth, requireAdmin, (req, res) => {
  const { username } = req.body;
  db.run('UPDATE users SET frozen = 0 WHERE username = ?', [username], function(err) {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ ok: true, message: 'user unfrozen' });
  });
});

// Adjust balance
app.post('/api/admin/adjust', auth, requireAdmin, (req, res) => {
  const { username, amount } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'amount must be a number' });
  db.run('UPDATE users SET balance = balance + ? WHERE username = ?', [amount, username], function(err) {
    if (err) return res.status(500).json({ error: 'db error' });
    db.get('SELECT id FROM users WHERE username = ?', [username], (e, row) => {
      const uid = row ? row.id : null;
      db.run('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)', [uid, 'admin_adjust', amount, JSON.stringify({ by: req.user.username })]);
    });
    res.json({ ok: true, message: 'balance adjusted' });
  });
});

// Transfer between users (admin)
app.post('/api/admin/transfer', auth, requireAdmin, (req, res) => {
  const { from, to, amount } = req.body;
  if (!from || !to || typeof amount !== 'number') return res.status(400).json({ error: 'from, to, and numeric amount required' });
  if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

  db.serialize(() => {
    db.get('SELECT id, username, balance, frozen FROM users WHERE username = ?', [from], (err, fromRow) => {
      if (err || !fromRow) return res.status(400).json({ error: 'from user not found' });
      db.get('SELECT id, username, balance, frozen FROM users WHERE username = ?', [to], (err2, toRow) => {
        if (err2 || !toRow) return res.status(400).json({ error: 'to user not found' });
        if (fromRow.frozen) return res.status(403).json({ error: 'from account is frozen' });
        if (toRow.frozen) return res.status(403).json({ error: 'to account is frozen' });
        if (fromRow.balance < amount) return res.status(400).json({ error: 'insufficient funds in from account' });

        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET balance = balance - ? WHERE username = ?', [amount, from], function(e1) {
          if (e1) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'db error during debit' });
          }
          db.run('UPDATE users SET balance = balance + ? WHERE username = ?', [amount, to], function(e2) {
            if (e2) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'db error during credit' });
            }
            db.get('SELECT id FROM users WHERE username = ?', [from], (er1, r1) => {
              db.run('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)', [r1.id, 'transfer_out', -amount, JSON.stringify({ to })]);
            });
            db.get('SELECT id FROM users WHERE username = ?', [to], (er2, r2) => {
              db.run('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)', [r2.id, 'transfer_in', amount, JSON.stringify({ from })]);
            });
            db.run('COMMIT');
            return res.json({ ok: true, message: 'transfer completed' });
          });
        });
      });
    });
  });
});

// Deposit (user)
app.post('/api/deposit', auth, (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number') return res.status(400).json({ error: 'amount must be a number' });
  db.get('SELECT frozen FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'db error or user not found' });
    if (row.frozen) return res.status(403).json({ error: 'account frozen' });
    db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, req.user.id], function(err2) {
      if (err2) return res.status(500).json({ error: 'db error' });
      db.run('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)', [req.user.id, 'deposit', amount, JSON.stringify({ method: 'simulated' })]);
      res.json({ ok: true, message: 'deposit credited' });
    });
  });
});

// Withdraw request (checks min USD using cached rate)
app.post('/api/withdraw/request', auth, async (req, res) => {
  const { amount, target_address } = req.body;
  if (typeof amount !== 'number' || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  if (!target_address) return res.status(400).json({ error: 'target_address required' });

  db.get('SELECT balance, frozen FROM users WHERE id = ?', [req.user.id], async (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'db error or user not found' });
    if (row.frozen) return res.status(403).json({ error: 'account frozen' });
    if (row.balance < amount) return res.status(400).json({ error: 'insufficient funds' });

    const rate = await fetchRateCached();
    const amount_usd = rate ? (amount * rate) : null;

    let min_usd = await getSetting('min_withdrawal_usd');
    min_usd = Number(min_usd || 0);

    if (amount_usd !== null && amount_usd < min_usd) {
      return res.status(400).json({ error: 'amount below minimum withdrawal', amount_usd, min_usd });
    }

    db.run('INSERT INTO withdrawals (user_id, amount, target_address, status, amount_usd) VALUES (?, ?, ?, ?, ?)', [req.user.id, amount, target_address, 'pending', amount_usd || 0], function(err2) {
      if (err2) return res.status(500).json({ error: 'db error creating withdrawal' });
      return res.json({ ok: true, message: 'withdrawal requested and pending approval', amount_usd });
    });
  });
});

// List my withdrawals
app.get('/api/withdraws', auth, (req, res) => {
  db.all('SELECT id, amount, target_address, status, requested_at, processed_at, amount_usd, note FROM withdrawals WHERE user_id = ?', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ withdrawals: rows });
  });
});

// Admin: list pending withdrawals
app.get('/api/admin/withdraws', auth, requireAdmin, (req, res) => {
  db.all('SELECT w.id, u.username as user, w.amount, w.amount_usd, w.target_address, w.status, w.requested_at FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = ?', ['pending'], (err, rows) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ withdrawals: rows });
  });
});

// Admin approve/reject (approve debits user and logs transaction)
app.post('/api/admin/withdraws/approve', auth, requireAdmin, (req, res) => {
  const { id, note, external_txid } = req.body;
  if (!id) return res.status(400).json({ error: 'withdrawal id required' });

  db.serialize(() => {
    db.get('SELECT * FROM withdrawals WHERE id = ? AND status = ?', [id, 'pending'], (err, w) => {
      if (err || !w) return res.status(400).json({ error: 'withdrawal not found or not pending' });

      db.get('SELECT id, username, balance, frozen FROM users WHERE id = ?', [w.user_id], (err2, u) => {
        if (err2 || !u) return res.status(400).json({ error: 'user not found' });
        if (u.frozen) return res.status(403).json({ error: 'user account frozen' });
        if (u.balance < w.amount) return res.status(400).json({ error: 'insufficient funds' });

        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [w.amount, u.id], function(e1) {
          if (e1) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'db error during debit' });
          }
          db.run('UPDATE withdrawals SET status = ?, processed_at = CURRENT_TIMESTAMP, admin_id = ?, note = ?, target_address = ?, amount_usd = ? WHERE id = ?', ['approved', req.user.id, note || null, w.target_address, w.amount_usd || 0, id], function(e2) {
            if (e2) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'db error updating withdrawal' });
            }
            db.run('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)', [u.id, 'withdrawal', -w.amount, JSON.stringify({ target: w.target_address, by: req.user.username, external_txid: external_txid || null })]);
            db.run('COMMIT');
            return res.json({ ok: true, message: 'withdrawal approved and user debited' });
          });
        });
      });
    });
  });
});

app.post('/api/admin/withdraws/reject', auth, requireAdmin, (req, res) => {
  const { id, note } = req.body;
  if (!id) return res.status(400).json({ error: 'withdrawal id required' });

  db.run('UPDATE withdrawals SET status = ?, processed_at = CURRENT_TIMESTAMP, admin_id = ?, note = ? WHERE id = ? AND status = ?', ['rejected', req.user.id, note || null, id, 'pending'], function(err) {
    if (err) return res.status(500).json({ error: 'db error updating withdrawal' });
    if (this.changes === 0) return res.status(400).json({ error: 'withdrawal not found or not pending' });
    res.json({ ok: true, message: 'withdrawal rejected' });
  });
});

app.get('/', (req, res) => {
  res.send('Backend running. Use /api endpoints.');
});

app.listen(PORT, () => console.log('Server listening on', PORT));
