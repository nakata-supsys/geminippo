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

const PROJECT_ID = getSecret('GCP_PROJECT_ID', '113315457153');
const LOCATION = 'us-central1'; 

function saveUserSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  
  const propsToSave = {
    'SLACK_CHANNEL_ID': data.slackId || userProps.getProperty('SLACK_MEMBER_ID'),
    'REPORT_MODEL_TYPE': data.modelType,
    'REPORT_MODE': data.reportMode,
    'REPORT_SLACK_STYLE': data.slackStyle,
    'REPORT_FIXED_THREAD_URL': data.fixedThreadUrl,
    'REPORT_MANHOUR': data.reportManhour,
    'REPORT_REFLECTION': data.reportReflection,
    'REPORT_SLACK_SCOPE': data.slackScope,
    'REPORT_DAY_FORMAT': data.dayFormat,
    'REPORT_DATE': data.reportDate,
    'REPORT_SCHEDULE_TIME': data.scheduleEnable === 'on' ? data.scheduleTime : 'off',
    'REPORT_SCHEDULE_DAYS': JSON.stringify(data.scheduleDays || []),
    'REPORT_SKIP_HOLIDAYS': data.skipHolidays || 'false',
    'CALENDAR_IGNORE_WORDS': data.CALENDAR_IGNORE_WORDS,
    'SLACK_IGNORE_CHANNELS': data.SLACK_IGNORE_CHANNELS,
    'BACKLOG_CONFIGS': JSON.stringify(data.backlogConfigs || []),
    // 新規追加
    'SELECTED_DEPARTMENT': data.selectedDepartment || userProps.getProperty('SELECTED_DEPARTMENT') || 'CS'
  };

  userProps.setProperties(propsToSave, false);

  userProps.setProperty('initialized', 'true');

  const isEnable = data.scheduleEnable === 'on';
  updateTrigger_(isEnable);

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
    
    // プロンプトシートを初期化（CS部）
    resetToDefaultPrompts('CS');
    // ES部プロンプトシートも初期化
    resetToDefaultPrompts('ES');
  }
  return ss;
}

/**
 * 部署別プロンプトを取得します
 * @param {string} department 部署コード（'CS' または 'ES'）
 * @returns {object} プロンプト設定
 */
function getDepartmentPrompts(department) {
  const cache = CacheService.getUserCache();
  const cacheKey = `prompt_settings_${department}_v1`;
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${department}`;
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
    const defaults = getDefaultPromptsForDepartment(department);
    sheet.getRange('A2').setValue(defaults.summary);
    sheet.getRange('C2').setValue(defaults.detail);
    sheet.getRange('E2').setValue(defaults.manhour);
    sheet.getRange('G2').setValue(defaults.reflection);
    sheet.getRange('I2').setValue(defaults.aggregation);
  }
  
  const prompts = {
    summary: sheet.getRange('A2').getValue() || getDefaultPromptsForDepartment(department).summary,
    detail: sheet.getRange('C2').getValue() || getDefaultPromptsForDepartment(department).detail,
    manhour: sheet.getRange('E2').getValue() || getDefaultPromptsForDepartment(department).manhour,
    reflection: sheet.getRange('G2').getValue() || getDefaultPromptsForDepartment(department).reflection,
    aggregation: sheet.getRange('I2').getValue() || getDefaultPromptsForDepartment(department).aggregation
  };
  
  cache.put(cacheKey, JSON.stringify(prompts), 600);
  return prompts;
}

/**
 * 部署別プロンプトを保存します
 * @param {string} department 部署コード
 * @param {object} data プロンプトデータ
 * @returns {object} 保存結果
 */
function saveDepartmentPrompts(department, data) {
  const ss = getOrSetupAppSheet();
  const sheetName = `プロンプト_${department}`;
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  sheet.getRange('A2').setValue(data.summary);
  sheet.getRange('C2').setValue(data.detail);
  sheet.getRange('E2').setValue(data.manhour);
  sheet.getRange('G2').setValue(data.reflection);
  if (data.aggregation) sheet.getRange('I2').setValue(data.aggregation);
  
  CacheService.getUserCache().remove(`prompt_settings_${department}_v1`);
  
  return { success: true, message: `${department}部のプロンプト設定を更新しました！` };
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
  // ユーザーの選択部署を優先。未選択ならCS部
  const userProps = PropertiesService.getUserProperties();
  const selectedDept = userProps.getProperty('SELECTED_DEPARTMENT') || 'CS';
  return getDepartmentPrompts(selectedDept);
}


function savePromptSettings(data) {
  // 既存のsavePromptSettingsはCS部として扱う
  return saveDepartmentPrompts('CS', data);
}

function resetToDefaultPrompts(department = 'CS') {
  const ss = getOrSetupAppSheet();
  let sheet = ss.getSheetByName(`プロンプト_${department}`);
  if (!sheet) {
    sheet = ss.insertSheet(`プロンプト_${department}`, 1);
  }
  
  const defaults = getDefaultPromptsForDepartment(department);

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

  CacheService.getUserCache().remove(`prompt_settings_${department}_v1`);

  return { success: true, message: "プロンプトを初期値に戻しました！", prompts: defaults };
}

/**
 * スケジュール実行の「予約係」トリガーを更新します。
 * このトリガーは毎日深夜に実行され、その日の本番トリガーをセットアップします。
 * @param {boolean} isEnable スケジュールを有効にするか
 */
function updateTrigger_(isEnable) {
  const handlerFunction = 'planTodaysExecution';
  const triggers = ScriptApp.getProjectTriggers();
  let plannerTriggerExists = false;

  // 既存の予約係トリガーをチェックし、不要な場合は削除
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === handlerFunction) {
      if (isEnable && !plannerTriggerExists) {
        // 有効化する場合、トリガーは1つだけあれば良い
        plannerTriggerExists = true;
      } else {
        // 無効化する場合、または重複している場合は削除
        ScriptApp.deleteTrigger(trigger);
      }
    }
  });

  // スケジュールが有効で、かつ予約係トリガーが存在しない場合のみ新規作成
  if (isEnable) {
    if (!plannerTriggerExists) {
      ScriptApp.newTrigger(handlerFunction)
        .timeBased()
        .everyDays(1)
        .atHour(0)
        .create();
    }
    // ★★★ 追加: 設定を即時反映させるため、その日の予約を試みる ★★★
    planTodaysExecution();
  }
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

function saveToPrivateHistory(reportText, dateObj) {
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
  return ss.getUrl();
}

function getHistorySheetUrl() {
  try {
      const ss = getOrSetupAppSheet();
      return ss.getUrl();
  } catch(e) { return null; }
}