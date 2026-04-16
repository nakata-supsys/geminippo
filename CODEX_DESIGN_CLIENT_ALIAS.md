# 設計書：クライアント名寄せ機能 UX改善

## 背景・目的

現状の名寄せ設定UIは生JSONを手書きする仕様であり、
非エンジニアには難しく、設定ミスが発生してもエラーが表示されない。
以下の改善により、誰でも直感的に設定・確認できるようにする。

---

## 改善項目一覧

| # | 優先度 | 内容 |
|---|--------|------|
| 1 | 高 | JSON textarea → ダイナミックフォームUI化 |
| 2 | 高 | 保存時JSONバリデーション＋UI上エラー表示 |
| 3 | 中 | テストマッチ機能（テキスト入力→分類結果表示） |
| 4 | 中 | SlackチャンネルID検索ヘルパー |
| 5 | 低 | フォールバック名称のカスタマイズ |

---

## 既存コードの参照先

| ファイル | 参照箇所 | 用途 |
|--------|---------|------|
| `Index.html` L115 | `backlog-container` / `addBacklogRow()` | Backlogの動的フォームパターンを流用 |
| `js.html` L321-340 | `addBacklogRow()` 関数 | 行追加・削除・input生成パターン |
| `css.html` L120-121 | `.backlog-row`, `.remove-btn` | 既存スタイルを流用 |
| `js.html` L1220-1221 | `collectAllSettings()` | 名寄せデータ収集箇所（変更必要） |
| `Services.js` L316-338 | `loadClientAliasRules()` | バックエンドのJSON読み込みロジック |
| `Services.js` L340-385 | `createClientResolver()` | マッチングロジック（変更不要） |
| `Services.js` L403 | `fallbackClient` 定数 | フォールバック名称（変更必要） |
| `Config.js` L45 | `CLIENT_ALIAS_RULES` 保存 | バックエンド保存（変更不要） |
| `Config.js` L52-57 | キャッシュクリア | 変更不要 |

---

## 改善1：動的フォームUI化

### 削除するもの（`Index.html`）

```html
<!-- 削除対象 -->
<div class="group">
  <label>🏷️ クライアント名寄せ辞書 (JSON形式)</label>
  <textarea id="clientAliasRules" rows="5" maxlength="8000" ...></textarea>
  <div>canonical: ... / keywords: ... / slackChannels: ... / backlogKeys: ...</div>
</div>
```

### 追加するもの（`Index.html`）

削除した箇所に以下を挿入：

```html
<div class="group">
  <label>🏷️ クライアント名寄せ設定</label>

  <!-- フォールバック名称設定 -->
  <div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">
    <span style="font-size:0.85rem; color:var(--sub-text); white-space:nowrap;">未分類時の名称：</span>
    <input type="text" id="clientFallbackName"
           value="<?= props.CLIENT_FALLBACK_NAME ? escapeHtml(props.CLIENT_FALLBACK_NAME) : '● その他・社内業務' ?>"
           style="flex:1; max-width:300px;"
           placeholder="● その他・社内業務">
  </div>

  <!-- ルール行コンテナ -->
  <div id="client-alias-container"></div>

  <!-- 追加・テストボタン -->
  <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
    <button type="button" class="btn" onclick="addClientAliasRow()"
            style="border:1px dashed var(--accent); color:var(--accent); background:var(--card-bg);">
      ＋ クライアントを追加
    </button>
    <button type="button" class="btn-test" onclick="openAliasTestModal()">
      🔍 マッチテスト
    </button>
  </div>

  <!-- バリデーションエラー表示 -->
  <div id="alias-error" style="display:none; color:#e55; font-size:0.85rem; margin-top:8px; padding:8px; background:#fff0f0; border-radius:4px; border:1px solid #fcc;"></div>

  <!-- 内部状態保持用（hidden） -->
  <input type="hidden" id="clientAliasRules">
</div>
```

### 各ルール行のHTML構造（`addClientAliasRow()` が動的生成）

各行は以下の情報を持つカード形式：

```
┌──────────────────────────────────────────────────────── [×削除]
│ 正式クライアント名（canonical）: [________________]
│
│ Slackチャンネル:  [C01ABCDEF] [＋追加] [🔍IDを調べる]
│ Backlogプロジェクトキー: [ACME] [BIZ] [＋追加]
│ キーワード（部分一致）: [A株式会社] [A社本社] [＋追加]
└──────────────────────────────────────────────────────────────
```

---

## 改善1 実装詳細（`js.html` に追加する関数）

### `addClientAliasRow(data)` 関数

