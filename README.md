
## 🚀 セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-username/GemiNippo.git
cd GemiNippo
```

### 2. 開発環境の準備

本プロジェクトは`clasp`を利用したローカル開発を推奨しています。

1.  **Node.js**をインストールします。
2.  `clasp`とTypeScriptの型定義をインストールします。
    ```bash
    # claspをグローバルにインストール
    npm install -g @google/clasp

    # 開発用の型定義をインストール
    npm install
    ```
3.  Googleアカウントで`clasp`にログインします。
    ```bash
    clasp login
    ```

### 3. Google Apps Script プロジェクトの作成

1.  ローカルのソースコードを元に、サーバー上に新しいApps Scriptプロジェクトを作成します。
    ```bash
    clasp create --title "GemiNippo" --rootDir ./
    ```
    成功すると、`.clasp.json`ファイルが生成され、ローカル環境とサーバー上のプロジェクトが紐付けられます。

2.  作成されたプロジェクトをブラウザで開きます。
    ```bash
    clasp open
    ```

### 4. GCPプロジェクトとの連携

1.  Apps Scriptエディタの左メニューから **[プロジェクトの設定]** (歯車アイコン) をクリックします。
2.  「Google Cloud Platform（GCP）プロジェクト」セクションの **[プロジェクトを変更]** をクリックし、準備したGCPプロジェクトの **プロジェクト番号** を入力して連携します。
3.  GCPコンソールで、連携したプロジェクトの **Vertex AI API** を有効化します。

### 5. Slackアプリの作成

1.  Slack API: Your Apps にアクセスし、**[Create New App]** をクリックします。
2.  **[From scratch]** を選択し、アプリ名（例: GemiNippo）とワークスペースを指定して作成します。
3.  左メニューの **[OAuth & Permissions]** に移動します。
4.  **[Redirect URLs]** セクションで **[Add New Redirect URL]** をクリックし、**この時点では仮のURL**（例: `https://localhost`）を入力して一度保存します。（このURLは後で正式なものに更新します）
5.  **[Scopes]** > **[User Token Scopes]** で、以下のスコープを追加します。
    -   `channels:read`
    -   `chat:write`
    -   `search:read`
    -   `users:read`
6.  左メニューの **[Basic Information]** に戻り、**[App Credentials]** セクションから **Client ID** と **Client Secret** をコピーします。

### 6. スクリプトプロパティとコードの反映

1.  Apps Scriptエディタの左メニューから **[プロジェクトの設定]** (歯車アイコン) をクリックします。
2.  **[スクリプト プロパティ]** セクションで **[スクリプト プロパティを編集]** をクリックし、以下の2つのプロパティを追加します。
    -   `SLACK_CLIENT_ID`: (SlackアプリのClient ID)
    -   `SLACK_CLIENT_SECRET`: (SlackアプリのClient Secret)
3.  **[スクリプト プロパティを保存]** をクリックします。
4.  ローカルのソースコードをサーバーにアップロードします。
    ```bash
    clasp push
    ```

### 7. デプロイと最終設定

1.  Apps Scriptエディタ右上の **[デプロイ] > [新しいデプロイ]** をクリックします。
2.  **[種類の選択]** で **[ウェブアプリ]** を選択します。
3.  **[次のユーザーとして実行]** を **「ウェブアプリにアクセスしているユーザー」** に設定します。
4.  **[アクセスできるユーザー]** を組織のドメインなどに設定し、**[デプロイ]** をクリックします。
5.  表示された**ウェブアプリURL**をコピーします。
6.  Slackアプリ設定の **Redirect URLs** に戻り、先ほどコピーした正式なウェブアプリURLを追加・保存します。

---

## 使い方

1.  デプロイしたウェブアプリのURLにアクセスします。

---

## トラブルシューティング

### エラーコード一覧

認証時にエラーが発生した場合、画面にエラーコードが表示されます。

| コード | 原因 | 対処法 |
|--------|------|--------|
| AUTH-001 | 認証セッションの期限切れ（10分以上経過） | ページを再読み込みし、もう一度Slack連携ボタンを押してください |
| AUTH-002 | Slackからの認証コードが欠落 | 再度お試しください。繰り返す場合はSlackアプリ設定のRedirect URLsを確認してください |
| AUTH-003 | Slack APIからのエラー応答 | Slackアプリの Client ID / Client Secret が正しいか確認してください |
| AUTH-004 | 許可されていないワークスペース | スクリプトプロパティの `SLACK_TEAM_ID` に正しいワークスペースIDが設定されているか確認してください |
| AUTH-005 | スクリプトの実行権限不足 | 下記「AUTH-005 の対処法」を参照 |
| AUTH-006 | ユーザーがSlack認証画面でキャンセル | 再度お試しいただき、Slackの権限画面で「許可する」を選択してください |

### AUTH-005 の対処法

このエラーは、ユーザーがGoogle Apps Scriptに対して外部通信の権限（`script.external_request`）を承認していない場合に発生します。
特に、**デプロイ更新後に新しいスコープが追加された場合**、既存ユーザーに再承認が求められないことがあります。

**ユーザー側の対処手順:**
1. [Googleアカウントの権限管理ページ](https://myaccount.google.com/permissions) にアクセス
2. 「サードパーティのアプリとサービス」から本アプリを見つけて **アクセス権を削除**
3. 本アプリのURLに再度アクセスし、表示される権限承認画面で **すべて許可**

**管理者側の予防策:**
- スコープを追加した場合は、既存デプロイの編集ではなく **新しいバージョンとしてデプロイ** してください。新バージョンでは全ユーザーに再承認が求められます。

### 管理者向け: 診断ツール

Apps Scriptエディタから `diagnoseAuthConfig()` 関数を手動実行すると、以下の設定を一括確認できます:
- `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` の設定状況
- `SLACK_TEAM_ID` の設定状況
- Web App URLの取得可否
- `LOG_SHEET_ID`（認証ログ用スプレッドシート）のアクセス可否
