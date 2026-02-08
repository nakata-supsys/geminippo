# コードレビュー：AI日報アシスタント (geminippo-gas)

## 1. 全体構成・アーキテクチャ

- **GAS Webアプリ**として、`doGet` → 認証/ログアウト/メイン表示の振り分けが明確です。
- **責務の分離**ができています。
  - `Code.gs`: エントリ・メインUI表示・ログアウト
  - `Config.js`: 設定保存・スプレッドシート・トリガー・プロンプト
  - `Services.js`: Slack / Calendar / Gmail / Backlog / Vertex AI 呼び出し
  - `AI.js`: プロンプト定義と Gemini 生成ロジック
- フロントは `Index.html` + `js.html` + `css.html` で、SweetAlert2 / Chart.js / marked / tippy を利用したUIになっています。

---

## 2. 良い点

- **JSDoc** が主要関数に付いており、役割が分かりやすい。
- **Vertex AI のエラーハンドリング**（`callVertexAI`）が 400 / 403 / 429 / 5xx ごとにユーザー向けメッセージを返しており、運用しやすい。
- **日報の下書き**を `localStorage` で保存・復元しており、離脱時の UX が良い。
- **処理のキャンセル**（`processId`）で、連打や二重実行を防いでいる。
- **未保存インジケーター**（ボタンに `*`）で、設定の保存忘れを防いでいる。
- **初回セットアップのガイド**（`?setup=true`）とヘルプで、オンボーディングが整っている。
- **ログ長の上限**（10万文字）で、API や UI の負荷を抑えている。
- **Slack 認証エラー時**に `doLogout()` して再ログインを促す設計になっている。

---

## 3. 要修正（バグ・不具合）

### 3.1 工数集計の「AIに修正を指示」が効いていない（重要）

- **場所**: `js.html` の `doAggregation` と `refineAggregation`。
- **事象**:  
  - サーバー `runPeriodAggregation(start, end, modelType, projectListStr, avgWorkHours, instruction)` は第6引数で `instruction` を受け取る。  
  - クライアントの `doAggregation(start, end, modelType, projectList)` は第5引数を持たず、`instruction` を渡していない。  
  - そのため「AIに修正を指示」で入力した指示がサーバーに届いていません。
- **修正案**:  
  - `doAggregation(start, end, modelType, projectList, instruction)` のように第5引数を追加する。  
  - 内部で `runPeriodAggregation(..., document.getElementById('avgWorkHours').value, instruction || null)` のように、`avgWorkHours` と `instruction` の両方を正しい順で渡す。

### 3.2 工数集計の「AIに修正を指示」ボタンが常に無効扱いになる

- **場所**: `js.html` の `refineAggregation`。
- **事象**: `refineAggregation` は `window.lastAggJson` の有無で「先に工数集計を実行してください」を出しているが、`renderAggResult` では `window.lastAggText` しか設定しておらず、`lastAggJson` は一度もセットされない。  
  そのため、1回集計した直後でも「データなし」と判定される可能性がある。
- **修正案**:  
  - `renderAggResult` 内で、JSON をパースした結果（例: `chartData`）を `window.lastAggJson = chartData` のようにセットする。  
  - もしくは、判定を `lastAggText || lastAggJson` のように「日別テキストがあればOK」に変更する。

---

## 4. 改善推奨（保守性・運用）

### 4.1 設定値のハードコード（Config.js）

- `PROJECT_ID` と `LOCATION` がソースに直書きされています。環境ごとに変えたい場合に不便です。
- **提案**: `PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID')` などで取得し、未設定時だけフォールバックで現在の値を使うようにする。

### 4.2 利用状況ログ用スプレッドシート（Services.js）

- `LOG_SHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'` のままでは `logUserActivity` は何もしません。
- **提案**:  
  - 本番で使う場合は README やコメントで「ここを設定すること」を明記する。  
  - あるいは、未設定のときに一度だけ `console.warn` で注意を出すと、デバッグ時に気づきやすい。

### 4.3 関数の引数名が短すぎる（AI.js）

- `generateReportWithGemini(l, modelType, prompts, m, d, f, h, df, instruction)` のように `l`, `m`, `d` などが多く、可読性が落ちています。
- **提案**:  
  - `logText`, `reportMode`, `targetDate`, `reflection`, `manhour`, `dayFormat` など、意味が分かる名前にする。

### 4.4 重複している定数（AI.js）

- `safetySettings` や `generationConfig` が `generateReportWithGemini` と `generateAggregationWithGemini` / `callVertexAI` 周辺で重複しています。
- **提案**: 共通の定数オブジェクトやヘルパー関数にまとめ、変更箇所を一か所にする。

### 4.5 日付のタイムゾーン表記（Services.js）

- `collectPeriodLogsParallel` 内で `Utilities.formatDate(d, 'JST', ...)` と `'JST'` が使われています。GAS では `'Asia/Tokyo'` の方が一般的です。
- **提案**: 他ファイル（`getFormattedDateString` など）と揃えて `'Asia/Tokyo'` に統一する。

### 4.6 トリガー更新時の曜日情報（Config.js）

- `updateTrigger_` は「毎日1回・指定時刻」のみで、**曜日**（`REPORT_SCHEDULE_DAYS`）や祝日スキップはトリガーではなく `autoRunDailyReport` 内で判定しています。  
  現状の `timeBased().everyDays(1)` では、実行は毎日発生し、中身で曜日と祝日を見ているので仕様としては問題ありませんが、トリガーを「月〜金だけ」などにしたい場合は GAS の制約上、複数トリガーや別の設計が必要です。  
  コメントで「曜日・祝日はハンドラ内で判定している」と書いておくと、後から読みやすいです。

---

## 5. セキュリティ・堅牢性

- **Slack Client ID / Secret**: スクリプトプロパティで管理されており問題ありません。
- **Backlog API キー**: ユーザープロパティに保存。ログやエラーメッセージに含めないよう注意する必要はありますが、現状の実装で大きな問題は見当たりません。
- **XSS**: `checkIgnoreIds` の結果を `Swal.fire({ html: ... })` で表示する際、サーバーから返す `message` に HTML が含まれると XSS になり得ます。  
  **提案**: サーバー側で表示用のメッセージをエスケープするか、クライアントで `textContent` ベースで表示する。

---

## 6. その他

- **Code.gs**: `handleAuthCallback` は `Services.js` にあり、GAS では同一プロジェクトの .gs がまとめて実行されるため問題ありません。  
  エントリの流れ（認証 → ログアウト → メイン）を把握しやすくするため、`Code.gs` の先頭に「認証は Services.js の handleAuthCallback を参照」のようなコメントがあると親切です。
- **result.html**: ログアウト完了や認証エラー時の結果表示として、リダイレクトとプログレスバーで分かりやすいです。

---

## 7. まとめ

- 全体として**構成が分かりやすく、エラーハンドリングや UX もよく考えられています**。
- **必ず直したい点**は次の2つです。  
  1. 工数集計の「AIに修正を指示」で `instruction` をサーバーに渡す（`doAggregation` の引数と `runPeriodAggregation` の呼び出しを修正）。  
  2. 「AIに修正を指示」の有効判定を `lastAggJson` / `lastAggText` のどちらで行うか決め、その変数を確実にセットする。
- 上記を直したうえで、設定値の外部化・引数名の明確化・定数整理・XSS 対策を進めると、保守性と安全性がさらに上がります。
