"""Automated checks for the demo video (brief, Section 8). Writes out/QA_REPORT.md.
Exits non-zero if any check fails. Frames for the manual look are written to out/frames/."""
import json
import re
import subprocess
import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parent
OUT = DEMO / "out"
VIDEO = OUT / "scam-gym-demo.mp4"
SRT = OUT / "scam-gym-demo.srt"


def sh(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe(entries, stream=None):
    cmd = ["ffprobe", "-v", "error"] + (["-select_streams", stream] if stream else []) + ["-show_entries", entries, "-of", "json", str(VIDEO)]
    return json.loads(sh(cmd).stdout)


def main():
    cfg = json.loads((DEMO / "scenes.json").read_text())
    dur = json.loads((DEMO / "narration" / "durations.json").read_text())
    tl = json.loads((OUT / "timeline.json").read_text())
    results = []

    def check(name, ok, detail):
        results.append((name, bool(ok), detail))

    # 1. Total duration
    total = float(probe("format=duration")["format"]["duration"])
    check("Total duration 2:15 to 3:00", 135 <= total <= 180, f"{total:.1f} s ({int(total // 60)}:{total % 60:04.1f})")

    # 2. Each scene's video matches its audio within 0.5 s (video = audio + tail [+ hold])
    worst = max(abs(s["video"] - s["audio"]) for s in tl["scenes"])
    holds = {s["id"]: s.get("hold", 0) for s in cfg["scenes"]}
    over = [s["id"] for s in tl["scenes"] if abs(s["video"] - s["audio"] - holds.get(s["id"], 0)) > 0.5]
    check("Scene video matches audio (within 0.5 s, excluding the end-card hold)", not over,
          "; ".join(f"{s['id']} video {s['video']:.2f} / audio {s['audio']:.2f}" for s in tl["scenes"]) + (f" | off: {over}" if over else ""))

    # 3. Format and loudness
    v = probe("stream=width,height,r_frame_rate,pix_fmt,codec_name", "v:0")["streams"][0]
    a = probe("stream=codec_name,sample_rate,bit_rate", "a:0")["streams"]
    lufs_out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(VIDEO), "-af", "ebur128", "-f", "null", "-"],
                              capture_output=True, text=True).stderr
    lufs = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", lufs_out)[-1])
    fmt_ok = v["width"] == 1920 and v["height"] == 1080 and v["r_frame_rate"] == "30/1" and v["pix_fmt"] == "yuv420p" and a
    check("1920x1080, 30 fps, yuv420p, audio present, loudness -18 to -14 LUFS", fmt_ok and -18 <= lufs <= -14,
          f"{v['codec_name']} {v['width']}x{v['height']} {v['r_frame_rate']} {v['pix_fmt']}, audio: {a[0]['codec_name'] if a else 'none'}, {lufs} LUFS")

    # 4. One frame per scene for the manual look
    frames = OUT / "frames"
    frames.mkdir(exist_ok=True)
    for old in frames.glob("*.png"):
        old.unlink()
    for s in tl["scenes"]:
        t = s["start"] + s["length"] / 2
        sh(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{t:.2f}", "-i", str(VIDEO), "-frames:v", "1", str(frames / f"{s['id']}_mid.png")])
    check("Middle frame per scene extracted (inspect by eye)", True, f"{len(tl['scenes'])} frames in out/frames/")

    # 5. No silent gap over 1.5 s inside the narration (the end-card hold after the last line is excluded)
    sil = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(VIDEO), "-af", "silencedetect=noise=-40dB:d=1.5", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", sil)]
    last_line = tl["scenes"][-1]["start"] + dur["scenes"][tl["scenes"][-1]["id"]]["segments"][-1]["end"]
    gaps = [round(x, 2) for x in starts if x < last_line - 0.1]
    check("No silent gap over 1.5 s inside narration", not gaps, f"gaps at {gaps}" if gaps else "none")

    # 6. Captions: at most 70 characters, in order, inside the video
    blocks = [b for b in SRT.read_text().strip().split("\n\n") if b.strip()]
    entries = []
    for b in blocks:
        lines = b.splitlines()
        a_, b_ = lines[1].split(" --> ")
        to_s = lambda x: int(x[:2]) * 3600 + int(x[3:5]) * 60 + int(x[6:8]) + int(x[9:]) / 1000
        entries.append((to_s(a_), to_s(b_), " ".join(lines[2:]), lines[2:]))
    long_lines = [l for e in entries for l in e[3] if len(l) > 70]
    ordered = all(e[0] < e[1] for e in entries) and all(entries[i][1] <= entries[i + 1][0] + 1e-3 for i in range(len(entries) - 1))
    inside = entries[-1][1] <= total + 0.05
    check("Captions: every line <= 70 chars, in order, inside the video", not long_lines and ordered and inside,
          f"{len(entries)} captions; longest line {max(len(l) for e in entries for l in e[3])} chars")

    # 7. SRT text matches the narration script
    norm = lambda s: re.sub(r"\s+", " ", s).strip()
    script = norm(" ".join(seg["text"] for sid in [s["id"] for s in tl["scenes"]] for seg in dur["scenes"][sid]["segments"]))
    srt_text = norm(" ".join(e[2] for e in entries))
    check("SRT text matches the narration script", script == srt_text, "identical" if script == srt_text else "MISMATCH")

    # 8. No personal data, keys or private URLs (text sources; frames checked by eye)
    end_card = (DEMO / "cards" / "end.html").read_text() + json.dumps(cfg)
    leaks = re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+|sk-[A-Za-z0-9]{10,}|localhost|127\.0\.0\.1|\b10\.\d+\.\d+\.\d+", end_card + SRT.read_text())
    urls = sorted(set(re.findall(r"https?://[^\s\"'<>]+", json.dumps(cfg))))
    check("No personal data, keys or private URLs in card text or captions", not leaks, f"URLs shown: {urls}")

    # 9. File size
    size = VIDEO.stat().st_size / 1e6
    check("File size under 150 MB", size < 150, f"{size:.1f} MB")

    # 10. Study numbers (scene 7 only)
    study_path = DEMO / "narration" / "study.json"
    if "S7" in dur["scenes"]:
        st = json.loads(study_path.read_text())
        said = " ".join(seg["text"] for seg in dur["scenes"]["S7"]["segments"])
        ok = f"with {st['n']} volunteers" in said and f"{st['pre']} percent" in said and f"{st['post']} percent" in said
        check("Study numbers match /api/study/summary", ok, f"n={st['n']}, pre={st['pre']}%, post={st['post']}% from {st['source']}")
    else:
        check("Study numbers match /api/study/summary", True, "scene 7 not included (no study participants yet)")

    passed = all(r[1] for r in results)
    report = ["# Demo video QA report", "", f"Video: `demo/out/scam-gym-demo.mp4` ({total:.1f} s)  ",
              f"Scenes: {', '.join(s['id'] for s in tl['scenes'])}  ", f"Voice: {tl['voice']}", "",
              "| # | Check | Result | Detail |", "|---|---|---|---|"]
    report += [f"| {i} | {n} | {'PASS' if ok else 'FAIL'} | {d} |" for i, (n, ok, d) in enumerate(results, 1)]
    report += ["", f"**Overall: {'PASS' if passed else 'FAIL'}**", ""]
    (OUT / "QA_REPORT.md").write_text("\n".join(report))
    for i, (n, ok, d) in enumerate(results, 1):
        print(f"{'PASS' if ok else 'FAIL'}  {i}. {n}: {d}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
