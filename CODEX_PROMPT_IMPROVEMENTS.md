# GemiNippo 改善実装依頼 (CODEX向け)

## 対象機能

| # | 機能 | 優先度 |
|---|------|--------|
| A | プロンプトのバージョン管理（ロールバック） | 高 |
| B | 除外ワードの自動サジェスト | 中 |
| C | Slack投稿後フィードバック収集 | 中 |
| D | AI業務改善フィードバックの刷新 | 高 |

---

## プロジェクト構成（参照用）

```
Code.gs       エントリポイント・トリガー管理
Config.js     設定保存・UserProperties管理・スプレッドシート管理
Services.js   ログ収集・各サービスAPIコール
AI.js         プロンプト定義・Gemini API呼び出し
Index.html    メインUI（GASテンプレート）
js.html       フロントエンドJS
css.html      スタイル
```

### スプレッドシート構造（既存）
`getOrSetupAppSheet()` が返す Spreadsheet に以下のシートがある：
- `履歴` : [送信日時, 対象日, 日報内容]
- `生ログ` : 生のActivityログ
- `プロンプト_CS` : プロンプト保存（A2/C2/E2/G2/I2）
- `プロンプト_ES` : 同上

### 主要API（既存）
- `getDepartmentPrompts(department)` → {summary, detail, manhour, reflection, aggregation}
- `saveDepartmentPrompts(department, data)` → シートのA2/C2/E2/G2/I2に保存
- `resetToDefaultPrompts(department)` → デフォルトに戻す
- `getOrSetupAppSheet()` → Spreadsheet オブジェクト
- `getDefaultPromptsForDepartment(department)` → デフォルトプロンプト

### UIライブラリ
- SweetAlert2（`Swal.fire()`）: モーダル表示
- GASクライアント呼び出し: `google.script.run.withSuccessHandler(...).withFailureHandler(...).関数名(引数)`

---

## 機能A: プロンプトのバージョン管理

### 要件
- プロンプトを保存するたびに、前のバージョンを自動的にスナップショット保存する
- 最大10バージョンを保持（古いものから自動削除）
- UIから過去バージョンの一覧表示・プレビュー・復元ができる
- 部署（CS/ES）ごとに独立した履歴を管理する

### スプレッドシート設計

新しいシート `プロンプト履歴_CS` / `プロンプト履歴_ES` を作成する。
ヘッダー行（1行目）: `[保存日時, ラベル, 要約, 詳細, 工数, フィードバック, 集計]`
データ行（2行目以降）: 最新が一番下。最大10行で、超えたら古い行を削除。

### GAS実装（Config.js に追記）

