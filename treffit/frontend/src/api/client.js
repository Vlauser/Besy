/**
 * API client: token handling, JSON plumbing, typed errors.
 *
 * The token lives in localStorage rather than Telegram CloudStorage because
 * it must be readable synchronously before the first render.
 */

import { getInitData } from "../lib/telegram";

const BASE = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "treffit.token";

let token = localStorage.getItem(TOKEN_KEY) || null;
const listeners = new Set();

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Fires when the server rejects the session, so the shell can re-auth. */
export function onUnauthorized(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export class ApiError extends Error {
  constructor(status, detail, payload) {
    super(detail || `Ошибка ${status}`);
    this.status = status;
    this.detail = detail;
    this.payload = payload;
  }
}

function describe(payload, status) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI validation errors arrive as a list of {loc, msg, type}.
  if (Array.isArray(detail) && detail.length) return detail[0]?.msg || `Ошибка ${status}`;
  return `Ошибка ${status}`;
}

/** Сколько ждать ответа. Без этого зависший сервер оборачивается вечным
 *  спиннером: `fetch` сам по себе не истекает никогда, промис не завершается,
 *  и экран так и остаётся в загрузке — ни ошибки, ни возможности повторить.
 *  Загрузка фотографии идёт дольше остальных запросов, ей срок отдельный. */
const TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 60000;

async function request(method, path, { body, formData, signal, timeout } = {}) {
  const headers = {};
  const hadToken = Boolean(token);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const limit = timeout ?? (formData ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  // Отмена снаружи должна работать наравне с таймаутом.
  const relay = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", relay, { once: true });
  }

  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch (error) {
    // Отмену вызывающим пробрасываем как есть — это не сбой.
    if (signal?.aborted) throw error;
    if (error.name === "AbortError") {
      throw new ApiError(0, "Сервер не отвечает — попробуйте ещё раз");
    }
    throw new ApiError(0, "Нет связи с сервером");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }

  if (response.status === 401) {
    setToken(null);
    // Only a *rejected* session is worth re-authenticating for. A 401 with
    // no token is the expected first call, and announcing it would send the
    // shell into a re-auth loop.
    if (hadToken) listeners.forEach((handler) => handler());
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response.status, describe(payload, response.status), payload);
  return payload;
}

export const api = {
  get: (path, options) => request("GET", path, options),
  post: (path, body, options) => request("POST", path, { ...options, body }),
  patch: (path, body, options) => request("PATCH", path, { ...options, body }),
  delete: (path, options) => request("DELETE", path, options),
  upload: (path, file) => {
    const formData = new FormData();
    formData.append("file", file);
    return request("POST", path, { formData });
  },
  /** Форма с полями и, возможно, файлом — одним запросом. */
  form: (path, fields, files = {}) => {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      // Пустое поле не отправляем: сервер отличает «не прислали» от
      // «прислали пустую строку», и второе ему пришлось бы разбирать.
      if (value !== undefined && value !== null && value !== "") formData.append(key, value);
    });
    Object.entries(files).forEach(([key, file]) => {
      if (file) formData.append(key, file);
    });
    return request("POST", path, { formData });
  },
};

/** Photo URLs come back path-only; the token rides in the query because
 *  <img> cannot send an Authorization header. */
export function mediaUrl(path) {
  if (!path) return null;
  const separator = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${separator}token=${encodeURIComponent(token || "")}`;
}

export function websocketUrl() {
  const base = BASE.startsWith("http")
    ? BASE
    : `${window.location.protocol}//${window.location.host}${BASE}`;
  const url = new URL(base.replace(/^http/, "ws") + "/ws");
  url.searchParams.set("token", token || "");
  return url.toString();
}

/* ---------------- endpoints ---------------- */

export const endpoints = {
  config: () => api.get("/config"),

  login: () => api.post("/auth/telegram", { init_data: getInitData() }),
  devLogin: (telegramId, firstName) =>
    api.post("/auth/telegram", { dev_telegram_id: telegramId, dev_first_name: firstName }),

  me: () => api.get("/me"),
  updateMe: (patch) => api.patch("/me", patch),
  consent: (consents) => api.post("/me/consent", consents),
  saveTest: (answers) => api.post("/me/test-answers", { answers }),
  uploadPhoto: (file) => api.upload("/me/photos", file),
  deletePhoto: (id) => api.delete(`/me/photos/${id}`),
  makePrimary: (id) => api.post(`/me/photos/${id}/primary`),
  deactivate: () => api.delete("/me"),

  verification: () => api.get("/me/verification"),
  startVerification: () => api.post("/me/verification/start"),
  submitVerification: (file) => api.upload("/me/verification/photo", file),

  discover: (limit = 10) => api.get(`/discover?limit=${limit}`),
  swipe: (userId, action) => api.post(`/discover/${userId}/swipe`, { action }),
  incomingLikes: () => api.get("/discover/likes"),
  incomingLikesCount: () => api.get("/discover/likes/count"),

  deck: () => api.get("/deck"),
  scratch: (cardId) => api.post(`/deck/${cardId}/scratch`),

  matches: () => api.get("/matches"),
  chats: () => api.get("/chats"),
  chat: (id) => api.get(`/chats/${id}`),
  messages: (id, beforeId) =>
    api.get(`/chats/${id}/messages${beforeId ? `?before_id=${beforeId}` : ""}`),
  sendMessage: (id, bodyText) => api.post(`/chats/${id}/messages`, { body: bodyText }),
  markRead: (id) => api.post(`/chats/${id}/read`),
  chatPhoto: (id) => api.get(`/chats/${id}/photo`),

  meetups: () => api.get("/meetups"),
  myMeetups: () => api.get("/meetups/mine"),
  meetupsGoing: () => api.get("/meetups/going"),
  createMeetup: (fields, image) => api.form("/meetups", fields, { image }),
  cancelMeetup: (id) => api.delete(`/meetups/${id}`),
  respondToMeetup: (id, action) => api.post(`/meetups/${id}/respond`, { action }),
  meetupResponses: (id) => api.get(`/meetups/${id}/responses`),
  acceptResponder: (id, userId) => api.post(`/meetups/${id}/responses/${userId}/accept`),

  events: () => api.get("/events"),
  attend: (id) => api.post(`/events/${id}/attend`),
  unattend: (id) => api.delete(`/events/${id}/attend`),
  checkin: (eventId, coords) => api.post("/live/checkin", { event_id: eventId, ...coords }),
  liveNearby: (eventId) => api.get(`/live/nearby?event_id=${eventId}`),

  block: (userId) => api.post("/safety/block", { user_id: userId }),
  report: (userId, reason, details) =>
    api.post("/safety/report", { user_id: userId, reason, details }),

  products: () => api.get("/payments/products"),
  invoice: (product) => api.post("/payments/invoice", { product }),
};
