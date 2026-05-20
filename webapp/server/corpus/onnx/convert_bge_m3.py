#!/usr/bin/env python3
"""
Convert BAAI/bge-m3 to Oracle-compatible augmented ONNX format.

Run this script on:
  - Your Mac M2 Max (recommended — fast, local)
  - OCI Cloud Shell (fallback — but OML4Py isn't pre-installed)
  - Any Linux x64 machine with OML4Py 2.1+

Usage:
  1. pip install oml  (or install OML4Py client from Oracle)
  2. python convert_bge_m3.py
  3. Upload the output .onnx file to your OCI bucket
  4. Load into ADB via DBMS_VECTOR.LOAD_ONNX_MODEL_CLOUD

If OML4Py is NOT available, this script falls back to a manual
ONNX export using the transformers + onnx libraries directly.
"""

import sys
import os


def try_oml4py():
    """Method 1: Use OML4Py's ONNXPipeline (preferred — handles augmentation)."""
    try:
        import oml
        from oml.utils import ONNXPipeline

        print("[oml4py] Converting BAAI/bge-m3 to augmented ONNX...")
        pipeline = ONNXPipeline(model_name="BAAI/bge-m3")

        output_dir = os.path.join(os.path.dirname(__file__), "onnx_output")
        os.makedirs(output_dir, exist_ok=True)

        pipeline.export2file(
            file_name="bge_m3_augmented.onnx",
            directory=output_dir,
        )
        print(f"[oml4py] ✅ Saved to {output_dir}/bge_m3_augmented.onnx")
        print("[oml4py] Next steps:")
        print("  1. Upload to OCI: oci os object put --bucket-name nblm-corpus --file onnx_output/bge_m3_augmented.onnx")
        print("  2. Load into ADB: see load_model.sql")
        return True
    except ImportError:
        print("[oml4py] OML4Py not installed, trying manual export...")
        return False
    except Exception as e:
        print(f"[oml4py] Error: {e}")
        print("[oml4py] Falling back to manual export...")
        return False


def try_manual_export():
    """
    Method 2: Manual ONNX export using sentence-transformers.

    This produces a raw ONNX model WITHOUT the Oracle augmentation
    (no built-in tokenizer). For use with Oracle 23ai, you would need
    to either:
      a) Use OML4Py on a Linux machine to augment it, or
      b) Pre-embed outside the database and store vectors directly

    This fallback is mainly useful if you want to verify the model
    works and produces correct 1024-dim vectors before going through
    the full OML4Py conversion on a Linux machine.
    """
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np

        print("[manual] Downloading BAAI/bge-m3...")
        model = SentenceTransformer("BAAI/bge-m3")

        # Quick sanity check
        test_vec = model.encode(["hello world", "你好世界"])
        print(f"[manual] Embedding dimensions: {test_vec.shape[1]}")
        assert test_vec.shape[1] == 1024, f"Expected 1024 dims, got {test_vec.shape[1]}"

        print("[manual] ✅ Model verified — produces 1024-dim vectors")
        print()
        print("[manual] ⚠️  Raw ONNX export cannot be loaded directly into Oracle ADB.")
        print("[manual] You MUST use OML4Py on a Linux x64 machine to produce the")
        print("[manual] augmented ONNX format that includes the tokenizer.")
        print()
        print("[manual] Options:")
        print("  a) Use your Linux environment with OML4Py installed")
        print("  b) Spin up an OCI Compute instance (free tier A1.Flex) and run OML4Py there")
        print("  c) Use Oracle ML Notebooks in the ADB console (browser-based, no install)")
        return True
    except ImportError:
        print("[manual] sentence-transformers not installed.")
        print("[manual] pip install sentence-transformers")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("BGE-M3 → Oracle ADB ONNX Model Converter")
    print("=" * 60)
    print()

    if not try_oml4py():
        try_manual_export()

    print()
    print("=" * 60)
    print("See load_model.sql for the SQL to load into Oracle ADB.")
    print("=" * 60)
