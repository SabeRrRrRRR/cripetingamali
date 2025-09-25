// Simple frontend that talks to the backend and shows token->USD conversions.
// Replace BACKEND with your deployed backend URL or use http://localhost:3000 for local testing.
const BACKEND = window.BACKEND_URL || 'http://cripetingamali.onrender.com';

let currentRate = null; // USD per token
async function loadRate() {
  try {
    const res = await fetch(BACKEND + '/api/rate');
    if (res.ok) {
      const data = await res.json();
      currentRate = data.usd;
      document.getElementById('rate_info').textContent = `1 ${data.token_id} ≈ $${currentRate} USD (cached_at: ${new Date(data.cached_at).toLocaleTimeString()})`;
      document.getElementById('me_usd').textContent = currentRate ? '0.00' : 'N/A';
      const adm = await fetch(BACKEND + '/api/admin/min_withdrawal', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') || '' } });
      if (adm.ok) {
        const j = await adm.json();
        document.getElementById('min_withdrawal').textContent = j.min_withdrawal_usd;
      }
    } else {
      document.getElementById('rate_info').textContent = 'Rate unavailable';
    }
  } catch (e) {
    document.getElementById('rate_info').textContent = 'Rate fetch error';
  }
}

function setToken(token) {
  localStorage.setItem('token', token);
}
function getToken() {
  return localStorage.getItem('token');
}
function authFetch(path, opts={}) {
  opts.headers = opts.headers || {};
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  return fetch(BACKEND + path, opts);
}

// UI wiring (register/login)
document.getElementById('reg_btn').onclick = async () => {
  const username = document.getElementById('reg_user').value;
  const password = document.getElementById('reg_pass').value;
  const res = await fetch(BACKEND + '/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
  const data = await res.json();
  if (res.ok) {
    setToken(data.token);
    await loadMe();
  } else {
    alert(JSON.stringify(data));
  }
};

document.getElementById('log_btn').onclick = async () => {
  const username = document.getElementById('log_user').value;
  const password = document.getElementById('log_pass').value;
  const res = await fetch(BACKEND + '/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
  const data = await res.json();
  if (res.ok) {
    setToken(data.token);
    await loadMe();
  } else {
    alert(JSON.stringify(data));
  }
};

document.getElementById('logout_btn').onclick = () => {
  localStorage.removeItem('token');
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth').style.display = 'block';
};

async function loadMe() {
  const res = await authFetch('/api/me');
  if (!res.ok) {
    alert('Session expired or error');
    return;
  }
  const data = await res.json();
  const user = data.user;
  document.getElementById('me_user').textContent = user.username;
  document.getElementById('me_balance').textContent = user.balance;
  document.getElementById('me_status').textContent = user.frozen ? 'Frozen' : 'Active';
  document.getElementById('auth').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  if (currentRate) {
    document.getElementById('me_usd').textContent = (user.balance * currentRate).toFixed(2);
  }
  loadMyWithdraws();
  if (user.is_admin) {
    document.getElementById('admin_panel').style.display = 'block';
    await refreshUsers();
    await refreshWithdraws();
    const adm = await fetch(BACKEND + '/api/admin/min_withdrawal', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') || '' } });
    if (adm.ok) {
      const j = await adm.json();
      document.getElementById('min_withdrawal').textContent = j.min_withdrawal_usd;
    }
  } else {
    document.getElementById('admin_panel').style.display = 'none';
  }
}

// Deposit
document.getElementById('deposit_btn').onclick = async () => {
  const amount = parseInt(document.getElementById('deposit_amount').value);
  const res = await authFetch('/api/deposit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount }) });
  const data = await res.json();
  if (res.ok) {
    alert('Deposit credited');
    await loadMe();
  } else {
    alert(JSON.stringify(data));
  }
};

// Withdraw request (client-side min check using cached rate)
document.getElementById('withdraw_btn').onclick = async () => {
  const amount = parseInt(document.getElementById('withdraw_amount').value);
  const target_address = document.getElementById('withdraw_address').value;
  if (currentRate) {
    const minElem = document.getElementById('min_withdrawal').textContent;
    const minUsd = Number(minElem) || 0;
    if ((amount * currentRate) < minUsd) {
      return alert(`Withdrawal amount is below minimum USD value of $${minUsd}. Approx value: $${(amount * currentRate).toFixed(2)}`);
    }
  }
  const res = await authFetch('/api/withdraw/request', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ amount, target_address }) });
  const data = await res.json();
  if (res.ok) {
    alert('Withdrawal requested and pending approval');
    await loadMyWithdraws();
  } else {
    alert(JSON.stringify(data));
  }
};

async function loadMyWithdraws() {
  const res = await authFetch('/api/withdraws');
  if (!res.ok) return;
  const data = await res.json();
  const container = document.getElementById('my_withdraws');
  container.innerHTML = '<h4>My Withdrawals</h4>';
  data.withdrawals.forEach(w => {
    const d = document.createElement('div');
    d.textContent = `#${w.id} ${w.amount} -> ${w.target_address} [${w.status}] requested: ${w.requested_at} USD ≈ ${w.amount_usd}`;
    container.appendChild(d);
  });
}

// Admin actions (set min withdrawal, refresh users/withdraws, approve/reject)
document.getElementById('set_min_btn').onclick = async () => {
  const value = Number(document.getElementById('set_min_value').value);
  const res = await authFetch('/api/admin/min_withdrawal', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ value }) });
  const data = await res.json();
  if (res.ok) {
    alert('Min withdrawal updated');
    document.getElementById('min_withdrawal').textContent = data.min_withdrawal_usd;
  } else {
    alert(JSON.stringify(data));
  }
};

