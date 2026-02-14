# BigQuery/GCS経由のSalesforce連携 - 代替案分析

## 📋 背景

社内ITから提案された回避策:
- **現状の制約**: Salesforce管理者権限がないため、Connected Appの作成ができない
- **提案された方式**: BigQuery(GCS)経由でSalesforceデータにアクセス
- **前提**: エリーさんがバックアップ目的でGCSに保存したSalesforceデータに、BigQueryビューを設定してアクセス

---

## ✅ 実現可能性の評価

### 技術的な実現可能性: **高い**

この方式は技術的に実現可能です。以下の理由から:

#### 1. GASからBigQueryへのアクセス
```javascript
// BigQuery Serviceを使用してクエリ実行
function queryBigQuery(sql) {
  const projectId = 'your-project-id';
  const request = {
    query: sql,
    useLegacySql: false
  };
  
  const queryResults = BigQuery.Jobs.query(request, projectId);
  return queryResults.rows;
}
```

**利点**:
- GASには標準で[`BigQuery Service`](https://developers.google.com/apps-script/advanced/bigquery)が組み込まれている
- OAuth認証不要（GCPプロジェクトの権限で動作）
- Connected App作成が不要

#### 2. データフロー
```
Salesforce → GCS (バックアップ) → BigQuery (ビュー) → GAS → 日報生成
```

---

## ⚠️ 技術的な懸念点

### 🔴 **重大な懸念: データ鮮度の問題**

#### 問題1: バックアップのタイミング
| シナリオ | 影響 |
|---------|------|
| **日次バックアップ（深夜実行）** | 当日の活動が反映されない |
| **リアルタイム同期** | 可能だが、バックアップ目的としては過剰 |

**具体例**:
```
【午前10時】営業担当が商談を更新
【午後3時】日報作成を実行
【結果】商談情報が取得できない（前日のバックアップデータのみ）
```

#### 問題2: TeamSpirit打刻情報の取得タイミング
```javascript
// 当日の実労働時間を取得したい
// しかし、バックアップが前日分までしかない場合...
const workTime = queryBigQuery(`
  SELECT RealWorkTime__c 
  FROM teamspirit_daily_work_record 
  WHERE Date__c = '2026-02-14'  -- 今日
`);
// → データなし（前日のバックアップまでしか存在しない）
```

**影響**:
- 工数精度向上の目的が達成できない
- 当日の日報作成時に、当日の打刻情報が使えない

---

### 🟡 その他の懸念点

#### 1. データ構造の把握が必要
- GCSにエクスポートされたデータの形式（JSON/CSV/Parquet等）
- BigQueryテーブル/ビューのスキーマ
- TeamSpiritのカスタムオブジェクト名・項目名

#### 2. 権限管理
- BigQueryへのアクセス権限（読み取り専用で十分）
- GASのサービスアカウントへの権限付与
- データの行レベルセキュリティ（ユーザーごとのフィルタリング）

#### 3. パフォーマンス
- BigQueryのクエリコスト（スキャン量に応じて課金）
- GASの実行時間制限（6分）
- 大量データの場合のレスポンス時間

#### 4. メンテナンス性
- バックアップジョブの監視
- スキーマ変更時の対応
- エラーハンドリング（データ欠損時）

---

## 🎯 推奨アプローチ

### **段階的アプローチ: ハイブリッド方式**

#### Phase 1: BigQuery連携（過去日報用）✅
**対象**: 過去の日報作成（前日以前）
**データソース**: BigQuery（GCSバックアップ）

```javascript
function fetchTeamSpiritFromBigQuery(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  
  // 当日の場合はBigQueryを使わない
  if (today.getTime() === target.getTime()) {
    return null;
  }
  
  // 過去日の場合のみBigQueryから取得
  const dateStr = Utilities.formatDate(target, 'JST', 'yyyy-MM-dd');
  const sql = `
    SELECT 
      StartTime__c,
      EndTime__c,
      RealWorkTime__c
    FROM \`project.dataset.teamspirit_daily_work_record\`
    WHERE Date__c = '${dateStr}'
      AND EmpId__c = '${getUserEmployeeId()}'
  `;
  
  const results = queryBigQuery(sql);
  if (results && results.length > 0) {
    return {
      startTime: results[0].f[0].v,
      endTime: results[0].f[1].v,
      realHours: results[0].f[2].v / 60
    };
  }
  return null;
}
```

**メリット**:
- 過去日報の精度向上（実労働時間を反映）
- 管理者権限不要
- セキュリティリスク低減

**制約**:
- 当日の日報には使えない（データ鮮度の問題）

---

#### Phase 2: 将来的なSalesforce直接連携（オプション）🔮

**条件**: CS部で「このツールええやん」の声が増えてきた場合

**方式1: 読み取り専用ユーザーでの連携**
```
Salesforce管理者に依頼:
1. 読み取り専用のIntegration Userを作成
2. 必要最小限の権限セット（TeamSpiritオブジェクトの参照のみ）
3. Connected Appの作成（管理者が実施）
```

**方式2: Salesforce Flowsを使った中間API**
```
Salesforce → Flow → REST API → GAS
```
- Salesforce側でREST APIエンドポイントを公開
- GASから呼び出し
- 管理者権限は必要だが、ユーザー側の設定は不要

---

## 📊 比較表: 3つのアプローチ

| 項目 | BigQuery経由 | Connected App | ハイブリッド方式 |
|------|-------------|--------------|----------------|
| **管理者権限** | 不要 ✅ | 必要 ❌ | 不要 ✅ |
| **データ鮮度** | 低い（前日まで）❌ | 高い（リアルタイム）✅ | 中（過去日のみ）⚠️ |
| **実装難易度** | 低 ✅ | 中 ⚠️ | 低 ✅ |
| **セキュリティ** | 高（読み取り専用）✅ | 中（OAuth管理）⚠️ | 高 ✅ |
| **コスト** | BigQueryクエリ課金 ⚠️ | なし ✅ | BigQueryクエリ課金 ⚠️ |
| **当日日報対応** | 不可 ❌ | 可 ✅ | 不可 ❌ |
| **過去日報対応** | 可 ✅ | 可 ✅ | 可 ✅ |

---

## 🚀 実装計画（ハイブリッド方式）

### Step 1: BigQuery連携の基盤構築

#### 1.1 BigQueryServiceの有効化
```javascript
// appsscript.json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "BigQuery",
        "version": "v2",
        "serviceId": "bigquery"
      }
    ]
  }
}
```

#### 1.2 BigQueryService.js の作成
```javascript
/**
 * BigQuery経由でTeamSpiritデータを取得
 * @param {Date} targetDate 対象日
 * @returns {object|null} 打刻情報
 */
