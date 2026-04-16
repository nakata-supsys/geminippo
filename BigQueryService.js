/**
 * =================================================
 * BigQueryService.js: BigQuery経由のSalesforce連携
 * =================================================
 * Salesforce管理者権限がない場合の代替策。
 * GCSにバックアップされたSalesforceデータをBigQuery経由で参照する。
 * データ鮮度の問題から、過去日の日報作成時のみ利用する。
 */

/**
 * BigQuery経由でTeamSpiritの打刻情報を取得します。
 * @param {Date} targetDate 対象日
 * @returns {object|null} 打刻情報 or null
 */
function fetchTeamSpiritFromBigQuery(targetDate) {
  try {
    // 当日の場合はBigQueryを使わない（データ鮮度の問題）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    if (today.getTime() === target.getTime()) {
      console.log('当日のため、BigQueryからの勤怠データ取得をスキップします');
      return null;
    }

    const scriptProps = PropertiesService.getScriptProperties();
    const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
    const datasetId = scriptProps.getProperty('BQ_DATASET_ID');
    const tableId = scriptProps.getProperty('BQ_TEAMSPIRIT_TABLE');

    if (!projectId || !datasetId || !tableId) {
      console.warn('BigQuery連携に必要なプロパティ（GCP_PROJECT_ID, BQ_DATASET_ID, BQ_TEAMSPIRIT_TABLE）が設定されていません。');
      return null;
    }

    // ユーザーごとの従業員IDを取得（UserPropertiesに保存されている想定）
    const employeeId = PropertiesService.getUserProperties().getProperty('EMPLOYEE_ID');
    if (!employeeId) {
      console.warn('BigQuery連携に必要な従業員ID（EMPLOYEE_ID）がユーザープロパティに設定されていません。');
      return null;
    }

    const dateStr = Utilities.formatDate(target, 'Asia/Tokyo', 'yyyy-MM-dd');

    const sql = `
      SELECT 
        StartTime__c,
        EndTime__c,
        RealWorkTime__c
      FROM \`${projectId}.${datasetId}.${tableId}\`
      WHERE Date__c = '${dateStr}'
        AND EmpId__c = '${employeeId}'
      LIMIT 1
    `;

    const request = { query: sql, useLegacySql: false, timeoutMs: 10000 };
    const queryResults = BigQuery.Jobs.query(request, projectId);

    if (!queryResults.rows || queryResults.rows.length === 0) {
      console.log(`BigQueryに勤怠データが見つかりませんでした: ${dateStr}`);
      return null;
    }

    const row = queryResults.rows[0];
    const realWorkMinutes = row.f[2].v;

    return {
      startTime: row.f[0].v,
      endTime: row.f[1].v,
      realHours: realWorkMinutes ? parseFloat(realWorkMinutes) / 60 : null,
      source: 'BigQuery' // 取得元を明記
    };

  } catch (e) {
    console.error('BigQueryからの勤怠データ取得エラー:', e);
    return null;
  }
}

/**
 * BigQuery経由で商談履歴を取得します（ES部向け）。
 * @param {Date} targetDate 対象日
 * @returns {Array} 商談情報の配列
 */
function fetchOpportunitiesFromBigQuery(targetDate) {
  try {
    // 当日の場合はBigQueryを使わない
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);

    if (today.getTime() === target.getTime()) {
      console.log('当日のため、BigQueryからの商談データ取得をスキップします');
      return [];
    }

    const scriptProps = PropertiesService.getScriptProperties();
    const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
    const datasetId = scriptProps.getProperty('BQ_DATASET_ID');
    const oppTableId = scriptProps.getProperty('BQ_OPPORTUNITY_TABLE');

    if (!projectId || !datasetId || !oppTableId) {
      console.warn('BigQuery連携に必要なプロパティ（GCP_PROJECT_ID, BQ_DATASET_ID, BQ_OPPORTUNITY_TABLE）が設定されていません。');
      return [];
    }

    // ユーザーごとのSalesforceユーザーIDを取得（UserPropertiesに保存されている想定）
    const salesforceUserId = PropertiesService.getUserProperties().getProperty('SALESFORCE_USER_ID');
    if (!salesforceUserId) {
      console.warn('BigQuery連携に必要なSalesforceユーザーID（SALESFORCE_USER_ID）がユーザープロパティに設定されていません。');
      return [];
    }

    const dateStr = Utilities.formatDate(target, 'Asia/Tokyo', 'yyyy-MM-dd');

    const sql = `
      SELECT 
        Id,
        Name,
        Account_Name,
        StageName,
        Amount,
        LastModifiedDate
      FROM \`${projectId}.${datasetId}.${oppTableId}\`
      WHERE OwnerId = '${salesforceUserId}'
        AND DATE(LastModifiedDate) = '${dateStr}'
      ORDER BY LastModifiedDate DESC
    `;

    const request = { query: sql, useLegacySql: false, timeoutMs: 10000 };
    const queryResults = BigQuery.Jobs.query(request, projectId);

    if (!queryResults.rows || queryResults.rows.length === 0) {
      console.log(`BigQueryに商談データが見つかりませんでした: ${dateStr}`);
      return [];
    }

    return queryResults.rows.map(row => ({
      id: row.f[0].v,
      name: row.f[1].v,
      accountName: row.f[2].v || '不明',
      stage: row.f[3].v,
      amount: row.f[4].v,
      lastModified: row.f[5].v,
      source: 'BigQuery' // 取得元を明記
    }));

  } catch (e) {
    console.error('BigQueryからの商談データ取得エラー:', e);
    return [];
  }
}

