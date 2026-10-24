"""Original music, sound effects and the final mix for each video. Everything is synthesised here,
so there is no third-party music or sound to license.

Usage: python3 source/audio.py   (after source/voice.py)
Writes audio/<video>-music.wav and audio/<video>-mix.wav.
"""
import json, os
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = json.load(open(os.path.join(ROOT, "source", "shots.json")))
SR = 48000
rng = np.random.default_rng(7)

NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def hz(name):  # "A3" -> frequency
    n, o = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[n] + 12 * (o + 1) - 69) / 12)


def env(n, a, r):
    e = np.ones(n)
    ai, ri = int(a * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, max(1, ai))[:ai]
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):  # simple one-pole filter
        s = (1 - a) * x[i] + a * s; y[i] = s
    return y


def pad(freqs, dur, bright=0.35):
    n = int(dur * SR); t = np.arange(n) / SR; x = np.zeros(n)
    for f in freqs:
        for d in (-0.12, 0.0, 0.11):  # gentle detune chorus
            ff = f * 2 ** (d / 12 / 4)
            x += np.sin(2 * np.pi * ff * t) + bright * 0.5 * np.sin(4 * np.pi * ff * t) + bright * 0.2 * np.sin(6 * np.pi * ff * t)
    x *= env(n, min(1.2, dur / 3), min(1.5, dur / 3))
    return x / (len(freqs) * 3)


def pluck(f, dur=1.4, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * f * t) + 0.45 * bright * np.sin(4 * np.pi * f * t) * np.exp(-t * 6) + 0.2 * bright * np.sin(6 * np.pi * f * t) * np.exp(-t * 9))
    return x * np.exp(-t * 3.2) * env(n, 0.004, 0.05)


def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def shaker():
    n = int(0.06 * SR); x = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 70)
    return np.diff(np.concatenate([[0], x]))  # bright


def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf): return
    sig = sig[: len(buf) - i]; buf[i:i + len(sig)] += sig * gain


PROGS = {
    "reflective": dict(bpm=64, chords=[["A2", "E3", "A3", "C4"], ["F2", "C3", "F3", "A3"], ["C3", "G3", "C4", "E4"], ["G2", "D3", "G3", "B3"]], arp=False, drums=False, keys=0.55),
    "confident": dict(bpm=104, chords=[["F2", "C3", "F3", "A3"], ["C3", "G3", "C4", "E4"], ["D3", "A3", "D4", "F4"], ["A#2", "F3", "A#3", "D4"]], arp=True, drums=True, keys=0.45),
    "warm": dict(bpm=84, chords=[["D3", "A3", "D4", "F#4"], ["A2", "E3", "A3", "C#4"], ["B2", "F#3", "B3", "D4"], ["G2", "D3", "G3", "B3"]], arp=True, drums=False, keys=0.6),
}


def music(style, dur, lift_at=None):
    p = PROGS[style]; beat = 60 / p["bpm"]; bar = 4 * beat
    buf = np.zeros(int((dur + 2) * SR))
    t, i = 0.0, 0
    while t < dur:
        ch = p["chords"][i % 4]
        add(buf, pad([hz(n) for n in ch], bar + 1.0, bright=0.25 if style == "reflective" else 0.4), t, 0.55)
        add(buf, pluck(hz(ch[0]) / 2, bar, 0.6), t, 0.35)  # bass
        if p["arp"]:
            seq = ch[1:] + [ch[2]]
            for k in range(8):
                note = hz(seq[k % 4]) * (2 if k >= 4 and style == "confident" else 1)
                add(buf, pluck(note, 0.9, 0.8), t + k * beat / 2, 0.16 if style == "warm" else 0.13)
        else:  # sparse piano notes
            for k, n in enumerate([ch[3], ch[2]]):
                add(buf, pluck(hz(n), 2.5, 0.5), t + k * 2 * beat + 0.02, p["keys"] * 0.3)
        if p["drums"] and t > bar - 0.01:
            for b in range(4):
                if b in (0, 2): add(buf, kick(), t + b * beat, 0.35)
                for h in range(2): add(buf, shaker(), t + b * beat + h * beat / 2, 0.05 if h else 0.03)
        if style == "warm" and lift_at and t >= lift_at:
            for b in range(4): add(buf, shaker(), t + b * beat + beat / 2, 0.035)
        t += bar; i += 1
    buf = lowpass(buf, 5200 if style != "reflective" else 2600)
    buf = buf[: int(dur * SR)]
    fade = int(2.5 * SR); buf[-fade:] *= np.linspace(1, 0, fade)
    buf[: int(0.8 * SR)] *= np.linspace(0, 1, int(0.8 * SR))
    return buf / (np.abs(buf).max() + 1e-9)


