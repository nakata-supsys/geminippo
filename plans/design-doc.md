# 設計図: 3つの改善（部署保存・UIレイアウト・SF Google SSO）

**本ドキュメントは設計書です。コーディングは Gemini Code Assist に依頼してください。**

---

## 改善1: 部署選択が「設定を保存する」で保存されない問題

### 背景
自動実行（`runDailyReportAndArchive()`）は `SELECTED_DEPARTMENT` プロパティを読んで部署別の日報を生成する。
しかし、UIの「設定を保存する」ボタンで `departmentSelect` の値がサーバーに送信されていない。

### 原因
- `departmentSelect` は「手動実行」タブ（`<div id="run">`）に配置されており、`connectionForm` / `settingForm` / `promptForm` のいずれにも属していない
- `collectAllSettings()` は3つの `<form>` から `FormData` を収集するため、`departmentSelect` が含まれない
- サーバー側の `saveUserSettings()` は `data.selectedDepartment` を期待するが、常に `undefined` → フォールバックで既存値が使われ、変更が反映されない

### 修正箇所

**ファイル: [js.html](js.html) — `collectAllSettings()` 関数（1099行目付近）**

`data.backlogConfigs = blConfigs;` の後に以下を追加:
```javascript
// 部署選択（run タブ内のため FormData に含まれない）
data.selectedDepartment = document.getElementById('departmentSelect').value;
```

