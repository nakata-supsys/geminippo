# CODEX実装依頼プロンプト：タブ構成の整理（名寄せ設定の移動）

```
以下のGoogle Apps Script（GAS）プロジェクトのUIを改修してください。

# 対象プロジェクト
geminippo-gas（Slackへの日報を自動生成するGASアプリ）

# 対象ファイル
- Index.html のみ

# 変更の背景
「工数集計」タブに集計操作UIと設定（マスターデータ）が混在しており、
ユーザーが設定を探しにくい状態になっている。
「クライアント名寄せ設定」はBacklog連携設定と性格が近いため、
「接続設定」タブに移動して整理する。

# 変更内容

## Step 1：工数集計タブから名寄せ設定ブロックを削除

`data-tab="aggregation"` コンテンツ内の以下のブロック（🏷️クライアント名寄せ設定 の group div 全体）を削除してください：

削除対象：
- `<div class="group">` で始まり、以下の要素をすべて含むブロック
  - `<label>🏷️ クライアント名寄せ設定</label>`（または同等のラベル）
  - `id="clientFallbackName"` の input
  - `id="client-alias-container"` の div
  - `addClientAliasRow()` と `openAliasTestModal()` のボタン
  - `id="alias-error"` の div
  - `id="clientAliasRules"` の hidden input

## Step 2：接続設定タブのBacklog連携の直後に名寄せ設定ブロックを追加

`data-tab="connection"` コンテンツ内の `id="backlog-container"` を含む group div の**直後**（保存ボタンの前）に、Step 1 で削除したブロックをそのまま挿入してください。

挿入するブロックはStep 1で削除した内容と完全に同一です。
要素の id・クラス・onclick属性はすべて変更しないこと。

## 変更後のタブ構成イメージ

### 接続設定タブ（変更後）
1. Vertex AI接続確認
2. Slack投稿先
3. 🚫 除外設定
4. Backlog連携
5. 🏷️ クライアント名寄せ設定  ← ここに移動
6. 保存ボタン

### 工数集計タブ（変更後）
1. 集計対象期間
2. 期間中の平均稼働時間
3. TeamSpiritプロジェクト一覧
4. 集計を開始ボタン
5. 結果エリア

# 注意事項
- JSや他のファイルは変更しないこと（id/onclickは同一のため変更不要）
- 移動するブロックの内部構造・属性はすべて保持すること
- 接続設定タブの保存ボタン（saveAllSettings）はBacklog設定と名寄せ設定の両方を保存するため、移動後も共有で問題ない
```
