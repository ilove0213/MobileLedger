# MobileLedger 手機記帳本

## 執行環境
- 純前端 PWA（HTML/CSS/JS，無建置流程、無 npm、無框架）
- 部署：GitHub Pages（`https://ilove0213.github.io/MobileLedger/`），推送 `main` 分支即自動部署
- 本機預覽：`python -m http.server` 或用 `.claude/launch.json` 的 preview 設定（見根目錄 `D:\一級資料\程式碼\.claude\launch.json`）
- 不要 `npm install` 任何東西——這個專案刻意不用建置工具

---

## 專案概述
- 資料庫：瀏覽器 IndexedDB（`MobileLedger` DB，`transactions` / `categories` 兩個 object store）
- 架構：`db.js`（資料層）→ `export.js` / `drive-backup.js`（匯出/同步層）→ `app.js`（UI/事件層）
- 單一 `LedgerApp` 類別管理所有狀態，事件委派 + 直接綁定混合
- **資料只存在使用者那支手機的瀏覽器裡，不會自動上傳**（雲端硬碟備份是選擇性功能，見下方）

---

## 檔案結構

```
MobileLedger/
├── index.html              # 唯一頁面，三個 <section class="page"> 切換顯示
├── manifest.json            # PWA manifest（圖示、名稱）
├── service-worker.js        # Cache First 離線快取
├── css/style.css
├── icons/icon-192.png, icon-512.png
└── js/
    ├── db.js                # LedgerDB：IndexedDB 封裝，所有方法回傳 Promise
    ├── export.js             # ExcelExporter：Excel 匯出、JSON 備份匯出/匯入、buildBackupObject() 共用邏輯
    ├── drive-config.js       # GOOGLE_DRIVE_CLIENT_ID（公開值，可進 git）
    ├── drive-backup.js       # DriveBackup：OAuth 連結、靜默換權杖、自動上傳雲端硬碟
    └── app.js                # LedgerApp：UI 渲染、事件綁定、串接上面所有模組
```

**載入順序（index.html 底部）必須是：** `db.js → export.js → drive-config.js → drive-backup.js → app.js`
（`drive-backup.js` 用到 `window.excelExporter.buildBackupObject`，`app.js` 用到前面全部）

---

## Google 雲端硬碟自動備份（重要，改動前先懂這套機制）

- **用途**：換手機/手機故障時的資料救援。使用者本來就會每天打開 App 記帳，藉此順便自動備份，不需額外動作
- **範圍最小化**：只要求 `drive.file` scope（僅能存取此 App 自己建立的檔案）
- **固定檔名覆蓋**：每次都上傳同一個檔案 `MobileLedger_backup.json`，不新增多個帶日期的檔案。舊版本救援交給 Google Drive 內建的版本記錄，不用自己管理保留策略
- **「自動」的實際定義**：只在使用者打開 App 時檢查「距上次備份是否 ≥ 1 天」，網頁沒有能力在完全沒開啟時背景執行——這是刻意的設計，不是缺陷，不要嘗試用 Periodic Background Sync 之類的 API 硬做「真背景」，Android Chrome 支援度不可靠
- **任何失敗都要吞掉**：`autoBackupIfNeeded()` 內部 try/catch，絕不能讓雲端備份的例外中斷記帳這個核心功能
- **Client ID 設定**：使用者自行在 Google Cloud Console 建立 OAuth 用戶端（類型必須是「網頁應用程式」，不是「電腦」），已授權來源填 `https://ilove0213.github.io`，填入 `js/drive-config.js`。這是公開值，可以進 git

---

## Service Worker / 快取（踩過的坑，務必遵守）

1. **改任何 `CORE_ASSETS` 內的檔案（HTML/CSS/JS/圖示），一定要把 `service-worker.js` 的 `CACHE_VERSION` 往上加一版**，否則使用者端因為 Cache First 策略永遠吃不到新版本
2. `cache.add()` 在 install 階段一律用 `new Request(url, { cache: 'reload' })`，強制略過瀏覽器 HTTP 快取——本機重複測試時曾經因為瀏覽器 HTTP 快取層記住舊版 `app.js`，即使 Service Worker 版本號已提升、cache name 已改變，`cache.add` 內部 fetch 仍拿到舊內容
3. 新增靜態檔案時記得同步加進 `CORE_ASSETS` 陣列
4. 外部資源（`accounts.google.com/gsi/client`、`cdn.jsdelivr.net` 的 xlsx）：GIS script 刻意不放進 `CORE_ASSETS` 預快取（只在真正要連結雲端硬碟時才動態載入），xlsx CDN 則有放（記帳/匯出的核心功能，離線也要能用）

---

## 已完成功能

- 新增/編輯/刪除交易，分類管理（僅「支出」一種 type，`type` 欄位保留是為了未來可能擴充收入/轉帳）
- 月份篩選、分類摘要
- Excel 匯出（依年/季篩選，SheetJS）
- **JSON 完整備份匯出/匯入**（本機手動，`export.js` 的 `exportToJSON` / `importFromJSON`）
- **Google 雲端硬碟自動備份**（見上方專節）
- PWA 離線支援、可加到主畫面

---

## 開發原則

1. 純前端無建置流程——不要引入 bundler、不要建議改用框架
2. 強型別：所有函數用 JSDoc `@param`/`@returns` 標註型別（這專案沒有 TypeScript，JSDoc 是唯一的型別文件）
3. 註解使用繁體中文，只寫「為什麼」不寫「做什麼」
4. `db.js` 的所有 DB 操作都要回傳 Promise，`readwrite` 操作以 `tx.oncomplete` 為完成依據（不要只看 `req.onsuccess`，那不保證真的寫入）
5. 任何會修改/清空資料的操作（清除全部、匯入覆蓋）都要有確認對話框，匯入甚至要提醒「無法復原」
6. 改完 UI 相關的檔案，優先用 Browser 工具本機起服務驗證過（含：清掉舊的 Service Worker registration + caches 再測，見上方踩過的坑），不要只憑語法檢查就回報完成
7. git commit 訊息、PR 相關動作維持一般 Claude Code 規範（僅在使用者明確要求時才 commit / push）
