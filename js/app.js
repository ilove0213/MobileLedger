/**
 * app.js
 * 主應用程式 — 串接 UI、資料層 (db)、匯出 (export)
 *
 * 採用單一 LedgerApp 類別管理整體狀態：
 *  - 三個頁面（新增 / 紀錄 / 設定）
 *  - 兩個 Modal（編輯交易 / 匯出 Excel）
 *  - 所有事件以委派或直接綁定方式註冊
 */

class LedgerApp {
  constructor() {
    /** @type {'add'|'list'|'settings'} 目前顯示頁面 */
    this.currentPage = 'add';

    /** @type {Category[]} 全部分類快取 */
    this.categories = [];

    /** @type {Transaction[]} 全部交易快取 */
    this.transactions = [];

    /** @type {'支出'|'收入'|'轉帳'} 新增表單目前選中的類型 */
    this.formType = '支出';

    /** @type {'支出'|'收入'|'轉帳'} 編輯表單目前選中的類型 */
    this.editFormType = '支出';

    /** @type {string} 紀錄頁的月份篩選 ('all' 或 'YYYY-MM') */
    this.filterMonth = 'all';

    /** @type {number | null} Toast 計時器 */
    this._toastTimer = null;
  }

  /**
   * 啟動 App
   */
  async init() {
    await window.ledgerDB.init();
    await this._reloadData();
    this._bindEvents();
    this._setDefaultDate();
    this._renderCategorySelect('t-category', this.formType);
    this._renderCategorySettings();
    this._renderTransactionList();
  }

  /**
   * 重新從 DB 載入分類與交易快取
   * @private
   */
  async _reloadData() {
    this.categories = await window.ledgerDB.getAllCategories();
    this.transactions = await window.ledgerDB.getAllTransactions();
  }

  /**
   * 將新增表單的日期欄位預設為今天
   * @private
   */
  _setDefaultDate() {
    document.getElementById('t-date').value = LedgerApp._todayISO();
  }

  /**
   * 取得今天日期的 ISO 字串（本地時區）
   * @returns {string} YYYY-MM-DD
   * @private
   */
  static _todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // ========== 事件綁定 ==========

