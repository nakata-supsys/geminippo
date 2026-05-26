// ==========================================
// Services.gs: 外部サービス連携 (Slack, Calendar, etc.)
// ==========================================

/**
 * ★★★ 利用状況ログ機能 ★★★
 * ユーザーの利用状況を記録するためのスプレッドシートID。
 * 記録用の新しいスプレッドシートを作成し、そのIDをここに貼り付けてください。
 * 例: '12345abcde-FGHIJKLMNOPQRSTUVWXYZ'
 */
const LOG_SHEET_ID = PropertiesService.getScriptProperties().getProperty('LOG_SHEET_ID')
  || '1BZIPxlW1ZYYQU66z3yCIZeT9kwJb8sFs8BoMHVYkDUk';
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const JST_TIMEZONE = 'Asia/Tokyo';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OAUTH_FLOW_CACHE_TTL_SEC = 600;

function markOAuthFlowState_(flowName, state) {
  if (!flowName || !state) return;
  const cache = CacheService.getUserCache();
  cache.put(`oauth_flow_${state}`, flowName, OAUTH_FLOW_CACHE_TTL_SEC);
}

function consumeOAuthFlowState_(state) {
  if (!state) return '';
  const cache = CacheService.getUserCache();
  const key = `oauth_flow_${state}`;
  const flow = cache.get(key) || '';
  cache.remove(key);
  return flow;
}

function parseDateInputAsJst(dateInput) {
  if (!dateInput) return new Date();
  if (Object.prototype.toString.call(dateInput) === '[object Date]') {
    return new Date(dateInput.getTime());
  }
  const raw = String(dateInput).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) {
    throw new Error(`日付の形式が不正です: ${raw}`);
  }
  const ymd = Utilities.formatDate(parsed, JST_TIMEZONE, 'yyyy-MM-dd');
  return new Date(`${ymd}T12:00:00+09:00`);
}

function getJstDayRange(dateInput) {
  const base = parseDateInputAsJst(dateInput);
  const ymd = Utilities.formatDate(base, JST_TIMEZONE, 'yyyy-MM-dd');
  const start = new Date(`${ymd}T00:00:00+09:00`);
  const endExclusive = new Date(start.getTime() + ONE_DAY_MS);
  const endInclusive = new Date(endExclusive.getTime() - 1);
  return {
    ymd: ymd,
    start: start,
    endExclusive: endExclusive,
    endInclusive: endInclusive,
    startUnix: Math.floor(start.getTime() / 1000),
    endExclusiveUnix: Math.floor(endExclusive.getTime() / 1000)
  };
}

/**
 * エラーコード付きのErrorオブジェクトを生成します。
 * @param {string} code エラーコード (例: 'AUTH-001')
 * @param {string} message エラーメッセージ
 * @returns {Error} authErrorCodeプロパティを持つErrorオブジェクト
 */
function createAuthError(code, message) {
  const error = new Error(message);
  error.authErrorCode = code;
  return error;
}

/**
 * 認証イベントをスプレッドシートに記録します（管理者向け診断ログ）。
 * LOG_SHEET_IDが未設定の場合は何もしません。
 * @param {string} errorCode エラーコード (例: 'AUTH-001', 'AUTH-OK')
 * @param {string} message メッセージ
 * @param {string} userEmail ユーザーのメールアドレス
 * @param {object} params リクエストパラメータ
 */
function logAuthEvent(errorCode, message, userEmail, params) {
  try {
    if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') return;

    const spreadsheet = SpreadsheetApp.openById(LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName('AuthLog');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('AuthLog');
      sheet.appendRow(['Timestamp', 'UserEmail', 'ErrorCode', 'Message', 'HasCode', 'HasState', 'SlackError']);
      sheet.setFrozenRows(1);
    }

    const safeParams = params ? {
      hasCode: !!params.code,
      hasState: !!params.state,
      slackError: params.error || ''
    } : {};

    sheet.appendRow([
      new Date(),
      userEmail || 'unknown',
      errorCode,
      message,
      safeParams.hasCode || false,
      safeParams.hasState || false,
      safeParams.slackError || ''
    ]);
  } catch (logErr) {
    console.error('Failed to log auth event: ' + logErr.message);
  }
}

/**
 * ユーザーのアクティビティをスプレッドシートに記録します。
 * @param {string} action 実行されたアクション名 (例: 'generatePreviewReport')。
 */
function logUserActivity(action) {
  try {
    if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') return;

    const spreadsheet = SpreadsheetApp.openById(LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName('ActivityLog');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('ActivityLog');
      sheet.appendRow(['Timestamp', 'UserEmail', 'Action']);
    }
    sheet.appendRow([new Date(), Session.getActiveUser().getEmail(), action]);
  } catch (e) {
    console.error(`Failed to log user activity: ${e.message}`);
  }
}

/**
 * 通信経路で発生した例外をユーザー向けメッセージに整形します。
 * @param {string} actionLabel ユーザーに伝える操作内容（例: 'Slackチャンネルの確認中'）
 * @param {Error} error 捕捉したエラー
 * @returns {string} ユーザー向けの丁寧な説明文
 */
function formatNetworkError(actionLabel, error) {
  const label = actionLabel || '操作';
  const detail = error && error.message ? `\n詳細: ${error.message}` : '';
  return `⚠️ ${label}に時間がかかり、外部サービスからの応答を確認できませんでした。通信環境を確認し、少し時間をおいてから再試行してください。繰り返し発生する場合は管理者に共有してください。${detail}`;
}

/**
 * ログ収集中に個別のソースで失敗したことをユーザーに伝える警告文を生成します。
 * @param {string} sourceName ソース名（例: 'Slackログ'）
 * @returns {string}
 */
function createSourceWarning(sourceName) {
  return `${sourceName}の取得に失敗しました。通信状況を確認のうえ、時間をおいて再度プレビューを実行してください。`;
}

function runDailyReportAndArchive() {
  // 部署選択を考慮
  const userProps = PropertiesService.getUserProperties();
  const department = userProps.getProperty('SELECTED_DEPARTMENT') || 'CS';
  const res = generatePreviewReport(null, null, department); 
  if(res.success) sendFinalReport(res.report, null);
}

/**
 * 手動実行時に選択された部署をユーザープロパティに保存します。
 * @param {string} department 保存する部署コード ('CS' or 'ES')
 */
function saveSelectedDepartment(department) {
  // 現在はCS固定運用。想定外入力で壊さないため、許可値のみ保存する。
  const normalized = (department === 'ES') ? 'ES' : 'CS';
  PropertiesService.getUserProperties().setProperty('SELECTED_DEPARTMENT', normalized);
}
/**
 * 日報のプレビューを生成します。
 * @param {string} instruction AIへの追加指示 (任意)
 * @param {string} dateStr 対象日の文字列 (YYYY-MM-DD形式、任意)
 * @param {string} department 部署コード (CS または ES)
 * @param {string} baseDraft 修正元の下書き本文 (任意)
 * @returns {object} 生成された日報テキストとログ情報
 */
function generatePreviewReport(instruction = null, dateStr = null, department = 'CS', baseDraft = null) {
  logUserActivity('generatePreviewReport'); // ログ記録処理を呼び出す

  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) return { success: false, message: "Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。" };

  // 部署別プロンプトを取得
  const prompts = getDepartmentPrompts(department);
  
  let targetDate = new Date();
  if (dateStr) { targetDate = parseDateInputAsJst(dateStr); }

  // 部署をcollectLogsに渡す
  const logData = collectLogs(props, targetDate, department);
  const warnings = logData.warnings || [];
  
  try { saveRawLogsToSheet(logData.sources, targetDate); } catch(e) { console.warn("生ログ保存エラー:", e); }
  
  if (!logData.text || logData.text.trim().length < 50) { 
      return { 
          success: true, 
          report: "⚠️ 【ログが見つかりませんでした】\n本日の活動ログ（カレンダー、Slack、Gmail等）が取得できませんでした。\n\n・日付が正しいか確認してください\n・休日の場合は活動がない可能性があります", 
          counts: logData.counts,
          warnings: warnings
      };
  }

  const reportMode = '要約モード';
  const report = generateReportWithGemini(
    logData.text,
    prompts,
    reportMode,
    targetDate,
    props.REPORT_REFLECTION,
    props.REPORT_MANHOUR,
    props.REPORT_DAY_FORMAT,
    props.REPORT_BULLET_STYLE || 'markdown',
    instruction,
    logData.teamSpiritData, // 新規追加
    logData.clients || [],
    props.CLIENT_FALLBACK_NAME || '● その他',
    baseDraft || null
  );
  const bulletStyle = props.REPORT_BULLET_STYLE || 'markdown';
  const shouldFormat = !(typeof global !== 'undefined' && global.IS_TESTING);
  const formattedReport = shouldFormat ? formatReportByBulletStyle(report, bulletStyle) : report;
  return { success: true, report: formattedReport, counts: logData.counts, warnings: warnings };
}

function parseProjectAliasRules_(rulesJson) {
  if (!rulesJson) return [];
  try {
    const parsed = typeof rulesJson === 'string' ? JSON.parse(rulesJson) : rulesJson;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('PROJECT_ALIAS_RULES parse error:', e.message);
    return [];
  }
}

function normalizeProjectAliasRules_(rules) {
  return (Array.isArray(rules) ? rules : []).map(function(rule) {
    const projectCode = String(rule.projectCode || rule.code || '').trim();
    if (!projectCode) return null;
    const patterns = Array.isArray(rule.patterns) ? rule.patterns : [];
    return {
      client: String(rule.client || '').trim(),
      projectCode: projectCode,
      category: String(rule.category || '').trim(),
      label: String(rule.label || '').trim(),
      patterns: patterns.map(function(p) { return String(p || '').trim(); }).filter(Boolean),
      priority: parseInt(rule.priority || '50', 10) || 50
    };
  }).filter(Boolean);
}

function buildProjectAliasRulesPrompt_(rulesJson) {
  const rules = normalizeProjectAliasRules_(parseProjectAliasRules_(rulesJson));
  if (!rules.length) return '';
  const lines = rules
    .sort(function(a, b) { return b.priority - a.priority; })
    .map(function(rule) {
      const attrs = [
        rule.client ? `クライアント=${rule.client}` : '',
        rule.category ? `カテゴリ=${rule.category}` : '',
        rule.label ? `区分=${rule.label}` : '',
        rule.patterns.length ? `判定語=${rule.patterns.join(', ')}` : '',
        `優先度=${rule.priority}`
      ].filter(Boolean).join(' / ');
      return `- ${rule.projectCode}: ${attrs}`;
    });
  return [
    '【プロジェクト分類ルール】',
    '同一クライアントに複数プロジェクトがある場合は、以下のルールを優先して正式プロジェクト名を選んでください。',
    '判定語がログ本文・Slackチャンネル名・Backlog課題名・カレンダー件名に含まれる場合、該当プロジェクトへ寄せてください。',
    '複数候補がある場合は優先度が高いものを選び、該当しない場合のみ正式なプロジェクト一覧から最も近い名称を選んでください。',
    lines.join('\n')
  ].join('\n');
}

function runPeriodAggregation(startDateStr, endDateStr, projectListStr, avgWorkHours, instruction, projectAliasRulesStr) {
  logUserActivity('runPeriodAggregation');

  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携がされていません");

  if (projectListStr) PropertiesService.getUserProperties().setProperty('PROJECT_LIST', projectListStr);
  if (projectAliasRulesStr && projectAliasRulesStr !== '[]') PropertiesService.getUserProperties().setProperty('PROJECT_ALIAS_RULES', projectAliasRulesStr);
  // ★改善案: 平均稼働時間もユーザープロパティに保存する
  if (avgWorkHours) PropertiesService.getUserProperties().setProperty('AVG_WORK_HOURS', avgWorkHours);


  const start = getJstDayRange(startDateStr).start;
  const end = getJstDayRange(endDateStr).endInclusive;

  // ★★★ 修正: 安定性向上のため、終了日が「本日」以降の場合は自動的に「昨日」に補正する ★★★
  // 未完了のログをAIに渡すと、結果が不安定になる問題への対策
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end >= today) {
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    end.setTime(yesterday.getTime());
  }

  end.setHours(23, 59, 59, 999); // 終了日の終わりまでを対象とする
  if (start > end) throw new Error("終了日は開始日より後に設定してください");

  // 期間ログ収集に部署情報は現時点では不要だが、将来的な拡張のため引数に追加
  const department = props.SELECTED_DEPARTMENT || 'CS';
  const periodLogs = collectPeriodLogsParallel(start, end, props.SLACK_USER_TOKEN, props, department);
  const logText = typeof periodLogs === 'string' ? periodLogs : (periodLogs && periodLogs.text) || '';
  const periodClients = (periodLogs && typeof periodLogs === 'object' && periodLogs.clients) ? periodLogs.clients : [];
  const periodWarnings = (periodLogs && typeof periodLogs === 'object' && periodLogs.warnings) ? periodLogs.warnings : [];
  if (!logText || logText.trim().length < 50) {
    // ログが見つからない場合、AIに渡さずに専用メッセージを返す
    const message = `
### ⚠️ ログが見つかりませんでした

指定された期間の活動ログ（カレンダー、Slackなど）が見つかりませんでした。
- 期間の指定が正しいか確認してください。
- ログとして記録されないオフライン作業が中心だった可能性があります。`;
    return { success: true, report: message, warnings: periodWarnings };
  }

  // ★★★ 修正: 日付ごとに表を作成するよう、プロンプトを動的に上書き ★★★
  const newAggregationPrompt = `
あなたはプロのコンサルタントです。以下のルールに従って、活動ログからプロジェクト工数を算出し、Markdown形式で報告してください。

### 【重要】出力形式の厳守事項
1. 各日付の見出しの直後に、**必ず空行を1行**入れてください
2. テーブルは**必ず3列（種別、工数(時間)、内容）のみ**としてください
3. 「日付」列は絶対に含めないでください
4. 見出し形式: \`▼ yyyy/MM/dd(E) | 合計 XX.X 時間\`
5. テーブルのヘッダー行: \`| 種別 | 工数(時間) | 内容 |\`
6. 区切り行: \`|---|---|---|\`

### ルール
- 各ログエントリの時間を積み上げて工数を計算してください。
- 提供された「1日の平均稼働時間」がある場合、合計工数がその値に近づくように調整してください。ただし、ログの内容とかけ離れた不自然な調整はしないでください。
- 可能であれば先頭に以下形式のJSONブロックを付けてください（出せない場合は省略可）。
  \`\`\`json
  [{"label":"PROJ-001: A社様導入支援","hours":12.5}]
  \`\`\`

### 悪い例（絶対にこうしないこと）
| 日付 | 種別 | 工数 | 内容 |
|---|---|---|---|
| 02/12 | プロジェクトA | 4.0時間 | 作業内容 |

### 良い例（必ずこの形式で出力すること）
▼ ${Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy/MM/dd(E)')} | 合計 8.0 時間

| 種別 | 工数(時間) | 内容 |
|---|---|---|
| PROJ-001: A社様導入支援 | 4.5 | 定例MTG、課題管理表の更新 |

【集計期間】 {{DATE}}

### 活動ログ
{{LOGS}}`;
  const projectAliasRulesPrompt = buildProjectAliasRulesPrompt_(projectAliasRulesStr || props.PROJECT_ALIAS_RULES || '[]');
  const report = generateAggregationWithGemini(logText, start, end, projectListStr, avgWorkHours || null, instruction || null, newAggregationPrompt, periodClients, projectAliasRulesPrompt);

  // AIの出力内容を検証し、異常な場合はフォールバックメッセージを返す
  if (isAggregationResultInvalid(report)) {
    const errorMessage = `
### ⚠️ 集計結果の生成に失敗しました

AIが活動ログから意味のある情報を抽出できませんでした。
- 期間中の活動がログに残らない作業（資料作成など）が中心だった可能性があります。
- 「TeamSpirit プロジェクト一覧」に情報を追加すると、精度が向上することがあります。
- 期間を短くして再度お試しください。`;
    return { success: true, report: errorMessage, warnings: periodWarnings };
  }

  return { success: true, report: report, warnings: periodWarnings };
}

const SUMMARY_MAX_CLIENTS = 10;
const SUMMARY_MAX_EVENTS_PER_CLIENT = 120;
const SUMMARY_MAX_RANGE_DAYS = 31;
const SUMMARY_COLLECTION_MODE_LIGHT = 'light';
const SUMMARY_COLLECTION_MODE_FULL = 'full';

function normalizeSummaryClientDefinitions_(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map(function(rule, index) {
      const id = String(rule.id || `client_${index + 1}`).trim();
      const name = String(rule.name || '').trim();
      const slackChannels = Array.isArray(rule.slackChannels) ? rule.slackChannels : [];
      const backlogKeys = Array.isArray(rule.backlogKeys) ? rule.backlogKeys : [];
      return {
        id: id,
        name: name,
        slackChannels: slackChannels.map(function(v) { return String(v || '').trim(); }).filter(Boolean),
        backlogKeys: backlogKeys.map(function(v) { return normalizeSummaryBacklogProjectKey_(v); }).filter(Boolean),
        updatedAt: String(rule.updatedAt || '')
      };
    })
    .filter(function(rule) { return !!rule.id; });
}

function getSummaryClientDefinitions() {
  const raw = PropertiesService.getUserProperties().getProperty('SUMMARY_CLIENT_RULES') || '[]';
  try {
    return normalizeSummaryClientDefinitions_(JSON.parse(raw));
  } catch (e) {
    console.warn('SUMMARY_CLIENT_RULES parse error:', e.message);
    return [];
  }
}

function saveSummaryClientDefinitions(data) {
  const defs = normalizeSummaryClientDefinitions_(data && data.rules);
  PropertiesService.getUserProperties().setProperty('SUMMARY_CLIENT_RULES', JSON.stringify(defs));
  return { success: true, message: 'サマリ設定を保存しました。', rules: defs };
}

function saveSummarySettings(data) {
  const payload = data || {};
  const defs = normalizeSummaryClientDefinitions_(payload.rules);
  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    SUMMARY_CLIENT_RULES: JSON.stringify(defs),
    SUMMARY_EVIDENCE_DEFAULT: 'on'
  }, false);
  return { success: true, message: 'サマリ設定を保存しました。', rules: defs };
}

function saveSummarySelectedClientIds(ids) {
  const arr = Array.isArray(ids) ? ids : [];
  const norm = [];
  const seen = {};
  arr.forEach(function(v) {
    const id = String(v || '').trim();
    if (!id || seen[id]) return;
    seen[id] = true;
    norm.push(id);
  });
  PropertiesService.getUserProperties().setProperty('SUMMARY_SELECTED_CLIENT_IDS', JSON.stringify(norm));
  return { success: true, selectedClientIds: norm };
}

function normalizeSummaryBacklogProjectKey_(value) {
  const raw = String(value || '').trim();
  let match;
  if (!raw) return '';
  match = raw.match(/\/projects\/([A-Za-z0-9_-]+)/i);
  if (match && match[1]) return match[1].toUpperCase();
  match = raw.match(/\/view\/([A-Za-z0-9_-]+)-\d+/i);
  if (match && match[1]) return match[1].toUpperCase();
  return raw.toUpperCase();
}

function checkSummaryBacklogProjectKeys(values) {
  const props = PropertiesService.getUserProperties().getProperties();
  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  const inputs = Array.isArray(values) ? values : [];
  const results = [];
  const configs = backlogState.configs || [];
  if (configs.length === 0) {
    return { results: inputs.map(function(v) { return { input: String(v || ''), valid: false, message: 'Backlog連携が設定されていません。' }; }) };
  }
  inputs.forEach(function(input) {
    const key = normalizeSummaryBacklogProjectKey_(input);
    let found = false;
    let lastMessage = '見つかりませんでした。';
    let projectName = '';
    configs.forEach(function(config) {
      if (found || !config.host || !config.key) return;
      const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      try {
        const url = `https://${host}/api/v2/projects/${encodeURIComponent(key)}?apiKey=${config.key}`;
        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
        if (response.getResponseCode() === 200) {
          const project = JSON.parse(response.getContentText());
          found = true;
          lastMessage = '名前: ' + (project.name || key);
          projectName = String(project.name || '');
          return;
        } else {
          lastMessage = '見つかりませんでした。';
        }
      } catch (e) {
        lastMessage = formatNetworkError('Backlogプロジェクト確認中', e);
      }
    });
    results.push({ input: key || String(input || ''), valid: found, message: lastMessage, projectName: projectName });
  });
  return { results: results };
}

