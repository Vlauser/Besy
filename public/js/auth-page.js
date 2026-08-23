(async function main() {
  await bootstrap();

  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/';
  const alertBox = document.getElementById('alert');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (auth.user) { location.href = next; return; }

  function setMode(mode) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    loginForm.hidden = mode !== 'login';
    registerForm.hidden = mode !== 'register';
    document.title = `${mode === 'login' ? 'Вход' : 'Регистрация'} — Besy`;
    alertBox.innerHTML = '';
  }

  if (params.get('mode') === 'register') setMode('register');

  document.getElementById('mode-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) setMode(tab.dataset.mode);
  });

  async function submit(form, url) {
    const body = Object.fromEntries(new FormData(form).entries());
    const button = form.querySelector('button[type=submit]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Подождите…';
    alertBox.innerHTML = '';
    try {
      await api.post(url, body);
      location.href = next;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      button.disabled = false;
      button.textContent = label;
    }
  }

  loginForm.addEventListener('submit', (e) => { e.preventDefault(); submit(loginForm, '/api/auth/login'); });
  registerForm.addEventListener('submit', (e) => { e.preventDefault(); submit(registerForm, '/api/auth/register'); });
})();