/**
 * BigQuery接続テスト（簡易）
 * 実行権限とプロジェクト設定を確認するため、軽量クエリを発行します。
 */
function testBigQueryConnection() {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
    if (!projectId) {
      return { success: false, message: 'GCP_PROJECT_ID が未設定です。スクリプトプロパティを確認してください。' };
    }

    const req = {
      query: 'SELECT 1 AS ok',
      useLegacySql: false,
      timeoutMs: 10000
    };
    const res = BigQuery.Jobs.query(req, projectId);
    const ok = !!(res && res.rows && res.rows[0] && res.rows[0].f && res.rows[0].f[0] && String(res.rows[0].f[0].v) === '1');
    if (!ok) {
      return { success: false, message: 'BigQueryから期待した応答を取得できませんでした。権限またはAPI設定を確認してください。' };
    }
    return { success: true, message: `✅ 接続OK！ BigQueryプロジェクト(${projectId})にアクセスできました。` };
  } catch (e) {
    return { success: false, message: `BigQuery接続テストに失敗しました: ${e.message}` };
  }
}

/**
 * 日報保存先として利用する BigQuery テーブルの情報を取得します。
 * 必須:
 * - GCP_PROJECT_ID
 * - BQ_DATASET_ID
 * 任意:
 * - BQ_DAILY_REPORT_TABLE (未指定時は daily_reports)
 */
function getDailyReportTableConfig_() {
  const scriptProps = PropertiesService.getScriptProperties();
  const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
  const datasetId = scriptProps.getProperty('BQ_DATASET_ID');
  const tableId = scriptProps.getProperty('BQ_DAILY_REPORT_TABLE') || 'daily_reports';
  if (!projectId || !datasetId) {
    throw new Error('BigQuery保存に必要な設定が不足しています（GCP_PROJECT_ID / BQ_DATASET_ID）。');
  }
  return { projectId, datasetId, tableId };
}

function ensureDatasetExists_(projectId, datasetId) {
  try {
    BigQuery.Datasets.get(projectId, datasetId);
  } catch (e) {
    const msg = (e && e.message) || '';
    if (msg.indexOf('Not found') === -1 && msg.indexOf('404') === -1) throw e;
    BigQuery.Datasets.insert({
      datasetReference: { projectId: projectId, datasetId: datasetId },
      location: 'asia-northeast1'
    }, projectId);
  }
}

