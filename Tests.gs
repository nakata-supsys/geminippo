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
    'Code.gs': [
      test_isSalesforceCallback_recognizesStandardCodeState,
      test_isSalesforceCallback_doesNotStealSlackCode,
    ],
    'Config.js': [
      test_getOrSetupAppSheet_createsNewSheet,
      test_savePromptSettings_savesAndClearsCache,
      test_saveRawLogsToSheet_writesVerticalRows,
      test_promptSchemaMigrationDetection_worksByVersion,
    ],
    'Services.js': [
      test_shouldIgnoreSlackChannel_worksForDmAndChannel,
      test_collectTodaysTasks_includesSlackPending,
      test_collectTodaysTasks_warnsWhenBacklogMissing,
      test_getNextBusinessDay_skipsWeekendAndHoliday,
      test_formatSlackLogsForSheet_outputsStructuredTSV,
      test_fetchGoogleCalendarEvents_ignoreWordsCaseInsensitive,
      test_loadClientAliasRules_validJson,
      test_loadClientAliasRules_invalidJson,
      test_createClientResolver_slackChannelMatch,
      test_createClientResolver_skipsDisabledRule,
      test_createClientResolver_backlogKeyMatch,
      test_createClientResolver_keywordMatch,
      test_createClientResolver_keywordNormalization_ignoresFullwidthAndSpaces,
      test_createClientResolver_keywordPrefersLongerMatch,
      test_createClientResolver_keywordExactMatchWins,
      test_createClientResolver_noMatch,
      test_suggestClientAliasRules_excludesRegisteredCandidates,
      test_runClientAliasAutoTest_collectsSlackAndBacklogMatches,
      test_collectLogs_attachesClientNameToSlack,
      test_collectLogs_ignoresDisabledAliasRules,
      test_collectLogs_warnsWhenClientAliasUnmatched,
      test_sendToSlack_fixedThreadWithoutUrlDoesNotThrow,
      test_sendTodaysTodoNotification_fallsBackWhenTodoFormatInvalid,
      test_enrichTodoMessageWithLinks_linksBacklogByKeyWithoutSourceId,
    ],
    'AI.js': [
      test_generateReportWithGemini_constructsCorrectPrompt,
      test_generateAggregationWithGemini_addsContext,
      test_applyBulletStyleRules_convertsLegacyBlock,
      test_appendHitokotoVariationRules_injectsSpecificity,
      test_formatReportByBulletStyle_convertsMarkdown,
      test_formatReportByBulletStyle_stripsEmphasisMarkers,
      test_resolveGeminiModelId_returnsSelectedModel,
      test_resolveGeminiModelId_defaultsToGemini25Flash,
      test_resolveVertexLocationForModel_usesGlobalForGemini3,
      test_buildVertexGenerateContentUrl_usesGlobalEndpointForGemini3,
      test_callVertexAI_maxTokens_returnsPartialTextWarning,
      test_callVertexAI_retriesOnTransientHttpErrors,
      test_generateTodaysTodoWithGemini_truncatesLargeLogInput,
      test_normalizeReportRevisionInstruction_mapsQuickFixHints,
      test_generateReportWithGemini_includesRewriteDraftHint,
    ],
    'E2E Integration': [
      test_e2e_dailyReport_happyPath_cs,
      test_e2e_dailyReport_happyPath_es,
      test_e2e_dailyReport_includesNextBusinessDayAndPendingSections,
      test_e2e_aggregation_withProjectList,
      test_e2e_aggregation_returnsFallbackWhenResultInvalid,
      test_e2e_vertexAI_403_errorMessage,
      test_e2e_vertexAI_429_errorMessage,
      test_e2e_teamSpirit_manhourConstraint,
      test_e2e_customInstruction_injectedIntoPrompt,
      test_e2e_todo_handlesMaxTokensEmptyResponse,
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
  let summary;
  if (totalFailed === 0) {
    summary = `🎉 ALL ${totalPassed} TESTS PASSED! 🎉`;
    console.log(summary);
  } else {
    summary = `🚨 Test Summary: ${totalPassed} Passed, ${totalFailed} Failed.`;
    console.log(summary);
  }
  console.log('=================================================');
  return {
    passed: totalPassed,
    failed: totalFailed,
    summary: summary
  };
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
    setProperties: function(obj) {
      Object.keys(obj || {}).forEach(key => {
        this.properties[key] = obj[key];
      });
    },
    deleteProperty: function(key) { delete this.properties[key]; },
    deleteAllProperties: function() { this.properties = {}; },
  };

  mockCache = {
    cache: {},
    get: function(key) { return this.cache[key]; },
    put: function(key, value, ttl) { this.cache[key] = value; },
    getAll: function(keys) {
      const result = {};
      (keys || []).forEach(key => {
        if (Object.prototype.hasOwnProperty.call(this.cache, key)) {
          result[key] = this.cache[key];
        }
      });
      return result;
    },
    putAll: function(entries, ttl) {
      Object.keys(entries || {}).forEach(key => {
        this.cache[key] = entries[key];
      });
    },
    remove: function(key) { delete this.cache[key]; },
  };

  // GASのグローバルサービスをモックに差し替える
  global.PropertiesService = {
    getUserProperties: () => mockUserProperties,
    getScriptProperties: () => ({
      getProperty: (key) => {
        if (key === 'GCP_PROJECT_ID') return 'test-project-id';
        if (key === 'SF_DOMAIN') return 'login.salesforce.com';
        return null;
      },
    }),
  };
  global.CacheService = {
    getUserCache: () => mockCache,
  };

  // SpreadsheetAppのモックを強化
  const mockRange = {
    getValue: () => '区分',
    setValue: () => mockRange, // メソッドチェーンを可能にする
    setValues: () => mockRange,
  };
  const mockSheet = {
    setName: () => {},
    appendRow: () => {},
    setFrozenRows: () => {},
    setColumnWidths: () => mockSheet,
    setColumnWidth: () => mockSheet,
    getRange: () => mockRange,
    getLastRow: () => 1,
    clearContents: () => {},
    clearFormats: () => {},
    hideSheet: () => {},
  };
  global.SpreadsheetApp = {
    create: (name) => ({
      getId: () => 'mock_sheet_id',
      getSheets: () => [mockSheet],
      getSheetByName: () => mockSheet,
      insertSheet: () => mockSheet,
      deleteSheet: () => {},
    }),
    openById: () => SpreadsheetApp.create(), // openByIdもcreateのモックを返す
  };
  global.Session = {
    getActiveUser: () => ({ getEmail: () => 'test@example.com' }),
  };

  const formatDateMock = (date, tz, fmt) => {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    switch (fmt) {
      case 'yyyy/MM/dd HH:mm:ss':
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      case 'yyyy/MM/dd':
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
      case 'HH:mm':
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      default:
        return d.toISOString();
    }
  };
  global.Utilities = {
    formatDate: formatDateMock,
    sleep: () => {},
  };

  global.getDepartmentPrompts = (department) => department === 'ES' ? getDefaultPromptsES() : getDefaultPrompts();
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
  global.__TEST_PROJECT_ID = 'test-project-id';
  global.lastFetchUrl = null;
  global.lastFetchOptions = null;

  global.fetchGoogleCalendarEvents = overrides.fetchGoogleCalendarEvents || (() => [{ log: SAMPLE_CAL_LOG }]);
  global.fetchMySlackPosts = overrides.fetchMySlackPosts || (() => [SAMPLE_SLACK_LOG]);
  global.fetchGmailSentMessages = overrides.fetchGmailSentMessages || (() => [{
    date: new Date('2024-01-15T09:00:00+09:00'),
    subject: '見積書送付（A社様）および追加ヒアリング調整',
    url: 'https://mail.google.com/mail/u/0/#sent/mock_thread_id',
    displayText: SAMPLE_GMAIL_LOG
  }]);
  global.fetchMultiBacklogActivities = overrides.fetchMultiBacklogActivities || (() => [{
    date: new Date('2024-01-15T10:00:00+09:00'),
    projectKey: 'GNM',
    summary: '課題棚卸し: API整備とレビュー',
    comment: '',
    issueKey: 'GNM-123',
    url: 'https://example.backlog.jp/view/GNM-123',
    displayText: SAMPLE_BACKLOG_LOG
  }]);
  global.fetchTeamSpiritWorkTime = overrides.fetchTeamSpiritWorkTime || (() => null);
  global.fetchTeamSpiritFromBigQuery = overrides.fetchTeamSpiritFromBigQuery || (() => null);
  global.fetchOpportunities = overrides.fetchOpportunities || (() => []);
  global.fetchOpportunityTasks = overrides.fetchOpportunityTasks || (() => []);
  global.fetchOpportunitiesFromBigQuery = overrides.fetchOpportunitiesFromBigQuery || (() => []);
  global.fetchBacklogTodayIssues = overrides.fetchBacklogTodayIssues || (() => []);
  global.fetchPendingSlackRequests = overrides.fetchPendingSlackRequests || (() => []);
  global.isHoliday = overrides.isHoliday || (() => false);
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
      fetch: (url, options) => {
        global.lastFetchUrl = url;
        global.lastFetchOptions = options || null;
        return overrides.UrlFetchApp.fetch(url, options);
      },
      fetchAll: overrides.UrlFetchApp.fetchAll || (() => []),
    };
  } else {
    global.UrlFetchApp = {
      fetch: (url, options) => {
        global.lastFetchUrl = url;
        global.lastFetchOptions = options || null;
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
      BACKLOG_CONFIGS: '[{"host":"example.backlog.jp","key":"GNM"}]',
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

function test_saveRawLogsToSheet_writesVerticalRows() {
  // setValues に渡された rows をキャプチャするモック
  let capturedRows = null;
  const spyRange = {
    getValue: () => '区分',
    setValue: () => spyRange,
    setValues: (rows) => { capturedRows = rows; return spyRange; },
  };
  const spySheet = {
    setName: () => {},
    appendRow: () => {},
    setFrozenRows: () => {},
    setColumnWidths: () => spySheet,
    setColumnWidth: () => spySheet,
    getRange: () => spyRange,
    getLastRow: () => 1,
    clearContents: () => {},
    clearFormats: () => {},
    hideSheet: () => {},
  };
  global.SpreadsheetApp = {
    create: () => ({
      getId: () => 'spy_sheet_id',
      getSheets: () => [spySheet],
      getSheetByName: () => spySheet,
      insertSheet: () => spySheet,
      deleteSheet: () => {},
    }),
    openById: () => SpreadsheetApp.create(),
  };

  const sources = {
    slackRows: [{
      ts: '1705280400.000000',
      channelName: 'test-ch',
      threadLabel: 'T001',
      threadTopText: 'スレッドトップ',
      text: 'テスト投稿',
      permalink: 'https://slack.com/p/abc',
      clientName: 'A社様'
    }],
    calendarRows: [],
    gmailRows: [{ date: new Date('2024-01-15T09:00:00'), subject: 'テスト件名', url: 'https://mail.google.com/...', clientName: 'B社様' }],
    backlogRows: [{ date: new Date('2024-01-15T10:00:00'), projectKey: 'TEST', issueKey: 'TEST-1', summary: '作業内容', comment: 'コメント', url: 'https://example.backlog.jp/view/TEST-1', clientName: 'C社様' }],
    salesforceRows: [{ date: new Date('2024-01-15'), place: 'A社', subject: '商談', content: '提案中', url: '', clientName: 'D社様' }],
  };

  saveRawLogsToSheet(sources, new Date('2024-01-15T00:00:00+09:00'));

  assert(capturedRows !== null, 'setValues が呼ばれること');
  assert(capturedRows.length === 4, `行数が4であること（Slack:1 + Gmail:1 + Backlog:1 + SF:1）。実際: ${capturedRows ? capturedRows.length : 'null'}`);

  const slackRow = capturedRows[0];
  assert(slackRow[2] === 'Slack', `Slack行の区分列が 'Slack' であること。実際: ${slackRow[2]}`);
  assert(slackRow[4] === 'A社様', `Slack行のクライアント列に clientName が保存されること。実際: ${slackRow[4]}`);
  assert(slackRow[6] === 'T001', `Slack行のスレッドNo列が 'T001' であること。実際: ${slackRow[6]}`);
  assert(slackRow[7] === 'スレッドトップ', `Slack行（スレッド返信）のスレッドトップ列が親メッセージ本文であること。実際: ${slackRow[7]}`);
  assert(slackRow[8] === 'テスト投稿', `Slack行の内容列が投稿本文であること。実際: ${slackRow[8]}`);
  assert(slackRow[9] === 'https://slack.com/p/abc', `Slack行のURL列が permalink であること。実際: ${slackRow[9]}`);

  const backlogRow = capturedRows[2];
  assert(backlogRow[4] === 'C社様', `Backlog行のクライアント列に clientName が保存されること。実際: ${backlogRow[4]}`);

  const gmailRow = capturedRows[1];
  assert(gmailRow[2] === 'Gmail', `Gmail行の区分列が 'Gmail' であること。実際: ${gmailRow[2]}`);
  assert(gmailRow[7] === 'テスト件名', `Gmail行の内容列が件名であること。実際: ${gmailRow[7]}`);
  assert(gmailRow[8].includes('mail.google.com'), `Gmail行のURL列にURLが入ること。実際: ${gmailRow[8]}`);

  assert(backlogRow[2] === 'Backlog', `Backlog行の区分列が 'Backlog' であること。実際: ${backlogRow[2]}`);
  assert(backlogRow[5] === 'TEST', `Backlog行のプロジェクトキー列が 'TEST' であること。実際: ${backlogRow[5]}`);
  assert(backlogRow[7] === 'TEST-1 作業内容', `Backlog行のスレッドトップ列がキー＋課題名であること。実際: ${backlogRow[7]}`);
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

function test_collectTodaysTasks_includesSlackPending() {
  const props = {
    CALENDAR_IGNORE_WORDS: '',
    BACKLOG_CONFIGS: '[{"host":"example","key":"dummy"}]',
    SLACK_USER_TOKEN: 'xoxp-test',
    SLACK_MEMBER_ID: 'U999999'
  };

  global.fetchGoogleCalendarEvents = () => [{ log: '[予定] 10:00 (60分) 顧客定例' }];
  global.fetchBacklogTodayIssues = () => ['[Backlog] PROJ-1: ドキュメント提出 (期限: 2024-01-15)'];
  global.fetchPendingSlackRequests = () => ['[Slack未返信] 02/24 09:12 #cs someone: ご確認お願いします'];

  const result = collectTodaysTasks(props, new Date('2024-01-15T00:00:00+09:00'));
  assertContains(result.text, '本日の予定', 'Calendar section should exist');
  assertContains(result.text, 'Backlog 未完了課題', 'Backlog section should exist');
  assertContains(result.text, 'Slack未返信依頼', 'Slack pending section should exist');
  assertContains(result.text, 'ご確認お願いします', 'Slack item should be present');
  if (result.warnings.length !== 0) {
    throw new Error('Warnings should be empty when all integrations succeed.');
  }
}

function test_collectTodaysTasks_warnsWhenBacklogMissing() {
  const props = {
    CALENDAR_IGNORE_WORDS: '',
    BACKLOG_CONFIGS: '[]',
    SLACK_USER_TOKEN: 'xoxp-test',
    SLACK_MEMBER_ID: 'U999999'
  };
  global.fetchGoogleCalendarEvents = () => [];
  global.fetchPendingSlackRequests = () => [];

  const result = collectTodaysTasks(props, new Date('2024-01-16T00:00:00+09:00'));
  if (!result.warnings || result.warnings.length === 0) {
    throw new Error('Warnings should be present when Backlog is not configured.');
  }
  assertContains(result.warnings.join('|'), 'Backlog連携', 'Backlog warning text should be included');
}

function test_getNextBusinessDay_skipsWeekendAndHoliday() {
  setup();
  global.isHoliday = (date) => {
    return date.getFullYear() === 2024 && date.getMonth() === 0 && date.getDate() === 22;
  };

  const result = getNextBusinessDay(new Date('2024-01-19T00:00:00+09:00'));

  assert(
    result.getFullYear() === 2024 &&
    result.getMonth() === 0 &&
    result.getDate() === 23,
    `翌営業日が 2024-01-23 になること。実際: ${result}`
  );
}

function test_formatSlackLogsForSheet_outputsStructuredTSV() {
  const messages = [{
    displayText: '[#daily-report] スレッド投稿',
    text: 'スレッド投稿',
    channelId: 'CDAILY',
    channelName: 'daily-report',
    userId: 'U12345',
    ts: '1700000000.000',
    threadTs: '1700000000.000',
    threadLabel: 'T001',
    threadTopText: 'スレッドトップ',
    permalink: 'https://example.com/p/abc'
  }];

  const result = formatSlackLogsForSheet(messages);
  if (!result.startsWith('__FORMAT=TSV')) {
    throw new Error('TSV marker should be present at the beginning of the Slack sheet payload.');
  }
  assertContains(result, '#daily-report', 'Channel name should be included.');
  assertContains(result, 'T001', 'Thread label should be included.');
  assertContains(result, 'https://example.com/p/abc', 'Permalink should be included.');
}

function test_promptSchemaMigrationDetection_worksByVersion() {
  setup();
  mockUserProperties.setProperty('PROMPT_SCHEMA_VERSION_CS', String(PROMPT_SCHEMA_VERSION));
  assert(needsPromptSchemaMigration_('CS') === false, '最新版ならマイグレーション不要');

  mockUserProperties.setProperty('PROMPT_SCHEMA_VERSION_CS', String(PROMPT_SCHEMA_VERSION - 1));
  assert(needsPromptSchemaMigration_('CS') === true, '旧版ならマイグレーション必要');
}

function test_sendToSlack_fixedThreadWithoutUrlDoesNotThrow() {
  setupE2E({
    UrlFetchApp: {
      fetch: () => ({
        getContentText: () => JSON.stringify({ ok: true, ts: '123.456' }),
        getResponseCode: () => 200,
      }),
      fetchAll: () => [],
    },
  });

  sendToSlack('本文', 'xoxp-token', 'C111111', 'fixed_thread', new Date('2024-01-15T00:00:00+09:00'), '', 'default');

  const payload = JSON.parse(global.lastFetchOptions.payload);
  assert(payload.channel === 'C111111', 'Slack投稿先が維持されること');
  assert(payload.text === '本文', 'Slack本文が維持されること');
  assert(!payload.thread_ts, 'URL未入力時はthread_tsを付与しないこと');
}

function test_saveRawLogsToSheet_convertsLegacySheet() {
  let renamed = false;
  let hidden = false;
  let inserted = false;
  let capturedRows = null;
  let legacyActive = true;

  const legacyRange = {
    getValue: () => '',
    setValue: () => legacyRange,
    setValues: () => legacyRange,
  };
  const legacySheet = {
    setName: () => { renamed = true; legacyActive = false; },
    appendRow: () => {},
    setFrozenRows: () => {},
    setColumnWidths: () => legacySheet,
    setColumnWidth: () => legacySheet,
    getRange: () => legacyRange,
    getLastRow: () => 1,
    clearContents: () => {},
    clearFormats: () => {},
    hideSheet: () => { hidden = true; },
  };

  const newRange = {
    getValue: () => '区分',
    setValue: () => newRange,
    setValues: (rows) => { capturedRows = rows; return newRange; },
  };
  const newSheet = {
    setName: () => {},
    appendRow: () => {},
    setFrozenRows: () => {},
    setColumnWidths: () => newSheet,
    setColumnWidth: () => newSheet,
    getRange: () => newRange,
    getLastRow: () => 1,
    clearContents: () => {},
    clearFormats: () => {},
    hideSheet: () => {},
  };

  global.SpreadsheetApp = {
    create: () => ({
      getId: () => 'legacy_sheet_id',
      getSheets: () => [legacySheet],
      getSheetByName: (name) => {
        if (name !== '生ログ') return null;
        if (legacyActive) return legacySheet;
        return inserted ? newSheet : null;
      },
      insertSheet: () => {
        inserted = true;
        return newSheet;
      },
      deleteSheet: () => {},
    }),
    openById: () => SpreadsheetApp.create(),
  };

  const sources = {
    slackRows: [{ ts: '1705280400.000000', channelName: 'legacy', threadLabel: '', threadTopText: '', text: 'legacy', permalink: '' }],
    calendarRows: [],
    gmailRows: [],
    backlogRows: [],
    salesforceRows: [],
  };

  saveRawLogsToSheet(sources, new Date('2024-01-15T00:00:00+09:00'));

  assert(renamed, 'Legacy sheet should be renamed');
  assert(hidden, 'Legacy sheet should be hidden');
  assert(inserted, 'New 生ログ sheet should be inserted');
  assert(capturedRows && capturedRows.length === 1, 'New sheet should receive rows');
}

function test_fetchGoogleCalendarEvents_ignoreWordsCaseInsensitive() {
  const events = [
    { title: 'Client Lunch', start: new Date('2024-01-15T10:00:00+09:00'), end: new Date('2024-01-15T11:00:00+09:00') },
    { title: 'LUNCH with VP', start: new Date('2024-01-15T12:00:00+09:00'), end: new Date('2024-01-15T13:00:00+09:00') },
    { title: 'Daily Standup', start: new Date('2024-01-15T09:00:00+09:00'), end: new Date('2024-01-15T09:30:00+09:00') },
  ];
  global.CalendarApp = {
    getDefaultCalendar: () => ({
      getEvents: () => events.map(ev => ({
        getTitle: () => ev.title,
        getStartTime: () => ev.start,
        getEndTime: () => ev.end,
      })),
      getEventsForDay: () => events.map(ev => ({
        getTitle: () => ev.title,
        getStartTime: () => ev.start,
        getEndTime: () => ev.end,
      })),
    }),
  };

  const result = originalFetchGoogleCalendarEvents(new Date('2024-01-15T00:00:00+09:00'), ['Lunch']);
  if (result.length !== 1) {
    throw new Error(`Expected only one event after filtering, but got ${result.length}`);
  }
  assertContains(result[0].log, 'Daily Standup', 'Non-matching event should remain');
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
  const resultPrompt = generateReportWithGemini('log', prompts, '詳細モード', new Date(), 'あり', 'あり', 'default', 'plain', '修正指示', null);

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
  const resultPrompt = generateAggregationWithGemini('log', new Date(), new Date(), 'Project List', '9.5', '修正指示');

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

function test_appendHitokotoVariationRules_injectsSpecificity() {
  const result = appendHitokotoVariationRules('#### ひとこと\n必ず1行。', '2024年01月15日 (月)');

  assertContains(result, '【ひとこと個性化ルール】', '個性化ルール見出し');
  assertContains(result, '汎用的な一言は禁止', '汎用文禁止');
  assertContains(result, '具体的な固有名詞', '具体性の要求');
  assertContains(result, '2024年01月15日 (月)', '対象日を含む');
}

function test_formatReportByBulletStyle_convertsMarkdown() {
  const plain = `● A様
　・タスク1

・単独トピック`;
  const markdown = formatReportByBulletStyle(plain, 'markdown');
  assertContains(markdown, '- A様', 'トップレベル変換');
  assertContains(markdown, '  - タスク1', '子要素変換');
  assertContains(markdown, '\n- 単独トピック', '単独トピックは親なし');

  const reverted = formatReportByBulletStyle(markdown, 'plain');
  assertContains(reverted, '● A様', 'トップレベル戻し');
  assertContains(reverted, '　・タスク1', '子要素戻し');
  assertContains(reverted, '● 単独トピック', '親なし行戻し');
}

function test_formatReportByBulletStyle_stripsEmphasisMarkers() {
  const report = `【日報】
**本日のタスク**
● A様
　・*仕様確認*
🔍 *AI業務改善フィードバック*`;

  const result = formatReportByBulletStyle(report, 'plain');

  if (result.indexOf('**') !== -1 || result.indexOf('*仕様確認*') !== -1 || result.indexOf('*AI業務改善フィードバック*') !== -1) {
    throw new Error(`強調記号が除去されること。実際: ${result}`);
  }
  assertContains(result, '本日のタスク', '太字マーカーなしの見出し');
  assertContains(result, '仕様確認', 'イタリックマーカーなしの本文');
  assertContains(result, 'AI業務改善フィードバック', 'イタリックマーカーなしのフィードバック見出し');
}

function test_resolveGeminiModelId_returnsSelectedModel() {
  mockUserProperties.setProperties({
    REPORT_FLASH_MODEL_ID: 'gemini-2.5-flash-custom'
  });

  const flashModel = resolveGeminiModelId_();

  assert(flashModel === 'gemini-2.5-flash-custom', `flash指定時は REPORT_FLASH_MODEL_ID が使われること。実際: ${flashModel}`);
}

function test_resolveGeminiModelId_defaultsToGemini25Flash() {
  mockUserProperties.setProperties({});

  const flashModel = resolveGeminiModelId_();
  assert(flashModel === 'gemini-2.5-flash', `未設定時は gemini-2.5-flash がデフォルトになること。実際: ${flashModel}`);
}

function test_isSalesforceCallback_recognizesStandardCodeState() {
  setup();
  mockCache.put('sf_oauth_state', 'sf-state-token', 600);

  const result = isSalesforceCallback_({
    parameter: {
      code: 'salesforce-auth-code',
      state: 'sf-state-token'
    }
  });

  assert(result === true, 'Salesforce標準の code/state コールバックをSalesforceとして判定すること');
}

function test_isSalesforceCallback_doesNotStealSlackCode() {
  setup();
  mockCache.put('sf_oauth_state', 'sf-state-token', 600);

  const result = isSalesforceCallback_({
    parameter: {
      code: 'slack-auth-code',
      state: 'slack-state-token'
    }
  });

  assert(result === false, 'Salesforce state と一致しない code/state はSlack側に残すこと');
}

function test_resolveVertexLocationForModel_usesGlobalForGemini3() {
  const previewLocation = resolveVertexLocationForModel_('gemini-3-flash-preview');
  const stableLocation = resolveVertexLocationForModel_('gemini-2.5-flash');

  assert(previewLocation === 'global', `Gemini 3 Preview は global endpoint を使うこと。実際: ${previewLocation}`);
  assert(stableLocation === LOCATION, `Gemini 2.5 Flash は既定リージョンを使うこと。実際: ${stableLocation}`);
}

function test_buildVertexGenerateContentUrl_usesGlobalEndpointForGemini3() {
  const url = buildVertexGenerateContentUrl_('gemini-3-flash-preview');

  assertContains(url, 'https://aiplatform.googleapis.com/v1/projects/', 'global host を使用');
  assertContains(url, '/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent', 'global location を使用');
}

function test_callVertexAI_maxTokens_returnsPartialTextWarning() {
  setupE2E({
    UrlFetchApp: {
      fetch: () => ({
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: '途中までの応答' }] }, finishReason: 'MAX_TOKENS' }],
        }),
        getResponseCode: () => 200,
      }),
      fetchAll: () => [],
    },
  });
  global.IS_TESTING = false;

  const result = callVertexAI('https://example.com', JSON.stringify({ contents: [] }));
  assertContains(result, '途中までの応答', '部分応答を返す');
  assertContains(result, '長さ制限', '注意文を付与する');
}

