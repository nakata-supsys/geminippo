# Salesforce連携 & 部署別プロンプト機能 設計書

## 📋 プロジェクト概要

### 現行システム
- **名称**: GemiNippo (AI日報アシスタント)
- **基盤**: Google Apps Script (GAS)
- **主要機能**:
  - Slack連携による活動ログ収集
  - Google Calendar、Gmail、Backlogからのログ収集
  - Vertex AI (Gemini 2.5) による日報自動生成
  - 工数集計機能（TeamSpirit転記用）

### 追加要件
1. **Salesforce連携（オプション機能）**
   - TeamSpiritの打刻情報取得 → 工数算出精度の向上
   - 商談履歴取得 → 営業日報への自動反映
2. **部署別プロンプト機能**
   - CS部: 技術対応中心（現行）
   - ES部（営業部）: 商談・提案活動中心

---

## 🏗️ システムアーキテクチャ

### 全体構成図

```
┌─────────────────────────────────────────────────────────────┐
│                        ユーザー                              │
│                    (Slack経由でログイン)                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Apps Script (Webアプリ)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  UI Layer (Index.html)                               │   │
│  │  - 認証状態管理                                       │   │
│  │  - 部署選択UI (新規)                                  │   │
│  │  - Salesforce連携設定UI (新規)                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Business Logic Layer                                │   │
│  │  ┌────────────────┐  ┌────────────────┐             │   │
│  │  │ Code.gs        │  │ Services.js    │             │   │
│  │  │ - ルーティング  │  │ - ログ収集     │             │   │
│  │  │ - 認証管理     │  │ - 外部API連携  │             │   │
│  │  └────────────────┘  └────────────────┘             │   │
│  │  ┌────────────────┐  ┌────────────────┐             │   │
│  │  │ Config.js      │  │ AI.js          │             │   │
│  │  │ - 設定管理     │  │ - Gemini連携   │             │   │
│  │  │ - プロンプト管理│  │ - 日報生成     │             │   │
│  │  └────────────────┘  └────────────────┘             │   │
│  │  ┌────────────────────────────────────┐             │   │
│  │  │ SalesforceService.js (新規)        │             │   │
│  │  │ - Salesforce OAuth認証             │             │   │
│  │  │ - TeamSpirit打刻情報取得           │             │   │
│  │  │ - 商談履歴取得                     │             │   │
│  │  └────────────────────────────────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Slack API  │  │ Salesforce   │  │  Vertex AI   │
│              │  │   REST API   │  │   (Gemini)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## 🔐 Salesforce連携設計

### 認証フロー

```
[ユーザー] → [Slack認証完了後のメイン画面]
                    │
                    ▼
            [接続設定タブ]
                    │
                    ▼
        [Salesforce連携ボタン] (オプション)
                    │
                    ▼
        [Salesforce OAuth 2.0認証]
                    │
                    ▼
        [アクセストークン取得・保存]
                    │
                    ▼
        [連携完了・ステータス表示]
