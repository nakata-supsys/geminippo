// ==========================================
// AI.gs: Gemini/Vertex AI 関連処理
// ==========================================

const DEFAULT_PROMPTS = {
  summary: `【要約モード用】
以下のログ（Slack / Backlog / Google Calendar / Gmail の活動記録）をもとに、今日の業務内容を簡潔に要約したビジネス日報を作成してください。
- 箇条書きで分かりやすく
- PMや上長への報告に適したトーンで

### 現在のモード
**要約モード（トピック箇条書き・超短縮スタイル）**

### 記述ルール（Slack表示用）
Slack API経由での投稿においてインデントを崩さないため、以下のルールを厳守してください。

#### 0. 案件・クライアントの特定（最優先ルール）
ログの情報を元に、タスクを正しいクライアント（大項目）に分類すること。**推測での紐付けは禁止**する。
- **判断基準**: Slackのチャンネル名（例: \`[#project-a]\`ならA社）、カレンダーの件名などを正とする。
- **Backlogの社名変換ルール**: プロジェクトキー（例: WCL）しか情報がない場合、**無理に日本語の社名を推測して捏造しないこと**。他の情報源（カレンダー等）から確証が得られない場合は、**「● WCL様」のようにキーのまま出力**すること。
- **迷った場合**: どの案件か明確な証拠がないタスクは、無理に特定のクライアントに紐付けず、**「{{FALLBACK_CLIENT_LABEL}}」** という大項目を作ってそこにまとめること。

#### 1. 共通フォーマット
{{BULLET_STYLE_RULES}}
- **トーン:** 体言止めで極めて簡潔に。
- **工数・進捗の禁止:** 本文の各箇条書きや見出しに、作業時間・工数・進捗率を記載しないこと。時間情報は「工数概算」セクションが有効な場合のみ、そこでのみ扱うこと。

#### 2. 本日のタスク（トピック箇条書き）
活動ログを「主要なトピック」ごとに箇条書きにし、極限まで短く記述すること。
- **使用するログセクション（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」のみを使用すること。「翌日」「翌営業日」「未完了課題」「未返信依頼」のセクションは「次回やること」専用のため、ここには含めないこと。
- **トピックごとの箇条書き**: 無理に1行にまとめず、**トピック（話題）が異なる場合は行を分ける**こと。
- **アクションの削除（体言止め徹底）**: 「実施」「参加」「調整」「確認」などの**動作動詞は削除**し、「〜の件」「〜対応」「〜方針策定」などの名詞形で終わらせる。
- ⭕️ 良い例：
・施策提案
・定例日程の提示
- ❌ 悪い例：
・施策提案を実施
・定例日程を提示した
- **禁止事項**: 文末・行頭を問わず「（会話・合意）」「（思考・作業）」「【顧客対応】」「【設計・戦略】」「【実装・代行】」等の工程分類ラベルを付記しないこと。これらは末尾の「工数概算」セクション専用であり、本文箇条書きへの混入は絶対に禁ずる。

#### 3. 次回やること（翌日・翌営業日連携）
「=== Googleカレンダー (翌日...) ===」「=== Googleカレンダー (翌営業日...) ===」「=== Backlog 未完了課題 ===」「=== Slack未返信依頼 ===」のセクションを使用すること。
- **重要（混在禁止）**: これらのセクションの情報は「次回やること」にのみ記載し、「本日のタスク」には絶対に含めないこと。
- **当日ログ流入禁止（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」の当日ログは「次回やること」に絶対に含めないこと。
- **記載ルール**: カレンダーに予定がある場合は、必ずクライアントごとに記載する。
- **注釈の禁止**: 「（翌日）」「（翌営業日）」「（予定）」といった注釈は一切記載しない。

#### 4. アイディア（収益拡大の種）・課題・ひとこと
- **アイディア**: 単なる感想ではなく、**アップセルやクロスセル（収益増）に繋がりそうな「提案の種」**を優先して抽出・記述すること。末尾に(A様)のように法人格を省いて付記。
- **アイディアの文量**: 1文が長くなる場合は、無理に1文に詰め込まず2文に分割して可読性を優先すること。
- **課題**: 発生したエラーやボトルネックを簡潔に。
- **ひとこと**: 必ず1行、一言で終わらせる。
- **ひとことのトーン**: 主観的感情（例: 安堵・不安）だけで締めず、進捗や見通しを中立的に表現すること。

### 【重要：出力制御】
1. 出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。
2. Backlog項目を含める場合も、他項目と同様に短縮を優先し、簡潔にまとめること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日のタスク*
{{BULLET_STYLE_SAMPLE}}
⛳ *次回やること*
● B株式会社様
　・MA設計まとめ作成
● A様
　・進捗確認MTG
:tossup: *アイディア/備忘*
・新規シナリオのまとめ割提案によるアップセル検討（C社様）
⚠️ *課題・困っていること*
・テスト環境のデータ同期遅延による検証待ち
💬 *ひとこと*
・週後半、タスクの消化が進み順調でした。

### 活動ログ
{{LOGS}}`,
  
  detail: `【詳細モード用】
以下のログをもとに、作業内容、技術的な挑戦、発生した課題などを詳細に記述したビジネス日報を作成してください。
- 時系列またはタスク別に整理
- 技術的なキーワードを含める
- 次の担当者が状況を把握できるように

### 現在のモード
**詳細モード（実務記録・技術ログ用）**

### 記述ルール（Slack表示用）
Slack API経由での投稿においてインデントを崩さないため、以下のルールを厳守してください。

#### 0. 案件・クライアントの特定（最優先ルール）
ログの情報を元に、タスクを正しいクライアント（大項目）に分類すること。**推測での紐付けは禁止**する。
- **判断基準**: Slackのチャンネル名（例: \`[#project-a]\`ならA社）、カレンダーの件名などを正とする。
- **Backlogの社名変換ルール**: プロジェクトキー（例: WCL）しか情報がない場合、**無理に日本語の社名を推測して捏造しないこと**。他の情報源（カレンダー等）から確証が得られない場合は、**「● WCL様」のようにキーのまま出力**すること。
- **迷った場合**: どの案件か明確な証拠がないタスクは、無理に特定のクライアントに紐付けず、**「{{FALLBACK_CLIENT_LABEL}}」** という大項目を作ってそこにまとめること。

#### 1. 共通フォーマット
{{BULLET_STYLE_RULES}}
- **トーン:** 事実ベースで具体的かつ、簡潔なトーン。
- **工数・進捗の禁止:** 本文の各箇条書きや見出しに、作業時間・工数・進捗率を記載しないこと。時間情報は「工数概算」セクションが有効な場合のみ、そこでのみ扱うこと。

#### 2. 本日のタスク（徹底分解ルール）
活動ログを元に、以下の**【徹底分解ルール】**に従って作成すること。
- **使用するログセクション（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」のみを使用すること。「翌日」「翌営業日」「未完了課題」「未返信依頼」のセクションは「次回やること」専用のため、ここには含めないこと。
- **分類ラベルの廃止**: 行頭に【顧客対応】や【作業】などの**分類タグは一切付けない**こと。
- **複合タスクの分離**: 「Aを作成してBを実施した」のような複合文は禁止。**「Aの作成」と「Bの実施」を別の行（箇条書き）に分ける**こと。
- **技術的詳細の記載**: 抽象化せず、具体的なテーブル名、カラム名、使用した関数、エラーコードなどの**技術的な固有名詞や数値をそのまま記載**する。
- **結果の併記**: 可能であれば、アクションの後ろに括弧書きで結果や状態を書く。
- **禁止事項**: 文末・行頭を問わず「（会話・合意）」「（思考・作業）」「【顧客対応】」「【設計・戦略】」「【実装・代行】」等の工程分類ラベルを付記しないこと。これらは末尾の「工数概算」セクション専用であり、本文箇条書きへの混入は絶対に禁ずる。

#### 3. 次回やること（翌日・翌営業日連携）
「=== Googleカレンダー (翌日...) ===」「=== Googleカレンダー (翌営業日...) ===」「=== Backlog 未完了課題 ===」「=== Slack未返信依頼 ===」のセクションを使用すること。
- **重要（混在禁止）**: これらのセクションの情報は「次回やること」にのみ記載し、「本日のタスク」には絶対に含めないこと。
- **当日ログ流入禁止（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」の当日ログは「次回やること」に絶対に含めないこと。
- **記載ルール**: カレンダーに予定がある場合は、必ずクライアントごとに記載する。
- **注釈の禁止**: 「（翌日）」「（翌営業日）」「（予定）」といった注釈は一切記載しない。

#### 4. アイディア（収益拡大の種）・課題・ひとこと
- **アイディア**: ログから読み取れる**アップセルやクロスセル（収益増）のヒント、追加提案のネタ**を優先して記述すること。（例：データの傾向から見て新機能の導入が有効、など）。末尾に(社名)を付記。
- **アイディアの文量**: 1文が長くなる場合は、無理に1文に詰め込まず2文に分割して可読性を優先すること。
- **課題**: 発生したエラーの詳細や、解決に時間を要したポイントなどを記録する。
- **ひとこと**: 1行で簡潔に。
- **ひとことのトーン**: 主観的感情（例: 安堵・不安）だけで締めず、進捗や見通しを中立的に表現すること。

### 【重要：出力制御】
1. 出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。
2. Backlog項目を含める場合も、他項目と同様に短縮を優先し、簡潔にまとめること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日のタスク*
{{BULLET_STYLE_SAMPLE}}
⛳ *次回やること*
● B株式会社様
　・新機能（レコメンド）の実装継続
:tossup: *アイディア/備忘*
・itemsテーブルの更新頻度課題に対し、リアルタイム連携オプションの提案余地あり（A様）
⚠️ *課題・困っていること*
・テスト環境のデータ同期が遅延しており、検証待ち時間が発生した
💬 *ひとこと*
・ロジックの複雑な部分を解決でき、技術的な理解が深まりました。

### 活動ログ
{{LOGS}}`,
  
  manhour: `《オプション》【工数概算】以下のログ内容と時間情報から、各タスクにかかった工数（時間）を推測・算出してください。
- 明確な時間が不明な場合は、タスクの重みから常識的な範囲で概算する
- 合計が実働時間（約8時間）から大きく乖離しないように調整する

### タスク分類定義（工数概算セクション専用）
**重要：この分類ラベルは末尾の「工数概算」セクションにのみ使用すること。本日のタスクの箇条書きには絶対に付記しないこと。**
以下の基準に従って、各タスクの内容を最も適切に表す分類ラベルを選択してください。
- 【設計・戦略】：分析シナリオ設計、施策策定、課題解決検討。
- 【実装・代行】：SQL作成、設定作業、作業代行。
- 【アウトプット作成】：資料、提案書、報告書作成。
- 【デリバリー準備】：MTG準備、レクチャー検討。
- 【仕様確認・検証】：仕様確認、調査、FAQ参照。
- 【不具合・技術調査】：挙動調査、バグ確認、技術相談。
- 【個別環境調査・復旧】：データ調査、ログ確認、エラー究明。
- 【顧客対応】：MTG、連絡、レクチャー。
- 【内部調整】：社内連携、相談。
- 【定型事務】：会議、事務作業。

#### 5. 工数概算（勤怠入力補助）
ログの時間情報から案件・タスク分類ごとの所要時間を計算し、以下のフォーマットで出力してください。

**出力フォーマット例**
--------------------------------------------------
⌛ *工数概算（勤怠入力補助）*
● A様
　・【顧客対応】定例MTG：計60分
　・【実装・代行】在庫ロジック実装：計40分
　・【仕様確認・検証】テスト配信確認：計20分
● B様
　・【実装・代行】レコメンド実装：計30分

合計作業時間：2時間30分`,
  
  reflection: `《オプション》【AI業務改善フィードバック】ここからは役割を切り替えてください。
あなたは「業務改善のプロフェッショナル」です。
上記で作成した日報を分析し、**本人向けのフィードバック**を行ってください。

### 重要：簡潔化ルール
読む負担を減らすため、以下のルールを厳守してください。
1. **短文記載**: 各項目は**1行（40〜60文字程度）**で簡潔に言い切る。長文・複文は禁止。
2. **厳選**: 各セクション**最大2点**まで。重要なことだけを書く。
3. **無理に書かない**: 判断材料が少ない、または特筆すべきことがない場合は、無理に捻り出さず「特になし」と記述する。

### フィードバック項目
1. **評価できる点**: 効率的だった動き、技術的な貢献など。
2. **改善すべき点**: 時間がかかりすぎている作業、属人化の予兆など。
3. **プロジェクト傾向**: 特定案件への偏り、フェーズの変化など。

### 記述ルール（Slack表示用）
1. **見出し:** 「🔍 *AI業務改善フィードバック*」
2. **大項目:** 「● 項目名」
3. **小項目:** 「・内容」

### 出力フォーマット
--------------------------------------------------
🔍 *AI業務改善フィードバック*
● 評価できる点
・SQL作成のプロンプト活用により、実装工数を大幅に短縮できている。
・顧客への技術的な回答が迅速で、信頼獲得に繋がっている。

● 改善すべき点
・A社の仕様調査に時間を要している。早めに有識者へエスカレーションすべき。

● プロジェクト傾向
・B社案件の稼働比率が急増中。来週以降のリソース調整が必要。

--------------------------------------------------`,

  aggregation: `あなたはベテランのプロジェクトマネージャーです。
以下の「活動ログ」に基づいて、指定された期間の【工数集計レポート】を作成してください。

### 目的
ユーザーが勤怠管理システム（TeamSpirit等）に工数を入力するための「思い出し補助」として使用します。

### 重要：プロジェクト名の正規化ルール
ユーザーから「正式なプロジェクト一覧」が提供された場合、**必ずそのリスト内の名称を使用**して分類してください。
- ログ: "A社定例MTG"
- リスト: "PROJ-101: A社様導入支援"
- **出力結果**: "PROJ-101: A社様導入支援" (ログの内容から最も近いものをリストから選ぶ)
- リストにない、または該当しないものは「その他・社内業務」としてください。

### 集計ルール
1. **時間の算出**:
   - **カレンダー**: 「(60分)」のような記載がある場合、その時間を正として集計してください。
   - **Slack/Backlog**: 具体的な時間が不明な活動は、内容の重さに応じて「1件あたり15分〜30分」程度と仮定して積み上げてください。
   - **合計調整**: 1日あたりの合計労働時間が「8時間〜10時間」程度に収まるように、過大な見積もりは自動的に圧縮・調整してください。

2. **並び順**: JSONブロック、プロジェクト別サマリ、各日の工数テーブルは、すべて**工数の多い順（降順）**に並べてください。ただし、「その他・社内業務」やそれに類する項目は、工数に関わらず**常に一番下に配置**してください。

3. **出力フォーマット（厳守）**:
   必ず以下の「JSONブロック」と「レポート本文」の2部構成で出力してください。
   挨拶や前置きは不要です。
   **重要: プロジェクト別サマリと日別データはMarkdownテーブル形式で出力すること。**

   \`\`\`json
   [
     {"label": "PROJ-101: A社様導入支援", "hours": 10.5},
     {"label": "PROJ-205: 社内基盤開発", "hours": 5.0},
     {"label": "その他・社内業務", "hours": 2.0}
   ]
   \`\`\`

   【集計期間】 {{DATE}}

   📊 **プロジェクト別サマリ**

   | プロジェクト | 合計時間 | 主な作業内容 |
   |---|---:|---|
   | PROJ-101: A社様導入支援 | 10.5h | 要件定義MTG、データ設計等 |
   | PROJ-205: 社内基盤開発 | 5.0h | API実装、テスト等 |
   | その他・社内業務 | 2.0h | 日報、定例会議等 |

   -----------------------------------
   📅 **日別・工数入力データ (TeamSpirit転記用)** 

   **【重要】日別データは、同じ「種別」のタスクを1行にグルーピングし、工数を合算、内容をまとめて記述してください。**

   | 日付 | 種別 | 工数(時間) | 内容 |
   |:---|:---|---:|:---|
   | **▼ MM/DD (曜) \| 合計: H.H時間** | | | |
   | | PROJ-101: A社様導入支援 | 4.5 | 定例MTG、データ設計、課題管理表の更新 |
   | | PROJ-205: 社内基盤開発 | 2.0 | API実装、テストコード作成 |
   | | その他・社内業務 | 1.5 | 全社MTG、日報作成 |

   ... (期間終了日まで繰り返し) ...

   -----------------------------------
   💰 期間総合計: Z.Z時間

### 活動ログ
{{LOGS}}`,
  clientSummary: `あなたはカスタマーサクセス担当の週次ステータス更新を支援するアシスタントです。
以下の抽出済みイベント以外の事実を一切追加しないでください。
推測や断定の追加は禁止です。根拠にないことは「要確認」と明記してください。
出力は以下の見出し順で作成してください。
進捗
主な対応（時系列）
懸念・リスク
次アクション
要確認`
};

