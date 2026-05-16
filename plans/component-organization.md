# コンポーネント整理ガイド

## 目的
- 画面ごとの実装差分を減らし、保守コストと見た目の揺れを抑える。

## 対象コンポーネント（現行）
- タブ: `.tab-btn`, `.content`, `.settings-content`
- 折りたたみ: `<details class="group">`
- 実行ボタン: `.btn.btn-primary`
- 補助ボタン: `.btn.btn-secondary`, `.btn-test`
- ステータス表示: `.status-container`, `.status-item`, `.status-badge`
- 結果表示: `.markdown-body`
- 切替タブ（結果内）: `.res-tab-btn`, `.res-tab-content`

## 再利用ルール
1. 主操作ボタン
- 1画面につき主操作は1つを基本。
- クラスは `btn btn-primary` を使う。

2. 折りたたみ
- 低頻度設定は `<details class="group">` へ統一。
- summary文言は `◯◯設定` または `◯◯一覧`。

3. テスト系操作
- 接続確認や更新は `btn-test` を使う。
- 破壊的操作には使わない。

4. 結果コンテナ
- Markdown描画先は `markdown-body` を使う。
- タブ内結果は `res-tab-content` で show/hide を統一。

## 実装上の注意
- `innerHTML` 注入箇所は表示専用データのみを許可し、リンクやラベルは必ずエスケープを通す。
- 新規コンポーネントを作る前に、既存クラスで代替できるか確認する。

## 追加時チェック
- 既存コンポーネントで表現できるか
- 既存命名規則に沿っているか
- ライト/ダーク両方で可読性が担保されるか
- スマホ幅で折り返し崩れがないか