function test_callVertexAI_retriesOnTransientHttpErrors() {
  let attempt = 0;
  setupE2E({
    UrlFetchApp: {
      fetch: () => {
        attempt++;
        if (attempt < 3) {
          return {
            getContentText: () => JSON.stringify({ error: { message: 'Service unavailable' } }),
            getResponseCode: () => 503,
          };
        }
        return {
          getContentText: () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'retry-success' }] }, finishReason: 'STOP' }],
          }),
          getResponseCode: () => 200,
        };
      },
      fetchAll: () => [],
    },
  });
  global.IS_TESTING = false;

  try {
    callVertexAI('https://example.com', JSON.stringify({ contents: [] }));
    assert(false, '503が継続した場合はエラーを返すこと');
  } catch (e) {
    assertContains(String(e.message || e), 'AIサーバーエラー', '503時のユーザー向けエラー');
  }
  assert(attempt >= 1, `503レスポンス時にfetchが呼ばれること。実際: ${attempt}`);
}

function test_generateTodaysTodoWithGemini_truncatesLargeLogInput() {
  setupE2E();
  const longLog = 'A'.repeat(MAX_TODO_LOG_CHARS + 100);
  const result = generateTodaysTodoWithGemini(longLog, new Date('2024-01-15T00:00:00+09:00'));

  assert(typeof result.truncatedInput === 'boolean', 'truncatedInput がbooleanで返ること');
  assert(result && typeof result.text === 'string' && result.text.length > 0, '長文入力でもTODO文字列を返すこと');
}

