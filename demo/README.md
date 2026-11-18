# Demo video pipeline

Builds `out/scam-gym-demo.mp4` (1920x1080, 30 fps) from the real app, with narration, burned-in captions, an SRT, a thumbnail and six gallery screenshots. The narration is the master clock: each scene's taps are scheduled against the sentence timings, and each scene lasts its audio plus 0.4 s.

## Run

```bash
# 1. The real stack, with a throwaway database (never the real study data)
DATABASE_PATH=demo/out/demo.db LLM_ENABLED=false uvicorn backend.main:app --port 8000 &

# 2. Narration (synthetic voice; see "Voice" below)
pip install kokoro-onnx soundfile
python demo/tts.py --models <folder with kokoro-v1.0.int8.onnx and voices-v1.0.bin>

# 3. Record every scene + the six screenshots (needs Playwright with Chromium)
node demo/record.mjs              # or: --scenes S2,S3   --screens-only

# 4. Compose, then run QA (writes out/QA_REPORT.md)
./demo/compose.sh
```

Model files: `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx` and `.../voices-v1.0.bin`.

## Outputs (`demo/out/`)

| File | What |
|---|---|
| `scam-gym-demo.mp4` | The video. H.264 veryfast CRF 20, AAC 192k, loudness about -16 LUFS |
| `scam-gym-demo.srt` | The same captions as the video |
| `thumbnail.png` | 1280x720 |
| `screens/` | Home, call in progress, lost debrief, safe debrief, family code word, Spanish Home (824x1830) |
| `QA_REPORT.md` | Results of the 10 checks |

## Choices

- **Sharpness.** Playwright's video recorder and Chrome's screencast both capture at 1x (412x915), which is blurry at 980 px tall. `record.mjs` instead calls `Page.captureScreenshot` at scale 2 in a loop (about 19 fps at 824x1830), and ffmpeg turns those frames into a constant 30 fps clip.
- **Taps and highlights.** The tap circle and the tactic outlines are injected into the page only while recording. The app code is unchanged.
- **Voice.** The narration is synthetic (Kokoro, voice `bf_emma`), credited on the end card and in `CREDITS.txt`. To use your own voice instead, put `S1.wav` … `S9.wav` (or `.m4a`) in `demo/narration/user/`, then run steps 2 to 4 again. `tts.py` measures your files, and the taps follow your timing.
- **Scene 7 (evidence)** is only included with real study numbers: `python demo/tts.py --models … --with-study` reads `GET /api/study/summary` from the deployed site and refuses if `n` is 0. Scene 7 is then recorded from the deployed About page, where the real chart lives.
- **Captions** are one line each, at most 70 characters, timed from the sentence timings and split by word count within a sentence.
- **Pauses** between sentences are 0.55 s by default, and at most 1.25 s where a scene needs time for its taps, so there is never more than 1.5 s of silence.
