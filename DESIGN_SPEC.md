# 設計書: Gemippo-GAS 追加機能

## 対象リポジトリ概要

**Gemippo-GAS** は Google Apps Script (GAS) で動作する AI 日報生成ツールです。
Calendar/Slack/Gmail/Backlog からログを収集し、Vertex AI (Gemini) で日報を生成して Slack に投稿します。

### ファイル構成

| ファイル | 役割 |
|---|---|
| `Config.js` | 設定保存・スプレッドシート管理・トリガー管理 |
| `Services.js` | 外部サービス連携（ログ収集・Slack投稿など） |
| `AI.js` | Vertex AI (Gemini) プロンプト・AI呼び出し |
| `Index.html` | メイン UI（GAS HtmlService テンプレート）|
| `js.html` | フロントエンド JS（Index.html に `<?!= include('js') ?>` でインジェクト）|
| `css.html` | スタイルシート |

---

## 機能① 生ログのスプレッドシート書き込み

### 目的
`collectLogs()` が各サービスから収集した**AI要約前の生テキスト**を、ソース別に列を分けてスプレッドシートに自動保存する。

### トリガー
`generatePreviewReport()` が呼ばれるたびに自動実行（プレビュー・スケジュール実行の両方）。

### 保存先
既存の `📂 AI日報_管理データ` スプレッドシート（`Config.js:getOrSetupAppSheet()` が管理）に、**新シート「生ログ」** を追加する。

### スプレッドシートの列定義

| 列 | ヘッダー | 内容 |
|---|---|---|
| A | 記録日時 | `yyyy/MM/dd HH:mm:ss`（JST） |
| B | 対象日 | `yyyy/MM/dd`（JST） |
| C | カレンダー | fetchGoogleCalendarEvents の生テキスト |
| D | Slack | fetchMySlackPosts の生テキスト |
| E | Gmail | fetchGmailSentMessages の生テキスト |
| F | Backlog | fetchMultiBacklogActivities の生テキスト |
| G | Salesforce | TeamSpirit/BigQuery の生テキスト |

---

### 変更箇所

#### `Config.js` — 2箇所

**変更①: `getOrSetupAppSheet()` (現在: 行59〜88)**

初回スプレッドシート作成時のブロック（`if (!id) { ... }`）に、"生ログ" シートの初期化を追加する。

```
// 現在のコード (行72〜87):
  if (!id) {
    ss = SpreadsheetApp.create("📂 AI日報_管理データ");
    id = ss.getId();
    userProps.setProperty('APP_SHEET_ID', id);

    let hSheet = ss.getSheets()[0];
    hSheet.setName('履歴');
    hSheet.appendRow(["送信日時", "対象日", "日報内容"]);
    hSheet.setFrozenRows(1);

    // プロンプトシートを初期化（CS部）
    resetToDefaultPrompts('CS');
    // ES部プロンプトシートも初期化
    resetToDefaultPrompts('ES');
  }
```

```
// 変更後 (hSheet の setFrozenRows(1) の直後に以下を追加):
    let rawSheet = ss.insertSheet('生ログ');
    rawSheet.appendRow(["記録日時", "対象日", "カレンダー", "Slack", "Gmail", "Backlog", "Salesforce"]);
    rawSheet.setFrozenRows(1);
    rawSheet.setColumnWidths(3, 5, 350);  // C〜G列（カレンダー〜Salesforce）を350pxに
```

**変更②: `saveToPrivateHistory()` の直前（現在: 行314）に新関数を追加**

```javascript
/**
 * 生ログ（AI要約前の各ソースのテキスト）を "生ログ" シートに追記します。
 * @param {object} sources ソース別テキスト { calendar, slack, gmail, backlog, salesforce }
 * @param {Date} targetDate 対象日
 */
function saveRawLogsToSheet(sources, targetDate) {
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName('生ログ');
  if (!sheet) {
    sheet = ss.insertSheet('生ログ');
    sheet.appendRow(["記録日時", "対象日", "カレンダー", "Slack", "Gmail", "Backlog", "Salesforce"]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(3, 5, 350);
  }
  const timestamp = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  const dateStr = Utilities.formatDate(targetDate, 'JST', 'yyyy/MM/dd');
  sheet.appendRow([
    timestamp,
    dateStr,
    sources.calendar   || '',
    sources.slack      || '',
    sources.gmail      || '',
    sources.backlog    || '',
    sources.salesforce || ''
  ]);
}
```