function test_normalizeReportRevisionInstruction_mapsQuickFixHints() {
  const normalized = normalizeReportRevisionInstruction_('もっと丁寧に、簡潔にしてください');
  assertContains(normalized, 'tone:polite', '丁寧タグが付与されること');
  assertContains(normalized, 'brevity:high', '簡潔タグが付与されること');
}

function test_generateReportWithGemini_includesRewriteDraftHint() {
  setupE2E();
  const prompts = getDefaultPrompts();
  const promptText = generateReportWithGemini(
    '=== Googleカレンダー ===\n10:00 定例',
    prompts,
    '要約モード',
    new Date('2024-01-15T00:00:00+09:00'),
    'なし',
    'なし',
    'default',
    'plain',
    'もっと丁寧に',
    null,
    [],
    '● その他',
    '【日報】2024年01月15日\n👉 *本日のタスク*\n● A社対応'
  );
  assertContains(promptText, '【再生成モード（下書きベース）】', '下書きベース再生成ルールが含まれること');
  assertContains(promptText, 'tone:polite', '指示正規化タグが含まれること');
}

function test_sendTodaysTodoNotification_fallsBackWhenTodoFormatInvalid() {
  setup();
  mockUserProperties.setProperties({
    SLACK_USER_TOKEN: 'xoxp-test',
    SLACK_MEMBER_ID: 'U123',
    SLACK_CHANNEL_ID: 'C123',
    REPORT_DAY_FORMAT: 'default',
    TODO_SLACK_STYLE: 'direct',
  });
  global.collectTodaysTasks = () => ({
    text: '=== 本日の予定 ===\n[予定] 10:00 定例MTG\n\n=== Backlog 未完了課題 ===\n[Backlog] PROJ-1: 資料提出\n\n=== Slack未返信依頼 ===\n[Slack未返信] 01/15 11:00 #dev @alice: ご確認ください',
    warnings: []
  });
  global.generateTodaysTodoWithGemini = () => ({ text: '壊れた出力', truncatedInput: false });
  let sent = null;
  global.sendToSlack = (m) => { sent = m; };

  const result = sendTodaysTodoNotification();
  assert(result.success === true, 'フォールバックでも成功扱いで返ること');
  assertContains(result.message, '🟥 最優先', '最優先セクションが含まれること');
  assertContains(result.message, '📅 本日の予定', '予定セクションが含まれること');
  assertContains(result.message, '💬 Slack未返信', 'Slack未返信セクションが含まれること');
  assert(sent === null, '画面表示時は自動送信しないこと');
}

