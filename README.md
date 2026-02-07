
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
