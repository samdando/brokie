#!/usr/bin/env python3
"""Inlines functions/_shared/*.ts into one paste-ready file per function (deploy/)."""
import pathlib, re
root = pathlib.Path(__file__).parent / "functions"
out = pathlib.Path(__file__).parent / "deploy"
out.mkdir(exist_ok=True)
for fn in ["ingest-quotes", "voice-token"]:
    src = (root / fn / "index.ts").read_text()
    shared = []
    for m in re.finditer(r'^import \{[^}]*\} from "\.\./_shared/([a-z]+)\.ts";\n', src, re.M):
        code = (root / "_shared" / f"{m.group(1)}.ts").read_text()
        shared.append(f"// ---- inlined from _shared/{m.group(1)}.ts ----\n" + re.sub(r"^export ", "", code, flags=re.M))
    body = re.sub(r'^import \{[^}]*\} from "\.\./_shared/[a-z]+\.ts";\n', "", src, flags=re.M)
    (out / f"{fn}.ts").write_text(body.rstrip() + "\n\n" + "\n".join(shared))
    print("wrote", out / f"{fn}.ts")