function checkSummarySlackChannelIds(idsStr) {
  const props = PropertiesService.getUserProperties();
  const token = props.getProperty('SLACK_USER_TOKEN');
  if (!token) return { results: [{ input: 'Error', valid: false, message: 'Slack連携がされていません' }] };

  const ids = String(idsStr || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  const results = [];

  ids.forEach(function(id) {
    if (!(id.startsWith('C') || id.startsWith('D') || id.startsWith('G'))) {
      results.push({ input: id, valid: false, message: '不正な形式です（C.../D.../G...）' });
      return;
    }
    try {
      const response = UrlFetchApp.fetch(`https://slack.com/api/conversations.info?channel=${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (response.getResponseCode() !== 200) throw new Error(`HTTP ${response.getResponseCode()}`);
      const res = JSON.parse(response.getContentText());
      if (res.ok) {
        const name = res.channel && res.channel.name ? '#' + res.channel.name : id;
        results.push({
          input: id,
          valid: true,
          message: `チャンネル: ${name}`,
          channelName: res.channel && res.channel.name ? String(res.channel.name) : ''
        });
      } else {
        if (res.error === 'missing_scope') {
          results.push({ input: id, valid: false, message: 'Slack API権限不足（missing_scope）。管理者に scopes 設定をご確認ください。' });
        } else {
          results.push({ input: id, valid: false, message: `見つかりません (${res.error})` });
        }
      }
    } catch (e) {
      results.push({ input: id, valid: false, message: formatNetworkError('Slackチャンネル確認中', e) });
    }
  });

  return { results: results };
}

function resolveSummarySlackChannelNames(ids) {
  const props = PropertiesService.getUserProperties();
  const token = props.getProperty('SLACK_USER_TOKEN');
  const list = Array.isArray(ids) ? ids : [];
  const map = {};
  if (!token) return { names: map };
  list.forEach(function(raw) {
    const id = String(raw || '').trim();
    if (!id || map[id]) return;
    if (!(id.startsWith('C') || id.startsWith('D') || id.startsWith('G'))) return;
    try {
      const response = UrlFetchApp.fetch(`https://slack.com/api/conversations.info?channel=${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (response.getResponseCode() !== 200) return;
      const res = JSON.parse(response.getContentText());
      if (res.ok && res.channel && res.channel.name) map[id] = '#' + String(res.channel.name);
    } catch (e) {}
  });
  return { names: map };
}

function resolveSummaryBacklogProjectNames(keys) {
  const props = PropertiesService.getUserProperties().getProperties();
  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  const configs = backlogState.configs || [];
  const list = Array.isArray(keys) ? keys : [];
  const names = {};
  list.forEach(function(raw) {
    const key = normalizeSummaryBacklogProjectKey_(raw);
    if (!key || names[key]) return;
    configs.forEach(function(config) {
      if (names[key] || !config.host || !config.key) return;
      const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      try {
        const url = `https://${host}/api/v2/projects/${encodeURIComponent(key)}?apiKey=${config.key}`;
        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
        if (response.getResponseCode() === 200) {
          const project = JSON.parse(response.getContentText());
          if (project && project.name) names[key] = String(project.name);
        }
      } catch (e) {}
    });
  });
  return { names: names };
}

function formatJstDateTime_(dateObj) {
  return Utilities.formatDate(dateObj, JST_TIMEZONE, 'yyyy/MM/dd HH:mm');
}

function normalizeSummaryCollectionMode_(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  return mode === SUMMARY_COLLECTION_MODE_FULL ? SUMMARY_COLLECTION_MODE_FULL : SUMMARY_COLLECTION_MODE_LIGHT;
}

function fetchJsonWithRetry_(url, options, maxRetries) {
  const safeOptions = options || {};
  const retries = Math.max(0, parseInt(maxRetries || 0, 10) || 0);
  let attempt = 0;
  while (attempt <= retries) {
    attempt++;
    const response = UrlFetchApp.fetch(url, safeOptions);
    const status = response.getResponseCode();
    if (status === 429 || status >= 500) {
      if (attempt <= retries) {
        Utilities.sleep(Math.min(1500 * attempt, 5000));
        continue;
      }
    }
    return {
      status: status,
      json: JSON.parse(response.getContentText() || '{}')
    };
  }
  return { status: 0, json: {} };
}

function fetchBacklogActivitiesDetailedForSummary_(configs, projectKeys, startDate, endDate) {
  const keySet = new Set((projectKeys || []).map(function(k) { return String(k || '').trim().toUpperCase(); }).filter(Boolean));
  if (keySet.size === 0) return [];
  const events = [];
  const COUNT = 100;
  (configs || []).forEach(function(config) {
    if (!config.host || !config.key) return;
    const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let maxId = null;
    let keepFetching = true;
    while (keepFetching) {
      try {
        let url = `https://${host}/api/v2/users/myself/activities?apiKey=${config.key}&count=${COUNT}`;
        if (maxId) url += `&maxId=${maxId}`;
        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
        if (response.getResponseCode() !== 200) break;
        const activities = JSON.parse(response.getContentText());
        if (!activities || activities.length === 0) {
          keepFetching = false;
          continue;
        }
        activities.forEach(function(act) {
          const projectKey = String(act && act.project && act.project.projectKey || '').toUpperCase();
          if (!keySet.has(projectKey)) return;
          const at = new Date(act.created);
          if (at < startDate || at > endDate) return;
          const content = act && act.content ? act.content : {};
          let summary = '';
          if (content.summary) summary = String(content.summary);
          else if (content.comment && content.comment.content) summary = String(content.comment.content);
          else if (content.changes && content.changes.length) {
            summary = content.changes
              .map(function(ch) {
                const field = ch && ch.field ? String(ch.field) : '';
                const to = ch && Object.prototype.hasOwnProperty.call(ch, 'new_value') ? String(ch.new_value) : '';
                const from = ch && Object.prototype.hasOwnProperty.call(ch, 'old_value') ? String(ch.old_value) : '';
                if (!field) return '';
                return from || to ? (field + ': ' + from + ' → ' + to) : field + ' を更新';
              })
              .filter(Boolean)
              .join(' / ');
          }
          if (!summary) summary = '更新';
          const keyId = act.content && act.content.key_id ? String(act.content.key_id) : '';
          const issueKey = keyId ? `${projectKey}-${keyId}` : '';
          const permalink = issueKey ? `https://${host}/view/${issueKey}` : '';
          events.push({
            source: 'Backlog',
            timestamp: at,
            timestampJst: formatJstDateTime_(at),
            text: summary.replace(/\s+/g, ' ').trim(),
            evidenceLabel: issueKey || projectKey,
            permalink: permalink
          });
        });
        maxId = activities[activities.length - 1].id;
        keepFetching = activities.length === COUNT;
      } catch (e) {
        console.warn(`Backlog summary fetch failed (${host}): ${e.message}`);
        keepFetching = false;
      }
    }
  });
  return events;
}

function fetchBacklogIssuesDetailedForSummary_(configs, projectKeys, startDate, endDate) {
  const keySet = new Set((projectKeys || []).map(function(k) { return String(k || '').trim().toUpperCase(); }).filter(Boolean));
  if (keySet.size === 0) return [];
  const events = [];
  const COUNT = 100;
  (configs || []).forEach(function(config) {
    if (!config.host || !config.key) return;
    const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let offset = 0;
    let keepFetching = true;
    while (keepFetching) {
      try {
        const params = [
          `apiKey=${encodeURIComponent(config.key)}`,
          `count=${COUNT}`,
          `offset=${offset}`,
          `sort=updated`,
          `order=desc`
        ];
        keySet.forEach(function(key) {
          params.push(`projectKey[]=${encodeURIComponent(key)}`);
        });
        const url = `https://${host}/api/v2/issues?${params.join('&')}`;
        const payload = fetchJsonWithRetry_(url, {
          muteHttpExceptions: true,
          timeout: DEFAULT_FETCH_TIMEOUT_MS
        }, 2);
        if (payload.status !== 200) break;
        const issues = Array.isArray(payload.json) ? payload.json : [];
        if (issues.length === 0) {
          keepFetching = false;
          continue;
        }
        let reachedOlder = false;
        issues.forEach(function(issue) {
          const projectKey = String(issue && issue.project && issue.project.projectKey || '').toUpperCase();
          if (!keySet.has(projectKey)) return;
          const updatedRaw = issue && issue.updated ? issue.updated : (issue && issue.created ? issue.created : '');
          const at = new Date(updatedRaw);
          if (isNaN(at.getTime())) return;
          if (at < startDate) {
            reachedOlder = true;
            return;
          }
          if (at > endDate) return;
          const issueKey = issue && issue.issueKey ? String(issue.issueKey) : '';
          const summary = String(issue && issue.summary ? issue.summary : '更新').replace(/\s+/g, ' ').trim();
          const permalink = issueKey ? `https://${host}/view/${issueKey}` : '';
          events.push({
            source: 'Backlog',
            timestamp: at,
            timestampJst: formatJstDateTime_(at),
            text: summary,
            evidenceLabel: issueKey || projectKey,
            permalink: permalink
          });
        });
        if (reachedOlder || issues.length < COUNT) {
          keepFetching = false;
        } else {
          offset += COUNT;
        }
      } catch (e) {
        console.warn(`Backlog issues summary fetch failed (${host}): ${e.message}`);
        keepFetching = false;
      }
    }
  });
  return events;
}

function fetchSlackMessagesForSummaryPublicChannels_(token, channelIds, startDate, endDate, ignoreIds) {
  if (!token) return [];
  const channelSet = new Set((channelIds || []).map(function(v) { return String(v || '').trim(); }).filter(Boolean));
  if (channelSet.size === 0) return [];
  const ignoreSet = new Set((ignoreIds || []).map(function(v) { return String(v || '').trim(); }).filter(Boolean));
  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(endDate.getTime() / 1000);
  const events = [];
  const added = {};
  channelSet.forEach(function(channelId) {
    if (ignoreSet.has(channelId)) return;
    let cursor = '';
    let page = 0;
    const limit = 200;
    while (page < 50) {
      page++;
      const params = [
        `channel=${encodeURIComponent(channelId)}`,
        `oldest=${startTs}`,
        `latest=${endTs}`,
        `inclusive=true`,
        `limit=${limit}`
      ];
      if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
      const url = `https://slack.com/api/conversations.history?${params.join('&')}`;
      let payload;
      try {
        payload = fetchJsonWithRetry_(url, {
          method: 'get',
          headers: { Authorization: `Bearer ${token}` },
          muteHttpExceptions: true,
          timeout: DEFAULT_FETCH_TIMEOUT_MS
        }, 2);
      } catch (e) {
        console.warn(`Slack history fetch failed (${channelId}): ${e.message}`);
        break;
      }
      if (payload.status !== 200) break;
      if (!payload.json.ok) {
        if (payload.json.error !== 'not_in_channel') {
          console.warn(`Slack history API error (${channelId}): ${payload.json.error}`);
        }
        break;
      }
      const messages = Array.isArray(payload.json.messages) ? payload.json.messages : [];
      messages.forEach(function(message) {
        const tsNum = parseFloat(message && message.ts ? message.ts : '0');
        if (!tsNum) return;
        const dedupKey = `${channelId}:${message.ts}`;
        if (added[dedupKey]) return;
        added[dedupKey] = true;
        const at = new Date(tsNum * 1000);
        const text = decodeSlackMarkup(String(message && message.text ? message.text : '').replace(/\s+/g, ' ').trim());
        events.push({
          source: 'Slack',
          timestamp: at,
          timestampJst: formatJstDateTime_(at),
          text: text,
          evidenceLabel: channelId,
          permalink: `https://slack.com/archives/${channelId}/p${String(message.ts).replace('.', '')}`
        });
        const replyCount = parseInt(message && message.reply_count ? message.reply_count : '0', 10) || 0;
        if (replyCount <= 0) return;
        const replyUrl = `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(message.ts)}&limit=200`;
        try {
          const replyPayload = fetchJsonWithRetry_(replyUrl, {
            method: 'get',
            headers: { Authorization: `Bearer ${token}` },
            muteHttpExceptions: true,
            timeout: DEFAULT_FETCH_TIMEOUT_MS
          }, 2);
          if (replyPayload.status !== 200 || !replyPayload.json.ok) return;
          const replies = Array.isArray(replyPayload.json.messages) ? replyPayload.json.messages : [];
          replies.forEach(function(reply) {
            if (!reply || reply.ts === message.ts) return;
            const rDedupKey = `${channelId}:${reply.ts}`;
            if (added[rDedupKey]) return;
            const rTs = parseFloat(reply.ts || '0');
            if (!rTs) return;
            const rAt = new Date(rTs * 1000);
            if (rAt < startDate || rAt > endDate) return;
            added[rDedupKey] = true;
            const rText = decodeSlackMarkup(String(reply.text || '').replace(/\s+/g, ' ').trim());
            events.push({
              source: 'Slack',
              timestamp: rAt,
              timestampJst: formatJstDateTime_(rAt),
              text: rText,
              evidenceLabel: channelId,
              permalink: `https://slack.com/archives/${channelId}/p${String(reply.ts).replace('.', '')}?thread_ts=${encodeURIComponent(message.ts)}`
            });
          });
        } catch (e) {
          console.warn(`Slack replies fetch failed (${channelId}): ${e.message}`);
        }
      });
      cursor = payload.json.response_metadata && payload.json.response_metadata.next_cursor;
      if (!cursor) break;
    }
  });
  return events;
}

function collectSummaryEventsForClient_(props, clientDef, startDate, endDate, runtimeCache) {
  const events = [];
  const slackToken = props.SLACK_USER_TOKEN;
  const scope = props.REPORT_SLACK_SCOPE || 'private';
  const ignoreIds = (props.SLACK_IGNORE_CHANNELS || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
  const collectionMode = normalizeSummaryCollectionMode_(props.SUMMARY_COLLECTION_MODE);
  const channelSet = new Set((clientDef.slackChannels || []).map(function(v) { return String(v || '').trim(); }).filter(Boolean));
  const cache = runtimeCache || {};
  cache.slackByDay = cache.slackByDay || {};
  if (channelSet.size > 0 && collectionMode === SUMMARY_COLLECTION_MODE_FULL) {
    const channelIds = Array.from(channelSet);
    fetchSlackMessagesForSummaryPublicChannels_(slackToken, channelIds, startDate, endDate, ignoreIds)
      .forEach(function(ev) { events.push(ev); });
  } else if (channelSet.size > 0) {
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      const dayKey = Utilities.formatDate(day, JST_TIMEZONE, 'yyyy-MM-dd');
      if (!Object.prototype.hasOwnProperty.call(cache.slackByDay, dayKey)) {
        cache.slackByDay[dayKey] = fetchMySlackPosts(slackToken, day, scope, ignoreIds) || [];
      }
      const slackMessages = cache.slackByDay[dayKey] || [];
      slackMessages.forEach(function(msg) {
        if (!channelSet.has(msg.channelId)) return;
        const tsNum = parseFloat(msg.ts);
        if (isNaN(tsNum)) return;
        const at = new Date(tsNum * 1000);
        const cleanText = decodeSlackMarkup(String(msg.text || '').replace(/\s+/g, ' ').trim());
        events.push({
          source: 'Slack',
          timestamp: at,
          timestampJst: formatJstDateTime_(at),
          text: cleanText,
          evidenceLabel: msg.channelName ? `#${msg.channelName}` : (msg.channelId || 'Slack'),
          permalink: msg.permalink || ''
        });
      });
    }
  }
  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  const backlogEvents = collectionMode === SUMMARY_COLLECTION_MODE_FULL
    ? fetchBacklogIssuesDetailedForSummary_(backlogState.configs || [], clientDef.backlogKeys || [], startDate, endDate)
    : fetchBacklogActivitiesDetailedForSummary_(backlogState.configs || [], clientDef.backlogKeys || [], startDate, endDate);
  backlogEvents.forEach(function(ev) { events.push(ev); });

  const dedup = {};
  const normalized = [];
  events
    .sort(function(a, b) { return a.timestamp.getTime() - b.timestamp.getTime(); })
    .forEach(function(ev) {
      const key = `${ev.source}|${ev.timestamp.getTime()}|${ev.text}`;
      if (dedup[key]) return;
      dedup[key] = true;
      normalized.push(ev);
    });
  return normalized.slice(-SUMMARY_MAX_EVENTS_PER_CLIENT);
}

function runClientSummary(params) {
  logUserActivity('runClientSummary');
  const input = params || {};
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error('Slack連携がされていません');
  const startRange = getJstDayRange(input.startDate || new Date()).start;
  const endRange = getJstDayRange(input.endDate || new Date()).endInclusive;
  if (startRange > endRange) throw new Error('終了日は開始日より後に設定してください');

  const selectedIdsRaw = Array.isArray(input.clientIds) ? input.clientIds : [];
  const selectedIdSet = {};
  const selectedIds = [];
  selectedIdsRaw.forEach(function(v) {
    const id = String(v || '').trim();
    if (!id || selectedIdSet[id]) return;
    selectedIdSet[id] = true;
    selectedIds.push(id);
  });
  if (selectedIds.length === 0) throw new Error('対象クライアントを選択してください');
  if (selectedIds.length > SUMMARY_MAX_CLIENTS) throw new Error(`同時に選択できるクライアントは最大${SUMMARY_MAX_CLIENTS}件です`);
  const rangeDays = Math.floor((endRange.getTime() - startRange.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (rangeDays > SUMMARY_MAX_RANGE_DAYS) throw new Error(`期間は最大${SUMMARY_MAX_RANGE_DAYS}日までにしてください`);

  const defs = getSummaryClientDefinitions();
  const byId = {};
  defs.forEach(function(def) { byId[def.id] = def; });
  const targets = selectedIds
    .map(function(id) { return byId[id]; })
    .filter(function(def) { return !!def; });
  if (targets.length === 0) throw new Error('クライアント定義が見つかりません');

  const showEvidence = (typeof input.showEvidence === 'boolean')
    ? input.showEvidence
    : (props.SUMMARY_EVIDENCE_DEFAULT === 'on');
  const collectionMode = normalizeSummaryCollectionMode_(input.collectionMode || props.SUMMARY_COLLECTION_MODE);
  const customPrompt = (getPromptSettings() || {}).clientSummary || '';
  const summaries = [];
  const warnings = [];
  const runtimeCache = { slackByDay: {} };
  targets.forEach(function(clientDef) {
    try {
      const tmpProps = Object.assign({}, props, { SUMMARY_COLLECTION_MODE: collectionMode });
      const events = collectSummaryEventsForClient_(tmpProps, clientDef, startRange, endRange, runtimeCache);
      if (!events || events.length === 0) {
        summaries.push({
          clientId: clientDef.id,
          clientName: clientDef.name,
          status: 'no_activity',
          report: [
            '進捗',
            '- 更新なし',
            '',
            '主な対応（時系列）',
            '- 期間内の更新は確認できませんでした',
            '',
            '懸念・リスク',
            '- 情報不足（要確認）',
            '',
            '次アクション',
            '- 必要に応じてSlack/Backlogの更新状況を再確認してください',
            '',
            '要確認',
            '- 情報不足（要確認）'
          ].join('\n'),
          evidence: [],
          activityCount: 0
        });
        return;
      }
      const extracted = events.map(function(ev) {
        return {
          timestampJst: ev.timestampJst,
          source: ev.source,
          text: ev.text,
          evidenceLabel: ev.evidenceLabel
        };
      });
      const reportText = generateClientSummaryWithGemini(clientDef.name, extracted, startRange, endRange, customPrompt);
      summaries.push({
        clientId: clientDef.id,
        clientName: clientDef.name,
        status: 'ok',
        report: reportText,
        evidence: events.map(function(ev) {
          return {
            source: ev.source,
            timestampJst: ev.timestampJst,
            label: ev.evidenceLabel,
            permalink: ev.permalink || '',
            text: ev.text
          };
        }),
        activityCount: events.length
      });
    } catch (e) {
      const msg = String(e && e.message || e || '不明なエラー');
      warnings.push((clientDef.name || '（名称未入力）') + ' の生成でエラー: ' + msg);
      summaries.push({
        clientId: clientDef.id,
        clientName: clientDef.name,
        status: 'error',
        report: 'このクライアントのサマリ生成に失敗しました。時間をおいて再実行してください。',
        evidence: [],
        activityCount: 0
      });
    }
  });

  return {
    success: true,
    startDate: Utilities.formatDate(startRange, JST_TIMEZONE, 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(endRange, JST_TIMEZONE, 'yyyy-MM-dd'),
    showEvidence: !!showEvidence,
    collectionMode: collectionMode,
    summaries: summaries,
    coverage: {
      selected: selectedIds.length,
      generated: summaries.length
    },
    warnings: warnings
  };
}

/**
 * 工数集計のAI応答が異常かどうかを判定します。
 * @param {string} reportText AIが生成したテキスト
 * @returns {boolean} 異常であればtrue
 */
function isAggregationResultInvalid(reportText) {
  if (!reportText || reportText.length < 30) return true;
  const contentChars = reportText.replace(/[-|#*`\s\n\r]/g, '');
  if (contentChars.length < 20) return true;

  // 水平線やパイプ記号が異常に多い場合も不正とみなす
  const markdownSymbols = (reportText.match(/[-|]/g) || []).length;
  if (contentChars.length > 0 && markdownSymbols / contentChars.length > 10) return true;

  return false;
}

function sendFinalReport(editedReport, dateStr = null) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) throw new Error("Slack連携切れ");
  
  let targetDate = new Date();
  if (dateStr) { targetDate = parseDateInputAsJst(dateStr); }
  else if (props.REPORT_DATE) { targetDate = parseDateInputAsJst(props.REPORT_DATE); }
  
  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) throw new Error("送信先(チャンネルIDまたはメンバーID)が見つかりません。設定を保存し直してください。");

  const reportForSend = normalizeReportSpacing(stripSlackEmphasisMarkers(editedReport));
  const slackPost = sendToSlack(reportForSend, props.SLACK_USER_TOKEN, dest, props.REPORT_SLACK_STYLE, targetDate, props.REPORT_FIXED_THREAD_URL, props.REPORT_DAY_FORMAT, null, props.REPORT_SLACK_FORMAT || 'markdown_block');
  if ((props.REPORT_SLACK_HOUSEKEEPING || 'off') === 'on') {
    try {
      cleanupPreviousDailyReportMessage_(props, targetDate, dest);
    } catch (cleanupErr) {
      console.warn('Daily report housekeeping skipped:', cleanupErr.message);
    }
  }
  persistLastDailyReportMeta_(targetDate, dest, slackPost && slackPost.ts ? slackPost.ts : '');

  const modelId = resolveGeminiModelId_();
  let historyUrl = null;
  let historyStorage = '';
  let historyLabel = '';
  try {
    const historyResult = saveToPrivateHistory(reportForSend, targetDate, {
      department: props.SELECTED_DEPARTMENT || 'CS',
      destination: dest,
      modelId: modelId,
      reportMode: '要約モード',
      bulletStyle: props.REPORT_BULLET_STYLE || 'markdown',
      slackStyle: props.REPORT_SLACK_STYLE || 'direct',
      slackFormat: props.REPORT_SLACK_FORMAT || 'markdown_block'
    });
    if (historyResult && typeof historyResult === 'object') {
      historyUrl = historyResult.url || '';
      historyStorage = historyResult.storage || '';
      historyLabel = historyResult.label || '';
    } else {
      historyUrl = historyResult || '';
    }
  } catch (e) {
    console.error('BigQuery save failed after Slack post:', e.message);
    historyUrl = getDailyReportHistoryConsoleUrl();
    historyStorage = historyUrl ? 'bigquery' : '';
    historyLabel = historyUrl ? '履歴データを開く' : '';
  }
  return {
    success: true,
    message: 'Slack送信完了！',
    historyUrl: historyUrl,
    historyStorage: historyStorage,
    historyLabel: historyLabel
  };
}

function runJstBoundaryDiagnostics(baseDateStr) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    throw new Error('Slack連携が未設定のため、検証を実行できません。');
  }
  const anchor = parseDateInputAsJst(baseDateStr || new Date());
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || '').split(',').map(function(w) { return w.trim(); }).filter(Boolean);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || '').split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  const offsets = [-2, -1, 0];

  function asJst(ts) {
    if (!ts) return '';
    return Utilities.formatDate(new Date(ts), JST_TIMEZONE, 'yyyy/MM/dd HH:mm:ss');
  }
  function summarize(dayRange, timestamps) {
    if (!timestamps || timestamps.length === 0) {
      return { count: 0, minJst: '', maxJst: '', outOfRange: 0 };
    }
    const sorted = timestamps.slice().sort(function(a, b) { return a - b; });
    const out = sorted.filter(function(t) {
      return t < dayRange.start.getTime() || t >= dayRange.endExclusive.getTime();
    }).length;
    return {
      count: sorted.length,
      minJst: asJst(sorted[0]),
      maxJst: asJst(sorted[sorted.length - 1]),
      outOfRange: out
    };
  }

  const diagnostics = offsets.map(function(offset) {
    const day = new Date(anchor.getTime());
    day.setDate(day.getDate() + offset);
    const dayRange = getJstDayRange(day);

    const cal = fetchGoogleCalendarEvents(day, calIgnore);
    const slack = fetchMySlackPosts(props.SLACK_USER_TOKEN, day, props.REPORT_SLACK_SCOPE, slackIgnore);
    const gmail = fetchGmailSentMessages(day);
    const backlog = backlogState.configs.length > 0 ? fetchMultiBacklogActivities(backlogState.configs, day) : [];

    const calTimes = cal.map(function(e) { return e && e.event ? e.event.getStartTime().getTime() : NaN; }).filter(function(v) { return !isNaN(v); });
    const slackTimes = slack.map(function(s) { return parseFloat(s.ts || '0') * 1000; }).filter(function(v) { return !isNaN(v) && v > 0; });
    const gmailTimes = gmail.map(function(g) { return g && g.date ? new Date(g.date).getTime() : NaN; }).filter(function(v) { return !isNaN(v); });
    const backlogTimes = backlog.map(function(b) { return b && b.date ? new Date(b.date).getTime() : NaN; }).filter(function(v) { return !isNaN(v); });

    return {
      targetDateJst: dayRange.ymd,
      rangeStartJst: asJst(dayRange.start),
      rangeEndJst: asJst(dayRange.endInclusive),
      calendar: summarize(dayRange, calTimes),
      slack: summarize(dayRange, slackTimes),
      gmail: summarize(dayRange, gmailTimes),
      backlog: summarize(dayRange, backlogTimes)
    };
  });

  return { diagnostics: diagnostics };
}

