// ==========================================
// Services.gs: 外部サービス連携 (Slack, Calendar, etc.)
// ==========================================

/**
 * ★★★ 利用状況ログ機能 ★★★
 * ユーザーの利用状況を記録するためのスプレッドシートID。
 * 記録用の新しいスプレッドシートを作成し、そのIDをここに貼り付けてください。
 * 例: '12345abcde-FGHIJKLMNOPQRSTUVWXYZ'
 */
const LOG_SHEET_ID = '1BZIPxlW1ZYYQU66z3yCIZeT9kwJb8sFs8BoMHVYkDUk';

/**
 * エラーコード付きのErrorオブジェクトを生成します。
 * @param {string} code エラーコード (例: 'AUTH-001')
 * @param {string} message エラーメッセージ
 * @returns {Error} authErrorCodeプロパティを持つErrorオブジェクト
 */
function createAuthError(code, message) {
  const error = new Error(message);
  error.authErrorCode = code;
  return error;
}

/**
 * 認証イベントをスプレッドシートに記録します（管理者向け診断ログ）。
 * LOG_SHEET_IDが未設定の場合は何もしません。
 * @param {string} errorCode エラーコード (例: 'AUTH-001', 'AUTH-OK')
 * @param {string} message メッセージ
 * @param {string} userEmail ユーザーのメールアドレス
 * @param {object} params リクエストパラメータ
 */
function logAuthEvent(errorCode, message, userEmail, params) {
  try {
    if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') return;

    const spreadsheet = SpreadsheetApp.openById(LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName('AuthLog');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('AuthLog');
      sheet.appendRow(['Timestamp', 'UserEmail', 'ErrorCode', 'Message', 'HasCode', 'HasState', 'SlackError']);
      sheet.setFrozenRows(1);
    }

    const safeParams = params ? {
      hasCode: !!params.code,
      hasState: !!params.state,
      slackError: params.error || ''
    } : {};

    sheet.appendRow([
      new Date(),
      userEmail || 'unknown',
      errorCode,
      message,
      safeParams.hasCode || false,
      safeParams.hasState || false,
      safeParams.slackError || ''
    ]);
  } catch (logErr) {
    console.error('Failed to log auth event: ' + logErr.message);
  }
}

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

function runDailyReportAndArchive() {
  // 部署選択を考慮
  const userProps = PropertiesService.getUserProperties();
  const department = userProps.getProperty('SELECTED_DEPARTMENT') || 'CS';
  const res = generatePreviewReport(null, null, department); 
  if(res.success) sendFinalReport(res.report, null);
}

/**
 * 手動実行時に選択された部署をユーザープロパティに保存します。
 * @param {string} department 保存する部署コード ('CS' or 'ES')
 */
function saveSelectedDepartment(department) {
  if (department === 'CS' || department === 'ES') {
    PropertiesService.getUserProperties().setProperty('SELECTED_DEPARTMENT', department);
  }
}
/**
 * 日報のプレビューを生成します。
 * @param {string} instruction AIへの追加指示 (任意)
 * @param {string} dateStr 対象日の文字列 (YYYY-MM-DD形式、任意)
 * @param {string} department 部署コード (CS または ES)
 * @returns {object} 生成された日報テキストとログ情報
 */
function generatePreviewReport(instruction = null, dateStr = null, department = 'CS') {
  logUserActivity('generatePreviewReport'); // ログ記録処理を呼び出す

  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) return { success: false, message: "Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。" };

  // 部署別プロンプトを取得
  const prompts = getDepartmentPrompts(department);
  
  let targetDate = new Date(); 
  if (dateStr) { targetDate = new Date(dateStr); } 

  // 部署をcollectLogsに渡す
  const logData = collectLogs(props, targetDate, department);
  
  try { saveRawLogsToSheet(logData.sources, targetDate); } catch(e) { console.warn("生ログ保存エラー:", e); }
  
  if (!logData.text || logData.text.trim().length < 50) { 
      return { 
          success: true, 
          report: "⚠️ 【ログが見つかりませんでした】\n本日の活動ログ（カレンダー、Slack、Gmail等）が取得できませんでした。\n\n・日付が正しいか確認してください\n・休日の場合は活動がない可能性があります", 
          counts: logData.counts 
      };
  }

  // generateReportWithGeminiに部署とTeamSpiritデータを渡す
  const report = generateReportWithGemini(
    logData.text,
    props.REPORT_MODEL_TYPE || 'flash',
    department, // 新規追加
    prompts,
    props.REPORT_MODE,
    targetDate,
    props.REPORT_REFLECTION,
    props.REPORT_MANHOUR,
    props.REPORT_DAY_FORMAT,
    props.REPORT_BULLET_STYLE || 'plain',
    instruction,
    logData.teamSpiritData // 新規追加
  );
  const bulletStyle = props.REPORT_BULLET_STYLE || 'plain';
  const shouldFormat = !(typeof global !== 'undefined' && global.IS_TESTING);
  const formattedReport = shouldFormat ? formatReportByBulletStyle(report, bulletStyle) : report;
  return { success: true, report: formattedReport, counts: logData.counts };
}

function runPeriodAggregation(startDateStr, endDateStr, modelType, projectListStr, avgWorkHours, instruction) {
  logUserActivity('runPeriodAggregation');

  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携がされていません");

  if (projectListStr) PropertiesService.getUserProperties().setProperty('PROJECT_LIST', projectListStr);
  // ★改善案: 平均稼働時間もユーザープロパティに保存する
  if (avgWorkHours) PropertiesService.getUserProperties().setProperty('AVG_WORK_HOURS', avgWorkHours);


  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  // ★★★ 修正: 安定性向上のため、終了日が「本日」以降の場合は自動的に「昨日」に補正する ★★★
  // 未完了のログをAIに渡すと、結果が不安定になる問題への対策
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end >= today) {
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    end.setTime(yesterday.getTime());
  }

  end.setHours(23, 59, 59, 999); // 終了日の終わりまでを対象とする
  if (start > end) throw new Error("終了日は開始日より後に設定してください");

  // 期間ログ収集に部署情報は現時点では不要だが、将来的な拡張のため引数に追加
  const department = props.SELECTED_DEPARTMENT || 'CS';
  const logText = collectPeriodLogsParallel(start, end, props.SLACK_USER_TOKEN, props, department);
  if (!logText || logText.trim().length < 50) {
    // ログが見つからない場合、AIに渡さずに専用メッセージを返す
    const message = `
### ⚠️ ログが見つかりませんでした

指定された期間の活動ログ（カレンダー、Slackなど）が見つかりませんでした。
- 期間の指定が正しいか確認してください。
- ログとして記録されないオフライン作業が中心だった可能性があります。`;
    return { success: true, report: message };
  }

  // ★★★ 修正: 日付ごとに表を作成するよう、プロンプトを動的に上書き ★★★
  const newAggregationPrompt = `
あなたはプロのコンサルタントです。以下のルールに従って、活動ログからプロジェクト工数を算出し、Markdown形式で報告してください。

### 【重要】出力形式の厳守事項
1. 各日付の見出しの直後に、**必ず空行を1行**入れてください
2. テーブルは**必ず3列（種別、工数(時間)、内容）のみ**としてください
3. 「日付」列は絶対に含めないでください
4. 見出し形式: \`▼ yyyy/MM/dd(E) | 合計 XX.X 時間\`
5. テーブルのヘッダー行: \`| 種別 | 工数(時間) | 内容 |\`
6. 区切り行: \`|---|---|---|\`

### ルール
- 各ログエントリの時間を積み上げて工数を計算してください。
- 提供された「1日の平均稼働時間」がある場合、合計工数がその値に近づくように調整してください。ただし、ログの内容とかけ離れた不自然な調整はしないでください。
- JSON形式の出力は絶対に含めないでください。

### 悪い例（絶対にこうしないこと）
| 日付 | 種別 | 工数 | 内容 |
|---|---|---|---|
| 02/12 | プロジェクトA | 4.0時間 | 作業内容 |

### 良い例（必ずこの形式で出力すること）
▼ ${Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy/MM/dd(E)')} | 合計 8.0 時間

| 種別 | 工数(時間) | 内容 |
|---|---|---|
| PROJ-001: A社様導入支援 | 4.5 | 定例MTG、課題管理表の更新 |

【集計期間】 {{DATE}}

### 活動ログ
{{LOGS}}`;
  const report = generateAggregationWithGemini(logText, modelType, start, end, projectListStr, avgWorkHours || null, instruction || null, newAggregationPrompt);

  // AIの出力内容を検証し、異常な場合はフォールバックメッセージを返す
  if (isAggregationResultInvalid(report)) {
    const errorMessage = `
### ⚠️ 集計結果の生成に失敗しました

AIが活動ログから意味のある情報を抽出できませんでした。
- 期間中の活動がログに残らない作業（資料作成など）が中心だった可能性があります。
- 「TeamSpirit プロジェクト一覧」に情報を追加すると、精度が向上することがあります。
- 期間を短くして再度お試しください。`;
    return { success: true, report: errorMessage };
  }

  return { success: true, report: report };
}

