/**
 * export.js
 * Excel 匯出 — 使用 SheetJS (xlsx) 將交易資料輸出為 .xlsx
 *
 * 匯出檔內含兩張工作表：
 *  1. 「明細」：依日期排序的全部交易
 *  2. 「分類摘要」：依類型+分類彙總總金額與筆數
 */

class ExcelExporter {
  /**
   * 建立備份物件（不觸發下載），供本機匯出與雲端上傳共用
   * @param {Transaction[]} transactions
   * @param {Category[]} categories
   * @returns {{ version: number, exportedAt: string, transactions: Transaction[], categories: Category[] }}
   */
  static buildBackupObject(transactions, categories) {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions,
      categories
    };
  }

  /**
   * 完整備份導出 — 將交易與分類導出為 JSON
   * @param {Transaction[]} transactions
   * @param {Category[]} categories
   * @returns {{ filename: string }}
   */
  static exportToJSON(transactions, categories) {
    const backup = ExcelExporter.buildBackupObject(transactions, categories);
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `記帳備份_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return { filename: link.download };
  }

  /**
   * 從 JSON 備份導入（清空舊資料，寫入新資料）
   * @param {File} file
   * @returns {Promise<{ transactionCount: number, categoryCount: number }>}
   */
  static async importFromJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const backup = JSON.parse(e.target.result);
          if (!backup.transactions || !Array.isArray(backup.transactions)) {
            throw new Error('備份格式不正確');
          }
          // 清空舊資料
          await window.ledgerDB.clearAllTransactions();
          await window.ledgerDB.clearAllCategories();
          // 寫入新資料
          for (const tx of backup.transactions) {
            await window.ledgerDB.addTransaction(tx);
          }
          if (backup.categories && Array.isArray(backup.categories)) {
            for (const cat of backup.categories) {
              await window.ledgerDB.addCategory(cat);
            }
          }
          resolve({
            transactionCount: backup.transactions.length,
            categoryCount: backup.categories ? backup.categories.length : 0
          });
        } catch (err) {
          reject(new Error('備份導入失敗：' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('檔案讀取失敗'));
      reader.readAsText(file);
    });
  }

  /**
   * 主要匯出方法
   * @param {Transaction[]} transactions - 所有交易（會在內部依年份/季度篩選）
   * @param {number} year                - 年份，例如 2026
   * @param {'all'|1|2|3|4} quarter      - 季度，'all' 表整年
   * @returns {{ filename: string, count: number }}
   */
  static exportToExcel(transactions, year, quarter) {
    // 依年份與季度篩選
    const filtered = transactions.filter(tx => {
      // tx.date 形如 "2026-05-14"
      const y = Number(tx.date.slice(0, 4));
      const m = Number(tx.date.slice(5, 7));
      if (y !== year) return false;
      if (quarter === 'all') return true;
      // 月份對應季度：1-3→Q1, 4-6→Q2, 7-9→Q3, 10-12→Q4
      const q = Math.ceil(m / 3);
      return q === Number(quarter);
    });

    // 依日期升冪排序，方便逐筆檢視
    filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.id || 0) - (b.id || 0);
    });

    // 建立 workbook
    const wb = XLSX.utils.book_new();
    const sheetTitle = quarter === 'all' ? `${year}年` : `${year}Q${quarter}`;

    // ===== 明細表 =====
    const detailRows = filtered.map(tx => ({
      '日期': tx.date,
      '類型': tx.category,   // 使用者自訂的 5 種類型
      '金額': Number(tx.amount),
      '備註': tx.note || ''
    }));

    // 若無資料，仍輸出含表頭的空表
    const wsDetail = XLSX.utils.json_to_sheet(detailRows, {
      header: ['日期', '類型', '金額', '備註']
    });
    wsDetail['!cols'] = [
      { wch: 14 },  // 日期
      { wch: 20 },  // 類型（最長：共同汽機車(現)）
      { wch: 12 },  // 金額
      { wch: 30 }   // 備註
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, '明細');

    // ===== 分類摘要表（有資料才產出） =====
    if (filtered.length > 0) {
      const summary = ExcelExporter._buildSummary(filtered);
      const wsSummary = XLSX.utils.json_to_sheet(summary, {
        header: ['類型', '分類', '總金額', '筆數']
      });
      wsSummary['!cols'] = [
        { wch: 8 },   // 類型
        { wch: 14 },  // 分類
        { wch: 12 },  // 總金額
        { wch: 8 }    // 筆數
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, '分類摘要');
    }

    // 寫出檔案，瀏覽器會觸發下載
    const filename = `記帳_${sheetTitle}.xlsx`;
    XLSX.writeFile(wb, filename);

    return { filename, count: filtered.length };
  }

  /**
   * 建立分類摘要
   * 依「類型 + 分類」分組加總；類型升冪，類型內依金額遞減
   * @param {Transaction[]} txs
   * @returns {{類型:string, 分類:string, 總金額:number, 筆數:number}[]}
   * @private
   */
  static _buildSummary(txs) {
    /** @type {Map<string, {category:string, total:number, count:number}>} */
    const groupMap = new Map();

    for (const tx of txs) {
      const key = tx.category;
      const cur = groupMap.get(key) || { category: tx.category, total: 0, count: 0 };
      cur.total += Number(tx.amount);
      cur.count += 1;
      groupMap.set(key, cur);
    }

    return [...groupMap.values()]
      .sort((a, b) => b.total - a.total)
      .map(r => ({
        '類型': r.category,
        '總金額': r.total,
        '筆數': r.count
      }));
  }
}

window.excelExporter = ExcelExporter;