function test_enrichTodoMessageWithLinks_linksBacklogByKeyWithoutSourceId() {
  const todo = [
    '【今日のTODO】2026/05/14(Thu)',
    '',
    '🟥 最優先',
    '- KMT_2-75 : 分析テンプレートのご提供',
    '',
    '💬 Slack未返信',
    '- なし',
    '',
    '📅 本日の予定',
    '- なし',
    '',
    '📋 その他のタスク',
    '- なし'
  ].join('\n');

  const sourceContext = {
    byId: {},
    backlogByKey: {
      'KMT_2-75': {
        url: 'https://example.backlog.jp/view/KMT_2-75',
        label: '[Backlog] KMT_2-75: 分析テンプレートのご提供 (期限: 2025-11-19)'
      }
    }
  };

  const enriched = enrichTodoMessageWithLinks_(todo, '', sourceContext);
  assertContains(enriched, '[KMT_2-75 : 分析テンプレートのご提供');
  assertContains(enriched, '](https://example.backlog.jp/view/KMT_2-75)');
}

// --- E2E Integration Tests ---

function test_e2e_dailyReport_happyPath_cs() {
  setupE2E();
  seedUserSettings({
    REPORT_MANHOUR: 'あり',
    REPORT_REFLECTION: 'あり',
    SELECTED_DEPARTMENT: 'CS',
  });

  const previewResult = capturePrompt(() => generatePreviewReport(null, '2024-01-15', 'CS'));
  assert(previewResult.success, 'プレビュー取得成功');
  const promptText = previewResult.report;
  const prompts = getDefaultPrompts();
  assertContains(promptText, prompts.summary.trim().slice(0, 20), '要約モードプロンプト');
  assertContains(promptText, SAMPLE_CAL_LOG, 'カレンダーログ挿入');
  assertContains(promptText, SAMPLE_SLACK_LOG, 'Slackログ挿入');
  assertContains(promptText, SAMPLE_GMAIL_LOG, 'Gmailログ挿入');
  assertContains(promptText, SAMPLE_BACKLOG_LOG, 'Backlogログ挿入');
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
  assertContains(promptText, SAMPLE_GMAIL_LOG, 'ES Gmailログ挿入');
  assertContains(promptText, SAMPLE_BACKLOG_LOG, 'ES Backlogログ挿入');

  __setMockVertexResponse('AIモックレスポンス（ES）');
  global.IS_TESTING = false;
  const liveResult = generatePreviewReport(null, '2024-01-15', 'ES');
  assert(liveResult.success, 'ES本番成功');
  assert(liveResult.report === 'AIモックレスポンス（ES）', 'ESレスポンス受領');
}