  /**
   * 綁定所有事件監聽器（init 階段呼叫一次）
   * @private
   */
  _bindEvents() {
    // --- 底部導覽 ---
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => this._switchPage(btn.dataset.page));
    });

    // --- 新增表單：類型切換 ---
    document.querySelectorAll('.type-tabs[data-form="add"] .type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._setActiveTab('add', tab.dataset.type);
        this.formType = /** @type {any} */ (tab.dataset.type);
        document.getElementById('t-type').value = this.formType;
        this._renderCategorySelect('t-category', this.formType);
      });
    });

    // --- 新增表單：送出 ---
    document.getElementById('transaction-form').addEventListener('submit', e => {
      e.preventDefault();
      this._handleAddTransaction();
    });

    // --- 紀錄頁：月份篩選 ---
    document.getElementById('filter-month').addEventListener('change', e => {
      this.filterMonth = /** @type {HTMLSelectElement} */ (e.target).value;
      this._renderTransactionList();
    });

    // --- 紀錄頁：匯出 ---
    document.getElementById('btn-export').addEventListener('click', () => this._openExportModal());
    document.getElementById('export-cancel').addEventListener('click', () => this._closeModal('export-modal'));
    document.getElementById('export-confirm').addEventListener('click', () => this._handleExport());
    document.getElementById('export-year').addEventListener('change', () => this._updateExportHint());
    document.getElementById('export-quarter').addEventListener('change', () => this._updateExportHint());

    // --- 設定頁：新增分類 ---
    document.querySelectorAll('#page-settings .btn-add').forEach(btn => {
      btn.addEventListener('click', () => this._handleAddCategory(btn.dataset.type));
    });

    // --- 設定頁：分類輸入框 Enter 送出 ---
    document.querySelectorAll('.add-cat-row input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const type = input.id.replace('new-cat-', '');
          this._handleAddCategory(type);
        }
      });
    });

    // --- 設定頁：備份 ---
    document.getElementById('btn-backup-export').addEventListener('click', () => this._handleBackupExport());
    document.getElementById('btn-backup-import').addEventListener('click', () => {
      document.getElementById('backup-file-input').click();
    });
    document.getElementById('backup-file-input').addEventListener('change', e => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (file) this._handleBackupImport(file);
      e.target.value = ''; // 清空，讓同一檔案也能再選一次
    });

    // --- 設定頁：清除所有資料 ---
    document.getElementById('btn-clear-all').addEventListener('click', () => this._handleClearAll());

    // --- 編輯 Modal：類型切換 ---
    document.querySelectorAll('.type-tabs[data-form="edit"] .type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._setActiveTab('edit', tab.dataset.type);
        this.editFormType = /** @type {any} */ (tab.dataset.type);
        document.getElementById('e-type').value = this.editFormType;
        this._renderCategorySelect('e-category', this.editFormType);
      });
    });

    // --- 編輯 Modal：表單送出 / 取消 / 刪除 ---
    document.getElementById('edit-form').addEventListener('submit', e => {
      e.preventDefault();
      this._handleEditSave();
    });
    document.getElementById('edit-cancel').addEventListener('click', () => this._closeModal('edit-modal'));
    document.getElementById('edit-delete').addEventListener('click', () => this._handleEditDelete());

    // --- Modal 點背景關閉 ---
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });
  }

  // ========== 頁面切換 ==========

  /**
   * 切換頁面
   * @param {string} page
   * @private
   */
  _switchPage(page) {
    this.currentPage = /** @type {any} */ (page);
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');

    // 標題列文字
    const titles = { add: '新增交易', list: '交易紀錄', settings: '設定' };
    document.getElementById('page-title').textContent = titles[page] || '記帳本';

    // 進入「紀錄」頁時重新渲染（月份篩選清單可能要更新）
    if (page === 'list') {
      this._renderMonthFilter();
      this._renderTransactionList();
    } else if (page === 'settings') {
      this._renderCategorySettings();
    }
  }

  /**
   * 設定類型 tab 的 active 狀態
   * @param {'add'|'edit'} form
   * @param {string} type
   * @private
   */
  _setActiveTab(form, type) {
    document.querySelectorAll(`.type-tabs[data-form="${form}"] .type-tab`).forEach(t => {
      t.classList.toggle('active', t.dataset.type === type);
    });
  }

  // ========== 渲染 ==========

  /**
   * 渲染分類 <select>
   * @param {string} selectId
   * @param {string} type
   * @private
   */
  _renderCategorySelect(selectId, type) {
    const select = document.getElementById(selectId);
    const cats = this.categories.filter(c => c.type === type);
    if (cats.length === 0) {
      select.innerHTML = '<option value="">（請先到設定新增分類）</option>';
      return;
    }
    select.innerHTML = cats
      .map(c => `<option value="${this._esc(c.name)}">${this._esc(c.name)}</option>`)
      .join('');
  }

  /**
   * 渲染設定頁的分類管理區塊
   * @private
   */
  _renderCategorySettings() {
    // 只有一個類型群組（type 統一為 '支出'）
    const container = document.getElementById('cat-expense');
    const cats = this.categories.filter(c => c.type === '支出');

    container.innerHTML = cats.map(c => `
      <span class="cat-chip">
        ${this._esc(c.name)}
        <button type="button" data-id="${c.id}" aria-label="刪除 ${this._esc(c.name)}">×</button>
      </span>
    `).join('');

    container.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._handleDeleteCategory(Number(btn.dataset.id));
      });
    });
  }

  /**
   * 渲染紀錄頁的月份篩選下拉
   * @private
   */
  _renderMonthFilter() {
    const select = document.getElementById('filter-month');
    const months = new Set();
    for (const tx of this.transactions) {
      months.add(tx.date.slice(0, 7)); // YYYY-MM
    }
    const sorted = [...months].sort().reverse();

    const opts = ['<option value="all">全部月份</option>'];
    for (const m of sorted) {
      opts.push(`<option value="${m}">${m}</option>`);
    }
    select.innerHTML = opts.join('');

    // 若先前選的月份已不存在，回到「全部」
    if (this.filterMonth !== 'all' && !months.has(this.filterMonth)) {
      this.filterMonth = 'all';
    }
    select.value = this.filterMonth;
  }

  /**
   * 渲染交易列表（依日期分群）+ 月份摘要
   * @private
   */
  _renderTransactionList() {
    const container = document.getElementById('transaction-list');
    const summaryBar = document.getElementById('summary-bar');

    // 套用月份篩選
    let txs = [...this.transactions];
    if (this.filterMonth !== 'all') {
      txs = txs.filter(tx => tx.date.startsWith(this.filterMonth));
    }

    // 摘要：總計金額與筆數
    const totalAmount = txs.reduce((s, t) => s + Number(t.amount), 0);

    summaryBar.innerHTML = `
      <div class="summary-card expense" style="grid-column: 1 / 3;">
        <div class="label">總計</div>
        <div class="value">${totalAmount.toLocaleString('zh-TW')}</div>
      </div>
      <div class="summary-card balance">
        <div class="label">筆數</div>
        <div class="value">${txs.length}</div>
      </div>
    `;

    // 排序：日期遞減、同日依 id 遞減（新的在上）
    txs.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.id || 0) - (a.id || 0);
    });

    if (txs.length === 0) {
      container.innerHTML = '<div class="empty-state">目前沒有交易紀錄</div>';
      return;
    }

    // 依日期分群顯示
    /** @type {Map<string, Transaction[]>} */
    const groups = new Map();
    for (const tx of txs) {
      if (!groups.has(tx.date)) groups.set(tx.date, []);
      groups.get(tx.date).push(tx);
    }

    const html = [...groups.entries()].map(([date, items]) => {
      const dayIncome = items.filter(t => t.type === '收入').reduce((s, t) => s + Number(t.amount), 0);
      const dayExpense = items.filter(t => t.type === '支出').reduce((s, t) => s + Number(t.amount), 0);
      const daySummary = [];
      if (dayIncome > 0) daySummary.push(`收 ${dayIncome.toLocaleString('zh-TW')}`);
      if (dayExpense > 0) daySummary.push(`支 ${dayExpense.toLocaleString('zh-TW')}`);

      const itemsHtml = items.map(tx => {
        const typeClass = tx.type === '支出' ? 'expense' : tx.type === '收入' ? 'income' : 'transfer';
        const sign = tx.type === '支出' ? '-' : tx.type === '收入' ? '+' : '';
        const amount = Number(tx.amount).toLocaleString('zh-TW');
        return `
          <div class="tx-item" data-id="${tx.id}">
            <div class="tx-info">
              <div class="tx-top">
                <span class="tx-cat">${this._esc(tx.category)}</span>
                <span class="tx-type-badge">${this._esc(tx.type)}</span>
              </div>
              ${tx.note ? `<div class="tx-note">${this._esc(tx.note)}</div>` : ''}
            </div>
            <div class="tx-amount ${typeClass}">${sign}${amount}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="date-group">
          <div class="date-header">
            <span>${date}</span>
            <span>${daySummary.join(' · ')}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // 綁定點擊 → 開編輯 Modal
    container.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => {
        this._openEditModal(Number(el.dataset.id));
      });
    });
  }

  // ========== 操作：交易 ==========

  /**
   * 處理新增交易
   * @private
   */
  async _handleAddTransaction() {
    const date = /** @type {HTMLInputElement} */ (document.getElementById('t-date')).value;
    const type = /** @type {HTMLInputElement} */ (document.getElementById('t-type')).value;
    const amount = Number(/** @type {HTMLInputElement} */ (document.getElementById('t-amount')).value);
    const category = /** @type {HTMLSelectElement} */ (document.getElementById('t-category')).value;
    const note = /** @type {HTMLInputElement} */ (document.getElementById('t-note')).value.trim();

    if (!date || !type || !category || !(amount > 0)) {
      this._toast('請完整填寫日期、金額與分類');
      return;
    }

    try {
      await window.ledgerDB.addTransaction({
        date, type, amount, category, note, createdAt: Date.now()
      });
      await this._reloadData();
      // 清空金額與備註，保留日期/類型/分類，連續新增方便
      document.getElementById('t-amount').value = '';
      document.getElementById('t-note').value = '';
      document.getElementById('t-amount').focus();
      this._toast('已儲存');
    } catch (err) {
      console.error('新增交易失敗:', err);
      this._toast('儲存失敗：' + err.message);
    }
  }

  /**
   * 開啟編輯 Modal
   * @param {number} id
   * @private
   */
  _openEditModal(id) {
    const tx = this.transactions.find(t => t.id === id);
    if (!tx) {
      this._toast('找不到該筆交易');
      return;
    }

    /** @type {HTMLInputElement} */ (document.getElementById('e-id')).value = String(id);
    /** @type {HTMLInputElement} */ (document.getElementById('e-date')).value = tx.date;
    /** @type {HTMLInputElement} */ (document.getElementById('e-amount')).value = String(tx.amount);
    /** @type {HTMLInputElement} */ (document.getElementById('e-note')).value = tx.note || '';
    /** @type {HTMLInputElement} */ (document.getElementById('e-type')).value = tx.type;

    this.editFormType = /** @type {any} */ (tx.type);
    this._setActiveTab('edit', tx.type);
    this._renderCategorySelect('e-category', tx.type);
    /** @type {HTMLSelectElement} */ (document.getElementById('e-category')).value = tx.category;

    this._openModal('edit-modal');
  }

  /**
   * 儲存編輯結果
   * @private
   */
  async _handleEditSave() {
    const id = Number(/** @type {HTMLInputElement} */ (document.getElementById('e-id')).value);
    const date = /** @type {HTMLInputElement} */ (document.getElementById('e-date')).value;
    const type = /** @type {HTMLInputElement} */ (document.getElementById('e-type')).value;
    const amount = Number(/** @type {HTMLInputElement} */ (document.getElementById('e-amount')).value);
    const category = /** @type {HTMLSelectElement} */ (document.getElementById('e-category')).value;
    const note = /** @type {HTMLInputElement} */ (document.getElementById('e-note')).value.trim();

    if (!date || !type || !category || !(amount > 0)) {
      this._toast('請完整填寫');
      return;
    }

    const original = this.transactions.find(t => t.id === id);
    if (!original) {
      this._toast('找不到原紀錄');
      return;
    }

    try {
      await window.ledgerDB.updateTransaction({
        ...original, id, date, type, amount, category, note
      });
      await this._reloadData();
      this._closeModal('edit-modal');
      this._renderMonthFilter();
      this._renderTransactionList();
      this._toast('已更新');
    } catch (err) {
      console.error('更新失敗:', err);
      this._toast('更新失敗：' + err.message);
    }
  }

  /**
   * 刪除目前編輯中的交易
   * @private
   */
  async _handleEditDelete() {
    const id = Number(/** @type {HTMLInputElement} */ (document.getElementById('e-id')).value);
    if (!confirm('確定要刪除這筆交易？')) return;

    try {
      await window.ledgerDB.deleteTransaction(id);
      await this._reloadData();
      this._closeModal('edit-modal');
      this._renderMonthFilter();
      this._renderTransactionList();
      this._toast('已刪除');
    } catch (err) {
      console.error('刪除失敗:', err);
      this._toast('刪除失敗：' + err.message);
    }
  }

  // ========== 操作：分類 ==========

  /**
   * 處理新增分類
   * @param {string} type
   * @private
   */
  async _handleAddCategory(type) {
    const input = /** @type {HTMLInputElement} */ (document.getElementById(`new-cat-${type}`));
    const name = input.value.trim();
    if (!name) {
      this._toast('請輸入分類名稱');
      return;
    }

    if (this.categories.some(c => c.type === type && c.name === name)) {
      this._toast('該分類已存在');
      return;
    }

    const order = this.categories.filter(c => c.type === type).length;
    try {
      await window.ledgerDB.addCategory({ type: /** @type {any} */ (type), name, order });
      await this._reloadData();
      input.value = '';
      this._renderCategorySettings();
      this._renderCategorySelect('t-category', this.formType);
      this._toast('已新增分類');
    } catch (err) {
      console.error('新增分類失敗:', err);
      this._toast('新增失敗：' + err.message);
    }
  }

  /**
   * 處理刪除分類
   * @param {number} id
   * @private
   */
  async _handleDeleteCategory(id) {
    const cat = this.categories.find(c => c.id === id);
    if (!cat) return;

    // 檢查是否仍被交易使用，提示影響範圍
    const used = this.transactions.filter(t => t.category === cat.name && t.type === cat.type);
    const msg = used.length > 0
      ? `「${cat.name}」已被 ${used.length} 筆交易使用。\n刪除分類不會影響既有紀錄。確定刪除？`
      : `確定要刪除分類「${cat.name}」？`;
    if (!confirm(msg)) return;

    try {
      await window.ledgerDB.deleteCategory(id);
      await this._reloadData();
      this._renderCategorySettings();
      this._renderCategorySelect('t-category', this.formType);
      this._toast('已刪除');
    } catch (err) {
      console.error('刪除分類失敗:', err);
      this._toast('刪除失敗：' + err.message);
    }
  }

  // ========== 操作：備份 ==========

  /**
   * 導出 JSON 備份
   * @private
   */
  _handleBackupExport() {
    try {
      const result = window.excelExporter.exportToJSON(this.transactions, this.categories);
      this._toast(`已導出備份：${result.filename}`);
    } catch (err) {
      console.error('導出備份失敗:', err);
      this._toast('導出失敗：' + err.message);
    }
  }

  /**
   * 導入 JSON 備份
   * @param {File} file
   * @private
   */
  async _handleBackupImport(file) {
    if (!confirm('確定要導入備份？現有資料將被完全替換。此動作無法復原。')) return;

    try {
      const result = await window.excelExporter.importFromJSON(file);
      await this._reloadData();
      this._renderCategorySettings();
      this._renderMonthFilter();
      this._renderTransactionList();
      this._toast(`已導入備份：${result.transactionCount} 筆交易、${result.categoryCount} 個分類`);
    } catch (err) {
      console.error('導入備份失敗:', err);
      this._toast('導入失敗：' + err.message);
    }
  }

  // ========== 操作：清除全部 / 匯出 ==========

  /**
   * 處理清除所有交易（兩段式確認）
   * @private
   */
  async _handleClearAll() {
    if (this.transactions.length === 0) {
      this._toast('目前沒有交易可清除');
      return;
    }
    if (!confirm(`確定要清除全部 ${this.transactions.length} 筆交易紀錄？此動作無法復原。`)) return;
    if (!confirm('再次確認：真的要清除全部交易紀錄？')) return;

    try {
      await window.ledgerDB.clearAllTransactions();
      await this._reloadData();
      this._renderMonthFilter();
      this._renderTransactionList();
      this._toast('已清除所有交易');
    } catch (err) {
      console.error('清除失敗:', err);
      this._toast('清除失敗：' + err.message);
    }
  }

  /**
   * 開啟匯出 Modal
   * @private
   */
  _openExportModal() {
    // 從現有交易與當前年份產生年份選項
    const years = new Set();
    for (const tx of this.transactions) {
      years.add(Number(tx.date.slice(0, 4)));
    }
    const currentYear = new Date().getFullYear();
    years.add(currentYear);

    const sorted = [...years].sort((a, b) => b - a);
    const yearSelect = /** @type {HTMLSelectElement} */ (document.getElementById('export-year'));
    yearSelect.innerHTML = sorted.map(y => `<option value="${y}">${y} 年</option>`).join('');
    yearSelect.value = String(currentYear);

    // 季度預設為當前所屬季
    const currentQ = Math.ceil((new Date().getMonth() + 1) / 3);
    /** @type {HTMLSelectElement} */ (document.getElementById('export-quarter')).value = String(currentQ);

    this._updateExportHint();
    this._openModal('export-modal');
  }

  /**
   * 即時更新匯出 Modal 的提示文字（顯示將匯出幾筆）
   * @private
   */
  _updateExportHint() {
    const year = Number(/** @type {HTMLSelectElement} */ (document.getElementById('export-year')).value);
    const quarter = /** @type {HTMLSelectElement} */ (document.getElementById('export-quarter')).value;

    const count = this.transactions.filter(tx => {
      const y = Number(tx.date.slice(0, 4));
      const m = Number(tx.date.slice(5, 7));
      if (y !== year) return false;
      if (quarter === 'all') return true;
      return Math.ceil(m / 3) === Number(quarter);
    }).length;

    const hint = document.getElementById('export-hint');
    const range = quarter === 'all' ? '整年' : `第 ${quarter} 季`;
    hint.textContent = `將匯出 ${year} 年${range}的 ${count} 筆交易`;
  }

  /**
   * 處理匯出
   * @private
   */
  _handleExport() {
    const year = Number(/** @type {HTMLSelectElement} */ (document.getElementById('export-year')).value);
    const quarterStr = /** @type {HTMLSelectElement} */ (document.getElementById('export-quarter')).value;
    const quarter = quarterStr === 'all' ? 'all' : /** @type {1|2|3|4} */ (Number(quarterStr));

    try {
      const result = window.excelExporter.exportToExcel(this.transactions, year, quarter);
      this._closeModal('export-modal');
      this._toast(`已匯出 ${result.count} 筆 → ${result.filename}`);
    } catch (err) {
      console.error('匯出失敗:', err);
      this._toast('匯出失敗：' + err.message);
    }
  }

  // ========== 工具 ==========

  /**
   * 開啟 Modal
   * @param {string} id
   * @private
   */
  _openModal(id) {
    document.getElementById(id).classList.add('active');
  }

  /**
   * 關閉 Modal
   * @param {string} id
   * @private
   */
  _closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  /**
   * 顯示底部浮動訊息
   * @param {string} msg
   * @private
   */
  _toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /**
   * HTML 跳脫，避免 XSS
   * @param {string} s
   * @returns {string}
   * @private
   */
  _esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// 啟動入口
document.addEventListener('DOMContentLoaded', () => {
  const app = new LedgerApp();
  app.init().catch(err => {
    console.error('App 初始化失敗:', err);
    alert('App 初始化失敗：' + (err.message || err));
  });
});