const BULLET_STYLE_RULE_TEMPLATES = {
  plain: `- **物理整形:** Markdownの記号は使わず、全角スペースで字下げ・整形すること。
- **大項目:** 「● 略称＋様」。法人格を外し「様」を付与する。
- **小項目:** 「　・内容」。全角スペース＋中黒でタスクを列挙する。
- **階層化:** 2段構成は禁止。全て1段でフラットに書き、入れ子を作らない。
- **例:**
  ● A様
  　・施策提案の素案共有`,
  markdown: `- **物理整形:** Slackが解釈するMarkdownリスト（\`- \`）で出力する。記号は半角ハイフンのみ。
- **大項目:** 1段目にクライアント/取引先名を\`- A社様\`の形式で記載する。
- **小項目:** 半角スペース2つ＋\`- \`で2段目を作り、具体的なタスクを書く。
- **階層化:** クライアント→タスクの**最大2段構成**。3段以上のネストは絶対に作らないこと。
- **例:**
  - A社様
    - 施策提案の素案共有`
};

const BULLET_STYLE_SAMPLE_TEMPLATES = {
  plain: `● A様
　・施策提案MTG
　・アプリ内レコメンド連携対応
● その他・社内業務
　・日報AIツール改修
　・SSL証明書手続き対応`,
  markdown: `- A様
  - 施策提案MTG
  - アプリ内レコメンド連携対応
- その他・社内業務
  - 日報AIツール改修
  - SSL証明書手続き対応`
};