---

#### `Services.js` — 2箇所

**変更①: `collectLogs()` (現在: 行288〜404)**

各ソース取得ブロックで `sources` オブジェクトの対応フィールドにもテキストを格納し、戻り値に追加する。

```
// 現在のコード (行288〜291):
function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 };
  let teamSpiritData = null;
```

```
// 変更後:
function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 };
  let teamSpiritData = null;
  // ★追加: ソース別生ログ
  let sources = { calendar: '', slack: '', gmail: '', backlog: '', salesforce: '' };
```

```
// 現在のコード (Calendar ブロック, 行298〜304):
  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if(cal.length > 0) {
        counts.calendar = cal.length;
        allLogs += `=== Calendar ===\n${cal.map(c => c.log).join('\n')}\n\n`;
    }
  } catch(e){ console.warn("Calendar error:", e); }
```

```
// 変更後:
  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if(cal.length > 0) {
        counts.calendar = cal.length;
        const calText = cal.map(c => c.log).join('\n');
        sources.calendar = calText;                             // ★追加
        allLogs += `=== Calendar ===\n${calText}\n\n`;
    }
  } catch(e){ console.warn("Calendar error:", e); }
```

```
// 現在のコード (Slack ブロック, 行306〜312):
  try {
    const sl = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    if(sl.length > 0) {
        counts.slack = sl.length;
        allLogs += `=== Slack ===\n${sl.join('\n')}\n\n`;
    }
  } catch(e){ console.warn("Slack error:", e); }
```

```
// 変更後:
  try {
    const sl = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    if(sl.length > 0) {
        counts.slack = sl.length;
        const slText = sl.join('\n');
        sources.slack = slText;                                 // ★追加
        allLogs += `=== Slack ===\n${slText}\n\n`;
    }
  } catch(e){ console.warn("Slack error:", e); }
```

```
// 現在のコード (Gmail ブロック, 行314〜325):
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
```

```
// 変更後:
  try {
    const gm = fetchGmailSentMessages(targetDate);
    if(gm.length > 0) {
        counts.gmail = gm.length;
        const gmText = gm.join('\n');
        sources.gmail = gmText;                                 // ★追加
        allLogs += `=== Gmail ===\n${gmText}\n\n`;
    }
  } catch(e){
    if (e.message.includes("Gmailへのアクセス権限がありません")) {
        throw new Error("Gmailへのアクセス権限がありません。Googleアカウントの権限設定を確認してください。");
    }
    console.warn("Gmail error:", e);
  }
```

```
// 現在のコード (Backlog ブロック, 行327〜336):
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
```

```
// 変更後:
  try {
    let bl = JSON.parse(props.BACKLOG_CONFIGS || "[]");
    if(bl.length > 0) {
      const blData = fetchMultiBacklogActivities(bl, targetDate);
      if(blData.length > 0) {
          counts.backlog = blData.length;
          const blText = blData.join('\n');
          sources.backlog = blText;                             // ★追加
          allLogs += `=== Backlog ===\n${blText}\n\n`;
      }
    }
  } catch(e){ console.warn("Backlog error:", e); }
```

```
// 現在のコード (Salesforce ブロック末尾, 行394〜397):
  if (sfLogs.length > 0) {
    counts.salesforce = sfLogs.length;
    allLogs += `=== Salesforce ===\n${sfLogs.join('\n')}\n\n`;
  }
```

```
// 変更後:
  if (sfLogs.length > 0) {
    counts.salesforce = sfLogs.length;
    const sfText = sfLogs.join('\n');
    sources.salesforce = sfText;                               // ★追加
    allLogs += `=== Salesforce ===\n${sfText}\n\n`;
  }
```

```
// 現在のコード (戻り値, 行403):
  return { text: allLogs, counts: counts, teamSpiritData: teamSpiritData };
```

```
// 変更後:
  return { text: allLogs, counts: counts, teamSpiritData: teamSpiritData, sources: sources };
```

**変更②: `generatePreviewReport()` (現在: 行109〜151)**

