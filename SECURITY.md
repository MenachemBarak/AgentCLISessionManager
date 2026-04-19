# Security Policy

## Reporting a vulnerability

If you believe you've found a security issue in AgentCLISessionManager, please
report it privately via **GitHub Security Advisories**:

https://github.com/MenachemBarak/AgentCLISessionManager/security/advisories/new

Please do **not** open a public issue. You should receive an acknowledgement
within 7 days.

## Scope

The backend binds to `127.0.0.1` by default and is designed to run on a single
user's workstation. Out-of-scope scenarios:

- Binding to non-loopback interfaces (requires an explicit config change the
  user controls)
- Running the viewer behind a shared proxy without auth
- Host-level compromise (i.e. if an attacker can read `~/.claude/projects`,
  they already have your sessions)

## Supply chain

- **Dependabot** opens weekly PRs for Python deps and GitHub Actions
- **pip-audit** runs on every push/PR and weekly via cron
- **CodeQL** (security-and-quality query suite) runs on every push/PR and
  weekly via cron
- **Bandit** SAST runs in CI
- Security patches and patch-level bumps auto-merge (see
  `.github/workflows/dependabot-auto-merge.yml`)

## Hardening notes

- The server never accepts remote connections on its default bind
- No credentials are stored by the app — labels are the only mutable state
- Subprocess invocations (`wt.exe`, `powershell.exe`) use `shell=False` and
  never interpolate untrusted strings into shell arguments

### `/api/open` command-injection defenses (reviewed false-positive)

`backend/app.py::open_session` passes a session ID and `cwd` to `wt.exe`.
GitHub Advanced Security's CodeQL flags this as potential command injection
via data flow. The finding is suppressed via `.github/codeql/codeql-config.yml`
because every input is sanitized before reaching `subprocess.Popen`:

1. **`sessionId`** — must match a strict UUID regex (`_UUID_RE`); the matched
   substring is extracted as a fresh string before use.
2. **`mode`** — must be exactly `"tab"` or `"split"` (enum whitelist), mapped
   to a constant subcommand (`"nt"` or `"sp"`).
3. **`cwd`** — canonicalized via `pathlib.Path(...).resolve()` before use.
4. **`shell=False`** — no shell interpretation of argv.
5. The previous `cmd.exe /k` fallback (which DID interpolate into a shell
   string) was removed. Missing `wt.exe` now returns 503 instead.

See `tests/test_backend_api.py::test_open_session_rejects_non_uuid_id` for
the regression test covering crafted session IDs.
