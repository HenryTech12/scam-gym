"""Composes the final demo video from the recorded clips and narration.

Each scene: dark canvas, the app clip scaled to 980 px tall and centered with a thin border,
the scene title to the left, burned-in captions at the bottom, and its narration padded to
clip length (= audio + 0.4 s). Scenes are joined with hard cuts, then loudness is normalised.

Outputs: out/scam-gym-demo.mp4, out/scam-gym-demo.srt, out/thumbnail.png, out/timeline.json
Usage:   python3 demo/compose.py [--audio-dir demo/narration]
"""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DEMO = Path(__file__).resolve().parent
OUT = DEMO / "out"
CLIPS = OUT / "clips"
BUILD = OUT / "build"
W, H, FPS = 1920, 1080, 30
BG = (20, 24, 31)          # #14181F
TEXT = (236, 234, 230)
MUTED = (169, 175, 182)
PHONE_H = 980
PHONE_Y = 14               # top-aligned so captions only touch the phone's bottom edge
CAPTION_MAX = 70
FONT_DIRS = [Path("/usr/share/fonts/opentype/inter"), Path("/usr/share/fonts/truetype/dejavu")]


def font(weight, size):
    inter = FONT_DIRS[0] / f"Inter-{weight}.otf"
    if inter.exists():
        return ImageFont.truetype(str(inter), size)
    bold = "-Bold" if weight in ("Bold", "ExtraBold", "SemiBold") else ""
    return ImageFont.truetype(str(FONT_DIRS[1] / f"DejaVuSans{bold}.ttf"), size)


F_TITLE = font("Bold", 58)
F_CAPTION = font("Medium", 42)


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def probe(path, entry="format=duration"):
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", entry, "-of", "csv=p=0", str(path)],
                          check=True, capture_output=True, text=True).stdout.strip()


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        test = f"{cur} {word}".strip()
        if draw.textlength(test, font=fnt) <= width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = word
    return lines + ([cur] if cur else [])


# ---------- captions ----------
def chunk_sentence(text):
    """Split a sentence into caption lines of at most 70 characters, preferring commas and colons."""
    if len(text) <= CAPTION_MAX:
        return [text]
    words, chunks, cur = text.split(), [], ""
    for w in words:
        test = f"{cur} {w}".strip()
        if len(test) > CAPTION_MAX:
            chunks.append(cur)
            cur = w
        else:
            cur = test
            if cur.endswith((",", ":", ";")) and len(cur) >= CAPTION_MAX * 0.45:
                chunks.append(cur)
                cur = ""
    if cur:
        chunks.append(cur)
    return chunks


def scene_captions(segments, scene_len):
    caps = []
    for i, s in enumerate(segments):
        chunks = chunk_sentence(s["text"])
        words = [len(c.split()) for c in chunks]
        t = s["start"]
        span = s["end"] - s["start"]
        for c, w in zip(chunks, words):
            d = span * w / sum(words)
            caps.append({"text": c, "start": t, "end": t + d})
            t += d
    # Hold each caption through short pauses, but never past the next one or the scene end.
    for i, c in enumerate(caps):
        nxt = caps[i + 1]["start"] if i + 1 < len(caps) else scene_len
        c["end"] = min(nxt, c["end"] + 0.6)
    return caps


def caption_png(text, path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=F_CAPTION)
    pad_x, pad_y, lh = 30, 16, 54
    bw, bh = tw + 2 * pad_x, lh + 2 * pad_y
    x0, y0 = (W - bw) / 2, H - 22 - bh
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=14, fill=(0, 0, 0, 190))
    d.text((x0 + pad_x, y0 + pad_y + 2), text, font=F_CAPTION, fill=(255, 255, 255, 255))
    img.save(path)


def srt_time(t):
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


# ---------- canvas ----------
def phone_geometry():
    w = round(824 * PHONE_H / 1830)
    w -= w % 2
    return (W - w) // 2, PHONE_Y, w, PHONE_H


def app_background(title, path):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    x, y, w, h = phone_geometry()
    d.rectangle([x - 3, y - 3, x + w + 2, y + h + 2], outline=(208, 212, 217), width=2)
    if title:
        lines = wrap(d, title, F_TITLE, x - 170)
        ty = 330 - len(lines) * 36
        for line in lines:
            d.text((100, ty), line, font=F_TITLE, fill=TEXT)
            ty += 72
    img.save(path)