function getBulletStyleRulesText(style) {
  return BULLET_STYLE_RULE_TEMPLATES[style === 'markdown' ? 'markdown' : 'plain'];
}

function getBulletStyleSampleText(style) {
  return BULLET_STYLE_SAMPLE_TEMPLATES[style === 'markdown' ? 'markdown' : 'plain'];
}

function appendHitokotoVariationRules(promptText, dateStr) {
  if (!promptText || promptText.indexOf('ひとこと') === -1) return promptText;
  if (promptText.indexOf('【ひとこと個性化ルール】') !== -1) return promptText;
  const seed = dateStr || '対象日';
  return `${promptText}

【ひとこと個性化ルール】
- 「様々なタスクを対応しました」「引き続き頑張ります」「順調でした」のような汎用的な一言は禁止。
- その日のログに含まれる具体的な固有名詞、作業対象、会話の温度感、詰まったポイント、前進した小さな発見のいずれかを1つ拾い、本人らしい短い一言にすること。
- ${seed}のログから、その日だけの手触りが伝わる表現を選ぶこと。同じ言い回しを毎回繰り返さないこと。
- ふざけすぎず、Slackで上長やチームに見せても自然な範囲で、少しだけ個性のある文にすること。
- 20〜55文字程度、1行のみ。
- 同じ語尾（例: 「〜でした」「〜ます」）を連続使用しないこと。`;
}

function appendFeedbackVariationRules(promptText) {
  if (!promptText || promptText.indexOf('AI業務改善フィードバック') === -1) return promptText;
  if (promptText.indexOf('【フィードバック多様化ルール】') !== -1) return promptText;
  return `${promptText}

【フィードバック多様化ルール】
- 毎回同じ言い回し（例: 「迅速」「順調」「改善が必要」）を機械的に繰り返さないこと。
- 各項目は、当日のログにある具体物（案件名、作業対象、会話内容、判断、詰まり）を1つ以上含めること。
- 抽象語だけで終わらせず、何がどう良かった/課題だったかを短く具体化すること。
- 根拠の薄い称賛や断定は避け、観測事実ベースで書くこと。`;
}

function applyBulletStyleRules(promptText, style) {
  const rules = getBulletStyleRulesText(style);
  let text = promptText;
  if (!text.includes('{{BULLET_STYLE_RULES}}')) {
    const legacyPattern = /- \*\*物理整形:[\s\S]*?(?=\n- \*\*トーン)/g;
    const replaced = text.replace(legacyPattern, '{{BULLET_STYLE_RULES}}\n');
    if (replaced !== text) {
      text = replaced;
    } else {
      text = `${text}\n\n【箇条書き形式ルール】\n{{BULLET_STYLE_RULES}}`;
    }
  }
  text = text.replaceAll('{{BULLET_STYLE_RULES}}', rules);
  if (text.includes('{{BULLET_STYLE_SAMPLE}}')) {
    text = text.replaceAll('{{BULLET_STYLE_SAMPLE}}', getBulletStyleSampleText(style));
  }
  return text;
}

function applyFallbackClientLabel(promptText, fallbackLabel) {
  if (!promptText) return promptText;
  const normalized = (fallbackLabel || '● その他').toString().trim() || '● その他';
  const withoutBullet = normalized.replace(/^●\s*/, '').trim() || 'その他';
  return promptText
    .replaceAll('{{FALLBACK_CLIENT_LABEL}}', normalized)
    .replaceAll('その他・社内業務', withoutBullet);
}

function normalizeReportSpacing(text) {
  if (!text) return text;
  let normalized = String(text).replace(/\r\n/g, '\n');
  normalized = normalized.replace(/^(?:💡|:bulb:)\s*\*?アイディア\/備忘\*?\s*$/gm, ':tossup: アイディア/備忘');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  normalized = normalized.replace(
    /(【日報】[^\n]*)\n(?:[ \t]*\n)+(?=(?:👉|:point_right:))/,
    '$1\n\n'
  );
  normalized = normalized.replace(/(【日報】[^\n]*)\n{2,}(👉\s*\*本日のタスク\*)/g, '$1\n$2');
  normalized = normalized.replace(/(\n(?:⛳\s*\*次回やること\*|:tossup:\s*\*アイディア\/備忘\*|⚠️\s*\*課題・困っていること\*|💬\s*\*ひとこと\*))\n{2,}/g, '$1\n');
  const lines = normalized.split('\n');
  const sectionHeaderPattern = /^(?:👉|:point_right:|⛳|:golf:|:tossup:|⚠️|:warning:|💬|:speech_balloon:)\s*\*?.+\*?$/;
  const isSectionHeader = function(line) {
    return sectionHeaderPattern.test((line || '').trim());
  };
  const compact = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = compact.length > 0 ? compact[compact.length - 1] : '';
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    const isBlank = (line || '').trim() === '';
    if (isBlank) {
      // セクション見出しの前後にある空行は削除して詰める
      if (isSectionHeader(prev) || isSectionHeader(next)) continue;
      // 連続空行は1つまで
      if ((prev || '').trim() === '') continue;
    }
    compact.push(line);
  }
  return compact.join('\n').trim();
}

function formatReportByBulletStyle(reportText, style) {
  if (!reportText) return reportText;
  const formatted = (style === 'markdown') ? convertPlainToMarkdown(reportText) : convertMarkdownToPlain(reportText);
  return normalizeReportSpacing(stripSlackEmphasisMarkers(formatted));
}

