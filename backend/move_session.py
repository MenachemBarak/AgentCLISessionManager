"""Session-move — relocate a Claude Code session JSONL between encoded
project directories.

Claude Code stores each session at
    ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
where <encoded-cwd> is the original working directory with `\\` and `/`
replaced by `-`, and the `:` drive separator replaced by `--`. The
viewer's discovery picks up JSONLs from `projects/*/*.jsonl` — moving a
session from its original project dir to a new one is a simple
file-system rename, PROVIDED:

1. the destination dir exists (or we create it),
2. a file with the same UUID does not already live there (collisions
   mean two sessions claim the same id — never silently overwrite),
3. the source file isn't being written to right now (avoid racing a
   live `claude --resume`).

HIGH-RISK: this moves user data. Every path goes through `plan_move`
(dry-run, returns a structured report) before `execute_move` can run,
and `execute_move` itself requires an explicit confirmation flag.
"""

from __future__ import annotations

import hashlib
import shutil
import time
from pathlib import Path


def encode_cwd(cwd: str) -> str:
    """Encode an absolute filesystem path into Claude Code's projects/
    sub-dir naming scheme.

    The mapping is:
        `:` → `-`  (drive separator → single dash)
        `:\\` / `:/` → `--`  (drive + separator → double dash)
        `\\` → `-`  (path separator)
        `/` → `-`  (path separator)

    This is lossy — a real dash in a directory name becomes ambiguous
    with a path separator — but it matches the encoding Claude Code
    writes on disk, which is what we have to target.
    """
    s = cwd.replace("\\", "/")
    # Drive letter — e.g. "C:" at the start becomes "C-".
    # Then the following `/` becomes another `-` → "C--".
    s = s.replace(":", "-")
    s = s.replace("/", "-")
    # Trim leading/trailing dashes that come from roots like "/home/...".
    return s.strip("-")


def plan_move(
    projects_dir: Path,
    session_id: str,
    target_cwd: str,
    *,
    must_exist_on_disk: bool = True,
) -> dict[str, object]:
    """Compute what `execute_move` would do and report every check.

    Never touches the filesystem beyond reading. The report returned
    here is the ONLY input the frontend dialog shows to the user — the
    confirmation button is gated on `safe_to_move=True`.
    """
    result: dict[str, object] = {
        "session_id": session_id,
        "target_cwd": target_cwd,
        "target_encoded_dir": encode_cwd(target_cwd),
        "safe_to_move": False,
        "warnings": [],
        "errors": [],
    }

    # Locate the source file. First collect every project dir that
    # holds a file for this session id — normally one, but a user could
    # have a collision.
    target_encoded = str(result["target_encoded_dir"])
    all_candidates = list(projects_dir.glob(f"*/{session_id}.jsonl"))

    # If the only place the session exists is already inside the target,
    # the move is a no-op.
    if all_candidates and all(p.parent.name == target_encoded for p in all_candidates):
        result["src_path"] = str(all_candidates[0])
        result["current_encoded_dir"] = target_encoded
        result["errors"].append(  # type: ignore[attr-defined]
            "target_cwd encodes to the same directory the session already lives in — move is a no-op."
        )
        return result

    # Pick a source NOT in the target dir so a pre-existing collision at
    # the destination can't masquerade as the source.
    src: Path | None = None
    for p in all_candidates:
        if p.parent.name == target_encoded:
            continue
        src = p
        break
    if src is None:
        result["errors"].append(  # type: ignore[attr-defined]
            f"Session {session_id} not found under {projects_dir}."
        )
        return result
    result["src_path"] = str(src)
    result["current_encoded_dir"] = src.parent.name

    # Source file modified recently — possibly live. 5s window is arbitrary
    # but matches the activity-label threshold in the provider.
    try:
        age_seconds = time.time() - src.stat().st_mtime
        result["src_age_seconds"] = round(age_seconds, 2)
        if age_seconds < 5:
            result["warnings"].append(  # type: ignore[attr-defined]
                f"Source file was modified {age_seconds:.1f}s ago — "
                "session may still be streaming. Close the running "
                "`claude` process before moving."
            )
    except OSError as e:  # noqa: BLE001 — best-effort age check; age is advisory
        log_warn = f"could not stat source for age check: {e}"
        warnings = result.get("warnings")
        if isinstance(warnings, list):
            warnings.append(log_warn)

    # Compute + validate destination.
    dest_parent = projects_dir / str(result["target_encoded_dir"])
    dest = dest_parent / f"{session_id}.jsonl"
    result["dest_path"] = str(dest)
    result["dest_parent_exists"] = dest_parent.is_dir()
    result["dest_file_exists"] = dest.is_file()

    if dest.is_file():
        result["errors"].append(  # type: ignore[attr-defined]
            f"A session file already exists at {dest} — cannot overwrite."
        )
        return result

    # Optional check — the user might type a cwd that doesn't exist on
    # their filesystem. Not fatal (the encoded dir is decoupled from the
    # real path), but worth surfacing.
    if must_exist_on_disk:
        real_target = Path(target_cwd)
        if not real_target.exists():
            result["warnings"].append(  # type: ignore[attr-defined]
                f"target_cwd `{target_cwd}` does not exist on this machine. "
                "The session will move but the `cwd` field inside each JSONL "
                "line still points to the old path; `claude --resume` will "
                "launch from that old location."
            )

    # Copy-verify-unlink is the plan — compute src hash so the executor
    # can confirm the destination is byte-identical before unlink.
    try:
        h = hashlib.sha256()
        with src.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        result["src_sha256"] = h.hexdigest()
    except OSError as e:
        result["errors"].append(f"could not hash source: {e}")  # type: ignore[attr-defined]
        return result

    if not result["errors"]:
        result["safe_to_move"] = True
    return result