function fetchTeamSpiritFromBigQuery(targetDate) {
  try {
    // 当日チェック
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    
    if (today.getTime() === target.getTime()) {
      console.log('当日のため、BigQueryからの取得をスキップします');
      return null;
    }
    
    const scriptProps = PropertiesService.getScriptProperties();
    const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
    const datasetId = scriptProps.getProperty('BQ_DATASET_ID');
    const tableId = scriptProps.getProperty('BQ_TEAMSPIRIT_TABLE');
    
    if (!projectId || !datasetId || !tableId) {
      console.warn('BigQuery設定が不完全です');
      return null;
    }
    
    const userProps = PropertiesService.getUserProperties();
    const employeeId = userProps.getProperty('EMPLOYEE_ID');
    
    if (!employeeId) {
      console.warn('従業員IDが設定されていません');
      return null;
    }
    
    const dateStr = Utilities.formatDate(target, 'JST', 'yyyy-MM-dd');
    
    const sql = `
      SELECT 
        StartTime__c,
        EndTime__c,
        RealWorkTime__c
      FROM \`${projectId}.${datasetId}.${tableId}\`
      WHERE Date__c = '${dateStr}'
        AND EmpId__c = '${employeeId}'
      LIMIT 1
    `;
    
    const request = {
      query: sql,
      useLegacySql: false,
      timeoutMs: 10000
    };
    
    const queryResults = BigQuery.Jobs.query(request, projectId);
    
    if (!queryResults.rows || queryResults.rows.length === 0) {
      console.log('BigQueryにデータが見つかりませんでした:', dateStr);
      return null;
    }
    
    const row = queryResults.rows[0];
    const startTime = row.f[0].v;
    const endTime = row.f[1].v;
    const realWorkMinutes = row.f[2].v;
    
    return {
      startTime: startTime,
      endTime: endTime,
      realHours: realWorkMinutes ? parseFloat(realWorkMinutes) / 60 : null,
      source: 'BigQuery'
    };
    
  } catch (e) {
    console.error('BigQuery取得エラー:', e);
    return null;
  }
}

