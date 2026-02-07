/**
 * ★★★ 利用状況ログ機能 ★★★
 * ユーザーの利用状況を記録するためのスプレッドシートID。
 * 記録用の新しいスプレッドシートを作成し、そのIDをここに貼り付けてください。
 * 例: '12345abcde-FGHIJKLMNOPQRSTUVWXYZ'
 */
const LOG_SHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

/**
 * ユーザーのアクティビティをスプレッドシートに記録します。
 * @param {string} action 実行されたアクション名 (例: 'generatePreviewReport')。
 */
function logUserActivity(action) {
  try {
    if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') return;

    const spreadsheet = SpreadsheetApp.openById(LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName('ActivityLog');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('ActivityLog');
      sheet.appendRow(['Timestamp', 'UserEmail', 'Action']);
    }
    sheet.appendRow([new Date(), Session.getActiveUser().getEmail(), action]);
  } catch (e) {
    console.error(`Failed to log user activity: ${e.message}`);
  }
}
/**
 * @typedef {Object} LogSource
 * @property {string} type - 'slack', 'backlog' などのソースタイプ
 * @property {GoogleAppsScript.URL_Fetch.HttpRequest} request - UrlFetchApp用のリクエストオブジェクト
 */

/**
 * 複数の外部APIから並列でログを収集します。
 * 一部のAPIリクエストが失敗しても、成功したリクエストの結果は返却します。
 *
 * @param {LogSource[]} sources - 収集対象のソース情報配列
 * @returns {Object[]} 収集・パースされたログデータの配列
 */
function collectPeriodLogsParallel(sources) {
  if (!sources || sources.length === 0) {
    return [];
  }

  const requests = sources.map(s => s.request);
  // ★★★ 改善提案 ★★★ 500エラー等でプロセスが停止しないようにする
  requests.forEach(req => req.muteHttpExceptions = true);

  const responses = UrlFetchApp.fetchAll(requests);
  
  const allLogs = [];

  responses.forEach((response, index) => {
    // ★★★ 修正点 ★★★
    // レスポンスコードが200 (OK) の場合のみ処理を続行する
    if (response.getResponseCode() === 200) {
      try {
        const logs = JSON.parse(response.getContentText()); // 各APIに合わせたパース処理を想定
        // Ensure the parsed content is an array to prevent spread syntax errors.
        const logsArray = Array.isArray(logs) ? logs : [logs];
        // ここで必要に応じて `sources[index].type` を元にログを整形する
        allLogs.push(...logsArray);
      } catch (e) {
        console.error(`JSON parse failed for source ${sources[index].type}. Error: ${e.message}. Response: ${response.getContentText().substring(0, 500)}`);
      }
    } else {
      console.warn(`Request failed for source ${sources[index].type}. Status: ${response.getResponseCode()}. Response: ${response.getContentText().substring(0, 500)}`);
    }
  });

  return allLogs;
}

/**
 * プレビューレポートを生成します (ロギング機能の統合例)。
 */
function generatePreviewReport(instruction, dateStr) {
  logUserActivity('generatePreviewReport');
  // (ここに元のレポート生成ロジックが入ります)
  // ...
  return { success: true, report: "プレビューレポートです。", counts: { calendar: 1, slack: 2, gmail: 3, backlog: 4 } };
}

/**
 * 期間集計を実行します (ロギング機能の統合例)。
 */
function runPeriodAggregation(start, end, modelType, projectList) {
  logUserActivity('runPeriodAggregation');
  // (ここに元の期間集計ロジックが入ります)
  // ...
  return { success: true, report: "期間集計レポートです。\n```json\n[{\"label\":\"Project A\",\"hours\":10.5},{\"label\":\"Project B\",\"hours\":8}]\n```" };
}