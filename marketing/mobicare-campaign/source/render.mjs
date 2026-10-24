// Renders each video frame by frame from stage.html, then encodes it with the audio mix.
// Usage: node source/render.mjs [video-id ...]   (from marketing/mobicare-campaign)
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FPS = 30, WORKERS = 3;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["01-the-problem", "02-meet-mobicare", "03-the-solution"];
const shotsAll = JSON.parse(fs.readFileSync(path.join(ROOT, "source/shots.json"), "utf8"));
const svgInner = (f) => fs.readFileSync(path.join(ROOT, "assets/brand", f), "utf8").replace(/<title>.*?<\/title>/, "");
const logoW = svgInner("MobiCare-logo-horizontal-white.svg").replace(/width="[^"]*" height="[^"]*"/, 'width="100%"');
const logoC = svgInner("MobiCare-logo-horizontal-colour.svg").replace(/width="[^"]*" height="[^"]*"/, 'width="100%"');
const pin = svgInner("MobiCare-pin.svg").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const apps = fs.readdirSync(path.join(ROOT, "assets/app")).filter((f) => f.endsWith(".png"));
const executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath });

async function page(cfg, shots) {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto("file://" + path.join(ROOT, "source/stage.html"));
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(async (list) => { window.__imgs = []; for (const f of list) { const i = new Image(); i.src = "../assets/app/" + f; await i.decode().catch(() => new Promise((r) => { i.onload = r; i.onerror = r; })); window.__imgs.push(i); } }, apps);
  await p.evaluate(([c, s, w, cc, pn]) => window.setup(c, s, w, cc, pn), [cfg, shots, logoW, logoC, pin]);
  return p;
}

for (const id of ids) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, `build/${id}.timeline.json`), "utf8"));
  const dir = path.join(ROOT, `build/frames-${id}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(cfg.duration * FPS);
  const pages = await Promise.all(Array.from({ length: WORKERS }, () => page(cfg, shotsAll[id] || {})));
  const t0 = Date.now();
  await Promise.all(pages.map(async (p, w) => {
    for (let f = w; f < n; f += WORKERS) {
      await p.evaluate((t) => window.renderFrame(t), f / FPS);
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await p.screenshot({ path: path.join(dir, String(f).padStart(5, "0") + ".jpg"), type: "jpeg", quality: 93 });
    }
  }));
  await Promise.all(pages.map((p) => p.close()));
  console.log(id, n, "frames in", ((Date.now() - t0) / 1000).toFixed(0), "s");
  const out = path.join(ROOT, `${id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "%05d.jpg"), "-i", path.join(ROOT, `audio/${id}-mix.wav`),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS),
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", out]);
  console.log("wrote", out);
}
await browser.close();
