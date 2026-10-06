"""Validate tracked Python syntax and JSON without network calls or dependencies."""

import ast
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def reject_nonfinite(value):
    raise ValueError(f"Nonstandard JSON numeric constant: {value}")


def main():
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    paths = [Path(name) for name in result.stdout.decode("utf-8").split("\0") if name]
    if not paths:
        raise SystemExit("No tracked files; stage the initial repository before checking.")
    failures = []
    python_count = json_count = 0
    for relative in paths:
        if relative.suffix not in {".py", ".json"}:
            continue
        try:
            text = (ROOT / relative).read_text(encoding="utf-8")
            if relative.suffix == ".py":
                ast.parse(text, filename=relative.as_posix())
                python_count += 1
            else:
                json.loads(text, parse_constant=reject_nonfinite)
                json_count += 1
        except (OSError, UnicodeError, SyntaxError, ValueError) as error:
            failures.append(f"{relative.as_posix()}: {error}")
    if failures:
        for message in failures:
            print(message, file=sys.stderr)
        return 1
    print(f"Validated {python_count} Python files and {json_count} JSON files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
