// "Today's to-dos": the day's task list from GET /api/todos, written by
// INSTINCT (sheet rows with category "todo", or entries on its log form).
// Unfinished tasks from earlier days are carried over below.

const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = window.SOMA_API_KEY ?? (() => { try { return localStorage.getItem('soma-api-key') ?? ''; } catch { return ''; } })();
const state = { date: null };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const niceDate = (iso, opts = { weekday: 'long', month: 'short', day: 'numeric' }) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
const shift = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export async function loadTodos() {
  const el = document.getElementById('todo-card');
  if (!el) return;
  let data = null;
  try {
    const q = state.date ? `?date=${state.date}` : '';
    const res = await fetch(`${API_BASE}/api/todos${q}`, { headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {} });
    if (res.ok) data = await res.json();
  } catch { /* offline: show the empty state */ }
  if (data) state.date = data.date;
  state.canEdit = Boolean(data?.can_edit);
  render(el, data);
}

// Tick boxes only work with the dashboard password (the server checks it).
const canEdit = () => state.canEdit; // decided by the server (see loadTodos)

async function send(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

function item(t, extra = '') {
  const icon = t.status === 'done' ? '✓' : t.status === 'skipped' ? '–' : '';
  const check = canEdit()
    ? `<button type="button" class="todo-check" data-todo="${esc(t.id)}" data-next="${t.status === 'done' ? 'open' : 'done'}" aria-label="${t.status === 'done' ? 'Mark not done' : 'Mark done'}: ${esc(t.text)}">${icon}</button>`
    : `<span class="todo-check" aria-hidden="true">${icon}</span>`;
  return `<li class="todo-item ${t.status} ${t.priority === 'high' ? 'high' : ''}">
    ${check}
    <span class="todo-text"><strong>${esc(t.text)}</strong>${t.notes ? `<small>${esc(t.notes)}</small>` : ''}${extra}</span>
    ${t.priority === 'high' ? '<span class="todo-flag">Priority</span>' : ''}
    <span class="sr-only">${t.status === 'done' ? 'done' : t.status === 'skipped' ? 'skipped' : 'to do'}</span>
  </li>`;
}

function render(el, data) {
  const date = data?.date ?? state.date;
  const todos = data?.todos ?? [];
  const carried = data?.carried_over ?? [];
  const pct = data?.total ? Math.round((data.done / data.total) * 100) : 0;
  const isToday = date === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });

  el.innerHTML = `
    <div class="todo-head">
      <div><p class="eyebrow">${isToday ? 'Today' : 'Day'} · ${esc(date ? niceDate(date) : '')}</p><h2>To-dos</h2></div>
      <div class="todo-nav">
        <button type="button" data-shift="-1" aria-label="Previous day">←</button>
        <button type="button" data-shift="1" aria-label="Next day">→</button>
      </div>
    </div>
    ${data?.total ? `<div class="todo-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Tasks done"><span style="width:${pct}%"></span></div><p class="todo-count">${data.done} of ${data.total} done</p>` : ''}
    ${todos.length
      ? `<ul class="todo-list">${todos.map((t) => item(t)).join('')}</ul>`
      : `<p class="todo-empty">No to-dos for this day yet. Text INSTINCT something like “add to my to-dos: finish calculus” and it shows up here.</p>`}
    ${canEdit() ? `<form class="todo-add" id="todo-add"><label for="todo-new" class="sr-only">New to-do</label><input id="todo-new" type="text" placeholder="Add a to-do for ${isToday ? 'today' : 'this day'}…" maxlength="200" required><select id="todo-priority" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><button type="submit">Add</button></form><p class="todo-error" id="todo-error" role="alert"></p>` : ''}
    ${carried.length ? `<details class="todo-carried" ${todos.length ? '' : 'open'}><summary>${carried.length} unfinished from earlier days</summary><ul class="todo-list">${carried.map((t) => item(t, `<small>from ${esc(niceDate(t.from, { month: 'short', day: 'numeric' }))}</small>`)).join('')}</ul></details>` : ''}`;

  const fail = (err) => { const p = el.querySelector('#todo-error'); if (p) p.textContent = `Couldn't save: ${err.message}`; };
  el.querySelectorAll('[data-todo]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await send(`/api/todos/${encodeURIComponent(btn.dataset.todo)}`, { status: btn.dataset.next }); loadTodos(); }
    catch (err) { btn.disabled = false; fail(err); }
  }));
  el.querySelector('#todo-add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#todo-new');
    try {
      await send('/api/todos', { text: input.value, priority: el.querySelector('#todo-priority').value, date });
      loadTodos();
    } catch (err) { fail(err); }
  });

  el.querySelectorAll('[data-shift]').forEach((btn) => btn.addEventListener('click', () => {
    state.date = shift(date, Number(btn.dataset.shift));
    loadTodos();
  }));
}
