# 実装サマリー: Salesforce連携 & 部署別プロンプト機能

## 📝 概要

このドキュメントは、GemiNippoへのSalesforce連携と部署別プロンプト機能追加の実装概要をまとめたものです。

---

## 🎯 実装する機能

### 1. Salesforce連携（オプション機能）
- **OAuth 2.0認証**: ユーザーごとにSalesforceアカウントと連携
- **TeamSpirit打刻情報取得**: 実労働時間を取得し、工数算出の精度を向上
- **商談履歴取得**: 営業部向けに商談情報と活動履歴を自動取得

### 2. 部署別プロンプト機能
- **部署選択UI**: CS部/ES部を選択可能
- **部署別プロンプト管理**: 部署ごとに異なるプロンプトテンプレートを管理
- **ES部向けプロンプト**: 営業活動に特化した日報フォーマット

---

## 📂 新規ファイル

### SalesforceService.js
Salesforce連携の全機能を実装

**主要関数**:
- `getSalesforceAuthUrl()`: OAuth認証URL生成
- `handleSalesforceCallback(e)`: 認証コールバック処理
- `refreshSalesforceToken()`: トークンリフレッシュ
- `callSalesforceAPI(endpoint)`: REST API呼び出し
- `fetchTeamSpiritWorkTime(targetDate)`: 打刻情報取得
- `fetchOpportunities(targetDate)`: 商談履歴取得
- `fetchOpportunityTasks(targetDate)`: 活動履歴取得
- `testSalesforceConnection()`: 接続テスト
- `disconnectSalesforce()`: 連携解除

---

## 🔧 変更ファイル

### 1. Config.js

**追加関数**:
```javascript
getDepartmentPrompts(department)      // 部署別プロンプト取得
saveDepartmentPrompts(department, data) // 部署別プロンプト保存
getDefaultPromptsForDepartment(department) // デフォルトプロンプト取得
```

**変更点**:
- 既存の`getPromptSettings()`は`getDepartmentPrompts('CS')`を呼び出すように変更（後方互換性維持）

### 2. Services.js

**変更関数**:
```javascript
// 部署パラメータを追加
generatePreviewReport(instruction, dateStr, department)

// Salesforce連携とTeamSpiritデータを追加
collectLogs(props, targetDate, department)
```

**追加処理**:
- Salesforce連携時のログ収集
- TeamSpirit打刻情報の取得
- ES部選択時の商談履歴取得

### 3. AI.js

**変更関数**:
```javascript
// 部署パラメータとTeamSpiritデータを追加
generateReportWithGemini(logText, modelType, department, prompts, reportMode, targetDate, reflection, manhour, dayFormat, instruction, teamSpiritData)
```

**追加関数**:
```javascript
calculateManhourConstraint(teamSpiritData, targetDate) // 工数制約生成
getDefaultPromptsES() // ES部向けデフォルトプロンプト
```

### 4. Code.gs

**変更関数**:
```javascript
doGet(e) // Salesforceコールバック対応を追加
```

**追加処理**:
```javascript
if (e.parameter.sf_code && e.parameter.sf_state) {
  return handleSalesforceCallback(e);
}
```

### 5. Index.html

**追加UI**:
1. **手動実行タブ**: 部署選択ドロップダウン
2. **接続設定タブ**: Salesforce連携設定UI
3. **連携ステータスバー**: Salesforceステータス表示
4. **プロンプトタブ**: 部署切り替えタブ

### 6. js.html (JavaScript)

**追加関数**:
```javascript
loadDepartmentSelection()        // 部署選択の復元
saveDepartmentSelection()        // 部署選択の保存
connectSalesforce()              // Salesforce連携開始
testSalesforce()                 // 接続テスト
disconnectSalesforce()           // 連携解除
switchDepartmentPrompt(dept)     // プロンプト部署切り替え
loadDepartmentPrompts(dept)      // 部署別プロンプト読み込み
```