`collectLogs()` 呼び出しの直後（行122の次）に、生ログ保存の呼び出しを追加する。

```
// 現在のコード (行121〜130):
  // 部署をcollectLogsに渡す
  const logData = collectLogs(props, targetDate, department);

  if (!logData.text || logData.text.trim().length < 50) {
      return {
          success: true,
          report: "⚠️ 【ログが見つかりませんでした】...",
          counts: logData.counts
      };
  }
```

```
// 変更後:
  // 部署をcollectLogsに渡す
  const logData = collectLogs(props, targetDate, department);

  // ★追加: 生ログをスプレッドシートに保存（失敗しても本処理は続行）
  try { saveRawLogsToSheet(logData.sources, targetDate); } catch(e) { console.warn("生ログ保存エラー:", e); }

  if (!logData.text || logData.text.trim().length < 50) {
      return {
          success: true,
          report: "⚠️ 【ログが見つかりませんでした】...",
          counts: logData.counts
      };
  }
```

---

## 機能② 今日のTODO Slack通知

### 目的
毎朝（設定した時刻）または手動ボタンで、当日の Google Calendar 予定と Backlog 未完了課題を Gemini が整理し、「今日のTODO」として Slack に投稿する。

### データソース
- **Google Calendar**: 既存の `fetchGoogleCalendarEvents()` を再利用（当日の予定）
- **Backlog**: 新規関数 `fetchBacklogTodayIssues()` を追加。Backlog API の `/api/v2/issues` で自分にアサインされた未完了課題（期限≦今日）を取得
- **AI**: 新規関数 `generateTodaysTodoWithGemini()` で TODO リストを生成

### スケジューラ設計
既存の日報スケジューラと完全に同じ二段階パターンを踏む：

1. **深夜トリガー** (`planTodaysTodoExecution`): 毎日 0時 → 設定日・時刻を確認 → 実行トリガーをセット
2. **実行トリガー** (`autoRunTodaysTodo`): 指定時刻に1回だけ → `sendTodaysTodoNotification()` を呼ぶ

### プロパティキー（PropertiesService.getUserProperties に保存）
| キー | 値 |
|---|---|
| `TODO_NOTIFY_ENABLE` | `'on'` または `'off'` |
| `TODO_NOTIFY_TIME` | `'HH:mm'` 形式（例: `'09:00'`）|
| `TODO_NOTIFY_DAYS` | JSON配列（例: `'["1","2","3","4","5"]'`）曜日番号（0=日曜）|

---

### 変更箇所

#### `Services.js` — 新規関数を `collectLogs()` の後（行404の後）に追加

```javascript
/**
 * Backlog API の /api/v2/issues を使い、自分にアサインされた未完了課題を取得します。
 * 期限が今日以前のもの（期限切れ含む）を返します。
 * @param {Array} configs BACKLOG_CONFIGS の配列（各要素: { host, key, label }）
 * @param {Date} today 対象日（通常 new Date()）
 * @returns {string[]} 課題のテキスト配列
 */
function fetchBacklogTodayIssues(configs, today) {
  const issues = [];
  const todayStr = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  configs.forEach(conf => {
    try {
      const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      // 自分のユーザーID取得
      const myselfRes = JSON.parse(
        UrlFetchApp.fetch(`https://${h}/api/v2/users/myself?apiKey=${conf.key}`).getContentText()
      );
      const userId = myselfRes.id;

      // 未完了課題（statusId: 1=未対応, 2=処理中）で期限が今日以前のもの
      const url = `https://${h}/api/v2/issues?apiKey=${conf.key}` +
                  `&assigneeId[]=${userId}` +
                  `&statusId[]=1&statusId[]=2` +
                  `&dueDateUntil=${todayStr}` +
                  `&count=50`;
      const res = JSON.parse(UrlFetchApp.fetch(url).getContentText());

      res.forEach(issue => {
        const dueLabel = issue.dueDate
          ? ` (期限: ${issue.dueDate.substring(0, 10)})`
          : ' (期限未設定)';
        const isOverdue = issue.dueDate && issue.dueDate.substring(0, 10) < todayStr;
        const overdueLabel = isOverdue ? ' ⚠️期限切れ' : '';
        issues.push(`[Backlog] ${issue.issueKey}: ${issue.summary}${dueLabel}${overdueLabel}`);
      });
    } catch(e) {
      console.warn('Backlog today issues error:', e);
    }
  });

  return issues;
}

