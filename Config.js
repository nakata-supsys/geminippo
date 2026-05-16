// ==========================================
// Config.gs: 設定保存・スプレッドシート管理
// ==========================================

/**
 * Secret Managerから機密情報を取得します。
 * @param {string} secretName 取得するシークレットの名前
 * @param {string} fallbackValue 取得失敗時のフォールバック値
 * @returns {string} シークレットの値
 */
function getSecret(secretName, fallbackValue) {
  try {
    // Secret Manager ライブラリが未導入の場合はフォールバック（GAS標準にはない）
    if (typeof SecretManager === 'undefined') return fallbackValue;
    return SecretManager.getSecret(secretName);
  } catch (e) {
    return fallbackValue;
  }
}

const PROJECT_ID = PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID')
  || getSecret('GCP_PROJECT_ID', null);
const LOCATION = 'us-central1'; 
const PROMPT_SCHEMA_VERSION = 2;

function getPromptSchemaVersionKey_(department) {
  const dept = (department === 'ES') ? 'ES' : 'CS';
  return `PROMPT_SCHEMA_VERSION_${dept}`;
}

function markPromptSchemaVersion_(department) {
  PropertiesService.getUserProperties().setProperty(getPromptSchemaVersionKey_(department), String(PROMPT_SCHEMA_VERSION));
}

function needsPromptSchemaMigration_(department) {
  const userProps = PropertiesService.getUserProperties();
  const current = parseInt(userProps.getProperty(getPromptSchemaVersionKey_(department)) || '0', 10) || 0;
  return current < PROMPT_SCHEMA_VERSION;
}

function migratePromptSchemaIfNeeded_(department) {
  if (!needsPromptSchemaMigration_(department)) return false;
  resetToDefaultPrompts(department);
  markPromptSchemaVersion_(department);
  return true;
}


function saveUserSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  const reportFlashModelId = (data.reportFlashModelId || userProps.getProperty('REPORT_FLASH_MODEL_ID') || 'gemini-2.5-flash').trim();

  const propsToSave = {
    'SLACK_CHANNEL_ID': data.slackId || userProps.getProperty('SLACK_MEMBER_ID'),
    'REPORT_MODEL_TYPE': 'flash',
    'REPORT_FLASH_MODEL_ID': reportFlashModelId || 'gemini-2.5-flash',
    'REPORT_MODE': '要約モード',
    'REPORT_BULLET_STYLE': data.bulletStyle || userProps.getProperty('REPORT_BULLET_STYLE') || 'plain',
    'REPORT_SLACK_STYLE': data.slackStyle,
    'REPORT_FIXED_THREAD_URL': data.fixedThreadUrl,
    'REPORT_MANHOUR': data.reportManhour,
    'REPORT_REFLECTION': data.reportReflection,
    'REPORT_SLACK_SCOPE': data.slackScope,
    'REPORT_DAY_FORMAT': 'default',
    'REPORT_DATE': data.reportDate,
    'REPORT_SCHEDULE_TIME': data.scheduleEnable === 'on' ? data.scheduleTime : 'off',
    'REPORT_SCHEDULE_DAYS': JSON.stringify(data.scheduleDays || []),
    'REPORT_SKIP_HOLIDAYS': data.skipHolidays || 'false',
    'CALENDAR_IGNORE_WORDS': data.CALENDAR_IGNORE_WORDS,
    'SLACK_IGNORE_CHANNELS': data.SLACK_IGNORE_CHANNELS,
    'TODO_SLACK_STYLE': data.todoSlackStyle || 'direct',
    'TODO_FIXED_THREAD_URL': data.todoFixedThreadUrl || '',
    'BACKLOG_CONFIGS': JSON.stringify(data.backlogConfigs || []),
    'CLIENT_ALIAS_RULES': data.clientAliasRules || '',
    'CLIENT_FALLBACK_NAME': data.clientFallbackName || '● その他',
    // CS部固定運用
    'SELECTED_DEPARTMENT': 'CS'
  };
  if (Object.prototype.hasOwnProperty.call(data, 'todoHousekeepDays')) {
    propsToSave.TODO_HOUSEKEEP_DAYS = String(Math.max(1, Math.min(30, parseInt(data.todoHousekeepDays || '5', 10) || 5)));
  }
  if (Object.prototype.hasOwnProperty.call(data, 'reportSlackHousekeeping')) {
    propsToSave.REPORT_SLACK_HOUSEKEEPING = data.reportSlackHousekeeping === 'on' ? 'on' : 'off';
  }

  userProps.setProperties(propsToSave, false);

  // 名寄せ辞書キャッシュをリセット
  try {
    CacheService.getUserCache().remove('CLIENT_ALIAS_RULES_PARSED');
  } catch (e) {
    console.warn('Failed to clear client alias cache:', e.message);
  }

  userProps.setProperty('initialized', 'true');

  const isEnable = data.scheduleEnable === 'on';
  updateTrigger_(isEnable);

  if (data.todoNotifyEnable !== undefined) {
    userProps.setProperties({
      'TODO_NOTIFY_ENABLE': data.todoNotifyEnable || 'off',
      'TODO_NOTIFY_TIME': data.todoNotifyEnable === 'on' ? (data.todoNotifyTime || '09:00') : 'off',
      'TODO_NOTIFY_DAYS': JSON.stringify(data.todoNotifyDays || []),
      'TODO_SKIP_HOLIDAYS': (data.todoSkipHolidays === true || data.todoSkipHolidays === 'true' || data.todoSkipHolidays === 'on') ? 'true' : 'false',
      'TODO_HOUSEKEEP_DAYS': String(Math.max(1, Math.min(30, parseInt(data.todoHousekeepDays || '5', 10) || 5)))
    }, false);
    updateTodoTrigger_(data.todoNotifyEnable === 'on');
  }

  return { success: true, message: "設定を保存しました！" };
}

