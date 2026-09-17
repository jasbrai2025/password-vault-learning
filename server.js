require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database setup ----------
// A simple JSON-file store instead of a native SQL database, so this project
// runs on any computer with Node.js installed — no compiler/Python needed.
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    return { nextUserId: 1, nextItemId: 1, users: [], vaultItems: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- Crypto helpers ----------
// Derives a per-user encryption key from their master password + a stored salt.
// The key travels inside the signed JWT (not the raw password), so the server
// never needs to store the master password itself.
function deriveKey(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, 32);
}

function encrypt(plainText, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

function decrypt(payload, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return plain.toString('utf8');
}

// ---------- Auth middleware ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.encKey = payload.key; // hex-encoded per-user encryption key
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// ---------- Auth routes ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username required; password must be at least 8 characters' });
  }
  const data = loadDB();
  const existing = data.users.find((u) => u.username === username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const passwordHash = bcrypt.hashSync(password, 12);
  const keySalt = crypto.randomBytes(16).toString('hex');
  const userId = data.nextUserId++;

  data.users.push({ id: userId, username, passwordHash, keySalt });
  saveDB(data);

  const key = deriveKey(password, keySalt).toString('hex');
  const token = jwt.sign({ userId, key }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = loadDB();
  const user = data.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const key = deriveKey(password, user.keySalt).toString('hex');
  const token = jwt.sign({ userId: user.id, key }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username });
});

// ---------- Vault routes (all require login) ----------
app.get('/api/vault', authMiddleware, (req, res) => {
  const data = loadDB();
  const rows = data.vaultItems
    .filter((row) => row.userId === req.userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    siteUsername: row.siteUsername,
    url: row.url,
    password: decrypt(row.encPassword, req.encKey),
    notes: row.encNotes ? decrypt(row.encNotes, req.encKey) : '',
    updatedAt: row.updatedAt,
  }));
  res.json(items);
});

app.post('/api/vault', authMiddleware, (req, res) => {
  const { title, siteUsername, url, password, notes } = req.body;
  if (!title || !password) return res.status(400).json({ error: 'Title and password are required' });

  const encPassword = encrypt(password, req.encKey);
  const encNotes = notes ? encrypt(notes, req.encKey) : null;

  const data = loadDB();
  const id = data.nextItemId++;
  const now = new Date().toISOString();
  data.vaultItems.push({
    id,
    userId: req.userId,
    title,
    siteUsername: siteUsername || '',
    url: url || '',
    encPassword,
    encNotes,
    createdAt: now,
    updatedAt: now,
  });
  saveDB(data);

  res.json({ id });
});

app.put('/api/vault/:id', authMiddleware, (req, res) => {
  const data = loadDB();
  const itemId = Number(req.params.id);
  const item = data.vaultItems.find((row) => row.id === itemId && row.userId === req.userId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const { title, siteUsername, url, password, notes } = req.body;
  item.title = title || item.title;
  item.siteUsername = siteUsername ?? item.siteUsername;
  item.url = url ?? item.url;
  if (password) item.encPassword = encrypt(password, req.encKey);
  if (notes) item.encNotes = encrypt(notes, req.encKey);
  item.updatedAt = new Date().toISOString();

  saveDB(data);
  res.json({ success: true });
});

app.delete('/api/vault/:id', authMiddleware, (req, res) => {
  const data = loadDB();
  const itemId = Number(req.params.id);
  data.vaultItems = data.vaultItems.filter((row) => !(row.id === itemId && row.userId === req.userId));
  saveDB(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Password vault server running on http://localhost:${PORT}`);
});
