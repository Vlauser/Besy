const $ = (id) => document.getElementById(id);

const ISSUE_LABELS = {
  background_not_white: "фон не белый",
  leftover_background: "остатки фона",
  part_clipped: "деталь обрезана",
  edge_eaten: "срезан край детали",
  part_off_center: "смещена от центра",
  foreign_object: "посторонний объект",
  blurry: "нерезкая",
  other: "прочее",
};

const WARNING_LABELS = {
  touches_frame_edge: "деталь упирается в край кадра",
  debris_removed: "убран мусор с фона",
  tiny_object: "деталь очень мелкая в кадре",
  huge_object: "деталь занимает почти весь кадр",
  upscaled: "результат растянут — исходник мелкий",
};

const state = {
  config: null,
  files: [],
  job: null,
  poll: null,
  filter: "all",
  showSource: false,
};

// ---------- запуск ----------

async function init() {
  state.config = await fetch("/api/config").then((r) => r.json());

  if (state.config.auth_required && !state.config.authenticated) {
    $("login").classList.remove("hidden");
  }

  $("limits").textContent =
    `до ${state.config.max_files} файлов за раз, до ${state.config.max_upload_mb} МБ каждый`;

  const meta = [];
  if (state.config.claude_enabled) {
    meta.push(
      state.config.claude_configured
        ? `Claude ${state.config.model}: OCR маркировки + контроль качества`
        : "⚠ Claude включён, но ключ не задан — проверка будет падать",
    );
  } else {
    meta.push("Claude отключён — только алгоритмическая обработка");
  }
  $("header-meta").textContent = meta.join(" · ");

  applyDefaults(state.config.defaults);
  bind();
}

function applyDefaults(d) {
  $("opt-w").value = d.canvas_width;
  $("opt-h").value = d.canvas_height;
  $("opt-fill").value = d.fill_height;
  $("opt-fillw").value = d.fill_width_max;
  $("opt-q").value = d.jpeg_quality;
  $("opt-bg").value = d.background;
  $("opt-matting").checked = d.alpha_matting;
}

function readOptions() {
  return {
    canvas_width: Number($("opt-w").value),
    canvas_height: Number($("opt-h").value),
    fill_height: Number($("opt-fill").value),
    fill_width_max: Number($("opt-fillw").value),
    jpeg_quality: Number($("opt-q").value),
    background: $("opt-bg").value,
    alpha_matting: $("opt-matting").checked,
  };
}

// ---------- события ----------

function bind() {
  $("login-form").addEventListener("submit", onLogin);
  $("browse").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => addFiles(e.target.files));
  $("clear-selection").addEventListener("click", () => setFiles([]));
  $("start").addEventListener("click", startJob);
  $("cancel").addEventListener("click", cancelJob);
  $("download").addEventListener("click", downloadZip);

  $("show-source").addEventListener("change", (e) => {
    state.showSource = e.target.checked;
    renderGallery();
  });

  $("filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderGallery();
  });

  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("hot");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("hot");
    }),
  );
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
}

async function onLogin(e) {
  e.preventDefault();
  const body = new FormData(e.target);
  const res = await fetch("/api/login", { method: "POST", body });
  if (res.ok) {
    $("login").classList.add("hidden");
    $("login-error").classList.add("hidden");
  } else {
    const err = await res.json().catch(() => ({}));
    showError($("login-error"), err.detail || "Не удалось войти");
  }
}

// ---------- выбор файлов ----------

function addFiles(list) {
  const incoming = Array.from(list).filter((f) => f.type.startsWith("image/"));
  setFiles(state.files.concat(incoming).slice(0, state.config.max_files));
}

