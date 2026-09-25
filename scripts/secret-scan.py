#!/usr/bin/env python3
"""Claude Code PreToolUse hook: block a Claude-started `git commit` when the
STAGED changes contain a high-confidence secret.

Shared with everyone who clones the repo via `.claude/settings.json`. Design
rules (this repo is PUBLIC and its owner is breakage-averse):

- FAIL-OPEN: any error or unexpected situation -> allow (exit 0). The hook can
  never lock you out of committing.
- Only acts on `git commit` (no other Bash command is touched).
- Scans only the added (+) lines of `git diff --cached`.
- NEVER prints the secret value itself, only the TYPE that matched.
- Escape hatch: put `#allow-secret` in the commit command for a false positive.

Exit codes (Claude Code hook contract): 0 = allow, 2 = block the tool call.
"""
import json
import re
import subprocess
import sys

PATTERNS = [
    ("Anthropic API key", r"sk-ant-api03-[A-Za-z0-9_\-]{20,}"),
    ("Shopify token", r"shp(at|ca|ss)_[a-fA-F0-9]{32}"),
    ("Slack token", r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    ("GitHub token", r"ghp_[A-Za-z0-9]{36}"),
    ("AWS key", r"AKIA[0-9A-Z]{16}"),
    ("Private key", r"-----BEGIN[ A-Z]*PRIVATE KEY-----"),
    ("Meta/Facebook token", r"EAA[A-Za-z0-9]{60,}"),
]


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0  # fail-open

    if data.get("tool_name") != "Bash":
        return 0
    cmd = ((data.get("tool_input") or {}).get("command") or "")
    if "git commit" not in cmd or "#allow-secret" in cmd:
        return 0

    try:
        diff = subprocess.run(
            ["git", "diff", "--cached", "--unified=0"],
            cwd=data.get("cwd") or None,
            capture_output=True, text=True, timeout=15,
        ).stdout
    except Exception:
        return 0  # fail-open: no git / nothing staged -> never block

    added = "\n".join(l for l in diff.splitlines()
                      if l.startswith("+") and not l.startswith("+++"))
    hits = sorted({name for name, pat in PATTERNS if re.search(pat, added)})
    if hits:
        sys.stderr.write(
            "SECRET-SCAN blocked this commit: the staged changes look like they "
            f"contain a secret (type: {', '.join(hits)}). Check `git diff --cached`, "
            "un-stage the file (it usually belongs in .gitignore), or add "
            "`#allow-secret` to the commit command if this is a false positive.\n"
        )
        return 2  # exit 2 = block the tool call
    return 0


if __name__ == "__main__":
    sys.exit(main())