```

### OAuth 2.0 実装方式

**選択肢1: Connected App方式（推奨）**
- Salesforceで専用のConnected Appを作成
- OAuth 2.0 Web Server Flow
- リフレッシュトークンによる長期利用

**選択肢2: Named Credentials方式**
- Salesforce側で認証情報を一元管理
- REST APIコールアウト

**推奨**: 選択肢1（ユーザーごとに認証、セキュリティ面で優位）

### データ取得API設計

#### 1. TeamSpirit打刻情報取得

**エンドポイント**:
```
GET /services/data/v59.0/query?q=SELECT+Id,StartTime__c,EndTime__c,RealWorkTime__c+FROM+TeamSpirit__DailyWorkRecord__c+WHERE+EmpId__c='[USER_ID]'+AND+Date__c=[TARGET_DATE]
```

**取得項目**:
- `StartTime__c`: 出勤時刻
- `EndTime__c`: 退勤時刻（当日実行時はnull）
- `RealWorkTime__c`: 実労働時間（分単位）

**活用方法**:
- 当日の日報生成時: 出勤時刻〜現在時刻で暫定工数を算出
- 過去日の日報生成時: 実労働時間を工数合計の上限値として使用

#### 2. 商談履歴取得

**エンドポイント**:
```
GET /services/data/v59.0/query?q=SELECT+Id,Name,AccountId,Account.Name,StageName,Amount,LastModifiedDate+FROM+Opportunity+WHERE+OwnerId='[USER_ID]'+AND+LastModifiedDate=[TARGET_DATE]
```

**取得項目**:
- `Name`: 商談名
- `Account.Name`: 取引先名
- `StageName`: フェーズ（商談ステージ）
- `Amount`: 金額
- `LastModifiedDate`: 最終更新日

**活動履歴の取得**:
```
GET /services/data/v59.0/query?q=SELECT+Id,Subject,Status,ActivityDate,WhatId+FROM+Task+WHERE+OwnerId='[USER_ID]'+AND+ActivityDate=[TARGET_DATE]
```

**取得項目**:
- `Subject`: タスク件名
- `Status`: ステータス（完了/未完了）
- `ActivityDate`: 活動日
- `WhatId`: 関連商談ID

---

## 🎯 部署別プロンプト機能設計

### データモデル

**プロンプトテンプレート構造**:
```javascript
{
  "department": "CS" | "ES",
  "displayName": "CS部（カスタマーサクセス）" | "ES部（営業）",
  "prompts": {
    "summary": "要約モード用プロンプト",
    "detail": "詳細モード用プロンプト",
    "manhour": "工数算出ルール",
    "reflection": "フィードバック視点",
    "aggregation": "期間集計モード指示"
  }
}
```

### UI設計

#### 1. 部署選択UI（手動実行タブ）

```
┌─────────────────────────────────────┐
│ 作成対象日: [2026-02-14]            │
│                                     │
│ 部署選択: [▼ CS部（カスタマーサクセス）] │
│           - CS部（カスタマーサクセス） │
│           - ES部（営業）             │
│                                     │
│ [日報を作成してプレビュー 🚀]        │
└─────────────────────────────────────┘
```

#### 2. プロンプト管理UI（プロンプトタブ）

```
┌─────────────────────────────────────┐
│ 部署別プロンプト設定                 │
│                                     │
│ [▼ CS部] [ES部]  ← タブ切り替え     │
│                                     │
│ 1. 要約モードの指示                  │
│ [テキストエリア]                     │
│                                     │
│ 2. 詳細モードの指示                  │
│ [テキストエリア]                     │
│                                     │
│ ... (以下同様)                       │
│                                     │
│ [保存] [デフォルトに戻す]            │
└─────────────────────────────────────┘
```

### プロンプトテンプレート例

#### CS部（現行ベース）
```
【要約モード用】
以下のログをもとに、カスタマーサクセス業務の日報を作成してください。
- 顧客対応、技術サポート、課題解決を中心に記述
- 技術的なキーワードを含める
...
```

#### ES部（営業向け・新規）
```
【要約モード用】
以下のログをもとに、営業活動の日報を作成してください。
- 商談進捗、提案活動、顧客訪問を中心に記述
- 商談名、取引先名、フェーズを明記
- 受注見込み、課題、ネクストアクションを含める

### 記述ルール
#### 1. 商談情報の記載
- 大項目: 「● 取引先名様」
- 小項目: 「　・商談名（フェーズ）: 活動内容」

#### 2. 本日の営業活動
- 商談ごとに進捗状況を記載
- 提案内容、顧客の反応、合意事項を明記

#### 3. 次回やること
- 商談ごとのネクストアクションを記載
- 期限がある場合は併記

#### 4. 受注見込み・課題
- 受注確度が高い案件の状況
- 障壁となっている課題

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日の営業活動*
● A社様
　・新規CRMシステム導入提案（商談中）: 要件ヒアリング実施、予算感の合意
　・既存契約の更新（クロージング）: 契約書送付、押印待ち
● B社様
　・MA導入支援（提案）: デモ実施、好反応、次回詳細見積提示

⛳ *次回やること*
● A社様
　・詳細見積書の作成・提出（2/16まで）
● B社様
　・詳細見積書の作成（2/17 MTG）

💰 *受注見込み*
・A社様 既存契約更新: 来週中に受注見込み（確度90%）

⚠️ *課題・困っていること*
・B社様の決裁プロセスが不明確、キーマンの特定が必要

💬 *ひとこと*
・A社様の新規案件が順調に進展、来月の受注目標達成に向けて好調です。

