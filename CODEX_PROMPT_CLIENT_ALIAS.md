# CODEX実装依頼プロンプト集：クライアント名寄せ機能 UX改善

以下のプロンプトは、改善項目ごとに分割されています。
設計の詳細は `CODEX_DESIGN_CLIENT_ALIAS.md` を参照してください。

---

## プロンプト 1/5：動的フォームUIへの置き換え（最重要）

```
以下のGoogle Apps Script（GAS）プロジェクトのUIを改修してください。

# 対象プロジェクト
geminippo-gas（Slackへの日報を自動生成するGASアプリ）

# 改修対象ファイル
- Index.html
- js.html
- css.html

# 変更内容

## Index.html の変更

以下のDOMを「削除」してください：
```html
<div class="group">
  <label>🏷️ クライアント名寄せ辞書 (JSON形式)</label>
  <textarea id="clientAliasRules" ...></textarea>
  <div>canonical: ... / keywords: ...</div>
</div>
```

削除した箇所に「追加」してください（設計書 CODEX_DESIGN_CLIENT_ALIAS.md の「改善1 追加するもの」セクション参照）：
- フォールバック名称入力フィールド（id="clientFallbackName"）
- ルール行コンテナ（id="client-alias-container"）
- 「＋クライアントを追加」ボタン（onclick="addClientAliasRow()"）
- 「🔍 マッチテスト」ボタン（onclick="openAliasTestModal()"）
- バリデーションエラー表示エリア（id="alias-error"、初期display:none）
- 内部状態保持用hidden input（id="clientAliasRules"）

## css.html の変更

末尾に以下のCSSクラスを追加してください（設計書「改善1 CSSの追加」セクション参照）：
- .tag-input-container
- .tag-pill
- .tag-input-field

スタイルはアプリの既存のCSS変数（--accent, --border-color, --input-bg, --text-color）を使うこと。

## js.html の変更

以下の関数を新規追加してください。実装の詳細は設計書「改善1 実装詳細」セクションを参照：

1. `window.addClientAliasRow(data)`
   - client-alias-containerに1ルール分のカードを動的追加する
   - カード内には canonical入力、slackChannels/backlogKeys/keywords のタグ入力を含む
   - 削除ボタンで行ごと削除、削除後にserializeAliasRules()を呼ぶ

2. `buildTagInput(label, className, values, placeholder, rowId)`
   - タグ（pill）形式の入力コンポーネントHTMLを返す関数

3. `handleTagInputKey(e, input)`
   - EnterまたはカンマでcommitTagInputを呼ぶ

4. `commitTagInput(input)`
   - input.valueをタグとして確定してpillを生成し、serializeAliasRules()を呼ぶ

5. `removeTagPill(btn)`
   - btn.parentElement.remove()するだけ

6. `getTagValues(container)`
   - .tag-pill要素のテキスト（×を除く）を配列で返す

7. `serializeAliasRules()`
   - フォームの全ルール行をJSONシリアライズしてhidden#clientAliasRulesに格納

8. `loadAliasRulesIntoForm(jsonStr)`
   - JSONを解析してaddClientAliasRow()を繰り返し呼びフォームを復元する
   - 既存のclient-alias-containerをクリアしてから実行する

さらに、既存の以下の関数を修正してください：

- `collectAllSettings()`
  - 既存の `data.clientAliasRules = document.getElementById('clientAliasRules')?.value || '';` の直前にserializeAliasRules()を呼ぶ
  - `data.clientFallbackName = document.getElementById('clientFallbackName')?.value?.trim() || '● その他・社内業務';` を追加する

- ページ初期化処理（propsをフォームに適用している箇所）
  - `loadAliasRulesIntoForm(props.CLIENT_ALIAS_RULES || '[]');` を追加する
  - clientFallbackNameの初期値もセットする

- `applySettingsToForm(settings)`（インポート機能）
  - settings.clientAliasRules があれば loadAliasRulesIntoForm() を呼ぶ
  - settings.clientFallbackName があれば対応inputにセットする

# 注意事項
- 既存コードのスタイル・関数命名規則に合わせること
- Backlog行追加（addBacklogRow）と同様のUXパターンを踏襲すること
- タグ入力でEnterを押すと確定、×ボタンで削除できるようにすること
```