```javascript
/**
 * 現在のプロンプトをバージョン履歴として保存します。
 * saveDepartmentPrompts() の冒頭で呼び出す。
 * @param {string} department 'CS' または 'ES'
 * @param {string} label バージョンラベル（例: '2026-03-10 手動保存'）
 */
function savePromptVersion(department, label) {
  const ss = getOrSetupAppSheet();
  const historySheetName = `プロンプト履歴_${department}`;
  let sheet = ss.getSheetByName(historySheetName);
  if (!sheet) {
    sheet = ss.insertSheet(historySheetName);
    sheet.appendRow(['保存日時', 'ラベル', '要約モード', '詳細モード', '工数算出', 'フィードバック', '工数集計']);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 7, 300);
  }

  // 現在のプロンプトを取得
  const current = getDepartmentPrompts(department);
  const timestamp = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm');
  const safeLabel = label || timestamp;

  sheet.appendRow([
    timestamp,
    safeLabel,
    current.summary,
    current.detail,
    current.manhour,
    current.reflection,
    current.aggregation
  ]);

  // 最大10バージョンを超えたら古い行を削除（ヘッダー除く）
  const MAX_VERSIONS = 10;
  const lastRow = sheet.getLastRow();
  if (lastRow > MAX_VERSIONS + 1) {
    sheet.deleteRow(2); // ヘッダーの次（最古）を削除
  }
}

/**
 * 過去のプロンプトバージョン一覧を返します。
 * @param {string} department
 * @returns {Array<{index:number, timestamp:string, label:string}>} 新しい順
 */
function getPromptVersions(department) {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName(`プロンプト履歴_${department}`);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const result = [];
  data.forEach(function(row, i) {
    if (row[0]) {
      result.push({ index: i + 2, timestamp: row[0].toString(), label: row[1] || row[0].toString() });
    }
  });
  return result.reverse(); // 新しい順
}

/**
 * 指定バージョンのプロンプト全文を返します（プレビュー・復元用）。
 * @param {string} department
 * @param {number} rowIndex シートの行番号（2以上）
 * @returns {object} {summary, detail, manhour, reflection, aggregation}
 */
function getPromptVersionDetail(department, rowIndex) {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName(`プロンプト履歴_${department}`);
  if (!sheet) throw new Error('バージョン履歴が存在しません');
  const row = sheet.getRange(rowIndex, 1, 1, 7).getValues()[0];
  return {
    timestamp: row[0],
    label: row[1],
    summary: row[2],
    detail: row[3],
    manhour: row[4],
    reflection: row[5],
    aggregation: row[6]
  };
}

/**
 * 指定バージョンを現在のプロンプトとして復元します。
 * @param {string} department
 * @param {number} rowIndex
 * @returns {object} {success, message}
 */
function restorePromptVersion(department, rowIndex) {
  const data = getPromptVersionDetail(department, rowIndex);
  // 復元前に今の状態をバックアップ
  savePromptVersion(department, '（復元前の自動バックアップ）');
  return saveDepartmentPrompts(department, {
    summary: data.summary,
    detail: data.detail,
    manhour: data.manhour,
    reflection: data.reflection,
    aggregation: data.aggregation
  });
}
```

**既存の `saveDepartmentPrompts()` を以下のように修正する：**
関数の先頭（シートへの書き込み前）に以下を追加：
```javascript
// バージョンを自動保存
try { savePromptVersion(department, null); } catch(e) { console.warn('version save failed:', e.message); }
```

### JS実装（js.html に追記）

```javascript
/**
 * バージョン履歴モーダルを開く。
 * プロンプトタブの「📜 変更履歴」ボタンから呼び出す。
 */
window.openPromptVersionModal = function() {
  const dept = document.getElementById('currentDepartment').value || 'CS';
  showLoading(true, 'バージョン履歴を読み込み中...');
  google.script.run
    .withSuccessHandler(function(versions) {
      showLoading(false);
      if (!versions || versions.length === 0) {
        Swal.fire({ icon: 'info', title: '履歴なし', text: 'まだバージョン履歴がありません。プロンプトを保存すると自動的に記録されます。' });
        return;
      }
      const listHtml = versions.map(function(v) {
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee;">
          <div style="flex:1;text-align:left;">
            <div style="font-weight:bold;font-size:13px;">${escapeHtml(v.label)}</div>
            <div style="font-size:11px;color:#999;">${escapeHtml(v.timestamp)}</div>
          </div>
          <button onclick="previewPromptVersion('${dept}',${v.index})" style="border:1px solid #aaa;background:#f5f5f5;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">プレビュー</button>
          <button onclick="restorePromptVersionConfirm('${dept}',${v.index},this)" style="border:none;background:var(--accent,#4a90e2);color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">復元</button>
        </div>`;
      }).join('');
      Swal.fire({
        title: '📜 プロンプト変更履歴',
        html: `<div style="text-align:left;max-height:60vh;overflow-y:auto;">${listHtml}</div>`,
        width: 600,
        showConfirmButton: false,
        showCloseButton: true
      });
    })
    .withFailureHandler(function(e) { showLoading(false); Swal.fire({ icon: 'error', title: 'エラー', text: e.message }); })
    .getPromptVersions(dept);
};

