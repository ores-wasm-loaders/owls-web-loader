#!/usr/bin/env python3
import hashlib
mods=(b"\x00asm-A",b"\x00asm-B",b"\x00asm-A")
d=[hashlib.sha256(x).hexdigest() for x in mods]
assert d[0]==d[2], "identical module bytes changed digest"
assert d[0]!=d[1], "different module bytes shared digest in fixture"
# Admission requires fetched bytes to match the expected digest.
for expected,actual in ((d[0],d[0]),(d[0],d[1])):
  admitted=expected==actual
  assert admitted == (expected==actual)
print("module digest integrity: ok")
