# GemiNippo GAS リリース前レビューレポート

**レビュー日**: 2026-02-13
**対象ファイル**: `Code.gs`, `Config.js`, `AI.js`, `Services.js`, `Index.html`, `js.html`, `result.html`

---

## サマリ

| 重要度 | 件数 | 概要 |
|--------|------|------|
| CRITICAL | 4件 | 本番クラッシュに直結。デプロイ前に必ず修正 |
| HIGH | 3件 | エラーやデータ不整合を引き起こす |
| MEDIUM | 3件 | 特定条件で問題が発生 |

---

## CRITICAL（本番クラッシュ直結）

### 1. `isHoliday()` — null ポインタクラッシュ

**ファイル**: `Config.js` 241-244行目

**問題**: `CalendarApp.getCalendarById(calId)` は、カレンダーが見つからない場合に `null` を返す。`null.getEventsForDay()` で即 TypeError。日本の祝日カレンダー (`ja.japanese#holiday@group.v.calendar.google.com`) にアクセスできない環境（海外 Google アカウント等）で発生する。

**影響**: スケジュール実行時 (`autoRunDailyReport`) にクラッシュし、日報が生成されない。

**現在のコード**:
```javascript
function isHoliday(date) {
  const calId = 'ja.japanese#holiday@group.v.calendar.google.com';
  const events = CalendarApp.getCalendarById(calId).getEventsForDay(date);
  return events.length > 0;
}
```

**改善案**:
```javascript
function isHoliday(date) {
  const calId = 'ja.japanese#holiday@group.v.calendar.google.com';
  const cal = CalendarApp.getCalendarById(calId);
  if (!cal) {
    console.warn('祝日カレンダーが取得できません。祝日スキップは無効として処理します。');
    return false;
  }
  return cal.getEventsForDay(date).length > 0;
}
```

---

### 2. `sendToSlack()` — undefined.match() クラッシュ

**ファイル**: `Services.js` 658-661行目

**問題**: Slack投稿スタイルが `"fixed_thread"` の場合、引数 `f`（= `props.REPORT_FIXED_THREAD_URL`）を `.match()` する。このプロパティが一度も保存されていない場合、`f` は `undefined` となり、`undefined.match(...)` で TypeError が発生する。

**影響**: 日報の送信が失敗する。

**現在のコード**:
```javascript
} else if (s === "fixed_thread") {
    let ts = null; const matchP = f.match(/\/p(\d{10})(\d{6})/);
```

**改善案**:
```javascript
} else if (s === "fixed_thread") {
    let ts = null;
    if (f) {
      const matchP = f.match(/\/p(\d{10})(\d{6})/);
      if (matchP) ts = `${matchP[1]}.${matchP[2]}`;
      else { const matchTs = f.match(/thread_ts=(\d+\.\d+)/); if (matchTs) ts = matchTs[1]; }
    }
    if (ts) payload.thread_ts = ts; else console.warn("固定スレッドURLが未設定または解析に失敗");
}
```

---

### 3. `callVertexAI()` — parts 配列の空チェック欠落

**ファイル**: `AI.js` 448-452行目

**問題**: Vertex AI のレスポンスから `json.candidates[0].content.parts[0].text` を取得しているが、`parts` が空配列 `[]` の場合、`parts[0]` は `undefined` となり、`.text` アクセスで TypeError が発生する。

**影響**: AI日報生成が失敗する。

**現在のコード**:
```javascript
if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
     throw new Error("AIからの応答が空でした。");
}
return json.candidates[0].content.parts[0].text;
```

**改善案**:
```javascript
if (!json.candidates || !json.candidates[0] || !json.candidates[0].content
    || !json.candidates[0].content.parts || json.candidates[0].content.parts.length === 0) {
     throw new Error("AIからの応答が空でした。");
}
return json.candidates[0].content.parts[0].text;
```

---

### 4. 重複トリガー作成 — 日報が複数回送信される

**ファイル**: `Config.js` 171-231行目

**問題**: `updateTrigger_()` の末尾（199行目）で `planTodaysExecution()` を即時呼び出している。`planTodaysExecution()` は呼ばれるたびに `autoRunDailyReport` の 1 回限りトリガーを新規作成する。ユーザーが設定を複数回保存すると、同じ時刻のトリガーが重複し、日報が複数回送信される。

