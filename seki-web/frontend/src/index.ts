import { mountApp } from "./app";

mountApp();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
    (registration) => {
      console.log("SW registered:", registration.scope);
    },
    (err) => {
      console.log("SW registration failed:", err);
    },
  );
}
