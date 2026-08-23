(async function main() {
  await bootstrap();

  if (!auth.user) return auth.requireLogin('/upload');

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('preview');
  const previewVideo = document.getElementById('preview-video');
  const canvas = document.getElementById('thumb-canvas');
  const submitBtn = document.getElementById('submit-btn');
  const alertBox = document.getElementById('alert');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const titleInput = document.getElementById('title');

  let file = null;
  let meta = { duration: 0, width: 0, height: 0 };
  let thumbBlob = null;

  function showError(message) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Reads duration/size and grabs a poster frame straight from the browser — no ffmpeg needed. */
  function analyze(selected) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(selected);
      previewVideo.src = url;
      previewVideo.onloadedmetadata = () => {
        meta = {
          duration: previewVideo.duration || 0,
          width: previewVideo.videoWidth || 0,
          height: previewVideo.videoHeight || 0,
        };
        // Seek slightly into the clip so the poster is not a black first frame.
        previewVideo.currentTime = Math.min(1, (previewVideo.duration || 2) / 3);
      };
      previewVideo.onseeked = () => {
        const width = 640;
        const height = Math.round(width * (meta.height / meta.width || 9 / 16));
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(previewVideo, 0, 0, width, height);
        canvas.toBlob((blob) => { thumbBlob = blob; resolve(); }, 'image/jpeg', 0.82);
      };
      previewVideo.onerror = () => reject(new Error('Не удалось прочитать видеофайл — возможно, формат не поддерживается браузером'));
    });
  }

  async function selectFile(selected) {
    if (!selected) return;
    if (!selected.type.startsWith('video/')) return showError('Это не видеофайл');

    file = selected;
    alertBox.innerHTML = '';
    dropzone.hidden = true;
    preview.hidden = false;
    document.getElementById('file-name').textContent = selected.name;

    if (!titleInput.value) titleInput.value = selected.name.replace(/\.[^.]+$/, '');

    try {
      await analyze(selected);
      document.getElementById('file-info').textContent =
        `${fmt.size(selected.size)} · ${fmt.duration(meta.duration)} · ${meta.width}×${meta.height}`;
    } catch (err) {
      document.getElementById('file-info').textContent = fmt.size(selected.size);
      showError(err.message);
    }

    submitBtn.disabled = false;
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files[0]));

  document.getElementById('reset-btn').addEventListener('click', () => {
    file = null;
    thumbBlob = null;
    fileInput.value = '';
    previewVideo.removeAttribute('src');
    preview.hidden = true;
    dropzone.hidden = false;
    submitBtn.disabled = true;
  });

  document.getElementById('upload-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!file) return showError('Сначала выберите видеофайл');

    const form = new FormData();
    form.append('video', file);
    if (thumbBlob) form.append('thumbnail', thumbBlob, 'thumb.jpg');
    form.append('title', titleInput.value.trim());
    form.append('description', document.getElementById('description').value);
    form.append('tags', document.getElementById('tags').value);
    form.append('visibility', document.getElementById('visibility').value);
    form.append('ageRestricted', document.getElementById('age-restricted').checked ? 'true' : 'false');
    form.append('duration', String(meta.duration));
    form.append('width', String(meta.width));
    form.append('height', String(meta.height));

    submitBtn.disabled = true;
    submitBtn.textContent = 'Загрузка…';
    progress.hidden = false;
    progressText.hidden = false;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.withCredentials = true;
    const csrf = readCookie('besy_csrf');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const percent = (e.loaded / e.total) * 100;
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${percent.toFixed(0)}% — ${fmt.size(e.loaded)} из ${fmt.size(e.total)}`;
    });

    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        progressText.textContent = 'Готово! Открываем видео…';
        location.href = `/watch/${data.video.id}`;
      } else {
        showError(data.error || `Ошибка загрузки (${xhr.status})`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Опубликовать';
        progress.hidden = true;
        progressText.hidden = true;
      }
    });

    xhr.addEventListener('error', () => {
      showError('Сеть недоступна, попробуйте ещё раз');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Опубликовать';
    });

    xhr.send(form);
  });
})();