**影響**: Slack に同じ日報が 2通、3通と送信される。

**現在のコード**:
```javascript
// updateTrigger_ の末尾
if (isEnable) {
    if (!plannerTriggerExists) { /* ... */ }
    planTodaysExecution(); // ← これが毎回トリガーを作る
}
```

**改善案**:
```javascript
function planTodaysExecution() {
  const userProps = PropertiesService.getUserProperties();
  const props = userProps.getProperties();
  const scheduleTime = props.REPORT_SCHEDULE_TIME;

  if (!scheduleTime || scheduleTime === 'off') return;

  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  const targetDays = JSON.parse(props.REPORT_SCHEDULE_DAYS || "[]");

  if (!targetDays.includes(dayOfWeek)) return;
  if (props.REPORT_SKIP_HOLIDAYS === 'true' && isHoliday(today)) return;

  // ★修正: 既存の autoRunDailyReport トリガーを削除してから作成する
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRunDailyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const [hour, minute] = scheduleTime.split(':');
  const executionDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hour, 10), parseInt(minute, 10));

  if (executionDate > new Date()) {
    ScriptApp.newTrigger('autoRunDailyReport')
      .timeBased()
      .at(executionDate)
      .create();
  }
}
```

---

## HIGH（エラーまたはデータ不整合）

### 5. `fetchMultiBacklogActivities()` — muteHttpExceptions 未設定

**ファイル**: `Services.js` 482-493行目

**問題**: Backlog API への 2 つの `UrlFetchApp.fetch` 呼び出しに `muteHttpExceptions: true` が設定されていない。API が非 200 ステータスを返した場合（APIキー失効、レート制限等）、GAS が例外を投げるが、空の `catch(e){}` で握り潰され、デバッグが不可能になる。