**変更関数**:
```javascript
validateAndRun() // 部署パラメータを追加
savePrompts()    // 部署別保存に対応
```

---

## 💾 データ構造

### UserProperties（追加項目）

```javascript
// Salesforce連携
SF_INSTANCE_URL: "https://yourcompany.my.salesforce.com"
SF_ACCESS_TOKEN: "00D..."
SF_REFRESH_TOKEN: "5Aep..."
SF_USER_ID: "005..."
SF_TOKEN_EXPIRES_AT: "2026-02-14T10:00:00Z"

// 部署選択
SELECTED_DEPARTMENT: "CS" // 最後に選択した部署
```

### ScriptProperties（追加項目）

```javascript
SF_CLIENT_ID: "Salesforce Connected AppのConsumer Key"
SF_CLIENT_SECRET: "Salesforce Connected AppのConsumer Secret"
```

### Spreadsheet（新規シート）

```
プロンプト_CS  // 既存の「プロンプト」シートをリネーム
プロンプト_ES  // 新規作成
```

---

## 🔄 データフロー

### 日報生成フロー（Salesforce連携時）

```
1. ユーザーが部署を選択（CS/ES）
2. 日報作成ボタン押下
3. generatePreviewReport(instruction, dateStr, department) 呼び出し
4. collectLogs(props, targetDate, department) でログ収集
   ├─ Calendar, Slack, Gmail, Backlog（既存）
   └─ Salesforce（新規）
      ├─ TeamSpirit打刻情報（全部署）
      └─ 商談履歴（ES部のみ）
5. getDepartmentPrompts(department) でプロンプト取得
6. generateReportWithGemini(...) でAI生成
   └─ TeamSpiritデータから工数制約を生成
7. プレビュー表示
```

### Salesforce OAuth認証フロー

```
1. ユーザーが「Salesforceと連携」ボタン押下
2. getSalesforceAuthUrl() で認証URL生成
3. Salesforce認証画面を新しいタブで開く
4. ユーザーがログイン・承認
5. Salesforceがコールバック（sf_code, sf_stateパラメータ付き）
6. handleSalesforceCallback(e) でトークン交換
7. UserPropertiesにトークン保存
8. 連携完了画面表示
```

---

## 🧪 テスト項目

### Phase 1: Salesforce連携基盤
- [ ] OAuth認証が正常に完了する
- [ ] トークンが正しく保存される
- [ ] トークンリフレッシュが動作する
- [ ] 接続テストが成功する
- [ ] 連携解除が正常に動作する

### Phase 2: TeamSpirit連携
- [ ] 当日の打刻情報が取得できる
- [ ] 過去日の実労働時間が取得できる
- [ ] 工数制約が正しく生成される
- [ ] 打刻情報がない場合のエラーハンドリング

### Phase 3: 商談履歴連携
- [ ] 商談データが取得できる
- [ ] 活動履歴が取得できる
- [ ] ES部選択時のみ取得される
- [ ] データがログに正しく統合される

### Phase 4: 部署別プロンプト
- [ ] CS部のプロンプトが保存・取得できる
- [ ] ES部のプロンプトが保存・取得できる
- [ ] 部署切り替えが正常に動作する
- [ ] デフォルトに戻す機能が動作する

### Phase 5: 統合テスト
- [ ] CS部でSalesforce連携なしで動作する
- [ ] CS部でSalesforce連携ありで動作する
- [ ] ES部でSalesforce連携なしで動作する
- [ ] ES部でSalesforce連携ありで動作する
- [ ] 既存機能が正常に動作する（後方互換性）

---

## 📋 実装チェックリスト

### 準備
- [ ] Salesforce環境でConnected Appを作成
- [ ] Consumer Key/Secretを取得
- [ ] ScriptPropertiesに設定

### Phase 1: Salesforce連携基盤
- [ ] SalesforceService.js作成
- [ ] OAuth認証フロー実装
- [ ] トークン管理実装
- [ ] REST API基盤実装
- [ ] Code.gsにコールバック処理追加
- [ ] Index.htmlに連携UI追加
- [ ] js.htmlに連携関数追加