def render_scene(sid, title, kind, length, audio, caps):
    """One scene -> build/<sid>.mp4 (video + padded narration)."""
    BUILD.mkdir(parents=True, exist_ok=True)
    bg = BUILD / f"{sid}_bg.png"
    app_background(title, bg)
    x, y, w, h = phone_geometry()
    inputs = ["-loop", "1", "-framerate", str(FPS), "-t", f"{length:.3f}", "-i", str(bg)]
    if kind == "card":
        inputs += ["-i", str(CLIPS / f"{sid}.mp4")]
        graph = ["[1:v]scale=1920:1080,setsar=1,fps=30[v0]"]
    elif kind == "card+app":  # scene 1: incoming-call card, then the last 3 s on the app
        inputs += ["-i", str(CLIPS / f"{sid}a.mp4"), "-i", str(CLIPS / f"{sid}b.mp4")]
        graph = [f"[2:v]scale={w}:{h},setsar=1[ph]",
                 f"[0:v][ph]overlay=x={x}:y={y}:shortest=1,fps=30[app]",
                 "[1:v]scale=1920:1080,setsar=1,fps=30[card]",
                 "[card][app]concat=n=2:v=1:a=0[v0]"]
    else:
        inputs += ["-i", str(CLIPS / f"{sid}.mp4")]
        graph = [f"[1:v]scale={w}:{h},setsar=1[ph]", f"[0:v][ph]overlay=x={x}:y={y}:eof_action=repeat,fps=30[v0]"]
    n_video = len([i for i in inputs if i == "-i"])
    inputs += ["-i", str(audio)]
    audio_idx = n_video
    last = "v0"
    for i, c in enumerate(caps):
        png = BUILD / f"{sid}_cap{i:02d}.png"
        caption_png(c["text"], png)
        inputs += ["-i", str(png)]
        idx = n_video + 1 + i
        graph.append(f"[{last}][{idx}:v]overlay=0:0:enable='between(t,{c['start']:.3f},{c['end']:.3f})'[c{i}]")
        last = f"c{i}"
    graph.append(f"[{audio_idx}:a]aresample=48000,apad,atrim=0:{length:.3f}[a]")
    out = BUILD / f"{sid}.mp4"
    run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(graph),
         "-map", f"[{last}]", "-map", "[a]", "-t", f"{length:.3f}", "-r", str(FPS),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(out)])
    return out


def thumbnail(timeline):
    """1280x720: a frame from scene 3's result screen beside the title and tagline."""
    s3 = next((s for s in timeline["scenes"] if s["id"] == "S3"), None)
    frame = BUILD / "thumb_frame.png"
    run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.8", "-i", str(CLIPS / "S3.mp4"), "-frames:v", "1", str(frame)])
    shot = Image.open(frame).convert("RGB")
    img = Image.new("RGB", (1280, 720), BG)
    ph = shot.resize((round(shot.width * 660 / shot.height), 660), Image.LANCZOS)
    px = 1280 - ph.width - 110
    d = ImageDraw.Draw(img)
    d.rectangle([px - 3, 27, px + ph.width + 2, 30 + ph.height + 2], outline=(208, 212, 217), width=2)
    img.paste(ph, (px, 30))
    d.text((80, 230), "Scam Gym", font=font("ExtraBold", 104), fill=TEXT)
    y = 370
    for line in wrap(d, "Practice the call before the scammer makes it.", font("Medium", 40), px - 150):
        d.text((84, y), line, font=font("Medium", 40), fill=MUTED)
        y += 54
    img.save(OUT / "thumbnail.png")
    return s3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-dir", default=str(DEMO / "narration"))
    args = ap.parse_args()
    narr = Path(args.audio_dir)
    cfg = json.loads((DEMO / "scenes.json").read_text())
    dur = json.loads((narr / "durations.json").read_text())
    scenes = [s for s in cfg["scenes"] if s["id"] in dur["scenes"]]

    timeline, srt, offset, number = {"scenes": [], "voice": dur["voice"]}, [], 0.0, 0
    parts = []
    for s in scenes:
        info = dur["scenes"][s["id"]]
        length = info["duration"] + cfg["tail"] + s.get("hold", 0)
        title = ""
        if s["title"]:
            number += 1
            title = f"{number}. {s['title'].split('. ', 1)[1]}"  # renumber when scene 7 is left out
        caps = scene_captions(info["segments"], length)
        print(f"{s['id']}: {length:5.2f}s  {title or '(card)'}  {len(caps)} captions")
        parts.append(render_scene(s["id"], title, s["kind"], length, narr / f"{s['id']}.wav", caps))
        for c in caps:
            srt.append((offset + c["start"], offset + c["end"], c["text"]))
        timeline["scenes"].append({"id": s["id"], "title": title, "start": round(offset, 3), "length": round(length, 3),
                                   "audio": info["duration"], "video": float(probe(parts[-1]))})
        offset += length
    timeline["total"] = round(offset, 3)

    concat = BUILD / "concat.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in parts))
    joined = BUILD / "joined.mp4"
    run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(joined)])
    final = OUT / "scam-gym-demo.mp4"
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(joined), "-c:v", "copy",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(final)])

    (OUT / "scam-gym-demo.srt").write_text(
        "\n".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for i, (a, b, t) in enumerate(srt, 1)))
    (OUT / "timeline.json").write_text(json.dumps(timeline, indent=2))
    thumbnail(timeline)
    print(f"done: {final.relative_to(DEMO.parent)} ({offset:.1f}s)")


if __name__ == "__main__":
    main()