/**
 * 工数集計のAI応答が異常かどうかを判定します。
 * @param {string} reportText AIが生成したテキスト
 * @returns {boolean} 異常であればtrue
 */
function isAggregationResultInvalid(reportText) {
  if (!reportText || reportText.length < 30) return true;
  const contentChars = reportText.replace(/[-|#*`\s\n\r]/g, '');
  if (contentChars.length < 20) return true;

  // 水平線やパイプ記号が異常に多い場合も不正とみなす
  const markdownSymbols = (reportText.match(/[-|]/g) || []).length;
  if (contentChars.length > 0 && markdownSymbols / contentChars.length > 10) return true;

  return false;
}

function sendFinalReport(editedReport, dateStr = null) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携切れ");

  // AI.jsで直接呼び出せないため、ここでプロンプト設定を取得する
  const prompts = getPromptSettings(); // 選択された部署のプロンプトが返る
  
  let targetDate = new Date();
  if (dateStr) { targetDate = new Date(dateStr); }
  else if (props.REPORT_DATE) { targetDate = new Date(props.REPORT_DATE); }
  
  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) throw new Error("送信先(チャンネルIDまたはメンバーID)が見つかりません。設定を保存し直してください。");

  sendToSlack(editedReport, props.SLACK_USER_TOKEN, dest, props.REPORT_SLACK_STYLE, targetDate, props.REPORT_FIXED_THREAD_URL, props.REPORT_DAY_FORMAT);
  
  const historyUrl = saveToPrivateHistory(editedReport, targetDate);
  return { success: true, message: "Slack送信完了！", historyUrl: historyUrl };
}

/**
 * 指定された日の活動ログを収集します。
 * @param {object} props ユーザープロパティ
 * @param {Date} targetDate 対象日
 * @param {string} department 部署コード (CS または ES)
 * @returns {object} 収集されたログテキストとカウント、TeamSpiritデータ
 */
function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 }; // salesforceを追加
  let teamSpiritData = null; // TeamSpiritデータ格納用
  let sources = { calendar: '', slack: '', gmail: '', backlog: '', salesforce: '',
                  calendarRows: [], slackRows: [], gmailRows: [], backlogRows: [], salesforceRows: [] };

  // 除外設定の読み込み
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);

  // 既存のログ収集（Calendar, Slack, Gmail, Backlog）
  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if(cal.length > 0) {
        counts.calendar = cal.length;
        const calText = cal.map(c => c.log).join('\n');
        sources.calendar = calText;
        sources.calendarRows = cal;
        allLogs += `=== Calendar ===\n${calText}\n\n`;
    }
  } catch(e){ console.warn("Calendar error:", e); }
  
  try {
    const slackRaw = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    const slackMessages = (slackRaw || []).map(msg => {
      if (typeof msg === 'string') {
        return { displayText: msg, text: msg };
      }
      if (!msg.displayText) {
        const channelLabel = msg.channelName ? `[#${msg.channelName}] ` : '';
        msg.displayText = `${channelLabel}${msg.text || ''}`;
      }
      return msg;
    });

    if (slackMessages.length > 0) {
      counts.slack = slackMessages.length;
      const slackDisplay = slackMessages.map(msg => msg.displayText || '').join('\n');
      const formattedSlack = formatSlackLogsForSheet(slackMessages);
      sources.slack = formattedSlack || slackDisplay;
      sources.slackRows = slackMessages;
      allLogs += `=== Slack ===\n${slackDisplay}\n\n`;
    }
  } catch(e){ console.warn("Slack error:", e); }
  
  try {
    const gmData = fetchGmailSentMessages(targetDate);
    if(gmData.length > 0) {
        counts.gmail = gmData.length;
        const gmText = gmData.map(g => g.displayText).join('\n');
        sources.gmail = gmText;
        sources.gmailRows = gmData;
        allLogs += `=== Gmail ===\n${gmText}\n\n`;
    }
  } catch(e){
    if (e.message && e.message.includes("Gmailへのアクセス権限がありません")) {
        throw new Error("Gmailへのアクセス権限がありません。Googleアカウントの権限設定を確認してください。");
    }
    console.warn("Gmail error:", e);
  }
  
  try {
    let bl = JSON.parse(props.BACKLOG_CONFIGS || "[]");
    if(bl.length > 0) {
      const blData = fetchMultiBacklogActivities(bl, targetDate);
      if(blData.length > 0) {
          counts.backlog = blData.length;
          const blText = blData.map(b => b.displayText).join('\n');
          sources.backlog = blText;
          sources.backlogRows = blData;
          allLogs += `=== Backlog ===\n${blText}\n\n`;
      }
    }
  } catch(e){ console.warn("Backlog error:", e); }
  
  // Salesforce連携（オプション）
  let sfLogs = [];
  let sfRows = [];
  if (props.SF_ACCESS_TOKEN) {
    try {
      // TeamSpirit打刻情報
      teamSpiritData = fetchTeamSpiritWorkTime(targetDate);
      if (teamSpiritData) {
        if (teamSpiritData.realHours) {
          sfLogs.push(`[勤怠] 実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`);
          sfRows.push({ date: targetDate, place: '', subject: '勤怠', content: `実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`, url: '' });
        } else if (teamSpiritData.startTime) {
          sfLogs.push(`[勤怠] 出勤時刻: ${Utilities.formatDate(new Date(teamSpiritData.startTime), 'JST', 'HH:mm')}`);
          sfRows.push({ date: targetDate, place: '', subject: '勤怠', content: `出勤時刻: ${Utilities.formatDate(new Date(teamSpiritData.startTime), 'JST', 'HH:mm')}`, url: '' });
        }
      }

      // 商談履歴（ES部のみ）
      if (department === 'ES') {
        const opportunities = fetchOpportunities(targetDate);
        opportunities.forEach(opp => {
          sfLogs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`);
          sfRows.push({
            date: opp.lastModified ? new Date(opp.lastModified) : targetDate,
            place: opp.accountName || '',
            subject: opp.name || '',
            content: `${opp.stage}${opp.amount ? ' / ' + opp.amount.toLocaleString() + '円' : ''}`,
            url: ''
          });
        });

        const tasks = fetchOpportunityTasks(targetDate);
        tasks.forEach(task => {
          const oppName = task.opportunityName ? ` - ${task.opportunityName}` : '';
          sfLogs.push(`[活動] ${task.subject} (${task.status})${oppName}`);
          sfRows.push({
            date: task.activityDate ? new Date(task.activityDate) : targetDate,
            place: task.opportunityName || '',
            subject: task.subject || '',
            content: task.status || '',
            url: ''
          });
        });
      }
    } catch (e) {
      console.warn("Salesforce error:", e);
    }
  } else {
    // --- BigQuery連携 (代替案) ---
    // 正規のSalesforce連携が設定されていない場合のみ、こちらを試行
    try {
      // TeamSpirit打刻情報（BigQuery経由）
      teamSpiritData = fetchTeamSpiritFromBigQuery(targetDate);
      if (teamSpiritData) {
        if (teamSpiritData.realHours) {
          sfLogs.push(`[勤怠] 実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間 (BQ)`);
          sfRows.push({ date: targetDate, place: '', subject: '勤怠', content: `実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`, url: '' });
        } else if (teamSpiritData.startTime) {
          sfLogs.push(`[勤怠] 出勤時刻: ${teamSpiritData.startTime} (BQ)`);
          sfRows.push({ date: targetDate, place: '', subject: '勤怠', content: `出勤時刻: ${teamSpiritData.startTime}`, url: '' });
        }
      }

      // 商談履歴（ES部のみ、BigQuery経由）
      if (department === 'ES') {
        const opportunities = fetchOpportunitiesFromBigQuery(targetDate);
        opportunities.forEach(opp => {
          sfLogs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage}) (BQ)`);
          sfRows.push({
            date: opp.lastModified ? new Date(opp.lastModified) : targetDate,
            place: opp.accountName || '',
            subject: opp.name || '',
            content: `${opp.stage}${opp.amount ? ' / ' + opp.amount.toLocaleString() + '円' : ''}`,
            url: ''
          });
        });
      }
    } catch (e) {
      console.warn("BigQuery fallback error:", e);
    }
  }

  if (sfLogs.length > 0) {
    counts.salesforce = sfLogs.length;
    const sfText = sfLogs.join('\n');
    sources.salesforce = sfText;
    sources.salesforceRows = sfRows;
    allLogs += `=== Salesforce ===\n${sfText}\n\n`;
  }

  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }
  
  return { text: allLogs, counts: counts, teamSpiritData: teamSpiritData, sources: sources };
}

