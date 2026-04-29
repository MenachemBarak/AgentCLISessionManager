# Knowledge — step 000005

## What shipped overnight (14 releases)

Every tag at https://github.com/MenachemBarak/AgentCLISessionManager/releases

| Tag | Highlights |
|---|---|
| v1.1.1 | Legacy session-tab auto-resume fix (the screenshot you showed) |
| v1.2.0 | Proper Windows installer (Inno Setup) + opt-in daemon-split |
| v1.2.1 | Smart search wired in left pane |
| v1.2.2 | Ctrl+K command palette + installer switched to one-folder (no `_MEI` dialog) |
| v1.2.3 | Palette preview pane + Unicode tokenizer |
| v1.2.4 | Palette recent searches |
| v1.2.5 | Session → Markdown export |
| v1.2.6 | Pin-to-top + copy session id |
| v1.2.7 | Keyboard nav + Ctrl+F transcript find |
| v1.2.8 | Session-move reliability (eager-rescan fallback) |
| v1.2.9 | Hover-to-copy message |
| v1.2.10 | `?` shortcut help overlay |
| v1.2.11 | `showing N of M` filter footer + one-click `clear` chip |
| v1.2.12 | Session-move `force=True` fix (root-cause mtime race) |
| v1.2.13 | `DAEMON` title-bar chip for opt-in mode |
| v1.2.14 | `(press /)` hint in search placeholder |

## Install state AFTER this step

- **`%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe`** = v1.2.14 (19,191,802 bytes, SHA-256 `df6e2501b2c4529938cf6168ce2906bf9227c4a9db03abb41c9806e0c3a59a35`)
- **`AgentManager.exe.old-1.1.1`** = previous (v1.1.1) kept for one-step rollback
- Earlier backups still present: `.old-1.0.0`, `.old-1.1.0`, `.old`
- Desktop + Start-menu shortcuts unchanged (already point at `AgentManager.exe`)

## Verify-live command

```cmd
"%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe" --version
# → AgentManager 1.2.14
```

## Idle-loop state

- `/loop` cron job `8d18b522` running `7,37 * * * *`, reminder text installed as the ambient rule. Auto-expires 7 days after scheduling.
- Autonomous session has been idle on releases since v1.2.14 was tagged (~40min ago as of this step).

## Session aggregate (start → now)

- **14 releases** shipped
- **43 PRs** merged
- **17/17** original tasks complete; #42 flagged `in_progress` for Phase 8-10 deployment-milestone bookkeeping
- **4 step snapshots** now exist (`step-000001` → `step-000004`), this is **step-000005**
