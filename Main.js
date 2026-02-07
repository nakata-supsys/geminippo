// ==========================================
// Main.gs: Webアプリのエントリポイント
// ==========================================

function doGet(e) {
  // OAuthコールバック
  if (e.parameter.code) return handleCallback(e.parameter.code);
  
  // ログアウト処理
  if (e.parameter.action === 'logout') {
    doLogout();
    return renderResultPage("👋 連携を解除しました", "設定を削除しました。まもなくトップ画面に戻ります。");
  }

  const userProps = PropertiesService.getUserProperties();
  const token = userProps.getProperty('SLACK_USER_TOKEN');
  const template = HtmlService.createTemplateFromFile('Index');
  const props = userProps.getProperties();
  
  props.MY_MEMBER_ID = userProps.getProperty('SLACK_MEMBER_ID') || '';
  template.props = props;

  if (token) {
    template.isLoggedIn = true;
    template.userName = props['SLACK_USER_NAME'] || 'ユーザー';
  } else {
    template.isLoggedIn = false;
    template.authUrl = getSlackAuthUrl();
  }
  
  return template.evaluate()
    .setTitle('✨ AI日報アシスタント (Geminippo)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