/**
 * 指定された日の活動ログを収集します。
 * @param {object} props ユーザープロパティ
 * @param {Date} targetDate 対象日
 * @param {string} department 部署コード (CS または ES)
 * @returns {object} 収集されたログテキストとカウント、TeamSpiritデータ
 */
function loadClientAliasRules(rulesJson) {
  if (!rulesJson || !rulesJson.trim()) return [];
  const cache = CacheService.getUserCache();
  const cacheKey = 'CLIENT_ALIAS_RULES_PARSED';
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('client alias cache parse error:', e.message);
  }

  try {
    const parsed = JSON.parse(rulesJson);
    const rules = Array.isArray(parsed) ? parsed : [];
    cache.put(cacheKey, JSON.stringify(rules), 600);
    return rules;
  } catch (e) {
    console.warn('CLIENT_ALIAS_RULES JSON parse error:', e.message);
    return [];
  }
}

function normalizeClientAliasRules(rules, includeIndex) {
  const normalized = [];
  (Array.isArray(rules) ? rules : []).forEach(function(rule, index) {
    if (!rule || !rule.canonical || rule.enabled === false) return;
    const normalizedKeywords = (rule.keywords || [])
      .map(function(kw) { return normalizeClientAliasText_(kw || ''); })
      .filter(Boolean);
    normalized.push({
      index: includeIndex ? index : -1,
      canonical: rule.canonical,
      slackChannels: (rule.slackChannels || []).map(function(id) { return (id || '').trim(); }).filter(Boolean),
      backlogKeys: (rule.backlogKeys || []).map(function(key) { return (key || '').toUpperCase(); }).filter(Boolean),
      keywords: normalizedKeywords
    });
  });
  return normalized;
}

function normalizeClientAliasText_(text) {
  if (text === null || text === undefined) return '';
  const src = String(text).toLowerCase();
  let out = '';
  for (var i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    // 全角英数・記号（！〜）を半角へ
    if (code >= 0xFF01 && code <= 0xFF5E) {
      out += String.fromCharCode(code - 0xFEE0);
      continue;
    }
    // 全角スペース
    if (code === 0x3000) {
      out += ' ';
      continue;
    }
    out += src.charAt(i);
  }

  // 記号・空白を除去して比較を安定化
  return out
    .replace(/[\s\-_/.:,!?'"`~@#$%^&*(){}\[\]<>|\\＋＝・。、「」『』【】（）]/g, '')
    .trim();
}

function scoreKeywordMatch_(keywords, normalizedFields, normalizedHaystack) {
  if (!keywords || keywords.length === 0) return null;
  let best = null;

  for (var i = 0; i < keywords.length; i++) {
    var kw = keywords[i];
    if (!kw) continue;
    var kwLen = kw.length;
    var score = 0;

    for (var j = 0; j < normalizedFields.length; j++) {
      if (normalizedFields[j] === kw) {
        score = Math.max(score, 1000 + kwLen * 10); // 完全一致を最優先
      } else if (normalizedFields[j].indexOf(kw) !== -1) {
        score = Math.max(score, 700 + kwLen * 5); // フィールド内部分一致
      }
    }

    if (score === 0 && normalizedHaystack.indexOf(kw) !== -1) {
      score = 400 + kwLen * 2; // 全文一致（弱）
    }

    if (score > 0) {
      if (!best || score > best.score || (score === best.score && kwLen > best.length)) {
        best = { score: score, length: kwLen, keyword: kw };
      }
    }
  }

  return best;
}

function findClientAliasMatch(normalizedRules, meta) {
  if (!normalizedRules || normalizedRules.length === 0) {
    return { matched: null, ruleIndex: -1 };
  }

  const safeMeta = meta || {};
  const sourceType = (safeMeta.sourceType || 'other').toLowerCase();
  const channelId = (safeMeta.channelId || '').trim();
  const projectKey = (safeMeta.projectKey || '').trim().toUpperCase();
  const fields = [
    safeMeta.channelName,
    safeMeta.title,
    safeMeta.subject,
    safeMeta.summary,
    safeMeta.place,
    safeMeta.accountName,
    safeMeta.opportunityName,
    safeMeta.threadTopText,
    safeMeta.displayText,
    safeMeta.content,
    safeMeta.text
  ].filter(Boolean);

  const normalizedFields = fields
    .map(function(field) { return normalizeClientAliasText_(field); })
    .filter(Boolean);
  const normalizedHaystack = normalizedFields.join('');

  for (var i = 0; i < normalizedRules.length; i++) {
    var rule = normalizedRules[i];
    if (sourceType === 'slack' && channelId && rule.slackChannels.indexOf(channelId) !== -1) {
      return { matched: rule.canonical, ruleIndex: typeof rule.index === 'number' ? rule.index : -1 };
    }
    if (sourceType === 'backlog' && projectKey && rule.backlogKeys.indexOf(projectKey) !== -1) {
      return { matched: rule.canonical, ruleIndex: typeof rule.index === 'number' ? rule.index : -1 };
    }
  }

  var bestRule = null;
  for (var k = 0; k < normalizedRules.length; k++) {
    var candidateRule = normalizedRules[k];
    var match = scoreKeywordMatch_(candidateRule.keywords, normalizedFields, normalizedHaystack);
    if (!match) continue;
    if (
      !bestRule ||
      match.score > bestRule.score ||
      (match.score === bestRule.score && match.length > bestRule.length)
    ) {
      bestRule = {
        canonical: candidateRule.canonical,
        ruleIndex: typeof candidateRule.index === 'number' ? candidateRule.index : -1,
        score: match.score,
        length: match.length
      };
    }
  }

  if (bestRule) {
    return { matched: bestRule.canonical, ruleIndex: bestRule.ruleIndex };
  }
  return { matched: null, ruleIndex: -1 };
}

function createClientResolver(rules) {
  if (!rules || rules.length === 0) return function() { return null; };

  const normalized = normalizeClientAliasRules(rules, false);

  if (normalized.length === 0) return function() { return null; };

  return function resolve(meta) {
    return findClientAliasMatch(normalized, meta).matched;
  };
}

function testClientAliasMatch(rulesJson, meta) {
  const rules = loadClientAliasRules(rulesJson || '[]');
  const normalized = normalizeClientAliasRules(rules, true);
  return findClientAliasMatch(normalized, meta);
}

function fetchSlackConversations(token, options) {
  if (!token) return [];

  const opts = options || {};
  const limit = opts.limit || 200;
  const maxPages = opts.maxPages || 5;
  const includeArchived = opts.includeArchived === true;
  const types = opts.types || 'public_channel,private_channel';
  const conversations = [];
  let cursor = '';

  for (let page = 0; page < maxPages; page++) {
    const params = [
      `limit=${limit}`,
      `types=${encodeURIComponent(types)}`
    ];
    if (!includeArchived) {
      params.push('exclude_archived=true');
    }
    if (cursor) {
      params.push(`cursor=${encodeURIComponent(cursor)}`);
    }
    const url = `https://slack.com/api/conversations.list?${params.join('&')}`;

    let payload;
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (response.getResponseCode() !== 200) {
        throw new Error(`Slack conversations.list HTTP ${response.getResponseCode()}`);
      }
      payload = JSON.parse(response.getContentText());
    } catch (e) {
      throw new Error(formatNetworkError('Slackチャンネル取得中', e));
    }

    if (!payload.ok) {
      throw new Error(`Slack APIエラー: ${payload.error || 'unknown_error'}`);
    }

    (payload.channels || []).forEach(function(channel) {
      if (!channel || !channel.id || !channel.name) return;
      if (!includeArchived && channel.is_archived) return;
      conversations.push(channel);
    });

    cursor = payload.response_metadata && payload.response_metadata.next_cursor;
    if (!cursor) break;
  }

  return conversations;
}

function fetchBacklogProjects(conf) {
  if (!conf || !conf.host || !conf.key) return [];
  const host = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${host}/api/v2/projects?apiKey=${encodeURIComponent(conf.key)}`;
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    timeout: DEFAULT_FETCH_TIMEOUT_MS
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Backlog APIエラー(projects): HTTP ${response.getResponseCode()}`);
  }
  const projects = JSON.parse(response.getContentText());
  return (Array.isArray(projects) ? projects : []).filter(function(project) {
    return project && project.projectKey;
  });
}

function fetchBacklogIssuesForAutoTest(conf, count) {
  if (!conf || !conf.host || !conf.key) return [];
  const host = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${host}/api/v2/issues?apiKey=${encodeURIComponent(conf.key)}&count=${count || 10}&sort=updated&order=desc`;
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    timeout: DEFAULT_FETCH_TIMEOUT_MS
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Backlog APIエラー(issues): HTTP ${response.getResponseCode()}`);
  }
  const issues = JSON.parse(response.getContentText());
  return Array.isArray(issues) ? issues : [];
}

function suggestClientAliasRules() {
  const props = PropertiesService.getUserProperties().getProperties();
  const rules = loadClientAliasRules(props.CLIENT_ALIAS_RULES || '');
  const registeredSlackIds = {};
  const registeredBacklogKeys = {};
  const result = { slack: [], backlog: [] };

  rules.forEach(function(rule) {
    (rule.slackChannels || []).forEach(function(id) {
      const trimmed = (id || '').trim();
      if (trimmed) registeredSlackIds[trimmed] = true;
    });
    (rule.backlogKeys || []).forEach(function(key) {
      const upperKey = (key || '').trim().toUpperCase();
      if (upperKey) registeredBacklogKeys[upperKey] = true;
    });
  });

  if (props.SLACK_USER_TOKEN) {
    try {
      const slackChannels = fetchSlackConversations(props.SLACK_USER_TOKEN, {
        maxPages: 5,
        limit: 200,
        types: 'public_channel,private_channel'
      });
      result.slack = slackChannels
        .filter(function(channel) { return !registeredSlackIds[channel.id]; })
        .map(function(channel) {
          return { source: 'slack', id: channel.id, name: channel.name };
        })
        .sort(function(a, b) { return a.name.localeCompare(b.name, 'ja'); });
    } catch (e) {
      console.warn('suggestClientAliasRules Slack error:', e.message);
    }
  }

  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  if (backlogState.configs.length > 0) {
    const seenKeys = {};
    backlogState.configs.forEach(function(conf) {
      try {
        fetchBacklogProjects(conf).forEach(function(project) {
          const projectKey = (project.projectKey || '').toUpperCase();
          if (!projectKey || registeredBacklogKeys[projectKey] || seenKeys[projectKey]) return;
          seenKeys[projectKey] = true;
          result.backlog.push({
            source: 'backlog',
            id: String(project.id || projectKey),
            name: project.name || projectKey,
            projectKey: projectKey
          });
        });
      } catch (e) {
        console.warn('suggestClientAliasRules Backlog error:', e.message);
      }
    });
    result.backlog.sort(function(a, b) { return a.projectKey.localeCompare(b.projectKey, 'en'); });
  }

  return result;
}

function runClientAliasAutoTest(rulesJson) {
  const rules = loadClientAliasRules(rulesJson || '[]');
  const normalized = normalizeClientAliasRules(rules, true);
  const props = PropertiesService.getUserProperties().getProperties();
  const results = [];
  const ignoreIds = (props.SLACK_IGNORE_CHANNELS || '').split(',').map(function(id) { return id.trim(); }).filter(Boolean);
  const oldest = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
  const maxSlackItems = 30;
  const maxSlackPerChannel = 5;
  const maxBacklogItems = 20;
  let slackCount = 0;
  let backlogCount = 0;

  if (props.SLACK_USER_TOKEN) {
    try {
      const channels = fetchSlackConversations(props.SLACK_USER_TOKEN, {
        maxPages: 5,
        limit: 200,
        types: 'public_channel,private_channel'
      });
      for (var i = 0; i < channels.length && slackCount < maxSlackItems; i++) {
        const channel = channels[i];
        if (shouldIgnoreSlackChannel(channel, ignoreIds, [])) continue;

        try {
          const url = `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel.id)}&oldest=${oldest}&limit=${maxSlackPerChannel * 3}&inclusive=true`;
          const response = UrlFetchApp.fetch(url, {
            method: 'get',
            headers: { Authorization: `Bearer ${props.SLACK_USER_TOKEN}` },
            muteHttpExceptions: true,
            timeout: DEFAULT_FETCH_TIMEOUT_MS
          });
          if (response.getResponseCode() !== 200) {
            throw new Error(`Slack conversations.history HTTP ${response.getResponseCode()}`);
          }
          const payload = JSON.parse(response.getContentText());
          if (!payload.ok) {
            throw new Error(payload.error || 'unknown_error');
          }

          const messages = (payload.messages || [])
            .filter(function(message) {
              return message && message.text && message.text.trim();
            })
            .slice(0, maxSlackPerChannel);

          for (var m = 0; m < messages.length && slackCount < maxSlackItems; m++) {
            const message = messages[m];
            const match = findClientAliasMatch(normalized, {
              sourceType: 'slack',
              channelId: channel.id,
              channelName: channel.name,
              text: message.text
            });
            const excerpt = message.text.length > 50 ? `${message.text.substring(0, 50)}...` : message.text;
            results.push({
              source: 'slack',
              label: `#${channel.name}`,
              excerpt: excerpt,
              matched: match.matched,
              ruleIndex: match.ruleIndex
            });
            slackCount++;
          }
        } catch (e) {
          console.warn(`runClientAliasAutoTest Slack history error (${channel.id}):`, e.message);
        }
      }
    } catch (e) {
      console.warn('runClientAliasAutoTest Slack error:', e.message);
    }
  }

  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  if (backlogState.configs.length > 0) {
    for (var k = 0; k < backlogState.configs.length && backlogCount < maxBacklogItems; k++) {
      const conf = backlogState.configs[k];
      try {
        const issues = fetchBacklogIssuesForAutoTest(conf, 10);
        for (var n = 0; n < issues.length && backlogCount < maxBacklogItems; n++) {
          const issue = issues[n];
          const projectKey = ((issue.issueKey || '').split('-')[0] || (issue.project && issue.project.projectKey) || '').toUpperCase();
          const summary = issue.summary || '';
          const match = findClientAliasMatch(normalized, {
            sourceType: 'backlog',
            projectKey: projectKey,
            title: summary,
            text: ''
          });
          const excerpt = summary.length > 50 ? `${summary.substring(0, 50)}...` : summary;
          results.push({
            source: 'backlog',
            label: issue.issueKey || projectKey,
            excerpt: excerpt,
            matched: match.matched,
            ruleIndex: match.ruleIndex
          });
          backlogCount++;
        }
      } catch (e) {
        console.warn('runClientAliasAutoTest Backlog error:', e.message);
      }
    }
  }

  return results;
}

function prefixWithClientLabel(text, clientName) {
  if (!text || !clientName) return text;
  if (/^【.+】/.test(text.trim())) return text;
  return `【${clientName}】${text}`;
}

function getNextBusinessDay(baseDate, holidayChecker) {
  const nextDate = new Date(baseDate);
  nextDate.setHours(0, 0, 0, 0);
  const checker = typeof holidayChecker === 'function'
    ? holidayChecker
    : (typeof isHoliday === 'function' ? isHoliday : function() { return false; });

  for (let i = 0; i < 14; i++) {
    nextDate.setDate(nextDate.getDate() + 1);
    const day = nextDate.getDay();
    if (day === 0 || day === 6) continue;
    if (checker(nextDate)) continue;
    return nextDate;
  }

  return nextDate;
}

