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
      test_doLogout_clearsPropertiesButKeepsSheetId,
      test_shouldIgnoreSlackChannel_worksForDmAndChannel,
    ],
    'AI.js': [
      test_generateReportWithGemini_constructsCorrectPrompt,
      test_generateAggregationWithGemini_addsContext,
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

function test_doLogout_clearsPropertiesButKeepsSheetId() {
  // 準備
  mockUserProperties.setProperty('APP_SHEET_ID', 'keep_this_id');
  mockUserProperties.setProperty('SLACK_USER_TOKEN', 'some_token');

  // 実行
  doLogout();

  // 検証
  const props = mockUserProperties.getProperties();
  if (props['SLACK_USER_TOKEN']) {
    throw new Error('SLACK_USER_TOKEN was not deleted.');
  }
  if (props['APP_SHEET_ID'] !== 'keep_this_id') {
    throw new Error('APP_SHEET_ID should have been kept, but was deleted.');
  }
}

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
  const resultPrompt = generateReportWithGemini('log', 'flash', prompts, '詳細モード', new Date(), 'あり', 'あり', 'default', '修正指示');

  // 検証
  if (!resultPrompt.includes(prompts.detail)) throw new Error('Detail prompt is missing.');
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

// このグローバル変数は、テスト関数内でGASサービスをモックするために必要です。
const global = this;