function stripSlackEmphasisMarkers(text) {
  if (!text) return text;
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}

function convertPlainToMarkdown(text) {
  const lines = text.split('\n');
  const childMarker = /^[\u3000 ]*・\s*/;
  const hasPlainMarkers = /●/.test(text) || childMarker.test(text);
  if (!hasPlainMarkers && /(^|\n)\s*-\s+/.test(text)) {
    return normalizeMarkdownHierarchy(lines).join('\n');
  }
  let hasActiveParent = false;
  const converted = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      hasActiveParent = false;
      return line;
    }
    if (/^●\s*/.test(trimmed)) {
      const content = trimmed.replace(/^●\s*/, '');
      hasActiveParent = true;
      return `- ${content}`;
    }
    if (childMarker.test(line)) {
      const content = line.replace(childMarker, '');
      if (hasActiveParent) {
        return `  - ${content}`;
      }
      return `- ${content}`;
    }
    hasActiveParent = false;
    return line;
  });
  return converted.join('\n');
}

function normalizeMarkdownHierarchy(lines) {
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) return line;
    const rawIndent = (line.match(/^(\s*)/) || ['', ''])[1];
    const indentWidth = rawIndent.replace(/\t/g, '  ').length;
    const content = trimmed.slice(2).trim();
    if (indentWidth === 0) return `- ${content}`;
    // 1段以上はすべて2スペース（1段目）に正規化し、3段以上を防ぐ
    return `  - ${content}`;
  });
}

function convertMarkdownToPlain(text) {
  const lines = text.split('\n');
  const converted = lines.map(line => {
    const match = line.match(/^(\s*)-\s+(.*)$/);
    if (!match) return line;
    const indent = match[1] || '';
    const content = match[2];
    const indentWidth = indent.replace(/\t/g, '    ').length;
    if (indentWidth >= 2) {
      return `　・${content}`;
    }
    return `● ${content}`;
  });
  return converted.join('\n');
}

function getDefaultPrompts() {
  return DEFAULT_PROMPTS;
}

/**
 * ES部（営業部）向けのデフォルトプロンプトを返します
 * @returns {object} デフォルトプロンプト
 */
function getDefaultPromptsES() {
  return {
    summary: `【要約モード用 - ES部（営業）】
以下のログをもとに、営業活動の日報を作成してください。

### 現在のモード
**要約モード（営業活動報告・簡潔スタイル）**

### 記述ルール（Slack表示用）

#### 0. 商談・取引先の特定（最優先ルール）
ログの情報を元に、活動を正しい取引先（大項目）に分類すること。**推測での紐付けは禁止**する。
- **判断基準**: Slackのチャンネル名、カレンダーの件名、Backlog情報などを正とする。
- **迷った場合**: どの取引先か明確な証拠がない活動は、**「● その他・社内業務」** にまとめること。

#### 1. 共通フォーマット
{{BULLET_STYLE_RULES}}
- **トーン:** 体言止めで簡潔に。
- **工数・進捗の禁止:** 本文の各箇条書きや見出しに、作業時間・工数・進捗率を記載しないこと。時間情報は「工数概算」セクションが有効な場合のみ、そこでのみ扱うこと。

#### 2. 本日の営業活動
商談ごとに進捗状況を記載する。
- **商談情報の記載**: 「商談名（フェーズ）: 活動内容」の形式
- **活動内容**: 提案内容、顧客の反応、合意事項を簡潔に
- **体言止め**: 「実施」「参加」などの動詞は削除

#### 3. 次回やること
商談ごとのネクストアクションを記載。
- 「=== Googleカレンダー (翌日...) ===」「=== Googleカレンダー (翌営業日...) ===」「=== Backlog 未完了課題 ===」「=== Slack未返信依頼 ===」のセクションを使用すること。
- **重要（混在禁止）**: これらのセクションの情報は「次回やること」にのみ記載し、「本日の営業活動」には絶対に含めないこと。
- **当日ログ流入禁止（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」の当日ログは「次回やること」に絶対に含めないこと。
- カレンダーの予定がある場合は必ず記載
- 「（翌日）」「（翌営業日）」「（予定）」といった注釈は不要

#### 4. 受注見込み・アイディア・課題
- **受注見込み**: 確度が高い案件の状況（確度%を併記）
- **アイディア**: アップセル・クロスセルの提案ネタ。末尾に(取引先名)を付記
- **課題**: 障壁となっている課題、解決が必要な事項

#### 5. ひとこと
必ず1行、一言で終わらせる。

### 【重要：出力制御】
1. ログが大量にある場合、重要度の高いものに絞って記述すること。
2. 出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日の営業活動*
{{BULLET_STYLE_SAMPLE}}

⛳ *次回やること*
● A社様
　・詳細見積書の作成・提出
● B社様
　・詳細見積書の作成

💰 *受注見込み*
・A社様 既存契約更新: 来週中に受注見込み（確度90%）

:tossup: *アイディア/備忘*
・新規シナリオのまとめ割提案によるアップセル検討（C社様）

⚠️ *課題・困っていること*
・B社様の決裁プロセスが不明確、キーマンの特定が必要

💬 *ひとこと*
・A社様の新規案件が順調に進展、来月の受注目標達成に向けて好調です。

### 活動ログ
{{LOGS}}`,

    detail: `【詳細モード用 - ES部（営業）】
以下のログをもとに、営業活動の詳細な記録を作成してください。

### 現在のモード
**詳細モード（営業活動詳細記録）**

### 記述ルール（Slack表示用）

#### 0. 商談・取引先の特定（最優先ルール）
ログの情報を元に、活動を正しい取引先（大項目）に分類すること。**推測での紐付けは禁止**する。

#### 1. 共通フォーマット
{{BULLET_STYLE_RULES}}
- **トーン:** 事実ベースで具体的かつ、簡潔なトーン。
- **工数・進捗の禁止:** 本文の各箇条書きや見出しに、作業時間・工数・進捗率を記載しないこと。時間情報は「工数概算」セクションが有効な場合のみ、そこでのみ扱うこと。

#### 2. 本日の営業活動（徹底分解ルール）
- **分類ラベルの廃止**: 行頭に【商談】などのタグは付けない。
- **複合タスクの分離**: 「Aを作成してBを実施した」は禁止。別の行に分ける。
- **具体的な記載**: 商談名、取引先名、フェーズ、提案内容、顧客の反応、合意事項などを具体的に記載。
- **結果の併記**: アクションの後ろに括弧書きで結果や状態を書く。

#### 3. 次回やること
「=== Googleカレンダー (翌日...) ===」「=== Googleカレンダー (翌営業日...) ===」「=== Backlog 未完了課題 ===」「=== Slack未返信依頼 ===」のセクションを使用すること。
- **重要（混在禁止）**: これらのセクションの情報は「次回やること」にのみ記載し、「本日の営業活動」には絶対に含めないこと。
- **当日ログ流入禁止（厳守）**: 「=== Googleカレンダー ===」「=== Slack ===」「=== Gmail ===」「=== Backlog ===」の当日ログは「次回やること」に絶対に含めないこと。
- 注釈（「（翌日）」「（翌営業日）」「（予定）」等）は不要。

#### 4. 受注見込み・アイディア・課題
- **受注見込み**: 確度が高い案件の詳細な状況
- **アイディア**: アップセル・クロスセルのヒント、追加提案のネタ
- **課題**: 発生した課題の詳細、解決に時間を要したポイント

#### 5. ひとこと
1行で簡潔に。

### 【重要：出力制御】
出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日の営業活動*
{{BULLET_STYLE_SAMPLE}}

⛳ *次回やること*
● A社様
　・詳細見積書の作成・提出
● B社様
　・詳細見積書の完成・提出

💰 *受注見込み*
・A社様 既存契約更新: 来週中に受注見込み（確度90%、金額300万円）

:tossup: *アイディア/備忘*
・A社様の新規案件で、追加オプション（データ分析機能）の提案余地あり（A社様）

⚠️ *課題・困っていること*
・B社様の決裁プロセスが不明確、キーマンの特定が必要。次回MTGで確認予定。

💬 *ひとこと*
・A社様の新規案件が順調に進展、技術的な理解が深まりました。

### 活動ログ
{{LOGS}}`,

    manhour: `《オプション》【工数概算】以下のログ内容と時間情報から、各タスクにかかった工数（時間）を推測・算出してください。
- 明確な時間が不明な場合は、タスクの重みから常識的な範囲で概算する
- 合計が実働時間（約8時間）から大きく乖離しないように調整する

#### 5. 工数概算（勤怠入力補助）
ログの時間情報から取引先・活動分類ごとの所要時間を計算し、以下のフォーマットで出力してください。

**活動分類の定義**:
- 【商談・提案】: 商談MTG、提案活動、プレゼン
- 【見積・資料作成】: 見積書作成、提案資料作成
- 【顧客対応】: 問い合わせ対応、フォローアップ
- 【社内調整】: 社内連携、相談、報告
- 【事務作業】: 日報、経費精算、定例会議

**出力フォーマット例**
--------------------------------------------------
⌛ *工数概算（勤怠入力補助）*
● A社様
　・【商談・提案】要件ヒアリングMTG：計60分
　・【見積・資料作成】契約書作成：計40分
● B社様
　・【商談・提案】デモ実施：計90分
　・【見積・資料作成】見積書作成：計30分
● その他・社内業務
　・【事務作業】日報作成：計20分

合計作業時間：4時間`,

    reflection: `《オプション》【AI業務改善フィードバック】ここからは役割を切り替えてください。
あなたは「営業マネージャー」です。
上記で作成した日報を分析し、**本人向けのフィードバック**を行ってください。

### 重要：簡潔化ルール
1. **短文記載**: 各項目は**1行（40〜60文字程度）**で簡潔に言い切る。
2. **厳選**: 各セクション**最大2点**まで。
3. **無理に書かない**: 特筆すべきことがない場合は「特になし」と記述する。

### フィードバック項目
1. **評価できる点**: 効果的な営業活動、顧客との良好な関係構築など。
2. **改善すべき点**: フォローアップの遅れ、提案の弱さなど。
3. **案件傾向**: 特定案件への偏り、フェーズの変化、受注確度の推移など。

### 記述ルール（Slack表示用）
1. **見出し:** 「🔍 *AI業務改善フィードバック*」
2. **大項目:** 「● 項目名」
3. **小項目:** 「・内容」

### 出力フォーマット
--------------------------------------------------
🔍 *AI業務改善フィードバック*
● 評価できる点
・A社様の要件ヒアリングが丁寧で、顧客の信頼獲得に繋がっている。
・複数案件を並行して進めており、タイムマネジメントが良好。

● 改善すべき点
・B社様の決裁プロセスの確認が遅れている。早めにキーマンを特定すべき。

● 案件傾向
・A社様案件の受注確度が高まっている。来月の目標達成に向けて順調。

--------------------------------------------------`,

    aggregation: DEFAULT_PROMPTS.aggregation, // 集計モードは共通
    clientSummary: DEFAULT_PROMPTS.clientSummary
  };
}

