# Lessons learned — step 000005

## L-31: The task-timer MCP is still not loaded in this session

- **What happened**: The `/step` skill's step 1 asks to start a 10-minute `task-timer` via `mcp__task-timer__timer_start`. `ToolSearch` returned no matches again (same as step-000004).
- **Root cause**: The task-timer MCP server isn't configured in this Claude Code session. Has been absent for at least 2 consecutive step invocations.
- **Fix / workaround**: Skipped the timer. The skill's fallback path allows this — the timer was always a soft wall-clock marker, not a gate.
- **Future avoidance**: Don't retry ToolSearch for the same MCP twice in one session. If the first search returned zero results, it won't be loaded in the same session. Either enable the MCP server in `~/.claude/mcp_servers.json` or stop re-probing.

## L-32: Idle windows tempt "inventing work" — resist it

- **What happened**: Cron reminder fired 6-7 times during a long idle window after v1.2.14 shipped. Each tick asks me to "verify visually". State was unchanged every time: 0 PRs, 3/3 green runs, latest tag v1.2.14.
- **Root cause**: The reminder is valuable when there IS work; it's noise when there isn't. Natural pull: ship a tiny polish "just to have something to do".
- **Fix / workaround**: Honor the rule literally — verify visually, and if nothing's changed, **don't act**. Minimal response confirming steady state is the correct output. Inventing features when the product is healthy burns the 5-minute prompt-cache cost for near-zero user value.
- **Future avoidance**: Treat "silence is correct" as an active state. Holding cadence is as valid a decision as shipping.

## L-33: User installs are **not** Inno-managed on this machine

- **What happened**: When deciding how to install v1.2.14, I checked the existing `%LOCALAPPDATA%\Programs\AgentManager\` layout. It had `AgentManager.exe`, `.old`, `.old-1.0.0`, `.old-1.1.0` — the signature of manual swap-helper chain, not an Inno `unins000.exe` install.
- **Root cause**: User manually installed v1.0.0 and subsequent versions have been swap-helper upgraded or manually swapped. The Inno Setup installer shipped in v1.2.0 was never actually run by the user (they ran the raw exe instead).
- **Fix / workaround**: Continued with the raw-exe swap approach (consistent with existing layout). Did NOT run the installer — that would have created a second parallel install that competes with the user's muscle memory.
- **Future avoidance**: Before deciding between installer vs swap, look for `unins000.exe` or `unins000.dat` in the install dir. If present → Inno-managed, prefer installer. If absent → raw-exe chain, prefer direct swap.
