# setlist-2

歌曲庫 / 打軸工具（Android WebView 殼，GitHub Actions 打包）。

## YT 直播（v1.1 新增）
- 底部導覽列「直播」：開啟第二個 WebView，載入桌面版 YouTube（登入、搜尋、直播、聊天室都用原網站）。
- 注入順序：`yt-shim.js`（頁內選單 + 油猴 API 最小子集）→ `dvr.js` → `yt-mobile-combo.user.js`（直向鎖定、時鐘、章節、打call）。
- 左邊緣的「⋯」：切換功能、回 YouTube 首頁、重新整理、開網址、回到歌曲庫。返回鍵也會先退 YouTube 歷史，沒有歷史時回歌曲庫。
- 打call 備份：面板 ⚙ →「匯出全部」會開啟系統儲存視窗。
- 檔案（根目錄平放）：`yt-shim.js`、`yt-mobile-combo.user.js` 需與 `MainActivity.kt` 一起上傳。
