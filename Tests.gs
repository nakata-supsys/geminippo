/**
 * @OnlyCurrentDoc
 *
 * The above comment directs Apps Script to limit the scope of file
 * access for this script to only the document it is bound to.
 */

// =============================================
// Simple Test Runner for geminippo-gas
// =============================================

/**
 * すべての単体テストを実行します。
 * Apps Scriptエディタからこの関数を実行してください。
 */
function runAllUnitTests() {
  const testSuite = {
    'Config.js': [
      test_getOrSetupAppSheet_createsNewSheet,
      test_savePromptSettings_savesAndClearsCache,
    ],
    'Services.js': [
      test_shouldIgnoreSlackChannel_worksForDmAndChannel,
    ],
    'AI.js': [
      test_generateReportWithGemini_constructsCorrectPrompt,
      test_generateAggregationWithGemini_addsContext,
      test_applyBulletStyleRules_convertsLegacyBlock,
      test_formatReportByBulletStyle_convertsMarkdown,
    ],
    'E2E Integration': [
      test_e2e_dailyReport_happyPath_cs,
      test_e2e_dailyReport_happyPath_es,
      test_e2e_aggregation_withProjectList,
      test_e2e_vertexAI_403_errorMessage,
      test_e2e_vertexAI_429_errorMessage,
      test_e2e_teamSpirit_manhourConstraint,
      test_e2e_customInstruction_injectedIntoPrompt,
    ],
  };

  let totalPassed = 0;
  let totalFailed = 0;

  console.log('🧪======= geminippo-gas Unit Test Suite =======🧪');

  for (const file in testSuite) {
    console.log(`\n📄 Testing ${file}...`);
    const tests = testSuite[file];
    tests.forEach(testFunc => {
      try {
        // 各テストの前に状態をリセット
        setup();
        testFunc();
        console.log(`  ✅ PASSED: ${testFunc.name}`);
        totalPassed++;
      } catch (e) {
        console.error(`  ❌ FAILED: ${testFunc.name} \n     Reason: ${e.stack}`);
        totalFailed++;
      }
    });
  }

  console.log('\n-------------------------------------------------');
  if (totalFailed === 0) {
    console.log(`🎉 ALL ${totalPassed} TESTS PASSED! 🎉`);
  } else {
    console.log(`🚨 Test Summary: ${totalPassed} Passed, ${totalFailed} Failed.`);
  }
  console.log('=================================================');
}

// =============================================
// Test Setup & Mocking
// =============================================

let mockUserProperties;
let mockCache;

/**
 * 各テストの実行前に呼ばれるセットアップ関数。
 * モックオブジェクトを初期化します。
 */
function setup() {
  mockUserProperties = {
    properties: {},
    getProperty: function(key) { return this.properties[key]; },
    getProperties: function() { return { ...this.properties }; },
    setProperty: function(key, value) { this.properties[key] = value; },
    deleteProperty: function(key) { delete this.properties[key]; },
    deleteAllProperties: function() { this.properties = {}; },
  };

  mockCache = {
    cache: {},
    get: function(key) { return this.cache[key]; },
    put: function(key, value, ttl) { this.cache[key] = value; },
    remove: function(key) { delete this.cache[key]; },
  };

  // GASのグローバルサービスをモックに差し替える
  global.PropertiesService = {
    getUserProperties: () => mockUserProperties,
  };
  global.CacheService = {
    getUserCache: () => mockCache,
  };

  // SpreadsheetAppのモックを強化
  const mockRange = {
    getValue: () => '',
    setValue: () => mockRange, // メソッドチェーンを可能にする
  };
  const mockSheet = {
    setName: () => {},
    appendRow: () => {},
    setFrozenRows: () => {},
    setColumnWidths: () => {},
    getRange: () => mockRange,
    getLastRow: () => 1,
  };
  global.SpreadsheetApp = {
    create: (name) => ({
      getId: () => 'mock_sheet_id',
      getSheets: () => [mockSheet],
      getSheetByName: () => mockSheet,
      insertSheet: () => mockSheet,
    }),
    openById: () => SpreadsheetApp.create(), // openByIdもcreateのモックを返す
  };
  global.Session = {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' }),
  };
}

