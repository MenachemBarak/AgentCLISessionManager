# PyInstaller spec for AgentManager-Daemon.exe (ADR-18 Phase 9).
#
# Builds the long-lived daemon binary that owns all PTY sessions and runs
# uvicorn on 127.0.0.1:8765. No webview — this is a headless service.
# console=True because the process is spawned DETACHED so no console window
# is actually visible; the flag just means no Windows subsystem override.
#
# Build:  pyinstaller pyinstaller-daemon.spec
# Output: dist/AgentManager-Daemon.exe

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
    + [
        "backend.app",
        "backend.cli",
        "backend.__version__",
        "daemon.bootstrap",
        "daemon.launcher",
        "daemon.uninstall",
        "daemon.__main__",
    ]
)

a = Analysis(  # noqa: F821
    ["daemon/__main__.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["webview", "tkinter", "matplotlib", "numpy", "pandas", "scipy"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AgentManager-Daemon",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