function getUserModelRoutingProps_() {
  try {
    if (typeof PropertiesService === 'undefined' || !PropertiesService.getUserProperties) return {};
    return PropertiesService.getUserProperties().getProperties() || {};
  } catch (e) {
    return {};
  }
}

function normalizeModelId_(value, fallback) {
  const trimmed = (value || '').toString().trim();
  return trimmed || fallback;
}

function resolveGeminiModelId_() {
  const props = getUserModelRoutingProps_();
  return normalizeModelId_(props.REPORT_FLASH_MODEL_ID, 'gemini-2.5-flash');
}

function resolveVertexLocationForModel_(modelId) {
  const normalized = normalizeModelId_(modelId, 'gemini-2.5-flash');
  return /^gemini-3([.-]|$)/.test(normalized) ? 'global' : LOCATION;
}

function buildVertexGenerateContentUrl_(modelId) {
  const normalized = normalizeModelId_(modelId, 'gemini-2.5-flash');
  const requestLocation = resolveVertexLocationForModel_(normalized);
  const host = requestLocation === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${requestLocation}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${PROJECT_ID}/locations/${requestLocation}/publishers/google/models/${normalized}:generateContent`;
}

function extractBacklogLines_(logText, maxItems) {
  const text = String(logText || '');
  const match = text.match(/===\s*Backlog\s*===\n([\s\S]*?)(?:\n===|$)/);
  if (!match || !match[1]) return [];
  return match[1]
    .split('\n')
    .map(function(line) { return line.trim(); })
    .filter(function(line) { return !!line; })
    .slice(0, maxItems || 8);
}

function buildBacklogReflectionHint_(logText) {
  const backlogLines = extractBacklogLines_(logText, 8);
  if (!backlogLines.length) return '';
  return (
    `\n\n【重要: Backlog反映ルール（必須）】\n` +
    `- 「=== Backlog ===」に項目がある日は、「本日のタスク」にBacklog由来の内容を最低1件以上必ず含めること。\n` +
    `- 課題名・要点を保持し、根拠なく省略しないこと。\n` +
    `- 参考（Backlog抜粋）:\n${backlogLines.map(function(line) { return `  - ${line}`; }).join('\n')}`
  );
}

function normalizeReportRevisionInstruction_(instruction) {
  const raw = String(instruction || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const tags = [];
  if (lower.indexOf('簡潔') !== -1 || lower.indexOf('短く') !== -1) tags.push('brevity:high');
  if (lower.indexOf('丁寧') !== -1 || lower.indexOf('敬語') !== -1) tags.push('tone:polite');
  if (lower.indexOf('箇条書') !== -1 || lower.indexOf('整理') !== -1) tags.push('format:list');
  if (lower.indexOf('技術') !== -1 || lower.indexOf('詳しく') !== -1 || lower.indexOf('詳細') !== -1) tags.push('detail:technical');
  if (tags.length === 0) return raw;
  return `[${tags.join(', ')}] ${raw}`;
}

function buildRewriteFromDraftHint_(draftText) {
  const draft = String(draftText || '').trim();
  if (!draft) return '';
  const compact = draft.length > 4000 ? `${draft.substring(0, 4000)}\n...(下書きが長いため一部省略)` : draft;
  return (
    '\n\n【再生成モード（下書きベース）】\n' +
    '- 直前の下書きの構成・文脈を極力維持し、指示に必要な差分のみを反映すること。\n' +
    '- ログにない事実を追加しないこと。\n' +
    '- 以下が現在の下書き:\n' +
    compact
  );
}

function generateReportWithGemini(logText, prompts, reportMode, targetDate, reflection, manhour, dayFormat, bulletStyle, instruction, teamSpiritData, clients = [], fallbackClientLabel = '● その他', rewriteDraft = null) {
  const useModelId = resolveGeminiModelId_();
  const apiUrl = buildVertexGenerateContentUrl_(useModelId);
  
  let p = (reportMode === "詳細モード") ? prompts.detail : prompts.summary;
  p = applyBulletStyleRules(p, bulletStyle);
  p = applyFallbackClientLabel(p, fallbackClientLabel);
  
  if (manhour !== "なし") {
    p += "\n\n" + prompts.manhour;
    
    // TeamSpirit連携時の工数制約追加
    if (teamSpiritData) {
      p += calculateManhourConstraint(teamSpiritData, targetDate);
    }
  }
  
  if (reflection !== "なし") {
    p += "\n\n" + appendFeedbackVariationRules(prompts.reflection);
  }
  p += buildBacklogReflectionHint_(logText);
  const normalizedInstruction = normalizeReportRevisionInstruction_(instruction);
  if (normalizedInstruction) {
    p += `\n\n【重要：修正指示】\n上記の生成ルールに加え、以下の指示に従って書き直してください：\n${normalizedInstruction}`;
  }
  p += buildRewriteFromDraftHint_(rewriteDraft);
  if (clients && clients.length > 0) {
    const limited = clients.slice(0, 30);
    p += `\n\n【名寄せ済みクライアント一覧（以下の名称を見出しに使用すること）】\n${limited.map(c => `- ${c}`).join('\n')}`;
    if (clients.length > limited.length) {
      p += `\n- ...ほか${clients.length - limited.length}件`;
    }
  }
  
  // Services.jsに定義されているgetFormattedDateStringを利用
  const dateStr = getFormattedDateString(targetDate, dayFormat);
  p = appendHitokotoVariationRules(p, dateStr);
  // 日付ハルシネーション防止: プロンプト冒頭に日付を明示指定する
  const dateInstruction = `【最重要指示】本日の日付は「${dateStr}」です。【日報】ヘッダーには必ずこの日付をそのまま使用してください。別の日付を創作・推測することは絶対に禁止です。\n\n`;
  const promptText = (dateInstruction + p)
    .replaceAll('{{DATE}}', dateStr)
    .replaceAll('{{LOGS}}', logText);
  
  if (typeof global !== 'undefined' && global.IS_TESTING) return promptText;
  
  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "あなたは優秀なビジネスアシスタントです。ユーザーから提供される業務ログを元に、指定されたフォーマットで日報を作成してください。" }]
    },
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 32768 }
  });
  
  return callVertexAI(apiUrl, payload);
}

/**
 * TeamSpiritデータから工数制約を生成します
 * @param {object} teamSpiritData TeamSpirit打刻情報
 * @param {Date} targetDate 対象日
 * @returns {string} 工数制約プロンプト
 */
function calculateManhourConstraint(teamSpiritData, targetDate) {
  let maxHours = 8.0;
  let constraint = "";
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const isToday = (today.getTime() === target.getTime());
  
  if (teamSpiritData.realHours) {
    // 実労働時間が記録されている場合（過去日）
    maxHours = teamSpiritData.realHours;
    constraint = `\n\n【重要: 工数制約（TeamSpirit連携）】\n` +
                 `本日の実労働時間は ${maxHours} 時間です。\n` +
                 `各タスクの工数合計が、この時間を超えないように調整してください。`;
  } else if (teamSpiritData.startTime && isToday) {
    // 当日で出勤時刻のみの場合
    const now = new Date();
    const startTime = new Date(teamSpiritData.startTime);
    const elapsedHours = (now - startTime) / (1000 * 60 * 60);
    maxHours = Math.max(Math.min(elapsedHours - 1, 10), 1); // 休憩1時間を差し引き、上限10時間、下限1時間
    constraint = `\n\n【重要: 工数制約（TeamSpirit連携）】\n` +
                 `本日の出勤時刻は ${Utilities.formatDate(startTime, 'JST', 'HH:mm')} です。\n` +
                 `現在までの経過時間から、工数合計は約 ${maxHours.toFixed(1)} 時間以内に収めてください。`;
  }
  
  return constraint;
}

function generateAggregationWithGemini(logText, start, end, projectList, avgWorkHours, instruction, customPrompt, clients = [], projectAliasRulesPrompt = '') {
  const prompts = getPromptSettings();
  // カスタムプロンプトが渡された場合はそれを優先し、なければ設定画面のプロンプトを使う
  let p = customPrompt || prompts.aggregation;
  const useModelId = resolveGeminiModelId_();
  const apiUrl = buildVertexGenerateContentUrl_(useModelId);

  if (projectList && projectList.trim() !== "") {
    p += `\n\n【正式なプロジェクト一覧 (この名称に変換すること)】\n${projectList}\n`;
  }
  if (projectAliasRulesPrompt && String(projectAliasRulesPrompt).trim() !== '') {
    p += `\n\n${projectAliasRulesPrompt}\n`;
  }
  if (avgWorkHours) {
    p += `\n\n【重要：工数調整ルール】\n` +
         `1日あたりの合計工数が、ユーザー指定の「${avgWorkHours}時間」に近づくように、各タスクの工数を調整してください。\n` +
         `ただし、ログの内容とかけ離れた不自然な調整はしないでください。\n`;
  }
  if (instruction) {
    p += `\n\n【重要：修正指示】\n上記の生成ルールに加え、以下の指示に従って書き直してください：\n${instruction}`;
  }
  if (clients && clients.length > 0) {
    const limited = clients.slice(0, 30);
    p += `\n\n【名寄せ済みクライアント一覧（この名称に分類すること）】\n${limited.map(c => `- ${c}`).join('\n')}`;
    if (clients.length > limited.length) {
      p += `\n- ...ほか${clients.length - limited.length}件`;
    }
  }

  // Services.jsに定義されているgetFormattedDateStringを利用
  const dateRangeStr = `${Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy/MM/dd')} 〜 ${Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy/MM/dd')}`;
  const promptText = p.replaceAll('{{DATE}}', dateRangeStr).replaceAll('{{LOGS}}', logText);

  // ★修正: テスト実行時はプロンプトをそのまま返す
  if (typeof global !== 'undefined' && global.IS_TESTING) return promptText;

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: "あなたはデータ出力マシンです。挨拶は禁止です。" }] },
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 32768 }
  });

  return callVertexAI(apiUrl, payload);
}

/**
 * クライアント別サマリを生成します（抽出済みイベントのみを入力に使用）。
 * @param {string} clientName
 * @param {Array<Object>} extractedEvents [{timestampJst, source, text, evidenceLabel}]
 * @param {Date} start
 * @param {Date} end
 * @param {string} customPrompt
 * @returns {string}
 */
function generateClientSummaryWithGemini(clientName, extractedEvents, start, end, customPrompt) {
  const useModelId = resolveGeminiModelId_();
  const apiUrl = buildVertexGenerateContentUrl_(useModelId);
  const range = `${Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy/MM/dd')} 〜 ${Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy/MM/dd')}`;
  const defaultPrompt = [
    'あなたはカスタマーサクセス担当の週次ステータス更新を支援するアシスタントです。',
    '以下の抽出済みイベント以外の事実を一切追加しないでください。',
    '推測や断定の追加は禁止です。根拠にないことは「要確認」と明記してください。',
    '出力は以下の見出し順で作成してください。',
    '進捗',
    '主な対応（時系列）',
    '懸念・リスク',
    '次アクション',
    '要確認',
    '',
    '出力形式ルール（厳守）:',
    '- Markdown記法（#, -, *, 1. など）は使わないこと',
    '- 大項目は「● 」で始めること（例: ● 進捗）',
    '- 中項目は全角スペース1つ+「・ 」で始めること（例: 　・ 更新あり）',
    '- 小項目は全角スペース2つ+「- 」で始めること（例: 　　- 補足）',
    '- 「主な対応（時系列）」は中項目を「・ yyyy/MM/dd HH:mm ：」形式で記載すること',
    '- 「主な対応（時系列）」の各中項目の直下に、小項目「　　- 」で具体対応を1件以上記載すること',
    '- 日時や固有名詞は抽出済みイベントにある情報のみを使うこと'
  ].join('\n');
  const p = (customPrompt && String(customPrompt).trim()) || defaultPrompt;
  const eventLines = (extractedEvents || []).map(function(ev, idx) {
    return `${idx + 1}. [${ev.timestampJst}] [${ev.source}] ${ev.text}`;
  }).join('\n');
  const promptText = [
    p,
    '',
    `対象クライアント: ${clientName}`,
    `対象期間: ${range}`,
    '',
    '抽出済みイベント:',
    eventLines || 'なし',
    '',
    '制約:',
    '- 「主な対応（時系列）」は日時（yyyy/MM/dd HH:mm）付きで時系列順に並べること',
    '- 情報が不足している場合は「情報不足（要確認）」と明記すること',
    '- 出力は日本語',
    '- 見出し行は「● 見出し名」の形式にすること',
    '- 箇条書きは中項目「　・ 」、必要に応じて小項目「　　- 」を使うこと',
    '- 「主な対応（時系列）」は「・ yyyy/MM/dd HH:mm ：」の直下に「　　- 詳細」を置くこと'
  ].join('\n');

  if (typeof global !== 'undefined' && global.IS_TESTING) return promptText;

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: "あなたは事実整形アシスタントです。与えられたイベント以外は出力しません。" }] },
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
  });
  return callVertexAI(apiUrl, payload);
}

/**
 * Gemini API呼び出し共通処理
 * ★修正: エラーハンドリングを強化し、ユーザーフレンドリーなメッセージを返すように修正
 */
function callVertexAI(apiUrl, payload) {
  const effectiveProjectId = (typeof global !== 'undefined' && global.__TEST_PROJECT_ID) ? global.__TEST_PROJECT_ID : PROJECT_ID;
  if (!effectiveProjectId) {
    throw new Error(
      "⚠️ 【設定エラー】GCPプロジェクトIDが設定されていません。\n" +
      "スクリプトプロパティ「GCP_PROJECT_ID」にプロジェクトIDを設定してください。"
    );
  }
  const commonPayload = JSON.parse(payload);
  commonPayload.safetySettings = [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }
  ];
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Goog-User-Project': effectiveProjectId
    },
    payload: JSON.stringify(commonPayload),
    muteHttpExceptions: true // エラー時もResponseオブジェクトを受け取る
  };

  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = UrlFetchApp.fetch(apiUrl, options);
    const txt = res.getContentText();
    const responseCode = res.getResponseCode();

    // ログ出力（デバッグ用）
    console.log(`【Gemini Response Log】 (Status: ${responseCode})`, txt.substring(0, 500) + "...");
    
    // --- エラーハンドリング強化 ---
    if (responseCode !== 200) {
      
      // 400 Bad Request (不正なリクエスト) の場合
      if (responseCode === 400) {
        throw new Error(
          "⚠️ 【AIリクエストエラー】\n" +
          "AIへのリクエスト内容に問題がある可能性があります。\n\n" +
          "【対応方法】\n" +
          "「プロンプト」タブの内容をデフォルトに戻してみるか、記述がAIのルールに沿っているか確認してください。"
        );
      }

      // 403 Permission Denied (権限不足) の場合
      if (responseCode === 403) {
        throw new Error(
          "⚠️ 【AI実行権限エラー】\n" +
          "あなたのGoogleアカウントには、このシステムのAI (Vertex AI) を実行する権限が付与されていません。\n\n" +
          "【対応方法】\n" +
          "管理者に連絡し、Google Cloudプロジェクトへのアクセス権限を確認してください。"
        );
      }

      // 429 Too Many Requests (クォータ不足) の場合
      if (responseCode === 429) {
        throw new Error(
          "⚠️ 【AI利用制限】\n" +
          "短時間にアクセスが集中したため、一時的に利用できません。\n" +
          "数分待って（少し時間をおいて）から再試行してください。"
        );
      }

      // 5xx Server Error (サーバー側エラー) の場合
      if (responseCode >= 500) {
        throw new Error(
          "⚠️ 【AIサーバーエラー】\n" +
          "現在、AIサーバー側で一時的な問題が発生しているようです。\n" +
          "大変お手数ですが、しばらく時間をおいてから再度お試しください。"
        );
      }

      // その他のエラー
      let errorTitle = `⚠️【不明なAIエラー】(${responseCode})\n`;
      let errorMessage = "";
      try {
        const jsonErr = JSON.parse(txt);
        if (jsonErr.error && jsonErr.error.message) {
          errorMessage = jsonErr.error.message;
        }
      } catch(e) {
        errorMessage = txt;
      }
      throw new Error(errorTitle + errorMessage);
    }
    // ---------------------------

    let json;
    
    try { 
      json = JSON.parse(txt); 
    } catch (e) { 
      throw new Error(`Vertex AIからの応答が不正です。\n内容: ${txt.substring(0, 100)}...`); 
    }

    // 途中で止まった場合のログ
    if (json.candidates && json.candidates[0] && json.candidates[0].finishReason) {
        const finishReason = json.candidates[0].finishReason;
        console.log("Finish Reason:", finishReason);
        if (finishReason === 'SAFETY') {
            return "⚠️ 【警告】AIの安全フィルターにより、生成が中断されました。";
        }
        if (finishReason === 'MAX_TOKENS') {
            console.warn("Gemini output was truncated due to MAX_TOKENS limit.");
            const parts = json.candidates[0].content && json.candidates[0].content.parts;
            if (parts && parts.length > 0) {
                return parts[0].text + "\n\n⚠️ 【注意】AIの出力が長さ制限により途中で切れている可能性があります。";
            }
            throw new Error("AIからの応答が空でした（MAX_TOKENS到達）。");
        }
    }
    
    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content
        || !json.candidates[0].content.parts || json.candidates[0].content.parts.length === 0) {

        // ★改善案: 安全フィルターによるブロックの可能性をユーザーに通知する
        if (json.promptFeedback && json.promptFeedback.blockReason) {
          const reason = json.promptFeedback.blockReason;
          console.warn(`AI response was empty. Block Reason: ${reason}`);
          throw new Error(
            `⚠️ 【生成ブロック】\nAIの安全フィルターが作動したため、応答を生成できませんでした。(理由: ${reason})\n\n` +
            "ログに不適切な単語が含まれていないか確認するか、時間を置いて再度お試しください。"
          );
        }
        throw new Error("AIからの応答が空でした。");
    }

      return json.candidates[0].content.parts[0].text;

    } catch (e) {
      const message = String((e && e.message) || e || '');
      const retryable =
        /HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/.test(message) ||
        /Too Many Requests|Service Unavailable|Gateway Timeout/.test(message) ||
        /timed out|Exception: Request failed|network|connection/i.test(message);
      lastError = e;
      if (!retryable || attempt === maxAttempts) {
        console.warn("Vertex AI Error: " + message);
        throw e;
      }
      // 400ms, 800ms + jitter（最大250ms）
      const base = 400 * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      Utilities.sleep(base + jitter);
    }
  }
  throw lastError || new Error('Vertex AI request failed.');
}

// ==========================================
// 今日のTODO生成
// ==========================================

const MAX_TODO_LOG_CHARS = 18000;

const TODO_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    top_priority: {
      type: 'ARRAY',
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          source_id: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    other_tasks: {
      type: 'ARRAY',
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          source_id: { type: 'STRING' }
        },
        required: ['text']
      }
    },
    slack_pending: {
      type: 'ARRAY',
      maxItems: 5,
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          source_id: { type: 'STRING' }
        },
        required: ['text']
      }
    }
  },
  required: ['top_priority', 'other_tasks', 'slack_pending']
};

const TODO_STRUCTURED_PROMPT = `あなたは優秀なタスクマネージャーです。
入力ログを分析し、今日実施すべきTODOを抽出してください。

