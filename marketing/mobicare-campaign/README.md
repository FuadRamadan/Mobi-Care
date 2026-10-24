# MobiCare brand awareness campaign: three vertical videos

| File | Title | Length | Status |
|---|---|---|---|
| `01-the-problem.mp4` | Getting Medicines Shouldn't Be This Difficult | 54.5 s | Rendered and quality-checked |
| `02-meet-mobicare.mp4` | Meet MobiCare | 66.0 s | Rendered and quality-checked |
| `03-the-solution.mp4` | Medicine Access, Made Simpler | 58.5 s | Rendered and quality-checked |

**Export:** 1080 × 1920 (9:16), 30 fps, H.264 High profile (CRF 18), AAC 192 kbps 48 kHz, loudness normalised to −14 LUFS, captions burned in, `faststart` for social sharing.
File sizes: 01-the-problem.mp4 10.4 MB · 02-meet-mobicare.mp4 32.5 MB · 03-the-solution.mp4 22.1 MB

## The campaign

Three connected videos for Instagram and Facebook Reels, TikTok and WhatsApp:

1. **The problem**: when a clinic runs out, a family searches from pharmacy to pharmacy, losing time and money, while someone waits at home. The medicine may be close; the information isn't. Ends on *A simpler way to find medicines.*
2. **The product**: the real MobiCare patient app, step by step: search, nearest licensed pharmacies with price and stock, brands and origin, delivery or collection, the delivery fee shown before paying, mobile-money payment, order tracking, and prescription upload checked by a pharmacist.
3. **The benefit**: Fatmata's son is unwell; instead of walking, she sends the prescription through MobiCare; a pharmacist confirms; she pays and follows the order. Ends on *Find your way to medicines with MobiCare.*

Exact narration and scene-by-scene plans are in `scripts/`; storyboard sheets are in `storyboards/`.

## What is real and what is illustrative

- **App footage is genuine.** Every phone screen is a capture of the real MobiCare patient app (repository `FuadRamadan/Mobi-Care`, branch `update-2026-10-16-delivery-by-distance`), run locally with the project's own `deploy/local/run.sh` and the seeded **test data**: the patient "Aminata", the pharmacy "City Pharmacy, Lumley" and the sample prescription are demonstration data, and every app scene says so on screen ("Real MobiCare screens · demonstration data"). No screen was edited or invented.
- **The payment page is not shown.** In local runs payment goes through a test stand-in for Monime, so the videos show MobiCare's own checkout ("Pay securely online… Orange Money, AfriMoney, a card or a bank account") and the order page after payment, not the stand-in.
- **Two local test-data adjustments:** the seeded delivery zones were renamed from "West Freetown (demo)" to "West Freetown" in the *local* database only, and the map tiles could not load offline, so the checkout map is framed out by the camera moves. No application code was changed.
- **B-roll is illustration, not footage.** Licensed stock-footage sites (Pexels, Pixabay, Unsplash, Wikimedia) and AI video tools were not reachable from the production environment, so the human scenes are original flat illustrations (Freetown street with the Lion Mountains, a clinic shelf, a home, a stylised map of the peninsula). They are clearly illustrative and do not imitate footage of real people or real pharmacies.

## Claims checked against the product

Every functional statement is supported by the running app:

| Statement | Where it is verified |
|---|---|
| Licensed pharmacies; nearest first; price and stock | Search results ("Nearest pharmacies first…", distance, price range, "in stock") |
| Compare brands, makers and origin; add to cart | "See options" lists brand, maker, country, price, stock, "Add to cart" |
| Delivery by a MobiCare rider, or collection | Checkout: "Delivery · A rider brings it to you" / "Collection · Pick up at the pharmacy" |
| Delivery fee shown before paying, based on distance | Checkout: "Delivery to … about 2.5 km: Le 35 · Priced by the distance…" |
| Orange Money, AfriMoney, card or bank | Checkout: "Next you'll pay on Monime's secure page with Orange Money, AfriMoney, a card or a bank account" |
| Follow the order | Order page steps: Payment received → Pharmacy confirmed → Being prepared → … |
| Photo of a prescription, cover personal details, sent to nearby pharmacies | Upload prescription: Photo / Cover name / Send; "Pharmacies near you see it…" |
| A pharmacist checks it; you choose quantities, then pay | "The pharmacist checked your prescription"; "At checkout you can lower a quantity, choose delivery or collection, and pay" |
| Open in the phone's browser at mobicaresl.com; no download needed | The patient app is a web app at `/app`; `mobicaresl.com` is the configured public URL (`artifacts/api-server/src/lib/monime/config.ts`) |

Deliberately **not** claimed: that every medicine is always available, that delivery is guaranteed or instant, any price or impact figures, or that MobiCare replaces doctors or pharmacists (video 3 ends with a disclaimer saying it does not).