def whoosh(d=0.55):
    n = int(d * SR); t = np.linspace(0, 1, n)
    x = rng.standard_normal(n)
    out = np.zeros(n); s = 0.0
    for i in range(n):  # sweeping low-pass
        a = np.exp(-2 * np.pi * (300 + 3800 * np.sin(np.pi * t[i])) / SR); s = (1 - a) * x[i] + a * s; out[i] = s
    return out * np.sin(np.pi * t) ** 2 * 1.6


def tap():
    n = int(0.09 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1500 * t) * 0.6 + rng.standard_normal(n) * 0.25) * np.exp(-t * 70)


def pop():
    n = int(0.16 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (520 + 380 * np.exp(-t * 30)) * t) * np.exp(-t * 26)


def tick():
    n = int(0.03 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 180)


def chime():
    return sum(pluck(hz(n), 2.2, 0.4) * g for n, g in (("C5", 0.5), ("E5", 0.35), ("G5", 0.3)))


def mix_video(vid):
    tl = json.load(open(os.path.join(ROOT, "build", f"{vid}.timeline.json")))
    dur = tl["duration"]
    vo, vsr = sf.read(os.path.join(ROOT, "audio", f"{vid}-voiceover.wav"))
    # Resample the 24 kHz narration to 48 kHz.
    vo = np.interp(np.arange(int(len(vo) * SR / vsr)) / SR, np.arange(len(vo)) / vsr, vo)
    n = int((dur + 0.1) * SR)
    vo = np.pad(vo, (0, max(0, n - len(vo))))[:n]
    lift = next((s["start"] for s in tl["scenes"] if s["id"] == "relief"), None)
    mus = music(tl["music"], dur + 0.1, lift)[:n]
    mus = np.pad(mus, (0, n - len(mus)))
    sf.write(os.path.join(ROOT, "audio", f"{vid}-music.wav"), (mus * 0.8).astype(np.float32), SR)
    # Duck the music under the narration.
    level = np.convolve(np.abs(vo), np.ones(int(0.25 * SR)) / int(0.25 * SR), mode="same")
    duck = 1 - 0.55 * np.clip(level / 0.04, 0, 1)
    duck = np.convolve(duck, np.ones(int(0.2 * SR)) / int(0.2 * SR), mode="same")
    music_gain = {"reflective": 0.2, "confident": 0.2, "warm": 0.2}[tl["music"]]
    fx = np.zeros(n)
    shots = SHOTS.get(vid, {})
    for k, s in enumerate(tl["scenes"]):
        if k: add(fx, whoosh(), s["start"] - 0.3, 0.05)
        sh = shots.get(s["id"], {})
        for tp in sh.get("taps", []): add(fx, tap(), s["start"] + tp[0], 0.22)
        for c in sh.get("callouts", []): add(fx, pop(), s["start"] + c[0], 0.08)
        for u in sh.get("pops", []): add(fx, pop(), s["start"] + u, 0.12)
        if "ticks" in sh:
            a, b = sh["ticks"]; u = a
            while u < min(b, s["end"] - s["start"]): add(fx, tick(), s["start"] + u, 0.12); u += 0.5
        if s["id"] == "end": add(fx, chime(), s["start"] + 0.35, 0.18)
    out = vo * 1.0 + mus * music_gain * duck + fx
    out = out / max(1.0, np.abs(out).max() / 0.95)
    sf.write(os.path.join(ROOT, "audio", f"{vid}-mix.wav"), out.astype(np.float32), SR)
    print(vid, f"{dur:.1f}s peak {np.abs(out).max():.2f}")


if __name__ == "__main__":
    for v in ("01-the-problem", "02-meet-mobicare", "03-the-solution"):
        mix_video(v)
