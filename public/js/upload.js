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

  const picker = document.getElementById('thumb-picker');
  const options = document.getElementById('thumb-options');
  const thumbFile = document.getElementById('thumb-file');

  let file = null;
  let meta = { duration: 0, width: 0, height: 0 };
  let thumbBlob = null;
  // Every candidate cover offered so far: the automatic frames, anything
  // grabbed from the playhead, and anything uploaded. Keeping them all means
  // changing your mind costs a click instead of a re-seek.
  let covers = [];

  function showError(message) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Reads duration and dimensions; no ffmpeg needed, the browser already decoded it. */
  function analyze(selected) {
    return new Promise((resolve, reject) => {
      previewVideo.src = URL.createObjectURL(selected);
      previewVideo.onloadedmetadata = () => {
        meta = {
          duration: previewVideo.duration || 0,
          width: previewVideo.videoWidth || 0,
          height: previewVideo.videoHeight || 0,
        };
        resolve();
      };
      previewVideo.onerror = () => reject(new Error('Не удалось прочитать видеофайл — возможно, формат не поддерживается браузером'));
    });
  }

  /** Moves the preview to a moment and waits for the picture to actually be there. */
  function seek(time) {
    return new Promise((resolve) => {
      const done = () => { previewVideo.removeEventListener('seeked', done); resolve(); };
      previewVideo.addEventListener('seeked', done);
      previewVideo.currentTime = Math.max(0, Math.min(time, Math.max(0, (meta.duration || 0) - 0.05)));
    });
  }

  /*
   * The frame currently on screen, as a JPEG shaped like the video itself.
   *
   * It used to be letterboxed into 16:9 whatever the source was, which put
   * black bars down both sides of every Short's cover — and a Short is shown
   * in a vertical tile, where those bars are the only thing that does not fit.
   * A landscape clip keeps 16:9; a vertical one keeps its own shape, and the
   * one place it meets a wide tile letterboxes it there instead.
   */
  function grabFrame() {
    const ratio = (meta.width && meta.height) ? meta.width / meta.height : 16 / 9;
    const portrait = ratio < 1;
    const width = portrait ? 720 : 1280;
    const height = Math.round(width / ratio);

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(previewVideo, 0, 0, width, height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  }

  /** Shows the candidates and marks the chosen one; clicking a tile is the whole gesture. */
  function renderCovers() {
    // A vertical cover shown in a wide preview would be cropped, and then the
    // frame you chose is not the frame you get.
    options.classList.toggle('covers-tall', (meta.height || 0) > (meta.width || 0));
    options.innerHTML = covers.map((cover, index) => `
      <button type="button" class="thumb-option${cover.blob === thumbBlob ? ' is-active' : ''}"
              data-cover="${index}" aria-pressed="${cover.blob === thumbBlob}">
        <img src="${cover.url}" alt="">
        <span>${escapeHtml(cover.label)}</span>
      </button>`).join('');
    picker.hidden = !covers.length;
  }

  function addCover(blob, label, { select = true } = {}) {
    if (!blob) return;
    covers.push({ blob, label, url: URL.createObjectURL(blob) });
    if (select) thumbBlob = blob;
    renderCovers();
  }

  function clearCovers() {
    covers.forEach((cover) => URL.revokeObjectURL(cover.url));
    covers = [];
    thumbBlob = null;
    renderCovers();
  }

  /*
   * Three moments spread across the clip, the way a video service offers them:
   * near the start but past any black lead-in, the middle, and near the end.
   */
  async function suggestCovers() {
    const duration = meta.duration || 0;
    const marks = duration > 3
      ? [duration * 0.15, duration * 0.5, duration * 0.85]
      : [Math.min(0.2, duration / 2)];
    for (const [index, mark] of marks.entries()) {
      await seek(mark);
      addCover(await grabFrame(), `Кадр ${index + 1}`, { select: index === 0 });
    }
    await seek(marks[0]);
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
      await suggestCovers();
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

  options.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cover]');
    if (!button) return;
    thumbBlob = covers[Number(button.dataset.cover)].blob;
    renderCovers();
  });

  // The playhead is the finest control there is: scrub to the exact moment and
  // take it. The three suggestions above are only shortcuts to the common ones.
  document.getElementById('thumb-current').addEventListener('click', async () => {
    addCover(await grabFrame(), `Кадр на ${fmt.duration(previewVideo.currentTime)}`);
  });

  thumbFile.addEventListener('change', async () => {
    const picked = thumbFile.files[0];
    if (!picked) return;
    try {
      addCover(await openCropper(picked, 'thumb'), 'Своя картинка');
    } catch (err) {
      showError(err.message);
    } finally {
      thumbFile.value = '';
    }
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    file = null;
    clearCovers();
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
    const publishAt = document.getElementById('publish-at').value;
    if (publishAt) form.append('publishAt', String(new Date(publishAt).getTime()));
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