/**
 * Backlog API から本日までに期限の来ている未完了課題を取得します。
 * @param {Array} configs BACKLOG_CONFIGS
 * @param {Date} today
 * @returns {string[]}
 */
function fetchBacklogTodayIssues(configs, today) {
  const issues = [];
  const todayStr = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  configs.forEach(conf => {
    try {
      const host = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const myself = JSON.parse(UrlFetchApp.fetch(`https://${host}/api/v2/users/myself?apiKey=${conf.key}`).getContentText());
      const userId = myself.id;
      const url = `https://${host}/api/v2/issues?apiKey=${conf.key}` +
                  `&assigneeId[]=${userId}` +
                  `&statusId[]=1&statusId[]=2` +
                  `&dueDateUntil=${todayStr}` +
                  `&count=50`;
      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());
      res.forEach(issue => {
        const due = issue.dueDate ? issue.dueDate.substring(0, 10) : null;
        const dueLabel = due ? ` (期限: ${due})` : ' (期限未設定)';
        const overdueLabel = due && due < todayStr ? ' ⚠️期限切れ' : '';
        issues.push(`[Backlog] ${issue.issueKey}: ${issue.summary}${dueLabel}${overdueLabel}`);
      });
    } catch(e) {
      console.warn('Backlog today issues error:', e);
    }
  });

  return issues;
}

const MAX_TODO_CALENDAR_ITEMS = 30;
const MAX_TODO_BACKLOG_ITEMS = 20;
const MAX_TODO_TEXT_LENGTH = 6000;

/**
 * 今日のTODO向けに各ソースのタスクを集約します。
 * @param {object} props
 * @param {Date} today
 * @returns {object} { text, warnings }
 */
function collectTodaysTasks(props, today) {
  let text = '';
  const warnings = [];
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);

  try {
    const cal = fetchGoogleCalendarEvents(today, calIgnore);
    if (cal.length > 0) {
      const sliced = cal.slice(0, MAX_TODO_CALENDAR_ITEMS);
      if (cal.length > MAX_TODO_CALENDAR_ITEMS) {
        warnings.push(`Googleカレンダーの予定が${cal.length}件あったため、先頭${MAX_TODO_CALENDAR_ITEMS}件のみを使用しました。`);
      }
      text += `=== 本日の予定 ===\n${sliced.map(c => c.log).join('\n')}\n\n`;
    }
  } catch(e) {
    console.warn('collectTodaysTasks Calendar error:', e);
    warnings.push('Googleカレンダーから予定を取得できませんでした。');
  }

  let backlogConfigs = [];
  try {
    backlogConfigs = JSON.parse(props.BACKLOG_CONFIGS || "[]");
  } catch (e) {
    backlogConfigs = [];
  }
  if (backlogConfigs.length > 0) {
    try {
      const issues = fetchBacklogTodayIssues(backlogConfigs, today);
      if (issues.length > 0) {
        const slicedIssues = issues.slice(0, MAX_TODO_BACKLOG_ITEMS);
        if (issues.length > MAX_TODO_BACKLOG_ITEMS) {
          warnings.push(`Backlogの未完了課題が${issues.length}件あったため、先頭${MAX_TODO_BACKLOG_ITEMS}件のみを使用しました。`);
        }
        text += `=== Backlog 未完了課題 ===\n${slicedIssues.join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn('collectTodaysTasks Backlog error:', e);
      warnings.push('Backlog APIから未完了課題を取得できませんでした。');
    }
  } else {
    warnings.push('Backlog連携が設定されていないため、課題は含まれていません。');
  }

  if (!props.SLACK_USER_TOKEN || !props.SLACK_MEMBER_ID) {
    warnings.push('Slack未返信チェックはSlack連携を完了すると利用できます。');
  } else {
    try {
      const slackPending = fetchPendingSlackRequests(
        props.SLACK_USER_TOKEN,
        props.SLACK_MEMBER_ID,
        today
      );
      if (slackPending.length > 0) {
        text += `=== Slack未返信依頼 ===\n${slackPending.join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn('collectTodaysTasks Slack mention error:', e);
      warnings.push('Slack未返信依頼の取得中にエラーが発生しました。');
    }
  }

  if (text.length > MAX_TODO_TEXT_LENGTH) {
    text = text.substring(0, MAX_TODO_TEXT_LENGTH) + "\n\n... (一部のタスクは文字数の都合で省略されました)";
    warnings.push('TODO入力が非常に長かったため、先頭部分のみをAIに渡しました。');
  }

  return { text, warnings };
}

/**
 * Slackで自分宛に届いた未返信依頼を取得します。
 * @param {string} token Slackユーザートークン
 * @param {string} myUserId 自分のSlackユーザーID
 * @param {Date} referenceDate 参照日
 * @param {number} lookbackDays さかのぼる日数
 * @param {number} maxItems 返却件数
 * @returns {string[]}
 */
function fetchPendingSlackRequests(token, myUserId, referenceDate, lookbackDays = 5, maxItems = 6) {
  if (!token || !myUserId) return [];

  const anchorDate = referenceDate ? new Date(referenceDate) : new Date();
  const oldest = new Date(anchorDate.getTime());
  oldest.setDate(oldest.getDate() - lookbackDays);
  oldest.setHours(0, 0, 0, 0);
  const oldestLabel = Utilities.formatDate(oldest, 'JST', 'yyyy-MM-dd');
  const mentionSyntax = `<@${myUserId}>`;
  const query = `${mentionSyntax} after:${oldestLabel}`;
  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${Math.max(maxItems * 2, 20)}&sort=timestamp&sort_dir=desc&highlight=false`;

  try {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    const json = JSON.parse(response.getContentText());
    if (!json.ok) {
      console.warn(`Slack mention search error: ${json.error || response.getResponseCode()}`);
      return [];
    }
    const matches = (json.messages && json.messages.matches) || [];
    const oldestMs = oldest.getTime();
    const pending = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!match || !match.user || match.user === myUserId) continue;
      const messageTs = parseFloat(match.ts);
      if (isNaN(messageTs) || (messageTs * 1000) < oldestMs) continue;

      let handled = false;
      try {
        handled = hasUserAcknowledgedSlackMessage(
          token,
          match.channel && match.channel.id,
          match.ts,
          match.thread_ts,
          myUserId
        );
      } catch (ackErr) {
        console.warn('Slack mention ack check error:', ackErr.message);
      }

      if (!handled) {
        pending.push(formatSlackRequestLine(match));
      }
      if (pending.length >= maxItems) break;
    }
    return pending;
  } catch (e) {
    console.warn('fetchPendingSlackRequests error:', e);
    return [];
  }
}

/**
 * 指定メッセージに対して自分が返信済みかどうかを判定します。
 */
function hasUserAcknowledgedSlackMessage(token, channelId, originalTs, threadTs, myUserId) {
  if (!channelId || !token || !myUserId) return false;
  const parentTs = threadTs || originalTs;

  // 1. スレッド内の返信を確認
  try {
    const replyUrl = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${parentTs}&limit=40`;
    const res = UrlFetchApp.fetch(replyUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    if (json.ok) {
      const replies = json.messages || [];
      for (let i = 0; i < replies.length; i++) {
        const msg = replies[i];
        if (!msg || !msg.user) continue;
        if (msg.user === myUserId && parseFloat(msg.ts) > parseFloat(originalTs)) {
          return true;
        }
      }
      // スレッドが存在する場合はここで判定終了
      if (replies.length > 1) {
        return false;
      }
    } else if (json.error !== 'thread_not_found' && json.error !== 'missing_scope') {
      console.warn(`Slack replies error (${channelId}): ${json.error}`);
    }
  } catch (e) {
    console.warn('conversations.replies error:', e.message);
  }

  // 2. チャンネル履歴から自分の最新投稿を確認
  return hasUserPostedAfter(token, channelId, originalTs, myUserId);
}

/**
 * チャンネル履歴内に自分の投稿が存在するか確認します。
 */
function hasUserPostedAfter(token, channelId, baseTs, myUserId) {
  if (!channelId) return false;
  try {
    const historyUrl = `https://slack.com/api/conversations.history?channel=${channelId}&oldest=${baseTs}&limit=60`;
    const res = UrlFetchApp.fetch(historyUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    if (!json.ok) {
      if (json.error !== 'missing_scope' && json.error !== 'not_in_channel') {
        console.warn(`Slack history error (${channelId}): ${json.error}`);
      }
      return false;
    }
    const messages = json.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || !msg.user) continue;
      if (msg.user === myUserId && parseFloat(msg.ts) > parseFloat(baseTs)) {
        return true;
      }
    }
  } catch (e) {
    console.warn('conversations.history error:', e.message);
  }
  return false;
}

