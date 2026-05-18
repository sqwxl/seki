import { ensureWasm } from "./goban/init-wasm";
import { mountApp } from "./app";

void import("./goban/create-board");

ensureWasm().then(mountApp);

if (__DEV__) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
    (registration) => {
      console.log("SW registered:", registration.scope);
    },
    (err) => {
      console.log("SW registration failed:", err);
    },
  );
}