function test_e2e_dailyReport_includesNextBusinessDayAndPendingSections() {
  setupE2E({
    fetchGoogleCalendarEvents: (date) => {
      const day = new Date(date).getDate();
      if (day === 19) {
        return [{ log: '[予定] 09:00 (30分) 当日定例', event: {
          getTitle: () => '当日定例',
          getStartTime: () => new Date('2024-01-19T09:00:00+09:00'),
          getEndTime: () => new Date('2024-01-19T09:30:00+09:00')
        } }];
      }
      if (day === 23) {
        return [{ log: '[予定] 10:00 (60分) 翌営業日キックオフ', event: {
          getTitle: () => '翌営業日キックオフ',
          getStartTime: () => new Date('2024-01-23T10:00:00+09:00'),
          getEndTime: () => new Date('2024-01-23T11:00:00+09:00')
        } }];
      }
      return [];
    },
    fetchBacklogTodayIssues: () => ['[Backlog] PROJ-9: 未提出資料の送付'],
    fetchPendingSlackRequests: () => ['[Slack未返信] 01/19 16:30 #support user: ご確認ください'],
    isHoliday: (date) => date.getFullYear() === 2024 && date.getMonth() === 0 && date.getDate() === 22
  });
  seedUserSettings({
    REPORT_MODE: '詳細モード',
    REPORT_MANHOUR: 'なし',
    REPORT_REFLECTION: 'なし',
    SELECTED_DEPARTMENT: 'CS'
  });

  const previewResult = capturePrompt(() => generatePreviewReport(null, '2024-01-19', 'CS'));
  assert(previewResult.success, 'プレビュー取得成功');
  const promptText = previewResult.report;

  assertContains(promptText, '=== Googleカレンダー (翌営業日 01/23(火)) ===', '翌営業日カレンダー見出し');
  assertContains(promptText, '翌営業日キックオフ', '翌営業日の予定内容');
  assertContains(promptText, '=== Backlog 未完了課題 ===', 'Backlog未完了見出し');
  assertContains(promptText, '未提出資料の送付', 'Backlog未完了内容');
  assertContains(promptText, '=== Slack未返信依頼 ===', 'Slack未返信見出し');
  assertContains(promptText, 'ご確認ください', 'Slack未返信内容');
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
    'PROJ-001: A社導入, PROJ-777: B社支援',
    '8.0',
    '週次レポート短縮'
  ));
  assert(promptResult.success, '集計プロンプト取得');
  const promptText = promptResult.report;
  assertContains(promptText, 'PROJ-001: A社導入', 'プロジェクト一覧注入');
  assertContains(promptText, 'PROJ-777: B社支援', '複数プロジェクト注入');
  assertContains(promptText, '8.0時間', '平均稼働時間注入');
  assertContains(promptText, '【集計期間】', '集計期間見出し');
  assertContains(promptText, 'Slack: 顧客一次対応', '期間ログ挿入');

  __setMockVertexResponse('[{\"label\":\"PROJ-001\",\"hours\":4.0}]\\nレポート本文');
  global.IS_TESTING = false;
  const liveResult = runPeriodAggregation(
    '2024-01-15',
    '2024-01-16',
    'PROJ-001: A社導入, PROJ-777: B社支援',
    '8.0',
    null
  );
  assert(liveResult.success, '集計呼び出し成功');
  assertContains(liveResult.report, 'PROJ-001', 'JSONブロック採用');
}