function setFiles(files) {
  state.files = files;
  const n = files.length;
  $("selection").classList.toggle("hidden", n === 0);
  $("selection-count").textContent = `${n} ${plural(n, "файл", "файла", "файлов")} выбрано`;
  $("start").disabled = n === 0;
  $("start").textContent = n ? `Обработать ${n} ${plural(n, "фото", "фото", "фото")}` : "Обработать";
  $("file-input").value = "";
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ---------- задача ----------

async function startJob() {
  const body = new FormData();
  state.files.forEach((f) => body.append("files", f, f.name));
  body.append("options", JSON.stringify(readOptions()));

  $("start").disabled = true;
  $("start").textContent = "Загрузка…";
  $("upload-error").classList.add("hidden");

  try {
    const res = await fetch("/api/jobs", { method: "POST", body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Ошибка сервера (${res.status})`);
    }
    state.job = await res.json();
    setFiles([]);
    $("job").classList.remove("hidden");
    renderJob();
    startPolling();
  } catch (err) {
    showError($("upload-error"), err.message);
    $("start").disabled = state.files.length === 0;
  }
}

function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!state.job) return;
    const res = await fetch(`/api/jobs/${state.job.id}`);
    if (!res.ok) {
      clearInterval(state.poll);
      return;
    }
    state.job = await res.json();
    renderJob();
    if (state.job.status !== "running") clearInterval(state.poll);
  }, 1200);
}

async function cancelJob() {
  if (!state.job) return;
  await fetch(`/api/jobs/${state.job.id}/cancel`, { method: "POST" });
}

function downloadZip() {
  if (state.job) window.location.href = `/api/jobs/${state.job.id}/download`;
}

// ---------- рендер ----------

function renderJob() {
  const job = state.job;
  if (!job) return;

  const { total, done, error } = job.counts;
  const finished = done + error;
  $("progress-bar").style.width = total ? `${(finished / total) * 100}%` : "0%";

  const parts = [`${finished} из ${total} обработано`];
  if (error) parts.push(`${error} с ошибкой`);
  if (job.usage.input_tokens) {
    parts.push(
      `токены: ${job.usage.input_tokens.toLocaleString("ru")} вход / ` +
        `${job.usage.output_tokens.toLocaleString("ru")} выход`,
    );
  }
  if (job.status === "finished") parts.push("готово");
  if (job.status === "cancelled") parts.push("отменено");
  $("job-status").textContent = parts.join(" · ");

  $("download").disabled = done === 0;
  $("cancel").disabled = job.status !== "running";
  $("start").disabled = state.files.length === 0;
  $("start").textContent = "Обработать";

  renderGallery();
}

function matchesFilter(item) {
  if (state.filter === "all") return true;
  if (state.filter === "error") return item.status === "error";
  const verdict = item.qc?.verdict;
  return (
    item.status === "error" ||
    verdict === "warn" ||
    verdict === "fail" ||
    verdict === "error" ||
    (item.warnings || []).length > 0
  );
}

function renderGallery() {
  const gallery = $("gallery");
  const items = (state.job?.items || []).filter(matchesFilter);

  if (!items.length) {
    gallery.innerHTML = `<p class="muted">Ничего не подходит под фильтр.</p>`;
    return;
  }

  gallery.innerHTML = items.map(renderTile).join("");

  gallery.querySelectorAll(".name").forEach((input) => {
    input.addEventListener("change", (e) => renameItem(e.target.dataset.id, e.target.value));
  });
  gallery.querySelectorAll("[data-retry]").forEach((btn) => {
    btn.addEventListener("click", (e) =>
      retryItem(e.target.dataset.retry, e.target.dataset.matting === "1"),
    );
  });
}

function renderTile(item) {
  const jobId = state.job.id;
  const bust = item.duration_ms;
  let frame;

  if (item.status === "done") {
    const src = state.showSource
      ? `/api/jobs/${jobId}/items/${item.id}/source`
      : `/api/jobs/${jobId}/items/${item.id}/result?v=${bust}`;
    frame = `<img src="${src}" alt="${esc(item.filename)}" loading="lazy">`;
  } else if (item.status === "error") {
    frame = `<span>Ошибка</span>`;
  } else if (item.status === "processing") {
    frame = `<span>Обрабатывается…</span>`;
  } else {
    frame = `<span>В очереди</span>`;
  }

  const badges = [];
  const qc = item.qc;

  if (item.status === "error") {
    badges.push(`<span class="badge fail">не обработано</span>`);
  } else if (qc?.verdict === "ok") {
    badges.push(`<span class="badge ok">проверено</span>`);
  } else if (qc?.verdict === "warn") {
    badges.push(`<span class="badge warn">на проверку</span>`);
  } else if (qc?.verdict === "fail") {
    badges.push(`<span class="badge fail">брак</span>`);
  } else if (qc?.verdict === "error") {
    badges.push(`<span class="badge err">проверка не прошла</span>`);
  } else if (qc?.verdict === "skipped") {
    badges.push(`<span class="badge neutral">без проверки</span>`);
  }

  (qc?.issues || []).forEach((code) =>
    badges.push(`<span class="badge warn">${esc(ISSUE_LABELS[code] || code)}</span>`),
  );
  (item.warnings || []).forEach((code) =>
    badges.push(`<span class="badge neutral">${esc(WARNING_LABELS[code] || code)}</span>`),
  );

  const comment = item.error || qc?.error || qc?.comment || qc?.part_description || "";
  const name = item.output_name || item.filename;
  const editable = item.status === "done";

  return `
    <article class="tile">
      <div class="frame${item.status === "done" ? "" : " pending"}">${frame}</div>
      <div class="body">
        <input class="name" data-id="${item.id}" value="${esc(name)}" ${editable ? "" : "disabled"}>
        <div class="badges">${badges.join("")}</div>
        ${comment ? `<p class="comment">${esc(comment)}</p>` : ""}
        <div class="actions">
          <button type="button" class="ghost" data-retry="${item.id}" data-matting="0">Повторить</button>
          <button type="button" class="ghost" data-retry="${item.id}" data-matting="1">С alpha matting</button>
        </div>
      </div>
    </article>`;
}

async function renameItem(itemId, value) {
  const body = new FormData();
  body.append("output_name", value);
  await fetch(`/api/jobs/${state.job.id}/items/${itemId}`, { method: "PATCH", body });
}

async function retryItem(itemId, matting) {
  await fetch(
    `/api/jobs/${state.job.id}/items/${itemId}/retry?alpha_matting=${matting ? "true" : "false"}`,
    { method: "POST" },
  );
  startPolling();
}

// ---------- утилиты ----------

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function showError(node, message) {
  node.textContent = message;
  node.classList.remove("hidden");
}

init();
