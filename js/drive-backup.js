/**
 * drive-backup.js
 * Google 雲端硬碟自動備份 — 用 Google Identity Services 做 OAuth，
 * 把記帳資料以固定檔名上傳/覆蓋到使用者自己的雲端硬碟
 *
 * 設計重點：
 * - 只要求 drive.file 權限（僅能存取此 App 自己建立的檔案，範圍最小）
 * - 檔名固定為 MobileLedger_backup.json，每次上傳直接覆蓋
 *   （不同版本的救援交給 Drive 內建的版本記錄，不必自己管理多個檔案）
 * - 首次連結需要使用者互動同意一次；之後每次 App 開啟時嘗試「靜默」換權杖，
 *   換到就檢查上次備份時間，超過門檻就悄悄上傳，不需使用者按按鈕
 * - 任何一步失敗（未設定 Client ID、權杖過期、離線…）都只吞掉錯誤，
 *   絕不能讓自動備份的例外中斷 App 本身的記帳功能
 */

class DriveBackup {
  constructor() {
    /** @type {string} */
    this.clientId = window.GOOGLE_DRIVE_CLIENT_ID || '';
    /** @type {string} 僅存取此 App 建立的檔案，範圍最小化 */
    this.scope = 'https://www.googleapis.com/auth/drive.file';
    /** @type {string} 固定檔名，每次上傳覆蓋同一個檔案 */
    this.fileName = 'MobileLedger_backup.json';
    /** @type {number} 距上次備份超過此時間才會自動再備份一次 */
    this.backupIntervalMs = 24 * 60 * 60 * 1000;

    /** @type {any} google.accounts.oauth2 的 token client 實例 */
    this.tokenClient = null;
    /** @type {string|null} 目前快取的 access token */
    this.accessToken = null;
    /** @type {number} access token 的到期時間（timestamp） */
    this.tokenExpiresAt = 0;
    /** @type {Promise<void>|null} GIS script 載入 promise，避免重複載入 */
    this._gisReady = null;
  }

  /** @returns {boolean} 是否已填入 Client ID */
  get isConfigured() {
    return !!this.clientId;
  }

  /** @returns {boolean} 使用者是否曾完成過一次連結授權 */
  get isLinked() {
    return localStorage.getItem('driveLinked') === 'true';
  }

  /** @returns {number} 上次成功備份的 timestamp（ms），從未備份過為 0 */
  get lastBackupAt() {
    const v = localStorage.getItem('driveLastBackupAt');
    return v ? Number(v) : 0;
  }

  /** @param {number} ts */
  set lastBackupAt(ts) {
    localStorage.setItem('driveLastBackupAt', String(ts));
  }

  /**
   * 載入 Google Identity Services script（只會真正載入一次）
   * @returns {Promise<void>}
   * @private
   */
  _loadGis() {
    if (this._gisReady) return this._gisReady;
    this._gisReady = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('無法載入 Google 服務，請檢查網路連線'));
      document.head.appendChild(script);
    });
    return this._gisReady;
  }

  /**
   * 確保 tokenClient 已建立
   * @returns {Promise<void>}
   * @private
   */
  async _ensureTokenClient() {
    if (!this.isConfigured) {
      throw new Error('尚未設定 Google Client ID（js/drive-config.js）');
    }
    await this._loadGis();
    if (!this.tokenClient) {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: () => {} // 實際 callback 由 _requestToken() 每次呼叫時動態覆蓋
      });
    }
  }

  /**
   * 向 Google 要求存取權杖
   * @param {'consent'|''} prompt 'consent' 顯示同意畫面（首次連結用）；'' 嘗試靜默取得
   * @returns {Promise<string>} access token
   * @private
   */
  _requestToken(prompt) {
    return new Promise((resolve, reject) => {
      this.tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        this.accessToken = resp.access_token;
        this.tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3300) * 1000;
        resolve(this.accessToken);
      };
      this.tokenClient.requestAccessToken({ prompt });
    });
  }

  /**
   * 首次連結雲端硬碟（會跳出 Google 同意畫面，需使用者互動點擊觸發）
   * @returns {Promise<void>}
   */
  async link() {
    await this._ensureTokenClient();
    await this._requestToken('consent');
    localStorage.setItem('driveLinked', 'true');
  }

  /**
   * 取消連結（僅清除本機記錄的連結狀態，不會撤銷 Google 端已核發的授權）
   */
  unlink() {
    localStorage.removeItem('driveLinked');
    localStorage.removeItem('driveLastBackupAt');
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * 取得有效的 access token；快取未過期就直接回傳，否則靜默換新
   * @returns {Promise<string>}
   * @private
   */
  async _getValidToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }
    await this._ensureTokenClient();
    return this._requestToken(''); // 空字串 = 不跳同意畫面，能換到就換，換不到就丟錯誤
  }

  /**
   * 依「距上次備份是否超過門檻」判斷現在該不該自動備份
   * @returns {boolean}
   */
  shouldBackup() {
    return this.isConfigured && this.isLinked &&
      (Date.now() - this.lastBackupAt) >= this.backupIntervalMs;
  }

  /**
   * 在雲端硬碟尋找備份檔案的 id（找不到回傳 null）
   * @param {string} token
   * @returns {Promise<string|null>}
   * @private
   */
  async _findFileId(token) {
    const q = encodeURIComponent(`name='${this.fileName}' and trashed=false`);
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) throw new Error(`查詢雲端硬碟失敗（HTTP ${resp.status}）`);
    const data = await resp.json();
    return (data.files && data.files[0] && data.files[0].id) || null;
  }

  /**
   * 立即執行一次備份上傳（找不到既有檔案就新建，找到就覆蓋內容）
   * @param {Transaction[]} transactions
   * @param {Category[]} categories
   * @returns {Promise<void>}
   */
  async backup(transactions, categories) {
    const token = await this._getValidToken();
    const backupObj = window.excelExporter.buildBackupObject(transactions, categories);
    const content = JSON.stringify(backupObj, null, 2);

    const fileId = await this._findFileId(token);
    let resp;

    if (fileId) {
      // 已有檔案：直接覆蓋內容
      resp = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: content
        }
      );
    } else {
      // 沒有檔案：用 multipart 建立新檔（metadata + 內容）
      const boundary = 'mobileledger-backup-boundary';
      const metadata = { name: this.fileName, mimeType: 'application/json' };
      const body =
        `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/json\r\n\r\n${content}\r\n` +
        `--${boundary}--`;
      resp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body
        }
      );
    }

    if (!resp.ok) throw new Error(`上傳雲端硬碟失敗（HTTP ${resp.status}）`);
    this.lastBackupAt = Date.now();
  }

  /**
   * App 啟動時呼叫：若已連結且該備份了，靜默換權杖並上傳
   * 任何失敗都吞掉不拋出，避免影響 App 正常使用；回傳是否有成功執行備份
   * @param {Transaction[]} transactions
   * @param {Category[]} categories
   * @returns {Promise<boolean>}
   */
  async autoBackupIfNeeded(transactions, categories) {
    if (!this.shouldBackup()) return false;
    try {
      await this.backup(transactions, categories);
      return true;
    } catch (err) {
      console.warn('雲端硬碟自動備份失敗:', err);
      return false;
    }
  }
}

window.driveBackup = new DriveBackup();