/**
 * Slack未返信依頼の表示用テキストを生成します。
 */
function formatSlackRequestLine(match) {
  const ts = new Date(parseFloat(match.ts) * 1000);
  const channelName = match.channel && match.channel.name
    ? `#${match.channel.name}`
    : (match.channel && match.channel.id ? match.channel.id : 'DM');
  const author = match.username || (match.user ? `<@${match.user}>` : 'someone');
  const cleanText = (match.text || '').replace(/\s+/g, ' ').trim();
  const normalized = decodeSlackMarkup(cleanText);
  const timeLabel = Utilities.formatDate(ts, 'JST', 'MM/dd HH:mm');
  const permalink = match.permalink ? ` ${match.permalink}` : '';
  return `[Slack未返信] ${timeLabel} ${channelName} ${author}: ${normalized.length > 80 ? normalized.substring(0, 77) + '…' : normalized}${permalink}`;
}

/**
 * Slackのリンク/メンション表記を人が読みやすい形に変換します。
 */
function decodeSlackMarkup(text) {
  if (!text) return '';
  return text
    .replace(/<@([A-Z0-9]+)\|([^>]+)>/g, '@$2')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 今日のTODOリストを生成してSlackに送信します。
 */
function sendTodaysTodoNotification() {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    return { success: false, message: 'Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。' };
  }

  const today = new Date();
  const tasksResult = collectTodaysTasks(props, today);
  const taskText = tasksResult.text;
  const warnings = tasksResult.warnings || [];

  if (!taskText || taskText.trim().length < 10) {
    let emptyMessage = '⚠️ 本日のカレンダー予定・Backlog課題が見つかりませんでした。';
    if (warnings.length > 0) {
      emptyMessage += '\n\n⚠️ 取得できなかったデータ\n' + warnings.map(w => `・${w}`).join('\n');
    }
    return { success: true, message: emptyMessage, warnings: warnings };
  }

  const department = props.SELECTED_DEPARTMENT || 'CS';
  const todoMessage = generateTodaysTodoWithGemini(taskText, department, today);

  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) {
    return { success: false, message: '送信先(チャンネルIDまたはメンバーID)が設定されていません。' };
  }

  let finalMessage = todoMessage;
  if (warnings.length > 0) {
    finalMessage += `\n\n⚠️ 取得できなかったデータ\n${warnings.map(w => `・${w}`).join('\n')}`;
  }

  sendToSlack(finalMessage, props.SLACK_USER_TOKEN, dest, 'direct', today, null, props.REPORT_DAY_FORMAT);

  return { success: true, message: finalMessage, warnings: warnings };
}

function autoRunTodaysTodo() {
  try {
    sendTodaysTodoNotification();
  } catch(e) {
    console.warn('autoRunTodaysTodo error:', e);
  }
}

