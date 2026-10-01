"""Jalankan seluruh uji GC 1 Sentinel.

Tiap uji memakai salinan sementara dan port sendiri, jadi data asli tidak tersentuh.

    python tests/run_all.py
"""
import glob
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
here = os.path.dirname(os.path.abspath(__file__))
total_ok = total_fail = 0
for path in sorted(glob.glob(os.path.join(here, "test_*.py"))):
    r = subprocess.run([sys.executable, "-B", path], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    out = r.stdout + r.stderr
    ok = len(re.findall(r"^OK", out, re.M))
    fail = re.findall(r"^GAGAL.*$", out, re.M)
    total_ok += ok
    total_fail += len(fail)
    print(f"{os.path.basename(path):34s} {ok:3d} lulus, {len(fail)} gagal")
    for f in fail:
        print("   ", f[:160])
print()
print(f"TOTAL: {total_ok} lulus, {total_fail} gagal")
sys.exit(1 if total_fail else 0)