function collectLogs(props, targetDate, department) {
  let allLogs = "";
  let counts = { calendar: 0, slack: 0, gmail: 0, backlog: 0, salesforce: 0 }; // salesforceを追加
  let teamSpiritData = null; // TeamSpiritデータ格納用
  let sources = { calendar: '', slack: '', gmail: '', backlog: '', salesforce: '',
                  calendarRows: [], slackRows: [], gmailRows: [], backlogRows: [], salesforceRows: [],
                  nextBusinessCalendar: '', nextBusinessCalendarRows: [],
                  pendingBacklog: '', pendingSlack: '' };
  const warnings = [];
  const aliasRules = loadClientAliasRules(props.CLIENT_ALIAS_RULES || '');
  const hasAliasRules = normalizeClientAliasRules(aliasRules, false).length > 0;
  const resolveClient = createClientResolver(aliasRules);
  const fallbackClientName = (props.CLIENT_FALLBACK_NAME || '● その他').trim();
  const clientSet = new Set();
  const aliasStats = { total: 0, matched: 0, unmatched: 0, sources: {} };

  function markAliasStat(sourceType, matched) {
    const source = (sourceType || 'other').toLowerCase();
    if (!aliasStats.sources[source]) {
      aliasStats.sources[source] = { total: 0, matched: 0, unmatched: 0 };
    }
    aliasStats.total++;
    aliasStats.sources[source].total++;
    if (matched) {
      aliasStats.matched++;
      aliasStats.sources[source].matched++;
    } else {
      aliasStats.unmatched++;
      aliasStats.sources[source].unmatched++;
    }
  }

  function determineClient(meta) {
    if (!hasAliasRules) return null;
    const safeMeta = meta || {};
    const resolved = resolveClient(safeMeta);
    markAliasStat(safeMeta.sourceType, !!resolved);
    if (!resolved) return fallbackClientName;
    clientSet.add(resolved);
    return resolved;
  }

  // 除外設定の読み込み
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);

  // 既存のログ収集（Calendar, Slack, Gmail, Backlog）
  try {
    const cal = fetchGoogleCalendarEvents(targetDate, calIgnore);
    if (cal.length > 0) {
      if (hasAliasRules) {
        cal.forEach(function(eventRow) {
          const title = eventRow.event ? eventRow.event.getTitle() : (eventRow.log || '');
          const clientName = determineClient({
            sourceType: 'calendar',
            title: title,
            text: eventRow.log || ''
          });
          eventRow.clientName = clientName;
          if (clientName) {
            eventRow.log = prefixWithClientLabel(eventRow.log, clientName);
          }
        });
      }
      counts.calendar = cal.length;
      const calText = cal.map(function(c) { return c.log; }).join('\n');
      sources.calendar = calText;
      sources.calendarRows = cal;
      allLogs += `=== Googleカレンダー ===\n${calText}\n\n`;
    }
  } catch(e){
    console.warn("Calendar error:", e);
    warnings.push(createSourceWarning('Googleカレンダー'));
  }
  
  try {
    const slackRaw = fetchMySlackPosts(props.SLACK_USER_TOKEN, targetDate, props.REPORT_SLACK_SCOPE, slackIgnore);
    const slackMessages = (slackRaw || []).map(msg => {
      if (typeof msg === 'string') {
        return { displayText: msg, text: msg };
      }
      if (!msg.displayText) {
        const channelLabel = msg.channelName ? `[#${msg.channelName}] ` : '';
        msg.displayText = `${channelLabel}${msg.text || ''}`;
      }
      return msg;
    });

    if (hasAliasRules && slackMessages.length > 0) {
      slackMessages.forEach(function(msg) {
        msg.clientName = determineClient({
          sourceType: 'slack',
          channelId: msg.channelId,
          channelName: msg.channelName,
          text: msg.text
        });
        if (msg.clientName) {
          msg.displayText = prefixWithClientLabel(msg.displayText || '', msg.clientName);
        }
      });
    }

    if (slackMessages.length > 0) {
      counts.slack = slackMessages.length;
      const slackDisplay = slackMessages.map(msg => msg.displayText || '').join('\n');
      const formattedSlack = formatSlackLogsForSheet(slackMessages);
      sources.slack = formattedSlack || slackDisplay;
      sources.slackRows = slackMessages;
      allLogs += `=== Slack ===\n${slackDisplay}\n\n`;
    }
  } catch(e){
    console.warn("Slack error:", e);
    warnings.push(createSourceWarning('Slackログ'));
  }
  
  try {
    const gmData = fetchGmailSentMessages(targetDate);
    if (gmData.length > 0) {
        if (hasAliasRules) {
          gmData.forEach(function(g) {
            g.clientName = determineClient({
              sourceType: 'gmail',
              title: g.subject,
              text: g.displayText || ''
            });
            if (g.clientName) {
              g.displayText = prefixWithClientLabel(g.displayText, g.clientName);
            }
          });
        }
        counts.gmail = gmData.length;
        const gmText = gmData.map(g => g.displayText).join('\n');
        sources.gmail = gmText;
        sources.gmailRows = gmData;
        allLogs += `=== Gmail ===\n${gmText}\n\n`;
    }
  } catch(e){
    if (e.message && e.message.includes("Gmailへのアクセス権限がありません")) {
        throw new Error("Gmailへのアクセス権限がありません。Googleアカウントの権限設定を確認してください。");
    }
    console.warn("Gmail error:", e);
    warnings.push(createSourceWarning('Gmail送信履歴'));
  }
  
  const backlogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  if (backlogState.configs.length > 0) {
    try {
      const blData = fetchMultiBacklogActivities(backlogState.configs, targetDate);
      if (blData.length > 0) {
          if (hasAliasRules) {
            blData.forEach(function(b) {
              b.clientName = determineClient({
                sourceType: 'backlog',
                projectKey: b.projectKey,
                title: b.summary,
                text: b.comment || b.displayText || ''
              });
              if (b.clientName) {
                b.displayText = prefixWithClientLabel(b.displayText, b.clientName);
              }
            });
          }
          counts.backlog = blData.length;
          const blText = blData.map(b => b.displayText).join('\n');
          sources.backlog = blText;
          sources.backlogRows = blData;
          allLogs += `=== Backlog ===\n${blText}\n\n`;
      }
    } catch(e){
      console.warn("Backlog error:", e);
      warnings.push(createSourceWarning('Backlogアクティビティ'));
    }
  } else if (backlogState.parseError) {
    warnings.push('Backlog設定の読み込みに失敗したため、Backlogログを含めていません。設定画面で内容を確認のうえ再保存してください。');
  } else if (backlogState.hasAnyEntry) {
    warnings.push('Backlog設定にホスト名またはAPIキーが未入力のため、Backlogログは含まれていません。');
  }
  
  // Salesforce連携（オプション）
  let sfLogs = [];
  let sfRows = [];
  if (props.SF_ACCESS_TOKEN) {
    try {
      // TeamSpirit打刻情報
      teamSpiritData = fetchTeamSpiritWorkTime(targetDate);
      if (teamSpiritData) {
        if (teamSpiritData.realHours) {
          let logLine = `[勤怠] 実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`;
          const row = { date: targetDate, place: '', subject: '勤怠', content: `実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`, url: '' };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        } else if (teamSpiritData.startTime) {
          const startLabel = Utilities.formatDate(new Date(teamSpiritData.startTime), 'JST', 'HH:mm');
          let logLine = `[勤怠] 出勤時刻: ${startLabel}`;
          const row = { date: targetDate, place: '', subject: '勤怠', content: `出勤時刻: ${startLabel}`, url: '' };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        }
      }

      // 商談履歴（ES部のみ）
      if (department === 'ES') {
        const opportunities = fetchOpportunities(targetDate);
        opportunities.forEach(opp => {
          let logLine = `[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`;
          const row = {
            date: opp.lastModified ? new Date(opp.lastModified) : targetDate,
            place: opp.accountName || '',
            subject: opp.name || '',
            content: `${opp.stage}${opp.amount ? ' / ' + opp.amount.toLocaleString() + '円' : ''}`,
            url: ''
          };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.place || row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        });

        const tasks = fetchOpportunityTasks(targetDate);
        tasks.forEach(task => {
          const oppName = task.opportunityName ? ` - ${task.opportunityName}` : '';
          let logLine = `[活動] ${task.subject} (${task.status})${oppName}`;
          const row = {
            date: task.activityDate ? new Date(task.activityDate) : targetDate,
            place: task.opportunityName || '',
            subject: task.subject || '',
            content: task.status || '',
            url: ''
          };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.place || row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        });
      }
    } catch (e) {
      console.warn("Salesforce error:", e);
      warnings.push(createSourceWarning('Salesforce連携'));
    }
  } else {
    // --- BigQuery連携 (代替案) ---
    // 正規のSalesforce連携が設定されていない場合のみ、こちらを試行
    try {
      // TeamSpirit打刻情報（BigQuery経由）
      teamSpiritData = fetchTeamSpiritFromBigQuery(targetDate);
      if (teamSpiritData) {
        if (teamSpiritData.realHours) {
          let logLine = `[勤怠] 実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間 (BQ)`;
          const row = { date: targetDate, place: '', subject: '勤怠', content: `実労働時間: ${teamSpiritData.realHours.toFixed(2)}時間`, url: '' };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        } else if (teamSpiritData.startTime) {
          let logLine = `[勤怠] 出勤時刻: ${teamSpiritData.startTime} (BQ)`;
          const row = { date: targetDate, place: '', subject: '勤怠', content: `出勤時刻: ${teamSpiritData.startTime}`, url: '' };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        }
      }

      // 商談履歴（ES部のみ、BigQuery経由）
      // NOTE: 実運用で未確定のため、明示フラグで無効化（デフォルトOFF）。
      // 再開時は ScriptProperties の ENABLE_BQ_SF_OPPORTUNITY_FALLBACK を 'true' に設定。
      const enableBqSfOpportunityFallback = PropertiesService.getScriptProperties()
        .getProperty('ENABLE_BQ_SF_OPPORTUNITY_FALLBACK') === 'true';
      if (department === 'ES' && enableBqSfOpportunityFallback) {
        const opportunities = fetchOpportunitiesFromBigQuery(targetDate);
        opportunities.forEach(opp => {
          let logLine = `[商談] ${opp.accountName}: ${opp.name} (${opp.stage}) (BQ)`;
          const row = {
            date: opp.lastModified ? new Date(opp.lastModified) : targetDate,
            place: opp.accountName || '',
            subject: opp.name || '',
            content: `${opp.stage}${opp.amount ? ' / ' + opp.amount.toLocaleString() + '円' : ''}`,
            url: ''
          };
          if (hasAliasRules) {
            row.clientName = determineClient({ sourceType: 'salesforce', title: row.place || row.subject, text: logLine });
            if (row.clientName) logLine = prefixWithClientLabel(logLine, row.clientName);
          }
          sfLogs.push(logLine);
          sfRows.push(row);
        });
      }
    } catch (e) {
      console.warn("BigQuery fallback error:", e);
      warnings.push('BigQuery経由のSalesforce連携に失敗しました。再実行でも続く場合は設定をご確認ください。');
    }
  }

  if (sfLogs.length > 0) {
    counts.salesforce = sfLogs.length;
    const sfText = sfLogs.join('\n');
    sources.salesforce = sfText;
    sources.salesforceRows = sfRows;
    allLogs += `=== Salesforce ===\n${sfText}\n\n`;
  }

  try {
    // 翌日（明日）のカレンダーを取得
    const tomorrow = new Date(targetDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    // 翌営業日を計算し、翌日と同じ日か確認する
    const nextBusinessDay = getNextBusinessDay(targetDate);
    nextBusinessDay.setHours(0, 0, 0, 0);
    const tomorrowIsBizDay = tomorrow.getTime() === nextBusinessDay.getTime();

    // 翌日（明日）を取得してログに追加
    const tomorrowRows = fetchGoogleCalendarEvents(tomorrow, calIgnore);
    if (tomorrowRows.length > 0) {
      if (hasAliasRules) {
        tomorrowRows.forEach(function(eventRow) {
          const title = eventRow.event ? eventRow.event.getTitle() : (eventRow.log || '');
          const clientName = determineClient({ sourceType: 'calendar', title: title, text: eventRow.log || '' });
          eventRow.clientName = clientName;
          if (clientName) eventRow.log = prefixWithClientLabel(eventRow.log, clientName);
        });
      }
      const tomorrowLabel = Utilities.formatDate(tomorrow, 'JST', 'MM/dd(E)');
      const tomorrowText = tomorrowRows.map(function(c) { return c.log; }).join('\n');
      sources.nextBusinessCalendar = tomorrowText;
      sources.nextBusinessCalendarRows = tomorrowRows;
      // 翌日が翌営業日の場合は「翌営業日」表記、そうでなければ「翌日」表記
      const tomorrowSectionLabel = tomorrowIsBizDay ? `翌営業日 ${tomorrowLabel}` : `翌日 ${tomorrowLabel}`;
      allLogs += `=== Googleカレンダー (${tomorrowSectionLabel}) ===\n${tomorrowText}\n\n`;
    }

    // 翌日 ≠ 翌営業日の場合（週末・祝日をまたぐ場合）は翌営業日も追加取得
    if (!tomorrowIsBizDay) {
      const nextBizRows = fetchGoogleCalendarEvents(nextBusinessDay, calIgnore);
      if (nextBizRows.length > 0) {
        if (hasAliasRules) {
          nextBizRows.forEach(function(eventRow) {
            const title = eventRow.event ? eventRow.event.getTitle() : (eventRow.log || '');
            const clientName = determineClient({ sourceType: 'calendar', title: title, text: eventRow.log || '' });
            eventRow.clientName = clientName;
            if (clientName) eventRow.log = prefixWithClientLabel(eventRow.log, clientName);
          });
        }
        const nextBizLabel = Utilities.formatDate(nextBusinessDay, 'JST', 'MM/dd(E)');
        const nextBizText = nextBizRows.map(function(c) { return c.log; }).join('\n');
        allLogs += `=== Googleカレンダー (翌営業日 ${nextBizLabel}) ===\n${nextBizText}\n\n`;
      }
    }
  } catch (e) {
    console.warn('Next day/business day calendar error:', e);
    warnings.push(createSourceWarning('翌日・翌営業日のGoogleカレンダー'));
  }

  if (backlogState.configs.length > 0) {
    try {
      const pendingIssues = fetchBacklogTodayIssues(backlogState.configs, targetDate);
      if (pendingIssues.length > 0) {
        const pendingBacklogText = pendingIssues.join('\n');
        sources.pendingBacklog = pendingBacklogText;
        allLogs += `=== Backlog 未完了課題 ===\n${pendingBacklogText}\n\n`;
      }
    } catch (e) {
      console.warn('Backlog pending issues error:', e);
      warnings.push('Backlog未完了課題を取得できなかったため、次回やることへの反映が一部不足している可能性があります。');
    }
  }

  if (props.SLACK_USER_TOKEN && props.SLACK_MEMBER_ID) {
    try {
      const slackPending = fetchPendingSlackRequests(
        props.SLACK_USER_TOKEN,
        props.SLACK_MEMBER_ID,
        targetDate
      );
      if (slackPending.length > 0) {
        const pendingSlackText = slackPending.join('\n');
        sources.pendingSlack = pendingSlackText;
        allLogs += `=== Slack未返信依頼 ===\n${pendingSlackText}\n\n`;
      }
    } catch (e) {
      console.warn('Slack pending requests error:', e);
      warnings.push('Slack未返信依頼を取得できなかったため、次回やることへの反映が一部不足している可能性があります。');
    }
  }

  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }

  if (hasAliasRules && aliasStats.total > 0 && aliasStats.unmatched > 0) {
    const sourceSummary = Object.keys(aliasStats.sources)
      .map(function(source) {
        const s = aliasStats.sources[source];
        return { source: source, unmatched: s.unmatched, total: s.total };
      })
      .filter(function(item) { return item.unmatched > 0; })
      .sort(function(a, b) { return b.unmatched - a.unmatched; })
      .slice(0, 3)
      .map(function(item) { return `${item.source}:${item.unmatched}/${item.total}`; })
      .join(', ');
    const ratio = Math.round((aliasStats.unmatched / aliasStats.total) * 100);
    warnings.push(
      `クライアント名寄せで未分類が ${aliasStats.unmatched}/${aliasStats.total} 件（${ratio}%）あります。` +
      ` ルール（チャネルID/Backlogキー/キーワード）を追加すると改善します。` +
      (sourceSummary ? ` 未分類が多いソース: ${sourceSummary}` : '')
    );
  }
  
  return {
    text: allLogs,
    counts: counts,
    teamSpiritData: teamSpiritData,
    sources: sources,
    warnings: warnings,
    clients: hasAliasRules ? Array.from(clientSet) : []
  };
}

/**
 * Backlog API から本日までに期限の来ている未完了課題を取得します。
 * @param {Array} configs BACKLOG_CONFIGS
 * @param {Date} today
 * @returns {string[]}
 */
function fetchBacklogTodayIssues(configs, today) {
  const issues = [];
  const todayStr = Utilities.formatDate(today, 'JST', 'yyyy-MM-dd');

  configs.forEach(conf => {
    if (!conf || !conf.host || !conf.key) return;
    try {
      const host = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const userEndpoint = `https://${host}/api/v2/users/myself?apiKey=${conf.key}`;
      const myselfResponse = UrlFetchApp.fetch(userEndpoint, {
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (myselfResponse.getResponseCode() !== 200) {
        throw new Error(`Backlog APIエラー(users/myself): HTTP ${myselfResponse.getResponseCode()}`);
      }
      const myself = JSON.parse(myselfResponse.getContentText());
      const userId = myself.id;
      const url = `https://${host}/api/v2/issues?apiKey=${conf.key}` +
                  `&assigneeId[]=${userId}` +
                  `&statusId[]=1&statusId[]=2` +
                  `&dueDateUntil=${todayStr}` +
                  `&count=50`;
      const issuesResponse = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (issuesResponse.getResponseCode() !== 200) {
        throw new Error(`Backlog APIエラー(issues): HTTP ${issuesResponse.getResponseCode()}`);
      }
      const res = JSON.parse(issuesResponse.getContentText());
      res.sort((a, b) => {
        const dueA = a && a.dueDate ? a.dueDate.substring(0, 10) : null;
        const dueB = b && b.dueDate ? b.dueDate.substring(0, 10) : null;
        const rankA = dueA === null ? 3 : (dueA < todayStr ? 0 : (dueA === todayStr ? 1 : 2));
        const rankB = dueB === null ? 3 : (dueB < todayStr ? 0 : (dueB === todayStr ? 1 : 2));
        if (rankA !== rankB) return rankA - rankB;
        return String(a && a.issueKey || '').localeCompare(String(b && b.issueKey || ''), 'en');
      });
      res.forEach(issue => {
        const due = issue.dueDate ? issue.dueDate.substring(0, 10) : null;
        const dueLabel = due ? ` (期限: ${due})` : ' (期限未設定)';
        const overdueLabel = due && due < todayStr ? ` ⚠️期限切れ（期限: ${due}）` : '';
        const issueUrl = `https://${host}/view/${issue.issueKey}`;
        const summary = truncateTodoLine_(String(issue.summary || ''), 90);
        issues.push({
          key: issue.issueKey,
          text: `[Backlog] ${issue.issueKey}: ${summary}${dueLabel}${overdueLabel}`,
          url: issueUrl
        });
      });
    } catch(e) {
      console.warn('Backlog today issues error:', e);
    }
  });

  return issues;
}

function loadBacklogConfigs(rawValue) {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return { configs: [], hasAnyEntry: false, parseError: false };
  }
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [];
    const valid = arr.filter(conf => conf && conf.host && conf.key);
    return { configs: valid, hasAnyEntry: arr.length > 0, parseError: false };
  } catch (e) {
    console.warn('Backlog config parse error:', e);
    return { configs: [], hasAnyEntry: true, parseError: true };
  }
}

const MAX_TODO_CALENDAR_ITEMS = 30;
const MAX_TODO_BACKLOG_ITEMS = 30;
const MAX_TODO_TEXT_LENGTH = 18000;
const TODO_PENDING_LOOKBACK_DAYS = 7;
const MAX_TODO_SLACK_PENDING_ITEMS = 30;
const MAX_TODO_BACKLOG_URGENT_ITEMS = 30;
const TODO_INCLUDE_CALENDAR_SECTION = false;

