// ==========================================
// AI.gs: Gemini/Vertex AI 関連処理
// ==========================================

const DEFAULT_PROMPTS = {
  summary: `【要約モード用】
以下のログ（カレンダー、Slack、Git等の活動記録）をもとに、今日の業務内容を簡潔に要約した以下の活動ログからビジネス日報を作成してください。
- 箇条書きで分かりやすく
- PMや上長への報告に適したトーンで

### 現在のモード
**要約モード（トピック箇条書き・超短縮スタイル）**

### タスク分類定義（工数概算用）
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

### 記述ルール（Slack表示用）
Slack API経由での投稿においてインデントを崩さないため、以下のルールを厳守してください。

#### 0. 案件・クライアントの特定（最優先ルール）
ログの情報を元に、タスクを正しいクライアント（大項目）に分類すること。**推測での紐付けは禁止**する。
- **判断基準**: Slackのチャンネル名（例: \`[#project-a]\`ならA社）、カレンダーの件名などを正とする。
- **Backlogの社名変換ルール**: プロジェクトキー（例: WCL）しか情報がない場合、**無理に日本語の社名を推測して捏造しないこと**。他の情報源（カレンダー等）から確証が得られない場合は、**「● WCL様」のようにキーのまま出力**すること。
- **迷った場合**: どの案件か明確な証拠がないタスクは、無理に特定のクライアントに紐付けず、**「● その他・社内業務」** という大項目を作ってそこにまとめること。

#### 1. 共通フォーマット
- **物理整形:** Markdownのリスト記号（- や *）は使わず、「全角スペース」でインデントを行う。
- **大項目:** 「● 略称＋様」とする。（黒丸＋半角スペース）
- **重要**: 「株式会社」「合同会社」などの法人格は削除し、社名のみにして「様」をつけること。
- （例：株式会社A → ● A様、Bジャパン株式会社 → ● Bジャパン様）
- **小項目:** 「　・内容」とする。（全角スペース＋中黒）
- **階層化:** 2段階目の字下げ（入れ子）は禁止。全て1段階でフラットに書く。
- **トーン:** 体言止めで極めて簡潔に。

#### 2. 本日のタスク（トピック箇条書き・超短縮ルール）
活動ログを「主要なトピック」ごとに箇条書きにし、極限まで短く記述すること。
- **トピックごとの箇条書き**: 無理に1行にまとめず、**トピック（話題）が異なる場合は行を分ける**こと。
- **アクションの削除（体言止め徹底）**: 「実施」「参加」「調整」「確認」などの**動作動詞は削除**し、「〜の件」「〜対応」「〜方針策定」などの名詞形で終わらせる。
- ⭕️ 良い例：
・施策提案
・定例日程の提示
- ❌ 悪い例：
・施策提案を実施
・定例日程を提示した
- **禁止事項**: 文末に「（会話・合意）」などの工程分類ラベルを付記しないこと。

#### 3. 次回やること（翌営業日連携）
ログにある「=== Googleカレンダー (翌営業日...)」の情報、および本日の未完了タスクから作成すること。
- **記載ルール**: カレンダーに予定がある場合は、必ずクライアントごとに記載する。
- **注釈の禁止**: その際、「（翌営業日）」や「（予定）」といった注釈は一切記載しない。

#### 4. アイディア（収益拡大の種）・課題・ひとこと
- **アイディア**: 単なる感想ではなく、**アップセルやクロスセル（収益増）に繋がりそうな「提案の種」**を優先して抽出・記述すること。末尾に(A様)のように法人格を省いて付記。
- **課題**: 発生したエラーやボトルネックを簡潔に。
- **ひとこと**: 必ず1行、一言で終わらせる。

### 【重要：出力制御】
**出力が長くなりすぎて途中で切れるのを防ぐため、以下のルールを絶対に守ってください。**
1. ログが大量にある場合、細かい作業ログは「他○件」のようにまとめるか、重要度の高いものに絞って記述すること。
2. 出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日のタスク：費やした時間、進捗率*
● A様
　・施策提案MTG
　・アプリ内レコメンド連携対応
● B株式会社様
　・MAシナリオ設計
　・データ定義確認
● その他・社内業務
　・日報AIツール改修
　・SSL証明書手続き対応
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
- **迷った場合**: どの案件か明確な証拠がないタスクは、無理に特定のクライアントに紐付けず、**「● その他・社内業務」** という大項目を作ってそこにまとめること。

#### 1. 共通フォーマット
- **物理整形:** Markdownのリスト記号（- や *）は使わず、「全角スペース」でインデントを行う。
- **大項目:** 「● 略称＋様」とする。（黒丸＋半角スペース）
- **重要**: 「株式会社」「合同会社」などの法人格は削除し、社名のみにして「様」をつけること。
- （例：株式会社A → ● A様、Bジャパン株式会社 → ● Bジャパン様）
- **小項目:** 「　・内容」とする。（全角スペース＋中黒）
- **階層化:** 2段階目の字下げ（入れ子）は禁止。全て1段階でフラットに書く。
- **トーン:** 事実ベースで具体的かつ、簡潔なトーン。

#### 2. 本日のタスク（徹底分解ルール）
活動ログを元に、以下の**【徹底分解ルール】**に従って作成すること。
- **分類ラベルの廃止**: 行頭に【顧客対応】や【作業】などの**分類タグは一切付けない**こと。
- **複合タスクの分離**: 「Aを作成してBを実施した」のような複合文は禁止。**「Aの作成」と「Bの実施」を別の行（箇条書き）に分ける**こと。
- **技術的詳細の記載**: 抽象化せず、具体的なテーブル名、カラム名、使用した関数、エラーコードなどの**技術的な固有名詞や数値をそのまま記載**する。
- **結果の併記**: 可能であれば、アクションの後ろに括弧書きで結果や状態を書く。
- **禁止事項**: 文末に「（会話・合意）」や「（思考・作業）」といった、工程分類を表すラベルを自動的に付記しないこと。

#### 3. 次回やること（翌営業日連携）
ログにある「=== Googleカレンダー (翌営業日...)」の情報、および本日の未完了タスクから作成すること。
- **記載ルール**: カレンダーに予定がある場合は、必ずクライアントごとに記載する。
- **注釈の禁止**: その際、「（翌営業日）」や「（予定）」といった注釈は一切記載しない。

#### 4. アイディア（収益拡大の種）・課題・ひとこと
- **アイディア**: ログから読み取れる**アップセルやクロスセル（収益増）のヒント、追加提案のネタ**を優先して記述すること。（例：データの傾向から見て新機能の導入が有効、など）。末尾に(社名)を付記。
- **課題**: 発生したエラーの詳細や、解決に時間を要したポイントなどを記録する。
- **ひとこと**: 1行で簡潔に。

### 【重要：出力制御】
**出力が長くなりすぎて途中で切れるのを防ぐため、以下のルールを絶対に守ってください。**
1. ログが大量にある場合、細かい作業ログは「他○件」のようにまとめるか、重要度の高いものに絞って記述すること。
2. 出力が途中で途切れることは許されません。必ず「ひとこと」セクションまで書ききって完結させること。

### 出力フォーマット例
【日報】{{DATE}}
👉 *本日のタスク：費やした時間、進捗率*
● A様
　・定例MTGにて要件定義を実施（対象期間の定義について合意）
　・在庫除外ロジックの実装（itemsテーブルのstockカラムが0の条件を追加）
　・テスト配信を実施（除外対象者のメール不達を確認）
● B株式会社様
　・新機能（レコメンド）の実装フェーズに着手
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

2. **出力フォーマット（厳守）**:
   必ず以下の「JSONブロック」と「レポート本文」の2部構成で出力してください。
   挨拶や前置きは不要です。

   \`\`\`json
   [
     {"label": "PROJ-101: A社様導入支援", "hours": 10.5},
     {"label": "PROJ-205: 社内基盤開発", "hours": 5.0},
     {"label": "その他・社内業務", "hours": 2.0}
   ]
   \`\`\`

   【集計期間】 {{DATE}}

   📊 **プロジェクト別サマリ**
   ■ [PROJ-101: A社様導入支援] (期間合計: X.X時間)
   - 内容: (期間中の主な作業概要)

   -----------------------------------
   📅 **日別・工数入力データ (TeamSpirit転記用)**
   
   ▼ MM/DD (曜) | 合計: H.H時間
   - [PROJ-101: A社様導入支援] H.H時間 : (具体的な作業名)
   - [PROJ-205: 社内基盤開発] H.H時間 : (具体的な作業名)

   ... (期間終了日まで繰り返し) ...
   
   -----------------------------------
   💰 期間総合計: Z.Z時間

### 活動ログ
{{LOGS}}`
};
 
