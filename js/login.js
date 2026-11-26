/* ==========================================================
   login.js — Logic for index.html (Sign in / Create account)
   ========================================================== */
(async function () {
  await DB.init();

  // Already logged in? Go straight to the portal.
  if (Auth.current()) { location.replace('app.html'); return; }

  hydrateIcons();
  $('#year').textContent = new Date().getFullYear();

  /* ---------- Theme toggle ---------- */
  const themeBtn = $('#themeBtn');
  const paintTheme = () => {
    themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  };
  paintTheme();
  themeBtn.addEventListener('click', () => { Theme.toggle(); paintTheme(); });

  /* ---------- Tabs (Sign in / Create account) ---------- */
  const tabs = $$('.tab');
  function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('.tabs').dataset.active = name;
    $('#loginForm').classList.toggle('active', name === 'login');
    $('#registerForm').classList.toggle('active', name === 'register');
  }
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  /* ---------- Show / hide password ---------- */
  $$('.pw-toggle').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));

  /* ---------- Button loading state ---------- */
  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.classList.toggle('loading', loading);
  }

  /* ---------- Login ---------- */
  const loginForm = $('#loginForm');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm(loginForm, {
      email: [Validate.required, Validate.email],
      password: [Validate.required]
    });
    if (!ok) return;

    const btn = loginForm.querySelector('[type=submit]');
    setLoading(btn, true);
    try {
      const u = await Auth.login(loginForm.email.value, loginForm.password.value, loginForm.remember.checked);
      toast(`Welcome back, ${u.name.split(' ')[0]}!`);
      setTimeout(() => location.replace('app.html'), 600);
    } catch (err) {
      setLoading(btn, false);
      setFieldError(loginForm.password.closest('.field'), err.message);
      toast(err.message, 'error');
    }
  });

  /* Demo accounts — fill the form and sign in */
  const DEMO = {
    admin:    ['admin@spicehub.com', 'admin123'],
    staff:    ['staff@spicehub.com', 'staff123'],
    customer: ['customer@spicehub.com', 'customer123']
  };
  $$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const [email, pw] = DEMO[b.dataset.demo];
    loginForm.email.value = email;
    loginForm.password.value = pw;
    loginForm.requestSubmit();
  }));

  $('#forgotLink').addEventListener('click', (e) => {
    e.preventDefault();
    toast('Please contact the restaurant admin to reset your password.', 'info');
  });

  /* ---------- Register ---------- */
  const regForm = $('#registerForm');

  // Allow only digits in the phone field
  regForm.phone.addEventListener('input', () => {
    regForm.phone.value = regForm.phone.value.replace(/\D/g, '').slice(0, 10);
  });

  // Password strength meter
  regForm.password.addEventListener('input', () => {
    const v = regForm.password.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    $('#strength').dataset.score = v ? score : 0;
    $('#strengthLabel').textContent = v ? `Password strength: ${labels[score] || 'Too short'}` : '';
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = validateForm(regForm, {
      name: [Validate.required, Validate.name],
      email: [Validate.required, Validate.email,
        (v) => !DB.users.all().some((u) => u.email === v.trim().toLowerCase()) || 'This email is already registered'],
      phone: [Validate.required, Validate.phone],
      password: [Validate.required, Validate.password],
      confirm: [Validate.required, (v, f) => v === f.password.value || 'Passwords do not match'],
      terms: [(v) => v === true || 'Please accept the terms to continue']
    });
    if (!ok) return;

    const btn = regForm.querySelector('[type=submit]');
    setLoading(btn, true);
    try {
      const u = await Auth.register({
        name: regForm.name.value, email: regForm.email.value,
        phone: regForm.phone.value, password: regForm.password.value
      });
      toast(`Account created! Welcome, ${u.name.split(' ')[0]} 🎉`);
      setTimeout(() => location.replace('app.html'), 700);
    } catch (err) {
      setLoading(btn, false);
      toast(err.message, 'error');
    }
  });
})();