document.getElementById('refresh_users').onclick = refreshUsers;
async function refreshUsers() {
  const res = await authFetch('/api/admin/users');
  if (!res.ok) return alert('admin required');
  const data = await res.json();
  const container = document.getElementById('users_list');
  container.innerHTML = '';
  data.users.forEach(u => {
    const div = document.createElement('div');
    div.textContent = `${u.username} — balance: ${u.balance} — ${u.frozen ? 'Frozen' : 'Active'} ${u.is_admin ? '(admin)' : ''}`;
    container.appendChild(div);
  });
}

document.getElementById('freeze_btn').onclick = async () => {
  const username = document.getElementById('admin_username').value;
  const res = await authFetch('/api/admin/freeze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username }) });
  const data = await res.json();
  alert(JSON.stringify(data));
  await refreshUsers();
};
document.getElementById('unfreeze_btn').onclick = async () => {
  const username = document.getElementById('admin_username').value;
  const res = await authFetch('/api/admin/unfreeze', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username }) });
  const data = await res.json();
  alert(JSON.stringify(data));
  await refreshUsers();
};
document.getElementById('adjust_btn').onclick = async () => {
  const username = document.getElementById('adjust_username').value;
  const amount = parseInt(document.getElementById('adjust_amount').value);
  const res = await authFetch('/api/admin/adjust', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, amount }) });
  const data = await res.json();
  alert(JSON.stringify(data));
  await refreshUsers();
};

document.getElementById('transfer_btn').onclick = async () => {
  const from = document.getElementById('transfer_from').value;
  const to = document.getElementById('transfer_to').value;
  const amount = parseInt(document.getElementById('transfer_amount').value);
  const res = await authFetch('/api/admin/transfer', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ from, to, amount }) });
  const data = await res.json();
  alert(JSON.stringify(data));
  await refreshUsers();
};

// Withdraw admin flows
document.getElementById('refresh_withdraws').onclick = refreshWithdraws;
async function refreshWithdraws() {
  const res = await authFetch('/api/admin/withdraws');
  if (!res.ok) return alert('admin required');
  const data = await res.json();
  const container = document.getElementById('withdraws_list');
  container.innerHTML = '';
  data.withdrawals.forEach(w => {
    const div = document.createElement('div');
    div.innerHTML = `#${w.id} user: ${w.user} amount: ${w.amount} (USD ≈ ${w.amount_usd}) -> ${w.target_address} requested: ${w.requested_at}
      <br/>
      <button data-id="${w.id}" class="approve">Approve</button>
      <button data-id="${w.id}" class="reject">Reject</button>
    `;
    container.appendChild(div);
  });
  document.querySelectorAll('.approve').forEach(b => b.onclick = async (e) => {
    const id = parseInt(e.target.getAttribute('data-id'));
    const note = prompt('Optional note for approval');
    const external = prompt('Optional external tx id (if you broadcasted on chain)');
    const r = await authFetch('/api/admin/withdraws/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, note, external_txid: external }) });
    alert(JSON.stringify(await r.json()));
    await refreshWithdraws(); await refreshUsers();
  });
  document.querySelectorAll('.reject').forEach(b => b.onclick = async (e) => {
    const id = parseInt(e.target.getAttribute('data-id'));
    const note = prompt('Optional rejection note');
    const r = await authFetch('/api/admin/withdraws/reject', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, note }) });
    alert(JSON.stringify(await r.json()));
    await refreshWithdraws();
  });
}

// On load: fetch rate then try to restore session
(async () => {
  await loadRate();
  const token = getToken();
  if (token) {
    await loadMe();
  }
})();
