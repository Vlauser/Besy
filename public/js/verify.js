(async function main() {
  await bootstrap();

  const box = document.getElementById('content');
  const token = new URLSearchParams(location.search).get('token');

  if (!token) {
    box.innerHTML = '<div class="alert alert-error">В ссылке нет кода подтверждения</div>';
    return;
  }

  try {
    await api.post('/api/auth/verify', { token });
    box.innerHTML = `
      <div class="alert alert-ok">E-mail подтверждён — теперь можно загружать видео и комментировать.</div>
      <a class="btn btn-primary" href="/upload">Загрузить видео</a>
      <a class="btn" href="/">На главную</a>`;
  } catch (err) {
    box.innerHTML = `
      <div class="alert alert-error">${escapeHtml(err.message)}</div>
      <a class="btn" href="/settings">Запросить новое письмо</a>`;
  }
})();
