#!/usr/bin/env python3
"""
Convert BAAI/bge-m3 → Oracle-augmented ONNX and load it into Oracle 26ai.

This is the **26ai** path (supersedes convert_bge_m3.py, which targeted the old
23ai 1 GB-cap workflow). 26ai supports ONNX models > 1 GB via "external
initializers", so bge-m3 (~2.3 GB) can be imported directly, and OML4Py 2.1's
ONNXPipeline.export2db() converts + loads in a single step.

────────────────────────────────────────────────────────────────────────────
⚠️  ARCHITECTURE REQUIREMENT — read README.md before running.

    OML4Py 2.1's client is published for **Linux x86_64 ONLY**. It does NOT
    run on aarch64/ARM. The primary dev host (Oracle Ampere A1) is ARM, so
    this script CANNOT run there. Run it on an x86_64 Linux box.

    The DB load + VECTOR_EMBEDDING() run inside the ADB, so once the model is
    loaded the ARM host uses it normally — only this conversion needs x86_64.
────────────────────────────────────────────────────────────────────────────

PREREQUISITES (see README.md for the full walkthrough):
  1. x86_64 Linux, Python 3.12.
  2. A venv with the deps in requirements.txt installed.
  3. The OML4Py 2.1 client wheel installed into that venv. It is NOT on PyPI —
     download from https://www.oracle.com/database/technologies/oml4py-downloads.html
     (license click-through), pick the cp312 Linux x86_64 wheel, then:
         pip install oml-2.1.1-cp312-cp312-linux_x86_64.whl
  4. The repo .env populated with ORACLE_* values + the ADB wallet on disk.

USAGE (run with the venv python):
  python convert_bge_m3_26ai.py            # convert + load into DB (one step)
  python convert_bge_m3_26ai.py --file     # only produce the .onnx locally
  python convert_bge_m3_26ai.py --check    # just test the DB connection

Connection mirrors the project's working node-oracledb thin-mode setup
(see webapp/server/corpus/oci/db.ts): wallet dir + wallet password, dsn alias.
All values are read from the repo .env so nothing is hard-coded here.
"""

import argparse
import os
import sys
from pathlib import Path

MODEL_HF_NAME = "BAAI/bge-m3"
DB_MODEL_NAME = "BGE_M3_MODEL"  # must match DB_EMBED_MODEL in .env
OUTPUT_DIR = Path(__file__).resolve().parent / "onnx_output"


def find_env_file() -> "Path | None":
    """Locate the repo .env by walking up from this file."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / ".env"
        if candidate.is_file():
            return candidate
    return None


def load_env() -> "dict[str, str]":
    """Minimal .env parser (avoids a hard dotenv dependency)."""
    env: dict[str, str] = {}
    path = find_env_file()
    if path:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    # Real process env wins over file (so you can override at the CLI).
    env.update({k: v for k, v in os.environ.items() if k.startswith("ORACLE_")})
    return env


def db_params(env: "dict[str, str]") -> "dict[str, str]":
    required = [
        "ORACLE_USER",
        "ORACLE_PASSWORD",
        "ORACLE_CONNECT_STRING",
        "ORACLE_WALLET_DIR",
        "ORACLE_WALLET_PASSWORD",
    ]
    missing = [k for k in required if not env.get(k)]
    if missing:
        sys.exit(f"[fatal] missing in .env: {', '.join(missing)}")
    wallet_dir = env["ORACLE_WALLET_DIR"]
    # Thin mode looks here for tnsnames.ora (alias resolution) + ewallet.pem.
    os.environ["TNS_ADMIN"] = wallet_dir
    os.environ["WALLET_LOCATION"] = wallet_dir
    return {
        "user": env["ORACLE_USER"],
        "password": env["ORACLE_PASSWORD"],
        "dsn": env["ORACLE_CONNECT_STRING"],
        "config_dir": wallet_dir,
        "wallet_location": wallet_dir,
        "wallet_password": env["ORACLE_WALLET_PASSWORD"],
    }


def check_connection(p: "dict[str, str]") -> None:
    """Prove the wallet + creds work via raw python-oracledb thin mode.

    This part needs only `oracledb` (pure-Python, works on ARM too), so it's a
    handy smoke test even before OML4Py is in the picture.
    """
    import oracledb

    print(f"[check] connecting to {p['dsn']} as {p['user']} (thin mode)...")
    with oracledb.connect(
        user=p["user"],
        password=p["password"],
        dsn=p["dsn"],
        config_dir=p["config_dir"],
        wallet_location=p["wallet_location"],
        wallet_password=p["wallet_password"],
    ) as conn:
        (ver,) = conn.cursor().execute("select banner_full from v$version").fetchone()
        print(f"[check] ✅ connected — {ver.splitlines()[0]}")


def build_pipeline():
    from oml.utils import ONNXPipeline  # from the OML4Py 2.1 client wheel (x86_64)

    print(f"[convert] downloading + augmenting {MODEL_HF_NAME} (this pulls ~2.3 GB)...")
    # The default config bakes in the SentencePiece tokenizer + mean pooling +
    # L2 normalization so VECTOR_EMBEDDING(... USING text) works in-DB and
    # returns a 1024-dim unit vector. Quantization is OPTIONAL on 26ai (no size
    # cap) — see ONNXPipelineConfig if you want a smaller, faster INT8 model.
    return ONNXPipeline(model_name=MODEL_HF_NAME)


def main() -> None:
    ap = argparse.ArgumentParser(description="Convert + load bge-m3 into Oracle 26ai")
    ap.add_argument("--file", action="store_true",
                    help="export to a local .onnx file instead of loading into the DB")
    ap.add_argument("--check", action="store_true",
                    help="only test the DB connection, then exit")
    args = ap.parse_args()

    env = load_env()
    params = db_params(env)

    if args.check:
        check_connection(params)
        return

    if args.file:
        OUTPUT_DIR.mkdir(exist_ok=True)
        pipeline = build_pipeline()
        base = DB_MODEL_NAME.lower()  # e.g. "bge_m3_model"
        pipeline.export2file(base, output_dir=str(OUTPUT_DIR))
        print(f"[convert] ✅ wrote {OUTPUT_DIR}/{base}.onnx")
        print("[convert] next: upload to your OCI bucket, then run load_model.sql")
        return

    # One-step: convert + load straight into the database.
    check_connection(params)  # fail fast with a clear message if the wallet is wrong
    import oml

    print("[convert] oml.connect ...")
    oml.connect(
        user=params["user"],
        password=params["password"],
        dsn=params["dsn"],
    )
    pipeline = build_pipeline()
    print(f"[convert] export2db('{DB_MODEL_NAME}') — importing into Oracle 26ai...")
    pipeline.export2db(DB_MODEL_NAME)
    print(f"[convert] ✅ model '{DB_MODEL_NAME}' loaded.")
    print("[convert] verify in SQL:")
    print(f"  SELECT VECTOR_EMBEDDING({DB_MODEL_NAME} USING 'hello world' AS DATA) FROM DUAL;")


if __name__ == "__main__":
    main()
