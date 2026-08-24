/**
 * Besy player: adaptive HLS with a manual quality picker, speed control,
 * keyboard shortcuts, theater/PiP modes, chapters and resume-where-you-left-off.
 */
class BesyPlayer {
  constructor(root, video, options = {}) {
    this.root = root;
    this.video = video;
    this.options = options;
    this.hls = null;
    this.levels = [];
    this.destroyed = false;
    this.settingsOpen = false;

    this.buildChrome();
    this.bindEvents();
    this.bindKeyboard();
  }

  /* --------------------------------------------------------------- sources */

  async load(source) {
    this.source = source;
    this.detachHls();

    const canPlayNative = this.video.canPlayType('application/vnd.apple.mpegurl');

    if (source.hlsUrl && window.Hls?.isSupported()) {
      const Hls = window.Hls;
      this.hls = new Hls({
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
        enableWorker: true,
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.levels = this.hls.levels.map((level, index) => ({
          index,
          height: level.height,
          label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}k`,
        }));
        this.renderQualityMenu();
      });
      this.hls.on(Hls.Events.LEVEL_SWITCHED, () => this.renderQualityMenu());
      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        // A broken manifest should never leave the viewer with a dead player.
        this.detachHls();
        this.video.src = source.streamUrl;
      });
      this.hls.loadSource(source.hlsUrl);
      this.hls.attachMedia(this.video);
    } else if (source.hlsUrl && canPlayNative) {
      this.video.src = source.hlsUrl;
    } else {
      this.video.src = source.streamUrl;
    }

    this.video.poster = source.thumbUrl || '';
    this.setCaptionTracks(source.captions || []);
    this.setChapters(source.chapters || []);
    this.restorePosition();
  }

  detachHls() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.levels = [];
  }

  /* ---------------------------------------------------------------- chrome */

  buildChrome() {
    const bar = document.createElement('div');
    bar.className = 'player-bar';
    bar.innerHTML = `
      <div class="player-seek" data-role="seek">
        <div class="player-seek-track">
          <div class="player-seek-buffer" data-role="buffer"></div>
          <div class="player-seek-progress" data-role="progress"></div>
          <div class="player-seek-chapters" data-role="chapters"></div>
        </div>
        <div class="player-tooltip" data-role="tooltip" hidden></div>
      </div>
      <div class="player-controls">
        <button class="player-btn" data-role="play" title="Воспроизвести (k)">${icon('play', 'Воспроизвести')}</button>
        <button class="player-btn" data-role="next" title="Следующее видео (shift+n)" hidden>${icon('next', 'Следующее видео')}</button>
        <div class="player-volume">
          <button class="player-btn" data-role="mute" title="Звук (m)">${icon('volume', 'Звук')}</button>
          <input type="range" min="0" max="1" step="0.05" value="1" data-role="volume" title="Громкость">
        </div>
        <span class="player-time" data-role="time">0:00 / 0:00</span>
        <span class="player-chapter" data-role="chapter-name"></span>
        <span class="player-spacer"></span>
        <button class="player-btn" data-role="cc" title="Субтитры (c)" hidden>CC</button>
        <button class="player-btn" data-role="settings" title="Настройки">${icon('settings', 'Настройки')}</button>
        <button class="player-btn" data-role="pip" title="Картинка в картинке (i)">${icon('pip', 'Картинка в картинке')}</button>
        <button class="player-btn" data-role="theater" title="Режим театра (t)">${icon('theater', 'Режим театра')}</button>
        <button class="player-btn" data-role="fullscreen" title="Во весь экран (f)">${icon('fullscreen', 'Во весь экран')}</button>
      </div>
      <div class="player-settings" data-role="settings-menu" hidden></div>
      <div class="player-toast" data-role="toast" hidden></div>`;

    this.root.appendChild(bar);
    this.el = {};
    for (const node of bar.querySelectorAll('[data-role]')) {
      this.el[node.dataset.role] = node;
    }
    this.bar = bar;
  }

  toast(text) {
    const node = this.el.toast;
    node.textContent = text;
    node.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { node.hidden = true; }, 900);
  }

  /* ---------------------------------------------------------------- events */

  bindEvents() {
    const v = this.video;

    this.el.play.addEventListener('click', () => this.togglePlay());
    this.video.addEventListener('click', () => this.togglePlay());
    this.el.mute.addEventListener('click', () => this.toggleMute());
    this.el.volume.addEventListener('input', (e) => {
      v.volume = Number(e.target.value);
      v.muted = v.volume === 0;
    });

    v.addEventListener('play', () => { this.el.play.innerHTML = icon('pause', 'Пауза'); this.root.classList.add('playing'); });
    v.addEventListener('pause', () => { this.el.play.innerHTML = icon('play', 'Воспроизвести'); this.root.classList.remove('playing'); });
    v.addEventListener('volumechange', () => {
      const level = v.muted || v.volume === 0 ? 'mute' : v.volume < 0.5 ? 'volumeLow' : 'volume';
      this.el.mute.innerHTML = icon(level, level === 'mute' ? 'Включить звук' : 'Выключить звук');
      this.el.volume.value = v.muted ? 0 : v.volume;
    });
    v.addEventListener('loadedmetadata', () => this.renderTime());
    v.addEventListener('timeupdate', () => {
      this.renderTime();
      this.savePosition();
    });
    v.addEventListener('progress', () => this.renderBuffer());
    v.addEventListener('ended', () => this.options.onEnded?.());

    const seek = this.el.seek;
    const seekTo = (event) => {
      const rect = seek.getBoundingClientRect();
      const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
      if (Number.isFinite(v.duration)) v.currentTime = ratio * v.duration;
    };
    seek.addEventListener('click', seekTo);
    seek.addEventListener('mousemove', (event) => {
      const rect = seek.getBoundingClientRect();
      const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
      const time = ratio * (v.duration || 0);
      const chapter = this.chapterAt(time);
      this.el.tooltip.hidden = false;
      this.el.tooltip.style.left = `${ratio * 100}%`;
      this.el.tooltip.textContent = chapter ? `${formatTime(time)} · ${chapter.title}` : formatTime(time);
    });
    seek.addEventListener('mouseleave', () => { this.el.tooltip.hidden = true; });

    this.el.settings.addEventListener('click', () => this.toggleSettings());
    this.el.fullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.el.theater.addEventListener('click', () => this.options.onTheater?.());
    this.el.pip.addEventListener('click', () => this.togglePip());
    this.el.cc.addEventListener('click', () => this.toggleCaptions());
    this.el.next.addEventListener('click', () => this.options.onNext?.());

    document.addEventListener('click', (event) => {
      if (this.settingsOpen && !this.bar.contains(event.target)) this.closeSettings();
    });
  }

  bindKeyboard() {
    this.keyHandler = (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

      const v = this.video;
      const key = event.key.toLowerCase();
      const actions = {
        ' ': () => this.togglePlay(),
        k: () => this.togglePlay(),
        m: () => this.toggleMute(),
        f: () => this.toggleFullscreen(),
        t: () => this.options.onTheater?.(),
        i: () => this.togglePip(),
        c: () => this.toggleCaptions(),
        arrowleft: () => { v.currentTime -= 5; this.toast('−5 с'); },
        arrowright: () => { v.currentTime += 5; this.toast('+5 с'); },
        j: () => { v.currentTime -= 10; this.toast('−10 с'); },
        l: () => { v.currentTime += 10; this.toast('+10 с'); },
        arrowup: () => { v.volume = Math.min(1, v.volume + 0.1); this.toast(`${Math.round(v.volume * 100)}%`); },
        arrowdown: () => { v.volume = Math.max(0, v.volume - 0.1); this.toast(`${Math.round(v.volume * 100)}%`); },
        '>': () => this.cycleSpeed(1),
        '<': () => this.cycleSpeed(-1),
        n: () => { if (event.shiftKey) this.options.onNext?.(); },
      };

      if (/^[0-9]$/.test(key) && Number.isFinite(v.duration)) {
        v.currentTime = (Number(key) / 10) * v.duration;
        event.preventDefault();
        return;
      }

      const action = actions[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  destroy() {
    this.destroyed = true;
    this.detachHls();
    document.removeEventListener('keydown', this.keyHandler);
  }

  /* --------------------------------------------------------------- actions */

  togglePlay() {
    if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
  }

  async togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      this.toast('Картинка в картинке недоступна');
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.root.requestFullscreen?.().catch(() => {});
  }

  cycleSpeed(direction) {
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const current = speeds.indexOf(this.video.playbackRate);
    const next = Math.min(Math.max((current === -1 ? 3 : current) + direction, 0), speeds.length - 1);
    this.video.playbackRate = speeds[next];
    this.toast(`${speeds[next]}×`);
    this.renderSettings();
  }

  /* -------------------------------------------------------------- captions */

  /** Rebuilds the <track> elements for the current video. */
  setCaptionTracks(captions) {
    this.video.querySelectorAll('track').forEach((track) => track.remove());

    for (const caption of captions) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = caption.label;
      track.srclang = caption.lang;
      track.src = caption.url;
      if (caption.isDefault) track.default = true;
      this.video.appendChild(track);
    }

    this.captions = captions;
    this.el.cc.hidden = !captions.length;
    this.el.cc.classList.toggle('on', captions.some((caption) => caption.isDefault));
  }

  toggleCaptions() {
    const tracks = Array.from(this.video.textTracks);
    if (!tracks.length) return;

    const activeIndex = tracks.findIndex((track) => track.mode === 'showing');
    tracks.forEach((track) => { track.mode = 'disabled'; });

    // Cycle through the languages, then back to off.
    const next = activeIndex + 1;
    if (next < tracks.length) {
      tracks[next].mode = 'showing';
      this.el.cc.classList.add('on');
      this.toast(`Субтитры: ${tracks[next].label || tracks[next].language}`);
    } else {
      this.el.cc.classList.remove('on');
      this.toast('Субтитры выключены');
    }
    this.renderSettings();
  }

  /* -------------------------------------------------------------- chapters */

  setChapters(chapters) {
    this.chapters = chapters;
    const track = this.el.chapters;
    track.innerHTML = '';
    this.chaptersRendered = false;
    if (!chapters.length || !Number.isFinite(this.video.duration) || !this.video.duration) return;
    this.chaptersRendered = true;
    for (const chapter of chapters.slice(1)) {
      const mark = document.createElement('span');
      mark.className = 'player-chapter-mark';
      mark.style.left = `${(chapter.start / this.video.duration) * 100}%`;
      track.appendChild(mark);
    }
  }

  chapterAt(time) {
    if (!this.chapters?.length) return null;
    let found = null;
    for (const chapter of this.chapters) {
      if (chapter.start <= time) found = chapter;
      else break;
    }
    return found;
  }

  /* -------------------------------------------------------------- position */

  positionKey() {
    return this.options.videoId ? `besy:pos:${this.options.videoId}` : null;
  }

  savePosition() {
    const key = this.positionKey();
    if (!key || !this.video.duration) return;
    const now = Date.now();
    if (now - (this.lastSave || 0) < 4000) return;
    this.lastSave = now;
    const nearEnd = this.video.currentTime > this.video.duration - 10;
    try {
      if (nearEnd || this.video.currentTime < 5) localStorage.removeItem(key);
      else localStorage.setItem(key, String(Math.floor(this.video.currentTime)));
    } catch { /* private mode */ }
  }

  restorePosition() {
    const key = this.positionKey();
    if (!key) return;
    let saved = null;
    try { saved = localStorage.getItem(key); } catch { /* private mode */ }
    if (!saved) return;
    const seconds = Number(saved);
    this.video.addEventListener('loadedmetadata', () => {
      if (seconds > 0 && seconds < this.video.duration - 5) {
        this.video.currentTime = seconds;
        this.toast(`Продолжаем с ${formatTime(seconds)}`);
      }
    }, { once: true });
  }

  /* ------------------------------------------------------------- rendering */

  renderTime() {
    const v = this.video;
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    this.el.time.textContent = `${formatTime(v.currentTime)} / ${formatTime(duration)}`;
    this.el.progress.style.width = duration ? `${(v.currentTime / duration) * 100}%` : '0%';

    const chapter = this.chapterAt(v.currentTime);
    this.el['chapter-name'].textContent = chapter ? chapter.title : '';
    // Duration is unknown until metadata arrives, so place the marks then.
    if (this.chapters?.length && !this.chaptersRendered) this.setChapters(this.chapters);
  }

  renderBuffer() {
    const v = this.video;
    if (!v.buffered.length || !Number.isFinite(v.duration)) return;
    const end = v.buffered.end(v.buffered.length - 1);
    this.el.buffer.style.width = `${(end / v.duration) * 100}%`;
  }

  toggleSettings() {
    this.settingsOpen ? this.closeSettings() : this.openSettings();
  }

  openSettings() {
    this.settingsOpen = true;
    this.el['settings-menu'].hidden = false;
    this.renderSettings();
  }

  closeSettings() {
    this.settingsOpen = false;
    this.el['settings-menu'].hidden = true;
  }

  renderQualityMenu() {
    if (this.settingsOpen) this.renderSettings();
  }

  renderSettings() {
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const currentLevel = this.hls ? this.hls.currentLevel : -1;
    const autoLabel = this.hls && this.hls.autoLevelEnabled && this.levels[currentLevel]
      ? ` (${this.levels[currentLevel].label})`
      : '';

    const quality = this.levels.length
      ? `
        <div class="player-menu-title">Качество</div>
        <button class="player-menu-item${this.hls?.autoLevelEnabled ? ' active' : ''}" data-quality="-1">Авто${autoLabel}</button>
        ${this.levels.slice().reverse().map((level) => `
          <button class="player-menu-item${!this.hls?.autoLevelEnabled && currentLevel === level.index ? ' active' : ''}"
                  data-quality="${level.index}">${level.label}</button>`).join('')}`
      : '<div class="player-menu-title">Качество</div><div class="player-menu-note">Исходное</div>';

    const captions = this.captions?.length
      ? `
        <div class="player-menu-title">Субтитры</div>
        ${this.captions.map((caption, index) => `
          <button class="player-menu-item${Array.from(this.video.textTracks)[index]?.mode === 'showing' ? ' active' : ''}"
                  data-caption="${index}">${escapeHtml(caption.label)}</button>`).join('')}
        <button class="player-menu-item${Array.from(this.video.textTracks).every((t) => t.mode !== 'showing') ? ' active' : ''}"
                data-caption="-1">Выключены</button>`
      : '';

    this.el['settings-menu'].innerHTML = `
      <div class="player-menu-title">Скорость</div>
      <div class="player-menu-row">
        ${speeds.map((speed) => `
          <button class="player-menu-chip${this.video.playbackRate === speed ? ' active' : ''}"
                  data-speed="${speed}">${speed === 1 ? '1×' : `${speed}×`}</button>`).join('')}
      </div>
      ${quality}
      ${captions}`;

    this.el['settings-menu'].querySelectorAll('[data-caption]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tracks = Array.from(this.video.textTracks);
        tracks.forEach((track) => { track.mode = 'disabled'; });
        const index = Number(btn.dataset.caption);
        if (index >= 0 && tracks[index]) tracks[index].mode = 'showing';
        this.el.cc.classList.toggle('on', index >= 0);
        this.renderSettings();
      });
    });

    this.el['settings-menu'].querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.video.playbackRate = Number(btn.dataset.speed);
        this.renderSettings();
      });
    });
    this.el['settings-menu'].querySelectorAll('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.hls) return;
        this.hls.currentLevel = Number(btn.dataset.quality);
        this.renderSettings();
      });
    });
  }

  showNextButton(show) {
    this.el.next.hidden = !show;
  }
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parses "1:23 Название" lines out of a description into chapter markers. */
function parseChapters(description) {
  const chapters = [];
  for (const line of String(description || '').split('\n')) {
    const match = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, h, m, s, title] = match;
    const start = (Number(h || 0) * 3600) + (Number(m) * 60) + Number(s);
    chapters.push({ start, title });
  }
  if (!chapters.length || chapters[0].start !== 0) return [];
  return chapters.sort((a, b) => a.start - b.start);
}