> **Before release:** the live site still runs the 11 October build. *Upload prescription*, distance-based delivery fees and "Not selling now" are on the newer branches. Publish the latest branch to mobicaresl.com before posting videos 2 and 3, or viewers will not find these features.

## Assets and licences

| Asset | Source | Licence |
|---|---|---|
| App screens (`assets/app/`) | Captured from the MobiCare app (local test data) | MobiCare's own |
| Logos, pin (`assets/brand/*.svg`) | MobiCare brand files | MobiCare's own |
| Fonts: Outfit, DM Sans | Google Fonts (the app's own display and text fonts) | SIL Open Font License 1.1 |
| Voice-over | Generated with **Kokoro-82M** (voice `af_heart`), q8 ONNX weights from npm `kokoro-q8-shards`, voices from npm `kokoro-local-runtime`; run offline with `kokoro-onnx` | Apache 2.0 (`source/tts/LICENSE-Kokoro-Apache-2.0.txt`); no attribution required in the video |
| Music and sound effects | Synthesised in `source/audio.py` | Original, owned by MobiCare |
| Illustrations | Drawn in code in `source/stage.html` | Original, owned by MobiCare |

No stock footage, stock music, social-media clips or watermarked material is used.

**Voice note:** no convincing Sierra Leonean or West African accent was available in an authorised model, so the narration uses a warm, clear American English female voice rather than a forced accent. To use a local voice artist instead, record the lines in `scripts/` (one file per scene, or one take per video) and replace `audio/<video>-voiceover.wav`; the timeline will need re-timing (`source/voice.py` can be adapted to read recordings).

## Folder

```
01-the-problem.mp4, 02-meet-mobicare.mp4, 03-the-solution.mp4   finished videos
scripts/        narration and scene-by-scene production plans
storyboards/    one frame per scene, per video
audio/          voice-over, music and final mix per video (WAV)
assets/app/     real app captures   assets/brand/  logos and fonts
source/         narration.json, shots.json, voice.py, audio.py, stage.html, render.mjs, stills.mjs, docs.py
build/          timelines, stills and frames (generated; safe to delete)
```

## Rendering again

From `marketing/mobicare-campaign/` (needs Python 3 with `numpy`, `soundfile`, `kokoro-onnx`; Node 22; ffmpeg; a Chromium for Playwright):

```bash
pip install kokoro-onnx soundfile numpy
bash source/tts/get-model.sh                 # voice model (not in git: 92 MB), from npm
cd source && npm install && cd ..            # Playwright for the renderer
python3 source/voice.py                       # narration + timelines   (edit source/narration.json first)
python3 source/audio.py                       # music, sound effects, mix
node source/stills.mjs 02-meet-mobicare 0.7   # optional: one still per scene to check layout
node source/render.mjs                        # frames + H.264/AAC MP4s (or name one video: node source/render.mjs 01-the-problem)
python3 source/docs.py                        # scripts/ and storyboards/
```

- Change words in `source/narration.json`; scene lengths follow the narration automatically (each scene's `min` sets a floor).
- Change app framing (zooms, taps, callouts) in `source/shots.json`; positions are fractions of the phone screen.
- Set `CHROMIUM_PATH` if Chromium is not at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- To refresh app footage, run the app locally (`bash deploy/local/run.sh --monime`) and re-capture the screens listed in `assets/app/` at 390 × 844, 3× scale.

## Quality check

All three videos were rendered and checked on 24 October 2026:

- **Format:** 1080 × 1920, 30 fps, H.264 High, yuv420p, AAC stereo 48 kHz (ffprobe).
- **No black frames** (ffmpeg `blackdetect`, threshold 0.15 s) and **no frozen stretches** of 2 s or more (`freezedetect`). The fade from black lasts 0.5 s at the start and 0.6 s at the end.
- **Audio:** integrated loudness −15.6 to −16.2 LUFS, true peak about −4 dBFS, no clipping. The music sits about 20 dB under the narration and ducks further while she speaks.
- **Captions:** generated from the same timeline as the narration. Each line starts when its spoken line starts and is split at sentence or comma boundaries.
- **Visual pass:** one frame every 1.5 s was inspected for each video (layout, caption legibility, transitions, spelling of MobiCare and mobicaresl.com). Issues found in the first render were fixed and re-rendered: captions splitting mid-phrase, overlapping headlines during cross-fades, near-static illustration scenes, and an empty map placeholder.
- **Known limits:**
  - The checkout map shows as a light-grey panel, because map tiles could not load offline. It is mostly framed out, but briefly visible in the "fee" and "cart" shots.
  - The voice is a synthetic voice (Kokoro), not a human artist.
  - The illustrations are flat motion graphics, not live-action B-roll.
- **Not produced:** 16:9 versions (a secondary deliverable). They can be made by rendering `stage.html` at 1920 × 1080 with a side-by-side layout. Ask if you want them.
