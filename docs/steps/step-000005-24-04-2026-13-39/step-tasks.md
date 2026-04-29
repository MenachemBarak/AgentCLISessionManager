# Step tasks — step 000005

## T-35: Summarize overnight release train (v1.1.1 → v1.2.14)

- **BEFORE**: User had been away; 14 releases shipped between step-000004 and this check-in.
- **AFTER**: Delivered a single compact markdown table summarising each tag's headline feature. No code changes in this sub-task.
- **Files**: N/A (reporting only).
- **Related prior steps**: step-000004/knowledge.md already documents the full release grid, but only through v1.2.7. This step extends through v1.2.14.
- **Related sibling files**: `knowledge.md` in this step.

## T-36: Install v1.2.14 on user's machine + verify

- **BEFORE**: `%LOCALAPPDATA%\Programs\AgentManager\AgentManager.exe` = v1.1.1 (19,136,581 bytes).
- **AFTER**: same path = v1.2.14 (19,191,802 bytes); `--version` returns `AgentManager 1.2.14`. Previous binary preserved as `AgentManager.exe.old-1.1.1` for rollback.
- **Files**: no repo changes; local filesystem swap only.
  - `C:\Users\User\Downloads\am-v1.2.14\AgentManager-1.2.14-windows-x64.exe` (downloaded)
  - `C:\Users\User\AppData\Local\Programs\AgentManager\AgentManager.exe` (replaced)
  - `C:\Users\User\AppData\Local\Programs\AgentManager\AgentManager.exe.old-1.1.1` (new backup)
- **Related prior steps**: step-000003/T-23 (the original "install it properly" action). Mirrors that flow but for v1.1.1→v1.2.14 instead of v0.9.x→v1.0.1.
- **Related sibling files**: `architecture-decisions.md::ADR-25`, `lessons-learned.md::L-33`, `maintenance.md` (rollback + upgrade runbook).

## T-37: Write this step snapshot

- **BEFORE**: Latest step was step-000004 (covers v1.1.1 → v1.2.7).
- **AFTER**: step-000005 extends through v1.2.14 + documents the manual install.
- **Files**: `docs/steps/step-000005-24-04-2026-13-39/{user-notes,knowledge,architecture-decisions,lessons-learned,maintenance,step-tasks}.md`
- **Related prior steps**: step-000001 through step-000004.
- **Timer**: task-timer MCP still unavailable (same as step-000004). No wall-clock timer started; noted in `lessons-learned.md::L-31`.