function getOrSetupAppSheet() {
  const userProps = PropertiesService.getUserProperties();
  let id = userProps.getProperty('APP_SHEET_ID');
  let ss;

  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (e) {
      id = null;
    }
  }

  if (!id) {
    ss = SpreadsheetApp.create("📂 AI日報_管理データ");
    id = ss.getId();
    userProps.setProperty('APP_SHEET_ID', id);
    
    let hSheet = ss.getSheets()[0];
    hSheet.setName('履歴');
    hSheet.appendRow(["送信日時", "対象日", "日報内容"]);
    hSheet.setFrozenRows(1);
    
    let rawSheet = ss.insertSheet('生ログ');
    initializeRawLogSheet(rawSheet);
    
    // プロンプトシートを初期化（CS部）
    resetToDefaultPrompts('CS');
    // ES部プロンプトシートも初期化
    resetToDefaultPrompts('ES');
  }
  cleanupLegacyPromptSheet(ss);
  return ss;
}

/**
 * 部署別プロンプトを取得します
 * @param {string} department 部署コード（'CS' または 'ES'）
 * @returns {object} プロンプト設定
 */
function getDepartmentPrompts(department) {
  const dept = (department === 'ES') ? 'ES' : 'CS';
  const migrated = migratePromptSchemaIfNeeded_(dept);
  const cache = CacheService.getUserCache();
  const cacheKey = `prompt_settings_${dept}_v1`;
  if (migrated) {
    cache.remove(cacheKey);
  }
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${dept}`;
  let sheet = ss.getSheetByName(sheetName);
  
  // シートが存在しない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // ヘッダー行を設定
    sheet.getRange('A1').setValue('【要約モード指示】');
    sheet.getRange('C1').setValue('【詳細モード指示】');
    sheet.getRange('E1').setValue('【工数算出ルール】');
    sheet.getRange('G1').setValue('【フィードバック視点】');
    sheet.getRange('I1').setValue('【期間集計モード指示】');
    sheet.setColumnWidths(1, 10, 400);
    // デフォルトプロンプトを設定
    const defaults = getDefaultPromptsForDepartment(dept);
    sheet.getRange('A2').setValue(defaults.summary);
    sheet.getRange('C2').setValue(defaults.detail);
    sheet.getRange('E2').setValue(defaults.manhour);
    sheet.getRange('G2').setValue(defaults.reflection);
    sheet.getRange('I2').setValue(defaults.aggregation);
  }
  
  const prompts = {
    summary: sheet.getRange('A2').getValue() || getDefaultPromptsForDepartment(dept).summary,
    detail: sheet.getRange('C2').getValue() || getDefaultPromptsForDepartment(dept).detail,
    manhour: sheet.getRange('E2').getValue() || getDefaultPromptsForDepartment(dept).manhour,
    reflection: sheet.getRange('G2').getValue() || getDefaultPromptsForDepartment(dept).reflection,
    aggregation: sheet.getRange('I2').getValue() || getDefaultPromptsForDepartment(dept).aggregation
  };
  
  cache.put(cacheKey, JSON.stringify(prompts), 600);
  return prompts;
}

function cleanupLegacyPromptSheet(ss) {
  const legacy = ss.getSheetByName('プロンプト');
  if (!legacy) return;
  if (!ss.getSheetByName('プロンプト_CS')) {
    legacy.setName('プロンプト_CS');
  } else {
    ss.deleteSheet(legacy);
  }
}

/**
 * 部署別プロンプトを保存します
 * @param {string} department 部署コード
 * @param {object} data プロンプトデータ
 * @returns {object} 保存結果
 */
function saveDepartmentPrompts(department, data) {
  const dept = (department === 'ES') ? 'ES' : 'CS';
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${dept}`;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  sheet.getRange('A2').setValue(data.summary);
  sheet.getRange('C2').setValue(data.detail);
  sheet.getRange('E2').setValue(data.manhour);
  sheet.getRange('G2').setValue(data.reflection);
  if (data.aggregation) sheet.getRange('I2').setValue(data.aggregation);
  
  CacheService.getUserCache().remove(`prompt_settings_${dept}_v1`);
  CacheService.getUserCache().remove('prompt_settings_v2'); // 互換用（旧キー）
  markPromptSchemaVersion_(dept);
  
  return { success: true, message: `${dept}部のプロンプト設定を更新しました！` };
}

