/**
 * Webアプリのメインエントリポイント。
 * パラメータに応じて各ハンドラに処理を振り分けます。
 * @param {object} e The event parameter for a web app request.
 * @returns {HtmlOutput} The HTML page to display.
 */
function doGet(e) {
  e = e || { parameter: {} };
  const params = (e && e.parameter) || {};
  const oauthFlow = resolveOAuthFlow_(params);
  if (oauthFlow === 'salesforce') return handleSalesforceCallback(e);
  if (oauthFlow === 'slack') return handleAuthCallback(e);

  // シナリオ1: Slackからの認証コールバック
  if (params.code) {
    // state期限切れ等でフローが判別できない場合は誤ルーティングを防止する
    return renderResultPage(
      "認証セッション切れ",
      "認証フローを判別できませんでした。時間をおいてやり直すと、この問題が発生しにくくなります。",
      ScriptApp.getService().getUrl(),
      "⚠️"
    );
  }

  // シナリオ1.5: Slackが認証拒否/キャンセルで返した場合
  if (params.error) {
    const errorMessages = {
      'access_denied': 'Slackでの認証がキャンセルされました。利用するにはSlack連携が必要です。',
    };
    const message = errorMessages[params.error] || 'Slack認証でエラーが発生しました。もう一度お試しください。';
    console.error(JSON.stringify({
      event: 'slack_oauth_denied',
      errorCode: 'AUTH-006',
      errorParam: params.error,
      userEmail: Session.getActiveUser().getEmail() || 'unknown',
      timestamp: new Date().toISOString()
    }));
    logAuthEvent('AUTH-006', message, Session.getActiveUser().getEmail(), params);
    return renderResultPage("認証キャンセル", message, ScriptApp.getService().getUrl(), "⚠️");
  }

  // シナリオ2: ログアウト要求
  if (params.action === 'logout') {
    return handleLogout();
  }

  // シナリオ3: 通常アクセス時の状態判定
  // ★★★ 修正: ログイン状態に関わらず、常にメインページ描画関数を呼び出す ★★★
  // ログインしているかどうかの判定と表示の切り替えはshowMainPageとIndex.htmlが担当する。
  return showMainPage();
}

/**
 * clasp run の疎通確認用。
 * @returns {{ok:boolean,message:string,timestamp:string}}
 */
function ping() {
  return {
    ok: true,
    message: 'pong',
    timestamp: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
  };
}

function resolveOAuthFlow_(params) {
  if (!params) return '';
  if (params.sf_code || params.sf_state) return 'salesforce';
  const state = params.state || '';
  if (!state) return '';
  const flowFromCache = CacheService.getUserCache().get(`oauth_flow_${state}`) || '';
  if (flowFromCache === 'salesforce' || flowFromCache === 'slack') return flowFromCache;
  if (isSalesforceCallback_({ parameter: params })) return 'salesforce';
  if (params.code) {
    const slackState = CacheService.getUserCache().get('oauth_state');
    if (slackState && slackState === state) return 'slack';
    return '';
  }
  return '';
}

/**
 * Salesforce OAuth callbackかどうかを判定します。
 * Salesforce標準の戻り値は code/state なので、Slack OAuthと衝突しないよう
 * 保存済みのSalesforce stateと照合してからSalesforce側へ振り分けます。
 * 旧実装の sf_code/sf_state 形式も互換のため許容します。
 * @param {object} e The event parameter for a web app request.
 * @returns {boolean}
 */
function isSalesforceCallback_(e) {
  const params = (e && e.parameter) || {};
  if (params.sf_code) return true;
  if (!params.code || !params.state) return false;

  try {
    const expectedState = CacheService.getUserCache().get('sf_oauth_state');
    return !!expectedState && params.state === expectedState;
  } catch (err) {
    console.warn('Salesforce callback state check failed:', err.message);
    return false;
  }
}




/**
 * メインのUIを表示します。
 * @returns {HtmlOutput}
 */
