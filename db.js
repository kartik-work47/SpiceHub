/* ==========================================================
   db.js — Data layer.
   Uses the browser's localStorage as a small JSON "database".
   Each table (users, menu, orders, bookings) is stored as an
   array of objects under the key "rom_<table>".
   ========================================================== */
const DB = (() => {
  const PREFIX = 'rom_';
  const ORDER_FLOW = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed'];
  const BOOKING_STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
  const CATEGORIES = ['Starters', 'Main Course', 'Pizza', 'Desserts', 'Beverages'];
  const TAX_RATE = 0.05; // 5% GST

  /* ---------- Low-level read / write ---------- */
  const read = (table) => {
    try { return JSON.parse(localStorage.getItem(PREFIX + table)) || []; }
    catch (e) { return []; }
  };
  const write = (table, rows) => localStorage.setItem(PREFIX + table, JSON.stringify(rows));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Generic CRUD for any table ---------- */
  function table(name) {
    return {
      all:   () => read(name),
      find:  (id) => read(name).find((r) => r.id === id) || null,
      where: (fn) => read(name).filter(fn),
      insert(row) {                                   // CREATE
        const rows = read(name);
        const rec = { id: uid(), createdAt: new Date().toISOString(), ...row };
        rows.push(rec);
        write(name, rows);
        return rec;
      },
      update(id, patch) {                             // UPDATE
        const rows = read(name);
        const i = rows.findIndex((r) => r.id === id);
        if (i === -1) return null;
        rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
        write(name, rows);
        return rows[i];
      },
      remove(id) {                                    // DELETE
        write(name, read(name).filter((r) => r.id !== id));
      }
    };
  }

  const users = table('users');
  const menu = table('menu');
  const orders = table('orders');
  const bookings = table('bookings');

  /* ---------- Password hashing (SHA-256) ----------
     Passwords are never stored as plain text. */
  async function hash(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for browsers without SubtleCrypto (non-secure context)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'f' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  /* ---------- Human-friendly running codes (ORD-1001, BK-101) ---------- */
  function nextCode(kind) {
    let c;
    try { c = JSON.parse(localStorage.getItem(PREFIX + 'counters')) || {}; } catch (e) { c = {}; }
    const start = { order: 1001, booking: 101 }[kind];
    const n = c[kind] || start;
    c[kind] = n + 1;
    localStorage.setItem(PREFIX + 'counters', JSON.stringify(c));
    return (kind === 'order' ? 'ORD-' : 'BK-') + n;
  }

  /* ---------- Business helpers ---------- */
  async function createUser({ name, email, phone, password, role = 'customer' }) {
    const exists = users.all().some((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (exists) throw new Error('An account with this email already exists');
    return users.insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      role,
      active: true,
      password: await hash(password)
    });
  }

  function calcTotals(items) {
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const tax = Math.round(subtotal * TAX_RATE);
    return { subtotal, tax, total: subtotal + tax };
  }

  function createOrder({ items, customerId, customerName, type, table: tableNo, address, notes, by }) {
    const now = new Date().toISOString();
    return orders.insert({
      code: nextCode('order'),
      customerId, customerName, items,
      ...calcTotals(items),
      type, table: tableNo || '', address: address || '', notes: notes || '',
      status: 'Pending',
      history: [{ status: 'Pending', at: now, by }]
    });
  }

  /* ---------- Sample data (runs only once) ---------- */
  async function init() {
    if (localStorage.getItem(PREFIX + 'seeded')) return;

    const created = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.toISOString(); };
    const seedUsers = [
      { id: 'u-admin', name: 'Aarav Sharma', email: 'admin@spicehub.com',    phone: '9876543210', role: 'admin',    pw: 'admin123', days: 120 },
      { id: 'u-staff', name: 'Priya Nair',   email: 'staff@spicehub.com',    phone: '9876501234', role: 'staff',    pw: 'staff123', days: 90 },
      { id: 'u-staff2', name: 'Karan Mehta', email: 'karan@spicehub.com',    phone: '9811122233', role: 'staff',    pw: 'staff123', days: 60 },
      { id: 'u-cust',  name: 'Rahul Verma',  email: 'customer@spicehub.com', phone: '9123456780', role: 'customer', pw: 'customer123', days: 45 },
      { id: 'u-cust2', name: 'Sneha Iyer',   email: 'sneha@example.com',     phone: '9988776655', role: 'customer', pw: 'customer123', days: 30 },
      { id: 'u-cust3', name: 'Arjun Reddy',  email: 'arjun@example.com',     phone: '9000011111', role: 'customer', pw: 'customer123', days: 12 }
    ];
    const userRows = [];
    for (const u of seedUsers) {
      userRows.push({
        id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
        active: true, password: await hash(u.pw), createdAt: created(u.days)
      });
    }
    write('users', userRows);

    const menuRows = [
      ['m1',  'Paneer Tikka',       'Starters',    249, '🍢', 'Char-grilled cottage cheese marinated in spiced yogurt.', true,  true],
      ['m2',  'Chicken 65',         'Starters',    279, '🍗', 'Crispy, fiery South-Indian style fried chicken.',        false, true],
      ['m3',  'Veg Spring Rolls',   'Starters',    199, '🥟', 'Golden rolls stuffed with crunchy vegetables.',          true,  true],
      ['m4',  'Butter Chicken',     'Main Course', 379, '🍛', 'Tandoori chicken in a rich, creamy tomato gravy.',       false, true],
      ['m5',  'Dal Makhani',        'Main Course', 259, '🥘', 'Black lentils slow-cooked overnight with butter.',       true,  true],
      ['m6',  'Hyderabadi Biryani', 'Main Course', 349, '🍚', 'Fragrant dum-cooked basmati rice with tender meat.',     false, true],
      ['m7',  'Margherita Pizza',   'Pizza',       299, '🍕', 'Classic tomato, mozzarella and fresh basil.',            true,  true],
      ['m8',  'BBQ Chicken Pizza',  'Pizza',       399, '🍕', 'Smoky BBQ chicken, onions and cheddar.',                 false, true],
      ['m9',  'Gulab Jamun',        'Desserts',    129, '🍡', 'Soft milk dumplings soaked in rose sugar syrup.',        true,  true],
      ['m10', 'Chocolate Brownie',  'Desserts',    179, '🍫', 'Warm fudgy brownie with a scoop of vanilla.',            true,  true],
      ['m11', 'Mango Lassi',        'Beverages',   119, '🥭', 'Chilled yogurt smoothie with Alphonso mango.',           true,  true],
      ['m12', 'Cold Coffee',        'Beverages',   149, '🧋', 'Creamy blended iced coffee.',                            true,  true],
      ['m13', 'Fresh Lime Soda',    'Beverages',    99, '🍋', 'Sweet or salted, fizzy and refreshing.',                 true,  false]
    ].map(([id, name, category, price, emoji, description, veg, available]) =>
      ({ id, name, category, price, emoji, description, veg, available, createdAt: created(100) }));
    write('menu', menuRows);

    /* Orders spread over the last 14 days so reports have data */
    const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const pick = (arr) => arr[rand(0, arr.length - 1)];
    const customers = userRows.filter((u) => u.role === 'customer');
    const types = ['Dine-in', 'Takeaway', 'Delivery'];
    const todayStatuses = ['Pending', 'Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Preparing'];
    const orderRows = [];
    let code = 1001;

    for (let d = 13; d >= 0; d--) {
      const n = d === 0 ? todayStatuses.length : rand(3, 7);
      for (let k = 0; k < n; k++) {
        const at = new Date();
        if (d === 0) at.setMinutes(at.getMinutes() - (n - k) * 9 - rand(0, 5));
        else { at.setDate(at.getDate() - d); at.setHours(rand(12, 22), rand(0, 59), 0, 0); }

        const chosen = new Set();
        const count = rand(1, 3);
        const orderable = menuRows.filter((m) => m.available);
        while (chosen.size < count) chosen.add(pick(orderable));
        const items = [...chosen].map((m) => ({ menuId: m.id, name: m.name, price: m.price, qty: rand(1, 3) }));

        const status = d === 0 ? todayStatuses[k] : (Math.random() < 0.1 ? 'Cancelled' : 'Completed');
        const cust = d === 0 && (k === 0 || k === 3) ? customers[0] : pick(customers);
        const type = pick(types);

        const history = [];
        let t = at.getTime();
        const stamp = () => new Date(Math.min(t, Date.now())).toISOString();
        if (status === 'Cancelled') {
          history.push({ status: 'Pending', at: stamp(), by: cust.name });
          t += 6 * 60000;
          history.push({ status: 'Cancelled', at: stamp(), by: 'Priya Nair' });
        } else {
          const idx = ORDER_FLOW.indexOf(status);
          for (let i = 0; i <= idx; i++) {
            history.push({ status: ORDER_FLOW[i], at: stamp(), by: i === 0 ? cust.name : 'Priya Nair' });
            t += rand(2, 6) * 60000;
          }
        }

        orderRows.push({
          id: uid() + k, code: 'ORD-' + code++,
          customerId: cust.id, customerName: cust.name,
          items, ...calcTotals(items), type,
          table: type === 'Dine-in' ? String(rand(1, 20)) : '',
          address: type === 'Delivery' ? '12, MG Road, Indiranagar, Bengaluru' : '',
          notes: k === 1 ? 'Less spicy, please' : '',
          status, history, createdAt: at.toISOString()
        });
      }
    }
    write('orders', orderRows);

    const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDateStr(d); };
    const bookingRows = [
      ['u-cust',  'Rahul Verma', '9123456780', day(1),  '19:30', 4, 'Birthday',    'Window seat if possible', 'Confirmed'],
      ['u-cust2', 'Sneha Iyer',  '9988776655', day(0),  '20:00', 2, 'Anniversary', '',                        'Pending'],
      ['u-cust3', 'Arjun Reddy', '9000011111', day(2),  '13:00', 6, 'Business',    'Need a quiet corner',     'Pending'],
      ['u-cust',  'Rahul Verma', '9123456780', day(-5), '21:00', 3, 'Casual',      '',                        'Completed'],
      ['u-cust2', 'Sneha Iyer',  '9988776655', day(-2), '12:30', 2, 'Casual',      '',                        'Cancelled']
    ].map(([customerId, name, phone, date, time, guests, occasion, notes, status], i) => ({
      id: 'b' + (i + 1), code: 'BK-' + (101 + i), customerId, name, phone, date, time,
      guests, occasion, notes, status, createdAt: created(6 - i)
    }));
    write('bookings', bookingRows);

    localStorage.setItem(PREFIX + 'counters', JSON.stringify({ order: code, booking: 101 + bookingRows.length }));
    localStorage.setItem(PREFIX + 'seeded', '1');
  }

  /* Wipe everything and start fresh with sample data */
  function reset() {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== PREFIX + 'theme')
      .forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem(PREFIX + 'session');
  }

  return {
    init, reset, hash, uid, nextCode, createUser, createOrder, calcTotals,
    users, menu, orders, bookings,
    ORDER_FLOW, BOOKING_STATUSES, CATEGORIES, TAX_RATE
  };
})();