function test_e2e_aggregation_returnsFallbackWhenResultInvalid() {
  setupE2E();
  seedUserSettings({});
  __setMockVertexResponse('|---|---|---|');
  global.IS_TESTING = false;

  const result = runPeriodAggregation(
    '2024-01-15',
    '2024-01-16',
    'PROJ-001: A社導入',
    '8.0',
    null
  );

  assert(result.success, '集計呼び出し成功');
  assertContains(result.report, '集計結果の生成に失敗しました', 'フォールバック文言');
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

function test_e2e_todo_handlesMaxTokensEmptyResponse() {
  setupE2E({
    fetchBacklogTodayIssues: () => ['[Backlog] PROJ-1: ドキュメント提出 (期限: 2024-01-15)'],
    UrlFetchApp: {
      fetch: (url) => ({
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
        }),
        getResponseCode: () => 200,
      }),
      fetchAll: () => [],
    },
  });
  seedUserSettings({});
  global.IS_TESTING = false;

  const result = sendTodaysTodoNotification();
  assert(result.success === true, '空応答MAX_TOKENS時はフォールバック生成で成功扱い');
  assertContains(result.message, '🟥 最優先', 'フォールバックTODOを返すこと');
}

function test_loadClientAliasRules_validJson() {
  const json = JSON.stringify([{ canonical: 'A社様', keywords: ['A株式会社'] }]);
  const rules = loadClientAliasRules(json);
  assert(Array.isArray(rules), '配列が返ること');
  assert(rules.length === 1, `ルール数が1であること。実際: ${rules.length}`);
  assert(rules[0].canonical === 'A社様', `canonical が 'A社様' であること。実際: ${rules[0].canonical}`);
}

