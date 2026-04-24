; AgentManager — Inno Setup 6 installer (task #48)
;
; Per-user install (no UAC prompt) that drops the PyInstaller one-file
; exe at %LOCALAPPDATA%\Programs\AgentManager\, creates Desktop + Start-
; menu shortcuts, and registers in Add/Remove Programs.
;
; Build from CI:
;   iscc installer/agentmanager.iss
;     /DMyAppVersion=1.2.0
;     /DMyExeSource=dist/AgentManager-1.2.0-windows-x64.exe
;
; Output: installer/Output/AgentManager-<version>-setup.exe

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#ifndef MyExeSource
  #define MyExeSource "dist\AgentManager.exe"
#endif

#define MyAppName       "AgentManager"
#define MyAppPublisher  "MenachemBarak"
#define MyAppURL        "https://github.com/MenachemBarak/AgentCLISessionManager"
#define MyAppExeName    "AgentManager.exe"

[Setup]
AppId={{4F3C1B2A-8E6D-4C1F-9A7B-1E5F2D3C4B6A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=AgentManager-{#MyAppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install — no UAC elevation. Install dir lives inside
; %LOCALAPPDATA% which is writable without admin.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; When a previous install exists, kill the running exe before
; overwriting its files.
CloseApplications=force
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
Source: "{#MyExeSource}"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Gracefully shut down any running daemon + walk PTY tree before we
; start removing files. --yes skips interactive confirmation;
; --dry-run=false is the default. Ignore the exit code — if the
; daemon is already dead, the CLI still exits 0.
Filename: "{app}\{#MyAppExeName}"; Parameters: "--uninstall --yes"; Flags: runhidden waituntilterminated; RunOnceId: "AgentManagerShutdown"