window.previewPromptVersion = function(dept, rowIndex) {
  showLoading(true, 'プレビューを読み込み中...');
  google.script.run
    .withSuccessHandler(function(data) {
      showLoading(false);
      Swal.fire({
        title: `🔍 プレビュー: ${escapeHtml(data.label)}`,
        html: `<div style="text-align:left;max-height:60vh;overflow-y:auto;">
          <details open><summary style="font-weight:bold;cursor:pointer;">要約モード</summary><pre style="white-space:pre-wrap;font-size:11px;background:#f5f5f5;padding:8px;border-radius:4px;">${escapeHtml(data.summary)}</pre></details>
          <details><summary style="font-weight:bold;cursor:pointer;">フィードバック視点</summary><pre style="white-space:pre-wrap;font-size:11px;background:#f5f5f5;padding:8px;border-radius:4px;">${escapeHtml(data.reflection)}</pre></details>
        </div>`,
        width: 700,
        showCloseButton: true,
        confirmButtonText: 'このバージョンに復元',
        showCancelButton: true,
        cancelButtonText: '閉じる'
      }).then(function(res) {
        if (res.isConfirmed) restorePromptVersionConfirm(dept, rowIndex, null);
      });
    })
    .withFailureHandler(function(e) { showLoading(false); Swal.fire({ icon: 'error', title: 'エラー', text: e.message }); })
    .getPromptVersionDetail(dept, rowIndex);
};

window.restorePromptVersionConfirm = function(dept, rowIndex, btn) {
  Swal.fire({
    icon: 'warning',
    title: 'このバージョンに復元しますか？',
    text: '現在のプロンプトは自動バックアップされてから上書きされます。',
    showCancelButton: true,
    confirmButtonText: '復元する',
    cancelButtonText: 'キャンセル'
  }).then(function(res) {
    if (!res.isConfirmed) return;
    showLoading(true, '復元中...');
    google.script.run
      .withSuccessHandler(function(r) {
        showLoading(false);
        Swal.fire({ icon: 'success', title: '復元しました', timer: 1500, showConfirmButton: false });
        // プロンプトタブの表示を更新
        loadPromptsForDepartment(dept);
      })
      .withFailureHandler(function(e) { showLoading(false); Swal.fire({ icon: 'error', title: 'エラー', text: e.message }); })
      .restorePromptVersion(dept, rowIndex);
  });
};
```

### HTML変更（Index.html）

`class="prompt-actions"` の中の「📜 変更履歴」ボタンの `style="display: none;"` を削除し、`onclick` を `openPromptVersionModal()` に変更する：

```html
<!-- 変更前 -->
<button type="button" class="btn btn-secondary" onclick="showPromptHistory()" style="display: none;">📜 変更履歴</button>

<!-- 変更後 -->
<button type="button" class="btn btn-secondary" onclick="openPromptVersionModal()">📜 変更履歴</button>
```

---

## 機能B: 除外ワードの自動サジェスト

### 要件
- 直近30日のGoogleカレンダーのイベントタイトルをスキャンし、頻出ワードを提案する
- すでに除外設定済みのワードは除外する
- ユーザーがチェックボックスで選択して一括追加できる
- 「社内業務系」「個人予定系」の判定ヒントを添える

### GAS実装（Services.js または Config.js に追記）

```javascript
/**
 * 直近30日のカレンダーイベントから除外ワード候補を提案します。
 * @returns {Array<{word:string, count:number, hint:string}>}
 */