/**
 * 今日のTODO通知用のログ（Calendar + Backlog未完了課題）を収集します。
 * @param {object} props PropertiesService.getUserProperties().getProperties()
 * @param {Date} today 対象日（new Date()）
 * @returns {string} 収集したテキスト（空の場合は空文字）
 */
function collectTodaysTasks(props, today) {
  let text = '';
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || '').split(',').map(w => w.trim()).filter(w => w);

  // Google Calendar（既存関数を再利用）
  try {
    const cal = fetchGoogleCalendarEvents(today, calIgnore);
    if (cal.length > 0) {
      text += `=== 本日の予定 ===\n${cal.map(c => c.log).join('\n')}\n\n`;
    }
  } catch(e) { console.warn('collectTodaysTasks Calendar error:', e); }

  // Backlog 未完了課題（新規関数）
  try {
    const bl = JSON.parse(props.BACKLOG_CONFIGS || '[]');
    if (bl.length > 0) {
      const issues = fetchBacklogTodayIssues(bl, today);
      if (issues.length > 0) {
        text += `=== Backlog 未完了課題 ===\n${issues.join('\n')}\n\n`;
      }
    }
  } catch(e) { console.warn('collectTodaysTasks Backlog error:', e); }

  return text;
}

/**
 * 今日のTODOを生成してSlackに投稿します。
 * UIのボタンからも、スケジューラからも呼ばれます。
 * @returns {object} { success: boolean, message: string }
 */
function sendTodaysTodoNotification() {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    return { success: false, message: 'Slack連携がされていません。「接続設定」タブから連携してください。' };
  }

  const today = new Date();
  const taskText = collectTodaysTasks(props, today);

  if (!taskText || taskText.trim().length < 10) {
    return { success: true, message: '⚠️ 本日のカレンダー予定・Backlog課題が見つかりませんでした。' };
  }

  const department = props.SELECTED_DEPARTMENT || 'CS';
  const todoMessage = generateTodaysTodoWithGemini(taskText, department, today);

  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) {
    return { success: false, message: '送信先Slack IDが設定されていません。' };
  }

  // Slack投稿（既存の sendToSlack を再利用。スタイルは direct 固定）
  sendToSlack(todoMessage, props.SLACK_USER_TOKEN, dest, 'direct', today, null, props.REPORT_DAY_FORMAT);

  return { success: true, message: '今日のTODOをSlackに送信しました！' };
}

/**
 * トリガーのハンドラ関数（autoRunDailyReport と同パターン）。
 */
function autoRunTodaysTodo() {
  sendTodaysTodoNotification();
}
```

---

#### `AI.js` — ファイル末尾に新規追加

```javascript
// ==========================================
// 今日のTODO生成用プロンプトと関数
// ==========================================

const DEFAULT_TODO_PROMPT = `あなたは優秀なタスクマネージャーです。
以下の「本日の予定（カレンダー）」と「Backlogの未完了課題」を分析し、今日やるべきことを優先度順にリストアップしてください。

### ルール
- 最大10件まで
- 期限切れの課題は最優先に
- カレンダーの予定は時刻順に記載
- 簡潔に（1行以内）

### 出力形式
【今日のTODO】{{DATE}}

🔴 最優先（期限切れ・本日締切）
● ...
● ...

📅 本日の予定
● ...

📋 その他のタスク
● ...

### 活動ログ
{{LOGS}}`;

/**
 * 今日のTODOリストをGeminiで生成します。
 * @param {string} logText collectTodaysTasks() が返したテキスト
 * @param {string} department 部署コード ('CS' または 'ES')
 * @param {Date} today 今日の日付
 * @returns {string} 生成されたTODOテキスト
 */
