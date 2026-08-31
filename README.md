# camp-diff

同じGitリポジトリを編集しているメンバーの作業箇所を共有し、変更の衝突に早く気づくためのVS Code拡張です。

camp-diffが共有するのは、編集中のファイルパスと行範囲です。ファイルの本文や、追加・削除された行のテキストは共有しません。ほかのメンバーと変更箇所が重なったときは、VS Code上で警告します。

> [!NOTE]
> MVPの機能は一通り実装済みです。マーケットプレイスには公開せず、`.vsix`を直接配る内輪向けの拡張として運用します。利用にはシグナリングサーバーの自前ホストが必要です。

## 背景

Gitのコンフリクトは、マージやリベースをするまで気づけないことがあります。同じファイルを並行して編集していると分かっていれば避けられた衝突でも、発見が遅いと変更内容の確認や手直しが必要になります。

camp-diffは、誰がどのファイルのどの辺りを編集中なのかをリアルタイムに表示します。作業が重なった時点で互いに気づけるため、担当箇所の相談や分担変更を早めに行えます。

## 画面

Activity Barにcamp-diffのアイコンを追加し、Primary Side Barにチームの作業状況を表示します。

```text
CAMP DIFF

● Connected
example/app · main

▼ CONFLICTS                         1
  ⚠ src/auth.ts · Lines 42–68
    You ↔ Tanaka

▼ MEMBERS                           3
  ▼ You
      README.md
      src/sidebar.ts

  ▼ Tanaka
    ⚠ src/auth.ts                   L42–68
      src/session.ts                L15–31

  ▶ Suzuki                          1 file
```

メンバー名を展開すると、その人が現在編集しているファイルが表示されます。ファイルを選ぶと自分のワークスペース上の該当箇所へ移動します。

編集範囲が重なっている場合は、`CONFLICTS`とメンバー別のファイル一覧に警告を表示します。警告は編集を止めるものではありません。誰が同じ箇所を触っているかを確認し、必要なら作業を調整できます。

## 共有する情報

- ユーザー名
- リポジトリの識別情報
- ブランチと基準コミット
- 編集中のファイルパス
- 編集中の行範囲
- 最終更新時刻

## 共有しない情報

- ファイルの本文
- Git diffに表示される追加行と削除行のテキスト

## 共有対象の設定

共有したくないファイルは、リポジトリ直下の`.campdiffignore`で指定します。書式は`.gitignore`と同じで、1行につき1つのパターンを記述します。

```gitignore
# ローカル設定
.env*
config/local/

# 鍵や証明書
*.pem
*.key

# 生成物
dist/
coverage/

# 共有対象へ戻す
!.env.example
```

パターンに一致したファイルは、編集中でもほかのメンバーのサイドバーに表示されず、衝突検知の対象にもなりません。`.campdiffignore`はリポジトリにコミットできるため、チーム全体で同じ共有ルールを使えます。

## 想定する流れ

1. VS Codeで対象のGitリポジトリを開き、チームのセッションに参加する
2. camp-diffが`.campdiffignore`を読み込み、共有対象のファイルを決める
3. camp-diffが編集中のファイルと行範囲を検知する
4. ほかのメンバーのVS Codeに作業箇所が反映される
5. 編集範囲が重なった場合、サイドバーとエディタ上に警告が表示される
6. 警告から対象ファイルを開き、相手と作業を調整する

## MVP

- VS Code拡張として動作する
- 同じリポジトリとブランチで作業するメンバーを表示する
- メンバーごとに編集中のファイルと行範囲を表示する
- `.campdiffignore`に一致するファイルを共有対象から外す
- 同じファイル内で重複または近接する編集範囲を検知する
- 衝突の可能性がある箇所をサイドバーとエディタ上で警告する
- サイドバーから対象ファイルと行へ移動できる

## セットアップ

camp-diffはマーケットプレイスに公開していません。`.vsix`をビルドしてチーム内で配布します。

### 1. シグナリングサーバーを1つ立てる