/**
 * 部署別のデフォルトプロンプトを取得します
 * @param {string} department 部署コード
 * @returns {object} デフォルトプロンプト
 */
function getDefaultPromptsForDepartment(department) {
  if (department === 'ES') {
    // ES部向けのデフォルトプロンプトはAI.jsに定義
    return getDefaultPromptsES();
  } else {
    // CS部向けのデフォルトプロンプトはAI.jsのDEFAULT_PROMPTS（既存）
    return getDefaultPrompts();
  }
}

/**
 * 既存のgetPromptSettings関数を部署対応に変更
 * 後方互換性のため、デフォルトはCS部
 */
function getPromptSettings() {
  return getDepartmentPrompts('CS');
}


function savePromptSettings(data) {
  // 既存のsavePromptSettingsはCS部として扱う
  return saveDepartmentPrompts('CS', data);
}

function reviewPromptSettings(department) {
  const dept = department || 'CS';
  const prompts = getDepartmentPrompts(dept);
  const checks = [];

  function push(level, area, message) {
    checks.push({ level: level, area: area, message: message });
  }

  const summary = String(prompts.summary || '');
  const detail = String(prompts.detail || '');

  const requiredSources = ['Slack', 'Backlog', 'Googleカレンダー', 'Gmail'];
  requiredSources.forEach(function(src) {
    if (summary.indexOf(src) === -1) {
      push('warn', '要約モード', `データソース記載に「${src}」が見当たりません。`);
    }
  });

  if (summary.indexOf('Git') !== -1) {
    push('warn', '要約モード', '未連携ソース「Git」が含まれています。');
  }
  if (summary.indexOf('Salesforce') !== -1) {
    push('warn', '要約モード', '未連携ソース「Salesforce」が含まれています。');
  }
  if (summary.indexOf('=== Calendar ===') !== -1 || detail.indexOf('=== Calendar ===') !== -1) {
    push('warn', 'セクション名', '旧見出し「=== Calendar ===」が含まれています。');
  }

  if (!checks.length) {
    push('ok', '全体', '重大な不整合は見つかりませんでした。');
  }

  return {
    success: true,
    department: dept,
    checks: checks
  };
}

