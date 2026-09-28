require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET is not set.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Crypto helpers ----------
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
    req.encKey = payload.key;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

function serverError(res, err) {
  console.error(err);
  return res.status(500).json({ error: 'Server error, please try again' });
}

// ---------- Auth routes ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 8) {
      return res.status(400).json({ error: 'Username required; password must be at least 8 characters' });
    }

    const passwordHash = bcrypt.hashSync(password, 12);
    const keySalt = crypto.randomBytes(16).toString('hex');

    const { data, error } = await supabase
      .from('users')
      .insert({ username, password_hash: passwordHash, key_salt: keySalt })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Username already taken' });
      return serverError(res, error);
    }

    const key = deriveKey(password, keySalt).toString('hex');
    const token = jwt.sign({ userId: data.id, key }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username });
  } catch (err) {
    serverError(res, err);
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, password_hash, key_salt')
      .eq('username', username)
      .maybeSingle();

    if (error) return serverError(res, error);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const key = deriveKey(password, user.key_salt).toString('hex');
    const token = jwt.sign({ userId: user.id, key }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (err) {
    serverError(res, err);
  }
});

// ---------- Vault routes (all require login) ----------
app.get('/api/vault', authMiddleware, async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('vault_items')
      .select('*')
      .eq('user_id', req.userId)
      .order('updated_at', { ascending: false });

    if (error) return serverError(res, error);

    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      siteUsername: row.site_username,
      url: row.url,
      password: decrypt(row.enc_password, req.encKey),
      notes: row.enc_notes ? decrypt(row.enc_notes, req.encKey) : '',
      updatedAt: row.updated_at,
    }));
    res.json(items);
  } catch (err) {
    serverError(res, err);
  }
});

app.post('/api/vault', authMiddleware, async (req, res) => {
  try {
    const { title, siteUsername, url, password, notes } = req.body;
    if (!title || !password) return res.status(400).json({ error: 'Title and password are required' });

    const { data, error } = await supabase
      .from('vault_items')
      .insert({
        user_id: req.userId,
        title,
        site_username: siteUsername || '',
        url: url || '',
        enc_password: encrypt(password, req.encKey),
        enc_notes: notes ? encrypt(notes, req.encKey) : null,
      })
      .select('id')
      .single();

    if (error) return serverError(res, error);
    res.json({ id: data.id });
  } catch (err) {
    serverError(res, err);
  }
});

app.put('/api/vault/:id', authMiddleware, async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { data: item, error: findError } = await supabase
      .from('vault_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', req.userId)
      .maybeSingle();

    if (findError) return serverError(res, findError);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { title, siteUsername, url, password, notes } = req.body;
    const updates = {
      title: title || item.title,
      site_username: siteUsername ?? item.site_username,
      url: url ?? item.url,
      updated_at: new Date().toISOString(),
    };
    if (password) updates.enc_password = encrypt(password, req.encKey);
    if (notes) updates.enc_notes = encrypt(notes, req.encKey);

    const { error } = await supabase
      .from('vault_items')
      .update(updates)
      .eq('id', itemId)
      .eq('user_id', req.userId);

    if (error) return serverError(res, error);
    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
});

app.delete('/api/vault/:id', authMiddleware, async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    const { error } = await supabase
      .from('vault_items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', req.userId);

    if (error) return serverError(res, error);
    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`Password vault server running on port ${PORT}`);
});
