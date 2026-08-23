(async function main() {
  await bootstrap();

  const form = document.getElementById('reset-form');
  const alertBox = document.getElementById('alert');
  const token = new URLSearchParams(location.search).get('token');

  if (!token) {
    form.hidden = true;
    alertBox.innerHTML = '<div class="alert alert-error">В ссылке нет кода сброса</div>';
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    alertBox.innerHTML = '';
    try {
      await api.post('/api/auth/password/reset', { token, password: form.password.value });
      alertBox.innerHTML = '<div class="alert alert-ok">Пароль обновлён. Войдите с новым паролем.</div>';
      form.hidden = true;
      setTimeout(() => { location.href = '/auth'; }, 1500);
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      button.disabled = false;
    }
  });
})();
