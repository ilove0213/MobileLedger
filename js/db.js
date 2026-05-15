/**
 * db.js
 * IndexedDB 封裝層 — 管理交易與分類的本地持久化
 *
 * 設計重點：
 * - 單一資料庫 MobileLedger，內含兩個 object store：transactions、categories
 * - 所有操作回傳 Promise，避免 callback 巢狀
 * - readwrite 操作以 transaction.oncomplete 為完成依據（確保資料真的寫入）
 */

/**
 * 交易資料型別（JSDoc 用於 IDE 提示）
 * @typedef {Object} Transaction
 * @property {number} [id]        - 主鍵，IndexedDB 自動產生
 * @property {string} date        - ISO 日期 (YYYY-MM-DD)
 * @property {'支出'|'收入'|'轉帳'} type
 * @property {number} amount      - 金額（一律正數，正負由 type 表達）
 * @property {string} category    - 分類名稱
 * @property {string} note        - 備註，可為空字串
 * @property {number} createdAt   - 建立時間 timestamp（ms）
 */

/**
 * 分類資料型別
 * @typedef {Object} Category
 * @property {number} [id]
 * @property {'支出'|'收入'|'轉帳'} type
 * @property {string} name
 * @property {number} order       - 同類型內的排序
 */

class LedgerDB {
  constructor() {
    /** @type {string} 資料庫名稱 */
    this.dbName = 'MobileLedger';
    /** @type {number} schema 版本，需更動結構時遞增 */
    this.version = 2;
    /** @type {IDBDatabase | null} */
    this.db = null;
  }

  /**
   * 開啟資料庫；首次開啟時建立 object store 並填入預設分類
   * @returns {Promise<void>}
   */
  async init() {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);

      // 第一次開啟或版本升級時建立 schema
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;

        // transactions：主鍵自增、依日期/類型建索引以便篩選
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }

        // categories：主鍵自增、依類型建索引
        if (!db.objectStoreNames.contains('categories')) {
          const store = db.createObjectStore('categories', {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('type', 'type', { unique: false });
        } else if (oldVersion < 2) {
          // v1 → v2：清空舊分類，onsuccess 後重新 seed 新的 5 種類型
          event.target.transaction.objectStore('categories').clear();
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    // 若分類為空，寫入預設分類（首次安裝）
    const existing = await this.getAllCategories();
    if (existing.length === 0) {
      await this._seedDefaultCategories();
    }
  }

  /**
   * 寫入預設分類
   * @returns {Promise<void>}
   * @private
   */
  async _seedDefaultCategories() {
    /** 預設 5 種類型，字串與使用者需求完全一致 */
    const defaults = [
      { type: '支出', name: '共同生活費(現)', order: 0 },
      { type: '支出', name: '保險(轉)',       order: 1 },
      { type: '支出', name: '共同好料(現)',   order: 2 },
      { type: '支出', name: '好料(現)',       order: 3 },
      { type: '支出', name: '共同汽機車(現)', order: 4 },
    ];
    for (const cat of defaults) {
      await this.addCategory(cat);
    }
  }

  /**
   * 通用 transaction 包裝
   * 對 readwrite 操作，等待 tx.oncomplete 確保寫入；對 readonly 則直接取 req.result
   * @template T
   * @param {string} storeName
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => IDBRequest} action
   * @returns {Promise<T>}
   * @private
   */
  _run(storeName, mode, action) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('資料庫尚未初始化'));
        return;
      }
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = action(store);
      let result;

      req.onsuccess = () => { result = req.result; };
      req.onerror = () => reject(req.error);

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('交易被中止'));
    });
  }

  // ========== Transactions ==========

  /**
   * 新增交易
   * @param {Omit<Transaction, 'id'>} tx
   * @returns {Promise<number>} 新增的 id
   */
  addTransaction(tx) {
    return this._run('transactions', 'readwrite', s => s.add(tx));
  }

  /**
   * 更新交易（id 必填）
   * @param {Transaction} tx
   * @returns {Promise<number>}
   */
  updateTransaction(tx) {
    return this._run('transactions', 'readwrite', s => s.put(tx));
  }

  /**
   * 刪除單筆交易
   * @param {number} id
   * @returns {Promise<void>}
   */
  deleteTransaction(id) {
    return this._run('transactions', 'readwrite', s => s.delete(id));
  }

  /**
   * 取得所有交易
   * @returns {Promise<Transaction[]>}
   */
  getAllTransactions() {
    return this._run('transactions', 'readonly', s => s.getAll());
  }

  /**
   * 清空所有交易
   * @returns {Promise<void>}
   */
  clearAllTransactions() {
    return this._run('transactions', 'readwrite', s => s.clear());
  }

  // ========== Categories ==========

  /**
   * 新增分類
   * @param {Omit<Category, 'id'>} cat
   * @returns {Promise<number>}
   */
  addCategory(cat) {
    return this._run('categories', 'readwrite', s => s.add(cat));
  }

  /**
   * 刪除分類
   * @param {number} id
   * @returns {Promise<void>}
   */
  deleteCategory(id) {
    return this._run('categories', 'readwrite', s => s.delete(id));
  }

  /**
   * 取得所有分類
   * @returns {Promise<Category[]>}
   */
  getAllCategories() {
    return this._run('categories', 'readonly', s => s.getAll());
  }
}

// 暴露為全域單例（搭配 <script> 標籤載入的方式）
window.ledgerDB = new LedgerDB();
