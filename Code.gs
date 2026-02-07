/**
 * Renders the main HTML page for the web app.
 * @param {object} e The event parameter for a web app request.
 * @returns {HtmlOutput} The HTML page to display.
 */
function doGet(e) {
  // Get user properties to check if this is the first visit.
  const userProps = PropertiesService.getUserProperties();
  const isFirstVisit = !userProps.getProperty('initialized');

  // Evaluate the main HTML template.
  const htmlOutput = HtmlService.createTemplateFromFile('js').evaluate();
  htmlOutput.setTitle('GemiNippo');

  // If it's the first visit and not a logout redirect, reload with a setup parameter.
  if (isFirstVisit && !e.parameter.logout) { // ★★★ 修正案 ★★★ ログアウト時はリダイレクトしない
    const url = ScriptApp.getService().getUrl();
    // This script forces a reload with '?setup=true' to trigger the guide prompt on the client-side.
    return HtmlService.createHtmlOutput(
      `<script>window.top.location.replace("${url}?setup=true");</script>`
    );
  }
  
  return htmlOutput;
}