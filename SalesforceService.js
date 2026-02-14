// ==========================================
// SalesforceService.js: Salesforce連携
// ==========================================

/**
 * Salesforce Connected Appの設定
 * スクリプトプロパティに以下を設定:
 * - SF_CLIENT_ID: Connected AppのConsumer Key
 * - SF_CLIENT_SECRET: Connected AppのConsumer Secret
 */

/**
 * Salesforce OAuth認証URLを生成します
 * @returns {string} 認証URL
 */
function getSalesforceAuthUrl() {
  const scriptProps = PropertiesService.getScriptProperties();
  const clientId = scriptProps.getProperty('SF_CLIENT_ID');
  const redirectUri = ScriptApp.getService().getUrl();
  
  // CSRF対策のstateトークン生成
  const state = ScriptApp.newStateToken().withTimeout(600).createToken();
  CacheService.getUserCache().put('sf_oauth_state', state, 600);
  
  // Salesforce OAuth URL
  const authUrl = 'https://login.salesforce.com/services/oauth2/authorize' +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=api refresh_token`;
  
  return authUrl;
}

/**
 * Salesforce OAuth コールバック処理
 * @param {object} e イベントパラメータ
 * @returns {HtmlOutput} 結果ページ
 */
function handleSalesforceCallback(e) {
  try {
    // State検証
    const receivedState = e.parameter.sf_state;
    const expectedState = CacheService.getUserCache().get('sf_oauth_state');
    
    if (!receivedState || receivedState !== expectedState) {
      throw new Error('認証セッションが無効です。もう一度お試しください。');
    }
    CacheService.getUserCache().remove('sf_oauth_state');
    
    const code = e.parameter.sf_code;
    if (!code) {
      throw new Error('Salesforceからの認証コードが見つかりませんでした。');
    }
    
    // トークン交換
    const scriptProps = PropertiesService.getScriptProperties();
    const clientId = scriptProps.getProperty('SF_CLIENT_ID');
    const clientSecret = scriptProps.getProperty('SF_CLIENT_SECRET');
    const redirectUri = ScriptApp.getService().getUrl();
    
    const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
    const response = UrlFetchApp.fetch(tokenUrl, {
      method: 'post',
      payload: {
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      },
      muteHttpExceptions: true
    });
    
    const json = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() !== 200 || !json.access_token) {
      throw new Error('Salesforce認証に失敗しました: ' + (json.error_description || '不明なエラー'));
    }
    
    // トークン保存
    const userProps = PropertiesService.getUserProperties();
    userProps.setProperties({
      'SF_INSTANCE_URL': json.instance_url,
      'SF_ACCESS_TOKEN': json.access_token,
      'SF_REFRESH_TOKEN': json.refresh_token,
      'SF_USER_ID': json.id.split('/').pop(),
      'SF_TOKEN_EXPIRES_AT': new Date(Date.now() + 7200000).toISOString() // 2時間後
    });
    
    return renderResultPage(
      "🎉 Salesforce連携完了",
      "Salesforceとの連携が完了しました。",
      ScriptApp.getService().getUrl(),
      "🎉"
    );
    
  } catch (err) {
    console.error('Salesforce auth error:', err);
    return renderResultPage(
      "❌ Salesforce認証エラー",
      err.message,
      ScriptApp.getService().getUrl(),
      "❌"
    );
  }
}

/**
 * アクセストークンをリフレッシュします
 * @returns {boolean} 成功したかどうか
 */
function refreshSalesforceToken() {
  try {
    const userProps = PropertiesService.getUserProperties();
    const refreshToken = userProps.getProperty('SF_REFRESH_TOKEN');
    
    if (!refreshToken) {
      throw new Error('リフレッシュトークンが見つかりません');
    }
    
    const scriptProps = PropertiesService.getScriptProperties();
    const clientId = scriptProps.getProperty('SF_CLIENT_ID');
    const clientSecret = scriptProps.getProperty('SF_CLIENT_SECRET');
    
    const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';
    const response = UrlFetchApp.fetch(tokenUrl, {
      method: 'post',
      payload: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      },
      muteHttpExceptions: true
    });
    
    const json = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() !== 200 || !json.access_token) {
      return false;
    }
    
    userProps.setProperties({
      'SF_ACCESS_TOKEN': json.access_token,
      'SF_TOKEN_EXPIRES_AT': new Date(Date.now() + 7200000).toISOString()
    });
    
    return true;
    
  } catch (e) {
    console.error('Token refresh failed:', e);
    return false;
  }
}

/**
 * Salesforce REST APIを呼び出します
 * @param {string} endpoint APIエンドポイント（/services/data/v59.0/以降）
 * @returns {object} APIレスポンス
 */
function callSalesforceAPI(endpoint) {
  const userProps = PropertiesService.getUserProperties();
  let accessToken = userProps.getProperty('SF_ACCESS_TOKEN');
  const instanceUrl = userProps.getProperty('SF_INSTANCE_URL');
  const expiresAt = userProps.getProperty('SF_TOKEN_EXPIRES_AT');
  
  if (!accessToken || !instanceUrl) {
    throw new Error('Salesforce連携が設定されていません');
  }
  
  // トークン期限チェック
  if (expiresAt && new Date(expiresAt) < new Date()) {
    if (!refreshSalesforceToken()) {
      throw new Error('Salesforceトークンの更新に失敗しました。再連携してください。');
    }
    accessToken = userProps.getProperty('SF_ACCESS_TOKEN');
  }
  
  const url = instanceUrl + endpoint;
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  });
  
  const responseCode = response.getResponseCode();
  
  // 401エラー（認証切れ）の場合、リフレッシュして再試行
  if (responseCode === 401) {
    if (refreshSalesforceToken()) {
      accessToken = userProps.getProperty('SF_ACCESS_TOKEN');
      const retryResponse = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      });
      return JSON.parse(retryResponse.getContentText());
    } else {
      throw new Error('Salesforce認証が切れています。再連携してください。');
    }
  }
  
  if (responseCode !== 200) {
    const errorBody = response.getContentText();
    console.error('Salesforce API Error:', errorBody);
    throw new Error(`Salesforce API エラー (${responseCode}): ${errorBody}`);
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * TeamSpiritの打刻情報を取得します
 * @param {Date} targetDate 対象日
 * @returns {object|null} 打刻情報 {startTime, endTime, realHours}
 */
function fetchTeamSpiritWorkTime(targetDate) {
  try {
    const userProps = PropertiesService.getUserProperties();
    const sfUserId = userProps.getProperty('SF_USER_ID');
    
    if (!sfUserId) {
      console.warn('Salesforce User IDが見つかりません');
      return null;
    }
    
    const dateStr = Utilities.formatDate(targetDate, 'JST', 'yyyy-MM-dd');
    
    // TeamSpiritのDailyWorkRecordを取得
    // 注: 実際のオブジェクト名・項目名は環境に応じて調整が必要
    const soql = `SELECT Id,StartTime__c,EndTime__c,RealWorkTime__c ` +
                 `FROM TeamSpirit__DailyWorkRecord__c ` +
                 `WHERE EmpId__r.UserId__c='${sfUserId}' AND Date__c=${dateStr}`;
    
    const endpoint = `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
    const result = callSalesforceAPI(endpoint);
    
    if (!result.records || result.records.length === 0) {
      console.log('TeamSpirit打刻情報が見つかりませんでした:', dateStr);
      return null;
    }
    
    const record = result.records[0];
    const startTime = record.StartTime__c;
    const endTime = record.EndTime__c;
    const realWorkMinutes = record.RealWorkTime__c;
    
    return {
      startTime: startTime,
      endTime: endTime,
      realHours: realWorkMinutes ? realWorkMinutes / 60 : null
    };
    
  } catch (e) {
    console.error('TeamSpirit取得エラー:', e);
    return null;
  }
}

