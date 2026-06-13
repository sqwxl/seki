import { chromium, firefox } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const browsers = { chromium, firefox };

function parseArgs(argv) {
  const args = {
    browser: process.env.SEKI_TAB_BENCH_BROWSER ?? "firefox",
    url: process.env.SEKI_TAB_BENCH_URL ?? "http://localhost:3333/games/47",
    headed: process.env.SEKI_TAB_BENCH_HEADED === "1",
    outDir: process.env.SEKI_TAB_BENCH_OUT_DIR ?? "/tmp",
    width: Number(process.env.SEKI_TAB_BENCH_WIDTH ?? 390),
    height: Number(process.env.SEKI_TAB_BENCH_HEIGHT ?? 844),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--browser" && next) {
      args.browser = next;
      i += 1;
    } else if (arg === "--headed") {
      args.headed = true;
    } else if (arg === "--out-dir" && next) {
      args.outDir = next;
      i += 1;
    } else if (arg === "--viewport" && next) {
      const [width, height] = next.split("x").map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        args.width = width;
        args.height = height;
      }
      i += 1;
    } else if (!arg.startsWith("--")) {
      args.url = arg;
    }
  }

  if (!browsers[args.browser]) {
    throw new Error(
      `Unsupported browser "${args.browser}". Use firefox or chromium.`,
    );
  }

  return args;
}

async function installInstrumentation(page) {
  await page.evaluate(() => {
    window.__sekiErrors = [];
    window.__sekiLongTasks = [];
    window.__sekiMeasures = [];

    const originalStringify = JSON.stringify;
    JSON.stringify = function patchedStringify(...args) {
      const start = performance.now();
      const result = originalStringify.apply(this, args);
      const duration = performance.now() - start;

      if (duration > 10) {
        window.__sekiMeasures.push({
          kind: "JSON.stringify",
          duration,
          size: typeof result === "string" ? result.length : 0,
        });
      }

      return result;
    };

    const storageProto = Storage.prototype;
    const originalSetItem = storageProto.setItem;
    storageProto.setItem = function patchedSetItem(key, value) {
      const start = performance.now();
      const result = originalSetItem.call(this, key, value);
      const duration = performance.now() - start;

      if (duration > 10 || String(key).includes("analysis")) {
        window.__sekiMeasures.push({
          kind: "localStorage.setItem",
          key,
          duration,
          size: String(value).length,
        });
      }

      return result;
    };

    window.addEventListener("error", (event) => {
      window.__sekiErrors.push({ type: "error", message: event.message });
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__sekiErrors.push({
        type: "unhandledrejection",
        message: String(event.reason),
      });
    });

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__sekiLongTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Firefox currently does not support longtask entries.
      }
    }
  });
}

async function measureTabs(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => resolve(performance.now())),
      );
    const labels = [
      "Chat",
      "Board",
      "Chat",
      "Analysis",
      "Chat",
      "Board",
      "Analysis",
      "Board",
    ];
    const results = [];

    for (const label of labels) {
      const button = [
        ...document.querySelectorAll(".mobile-tab-bar button"),
      ].find((candidate) => candidate.title === label);

      if (!button) {
        results.push({ label, error: "missing button" });
        continue;
      }

      const before = performance.now();
      button.click();
      const afterClick = performance.now();
      const frame1 = await nextFrame();
      const frame2 = await nextFrame();
      await sleep(120);

      results.push({
        label,
        clickMs: afterClick - before,
        frame1Ms: frame1 - before,
        frame2Ms: frame2 - before,
        active: button.getAttribute("aria-pressed"),
        selectedText: document.body.innerText.slice(0, 200),
      });
    }

    return {
      url: location.href,
      title: document.title,
      results,
      longTasks: window.__sekiLongTasks ?? [],
      measures: window.__sekiMeasures ?? [],
      errors: window.__sekiErrors ?? [],
      body: document.body.innerText.slice(0, 1000),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserType = browsers[args.browser];
  const consoleMessages = [];
  const browser = await browserType.launch({ headless: !args.headed });
  const page = await browser.newPage({
    viewport: { width: args.width, height: args.height },
  });

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: error.message });
  });

  await page.goto(args.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.mobile-tab-bar button[title="Chat"]', {
    timeout: 10000,
  });
  await installInstrumentation(page);

  const metrics = await measureTabs(page);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `seki-live-tab-benchmark-${args.browser}-${stamp}`;
  const screenshotPath = path.join(args.outDir, `${baseName}.png`);
  const reportPath = path.join(args.outDir, `${baseName}.json`);

  await mkdir(args.outDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await browser.close();

  const report = {
    browser: args.browser,
    viewport: `${args.width}x${args.height}`,
    url: args.url,
    metrics,
    consoleMessages,
    screenshotPath,
    reportPath,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