```javascript
window.addClientAliasRow = function(data) {
  const container = document.getElementById('client-alias-container');
  if (!container) return;
  data = data || {};

  const rowId = 'alias_' + Math.random().toString(36).substr(2, 9);
  const div = document.createElement('div');
  div.className = 'backlog-row';  // 既存スタイル流用
  div.id = rowId;
  div.style.marginBottom = '12px';

  // canonical 入力
  let html = `<button type="button" class="remove-btn" onclick="document.getElementById('${rowId}').remove(); serializeAliasRules();">×</button>`;
  html += `<div style="margin-bottom:8px;">`;
  html += `  <label style="font-size:0.8rem; color:var(--sub-text);">正式クライアント名（canonical）</label>`;
  html += `  <input type="text" class="alias-canonical" placeholder="例：A社様" value="${escapeAttr(data.canonical || '')}" oninput="serializeAliasRules()" style="width:100%;">`;
  html += `</div>`;

  // slackChannels タグ入力
  html += buildTagInput('Slack チャンネルID', 'alias-slack-tags', data.slackChannels || [], 'C01ABCDEF', rowId);
  html += `<button type="button" class="btn-test" style="font-size:0.75rem; margin-bottom:8px;" onclick="openSlackChannelSearch('${rowId}')">🔍 チャンネルIDを調べる</button>`;

  // backlogKeys タグ入力
  html += buildTagInput('Backlogプロジェクトキー', 'alias-backlog-tags', data.backlogKeys || [], 'ACME', rowId);

  // keywords タグ入力
  html += buildTagInput('キーワード（部分一致）', 'alias-keyword-tags', data.keywords || [], 'A株式会社', rowId);

  div.innerHTML = html;
  container.appendChild(div);
  serializeAliasRules();
};
```

### `buildTagInput(label, className, values, placeholder, rowId)` ヘルパー

タグ（pill）形式の入力コンポーネントを生成する。
Enterまたはカンマで確定、×クリックで削除。

```javascript
function buildTagInput(label, className, values, placeholder, rowId) {
  const tagsJson = JSON.stringify(values).replace(/"/g, '&quot;');
  return `
    <div style="margin-bottom:8px;">
      <label style="font-size:0.8rem; color:var(--sub-text);">${label}</label>
      <div class="tag-input-container ${className}" data-row="${rowId}">
        ${values.map(v => `<span class="tag-pill">${escapeHtml(v)}<button onclick="removeTagPill(this); serializeAliasRules();" type="button">×</button></span>`).join('')}
        <input type="text" class="tag-input-field" placeholder="${placeholder}"
               onkeydown="handleTagInputKey(event, this)" onblur="commitTagInput(this)">
      </div>
    </div>`;
}
```

### タグ入力ユーティリティ関数群

```javascript
// Enterまたはカンマで入力確定
function handleTagInputKey(e, input) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    commitTagInput(input);
  }
}

function commitTagInput(input) {
  const val = input.value.replace(/,/g, '').trim();
  if (!val) return;
  const pill = document.createElement('span');
  pill.className = 'tag-pill';
  pill.innerHTML = `${escapeHtml(val)}<button type="button" onclick="this.parentElement.remove(); serializeAliasRules();">×</button>`;
  input.parentElement.insertBefore(pill, input);
  input.value = '';
  serializeAliasRules();
}

function removeTagPill(btn) {
  btn.parentElement.remove();
}

function getTagValues(container) {
  return Array.from(container.querySelectorAll('.tag-pill'))
    .map(p => p.textContent.replace('×', '').trim())
    .filter(Boolean);
}
```

### `serializeAliasRules()` 関数

フォームの状態をJSON文字列にシリアライズしてhidden inputに格納する。

```javascript
function serializeAliasRules() {
  const rules = [];
  document.querySelectorAll('#client-alias-container .backlog-row').forEach(row => {
    const canonical = row.querySelector('.alias-canonical')?.value?.trim();
    if (!canonical) return;
    rules.push({
      canonical,
      slackChannels: getTagValues(row.querySelector('.alias-slack-tags')),
      backlogKeys:   getTagValues(row.querySelector('.alias-backlog-tags')),
      keywords:      getTagValues(row.querySelector('.alias-keyword-tags')),
    });
  });
  const hidden = document.getElementById('clientAliasRules');
  if (hidden) hidden.value = JSON.stringify(rules);
}
```

### `loadAliasRulesIntoForm(jsonStr)` 関数

設定ロード時（ページ初期化・インポート）に呼び出してフォームを復元する。

