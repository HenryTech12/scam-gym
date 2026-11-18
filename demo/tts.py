"""Builds demo/narration/S*.wav (48 kHz mono) and narration/durations.json.

Narration is the master clock: record.mjs schedules taps against the sentence timings
written here, and compose.py sizes each scene to its audio.

Sources, in order:
  1. Your own recordings: demo/narration/user/S1.wav (or .m4a/.mp3) ... measured and converted.
  2. Synthetic voice (Kokoro, offline). Needs `pip install kokoro-onnx soundfile` and the model
     files kokoro-v1.0.int8.onnx + voices-v1.0.bin in --models (see demo/README.md).

Usage:
  python demo/tts.py --models DIR [--with-study --summary-url URL]
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

DEMO = Path(__file__).resolve().parent
NARR = DEMO / "narration"
USER = NARR / "user"
SR = 48000


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def load_study(args):
    """Real numbers only: fetched from the live summary endpoint, never invented."""
    with urllib.request.urlopen(args.summary_url, timeout=30) as r:
        s = json.load(r)
    if not s.get("n"):
        sys.exit("--with-study: the study has no participants yet (n = 0). Render without scene 7.")
    study = {
        "n": s["n"],
        "pre": round(s["pre_verify_rate"] * 100),
        "post": round(s["post_verify_rate"] * 100),
        "source": args.summary_url,
        "label": s.get("label", "Small sample, self-reported"),
    }
    (NARR / "study.json").write_text(json.dumps(study, indent=2))
    return study


def included(cfg, with_study):
    return [s for s in cfg["scenes"] if s.get("flag") != "with-study" or with_study]


def scene_text(scene, study):
    return [t.format(**study) if study else t for t in scene["sentences"]]


def synth(scene, sentences, cfg, kokoro, out_wav):
    import numpy as np
    import soundfile as sf

    v = cfg["voice"]
    tts_over = scene.get("tts", {})
    pauses = scene.get("pauses", {})
    sr = None
    parts, segments, t = [], [], cfg["lead_in"]
    for i, text in enumerate(sentences):
        samples, sr = kokoro.create(tts_over.get(str(i), text), voice=v["voice"], speed=v["speed"], lang=v["lang"])
        samples = np.asarray(samples, dtype=np.float32)
        loud = np.where(np.abs(samples) > 0.01)[0]
        if len(loud):  # trim leading/trailing near-silence so timings are exact
            samples = samples[max(0, loud[0] - int(0.02 * sr)): loud[-1] + int(0.06 * sr)]
        dur = len(samples) / sr
        segments.append({"text": text, "start": round(t, 3), "end": round(t + dur, 3)})
        # A listed pause replaces the default gap (brief: 0.6 to 1.2 s); capped so QA never sees > 1.5 s of silence.
        gap = min(1.25, float(pauses.get(str(i), cfg["sentence_pause"]))) if i < len(sentences) - 1 else 0
        parts.append(samples)
        parts.append(np.zeros(int(gap * sr), dtype=np.float32))
        t += dur + gap
    audio = np.concatenate([np.zeros(int(cfg["lead_in"] * sr), dtype=np.float32), *parts])
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.wav"
        sf.write(raw, audio, sr)
        run(["ffmpeg", "-y", "-i", str(raw), "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(out_wav)])
    return segments


def from_user(scene, sentences, src, out_wav):
    """Your own recording: convert, then spread sentence timings by word count (speech assumed to fill the file)."""
    run(["ffmpeg", "-y", "-i", str(src), "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(out_wav)])
    dur = probe_duration(out_wav)
    words = [len(s.split()) for s in sentences]
    start, span = 0.5, max(0.1, dur - 1.0)  # brief asks for ~0.5 s of silence at each end
    segments, t = [], start
    for s, w in zip(sentences, words):
        d = span * w / sum(words)
        segments.append({"text": s, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return segments


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", help="folder with kokoro-v1.0.int8.onnx and voices-v1.0.bin")
    ap.add_argument("--with-study", action="store_true")
    ap.add_argument("--summary-url", default=None)
    args = ap.parse_args()

    cfg = json.loads((DEMO / "scenes.json").read_text())
    NARR.mkdir(exist_ok=True)
    study = None
    if args.with_study:
        args.summary_url = args.summary_url or cfg["deployed_url"] + "/api/study/summary"
        study = load_study(args)
    elif (NARR / "study.json").exists():
        (NARR / "study.json").unlink()

    scenes = included(cfg, args.with_study)
    kokoro = None
    result = {"scenes": {}, "with_study": bool(study)}
    script_lines = []
    for scene in scenes:
        sentences = scene_text(scene, study)
        out_wav = NARR / f"{scene['id']}.wav"
        user = next((p for ext in ("wav", "m4a", "mp3") for p in [USER / f"{scene['id']}.{ext}"] if p.exists()), None)
        if user:
            segments = from_user(scene, sentences, user, out_wav)
            source = "user"
        else:
            if kokoro is None:
                if not args.models:
                    sys.exit(f"No recording for {scene['id']} in {USER} and no --models for the synthetic voice.")
                from kokoro_onnx import Kokoro
                m = Path(args.models)
                kokoro = Kokoro(str(m / "kokoro-v1.0.int8.onnx"), str(m / "voices-v1.0.bin"))
            segments = synth(scene, sentences, cfg, kokoro, out_wav)
            source = "synthetic"
        dur = probe_duration(out_wav)
        words = sum(len(s.split()) for s in sentences)
        speech = sum(s["end"] - s["start"] for s in segments)
        result["scenes"][scene["id"]] = {"duration": round(dur, 3), "segments": segments, "source": source,
                                         "target": scene["target"], "wpm": round(words / speech * 60)}
        script_lines += [f"[{scene['id']}] {scene['title'] or 'Close'} (target {scene['target']} s)", *sentences, ""]
        print(f"{scene['id']}: {dur:5.2f}s (target {scene['target']}s, {result['scenes'][scene['id']]['wpm']} wpm, {source})")

    sources = {s["source"] for s in result["scenes"].values()}
    result["voice"] = "user" if sources == {"user"} else cfg["voice"]["engine"] if sources == {"synthetic"} else "mixed"
    (NARR / "durations.json").write_text(json.dumps(result, indent=2))
    (DEMO / "narration_script.txt").write_text("\n".join(script_lines))
    total = sum(s["duration"] + cfg["tail"] for s in result["scenes"].values())
    print(f"total with tails: {total:.1f}s")


if __name__ == "__main__":
    main()