function ensureDailyReportTableExists_() {
  const conf = getDailyReportTableConfig_();
  ensureDatasetExists_(conf.projectId, conf.datasetId);
  try {
    BigQuery.Tables.get(conf.projectId, conf.datasetId, conf.tableId);
    return conf;
  } catch (e) {
    const msg = (e && e.message) || '';
    if (msg.indexOf('Not found') === -1 && msg.indexOf('404') === -1) throw e;
  }

  const table = {
    tableReference: {
      projectId: conf.projectId,
      datasetId: conf.datasetId,
      tableId: conf.tableId
    },
    schema: {
      fields: [
        { name: 'record_id', type: 'STRING', mode: 'REQUIRED' },
        { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
        { name: 'target_date', type: 'DATE', mode: 'REQUIRED' },
        { name: 'user_email', type: 'STRING' },
        { name: 'department', type: 'STRING' },
        { name: 'destination', type: 'STRING' },
        { name: 'model_id', type: 'STRING' },
        { name: 'report_mode', type: 'STRING' },
        { name: 'bullet_style', type: 'STRING' },
        { name: 'slack_style', type: 'STRING' },
        { name: 'report_text', type: 'STRING' },
        { name: 'report_length', type: 'INTEGER' }
      ]
    },
    timePartitioning: {
      type: 'DAY',
      field: 'target_date'
    },
    clustering: {
      fields: ['department', 'user_email']
    }
  };

  BigQuery.Tables.insert(table, conf.projectId, conf.datasetId);
  return conf;
}

/**
 * 送信済み日報を BigQuery に保存します。
 * @param {string} reportText 日報本文
 * @param {Date} targetDate 対象日
 * @param {object} meta 追加メタデータ
 * @returns {string} BigQueryコンソールURL
 */
function saveDailyReportToBigQuery(reportText, targetDate, meta) {
  const conf = ensureDailyReportTableExists_();
  const now = new Date();
  const recordId = Utilities.getUuid();
  const safeMeta = meta || {};
  const userEmail = safeMeta.userEmail || (Session.getActiveUser && Session.getActiveUser().getEmail ? Session.getActiveUser().getEmail() : '');

  const row = {
    record_id: recordId,
    created_at: now.toISOString(),
    target_date: Utilities.formatDate(targetDate, 'Asia/Tokyo', 'yyyy-MM-dd'),
    user_email: userEmail || '',
    department: safeMeta.department || '',
    destination: safeMeta.destination || '',
    model_id: safeMeta.modelId || '',
    report_mode: safeMeta.reportMode || '',
    bullet_style: safeMeta.bulletStyle || '',
    slack_style: safeMeta.slackStyle || '',
    report_text: reportText || '',
    report_length: (reportText || '').length
  };

  const request = {
    rows: [{ insertId: recordId, json: row }],
    ignoreUnknownValues: false,
    skipInvalidRows: false
  };
  const response = BigQuery.Tabledata.insertAll(request, conf.projectId, conf.datasetId, conf.tableId);
  if (response && response.insertErrors && response.insertErrors.length > 0) {
    const firstErr = response.insertErrors[0] && response.insertErrors[0].errors && response.insertErrors[0].errors[0];
    const reason = firstErr ? `${firstErr.reason || 'unknown'}: ${firstErr.message || ''}` : JSON.stringify(response.insertErrors[0]);
    throw new Error(`BigQuery保存エラー: ${reason}`);
  }

  return getDailyReportHistoryConsoleUrl();
}

function getDailyReportHistoryConsoleUrl() {
  try {
    const conf = getDailyReportTableConfig_();
    return `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(conf.projectId)}&ws=!1m5!1m4!4m3!1s${encodeURIComponent(conf.projectId)}!2s${encodeURIComponent(conf.datasetId)}!3s${encodeURIComponent(conf.tableId)}`;
  } catch (e) {
    return null;
  }
}

function upsertView_(projectId, datasetId, viewId, query) {
  const resource = {
    tableReference: {
      projectId: projectId,
      datasetId: datasetId,
      tableId: viewId
    },
    view: {
      query: query,
      useLegacySql: false
    }
  };

  try {
    BigQuery.Tables.get(projectId, datasetId, viewId);
    BigQuery.Tables.update(resource, projectId, datasetId, viewId);
  } catch (e) {
    const msg = (e && e.message) || '';
    if (msg.indexOf('Not found') !== -1 || msg.indexOf('404') !== -1) {
      BigQuery.Tables.insert(resource, projectId, datasetId);
      return;
    }
    throw e;
  }
}

/**
 * 月次分析用のビューを作成/更新します。
 * - v_monthly_department_summary
 * - v_monthly_user_summary
 * - v_monthly_model_summary
 * @returns {object} 生成したビューのURL情報
 */
function setupDailyReportAnalyticsViews() {
  const conf = ensureDailyReportTableExists_();
  const base = `\`${conf.projectId}.${conf.datasetId}.${conf.tableId}\``;

  const qDepartment = `
SELECT
  FORMAT_DATE('%Y-%m', target_date) AS ym,
  department,
  COUNT(*) AS report_count,
  COUNT(DISTINCT user_email) AS active_users,
  ROUND(AVG(report_length), 1) AS avg_report_length
FROM ${base}
GROUP BY ym, department
ORDER BY ym DESC, department
`;

  const qUser = `
SELECT
  FORMAT_DATE('%Y-%m', target_date) AS ym,
  department,
  user_email,
  COUNT(*) AS report_count,
  ROUND(AVG(report_length), 1) AS avg_report_length
FROM ${base}
GROUP BY ym, department, user_email
ORDER BY ym DESC, department, user_email
`;

  const qModel = `
SELECT
  FORMAT_DATE('%Y-%m', target_date) AS ym,
  department,
  model_id,
  COUNT(*) AS report_count,
  ROUND(AVG(report_length), 1) AS avg_report_length
FROM ${base}
GROUP BY ym, department, model_id
ORDER BY ym DESC, department, model_id
`;

  upsertView_(conf.projectId, conf.datasetId, 'v_monthly_department_summary', qDepartment);
  upsertView_(conf.projectId, conf.datasetId, 'v_monthly_user_summary', qUser);
  upsertView_(conf.projectId, conf.datasetId, 'v_monthly_model_summary', qModel);

  const mkUrl = function(viewId) {
    return `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(conf.projectId)}&ws=!1m5!1m4!4m3!1s${encodeURIComponent(conf.projectId)}!2s${encodeURIComponent(conf.datasetId)}!3s${encodeURIComponent(viewId)}`;
  };

  return {
    success: true,
    projectId: conf.projectId,
    datasetId: conf.datasetId,
    views: {
      monthlyDepartment: { id: 'v_monthly_department_summary', url: mkUrl('v_monthly_department_summary') },
      monthlyUser: { id: 'v_monthly_user_summary', url: mkUrl('v_monthly_user_summary') },
      monthlyModel: { id: 'v_monthly_model_summary', url: mkUrl('v_monthly_model_summary') }
    },
    dashboardHintUrl: 'https://lookerstudio.google.com/navigation/reporting'
  };
}