```javascript
function loadAliasRulesIntoForm(jsonStr) {
  const container = document.getElementById('client-alias-container');
  if (!container) return;
  container.innerHTML = '';
  try {
    const rules = JSON.parse(jsonStr || '[]');
    rules.forEach(r => addClientAliasRow(r));
  } catch(e) {
    // 旧データが壊れていても無視して空で開始
  }
}
```

---

## 改善1 CSSの追加（`css.html`）

```css
/* タグ入力コンポーネント */
.tag-input-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--input-bg);
  min-height: 36px;
  align-items: center;
  cursor: text;
}
.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--accent);
  color: #fff;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 0.8rem;
}
.tag-pill button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 0;
  font-size: 0.9rem;
  line-height: 1;
  opacity: 0.8;
}
.tag-pill button:hover { opacity: 1; }
.tag-input-field {
  border: none;
  background: transparent;
  outline: none;
  min-width: 120px;
  font-size: 0.85rem;
  color: var(--text-color);
}
```

---

## 改善2：保存時バリデーション

### `collectAllSettings()` 変更点（`js.html`）

既存の `data.clientAliasRules = document.getElementById('clientAliasRules')?.value || '';` の直後に追加：

```javascript
// バリデーション
const aliasError = document.getElementById('alias-error');
if (data.clientAliasRules) {
  try {
    JSON.parse(data.clientAliasRules);
    if (aliasError) aliasError.style.display = 'none';
  } catch(e) {
    if (aliasError) {
      aliasError.textContent = '⚠️ 名寄せルールのデータが壊れています。再設定してください。';
      aliasError.style.display = 'block';
    }
    return null;  // 保存を中断するためnullを返す
  }
}

// フォールバック名称も収集
data.clientFallbackName = document.getElementById('clientFallbackName')?.value?.trim() || '● その他・社内業務';
```

`saveAllSettings()` 側で `collectAllSettings()` の戻り値が `null` の場合は処理を中断する：

```javascript
// saveAllSettings() 内の先頭付近
const data = collectAllSettings();
if (!data) return;  // バリデーションエラー時は中断
```

---

## 改善3：テストマッチ機能

### `openAliasTestModal()` 関数（`js.html`）

SweetAlert2のモーダルを使い、テキスト入力→GASサーバーにマッチング問い合わせ→結果表示する。

```javascript
window.openAliasTestModal = async function() {
  serializeAliasRules();
  const rulesJson = document.getElementById('clientAliasRules')?.value || '[]';
  const fallbackName = document.getElementById('clientFallbackName')?.value?.trim() || '● その他・社内業務';

  const { value: formValues } = await Swal.fire({
    title: '🔍 マッチテスト',
    html: `
      <div style="text-align:left; font-size:0.85rem; color:#666; margin-bottom:8px;">
        テストしたいテキストを入力してください（チャンネル名・タイトル・本文など）
      </div>
      <select id="test-source-type" style="width:100%; margin-bottom:8px; padding:6px; border-radius:4px; border:1px solid #ddd;">
        <option value="other">汎用（カレンダー・Gmail）</option>
        <option value="slack">Slack</option>
        <option value="backlog">Backlog</option>
      </select>
      <input id="test-channel-id" class="swal2-input" placeholder="Slack チャンネルID（Slackの場合）" style="display:none;">
      <input id="test-project-key" class="swal2-input" placeholder="Backlogプロジェクトキー（Backlogの場合）" style="display:none;">
      <textarea id="test-input-text" class="swal2-textarea" placeholder="マッチさせたいテキスト（件名・本文など）" rows="4"></textarea>
    `,
    didOpen: () => {
      document.getElementById('test-source-type').addEventListener('change', function() {
        document.getElementById('test-channel-id').style.display = this.value === 'slack' ? '' : 'none';
        document.getElementById('test-project-key').style.display = this.value === 'backlog' ? '' : 'none';
      });
    },
    showCancelButton: true,
    confirmButtonText: 'マッチ確認',
    cancelButtonText: 'キャンセル',
    preConfirm: () => ({
      sourceType: document.getElementById('test-source-type').value,
      channelId:  document.getElementById('test-channel-id').value.trim(),
      projectKey: document.getElementById('test-project-key').value.trim().toUpperCase(),
      text:       document.getElementById('test-input-text').value.trim(),
    })
  });

  if (!formValues) return;

  google.script.run
    .withSuccessHandler(result => {
      const matched = result.matched || fallbackName;
      const ruleIndex = result.ruleIndex;
      const msg = ruleIndex >= 0
        ? `✅ ルール ${ruleIndex + 1}「${matched}」にマッチしました`
        : `⚠️ マッチするルールがなく、フォールバック「${matched}」に分類されます`;
      Swal.fire('テスト結果', msg, ruleIndex >= 0 ? 'success' : 'warning');
    })
    .withFailureHandler(e => Swal.fire('エラー', e.message, 'error'))
    .testClientAliasMatch(rulesJson, formValues);
};
```

