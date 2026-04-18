"""Claude Code hook: tag the terminal tab title with `<label> · <sid8>`.

- SessionStart: emits OSC-0 so the title appears immediately.
- UserPromptSubmit: returns JSON `sessionTitle` so Claude's TUI keeps the
  title across redraws. Also triggers lazy label generation via the viewer
  backend when no label is cached yet.

Label cache at ~/.claude/viewer-labels.json; the viewer server fills it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
LABELS_FILE = HOME / ".claude" / "viewer-labels.json"
VIEWER_URL = "http://127.0.0.1:8765"


def _load_label(sid: str) -> str | None:
    try:
        with LABELS_FILE.open("r", encoding="utf-8") as f:
            d = json.load(f)
        e = d.get(sid)
        return e.get("label") if isinstance(e, dict) else None
    except Exception:
        return None


def _request_label(sid: str, prompt: str) -> None:
    """Fire-and-forget: ask viewer backend to generate a label. Never blocks."""
    try:
        import urllib.request
        body = json.dumps({"prompt": prompt[:1000]}).encode("utf-8")
        req = urllib.request.Request(
            f"{VIEWER_URL}/api/sessions/{sid}/label/generate",
            data=body, method="POST",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=0.4).read()
    except Exception:
        pass


def _compose_title(sid: str) -> str:
    sid8 = sid[:8]
    label = _load_label(sid)
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
        # Ask Claude to use our title for its own renders.
        out = {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "sessionTitle": title,
            }
        }
        sys.stdout.write(json.dumps(out))
        # Trigger label generation if not cached yet.
        if _load_label(sid) is None:
            prompt = (data.get("prompt") or data.get("user_prompt") or "").strip()
            if prompt:
                _request_label(sid, prompt)
        return

    # SessionStart / everything else — emit OSC-0 directly.
    sys.stdout.write(f"\x1b]0;{title}\x07")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
