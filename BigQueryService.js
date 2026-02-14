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
 * BigQuery接続テスト（未実装）
 * TODO: 実際に簡単なクエリを発行して疎通確認するロジックを実装する
 */
function testBigQueryConnection() {
  // ここに実装
  return { success: true, message: 'BigQuery連携は現在開発中です。' };
}