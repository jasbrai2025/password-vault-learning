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
    li.innerHTML = `
      <div class="vault-item-main">
        <div class="vault-item-title">${escapeHtml(item.title)}</div>
        <div class="vault-item-sub">${escapeHtml(item.siteUsername || '')}</div>
      </div>
      <div class="vault-item-actions">
        <button class="icon-btn" data-action="copy" data-id="${item.id}">Copy</button>
      </div>
    `;
    li.addEventListener('click', (e) => {
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

// ---------- Init ----------
if (token && username) {
  showVaultScreen();
}
