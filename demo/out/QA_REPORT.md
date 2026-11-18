# Demo video QA report

Video: `demo/out/scam-gym-demo.mp4` (144.0 s)  
Scenes: S1, S2, S3, S4, S5, S6, S8, S9  
Voice: Kokoro (kokoro-onnx v1.0, open-source text-to-speech)

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | Total duration 2:15 to 3:00 | PASS | 144.0 s (2:24.0) |
| 2 | Scene video matches audio (within 0.5 s, excluding the end-card hold) | PASS | S1 video 20.20 / audio 19.80; S2 video 21.08 / audio 20.68; S3 video 19.59 / audio 19.19; S4 video 13.56 / audio 13.16; S5 video 18.28 / audio 17.88; S6 video 15.43 / audio 15.03; S8 video 21.14 / audio 20.74; S9 video 14.67 / audio 12.66 |
| 3 | 1920x1080, 30 fps, yuv420p, audio present, loudness -18 to -14 LUFS | PASS | h264 1920x1080 30/1 yuv420p, audio: aac, -16.1 LUFS |
| 4 | Middle frame per scene extracted (inspect by eye) | PASS | 8 frames in out/frames/ |
| 5 | No silent gap over 1.5 s inside narration | PASS | none |
| 6 | Captions: every line <= 70 chars, in order, inside the video | PASS | 38 captions; longest line 68 chars |
| 7 | SRT text matches the narration script | PASS | identical |
| 8 | No personal data, keys or private URLs in card text or captions | PASS | URLs shown: ['https://github.com/HenryTech12/scam-gym', 'https://scam-gym.onrender.com'] |
| 9 | File size under 150 MB | PASS | 8.3 MB |
| 10 | Study numbers match /api/study/summary | PASS | scene 7 not included (no study participants yet) |

**Overall: PASS**
