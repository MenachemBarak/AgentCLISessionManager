# PyInstaller ONE-FOLDER spec (task #45 + #48 follow-up).
#
# Produces dist/AgentManager/ containing AgentManager.exe + _internal/
# (python runtime, libs, backend/frontend, hooks). No runtime
# extraction happens — the folder IS the app — which eliminates the
# "Failed to remove temporary directory: %TEMP%\_MEI<pid>" MessageBox
# that the one-file bootloader shows when DLLs are still locked.
#
# Packaged into the Windows installer (installer/agentmanager.iss).
# The one-file pyinstaller.spec is kept for the legacy auto-update
# chain (drop-in single-exe swap helper in backend/updater.py).
#
# Build:  pyinstaller pyinstaller-onedir.spec
# Output: dist/AgentManager/AgentManager.exe  (+ _internal/ sibling)

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve()  # noqa: F821

datas = [
    (str(ROOT / "backend" / "frontend"), "backend/frontend"),
    (str(ROOT / "hooks"), "hooks"),
]

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
    [],
    exclude_binaries=True,  # one-folder: COLLECT() lays binaries next to the exe
    name="AgentManager",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# COLLECT() is what makes this one-folder instead of one-file. Output
# is dist/AgentManager/ with AgentManager.exe at its root and every
# DLL + data file laid out alongside it. No runtime _MEI extraction.
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="AgentManager",
)