P2P接続はWebRTCのハンドシェイクを中継するシグナリングサーバー経由で確立します。公開サーバーは用意していないため、チームで1つ立ててください。手順は[`signaling-server/README.md`](signaling-server/README.md)にあります（Dockerfile同梱）。中継するのはSDP/ICEだけで、presenceの中身は通りません。

### 2. `.vsix`をビルドして配る

```powershell
git clone https://github.com/YukkuriPannda/camp-diff.git
cd camp-diff
npm install
npm run package         # camp-diff-0.0.1.vsix を生成
```

生成された`.vsix`をメンバーに渡します（GitHubのReleasesに添付する、共有フォルダに置く、など）。

### 3. 各メンバーがインストールする

```powershell
code --install-extension camp-diff-0.0.1.vsix
```

VS Codeの拡張ビューの「...」→「Install from VSIX...」からでも入れられます。

> [!IMPORTANT]
> `.vsix`で入れた拡張は自動更新されません。更新するときは`package.json`の`version`を上げて`.vsix`を配り直し、各メンバーが同じコマンドで再インストールする必要があります。

### 4. 設定を合わせる

チーム全員が同じ`campDiff.signalingServerUrls`を指すようにします。同じリポジトリ・同じブランチで作業しているメンバーだけが同じルームに入ります（ルーム名はremote URLとブランチ名から決まり、サーバーには中身が渡りません）。任意で`campDiff.roomPassword`を全員で揃えておくと、ルーム名を計算できる第三者が紛れ込むのを防げます。

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `campDiff.username` | 空 | 表示名。未設定なら`git config user.name`→OSのユーザー名の順に自動解決します |
| `campDiff.signalingServerUrls` | `["ws://localhost:4444"]` | シグナリングサーバーのURL（冗長化のため配列） |
| `campDiff.iceServers` | Google STUN | `RTCIceServer[]`形式。企業ネットワークではTURNの追加を推奨します |
| `campDiff.roomPassword` | 空 | y-webrtcのアプリ層暗号化に使う任意の共有パスワード |
| `campDiff.remoteName` | `origin` | ルーム名の導出に使うremote名。fork構成では`upstream`などに変更します |
| `campDiff.cursorContextLines` | `3` | 選択範囲が空のとき、カーソル行の前後何行を共有するか |
| `campDiff.conflictProximityLines` | `3` | 重なっていなくても衝突とみなす範囲間の行数 |
| `campDiff.idleTimeoutSeconds` | `120` | 無操作がこの秒数続くと自分の編集箇所を非表示にします |

## プライバシー

- 共有されるのはファイルパスと行範囲だけで、ファイルの本文や差分の中身は一切送信しません。この性質は実装上も担保されており、presenceはすべて`awareness`（非永続の共有状態）にのみ載せ、共同編集用の文書オブジェクトは空のまま使いません。
- シグナリングサーバーが扱うのはWebRTCのSDP/ICEハンドシェイクだけです。presenceの中身はP2Pのデータチャネル確立後にしか流れないため、サーバーからは見えません。
- テレメトリの送信は一切ありません。

## 制限事項

- **認証はありません**。ルーム名の導出にはpublicなremote URLとブランチ名しか使わないため、同じ値を計算できる相手は誰でも参加できます。小規模チーム向けMVPとして意図的に許容しています。
- 企業ネットワークやVPN配下ではSTUNだけでは接続できないことがあります。その場合は`campDiff.iceServers`にTURNを追加してください。
- フルメッシュ接続のため、人数が増えると接続数が二乗で増えます。十数名程度までを想定しています。
- remoteが設定されていないリポジトリ、`vscode.git`拡張が無効な環境では接続せず、サイドバーに縮退状態を表示します。
- バックグラウンド同期用に「camp-diff (background sync)」というタブが常に1つ開きます。これを隠す公式APIがないための仕様です。

## 開発

```powershell
npm install
npm run watch              # esbuildのウォッチ（F5でExtension Development Hostを起動）
npm run lint
npm run compile            # tscによる型チェックのみ
npm test                   # 単体テスト（VS Codeホスト上で実行）
npm run test:integration   # 実WebRTCでのP2P疎通・衝突検知の統合テスト
npm run test:package       # .vsixを生成しクリーンなプロファイルで起動確認
```
