const API = '';
let token = localStorage.getItem('vault_token');
let username = localStorage.getItem('vault_username');
let vaultItems = [];
let editingId = null;

const $ = (sel) => document.querySelector(sel);

// ---------- Toast ----------
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------- API helper ----------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'केही गडबड भयो');
  return data;
}

// ---------- Auth screen tabs ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    $('#loginForm').classList.toggle('hidden', !isLogin);
    $('#registerForm').classList.toggle('hidden', isLogin);
  });
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    onLoggedIn(data);
    if ($('#enableBio').checked) enableBiometric(fd.get('username'), fd.get('password'));
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#registerError').textContent = '';
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
    });
    onLoggedIn(data);
  } catch (err) {
    $('#registerError').textContent = err.message;
  }
});

function onLoggedIn(data) {
  token = data.token;
  username = data.username;
  localStorage.setItem('vault_token', token);
  localStorage.setItem('vault_username', username);
  showVaultScreen();
}

$('#logoutBtn').addEventListener('click', () => {
  token = null;
  localStorage.removeItem('vault_token');
  localStorage.removeItem('vault_username');
  $('#vaultScreen').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
});

// ---------- Vault screen ----------
async function showVaultScreen() {
  $('#authScreen').classList.add('hidden');
  $('#vaultScreen').classList.remove('hidden');
  $('#whoami').textContent = username;
  await loadVault();
}

async function loadVault() {
  try {
    vaultItems = await api('/api/vault');
    renderVaultList();
  } catch (err) {
    showToast(err.message);
  }
}

function renderVaultList(filter = '') {
  const list = $('#vaultList');
  list.innerHTML = '';
  const filtered = vaultItems.filter((item) =>
    item.title.toLowerCase().includes(filter.toLowerCase()) ||
    (item.siteUsername || '').toLowerCase().includes(filter.toLowerCase())
  );

  $('#emptyState').classList.toggle('hidden', vaultItems.length > 0);

  filtered.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'vault-item';
    const openLink = item.url
      ? `<a class="icon-btn" href="${escapeHtml(normalizeUrl(item.url))}" target="_blank" rel="noopener noreferrer" data-action="open">🔗 Open</a>`
      : '';
    li.innerHTML = `
      <div class="vault-item-main">
        <div class="vault-item-title">${escapeHtml(item.title)}</div>
        <div class="vault-item-sub">${escapeHtml(item.siteUsername || '')}</div>
      </div>
      <div class="vault-item-actions">
        ${openLink}
        <button class="icon-btn" data-action="copy" data-id="${item.id}">Copy</button>
      </div>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'open') {
        e.stopPropagation();
        return; // let the link open normally in a new tab
      }
      if (e.target.dataset.action === 'copy') {
        e.stopPropagation();
        navigator.clipboard.writeText(item.password);
        showToast('Password copy भयो');
        return;
      }
      openModal(item);
    });
    list.appendChild(li);
  });
}

function normalizeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '#';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

$('#searchBox').addEventListener('input', (e) => renderVaultList(e.target.value));

// ---------- Modal ----------
function openModal(item = null) {
  editingId = item ? item.id : null;
  $('#modalTitle').textContent = item ? 'Password Edit गर्नुहोस्' : 'नयाँ Password';
  const form = $('#itemForm');
  form.reset();
  form.title.value = item ? item.title : '';
  form.siteUsername.value = item ? item.siteUsername || '' : '';
  form.password.value = item ? item.password : '';
  form.url.value = item ? item.url || '' : '';
  form.notes.value = item ? item.notes || '' : '';
  $('#itemPasswordInput').type = 'password';
  $('#togglePasswordBtn').textContent = 'देखाउनुहोस्';
  $('#deleteItemBtn').classList.toggle('hidden', !item);
  $('#itemModal').classList.remove('hidden');
}

function closeModal() {
  $('#itemModal').classList.add('hidden');
  editingId = null;
}

$('#addBtn').addEventListener('click', () => openModal());
$('#emptyAddBtn').addEventListener('click', () => openModal());
$('#cancelModalBtn').addEventListener('click', closeModal);

$('#togglePasswordBtn').addEventListener('click', () => {
  const input = $('#itemPasswordInput');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  $('#togglePasswordBtn').textContent = isHidden ? 'लुकाउनुहोस्' : 'देखाउनुहोस्';
});

$('#genPasswordBtn').addEventListener('click', () => {
  $('#itemPasswordInput').value = generatePassword();
  $('#itemPasswordInput').type = 'text';
  $('#togglePasswordBtn').textContent = 'लुकाउनुहोस्';
});

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

$('#itemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    title: fd.get('title'),
    siteUsername: fd.get('siteUsername'),
    url: fd.get('url'),
    password: fd.get('password'),
    notes: fd.get('notes'),
  };
  try {
    if (editingId) {
      await api(`/api/vault/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Update भयो');
    } else {
      await api('/api/vault', { method: 'POST', body: JSON.stringify(payload) });
      showToast('थपियो');
    }
    closeModal();
    await loadVault();
  } catch (err) {
    showToast(err.message);
  }
});

$('#deleteItemBtn').addEventListener('click', async () => {
  if (!editingId) return;
  if (!confirm('यो password मेट्ने हो?')) return;
  try {
    await api(`/api/vault/${editingId}`, { method: 'DELETE' });
    showToast('मेटियो');
    closeModal();
    await loadVault();
  } catch (err) {
    showToast(err.message);
  }
});

// ---------- Biometric (WebAuthn PRF) ----------
const BIO_KEY = 'vault_bio';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bioSupported = !!window.PublicKeyCredential;

function refreshBioUi() {
  const has = !!localStorage.getItem(BIO_KEY);
  $('#bioEnableRow').classList.toggle('hidden', !bioSupported);
  $('#bioLoginBtn').classList.toggle('hidden', !has);
  $('#bioOffBtn').classList.toggle('hidden', !has);
}

async function bioKeyFromCredential(credId, salt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = cred.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('यो device/browser ले biometric key समर्थन गर्दैन');
  return crypto.subtle.importKey('raw', out, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function enableBiometric(user, password) {
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Vault' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: user, displayName: user },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        extensions: { prf: {} },
      },
    });
    if (!cred.getClientExtensionResults().prf?.enabled) {
      throw new Error('यो device ले biometric key समर्थन गर्दैन');
    }
    const credId = new Uint8Array(cred.rawId);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const key = await bioKeyFromCredential(credId, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify({ username: user, password }))
    );
    localStorage.setItem(
      BIO_KEY,
      JSON.stringify({ credId: b64(credId), salt: b64(salt), iv: b64(iv), ct: b64(ct) })
    );
    refreshBioUi();
    showToast('Biometric खुल्यो');
  } catch (err) {
    showToast('Biometric खुलेन: ' + err.message);
  }
}

async function bioLogin() {
  $('#loginError').textContent = '';
  try {
    const s = JSON.parse(localStorage.getItem(BIO_KEY));
    const key = await bioKeyFromCredential(unb64(s.credId), unb64(s.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.ct));
    const { username: u, password } = JSON.parse(new TextDecoder().decode(plain));
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password }),
    });
    onLoggedIn(data);
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
}

$('#bioLoginBtn').addEventListener('click', bioLogin);
$('#bioOffBtn').addEventListener('click', () => {
  localStorage.removeItem(BIO_KEY);
  refreshBioUi();
  showToast('Biometric बन्द भयो');
});
$('#logoutBtn').addEventListener('click', refreshBioUi);
refreshBioUi();

// ---------- Init ----------
if (token && username) {
  showVaultScreen();
}