function test_loadClientAliasRules_invalidJson() {
  const rules = loadClientAliasRules('{ invalid json }');
  assert(Array.isArray(rules), '不正JSONでも配列が返ること');
  assert(rules.length === 0, '不正JSONは空配列になること');
}

function test_createClientResolver_slackChannelMatch() {
  const resolver = createClientResolver([{ canonical: 'A社様', slackChannels: ['C01ABC'] }]);
  const result = resolver({ sourceType: 'slack', channelId: 'C01ABC', channelName: 'a', text: '' });
  assert(result === 'A社様', `SlackチャンネルIDで 'A社様' が返ること。実際: ${result}`);
}

function test_createClientResolver_skipsDisabledRule() {
  const resolver = createClientResolver([
    { canonical: '無効ルール', enabled: false, slackChannels: ['C01ABC'] },
    { canonical: '有効ルール', slackChannels: ['C02XYZ'] }
  ]);
  const disabledResult = resolver({ sourceType: 'slack', channelId: 'C01ABC', channelName: 'proj-a', text: '' });
  const enabledResult = resolver({ sourceType: 'slack', channelId: 'C02XYZ', channelName: 'proj-b', text: '' });
  assert(disabledResult === null, `enabled=false のルールは一致対象外であること。実際: ${disabledResult}`);
  assert(enabledResult === '有効ルール', `有効ルールは引き続き一致すること。実際: ${enabledResult}`);
}

function test_createClientResolver_backlogKeyMatch() {
  const resolver = createClientResolver([{ canonical: 'B社様', backlogKeys: ['BKEY'] }]);
  const result = resolver({ sourceType: 'backlog', projectKey: 'bkey', title: '', text: '' });
  assert(result === 'B社様', `Backlogキーの大文字小文字を無視して一致すること。実際: ${result}`);
}

function test_createClientResolver_keywordMatch() {
  const resolver = createClientResolver([{ canonical: 'C社様', keywords: ['c株式会社'] }]);
  const result = resolver({ sourceType: 'gmail', title: 'C株式会社と打合せ', text: '' });
  assert(result === 'C社様', `キーワード部分一致で 'C社様' が返ること。実際: ${result}`);
}

function test_createClientResolver_keywordNormalization_ignoresFullwidthAndSpaces() {
  const resolver = createClientResolver([{ canonical: 'A社様', keywords: ['a株式会社'] }]);
  const result = resolver({ sourceType: 'gmail', title: 'Ａ　株 式 会 社 との定例', text: '' });
  assert(result === 'A社様', `全角/空白ゆらぎを吸収して一致すること。実際: ${result}`);
}

function test_createClientResolver_keywordPrefersLongerMatch() {
  const resolver = createClientResolver([
    { canonical: '短語ルール', keywords: ['ワコール'] },
    { canonical: '長語ルール', keywords: ['ワコール様向け'] }
  ]);
  const result = resolver({ sourceType: 'slack', text: 'ワコール様向けアナウンスの保留対応' });
  assert(result === '長語ルール', `競合時は長いキーワードを優先すること。実際: ${result}`);
}

function test_createClientResolver_keywordExactMatchWins() {
  const resolver = createClientResolver([
    { canonical: '部分一致ルール', keywords: ['ワコール'] },
    { canonical: '完全一致ルール', keywords: ['次回のリリースノートの準備'] }
  ]);
  const result = resolver({ sourceType: 'slack', text: '次回のリリースノートの準備' });
  assert(result === '完全一致ルール', `部分一致より完全一致を優先すること。実際: ${result}`);
}

function test_createClientResolver_noMatch() {
  const resolver = createClientResolver([{ canonical: 'D社様', keywords: ['d社'] }]);
  const result = resolver({ sourceType: 'slack', channelId: 'C999', channelName: 'general', text: '雑談' });
  assert(result === null, `一致が無い場合は null を返すこと。実際: ${result}`);
}

function test_suggestClientAliasRules_excludesRegisteredCandidates() {
  mockUserProperties.setProperties({
    SLACK_USER_TOKEN: 'xoxp-test',
    CLIENT_ALIAS_RULES: JSON.stringify([
      { canonical: 'A社様', slackChannels: ['C123'], backlogKeys: ['ACME'] }
    ]),
    BACKLOG_CONFIGS: JSON.stringify([{ host: 'example.backlog.jp', key: 'dummy-key' }])
  });
  global.UrlFetchApp = {
    fetch: (url) => {
      if (url.indexOf('conversations.list') !== -1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            ok: true,
            channels: [
              { id: 'C123', name: 'registered-channel' },
              { id: 'C999', name: 'new-channel' }
            ],
            response_metadata: {}
          })
        };
      }
      if (url.indexOf('/api/v2/projects') !== -1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify([
            { id: 1, name: 'ACME社', projectKey: 'ACME' },
            { id: 2, name: 'BETA社', projectKey: 'BETA' }
          ])
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    fetchAll: () => []
  };

  const result = suggestClientAliasRules();
  assert(result.slack.length === 1, `Slack候補は未登録1件のみ返ること。実際: ${JSON.stringify(result.slack)}`);
  assert(result.slack[0].id === 'C999', `Slack候補に C999 が含まれること。実際: ${result.slack[0].id}`);
  assert(result.backlog.length === 1, `Backlog候補は未登録1件のみ返ること。実際: ${JSON.stringify(result.backlog)}`);
  assert(result.backlog[0].projectKey === 'BETA', `Backlog候補に BETA が含まれること。実際: ${result.backlog[0].projectKey}`);
}

function test_runClientAliasAutoTest_collectsSlackAndBacklogMatches() {
  mockUserProperties.setProperties({
    SLACK_USER_TOKEN: 'xoxp-test',
    SLACK_IGNORE_CHANNELS: '',
    BACKLOG_CONFIGS: JSON.stringify([{ host: 'example.backlog.jp', key: 'dummy-key' }])
  });
  global.UrlFetchApp = {
    fetch: (url) => {
      if (url.indexOf('conversations.list') !== -1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            ok: true,
            channels: [{ id: 'C123', name: 'proj-a' }],
            response_metadata: {}
          })
        };
      }
      if (url.indexOf('conversations.history') !== -1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            ok: true,
            messages: [{ text: 'A社向け定例の確認です' }]
          })
        };
      }
      if (url.indexOf('/api/v2/issues') !== -1) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify([
            { issueKey: 'BETA-101', summary: 'B社様向けタスク整理', project: { projectKey: 'BETA' } }
          ])
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    fetchAll: () => []
  };

  const result = runClientAliasAutoTest(JSON.stringify([
    { canonical: 'A社様', slackChannels: ['C123'] },
    { canonical: 'B社様', backlogKeys: ['BETA'] }
  ]));

  assert(result.length === 2, `SlackとBacklogの2件が返ること。実際: ${JSON.stringify(result)}`);
  assert(result[0].source === 'slack' && result[0].matched === 'A社様', `Slackログが A社様 に分類されること。実際: ${JSON.stringify(result[0])}`);
  assert(result[1].source === 'backlog' && result[1].matched === 'B社様', `Backlogログが B社様 に分類されること。実際: ${JSON.stringify(result[1])}`);
}

