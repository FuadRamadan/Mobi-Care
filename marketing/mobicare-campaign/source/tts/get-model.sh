#!/usr/bin/env bash
# Fetches the Kokoro-82M voice model (Apache-2.0) from npm and prepares source/tts/kokoro-q8.onnx and voices.bin.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
(cd "$tmp" && npm pack kokoro-q8-shards@1.0.0 kokoro-local-runtime@0.1.0 --silent >/dev/null && for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done)
cat "$tmp"/kokoro-q8-shards-1.0.0/package/kokoro-q8.part{0,1,2,3,4,5}.bin > kokoro-q8.onnx
echo "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478  kokoro-q8.onnx" | sha256sum -c -
python3 - "$tmp/kokoro-local-runtime-0.1.0/package/voices" <<'PY'
import glob, os, sys, numpy as np
d = {os.path.basename(f)[:-4]: np.fromfile(f, dtype=np.float32).reshape(-1, 1, 256) for f in glob.glob(sys.argv[1] + "/*f_*.bin")}
np.savez("voices.npz", **d); os.replace("voices.npz", "voices.bin"); print("voices:", ", ".join(sorted(d)))
PY
rm -rf "$tmp"