### `testClientAliasMatch(rulesJson, meta)` 関数（`Services.js` または `Code.gs` に追加）

既存の `createClientResolver()` を呼び出して結果と適用ルールのインデックスを返す。

```javascript
/**
 * 名寄せルールのテストマッチを行う（UIから呼び出し用）
 * @param {string} rulesJson JSON文字列
 * @param {object} meta { sourceType, channelId, projectKey, text }
 * @returns {{ matched: string|null, ruleIndex: number }}
 */
function testClientAliasMatch(rulesJson, meta) {
  const rules = loadClientAliasRules(rulesJson);
  if (rules.length === 0) return { matched: null, ruleIndex: -1 };

  // createClientResolverはルールをまとめて返すため、
  // インデックスも取得できるよう直接ループする
  const normalized = rules
    .filter(r => r && r.canonical)
    .map(r => ({
      canonical: r.canonical,
      slackChannels: (r.slackChannels || []).map(id => (id || '').trim()).filter(Boolean),
      backlogKeys:   (r.backlogKeys || []).map(k => (k || '').toUpperCase()).filter(Boolean),
      keywords:      (r.keywords || []).map(kw => (kw || '').toLowerCase()).filter(Boolean),
    }));

  const haystack = [meta.channelName, meta.title, meta.text].filter(Boolean).join(' ').toLowerCase();

  for (let i = 0; i < normalized.length; i++) {
    const rule = normalized[i];
    if (meta.sourceType === 'slack' && meta.channelId && rule.slackChannels.includes(meta.channelId)) {
      return { matched: rule.canonical, ruleIndex: i };
    }
    if (meta.sourceType === 'backlog' && meta.projectKey && rule.backlogKeys.includes(meta.projectKey)) {
      return { matched: rule.canonical, ruleIndex: i };
    }
    if (rule.keywords.length > 0 && haystack) {
      for (const kw of rule.keywords) {
        if (kw && haystack.includes(kw)) {
          return { matched: rule.canonical, ruleIndex: i };
        }
      }
    }
  }
  return { matched: null, ruleIndex: -1 };
}
```

---

## 改善4：SlackチャンネルID検索ヘルパー

### `openSlackChannelSearch(rowId)` 関数（`js.html`）

既存の `checkIgnoreIds()` や Slack APIコール実績を参考にする。

```javascript
window.openSlackChannelSearch = async function(rowId) {
  const { value: keyword } = await Swal.fire({
    title: '🔍 Slackチャンネルを検索',
    input: 'text',
    inputPlaceholder: 'チャンネル名を入力（例：proj-a）',
    confirmButtonText: '検索',
    cancelButtonText: 'キャンセル',
    showCancelButton: true,
  });
  if (!keyword) return;

  google.script.run
    .withSuccessHandler(channels => {
      if (!channels || channels.length === 0) {
        Swal.fire('見つかりません', `「${keyword}」に一致するチャンネルはありませんでした`, 'info');
        return;
      }
      const options = channels.map(c => `<option value="${c.id}">#${c.name}（${c.id}）</option>`).join('');
      Swal.fire({
        title: '検索結果',
        html: `<select id="found-channel-select" class="swal2-select" style="width:100%;">${options}</select>`,
        confirmButtonText: 'このチャンネルを追加',
        cancelButtonText: 'キャンセル',
        showCancelButton: true,
        preConfirm: () => ({
          id:   document.getElementById('found-channel-select').value,
          name: document.getElementById('found-channel-select').selectedOptions[0].text,
        })
      }).then(result => {
        if (!result.isConfirmed) return;
        const row = document.getElementById(rowId);
        if (!row) return;
        const tagContainer = row.querySelector('.alias-slack-tags');
        const input = tagContainer.querySelector('.tag-input-field');
        input.value = result.value.id;
        commitTagInput(input);
      });
    })
    .withFailureHandler(e => Swal.fire('エラー', e.message, 'error'))
    .searchSlackChannels(keyword);
};
```

### `searchSlackChannels(keyword)` 関数（`Services.js` に追加）

Slack `conversations.list` APIを使ってチャンネル名部分一致検索する。

```javascript
/**
 * Slackチャンネル名でチャンネルIDを検索する
 * @param {string} keyword 検索キーワード
 * @returns {Array<{id: string, name: string}>}
 */
