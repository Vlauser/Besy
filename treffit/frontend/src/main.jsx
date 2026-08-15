import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installErrorReporting, reportClientError } from "./lib/errors.js";
import "./index.css";

installErrorReporting();

// Сторож на странице ждёт признака, что приложение ожило. Ставим его до
// отрисовки: если она упадёт, признака не будет и сторож покажет запасной
// экран.
try {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  window.__treffitMounted = true;
} catch (error) {
  reportClientError(error?.message || "не удалось запустить приложение", {
    source: "монтирование",
    stack: error?.stack,
  });
  throw error;
}