### 補足
- サーバー側 [Config.js:45](Config.js#L45) の `saveUserSettings()` は既に `data.selectedDepartment` を処理するコードがある
- [Services.js:88](Services.js#L88) の `runDailyReportAndArchive()` も既に `SELECTED_DEPARTMENT` を読み取っている
- **サーバー側の変更は不要**、クライアント側の収集漏れのみ修正

---

## 改善2: 「設定を保存する」ボタンとSalesforce連携セクションの順序入れ替え

### 背景
現在、接続設定タブ内で「設定を保存する」ボタンの**下**にSalesforce連携セクションが配置されている。
Salesforce連携は保存ボタンより上（他の接続設定と同列）にあるべき。

### 現在のレイアウト（[Index.html](Index.html) 116〜141行目）
```
116:   </div>（Backlog連携グループの閉じ）
117: </form>（connectionFormの閉じ）
118: <button ... onclick="saveAllSettings()">設定を保存する</button>  ← ここ
119:
120: <div class="group">  ← Salesforce連携セクション開始
...
141: </div>               ← Salesforce連携セクション終了
142: </div>
```

### 修正後のレイアウト
```
116:   </div>（Backlog連携グループの閉じ）
      ← ★Salesforce連携セクションをここに移動（formタグの中）
117: </form>（connectionFormの閉じ）
118: <button ... onclick="saveAllSettings()">設定を保存する</button>
142: </div>
```

### 修正箇所

**ファイル: [Index.html](Index.html)**

1. 120〜141行目のSalesforce連携セクション全体を**切り取る**
2. 116行目（Backlog連携の `</div>` の後、`</form>` の前）に**貼り付ける**

具体的には、以下のHTMLブロックを移動:
```html
<div class="group">
  <label>Salesforce連携（オプション） <span class="help-icon" data-help="salesforce">?</span></label>
  <div class="status-badge" id="sf-status">
    <?= props.SF_ACCESS_TOKEN ? '🟢 連携済み' : '⚪ 未連携' ?>
  </div>
  <div style="font-size:12px; color:var(--sub-text); margin-bottom:10px;">
    TeamSpirit打刻情報と商談履歴を取得できます。
  </div>
  <? if (!props.SF_ACCESS_TOKEN) { ?>
    <button type="button" class="btn-test" onclick="connectSalesforce()">
      ⚡ Salesforceと連携
    </button>
  <? } else { ?>
    <button type="button" class="btn-test" onclick="testSalesforce()">
      ⚡ 接続テスト
    </button>
    <button type="button" class="btn-test" onclick="disconnectSalesforce()"
            style="background:#dc3545; color:#fff;">
      🔓 連携解除
    </button>
  <? } ?>
</div>
```

---

## 改善3: Salesforce OAuth を Google SSO 対応にする（MyDomain 方式）

### 背景
ユーザーは Salesforce（TeamSpirit）に Google アカウント連携でログインしている。
現在のコードは `login.salesforce.com` にハードコードされているため、Salesforce のログイン画面でユーザー名/パスワード入力を求められる。
MyDomain URL に変更すれば、Salesforce 側で設定済みの Google SSO に自動リダイレクトされる。

### 仕組み
Salesforce の MyDomain URL（例: `yourcompany.my.salesforce.com`）に OAuth リクエストを送ると:
1. Salesforce が組織の SSO 設定を参照
2. Google が Identity Provider として設定されている場合、自動的に Google ログイン画面にリダイレクト
3. Google 認証後、Salesforce に戻り、通常通り認可コードが発行される
4. 以降のトークン交換・リフレッシュは同じ仕組みで動作

### 修正箇所

**ファイル: [SalesforceService.js](SalesforceService.js)**

#### 3-1. Script Properties に `SF_DOMAIN` を追加（管理者設定）

GAS のプロジェクト設定 → スクリプトプロパティに以下を追加:
- キー: `SF_DOMAIN`
- 値: `supreme-system.my.salesforce.com`

※ ユーザーの Lightning UI URL は `supreme-system.lightning.force.com` だが、OAuth エンドポイントには MyDomain 形式（`*.my.salesforce.com`）を使用する。

#### 3-2. `getSalesforceAuthUrl()` の修正（16行目付近）

```javascript
function getSalesforceAuthUrl() {
  const scriptProps = PropertiesService.getScriptProperties();
  const clientId = scriptProps.getProperty('SF_CLIENT_ID');
  const sfDomain = scriptProps.getProperty('SF_DOMAIN') || 'login.salesforce.com';  // ★追加
  const redirectUri = ScriptApp.getService().getUrl();

  const state = ScriptApp.newStateToken().withTimeout(600).createToken();
  CacheService.getUserCache().put('sf_oauth_state', state, 600);

  const authUrl = `https://${sfDomain}/services/oauth2/authorize` +    // ★変更
    `?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&scope=api refresh_token`;

  return authUrl;
}
```

#### 3-3. トークン交換URLの修正（63行目付近 `handleSalesforceCallback` 内）

```javascript
// 変更前
const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';

// 変更後
const sfDomain = PropertiesService.getScriptProperties().getProperty('SF_DOMAIN') || 'login.salesforce.com';
const tokenUrl = `https://${sfDomain}/services/oauth2/token`;
```

#### 3-4. トークンリフレッシュURLの修正（127行目付近 `refreshSalesforceToken` 内）

同様に:
```javascript
// 変更前
const tokenUrl = 'https://login.salesforce.com/services/oauth2/token';

// 変更後
const sfDomain = PropertiesService.getScriptProperties().getProperty('SF_DOMAIN') || 'login.salesforce.com';
const tokenUrl = `https://${sfDomain}/services/oauth2/token`;
```

### 注意事項
- `SF_DOMAIN` が未設定の場合は `login.salesforce.com` にフォールバックするため、既存動作は壊れない
- Salesforce Connected App の設定で、Callback URL に GAS の Web アプリ URL が登録されていることを確認
- MyDomain: `supreme-system.my.salesforce.com`（Lightning URL `supreme-system.lightning.force.com` から特定）

---

---

## バグ修正: 工数集計で日付が正しく表示されない問題

### 症状
2026年2月の工数集計を実行すると、2023年10月の結果として出力される。エラーは発生しない。

### 原因（根本原因）
[Services.js:191-218](Services.js#L191-L218) の `newAggregationPrompt` に `{{DATE}}` と `{{LOGS}}` のプレースホルダーが**含まれていない**。

このカスタムプロンプトが [AI.js:580](AI.js#L580) の `generateAggregationWithGemini()` に `customPrompt` として渡されると、595行目の:
```javascript
const promptText = p.replaceAll('{{DATE}}', dateRangeStr).replaceAll('{{LOGS}}', logText);
```
が何もマッチせず、**活動ログと集計期間がAIに一切渡されない**。

結果として、AIが活動ログなしで「想像」で出力を生成し、でたらめな日付（2023年10月等）が返される。

### 対比
元々の `DEFAULT_PROMPTS.aggregation`（[AI.js:225-284](AI.js#L225-L284)）には以下のプレースホルダーが存在する:
```
【集計期間】 {{DATE}}
...
### 活動ログ
{{LOGS}}
```
しかし `newAggregationPrompt` にはこれらがないため、カスタムプロンプト使用時にログが注入されない。

### 修正箇所

**ファイル: [Services.js](Services.js) — `runPeriodAggregation()` 内の `newAggregationPrompt`（218行目付近）**

`newAggregationPrompt` の末尾（`};` の直前）に以下を追加:

```javascript
// 変更前（218行目付近）
| PROJ-001: A社様導入支援 | 4.5 | 定例MTG、課題管理表の更新 |
`;

// 変更後
| PROJ-001: A社様導入支援 | 4.5 | 定例MTG、課題管理表の更新 |

【集計期間】 {{DATE}}

### 活動ログ
{{LOGS}}`;
```

これにより、`generateAggregationWithGemini()` 内の `replaceAll` で正しくログと日付が注入される。

### 補足
- `DEFAULT_PROMPTS.aggregation` 側のプロンプトには既にJSONブロック出力やプロジェクト別サマリの指示があるが、`newAggregationPrompt` はテーブルフォーマットの厳守に特化している
- `newAggregationPrompt` では「JSON形式の出力は絶対に含めないでください」と明記しているため、フロントエンドの `renderAggResult()` でJSONチャートデータが取得できなくなる可能性がある。必要に応じてJSON出力指示も追加すること
- epoch time の桁違いではなく、**そもそもログが渡されていなかった**のが真の原因

---

## 修正対象ファイル一覧

| ファイル | 修正内容 |
|----------|----------|
| [Services.js](Services.js) | `newAggregationPrompt` に `{{DATE}}` と `{{LOGS}}` プレースホルダー追加（**最優先**） |
| [js.html](js.html) | `collectAllSettings()` に `selectedDepartment` 追加（1行追加） |
| [Index.html](Index.html) | Salesforce セクションを保存ボタンの上に移動（HTMLブロック移動のみ） |
| [SalesforceService.js](SalesforceService.js) | `login.salesforce.com` → `SF_DOMAIN` 参照に変更（3箇所） |

## 検証方法
1. **【最優先】** テストデプロイ後、工数集計タブで2月の期間を指定して集計 → 正しい日付（2026年2月）でレポートが生成されることを確認
2. テストデプロイ後、部署を「ES部」に変更 → 「設定を保存」→ ページリロード → 「ES部」が保持されていることを確認
3. 接続設定タブでSalesforce連携セクションが保存ボタンの上に表示されることを確認
4. Script Properties に `SF_DOMAIN` を設定 → 「Salesforceと連携」ボタンでGoogle SSO画面にリダイレクトされることを確認