/**
 * 商談履歴を取得します（ES部向け）
 * @param {Date} targetDate 対象日
 * @returns {Array} 商談情報の配列
 */
function fetchOpportunities(targetDate) {
  try {
    const userProps = PropertiesService.getUserProperties();
    const sfUserId = userProps.getProperty('SF_USER_ID');
    
    if (!sfUserId) {
      return [];
    }
    
    const dateStr = Utilities.formatDate(targetDate, 'JST', 'yyyy-MM-dd');
    
    // 当日更新された商談を取得
    const soql = `SELECT Id,Name,Account.Name,StageName,Amount,LastModifiedDate ` +
                 `FROM Opportunity ` +
                 `WHERE OwnerId='${sfUserId}' ` +
                 `AND DAY_ONLY(LastModifiedDate)=${dateStr}`;
    
    const endpoint = `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
    const result = callSalesforceAPI(endpoint);
    
    if (!result.records || result.records.length === 0) {
      return [];
    }
    
    return result.records.map(opp => ({
      id: opp.Id,
      name: opp.Name,
      accountName: opp.Account ? opp.Account.Name : '不明',
      stage: opp.StageName,
      amount: opp.Amount,
      lastModified: opp.LastModifiedDate
    }));
    
  } catch (e) {
    console.error('商談取得エラー:', e);
    return [];
  }
}

/**
 * 商談に関連する活動履歴（Task）を取得します
 * @param {Date} targetDate 対象日
 * @returns {Array} タスク情報の配列
 */
function fetchOpportunityTasks(targetDate) {
  try {
    const userProps = PropertiesService.getUserProperties();
    const sfUserId = userProps.getProperty('SF_USER_ID');
    
    if (!sfUserId) {
      return [];
    }
    
    const dateStr = Utilities.formatDate(targetDate, 'JST', 'yyyy-MM-dd');
    
    // 当日の活動を取得
    const soql = `SELECT Id,Subject,Status,ActivityDate,What.Name ` +
                 `FROM Task ` +
                 `WHERE OwnerId='${sfUserId}' ` +
                 `AND ActivityDate=${dateStr} ` +
                 `AND What.Type='Opportunity'`;
    
    const endpoint = `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;
    const result = callSalesforceAPI(endpoint);
    
    if (!result.records || result.records.length === 0) {
      return [];
    }
    
    return result.records.map(task => ({
      id: task.Id,
      subject: task.Subject,
      status: task.Status,
      activityDate: task.ActivityDate,
      opportunityName: task.What ? task.What.Name : null
    }));
    
  } catch (e) {
    console.error('活動履歴取得エラー:', e);
    return [];
  }
}