// 期間指定の並列ログ収集
function collectPeriodLogsParallel(start, end, slackToken, props, department = 'CS') { // departmentを追加
  const dateList = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dateList.push(new Date(d));
  }

  // 除外設定
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);
  const ignoreUserNames = resolveSlackUserNames(slackToken, slackIgnore.filter(id => id.startsWith('U') || id.startsWith('W')));

  let requests = [];
  let slackIndices = [];
  // let backlogIndices = []; // 現時点では未使用

  dateList.forEach((d, i) => {
    const ds = Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
    let q = `from:me on:${ds}`;
    if (props.REPORT_SLACK_SCOPE === 'public') q += ` is:public`;

    requests.push({
      url: `https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=50`,
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + slackToken },
      muteHttpExceptions: true
    });
    slackIndices.push({ date: d, reqIndex: requests.length - 1 });
  });

  // --- 改善案: リクエストをチャンクに分割して実行 ---
  let responses = [];
  if (requests.length > 0) {
    const CHUNK_SIZE = 10; // 10件ずつに分割
    for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
      const chunk = requests.slice(i, i + CHUNK_SIZE);
      try {
        const chunkResponses = UrlFetchApp.fetchAll(chunk);
        responses = responses.concat(chunkResponses);
      } catch (e) {
        // チャンクの実行に失敗した場合でも、エラーを投げて処理を中断させる
        console.error(`UrlFetchApp.fetchAll failed for chunk starting at index ${i}: ${e.message}`);
        throw new Error(`ログ収集時の通信エラーが多発しました。期間を短くして再試行してください。\n詳細: ${e.message}`);
      }
      // クォータを避けるために少し待機する
      if (requests.length > CHUNK_SIZE) {
        Utilities.sleep(500); // 0.5秒待機
      }
    }
  }

  let allLogs = "";

  dateList.forEach(d => {
    const dateLabel = Utilities.formatDate(d, 'JST', 'MM/dd(E)');
    let dayLogs = [];

    // Calendar
    try {
      const events = fetchGoogleCalendarEvents(d, calIgnore);
      events.forEach(eventData => { // eventData is {log: string, event: CalendarEvent}
        dayLogs.push(eventData.log.replace('[予定] ', '[Cal] '));
      });
    } catch(e){} // 変数 'e' の衝突を避ける

    // Slack
    const slIdx = slackIndices.find(item => item.date.getTime() === d.getTime());
    if (slIdx) {
      const resp = responses[slIdx.reqIndex];
      if (resp.getResponseCode() === 200) {
        try {
          const json = JSON.parse(resp.getContentText());
          if (json.ok && json.messages && json.messages.matches) {
            json.messages.matches.forEach(m => {
              if (shouldIgnoreSlackChannel(m.channel, slackIgnore, ignoreUserNames)) return;
              dayLogs.push(`[Slack] #${m.channel.name}: ${m.text.replace(/\n/g, ' ').substring(0, 50)}...`);
            });
          }
        } catch(e){
          console.warn(`Slack log parsing failed for date ${d.toISOString()}: ${e.message}`);
        }
      }
    }

    // Backlog
    // バックログはページネーション対応済みのfetchBacklogActivitiesWithPaginationで期間取得
    // ここでは個別日の取得はしない

    // Salesforce連携（期間集計対応）
    if (props.SF_ACCESS_TOKEN) {
      try {
        // TeamSpirit打刻情報
        const teamSpiritData = fetchTeamSpiritWorkTime(d);
        if (teamSpiritData && teamSpiritData.realHours) {
          dayLogs.push(`[勤怠] 実労働時間: ${teamSpiritData.realHours}時間`);
        }
        
        // 商談履歴（ES部のみ）
        if (department === 'ES') {
          const opportunities = fetchOpportunities(d);
          opportunities.forEach(opp => {
            dayLogs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`);
          });
          const tasks = fetchOpportunityTasks(d);
          tasks.forEach(task => {
            const oppName = task.opportunityName ? ` - ${task.opportunityName}` : '';
            dayLogs.push(`[活動] ${task.subject} (${task.status})${oppName}`);
          });
        }
      } catch (e) {
        console.warn(`Salesforce log fetch error for ${d.toISOString()}: ${e.message}`);
      }
    }
    
    if (dayLogs.length > 0) {
      allLogs += `\n=== ${dateLabel} ===\n` + dayLogs.join('\n') + "\n";
    }
  });

  // --- Backlogログ収集 (ページネーション対応) ---
  let blLogs = [];
  let backlogConfigs = [];
  try { backlogConfigs = JSON.parse(props.BACKLOG_CONFIGS || "[]"); } catch(e){}
  if (backlogConfigs.length > 0) {
    blLogs = fetchBacklogActivitiesWithPagination(backlogConfigs, start, end);
  }
  if (blLogs.length > 0) allLogs += `\n=== Backlog Activities ===\n` + blLogs.join('\n');
  
  // ★追加: 最終的な文字列長を制限する
  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }

  return allLogs;
}

/**
 * 複数のBacklog設定に対して、ページネーションを考慮してアクティビティを取得します。
 * @param {Array<Object>} configs Backlog設定の配列
 * @param {Date} startDate 取得開始日
 * @param {Date} endDate 取得終了日
 * @returns {Array<string>} ログ文字列の配列
 */
function fetchBacklogActivitiesWithPagination(configs, startDate, endDate) {
  let allActivityLogs = [];
  const COUNT = 100; // 1リクエストあたりの取得件数

  configs.forEach(config => {
    if (!config.host || !config.key) return;

    const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let maxId = null;
    let keepFetching = true;

    while (keepFetching) {
      try {
        let url = `https://${host}/api/v2/users/myself/activities?apiKey=${config.key}&count=${COUNT}`;
        if (maxId) {
          url += `&maxId=${maxId}`;
        }

        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (response.getResponseCode() !== 200) break;

        const activities = JSON.parse(response.getContentText());
        if (activities.length === 0) {
          keepFetching = false;
          continue;
        }

        activities.forEach(act => {
          const activityDate = new Date(act.created);
          if (activityDate >= startDate && activityDate <= endDate) {
            const dateStr = Utilities.formatDate(activityDate, 'JST', 'MM/dd');
            const summary = act.content.summary || (act.content.comment ? `コメント: ${act.content.comment.content.substring(0, 20)}...` : '更新');
            allActivityLogs.push(`${dateStr} [Backlog] ${act.project.projectKey} ${summary}`);
          }
        });

        maxId = activities[activities.length - 1].id;
        keepFetching = (activities.length === COUNT); // 取得件数が上限に達していれば、まだ続きがある可能性がある
      } catch (e) {
        console.warn(`Backlog pagination fetch failed for host ${host}: ${e.message}`);
        keepFetching = false;
      }
    }
  });
  return allActivityLogs;
}

// ------------------------------------------
// サービス別ヘルパー関数群
// ------------------------------------------

/**
 * Slackの除外判定ロジック
 */
function shouldIgnoreSlackChannel(channelObj, ignoreIds, ignoreUserNames) {
  // 1. チャンネルIDが直接指定されている場合 (C..., D...)
  if (ignoreIds.includes(channelObj.id)) return true;

  // 2. DM(D...) の場合、チャンネル名が除外対象ユーザー名と一致するか確認
  // (Search APIでは、DMの channel.name は相手のユーザー名(または自分)になる)
  if (channelObj.id.startsWith('D')) {
    if (ignoreUserNames.includes(channelObj.name)) return true;
  }

  return false;
}

/**
 * 指定されたユーザーIDリストから名前を取得する (DM判定用)。戻り値の順序は userIds と一致する。
 */
function resolveSlackUserNames(token, userIds) {
  if (!userIds || userIds.length === 0) return [];

  const cache = CacheService.getUserCache();
  const cacheKeys = userIds.map(id => `slack_name_${id}`);
  const cachedNames = cache.getAll(cacheKeys);

  const nameByUid = {};
  const missingIds = [];

  userIds.forEach(uid => {
    const cacheKey = `slack_name_${uid}`;
    if (cachedNames[cacheKey]) {
      nameByUid[uid] = cachedNames[cacheKey];
    } else {
      missingIds.push(uid);
    }
  });

  const newNamesToCache = {};
  missingIds.forEach(uid => {
    try {
      const res = JSON.parse(UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${uid}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      }).getContentText());
      if (res.ok) {
        const name = res.user.name;
        nameByUid[uid] = name;
        newNamesToCache[`slack_name_${uid}`] = name;
      }
    } catch (e) {}
  });

  if (Object.keys(newNamesToCache).length > 0) {
    cache.putAll(newNamesToCache, 21600); // 6時間キャッシュ
  }

  return userIds.map(uid => nameByUid[uid]).filter(Boolean);
}

/**
 * 指定された日の自分のSlack投稿を取得します。
 * @param {string} token Slackユーザートークン
 * @param {Date} date 取得対象日
 * @param {string} scope 'public' または 'private'
 * @param {Array<string>} ignoreIds 除外するチャンネル/ユーザーIDの配列
 * @returns {Array<string>} ログ文字列の配列
 */
const SLACK_THREAD_FETCH_LIMIT = 20;

function fetchMySlackPosts(token, date, scope, ignoreIds = []) {
  const dateString = Utilities.formatDate(date, 'JST', 'yyyy-MM-dd');
  let q = `from:me on:${dateString}`;
  if (scope === 'public') q += ` is:public`;

  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=100`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const res = JSON.parse(response.getContentText());

  if (!res.ok) {
    if (res.error === 'invalid_auth') {
      throw new Error("AUTH_ERROR:Slack連携の再認証が必要です。");
    }
    console.warn(`Slack API error in fetchMySlackPosts: ${res.error}`);
    return [];
  }

  if (!res.messages || !res.messages.matches) return [];
  const ignoreUserNames = resolveSlackUserNames(token, ignoreIds.filter(id => id.startsWith('U') || id.startsWith('W')));

  const normalizedMessages = res.messages.matches
    .filter(m => !shouldIgnoreSlackChannel(m.channel, ignoreIds, ignoreUserNames))
    .map(m => {
      const channelName = m.channel && m.channel.name ? m.channel.name : '';
      const channelId = m.channel && m.channel.id ? m.channel.id : '';
      const threadTs = m.thread_ts || m.ts;
      const channelLabel = channelName ? `[#${channelName}] ` : '';
      return {
        displayText: `${channelLabel}${m.text || ''}`,
        text: m.text || '',
        channelId: channelId,
        channelName: channelName,
        userId: m.user || '',
        ts: m.ts,
        threadTs: threadTs,
        permalink: m.permalink || ''
      };
    });

  if (normalizedMessages.length === 0) return [];

  enrichSlackThreadTopTexts(normalizedMessages, token);
  assignSlackThreadLabels(normalizedMessages);

  return normalizedMessages;
}