function normalizeTodoTaskLine_(text) {
  return String(text || '')
    .replace(/\[ID:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function compactTodoInputText_(text, lineLimit) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const seen = {};
  const limit = lineLimit || 120;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }
    if (/^===.+===\s*$/.test(trimmed)) {
      out.push(trimmed);
      continue;
    }
    let line = raw.replace(/\s+/g, ' ').trim();
    if (line.length > limit) line = `${line.substring(0, limit - 3)}...`;
    const key = line.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function dedupeTodoEntryObjects_(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = {};
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const text = (typeof entry === 'string')
      ? entry
      : ((entry && entry.text) ? String(entry.text) : '');
    const key = normalizeTodoTaskLine_(text);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push(entry);
  }
  return out;
}

/**
 * 今日のTODO向けに各ソースのタスクを集約します。
 * @param {object} props
 * @param {Date} today
 * @returns {object} { text, warnings }
 */
function collectTodaysTasks(props, today) {
  let calendarSection = '';
  let backlogSection = '';
  let slackSection = '';
  const warnings = [];
  const sourceContext = {
    byId: {},
    backlogByKey: {}
  };
  let backlogSeq = 1;
  let slackSeq = 1;
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);

  if (TODO_INCLUDE_CALENDAR_SECTION) {
    try {
      const cal = fetchGoogleCalendarEvents(today, calIgnore);
      if (cal.length > 0) {
        const sliced = cal.slice(0, MAX_TODO_CALENDAR_ITEMS);
        if (cal.length > MAX_TODO_CALENDAR_ITEMS) {
          warnings.push(`Googleカレンダーの予定が${cal.length}件あったため、先頭${MAX_TODO_CALENDAR_ITEMS}件のみを使用しました。`);
        }
        calendarSection = `=== 本日の予定 ===\n${sliced.map(c => c.log).join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn('collectTodaysTasks Calendar error:', e);
      warnings.push('Googleカレンダーから予定を取得できませんでした。');
    }
  }

  const todoBacklogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  if (todoBacklogState.configs.length > 0) {
    try {
      const issues = fetchBacklogTodayIssues(todoBacklogState.configs, today);
      if (issues.length > 0) {
        const dedupedIssues = dedupeTodoEntryObjects_(issues);
        const urgentIssues = dedupedIssues.filter(function(issue) {
          return /期限切れ|期限:/.test(String(issue && issue.text || ''));
        });
        const normalIssues = dedupedIssues.filter(function(issue) {
          return !/期限切れ|期限:/.test(String(issue && issue.text || ''));
        });
        const prioritizedIssues = urgentIssues
          .slice(0, MAX_TODO_BACKLOG_URGENT_ITEMS)
          .concat(normalIssues);
        const slicedIssues = prioritizedIssues.slice(0, MAX_TODO_BACKLOG_ITEMS);
        if (issues.length > MAX_TODO_BACKLOG_ITEMS) {
          warnings.push(`Backlogの未完了課題が${issues.length}件あったため、先頭${MAX_TODO_BACKLOG_ITEMS}件のみを使用しました。`);
        }
        const issueLines = slicedIssues.map(function(issue) {
          const normalizedIssue = (typeof issue === 'string')
            ? { text: issue, url: '' }
            : (issue || { text: '', url: '' });
          const sourceId = `BL_${backlogSeq++}`;
          sourceContext.byId[sourceId] = {
            type: 'backlog',
            url: normalizedIssue.url || '',
            label: normalizedIssue.text || ''
          };
          const keyMatch = String(normalizedIssue.text || '').match(/\[Backlog\]\s+([A-Z0-9_-]+):/);
          if (keyMatch && keyMatch[1] && normalizedIssue.url) {
            sourceContext.backlogByKey[keyMatch[1]] = {
              url: normalizedIssue.url,
              label: normalizedIssue.text || ''
            };
          }
          return `${normalizedIssue.text || ''} [ID:${sourceId}]`;
        });
        backlogSection = `=== Backlog 未完了課題 ===\n${issueLines.join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn('collectTodaysTasks Backlog error:', e);
      warnings.push('Backlog APIから未完了課題を取得できませんでした。');
    }
  } else if (todoBacklogState.parseError) {
    warnings.push('Backlog設定の読み込みに失敗したため、TODOにはBacklog課題を含めていません。設定画面で保存をやり直してください。');
  } else if (todoBacklogState.hasAnyEntry) {
    warnings.push('Backlog設定にホスト名またはAPIキーが未入力のため、TODOにはBacklog課題を含めていません。設定画面で内容を確認してください。');
  } else {
    warnings.push('Backlog連携が設定されていないため、課題は含まれていません。');
  }

  if (!props.SLACK_USER_TOKEN || !props.SLACK_MEMBER_ID) {
    warnings.push('Slack未返信チェックはSlack連携を完了すると利用できます。');
  } else {
    try {
      const slackPending = fetchPendingSlackRequests(
        props.SLACK_USER_TOKEN,
        props.SLACK_MEMBER_ID,
        today,
        TODO_PENDING_LOOKBACK_DAYS,
        MAX_TODO_SLACK_PENDING_ITEMS
      );
      if (slackPending.length > 0) {
        const dedupedSlack = dedupeTodoEntryObjects_(slackPending).slice(0, MAX_TODO_SLACK_PENDING_ITEMS);
        if (slackPending.length > MAX_TODO_SLACK_PENDING_ITEMS) {
          warnings.push(`Slack未返信依頼が${slackPending.length}件あったため、最新${MAX_TODO_SLACK_PENDING_ITEMS}件のみを使用しました。`);
        }
        const slackLines = dedupedSlack.map(function(entry) {
          const normalizedEntry = (typeof entry === 'string')
            ? { text: entry, permalink: '' }
            : (entry || { text: '', permalink: '' });
          const sourceId = `SLK_${slackSeq++}`;
          sourceContext.byId[sourceId] = {
            type: 'slack',
            url: normalizedEntry.permalink || '',
            label: normalizedEntry.text || ''
          };
          return `${normalizedEntry.text || ''} [ID:${sourceId}]`;
        });
        slackSection = `=== Slack未返信依頼 ===\n${slackLines.join('\n')}\n\n`;
      }
    } catch(e) {
      console.warn('collectTodaysTasks Slack mention error:', e);
      warnings.push('Slack未返信依頼の取得中にエラーが発生しました。');
    }
  }

  // 重要度の高い情報（Backlog/Slack）を先に並べることで、
  // 入力上限に達した場合でもリンク紐づけに必要な情報を優先的に残す。
  let text = compactTodoInputText_(`${backlogSection}${slackSection}${calendarSection}`, 120);

  if (text.length > MAX_TODO_TEXT_LENGTH) {
    const tighter = compactTodoInputText_(text, 80);
    if (tighter.length > MAX_TODO_TEXT_LENGTH) {
      text = tighter.substring(0, MAX_TODO_TEXT_LENGTH) + '\n\n... (一部のタスクは文字数の都合で省略されました)';
      warnings.push('TODO入力が非常に長かったため、先頭部分のみをAIに渡しました。');
    } else {
      text = tighter;
    }
  }

  return { text, warnings, sourceContext };
}

/**
 * Slackで自分宛に届いた未返信依頼を取得します。
 * @param {string} token Slackユーザートークン
 * @param {string} myUserId 自分のSlackユーザーID
 * @param {Date} referenceDate 参照日
 * @param {number} lookbackDays さかのぼる日数
 * @param {number} maxItems 返却件数
 * @returns {string[]}
 */
function fetchPendingSlackRequests(token, myUserId, referenceDate, lookbackDays = 5, maxItems = 15) {
  if (!token || !myUserId) return [];

  const anchorDate = referenceDate ? new Date(referenceDate) : new Date();
  const oldest = new Date(anchorDate.getTime());
  oldest.setDate(oldest.getDate() - lookbackDays);
  oldest.setHours(0, 0, 0, 0);
  const oldestLabel = Utilities.formatDate(oldest, 'JST', 'yyyy-MM-dd');
  const mentionSyntax = `<@${myUserId}>`;
  const query = `${mentionSyntax} after:${oldestLabel}`;
  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${Math.max(maxItems * 3, 30)}&sort=timestamp&sort_dir=desc&highlight=false`;

  try {
    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true,
      timeout: DEFAULT_FETCH_TIMEOUT_MS
    });
    if (response.getResponseCode() !== 200) {
      console.warn(`Slack mention search HTTP error: ${response.getResponseCode()}`);
      return [];
    }
    const json = JSON.parse(response.getContentText());
    if (!json.ok) {
      console.warn(`Slack mention search error: ${json.error || response.getResponseCode()}`);
      return [];
    }
    const matches = (json.messages && json.messages.matches) || [];
    const oldestMs = oldest.getTime();
    const pending = [];
    const seen = {};
    const candidates = [];
    const ruleStateMap = getTodoReminderStateMap_();

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!match || !match.user || match.user === myUserId) continue;
      if (match.permalink && ruleStateMap[match.permalink]) continue;
      const messageTs = parseFloat(match.ts);
      if (isNaN(messageTs) || (messageTs * 1000) < oldestMs) continue;

      let handled = false;
      try {
        handled = hasUserAcknowledgedSlackMessage(
          token,
          match.channel && match.channel.id,
          match.ts,
          match.thread_ts,
          myUserId,
          match.user
        );
      } catch (ackErr) {
        console.warn('Slack mention ack check error:', ackErr.message);
      }

      if (!handled) {
        candidates.push(match);
      }
      if (candidates.length >= Math.max(maxItems * 3, 24)) break;
    }

    const aiAccepted = classifySlackRequestCandidatesWithAi_(candidates, Math.max(maxItems * 2, 20));
    for (let i = 0; i < candidates.length; i++) {
      const match = candidates[i];
      const candidateId = buildSlackCandidateId_(match);
      const byAi = aiAccepted[candidateId] === true;
      const byRule = isLikelyRequestText_(match && match.text);
      if (!byAi && !byRule) continue;
      const line = formatSlackRequestLine(match);
      const key = normalizeTodoTaskLine_(line);
      if (!key || seen[key]) continue;
      seen[key] = true;
      pending.push(line);
      if (pending.length >= maxItems) break;
    }
    return pending;
  } catch (e) {
    console.warn('fetchPendingSlackRequests error:', e);
    return [];
  }
}

function buildSlackCandidateId_(match) {
  const channelId = ((match && match.channel && match.channel.id) || 'DM').toString();
  const ts = String((match && match.ts) || '');
  return `${channelId}:${ts}`;
}

function isLikelyRequestText_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/@[a-z0-9_.-]+/i.test(t)) return true;
  const pattern = /(お願いします|お願いできますか|ご確認|確認お願いします|確認ください|ご対応|対応お願いします|対応可能|依頼|至急|レビュー|見てください|ご教示|教えて|対応可否|お願いしたい|\?|\？)/i;
  return pattern.test(t);
}

function classifySlackRequestCandidatesWithAi_(candidates, maxCandidates) {
  const accepted = {};
  const list = Array.isArray(candidates) ? candidates.slice(0, Math.max(1, maxCandidates || 20)) : [];
  if (list.length === 0) return accepted;

  const rows = list.map(function(match, idx) {
    const id = buildSlackCandidateId_(match);
    const author = (match && (match.username || match.user)) ? String(match.username || match.user) : 'unknown';
    const text = String((match && match.text) || '').replace(/\s+/g, ' ').trim();
    return `${idx + 1}. id=${id} author=${author} text=${text}`;
  }).join('\n');

  const prompt = [
    'あなたはSlack依頼判定アシスタントです。',
    '以下の候補メッセージから、「相手が対応・確認・返答を求めている依頼」に該当するidのみを選んでください。',
    '雑談、報告、独り言、完了報告は除外してください。',
    '出力はJSONのみ。形式: {"accepted":["id1","id2"]}',
    '',
    rows
  ].join('\n');

  try {
    const modelId = resolveGeminiModelId_();
    const apiUrl = buildVertexGenerateContentUrl_(modelId);
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: 'あなたは判定器です。JSONのみを返します。' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    });
    const raw = callVertexAI(apiUrl, payload);
    const cleaned = String(raw || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const ids = Array.isArray(parsed && parsed.accepted) ? parsed.accepted : [];
    ids.forEach(function(id) { accepted[String(id || '')] = true; });
  } catch (e) {
    console.warn('classifySlackRequestCandidatesWithAi error:', e.message);
  }
  return accepted;
}

function normalizeTodoRuleList_(raw) {
  let list = [];
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) list = parsed;
  } catch (e) {}
  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item === 'string') {
      const url = item.trim();
      if (url) normalized.push({ url: url, label: '', updatedAt: '', type: 'muted' });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (!url) continue;
    normalized.push({
      url: url,
      label: String(item.label || ''),
      updatedAt: String(item.updatedAt || ''),
      type: String(item.type || 'muted')
    });
  }
  return normalized;
}

function getTodoReminderStateMap_() {
  const userProps = PropertiesService.getUserProperties();
  const muted = normalizeTodoRuleList_(userProps.getProperty('TODO_MUTE_SLACK_PERMALINKS') || '[]');
  const checked = normalizeTodoRuleList_(userProps.getProperty('TODO_CHECKED_SLACK_PERMALINKS') || '[]');
  const map = {};
  muted.forEach(function(item) { map[item.url] = 'muted'; });
  checked.forEach(function(item) { map[item.url] = 'checked'; });
  return map;
}

function setTodoReminderState(permalink, label, state) {
  const url = String(permalink || '').trim();
  const next = String(state || '').trim(); // muted|checked|none
  if (!url) return { success: false, message: '対象URLが空です。' };

  const userProps = PropertiesService.getUserProperties();
  const now = Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm:ss');
  let muted = normalizeTodoRuleList_(userProps.getProperty('TODO_MUTE_SLACK_PERMALINKS') || '[]');
  let checked = normalizeTodoRuleList_(userProps.getProperty('TODO_CHECKED_SLACK_PERMALINKS') || '[]');
  muted = muted.filter(function(item) { return item.url !== url; });
  checked = checked.filter(function(item) { return item.url !== url; });

  if (next === 'muted') {
    muted.push({ url: url, label: String(label || ''), updatedAt: now, type: 'muted' });
  } else if (next === 'checked') {
    checked.push({ url: url, label: String(label || ''), updatedAt: now, type: 'checked' });
  }

  userProps.setProperties({
    TODO_MUTE_SLACK_PERMALINKS: JSON.stringify(muted),
    TODO_CHECKED_SLACK_PERMALINKS: JSON.stringify(checked)
  }, false);
  return { success: true, state: next || 'none' };
}

function listTodoReminderRules() {
  const userProps = PropertiesService.getUserProperties();
  const muted = normalizeTodoRuleList_(userProps.getProperty('TODO_MUTE_SLACK_PERMALINKS') || '[]');
  const checked = normalizeTodoRuleList_(userProps.getProperty('TODO_CHECKED_SLACK_PERMALINKS') || '[]');
  return {
    muted: muted,
    checked: checked
  };
}

/**
 * 指定メッセージに対して自分が返信済みかどうかを判定します。
 */
function hasUserAcknowledgedSlackMessage(token, channelId, originalTs, threadTs, myUserId, requesterUserId) {
  if (!channelId || !token || !myUserId) return false;
  const parentTs = threadTs || originalTs;

  // 1. スレッド内の返信を確認
  try {
    const replyUrl = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${parentTs}&limit=40`;
    const res = UrlFetchApp.fetch(replyUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true,
      timeout: DEFAULT_FETCH_TIMEOUT_MS
    });
    if (res.getResponseCode() !== 200) {
      console.warn(`Slack conversations.replies HTTP error: ${res.getResponseCode()}`);
      return false;
    }
    const json = JSON.parse(res.getContentText());
    if (json.ok) {
      const replies = json.messages || [];
      for (let i = 0; i < replies.length; i++) {
        const msg = replies[i];
        if (!msg) continue;
        if (msg.user === myUserId && parseFloat(msg.ts) > parseFloat(originalTs)) {
          return true;
        }
        if (hasReactionFromUser_(msg, myUserId) && parseFloat(msg.ts || '0') >= parseFloat(originalTs || '0')) {
          return true;
        }
      }
      if (isResolvedThreadByText_(replies, requesterUserId, originalTs)) {
        return true;
      }
      // スレッドが存在する場合はここで判定終了
      if (replies.length > 1) {
        return false;
      }
    } else if (json.error !== 'thread_not_found' && json.error !== 'missing_scope') {
      console.warn(`Slack replies error (${channelId}): ${json.error}`);
    }
  } catch (e) {
    console.warn('conversations.replies error:', e.message);
  }

  // 2. チャンネル履歴から自分の最新投稿を確認
  return hasUserPostedAfter(token, channelId, originalTs, myUserId);
}

/**
 * チャンネル履歴内に自分の投稿が存在するか確認します。
 */
function hasUserPostedAfter(token, channelId, baseTs, myUserId) {
  if (!channelId) return false;
  try {
    const historyUrl = `https://slack.com/api/conversations.history?channel=${channelId}&oldest=${baseTs}&limit=60`;
    const res = UrlFetchApp.fetch(historyUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
      muteHttpExceptions: true,
      timeout: DEFAULT_FETCH_TIMEOUT_MS
    });
    if (res.getResponseCode() !== 200) {
      console.warn(`Slack conversations.history HTTP error: ${res.getResponseCode()}`);
      return false;
    }
    const json = JSON.parse(res.getContentText());
    if (!json.ok) {
      if (json.error !== 'missing_scope' && json.error !== 'not_in_channel') {
        console.warn(`Slack history error (${channelId}): ${json.error}`);
      }
      return false;
    }
    const messages = json.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.user === myUserId && parseFloat(msg.ts) > parseFloat(baseTs)) {
        return true;
      }
      if (hasReactionFromUser_(msg, myUserId) && parseFloat(msg.ts || '0') >= parseFloat(baseTs || '0')) {
        return true;
      }
    }
  } catch (e) {
    console.warn('conversations.history error:', e.message);
  }
  return false;
}

function hasReactionFromUser_(msg, userId) {
  if (!msg || !userId) return false;
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  for (let i = 0; i < reactions.length; i++) {
    const users = Array.isArray(reactions[i].users) ? reactions[i].users : [];
    if (users.indexOf(userId) !== -1) return true;
  }
  return false;
}

/**
 * スレッド本文から「解決済み」らしき文言を検知します。
 * 依頼者・対応者を問わず、完了系のキーワードがあれば除外対象とします。
 */
function isResolvedThreadByText_(replies, requesterUserId, originalTs) {
  if (!replies || replies.length === 0) return false;
  const donePattern = /(対応済|対応しました|解決|解消|クローズ|完了|ありがとうございました|助かりました|done|resolved|fixed|close[sd]?)/i;
  for (let i = 0; i < replies.length; i++) {
    const msg = replies[i];
    if (!msg || !msg.text) continue;
    const ts = parseFloat(msg.ts || '0');
    if (ts <= parseFloat(originalTs || '0')) continue;
    if (donePattern.test(msg.text)) {
      return true;
    }
    // 依頼者が返信している場合は、軽量ヒューリスティックとして解決済み扱いに寄せる
    if (requesterUserId && msg.user === requesterUserId) {
      return true;
    }
  }
  return false;
}

/**
 * Slack未返信依頼の表示用テキストを生成します。
 */
function formatSlackRequestLine(match) {
  const ts = new Date(parseFloat(match.ts) * 1000);
  const channelName = match.channel && match.channel.name
    ? `#${match.channel.name}`
    : (match.channel && match.channel.id ? match.channel.id : 'DM');
  const author = match.username || (match.user ? `<@${match.user}>` : 'someone');
  const cleanText = (match.text || '').replace(/\s+/g, ' ').trim();
  const normalized = decodeSlackMarkup(cleanText);
  const timeLabel = Utilities.formatDate(ts, 'JST', 'MM/dd HH:mm');
  const permalink = match.permalink ? ` ${match.permalink}` : '';
  return {
    text: `[Slack未返信] ${timeLabel} ${channelName} ${author}: ${normalized.length > 80 ? normalized.substring(0, 77) + '…' : normalized}`,
    permalink: match.permalink || ''
  };
}

/**
 * Slackのリンク/メンション表記を人が読みやすい形に変換します。
 */
function decodeSlackMarkup(text) {
  if (!text) return '';
  return text
    .replace(/<@([A-Z0-9]+)\|([^>]+)>/g, '@$2')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * 今日のTODOリストを生成して返します。
 */
const TODO_EXPERIMENT_NOTE = '';

function sendTodaysTodoNotification(overrides) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    return { success: false, message: 'Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。' };
  }

  const today = new Date();
  const tasksResult = collectTodaysTasks(props, today);
  const taskText = tasksResult.text;
  const warnings = tasksResult.warnings || [];
  const sourceContext = tasksResult.sourceContext || { byId: {} };

  if (!taskText || taskText.trim().length < 10) {
    let emptyMessage = '⚠️ 未対応の依頼・課題が見つかりませんでした。';
    if (warnings.length > 0) {
      emptyMessage += '\n\n⚠️ 取得できなかったデータ\n' + warnings.map(w => `・${w}`).join('\n');
    }
    return { success: true, message: emptyMessage, warnings: warnings };
  }

  const department = props.SELECTED_DEPARTMENT || 'CS';
  let todoResult;
  try {
    todoResult = generateTodaysTodoWithGemini(taskText, today);
  } catch (e) {
    const errorMessage = String((e && e.message) || e || '');
    let message = '⚠️ 今日のTODO生成に失敗しました。';
    if (errorMessage.indexOf('MAX_TOKENS') !== -1 || errorMessage.indexOf('応答が空でした') !== -1) {
      message += '\nAIの出力が長さ制限に達した可能性があります。ログ量を絞るか、時間をおいて再実行してください。';
    } else {
      message += `\n${errorMessage}`;
    }
    if (warnings.length > 0) {
      message += '\n\n⚠️ 取得できなかったデータ\n' + warnings.map(w => `・${w}`).join('\n');
    }
    return { success: false, message: message, warnings: warnings };
  }
  let todoMessage = todoResult.text || '';
  if (todoResult.truncatedInput) {
    warnings.push('今日のTODOではログが多かったため、先頭部分のみをAIに渡しています。');
  }
  if (todoMessage.indexOf('⚠️ 【注意】AIの出力が長さ制限') !== -1) {
    warnings.push('AIのTODO出力が長さ制限で途中終了しました。必要に応じてログを絞るか、時間を置いて再実行してください。');
  }
  todoMessage = cleanGeneratedTodoMessage_(todoMessage);
  todoMessage = normalizeTodoBullets(todoMessage);
  todoMessage = dedupeTodoSections_(todoMessage);
  if (!isValidTodoMessage_(todoMessage)) {
    warnings.push('AIのTODO出力が不完全だったため、ログから定型TODOを自動生成しました。');
    todoMessage = buildFallbackTodoFromTaskText_(taskText, today, props.REPORT_DAY_FORMAT);
  }

  let finalMessage = TODO_EXPERIMENT_NOTE ? `${TODO_EXPERIMENT_NOTE}\n\n${todoMessage}` : todoMessage;
  if (warnings.length > 0) {
    finalMessage += `\n\n⚠️ 取得できなかったデータ\n${warnings.map(w => `・${w}`).join('\n')}`;
  }
  finalMessage = enrichTodoMessageWithLinks_(finalMessage, taskText, sourceContext);

  const runtimeOverrides = overrides || {};
  if (runtimeOverrides.deliverToSlack === true) {
    const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
    if (!dest) {
      return { success: false, message: '送信先(チャンネルIDまたはメンバーID)が設定されていません。', warnings: warnings };
    }
    const todoSlackStyle = runtimeOverrides.todoSlackStyle || props.TODO_SLACK_STYLE || 'direct';
    const todoFixedThreadUrl = runtimeOverrides.todoFixedThreadUrl || props.TODO_FIXED_THREAD_URL || '';
    const todoParentTitle = `【今日のTODO】${getFormattedDateString(today, props.REPORT_DAY_FORMAT)}`;
    const sendMessage = stripTodoControlMarkers_(finalMessage);
    sendToSlack(sendMessage, props.SLACK_USER_TOKEN, dest, todoSlackStyle, today, todoFixedThreadUrl, props.REPORT_DAY_FORMAT, todoParentTitle);
  }

  return { success: true, message: finalMessage, warnings: warnings };
}