### 活動ログ
{{LOGS}}
```

---

## 📊 データフロー設計

### 日報生成フロー（Salesforce連携あり）

```
[ユーザー: 日報作成ボタン押下]
         │
         ▼
[部署選択の取得] (CS/ES)
         │
         ▼
[対象日付の取得]
         │
         ▼
┌────────────────────────────────┐
│ ログ収集 (並列実行)             │
│ ┌────────────────────────────┐ │
│ │ 1. Google Calendar         │ │
│ │ 2. Slack                   │ │
│ │ 3. Gmail                   │ │
│ │ 4. Backlog                 │ │
│ │ 5. Salesforce (新規)       │ │
│ │    - TeamSpirit打刻情報    │ │
│ │    - 商談履歴 (ES部のみ)   │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
         │
         ▼
[ログの統合・整形]
         │
         ▼
[部署別プロンプトの取得]
         │
         ▼
[Gemini APIコール]
  - プロンプト: 部署別テンプレート
  - コンテキスト: 統合ログ + TeamSpirit工数情報
         │
         ▼
[日報生成結果の表示]
         │
         ▼
[ユーザー編集 → Slack送信]
```

### 工数算出ロジック（TeamSpirit連携時）

```javascript
// 疑似コード
function calculateManhour(logs, teamSpiritData) {
  let maxHours = 8.0; // デフォルト
  
  if (teamSpiritData) {
    if (teamSpiritData.RealWorkTime__c) {
      // 実労働時間が記録されている場合（過去日）
      maxHours = teamSpiritData.RealWorkTime__c / 60;
    } else if (teamSpiritData.StartTime__c) {
      // 当日で出勤時刻のみの場合
      const now = new Date();
      const startTime = new Date(teamSpiritData.StartTime__c);
      const elapsedHours = (now - startTime) / (1000 * 60 * 60);
      maxHours = Math.min(elapsedHours - 1, 10); // 休憩1時間を差し引き、上限10時間
    }
  }
  
  // AIに渡すプロンプトに追加
  const manhourInstruction = `
  【重要: 工数制約】
  本日の実労働時間は ${maxHours} 時間です。
  各タスクの工数合計が、この時間を超えないように調整してください。
  `;
  
  return manhourInstruction;
}
```

---

## 🗂️ ファイル構成（追加・変更）

### 新規ファイル

```
SalesforceService.js
├─ getSalesforceAuthUrl()          // OAuth認証URL生成
├─ handleSalesforceCallback(e)     // OAuth コールバック処理
├─ fetchTeamSpiritWorkTime(date)   // TeamSpirit打刻情報取得
├─ fetchOpportunities(date)        // 商談履歴取得
├─ fetchOpportunityTasks(date)     // 商談活動履歴取得
└─ testSalesforceConnection()      // 接続テスト
```

### 変更ファイル

#### [`Config.js`](Config.js:1-283)
```javascript
// 追加: 部署別プロンプト管理
function getDepartmentPrompts(department) {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName('プロンプト_' + department);
  // ...
}

function saveDepartmentPrompts(department, prompts) {
  // ...
}

