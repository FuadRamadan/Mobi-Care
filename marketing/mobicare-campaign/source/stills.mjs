// Contact sheet of one frame per scene (mid-scene), for checking layout before a full render.
import { chromium } from "playwright";
import fs from "fs"; import path from "path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const id = process.argv[2], at = Number(process.argv[3] || 0.6);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, `build/${id}.timeline.json`), "utf8"));
const shots = JSON.parse(fs.readFileSync(path.join(ROOT, "source/shots.json"), "utf8"))[id] || {};
const svgInner = (f) => fs.readFileSync(path.join(ROOT, "assets/brand", f), "utf8").replace(/<title>.*?<\/title>/, "");
const logoW = svgInner("MobiCare-logo-horizontal-white.svg").replace(/width="[^"]*" height="[^"]*"/, 'width="100%"');
const pin = svgInner("MobiCare-pin.svg").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const apps = fs.readdirSync(path.join(ROOT, "assets/app")).filter((f) => f.endsWith(".png"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto("file://" + path.join(ROOT, "source/stage.html"));
await p.evaluate(() => document.fonts.ready);
await p.evaluate(async (list) => { window.__imgs = []; for (const f of list) { const i = new Image(); i.src = "../assets/app/" + f; await i.decode().catch(() => new Promise((r) => { i.onload = r; i.onerror = r; })); window.__imgs.push(i); } }, apps);
await p.evaluate(([c, s, w, pn]) => window.setup(c, s, w, w, pn), [cfg, shots, logoW, pin]);
fs.mkdirSync(path.join(ROOT, "build/stills"), { recursive: true });
for (const [i, sc] of cfg.scenes.entries()) {
  const t = sc.start + (sc.end - sc.start) * at;
  await p.evaluate((t) => window.renderFrame(t), t);
  await p.waitForTimeout(80);
  await p.screenshot({ path: path.join(ROOT, `build/stills/${id}-${String(i).padStart(2, "0")}-${sc.id}.jpg`), type: "jpeg", quality: 80 });
}
await b.close();