function getDefaultPrompts() {
  return DEFAULT_PROMPTS;
}

function generateReportWithGemini(logText, modelType, prompts, reportMode, targetDate, reflection, manhour, dayFormat, instruction) {
  // ★修正: gemini-2.5 のまま使用
  const useModelId = (modelType === 'pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${useModelId}:generateContent`;

  let p = (reportMode === "詳細モード") ? prompts.detail : prompts.summary;
  if (manhour !== "なし") p += "\n\n" + prompts.manhour;
  if (reflection !== "なし") p += "\n\n" + prompts.reflection;
  
  if (instruction) { p += `\n\n【重要：修正指示】\n上記の生成ルールに加え、以下の指示に従って書き直してください：\n${instruction}`; }
  
  const promptText = p.replace('{{DATE}}', getFormattedDateString(targetDate, dayFormat)).replace('{{LOGS}}', logText);
  
  // ★修正: テスト実行時はプロンプトをそのまま返す
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

function generateAggregationWithGemini(logText, modelType, start, end, projectList, avgWorkHours, instruction) {
  // ★修正: gemini-2.5 のまま使用
  const useModelId = (modelType === 'pro') ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${useModelId}:generateContent`;

  const prompts = getPromptSettings();
  let p = prompts.aggregation;
  
  if (projectList && projectList.trim() !== "") {
    p += `\n\n【正式なプロジェクト一覧 (この名称に変換すること)】\n${projectList}\n`;
  }

  if (avgWorkHours) {
    p += `\n\n【補足：稼働時間】\n1日あたりの合計工数が「${avgWorkHours}時間」になるように、各タスクの時間を調整してください。\n`;
  }

  if (instruction) {
    p += `\n\n【重要：ユーザーからの修正指示】\n上記ルールに加え、以下の指示を最優先で反映して再集計してください：\n${instruction}\n`;
  }

  const dateRangeStr = `${Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy/MM/dd')} 〜 ${Utilities.formatDate(end, 'Asia/Tokyo', 'yyyy/MM/dd')}`;
  const promptText = p.replace('{{DATE}}', dateRangeStr).replace('{{LOGS}}', logText);

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
 * Gemini API呼び出し共通処理
 * ★修正: エラーハンドリングを強化し、ユーザーフレンドリーなメッセージを返すように修正
 */
function callVertexAI(apiUrl, payload) {
  // ★修正: 重複していた設定を共通化
  const commonPayload = JSON.parse(payload);
  commonPayload.safetySettings = [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" }
  ];
  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Goog-User-Project': PROJECT_ID
      },
      payload: JSON.stringify(commonPayload),
      muteHttpExceptions: true // エラー時もResponseオブジェクトを受け取る
    };

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
          "数分待ってから再試行してください。"
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
        console.log("Finish Reason:", json.candidates[0].finishReason);
        if (json.candidates[0].finishReason === 'SAFETY') {
            return "⚠️ 【警告】AIの安全フィルターにより、生成が中断されました。";
        }
    }
    
    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) {
         throw new Error("AIからの応答が空でした。");
    }
    
    return json.candidates[0].content.parts[0].text;

  } catch (e) {
    console.warn("Vertex AI Error: " + e.message);
    throw e; // 上位の関数（handleReportなど）にエラーを伝える
  }
}