function enrichSlackThreadTopTexts(messages, token) {
  const threadMeta = {};
  const pending = [];

  messages.forEach(msg => {
    const key = msg.threadTs || msg.ts;
    msg.threadTs = key;
    if (!threadMeta[key]) {
      if (!msg.threadTs || msg.threadTs === msg.ts) {
        threadMeta[key] = { topText: msg.text };
      } else {
        threadMeta[key] = { channelId: msg.channelId };
        pending.push({ threadTs: key, channelId: msg.channelId });
      }
    }
  });

  if (pending.length > 0) {
    const cache = (typeof CacheService !== 'undefined' && CacheService.getUserCache)
      ? CacheService.getUserCache()
      : null;
    const toFetch = [];

    pending.forEach(req => {
      const cacheKey = `slack_thread_top_${req.channelId}_${req.threadTs}`;
      req.cacheKey = cacheKey;
      const cached = cache && cache.get ? cache.get(cacheKey) : null;
      if (cached) {
        threadMeta[req.threadTs].topText = cached;
      } else if (toFetch.length < SLACK_THREAD_FETCH_LIMIT) {
        toFetch.push(req);
      } else {
        threadMeta[req.threadTs].topText = '(取得上限)';
      }
    });

    toFetch.forEach(req => {
      const topText = fetchSlackThreadRootText(token, req.channelId, req.threadTs);
      threadMeta[req.threadTs].topText = topText || '(取得失敗)';
      if (topText && cache && cache.put) {
        cache.put(req.cacheKey, topText, 3600); // 1時間キャッシュ
      }
    });
  }

  messages.forEach(msg => {
    const meta = threadMeta[msg.threadTs];
    msg.threadTopText = (meta && meta.topText) ? meta.topText : msg.text;
  });
}

function assignSlackThreadLabels(messages) {
  const labelMap = {};
  let counter = 1;
  messages.forEach(msg => {
    const key = msg.threadTs || msg.ts;
    if (!labelMap[key]) {
      labelMap[key] = `T${String(counter).padStart(3, '0')}`;
      counter++;
    }
    msg.threadLabel = labelMap[key];
  });
}

function fetchSlackThreadRootText(token, channelId, threadTs) {
  if (!token || !channelId || !threadTs) return '';
  try {
    const url = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=1&inclusive=true`;
    const res = JSON.parse(UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    }).getContentText());
    if (res.ok && res.messages && res.messages.length > 0) {
      return res.messages[0].text || '';
    }
    return '';
  } catch (e) {
    console.warn(`Slack thread fetch error (${channelId}, ${threadTs}): ${e.message}`);
    return '';
  }
}

function formatSlackLogsForSheet(messages) {
  if (!messages || messages.length === 0) return '';
  const hasStructuredData = messages.some(msg =>
    msg && (msg.ts || msg.channelId || msg.threadLabel || msg.permalink)
  );
  if (!hasStructuredData) return '';
  const headerMarker = '__FORMAT=TSV v1';
  const columnHeader = [
    '投稿日時',
    '投稿チャンネル',
    '投稿チャンネルID',
    'ユーザーID',
    'スレッドNo',
    'スレッドトップ内容',
    '投稿内容',
    '投稿URL'
  ].join('\t');

  const lines = messages.map(msg => {
    const tsString = formatSlackTimestamp(msg.ts);
    return [
      tsString,
      msg.channelName ? `#${msg.channelName}` : '',
      msg.channelId || '',
      msg.userId || '',
      msg.threadLabel || '',
      sanitizeSlackSheetField(msg.threadTopText || msg.displayText || ''),
      sanitizeSlackSheetField(msg.text || ''),
      msg.permalink || ''
    ].join('\t');
  });

  return [headerMarker, columnHeader].concat(lines).join('\n');
}

function formatSlackTimestamp(ts) {
  if (!ts) return '';
  const millis = parseFloat(ts) * 1000;
  if (isNaN(millis)) return '';
  return Utilities.formatDate(new Date(millis), 'JST', 'yyyy/MM/dd HH:mm:ss');
}

function sanitizeSlackSheetField(value) {
  if (!value) return '';
  return String(value).replace(/\t/g, '    ').replace(/\r?\n/g, ' / ');
}

function fetchGoogleCalendarEvents(d, ignoreWords = []) {
  // TODO: 将来的に、設定画面でユーザーがログ収集対象のカレンダーIDを選択できるようにする
  return CalendarApp.getDefaultCalendar().getEventsForDay(d)
    .filter(e => !ignoreWords.some(w => e.getTitle().includes(w)))
    .map(event => {
      const dur = (event.getEndTime() - event.getStartTime()) / 60000;
      return {
        log: `[予定] ${Utilities.formatDate(event.getStartTime(),'JST','HH:mm')} (${dur}分) ${event.getTitle()}`,
        event: event
      };
    });
}

function fetchGmailSentMessages(d) {
  const start = new Date(d);
  start.setHours(0,0,0,0);
  const end = new Date(d);
  end.setHours(23,59,59,999);
  const s = Math.floor(start.getTime()/1000);
  const e = Math.floor(end.getTime()/1000);
  return GmailApp.search(`from:me after:${s} before:${e}`).map(thread => {
    const msg = thread.getMessages()[0];
    const subject = thread.getFirstMessageSubject();
    return {
      date: msg ? msg.getDate() : null,
      subject: subject,
      url: `https://mail.google.com/mail/u/0/#sent/${thread.getId()}`,
      displayText: `[送信] ${subject}`
    };
  });
}

function fetchMultiBacklogActivities(c, d) {
  let acts = [];
  c.forEach(conf => {
    try {
      const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const u = JSON.parse(UrlFetchApp.fetch(`https://${h}/api/v2/users/myself?apiKey=${conf.key}`).getContentText()).id;
      const res = JSON.parse(UrlFetchApp.fetch(`https://${h}/api/v2/users/${u}/activities?apiKey=${conf.key}`).getContentText());
      const ts = new Date(d); ts.setHours(0,0,0,0); const te = new Date(d); te.setHours(23,59,59,999);
      res.filter(a => { const ad = new Date(a.created); return ad >= ts && ad < te; }).forEach(a => {
        const summary = a.content.summary || '更新';
        const issueKey = a.content && a.content.key_id
          ? `${a.project.projectKey}-${a.content.key_id}` : null;
        acts.push({
          date: new Date(a.created),
          projectKey: a.project.projectKey,
          summary: summary,
          comment: a.content.comment ? a.content.comment.content.substring(0, 200) : '',
          issueKey: issueKey,
          url: issueKey ? `https://${h}/view/${issueKey}` : '',
          displayText: `[Backlog] ${a.project.projectKey} ${summary}`
        });
      });
    } catch(e){}
  });
  return acts;
}

/**
 * Slackチャンネル/ユーザーIDが除外リストに含まれているかチェックします。
 */