function searchSlackChannels(keyword) {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  if (!token) throw new Error('Slack User Tokenが設定されていません');

  const lowerKw = keyword.toLowerCase();
  const results = [];
  let cursor = '';

  // 最大200件まで取得（ページネーション1回）
  for (let page = 0; page < 5; page++) {
    const url = `https://slack.com/api/conversations.list?limit=200&exclude_archived=true${cursor ? '&cursor=' + cursor : ''}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });
    const data = JSON.parse(res.getContentText());
    if (!data.ok) throw new Error(`Slack APIエラー: ${data.error}`);

    (data.channels || []).forEach(ch => {
      if (ch.name && ch.name.toLowerCase().includes(lowerKw)) {
        results.push({ id: ch.id, name: ch.name });
      }
    });

    cursor = data.response_metadata?.next_cursor || '';
    if (!cursor || results.length >= 30) break;  // 30件で打ち切り
  }

  return results.slice(0, 30);
}
```

---

## 改善5：フォールバック名称のカスタマイズ

### バックエンド側（`Config.js`）

`saveUserSettings()` 内の `propsToSave` に追加：

```javascript
'CLIENT_FALLBACK_NAME': data.clientFallbackName || '● その他・社内業務',
```

### `Services.js` の変更

`collectLogs()` 関数内の `fallbackClient` をUserPropertiesから読む：

```javascript
// 変更前
const fallbackClient = '● その他・社内業務';

// 変更後
const fallbackClient = props.CLIENT_FALLBACK_NAME || '● その他・社内業務';
```

同様に `collectPeriodLogsParallel()` 内も同じ変更を行う。

---

## ページ初期化時の対応

`Index.html` の `<?= ... ?>` テンプレート変数として `props.CLIENT_FALLBACK_NAME` が必要。
`Index.html` 内のサーバーサイドで `props` を返している箇所で追加渡しが必要か確認すること。

`js.html` 内のページ初期化関数（設定値をフォームに適用している箇所）に以下を追加：

```javascript
// 名寄せフォームの復元
loadAliasRulesIntoForm(props.CLIENT_ALIAS_RULES || '[]');

// フォールバック名称
const fallbackInput = document.getElementById('clientFallbackName');
if (fallbackInput && props.CLIENT_FALLBACK_NAME) {
  fallbackInput.value = props.CLIENT_FALLBACK_NAME;
}
```

### `applySettingsToForm()` 内（インポート機能との統合）

インポート時に名寄せも復元できるよう追記：

```javascript
if (settings.clientAliasRules) {
  loadAliasRulesIntoForm(settings.clientAliasRules);
}
if (settings.clientFallbackName) {
  const el = document.getElementById('clientFallbackName');
  if (el) el.value = settings.clientFallbackName;
}
```

---

## 変更ファイルのサマリー

| ファイル | 変更内容 |
|--------|---------|
| `Index.html` | JSON textareaを削除し、動的フォームUIに置き換え（改善1、5） |
| `css.html` | `.tag-input-container`, `.tag-pill`, `.tag-input-field` を追加（改善1） |
| `js.html` | `addClientAliasRow()`, `buildTagInput()`, `serializeAliasRules()`, `loadAliasRulesIntoForm()`, `openAliasTestModal()`, `openSlackChannelSearch()`, タグ入力ユーティリティ群を追加。`collectAllSettings()`・`saveAllSettings()`・`applySettingsToForm()` を修正（改善1〜4） |
| `Services.js` | `testClientAliasMatch()`, `searchSlackChannels()` を追加。`fallbackClient` の参照をpropsから取得に変更（改善3〜5） |
| `Config.js` | `propsToSave` に `CLIENT_FALLBACK_NAME` を追加（改善5） |

---

## 実装時の注意事項

1. **`escapeAttr()` ヘルパー**: `addClientAliasRow()` 内で使うHTML属性エスケープ関数。`escapeHtml()` が既存なら同様の実装を追加する。
2. **hidden inputのタイミング**: `serializeAliasRules()` は行追加・削除・タグ確定のたびに呼ぶ。`collectAllSettings()` 実行前に必ず一度呼ばれている設計にする。
3. **既存の `checkIgnoreIds()` との重複**: `searchSlackChannels()` のAPIコールは既存のSlack接続実績（`SLACK_USER_TOKEN`）を使う。トークン権限 `channels:read` が必要。
4. **`testClientAliasMatch()` の配置**: `google.script.run` から呼べる位置（トップレベル関数）に定義する必要がある。`Services.js` に定義してもGASでは公開関数になるので問題ない。
5. **maxlength制限撤廃**: hidden inputに `maxlength` は不要。ただしUserPropertiesの1プロパティ上限は50KBのため、非常に多い場合は注意。