**改善案**:
```javascript
function fetchMultiBacklogActivities(c, d) {
  let acts = [];
  c.forEach(conf => {
    try {
      const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const userRes = UrlFetchApp.fetch(`https://${h}/api/v2/users/myself?apiKey=${conf.key}`, { muteHttpExceptions: true });
      if (userRes.getResponseCode() !== 200) {
        console.warn(`Backlog user API error (${h}): ${userRes.getResponseCode()}`);
        return;
      }
      const u = JSON.parse(userRes.getContentText()).id;
      const actRes = UrlFetchApp.fetch(`https://${h}/api/v2/users/${u}/activities?apiKey=${conf.key}`, { muteHttpExceptions: true });
      if (actRes.getResponseCode() !== 200) {
        console.warn(`Backlog activities API error (${h}): ${actRes.getResponseCode()}`);
        return;
      }
      const res = JSON.parse(actRes.getContentText());
      const ts = new Date(d); ts.setHours(0,0,0,0);
      const te = new Date(d); te.setHours(23,59,59,999);
      res.filter(a => { const ad = new Date(a.created); return ad >= ts && ad < te; })
         .forEach(a => acts.push(`[Backlog] ${a.project.projectKey} ${a.content.summary || '更新'}`));
    } catch(e) {
      console.warn(`Backlog fetch error for ${conf.host}: ${e.message}`);
    }
  });
  return acts;
}
```

---

### 6. `collectLogs()` — Gmail 権限チェックが機能しない

**ファイル**: `Services.js` 190-195行目

**問題**: Gmail のエラーメッセージに日本語文字列 (`"Gmailへのアクセス権限がありません"`) が含まれるかチェックしているが、GAS の実際の権限エラーメッセージは英語（例: `"Exception: You do not have permission to call GmailApp.search"`）。このチェックは常に `false` となり、Gmail 権限エラーは `console.warn` で無視される。

**改善案**:
```javascript
} catch(e) {
  if (e.message.includes('permission') || e.message.includes('Permission')
      || e.message.includes('権限')) {
    throw new Error("Gmailへのアクセス権限がありません。Googleアカウントの権限設定を確認してください。\n(元のエラー: " + e.message + ")");
  }
  console.warn("Gmail error:", e);
}
```

---

### 7. Index.html — PROJECT_LIST の二重 HTML エスケープ

**ファイル**: `Index.html` 163行目

**問題**: `<?= ?>` テンプレートタグは自動的に HTML エスケープを行う。さらに `escapeHtml()` 関数を手動で呼んでいるため、二重エスケープが発生する。例: `A&B` → `A&amp;amp;B` と表示される。

**現在のコード**:
```html
<textarea id="projectList" ...><?= props.PROJECT_LIST ? escapeHtml(props.PROJECT_LIST) : '' ?></textarea>
```

**改善案**:
```html
<textarea id="projectList" ...><?= props.PROJECT_LIST || '' ?></textarea>
```

`<?= ?>` が自動でエスケープするため、`escapeHtml()` の追加呼び出しは不要。

---

## MEDIUM（特定条件で問題発生）

### 8. `autoRunDailyReport()` — 未使用変数

**ファイル**: `Config.js` 234-239行目

**問題**: `props` と `dayOfWeek` を取得しているが、どこにも使用されていない。不要なAPIコール（`PropertiesService`）が発生する。

**現在のコード**:
```javascript
function autoRunDailyReport() {
  const props = PropertiesService.getUserProperties().getProperties();
  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  runDailyReportAndArchive();
}
```

**改善案**:
```javascript
function autoRunDailyReport() {
  runDailyReportAndArchive();
}
```

---

### 9. `generateReportWithGemini()` — replace() が最初の 1 箇所のみ

**ファイル**: `AI.js` 293行目

**問題**: JavaScript の `String.replace()` は正規表現でない場合、最初の 1 箇所のみ置換する。プロンプト内に `{{DATE}}` や `{{LOGS}}` が複数出現する場合、2 箇所目以降は置換されない。現在のデフォルトプロンプトでは各 1 箇所しかないため問題ないが、ユーザーがプロンプトをカスタマイズした際に発生しうる。

**現在のコード**:
```javascript
const promptText = p.replace('{{DATE}}', getFormattedDateString(...)).replace('{{LOGS}}', logText);
```

**改善案**:
```javascript
const promptText = p.replaceAll('{{DATE}}', getFormattedDateString(...)).replaceAll('{{LOGS}}', logText);
```

> **注**: `replaceAll` は GAS の V8 ランタイムで使用可能。

---

### 10. `callVertexAI()` — MAX_TOKENS finishReason 未処理

**ファイル**: `AI.js` 441-446行目

**問題**: `finishReason` が `'SAFETY'` の場合のみ処理しているが、`'MAX_TOKENS'` の場合は出力が途中で切れている可能性がある。ユーザーに知らせずにそのまま返すと、日報が途中で終わった状態で送信されるリスクがある。

**現在のコード**:
```javascript
if (json.candidates[0].finishReason === 'SAFETY') {
    return "⚠️ 【警告】AIの安全フィルターにより、生成が中断されました。";
}
```

**改善案**:
```javascript
const finishReason = json.candidates[0].finishReason;
if (finishReason === 'SAFETY') {
    return "⚠️ 【警告】AIの安全フィルターにより、生成が中断されました。";
}
if (finishReason === 'MAX_TOKENS') {
    console.warn("Gemini output was truncated due to MAX_TOKENS limit.");
    // テキスト自体は返すが、末尾に警告を追記
    const text = json.candidates[0].content.parts[0].text;
    return text + "\n\n⚠️ 【注意】AIの出力が長さ制限により途中で切れている可能性があります。";
}
```

---

## 修正優先度ガイド

| 順序 | 問題 # | 修正工数 | 理由 |
|------|--------|----------|------|
| 1 | #1 `isHoliday` | 3行 | null クラッシュ。スケジュール実行が全停止 |
| 2 | #2 `sendToSlack` | 5行 | undefined クラッシュ。日報送信が失敗 |
| 3 | #4 重複トリガー | 8行 | 日報二重送信。ユーザー信頼に関わる |
| 4 | #3 `callVertexAI` | 2行 | AI レスポンス異常時にクラッシュ |
| 5 | #7 二重エスケープ | 1行 | 表示バグ。`&` を含むプロジェクト名で発生 |
| 6 | #5 Backlog mute | 10行 | デバッグ不能な状態を解消 |
| 7 | #6 Gmail 権限 | 3行 | 権限エラーのサイレント無視を解消 |
| 8 | #10 MAX_TOKENS | 5行 | 出力切れの検知 |
| 9 | #9 replaceAll | 1行 | 将来的な問題の予防 |
| 10 | #8 未使用変数 | 3行削除 | コード品質 |