function checkSlackChannelIds(idsStr) {
  const props = PropertiesService.getUserProperties();
  const token = props.getProperty('SLACK_USER_TOKEN');
  if (!token) return { results: [{ input: "Error", valid: false, message: "Slack連携がされていません" }] };

  const ids = idsStr.split(',').map(s => s.trim()).filter(s => s);
  const results = [];

  ids.forEach(id => {
    // 1. チャンネルID (C..., D..., G...)
    if (id.startsWith('C') || id.startsWith('D') || id.startsWith('G')) {
      try {
        const url = `https://slack.com/api/conversations.info?channel=${id}`;
        const res = JSON.parse(UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${token}` } }).getContentText());
        if (res.ok) {
          const name = res.channel.name || "DM/Private";
          results.push({ input: id, valid: true, message: `名前: <b>#${name}</b> (除外OK)` });
        } else {
          results.push({ input: id, valid: false, message: `見つかりません (${res.error})` });
        }
      } catch (e) { results.push({ input: id, valid: false, message: "通信エラー" }); }
    } 
    // 2. メンバーID (U..., W...)
    else if (id.startsWith('U') || id.startsWith('W')) {
      try {
        const uRes = JSON.parse(UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${id}`, { headers: { Authorization: `Bearer ${token}` } }).getContentText());
        if (uRes.ok) {
          const userName = uRes.user.real_name || uRes.user.name;
          results.push({ 
            input: id, 
            valid: true, 
            message: `👤 ユーザー: <b>${userName}</b><br>✅ 確認OK。このユーザーとのDMを自動除外します。` 
          });
        } else {
          results.push({ input: id, valid: false, message: `ユーザーが見つかりません` });
        }
      } catch (e) { results.push({ input: id, valid: false, message: "通信エラー" }); }
    } 
    else {
      results.push({ input: id, valid: false, message: "不正な形式です" });
    }
  });

  return { results: results, hasSuggestion: false };
}

function testGeminiConnection() {
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.5-flash:generateContent`;
  const payload = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Hello" }] }] });
  try {
    const options = { method: 'post', contentType: 'application/json', headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT_ID }, payload: payload, muteHttpExceptions: true };
    const res = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) { return { success: false, message: `エラー (${res.getResponseCode()}): ` + (json.error ? json.error.message : "詳細不明") }; }
    return { success: true, message: "✅ 接続成功！Vertex AI (Flash) が正常に応答しました。" };
  } catch (e) { return { success: false, message: "通信エラー: " + e.message }; }
}

function testSlackConnection(channelId) {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  let targetId = channelId;
  let isSelf = false;
  if (!token) return { success: false, message: "先にSlack連携(ログイン)を行ってください" };
  if (!targetId || targetId.trim() === "") { targetId = userProps.getProperty('SLACK_MEMBER_ID'); isSelf = true; if (!targetId) return { success: false, message: "メンバーIDが取得できていません。" }; }
  try {
    let url; let isUser = false;
    if (targetId.startsWith('U') || targetId.startsWith('W')) { url = `https://slack.com/api/users.info?user=${targetId}`; isUser = true; } 
    else { url = `https://slack.com/api/conversations.info?channel=${targetId}`; }
    const res = JSON.parse(UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${token}` } }).getContentText());
    if (res.ok) {
      // ★★★ 改善案: 接続テスト成功時に設定を保存する ★★★
      userProps.setProperty('SLACK_CHANNEL_ID', targetId);

      if (isUser) {
        return { success: true, message: `✅ 接続OK！\nユーザーID: ${targetId} (DMとして送信)\n\n設定を保存しました。` };
      } else {
        return { success: true, message: `✅ 接続OK！\nチャンネル名: #${res.channel.name}\n\n設定を保存しました。` };
      }
    } else {
      return { success: false, message: "エラー: " + res.error };
    }
  } catch (e) { return { success: false, message: "通信エラー: " + e.message }; }
}

function testBacklogConnection(host, apiKey) {
  if (!host || !apiKey) return { success: false, message: "ホスト名とAPIキーを入力してください" };
  host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    const url = `https://${host}/api/v2/users/myself?apiKey=${apiKey}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200 && json.id) { return { success: true, message: `✅ 接続OK！\nユーザー: ${json.name} (${json.userId})` }; } 
    else { return { success: false, message: "エラー: " + (json.errors ? json.errors[0].message : "認証に失敗しました") }; }
  } catch (e) { return { success: false, message: "通信エラー: " + e.message }; }
}

/**
 * 認証設定の診断を実行します。管理者がApps Scriptエディタから手動実行できます。
 * Slack OAuth設定が正しく構成されているか一括確認します。
 * @returns {object} 診断結果
 */
function diagnoseAuthConfig() {
  const results = [];
  const scriptProps = PropertiesService.getScriptProperties();

  // 1. SLACK_CLIENT_ID
  const clientId = scriptProps.getProperty('SLACK_CLIENT_ID');
  if (!clientId) {
    results.push({ check: 'SLACK_CLIENT_ID', status: 'FAIL', detail: 'スクリプトプロパティに SLACK_CLIENT_ID が設定されていません。' });
  } else {
    results.push({ check: 'SLACK_CLIENT_ID', status: 'OK', detail: `設定済み (末尾: ...${clientId.slice(-4)})` });
  }

  // 2. SLACK_CLIENT_SECRET
  const clientSecret = scriptProps.getProperty('SLACK_CLIENT_SECRET');
  if (!clientSecret) {
    results.push({ check: 'SLACK_CLIENT_SECRET', status: 'FAIL', detail: 'スクリプトプロパティに SLACK_CLIENT_SECRET が設定されていません。' });
  } else {
    results.push({ check: 'SLACK_CLIENT_SECRET', status: 'OK', detail: '設定済み (値は非表示)' });
  }

  // 3. SLACK_TEAM_ID（任意）
  const teamId = scriptProps.getProperty('SLACK_TEAM_ID');
  if (!teamId) {
    results.push({ check: 'SLACK_TEAM_ID', status: 'WARN', detail: '未設定。任意のワークスペースで認証可能な状態です。' });
  } else {
    results.push({ check: 'SLACK_TEAM_ID', status: 'OK', detail: `設定済み: ${teamId}` });
  }

  // 4. Web App URL
  const appUrl = ScriptApp.getService().getUrl();
  if (!appUrl) {
    results.push({ check: 'WEB_APP_URL', status: 'FAIL', detail: 'Webアプリがデプロイされていません。' });
  } else {
    results.push({ check: 'WEB_APP_URL', status: 'OK', detail: appUrl });
  }

  // 5. LOG_SHEET_ID
  if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    results.push({ check: 'LOG_SHEET_ID', status: 'WARN', detail: '未設定。認証イベントのスプレッドシートログが無効です。' });
  } else {
    try {
      SpreadsheetApp.openById(LOG_SHEET_ID);
      results.push({ check: 'LOG_SHEET_ID', status: 'OK', detail: '設定済み・アクセス可能' });
    } catch (openErr) {
      results.push({ check: 'LOG_SHEET_ID', status: 'FAIL', detail: 'スプレッドシートにアクセスできません: ' + openErr.message });
    }
  }

  // Salesforce連携設定の診断を追加
  const sfClientId = scriptProps.getProperty('SF_CLIENT_ID');
  if (!sfClientId) {
    results.push({ check: 'SF_CLIENT_ID', status: 'WARN', detail: 'Salesforce Connected AppのクライアントIDが設定されていません。' });
  } else {
    results.push({ check: 'SF_CLIENT_ID', status: 'OK', detail: `設定済み (末尾: ...${sfClientId.slice(-4)})` });
  }
  const sfClientSecret = scriptProps.getProperty('SF_CLIENT_SECRET');
  if (!sfClientSecret) {
    results.push({ check: 'SF_CLIENT_SECRET', status: 'WARN', detail: 'Salesforce Connected Appのクライアントシークレットが設定されていません。' });
  } else {
    results.push({ check: 'SF_CLIENT_SECRET', status: 'OK', detail: '設定済み (値は非表示)' });
  }

  console.log('=== Auth Configuration Diagnosis ===');
  results.forEach(r => {
    console.log(`[${r.status}] ${r.check}: ${r.detail}`);
  });
  console.log('====================================');

  return { results: results };
}

function sendToSlack(m, t, c, s, d, f, df) {
  const url = 'https://slack.com/api/chat.postMessage';
  const headers = { 'Authorization': 'Bearer ' + t };
  let payload = { channel: c, text: m };
  if (s === "thread") {
    const parentPayload = { channel: c, text: `【日報】${getFormattedDateString(d, df)}` };
    try {
      const res = UrlFetchApp.fetch(url, { method: 'post', headers, contentType: 'application/json', payload: JSON.stringify(parentPayload) });
      const json = JSON.parse(res.getContentText());
      if (json.ok) payload.thread_ts = json.ts; else console.warn("親スレッド作成失敗: " + json.error);
    } catch(e) { console.warn("Slack通信エラー(親投稿): " + e.message); }
  } else if (s === "fixed_thread") {
    let ts = null; const matchP = f.match(/\/p(\d{10})(\d{6})/);
    if (matchP) ts = `${matchP[1]}.${matchP[2]}`; else { const matchTs = f.match(/thread_ts=(\d+\.\d+)/); if (matchTs) ts = matchTs[1]; }
    if (ts) payload.thread_ts = ts; else console.warn("固定スレッドURLの解析に失敗");
  }
  
  try {
    const response = UrlFetchApp.fetch(url, { method: 'post', headers, contentType: 'application/json', payload: JSON.stringify(payload) });
    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      console.error("Slack投稿エラー:", result.error);
      throw new Error(`Slack投稿エラー: ${result.error}`);
    }
  } catch(e) {
    console.error("Slack通信エラー:", e);
    throw e;
  }
}

function getSlackAuthUrl() {
  const state = ScriptApp.newStateToken().withTimeout(600).createToken();
  CacheService.getUserCache().put('oauth_state', state, 600); // 10分間キャッシュ

  const redirectUri = ScriptApp.getService().getUrl();
  const scopes = 'channels:read,chat:write,search:read,users:read';
  const clientId = PropertiesService.getScriptProperties().getProperty('SLACK_CLIENT_ID');
  
  const teamId = PropertiesService.getScriptProperties().getProperty('SLACK_TEAM_ID');
  
  let authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  if (teamId) authUrl += `&team=${teamId}`;
  return authUrl;
}

function handleAuthCallback(e) {
  try {
    const receivedState = e.parameter.state;
    const expectedState = CacheService.getUserCache().get('oauth_state');

    if (!receivedState || receivedState !== expectedState) {
      throw createAuthError('AUTH-001', '認証セッションが無効です。ページを開いてから時間が経ちすぎた可能性があります。もう一度お試しください。');
    }
    CacheService.getUserCache().remove('oauth_state');

    const code = e.parameter.code;
    if (!code) {
      throw createAuthError('AUTH-002', 'Slackからの認証コードが見つかりませんでした。');
    }

    const scriptProps = PropertiesService.getScriptProperties();
    const clientId = scriptProps.getProperty('SLACK_CLIENT_ID');
    const clientSecret = scriptProps.getProperty('SLACK_CLIENT_SECRET');
    const redirectUri = ScriptApp.getService().getUrl();

    let response;
    try {
      response = UrlFetchApp.fetch('https://slack.com/api/oauth.v2.access', { method: 'post', payload: { code: code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri } });
    } catch (fetchErr) {
      let authMessage = 'Slack APIとの通信中にエラーが発生しました: ' + fetchErr.message;
      if (fetchErr.message.includes("script.external_request") || fetchErr.message.includes("権限")) {
        authMessage = 'スクリプトの実行権限が不足しています。\n\n'
          + '【対処法】\n'
          + '1. https://myaccount.google.com/permissions にアクセス\n'
          + '2. 本アプリのアクセス権を削除\n'
          + '3. 本アプリのURLに再度アクセスし、権限をすべて許可してください';
      }
      throw createAuthError('AUTH-005', authMessage);
    }
    const json = JSON.parse(response.getContentText());

    if (json.ok) {
      const expectedTeamId = PropertiesService.getScriptProperties().getProperty('SLACK_TEAM_ID');
      const actualTeamId = json.team && json.team.id;
      const actualTeamName = json.team && json.team.name;
      const authedUserId = json.authed_user && json.authed_user.id;

      if (expectedTeamId && actualTeamId && expectedTeamId !== actualTeamId) {
        console.error(
          "Team ID mismatch during auth. Expected: %s, Got: %s (Team Name: %s, User ID: %s)",
          expectedTeamId, actualTeamId, actualTeamName, authedUserId
        );
        throw createAuthError('AUTH-004', '許可されていないSlackワークスペースで認証されました。正しいワークスペースで再度お試しください。');
      }

      const userProps = PropertiesService.getUserProperties();
      userProps.setProperty('SLACK_USER_TOKEN', json.authed_user.access_token);
      userProps.setProperty('SLACK_MEMBER_ID', json.authed_user.id);
      let slackName = 'ユーザー';
      try {
        const userRes = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${json.authed_user.id}`, { headers: { 'Authorization': `Bearer ${json.authed_user.access_token}` } });
        const userData = JSON.parse(userRes.getContentText());
        if (userData.ok) { slackName = userData.user.profile.display_name || userData.user.real_name || userData.user.name; userProps.setProperty('SLACK_USER_NAME', slackName); }
      } catch(nameErr) { /* ユーザー名取得失敗は致命的ではないので無視 */ }

      logAuthEvent('AUTH-OK', 'Authentication successful for ' + slackName, Session.getActiveUser().getEmail(), e.parameter);

      return renderResultPage("🎉 連携が完了しました！", "以下のボタンを押して、アプリの利用を開始してください。", `${ScriptApp.getService().getUrl()}?setup=true`, '🎉');

    } else {
      const safeErrorResponse = {
        ok: json.ok,
        error: json.error,
        team: json.team,
        user: json.user ? { id: json.user.id, name: json.user.name } : undefined
      };
      console.error("Slack API Error during auth:", JSON.stringify(safeErrorResponse, null, 2));
      throw createAuthError('AUTH-003', 'Slack認証に失敗しました: ' + (json.error || '不明なエラー'));
    }
  } catch (err) {
    const errorCode = err.authErrorCode || 'AUTH-099';
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    const userEmail = Session.getActiveUser().getEmail() || 'unknown';

    console.error(JSON.stringify({
      event: 'auth_callback_failed',
      errorCode: errorCode,
      message: err.message,
      stack: err.stack,
      userEmail: userEmail,
      timestamp: timestamp,
      requestParams: {
        hasCode: !!e.parameter.code,
        hasState: !!e.parameter.state,
        hasError: !!e.parameter.error,
        errorParam: e.parameter.error || null
      }
    }));

    logAuthEvent(errorCode, err.message, userEmail, e.parameter);

    const userMessage = `エラーコード: ${errorCode}\n発生時刻: ${timestamp}\n\n${err.message}\n\nこの情報を管理者にお伝えください。`;
    return renderResultPage("認証エラー", userMessage, ScriptApp.getService().getUrl(), "❌");
  }
}

