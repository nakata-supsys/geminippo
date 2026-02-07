// ==========================================
// Config.gs: 設定保存・スプレッドシート管理
// ==========================================

// ★ここに定数を定義（プロジェクト全体で使う設定値）
const PROJECT_ID = '113315457153'; 
const LOCATION = 'us-central1'; 

function saveUserSettings(data) {
  const userProps = PropertiesService.getUserProperties();
  
  const propsToSave = {
    'SLACK_CHANNEL_ID': data.slackId,
    'REPORT_MODEL_TYPE': data.modelType,
    'REPORT_MODE': data.reportMode,
    'REPORT_SLACK_STYLE': data.slackStyle,
    'REPORT_FIXED_THREAD_URL': data.fixedThreadUrl,
    'REPORT_MANHOUR': data.reportManhour,
    'REPORT_REFLECTION': data.reportReflection,
    'REPORT_SLACK_SCOPE': data.slackScope,
    'REPORT_DAY_FORMAT': data.dayFormat,
    'REPORT_DATE': data.reportDate,
    'REPORT_SCHEDULE': data.scheduleEnable === 'on' ? data.scheduleHour : 'off',
    'REPORT_SCHEDULE_DAYS': JSON.stringify(data.scheduleDays || []),
    'REPORT_SKIP_HOLIDAYS': data.skipHolidays,
    'CALENDAR_IGNORE_WORDS': data.CALENDAR_IGNORE_WORDS,
    'SLACK_IGNORE_CHANNELS': data.SLACK_IGNORE_CHANNELS,
    'BACKLOG_CONFIGS': JSON.stringify(data.backlogConfigs || [])
  };

  userProps.setProperties(propsToSave, false);

  // トリガーの更新
  const isEnable = data.scheduleEnable === 'on';
  const hour = parseInt(data.scheduleHour, 10);
  updateTrigger_(isEnable, hour);

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

    // ★修正: 関数経由でデフォルト値を取得
    const defaults = getDefaultPrompts();

    let pSheet = ss.insertSheet('プロンプト', 1);
    pSheet.getRange('A1').setValue('【要約モード指示】');
    pSheet.getRange('A2').setValue(defaults.summary);
    pSheet.getRange('C1').setValue('【詳細モード指示】');
    pSheet.getRange('C2').setValue(defaults.detail);
    pSheet.getRange('E1').setValue('【工数算出ルール】');
    pSheet.getRange('E2').setValue(defaults.manhour);
    pSheet.getRange('G1').setValue('【フィードバック視点】');
    pSheet.getRange('G2').setValue(defaults.reflection);
    pSheet.getRange('I1').setValue('【期間集計モード指示】');
    pSheet.getRange('I2').setValue(defaults.aggregation);

    pSheet.setColumnWidth(1, 300); pSheet.setColumnWidth(3, 300);
    pSheet.setColumnWidth(5, 300); pSheet.setColumnWidth(7, 300); pSheet.setColumnWidth(9, 400);
  }
  return ss;
}

function getPromptSettings() {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName('プロンプト') || ss.insertSheet('プロンプト');
  
  // ★修正: 関数経由でデフォルト値を取得
  const defaults = getDefaultPrompts();

  if (sheet.getLastRow() === 0) {
      sheet.getRange('A2').setValue(defaults.summary);
      sheet.getRange('C2').setValue(defaults.detail);
      sheet.getRange('E2').setValue(defaults.manhour);
      sheet.getRange('G2').setValue(defaults.reflection);
      sheet.getRange('I2').setValue(defaults.aggregation);
  }
  return {
    summary: sheet.getRange('A2').getValue() || defaults.summary,
    detail: sheet.getRange('C2').getValue() || defaults.detail,
    manhour: sheet.getRange('E2').getValue() || defaults.manhour,
    reflection: sheet.getRange('G2').getValue() || defaults.reflection,
    aggregation: sheet.getRange('I2').getValue() || defaults.aggregation
  };
}

function savePromptSettings(data) {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName('プロンプト');
  sheet.getRange('A2').setValue(data.summary);
  sheet.getRange('C2').setValue(data.detail);
  sheet.getRange('E2').setValue(data.manhour);
  sheet.getRange('G2').setValue(data.reflection);
  if(data.aggregation) sheet.getRange('I2').setValue(data.aggregation);
  return { success: true, message: "プロンプト設定を更新しました！" };
}

function resetToDefaultPrompts() {
  const ss = getOrSetupAppSheet();
  const sheet = ss.getSheetByName('プロンプト');
  
  // ★修正: 関数経由でデフォルト値を取得
  const defaults = getDefaultPrompts();

  sheet.getRange('A2').setValue(defaults.summary);
  sheet.getRange('C2').setValue(defaults.detail);
  sheet.getRange('E2').setValue(defaults.manhour);
  sheet.getRange('G2').setValue(defaults.reflection);
  sheet.getRange('I2').setValue(defaults.aggregation);
  return { success: true, message: "プロンプトを初期値に戻しました！", prompts: defaults };
}

function updateTrigger_(isEnable, hour) {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'autoRunDailyReport') ScriptApp.deleteTrigger(t);
  }
  if (isEnable && !isNaN(hour)) {
    ScriptApp.newTrigger('autoRunDailyReport').timeBased().everyDays(1).atHour(hour).create();
  }
}

function autoRunDailyReport() {
  const props = PropertiesService.getUserProperties().getProperties();
  const today = new Date();
  const dayOfWeek = today.getDay().toString();
  const targetDays = JSON.parse(props.REPORT_SCHEDULE_DAYS || "[]");
  
  if (!targetDays.includes(dayOfWeek)) return;
  if (props.REPORT_SKIP_HOLIDAYS === 'true' && isHoliday(today)) return;

  runDailyReportAndArchive();
}

function isHoliday(date) {
  const calId = 'ja.japanese#holiday@group.v.calendar.google.com';
  const events = CalendarApp.getCalendarById(calId).getEventsForDay(date);
  return events.length > 0;
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