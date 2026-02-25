# Codex 実装プロンプト

## 前提確認

このリポジトリは **Google Apps Script (GAS)** のプロジェクトです。
ファイル拡張子は `.js` ですが、GAS 環境で実行されます（`SpreadsheetApp`, `CalendarApp`, `UrlFetchApp`, `ScriptApp`, `PropertiesService`, `Utilities`, `CacheService` などの GAS グローバルオブジェクトを使用しています）。

詳細な設計仕様は **`DESIGN_SPEC.md`** に記載されています。このファイルを必ず参照してください。

---

## タスク

以下の2つの機能を実装してください。詳細なコード例はすべて `DESIGN_SPEC.md` に記載済みです。

---

### 機能① 生ログのスプレッドシート書き込み

**概要**: ユーザーが日報をプレビューするたびに、AI要約前の生ログ（Calendar / Slack / Gmail / Backlog / Salesforce 別）を既存のスプレッドシートの新シート「生ログ」に自動保存する。

**変更対象ファイル**:

#### `Config.js`

1. **`getOrSetupAppSheet()` 関数の修正**
   - 場所: 行 72〜86（`if (!id) { ... }` ブロック）
   - `hSheet.setFrozenRows(1);` の直後に "生ログ" シートの初期化コードを追加する
   - 追加内容は `DESIGN_SPEC.md` の「変更①: `getOrSetupAppSheet()`」を参照

2. **`saveRawLogsToSheet()` 関数の新規追加**
   - 場所: 行 314（`saveToPrivateHistory()` 関数の直前）
   - `DESIGN_SPEC.md` の「変更②: `saveRawLogsToSheet()` 新規追加」のコードをそのまま追加する

#### `Services.js`

3. **`collectLogs()` 関数の修正**
   - 場所: 行 288〜403
   - `sources` オブジェクトをローカル変数として宣言し、各ソース取得ブロック（Calendar / Slack / Gmail / Backlog / Salesforce）でそれぞれのテキストを格納する
   - 戻り値（行 403）に `sources` を追加する
   - 変更内容は `DESIGN_SPEC.md` の「変更①: `collectLogs()` 修正」を参照

4. **`generatePreviewReport()` 関数の修正**
   - 場所: 行 109〜151
   - `collectLogs()` 呼び出し（行 122）の直後に `saveRawLogsToSheet(logData.sources, targetDate)` を try-catch で呼び出すコードを追加する
   - 変更内容は `DESIGN_SPEC.md` の「変更②: `generatePreviewReport()` 修正」を参照

---

### 機能② 今日のTODO Slack通知

**概要**: Backlog の未完了課題と Google Calendar の当日予定を収集し、Gemini がTODOリストを生成して Slack に投稿する機能を追加する。毎朝の定時通知（スケジューラ）と、UIボタンからのオンデマンド実行の両方を実装する。

**変更対象ファイル**:

#### `Services.js`

5. **新規関数の追加**
   - 場所: `collectLogs()` の終わり（行 403〜404）の直後
   - `fetchBacklogTodayIssues()`, `collectTodaysTasks()`, `sendTodaysTodoNotification()`, `autoRunTodaysTodo()` の4つを追加する
   - 各関数のコードは `DESIGN_SPEC.md` の「変更箇所: Services.js — 新規関数」を参照

#### `AI.js`

6. **新規追加（ファイル末尾）**
   - `DEFAULT_TODO_PROMPT` 定数と `generateTodaysTodoWithGemini()` 関数をファイル末尾に追加する
   - コードは `DESIGN_SPEC.md` の「変更箇所: AI.js」を参照

#### `Config.js`

7. **`saveUserSettings()` 関数の修正**
   - 場所: 行 24〜57
   - `updateTrigger_(isEnable);` の呼び出し（行 54）の直後に、TODO通知設定の保存と `updateTodoTrigger_()` の呼び出しを追加する
   - 変更内容は `DESIGN_SPEC.md` の「変更①: `saveUserSettings()` 修正」を参照

