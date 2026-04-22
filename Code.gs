/**
 * Webアプリのメインエントリポイント。
 * パラメータに応じて各ハンドラに処理を振り分けます。
 * @param {object} e The event parameter for a web app request.
 * @returns {HtmlOutput} The HTML page to display.
 */
function doGet(e) {
  // Salesforceからの認証コールバックを最初にチェック
  if (e.parameter.sf_code && e.parameter.state) {
    // Salesforce OAuthの場合、stateはSalesforceServiceでsf_oauth_stateとして検証
    return handleSalesforceCallback(e);
  }

  // シナリオ1: Slackからの認証コールバック
  if (e.parameter.code) {
    return handleAuthCallback(e);
  }

  // シナリオ1.5: Slackが認証拒否/キャンセルで返した場合
  if (e.parameter.error) {
    const errorMessages = {
      'access_denied': 'Slackでの認証がキャンセルされました。利用するにはSlack連携が必要です。',
    };
    const message = errorMessages[e.parameter.error] || 'Slack認証でエラーが発生しました。もう一度お試しください。';
    console.error(JSON.stringify({
      event: 'slack_oauth_denied',
      errorCode: 'AUTH-006',
      errorParam: e.parameter.error,
      userEmail: Session.getActiveUser().getEmail() || 'unknown',
      timestamp: new Date().toISOString()
    }));
    logAuthEvent('AUTH-006', message, Session.getActiveUser().getEmail(), e.parameter);
    return renderResultPage("認証キャンセル", message, ScriptApp.getService().getUrl(), "⚠️");
  }

  // シナリオ2: ログアウト要求
  if (e.parameter.action === 'logout') {
    return handleLogout();
  }

  // シナリオ3: 通常アクセス時の状態判定
  // ★★★ 修正: ログイン状態に関わらず、常にメインページ描画関数を呼び出す ★★★
  // ログインしているかどうかの判定と表示の切り替えはshowMainPageとIndex.htmlが担当する。
  return showMainPage();
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
    'REPORT_SKIP_HOLIDAYS',
    'AVG_WORK_HOURS', 'PROJECT_LIST',
    'TODO_NOTIFY_ENABLE', 'TODO_NOTIFY_DAYS', 'TODO_NOTIFY_TIME',
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
