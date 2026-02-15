import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import logo from "./assets/logo.png";
import "./styles.css";

document.title = "FAKA Performance";

const faviconLink =
  document.querySelector<HTMLLinkElement>("link[rel='icon']") ||
  document.createElement("link");
faviconLink.rel = "icon";
faviconLink.type = "image/png";
faviconLink.href = logo;
if (!faviconLink.parentNode) {
  document.head.appendChild(faviconLink);
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);