---

## プロンプト 2/5：保存時バリデーション＋エラー表示

```
以下のGoogle Apps Scriptプロジェクトに、名寄せ設定の保存時バリデーションを追加してください。

# 対象ファイル
- js.html
- Config.js
- Services.js

# 変更内容

## js.html の変更

`saveAllSettings()` 関数の先頭部分を修正してください：
1. `collectAllSettings()` を呼ぶ
2. 戻り値が null の場合は処理を中断してreturnする

`collectAllSettings()` 関数に以下のバリデーションを追加してください：
- `data.clientAliasRules` が存在する場合、JSON.parse()を試みる
- parseに失敗した場合：
  - id="alias-error" 要素に警告メッセージを表示（display:block）
  - 関数からnullをreturnして保存を中断する
- parseに成功した場合：
  - id="alias-error" 要素を非表示にする（display:none）

## Config.js の変更

`saveUserSettings(data)` 関数内の `propsToSave` オブジェクトに以下を追加してください：
```
'CLIENT_FALLBACK_NAME': data.clientFallbackName || '● その他・社内業務',
```

## Services.js の変更

`collectLogs()` 関数内の以下の行を変更してください：
- 変更前: `const fallbackClient = '● その他・社内業務';`
- 変更後: `const fallbackClient = props.CLIENT_FALLBACK_NAME || '● その他・社内業務';`

`collectPeriodLogsParallel()` 関数内の同じ行も同様に変更してください。

# 注意事項
- バリデーションエラーメッセージは日本語で表示すること
- エラーが解消されたら（正常保存時に）エラー表示を消すこと
```

---

## プロンプト 3/5：テストマッチ機能

```
以下のGoogle Apps Scriptプロジェクトに、名寄せルールのテストマッチ機能を追加してください。

# 対象ファイル
- js.html
- Services.js

# 変更内容

## js.html の変更

`openAliasTestModal()` 関数を追加してください（設計書「改善3」セクション参照）：
- SweetAlert2のモーダルを使う（既存コードはSwal.fireを使用済み）
- モーダル内のフォーム：
  - ソース種別選択（select）: other（汎用）/ slack / backlog
  - SlackチャンネルID入力（slack選択時のみ表示）
  - Backlogプロジェクトキー入力（backlog選択時のみ表示）
  - テキスト入力（textarea）
- 確定ボタン押下で `google.script.run.testClientAliasMatch()` を呼ぶ
- 結果はSwal.fireで表示：
  - マッチした場合：success、ルール番号とクライアント名を表示
  - マッチしなかった場合：warning、フォールバック名称を表示
- 呼び出し前に serializeAliasRules() を実行して最新状態を取得する

## Services.js の変更

`testClientAliasMatch(rulesJson, meta)` 関数を追加してください（設計書「改善3 バックエンド」参照）：
- 引数: rulesJson（JSON文字列）, meta（{ sourceType, channelId, projectKey, text }）
- 戻り値: { matched: string|null, ruleIndex: number }
- 実装は既存の createClientResolver() のロジックを参考にしつつ、
  どのルールにマッチしたかのインデックスも返すようにする
- マッチしなかった場合は ruleIndex: -1 を返す
- この関数はgoogle.script.runから呼べるトップレベル関数として定義する

# 注意事項
- 既存の createClientResolver() は変更しないこと（後方互換維持）
- テストはあくまで現在フォームに設定されているルールで行うこと（保存前でもテスト可能にする）
- GASのgoogle.script.run制約上、引数はJSONシリアライズ可能な値のみ使うこと
```

---