function enrichTodoMessageWithLinks_(todoMessage, taskText, sourceContext) {
  const messageLines = String(todoMessage || '').split('\n');
  const contextMap = (sourceContext && sourceContext.byId) ? sourceContext.byId : {};
  const backlogByKey = (sourceContext && sourceContext.backlogByKey) ? sourceContext.backlogByKey : {};
  const backlogPool = [];
  const slackPool = [];
  Object.keys(contextMap).forEach(function(id) {
    const meta = contextMap[id] || {};
    const item = {
      id: id,
      label: String(meta.label || ''),
      url: String(meta.url || ''),
      used: false
    };
    if (meta.type === 'backlog') backlogPool.push(item);
    if (meta.type === 'slack') slackPool.push(item);
  });

  function norm_(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶー一-龠]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function score_(a, b) {
    const aa = norm_(a).split(' ').filter(Boolean);
    const bb = {};
    norm_(b).split(' ').filter(Boolean).forEach(function(t) { bb[t] = true; });
    let c = 0;
    for (let i = 0; i < aa.length; i++) if (bb[aa[i]]) c++;
    return c;
  }
  function pickFromPool_(lineBody, pool, minScore) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.used || !p.url) continue;
      const s = score_(lineBody, p.label);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best && bestScore >= minScore) {
      best.used = true;
      return best;
    }
    return null;
  }

  function extractBacklogKey_(line) {
    const keyMatch = String(line || '').match(/([A-Z][A-Z0-9_]*-[0-9]+)/);
    return keyMatch ? keyMatch[1] : '';
  }

  function formatDisplayTextWithMeta_(body, meta) {
    const cleanBody = String(body || '').trim();
    if (!meta || !meta.type) return cleanBody;
    if (meta.type === 'slack') {
      return cleanBody.replace(/^Slack:\s*/i, '').trim();
    }
    if (meta.type === 'backlog') {
      const label = String(meta.label || '');
      const keyMatch = label.match(/\[Backlog\]\s+([A-Z0-9_-]+):/);
      const dueMatch = label.match(/\(期限:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\)/);
      const key = keyMatch ? keyMatch[1] : '';
      const due = dueMatch ? dueMatch[1] : '';
      const taskBody = cleanBody
        .replace(/^Backlog\s+[A-Z0-9_-]+\s*(?:\(期限:[^)]+\))?\s*:\s*/, '')
        .replace(/^[A-Z][A-Z0-9_]*-[0-9]+\s*:\s*/, '')
        .trim();
      const fallbackKey = extractBacklogKey_(cleanBody);
      const resolvedKey = key || fallbackKey;
      const line1 = resolvedKey ? `${resolvedKey} : ${taskBody || cleanBody}` : (taskBody || cleanBody);
      return due ? `${line1}\n  （期限: ${due}）` : line1;
    }
    return cleanBody;
  }

  let currentSection = '';
  for (let i = 0; i < messageLines.length; i++) {
    const line = messageLines[i];
    if (line.indexOf('🟥 最優先') !== -1) currentSection = 'top';
    else if (line.indexOf('📋 その他のタスク') !== -1) currentSection = 'other';
    else if (line.indexOf('💬 Slack未返信') !== -1) currentSection = 'slack';

    const srcMatch = line.match(/<!--SRC:([A-Z0-9_:-]+)-->/);
    if (!srcMatch) continue;
    const sourceId = srcMatch[1];
    const meta = contextMap[sourceId];
    const body = line
      .replace(/<!--SRC:[A-Z0-9_:-]+-->/g, '')
      .replace(/^\s*-\s*/, '')
      .trim();
    if (meta && meta.url) {
      const displayBody = formatDisplayTextWithMeta_(body, meta);
      let enriched = `- [${displayBody}](${meta.url})`;
      if (sourceId.indexOf('SLK_') === 0) {
        const encodedLabel = encodeURIComponent(displayBody);
        enriched += ` <!--REM:${meta.url}|${encodedLabel}-->`;
      }
      messageLines[i] = enriched;
    } else {
      const backlogKey = extractBacklogKey_(body);
      if (backlogKey && backlogByKey[backlogKey] && backlogByKey[backlogKey].url) {
        const displayBody = formatDisplayTextWithMeta_(body, { type: 'backlog', label: backlogByKey[backlogKey].label || '' });
        messageLines[i] = `- [${displayBody}](${backlogByKey[backlogKey].url})`;
      } else {
        messageLines[i] = `- ${body}`;
      }
    }
  }

  // source_idが欠けた行を、同一セクション内で補完してリンク化
  currentSection = '';
  for (let i = 0; i < messageLines.length; i++) {
    let line = messageLines[i];
    if (line.indexOf('🟥 最優先') !== -1) currentSection = 'top';
    else if (line.indexOf('📋 その他のタスク') !== -1) currentSection = 'other';
    else if (line.indexOf('💬 Slack未返信') !== -1) currentSection = 'slack';
    if (!/^\s*-\s+/.test(line)) continue;
    if (/\[[^\]]+\]\(https?:\/\//.test(line)) continue;
    if (/<!--SRC:/.test(line)) continue;
    const body = line.replace(/^\s*-\s*/, '').trim();
    if (!body || body === 'なし') continue;
    const backlogKey = extractBacklogKey_(body);
    if (backlogKey && backlogByKey[backlogKey] && backlogByKey[backlogKey].url) {
      const displayBody = formatDisplayTextWithMeta_(body, { type: 'backlog', label: backlogByKey[backlogKey].label || '' });
      messageLines[i] = `- [${displayBody}](${backlogByKey[backlogKey].url})`;
      continue;
    }

    if (currentSection === 'top' || currentSection === 'other') {
      const hit = pickFromPool_(body, backlogPool, 2);
      if (hit) {
        const displayBody = formatDisplayTextWithMeta_(body, { type: 'backlog', label: hit.label });
        messageLines[i] = `- [${displayBody}](${hit.url})`;
        continue;
      }
    }
    if (currentSection === 'slack') {
      const hit = pickFromPool_(body, slackPool, 1);
      if (hit) {
        const displayBody = formatDisplayTextWithMeta_(body, { type: 'slack', label: hit.label });
        const encodedLabel = encodeURIComponent(displayBody);
        messageLines[i] = `- [${displayBody}](${hit.url}) <!--REM:${hit.url}|${encodedLabel}-->`;
      }
    }
  }
  return messageLines.join('\n');
}

function enrichTodoMessageWithLegacyHeuristic_(todoMessage, taskText) {
  const messageLines = String(todoMessage || '').split('\n');
  const sourceText = String(taskText || '');

  const backlogUrlByKey = {};
  const backlogRe = /\[Backlog\]\s+([A-Z0-9_-]+):[^\n]*?(https?:\/\/[^\s)>\]]+)/g;
  let m;
  while ((m = backlogRe.exec(sourceText)) !== null) {
    backlogUrlByKey[m[1]] = m[2];
  }

  const slackEntries = [];
  const slackRe = /\[Slack未返信\]\s*([^\n]*?)\s*(https?:\/\/[^\s)>\]]+)/g;
  const seenSlack = {};
  while ((m = slackRe.exec(sourceText)) !== null) {
    const summary = String(m[1] || '').trim();
    const url = m[2];
    if (!url || seenSlack[url]) continue;
    seenSlack[url] = true;
    slackEntries.push({ summary: summary, url: url, used: false });
  }

  function normalize_(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/[#@:：()\[\]<>。、「」・\/\\_\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toBigrams_(s) {
    const t = normalize_(s).replace(/\s+/g, '');
    const grams = [];
    for (let i = 0; i < t.length - 1; i++) {
      grams.push(t.substring(i, i + 2));
    }
    return grams;
  }

  function diceSimilarity_(a, b) {
    const aa = toBigrams_(a);
    const bb = toBigrams_(b);
    if (!aa.length || !bb.length) return 0;
    const bbCount = {};
    for (let i = 0; i < bb.length; i++) {
      bbCount[bb[i]] = (bbCount[bb[i]] || 0) + 1;
    }
    let overlap = 0;
    for (let i = 0; i < aa.length; i++) {
      const g = aa[i];
      if (bbCount[g] > 0) {
        overlap++;
        bbCount[g]--;
      }
    }
    return (2 * overlap) / (aa.length + bb.length);
  }

  function pickSlackUrlByLine_(lineBody) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < slackEntries.length; i++) {
      if (slackEntries[i].used) continue;
      const score = diceSimilarity_(lineBody, slackEntries[i].summary);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    // 誤リンク防止: 一致度が低い場合はリンクを付けない
    if (bestIdx >= 0 && bestScore >= 0.28) {
      slackEntries[bestIdx].used = true;
      return slackEntries[bestIdx].url;
    }
    return '';
  }

  let inSlackSection = false;
  for (let i = 0; i < messageLines.length; i++) {
    const line = messageLines[i];
    if (line.indexOf('💬 Slack未返信') !== -1) {
      inSlackSection = true;
      continue;
    }
    if (/^[🟥📅📋⚠️]/.test(line)) {
      inSlackSection = false;
    }
    if (!/^\s*-\s+/.test(line)) continue;
    if (/\[[^\]]+\]\(https?:\/\//.test(line)) continue;

    let linked = false;
    const keyMatch = line.match(/([A-Z0-9][A-Z0-9_-]*-[0-9]+)/);
    if (keyMatch && backlogUrlByKey[keyMatch[1]]) {
      const body = line.replace(/^\s*-\s*/, '').trim();
      messageLines[i] = `- [${body}](${backlogUrlByKey[keyMatch[1]]})`;
      linked = true;
    }

    if (!linked && inSlackSection) {
      const permalink = pickSlackUrlByLine_(line);
      if (!permalink) continue;
      const body = line.replace(/^\s*-\s*/, '').trim();
      const encodedLabel = encodeURIComponent(body);
      messageLines[i] = `- [${body}](${permalink}) <!--REM:${permalink}|${encodedLabel}-->`;
      linked = true;
    }

    // 「Slack: ...」行（最優先/その他）は誤リンクがUXを崩しやすいため、現状は非リンク化。
  }
  return messageLines.join('\n');
}

function normalizeTodoBullets(text) {
  if (!text) return '';
  return text.replace(/^\s*[●・■▪︎•]\s*/gm, '- ');
}

function cleanGeneratedTodoMessage_(text) {
  if (!text) return '';
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  let inScheduleSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(?:[-*●・■▪︎•◦]\s*)?===.+===\s*$/.test(trimmed)) continue;
    if (/^📅\s*本日の予定/.test(trimmed)) {
      inScheduleSection = true;
      continue;
    }
    if (/^[🟥💬📋⚠️]/.test(trimmed)) {
      inScheduleSection = false;
    }
    if (inScheduleSection) continue;
    cleaned.push(line);
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function dedupeTodoSections_(text) {
  const src = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!src) return src;
  const sectionHeaders = ['🟥 最優先', '💬 Slack未返信', '📋 その他のタスク'];
  const lines = src.split('\n');
  const preface = [];
  const sections = {};
  sectionHeaders.forEach(function(header) { sections[header] = []; });
  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const hit = sectionHeaders.find(function(header) { return trimmed.indexOf(header) === 0; });
    if (hit) {
      current = hit;
      continue;
    }
    if (!current) {
      preface.push(line);
      continue;
    }
    sections[current].push(line);
  }

  const seen = {};
  const out = [];
  if (preface.length > 0) {
    out.push(preface.join('\n').trim());
    out.push('');
  }

  sectionHeaders.forEach(function(header, idx) {
    const rawItems = sections[header] || [];
    const cleanedItems = [];
    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (!/^\s*[-*●・■▪︎•◦]\s+/.test(trimmed)) continue;
      let body = trimmed.replace(/^\s*[-*●・■▪︎•◦]\s+/, '');
      body = body.replace(/\s*<!--SRC:[^>]+-->/g, '').replace(/\s*<!--REM:[^>]+-->/g, '').trim();
      if (!body || body === 'なし') continue;
      if (/^===.+===\s*$/i.test(body)) continue;
      const key = normalizeTodoTaskLine_(body);
      if (!key || seen[key]) continue;
      seen[key] = true;
      cleanedItems.push(`- ${body}`);
      if (cleanedItems.length >= 5) break;
    }
    out.push(header);
    out.push(cleanedItems.length > 0 ? cleanedItems.join('\n') : '- なし');
    if (idx < sectionHeaders.length - 1) out.push('');
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isValidTodoMessage_(text) {
  if (!text || text.trim().length < 20) return false;
  const required = ['🟥 最優先', '📋 その他のタスク', '💬 Slack未返信'];
  for (let i = 0; i < required.length; i++) {
    if (text.indexOf(required[i]) === -1) return false;
  }
  return true;
}

function truncateTodoLine_(line, limit) {
  const safe = (line || '').replace(/\s+/g, ' ').trim();
  if (!safe) return '';
  return safe.length > limit ? `${safe.substring(0, limit - 3)}...` : safe;
}

function extractTaskLinesFromSection_(taskText, headerName, maxItems) {
  const pattern = new RegExp(`===\\s*${headerName}\\s*===\\n([\\s\\S]*?)(?:\\n===|$)`);
  const match = (taskText || '').match(pattern);
  if (!match || !match[1]) return [];
  const lines = match[1]
    .split('\n')
    .map(function(line) { return truncateTodoLine_(line, 60); })
    .filter(Boolean);
  const dedup = {};
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].toLowerCase();
    if (dedup[key]) continue;
    dedup[key] = true;
    results.push(lines[i]);
    if (results.length >= maxItems) break;
  }
  return results;
}

function toTodoBullets_(items) {
  if (!items || items.length === 0) return '- なし';
  return items.map(function(item) { return `- ${item}`; }).join('\n');
}

function buildFallbackTodoFromTaskText_(taskText, today, dayFormat) {
  const dateLabel = getFormattedDateString(today, dayFormat);
  const backlog = extractTaskLinesFromSection_(taskText, 'Backlog 未完了課題', 5);
  const slack = extractTaskLinesFromSection_(taskText, 'Slack未返信依頼', 5);
  const top = []
    .concat(backlog.slice(0, 2))
    .concat(slack.slice(0, 2))
    .slice(0, 5);
  const other = backlog.filter(function(item) { return top.indexOf(item) === -1; }).slice(0, 5);

  return [
    `【今日のTODO】${dateLabel}`,
    '',
    '🟥 最優先',
    toTodoBullets_(top),
    '',
    '💬 Slack未返信',
    toTodoBullets_(slack),
    '',
    '📋 その他のタスク',
    toTodoBullets_(other)
  ].join('\n');
}

function autoRunTodaysTodo() {
  try {
    sendTodaysTodoNotification({ deliverToSlack: true });
  } catch(e) {
    console.warn('autoRunTodaysTodo error:', e);
  }
}

/**
 * 画面に表示済みのTODO本文をSlackへ送信します。
 * TODO設定（送信先・投稿スタイル）を使用します。
 * @param {string} todoMessage
 * @returns {{success:boolean, message:string}}
 */
function sendTodoMessageToSlack(todoMessage) {
  const props = PropertiesService.getUserProperties().getProperties();
  if (!props.SLACK_USER_TOKEN) {
    return { success: false, message: 'Slack連携がされていません。「接続設定」タブからSlackとの連携を完了してください。' };
  }
  const text = String(todoMessage || '').trim();
  if (!text) {
    return { success: false, message: '送信するTODO本文が空です。' };
  }

  const today = new Date();
  const dest = props.SLACK_CHANNEL_ID || props.SLACK_MEMBER_ID;
  if (!dest) {
    return { success: false, message: '送信先(チャンネルIDまたはメンバーID)が設定されていません。' };
  }

  const todoSlackStyle = props.TODO_SLACK_STYLE || 'direct';
  const todoFixedThreadUrl = props.TODO_FIXED_THREAD_URL || '';
  const todoParentTitle = `【今日のTODO】${getFormattedDateString(today, props.REPORT_DAY_FORMAT)}`;
  const sendMessage = stripTodoControlMarkers_(text);
  sendToSlack(sendMessage, props.SLACK_USER_TOKEN, dest, todoSlackStyle, today, todoFixedThreadUrl, props.REPORT_DAY_FORMAT, todoParentTitle);

  return { success: true, message: 'Slackに送信しました。' };
}

function stripTodoControlMarkers_(text) {
  return String(text || '')
    .replace(/\s*<!--SRC:[A-Z0-9_:-]+-->/g, '')
    .replace(/\s*<!--REM:[^>]+-->/g, '');
}

// 期間指定の並列ログ収集
function collectPeriodLogsParallel(start, end, slackToken, props, department = 'CS') { // departmentを追加
  const dateList = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dateList.push(new Date(d));
  }
  const aliasRules = loadClientAliasRules(props.CLIENT_ALIAS_RULES || '');
  const hasAliasRules = normalizeClientAliasRules(aliasRules, false).length > 0;
  const resolveClient = createClientResolver(aliasRules);
  const fallbackClientName = (props.CLIENT_FALLBACK_NAME || '● その他').trim();
  const periodClientSet = new Set();
  const periodAliasStats = { total: 0, matched: 0, unmatched: 0, sources: {} };

  function markPeriodAliasStat(sourceType, matched) {
    const source = (sourceType || 'other').toLowerCase();
    if (!periodAliasStats.sources[source]) {
      periodAliasStats.sources[source] = { total: 0, matched: 0, unmatched: 0 };
    }
    periodAliasStats.total++;
    periodAliasStats.sources[source].total++;
    if (matched) {
      periodAliasStats.matched++;
      periodAliasStats.sources[source].matched++;
    } else {
      periodAliasStats.unmatched++;
      periodAliasStats.sources[source].unmatched++;
    }
  }

  function determinePeriodClient(meta) {
    if (!hasAliasRules) return null;
    const safeMeta = meta || {};
    const resolved = resolveClient(safeMeta);
    markPeriodAliasStat(safeMeta.sourceType, !!resolved);
    if (!resolved) return fallbackClientName;
    periodClientSet.add(resolved);
    return resolved;
  }

  // 除外設定
  const calIgnore = (props.CALENDAR_IGNORE_WORDS || "").split(",").map(w => w.trim()).filter(w => w);
  const slackIgnore = (props.SLACK_IGNORE_CHANNELS || "").split(",").map(c => c.trim()).filter(c => c);
  const ignoreUserNames = resolveSlackUserNames(slackToken, slackIgnore.filter(id => id.startsWith('U') || id.startsWith('W')));

  let requests = [];
  let slackIndices = [];
  // let backlogIndices = []; // 現時点では未使用

  dateList.forEach((d, i) => {
    const ds = Utilities.formatDate(d, JST_TIMEZONE, 'yyyy-MM-dd');
    let q = `from:me on:${ds}`;
    if (props.REPORT_SLACK_SCOPE === 'public') q += ` is:public`;

    requests.push({
      url: `https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=50`,
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + slackToken },
      muteHttpExceptions: true,
      timeout: DEFAULT_FETCH_TIMEOUT_MS
    });
    slackIndices.push({ date: d, reqIndex: requests.length - 1 });
  });

  // --- 改善案: リクエストをチャンクに分割して実行 ---
  let responses = [];
  if (requests.length > 0) {
    const CHUNK_SIZE = 10; // 10件ずつに分割
    for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
      const chunk = requests.slice(i, i + CHUNK_SIZE);
      try {
        const chunkResponses = UrlFetchApp.fetchAll(chunk);
        responses = responses.concat(chunkResponses);
      } catch (e) {
        // チャンクの実行に失敗した場合でも、エラーを投げて処理を中断させる
        console.error(`UrlFetchApp.fetchAll failed for chunk starting at index ${i}: ${e.message}`);
        throw new Error(`ログ収集時の通信エラーが多発しました。期間を短くして再試行してください。\n詳細: ${e.message}`);
      }
      // クォータを避けるために少し待機する
      if (requests.length > CHUNK_SIZE) {
        Utilities.sleep(500); // 0.5秒待機
      }
    }
  }

  let allLogs = "";

  dateList.forEach(d => {
    const dateLabel = Utilities.formatDate(d, JST_TIMEZONE, 'MM/dd(E)');
    let dayLogs = [];

    // Calendar
    try {
      const events = fetchGoogleCalendarEvents(d, calIgnore);
      events.forEach(eventData => { // eventData is {log: string, event: CalendarEvent}
        let calLine = eventData.log.replace('[予定] ', '[Cal] ');
        if (hasAliasRules) {
          const clientName = determinePeriodClient({
            sourceType: 'calendar',
            title: eventData.event ? eventData.event.getTitle() : eventData.log,
            text: calLine
          });
          if (clientName) calLine = prefixWithClientLabel(calLine, clientName);
        }
        dayLogs.push(calLine);
      });
    } catch (e) {
      console.warn(`Calendar log fetch failed for ${Utilities.formatDate(d, 'JST', 'yyyy/MM/dd')}: ${e.message}`);
    }

    // Slack
    const slIdx = slackIndices.find(item => item.date.getTime() === d.getTime());
    if (slIdx) {
      const resp = responses[slIdx.reqIndex];
      if (resp.getResponseCode() === 200) {
        try {
          const json = JSON.parse(resp.getContentText());
          if (json.ok && json.messages && json.messages.matches) {
            const dayRange = getJstDayRange(d);
            json.messages.matches.forEach(m => {
              if (shouldIgnoreSlackChannel(m.channel, slackIgnore, ignoreUserNames)) return;
              const messageSec = parseFloat(m.ts);
              if (isNaN(messageSec)) return;
              const messageMs = messageSec * 1000;
              if (messageMs < dayRange.start.getTime() || messageMs >= dayRange.endExclusive.getTime()) return;
              let slackLine = `[Slack] #${m.channel.name}: ${m.text.replace(/\n/g, ' ').substring(0, 50)}...`;
              if (hasAliasRules) {
                const clientName = determinePeriodClient({
                  sourceType: 'slack',
                  channelId: m.channel && m.channel.id,
                  channelName: m.channel && m.channel.name,
                  text: m.text
                });
                if (clientName) slackLine = prefixWithClientLabel(slackLine, clientName);
              }
              dayLogs.push(slackLine);
            });
          }
        } catch(e){
          console.warn(`Slack log parsing failed for date ${d.toISOString()}: ${e.message}`);
        }
      }
    }

    // Backlog
    // バックログはページネーション対応済みのfetchBacklogActivitiesWithPaginationで期間取得
    // ここでは個別日の取得はしない

    // Salesforce連携（期間集計対応）
    if (props.SF_ACCESS_TOKEN) {
      try {
        // TeamSpirit打刻情報
        const teamSpiritData = fetchTeamSpiritWorkTime(d);
        if (teamSpiritData && teamSpiritData.realHours) {
          let logLine = `[勤怠] 実労働時間: ${teamSpiritData.realHours}時間`;
          if (hasAliasRules) {
            const clientName = determinePeriodClient({ sourceType: 'salesforce', title: '勤怠', text: logLine });
            if (clientName) logLine = prefixWithClientLabel(logLine, clientName);
          }
          dayLogs.push(logLine);
        }
        
        // 商談履歴（ES部のみ）
        if (department === 'ES') {
          const opportunities = fetchOpportunities(d);
          opportunities.forEach(opp => {
            let logLine = `[商談] ${opp.accountName}: ${opp.name} (${opp.stage})`;
            if (hasAliasRules) {
              const clientName = determinePeriodClient({ sourceType: 'salesforce', title: opp.accountName || opp.name, text: logLine });
              if (clientName) logLine = prefixWithClientLabel(logLine, clientName);
            }
            dayLogs.push(logLine);
          });
          const tasks = fetchOpportunityTasks(d);
          tasks.forEach(task => {
            const oppName = task.opportunityName ? ` - ${task.opportunityName}` : '';
            let logLine = `[活動] ${task.subject} (${task.status})${oppName}`;
            if (hasAliasRules) {
              const clientName = determinePeriodClient({ sourceType: 'salesforce', title: task.opportunityName || task.subject, text: logLine });
              if (clientName) logLine = prefixWithClientLabel(logLine, clientName);
            }
            dayLogs.push(logLine);
          });
        }
      } catch (e) {
        console.warn(`Salesforce log fetch error for ${d.toISOString()}: ${e.message}`);
      }
    }
    
    if (dayLogs.length > 0) {
      allLogs += `\n=== ${dateLabel} ===\n` + dayLogs.join('\n') + "\n";
    }
  });

  // --- Backlogログ収集 (ページネーション対応) ---
  const periodBacklogState = loadBacklogConfigs(props.BACKLOG_CONFIGS);
  let blLogs = [];
  if (periodBacklogState.configs.length > 0) {
    blLogs = fetchBacklogActivitiesWithPagination(periodBacklogState.configs, start, end);
  }
  if (blLogs.length > 0) {
    if (hasAliasRules) {
      blLogs = blLogs.map(function(line) {
        const keyMatch = line.match(/\[Backlog\]\s+([A-Za-z0-9_-]+)/);
        const projectKey = keyMatch ? keyMatch[1] : '';
        const clientName = determinePeriodClient({
          sourceType: 'backlog',
          projectKey: projectKey,
          title: line,
          text: line
        });
        return clientName ? prefixWithClientLabel(line, clientName) : line;
      });
    }
    allLogs += `\n=== Backlog Activities ===\n` + blLogs.join('\n');
  }
  
  // ★追加: 最終的な文字列長を制限する
  if (allLogs.length > 100000) {
    allLogs = allLogs.substring(0, 100000) + "\n\n... (文字数制限により以降のログは省略されました)";
  }

  const periodWarnings = [];
  if (hasAliasRules && periodAliasStats.total > 0 && periodAliasStats.unmatched > 0) {
    const ratio = Math.round((periodAliasStats.unmatched / periodAliasStats.total) * 100);
    periodWarnings.push(
      `期間集計の名寄せで未分類が ${periodAliasStats.unmatched}/${periodAliasStats.total} 件（${ratio}%）あります。` +
      ` ルール（チャネルID/Backlogキー/キーワード）の補強を検討してください。`
    );
  }

  return {
    text: allLogs,
    clients: hasAliasRules ? Array.from(periodClientSet) : [],
    warnings: periodWarnings
  };
}

