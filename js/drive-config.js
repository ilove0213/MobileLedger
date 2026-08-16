/**
 * drive-config.js
 * Google 雲端硬碟備份設定
 *
 * Client ID 是公開值，可以放在前端程式碼、上傳到 GitHub 都沒關係
 * （它不是密碼，沒有對應的使用者同意，Google 不會核發任何權杖）。
 *
 * 設定步驟：
 * 1. https://console.cloud.google.com/ 建立/選擇專案，啟用「Google Drive API」
 * 2. OAuth 同意畫面：外部、測試模式，把自己的 Google 帳號加入「測試使用者」
 * 3. 憑證 → 建立憑證 → OAuth 用戶端 ID → 應用程式類型選「網頁應用程式」
 * 4. 已授權的 JavaScript 來源填：https://ilove0213.github.io
 * 5. 複製「用戶端 ID」（格式類似 xxxxx.apps.googleusercontent.com）貼到下面
 */
window.GOOGLE_DRIVE_CLIENT_ID = '641366057673-cghg8af1bqjghj9ardsb6439daq5nlhd.apps.googleusercontent.com';
