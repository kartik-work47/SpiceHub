/* ==========================================================
   app.js — Portal controller for app.html
   - Hash-based router (#dashboard, #menu, #orders ...)
   - Role-based navigation and permissions
   - Views: Dashboard, Menu, Orders, Bookings, Users, Reports, Profile
   - Cart drawer + order placement workflow
   ========================================================== */
(async function () {
  await DB.init();
  let me = Auth.guard();
  if (!me) return;

  const view = $('#view');
  const ORDER_FLOW = DB.ORDER_FLOW;
  const ORDER_TYPES = ['Dine-in', 'Takeaway', 'Delivery'];
  const CATEGORY_HUE = { 'Starters': 24, 'Main Course': 40, 'Pizza': 8, 'Desserts': 330, 'Beverages': 190 };
  const STATUS_COLOR = {
    Pending: 'var(--warning)', Confirmed: 'var(--info)', Preparing: 'var(--purple)',
    Ready: 'var(--teal)', Completed: 'var(--success)', Cancelled: 'var(--danger)'
  };

  const isAdmin = () => me.role === 'admin';
  const isStaff = () => me.role === 'admin' || me.role === 'staff';   // admin has all staff powers
  const isActive = (status) => !['Completed', 'Cancelled'].includes(status);
  const nextStatus = (s) => { const i = ORDER_FLOW.indexOf(s); return i > -1 && i < ORDER_FLOW.length - 1 ? ORDER_FLOW[i + 1] : null; };
  const badge = (status) => `<span class="badge s-${status.toLowerCase()}">${esc(status)}</span>`;
  const avatarColor = (name) => 'c' + ([...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 4);

  /* ---------- Route table (role-based access control) ---------- */
  const ALL = ['admin', 'staff', 'customer'];
  const ROUTES = {
    dashboard: { label: 'Dashboard', icon: 'grid', roles: ALL, render: renderDashboard },
    menu:      { label: 'Menu', icon: 'utensils', roles: ALL, render: renderMenu },
    orders:    { label: 'Orders', icon: 'receipt', roles: ALL, render: renderOrders },
    bookings:  { label: 'Table Bookings', icon: 'calendar', roles: ALL, render: renderBookings },
    users:     { label: 'Users', icon: 'users', roles: ['admin'], render: renderUsers },
    reports:   { label: 'Reports', icon: 'chart', roles: ['admin'], render: renderReports },
    profile:   { label: 'My Profile', icon: 'user', roles: ALL, render: renderProfile }
  };
  const SUBTITLES = {
    dashboard: { admin: 'Overview of today’s restaurant operations', staff: 'Track and move orders through the kitchen', customer: 'Your orders and bookings at a glance' },
    menu:      { admin: 'Add, edit and manage dishes and availability', staff: 'Check availability or take walk-in orders', customer: 'Pick your favourites and add them to your order' },
    orders:    { admin: 'Search, filter and update every order', staff: 'Search, filter and update order status', customer: 'Track the status of your orders' },
    bookings:  { admin: 'Approve and manage table reservations', staff: 'Approve and manage table reservations', customer: 'Reserve a table and manage your bookings' },
    users:     { admin: 'Manage customers, staff and their roles' },
    reports:   { admin: 'Sales performance and business insights' },
    profile:   { admin: 'Your account details', staff: 'Your account details', customer: 'Your account details' }
  };

  /* Filter/search state per view (kept while navigating) */
  const state = {
    menu:     { q: '', cat: 'All', diet: 'all' },
    orders:   { q: '', status: 'All', type: 'All', sort: 'new' },
    bookings: { q: '', status: 'All', date: '' },
    users:    { q: '', role: 'All' },
    reports:  { range: 7 }
  };
  let currentRoute = 'dashboard';

  /* ======================================================
     SHELL: sidebar, topbar, theme, router
     ====================================================== */
  function renderShell() {
    $('#nav').innerHTML = Object.entries(ROUTES)
      .filter(([, r]) => r.roles.includes(me.role))
      .map(([key, r]) => `
        <a href="#${key}" class="nav-link" data-route="${key}">
          ${icon(r.icon)}<span>${key === 'orders' && me.role === 'customer' ? 'My Orders' : r.label}</span>
          ${key === 'orders' && isStaff() ? '<span class="nav-badge" id="navPending"></span>' : ''}
          ${key === 'bookings' && isStaff() ? '<span class="nav-badge" id="navBookings"></span>' : ''}
        </a>`).join('');

    $('#sideUser').innerHTML = `
      <div class="avatar ${avatarColor(me.name)}">${initials(me.name)}</div>
      <div class="su-info"><strong>${esc(me.name)}</strong><span class="role-tag role-${me.role}">${me.role}</span></div>
      <button class="icon-btn" id="logoutBtn" title="Log out" aria-label="Log out">${icon('logout')}</button>`;
    $('#logoutBtn').addEventListener('click', async () => {
      if (await confirmDialog('You will be signed out of the portal.', { title: 'Log out?', okText: 'Log out' })) Auth.logout();
    });

    const top = $('#topAvatar');
    top.textContent = initials(me.name);
    top.className = `avatar ${avatarColor(me.name)}`;
    $('#cartBtn').hidden = isAdmin();          // admins manage, they don't place orders
    updateBadges();
  }

  function updateBadges() {
    const pend = $('#navPending');
    if (pend) { const n = DB.orders.where((o) => o.status === 'Pending').length; pend.textContent = n || ''; }
    const bk = $('#navBookings');
    if (bk) { const n = DB.bookings.where((b) => b.status === 'Pending').length; bk.textContent = n || ''; }
    const cc = $('#cartCount');
    const n = Cart.count();
    cc.textContent = n || '';
    cc.dataset.n = n;
  }

  function paintThemeBtn() {
    $('#themeBtn').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  }

  function navigate() {
    let key = location.hash.slice(1) || 'dashboard';
    if (!ROUTES[key] || !ROUTES[key].roles.includes(me.role)) {
      if (ROUTES[key]) toast('You do not have permission to open that page', 'error');
      key = 'dashboard';
      history.replaceState(null, '', '#dashboard');
    }
    currentRoute = key;
    $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
    const label = key === 'orders' && me.role === 'customer' ? 'My Orders' : ROUTES[key].label;
    $('#pageTitle').textContent = label;
    $('#pageSubtitle').textContent = (SUBTITLES[key] || {})[me.role] || '';
    document.title = `${label} · SpiceHub`;
    closeSidebar();
    view.classList.remove('enter');
    void view.offsetWidth;                 // restart the CSS animation
    view.classList.add('enter');
    ROUTES[key].render(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Re-render the current page without the page transition */
  function refresh() {
    ROUTES[currentRoute].render(view);
    updateBadges();
    if ($('#cartDrawer').classList.contains('open')) renderCart();
  }

  function openSidebar() { $('#sidebar').classList.add('open'); $('#overlay').classList.add('show'); }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#overlay').classList.remove('show'); }

  /* ======================================================
     SHARED UI PIECES
     ====================================================== */
  const statCard = (ic, label, value, sub, color) => `
    <div class="stat-card c-${color}">
      <div class="stat-icon">${icon(ic, 22)}</div>
      <div><p class="stat-label">${label}</p><h3 class="stat-value">${value}</h3><p class="stat-sub">${sub}</p></div>
    </div>`;

  const emptyState = (ic, title, text, action = '') => `
    <div class="empty"><div class="empty-icon">${icon(ic, 28)}</div><h4>${title}</h4><p>${text}</p>${action}</div>`;

  const itemsSummary = (o) => o.items.map((i) => `${i.name} ×${i.qty}`).join(', ');

  function tracker(status) {
    if (status === 'Cancelled') return `<div class="tracker-cancelled">${icon('x', 16)} This order was cancelled</div>`;
    const idx = ORDER_FLOW.indexOf(status);
    return `<div class="tracker">${ORDER_FLOW.map((s, i) => `
      <div class="step ${i < idx || status === 'Completed' ? 'done' : ''} ${i === idx && status !== 'Completed' ? 'current' : ''}">
        <span class="dot">${i < idx || status === 'Completed' ? icon('check', 13) : i + 1}</span>
        <span class="lbl">${s}</span>
      </div>`).join('')}</div>`;
  }

  /* Wire a search box so typing updates state and redraws only the list (keeps focus) */
  function bindInput(sel, obj, key, redraw, evt = 'input') {
    const el = $(sel);
    if (!el) return;
    el.addEventListener(evt, () => { obj[key] = el.value; redraw(); });
  }

  /* ======================================================
     CART (customers & staff)
     ====================================================== */
  const CART_KEY = 'rom_cart_' + me.id;
  const Cart = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } },
    save(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateBadges(); },
    add(id, n = 1) {
      const c = this.get();
      c[id] = Math.min(20, (c[id] || 0) + n);
      if (c[id] <= 0) delete c[id];
      this.save(c);
    },
    clear() { this.save({}); },
    lines() {
      return Object.entries(this.get()).map(([id, qty]) => {
        const m = DB.menu.find(id);
        return m && m.available ? { menuId: id, name: m.name, price: m.price, qty, emoji: m.emoji } : null;
      }).filter(Boolean);
    },
    count() { return this.lines().reduce((s, l) => s + l.qty, 0); }
  };

  function bumpCart() {
    const b = $('#cartCount');
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  }

  function openCart() {
    renderCart();
    $('#cartDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('show');
  }
  function closeCart() {
    $('#cartDrawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('show');
  }

  /* Remember what the user typed in the cart form between re-renders */
  const DRAFT_KEY = 'rom_draft_' + me.id;
  const cartDraft = { type: 'Dine-in', table: '', address: '', notes: '', customerName: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(cartDraft)) {
        if (typeof saved[key] === 'string') cartDraft[key] = saved[key];
      }
      if (!ORDER_TYPES.includes(cartDraft.type)) cartDraft.type = 'Dine-in';
    }
  } catch (e) { /* Ignore invalid draft data. */ }
  const saveDraft = () => localStorage.setItem(DRAFT_KEY, JSON.stringify(cartDraft));

  function renderCart() {
    const body = $('#cartBody');
    const lines = Cart.lines();
    if (!lines.length) {
      body.innerHTML = emptyState('cart', 'Your order is empty', 'Add some delicious dishes from the menu to get started.',
        `<button class="btn btn-primary" data-action="go" data-to="menu">${icon('utensils', 16)} Browse Menu</button>`);
      return;
    }
    const t = DB.calcTotals(lines);
    body.innerHTML = `
      ${lines.map((l) => `
        <div class="cart-line">
          <span class="emoji">${esc(l.emoji)}</span>
          <div class="info"><strong>${esc(l.name)}</strong><small>${money(l.price)} each</small></div>
          <div class="stepper">
            <button data-action="cart-dec" data-id="${l.menuId}" aria-label="Decrease">${icon('minus', 14)}</button>
            <span>${l.qty}</span>
            <button data-action="cart-inc" data-id="${l.menuId}" aria-label="Increase">${icon('plus', 14)}</button>
          </div>
        </div>`).join('')}

      <form id="cartForm" class="cart-form" novalidate>
        ${isStaff() ? `
        <div class="field"><label>Customer name *</label>
          <input name="customerName" placeholder="Walk-in customer name" value="${esc(cartDraft.customerName)}" maxlength="40"></div>` : ''}
        <div class="field"><label>Order type</label>
          <div class="segmented">
            ${ORDER_TYPES.map((tp) => `<label><input type="radio" name="type" value="${tp}" ${cartDraft.type === tp ? 'checked' : ''}><span>${tp}</span></label>`).join('')}
          </div>
        </div>
        <div class="field" id="tableField" ${cartDraft.type !== 'Dine-in' ? 'hidden' : ''}><label>Table number *</label>
          <input name="table" type="number" min="1" max="30" placeholder="1 – 30" value="${esc(cartDraft.table)}"></div>
        <div class="field" id="addressField" ${cartDraft.type !== 'Delivery' ? 'hidden' : ''}><label>Delivery address *</label>
          <textarea name="address" rows="2" placeholder="House no, street, area, city" maxlength="200">${esc(cartDraft.address)}</textarea></div>
        <div class="field"><label>Special instructions</label>
          <textarea name="notes" rows="2" placeholder="e.g. Less spicy, no onions" maxlength="150">${esc(cartDraft.notes)}</textarea></div>

        <div class="totals">
          <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div><span>GST (5%)</span><span>${money(t.tax)}</span></div>
          <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top:18px">
          ${icon('check', 18)} Place Order · ${money(t.total)}
        </button>
        <button type="button" class="btn btn-ghost btn-block" style="margin-top:8px" data-action="cart-clear">Clear order</button>
      </form>`;

    const form = $('#cartForm');
    const syncDraft = () => {
      cartDraft.type = form.type.value;
      cartDraft.table = form.table.value;
      cartDraft.address = form.address.value;
      cartDraft.notes = form.notes.value;
      if (form.customerName) cartDraft.customerName = form.customerName.value;
      saveDraft();
      $('#tableField').hidden = cartDraft.type !== 'Dine-in';
      $('#addressField').hidden = cartDraft.type !== 'Delivery';
    };
    form.addEventListener('input', syncDraft);
    form.addEventListener('change', syncDraft);
    form.addEventListener('submit', (e) => { e.preventDefault(); placeOrder(form); });
  }

  function placeOrder(form) {
    const lines = Cart.lines();
    if (!lines.length) return toast('Your order is empty', 'error');
    const type = form.type.value;
    const rules = {};
    if (isStaff()) rules.customerName = [Validate.required, Validate.name];
    if (type === 'Dine-in') rules.table = [Validate.required, (v) => (Number.isInteger(+v) && +v >= 1 && +v <= 30) || 'Table number must be between 1 and 30'];
    if (type === 'Delivery') rules.address = [Validate.required, (v) => v.trim().length >= 10 || 'Please enter a complete address (min 10 characters)'];
    if (!validateForm(form, rules)) return;

    const order = DB.createOrder({
      items: lines.map(({ menuId, name, price, qty }) => ({ menuId, name, price, qty })),
      customerId: isStaff() ? null : me.id,
      customerName: isStaff() ? form.customerName.value.trim() : me.name,
      type,
      table: type === 'Dine-in' ? form.table.value : '',
      address: type === 'Delivery' ? form.address.value.trim() : '',
      notes: form.notes.value.trim(),
      by: me.name
    });
    Cart.clear();
    Object.assign(cartDraft, { table: '', address: '', notes: '', customerName: '' });
    localStorage.removeItem(DRAFT_KEY);
    closeCart();
    toast(`Order ${order.code} placed successfully! 🎉`);
    if (currentRoute === 'orders') refresh(); else location.hash = '#orders';
  }

  /* ======================================================
     ORDER ACTIONS (status workflow)
     ====================================================== */
  function setOrderStatus(id, status) {
    const o = DB.orders.find(id);
    if (!o || o.status === status) return;
    DB.orders.update(id, {
      status,
      history: [...(o.history || []), { status, at: new Date().toISOString(), by: me.name }]
    });
    toast(`${o.code} → ${status}`, status === 'Cancelled' ? 'info' : 'success');
    refresh();
  }

  const canCancelOrder = (o) => (isStaff() ? isActive(o.status) : o.status === 'Pending' && o.customerId === me.id);

  function orderModal(id) {
    const o = DB.orders.find(id);
    if (!o) return;
    const where = o.type === 'Dine-in' ? `Table ${esc(o.table)}` : o.type === 'Delivery' ? esc(o.address) : 'Pickup at counter';
    const next = nextStatus(o.status);
    openModal({
      title: `Order ${o.code}`,
      size: 'lg',
      body: `
        <div class="row-between" style="margin:0 0 16px">${badge(o.status)}<span class="muted small">${fmtDateTime(o.createdAt)}</span></div>
        ${tracker(o.status)}
        <div class="detail-grid" style="margin-top:20px">
          <div><span>Customer</span><strong>${esc(o.customerName)}</strong></div>
          <div><span>Order type</span><strong>${esc(o.type)}</strong></div>
          <div><span>${o.type === 'Delivery' ? 'Deliver to' : 'Location'}</span><strong>${where}</strong></div>
          <div><span>Items</span><strong>${o.items.reduce((s, i) => s + i.qty, 0)} item(s)</strong></div>
        </div>
        ${o.notes ? `<div class="note-box">📝 ${esc(o.notes)}</div>` : ''}
        <h4 class="section-title">Items</h4>
        <table class="line-items">
          ${o.items.map((i) => `<tr><td class="qty">${i.qty}×</td><td>${esc(i.name)}</td><td>${money(i.price * i.qty)}</td></tr>`).join('')}
        </table>
        <div class="totals">
          <div><span>Subtotal</span><span>${money(o.subtotal)}</span></div>
          <div><span>GST (5%)</span><span>${money(o.tax)}</span></div>
          <div class="grand"><span>Total</span><span>${money(o.total)}</span></div>
        </div>
        <h4 class="section-title">Status history</h4>
        <ul class="timeline">
          ${(o.history || []).map((h) => `<li style="--b:${STATUS_COLOR[h.status]}"><strong>${h.status}</strong><small>${fmtDateTime(h.at)} · by ${esc(h.by || 'System')}</small></li>`).join('')}
        </ul>
        ${isStaff() && isActive(o.status) ? `
        <div class="status-update">
          <select class="select" id="statusSelect">
            ${[...ORDER_FLOW, 'Cancelled'].map((s) => `<option ${s === (next || o.status) ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="statusSave">${icon('refresh', 16)} Update status</button>
        </div>` : ''}`,
      footer: `
        ${canCancelOrder(o) ? `<button class="btn btn-ghost left" data-action="cancel-order" data-id="${o.id}">${icon('x', 16)} Cancel order</button>` : ''}
        <button class="btn btn-outline" onclick="window.print()">${icon('printer', 16)} Print</button>
        <button class="btn btn-primary" data-close>Done</button>`
    });
    const save = $('#statusSave');
    if (save) save.addEventListener('click', () => { const s = $('#statusSelect').value; closeModal(); setOrderStatus(o.id, s); });
  }

  /* ======================================================
     VIEW: DASHBOARD
     ====================================================== */
  function renderDashboard(el) {
    if (me.role === 'customer') return renderCustomerDashboard(el);

    const orders = DB.orders.all();
    const today = todayStr();
    const todays = orders.filter((o) => localDateStr(new Date(o.createdAt)) === today);
    const revenue = todays.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0);
    const active = orders.filter((o) => isActive(o.status)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const bookings = DB.bookings.all();
    const todaysBookings = bookings.filter((b) => b.date === today && b.status !== 'Cancelled');
    const upcoming = bookings.filter((b) => b.date >= today && ['Pending', 'Confirmed'].includes(b.status))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 5);
    const recent = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);

    el.innerHTML = `
      <div class="stats-grid">
        ${statCard('receipt', 'Today’s Orders', todays.length, `${active.length} active right now`, 'orange')}
        ${statCard('rupee', 'Today’s Revenue', money(revenue), 'Excluding cancelled orders', 'green')}
        ${statCard('clock', 'Pending Orders', orders.filter((o) => o.status === 'Pending').length, 'Waiting for confirmation', 'amber')}
        ${statCard('calendar', 'Bookings Today', todaysBookings.length, `${bookings.filter((b) => b.status === 'Pending').length} awaiting approval`, 'blue')}
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>Live Order Board</h3><p class="muted">Move each order to the next stage with one click</p></div>
          <a href="#orders" class="btn btn-ghost btn-sm">View all orders ${icon('arrowRight', 15)}</a>
        </div>
        <div class="board">
          ${ORDER_FLOW.slice(0, 4).map((s) => {
            const list = active.filter((o) => o.status === s);
            return `
            <div class="board-col" style="--b:${STATUS_COLOR[s]}">
              <h4><span class="dot"></span>${s}<span class="n">${list.length}</span></h4>
              <div class="board-list">
                ${list.length ? list.map((o) => `
                  <div class="ticket" style="--b:${STATUS_COLOR[s]}">
                    <div class="ticket-top"><span class="code">${o.code}</span><span class="tag">${o.type}${o.table ? ' · T' + esc(o.table) : ''}</span></div>
                    <p>${esc(o.customerName)} — ${esc(itemsSummary(o))}</p>
                    <div class="ticket-foot">
                      <small>${timeAgo(o.createdAt)} · ${money(o.total)}</small>
                      <div class="row-actions">
                        <button class="icon-btn sm" title="Details" data-action="view-order" data-id="${o.id}">${icon('eye', 15)}</button>
                        <button class="btn btn-soft btn-sm" data-action="advance-order" data-id="${o.id}">${nextStatus(s)} ${icon('arrowRight', 13)}</button>
                      </div>
                    </div>
                  </div>`).join('') : '<div class="board-empty">No orders here</div>'}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="grid-2">
        <div class="card p0">
          <div class="card-head" style="padding:20px 22px 0"><h3>Recent Orders</h3><a href="#orders" class="link-sm">See all</a></div>
          <div class="table-wrap">${ordersTable(recent, true)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Upcoming Bookings</h3><a href="#bookings" class="link-sm">Manage</a></div>
          <div class="list">
            ${upcoming.length ? upcoming.map(bookingListItem).join('') : emptyState('calendar', 'No upcoming bookings', 'New reservations will appear here.')}
          </div>
        </div>
      </div>`;
  }

  function bookingListItem(b) {
    const d = new Date(b.date + 'T00:00');
    return `
      <div class="list-item">
        <div class="date-chip"><b>${d.getDate()}</b><small>${d.toLocaleString('en-IN', { month: 'short' })}</small></div>
        <div class="grow"><strong>${esc(b.name)} · ${b.guests} guest${b.guests > 1 ? 's' : ''}</strong>
          <small>${fmtTime12(b.time)} · ${esc(b.occasion || 'Casual')}</small></div>
        ${badge(b.status)}
      </div>`;
  }

  function renderCustomerDashboard(el) {
    const mine = DB.orders.where((o) => o.customerId === me.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const active = mine.filter((o) => isActive(o.status));
    const spent = mine.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + o.total, 0);
    const today = todayStr();
    const myBookings = DB.bookings.where((b) => b.customerId === me.id && b.date >= today && ['Pending', 'Confirmed'].includes(b.status))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    // Popular dishes = most ordered across all orders
    const sold = {};
    DB.orders.all().forEach((o) => o.items.forEach((i) => { sold[i.menuId] = (sold[i.menuId] || 0) + i.qty; }));
    const popular = DB.menu.where((m) => m.available).sort((a, b) => (sold[b.id] || 0) - (sold[a.id] || 0)).slice(0, 4);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    el.innerHTML = `
      <div class="welcome">
        <div style="position:relative">
          <h2>${greet}, ${esc(me.name.split(' ')[0])}! 👋</h2>
          <p>Hungry? Order your favourites for dine-in, takeaway or delivery, or reserve a table for later.</p>
          <div class="actions">
            <a href="#menu" class="btn btn-white">${icon('utensils', 16)} Order Food</a>
            <button class="btn btn-glass" data-action="new-booking">${icon('calendar', 16)} Book a Table</button>
          </div>
        </div>
        <div class="welcome-emoji">🍜</div>
      </div>

      <div class="stats-grid">
        ${statCard('receipt', 'Total Orders', mine.length, 'All time', 'orange')}
        ${statCard('clock', 'Active Orders', active.length, active.length ? 'Being prepared now' : 'Nothing cooking', 'purple')}
        ${statCard('calendar', 'Upcoming Bookings', myBookings.length, myBookings[0] ? `Next: ${fmtDate(myBookings[0].date)}` : 'No reservations', 'blue')}
        ${statCard('rupee', 'Total Spent', money(spent), 'Thank you for dining with us', 'green')}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head"><div><h3>Track Your Orders</h3><p class="muted">Live status of your active orders</p></div><a href="#orders" class="link-sm">Order history</a></div>
          ${active.length ? active.map((o) => `
            <div class="active-order">
              <div class="active-order-head">
                <div><span class="code">${o.code}</span> <span class="muted small">· ${timeAgo(o.createdAt)} · ${o.type}</span></div>
                <div class="row-actions"><strong>${money(o.total)}</strong>
                  <button class="icon-btn sm" data-action="view-order" data-id="${o.id}" title="Details">${icon('eye', 15)}</button></div>
              </div>
              ${tracker(o.status)}
              <p class="muted small" style="margin-top:10px">${esc(itemsSummary(o))}</p>
            </div>`).join('')
          : emptyState('receipt', 'No active orders', 'Place an order and track it live right here.', `<a href="#menu" class="btn btn-primary">${icon('utensils', 16)} Browse Menu</a>`)}
        </div>
        <div class="card">
          <div class="card-head"><h3>My Upcoming Bookings</h3><a href="#bookings" class="link-sm">View all</a></div>
          <div class="list">${myBookings.length ? myBookings.slice(0, 4).map(bookingListItem).join('') : emptyState('calendar', 'No bookings yet', 'Reserve a table in under a minute.')}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Popular Right Now 🔥</h3><p class="muted">Our most-ordered dishes</p></div><a href="#menu" class="link-sm">Full menu</a></div>
        <div class="menu-grid">${popular.map(menuCard).join('')}</div>
      </div>`;
  }

  /* ======================================================
     VIEW: MENU (admin = CRUD, staff = availability + walk-in, customer = order)
     ====================================================== */
  function renderMenu(el) {
    const s = state.menu;
    el.innerHTML = `
      <div class="toolbar">
        <div class="search">${icon('search')}<input id="menuSearch" type="search" placeholder="Search dishes..." value="${esc(s.q)}" aria-label="Search menu"></div>
        <select class="select" id="menuDiet" aria-label="Diet filter">
          <option value="all">All types</option><option value="veg">Veg only</option><option value="nonveg">Non-veg only</option>
        </select>
        <span class="spacer"></span>
        <span class="result-count" id="menuCount"></span>
        ${isAdmin() ? `<button class="btn btn-primary" data-action="add-item">${icon('plus', 16)} Add Item</button>` : ''}
      </div>
      <div class="chips" id="menuChips">
        ${['All', ...DB.CATEGORIES].map((c) => `<button class="chip ${s.cat === c ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
      <div class="menu-grid" id="menuGrid"></div>`;

    $('#menuDiet').value = s.diet;
    bindInput('#menuSearch', s, 'q', drawMenuGrid);
    bindInput('#menuDiet', s, 'diet', drawMenuGrid, 'change');
    $('#menuChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      s.cat = chip.dataset.cat;
      $$('.chip', $('#menuChips')).forEach((c) => c.classList.toggle('active', c === chip));
      drawMenuGrid();
    });
    drawMenuGrid();
  }

  function drawMenuGrid() {
    const s = state.menu;
    const q = s.q.trim().toLowerCase();
    const items = DB.menu.all().filter((m) =>
      (s.cat === 'All' || m.category === s.cat) &&
      (s.diet === 'all' || (s.diet === 'veg' ? m.veg : !m.veg)) &&
      (!q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)));
    $('#menuCount').textContent = `${items.length} dish${items.length === 1 ? '' : 'es'}`;
    $('#menuGrid').innerHTML = items.length
      ? items.map((m, i) => menuCard(m, i)).join('')
      : emptyState('search', 'No dishes found', 'Try a different search term or category.');
  }

  function menuCard(m, i = 0) {
    const qty = Cart.get()[m.id] || 0;
    let actions = '';
    if (isAdmin()) {
      actions = `
        <div class="grp">
          <label class="switch" title="${m.available ? 'Available' : 'Unavailable'}"><input type="checkbox" data-change="toggle-avail" data-id="${m.id}" ${m.available ? 'checked' : ''}><span></span></label>
          <button class="icon-btn sm info" title="Edit" data-action="edit-item" data-id="${m.id}">${icon('edit', 16)}</button>
          <button class="icon-btn sm danger" title="Delete" data-action="delete-item" data-id="${m.id}">${icon('trash', 16)}</button>
        </div>`;
    } else {
      const toggle = me.role === 'staff'
        ? `<label class="switch" title="Toggle availability"><input type="checkbox" data-change="toggle-avail" data-id="${m.id}" ${m.available ? 'checked' : ''}><span></span></label>` : '';
      const order = !m.available
        ? `<button class="btn btn-ghost btn-sm" disabled>Unavailable</button>`
        : qty
          ? `<div class="stepper">
               <button data-action="cart-dec" data-id="${m.id}" aria-label="Decrease">${icon('minus', 14)}</button><span>${qty}</span>
               <button data-action="cart-inc" data-id="${m.id}" aria-label="Increase">${icon('plus', 14)}</button></div>`
          : `<button class="btn btn-soft btn-sm" data-action="cart-inc" data-id="${m.id}">${icon('plus', 15)} Add</button>`;
      actions = `<div class="grp">${toggle}${order}</div>`;
    }
    return `
      <article class="menu-card" style="animation-delay:${Math.min(i, 12) * 35}ms">
        <div class="menu-thumb" style="--hue:${CATEGORY_HUE[m.category] ?? 24}">
          <span class="diet ${m.veg ? 'veg' : 'nonveg'}" title="${m.veg ? 'Veg' : 'Non-veg'}"></span>
          <span class="emoji">${esc(m.emoji)}</span>
          ${qty && m.available && !isAdmin() ? `<span class="in-cart">${qty} in order</span>` : ''}
          ${!m.available ? '<span class="sold">Sold out</span>' : ''}
        </div>
        <div class="menu-info">
          <div class="menu-top"><h4>${esc(m.name)}</h4><span class="price">${money(m.price)}</span></div>
          <p class="muted desc">${esc(m.description || 'Freshly prepared by our chefs.')}</p>
          <div class="menu-actions"><span class="tag">${esc(m.category)}</span>${actions}</div>
        </div>
      </article>`;
  }

  function menuForm(id) {
    const m = id ? DB.menu.find(id) : { name: '', category: DB.CATEGORIES[0], price: '', emoji: '🍽️', description: '', veg: true, available: true };
    if (!m) return;
    openModal({
      title: id ? 'Edit Menu Item' : 'Add Menu Item',
      body: `
        <form id="itemForm" novalidate>
          <div class="form-grid">
            <div class="field span-2"><label>Item name *</label><input name="name" value="${esc(m.name)}" maxlength="40" placeholder="e.g. Paneer Butter Masala"></div>
            <div class="field"><label>Category *</label>
              <select name="category">${DB.CATEGORIES.map((c) => `<option ${c === m.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            <div class="field"><label>Price (₹) *</label><input name="price" type="number" min="1" max="10000" step="1" value="${m.price}" placeholder="e.g. 249"></div>
            <div class="field"><label>Icon (emoji)</label><input name="emoji" value="${esc(m.emoji)}" maxlength="4"><span class="hint">Shown on the menu card</span></div>
            <div class="field"><label>Type</label>
              <select name="veg"><option value="1" ${m.veg ? 'selected' : ''}>Veg</option><option value="0" ${!m.veg ? 'selected' : ''}>Non-veg</option></select></div>
            <div class="field span-2"><label>Description</label><textarea name="description" rows="3" maxlength="150" placeholder="Short description (max 150 characters)">${esc(m.description)}</textarea></div>
            <label class="check span-2"><input type="checkbox" name="available" ${m.available ? 'checked' : ''}> Available for ordering</label>
          </div>
        </form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn btn-primary" type="submit" form="itemForm">${icon('check', 16)} ${id ? 'Save Changes' : 'Add Item'}</button>`
    });
    const form = $('#itemForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = validateForm(form, {
        name: [Validate.required,
          (v) => v.trim().length >= 2 || 'Name must be at least 2 characters',
          (v) => !DB.menu.all().some((x) => x.id !== id && x.name.toLowerCase() === v.trim().toLowerCase()) || 'A dish with this name already exists'],
        price: [Validate.required, (v) => (+v >= 1 && +v <= 10000) || 'Price must be between ₹1 and ₹10,000']
      });
      if (!ok) return;
      const data = {
        name: form.name.value.trim(),
        category: form.category.value,
        price: Math.round(+form.price.value),
        emoji: form.emoji.value.trim() || '🍽️',
        description: form.description.value.trim(),
        veg: form.veg.value === '1',
        available: form.available.checked
      };
      if (id) DB.menu.update(id, data); else DB.menu.insert(data);
      closeModal();
      toast(id ? `"${data.name}" updated` : `"${data.name}" added to the menu`);
      refresh();
    });
  }

  /* ======================================================
     VIEW: ORDERS
     ====================================================== */
  const scopedOrders = () => (me.role === 'customer' ? DB.orders.where((o) => o.customerId === me.id) : DB.orders.all());

  function renderOrders(el) {
    const s = state.orders;
    el.innerHTML = `
      <div class="chips" id="orderTabs"></div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input id="orderSearch" type="search" placeholder="${isStaff() ? 'Search order ID, customer or dish...' : 'Search order ID or dish...'}" value="${esc(s.q)}" aria-label="Search orders"></div>
        <select class="select" id="orderType" aria-label="Order type">
          <option value="All">All types</option>${ORDER_TYPES.map((t) => `<option>${t}</option>`).join('')}
        </select>
        <select class="select" id="orderSort" aria-label="Sort">
          <option value="new">Newest first</option><option value="old">Oldest first</option>
          <option value="high">Amount: high → low</option><option value="low">Amount: low → high</option>
        </select>
        <span class="spacer"></span>
        ${!isAdmin() ? `<a href="#menu" class="btn btn-primary">${icon('plus', 16)} New Order</a>` : ''}
      </div>
      <div class="card p0"><div class="table-wrap" id="orderTable"></div></div>`;

    $('#orderType').value = s.type;
    $('#orderSort').value = s.sort;
    bindInput('#orderSearch', s, 'q', drawOrders);
    bindInput('#orderType', s, 'type', drawOrders, 'change');
    bindInput('#orderSort', s, 'sort', drawOrders, 'change');
    $('#orderTabs').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      s.status = chip.dataset.status;
      drawOrders();
    });
    drawOrders();
  }

  function drawOrders() {
    const s = state.orders;
    const all = scopedOrders();
    const statuses = ['All', ...ORDER_FLOW, 'Cancelled'];
    $('#orderTabs').innerHTML = statuses.map((st) => {
      const n = st === 'All' ? all.length : all.filter((o) => o.status === st).length;
      return `<button class="chip ${s.status === st ? 'active' : ''}" data-status="${st}">${st}<span class="n">${n}</span></button>`;
    }).join('');

    const q = s.q.trim().toLowerCase();
    let list = all.filter((o) =>
      (s.status === 'All' || o.status === s.status) &&
      (s.type === 'All' || o.type === s.type) &&
      (!q || o.code.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) ||
        o.items.some((i) => i.name.toLowerCase().includes(q))));
    const sorters = {
      new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      old: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      high: (a, b) => b.total - a.total,
      low: (a, b) => a.total - b.total
    };
    list = list.sort(sorters[s.sort]);

    $('#orderTable').innerHTML = list.length
      ? ordersTable(list)
      : emptyState('inbox', 'No orders found', all.length ? 'Try changing the filters or search term.' : 'Orders you place will show up here.',
        !all.length && !isAdmin() ? `<a href="#menu" class="btn btn-primary">${icon('utensils', 16)} Browse Menu</a>` : '');
  }

  function ordersTable(list, compact = false) {
    if (!list.length) return emptyState('inbox', 'No orders yet', 'New orders will appear here.');
    return `
      <table class="table">
        <thead><tr>
          <th>Order</th>${isStaff() ? '<th>Customer</th>' : ''}${compact ? '' : '<th>Items</th><th>Type</th>'}
          <th>Total</th><th>Status</th>${compact ? '' : '<th>Placed</th>'}<th style="text-align:right">Actions</th>
        </tr></thead>
        <tbody>
          ${list.map((o, i) => `
            <tr class="row-in" style="animation-delay:${Math.min(i, 15) * 25}ms">
              <td class="td-main"><span class="code">${o.code}</span></td>
              ${isStaff() ? `<td data-label="Customer"><div class="cell-user"><div class="avatar ${avatarColor(o.customerName)}">${initials(o.customerName)}</div><strong>${esc(o.customerName)}</strong></div></td>` : ''}
              ${compact ? '' : `<td data-label="Items"><div class="items-preview" title="${esc(itemsSummary(o))}">${esc(itemsSummary(o))}</div></td>
              <td data-label="Type"><span class="tag">${o.type}</span></td>`}
              <td data-label="Total"><strong>${money(o.total)}</strong></td>
              <td data-label="Status">${badge(o.status)}</td>
              ${compact ? '' : `<td data-label="Placed" class="nowrap muted small">${fmtDateTime(o.createdAt)}</td>`}
              <td data-label="Actions">${orderActions(o, compact)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function orderActions(o, compact) {
    let h = `<button class="icon-btn sm" title="View details" data-action="view-order" data-id="${o.id}">${icon('eye', 16)}</button>`;
    if (isStaff() && isActive(o.status) && !compact) {
      h += `<button class="btn btn-soft btn-sm" data-action="advance-order" data-id="${o.id}" title="Move to next stage">${nextStatus(o.status)} ${icon('arrowRight', 13)}</button>`;
    }
    if (canCancelOrder(o) && !compact) h += `<button class="icon-btn sm danger" title="Cancel order" data-action="cancel-order" data-id="${o.id}">${icon('x', 16)}</button>`;
    if (me.role === 'customer' && !isActive(o.status) && !compact) h += `<button class="icon-btn sm info" title="Order again" data-action="reorder" data-id="${o.id}">${icon('repeat', 16)}</button>`;
    if (isAdmin() && !compact) h += `<button class="icon-btn sm danger" title="Delete record" data-action="delete-order" data-id="${o.id}">${icon('trash', 16)}</button>`;
    return `<div class="row-actions">${h}</div>`;
  }

  /* ======================================================
     VIEW: BOOKINGS
     ====================================================== */
  const scopedBookings = () => (me.role === 'customer' ? DB.bookings.where((b) => b.customerId === me.id) : DB.bookings.all());

  function renderBookings(el) {
    const s = state.bookings;
    el.innerHTML = `
      <div class="chips" id="bookingTabs"></div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input id="bookingSearch" type="search" placeholder="Search booking ID, name or phone..." value="${esc(s.q)}" aria-label="Search bookings"></div>
        <input type="date" class="select" id="bookingDate" value="${s.date}" aria-label="Filter by date">
        <button class="btn btn-ghost" id="clearDate" ${s.date ? '' : 'hidden'}>${icon('x', 15)} Clear date</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" data-action="new-booking">${icon('plus', 16)} New Booking</button>
      </div>
      <div class="card p0"><div class="table-wrap" id="bookingTable"></div></div>`;

    bindInput('#bookingSearch', s, 'q', drawBookings);
    $('#bookingDate').addEventListener('change', (e) => { s.date = e.target.value; $('#clearDate').hidden = !s.date; drawBookings(); });
    $('#clearDate').addEventListener('click', () => { s.date = ''; $('#bookingDate').value = ''; $('#clearDate').hidden = true; drawBookings(); });
    $('#bookingTabs').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) { s.status = chip.dataset.status; drawBookings(); }
    });
    drawBookings();
  }

  function drawBookings() {
    const s = state.bookings;
    const all = scopedBookings();
    $('#bookingTabs').innerHTML = ['All', ...DB.BOOKING_STATUSES].map((st) => {
      const n = st === 'All' ? all.length : all.filter((b) => b.status === st).length;
      return `<button class="chip ${s.status === st ? 'active' : ''}" data-status="${st}">${st}<span class="n">${n}</span></button>`;
    }).join('');

    const q = s.q.trim().toLowerCase();
    const list = all.filter((b) =>
      (s.status === 'All' || b.status === s.status) &&
      (!s.date || b.date === s.date) &&
      (!q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || b.phone.includes(q)))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

    $('#bookingTable').innerHTML = list.length ? `
      <table class="table">
        <thead><tr><th>Booking</th><th>Guest</th><th>Date &amp; time</th><th>Guests</th><th>Occasion</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${list.map((b, i) => `
            <tr class="row-in" style="animation-delay:${Math.min(i, 15) * 25}ms">
              <td class="td-main"><span class="code">${b.code}</span></td>
              <td data-label="Guest"><div class="cell-user"><div class="avatar ${avatarColor(b.name)}">${initials(b.name)}</div><div><strong>${esc(b.name)}</strong><small>${esc(b.phone)}</small></div></div></td>
              <td data-label="Date & time" class="nowrap"><strong>${fmtDate(b.date + 'T00:00')}</strong><br><small class="muted">${fmtTime12(b.time)}</small></td>
              <td data-label="Guests">${b.guests}</td>
              <td data-label="Occasion"><span class="tag">${esc(b.occasion || 'Casual')}</span></td>
              <td data-label="Status">${badge(b.status)}</td>
              <td data-label="Actions">${bookingActions(b)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
      : emptyState('calendar', 'No bookings found', all.length ? 'Try changing the filters.' : 'Reserve your first table now.',
        `<button class="btn btn-primary" data-action="new-booking">${icon('plus', 16)} New Booking</button>`);
  }

  function bookingActions(b) {
    let h = '';
    const open = ['Pending', 'Confirmed'].includes(b.status);
    if (isStaff()) {
      if (b.status === 'Pending') h += `<button class="btn btn-soft btn-sm" data-action="booking-status" data-status="Confirmed" data-id="${b.id}">${icon('check', 14)} Confirm</button>`;
      if (b.status === 'Confirmed') h += `<button class="btn btn-soft btn-sm" data-action="booking-status" data-status="Completed" data-id="${b.id}">${icon('check', 14)} Complete</button>`;
    }
    if (open && (isStaff() || b.status === 'Pending')) h += `<button class="icon-btn sm info" title="Edit" data-action="edit-booking" data-id="${b.id}">${icon('edit', 16)}</button>`;
    if (open) h += `<button class="icon-btn sm danger" title="Cancel booking" data-action="booking-status" data-status="Cancelled" data-id="${b.id}">${icon('x', 16)}</button>`;
    if (isAdmin()) h += `<button class="icon-btn sm danger" title="Delete record" data-action="delete-booking" data-id="${b.id}">${icon('trash', 16)}</button>`;
    return `<div class="row-actions">${h || '<span class="muted small">—</span>'}</div>`;
  }

  function bookingForm(id) {
    const b = id ? DB.bookings.find(id) : {
      name: me.role === 'customer' ? me.name : '', phone: me.role === 'customer' ? me.phone : '',
      date: todayStr(), time: '19:00', guests: 2, occasion: 'Casual', notes: ''
    };
    if (!b) return;
    const maxDate = localDateStr(new Date(Date.now() + 60 * 864e5));
    openModal({
      title: id ? `Edit Booking ${b.code}` : 'Reserve a Table',
      body: `
        <form id="bookingForm" novalidate>
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" value="${esc(b.name)}" maxlength="40"></div>
            <div class="field"><label>Mobile *</label><input name="phone" value="${esc(b.phone)}" maxlength="10" inputmode="numeric"></div>
            <div class="field"><label>Date *</label><input name="date" type="date" min="${todayStr()}" max="${maxDate}" value="${b.date}"></div>
            <div class="field"><label>Time *</label><input name="time" type="time" min="11:00" max="23:00" step="900" value="${b.time}"><span class="hint">Open 11:00 AM – 11:00 PM</span></div>
            <div class="field"><label>Guests *</label><input name="guests" type="number" min="1" max="20" value="${b.guests}"></div>
            <div class="field"><label>Occasion</label>
              <select name="occasion">${['Casual', 'Birthday', 'Anniversary', 'Business', 'Family', 'Other'].map((o) => `<option ${o === b.occasion ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field span-2"><label>Special requests</label><textarea name="notes" rows="2" maxlength="150" placeholder="e.g. Window seat, high chair">${esc(b.notes)}</textarea></div>
          </div>
        </form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn btn-primary" type="submit" form="bookingForm">${icon('check', 16)} ${id ? 'Save Changes' : 'Request Booking'}</button>`
    });

    const form = $('#bookingForm');
    form.phone.addEventListener('input', () => { form.phone.value = form.phone.value.replace(/\D/g, '').slice(0, 10); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const SLOT_CAPACITY = 40; // max guests the restaurant can seat per time slot
      const ok = validateForm(form, {
        name: [Validate.required, Validate.name],
        phone: [Validate.required, Validate.phone],
        date: [Validate.required,
          (v) => v >= todayStr() || 'Booking date cannot be in the past',
          (v) => v <= maxDate || 'Bookings can be made up to 60 days in advance'],
        time: [Validate.required,
          (v) => (v >= '11:00' && v <= '23:00') || 'We are open from 11:00 AM to 11:00 PM',
          (v, f) => f.date.value !== todayStr() || v > new Date().toTimeString().slice(0, 5) || 'This time has already passed today'],
        guests: [Validate.required,
          (v) => (Number.isInteger(+v) && +v >= 1 && +v <= 20) || 'Guests must be between 1 and 20',
          (v, f) => {
            const booked = DB.bookings.where((x) => x.id !== id && x.date === f.date.value && x.time === f.time.value && x.status !== 'Cancelled')
              .reduce((s, x) => s + x.guests, 0);
            return booked + +v <= SLOT_CAPACITY || `Only ${Math.max(0, SLOT_CAPACITY - booked)} seats left at this time. Try another slot.`;
          }]
      });
      if (!ok) return;
      const data = {
        name: form.name.value.trim(), phone: form.phone.value.trim(), date: form.date.value, time: form.time.value,
        guests: +form.guests.value, occasion: form.occasion.value, notes: form.notes.value.trim()
      };
      if (id) {
        DB.bookings.update(id, data);
        toast(`Booking ${b.code} updated`);
      } else {
        const rec = DB.bookings.insert({ ...data, code: DB.nextCode('booking'), customerId: me.role === 'customer' ? me.id : null, status: isStaff() ? 'Confirmed' : 'Pending' });
        toast(isStaff() ? `Booking ${rec.code} created & confirmed` : `Booking ${rec.code} requested! We'll confirm shortly.`);
      }
      closeModal();
      if (currentRoute === 'bookings') refresh(); else location.hash = '#bookings';
    });
  }

  /* ======================================================
     VIEW: USERS (admin only)
     ====================================================== */
  function renderUsers(el) {
    const s = state.users;
    const all = DB.users.all();
    const count = (r) => all.filter((u) => u.role === r).length;
    el.innerHTML = `
      <div class="stats-grid">
        ${statCard('users', 'Total Users', all.length, `${all.filter((u) => u.active).length} active`, 'purple')}
        ${statCard('shield', 'Admins', count('admin'), 'Full access', 'orange')}
        ${statCard('utensils', 'Staff', count('staff'), 'Orders & bookings', 'blue')}
        ${statCard('user', 'Customers', count('customer'), 'Registered diners', 'green')}
      </div>
      <div class="toolbar">
        <div class="search">${icon('search')}<input id="userSearch" type="search" placeholder="Search name, email or phone..." value="${esc(s.q)}" aria-label="Search users"></div>
        <select class="select" id="userRole" aria-label="Role filter">
          <option value="All">All roles</option><option value="admin">Admins</option><option value="staff">Staff</option><option value="customer">Customers</option>
        </select>
        <span class="spacer"></span>
        <button class="btn btn-primary" data-action="add-user">${icon('plus', 16)} Add User</button>
      </div>
      <div class="card p0"><div class="table-wrap" id="userTable"></div></div>`;
    $('#userRole').value = s.role;
    bindInput('#userSearch', s, 'q', drawUsers);
    bindInput('#userRole', s, 'role', drawUsers, 'change');
    drawUsers();
  }

  function drawUsers() {
    const s = state.users;
    const q = s.q.trim().toLowerCase();
    const orders = DB.orders.all();
    const list = DB.users.all().filter((u) =>
      (s.role === 'All' || u.role === s.role) &&
      (!q || u.name.toLowerCase().includes(q) || u.email.includes(q) || u.phone.includes(q)));
    $('#userTable').innerHTML = list.length ? `
      <table class="table">
        <thead><tr><th>User</th><th>Phone</th><th>Role</th><th>Orders</th><th>Joined</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody>
          ${list.map((u, i) => `
            <tr class="row-in" style="animation-delay:${Math.min(i, 15) * 25}ms">
              <td class="td-main"><div class="cell-user"><div class="avatar ${avatarColor(u.name)}">${initials(u.name)}</div>
                <div><strong>${esc(u.name)}${u.id === me.id ? ' <span class="muted small">(you)</span>' : ''}</strong><small>${esc(u.email)}</small></div></div></td>
              <td data-label="Phone">${esc(u.phone)}</td>
              <td data-label="Role"><span class="role-tag role-${u.role}">${u.role}</span></td>
              <td data-label="Orders">${orders.filter((o) => o.customerId === u.id).length}</td>
              <td data-label="Joined" class="muted small nowrap">${fmtDate(u.createdAt)}</td>
              <td data-label="Status">
                <label class="switch" title="${u.active ? 'Active' : 'Inactive'}"><input type="checkbox" data-change="toggle-user" data-id="${u.id}" ${u.active ? 'checked' : ''} ${u.id === me.id ? 'disabled' : ''}><span></span></label>
              </td>
              <td data-label="Actions"><div class="row-actions">
                <button class="icon-btn sm info" title="Edit" data-action="edit-user" data-id="${u.id}">${icon('edit', 16)}</button>
                ${u.id !== me.id ? `<button class="icon-btn sm danger" title="Delete" data-action="delete-user" data-id="${u.id}">${icon('trash', 16)}</button>` : ''}
              </div></td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('users', 'No users found', 'Try a different search or role filter.');
  }

  function userForm(id) {
    const u = id ? DB.users.find(id) : { name: '', email: '', phone: '', role: 'staff', active: true };
    if (!u) return;
    const self = id === me.id;
    openModal({
      title: id ? 'Edit User' : 'Add New User',
      body: `
        <form id="userForm" novalidate>
          <div class="form-grid">
            <div class="field span-2"><label>Full name *</label><input name="name" value="${esc(u.name)}" maxlength="40"></div>
            <div class="field"><label>Email *</label><input name="email" type="email" value="${esc(u.email)}"></div>
            <div class="field"><label>Mobile *</label><input name="phone" value="${esc(u.phone)}" maxlength="10" inputmode="numeric"></div>
            <div class="field"><label>Role *</label>
              <select name="role" ${self ? 'disabled' : ''}>${['admin', 'staff', 'customer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select>
              ${self ? '<span class="hint">You cannot change your own role</span>' : ''}</div>
            <div class="field"><label>${id ? 'New password' : 'Password *'}</label><input name="password" type="password" placeholder="${id ? 'Leave blank to keep current' : 'Min 6 characters'}"></div>
          </div>
        </form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button>
               <button class="btn btn-primary" type="submit" form="userForm">${icon('check', 16)} ${id ? 'Save Changes' : 'Create User'}</button>`
    });
    const form = $('#userForm');
    form.phone.addEventListener('input', () => { form.phone.value = form.phone.value.replace(/\D/g, '').slice(0, 10); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = validateForm(form, {
        name: [Validate.required, Validate.name],
        email: [Validate.required, Validate.email,
          (v) => !DB.users.all().some((x) => x.id !== id && x.email === v.trim().toLowerCase()) || 'Email is already in use'],
        phone: [Validate.required, Validate.phone],
        password: id ? [(v) => !v || v.length >= 6 || 'Password must be at least 6 characters'] : [Validate.required, Validate.password]
      });
      if (!ok) return;
      const data = { name: form.name.value.trim(), email: form.email.value.trim().toLowerCase(), phone: form.phone.value.trim() };
      if (!self) data.role = form.role.value;
      if (id) {
        if (form.password.value) data.password = await DB.hash(form.password.value);
        DB.users.update(id, data);
        if (self) { me = DB.users.find(me.id); renderShell(); }
        toast(`${data.name}'s details updated`);
      } else {
        await DB.createUser({ ...data, password: form.password.value });
        toast(`${data.name} added as ${data.role}`);
      }
      closeModal();
      refresh();
    });
  }

  /* ======================================================
     VIEW: REPORTS (admin only)
     ====================================================== */
  function renderReports(el) {
    const s = state.reports;
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (s.range - 1));
    const orders = DB.orders.where((o) => new Date(o.createdAt) >= start);
    const valid = orders.filter((o) => o.status !== 'Cancelled');
    const revenue = valid.reduce((a, o) => a + o.total, 0);
    const aov = valid.length ? Math.round(revenue / valid.length) : 0;
    const cancelled = orders.length - valid.length;
    const cancelRate = orders.length ? ((cancelled / orders.length) * 100).toFixed(1) : '0.0';

    // Daily revenue for the bar chart
    const days = [];
    for (let i = 0; i < s.range; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = localDateStr(d);
      days.push({
        key, d,
        v: valid.filter((o) => localDateStr(new Date(o.createdAt)) === key).reduce((a, o) => a + o.total, 0)
      });
    }
    const maxV = Math.max(...days.map((d) => d.v), 1);
    const labelEvery = s.range > 14 ? 5 : s.range > 7 ? 2 : 1;

    // Status distribution (donut)
    const statuses = [...ORDER_FLOW, 'Cancelled'];
    const counts = statuses.map((st) => orders.filter((o) => o.status === st).length);
    let acc = 0;
    const segs = statuses.map((st, i) => {
      const from = acc; acc += orders.length ? (counts[i] / orders.length) * 360 : 0;
      return `${STATUS_COLOR[st]} ${from}deg ${acc}deg`;
    }).join(', ');

    // Top items & revenue by category
    const itemAgg = {};
    const catAgg = {};
    valid.forEach((o) => o.items.forEach((it) => {
      itemAgg[it.name] = itemAgg[it.name] || { qty: 0, rev: 0 };
      itemAgg[it.name].qty += it.qty;
      itemAgg[it.name].rev += it.qty * it.price;
      const cat = (DB.menu.find(it.menuId) || {}).category || 'Other';
      catAgg[cat] = (catAgg[cat] || 0) + it.qty * it.price;
    }));
    const top = Object.entries(itemAgg).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
    const topMax = top.length ? top[0][1].qty : 1;
    const cats = Object.entries(catAgg).sort((a, b) => b[1] - a[1]);
    const catMax = cats.length ? cats[0][1] : 1;
    const catColors = ['var(--primary)', 'var(--purple)', 'var(--info)', 'var(--teal)', 'var(--warning)', 'var(--danger)'];
    const typeCounts = ORDER_TYPES.map((t) => [t, valid.filter((o) => o.type === t).length]);

    el.innerHTML = `
      <div class="toolbar">
        <div class="chips" id="rangeChips">
          ${[7, 14, 30].map((r) => `<button class="chip ${s.range === r ? 'active' : ''}" data-range="${r}">Last ${r} days</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <button class="btn btn-outline" data-action="export-csv">${icon('download', 16)} Export CSV</button>
        <button class="btn btn-outline" onclick="window.print()">${icon('printer', 16)} Print</button>
      </div>

      <div class="stats-grid">
        ${statCard('rupee', 'Revenue', money(revenue), `${valid.length} completed / active orders`, 'green')}
        ${statCard('receipt', 'Total Orders', orders.length, `Last ${s.range} days`, 'orange')}
        ${statCard('chart', 'Avg. Order Value', money(aov), 'Revenue ÷ orders', 'blue')}
        ${statCard('x', 'Cancellation Rate', cancelRate + '%', `${cancelled} cancelled`, 'red')}
      </div>

      <div class="card">
        <div class="card-head"><div><h3>Daily Revenue</h3><p class="muted">Hover a bar to see the exact amount</p></div></div>
        <div class="bar-chart">
          ${days.map((d, i) => `
            <div class="bar-col">
              <div class="bar" style="--h:${((d.v / maxV) * 100).toFixed(1)}%;animation-delay:${i * 25}ms"><span class="tip">${d.d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${money(d.v)}</span></div>
              <span class="bar-lbl">${(s.range - 1 - i) % labelEvery === 0 ? d.d.toLocaleDateString('en-IN', s.range > 7 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }) : ''}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="grid-2 even">
        <div class="card">
          <div class="card-head"><h3>Orders by Status</h3></div>
          <div class="donut-wrap">
            <div class="donut" style="background:${orders.length ? `conic-gradient(${segs})` : 'var(--surface-2)'}">
              <div class="donut-center"><div><strong>${orders.length}</strong><small>orders</small></div></div>
            </div>
            <div class="legend">
              ${statuses.map((st, i) => `<div><i style="background:${STATUS_COLOR[st]}"></i>${st}<b>${counts[i]}</b></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Top Selling Dishes</h3></div>
          <div class="hbars">
            ${top.length ? top.map(([name, v], i) => `
              <div>
                <div class="hbar-top"><span>${i + 1}. ${esc(name)}</span><span class="muted">${v.qty} sold · ${money(v.rev)}</span></div>
                <div class="hbar-track"><div class="hbar-fill" style="--w:${(v.qty / topMax) * 100}%;animation-delay:${i * 80}ms"></div></div>
              </div>`).join('') : emptyState('chart', 'No sales yet', 'Data will appear once orders come in.')}
          </div>
        </div>
      </div>

      <div class="grid-2 even">
        <div class="card">
          <div class="card-head"><h3>Revenue by Category</h3></div>
          <div class="hbars">
            ${cats.length ? cats.map(([c, v], i) => `
              <div>
                <div class="hbar-top"><span>${esc(c)}</span><span class="muted">${money(v)}</span></div>
                <div class="hbar-track"><div class="hbar-fill" style="--w:${(v / catMax) * 100}%;--c:${catColors[i % catColors.length]};animation-delay:${i * 80}ms"></div></div>
              </div>`).join('') : emptyState('chart', 'No data', '')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Order Type Split</h3></div>
          <div class="hbars">
            ${typeCounts.map(([t, n], i) => `
              <div>
                <div class="hbar-top"><span>${t}</span><span class="muted">${n} orders · ${valid.length ? Math.round((n / valid.length) * 100) : 0}%</span></div>
                <div class="hbar-track"><div class="hbar-fill" style="--w:${valid.length ? (n / valid.length) * 100 : 0}%;--c:${catColors[i + 1]};animation-delay:${i * 80}ms"></div></div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card danger-zone no-print">
        <div class="card-head" style="margin:0">
          <div><h3>Reset Demo Data</h3><p class="muted">Erase all records and restore the original sample data.</p></div>
          <button class="btn btn-danger" data-action="reset-data">${icon('refresh', 16)} Reset Data</button>
        </div>
      </div>`;

    $('#rangeChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) { s.range = +chip.dataset.range; refresh(); }
    });
  }

  function exportCSV() {
    const rows = [['Order ID', 'Date', 'Customer', 'Type', 'Items', 'Subtotal', 'GST', 'Total', 'Status']];
    DB.orders.all().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach((o) => rows.push([
      o.code, new Date(o.createdAt).toLocaleString('en-IN'), o.customerName, o.type,
      itemsSummary(o), o.subtotal, o.tax, o.total, o.status
    ]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `spicehub-orders-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${rows.length - 1} orders to CSV`);
  }

  /* ======================================================
     VIEW: PROFILE
     ====================================================== */
  function renderProfile(el) {
    const myOrders = DB.orders.where((o) => o.customerId === me.id);
    el.innerHTML = `
      <div class="profile-grid">
        <div class="card profile-card">
          <div class="avatar xl ${avatarColor(me.name)}">${initials(me.name)}</div>
          <h3>${esc(me.name)}</h3>
          <p class="muted">${esc(me.email)}</p>
          <p style="margin-top:8px"><span class="role-tag role-${me.role}">${me.role}</span></p>
          <div class="profile-meta">
            <div><span>Member since</span><strong>${fmtDate(me.createdAt)}</strong></div>
            <div><span>Mobile</span><strong>${esc(me.phone)}</strong></div>
            ${me.role === 'customer' ? `<div><span>Orders placed</span><strong>${myOrders.length}</strong></div>` : ''}
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>Personal Information</h3></div>
            <form id="profileForm" novalidate>
              <div class="form-grid">
                <div class="field span-2"><label>Full name</label><input name="name" value="${esc(me.name)}" maxlength="40"></div>
                <div class="field"><label>Email</label><input name="email" value="${esc(me.email)}" disabled><span class="hint">Email cannot be changed</span></div>
                <div class="field"><label>Mobile</label><input name="phone" value="${esc(me.phone)}" maxlength="10" inputmode="numeric"></div>
              </div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('check', 16)} Save Changes</button></div>
            </form>
          </div>
          <div class="card">
            <div class="card-head"><h3>Change Password</h3></div>
            <form id="passwordForm" novalidate>
              <div class="field"><label>Current password</label><input name="current" type="password" autocomplete="current-password"></div>
              <div class="form-grid">
                <div class="field"><label>New password</label><input name="next" type="password" autocomplete="new-password"></div>
                <div class="field"><label>Confirm new password</label><input name="confirm" type="password" autocomplete="new-password"></div>
              </div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">${icon('lock', 16)} Update Password</button></div>
            </form>
          </div>
        </div>
      </div>`;

    const pf = $('#profileForm');
    pf.phone.addEventListener('input', () => { pf.phone.value = pf.phone.value.replace(/\D/g, '').slice(0, 10); });
    pf.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validateForm(pf, { name: [Validate.required, Validate.name], phone: [Validate.required, Validate.phone] })) return;
      me = DB.users.update(me.id, { name: pf.name.value.trim(), phone: pf.phone.value.trim() });
      renderShell();
      $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === 'profile'));
      refresh();
      toast('Profile updated successfully');
    });

    const pw = $('#passwordForm');
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentHash = await DB.hash(pw.current.value);
      const ok = validateForm(pw, {
        current: [Validate.required, () => currentHash === me.password || 'Current password is incorrect'],
        next: [Validate.required, Validate.password, (v) => v !== pw.current.value || 'New password must be different'],
        confirm: [Validate.required, (v) => v === pw.next.value || 'Passwords do not match']
      });
      if (!ok) return;
      me = DB.users.update(me.id, { password: await DB.hash(pw.next.value) });
      pw.reset();
      toast('Password changed successfully');
    });
  }

  /* ======================================================
     GLOBAL EVENT DELEGATION
     Any element with data-action="..." triggers ACTIONS[...]
     ====================================================== */
  const ACTIONS = {
    'go': (_, btn) => { closeCart(); closeModal(); location.hash = '#' + btn.dataset.to; },
    'cart-inc': (id) => {
      const m = DB.menu.find(id);
      if (!m || !m.available) return toast('This item is currently unavailable', 'error');
      if ((Cart.get()[id] || 0) >= 20) return toast('Maximum 20 of one item per order', 'error');
      const first = !Cart.get()[id];
      Cart.add(id, 1);
      bumpCart();
      if (first) toast(`${m.name} added to your order`);
      refresh();
    },
    'cart-dec': (id) => { Cart.add(id, -1); refresh(); },
    'cart-clear': async () => {
      if (await confirmDialog('Remove all items from the current order?', { okText: 'Clear' })) { Cart.clear(); refresh(); renderCart(); }
    },
    'view-order': (id) => orderModal(id),
    'advance-order': (id) => { const o = DB.orders.find(id); if (o) setOrderStatus(id, nextStatus(o.status)); },
    'cancel-order': async (id) => {
      const o = DB.orders.find(id);
      if (o && await confirmDialog(`Cancel order ${o.code}? This cannot be undone.`, { title: 'Cancel order?', okText: 'Yes, cancel' })) setOrderStatus(id, 'Cancelled');
    },
    'delete-order': async (id) => {
      const o = DB.orders.find(id);
      if (o && await confirmDialog(`Permanently delete ${o.code} from records?`, { title: 'Delete order?', okText: 'Delete' })) {
        DB.orders.remove(id); toast(`${o.code} deleted`, 'info'); refresh();
      }
    },
    'reorder': (id) => {
      const o = DB.orders.find(id);
      let added = 0;
      o.items.forEach((i) => { const m = DB.menu.find(i.menuId); if (m && m.available) { Cart.add(i.menuId, i.qty); added++; } });
      if (!added) return toast('These items are no longer available', 'error');
      bumpCart();
      toast(added < o.items.length ? 'Some items are unavailable — added the rest' : 'Items added to your order');
      openCart();
    },
    'add-item': () => menuForm(null),
    'edit-item': (id) => menuForm(id),
    'delete-item': async (id) => {
      const m = DB.menu.find(id);
      if (m && await confirmDialog(`Delete "${m.name}" from the menu?`, { title: 'Delete item?', okText: 'Delete' })) {
        DB.menu.remove(id); toast(`"${m.name}" deleted`, 'info'); refresh();
      }
    },
    'new-booking': () => bookingForm(null),
    'edit-booking': (id) => bookingForm(id),
    'booking-status': async (id, btn) => {
      const b = DB.bookings.find(id);
      const status = btn.dataset.status;
      if (!b) return;
      if (status === 'Cancelled' && !(await confirmDialog(`Cancel booking ${b.code}?`, { title: 'Cancel booking?', okText: 'Yes, cancel' }))) return;
      DB.bookings.update(id, { status });
      toast(`Booking ${b.code} ${status.toLowerCase()}`, status === 'Cancelled' ? 'info' : 'success');
      refresh();
    },
    'delete-booking': async (id) => {
      const b = DB.bookings.find(id);
      if (b && await confirmDialog(`Permanently delete booking ${b.code}?`, { title: 'Delete booking?', okText: 'Delete' })) {
        DB.bookings.remove(id); toast(`Booking ${b.code} deleted`, 'info'); refresh();
      }
    },
    'add-user': () => userForm(null),
    'edit-user': (id) => userForm(id),
    'delete-user': async (id) => {
      const u = DB.users.find(id);
      if (u && await confirmDialog(`Delete ${u.name}'s account? Their order history will be kept.`, { title: 'Delete user?', okText: 'Delete' })) {
        DB.users.remove(id); toast(`${u.name} deleted`, 'info'); refresh();
      }
    },
    'export-csv': () => exportCSV(),
    'reset-data': async () => {
      if (await confirmDialog('All orders, bookings, users and menu changes will be replaced with the original sample data. You will be logged out.', { title: 'Reset all data?', okText: 'Reset' })) {
        DB.reset();
        location.replace('index.html');
      }
    }
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const fn = ACTIONS[btn.dataset.action];
    if (fn) { e.preventDefault(); fn(btn.dataset.id, btn); }
  });

  /* Checkbox switches use data-change="..." */
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change === 'toggle-avail') {
      const m = DB.menu.update(el.dataset.id, { available: el.checked });
      toast(`${m.name} is now ${m.available ? 'available' : 'unavailable'}`, m.available ? 'success' : 'info');
      refresh();
    }
    if (el.dataset.change === 'toggle-user') {
      const u = DB.users.update(el.dataset.id, { active: el.checked });
      toast(`${u.name} ${u.active ? 'activated' : 'deactivated'}`, u.active ? 'success' : 'info');
      refresh();
    }
  });

  /* ---------- Live sync between browser tabs ----------
     If a customer places an order in one tab, the staff tab updates instantly. */
  let knownOrders = DB.orders.all().length;
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('rom_') || e.key === 'rom_theme') return;
    const fresh = Auth.current();
    if (!fresh) return Auth.logout();                 // account deleted/deactivated elsewhere
    const roleChanged = fresh.role !== me.role;
    me = fresh;
    const count = DB.orders.all().length;
    if (isStaff() && count > knownOrders) toast('🔔 New order received!', 'info');
    knownOrders = count;
    if (roleChanged) { renderShell(); navigate(); } else if (!$('#modal')) refresh(); else updateBadges();
  });

  /* ---------- Boot ---------- */
  hydrateIcons();
  paintThemeBtn();
  $('#themeBtn').addEventListener('click', () => { Theme.toggle(); paintThemeBtn(); });
  $('#menuToggle').addEventListener('click', openSidebar);
  $('#overlay').addEventListener('click', closeSidebar);
  $('#cartBtn').addEventListener('click', openCart);
  $('#closeDrawer').addEventListener('click', closeCart);
  $('#drawerBackdrop').addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCart(); closeSidebar(); } });
  window.addEventListener('hashchange', navigate);

  renderShell();
  navigate();
})();
