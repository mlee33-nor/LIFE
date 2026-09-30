// Dashboard password. The server requires it (READ_API_KEY) for all data;
// once entered it's remembered on this device in localStorage.

const STORAGE = 'soma-api-key';
const API_BASE = window.SOMA_API_BASE ?? '';

export function getKey() {
  try { return window.SOMA_API_KEY ?? localStorage.getItem(STORAGE) ?? ''; } catch { return ''; }
}

export function lockDevice() {
  try { localStorage.removeItem(STORAGE); } catch { /* storage blocked */ }
  location.reload();
}

// Full-screen unlock form. Shown when the server answers 401.
export function showLock() {
  if (document.getElementById('lock-screen')) return;
  const hadKey = Boolean(getKey());
  const el = document.createElement('div');
  el.id = 'lock-screen';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lock-title');
  el.innerHTML = `
    <form class="lock-card" id="lock-form" autocomplete="on">
      <div class="lock-mark" aria-hidden="true">✦</div>
      <h1 id="lock-title">Soma is locked</h1>
      <p>${hadKey ? 'That password no longer works. Enter the current one.' : 'Enter your dashboard password to see your data.'}</p>
      <label for="lock-password" class="sr-only">Password</label>
      <input id="lock-password" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
      <button type="submit">Unlock</button>
      <p class="lock-error" id="lock-error" role="alert"></p>
      <small>Remembered on this device only.</small>
    </form>`;
  document.body.appendChild(el);
  document.body.classList.add('is-locked');
  const input = el.querySelector('#lock-password');
  input.focus();

  el.querySelector('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = input.value.trim();
    const error = el.querySelector('#lock-error');
    error.textContent = '';
    try {
      const res = await fetch(`${API_BASE}/api/schema`, { headers: { Authorization: `Bearer ${key}` } });
      if (res.status === 401) { error.textContent = 'Wrong password.'; input.select(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try { localStorage.setItem(STORAGE, key); } catch { /* storage blocked */ }
      location.reload();
    } catch {
      error.textContent = 'Could not reach the server. Try again.';
    }
  });
}
