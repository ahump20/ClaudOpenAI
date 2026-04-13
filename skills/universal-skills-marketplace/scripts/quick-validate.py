#!/usr/bin/env python3
"""quick-validate.py — Python mirror of validate.sh for CI / cross-platform use.

Performs the same 9 rules as validate.sh but in Python. Exits 0 on pass, 1 on fail.

Usage:
    python3 quick-validate.py [path-to-skill-dir]

If no path given, defaults to the skill dir containing this script.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SKILL_DIR = SCRIPT_DIR.parent


def main(skill_dir: Path) -> int:
    skill_name = skill_dir.name
    skill_md = skill_dir / "SKILL.md"
    print(f"=== Validating skill: {skill_name} ===")
    print(f"    path: {skill_dir}")
    print()

    fail_count = 0

    def pass_check(msg: str) -> None:
        print(f"  ✓ {msg}")

    def fail_check(msg: str) -> None:
        nonlocal fail_count
        print(f"  ✗ {msg}")
        fail_count += 1

    # R1
    print("R1. SKILL.md exists and non-empty")
    if skill_md.exists() and skill_md.stat().st_size > 0:
        pass_check(f"SKILL.md exists ({skill_md.stat().st_size} bytes)")
    else:
        fail_check("SKILL.md missing or empty")
        return 1

    # R2
    print("\nR2. SKILL.md ≤ 100 lines")
    content = skill_md.read_text()
    lines = content.count("\n")
    if lines <= 100:
        pass_check(f"SKILL.md is {lines} lines")
    else:
        fail_check(f"SKILL.md is {lines} lines (> 100)")

    # R3
    print("\nR3. YAML frontmatter with name + description")
    fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    frontmatter = fm_match.group(1) if fm_match else ""
    name_in_fm = re.search(r"^name:\s*(\S.*)$", frontmatter, re.MULTILINE)
    desc_in_fm = re.search(r"^description:", frontmatter, re.MULTILINE)
    if name_in_fm:
        pass_check("frontmatter has 'name'")
    else:
        fail_check("frontmatter missing 'name'")
    if desc_in_fm:
        pass_check("frontmatter has 'description'")
    else:
        fail_check("frontmatter missing 'description'")

    # R4
    print("\nR4. frontmatter name matches directory name")
    fm_name = name_in_fm.group(1).strip() if name_in_fm else None
    if fm_name == skill_name:
        pass_check(f"name '{fm_name}' matches dir '{skill_name}'")
    else:
        fail_check(f"name '{fm_name}' does not match dir '{skill_name}'")

    # R5
    print("\nR5. required subdirectories")
    for d in ("references", "scripts", "assets"):
        if (skill_dir / d).is_dir():
            pass_check(f"{d}/ exists")
        else:
            fail_check(f"{d}/ missing")

    # R6
    print("\nR6. references 00-12 all present")
    refs_dir = skill_dir / "references"
    missing = []
    if refs_dir.is_dir():
        for n in range(13):
            prefix = f"{n:02d}-"
            if not any(f.name.startswith(prefix) for f in refs_dir.iterdir() if f.is_file()):
                missing.append(prefix)
    else:
        missing = [f"{n:02d}-" for n in range(13)]
    if not missing:
        pass_check("all 13 references present")
    else:
        fail_check(f"missing prefixes: {' '.join(missing)}")

    # R7
    print("\nR7. scripts executable")
    scripts_dir = skill_dir / "scripts"
    non_exec = []
    if scripts_dir.is_dir():
        for f in scripts_dir.iterdir():
            if f.is_file() and f.suffix == ".sh" and not os.access(f, os.X_OK):
                non_exec.append(f.name)
    if not non_exec:
        pass_check("all .sh scripts executable")
    else:
        fail_check(f"not executable: {', '.join(non_exec)}")

    # R8 — skipped in Python version (see validate.sh for link-check)
    print("\nR8. (link check performed by validate.sh)")

    # R9
    print("\nR9. assets subdirs present")
    assets_dir = skill_dir / "assets"
    for d in ("schemas", "templates", "real-examples", "fixtures", "diagrams"):
        if (assets_dir / d).is_dir():
            pass_check(f"assets/{d}/ exists")
        else:
            fail_check(f"assets/{d}/ missing")

    print()
    print("=== Summary ===")
    if fail_count == 0:
        print(f"✓ PASS — {skill_name} is valid")
        return 0
    else:
        print(f"✗ FAIL — {fail_count} rule(s) failed")
        return 1


if __name__ == "__main__":
    path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SKILL_DIR
    sys.exit(main(path))