8. **新規関数の追加**
   - 場所: `isHoliday()` 関数（行 304〜312）の直後
   - `updateTodoTrigger_()`, `planTodaysTodoExecution()`, `saveTodoSettings()` の3つを追加する
   - コードは `DESIGN_SPEC.md` の「変更②: 新規関数追加」を参照

#### `Index.html`

9. **タブボタンの追加**
   - 場所: 行 52（`プロンプト` タブボタンの行）の直後
   - `<button class="tab-btn" data-tab="todo" onclick="switchTab('todo', event)">今日のTODO</button>` を追加する

10. **新タブパネルの追加**
    - 場所: `</div> <!-- /prompts -->` の直後（行 237）、`<? } ?>` の前（行 239）
    - `<div id="todo" class="content">...</div>` を追加する
    - コードは `DESIGN_SPEC.md` の「変更②: 新タブパネル追加」を参照

#### `js.html`

11. **新規関数の追加（ファイル末尾の `</script>` 直前）**
    - `runTodaysTodo()`, `toggleTodoTime()`, `saveTodoSettings()` の3関数を追加する
    - コードは `DESIGN_SPEC.md` の「js.html — ファイル末尾」を参照

12. **設定読み込み処理の修正**
    - `google.script.run.getUserSettings()` の SuccessHandler 内に、TODO通知設定（`TODO_NOTIFY_ENABLE` / `TODO_NOTIFY_TIME` / `TODO_NOTIFY_DAYS`）をフォームに反映するコードを追加する
    - 反映する内容は `DESIGN_SPEC.md` のコメント部分を参照

---

## 実装時の注意点

1. **GAS の `Utilities.formatDate` を使用**: JavaScript 標準の `Date` メソッドではタイムゾーンが狂う。日付フォーマットは必ず `Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm:ss')` を使うこと

2. **既存コードへの影響を最小限に**: `collectLogs()` の戻り値に `sources` を追加するだけで、既存の `text` / `counts` / `teamSpiritData` は変更しない。`generatePreviewReport()` の既存ロジックも変えない

3. **エラーを握りつぶす設計**: 生ログ保存（`saveRawLogsToSheet`）は try-catch で囲み、失敗しても日報生成本処理を止めない。同様に TODO 収集の各ブロックも try-catch で囲む

4. **重複トリガーの防止**: `updateTodoTrigger_()` は既存の `updateTrigger_()` と同じパターンで実装する。既存のトリガーを確認して削除してから新規作成する

5. **`sendToSlack()` の再利用**: `sendTodaysTodoNotification()` 内の Slack 投稿は、既存の `sendToSlack()` 関数を呼ぶ。新たな Slack API 呼び出しは書かない

6. **`callVertexAI()` の再利用**: `generateTodaysTodoWithGemini()` は既存の `callVertexAI()` を呼ぶ

7. **UIの整合性**: `Index.html` の `<div id="todo">` 内のクラス名（`group`, `btn`, `btn-primary`, `btn-secondary`, `markdown-body` など）は既存タブのコードから同じものを使うこと

8. **`DESIGN_SPEC.md` が最優先**: コードの細部（変数名、API URLパラメータなど）は設計書に記載したものをそのまま使うこと

---

## 検証方法

実装完了後、以下で動作確認できます（GAS エディタで実行）：

### 機能① 確認手順
1. GAS Web App を開き、日報プレビューを実行
2. `📂 AI日報_管理データ` スプレッドシートを開く
3. 「生ログ」タブが存在し、1行データが追加されていることを確認
4. C〜G列にソース別テキストが入っていることを確認

### 機能② 確認手順
1. 「今日のTODO」タブが表示されることを確認
2. 「今日のTODOをSlackに送る」ボタンをクリック → Slack に投稿されることを確認
3. 通知設定を「オン」にして保存 → GAS トリガー管理画面に `planTodaysTodoExecution` トリガーが作成されることを確認
