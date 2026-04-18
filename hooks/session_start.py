"""Claude Code hook: stamp the tab title with the session id.

Claude Code's TUI continuously rewrites the terminal tab title, so a one-shot
OSC-0 from SessionStart alone gets overwritten. This hook handles two events:

- SessionStart: emit OSC-0 `cc-<sid>` directly to the terminal.
- UserPromptSubmit: return JSON with `sessionTitle: cc-<sid>` so Claude's own
  rendering includes the tag in its tab title.

Both combined give the Sessions Viewer a reliable cc-<sid> marker to match
via UI Automation when focusing a specific WT tab.

Invoked as: `python session_start.py <event-name>`.
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    sid = (data.get("session_id") or "").strip()
    if not sid:
        return
    event = (data.get("hook_event_name") or "").strip()
    label = f"cc-{sid}"

    if event == "UserPromptSubmit":
        # Ask Claude to set its session title; it will include this in the
        # OSC-0 stream it writes to the terminal on every render.
        out = {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "sessionTitle": label,
            }
        }
        sys.stdout.write(json.dumps(out))
        return

    # SessionStart (and anything else) — emit OSC-0 directly.
    sys.stdout.write(f"\x1b]0;{label}\x07")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