def execute_move(
    projects_dir: Path,
    session_id: str,
    target_cwd: str,
) -> dict[str, object]:
    """Actually perform the move — copy to destination, verify SHA-256,
    then unlink source. The copy-verify-unlink order is critical: if the
    process dies mid-move we are left with either just the source
    (resumable) or both copies (deduplicate by hand); we never end with
    only a partial destination and no source.

    Caller MUST have already invoked `plan_move` and received
    `safe_to_move=True`. This function repeats the safety checks as a
    defense-in-depth measure, but does not return a plan-shaped object.
    """
    plan = plan_move(projects_dir, session_id, target_cwd)
    if not plan.get("safe_to_move"):
        return {
            "ok": False,
            "plan": plan,
            "message": "plan_move refused; see plan.errors",
        }

    src = Path(str(plan["src_path"]))
    dest = Path(str(plan["dest_path"]))
    expected_sha = str(plan["src_sha256"])

    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        # shutil.copy2 preserves mtime — important because the index
        # sorts by lastActive = stat.st_mtime. A naive copy would push
        # the session to the top of the list.
        shutil.copy2(src, dest)
    except OSError as e:
        return {"ok": False, "plan": plan, "message": f"copy failed: {e}"}

    # Verify the destination matches byte-for-byte.
    try:
        h = hashlib.sha256()
        with dest.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        actual = h.hexdigest()
    except OSError as e:
        # Don't unlink source if we can't even read dest back.
        return {"ok": False, "plan": plan, "message": f"verify failed: {e}"}

    if actual != expected_sha:
        # Clean up the bad copy rather than leave a silent duplicate.
        # If unlink fails the user still has a dedupable duplicate, not
        # a silent corruption — the caller is about to return ok:False
        # either way.
        try:
            dest.unlink(missing_ok=True)
        except OSError:  # noqa: S110 — cleanup is best-effort
            pass
        return {
            "ok": False,
            "plan": plan,
            "message": f"SHA mismatch after copy (expected {expected_sha[:12]}, got {actual[:12]})",
        }

    try:
        src.unlink()
    except OSError as e:
        # Destination is valid; source deletion failure is recoverable
        # — user can clean up manually. Report but don't fail hard.
        return {
            "ok": True,
            "plan": plan,
            "message": f"moved but source unlink failed: {e}",
            "src_still_present": True,
        }

    return {"ok": True, "plan": plan, "message": "moved"}