### Phase 2: TeamSpirit連携
- [ ] fetchTeamSpiritWorkTime実装
- [ ] Services.jsのcollectLogs変更
- [ ] AI.jsのcalculateManhourConstraint実装
- [ ] generateReportWithGemini変更

### Phase 3: 商談履歴連携
- [ ] fetchOpportunities実装
- [ ] fetchOpportunityTasks実装
- [ ] Services.jsのcollectLogs変更（ES部判定）

### Phase 4: 部署別プロンプト
- [ ] Config.jsにgetDepartmentPrompts実装
- [ ] Config.jsにsaveDepartmentPrompts実装
- [ ] AI.jsにgetDefaultPromptsES実装
- [ ] Index.htmlに部署選択UI追加
- [ ] Index.htmlにプロンプト部署切り替え追加
- [ ] js.htmlに部署管理関数追加
- [ ] Services.jsのgeneratePreviewReport変更
- [ ] AI.jsのgenerateReportWithGemini変更

### Phase 5: テスト・ドキュメント
- [ ] 全機能の統合テスト
- [ ] README更新
- [ ] セットアップ手順書作成
- [ ] ヘルプテキスト追加

---

## 🚀 デプロイ手順

### 1. Salesforce環境準備
1. Salesforceにログイン
2. 設定 > アプリケーション > アプリケーションマネージャー
3. 「新規接続アプリケーション」作成
4. OAuth設定:
   - コールバックURL: GASのWebアプリURL
   - スコープ: `api`, `refresh_token`
5. Consumer Key/Secretをコピー

### 2. GAS環境設定
1. ScriptPropertiesに設定:
   ```
   SF_CLIENT_ID: [Consumer Key]
   SF_CLIENT_SECRET: [Consumer Secret]
   ```

### 3. コードデプロイ
1. 新規ファイル作成: `SalesforceService.js`
2. 既存ファイル変更: `Config.js`, `Services.js`, `AI.js`, `Code.gs`, `Index.html`, `js.html`
3. `clasp push` でアップロード
4. 新しいバージョンとしてデプロイ

### 4. 動作確認
1. Webアプリにアクセス
2. Salesforce連携テスト
3. CS部で日報作成テスト
4. ES部で日報作成テスト

---

## ⚠️ 注意事項

### Salesforce API制限
- 日次API制限: 15,000〜25,000リクエスト/日
- 対策: キャッシュ活用、バッチ処理

### TeamSpiritオブジェクト名
- 環境によってカスタムオブジェクト名が異なる可能性
- 実装前に確認が必要:
  - `TeamSpirit__DailyWorkRecord__c`
  - `EmpId__c`, `Date__c`, `StartTime__c`, `EndTime__c`, `RealWorkTime__c`

### 後方互換性
- 既存ユーザーへの影響を最小化
- Salesforce連携なしでも動作
- 部署選択のデフォルトはCS部

---

## 📚 参考資料

- [設計書](./salesforce-integration-design.md)
- [技術仕様書](./technical-specifications.md)
- [Salesforce OAuth 2.0](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm)
- [Salesforce REST API](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/)
- [Google Apps Script Quotas](https://developers.google.com/apps-script/guides/services/quotas)

---

## 🎯 成功の定義

1. **機能面**:
   - Salesforce連携が正常に動作
   - TeamSpirit工数情報が日報に反映
   - ES部で商談履歴が自動取得
   - 部署別プロンプトが正常に動作

2. **品質面**:
   - 既存機能が正常に動作（後方互換性）
   - エラーハンドリングが適切
   - ユーザーフレンドリーなUI

3. **運用面**:
   - ドキュメントが整備されている
   - トラブルシューティングガイドがある
   - ユーザーサポート体制が整っている

---

以上が実装サマリーです。詳細は各設計書を参照してください。
