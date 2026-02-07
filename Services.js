// ==========================================
// Services.gs: 外部サービス連携 (Slack, Calendar, etc.)
// ==========================================

function runDailyReportAndArchive() {
  const res = generatePreviewReport(null, null); 
  if(res.success) sendFinalReport(res.report, null);
}

function generatePreviewReport(instruction = null, dateStr = null) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携がされていません");

  // AI.jsで直接呼び出せないため、ここでプロンプト設定を取得する
  const prompts = getPromptSettings();
  
  let targetDate = new Date(); 
  if (dateStr) { targetDate = new Date(dateStr); } 

  const logData = collectLogs(props, targetDate);
  
  if (!logData.text || logData.text.trim().length < 50) { 
      return { 
          success: true, 
          report: "⚠️ 【ログが見つかりませんでした】\n本日の活動ログ（カレンダー、Slack、Gmail等）が取得できませんでした。\n\n・日付が正しいか確認してください\n・休日の場合は活動がない可能性があります", 
          counts: logData.counts 
      };
  }

  const modelType = props.REPORT_MODEL_TYPE || 'flash';
  const report = generateReportWithGemini(logData.text, modelType, prompts, props.REPORT_MODE, targetDate, props.REPORT_REFLECTION, props.REPORT_MANHOUR, props.REPORT_DAY_FORMAT, instruction);
  return { success: true, report: report, counts: logData.counts };
}

function runPeriodAggregation(startDateStr, endDateStr, modelType, projectList) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携がされていません");

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  
  if(start > end) throw new Error("終了日は開始日より後に設定してください");

  // ログ収集（並列処理）
  const logText = collectPeriodLogsParallel(start, end, props.SLACK_USER_TOKEN, props);
  
  if (!logText || logText.trim().length < 50) {
    return { success: false, message: "期間内のログが見つかりませんでした。" };
  }

  // Gemini呼び出し
  const report = generateAggregationWithGemini(logText, modelType, start, end, projectList);
  return { success: true, report: report };
}

function sendFinalReport(editedReport, dateStr = null) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携切れ");

  // AI.jsで直接呼び出せないため、ここでプロンプト設定を取得する
  const prompts = getPromptSettings();
  
  let targetDate = new Date();
  if (dateStr) { targetDate = new Date(dateStr); }
  else if (props.REPORT_DATE) { targetDate = new Date(props.REPORT_DATE); }
  
  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) throw new Error("送信先(チャンネルIDまたはメンバーID)が見つかりません。設定を保存し直してください。");

  sendToSlack(editedReport, props.SLACK_USER_TOKEN, dest, props.REPORT_SLACK_STYLE, targetDate, props.REPORT_FIXED_THREAD_URL, props.REPORT_DAY_FORMAT);
  
  const historyUrl = saveToPrivateHistory(editedReport, targetDate);
  return { success: true, message: "Slack送信完了！", historyUrl: historyUrl };
}

function collectLogs(props, targetDate) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0 };

  // 除外設定の読み込み
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);

  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if(cal.length > 0) {
        counts.calendar = cal.length;
        allLogs += `=== Calendar ===\n${cal.join('\n')}\n\n`;
    }
  } catch(e){ console.warn("Calendar error:", e); }
  
  try { 
    // ★Slackログ取得（除外リストを渡す）
    const sl = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    if(sl.length > 0) {
        counts.slack = sl.length;
        allLogs += `=== Slack ===\n${sl.join('\n')}\n\n`; 
    }
  } catch(e){ console.warn("Slack error:", e); }
  
  try { 
    const gm = fetchGmailSentMessages(targetDate);
    if(gm.length > 0) {
        counts.gmail = gm.length;
        allLogs += `=== Gmail ===\n${gm.join('\n')}\n\n`; 
    }
  } catch(e){
    if (e.message.includes("Gmailへのアクセス権限がありません")) {
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
          allLogs += `=== Backlog ===\n${blData.join('\n')}\n\n`;
      }
    }
  } catch(e){ console.warn("Backlog error:", e); }
  
  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }
  
  return { text: allLogs, counts: counts };
}