function suggestIgnoreWords() {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const events = CalendarApp.getDefaultCalendar().getEvents(start, now);

  // 個人予定・社内業務の判定キーワード（ヒント用）
  const PERSONAL_HINTS = ['ランチ', '昼食', '休憩', '休暇', '有給', '半休', '外出', '移動', '帰宅', '出張'];
  const INTERNAL_HINTS = ['全社', '朝会', '定例', 'MTG', '会議', '1on1', 'オフサイト'];

  const wordCount = {};
  events.forEach(function(event) {
    const title = event.getTitle().trim();
    if (!title) return;
    // 句読点・カッコを除去して1〜6文字の単語を抽出
    const tokens = title.replace(/[（）()【】\[\]「」『』、。・\s]/g, '|').split('|').filter(function(t) { return t.length >= 2 && t.length <= 8; });
    tokens.forEach(function(token) {
      wordCount[token] = (wordCount[token] || 0) + 1;
    });
    // タイトル全体も候補に
    if (title.length >= 2 && title.length <= 20) {
      wordCount[title] = (wordCount[title] || 0) + 1;
    }
  });

  // 既存の除外ワードを取得
  const existingWords = (PropertiesService.getUserProperties().getProperty('CALENDAR_IGNORE_WORDS') || '')
    .split(',').map(function(w) { return w.trim(); }).filter(Boolean);

  // 頻度2以上 & 未登録のものを返す（頻度降順）
  const candidates = Object.keys(wordCount)
    .filter(function(w) { return wordCount[w] >= 2 && !existingWords.includes(w); })
    .map(function(w) {
      let hint = '業務関連';
      if (PERSONAL_HINTS.some(function(h) { return w.includes(h); })) hint = '個人予定の可能性';
      else if (INTERNAL_HINTS.some(function(h) { return w.includes(h); })) hint = '社内業務';
      return { word: w, count: wordCount[w], hint: hint };
    })
    .sort(function(a, b) { return b.count - a.count; })
    .slice(0, 20);

  return candidates;
}
```

### JS実装（js.html に追記）

```javascript
/**
 * 除外ワード候補をモーダルで表示し、選択したものを入力欄に追加する。
 * 除外設定フォームの「💡 候補提案」ボタンから呼び出す。
 */