/**
 * BigQuery経由で商談履歴を取得（ES部向け）
 * @param {Date} targetDate 対象日
 * @returns {Array} 商談情報の配列
 */
function fetchOpportunitiesFromBigQuery(targetDate) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    
    if (today.getTime() === target.getTime()) {
      return [];
    }
    
    const scriptProps = PropertiesService.getScriptProperties();
    const projectId = scriptProps.getProperty('GCP_PROJECT_ID');
    const datasetId = scriptProps.getProperty('BQ_DATASET_ID');
    const oppTableId = scriptProps.getProperty('BQ_OPPORTUNITY_TABLE');
    
    if (!projectId || !datasetId || !oppTableId) {
      return [];
    }
    
    const userProps = PropertiesService.getUserProperties();
    const salesforceUserId = userProps.getProperty('SALESFORCE_USER_ID');
    
    if (!salesforceUserId) {
      return [];
    }
    
    const dateStr = Utilities.formatDate(target, 'JST', 'yyyy-MM-dd');
    
    const sql = `
      SELECT 
        Id,
        Name,
        Account_Name,
        StageName,
        Amount,
        LastModifiedDate
      FROM \`${projectId}.${datasetId}.${oppTableId}\`
      WHERE OwnerId = '${salesforceUserId}'
        AND DATE(LastModifiedDate) = '${dateStr}'
      ORDER BY LastModifiedDate DESC
    `;
    
    const request = {
      query: sql,
      useLegacySql: false,
      timeoutMs: 10000
    };
    
    const queryResults = BigQuery.Jobs.query(request, projectId);
    
    if (!queryResults.rows || queryResults.rows.length === 0) {
      return [];
    }
    
    return queryResults.rows.map(row => ({
      id: row.f[0].v,
      name: row.f[1].v,
      accountName: row.f[2].v || '不明',
      stage: row.f[3].v,
      amount: row.f[4].v,
      lastModified: row.f[5].v,
      source: 'BigQuery'
    }));
    
  } catch (e) {
    console.error('BigQuery商談取得エラー:', e);
    return [];
  }
}
```

---

### Step 2: Services.jsの修正

```javascript
/**
 * collectLogs関数の修正
 * BigQuery連携を追加
 */
function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 };
  let teamSpiritData = null;
  
  // ... 既存のログ収集 ...
  
  // BigQuery連携（過去日のみ）
  try {
    const sfLogs = [];
    
    // TeamSpirit打刻情報（BigQuery経由）
    teamSpiritData = fetchTeamSpiritFromBigQuery(targetDate);
    if (teamSpiritData) {
      if (teamSpiritData.realHours) {
        sfLogs.push(`[勤怠] 実労働時間: ${teamSpiritData.realHours}時間 (BigQuery)`);
      } else if (teamSpiritData.startTime) {
        sfLogs.push(`[勤怠] 出勤時刻: ${teamSpiritData.startTime} (BigQuery)`);
      }
    }
    
    // 商談履歴（ES部のみ、BigQuery経由）
    if (department === 'ES') {
      const opportunities = fetchOpportunitiesFromBigQuery(targetDate);
      opportunities.forEach(opp => {
        sfLogs.push(`[商談] ${opp.accountName}: ${opp.name} (${opp.stage}) (BigQuery)`);
      });
    }
    
    if (sfLogs.length > 0) {
      counts.salesforce = sfLogs.length;
      allLogs += `=== Salesforce (BigQuery) ===\n${sfLogs.join('\n')}\n\n`;
    }
    
  } catch (e) {
    console.warn("BigQuery error:", e);
  }
  
  return { text: allLogs, counts: counts, teamSpiritData: teamSpiritData };
}
```

---

### Step 3: 設定UIの追加

```html
<!-- Index.html: 接続設定タブ -->
<div class="group">
  <label>BigQuery連携（過去日報用）</label>
  <p class="help-text">
    ⚠️ 当日の日報には使用できません（前日までのバックアップデータのみ）
  </p>
  <div class="status-badge" id="bq-status">未設定</div>
  <button type="button" class="btn-test" onclick="testBigQueryConnection()">
    ⚡ 接続テスト
  </button>