function resetToDefaultPrompts(department = 'CS') {
  const dept = (department === 'ES') ? 'ES' : 'CS';
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName(`プロンプト_${dept}`);
  if (!sheet) {
    sheet = ss.insertSheet(`プロンプト_${dept}`, 1);
  }
  
  const defaults = getDefaultPromptsForDepartment(dept);

  sheet.getRange('A1').setValue('【要約モード指示】');
  sheet.getRange('A2').setValue(defaults.summary);
  sheet.getRange('C1').setValue('【詳細モード指示】');
  sheet.getRange('C2').setValue(defaults.detail);
  sheet.getRange('E1').setValue('【工数算出ルール】');
  sheet.getRange('E2').setValue(defaults.manhour);
  sheet.getRange('G1').setValue('【フィードバック視点】');
  sheet.getRange('G2').setValue(defaults.reflection);
  sheet.getRange('I1').setValue('【期間集計モード指示】');
  sheet.getRange('I2').setValue(defaults.aggregation);

  sheet.setColumnWidths(1, 10, 400); // A-J列の幅を調整

  CacheService.getUserCache().remove(`prompt_settings_${dept}_v1`);
  markPromptSchemaVersion_(dept);

  return { success: true, message: "プロンプトを初期値に戻しました！", prompts: defaults };
}

/**
 * 予約係トリガー（毎日深夜0時）と本番トリガーを一括管理する共通関数。
 * @param {boolean} isEnable スケジュールを有効にするか
 * @param {string} plannerFunction 予約係関数名
 * @param {string} runnerFunction 本番実行関数名
 * @param {Function} planNow 設定即時反映のために呼ぶ予約関数
 */
function updateScheduleTrigger_(isEnable, plannerFunction, runnerFunction, planNow) {
  const triggers = ScriptApp.getProjectTriggers();
  let plannerExists = false;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === plannerFunction) {
      if (isEnable && !plannerExists) {
        plannerExists = true;
      } else {
        ScriptApp.deleteTrigger(trigger);
      }
    }
  });

  if (isEnable) {
    if (!plannerExists) {
      ScriptApp.newTrigger(plannerFunction)
        .timeBased()
        .everyDays(1)
        .atHour(0)
        .create();
    }
    planNow();
  } else {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getHandlerFunction() === runnerFunction) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }
}

/**
 * スケジュール実行の「予約係」トリガーを更新します。
 * @param {boolean} isEnable スケジュールを有効にするか
 */
function updateTrigger_(isEnable) {
  updateScheduleTrigger_(isEnable, 'planTodaysExecution', 'autoRunDailyReport', planTodaysExecution);
}

/**
 * 予約係関数。毎日深夜に実行され、その日の本番トリガーをセットします。
 */
function planTodaysExecution() {
  const userProps = PropertiesService.getUserProperties();
  const props = userProps.getProperties();
  const scheduleTime = props.REPORT_SCHEDULE_TIME; // "HH:mm"

  if (!scheduleTime || scheduleTime === 'off') return;

  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  const targetDays = JSON.parse(props.REPORT_SCHEDULE_DAYS || "[]");

  // 実行曜日か、祝日スキップ対象か判定
  if (!targetDays.includes(dayOfWeek)) return;
  if (props.REPORT_SKIP_HOLIDAYS === 'true' && isHoliday(today)) return;

  // ★修正: 既存の autoRunDailyReport トリガーを削除してから作成する（重複防止）
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRunDailyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 実行時刻のDateオブジェクトを作成
  const [hour, minute] = scheduleTime.split(':');
  const executionDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(hour, 10), parseInt(minute, 10));

  // 実行時刻が過去でない場合のみ、1回限りのトリガーを作成
  if (executionDate > new Date()) {
    ScriptApp.newTrigger('autoRunDailyReport')
      .timeBased()
      .at(executionDate)
      .create();
  }
}

function autoRunDailyReport() {
  runDailyReportAndArchive();
}

function isHoliday(date) {
  const calId = 'ja.japanese#holiday@group.v.calendar.google.com';
  const cal = CalendarApp.getCalendarById(calId);
  if (!cal) {
    console.warn('祝日カレンダーが取得できません。祝日スキップは無効として処理します。');
    return false;
  }
  return cal.getEventsForDay(date).length > 0;
}

/**
 * TODO通知スケジュールの「予約係」トリガーを更新します。
 * @param {boolean} isEnable 通知を有効にするか
 */