// 期間指定の並列ログ収集
function collectPeriodLogsParallel(start, end, slackToken, props) {
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
  let backlogIndices = [];

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

  // Backlogリクエスト
  let backlogConfigs = [];
  try { backlogConfigs = JSON.parse(props.BACKLOG_CONFIGS || "[]"); } catch(e){}
  
  if (backlogConfigs.length > 0) {
      const backlogActivityRequests = backlogConfigs.map(conf => {
          const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
          return { url: `https://${h}/api/v2/users/myself/activities?apiKey=${conf.key}&count=100`, muteHttpExceptions: true, headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } };
      });
      backlogIndices = backlogActivityRequests.map((_, i) => ({ config: backlogConfigs[i], reqIndex: requests.length + i }));
      requests = requests.concat(backlogActivityRequests);
  }

  // 一括フェッチ
  let responses = [];
  if (requests.length > 0) {
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch(e) {
      throw new Error("ログ収集時の通信エラー: " + e.message);
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
          // ★修正: `json.messages.matches` が存在することを保証する
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
    
    if (dayLogs.length > 0) {
      allLogs += `\n=== ${dateLabel} ===\n` + dayLogs.join('\n') + "\n";
    }
  });

  let blLogs = [];
  backlogIndices.forEach(bi => {
      const resp = responses[bi.reqIndex];
      if (resp.getResponseCode() === 200) {
          try {
              const acts = JSON.parse(resp.getContentText());
              acts.filter(a => new Date(a.created) >= start && new Date(a.created) <= end)
                  .forEach(a => {
                      const dateStr = Utilities.formatDate(new Date(a.created), 'JST', 'MM/dd');
                      const summary = a.content.summary || (a.content.comment ? `コメント: ${a.content.comment.content.substring(0,20)}...` : '更新');
                      blLogs.push(`${dateStr} [Backlog] ${a.project.projectKey} ${summary}`);
                  });
          } catch (e) {
            console.warn(`Backlog log parsing failed for host ${bi.config.host}: ${e.message}`);
          }
      }
  });
  if (blLogs.length > 0) allLogs += `\n=== Backlog Activities ===\n` + blLogs.join('\n');

  // ★追加: 最終的な文字列長を制限する
  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }

  return allLogs;
}

// ------------------------------------------
// サービス別ヘルパー関数群
// ------------------------------------------

// ★Slackの除外判定ロジック
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

