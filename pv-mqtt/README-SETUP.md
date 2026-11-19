# Pokemon Volleyball MQTT Server 安裝指南
## Windows + Tailscale 方案

### 前置條件
- Windows 10/11，PowerShell 7（`winget install --id Microsoft.PowerShell`）
- 你和對手都在同一個 Tailnet（或把裝置分享給對方）

### 一鍵安裝

以**系統管理員**身分開啟 PowerShell 7（`pwsh`），在 `pv-mqtt` 資料夾執行：
```powershell
.\setup.ps1
```

腳本會：
1. 用 winget 安裝 Mosquitto（`EclipseFoundation.Mosquitto`）
2. 把 `mosquitto.conf`、`acl`、`run-broker.ps1` 複製到 `C:\mosquitto-pv`
3. 建立排程工作 `PokemonVolleyballMQTT`：開機時以 SYSTEM 身分執行，Mosquitto 當掉 5 秒後自動重啟
4. 確認 port 9001 有在監聽

> 為什麼不用 Windows 服務：Mosquitto 2.1 的服務模式不支援自訂設定檔路徑，會卡在 StartPending。

### Tailscale Serve（只需設定一次，重開機會保留）
```powershell
tailscale serve --bg --https=443 http://localhost:9001
```
broker URL：`wss://<機器名>.<tailnet>.ts.net/mqtt`，填進各語言 `index.html` 的 `window.PV_BROKERS` 第一個位置。

### 維運
- 日誌：`C:\mosquitto-pv\mosquitto.log`（Mosquitto 執行中會鎖住檔案，要先停止排程工作才能讀）
- 重啟：`Stop-ScheduledTask PokemonVolleyballMQTT; Start-ScheduledTask PokemonVolleyballMQTT`（需系統管理員）
- 只允許 `pvu9x7/#` 主題（見 `acl`）
- 你的電腦要開著，對手才連得到自架 broker；關機時遊戲會自動退回公共 broker