function updateTodoTrigger_(isEnable) {
  updateScheduleTrigger_(isEnable, 'planTodaysTodoExecution', 'autoRunTodaysTodo', planTodaysTodoExecution);
}

/**
 * TODO通知の予約係関数。毎日深夜に実行され、その日の本番トリガーをセットします。
 */
function planTodaysTodoExecution() {
  const userProps = PropertiesService.getUserProperties();
  const props = userProps.getProperties();
  const notifyTime = props.TODO_NOTIFY_TIME;

  if (!notifyTime || notifyTime === 'off') return;

  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  const targetDays = JSON.parse(props.TODO_NOTIFY_DAYS || '[]');

  if (!targetDays.includes(dayOfWeek)) return;
  if (props.TODO_SKIP_HOLIDAYS === 'true' && isHoliday(today)) return;

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRunTodaysTodo') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const [hour, minute] = notifyTime.split(':');
  const executionDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    parseInt(hour, 10),
    parseInt(minute, 10)
  );

  if (executionDate > new Date()) {
    ScriptApp.newTrigger('autoRunTodaysTodo')
      .timeBased()
      .at(executionDate)
      .create();
  }
}

/**
 * 「今日のTODO」タブからの保存用。通知設定のみ更新する。
 * @param {object} data { todoNotifyEnable, todoNotifyTime, todoNotifyDays, todoHousekeepDays }
 */
function saveTodoSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    'TODO_NOTIFY_ENABLE': data.todoNotifyEnable || 'off',
    'TODO_NOTIFY_TIME': data.todoNotifyEnable === 'on' ? (data.todoNotifyTime || '09:00') : 'off',
    'TODO_NOTIFY_DAYS': JSON.stringify(data.todoNotifyDays || []),
    'TODO_SKIP_HOLIDAYS': (data.todoSkipHolidays === true || data.todoSkipHolidays === 'true' || data.todoSkipHolidays === 'on') ? 'true' : 'false',
    'TODO_SLACK_STYLE': data.todoSlackStyle || 'direct',
    'TODO_FIXED_THREAD_URL': data.todoFixedThreadUrl || '',
    'TODO_HOUSEKEEP_DAYS': String(Math.max(1, Math.min(30, parseInt(data.todoHousekeepDays || '5', 10) || 5)))
  }, false);
  updateTodoTrigger_(data.todoNotifyEnable === 'on');
  return { success: true, message: '通知設定を保存しました！' };
}

/**
 * 生ログ（AI要約前の各ソースのテキスト）を "生ログ" シートに追記します。
 * @param {object} sources ソース別テキスト { calendar, slack, gmail, backlog, salesforce }
 * @param {Date} targetDate 対象日
 */
const RAW_LOG_HEADERS = ["記録日時", "対象日", "区分", "日時", "クライアント", "場所/チャンネル", "スレッドNo", "スレッドトップ", "内容", "URL"];

