# PyInstaller spec for the Claude Sessions Viewer desktop app.
#
# Produces a single-file executable that bundles:
#  - Python runtime
#  - FastAPI + uvicorn + watchdog + psutil + pywebview
#  - backend/frontend/ (the React SPA)
#  - hooks/session_start.py
#
# Build:  pyinstaller pyinstaller.spec
# Output: dist/claude-sessions-viewer[.exe]

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve()  # noqa: F821 — SPECPATH injected by PyInstaller

# Ship the frontend SPA and the Claude Code hook script as data files.
datas = [
    (str(ROOT / "backend" / "frontend"), "backend/frontend"),
    (str(ROOT / "hooks"), "hooks"),
]

# Submodules that dynamic-import at runtime and PyInstaller might miss.
hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("uvicorn.logging")
    + collect_submodules("uvicorn.loops")
    + collect_submodules("uvicorn.protocols")
    + collect_submodules("uvicorn.lifespan")
    + collect_submodules("sse_starlette")
    + collect_submodules("watchdog.observers")
    + collect_submodules("webview")
    + ["backend.app", "backend.cli", "backend.__version__"]
)

a = Analysis(  # noqa: F821
    ["backend/cli.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "scipy"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="claude-sessions-viewer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX triggers Windows Defender false positives
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # true desktop app — no terminal window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