/**
 * Salesforce接続テスト
 * @returns {object} テスト結果
 */
function testSalesforceConnection() {
  try {
    const userProps = PropertiesService.getUserProperties();
    const accessToken = userProps.getProperty('SF_ACCESS_TOKEN');
    
    if (!accessToken) {
      return {
        success: false,
        message: 'Salesforce連携が設定されていません。先に連携を完了してください。'
      };
    }
    
    // ユーザー情報を取得してテスト
    const endpoint = '/services/data/v59.0/sobjects/User/' + userProps.getProperty('SF_USER_ID');
    const result = callSalesforceAPI(endpoint);
    
    return {
      success: true,
      message: `✅ 接続成功！\nユーザー: ${result.Name}\nメール: ${result.Email}`
    };
    
  } catch (e) {
    return {
      success: false,
      message: '接続エラー: ' + e.message
    };
  }
}

/**
 * Salesforce連携を解除します
 */
function disconnectSalesforce() {
  const userProps = PropertiesService.getUserProperties();
  userProps.deleteProperty('SF_INSTANCE_URL');
  userProps.deleteProperty('SF_ACCESS_TOKEN');
  userProps.deleteProperty('SF_REFRESH_TOKEN');
  userProps.deleteProperty('SF_USER_ID');
  userProps.deleteProperty('SF_TOKEN_EXPIRES_AT');
  
  return { success: true, message: 'Salesforce連携を解除しました' };
}
