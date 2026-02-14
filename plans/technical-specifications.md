# 技術仕様書: Salesforce連携 & 部署別プロンプト機能

## 📋 目次

1. [SalesforceService.js 実装仕様](#salesforceservicejs-実装仕様)
2. [Config.js 変更仕様](#configjs-変更仕様)
3. [Services.js 変更仕様](#servicesjs-変更仕様)
4. [AI.js 変更仕様](#aijs-変更仕様)
5. [Index.html & js.html 変更仕様](#indexhtml--jshtml-変更仕様)
6. [ES部向けデフォルトプロンプト](#es部向けデフォルトプロンプト)

---

## SalesforceService.js 実装仕様

### 新規ファイル作成

```javascript
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
```

---

## Config.js 変更仕様

### 追加関数

```javascript
/**
 * 部署別プロンプトを取得します
 * @param {string} department 部署コード（'CS' または 'ES'）
 * @returns {object} プロンプト設定
 */
function getDepartmentPrompts(department) {
  const cache = CacheService.getUserCache();
  const cacheKey = `prompt_settings_${department}_v1`;
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${department}`;
  let sheet = ss.getSheetByName(sheetName);
  
  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const defaults = getDefaultPromptsForDepartment(department);
    sheet.getRange('A1').setValue('【要約モード指示】');
    sheet.getRange('A2').setValue(defaults.summary);
    sheet.getRange('C1').setValue('【詳細モード指示】');
    sheet.getRange('C2').setValue(defaults.detail);
    sheet.getRange('E1').setValue('【工数算出ルール】');
    sheet.getRange('E2').setValue(defaults.manhour);
    sheet.getRange('G1').setValue('【フィードバック視点】');
    sheet.getRange('G2').setValue(defaults.reflection);
    sheet.getRange('I1').setValue('【期間集計モード指示】');
    sheet.getRange('I2').setValue(defaults.aggregation);
    sheet.setColumnWidths(1, 10, 400);
  }
  
  const prompts = {
    summary: sheet.getRange('A2').getValue() || getDefaultPromptsForDepartment(department).summary,
    detail: sheet.getRange('C2').getValue() || getDefaultPromptsForDepartment(department).detail,
    manhour: sheet.getRange('E2').getValue() || getDefaultPromptsForDepartment(department).manhour,
    reflection: sheet.getRange('G2').getValue() || getDefaultPromptsForDepartment(department).reflection,
    aggregation: sheet.getRange('I2').getValue() || getDefaultPromptsForDepartment(department).aggregation
  };
  
  cache.put(cacheKey, JSON.stringify(prompts), 600);
  return prompts;
}

/**
 * 部署別プロンプトを保存します
 * @param {string} department 部署コード
 * @param {object} data プロンプトデータ
 * @returns {object} 保存結果
 */
function saveDepartmentPrompts(department, data) {
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${department}`;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  sheet.getRange('A2').setValue(data.summary);
  sheet.getRange('C2').setValue(data.detail);
  sheet.getRange('E2').setValue(data.manhour);
  sheet.getRange('G2').setValue(data.reflection);
  if (data.aggregation) sheet.getRange('I2').setValue(data.aggregation);
  
  CacheService.getUserCache().remove(`prompt_settings_${department}_v1`);
  
  return { success: true, message: `${department}部のプロンプト設定を更新しました！` };
}

/**
 * 部署別のデフォルトプロンプトを取得します
 * @param {string} department 部署コード
 * @returns {object} デフォルトプロンプト
 */
function getDefaultPromptsForDepartment(department) {
  if (department === 'ES') {
    return getDefaultPromptsES();
  } else {
    return DEFAULT_PROMPTS; // AI.jsのCS部向けデフォルト
  }
}

/**
 * 既存のgetPromptSettings関数を部署対応に変更
 * 後方互換性のため、デフォルトはCS部
 */
function getPromptSettings() {
  return getDepartmentPrompts('CS');
}
```

---

## Services.js 変更仕様

### 変更関数

```javascript
/**
 * generatePreviewReport関数の変更
 * 部署パラメータを追加
 */
function generatePreviewReport(instruction = null, dateStr = null, department = 'CS') {
  logUserActivity('generatePreviewReport');
  
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    return {
      success: false,
      message: "Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。"
    };
  }
  
  const prompts = getDepartmentPrompts(department);
  
  let targetDate = new Date();
  if (dateStr) {
    targetDate = new Date(dateStr);
  }
  
  const logData = collectLogs(props, targetDate, department);
  
  if (!logData.text || logData.text.trim().length < 50) {
    return {
      success: true,
      report: "⚠️ 【ログが見つかりませんでした】\n本日の活動ログが取得できませんでした。",
      counts: logData.counts
    };
  }
  
  const report = generateReportWithGemini(
    logData.text,
    props.REPORT_MODEL_TYPE || 'flash',
    department,
    prompts,
    props.REPORT_MODE,
    targetDate,
    props.REPORT_REFLECTION,
    props.REPORT_MANHOUR,
    props.REPORT_DAY_FORMAT,
    instruction,
    logData.teamSpiritData
  );
  
  return { success: true, report: report, counts: logData.counts };
}

/**
 * collectLogs関数の変更
 * Salesforce連携とTeamSpiritデータの追加
 */
function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 };
  let teamSpiritData = null;
  
  // 除外設定の読み込み
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);
  
  // 既存のログ収集（Calendar, Slack, Gmail, Backlog）
  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if (cal.length > 0) {
      counts.calendar = cal.length;
      allLogs += `=== Calendar ===\n${cal.map(c => c.log).join('\n')}\n\n`;
    }
  } catch (e) {
    console.warn("Calendar error:", e);
  }
  
  try {
    const sl = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    if (sl.length > 0) {
      counts.slack = sl.length;
      allLogs += `=== Slack ===\n${sl.join('\n')}\n\n`;
    }
  } catch (e) {
    console.warn("Slack error:", e);
  }
  
  try {
    const gm = fetchGmailSentMessages(targetDate);
    if (gm.length > 0) {
      counts.gmail = gm.length;
      allLogs += `=== Gmail ===\n${gm.join('\n')}\n\n`;
    }
  } catch (e) {
    console.warn("Gmail error:", e);
  }
  
  try {
    let bl = JSON.parse(props.BACKLOG_CONFIGS || "[]");
    if (bl.length > 0) {
      const blData = fetchMultiBacklogActivities(bl, targetDate);
      if (blData.length > 0) {
        counts.backlog = blData.length;
        allLogs += `=== Backlog ===\n${blData.join('\n')}\n\n`;
      }
    }
  } catch (e) {
    console.warn("Backlog error:", e);
  }
  
  // Salesforce連携（オプション）
  if (props.SF_ACCESS_TOKEN) {
    try {
      const sfLogs = [];
      
      // TeamSpirit打刻情報
      teamSpiritData = fetchTeamSpiritWorkTime(targetDate);
      if (teamSpiritData) {
        if (teamSpiritData.realHours) {
          sfLogs.push(`[勤怠] 実労働時間: ${teamSpiritData.realHours}時間`);
        } else if (teamSpiritData.startTime) {
          sfLogs.push(`[勤怠] 出勤時刻: ${teamSpiritData.startTime}`);
        }
      }
      
      // 商談履歴（ES部のみ）
      if (department === 'ES') {
        const opportunities = fetchOpportunities(targetDate);
        opportunities.forEach(opp => {
          sfLogs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`);
        });
        
        const tasks = fetchOpportunityTasks(targetDate);
        tasks.forEach(task => {
          const oppName = task.opportunityName ? ` - ${task.opportunityName}` : '';
          sfLogs.push(`[活動] ${task.subject} (${task.status})${oppName}`);
        });
      }
      
      if (sfLogs.length > 0) {
        counts.salesforce = sfLogs.length;
        allLogs += `=== Salesforce ===\n${sfLogs.join('\n')}\n\n`;
      }
      
    } catch (e) {
      console.warn("Salesforce error:", e);
    }
  }
  
  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }
  
  return { text: allLogs, counts: counts, teamSpiritData: teamSpiritData };
}
```

---

## AI.js 変更仕様

### 変更関数

```javascript
/**
 * generateReportWithGemini関数の変更
 * 部署パラメータとTeamSpiritデータを追加
 */