### 厳守ルール
- JSON以外を出力しないこと。
- 各配列は最大5件、各項目は60文字以内。
- 各項目は1タスク1行の短文にし、冗長な説明は禁止。
- 該当がない配列は空配列 [] を返す。
- 優先度は「期限が近い」「返信待ち」「依存タスク」を優先。
- 入力ログに含まれる [ID:XXXX] はリンク紐づけ用。該当タスクを採用した場合は source_id に同じIDを必ず設定すること。
- 出力textには [ID:XXXX] を含めないこと。
- Backlog由来タスクを採用した場合は source_id を必ず設定すること（BL_ で始まるID）。
- Slack未返信由来タスクを採用した場合は source_id を必ず設定すること（SLK_ で始まるID）。

### 活動ログ
{{LOGS}}`;

const TODO_FALLBACK_PROMPT = `以下のログから、今日のTODOをMarkdownで簡潔に作成してください。

### 厳守ルール
- 合計9件まで（各セクション最大3件）。
- 各行は必ず「- 」で開始し、60文字以内。
- 前置き・後書きは禁止。
- セクションはこの順序で固定:
  1) 🟥 最優先
  2) 💬 Slack未返信
  3) 📋 その他のタスク

### 活動ログ
{{LOGS}}`;

function generateTodaysTodoWithGemini(logText, today) {
  const useModelId = resolveGeminiModelId_();
  const apiUrl = buildVertexGenerateContentUrl_(useModelId);
  const dateStr = Utilities.formatDate(today, 'JST', 'yyyy/MM/dd(E)');
  let normalizedLog = logText || '';
  let isLogTruncated = false;
  if (normalizedLog.length > MAX_TODO_LOG_CHARS) {
    normalizedLog = normalizedLog.slice(0, MAX_TODO_LOG_CHARS) + '\n...(ログが多かったため省略)';
    isLogTruncated = true;
  }
  const structuredPrompt = TODO_STRUCTURED_PROMPT
    .replaceAll('{{LOGS}}', normalizedLog);

  const structuredPayload = JSON.stringify({
    systemInstruction: { parts: [{ text: 'あなたはタスク抽出器です。指定スキーマ準拠のJSONのみを返してください。' }] },
    contents: [{ role: "user", parts: [{ text: structuredPrompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: TODO_RESPONSE_SCHEMA
    }
  });

  try {
    const jsonText = callVertexAI(apiUrl, structuredPayload);
    const structured = parseTodoJsonResponse_(jsonText);
    const markdown = formatStructuredTodoAsMarkdown_(structured, dateStr);
    return { text: markdown, truncatedInput: isLogTruncated };
  } catch (e) {
    // JSON整形に失敗した場合は、出力量を強く制限したプレーン生成にフォールバック
    try {
      const compactLog = normalizedLog.length > 12000 ? normalizedLog.slice(0, 12000) : normalizedLog;
      const fallbackPrompt = TODO_FALLBACK_PROMPT.replaceAll('{{LOGS}}', compactLog);
      const fallbackPayload = JSON.stringify({
        systemInstruction: { parts: [{ text: 'あなたは優秀なタスクマネージャーです。短く実用的なTODOを返してください。' }] },
        contents: [{ role: "user", parts: [{ text: fallbackPrompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      });
      const fallback = callVertexAI(apiUrl, fallbackPayload);
      return { text: fallback, truncatedInput: isLogTruncated };
    } catch (fallbackErr) {
      const emergency = buildEmergencyTodoFromLogText_(normalizedLog, dateStr);
      return { text: emergency, truncatedInput: isLogTruncated };
    }
  }
}

function buildEmergencyTodoFromLogText_(logText, dateStr) {
  const lines = String(logText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(function(line) { return line.replace(/\[ID:[^\]]+\]/g, '').trim(); })
    .filter(function(line) {
      return !!line && !/^===.+===\s*$/.test(line);
    });

  function pick(max, matcher) {
    const out = [];
    const seen = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!matcher(line)) continue;
      const normalized = line.replace(/\s+/g, ' ').trim();
      if (!normalized || seen[normalized]) continue;
      seen[normalized] = true;
      out.push(normalized.length > 60 ? `${normalized.substring(0, 57)}...` : normalized);
      if (out.length >= max) break;
    }
    return out;
  }

  const backlog = pick(3, function(line) { return /\[Backlog\]|期限|課題|未完了/i.test(line); });
  const pending = pick(3, function(line) { return /Slack未返信|未返信|返信/i.test(line); });
  const misc = pick(3, function(line) { return true; });

  function fmt(items) {
    if (!items || items.length === 0) return '- なし';
    return items.map(function(item) { return `- ${item}`; }).join('\n');
  }

  return [
    `【今日のTODO】${dateStr}`,
    '',
    '🟥 最優先',
    fmt(backlog.length ? backlog : misc.slice(0, 2)),
    '',
    '💬 Slack未返信',
    fmt(pending),
    '',
    '📋 その他のタスク',
    fmt(misc)
  ].join('\n');
}

function parseTodoJsonResponse_(jsonText) {
  const raw = (jsonText || '').trim();
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) || {};
  } catch (e) {
    const extracted = extractFirstJsonObject_(cleaned);
    if (extracted) {
      try {
        return JSON.parse(extracted) || {};
      } catch (nested) {}
    }
    throw new Error(`TODO JSONパース失敗: ${e.message} / raw="${cleaned.slice(0, 200)}"`);
  }
}

function extractFirstJsonObject_(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  return s.substring(start, end + 1);
}

function getTodoUrgencyRank_(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 9;
  if (/期限切れ|overdue/.test(t)) return 0;
  if (/至急|urgent|本日中|今日中|即時|早急/.test(t)) return 1;
  if (/期限:\s*[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(t)) return 2;
  if (/ご確認|確認お願いします|お願いします|ご対応|対応お願いします|返信/.test(t)) return 3;
  return 5;
}

function getTodoSourceRank_(sourceId) {
  if (!sourceId) return 9;
  if (sourceId.indexOf('BL_') === 0) return 1;
  if (sourceId.indexOf('SLK_') === 0) return 2;
  return 9;
}

function normalizeTodoItems_(items, maxItems) {
  const list = Array.isArray(items) ? items : [];
  const dedup = {};
  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    let text = '';
    let sourceId = '';
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      text = (raw.text || '').toString();
      sourceId = (raw.source_id || '').toString().trim();
    } else {
      text = (raw || '').toString();
    }
    const item = text.replace(/\s+/g, ' ').replace(/\[ID:[^\]]+\]/g, '').trim();
    if (/^===.+===\s*$/i.test(item)) continue;
    if (!item) continue;
    const key = `${item.toLowerCase()}__${sourceId}`;
    if (dedup[key]) continue;
    dedup[key] = true;
    normalized.push({
      text: item.length > 60 ? `${item.substring(0, 57)}...` : item,
      sourceId: sourceId
    });
  }
  normalized.sort(function(a, b) {
    const urgencyA = getTodoUrgencyRank_(a.text || '');
    const urgencyB = getTodoUrgencyRank_(b.text || '');
    if (urgencyA !== urgencyB) return urgencyA - urgencyB;
    const sourceA = getTodoSourceRank_(a.sourceId || '');
    const sourceB = getTodoSourceRank_(b.sourceId || '');
    if (sourceA !== sourceB) return sourceA - sourceB;
    return 0;
  });
  if (normalized.length > maxItems) {
    return normalized.slice(0, maxItems);
  }
  return normalized;
}

function pickUniqueTodoItems_(items, sharedSeenMap) {
  const safeItems = normalizeTodoItems_(items, 12);
  const result = [];
  for (let i = 0; i < safeItems.length; i++) {
    const item = safeItems[i];
    const key = String(item && item.text || '').toLowerCase();
    if (!key || sharedSeenMap[key]) continue;
    sharedSeenMap[key] = true;
    result.push(item);
    if (result.length >= 5) break;
  }
  return result;
}

function formatTodoSectionItems_(title, items) {
  const lines = items.length > 0
    ? items.map(function(item) {
        if (item.sourceId) {
          return `- ${item.text} <!--SRC:${item.sourceId}-->`;
        }
        return `- ${item.text}`;
      })
    : ['- なし'];
  return `${title}\n${lines.join('\n')}`;
}

function formatStructuredTodoAsMarkdown_(todoJson, dateStr) {
  const data = todoJson || {};
  const seen = {};
  const top = pickUniqueTodoItems_(data.top_priority, seen);
  const slack = pickUniqueTodoItems_(data.slack_pending, seen);
  const other = pickUniqueTodoItems_(data.other_tasks, seen);
  const sections = [
    `【今日のTODO】${dateStr}`,
    '',
    formatTodoSectionItems_('🟥 最優先', top),
    '',
    formatTodoSectionItems_('💬 Slack未返信', slack),
    '',
    formatTodoSectionItems_('📋 その他のタスク', other)
  ];
  return sections.join('\n');
}
