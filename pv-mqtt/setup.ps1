#Requires -Version 7
#Requires -RunAsAdministrator
# Pokemon Volleyball MQTT 一鍵安裝（以系統管理員身分在 PowerShell 7 執行）

$ErrorActionPreference = 'Stop'
$MqttDir = 'C:\mosquitto-pv'
$TaskName = 'PokemonVolleyballMQTT'
$MosquittoExe = 'C:\Program Files\mosquitto\mosquitto.exe'

Write-Host "`n=== 1. 安裝 Mosquitto ===" -ForegroundColor Cyan
if (-not (Test-Path $MosquittoExe)) {
    winget install --id EclipseFoundation.Mosquitto --source winget --accept-source-agreements --accept-package-agreements
}

Write-Host "`n=== 2. 複製設定檔到 $MqttDir ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $MqttDir -Force | Out-Null
foreach ($f in 'mosquitto.conf', 'acl', 'run-broker.ps1') {
    Copy-Item (Join-Path $PSScriptRoot $f) (Join-Path $MqttDir $f) -Force
}

Write-Host "`n=== 3. 建立開機自動啟動的排程工作 ===" -ForegroundColor Cyan
# Mosquitto 2.1 的服務模式不吃自訂設定檔，所以改用 SYSTEM 排程工作
if (Get-Service MosquittoPV -ErrorAction SilentlyContinue) { sc.exe delete MosquittoPV | Out-Null }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName
    Get-CimInstance Win32_Process -Filter "Name='mosquitto.exe'" |
        Where-Object { $_.CommandLine -like '*mosquitto-pv*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $MqttDir\run-broker.ps1"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Description 'Pokemon Volleyball MQTT broker (Mosquitto on 9001)' `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "`n=== 4. 驗證 ===" -ForegroundColor Cyan
Start-Sleep -Seconds 4
if (Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Mosquitto 已在 port 9001 運作' -ForegroundColor Green
} else {
    Write-Host "port 9001 沒有在監聽，請查看 $MqttDir\mosquitto.log" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== 5. Tailscale（只需做一次）===" -ForegroundColor Cyan
Write-Host @'
  tailscale serve --bg --https=443 http://localhost:9001
  tailscale status   # 查機器名

broker URL：wss://<機器名>.<tailnet>.ts.net/mqtt
'@ -ForegroundColor Yellow
