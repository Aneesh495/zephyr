#!/usr/bin/env python3
"""
tools/audit_em_dashes.py

Strict zero-defect audit tool ensuring that prohibited em dashes (U+2014)
do not appear anywhere in repository source files, comments, or documentation.
Exits with code 1 if any em dash is detected, printing exact file and line references.
Exits with code 0 if the audit passes cleanly.
"""

import os
import sys

PROHIBITED_CHARS = {
    "\u2014": "EM DASH (U+2014)",
}

IGNORED_DIRS = {
    ".git",
    "node_modules",
    ".cache",
    "data",
    "build",
    "dist",
    ".nyc_output",
    "__pycache__",
}

IGNORED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".o",
    ".a",
    ".so",
    ".dylib",
    ".wal",
    ".seg",
    ".idx",
    ".bin",
}


def audit_repository(root_dir: str) -> int:
    total_files = 0
    violations = 0

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Prune ignored directories in-place
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]

        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext in IGNORED_EXTENSIONS:
                continue

            filepath = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(filepath, root_dir)
            total_files += 1

            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    for line_number, line in enumerate(f, 1):
                        for char, name in PROHIBITED_CHARS.items():
                            if char in line:
                                col = line.index(char) + 1
                                print(
                                    f"[FAIL] {rel_path}:{line_number}:{col} -> "
                                    f"Prohibited {name} detected: {line.strip()}"
                                )
                                violations += 1
            except Exception as e:
                print(f"[WARN] Unable to read {rel_path}: {e}")

    print("----------------------------------------------------------------------")
    print(f"Em-Dash Audit Summary: Scanned {total_files} files across repository.")
    if violations > 0:
        print(f"[ERROR] Found {violations} prohibited character violations!")
        return 1

    print("[SUCCESS] Zero prohibited em dashes detected. Codebase is clean.")
    return 0


if __name__ == "__main__":
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    sys.exit(audit_repository(root))
