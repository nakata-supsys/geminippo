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