// ★指定されたユーザーIDリストから名前を取得する (DM判定用)
function resolveSlackUserNames(token, userIds) {
  if (!userIds || userIds.length === 0) return [];
  
  const names = [];
  userIds.forEach(uid => {
    try {
        const res = JSON.parse(UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${uid}`, { 
          headers: { 'Authorization': 'Bearer ' + token } 
        }).getContentText());
        if (res.ok) {
          names.push(res.user.name); 
        }
    } catch(e) {}
  });
  return names;
}

function fetchMySlackPosts(t, d, s, ignoreIds = []) {
  const ds = Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
  let q = `from:me on:${ds}`; 
  if (s === 'public') q += ` is:public`;

  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=100`;
  const response = UrlFetchApp.fetch(url, { 
    headers: { 'Authorization': 'Bearer ' + t },
    muteHttpExceptions: true 
  });
  const res = JSON.parse(response.getContentText());
  
  if (!res.ok) {
    if (res.error === 'invalid_auth') {
      throw new Error("Slackの認証が切れました。お手数ですが「接続設定」タブから再連携してください。");
    }
    console.warn(`Slack API error in fetchMySlackPosts: ${res.error}`);
    return [];
  }

  if (!res.messages || !res.messages.matches) return [];
  const ignoreUserNames = resolveSlackUserNames(t, ignoreIds.filter(id => id.startsWith('U') || id.startsWith('W')));

  return res.messages.matches
    .filter(m => !shouldIgnoreSlackChannel(m.channel, ignoreIds, ignoreUserNames))
    .map(m => `[#${m.channel.name}] ${m.text}`);
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
  const s = Math.floor(new Date(d.setHours(0,0,0,0)).getTime()/1000);
  const e = Math.floor(new Date(d.setHours(23,59,59,999)).getTime()/1000);
  return GmailApp.search(`from:me after:${s} before:${e}`).map(t => `[送信] ${t.getFirstMessageSubject()}`);
}

function fetchMultiBacklogActivities(c, d) {
  let acts = [];
  c.forEach(conf => {
    try {
      const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const u = JSON.parse(UrlFetchApp.fetch(`https://${h}/api/v2/users/myself?apiKey=${conf.key}`).getContentText()).id;
      const res = JSON.parse(UrlFetchApp.fetch(`https://${h}/api/v2/users/${u}/activities?apiKey=${conf.key}`).getContentText());
      const ts = new Date(d.setHours(0,0,0,0)); const te = new Date(d.setHours(23,59,59,999));
      res.filter(a => { const ad = new Date(a.created); return ad >= ts && ad < te; }).forEach(a => acts.push(`[Backlog] ${a.project.projectKey} ${a.content.summary || '更新'}`));
    } catch(e){}
  });
  return acts;
}

// ★修正：U... IDがきてもエラーにせず、ユーザー確認のみ行う
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
    // 2. メンバーID (U..., W...) ★ここを修正
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
    if (res.ok) { if (isUser) return { success: true, message: `✅ 接続OK！\nユーザーID: ${targetId} (DMとして送信)` }; else return { success: true, message: `✅ 接続OK！\nチャンネル名: #${res.channel.name}` }; } 
    else { return { success: false, message: "エラー: " + res.error }; }
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
  const baseUrl = ScriptApp.getService().getUrl();
  const scopes = 'channels:read,chat:write,search:read,users:read';
  const clientId = PropertiesService.getScriptProperties().getProperty('SLACK_CLIENT_ID');
  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scopes}&redirect_uri=${encodeURIComponent(baseUrl)}`;
}

function handleCallback(code) {
  const scriptProps = PropertiesService.getScriptProperties();
  const clientId = scriptProps.getProperty('SLACK_CLIENT_ID');
  const clientSecret = scriptProps.getProperty('SLACK_CLIENT_SECRET');
  const redirectUri = ScriptApp.getService().getUrl();
  try {
    const response = UrlFetchApp.fetch('https://slack.com/api/oauth.v2.access', { method: 'post', payload: { code: code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri } });
    const json = JSON.parse(response.getContentText());
    if (json.ok) {
      const userProps = PropertiesService.getUserProperties();
      userProps.setProperty('SLACK_USER_TOKEN', json.authed_user.access_token);
      userProps.setProperty('SLACK_MEMBER_ID', json.authed_user.id);
      let slackName = 'ユーザー';
      try {
        const userRes = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${json.authed_user.id}`, { headers: { Authorization: `Bearer ${json.authed_user.access_token}` } });
        const userData = JSON.parse(userRes.getContentText());
        if (userData.ok) { slackName = userData.user.profile.display_name || userData.user.real_name || userData.user.name; userProps.setProperty('SLACK_USER_NAME', slackName); }
      } catch(e) {}
      return renderResultPage("🎉 連携成功！", slackName + " さん、設定が完了しました。まもなくトップ画面に戻ります。");
    } else { return HtmlService.createHtmlOutput(`<h1>❌ 認証エラー</h1><p>${json.error}</p>`); }
  } catch (e) { return HtmlService.createHtmlOutput(`<h1>❌ システムエラー</h1><p>${e.message}</p>`); }
}

function doLogout() { 
  const userProps = PropertiesService.getUserProperties();
  // Slack連携情報と設定のみ削除し、スプレッドシートIDは保持する
  Object.keys(userProps.getProperties()).forEach(key => {
    if (key !== 'APP_SHEET_ID') userProps.deleteProperty(key);
  });
  updateTrigger_(false, 0); 
}

function getFormattedDateString(d, t) {
  const dp = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy年MM月dd日');
  if (t === 'none') return dp;
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${dp} (${days[d.getDay()]})`;
}