## プロンプト 4/5：Slackチャンネル検索ヘルパー

```
以下のGoogle Apps Scriptプロジェクトに、Slackチャンネル名からIDを検索する機能を追加してください。

# 対象ファイル
- js.html
- Services.js

# 前提
- Slack User Tokenは UserProperties の 'SLACK_USER_TOKEN' に保存済み
- 既存コードで Slack APIコールの実績がある（UrlFetchApp.fetchを使用）

# 変更内容

## js.html の変更

`openSlackChannelSearch(rowId)` 関数を追加してください（設計書「改善4 フロントエンド」参照）：
1. Swal.fireでキーワード入力モーダルを表示
2. キーワードが入力されたら google.script.run.searchSlackChannels(keyword) を呼ぶ
3. 結果チャンネルリストをselectで表示する第2モーダルを表示
4. ユーザーが選択して確定したら、対象行（rowId）の .alias-slack-tags コンテナにチャンネルIDをタグとして追加する
   - commitTagInput() を利用してタグを追加する
5. 結果が0件の場合は「見つかりません」メッセージを表示

## Services.js の変更

`searchSlackChannels(keyword)` 関数を追加してください（設計書「改善4 バックエンド」参照）：
- Slack conversations.list APIを呼び出す
- keywordで部分一致フィルタリングする（大文字小文字無視）
- アーカイブ済みチャンネルは除外する（exclude_archived=true）
- 最大30件を返す
- トークンがない場合は適切なエラーをthrowする
- 戻り値: Array<{ id: string, name: string }>

# 注意事項
- Slack APIのページネーション（cursor）に対応する（最大5ページまで）
- 30件見つかったら打ち切る
- エラー時はユーザーにわかりやすいメッセージを表示すること
```

---

## プロンプト 5/5：全体統合テスト確認（実装完了後に使用）

```
以下のGoogle Apps Scriptプロジェクトの名寄せ機能改善実装が完了しました。
以下の観点でコードレビューと動作確認チェックリストを作成してください。

# 対象ファイル
- Index.html
- css.html
- js.html
- Services.js
- Config.js

# 確認観点

## 機能確認
1. 「＋クライアントを追加」ボタンで行が追加されること
2. canonical、slackChannels、backlogKeys、keywordsが入力できること
3. タグ入力：Enterキーで確定、×ボタンで削除できること
4. 行の×ボタンで行全体が削除されること
5. 設定保存→ページリロード後にフォームが復元されること
6. 「マッチテスト」でソース種別/テキストを入力してテスト結果が表示されること
7. 「チャンネルIDを調べる」でキーワード検索→選択→タグ追加ができること
8. フォールバック名称を変更して保存→日報生成時に反映されること
9. 設定エクスポート→インポート後に名寄せ設定が復元されること

## エラー処理確認
10. clientAliasRulesのJSONが壊れている場合（旧データ互換）にページが壊れないこと
11. Slack Tokenがない状態でチャンネル検索を実行した場合に適切なエラーが出ること
12. ルールが0件でも日報生成が正常に動作すること

## 後方互換確認
13. createClientResolver()が変更されていないこと
14. 既存のcollectLogs()のマッチングロジックが変わっていないこと
15. 既存のsaveAllSettings()が正常動作すること

レビュー結果として、問題点があれば修正箇所と修正内容を具体的に指摘してください。
```

---

## 実装順序の推奨

```
プロンプト1 → プロンプト2 → プロンプト4 → プロンプト3 → プロンプト5
```

**理由：**
- プロンプト1（フォームUI）が基盤。最初に実装して動作確認する
- プロンプト2（バリデーション）はプロンプト1の `collectAllSettings()` 変更に依存する
- プロンプト4（チャンネル検索）はフロント・バックエンドが独立しており早めに実装できる
- プロンプト3（テストマッチ）はフォームUIが完成してからの方がテストしやすい
- プロンプト5は最後に全体レビューとして使う
