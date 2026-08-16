/**
 * WebSocket client with backoff reconnect and a heartbeat.
 *
 * Subscribers get every server event; each screen filters what it cares
 * about. Sending is limited to typing/ping — messages go over HTTP so the
 * reveal counter has a single code path on the server.
 */

import { websocketUrl } from "../api/client.js";

const MAX_BACKOFF_MS = 15000;
const HEARTBEAT_MS = 25000;

class Realtime {
  constructor() {
    this.socket = null;
    this.listeners = new Set();
    this.attempt = 0;
    this.heartbeat = null;
    this.closedByUs = false;
    this.retryTimer = null;
    this.foregroundWatched = false;
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.watchForeground();
    try {
      this.socket = new WebSocket(websocketUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.attempt = 0;
      this.emit({ type: "connection", state: "online" });
      this.heartbeat = setInterval(() => this.send({ type: "ping" }), HEARTBEAT_MS);
    };
    this.socket.onmessage = (event) => {
      try {
        this.emit(JSON.parse(event.data));
      } catch {
        // Ignore frames that are not JSON.
      }
    };
    this.socket.onclose = () => {
      clearInterval(this.heartbeat);
      this.emit({ type: "connection", state: "offline" });
      if (!this.closedByUs) this.scheduleReconnect();
    };
    this.socket.onerror = () => this.socket?.close();
  }

  scheduleReconnect() {
    // Один таймер на все попытки. Без этого каждый onclose и каждый
    // неудавшийся connect добавляли свой, и после десятка сворачиваний
    // приложение долбилось в сокет пачками вместо выдержанной паузы.
    if (this.retryTimer) return;
    this.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempt, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Вернулись в приложение — проверить, жив ли сокет.
   *
   *  Telegram усыпляет веб-вью, а не закрывает: сокет к этому моменту уже
   *  мёртв, но события `close` не приходило, и мы честно считали себя
   *  подключёнными. Внешне это выглядело так, что сообщения перестают
   *  приходить, пока приложение не перезапустишь.
   */
  watchForeground() {
    if (this.foregroundWatched || typeof document === "undefined") return;
    this.foregroundWatched = true;
    const revive = () => {
      if (this.closedByUs || document.hidden) return;
      const state = this.socket?.readyState;
      if (state === WebSocket.OPEN) {
        // Живой на вид сокет может оказаться мёртвым: пинг это покажет,
        // и обрыв придёт обычным путём через onclose.
        this.send({ type: "ping" });
        return;
      }
      if (state !== WebSocket.CONNECTING) {
        // Возврат в приложение — не отказ сервера: ждать выдержанную паузу
        // здесь незачем, подключаемся сразу.
        this.attempt = 0;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.connect();
      }
    };
    document.addEventListener("visibilitychange", revive);
    window.addEventListener("focus", revive);
    window.addEventListener("online", revive);
  }

  disconnect() {
    this.closedByUs = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  typing(chatId, state) {
    this.send({ type: "typing", chat_id: chatId, state });
  }

  subscribe(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(event) {
    this.listeners.forEach((handler) => handler(event));
  }
}

export const realtime = new Realtime();
