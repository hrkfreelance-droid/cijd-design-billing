import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 320, height: 720 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { localStorage.setItem("cijd.locale","ja"); localStorage.setItem("cijd.theme","light"); });
const p = await ctx.newPage();
for (const [n, path] of [["today","/"],["projects","/projects"],["billing","/billing"],["archive","/archive"]]) {
  await p.goto("http://localhost:3000"+path, { waitUntil: "networkidle" });
  await p.waitForSelector("h1"); await p.waitForTimeout(400);
  await p.screenshot({ path: `.shots/narrow-${n}.png` });
}
await b.close(); console.log("ok");
