"""Claude Code hook: tag the terminal tab title with the user's custom
label if set, else `cc-<sid8>`.

- SessionStart: emits OSC-0 to set tab title immediately.
- UserPromptSubmit: returns JSON `sessionTitle` so Claude's TUI keeps the
  title stable across redraws.

Labels are user-set only (no auto-generation); stored at
~/.claude/viewer-labels.json by the viewer server.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
LABELS_FILE = HOME / ".claude" / "viewer-labels.json"


def _load_user_label(sid: str) -> str | None:
    try:
        with LABELS_FILE.open("r", encoding="utf-8") as f:
            d = json.load(f)
        e = d.get(sid)
        return e.get("userLabel") if isinstance(e, dict) else None
    except Exception:
        return None


def _compose_title(sid: str) -> str:
    sid8 = sid[:8]
    label = _load_user_label(sid)
    return f"{label} · {sid8}" if label else f"cc-{sid8}"


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    sid = (data.get("session_id") or "").strip()
    if not sid:
        return
    event = (data.get("hook_event_name") or "").strip()
    title = _compose_title(sid)

    if event == "UserPromptSubmit":
        out = {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "sessionTitle": title,
            }
        }
        sys.stdout.write(json.dumps(out))
        return

    # SessionStart / everything else — emit OSC-0 directly.
    sys.stdout.write(f"\x1b]0;{title}\x07")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
