/**
 * @OnlyCurrentDoc_
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
  let totalPassed = 0;
  let totalFailed = 0;

  console.log('🧪======= geminippo-gas Unit Test Suite =======🧪');

  for (const file in testSuite) {
    console.log(`\n📄 Testing ${file}...`);
    for (const testName in testSuite[file]) {
      const testFunc = testSuite[file][testName];
      try {
        // 各テストの前に状態をリセット
        setup();
        testFunc();
        console.log(`  ✅ PASSED: ${testFunc.name}`);
        totalPassed++;
      } catch (e) {
        console.error('  ❌ FAILED: ' + testFunc.name + '\n     Reason: ' + e.stack);
        totalFailed++;
      }
    });

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
      insertSheet: (name, index) => mockSheet,
    }),
    openById: () => SpreadsheetApp.create(), // openByIdもcreateのモックを返す
  };
  global.Session = {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' }),
  };
  global.ScriptApp = {
    getProjectTriggers: () => [],
    deleteTrigger: () => {},
    newTrigger: () => ({
      timeBased: () => ({
        everyDays: () => ({
          atHour: () => ({
            create: () => {},
          }),
        }),
      }),
    }),
    getOAuthToken: () => 'mock_token',
  };
  global.UrlFetchApp = {
    fetch: () => ({
      getContentText: () => '{"candidates":[{"content":{"parts":[{"text":"mock response"}]}}]}',
      getResponseCode: () => 200,
    }),
  };
  global.Utilities = {
    formatDate: () => '2024/01/01',
  };
  global.getFormattedDateString = () => '2024/01/01';
  global.getPromptSettings = () => getDefaultPrompts();
  global.IS_TESTING = true;
}

// =============================================
// Assertion Library
// =============================================

function assertEquals(expected, actual, message) {
  if (expected !== actual) {
    throw new Error(`${message || 'Assertion Failed'}: Expected "${expected}" but got "${actual}"`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion Failed: Expected condition to be true');
  }
}

function assertFalse(condition, message) {
  if (condition) {
    throw new Error(message || 'Assertion Failed: Expected condition to be false');
  }
}

// =============================================
// Test Suite
// =============================================

const testSuite = {
  'Config.js': {
    test_getOrSetupAppSheet_createsNewSheet: function() {
      getOrSetupAppSheet();
      const sheetId = mockUserProperties.getProperty('APP_SHEET_ID');
      assertEquals('mock_sheet_id', sheetId, 'Should set APP_SHEET_ID on creation.');
    },
    test_savePromptSettings_savesAndClearsCache: function() {
      const testPrompts = { summary: 'test summary' };
      mockCache.put('prompt_settings_v2', JSON.stringify({ summary: 'old' }));
      savePromptSettings(testPrompts);
      const cached = mockCache.get('prompt_settings_v2');
      assertFalse(cached, 'Cache should be cleared after saving prompts.');
    },
  },
  'Services.js': {
    test_doLogout_clearsPropertiesButKeepsSheetId: function() {
      mockUserProperties.setProperty('APP_SHEET_ID', 'keep_this_id');
      mockUserProperties.setProperty('SLACK_USER_TOKEN', 'some_token');
      doLogout();
      const props = mockUserProperties.getProperties();
      assertFalse(props['SLACK_USER_TOKEN'], 'SLACK_USER_TOKEN should be deleted.');
      assertEquals('keep_this_id', props['APP_SHEET_ID'], 'APP_SHEET_ID should be kept.');
    },
    test_shouldIgnoreSlackChannel_worksForDmAndChannel: function() {
      const ignoreIds = ['C123', 'U456'];
      const ignoreUserNames = ['testuser']; // U456's name
      assertTrue(shouldIgnoreSlackChannel({ id: 'C123' }, ignoreIds, ignoreUserNames), 'Should ignore channel C123');
      assertTrue(shouldIgnoreSlackChannel({ id: 'D789', name: 'testuser' }, ignoreIds, ignoreUserNames), 'Should ignore DM with user "testuser"');
      assertFalse(shouldIgnoreSlackChannel({ id: 'C999' }, ignoreIds, ignoreUserNames), 'Should NOT ignore channel C999');
    },
  },
  'AI.js': {
    test_generateReportWithGemini_constructsCorrectPrompt: function() {
      const prompts = getDefaultPrompts();
      const resultPrompt = generateReportWithGemini('log', 'flash', prompts, '詳細モード', new Date(), 'あり', 'あり', 'default', '修正指示');
      assertTrue(resultPrompt.includes(prompts.detail), 'Detail prompt should be included.');
      assertTrue(resultPrompt.includes(prompts.manhour), 'Manhour prompt should be included.');
      assertTrue(resultPrompt.includes(prompts.reflection), 'Reflection prompt should be included.');
      assertTrue(resultPrompt.includes('修正指示'), 'Instruction should be included.');
    },
    test_generateAggregationWithGemini_addsContext: function() {
      const resultPrompt = generateAggregationWithGemini('log', 'flash', new Date(), new Date(), 'Project List', '9.5', '修正指示');
      assertTrue(resultPrompt.includes('Project List'), 'Project list should be included.');
      assertTrue(resultPrompt.includes('9.5時間'), 'Average work hours context should be included.');
      assertTrue(resultPrompt.includes('修正指示'), 'Instruction should be included.');
    },
  },
};

// このグローバル変数は、テスト関数内でGASサービスをモックするために必要です。
const global = this;