function saveRawLogsToSheet(sources, targetDate) {
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName('生ログ');

  if (sheet) {
    const c3Val = sheet.getLastRow() > 0 ? sheet.getRange(1, 3).getValue() : '';
    if (c3Val !== '区分') {
      const legacyName = `生ログ_旧_${Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd_HHmmss')}`;
      try {
        sheet.setName(legacyName);
        if (sheet.hideSheet) sheet.hideSheet();
      } catch (e) {
        sheet.setName('生ログ_旧');
      }
      sheet = null;
    }
  }

  if (!sheet) {
    sheet = ss.getSheetByName('生ログ');
    if (!sheet) {
      sheet = ss.insertSheet('生ログ');
    }
    initializeRawLogSheet(sheet);
  }

  const now = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  const dateStr = Utilities.formatDate(targetDate, 'JST', 'yyyy/MM/dd');
  const rows = [];

  // Slack
  (sources.slackRows || []).forEach(m => {
    const tsSec = parseFloat(m.ts || 0);
    const postDate = tsSec > 0 ? Utilities.formatDate(new Date(tsSec * 1000), 'JST', 'yyyy/MM/dd HH:mm:ss') : '';
    const threadTop = m.threadTopText || '';
    rows.push([
      now, dateStr, 'Slack',
      postDate,
      m.clientName || '',
      m.channelName ? `#${m.channelName}` : '',
      m.threadLabel || '',
      threadTop,
      m.text || '',
      m.permalink || ''
    ]);
  });

  // カレンダー
  (sources.calendarRows || []).forEach(ev => {
    const startDate = ev.event ? Utilities.formatDate(ev.event.getStartTime(), 'JST', 'yyyy/MM/dd HH:mm') : '';
    rows.push([
      now, dateStr, 'カレンダー',
      startDate,
      ev.clientName || '',
      '', '', '',
      ev.event ? ev.event.getTitle() : (ev.log || ''),
      ''
    ]);
  });

  // Gmail
  (sources.gmailRows || []).forEach(g => {
    const sentDate = g.date ? Utilities.formatDate(g.date, 'JST', 'yyyy/MM/dd HH:mm:ss') : '';
    const contentParts = [];
    if (g.displayText) {
      contentParts.push(g.displayText);
    } else if (g.subject) {
      contentParts.push(g.subject);
    }
    if (g.url) {
      contentParts.push(`URL: ${g.url}`);
    }
    const gmailContent = contentParts.join('\n');

    rows.push([
      now, dateStr, 'Gmail',
      sentDate,
      g.clientName || '',
      '', '',
      g.subject || '',
      gmailContent,
      g.url || ''
    ]);
  });

  // Backlog
  (sources.backlogRows || []).forEach(b => {
    const actDate = b.date ? Utilities.formatDate(b.date, 'JST', 'yyyy/MM/dd HH:mm:ss') : '';
    const issueTitle = b.issueKey ? `${b.issueKey} ${b.summary || ''}` : (b.summary || '');
    rows.push([
      now, dateStr, 'Backlog',
      actDate,
      b.clientName || '',
      b.projectKey || '',
      '',
      issueTitle,
      b.comment || '',
      b.url || ''
    ]);
  });

  // Salesforce
  (sources.salesforceRows || []).forEach(sf => {
    const sfDate = sf.date ? Utilities.formatDate(new Date(sf.date), 'JST', 'yyyy/MM/dd HH:mm:ss') : '';
    rows.push([
      now, dateStr, 'Salesforce',
      sfDate,
      sf.clientName || '',
      sf.place || '',
      '',
      sf.subject || '',
      sf.content || '',
      sf.url || ''
    ]);
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RAW_LOG_HEADERS.length).setValues(rows);
  }
}

function initializeRawLogSheet(sheet) {
  sheet.clearContents();
  sheet.clearFormats();
  sheet.appendRow(RAW_LOG_HEADERS);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 180);
  sheet.setColumnWidth(7, 80);
  sheet.setColumnWidth(8, 300);
  sheet.setColumnWidth(9, 400);
  sheet.setColumnWidth(10, 300);
}

function saveToPrivateHistory(reportText, dateObj, meta) {
  try {
    const bqUrl = saveDailyReportToBigQuery(reportText, dateObj, meta || {});
    if (bqUrl) {
      return { url: bqUrl, storage: 'bigquery', label: 'BigQuery履歴を開く' };
    }
  } catch (e) {
    console.error('saveToPrivateHistory BigQuery save failed, fallback to sheet:', e.message);
  }

  // BigQuery保存に失敗した場合は、既存の履歴シートへ退避
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName('履歴');
  if (!sheet) {
    sheet = ss.insertSheet('履歴');
    sheet.appendRow(["送信日時", "対象日", "日報内容"]);
    sheet.setFrozenRows(1);
  }
  const timestamp = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  const targetDateStr = Utilities.formatDate(dateObj, 'JST', 'yyyy/MM/dd');
  sheet.appendRow([timestamp, targetDateStr, reportText]);
  return { url: ss.getUrl(), storage: 'sheet', label: 'スプレッドシート履歴を開く' };
}

function getHistorySheetUrl() {
  try {
      return getDailyReportHistoryConsoleUrl() || getOrSetupAppSheet().getUrl();
  } catch(e) { return null; }
}

function getRawLogSheetUrl() {
  try {
    const ss = getOrSetupAppSheet();
    const sheet = ss.getSheetByName('生ログ');
    if (!sheet) return ss.getUrl();
    return `${ss.getUrl()}#gid=${sheet.getSheetId()}`;
  } catch (e) {
    return null;
  }
}
