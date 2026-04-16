# CODEX実装依頼プロンプト：セキュリティ・堅牢性の修正

```
以下のGoogle Apps Script（GAS）プロジェクトのセキュリティ上の問題と堅牢性の問題を修正してください。

# 対象プロジェクト
geminippo-gas（Slackへの日報を自動生成するGASアプリ）

# 対象ファイル
- Code.gs
- Services.js

---

# 修正1：Slackエラーコードの直接露出を防ぐ（Code.gs）

## 問題
`doGet()` 関数内のSlack OAuthコールバック処理で、ホワイトリスト以外のエラーコードをメッセージにそのまま連結している。
`invalid_auth` 等のSlack内部エラーコードがユーザーに表示される。

## 対象箇所
`doGet()` 関数内の以下の行：
```js
const message = errorMessages[e.parameter.error] || 'Slack認証でエラーが発生しました: ' + e.parameter.error;
```

## 修正内容
```js
// 変更後
const message = errorMessages[e.parameter.error] || 'Slack認証でエラーが発生しました。もう一度お試しください。';
```

`e.parameter.error` を直接メッセージに含めないこと。

---

# 修正2：ハードコードされたスプレッドシートIDをScriptPropertiesに移行（Services.js）

## 問題
`LOG_SHEET_ID` がソースコードに直接ハードコードされており、リポジトリ履歴に残る。

## 対象箇所
Services.js の先頭付近（約11行目）：
```js
const LOG_SHEET_ID = '1BZIPxlW1ZYYQU66z3yCIZeT9kwJb8sFs8BoMHVYkDUk';
```

## 修正内容
```js
// 変更後（ScriptPropertiesから取得し、未設定の場合は既存値にフォールバック）
const LOG_SHEET_ID = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID')
  || '1BZIPxlW1ZYYQU66z3yCIZeT9kwJb8sFs8BoMHVYkDUk';
```

---

# 修正3：UrlFetchApp にタイムアウトと例外抑制を追加（Services.js）

## 問題
外部APIへの `UrlFetchApp.fetch()` 呼び出しにタイムアウトが設定されておらず、
APIがハングした場合にGASの6分の実行制限を消費してしまう。
また `muteHttpExceptions: true` がない箇所は、HTTPエラー時に未処理の例外が発生する。

## 対象
Services.js 内の以下のAPIへの fetch 呼び出し（該当する全箇所）：
- Slack API（`https://slack.com/api/...`）
- Backlog API（`https://${host}/api/v2/...`）
- Vertex AI / Gemini API（`https://...aiplatform.googleapis.com/...` または `generativelanguage.googleapis.com`）

## 修正内容
各 `UrlFetchApp.fetch(url, options)` の `options` オブジェクトに以下を追加：

```js
// 既存の options への追加例
const options = {
  method: 'get',           // 既存
  headers: { ... },        // 既存
  muteHttpExceptions: true, // ← 追加（HTTPエラーを例外ではなくレスポンスとして受け取る）
};
```

注意：
- `muteHttpExceptions: true` を追加したら、呼び出し後に `response.getResponseCode()` でHTTPステータスを確認して200以外はエラー処理すること
- すでに `muteHttpExceptions: true` が設定されている箇所は変更不要
- 既存のエラーハンドリングロジックを破壊しないこと

---

# 修正4：XFrameOptionsを制限する（Code.gs）

## 問題
`doGet()` のレスポンスに `setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` が設定されており、
任意のドメインからiframeで埋め込み可能になっている。

## 対象箇所
`doGet()` 関数内：
```js
.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
```

## 修正内容
```js
// 変更後
.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
```

---

# 注意事項
- 修正3は影響範囲が広いため、既存のエラーハンドリング（throw文、try-catch、エラーメッセージ返却）を壊さないよう慎重に変更すること
- 修正2のフォールバック値（既存のスプレッドシートID）はそのまま残すこと（後方互換のため）
- 上記4点以外の変更はしないこと
```