function generateReportWithGemini(logText, modelType, department, prompts, reportMode, targetDate, reflection, manhour, dayFormat, instruction, teamSpiritData) {
  const useModelId = (modelType === 'pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${useModelId}:generateContent`;
  
  let p = (reportMode === "詳細モード") ? prompts.detail : prompts.summary;
  
  if (manhour !== "なし") {
    p += "\n\n" + prompts.manhour;
    
    // TeamSpirit連携時の工数制約追加
    if (teamSpiritData) {
      p += calculateManhourConstraint(teamSpiritData, targetDate);
    }
  }
  
  if (reflection !== "なし") p += "\n\n" + prompts.reflection;
  if (instruction) p += `\n\n【重要：修正指示】\n上記の生成ルールに加え、以下の指示に従って書き直してください：\n${instruction}`;
  
  const promptText = p.replaceAll('{{DATE}}', getFormattedDateString(targetDate, dayFormat))
                      .replaceAll('{{LOGS}}', logText);
  
  if (typeof global !== 'undefined' && global.IS_TESTING) return promptText;
  
  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "あなたは優秀なビジネスアシスタントです。ユーザーから提供される業務ログを元に、指定されたフォーマットで日報を作成してください。" }]
    },
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 32768 }
  });
  
  return callVertexAI(apiUrl, payload);
}

/**
 * TeamSpiritデータから工数制約を生成します
 * @param {object} teamSpiritData TeamSpirit打刻情報
 * @param {Date} targetDate 対象日
 * @returns {string} 工数制約プロンプト
 */
function calculateManhourConstraint(teamSpiritData, targetDate) {
  let maxHours = 8.0;
  let constraint = "";
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const isToday = (today.getTime() === target.getTime());
  
  if (teamSpiritData.realHours) {
    // 実労働時間が記録されている場合（過去日）
    maxHours = teamSpiritData.realHours;
    constraint = `\n\n【重要: 工数制約（TeamSpirit連携）】\n` +
                 `本日の実労働時間は ${maxHours} 時間です。\n` +
                 `各タスクの工数合計が、この