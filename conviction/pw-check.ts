/**
 * Headless browser smoke-test.
 * Visits each URL, collects console errors and uncaught page errors,
 * and exits non-zero if any are found.
 */
import { chromium } from "@playwright/test";

const PAGES = [
  { label: "/", url: "http://localhost:5173/" },
  { label: "/demo", url: "http://localhost:5173/demo" },
];

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  let anyError = false;

  for (const { label, url } of PAGES) {
    const page = await browser.newPage();
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      errors.push(`[pageerror] ${err.message}\n  ${err.stack?.split("\n")[1] ?? ""}`);
    });

    let status = 0;
    try {
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      status = res?.status() ?? 0;
    } catch (e: unknown) {
      errors.push(`[navigation] ${e instanceof Error ? e.message : String(e)}`);
    }

    // Wait a beat for any deferred JS errors
    await page.waitForTimeout(1500);

    if (errors.length || status !== 200) {
      console.log(`FAIL  ${label}  (HTTP ${status})`);
      for (const e of errors) console.log("  " + e);
      anyError = true;
    } else {
      console.log(`PASS  ${label}  (HTTP ${status})`);
    }

    await page.close();
  }

  await browser.close();
  process.exit(anyError ? 1 : 0);
})();