function generateTodaysTodoWithGemini(logText, department, today) {
  const useModelId = 'gemini-2.5-flash'; // TODOは flash で十分
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${useModelId}:generateContent`;

  const dateStr = Utilities.formatDate(today, 'JST', 'yyyy/MM/dd(E)');
  const promptText = DEFAULT_TODO_PROMPT
    .replaceAll('{{DATE}}', dateStr)
    .replaceAll('{{LOGS}}', logText);

  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{ text: 'あなたは優秀なタスクマネージャーです。簡潔で実用的なTODOリストを作成してください。' }]
    },
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
  });

  return callVertexAI(apiUrl, payload);
}
```

---

#### `Config.js` — 3箇所

**変更①: `saveUserSettings()` (現在: 行24〜57)**

`propsToSave` オブジェクトに TODO 通知設定を追加し、末尾で `updateTodoTrigger_()` も呼ぶ。

```
// 現在のコード (行43〜54):
    'BACKLOG_CONFIGS': JSON.stringify(data.backlogConfigs || []),
    // 新規追加
    'SELECTED_DEPARTMENT': data.selectedDepartment || userProps.getProperty('SELECTED_DEPARTMENT') || 'CS'
  };

  userProps.setProperties(propsToSave, false);

  userProps.setProperty('initialized', 'true');

  const isEnable = data.scheduleEnable === 'on';
  updateTrigger_(isEnable);

  return { success: true, message: "設定を保存しました！" };
```

```
// 変更後:
    'BACKLOG_CONFIGS': JSON.stringify(data.backlogConfigs || []),
    // 新規追加
    'SELECTED_DEPARTMENT': data.selectedDepartment || userProps.getProperty('SELECTED_DEPARTMENT') || 'CS'
  };

  userProps.setProperties(propsToSave, false);

  userProps.setProperty('initialized', 'true');

  const isEnable = data.scheduleEnable === 'on';
  updateTrigger_(isEnable);

  // ★追加: TODO通知トリガーの更新
  if (data.todoNotifyEnable !== undefined) {
    userProps.setProperties({
      'TODO_NOTIFY_ENABLE': data.todoNotifyEnable || 'off',
      'TODO_NOTIFY_TIME':   data.todoNotifyEnable === 'on' ? (data.todoNotifyTime || '09:00') : 'off',
      'TODO_NOTIFY_DAYS':   JSON.stringify(data.todoNotifyDays || [])
    }, false);
    updateTodoTrigger_(data.todoNotifyEnable === 'on');
  }

  return { success: true, message: "設定を保存しました！" };
```

**変更②: `isHoliday()` の後（現在: 行312）に新規関数を追加**

`updateTrigger_` と `planTodaysExecution` の直後かつ `saveToPrivateHistory` の前に追加する。

```javascript
/**
 * TODO通知スケジュールの「予約係」トリガーを更新します。
 * @param {boolean} isEnable 通知を有効にするか
 */
function updateTodoTrigger_(isEnable) {
  const handlerFunction = 'planTodaysTodoExecution';
  const triggers = ScriptApp.getProjectTriggers();
  let plannerExists = false;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === handlerFunction) {
      if (isEnable && !plannerExists) {
        plannerExists = true;
      } else {
        ScriptApp.deleteTrigger(trigger);
      }
    }
  });

  if (isEnable) {
    if (!plannerExists) {
      ScriptApp.newTrigger(handlerFunction)
        .timeBased()
        .everyDays(1)
        .atHour(0)
        .create();
    }
    planTodaysTodoExecution(); // 設定を即時反映
  }
}

/**
 * TODO通知の予約係関数。毎日深夜に実行され、その日の本番トリガーをセットします。
 */
function planTodaysTodoExecution() {
  const userProps = PropertiesService.getUserProperties();
  const props = userProps.getProperties();
  const notifyTime = props.TODO_NOTIFY_TIME; // "HH:mm"

  if (!notifyTime || notifyTime === 'off') return;

  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  const targetDays = JSON.parse(props.TODO_NOTIFY_DAYS || '[]');

  if (!targetDays.includes(dayOfWeek)) return;
  if (props.REPORT_SKIP_HOLIDAYS === 'true' && isHoliday(today)) return; // isHoliday() を共用

  // 既存の autoRunTodaysTodo トリガーを削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRunTodaysTodo') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const [hour, minute] = notifyTime.split(':');
  const executionDate = new Date(
    today.getFullYear(), today.getMonth(), today.getDate(),
    parseInt(hour, 10), parseInt(minute, 10)
  );

  if (executionDate > new Date()) {
    ScriptApp.newTrigger('autoRunTodaysTodo')
      .timeBased()
      .at(executionDate)
      .create();
  }
}
```

---

#### `Index.html` — 2箇所

**変更①: タブボタン列（現在: 行47〜53）にタブボタンを追加**

```
// 現在のコード:
        <div class="tabs">
          <button class="tab-btn active" data-tab="run" onclick="switchTab('run', event)">手動実行</button>
          <button class="tab-btn" data-tab="connection" onclick="switchTab('connection', event)">接続設定</button>
          <button class="tab-btn" data-tab="settings" onclick="switchTab('settings', event)">日報設定</button>
          <button class="tab-btn" data-tab="aggregation" onclick="switchTab('aggregation', event)">工数集計</button>
          <button class="tab-btn" data-tab="prompts" onclick="switchTab('prompts', event)">プロンプト</button>
        </div>
```

```
// 変更後（prompts ボタンの後に追加）:
        <div class="tabs">
          <button class="tab-btn active" data-tab="run" onclick="switchTab('run', event)">手動実行</button>
          <button class="tab-btn" data-tab="connection" onclick="switchTab('connection', event)">接続設定</button>
          <button class="tab-btn" data-tab="settings" onclick="switchTab('settings', event)">日報設定</button>
          <button class="tab-btn" data-tab="aggregation" onclick="switchTab('aggregation', event)">工数集計</button>
          <button class="tab-btn" data-tab="prompts" onclick="switchTab('prompts', event)">プロンプト</button>
          <button class="tab-btn" data-tab="todo" onclick="switchTab('todo', event)">今日のTODO</button>
        </div>
```

**変更②: `</div> <!-- /prompts -->` の後（現在: 行237）に新タブパネルを追加**

`</div>` の後（`<? } ?>` の前、行239）に挿入する。

```html
        <div id="todo" class="content">
          <!-- オンデマンド送信 -->
          <div class="group">
            <label>今日のTODOをSlackに送信します（Backlog + Googleカレンダーから自動収集）</label>
            <button type="button" class="btn btn-primary" onclick="runTodaysTodo()">今日のTODOをSlackに送る 📋</button>
          </div>

          <!-- 結果プレビュー -->
          <div id="todoResult" class="result-area markdown-body" style="display:none;"></div>

          <!-- 定時通知設定 -->
          <div class="group" style="border-top: 1px solid var(--border-color); margin-top: 24px; padding-top: 20px;">
            <label><strong>朝の定時通知設定</strong></label>

            <div style="margin-top: 12px;">
              <label>通知スケジュール</label>
              <div class="radio-group">
                <label><input type="radio" name="todoNotifyEnable" value="off" checked> オフ</label>
                <label><input type="radio" name="todoNotifyEnable" value="on" onchange="toggleTodoTime(true)"> オン</label>
              </div>
            </div>

            <div id="todoTimeSettings" style="display:none; margin-top: 12px;">
              <label>通知時刻</label>
              <input type="time" id="todoNotifyTime" value="09:00" style="margin-bottom:12px;">

              <label>通知する曜日</label>
              <div class="day-selector">
                <label><input type="checkbox" class="todo-day-checkbox" value="0"> 日</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="1" checked> 月</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="2" checked> 火</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="3" checked> 水</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="4" checked> 木</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="5" checked> 金</label>
                <label><input type="checkbox" class="todo-day-checkbox" value="6"> 土</label>
              </div>
            </div>

            <button type="button" class="btn btn-secondary" onclick="saveTodoSettings()" style="margin-top:16px;">通知設定を保存</button>
          </div>
        </div>
```

---

#### `js.html` — ファイル末尾の `</script>` タグの直前に追加

```javascript
  // =============================================
  // 今日のTODO タブ
  // =============================================

  window.runTodaysTodo = function() {
    showLoading(true, '今日のTODOを収集・生成中...', false);
    google.script.run
      .withSuccessHandler(function(res) {
        showLoading(false);
        const resultEl = document.getElementById('todoResult');
        if (res.success) {
          resultEl.style.display = 'block';
          resultEl.innerHTML = marked.parse(res.message || '');
          Swal.fire({ icon: 'success', title: '送信完了', text: 'SlackにTODOを送信しました！', timer: 2000, showConfirmButton: false });
        } else {
          resultEl.style.display = 'none';
          Swal.fire('エラー', res.message, 'error');
        }
      })
      .withFailureHandler(function(e) {
        showLoading(false);
        Swal.fire('実行エラー', e.message, 'error');
      })
      .sendTodaysTodoNotification();
  };

  window.toggleTodoTime = function(show) {
    document.getElementById('todoTimeSettings').style.display = show ? 'block' : 'none';
  };

  window.saveTodoSettings = function() {
    const enable = document.querySelector('input[name="todoNotifyEnable"]:checked')?.value || 'off';
    const time = document.getElementById('todoNotifyTime').value;
    const days = Array.from(document.querySelectorAll('.todo-day-checkbox:checked')).map(cb => cb.value);

    // saveUserSettings に相乗りして送信
    const data = {
      todoNotifyEnable: enable,
      todoNotifyTime: time,
      todoNotifyDays: days
    };

    showLoading(true, '保存中...', false);
    google.script.run
      .withSuccessHandler(function(res) {
        showLoading(false);
        Swal.fire({ icon: 'success', title: '保存しました', timer: 1500, showConfirmButton: false });
      })
      .withFailureHandler(function(e) {
        showLoading(false);
        Swal.fire('エラー', e.message, 'error');
      })
      .saveTodoSettings(data);
  };

  // 設定読み込み時にTODO設定を反映（既存の applySettingsToForm を流用可能）
  // ページロード後に呼ばれる既存の google.script.run.getUserSettings() の
  // SuccessHandler 内で以下を追加:
  //   if (settings.TODO_NOTIFY_ENABLE === 'on') {
  //     document.querySelector('input[name="todoNotifyEnable"][value="on"]').checked = true;
  //     toggleTodoTime(true);
  //   }
  //   if (settings.TODO_NOTIFY_TIME) document.getElementById('todoNotifyTime').value = settings.TODO_NOTIFY_TIME;
  //   const todoDays = JSON.parse(settings.TODO_NOTIFY_DAYS || '[]');
  //   todoDays.forEach(d => {
  //     const cb = document.querySelector(`.todo-day-checkbox[value="${d}"]`);
  //     if (cb) cb.checked = true;
  //   });
```

---

## 追加が必要な GAS 公開関数

`js.html` から `google.script.run` で呼ぶために、以下の関数を GAS 側（`Services.js` または `Config.js`）に追加する：

```javascript
// Config.js に追加
/**
 * TODO通知設定のみを保存します（「今日のTODO」タブの保存ボタン用）。
 * @param {object} data { todoNotifyEnable, todoNotifyTime, todoNotifyDays }
 */
function saveTodoSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    'TODO_NOTIFY_ENABLE': data.todoNotifyEnable || 'off',
    'TODO_NOTIFY_TIME':   data.todoNotifyEnable === 'on' ? (data.todoNotifyTime || '09:00') : 'off',
    'TODO_NOTIFY_DAYS':   JSON.stringify(data.todoNotifyDays || [])
  }, false);
  updateTodoTrigger_(data.todoNotifyEnable === 'on');
  return { success: true, message: '通知設定を保存しました！' };
}
```

---

## 変更ファイル一覧（サマリ）

| ファイル | 変更内容 |
|---|---|
| `Config.js` | `getOrSetupAppSheet()` に "生ログ" シート初期化を追加、`saveRawLogsToSheet()` 追加、`saveUserSettings()` に TODO 設定保存を追加、`updateTodoTrigger_()` / `planTodaysTodoExecution()` / `saveTodoSettings()` 追加 |
| `Services.js` | `collectLogs()` の戻り値に `sources` 追加、`generatePreviewReport()` に `saveRawLogsToSheet()` 呼び出し追加、`fetchBacklogTodayIssues()` / `collectTodaysTasks()` / `sendTodaysTodoNotification()` / `autoRunTodaysTodo()` 追加 |
| `AI.js` | `DEFAULT_TODO_PROMPT` 定数と `generateTodaysTodoWithGemini()` 追加 |
| `Index.html` | タブボタン追加（`<button data-tab="todo">`）、`<div id="todo">` パネル追加 |
| `js.html` | `runTodaysTodo()` / `toggleTodoTime()` / `saveTodoSettings()` 追加、設定読み込み処理に TODO 設定の反映を追加 |
