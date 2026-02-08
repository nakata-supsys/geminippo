/**
 * Webアプリのメインエントリポイント。
 * パラメータに応じて各ハンドラに処理を振り分けます。
 * @param {object} e The event parameter for a web app request.
 * @returns {HtmlOutput} The HTML page to display.
 */
function doGet(e) {
  // 1. OAuthコールバック処理
  if (e.parameter.code) {
    return handleAuthCallback(e);
  }

  // 2. ログアウト処理
  if (e.parameter.action === 'logout') {
    return handleLogout();
  }

  // 3. メイン画面の表示
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
  const props = userProps.getProperties();

  props.MY_MEMBER_ID = userProps.getProperty('SLACK_MEMBER_ID') || '';
  template.props = props;

  if (token) {
    template.isLoggedIn = true;
    template.userName = props['SLACK_USER_NAME'] || 'ユーザー';
    template.appUrl = ScriptApp.getService().getUrl();
  } else {
    template.isLoggedIn = false;
    template.authUrl = getSlackAuthUrl();
  }

  return template.evaluate()
    .setTitle('✨ AI日報アシスタント')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ログアウト処理を行い、結果ページを表示します。
 * @returns {HtmlOutput}
 */
function handleLogout() {
  doLogout();
  const appUrl = ScriptApp.getService().getUrl();
  // ログアウト時は result.html を使って結果を表示
  return renderResultPage("👋 連携を解除しました", "設定を削除しました。まもなくトップ画面に戻ります。", appUrl, '👋');
}