// 追加: Salesforce設定保存
function saveSalesforceSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    'SF_INSTANCE_URL': data.instanceUrl,
    'SF_ACCESS_TOKEN': data.accessToken,
    'SF_REFRESH_TOKEN': data.refreshToken,
    'SF_USER_ID': data.userId
  });
}
```

#### [`Services.js`](Services.js:1-885)
```javascript
// 変更: collectLogs関数にSalesforce連携を追加
function collectLogs(props, targetDate, department) {
  // ... 既存のログ収集 ...
  
  // Salesforce連携（オプション）
  if (props.SF_ACCESS_TOKEN) {
    try {
      const sfLogs = collectSalesforceLogs(targetDate, department);
      if (sfLogs.length > 0) {
        allLogs += `=== Salesforce ===\n${sfLogs.join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn("Salesforce error:", e);
    }
  }
  
  return { text: allLogs, counts: counts };
}

function collectSalesforceLogs(targetDate, department) {
  const logs = [];
  
  // TeamSpirit打刻情報
  const workTime = fetchTeamSpiritWorkTime(targetDate);
  if (workTime) {
    logs.push(`[勤怠] 出勤: ${workTime.startTime}, 実労働: ${workTime.realHours}時間`);
  }
  
  // 商談履歴（ES部のみ）
  if (department === 'ES') {
    const opportunities = fetchOpportunities(targetDate);
    opportunities.forEach(opp => {
      logs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`);
    });
    
    const tasks = fetchOpportunityTasks(targetDate);
    tasks.forEach(task => {
      logs.push(`[活動] ${task.subject} (${task.status})`);
    });
  }
  
  return logs;
}
```

#### [`AI.js`](AI.js:1-487)
```javascript
// 変更: 部署別プロンプト対応
function generateReportWithGemini(logText, modelType, department, prompts, reportMode, targetDate, reflection, manhour, dayFormat, instruction, teamSpiritData) {
  const useModelId = (modelType === 'pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${useModelId}:generateContent`;

  // 部署別プロンプトの取得
  const deptPrompts = getDepartmentPrompts(department);
  let p = (reportMode === "詳細モード") ? deptPrompts.detail : deptPrompts.summary;
  
  if (manhour !== "なし") {
    p += "\n\n" + deptPrompts.manhour;
    
    // TeamSpirit連携時の工数制約追加
    if (teamSpiritData) {
      p += calculateManhourConstraint(teamSpiritData);
    }
  }
  
  if (reflection !== "なし") p += "\n\n" + deptPrompts.reflection;
  if (instruction) p += `\n\n【重要：修正指示】\n${instruction}`;
  
  const promptText = p.replaceAll('{{DATE}}', getFormattedDateString(targetDate, dayFormat))
                      .replaceAll('{{LOGS}}', logText);
  
  // ... Gemini API呼び出し ...
}
```

#### [`Index.html`](Index.html:1-226)
```html
<!-- 追加: 部署選択UI -->
<div id="run" class="content active">
  <div class="group">
    <label>部署選択</label>
    <select id="departmentSelect">
      <option value="CS">CS部（カスタマーサクセス）</option>
      <option value="ES">ES部（営業）</option>
    </select>
  </div>
  
  <div class="group">
    <label>作成対象日</label>
    <input type="date" id="manualDate">
  </div>
  
  <button type="button" class="btn btn-primary" onclick="validateAndRun()">
    日報を作成してプレビュー 🚀
  </button>
</div>

<!-- 追加: Salesforce連携設定UI -->
<div id="connection" class="content">
  <!-- 既存の連携設定 -->
  
  <div class="group">
    <label>Salesforce連携（オプション）</label>
    <div class="status-badge" id="sf-status">未連携</div>
    <button type="button" class="btn-test" onclick="connectSalesforce()">
      ⚡ Salesforceと連携
    </button>
    <button type="button" class="btn-test" onclick="testSalesforce()" style="display:none;" id="sf-test-btn">
      ⚡ 接続テスト
    </button>
  </div>
</div>

<!-- 変更: プロンプトタブに部署切り替え追加 -->
<div id="prompts" class="content">
  <div class="tabs" style="margin-bottom: 20px;">
    <button class="tab-btn active" onclick="switchDepartment('CS')">CS部</button>
    <button class="tab-btn" onclick="switchDepartment('ES')">ES部</button>
  </div>
  
  <form id="promptForm">
    <!-- プロンプト編集フォーム -->
  </form>
</div>
```

---

## 🔧 実装タスク一覧

### Phase 1: Salesforce連携基盤（必須）

- [ ] **1.1 Salesforce Connected App作成**
  - Salesforce組織でConnected Appを作成
  - OAuth設定（Callback URL、スコープ設定）
  - Consumer Key/Secretの取得

- [ ] **1.2 SalesforceService.js実装**
  - OAuth 2.0認証フロー実装
  - アクセストークン管理（取得・更新・保存）
  - REST API基盤実装

- [ ] **1.3 UI実装（接続設定タブ）**
  - Salesforce連携ボタン追加
  - 連携ステータス表示
  - 接続テスト機能

### Phase 2: TeamSpirit連携（工数精度向上）

- [ ] **2.1 TeamSpirit API実装**
  - 打刻情報取得API実装
  - 実労働時間の取得・計算ロジック
  - エラーハンドリング

- [ ] **2.2 工数算出ロジック改修**
  - TeamSpiritデータを考慮した工数制約生成
  - プロンプトへの工数情報埋め込み
  - 既存の工数算出機能との統合

- [ ] **2.3 テスト**
  - 当日実行時のテスト（出勤時刻ベース）
  - 過去日実行時のテスト（実労働時間ベース）

### Phase 3: 商談履歴連携（営業向け）

- [ ] **3.1 商談データ取得API実装**
  - Opportunity取得API実装
  - Task（活動履歴）取得API実装
  - データ整形・ログ統合

- [ ] **3.2 ログ収集ロジック改修**
  - 部署判定ロジック追加
  - ES部の場合のみ商談データ取得
  - 既存ログとの統合

### Phase 4: 部署別プロンプト機能

- [ ] **4.1 データモデル設計・実装**
  - 部署別プロンプトのスプレッドシート構造設計
  - プロンプト取得・保存関数実装
  - デフォルトプロンプトの作成（CS部/ES部）

- [ ] **4.2 UI実装（手動実行タブ）**
  - 部署選択ドロップダウン追加
  - 選択状態の保存・復元

- [ ] **4.3 UI実装（プロンプトタブ）**
  - 部署切り替えタブ追加
  - 部署ごとのプロンプト編集機能
  - 保存・リセット機能

- [ ] **4.4 日報生成ロジック改修**
  - 部署パラメータの追加
  - 部署別プロンプトの適用
  - 既存機能との互換性確保

### Phase 5: テスト・ドキュメント

- [ ] **5.1 統合テスト**
  - CS部での動作確認（既存機能維持）
  - ES部での動作確認（Salesforce連携あり/なし）
  - エラーケースのテスト

- [ ] **5.2 ドキュメント作成**
  - README更新（新機能の説明）
  - セットアップ手順書（Salesforce連携）
  - トラブルシューティング

- [ ] **5.3 ユーザー向けヘルプ**
  - 部署選択のヘルプテキスト
  - Salesforce連携のヘルプテキスト
  - プロンプトカスタマイズガイド

---

## 🔒 セキュリティ考慮事項

### 1. Salesforce認証情報の管理
- **保存場所**: UserProperties（ユーザーごとに暗号化）
- **スコープ**: 最小権限の原則（必要なオブジェクトのみ）
- **トークン更新**: リフレッシュトークンによる自動更新

### 2. データアクセス制御
- **原則**: ユーザー自身のデータのみ取得
- **Salesforce側**: 共有設定・権限セットで制御
- **GAS側**: ユーザーIDによるフィルタリング

### 3. エラーハンドリング
- **認証エラー**: 再認証を促すメッセージ表示
- **API制限**: リトライロジック、エラーログ記録
- **データ欠損**: 部分的な失敗でも他のログは取得継続

---

## 📈 拡張性の考慮

### 将来的な拡張案

1. **部署の追加**
   - 開発部、マーケティング部など
   - 部署マスタの外部管理（スプレッドシート）

2. **Salesforce連携の拡張**
   - ケース（サポート問い合わせ）の取得
   - Chatterフィードの取得
   - カスタムオブジェクトへの対応

3. **他の勤怠システム対応**
   - KING OF TIME
   - ジョブカン
   - freee勤怠管理

4. **プロンプトテンプレート共有**
   - 組織内でのテンプレート共有機能
   - ベストプラクティスの蓄積

---

## 🚀 デプロイ戦略

### ロールアウト計画

**Step 1: パイロット運用（CS部のみ）**
- 既存機能の動作確認
- 部署選択UIの追加（CS部固定）
- フィードバック収集

**Step 2: Salesforce連携追加（CS部）**
- TeamSpirit連携のみ先行実装
- 工数精度の改善効果を測定

**Step 3: ES部への展開**
- 商談履歴連携の追加
- ES部向けプロンプトの調整
- 営業部門でのパイロット運用

**Step 4: 全社展開**
- 全部署への展開
- 運用マニュアル整備
- サポート体制の確立

---

## 📝 補足事項

### Salesforce API制限への対応
- **日次API制限**: 組織の制限を確認（通常15,000〜25,000リクエスト/日）
- **対策**:
  - バッチ処理の活用（複数レコードを1リクエストで取得）
  - キャッシュの活用（同日内の重複リクエスト防止）
  - エラー時のリトライ制限

### 既存機能への影響
- **後方互換性**: Salesforce連携なしでも既存機能は動作
- **段階的導入**: オプション機能として実装
- **パフォーマンス**: 並列処理により体感速度は維持

---

## 🎨 UI/UXワイヤーフレーム

### 接続設定タブ（Salesforce連携追加後）

```
┌─────────────────────────────────────────────────────────┐
│ 📡 連携ステータス                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [✨ Vertex AI] [📅 Calendar] [🔗 Slack Auth]        │ │
│ │ [📮 Slack Post] [📧 Gmail] [🐢 Backlog]             │ │
│ │ [☁️ Salesforce] ← 新規追加                          │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Salesforce連携（オプション）                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ステータス: [🟢 連携済み] または [⚪ 未連携]         │ │
│ │                                                     │ │
│ │ 連携機能:                                            │ │
│ │ ☑ TeamSpirit打刻情報（工数精度向上）                 │ │
│ │ ☑ 商談履歴（営業日報用）                             │ │
│ │                                                     │ │
│ │ [⚡ Salesforceと連携] または [🔄 再連携]            │ │
│ │ [⚡ 接続テスト] [🔓 連携解除]                       │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 手動実行タブ（部署選択追加後）

```
┌─────────────────────────────────────────────────────────┐
│ 📝 日報作成                                              │
│                                                         │
│ 部署選択 ⓘ                                              │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [▼ CS部（カスタマーサクセス）]                       │ │
│ │     - CS部（カスタマーサクセス）                      │ │
│ │     - ES部（営業）                                   │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 作成対象日 ⓘ                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [2026-02-14]                                        │ │
│ └─────────────────────────────────────────────────────┘ │
│ [昨日] [今日]                                           │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │      [日報を作成してプレビュー 🚀]                   │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### プロンプトタブ（部署別対応後）

```
┌─────────────────────────────────────────────────────────┐
│ 部署別プロンプト設定                                      │
│                                                         │
│ ┌───────────┬───────────┐                              │
│ │ [CS部] ✓  │  [ES部]   │  ← タブ切り替え              │
│ └───────────┴───────────┘                              │
│                                                         │
│ 1. 要約モードの指示                                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 以下のログをもとに、カスタマーサクセス業務の...      │ │
│ │ [テキストエリア: 10行]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 2. 詳細モードの指示                                      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [テキストエリア: 10行]                               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ... (以下同様)                                          │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [プロンプトを保存する] [🔄 デフォルトに戻す]         │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 💾 データ保存設計

### UserProperties（ユーザーごとの設定）

```javascript
// 既存
SLACK_USER_TOKEN: "xoxp-..."
SLACK_MEMBER_ID: "U123456"
SLACK_CHANNEL_ID: "C123456"
REPORT_MODEL_TYPE: "flash"
REPORT_MODE: "要約モード"
// ... その他既存設定 ...

// 新規追加
SF_INSTANCE_URL: "https://yourcompany.my.salesforce.com"
SF_ACCESS_TOKEN: "00D..."
SF_REFRESH_TOKEN: "5Aep..."
SF_USER_ID: "005..."
SF_TOKEN_EXPIRES_AT: "2026-02-14T10:00:00Z"
SELECTED_DEPARTMENT: "CS" // 最後に選択した部署
```

### Spreadsheet（プロンプト管理）

**シート構成**:

1. **プロンプト_CS** (既存の「プロンプト」シートをリネーム)
   - A列: 要約モード指示
   - C列: 詳細モード指示
   - E列: 工数算出ルール
   - G列: フィードバック視点
   - I列: 期間集計モード指示

2. **プロンプト_ES** (新規)
   - 同様の構造

3. **履歴** (既存)
   - 日報送信履歴

---

## 🔄 シーケンス図

### Salesforce OAuth認証フロー

```
ユーザー          GAS Web App       Salesforce
   │                  │                  │
   │ 1. 連携ボタン押下 │                  │
   │─────────────────>│                  │
   │                  │                  │
   │                  │ 2. 認証URL生成   │
   │                  │<─────────────────│
   │                  │                  │
   │ 3. 認証画面表示   │                  │
   │<─────────────────│                  │
   │                  │                  │
   │ 4. ログイン・承認 │                  │
   │──────────────────────────────────>│
   │                  │                  │
   │                  │ 5. 認証コード返却 │
   │                  │<─────────────────│
   │                  │                  │
   │                  │ 6. トークン交換   │
   │                  │─────────────────>│
   │                  │                  │
   │                  │ 7. トークン取得   │
   │                  │<─────────────────│
   │                  │                  │
   │                  │ 8. トークン保存   │
   │                  │ (UserProperties) │
   │                  │                  │
   │ 9. 連携完了表示   │                  │
   │<─────────────────│                  │
```

### 日報生成フロー（Salesforce連携時）

```
ユーザー          GAS              Salesforce        Vertex AI
   │                │                    │               │
   │ 1. 日報作成    │                    │               │
   │───────────────>│                    │               │
   │                │                    │               │
   │                │ 2. 部署・日付取得  │               │
   │                │                    │               │
   │                │ 3. ログ収集開始    │               │
   │                │ (並列実行)         │               │
   │                │                    │               │
   │                │ 4. Calendar取得    │               │
   │                │ 5. Slack取得       │               │
   │                │ 6. Gmail取得       │               │
   │                │ 7. Backlog取得     │               │
   │                │                    │               │
   │                │ 8. TeamSpirit取得  │               │
   │                │───────────────────>│               │
   │                │<───────────────────│               │
   │                │                    │               │
   │                │ 9. 商談履歴取得    │               │
   │                │   (ES部のみ)       │               │
   │                │───────────────────>│               │
   │                │<───────────────────│               │
   │                │                    │               │
   │                │ 10. ログ統合       │               │
   │                │                    │               │
   │                │ 11. プロンプト生成 │               │
   │                │  (部署別)          │               │
   │                │                    │               │
   │                │ 12. Gemini呼び出し │               │
   │                │───────────────────────────────────>│
   │                │                    │               │
   │                │ 13. 日報生成       │               │
   │                │<───────────────────────────────────│
   │                │                    │               │
   │ 14. プレビュー │                    │               │
   │<───────────────│                    │               │
```

---

## 🧪 テストシナリオ

### 1. Salesforce連携テスト

#### 1.1 OAuth認証
- [ ] 初回連携が正常に完了する
- [ ] 認証後にステータスが「連携済み」になる
- [ ] トークンがUserPropertiesに保存される
- [ ] 連携解除が正常に動作する

#### 1.2 TeamSpirit連携
- [ ] 当日の打刻情報が取得できる（出勤時刻のみ）
- [ ] 過去日の実労働時間が取得できる
- [ ] 打刻情報がない場合のエラーハンドリング
- [ ] 工数算出に正しく反映される

#### 1.3 商談履歴連携
- [ ] 商談データが取得できる
- [ ] 活動履歴（Task）が取得できる
- [ ] ES部選択時のみ取得される
- [ ] データがログに正しく統合される

### 2. 部署別プロンプトテスト

#### 2.1 プロンプト管理
- [ ] CS部のプロンプトが保存・取得できる
- [ ] ES部のプロンプトが保存・取得できる
- [ ] デフォルトに戻す機能が動作する
- [ ] 部署切り替えが正常に動作する

#### 2.2 日報生成
- [ ] CS部選択時に正しいプロンプトが使用される
- [ ] ES部選択時に正しいプロンプトが使用される
- [ ] 部署ごとに異なる日報フォーマットが生成される

### 3. 統合テスト

#### 3.1 CS部（既存機能維持）
- [ ] Salesforce連携なしで動作する
- [ ] Salesforce連携ありで動作する（TeamSpiritのみ）
- [ ] 既存の日報フォーマットが維持される

#### 3.2 ES部（新機能）
- [ ] Salesforce連携なしで動作する
- [ ] Salesforce連携ありで動作する（TeamSpirit + 商談）
- [ ] 営業向け日報フォーマットが生成される

#### 3.3 エラーケース
- [ ] Salesforce認証エラー時の挙動
- [ ] API制限到達時の挙動
- [ ] ネットワークエラー時の挙動
- [ ] 部分的なデータ取得失敗時の挙動

---

## 📚 参考資料・API仕様

### Salesforce REST API

**認証**:
- [OAuth 2.0 Web Server Flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm)

**データ取得**:
- [SOQL Query](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm)
- [Standard Objects](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/)

**TeamSpirit**:
- カスタムオブジェクト: `TeamSpirit__DailyWorkRecord__c`
- 主要項目:
  - `EmpId__c`: 従業員ID
  - `Date__c`: 対象日
  - `StartTime__c`: 出勤時刻
  - `EndTime__c`: 退勤時刻
  - `RealWorkTime__c`: 実労働時間（分）

**商談・活動**:
- 標準オブジェクト: `Opportunity`, `Task`
- 主要項目:
  - Opportunity: `Name`, `AccountId`, `StageName`, `Amount`, `OwnerId`
  - Task: `Subject`, `Status`, `ActivityDate`, `WhatId`, `OwnerId`

### Google Apps Script

**制限事項**:
- [Quotas for Google Services](https://developers.google.com/apps-script/guides/services/quotas)
- URL Fetch: 20,000リクエスト/日
- 実行時間: 6分/実行

---

## 🎯 成功指標（KPI）

### 定量指標

1. **工数精度の向上**
   - 目標: TeamSpirit連携により工数算出の誤差を±20%以内に
   - 測定: 実労働時間とAI算出工数の差分

2. **営業部門の利用率**
   - 目標: ES部の50%以上が月1回以上利用
   - 測定: 部署別の利用ログ

3. **日報作成時間の短縮**
   - 目標: 平均作成時間を30%削減（15分 → 10分）
   - 測定: ユーザーアンケート

### 定性指標

1. **ユーザー満足度**
   - 目標: 満足度4.0以上（5段階評価）
   - 測定: 四半期ごとのアンケート

2. **日報の質の向上**
   - 目標: 上長からの「わかりやすい」評価が80%以上
   - 測定: マネージャーアンケート

---

## 🚨 リスクと対策

### リスク1: Salesforce API制限
**影響**: 大量ユーザー利用時にAPI制限到達
**対策**:
- キャッシュの活用
- バッチ処理の最適化
- 利用状況のモニタリング

### リスク2: TeamSpiritデータ構造の変更
**影響**: アップデート時にデータ取得不可
**対策**:
- バージョン管理
- エラーハンドリングの強化
- フォールバック処理（既存機能で継続）

### リスク3: プロンプトの複雑化
**影響**: 部署ごとのメンテナンスコスト増加
**対策**:
- 共通部分の抽出・モジュール化
- テンプレート管理の仕組み化
- ドキュメント整備

### リスク4: ユーザー教育コスト
**影響**: 新機能の理解・活用に時間がかかる
**対策**:
- 段階的ロールアウト
- チュートリアル動画の作成
- FAQ・ヘルプの充実

---

## 📅 実装スケジュール（目安）

### Week 1-2: 基盤整備
- Salesforce Connected App作成
- SalesforceService.js実装
- OAuth認証フロー実装

### Week 3-4: TeamSpirit連携
- 打刻情報取得API実装
- 工数算出ロジック改修
- テスト・デバッグ

### Week 5-6: 商談履歴連携
- 商談データ取得API実装
- ログ統合ロジック改修
- テスト・デバッグ

### Week 7-8: 部署別プロンプト
- データモデル実装
- UI実装（部署選択・プロンプト編集）
- ES部向けプロンプト作成

### Week 9-10: 統合テスト・調整
- 全機能の統合テスト
- パフォーマンスチューニング
- ドキュメント作成

### Week 11-12: パイロット運用
- CS部での先行運用
- フィードバック収集・改善
- ES部への展開準備

---

## 📖 まとめ

本設計書では、GemiNippoに以下の機能を追加する計画を示しました:

1. **Salesforce連携（オプション機能）**
   - TeamSpiritの打刻情報取得による工数精度向上
   - 商談履歴取得による営業日報の自動化

2. **部署別プロンプト機能**
   - CS部: 技術対応中心（既存）
   - ES部: 商談・提案活動中心（新規）

### 主要な設計ポイント

- **段階的導入**: オプション機能として実装し、既存機能への影響を最小化
- **セキュリティ**: OAuth 2.0による安全な認証、最小権限の原則
- **拡張性**: 将来的な部署追加、他システム連携を考慮した設計
- **ユーザビリティ**: 直感的なUI、わかりやすいエラーメッセージ

### 次のステップ

1. 本設計書のレビュー・承認
2. Salesforce環境の準備（Connected App作成）
3. Phase 1の実装開始

この設計に基づいて実装を進めることで、CS部と営業部の両方で効果的に活用できる日報システムが実現できます。