/* ==========================================================
   utils.js — Shared helpers: DOM, formatting, validation,
   toasts, modals, confirm dialog and theme switching.
   ========================================================== */

/* ---------- DOM shortcuts ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Escape user text before putting it into innerHTML (prevents XSS) */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/* ---------- Formatting ---------- */
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => localDateStr(new Date());
const initials = (name = '') => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr > 1 ? 's' : ''} ago`;
  const day = Math.floor(hr / 24);
  return day === 1 ? 'yesterday' : `${day} days ago`;
}

/* ---------- Validation ----------
   Each rule returns true (valid) or an error message string. */
const Validate = {
  required: (v) => String(v ?? '').trim() !== '' || 'This field is required',
  name:     (v) => /^[A-Za-z][A-Za-z .'-]{1,39}$/.test(v.trim()) || 'Enter a valid name (2–40 letters)',
  email:    (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Enter a valid email address',
  phone:    (v) => /^[6-9]\d{9}$/.test(v.trim()) || 'Enter a valid 10-digit mobile number',
  password: (v) => v.length >= 6 || 'Password must be at least 6 characters'
};

function setFieldError(field, msg) {
  if (!field) return;
  field.classList.toggle('invalid', !!msg);
  let el = field.querySelector('.error');
  if (!el) {
    el = document.createElement('small');
    el.className = 'error';
    field.appendChild(el);
  }
  el.textContent = msg || '';
}

/* rules = { fieldName: [ruleFn, ruleFn, ...] } */
function validateForm(form, rules) {
  let ok = true;
  for (const [name, fns] of Object.entries(rules)) {
    const input = form.elements[name];
    if (!input) continue;
    const value = input.type === 'checkbox' ? input.checked : input.value;
    let msg = '';
    for (const fn of fns) {
      const r = fn(value, form);
      if (r !== true) { msg = r; break; }
    }
    setFieldError(input.closest('.field'), msg);
    if (msg) ok = false;
  }
  if (!ok) {
    const first = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
    if (first) first.focus();
  }
  return ok;
}

/* Clear a field's error as soon as the user edits it */
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('.field.invalid');
  if (f) setFieldError(f, '');
});

/* ---------- Toast notifications ---------- */
function toast(msg, type = 'success') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    document.body.appendChild(box);
  }
  const iconName = { success: 'check', error: 'alert', info: 'info' }[type] || 'info';
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', 'status');
  t.innerHTML = `<span class="toast-icon">${icon(iconName, 16)}</span><span>${esc(msg)}</span>`;
  box.appendChild(t);
  setTimeout(() => {
    t.classList.add('hide');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

/* ---------- Modal ---------- */
let modalOnClose = null;

function openModal({ title, body, footer = '', size = '', onClose = null }) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'modal';
  wrap.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) closeModal();
  });
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  modalOnClose = onClose;
  requestAnimationFrame(() => wrap.classList.add('show'));
  const first = wrap.querySelector('.modal-body input:not([disabled]), .modal-body select, .modal-body textarea');
  if (first) setTimeout(() => first.focus(), 80);
  return wrap;
}

function closeModal() {
  const m = $('#modal');
  if (!m) return;
  m.remove();
  document.body.classList.remove('no-scroll');
  const cb = modalOnClose;
  modalOnClose = null;
  if (cb) cb();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* Promise-based confirm dialog: await confirmDialog('Delete?') */
function confirmDialog(message, { title = 'Are you sure?', okText = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title,
      size: 'sm',
      body: `<div class="confirm-body"><span class="confirm-icon ${danger ? 'danger' : ''}">${icon(danger ? 'alert' : 'info', 22)}</span><p>${esc(message)}</p></div>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOk">${esc(okText)}</button>`,
      onClose: () => { if (!answered) resolve(false); }
    });
    m.querySelector('#confirmOk').addEventListener('click', () => {
      answered = true;
      closeModal();
      resolve(true);
    });
  });
}

/* ---------- Theme (light / dark) ---------- */
const Theme = {
  KEY: 'rom_theme',
  init() {
    let t = null;
    try { t = localStorage.getItem(this.KEY); } catch (e) { /* storage blocked */ }
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
  },
  toggle() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(this.KEY, t); } catch (e) { /* ignore */ }
    return t;
  }
};

/* Replace <span data-icon="name"></span> placeholders with SVG icons */
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 18); });
}
