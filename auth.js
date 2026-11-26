/* ==========================================================
   auth.js — Registration, login, logout, session & route guard
   ========================================================== */
const Auth = {
  KEY: 'rom_session',

  /* The logged-in user (or null). Deactivated users are treated as logged out. */
  current() {
    const id = localStorage.getItem(this.KEY) || sessionStorage.getItem(this.KEY);
    if (!id) return null;
    const u = DB.users.find(id);
    return u && u.active ? u : null;
  },

  async login(email, password, remember) {
    const u = DB.users.all().find((x) => x.email === email.trim().toLowerCase());
    if (!u || u.password !== (await DB.hash(password))) throw new Error('Invalid email or password');
    if (!u.active) throw new Error('Your account is deactivated. Please contact the admin.');
    this.startSession(u.id, remember);
    return u;
  },

  /* Public sign-up always creates a "customer" — only admins can create staff/admins */
  async register(data) {
    const u = await DB.createUser({ ...data, role: 'customer' });
    this.startSession(u.id, false);
    return u;
  },

  startSession(id, remember) {
    // "Remember me" -> localStorage (survives browser restart), else sessionStorage (tab only)
    localStorage.removeItem(this.KEY);
    sessionStorage.removeItem(this.KEY);
    (remember ? localStorage : sessionStorage).setItem(this.KEY, id);
  },

  logout() {
    localStorage.removeItem(this.KEY);
    sessionStorage.removeItem(this.KEY);
    location.replace('index.html');
  },

  /* Protects app.html — redirects to login if no valid session */
  guard() {
    const u = this.current();
    if (!u) { location.replace('index.html'); return null; }
    return u;
  }
};
