"""Writes scripts/ and storyboards/ from the timelines, so the documents always match the render.
Usage: python3 source/docs.py  (after source/voice.py; storyboard sheets need build/stills from stills.mjs)
"""
import glob, json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = json.load(open(os.path.join(ROOT, "source", "shots.json")))

VISUAL = {
    "01-the-problem": {
        "hook": "Illustration: a clinic shelf with empty spaces; a prescription slides up; an OUT OF STOCK stamp lands.",
        "walk": "Illustration: a woman walks along a Freetown street past three pharmacies (side-scrolling parallax, Lion Mountains behind); speech bubbles: Not today / Try the next one / Out of stock.",
        "time": "Illustration: a clock spins while the sky turns from afternoon to night; bubbles: Transport fare / Another hour / Still searching.",
        "call": "Illustration: she calls friends; chat bubbles: Do you know where to find it? / Not sure… / Maybe try Lumley? / Still nothing.",
        "wait": "Illustration: evening interior; a family member resting in bed under a lamp, another waiting.",
        "insight": "Illustration: stylised peninsula map; her search path draws on; pharmacy pins pop in; one lights up with It was here.",
        "turn": "Illustration: the pins gather into a phone showing the MobiCare pin.",
        "end": "End card: MobiCare logo, A simpler way to find medicines., mobicaresl.com.",
    },
    "02-meet-mobicare": {
        "hook": "Brand open: MobiCare logo, MEET MOBICARE, headline.",
        "end": "End card: Discover MobiCare, logo, Search, order and follow your medicines., mobicaresl.com.",
    },
    "03-the-solution": {
        "story": "Illustration: warm home; Fatmata with her son; prescription on the table; bubble: Fever since this morning.",
        "relief": "Illustration: same home in morning light; the medicine bag on the table; the boy playing.",
        "values": "Three cards with check marks: Licensed pharmacies (verified by MobiCare) · Prescriptions checked (by a pharmacist, before you pay) · Prices you can see (before you order).",
        "end": "End card: logo, Find your way to medicines., mobicaresl.com, Explore MobiCare today, disclaimer that MobiCare does not replace advice from a doctor or pharmacist.",
    },
}
MUSIC = {"reflective": "reflective piano and pad, A minor, 64 bpm", "confident": "confident pluck arpeggio, light kick and shaker, F major, 104 bpm", "warm": "warm pluck arpeggio and pad, D major, 84 bpm; gentle shaker from the relief scene"}


def app_note(vid, sid):
    sh = SHOTS.get(vid, {}).get(sid)
    if not sh or "frames" not in sh: return "None (illustration or brand card)"
    frames = " → ".join(f[1] for f in sh["frames"])
    extra = []
    if sh.get("taps"): extra.append(f"{len(sh['taps'])} tap highlight(s)")
    if sh.get("callouts"): extra.append("callouts: " + ", ".join(c[3] for c in sh["callouts"]))
    if len(sh.get("zoom", [])) > 1: extra.append("slow push-in on the relevant element")
    return f"Real app captures (assets/app): {frames}" + (f"; {'; '.join(extra)}" if extra else "")


def main():
    os.makedirs(os.path.join(ROOT, "scripts"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "storyboards"), exist_ok=True)
    for i, path in enumerate(sorted(glob.glob(os.path.join(ROOT, "build", "*.timeline.json"))), 1):
        tl = json.load(open(path)); vid = tl["id"]
        md = [f"# Video {i}: {tl['title']}", "", f"File: `{vid}.mp4` · {tl['duration']:.1f} seconds · 1080 × 1920 · 30 fps", "",
              f"Voice: Kokoro `af_heart` (female, warm American English) · Music: {MUSIC[tl['music']]} (original, synthesised)", "", "## Narration", ""]
        md += [s["text"] for s in tl["scenes"]]
        md += ["", "## Scene by scene", "", "| # | Time | Narration | Visual | App footage | On-screen text | Transition / animation | Sound |", "|---|---|---|---|---|---|---|---|"]
        for n, s in enumerate(tl["scenes"], 1):
            vis = VISUAL.get(vid, {}).get(s["id"]) or "Phone mockup with the real MobiCare screen; headline above; captions below."
            sound = "whoosh in" if n > 1 else "music fades in"
            sh = SHOTS.get(vid, {}).get(s["id"], {})
            if sh.get("taps"): sound += "; tap clicks"
            if sh.get("callouts") or sh.get("pops"): sound += "; soft pops"
            if sh.get("ticks"): sound += "; clock ticks"
            if s["id"] == "end": sound += "; closing chime"
            md.append(f"| {n} | {s['start']:.1f}–{s['end']:.1f}s | {s['text']} | {vis} | {app_note(vid, s['id'])} | {s['onscreen']} | 0.45 s cross-fade with a slight push; words rise in one by one | {sound} |")
        md += ["", "Captions are burned in, timed to the narration (see the timeline file in build/)."]
        open(os.path.join(ROOT, "scripts", f"video-0{i}-script.md"), "w").write("\n".join(md) + "\n")
        # storyboard sheet
        fs = sorted(glob.glob(os.path.join(ROOT, "build", "stills", f"{vid}-*.jpg")))
        if fs:
            cols = 4; rows = (len(fs) + cols - 1) // cols
            S = Image.new("RGB", (cols * 330 + 10, rows * 640 + 10), "#F4F7F5"); d = ImageDraw.Draw(S)
            for k, f in enumerate(fs):
                im = Image.open(f).resize((320, 569)); x = 10 + (k % cols) * 330; y = 10 + (k // cols) * 640
                S.paste(im, (x, y)); sc = tl["scenes"][k]
                d.text((x, y + 575), f"{k + 1}. {sc['id']}  {sc['start']:.1f}–{sc['end']:.1f}s", fill="#0B3D2E")
                d.text((x, y + 595), sc["onscreen"][:46], fill="#4A5E57")
            S.save(os.path.join(ROOT, "storyboards", f"video-0{i}-storyboard.jpg"), quality=88)
        print("wrote", vid)


if __name__ == "__main__":
    main()
