#!/bin/bash
# Usage: vlm-audit.sh <image> <out.txt> "<prompt>"
z-ai vision -p "$3" -i "$1" -o "$2" >/dev/null 2>&1
python3 - "$2" <<'EOF'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d["choices"][0]["message"]["content"])
except Exception as e:
    print(f"PARSE FAIL: {e}")
    import os
    if os.path.exists(sys.argv[1]):
        print(open(sys.argv[1]).read()[:500])
EOF
