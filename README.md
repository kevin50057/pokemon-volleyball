# 寶可夢排球 Ultimate — 自架版

純靜態網站，放到任何靜態主機（GitHub Pages、Cloudflare Pages、Netlify）就能玩，連線對戰不需要 Claude 帳號。

## 部署到 GitHub Pages
1. 建一個新的 repository，把這個資料夾的所有檔案放進去（index.html 要在最上層）。
2. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾 `/ (root)`。
3. 一兩分鐘後網址是 `https://<帳號>.github.io/<repo 名稱>/`。

## 連線架構（三層）
1. 點對點直連（WebRTC，不可靠模式）：延遲最低。
2. 中繼備援：同時連三個公開 MQTT 伺服器（`selfroom.js` 最上面的清單）。直連打不通或斷掉時自動改走中繼，其中一個伺服器掛了自動換下一個。
3. 自我修復：每層各自退避重連；直連 4 秒沒資料就退回中繼並在背景重建。

想換成自己的中繼伺服器：在 `zh/index.html` 加 `<script>window.PV_BROKERS=['wss://你的網域/mqtt']</script>`。
