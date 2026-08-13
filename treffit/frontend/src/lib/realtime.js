/**
 * WebSocket client with backoff reconnect and a heartbeat.
 *
 * Subscribers get every server event; each screen filters what it cares
 * about. Sending is limited to typing/ping — messages go over HTTP so the
 * reveal counter has a single code path on the server.
 */

import { websocketUrl } from "../api/client";

const MAX_BACKOFF_MS = 15000;
const HEARTBEAT_MS = 25000;

class Realtime {
  constructor() {
    this.socket = null;
    this.listeners = new Set();
    this.attempt = 0;
    this.heartbeat = null;
    this.closedByUs = false;
  }

  connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
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
    this.attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempt, 5));
    setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    this.closedByUs = true;
    clearInterval(this.heartbeat);
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