const SAMPLE_CAL_LOG = '[予定] 10:00 (60分) CS顧客フォローMTGと課題整理';
const SAMPLE_SLACK_LOG = '[#cs-support] サンプルログ: Enterprise問い合わせ一次対応とエスカレーション共有';
const SAMPLE_GMAIL_LOG = '[送信] 見積書送付（A社様）および追加ヒアリング調整';
const SAMPLE_BACKLOG_LOG = '[Backlog] GNM-123 課題棚卸し: API整備とレビュー';
const PERIOD_LOG_FIXTURE = [
  '=== 2024/01/15 ===',
  'Slack: 顧客一次対応と社内共有(2件)',
  'Calendar: 定例MTG 60分 / 提案準備',
  '=== 2024/01/16 ===',
  'Slack: 仕様確認とフォローアップ(3件)',
  'Calendar: A社キックオフ 90分'
].join('\\n');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`アサーション失敗: ${message}`);
  }
}

function assertContains(str, substring, label) {
  if (!str || str.indexOf(substring) === -1) {
    throw new Error(`${label}: \"${substring}\" が含まれるはずですが、含まれていません。\\n取得値: ${(str || '').substring(0, 200)}`);
  }
}

function setupE2E(overrides = {}) {
  setup();

  global.fetchGoogleCalendarEvents = overrides.fetchGoogleCalendarEvents || (() => [{ log: SAMPLE_CAL_LOG }]);
  global.fetchMySlackPosts = overrides.fetchMySlackPosts || (() => [SAMPLE_SLACK_LOG]);
  global.fetchGmailSentMessages = overrides.fetchGmailSentMessages || (() => [SAMPLE_GMAIL_LOG]);
  global.fetchMultiBacklogActivities = overrides.fetchMultiBacklogActivities || (() => [SAMPLE_BACKLOG_LOG]);
  global.fetchTeamSpiritWorkTime = overrides.fetchTeamSpiritWorkTime || (() => null);
  global.fetchTeamSpiritFromBigQuery = overrides.fetchTeamSpiritFromBigQuery || (() => null);
  global.fetchOpportunities = overrides.fetchOpportunities || (() => []);
  global.fetchOpportunityTasks = overrides.fetchOpportunityTasks || (() => []);
  global.fetchOpportunitiesFromBigQuery = overrides.fetchOpportunitiesFromBigQuery || (() => []);
  global.collectPeriodLogsParallel = overrides.collectPeriodLogsParallel || (() => PERIOD_LOG_FIXTURE);

  const defaultUtilities = {
    formatDate: (date, tz, fmt) => {
      const d = new Date(date);
      const pad = (n) => String(n).padStart(2, '0');
      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      switch (fmt) {
        case 'yyyy/MM/dd':
          return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
        case 'yyyy/MM/dd HH:mm:ss':
          return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        case 'yyyy年MM月dd日':
          return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
        case 'HH:mm':
          return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        case 'MM/dd(E)':
          return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${weekdays[d.getDay()]})`;
        default:
          return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
      }
    },
    sleep: () => {},
  };
  global.Utilities = overrides.Utilities || defaultUtilities;

  global.CalendarApp = overrides.CalendarApp || {
    getDefaultCalendar: () => ({
      getEventsForDay: () => [{
        getStartTime: () => new Date('2024-01-15T10:00:00+09:00'),
        getEndTime: () => new Date('2024-01-15T11:00:00+09:00'),
        getTitle: () => 'CS顧客フォローMTG',
      }],
    }),
    getCalendarsByName: () => [{ getEvents: () => [] }],
    getCalendarById: () => ({ getEventsForDay: () => [] }),
  };

  global.GmailApp = overrides.GmailApp || {
    search: () => [{ getFirstMessageSubject: () => '見積書送付（A社様）' }],
  };

  let mockVertexResponse = 'AIモックレスポンス';
  global.__setMockVertexResponse = (text) => { mockVertexResponse = text || 'AIモックレスポンス'; };

  if (overrides.UrlFetchApp) {
    global.UrlFetchApp = {
      fetch: overrides.UrlFetchApp.fetch,
      fetchAll: overrides.UrlFetchApp.fetchAll || (() => []),
    };
  } else {
    global.UrlFetchApp = {
      fetch: (url) => {
        if (url.indexOf('aiplatform.googleapis.com') !== -1) {
          return {
            getContentText: () => JSON.stringify({
              candidates: [{ content: { parts: [{ text: mockVertexResponse }] }, finishReason: 'STOP' }],
            }),
            getResponseCode: () => 200,
          };
        }
        return { getContentText: () => JSON.stringify({ ok: true }), getResponseCode: () => 200 };
      },
      fetchAll: (requests) => requests.map(() => ({ getContentText: () => '{"ok":true,"messages":{"matches":[]}}', getResponseCode: () => 200 })),
    };
  }

  global.ScriptApp = overrides.ScriptApp || {
    getOAuthToken: () => 'test-oauth-token',
    getService: () => ({ getUrl: () => 'https://example.com' }),
    newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => ({}) }) }) }) }),
    getProjectTriggers: () => [],
    deleteTrigger: () => {},
    newStateToken: () => ({ withTimeout: () => ({ createToken: () => 'state-token' }) }),
  };

  global.seedUserSettings = function(overrides = {}) {
    const defaults = {
      SLACK_USER_TOKEN: 'xoxp-e2e-token',
      SLACK_CHANNEL_ID: 'C111111',
      SLACK_MEMBER_ID: 'U999999',
      REPORT_MODEL_TYPE: 'flash',
      REPORT_MODE: '詳細モード',
      REPORT_BULLET_STYLE: 'plain',
      REPORT_SLACK_STYLE: 'default',
      REPORT_FIXED_THREAD_URL: '',
      REPORT_MANHOUR: 'あり',
      REPORT_REFLECTION: 'あり',
      REPORT_SLACK_SCOPE: 'default',
      REPORT_DAY_FORMAT: 'default',
      REPORT_DATE: '2024-01-15',
      PROJECT_LIST: 'PROJ-001: A社導入, PROJ-777: B社支援',
      AVG_WORK_HOURS: '8.0',
      SELECTED_DEPARTMENT: 'CS',
    };
    const merged = { ...defaults, ...overrides };
    const userProps = PropertiesService.getUserProperties();
    Object.keys(merged).forEach(key => userProps.setProperty(key, merged[key]));
  };

  global.capturePrompt = function(fn) {
    const prev = global.IS_TESTING;
    global.IS_TESTING = true;
    try {
      return fn();
    } finally {
      global.IS_TESTING = typeof prev === 'undefined' ? false : prev;
    }
  };

  global.IS_TESTING = false;
}

// =============================================
// Test Cases
// =============================================

// --- Config.js Tests ---

function test_getOrSetupAppSheet_createsNewSheet() {
  // 実行
  getOrSetupAppSheet();

  // 検証
  const sheetId = mockUserProperties.getProperty('APP_SHEET_ID');
  if (sheetId !== 'mock_sheet_id') {
    throw new Error(`Expected APP_SHEET_ID to be 'mock_sheet_id', but got ${sheetId}`);
  }
}

function test_savePromptSettings_savesAndClearsCache() {
  // 準備
  const testPrompts = { summary: 'test summary' };
  mockCache.put('prompt_settings_v2', JSON.stringify({ summary: 'old' }));

  // 実行
  savePromptSettings(testPrompts);

  // 検証
  const cached = mockCache.get('prompt_settings_v2');
  if (cached) {
    throw new Error('Cache was not cleared after saving prompts.');
  }
}

// --- Services.js Tests ---

function test_shouldIgnoreSlackChannel_worksForDmAndChannel() {
  // 準備
  const ignoreIds = ['C123', 'U456'];
  const ignoreUserNames = ['testuser']; // U456's name

  // 検証
  if (!shouldIgnoreSlackChannel({ id: 'C123' }, ignoreIds, ignoreUserNames)) {
    throw new Error('Should ignore channel C123');
  }
  if (!shouldIgnoreSlackChannel({ id: 'D789', name: 'testuser' }, ignoreIds, ignoreUserNames)) {
    throw new Error('Should ignore DM with user "testuser"');
  }
  if (shouldIgnoreSlackChannel({ id: 'C999' }, ignoreIds, ignoreUserNames)) {
    throw new Error('Should NOT ignore channel C999');
  }
}

// --- AI.js Tests ---

function test_generateReportWithGemini_constructsCorrectPrompt() {
  // 準備
  // 実行に必要なグローバルモック
  global.ScriptApp = { getOAuthToken: () => 'mock_token' };
  global.UrlFetchApp = { fetch: () => ({ getContentText: () => '{"candidates":[{"content":{"parts":[{"text":"mock response"}]}}]}', getResponseCode: () => 200 }) };

  // ★修正: テスト対象の関数が依存するヘルパー関数をモック化
  global.getFormattedDateString = () => '2024/01/01';

  // ★修正: getPromptSettingsをモック化し、常にデフォルトプロンプトを返すようにする
  global.getPromptSettings = () => getDefaultPrompts();

  global.IS_TESTING = true; // AI呼び出しをスキップするフラグ

  const prompts = getDefaultPrompts();

  // 実行
  const resultPrompt = generateReportWithGemini('log', 'flash', 'CS', prompts, '詳細モード', new Date(), 'あり', 'あり', 'default', 'plain', '修正指示', null);

  // 検証
  assertContains(resultPrompt, '【詳細モード用】', 'Detail prompt header');
  assertContains(resultPrompt, getBulletStyleRulesText('plain').split('\n')[0], 'Bullet rules inserted');
  if (!resultPrompt.includes(prompts.manhour)) throw new Error('Manhour prompt is missing.');
  if (!resultPrompt.includes(prompts.reflection)) throw new Error('Reflection prompt is missing.');
  if (!resultPrompt.includes('修正指示')) throw new Error('Instruction is missing.');
}

function test_generateAggregationWithGemini_addsContext() {
  // 準備
  // 実行に必要なグローバルモック
  global.ScriptApp = { getOAuthToken: () => 'mock_token' };
  global.UrlFetchApp = { fetch: () => ({ getContentText: () => '{"candidates":[{"content":{"parts":[{"text":"mock response"}]}}]}', getResponseCode: () => 200 }) };
  global.Utilities = { formatDate: () => '2024/01/01' };

  // ★修正: getPromptSettingsをモック化
  global.getPromptSettings = () => getDefaultPrompts();

  global.IS_TESTING = true; // AI呼び出しをスキップするフラグ

  // 実行
  const resultPrompt = generateAggregationWithGemini('log', 'flash', new Date(), new Date(), 'Project List', '9.5', '修正指示');

  // 検証
  if (!resultPrompt.includes('Project List')) throw new Error('Project list is missing.');
  if (!resultPrompt.includes('9.5時間')) throw new Error('Average work hours context is missing.');
  if (!resultPrompt.includes('修正指示')) throw new Error('Instruction is missing.');
}

function test_applyBulletStyleRules_convertsLegacyBlock() {
  const legacy = `#### 1. 共通フォーマット
- **物理整形:** Markdownのリスト記号（- や *）は使わず、「全角スペース」でインデントを行う。
- **大項目:** 「● 略称＋様」とする。（黒丸＋半角スペース）
- **小項目:** 「　・内容」とする。（全角スペース＋中黒）
- **階層化:** 2段階目の字下げ（入れ子）は禁止。全て1段階でフラットに書く。
- **トーン:** 体言止めで極めて簡潔に。`;
  const result = applyBulletStyleRules(legacy, 'markdown');
  assertContains(result, 'Slackが解釈するMarkdown', '新ルール挿入');
  if (result.includes('全角スペース')) throw new Error('Legacy rule text should be removed.');
}

function test_formatReportByBulletStyle_convertsMarkdown() {
  const plain = `● A様
　・タスク1

・単独トピック`;
  const markdown = formatReportByBulletStyle(plain, 'markdown');
  assertContains(markdown, '- A様', 'トップレベル変換');
  assertContains(markdown, '    - タスク1', '子要素変換');
  assertContains(markdown, '\n- 単独トピック', '単独トピックは親なし');

  const reverted = formatReportByBulletStyle(markdown, 'plain');
  assertContains(reverted, '● A様', 'トップレベル戻し');
  assertContains(reverted, '　・タスク1', '子要素戻し');
  assertContains(reverted, '● 単独トピック', '親なし行戻し');
}

// --- E2E Integration Tests ---

function test_e2e_dailyReport_happyPath_cs() {
  setupE2E();
  seedUserSettings({
    REPORT_MODE: '詳細モード',
    REPORT_MANHOUR: 'あり',
    REPORT_REFLECTION: 'あり',
    SELECTED_DEPARTMENT: 'CS',
  });

  const previewResult = capturePrompt(() => generatePreviewReport(null, '2024-01-15', 'CS'));
  assert(previewResult.success, 'プレビュー取得成功');
  const promptText = previewResult.report;
  const prompts = getDefaultPrompts();
  assertContains(promptText, prompts.detail.trim().slice(0, 20), '詳細モードプロンプト');
  assertContains(promptText, SAMPLE_CAL_LOG, 'カレンダーログ挿入');
  assertContains(promptText, SAMPLE_SLACK_LOG, 'Slackログ挿入');
  assertContains(promptText, prompts.manhour.trim().slice(0, 20), '工数セクション');
  assertContains(promptText, 'AI業務改善フィードバック', 'フィードバックセクション');

  __setMockVertexResponse('AIモックレスポンス（日報）');
  global.IS_TESTING = false;
  const liveResult = generatePreviewReport(null, '2024-01-15', 'CS');
  assert(liveResult.success, '本番フロー成功');
  assert(liveResult.report === 'AIモックレスポンス（日報）', 'AIレスポンス受領');
}

function test_e2e_dailyReport_happyPath_es() {
  setupE2E();
  seedUserSettings({
    REPORT_MODE: '要約モード',
    SELECTED_DEPARTMENT: 'ES',
  });

  const previewResult = capturePrompt(() => generatePreviewReport('追加指示なし', '2024-01-15', 'ES'));
  assert(previewResult.success, 'ESプレビュー成功');
  const promptText = previewResult.report;
  const esPrompts = getDefaultPromptsES();
  assertContains(promptText, esPrompts.summary.split('\n')[0], 'ES要約プロンプト');
  assertContains(promptText, '営業活動', 'ES専用テンプレート');
  assertContains(promptText, SAMPLE_SLACK_LOG, 'ESログ挿入');

  __setMockVertexResponse('AIモックレスポンス（ES）');
  global.IS_TESTING = false;
  const liveResult = generatePreviewReport(null, '2024-01-15', 'ES');
  assert(liveResult.success, 'ES本番成功');
  assert(liveResult.report === 'AIモックレスポンス（ES）', 'ESレスポンス受領');
}

function test_e2e_aggregation_withProjectList() {
  setupE2E({ collectPeriodLogsParallel: () => PERIOD_LOG_FIXTURE });
  seedUserSettings({
    PROJECT_LIST: 'PROJ-001: A社導入, PROJ-777: B社支援',
    AVG_WORK_HOURS: '8.0',
  });

  const promptResult = capturePrompt(() => runPeriodAggregation(
    '2024-01-15',
    '2024-01-16',
    'flash',
    'PROJ-001: A社導入, PROJ-777: B社支援',
    '8.0',
    '週次レポート短縮'
  ));
  assert(promptResult.success, '集計プロンプト取得');
  const promptText = promptResult.report;
  assertContains(promptText, 'PROJ-001: A社導入', 'プロジェクト一覧注入');
  assertContains(promptText, 'PROJ-777: B社支援', '複数プロジェクト注入');
  assertContains(promptText, '8.0時間', '平均稼働時間注入');
  assertContains(promptText, '2024/01/15 〜 2024/01/16', '日付レンジ置換');
  assertContains(promptText, 'Slack: 顧客一次対応', '期間ログ挿入');

  __setMockVertexResponse('[{\"label\":\"PROJ-001\",\"hours\":4.0}]\\nレポート本文');
  global.IS_TESTING = false;
  const liveResult = runPeriodAggregation(
    '2024-01-15',
    '2024-01-16',
    'flash',
    'PROJ-001: A社導入, PROJ-777: B社支援',
    '8.0',
    null
  );
  assert(liveResult.success, '集計呼び出し成功');
  assertContains(liveResult.report, 'PROJ-001', 'JSONブロック採用');
}

function test_e2e_vertexAI_403_errorMessage() {
  setupE2E({
    UrlFetchApp: {
      fetch: () => ({
        getContentText: () => '{"error":{"message":"permission denied"}}',
        getResponseCode: () => 403,
      }),
      fetchAll: () => [],
    },
  });
  global.IS_TESTING = false;
  try {
    callVertexAI('https://example.com', JSON.stringify({ contents: [] }));
    assert(false, '403エラーはthrowされるべき');
  } catch (e) {
    assertContains(e.message, '権限', '403メッセージ');
  }
}

function test_e2e_vertexAI_429_errorMessage() {
  setupE2E({
    UrlFetchApp: {
      fetch: () => ({
        getContentText: () => '{"error":{"message":"too many requests"}}',
        getResponseCode: () => 429,
      }),
      fetchAll: () => [],
    },
  });
  global.IS_TESTING = false;
  try {
    callVertexAI('https://example.com', JSON.stringify({ contents: [] }));
    assert(false, '429エラーはthrowされるべき');
  } catch (e) {
    assertContains(e.message, '時間をおいて', '429メッセージ');
  }
}

function test_e2e_teamSpirit_manhourConstraint() {
  setupE2E();
  const teamSpiritData = { realHours: 7.5 };
  const pastDate = new Date('2024-01-14T00:00:00+09:00');
  const constraint = calculateManhourConstraint(teamSpiritData, pastDate);
  assertContains(constraint, '7.5', 'TeamSpirit制約文字列');

  const promptText = capturePrompt(() => generateReportWithGemini(
    'LOG',
    'flash',
    'CS',
    getDefaultPrompts(),
    '詳細モード',
    pastDate,
    'あり',
    'あり',
    'default',
    'plain',
    null,
    teamSpiritData
  ));
  assertContains(promptText, 'TeamSpirit連携', 'プロンプトへ制約注入');
}

function test_e2e_customInstruction_injectedIntoPrompt() {
  setupE2E();
  const instruction = '箇条書きではなく段落形式で書いてください';
  const promptText = capturePrompt(() => generateReportWithGemini(
    'LOG',
    'flash',
    'CS',
    getDefaultPrompts(),
    '詳細モード',
    new Date('2024-01-15T00:00:00+09:00'),
    'あり',
    'あり',
    'default',
    'plain',
    instruction,
    null
  ));
  assertContains(promptText, '【重要：修正指示】', '修正指示セクション');
  assertContains(promptText, instruction, '指示文挿入');
}

// このグローバル変数は、テスト関数内でGASサービスをモックするために必要です。
const global = this;
