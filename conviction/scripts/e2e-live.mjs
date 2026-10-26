// Usage: npm run e2e:live [-- --url https://conviction-brown.vercel.app] [--cycles 2]
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const baseUrl = opt("--url", process.env.E2E_URL ?? "https://conviction-brown.vercel.app").replace(/\/$/, "");
const cycles = Number(opt("--cycles", 2));
const refreshMs = Number(opt("--refresh-ms", 30_000));
const pages = [
  ["Home", "/demo"],
  ["Markets", "/demo/markets"],
  ["Vault", "/demo/vault"],
  ["Portfolio", "/demo/portfolio"],
  ["Agents", "/demo/agents"],
];
const rpcPattern = /rpc\.testnet\.arc\.io/;
const problems = [];

async function run(mode) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let rpcRequests = 0;
  let rpcCalls = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && rpcPattern.test(request.url())) {
      rpcRequests += 1;
      try {
        const body = JSON.parse(request.postData() ?? "null");
        rpcCalls += Array.isArray(body) ? body.length : 1;
      } catch { rpcCalls += 1; }
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`[${mode}] console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`[${mode}] page error: ${error.message}`));
  page.on("response", async (response) => {
    if (rpcPattern.test(response.url()) && response.status() === 429) problems.push(`[${mode}] RPC 429 from ${response.url()}`);
  });

  await page.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
  if (mode === "live") await page.getByRole("button", { name: "Use on-chain data" }).click();
  const startRequests = rpcRequests;
  for (const [label, path] of pages) {
    if (path !== "/demo") await page.locator(`a[href="${path}"]`).first().click();
    await page.waitForURL(`**${path}`);
    await page.waitForTimeout(mode === "live" ? 6_000 : 1_000);
    const alerts = await page.locator('[role="alert"]:not(#__next-route-announcer__), .stale-notice').allInnerTexts();
    for (const text of alerts.filter((item) => item.trim())) problems.push(`[${mode}] ${label}: banner "${text.trim().slice(0, 160)}"`);
    const body = await page.locator("body").innerText();
    if (/rate limit|exceeds defined limit|Live Arc reads failed/i.test(body)) problems.push(`[${mode}] ${label}: rate-limit/read error text on page`);
    console.log(`[${mode}] ${label}: ok`);
  }
  if (mode === "live") {
    await page.locator('a[href="/demo/vault"]').first().click();
    const before = rpcRequests;
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      await page.waitForTimeout(refreshMs + 3_000);
      const body = await page.locator("body").innerText();
      if (/rate limit|exceeds defined limit|Live Arc reads failed/i.test(body)) problems.push(`[live] refresh cycle ${cycle}: rate-limit/read error text`);
      const alerts = await page.locator('[role="alert"]:not(#__next-route-announcer__), .stale-notice').allInnerTexts();
      for (const text of alerts.filter((item) => item.trim())) problems.push(`[live] refresh cycle ${cycle}: banner "${text.trim().slice(0, 160)}"`);
    }
    console.log(`[live] RPC POSTs during navigation: ${before - startRequests}; during ${cycles} idle refresh cycles: ${rpcRequests - before}`);
  }
  console.log(`[${mode}] RPC HTTP requests total: ${rpcRequests} (JSON-RPC calls inside: ${rpcCalls})`);
  await browser.close();
}

await run("mock");
await run("live");
if (problems.length > 0) {
  console.error(`\nFAILED with ${problems.length} problem(s):`);
  for (const problem of new Set(problems)) console.error(` - ${problem}`);
  process.exit(1);
}
console.log("\nE2E passed: no console errors, rate-limit errors or error banners.");