function test_collectLogs_attachesClientNameToSlack() {
  const props = {
    SLACK_USER_TOKEN: 'xoxp-test',
    REPORT_SLACK_SCOPE: 'all',
    SLACK_IGNORE_CHANNELS: '',
    CALENDAR_IGNORE_WORDS: '',
    CLIENT_ALIAS_RULES: JSON.stringify([{ canonical: 'A社様', slackChannels: ['C123'] }])
  };
  global.fetchGoogleCalendarEvents = () => [];
  global.fetchMySlackPosts = () => [{
    text: '定例の共有',
    displayText: '[#proj-a] 定例の共有',
    channelId: 'C123',
    channelName: 'proj-a',
    ts: '1705280400.000000',
    threadTs: '1705280400.000000',
    permalink: 'https://slack.com/p/1'
  }];
  global.formatSlackLogsForSheet = (msgs) => msgs.map(m => m.displayText).join('\\n');
  global.fetchGmailSentMessages = () => [];
  global.fetchMultiBacklogActivities = () => [];
  global.fetchTeamSpiritWorkTime = () => null;
  global.fetchTeamSpiritFromBigQuery = () => null;
  global.fetchOpportunities = () => [];
  global.fetchOpportunityTasks = () => [];
  global.fetchOpportunitiesFromBigQuery = () => [];

  const result = collectLogs(props, new Date('2024-01-15T00:00:00+09:00'), 'CS');
  assert(result.clients.length === 1 && result.clients[0] === 'A社様', `clients配列に 'A社様' が含まれること。実際: ${JSON.stringify(result.clients)}`);
  assertContains(result.text, '【A社様】', 'Slackログにクライアントラベルが付与されること');
  const slackRow = result.sources.slackRows[0];
  assert(slackRow.clientName === 'A社様', `Slack行に clientName が保存されること。実際: ${slackRow.clientName}`);
}

function test_collectLogs_ignoresDisabledAliasRules() {
  const props = {
    SLACK_USER_TOKEN: 'xoxp-test',
    REPORT_SLACK_SCOPE: 'all',
    SLACK_IGNORE_CHANNELS: '',
    CALENDAR_IGNORE_WORDS: '',
    CLIENT_FALLBACK_NAME: '● その他・社内業務',
    CLIENT_ALIAS_RULES: JSON.stringify([
      { canonical: '無効ルール', enabled: false, slackChannels: ['C123'] }
    ])
  };
  global.fetchGoogleCalendarEvents = () => [];
  global.fetchMySlackPosts = () => [{
    text: '定例の共有',
    displayText: '[#proj-a] 定例の共有',
    channelId: 'C123',
    channelName: 'proj-a',
    ts: '1705280400.000000',
    threadTs: '1705280400.000000',
    permalink: 'https://slack.com/p/1'
  }];
  global.formatSlackLogsForSheet = (msgs) => msgs.map(m => m.displayText).join('\\n');
  global.fetchGmailSentMessages = () => [];
  global.fetchMultiBacklogActivities = () => [];
  global.fetchTeamSpiritWorkTime = () => null;
  global.fetchTeamSpiritFromBigQuery = () => null;
  global.fetchOpportunities = () => [];
  global.fetchOpportunityTasks = () => [];
  global.fetchOpportunitiesFromBigQuery = () => [];

  const result = collectLogs(props, new Date('2024-01-15T00:00:00+09:00'), 'CS');
  assert(result.clients.length === 0, `無効ルールだけの場合は clients が空であること。実際: ${JSON.stringify(result.clients)}`);
  assert(result.text.indexOf('● その他・社内業務') === -1, `無効ルールだけでフォールバック名が付与されないこと。実際: ${result.text}`);
}

function test_collectLogs_warnsWhenClientAliasUnmatched() {
  const props = {
    SLACK_USER_TOKEN: 'xoxp-test',
    REPORT_SLACK_SCOPE: 'all',
    SLACK_IGNORE_CHANNELS: '',
    CALENDAR_IGNORE_WORDS: '',
    CLIENT_FALLBACK_NAME: '● その他・社内業務',
    CLIENT_ALIAS_RULES: JSON.stringify([
      { canonical: 'A社様', slackChannels: ['C123'] }
    ])
  };
  global.fetchGoogleCalendarEvents = () => [];
  global.fetchMySlackPosts = () => [{
    text: '分類対象の投稿',
    displayText: '[#proj-z] 分類対象の投稿',
    channelId: 'C999',
    channelName: 'proj-z',
    ts: '1705280400.000000',
    threadTs: '1705280400.000000',
    permalink: 'https://slack.com/p/1'
  }];
  global.formatSlackLogsForSheet = (msgs) => msgs.map(m => m.displayText).join('\\n');
  global.fetchGmailSentMessages = () => [];
  global.fetchMultiBacklogActivities = () => [];
  global.fetchTeamSpiritWorkTime = () => null;
  global.fetchTeamSpiritFromBigQuery = () => null;
  global.fetchOpportunities = () => [];
  global.fetchOpportunityTasks = () => [];
  global.fetchOpportunitiesFromBigQuery = () => [];

  const result = collectLogs(props, new Date('2024-01-15T00:00:00+09:00'), 'CS');
  assert(result.clients.length === 0, `未マッチ時は clients が空であること。実際: ${JSON.stringify(result.clients)}`);
  assertContains(result.text, '● その他・社内業務', '未マッチ時はフォールバック名を付与すること');
  const warningText = (result.warnings || []).join('\n');
  assertContains(warningText, 'クライアント名寄せで未分類', '未分類warningが返ること');
}

// このグローバル変数は、テスト関数内でGASサービスをモックするために必要です。
const global = this;
const originalFetchGoogleCalendarEvents = fetchGoogleCalendarEvents;
