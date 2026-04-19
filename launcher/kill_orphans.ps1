$proc = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Generate a 3-5 word*' }
foreach ($p in $proc) {
    try { Stop-Process -Id $p.ProcessId -Force } catch {}
    Write-Output ("killed " + $p.ProcessId)
}
Start-Sleep -Seconds 2
$remain = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Generate a 3-5 word*' } | Measure-Object).Count
Write-Output ("remaining: " + $remain)
