(async function main() {
  await bootstrap();

  const form = document.getElementById('forgot-form');
  const alertBox = document.getElementById('alert');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await api.post('/api/auth/password/forgot', { email: form.email.value.trim() });
      // Deliberately identical wording whether or not the address exists.
      alertBox.innerHTML = '<div class="alert alert-ok">Если такой аккаунт есть, письмо со ссылкой уже отправлено.</div>';
      form.hidden = true;
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      button.disabled = false;
    }
  });
})();