/**
 * 複数のBacklog設定に対して、ページネーションを考慮してアクティビティを取得します。
 * @param {Array<Object>} configs Backlog設定の配列
 * @param {Date} startDate 取得開始日
 * @param {Date} endDate 取得終了日
 * @returns {Array<string>} ログ文字列の配列
 */
function fetchBacklogActivitiesWithPagination(configs, startDate, endDate) {
  let allActivityLogs = [];
  const COUNT = 100; // 1リクエストあたりの取得件数

  configs.forEach(config => {
    if (!config.host || !config.key) return;

    const host = config.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let maxId = null;
    let keepFetching = true;

    while (keepFetching) {
      try {
        let url = `https://${host}/api/v2/users/myself/activities?apiKey=${config.key}&count=${COUNT}`;
        if (maxId) {
          url += `&maxId=${maxId}`;
        }

        const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
        if (response.getResponseCode() !== 200) break;

        const activities = JSON.parse(response.getContentText());
        if (activities.length === 0) {
          keepFetching = false;
          continue;
        }

        activities.forEach(act => {
          const activityDate = new Date(act.created);
          if (activityDate >= startDate && activityDate <= endDate) {
            const dateStr = Utilities.formatDate(activityDate, 'JST', 'MM/dd');
            const summary = act.content.summary || (act.content.comment ? `コメント: ${act.content.comment.content.substring(0, 20)}...` : '更新');
            allActivityLogs.push(`${dateStr} [Backlog] ${act.project.projectKey} ${summary}`);
          }
        });

        maxId = activities[activities.length - 1].id;
        keepFetching = (activities.length === COUNT); // 取得件数が上限に達していれば、まだ続きがある可能性がある
      } catch (e) {
        console.warn(`Backlog pagination fetch failed for host ${host}: ${e.message}`);
        keepFetching = false;
      }
    }
  });
  return allActivityLogs;
}

// ------------------------------------------
// サービス別ヘルパー関数群
// ------------------------------------------

/**
 * Slackの除外判定ロジック
 */
function shouldIgnoreSlackChannel(channelObj, ignoreIds, ignoreUserNames) {
  // 1. チャンネルIDが直接指定されている場合 (C..., D...)
  if (ignoreIds.includes(channelObj.id)) return true;

  // 2. DM(D...) の場合、チャンネル名が除外対象ユーザー名と一致するか確認
  // (Search APIでは、DMの channel.name は相手のユーザー名(または自分)になる)
  if (channelObj.id.startsWith('D')) {
    if (ignoreUserNames.includes(channelObj.name)) return true;
  }

  return false;
}

/**
 * 指定されたユーザーIDリストから名前を取得する (DM判定用)。戻り値の順序は userIds と一致する。
 */
function resolveSlackUserNames(token, userIds) {
  if (!userIds || userIds.length === 0) return [];

  const cache = CacheService.getUserCache();
  const cacheKeys = userIds.map(id => `slack_name_${id}`);
  const cachedNames = cache.getAll(cacheKeys);

  const nameByUid = {};
  const missingIds = [];

  userIds.forEach(uid => {
    const cacheKey = `slack_name_${uid}`;
    if (cachedNames[cacheKey]) {
      nameByUid[uid] = cachedNames[cacheKey];
    } else {
      missingIds.push(uid);
    }
  });

  const newNamesToCache = {};
  missingIds.forEach(uid => {
    try {
      const response = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${uid}`, {
        headers: { 'Authorization': 'Bearer ' + token },
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (response.getResponseCode() !== 200) {
        throw new Error(`HTTP ${response.getResponseCode()}`);
      }
      const res = JSON.parse(response.getContentText());
      if (res.ok) {
        const name = res.user.name;
        nameByUid[uid] = name;
        newNamesToCache[`slack_name_${uid}`] = name;
      }
    } catch (e) {
      console.warn(`users.info failed for ${uid}: ${e.message}`);
    }
  });

  if (Object.keys(newNamesToCache).length > 0) {
    cache.putAll(newNamesToCache, 21600); // 6時間キャッシュ
  }

  return userIds.map(uid => nameByUid[uid]).filter(Boolean);
}

/**
 * 指定された日の自分のSlack投稿を取得します。
 * @param {string} token Slackユーザートークン
 * @param {Date} date 取得対象日
 * @param {string} scope 'public' または 'private'
 * @param {Array<string>} ignoreIds 除外するチャンネル/ユーザーIDの配列
 * @returns {Array<string>} ログ文字列の配列
 */
function fetchMySlackPosts(token, date, scope, ignoreIds = []) {
  const dayRange = getJstDayRange(date);
  const dateString = Utilities.formatDate(dayRange.start, JST_TIMEZONE, 'yyyy-MM-dd');
  let q = `from:me on:${dateString}`;
  if (scope === 'public') q += ` is:public`;

  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(q)}&count=100`;
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
    timeout: DEFAULT_FETCH_TIMEOUT_MS
  });
  if (response.getResponseCode() !== 200) {
    console.warn(`Slack search.messages HTTP error: ${response.getResponseCode()}`);
    return [];
  }
  const res = JSON.parse(response.getContentText());

  if (!res.ok) {
    if (res.error === 'invalid_auth') {
      throw new Error("AUTH_ERROR:Slack連携の再認証が必要です。");
    }
    console.warn(`Slack API error in fetchMySlackPosts: ${res.error}`);
    return [];
  }

  if (!res.messages || !res.messages.matches) return [];
  const ignoreUserNames = resolveSlackUserNames(token, ignoreIds.filter(id => id.startsWith('U') || id.startsWith('W')));

  const normalizedMessages = res.messages.matches
    .filter(m => {
      const sec = parseFloat(m.ts);
      if (isNaN(sec)) return false;
      const ms = sec * 1000;
      return ms >= dayRange.start.getTime() && ms < dayRange.endExclusive.getTime();
    })
    .filter(m => !shouldIgnoreSlackChannel(m.channel, ignoreIds, ignoreUserNames))
    .map(m => {
      const channelName = m.channel && m.channel.name ? m.channel.name : '';
      const channelId = (m.channel && m.channel.id ? m.channel.id : '') || extractChannelIdFromPermalink(m.permalink || '');
      const permalinkThreadTs = extractThreadTsFromPermalink(m.permalink || '');
      const threadTs = m.thread_ts || permalinkThreadTs || m.ts;
      const channelLabel = channelName ? `[#${channelName}] ` : '';
      return {
        displayText: `${channelLabel}${m.text || ''}`,
        text: m.text || '',
        channelId: channelId,
        channelName: channelName,
        userId: m.user || '',
        ts: m.ts,
        threadTs: threadTs,
        isThreadRoot: threadTs === m.ts,
        permalink: m.permalink || ''
      };
    });

  if (normalizedMessages.length === 0) return [];

  assignSlackThreadLabels(normalizedMessages);

  return normalizedMessages;
}

function assignSlackThreadLabels(messages) {
  const labelMap = {};
  let counter = 1;
  messages.forEach(msg => {
    const key = msg.threadTs || msg.ts;
    if (!labelMap[key]) {
      labelMap[key] = `T${String(counter).padStart(3, '0')}`;
      counter++;
    }
    msg.threadLabel = labelMap[key];
  });
}

function extractThreadTsFromPermalink(permalink) {
  if (!permalink) return '';
  const match = permalink.match(/thread_ts=([0-9]+\.[0-9]+)/);
  return (match && match[1]) ? match[1] : '';
}

function extractChannelIdFromPermalink(permalink) {
  if (!permalink) return '';
  const match = permalink.match(/archives\/([A-Z0-9]+)/i);
  return (match && match[1]) ? match[1] : '';
}

function formatSlackLogsForSheet(messages) {
  if (!messages || messages.length === 0) return '';
  const hasStructuredData = messages.some(msg =>
    msg && (msg.ts || msg.channelId || msg.threadLabel || msg.permalink)
  );
  if (!hasStructuredData) return '';
  const headerMarker = '__FORMAT=TSV v1';
  const columnHeader = [
    '投稿日時',
    '投稿チャンネル',
    '投稿チャンネルID',
    'ユーザーID',
    'スレッドNo',
    '投稿内容',
    '投稿URL'
  ].join('\t');

  const lines = messages.map(msg => {
    const tsString = formatSlackTimestamp(msg.ts);
    return [
      tsString,
      msg.channelName ? `#${msg.channelName}` : '',
      msg.channelId || '',
      msg.userId || '',
      msg.threadLabel || '',
      sanitizeSlackSheetField(msg.text || ''),
      msg.permalink || ''
    ].join('\t');
  });

  return [headerMarker, columnHeader].concat(lines).join('\n');
}

function formatSlackTimestamp(ts) {
  if (!ts) return '';
  const millis = parseFloat(ts) * 1000;
  if (isNaN(millis)) return '';
  return Utilities.formatDate(new Date(millis), 'JST', 'yyyy/MM/dd HH:mm:ss');
}

function sanitizeSlackSheetField(value) {
  if (!value) return '';
  return String(value).replace(/\t/g, '    ').replace(/\r?\n/g, ' / ');
}

function fetchGoogleCalendarEvents(d, ignoreWords = []) {
  // TODO: 将来的に、設定画面でユーザーがログ収集対象のカレンダーIDを選択できるようにする
  const normalizedIgnores = (ignoreWords || [])
    .map(w => (w || '').toString().trim().toLowerCase())
    .filter(w => w);
  const dayRange = getJstDayRange(d);
  return CalendarApp.getDefaultCalendar().getEvents(dayRange.start, dayRange.endExclusive)
    .filter(e => {
      // 「参加しない」（NO）または「未定」（MAYBE）にした予定は除外する
      // CalendarApp.GuestStatus の null ガードは使わず try-catch で保護する
      try {
        const myStatus = typeof e.getMyStatus === 'function' ? e.getMyStatus() : null;
        const gs = CalendarApp.GuestStatus;
        if (myStatus === gs.NO || myStatus === gs.MAYBE) return false;
      } catch (_) {}
      if (normalizedIgnores.length === 0) return true;
      const title = (e.getTitle ? e.getTitle() : '').toString().toLowerCase();
      return !normalizedIgnores.some(w => title.includes(w));
    })
    .map(event => {
      const dur = (event.getEndTime() - event.getStartTime()) / 60000;
      return {
        log: `[予定] ${Utilities.formatDate(event.getStartTime(),'JST','HH:mm')} (${dur}分) ${event.getTitle()}`,
        event: event
      };
    });
}

function fetchGmailSentMessages(d) {
  const dayRange = getJstDayRange(d);
  const afterSec = Math.max(0, dayRange.startUnix - 1);
  const beforeSec = dayRange.endExclusiveUnix;
  return GmailApp.search(`from:me after:${afterSec} before:${beforeSec}`).map(thread => {
    const msg = thread.getMessages()[0];
    const subject = thread.getFirstMessageSubject();
    return {
      date: msg ? msg.getDate() : null,
      subject: subject,
      url: `https://mail.google.com/mail/u/0/#sent/${thread.getId()}`,
      displayText: `[送信] ${subject}`
    };
  });
}

function fetchMultiBacklogActivities(c, d) {
  let acts = [];
  c.forEach(conf => {
    try {
      const h = conf.host.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const userResp = UrlFetchApp.fetch(`https://${h}/api/v2/users/myself?apiKey=${conf.key}`, {
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (userResp.getResponseCode() !== 200) {
        throw new Error(`Backlog APIエラー(users/myself): HTTP ${userResp.getResponseCode()}`);
      }
      const u = JSON.parse(userResp.getContentText()).id;
      const activitiesResp = UrlFetchApp.fetch(`https://${h}/api/v2/users/${u}/activities?apiKey=${conf.key}`, {
        muteHttpExceptions: true,
        timeout: DEFAULT_FETCH_TIMEOUT_MS
      });
      if (activitiesResp.getResponseCode() !== 200) {
        throw new Error(`Backlog APIエラー(users/${u}/activities): HTTP ${activitiesResp.getResponseCode()}`);
      }
      const res = JSON.parse(activitiesResp.getContentText());
      const dayRange = getJstDayRange(d);
      res.filter(a => {
        const ad = new Date(a.created);
        return ad >= dayRange.start && ad < dayRange.endExclusive;
      }).forEach(a => {
        const summary = a.content.summary || '更新';
        const rawComment = (a.content && a.content.comment && a.content.comment.content)
          ? String(a.content.comment.content)
          : '';
        const compactComment = rawComment.replace(/\s+/g, ' ').trim();
        const commentSnippet = compactComment ? compactComment.substring(0, 160) : '';
        const issueKey = a.content && a.content.key_id
          ? `${a.project.projectKey}-${a.content.key_id}` : null;
        const detail = commentSnippet ? ` | コメント: ${commentSnippet}` : '';
        acts.push({
          date: new Date(a.created),
          projectKey: a.project.projectKey,
          summary: summary,
          comment: commentSnippet,
          issueKey: issueKey,
          url: issueKey ? `https://${h}/view/${issueKey}` : '',
          displayText: `[Backlog] ${a.project.projectKey} ${summary}${detail}`
        });
      });
    } catch (e) {
      console.warn(`Backlog activity fetch failed for ${conf && conf.host ? conf.host : 'unknown-host'}: ${e.message}`);
    }
  });
  return acts;
}

/**
 * Slackチャンネル名からIDを検索します。
 * @param {string} keyword 検索キーワード
 * @returns {Array<{id: string, name: string}>}
 */
// NOTE:
// searchSlackChannels は「設定 > クライアント名寄せ」向けの補助機能です。
// サマリ導線（クライアント定義/接続テスト）では依存しない設計にしています。
function searchSlackChannels(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) {
    throw new Error('検索キーワードを入力してください。');
  }

  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  if (!token) {
    throw new Error('Slack連携がされていません。接続設定タブからSlack連携を完了してください。');
  }

  const lowerKw = kw.toLowerCase();
  const conversations = fetchSlackConversations(token, {
    maxPages: 5,
    limit: 200,
    types: 'public_channel,private_channel'
  });

  return conversations
    .filter(function(channel) { return channel.name && channel.name.toLowerCase().includes(lowerKw); })
    .map(function(channel) { return { id: channel.id, name: channel.name }; })
    .slice(0, 30);
}

/**
 * Slackチャンネル/ユーザーIDが除外リストに含まれているかチェックします。
 */
function checkSlackChannelIds(idsStr) {
  const props = PropertiesService.getUserProperties();
  const token = props.getProperty('SLACK_USER_TOKEN');
  if (!token) return { results: [{ input: "Error", valid: false, message: "Slack連携がされていません" }] };

  const ids = idsStr.split(',').map(s => s.trim()).filter(s => s);
  const results = [];

  ids.forEach(id => {
    // 1. チャンネルID (C..., D..., G...)
    if (id.startsWith('C') || id.startsWith('D') || id.startsWith('G')) {
      try {
        const url = `https://slack.com/api/conversations.info?channel=${id}`;
        const response = UrlFetchApp.fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          muteHttpExceptions: true,
          timeout: DEFAULT_FETCH_TIMEOUT_MS
        });
        if (response.getResponseCode() !== 200) {
          throw new Error(`HTTP ${response.getResponseCode()}`);
        }
        const res = JSON.parse(response.getContentText());
        if (res.ok) {
          const name = res.channel.name || "DM/Private";
          results.push({ input: id, valid: true, message: `名前: <b>#${name}</b> (除外OK)` });
        } else {
          results.push({ input: id, valid: false, message: `見つかりません (${res.error})` });
        }
      } catch (e) { results.push({ input: id, valid: false, message: formatNetworkError('Slackチャンネル情報の確認中', e) }); }
    } 
    // 2. メンバーID (U..., W...)
    else if (id.startsWith('U') || id.startsWith('W')) {
      try {
        const userResponse = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          muteHttpExceptions: true,
          timeout: DEFAULT_FETCH_TIMEOUT_MS
        });
        if (userResponse.getResponseCode() !== 200) {
          throw new Error(`HTTP ${userResponse.getResponseCode()}`);
        }
        const uRes = JSON.parse(userResponse.getContentText());
        if (uRes.ok) {
          const userName = uRes.user.real_name || uRes.user.name;
          results.push({ 
            input: id, 
            valid: true, 
            message: `👤 ユーザー: <b>${userName}</b><br>✅ 確認OK。このユーザーとのDMを自動除外します。` 
          });
        } else {
          results.push({ input: id, valid: false, message: `ユーザーが見つかりません` });
        }
      } catch (e) { results.push({ input: id, valid: false, message: formatNetworkError('Slackユーザー情報の確認中', e) }); }
    } 
    else {
      results.push({ input: id, valid: false, message: "不正な形式です" });
    }
  });

  return { results: results, hasSuggestion: false };
}

function testGeminiConnection(selectedModelId) {
  const modelId = (selectedModelId && String(selectedModelId).trim()) || resolveGeminiModelId_();
  const apiUrl = buildVertexGenerateContentUrl_(modelId);
  const payload = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Hello" }] }] });
  try {
    const options = { method: 'post', contentType: 'application/json', headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': PROJECT_ID }, payload: payload, muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS };
    const res = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) { return { success: false, message: `エラー (${res.getResponseCode()}): ` + (json.error ? json.error.message : "詳細不明") }; }
    return { success: true, message: `✅ 接続成功！Vertex AI (${modelId}) が正常に応答しました。` };
  } catch (e) { return { success: false, message: formatNetworkError('Vertex AIとの接続テスト中', e) }; }
}