function showMainPage() {
  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  const template = HtmlService.createTemplateFromFile('Index');
  const allProps = userProps.getProperties();

  // テンプレートに渡すのは表示に必要なキーのみ。トークン類は除外する
  const SAFE_KEYS = [
    'SELECTED_DEPARTMENT',
    'SLACK_CHANNEL_ID', 'SLACK_MEMBER_ID', 'SLACK_USER_NAME',
    'BACKLOG_CONFIGS',
    'CALENDAR_IGNORE_WORDS', 'SLACK_IGNORE_CHANNELS',
    'CLIENT_FALLBACK_NAME', 'CLIENT_ALIAS_RULES',
    'REPORT_FLASH_MODEL_ID', 'REPORT_MODE', 'REPORT_BULLET_STYLE',
    'REPORT_SLACK_STYLE', 'REPORT_FIXED_THREAD_URL',
    'REPORT_MANHOUR', 'REPORT_REFLECTION', 'REPORT_SLACK_SCOPE',
    'REPORT_DAY_FORMAT', 'REPORT_SCHEDULE_TIME', 'REPORT_SCHEDULE_DAYS',
    'REPORT_SKIP_HOLIDAYS', 'REPORT_SLACK_HOUSEKEEPING',
    'AVG_WORK_HOURS', 'PROJECT_LIST',
    'TODO_NOTIFY_ENABLE', 'TODO_NOTIFY_DAYS', 'TODO_NOTIFY_TIME', 'TODO_SKIP_HOLIDAYS', 'TODO_HOUSEKEEP_DAYS',
    'TODO_SLACK_STYLE', 'TODO_FIXED_THREAD_URL'
  ];
  const props = {};
  SAFE_KEYS.forEach(k => { props[k] = allProps[k] || ''; });
  props.MY_MEMBER_ID = allProps['SLACK_MEMBER_ID'] || '';
  // トークンは真偽値のみ渡す（値は渡さない）
  props.SLACK_CONNECTED = !!token;

  template.props = props;

  if (token) {
    template.isLoggedIn = true;
    template.userName = props['SLACK_USER_NAME'] || 'ユーザー'; // <?= ?> がHTMLエスケープするためここではエスケープしない
    template.appUrl = ScriptApp.getService().getUrl();
  } else {
    template.isLoggedIn = false;
    template.authUrl = getSlackAuthUrl();
  }

  return template.evaluate()
    .setTitle('✨ AI日報アシスタント(GemiNippo)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML特殊文字をエスケープします。
 * @param {string} str エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * HTMLテンプレート内で別のHTMLファイルをインクルードするためのヘルパー関数。
 * @param {string} filename インクルードするファイル名 (拡張子なし)
 * @returns {string} ファイルのコンテンツ
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * クライアント再同期用に、ユーザー設定を返します。
 * トークン類は含めず、表示に必要なキーのみ返します。
 * @returns {Object<string,string>}
 */
function getUserSettings() {
  const userProps = PropertiesService.getUserProperties().getProperties();
  const SAFE_KEYS = [
    'SELECTED_DEPARTMENT',
    'SLACK_CHANNEL_ID', 'SLACK_MEMBER_ID', 'SLACK_USER_NAME',
    'BACKLOG_CONFIGS',
    'CALENDAR_IGNORE_WORDS', 'SLACK_IGNORE_CHANNELS',
    'CLIENT_FALLBACK_NAME', 'CLIENT_ALIAS_RULES',
    'REPORT_FLASH_MODEL_ID', 'REPORT_MODE', 'REPORT_BULLET_STYLE',
    'REPORT_SLACK_STYLE', 'REPORT_FIXED_THREAD_URL',
    'REPORT_MANHOUR', 'REPORT_REFLECTION', 'REPORT_SLACK_SCOPE',
    'REPORT_DAY_FORMAT', 'REPORT_SCHEDULE_TIME', 'REPORT_SCHEDULE_DAYS',
    'REPORT_SKIP_HOLIDAYS', 'REPORT_SLACK_HOUSEKEEPING',
    'AVG_WORK_HOURS', 'PROJECT_LIST',
    'TODO_NOTIFY_ENABLE', 'TODO_NOTIFY_DAYS', 'TODO_NOTIFY_TIME', 'TODO_SKIP_HOLIDAYS', 'TODO_HOUSEKEEP_DAYS',
    'TODO_SLACK_STYLE', 'TODO_FIXED_THREAD_URL'
  ];
  const settings = {};
  SAFE_KEYS.forEach(function(k) { settings[k] = userProps[k] || ''; });
  settings.MY_MEMBER_ID = userProps.SLACK_MEMBER_ID || '';
  return settings;
}