window.openIgnoreWordSuggestModal = function() {
  showLoading(true, 'カレンダーを分析中...');
  google.script.run
    .withSuccessHandler(function(candidates) {
      showLoading(false);
      if (!candidates || candidates.length === 0) {
        Swal.fire({ icon: 'info', title: '候補なし', text: '直近30日で2回以上出現する新しいワードが見つかりませんでした。' });
        return;
      }
      const listHtml = candidates.map(function(c, i) {
        return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;">
          <input type="checkbox" class="ignore-suggest-check" value="${escapeHtml(c.word)}" style="width:16px;height:16px;">
          <span style="flex:1;font-size:13px;">${escapeHtml(c.word)}</span>
          <span style="font-size:11px;color:#999;">${c.count}回</span>
          <span style="font-size:10px;background:#f0f0f0;padding:2px 6px;border-radius:10px;color:#666;">${escapeHtml(c.hint)}</span>
        </label>`;
      }).join('');
      Swal.fire({
        title: '💡 除外ワード候補',
        html: `<div style="font-size:12px;color:#888;margin-bottom:8px;text-align:left;">直近30日のカレンダーに複数回登場したワードです。除外したいものにチェックを入れてください。</div>
          <div style="text-align:left;max-height:50vh;overflow-y:auto;">${listHtml}</div>`,
        width: 560,
        showCancelButton: true,
        confirmButtonText: '選択したワードを追加',
        cancelButtonText: 'キャンセル'
      }).then(function(res) {
        if (!res.isConfirmed) return;
        const checked = Array.from(document.querySelectorAll('.ignore-suggest-check:checked')).map(function(el) { return el.value; });
        if (checked.length === 0) return;
        const current = document.getElementById('ignoreWords').value.trim();
        const currentList = current ? current.split(',').map(function(w) { return w.trim(); }) : [];
        const merged = Array.from(new Set(currentList.concat(checked)));
        document.getElementById('ignoreWords').value = merged.join(', ');
        Swal.fire({ icon: 'success', title: `${checked.length}件を追加しました`, timer: 1500, showConfirmButton: false });
      });
    })
    .withFailureHandler(function(e) { showLoading(false); Swal.fire({ icon: 'error', title: 'エラー', text: e.message }); })
    .suggestIgnoreWords();
};
```

### HTML変更（Index.html）

除外設定グループの `<button type="button" class="btn-test" onclick="checkIgnoreIds()">` の前に追加：

```html
<button type="button" class="btn-test" onclick="openIgnoreWordSuggestModal()" style="margin-right:8px;">💡 候補提案</button>
```

---

## 機能C: Slack投稿後フィードバック収集

### 要件
- Slackへの投稿が成功した直後に、任意でフィードバックを残せるモーダルを表示する
- 評価（5段階の星）+ コメント（任意）を入力できる
- データはスプレッドシートの「フィードバック」シートに保存する
- 将来的にフィードバック傾向を分析できるよう、対象日・評価・コメント・日報の先頭200文字を記録する

### スプレッドシート設計

新規シート `フィードバック` を `getOrSetupAppSheet()` の初期化時に作成。
ヘッダー: `[記録日時, 対象日, 評価(1-5), コメント, 日報冒頭]`

### GAS実装（Config.js に追記）

```javascript
/**
 * 日報フィードバックを記録します。
 * @param {string} targetDate 対象日（'2026-03-10' 形式）
 * @param {number} rating 1〜5
 * @param {string} comment 任意コメント
 * @param {string} reportExcerpt 日報冒頭200文字
 * @returns {object} {success, message}
 */
function saveReportFeedback(targetDate, rating, comment, reportExcerpt) {
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName('フィードバック');
  if (!sheet) {
    sheet = ss.insertSheet('フィードバック');
    sheet.appendRow(['記録日時', '対象日', '評価(1-5)', 'コメント', '日報冒頭']);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 5, 200);
    sheet.setColumnWidth(4, 400);
    sheet.setColumnWidth(5, 500);
  }
  const timestamp = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  sheet.appendRow([
    timestamp,
    targetDate || '',
    rating || 0,
    comment || '',
    (reportExcerpt || '').substring(0, 200)
  ]);
  return { success: true, message: 'フィードバックを保存しました。' };
}
```

**`getOrSetupAppSheet()` の初期化ブロック（`!id` の条件分岐内）にも追加する：**
```javascript
let fbSheet = ss.insertSheet('フィードバック');
fbSheet.appendRow(['記録日時', '対象日', '評価(1-5)', 'コメント', '日報冒頭']);
fbSheet.setFrozenRows(1);
```

### JS実装（js.html に追記）

```javascript
/**
 * Slack投稿成功後にフィードバックモーダルを表示する。
 * 既存の「投稿成功」ハンドラの末尾から呼び出す。
 * @param {string} targetDate 対象日文字列
 * @param {string} reportText 投稿した日報テキスト
 */
window.showFeedbackModal = function(targetDate, reportText) {
  let selectedRating = 0;
  const stars = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
  const labels = ['いまいち', 'もう少し', 'まあまあ', '良かった', '最高！'];

  Swal.fire({
    title: '📮 投稿しました！',
    html: `<p style="color:#666;font-size:13px;margin-bottom:16px;">今日の日報の出来はどうでしたか？（任意）</p>
      <div id="star-area" style="display:flex;justify-content:center;gap:12px;margin-bottom:8px;">
        ${[1,2,3,4,5].map(function(n) {
          return `<button onclick="setFeedbackRating(${n})" id="star-btn-${n}"
            style="background:none;border:none;font-size:28px;cursor:pointer;opacity:0.3;transition:opacity 0.1s;">★</button>`;
        }).join('')}
      </div>
      <div id="star-label" style="font-size:12px;color:#aaa;height:18px;margin-bottom:12px;"></div>
      <textarea id="feedback-comment" rows="3" placeholder="AIへの改善コメント（任意）&#10;例：A社の記述が短すぎた、課題セクションが的外れだった" style="width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:13px;resize:vertical;"></textarea>`,
    showCancelButton: true,
    confirmButtonText: '送信',
    cancelButtonText: 'スキップ',
    didOpen: function() {
      window._feedbackRating = 0;
      window.setFeedbackRating = function(n) {
        window._feedbackRating = n;
        for (var i = 1; i <= 5; i++) {
          var btn = document.getElementById('star-btn-' + i);
          if (btn) btn.style.opacity = i <= n ? '1' : '0.3';
        }
        var lbl = document.getElementById('star-label');
        if (lbl) lbl.textContent = labels[n - 1] || '';
      };
    },
    preConfirm: function() {
      return {
        rating: window._feedbackRating,
        comment: document.getElementById('feedback-comment').value.trim()
      };
    }
  }).then(function(res) {
    if (!res.isConfirmed || !res.value) return;
    const { rating, comment } = res.value;
    if (rating === 0 && !comment) return; // 何も選ばずに送信した場合はスキップ
    google.script.run
      .withSuccessHandler(function() { /* silent */ })
      .withFailureHandler(function(e) { console.warn('Feedback save failed:', e.message); })
      .saveReportFeedback(targetDate, rating, comment, reportText);
  });
};
```

### 既存コードへの組み込み

`js.html` の中で、Slackへの投稿が成功したとき（`postSlack` の `withSuccessHandler`）のコールバック末尾に以下を追加する：

```javascript
// フィードバックモーダルを表示（Slack投稿成功後）
const targetDateStr = document.getElementById('manualDate').value;
const reportPreview = document.getElementById('reportPreview') ? document.getElementById('reportPreview').innerText : '';
showFeedbackModal(targetDateStr, reportPreview);
```

※ `postSlack` の成功ハンドラの場所は `js.html` を検索して特定すること。

---

## 機能D: AI業務改善フィードバックの刷新

### 問題点（現状）
- 「1行40〜60文字で」という制約が過度に厳しく、表面的・画一的な文章になっている
- 「評価できる点 / 改善すべき点 / プロジェクト傾向」は人事評価的で自分ごと感が薄い
- 「特になし」で埋められるセクションが多く、有用性が低い

### 改善方針
- **視点をコーチ/先輩に変える**: 上長への報告文ではなく、「信頼できる先輩が夕方に声をかけてくれる」ような語感に
- **ログの具体情報を必ず引用**: クライアント名・件数・時間帯などをログから抜き出して言及させる
- **行動提案を1つだけ具体的に出す**: 「明日これをやると差がつく」という一手
- **文体**: 簡潔だが体言止めではなく、語りかけ調（〜です、〜してみましょう、〜が気になります）
- **セクション構成を刷新**: 旧3項目→新4項目

### 新しいプロンプト（AI.jsの `DEFAULT_PROMPTS.reflection` を置き換え）

```
《オプション》【今日のふりかえり】ここからは役割を切り替えてください。
あなたは「現場をよく知る信頼できる先輩」です。
上記の日報ログを読んで、本人への**率直なふりかえりコメント**を書いてください。

### 重要ルール
1. **ログの固有情報を引用する**: クライアント名、Slackチャンネル名、Backlogのプロジェクト名、具体的なタスク内容などを必ずどこかに盛り込むこと。「具体的な記述が見当たらない」場合のみ「特になし」と書く。
2. **語りかけ調**: 箇条書きの体言止めではなく、「〜が良かったです」「〜を意識してみましょう」のような自然な文体にする。
3. **各項目は2〜3文**: 短すぎず、長すぎず。根拠→評価→一言アドバイスの流れを意識する。
4. **「明日の一手」は1つだけ**: 複数の提案をせず、最もインパクトがある行動だけを選ぶ。

### フィードバック項目（4セクション固定）

**1. 今日のWin（具体的な成果・突破口）**
今日のログの中で「前進した」「解決した」「顧客に喜ばれた（可能性がある）」場面を見つけ、具体的に言及する。
単なる「〇〇ができた」ではなく、「なぜそれが良かったか」まで一言添える。

**2. 気になるシグナル（ボトルネック・消化できなかった懸念）**
今日のログから「時間がかかっている」「積み残しになっている」「返答待ちが続いている」「同じ案件で同じ種類の作業が繰り返されている」などのシグナルを見つける。
判断材料がなければ「特になし」と書く（無理に捻り出さない）。

**3. 工数の偏り（時間配分のサマリと示唆）**
今日の業務ログを見て、どのクライアント・どの種類の作業に比重がかかっていたかを1〜2文で要約する。
「〇〇への対応が中心だった一日でした」のように事実を述べた上で、「来週以降〜を意識すると良さそうです」といった示唆を添える。

**4. 明日の一手（明日やると差がつく行動提案1つ）**
今日のログから見えた「これをやっておけば翌日・翌週がスムーズになる」行動を1つだけ提案する。
具体的に（「〇〇社のBacklog課題に先にコメントを入れておく」「△△の件でキーマンに事前連絡を入れる」のように）書く。

### 記述ルール（Slack表示用）
- 見出し: 「🪞 *今日のふりかえり*」
- 大項目: 「● 項目名」
- 本文: 「　」（全角スペース）から始める

### 出力フォーマット
--------------------------------------------------
🪞 *今日のふりかえり*
● 今日のWin
　A社様との定例でデータ同期の課題が解消できたのは大きな前進です。Slackでのやり取りから見ると、先週から引き続いていた問題に一区切りつけられました。顧客の信頼維持につながる動きができています。

● 気になるシグナル
　WCLプロジェクトの仕様調査が今週3日連続で登場しています。情報が散らばっている可能性があります。まとめドキュメントや有識者へのエスカレーションを検討してみましょう。

● 工数の偏り
　今日はB社様とその他・社内業務で時間の大半を占めた一日でした。A社様への対応が相対的に薄くなっているので、明日以降にバランスを意識できると良いかもしれません。

● 明日の一手
　Backlogに積まれているWCL-45の課題に、進捗メモを一言コメントしておきましょう。明日のMTGで聞かれる前に状況を整理しておくと、議論がスムーズに進みます。

--------------------------------------------------
```

### 変更箇所（AI.js）

`DEFAULT_PROMPTS.reflection` の文字列全体を上記の新プロンプトに置き換える。

**ES部版（`getDefaultPromptsES().reflection`）も同様に更新する**。
ES部版は「今日のWin」を営業文脈（商談の進展・顧客の反応）、「気になるシグナル」をフォローアップ漏れ・決裁遅延に寄せた内容に書き直す。ES部用バージョン：

```
《オプション》【今日の営業ふりかえり】ここからは役割を切り替えてください。
あなたは「現場経験豊富な先輩営業マネージャー」です。
上記の日報ログを読んで、本人への**率直な営業ふりかえりコメント**を書いてください。

### 重要ルール
1. **ログの固有情報を引用する**: 取引先名、商談フェーズ、提案内容、顧客の反応などを必ず引用する。
2. **語りかけ調**: 箇条書きの体言止めではなく、「〜が良い動きでした」「〜を意識してみましょう」のような文体にする。
3. **各項目は2〜3文**: 根拠→評価→一言アドバイスの流れを意識する。
4. **「明日の一手」は1つだけ**: 最もインパクトがある営業行動だけを選ぶ。

### フィードバック項目（4セクション固定）

**1. 今日のWin（商談の前進・顧客との関係構築）**
今日のログで「商談が進んだ」「顧客の信頼を得た」「合意を取り付けた」場面を具体的に言及する。

**2. 気になるシグナル（フォローアップ漏れ・停滞案件）**
「フォローが遅れている」「返答待ちが続いている」「同じ商談で同じ障壁が繰り返されている」シグナルを拾う。

**3. 案件の偏り（商談ポートフォリオのサマリ）**
今日どの取引先に時間がかかったか、どのフェーズの商談に集中していたかを要約し、来週への示唆を添える。

**4. 明日の一手（明日やると受注に近づく行動1つ）**
今日のログから見えた「明日これをやれば商談が前進する」行動を1つだけ、具体的に提案する。

### 記述ルール（Slack表示用）
- 見出し: 「🪞 *今日の営業ふりかえり*」
- 大項目: 「● 項目名」
- 本文: 「　」（全角スペース）から始める

### 出力フォーマット
--------------------------------------------------
🪞 *今日の営業ふりかえり*
● 今日のWin
　A社様との商談でROIへの懸念点を解消できたのは大きな前進です。次回の詳細提案MTGにスムーズにつながりました。顧客の関心が具体的なフェーズに入ってきているサインです。

● 気になるシグナル
　B社様の決裁プロセスが今週ずっと「確認中」のままです。キーマンへの直接アプローチかエスカレーションを検討するタイミングかもしれません。

● 案件の偏り
　今日はA社様とC社様への対応が中心でした。B社様への時間が取れていないので、明日は意識してコンタクトを入れてみましょう。

● 明日の一手
　B社様の担当者に「決裁の目安時期」を確認するメッセージを一本送っておきましょう。情報収集することで、受注見込み精度も上がります。

--------------------------------------------------
```

---

## 実装チェックリスト

### Config.js
- [ ] `savePromptVersion(department, label)` を追加
- [ ] `getPromptVersions(department)` を追加
- [ ] `getPromptVersionDetail(department, rowIndex)` を追加
- [ ] `restorePromptVersion(department, rowIndex)` を追加
- [ ] `saveDepartmentPrompts()` の先頭に `savePromptVersion()` 呼び出しを追加
- [ ] `saveReportFeedback(targetDate, rating, comment, reportExcerpt)` を追加
- [ ] `getOrSetupAppSheet()` の初期化ブロックに `フィードバック` シート作成を追加
- [ ] `suggestIgnoreWords()` を追加（Services.js か Config.js のどちらか近い方に）

### AI.js
- [ ] `DEFAULT_PROMPTS.reflection` を新プロンプトに置き換え
- [ ] `getDefaultPromptsES().reflection` を ES部版新プロンプトに置き換え

### js.html
- [ ] `openPromptVersionModal()` を追加
- [ ] `previewPromptVersion(dept, rowIndex)` を追加
- [ ] `restorePromptVersionConfirm(dept, rowIndex, btn)` を追加
- [ ] `openIgnoreWordSuggestModal()` を追加
- [ ] `showFeedbackModal(targetDate, reportText)` を追加
- [ ] Slack投稿成功ハンドラの末尾に `showFeedbackModal()` の呼び出しを追加

### Index.html
- [ ] 「📜 変更履歴」ボタンの `style="display:none"` を削除し `onclick` を `openPromptVersionModal()` に変更
- [ ] 除外設定に「💡 候補提案」ボタン（`openIgnoreWordSuggestModal()`）を追加

---

## 注意事項・実装上のポイント

1. **スプレッドシートのシート名**: `プロンプト履歴_CS`, `プロンプト履歴_ES`, `フィードバック` は新規作成。既存シートには触れない。
2. **バージョン保存のタイミング**: `savePromptVersion()` は `saveDepartmentPrompts()` の**書き込み前**に呼ぶ（現在の状態を記録してから上書きする）。
3. **`suggestIgnoreWords()` の配置**: `CalendarApp` を使うため GAS サーバー側（`.gs` または `.js`）ファイルに置く。
4. **Slack投稿成功ハンドラの場所**: `js.html` 内で `google.script.run...postSlack` または `postReport` のような関数呼び出しの `withSuccessHandler` を検索して特定すること。
5. **フィードバックのスキップ**: ユーザーが星を選ばずコメントも空のまま「送信」した場合は、GAS呼び出しをスキップして良い（無駄なAPIコールを避ける）。
6. **プロンプト更新時のキャッシュクリア**: `restorePromptVersion()` は内部で `saveDepartmentPrompts()` を呼ぶため、キャッシュクリアは自動で行われる。
