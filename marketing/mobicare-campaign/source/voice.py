"""Generate the narration for each scene with Kokoro (Apache-2.0), then build each video's timeline.

Usage: python3 source/voice.py   (run from marketing/mobicare-campaign)
Needs: pip install kokoro-onnx soundfile; the model and voices in source/tts/ (see README).
"""
import json, os, re
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "source", "narration.json")))
TTS = os.path.join(ROOT, "source", "tts")
SR = 24000
TAIL = 0.7  # breathing room after each line

# Spoken forms, so names are pronounced naturally.
SAY = [(r"mobicaresl\.com", "mobi care S L dot com"), (r"MobiCare", "Mobi Care"), (r"AfriMoney", "Afri Money")]


def spoken(text):
    for a, b in SAY:
        text = re.sub(a, b, text)
    return text


def captions(text, start, dur):
    """Caption chunks: one sentence at a time; long sentences split into balanced parts (max ~44 characters),
    preferring a break after a comma. Each chunk is timed by its share of the characters."""
    sentences = re.split(r"(?<=[.?!])\s+", text)
    # join very short neighbouring sentences ("Less searching. Less guessing.")
    merged = []
    for sen in sentences:
        if merged and (len(merged[-1]) <= 16 or len(sen) <= 16) and len(merged[-1]) + len(sen) + 1 <= 44:
            merged[-1] += " " + sen
        else:
            merged.append(sen)
    sentences = merged
    chunks = []
    for sen in (x.strip() for x in sentences if x.strip()):
        if len(sen) <= 44:
            chunks.append(sen); continue
        words = sen.split(); parts = -(-len(sen) // 44)
        target = len(sen) / parts; cur = []
        for i, w in enumerate(words):
            cur.append(w)
            length = len(" ".join(cur)); rest = len(" ".join(words[i + 1:]))
            if rest and len(chunks) >= 0 and ((length >= target * 0.85 and w.endswith(",")) or length >= target) and rest > 8:
                chunks.append(" ".join(cur)); cur = []
        if cur:
            if chunks and len(" ".join(cur)) <= 8: chunks[-1] += " " + " ".join(cur)
            else: chunks.append(" ".join(cur))
    total = sum(len(c) for c in chunks)
    out, t = [], start
    for c in chunks:
        d = dur * len(c) / total
        out.append({"text": c, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return out


def main():
    k = Kokoro(os.path.join(TTS, "kokoro-q8.onnx"), os.path.join(TTS, "voices.bin"))
    for vid, v in CFG["videos"].items():
        t, timeline, track = 0.0, [], []
        for sc in v["scenes"]:
            audio, sr = k.create(spoken(sc["text"]), voice=CFG["voice"], speed=CFG["speed"], lang="en-us")
            assert sr == SR
            # Trim leading and trailing silence.
            nz = np.where(np.abs(audio) > 0.01)[0]
            audio = audio[max(0, nz[0] - 240): nz[-1] + 1200]
            dur = len(audio) / SR
            length = max(sc["min"], sc["lead"] + dur + TAIL)
            vo_start = t + sc["lead"]
            timeline.append({**sc, "start": round(t, 3), "end": round(t + length, 3), "vo_start": round(vo_start, 3), "vo_dur": round(dur, 3),
                             "captions": captions(sc["text"], vo_start, dur)})
            track.append((vo_start, audio))
            t += length
        total = t
        mix = np.zeros(int((total + 0.5) * SR), dtype=np.float32)
        for st, a in track:
            i = int(st * SR); mix[i:i + len(a)] += a
        mix = mix / max(1e-6, np.abs(mix).max()) * 0.89
        os.makedirs(os.path.join(ROOT, "audio"), exist_ok=True)
        sf.write(os.path.join(ROOT, "audio", f"{vid}-voiceover.wav"), mix, SR)
        json.dump({"id": vid, "title": v["title"], "music": v["music"], "duration": round(total, 3), "scenes": timeline},
                  open(os.path.join(ROOT, "build", f"{vid}.timeline.json"), "w"), indent=1)
        print(vid, f"{total:.1f}s", [f'{s["id"]}:{s["end"]-s["start"]:.1f}' for s in timeline])


if __name__ == "__main__":
    main()
