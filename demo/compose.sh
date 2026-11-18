#!/usr/bin/env bash
# Composes the demo from demo/out/clips and the narration, then runs the QA checks.
#   ./demo/compose.sh                         # synthetic or already-built narration
#   ./demo/compose.sh --audio-dir demo/narration   # same, explicit
# To use your own voice: put S1.wav ... S9.wav in demo/narration/user/, run
#   python demo/tts.py   (measures them)  then  node demo/record.mjs  then  ./demo/compose.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 demo/compose.py "$@"
python3 demo/qa.py