function testSlackConnection(channelId) {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  let targetId = channelId;
  let isSelf = false;
  if (!token) return { success: false, message: "先にSlack連携(ログイン)を行ってください" };
  if (!targetId || targetId.trim() === "") { targetId = userProps.getProperty('SLACK_MEMBER_ID'); isSelf = true; if (!targetId) return { success: false, message: "メンバーIDが取得できていません。" }; }
  try {
    let url; let isUser = false;
    if (targetId.startsWith('U') || targetId.startsWith('W')) { url = `https://slack.com/api/users.info?user=${targetId}`; isUser = true; } 
    else { url = `https://slack.com/api/conversations.info?channel=${targetId}`; }
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
      timeout: DEFAULT_FETCH_TIMEOUT_MS
    });
    if (response.getResponseCode() !== 200) {
      throw new Error(`HTTP ${response.getResponseCode()}`);
    }
    const res = JSON.parse(response.getContentText());
    if (res.ok) {
      // ★★★ 改善案: 接続テスト成功時に設定を保存する ★★★
      userProps.setProperty('SLACK_CHANNEL_ID', targetId);

      if (isUser) {
        return { success: true, message: `✅ 接続OK！\nユーザーID: ${targetId} (DMとして送信)\n\n設定を保存しました。` };
      } else {
        return { success: true, message: `✅ 接続OK！\nチャンネル名: #${res.channel.name}\n\n設定を保存しました。` };
      }
    } else {
      return { success: false, message: "エラー: " + res.error };
    }
  } catch (e) { return { success: false, message: formatNetworkError('Slackとの接続テスト中', e) }; }
}

function testBacklogConnection(host, apiKey) {
  if (!host || !apiKey) return { success: false, message: "ホスト名とAPIキーを入力してください" };
  host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    const url = `https://${host}/api/v2/users/myself?apiKey=${apiKey}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200 && json.id) { return { success: true, message: `✅ 接続OK！\nユーザー: ${json.name} (${json.userId})` }; } 
    else { return { success: false, message: "エラー: " + (json.errors ? json.errors[0].message : "認証に失敗しました") }; }
  } catch (e) { return { success: false, message: formatNetworkError('Backlogとの接続テスト中', e) }; }
}

/**
 * 認証設定の診断を実行します。管理者がApps Scriptエディタから手動実行できます。
 * Slack OAuth設定が正しく構成されているか一括確認します。
 * @returns {object} 診断結果
 */
function diagnoseAuthConfig() {
  const results = [];
  const scriptProps = PropertiesService.getScriptProperties();

  // 1. SLACK_CLIENT_ID
  const clientId = scriptProps.getProperty('SLACK_CLIENT_ID');
  if (!clientId) {
    results.push({ check: 'SLACK_CLIENT_ID', status: 'FAIL', detail: 'スクリプトプロパティに SLACK_CLIENT_ID が設定されていません。' });
  } else {
    results.push({ check: 'SLACK_CLIENT_ID', status: 'OK', detail: `設定済み (末尾: ...${clientId.slice(-4)})` });
  }

  // 2. SLACK_CLIENT_SECRET
  const clientSecret = scriptProps.getProperty('SLACK_CLIENT_SECRET');
  if (!clientSecret) {
    results.push({ check: 'SLACK_CLIENT_SECRET', status: 'FAIL', detail: 'スクリプトプロパティに SLACK_CLIENT_SECRET が設定されていません。' });
  } else {
    results.push({ check: 'SLACK_CLIENT_SECRET', status: 'OK', detail: '設定済み (値は非表示)' });
  }

  // 3. SLACK_TEAM_ID（任意）
  const teamId = scriptProps.getProperty('SLACK_TEAM_ID');
  if (!teamId) {
    results.push({ check: 'SLACK_TEAM_ID', status: 'WARN', detail: '未設定。任意のワークスペースで認証可能な状態です。' });
  } else {
    results.push({ check: 'SLACK_TEAM_ID', status: 'OK', detail: `設定済み: ${teamId}` });
  }

  // 4. Web App URL
  const appUrl = ScriptApp.getService().getUrl();
  if (!appUrl) {
    results.push({ check: 'WEB_APP_URL', status: 'FAIL', detail: 'Webアプリがデプロイされていません。' });
  } else {
    results.push({ check: 'WEB_APP_URL', status: 'OK', detail: appUrl });
  }

  // 5. LOG_SHEET_ID
  if (!LOG_SHEET_ID || LOG_SHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    results.push({ check: 'LOG_SHEET_ID', status: 'WARN', detail: '未設定。認証イベントのスプレッドシートログが無効です。' });
  } else {
    try {
      SpreadsheetApp.openById(LOG_SHEET_ID);
      results.push({ check: 'LOG_SHEET_ID', status: 'OK', detail: '設定済み・アクセス可能' });
    } catch (openErr) {
      results.push({ check: 'LOG_SHEET_ID', status: 'FAIL', detail: 'スプレッドシートにアクセスできません: ' + openErr.message });
    }
  }

  // Salesforce連携設定の診断を追加
  const sfClientId = scriptProps.getProperty('SF_CLIENT_ID');
  if (!sfClientId) {
    results.push({ check: 'SF_CLIENT_ID', status: 'WARN', detail: 'Salesforce Connected AppのクライアントIDが設定されていません。' });
  } else {
    results.push({ check: 'SF_CLIENT_ID', status: 'OK', detail: `設定済み (末尾: ...${sfClientId.slice(-4)})` });
  }
  const sfClientSecret = scriptProps.getProperty('SF_CLIENT_SECRET');
  if (!sfClientSecret) {
    results.push({ check: 'SF_CLIENT_SECRET', status: 'WARN', detail: 'Salesforce Connected Appのクライアントシークレットが設定されていません。' });
  } else {
    results.push({ check: 'SF_CLIENT_SECRET', status: 'OK', detail: '設定済み (値は非表示)' });
  }

  console.log('=== Auth Configuration Diagnosis ===');
  results.forEach(r => {
    console.log(`[${r.status}] ${r.check}: ${r.detail}`);
  });
  console.log('====================================');

  return { results: results };
}

function getJstYmd_(dateObj) {
  return Utilities.formatDate(dateObj, JST_TIMEZONE, 'yyyy-MM-dd');
}

function getYesterdayJstYmd_(dateObj) {
  const base = new Date(dateObj.getTime());
  base.setDate(base.getDate() - 1);
  return getJstYmd_(base);
}

function persistLastDailyReportMeta_(targetDate, channelId, ts) {
  const userProps = PropertiesService.getUserProperties();
  userProps.setProperties({
    LAST_DAILY_REPORT_DATE: getJstYmd_(targetDate),
    LAST_DAILY_REPORT_CHANNEL: channelId || '',
    LAST_DAILY_REPORT_TS: ts || ''
  }, false);
}

function cleanupPreviousDailyReportMessage_(props, targetDate, currentChannel) {
  // 手動で過去日の日報を再送するケースでは削除しない
  if (getJstYmd_(targetDate) !== getJstYmd_(new Date())) return;
  const token = props.SLACK_USER_TOKEN;
  const lastDate = props.LAST_DAILY_REPORT_DATE || '';
  const lastChannel = props.LAST_DAILY_REPORT_CHANNEL || '';
  const lastTs = props.LAST_DAILY_REPORT_TS || '';
  if (!token || !lastDate || !lastChannel || !lastTs) return;
  if (lastChannel !== currentChannel) return;
  if (lastDate !== getYesterdayJstYmd_(targetDate)) return;

  const delRes = UrlFetchApp.fetch('https://slack.com/api/chat.delete', {
    method: 'post',
    headers: { Authorization: `Bearer ${token}` },
    contentType: 'application/json',
    payload: JSON.stringify({ channel: lastChannel, ts: lastTs }),
    muteHttpExceptions: true,
    timeout: DEFAULT_FETCH_TIMEOUT_MS
  });
  if (delRes.getResponseCode() !== 200) {
    console.warn(`Slack housekeeping delete HTTP error: ${delRes.getResponseCode()}`);
    return;
  }
  const delJson = JSON.parse(delRes.getContentText());
  if (!delJson.ok) {
    console.warn(`Slack housekeeping delete skipped: ${delJson.error}`);
  }
}

function normalizeSlackMarkdownBlockText_(messageText) {
  const sectionHeaderPattern = /^(?:👉|:point_right:|⛳|:golf:|💡|:bulb:|:tossup:|⚠️|:warning:|💬|:speech_balloon:|⌛|:hourglass:|🔍|:mag:)\s*.+$/;
  const lines = String(messageText || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let skipBlankAfterHeader = false;

  function boldSectionHeader_(text) {
    if (/^\*\*.*\*\*$/.test(text) || /^__.*__$/.test(text)) return text;
    return `**${text.replace(/^(\*\*|__|\*|_)+|(\*\*|__|\*|_)+$/g, '')}**`;
  }

  lines.forEach(function(line) {
    let trimmed = (line || '').trim();
    trimmed = trimmed.replace(/^(?:💡|:bulb:)\s*(\*?アイディア\/備忘\*?)\s*$/, ':tossup: $1');
    const isSectionHeader = sectionHeaderPattern.test(trimmed);
    if (skipBlankAfterHeader && trimmed === '') {
      return;
    }
    if (isSectionHeader) {
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      const prev = out.length > 0 ? out[out.length - 1].trim() : '';
      if (out.length > 0 && !/^【日報】/.test(prev)) out.push('');
      out.push(boldSectionHeader_(trimmed));
      skipBlankAfterHeader = true;
      return;
    }
    skipBlankAfterHeader = false;
    out.push(line);
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSlackMarkdownBlockPayload_(messageText) {
  const markdownText = normalizeSlackMarkdownBlockText_(messageText);
  return {
    text: markdownText,
    blocks: [{
      type: 'markdown',
      text: markdownText
    }]
  };
}

function shouldFallbackSlackTextPost_(result) {
  if (!result || result.ok) return false;
  const error = result.error || '';
  return ['invalid_blocks', 'unsupported_block_type', 'msg_blocks_too_long', 'invalid_arguments'].indexOf(error) !== -1;
}

function postSlackMessage_(url, headers, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    timeout: DEFAULT_FETCH_TIMEOUT_MS
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Slack投稿エラー: HTTP ${response.getResponseCode()}`);
  }
  return JSON.parse(response.getContentText());
}

function sendToSlack(m, t, c, s, d, f, df, parentTitle, slackFormat) {
  const url = 'https://slack.com/api/chat.postMessage';
  const headers = { 'Authorization': 'Bearer ' + t };
  const format = slackFormat === 'markdown_block' ? 'markdown_block' : 'text';
  let payload = { channel: c, text: m };
  if (format === 'markdown_block') {
    payload = Object.assign({ channel: c }, buildSlackMarkdownBlockPayload_(m));
  }
  let parentTs = '';
  if (s === "thread") {
    const parentPayload = { channel: c, text: parentTitle || `【日報】${getFormattedDateString(d, df)}` };
    try {
      const res = UrlFetchApp.fetch(url, { method: 'post', headers, contentType: 'application/json', payload: JSON.stringify(parentPayload), muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        if (json.ok) {
          payload.thread_ts = json.ts;
          parentTs = json.ts;
        } else console.warn("親スレッド作成失敗: " + json.error);
      } else {
        console.warn(`Slack親投稿HTTPエラー: ${res.getResponseCode()}`);
      }
    } catch(e) { console.warn("Slack通信エラー(親投稿): " + e.message); }
  } else if (s === "fixed_thread") {
    const fixedThreadUrl = (f || '').toString().trim();
    let ts = null; const matchP = fixedThreadUrl.match(/\/p(\d{10})(\d{6})/);
    if (matchP) ts = `${matchP[1]}.${matchP[2]}`; else { const matchTs = fixedThreadUrl.match(/thread_ts=(\d+\.\d+)/); if (matchTs) ts = matchTs[1]; }
    if (ts) payload.thread_ts = ts; else console.warn("固定スレッドURLの解析に失敗");
  }
  
  try {
  let result = postSlackMessage_(url, headers, payload);
    let usedFormat = format;
    if (!result.ok && format === 'markdown_block' && shouldFallbackSlackTextPost_(result)) {
      console.warn(`Slack markdown_block投稿をtext投稿へフォールバック: ${result.error}`);
      const fallbackPayload = {
        channel: payload.channel,
        text: m
      };
      if (payload.thread_ts) fallbackPayload.thread_ts = payload.thread_ts;
      result = postSlackMessage_(url, headers, fallbackPayload);
      payload = fallbackPayload;
      usedFormat = 'text';
    }
    if (!result.ok) {
      console.error("Slack投稿エラー:", result.error);
      throw new Error(`Slack投稿エラー: ${result.error}`);
    }
    return {
      ok: true,
      channel: result.channel || c,
      ts: result.ts || '',
      threadTs: payload.thread_ts || result.ts || '',
      parentTs: parentTs,
      slackFormat: usedFormat
    };
  } catch(e) {
    console.error("Slack通信エラー:", e);
    throw e;
  }
}

function getSlackAuthUrl() {
  const state = ScriptApp.newStateToken().withTimeout(600).createToken();
  CacheService.getUserCache().put('oauth_state', state, 600); // 10分間キャッシュ
  markOAuthFlowState_('slack', state);

  const redirectUri = ScriptApp.getService().getUrl();
  const scopes = 'channels:read,chat:write,search:read,users:read';
  const clientId = PropertiesService.getScriptProperties().getProperty('SLACK_CLIENT_ID');
  
  const teamId = PropertiesService.getScriptProperties().getProperty('SLACK_TEAM_ID');
  
  let authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&user_scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  if (teamId) authUrl += `&team=${teamId}`;
  return authUrl;
}

function handleAuthCallback(e) {
  try {
    const receivedState = e.parameter.state;
    const expectedState = CacheService.getUserCache().get('oauth_state');

    if (!receivedState || receivedState !== expectedState) {
      throw createAuthError('AUTH-001', '認証セッションが無効です。ページを開いてから時間が経ちすぎた可能性があります。もう一度お試しください。');
    }
    CacheService.getUserCache().remove('oauth_state');
    consumeOAuthFlowState_(receivedState);

    const code = e.parameter.code;
    if (!code) {
      throw createAuthError('AUTH-002', 'Slackからの認証コードが見つかりませんでした。');
    }

    const scriptProps = PropertiesService.getScriptProperties();
    const clientId = scriptProps.getProperty('SLACK_CLIENT_ID');
    const clientSecret = scriptProps.getProperty('SLACK_CLIENT_SECRET');
    const redirectUri = ScriptApp.getService().getUrl();

    let response;
    try {
      response = UrlFetchApp.fetch('https://slack.com/api/oauth.v2.access', { method: 'post', payload: { code: code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }, muteHttpExceptions: true, timeout: DEFAULT_FETCH_TIMEOUT_MS });
    } catch (fetchErr) {
      let authMessage = 'Slack APIとの通信中にエラーが発生しました: ' + fetchErr.message;
      if (fetchErr.message.includes("script.external_request") || fetchErr.message.includes("権限")) {
        authMessage = 'スクリプトの実行権限が不足しています。\n\n'
          + '【対処法】\n'
          + '1. https://myaccount.google.com/permissions にアクセス\n'
          + '2. 本アプリのアクセス権を削除\n'
          + '3. 本アプリのURLに再度アクセスし、権限をすべて許可してください';
      }
      throw createAuthError('AUTH-005', authMessage);
    }
    const json = JSON.parse(response.getContentText());
    if (response.getResponseCode() !== 200) {
      throw createAuthError('AUTH-003', 'Slack認証に失敗しました: HTTP ' + response.getResponseCode());
    }

    if (json.ok) {
      const expectedTeamId = PropertiesService.getScriptProperties().getProperty('SLACK_TEAM_ID');
      const actualTeamId = json.team && json.team.id;
      const actualTeamName = json.team && json.team.name;
      const authedUserId = json.authed_user && json.authed_user.id;

      if (expectedTeamId && actualTeamId && expectedTeamId !== actualTeamId) {
        console.error(
          "Team ID mismatch during auth. Expected: %s, Got: %s (Team Name: %s, User ID: %s)",
          expectedTeamId, actualTeamId, actualTeamName, authedUserId
        );
        throw createAuthError('AUTH-004', '許可されていないSlackワークスペースで認証されました。正しいワークスペースで再度お試しください。');
      }

      const userProps = PropertiesService.getUserProperties();
      userProps.setProperty('SLACK_USER_TOKEN', json.authed_user.access_token);
      userProps.setProperty('SLACK_MEMBER_ID', json.authed_user.id);
      let slackName = 'ユーザー';
      try {
        const userRes = UrlFetchApp.fetch(`https://slack.com/api/users.info?user=${json.authed_user.id}`, {
          headers: { 'Authorization': `Bearer ${json.authed_user.access_token}` },
          muteHttpExceptions: true,
          timeout: DEFAULT_FETCH_TIMEOUT_MS
        });
        if (userRes.getResponseCode() === 200) {
          const userData = JSON.parse(userRes.getContentText());
          if (userData.ok) { slackName = userData.user.profile.display_name || userData.user.real_name || userData.user.name; userProps.setProperty('SLACK_USER_NAME', slackName); }
        }
      } catch(nameErr) { /* ユーザー名取得失敗は致命的ではないので無視 */ }

      logAuthEvent('AUTH-OK', 'Authentication successful for ' + slackName, Session.getActiveUser().getEmail(), e.parameter);

      return renderResultPage("🎉 連携が完了しました！", "以下のボタンを押して、アプリの利用を開始してください。", `${ScriptApp.getService().getUrl()}?setup=true`, '🎉');

    } else {
      const safeErrorResponse = {
        ok: json.ok,
        error: json.error,
        team: json.team,
        user: json.user ? { id: json.user.id, name: json.user.name } : undefined
      };
      console.error("Slack API Error during auth:", JSON.stringify(safeErrorResponse, null, 2));
      throw createAuthError('AUTH-003', 'Slack認証に失敗しました: ' + (json.error || '不明なエラー'));
    }
  } catch (err) {
    const errorCode = err.authErrorCode || 'AUTH-099';
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    const userEmail = Session.getActiveUser().getEmail() || 'unknown';

    console.error(JSON.stringify({
      event: 'auth_callback_failed',
      errorCode: errorCode,
      message: err.message,
      stack: err.stack,
      userEmail: userEmail,
      timestamp: timestamp,
      requestParams: {
        hasCode: !!e.parameter.code,
        hasState: !!e.parameter.state,
        hasError: !!e.parameter.error,
        errorParam: e.parameter.error || null
      }
    }));

    logAuthEvent(errorCode, err.message, userEmail, e.parameter);

    const userMessage = `エラーコード: ${errorCode}\n発生時刻: ${timestamp}\n\n${err.message}\n\nこの情報を管理者にお伝えください。`;
    return renderResultPage("認証エラー", userMessage, ScriptApp.getService().getUrl(), "❌");
  }
}

/**
 * ログアウト処理を行い、ユーザーを再認証ページへリダイレクトさせます。
 * @returns {HtmlOutput} リダイレクト用のHTML
 */
function handleLogout() {
  const userProps = PropertiesService.getUserProperties();
  userProps.deleteAllProperties(); // ユーザープロパティをすべて削除
  updateTrigger_(false); // 自動実行トリガーを削除
  updateTodoTrigger_(false); // TODO通知トリガーを削除
  
  // Salesforce連携情報も削除
  disconnectSalesforce(); // 新規追加

  const authUrl = getSlackAuthUrl();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa; }
          .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; }
          h1 { margin: 0 0 10px 0; font-size: 20px; }
          p { color: #666; margin-bottom: 25px; }
          a { display: inline-block; background: #1a73e8; color: #fff; padding: 12px 24px; border-radius: 24px; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card"><h1>👋 ログアウトしました</h1><p>設定はすべてリセットされました。</p><a href="${authUrl}" target="_top">再度Slackと連携する</a></div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(htmlContent)
    .setTitle('ログアウト完了');
}

function getFormattedDateString(d, t) {
  const dp = Utilities.formatDate(d, JST_TIMEZONE, 'yyyy年MM月dd日');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  // d.getDay() はUTC基準のため、GASサーバー(UTC)でJST午前9時前に実行すると曜日がズレる。
  // Utilities.formatDate で JST 基準の日付文字列から曜日を取得する。
  const jstDateStr = Utilities.formatDate(d, JST_TIMEZONE, 'yyyy/MM/dd');
  const parts = jstDateStr.split('/');
  const jstMidnightLocal = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
  return `${dp} (${days[jstMidnightLocal.getDay()]})`;
}

/**
 * Renders a simple HTML page to show a result message to the user.
 * Uses the result.html template.
 * @param {string} title The title of the page.
 * @param {string} message The message to display.
 * @param {string} appUrl The URL to redirect to.
 * @param {string} icon The emoji icon to display.
 * @returns {HtmlOutput} The HTML output to render.
 */
function renderResultPage(title, message, appUrl, icon) {
  const template = HtmlService.createTemplateFromFile('result');
  template.title = title;
  template.message = message;
  template.appUrl = appUrl || ScriptApp.getService().getUrl();
  template.icon = icon || '✅';
  return template.evaluate().setTitle(title);
}