</div>
```

---

## 📝 セットアップ手順

### 管理者側の作業

1. **BigQueryデータセットの確認**
   - GCSバックアップからBigQueryへのデータ転送設定
   - ビューの作成（必要に応じて）

2. **GASサービスアカウントへの権限付与**
   ```
   BigQuery Data Viewer (読み取り専用)
   BigQuery Job User (クエリ実行用)
   ```

3. **スクリプトプロパティの設定**
   ```javascript
   GCP_PROJECT_ID: "your-project-id"
   BQ_DATASET_ID: "salesforce_backup"
   BQ_TEAMSPIRIT_TABLE: "teamspirit_daily_work_record"
   BQ_OPPORTUNITY_TABLE: "opportunity"
   ```

### ユーザー側の作業

1. **従業員IDの設定**
   - 接続設定タブで従業員IDを入力
   - UserPropertiesに保存

2. **接続テスト**
   - 「接続テスト」ボタンで動作確認

---

## 🎓 ユーザーへの説明

### 機能の制約を明示

```
【BigQuery連携の特徴】

✅ できること:
- 過去の日報作成時に、TeamSpiritの実労働時間を反映
- 工数精度の向上（前日以前の日報）
- 管理者権限不要

❌ できないこと:
- 当日の日報作成時のリアルタイムデータ取得
- 当日の打刻情報の反映

💡 推奨される使い方:
- 当日の日報: 通常通り作成（BigQueryは使用されません）
- 過去の日報: BigQueryから実労働時間を取得して精度向上
```

---

## 🔮 将来的な拡張

### オプション1: Salesforce Flowsを使った中間API

```
[GAS] → [Cloud Functions] → [Salesforce Flow] → [TeamSpirit]
```

**メリット**:
- リアルタイムデータ取得
- ユーザー側の設定不要
- セキュリティ制御が容易

**デメリット**:
- Salesforce管理者の協力が必要
- 追加の開発コスト

### オプション2: 段階的なバックアップ頻度の向上

```
現状: 日次バックアップ（深夜）
↓
改善: 4時間ごとのバックアップ
↓
理想: 1時間ごとのバックアップ
```

**メリット**:
- データ鮮度の向上
- 既存の仕組みを活用

**デメリット**:
- バックアップコストの増加
- GCS/BigQueryの課金増加

---

## 💰 コスト試算

### BigQueryクエリコスト

**前提**:
- ユーザー数: 20人
- 1人あたり月20回の日報作成
- 1クエリあたりのスキャン量: 10MB

**計算**:
```
月間クエリ数: 20人 × 20回 = 400クエリ
スキャン量: 400 × 10MB = 4GB
コスト: 4GB × $5/TB = $0.02/月
```

**結論**: ほぼ無視できるレベル ✅

---

## 🎯 最終推奨

### **ハイブリッド方式を推奨**

#### 理由:
1. **管理者権限不要** - 現在の制約をクリア
2. **段階的導入** - まずは過去日報の精度向上から
3. **低リスク** - 既存機能への影響なし
4. **将来の拡張性** - 利用が広がれば、Salesforce直接連携を検討

#### 実装優先度:
```
Phase 1 (即時): BigQuery連携（過去日報用）
  ↓
Phase 2 (3ヶ月後): 利用状況の評価
  ↓
Phase 3 (6ヶ月後): Salesforce直接連携の検討
```

---

## ⚠️ 重要な注意事項

### データ鮮度の制約を明示

**ユーザーへの説明文（UI上）**:
```
⚠️ BigQuery連携について

この機能は「前日以前の日報」作成時に、TeamSpiritの
実労働時間を自動取得します。

【制約】
・当日の日報には使用できません
・バックアップのタイミングにより、前日のデータが
  反映されるまで時間がかかる場合があります

【推奨】
・当日の日報: 通常通り作成
・過去の日報: BigQueryから精度の高い工数情報を取得
```

---

## 📚 参考資料

- [BigQuery API for Apps Script](https://developers.google.com/apps-script/advanced/bigquery)
- [BigQuery Pricing](https://cloud.google.com/bigquery/pricing)
- [Salesforce to BigQuery ETL Best Practices](https://cloud.google.com/architecture/salesforce-bigquery-integration)