/**
 * ログアウト処理を行い、ユーザーを再認証ページへリダイレクトさせます。
 * @returns {HtmlOutput} リダイレクト用のHTML
 */
function handleLogout() {
  const userProps = PropertiesService.getUserProperties();
  userProps.deleteAllProperties(); // ユーザープロパティをすべて削除
  updateTrigger_(false); // 自動実行トリガーを削除
  
  // Salesforce連携情報も削除
  disconnectSalesforce(); // 新規追加

  const authUrl = getSlackAuthUrl();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa; }
          .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; }
          h1 { margin: 0 0 10px 0; font-size: 20px; }
          p { color: #666; margin-bottom: 25px; }
          a { display: inline-block; background: #1a73e8; color: #fff; padding: 12px 24px; border-radius: 24px; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card"><h1>👋 ログアウトしました</h1><p>設定はすべてリセットされました。</p><a href="${authUrl}" target="_top">再度Slackと連携する</a></div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle('ログアウト完了');
}

function getFormattedDateString(d, t) {
  const dp = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年MM月dd日');
  if (t === 'none') return dp;
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${dp} (${days[d.getDay()]})`;
}

/**
 * Renders a simple HTML page to show a result message to the user.
 * Uses the result.html template.
 * @param {string} title The title of the page.
 * @param {string} message The message to display.
 * @param {string} appUrl The URL to redirect to.
 * @param {string} icon The emoji icon to display.
 * @returns {HtmlOutput} The HTML output to render.
 */
function renderResultPage(title, message, appUrl, icon) {
  const template = HtmlService.createTemplateFromFile('result');
  template.title = title;
  template.message = message;
  template.appUrl = appUrl || ScriptApp.getService().getUrl();
  template.icon = icon || '✅';
  return template.evaluate().setTitle(title);
}
