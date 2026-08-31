# camp-diff 実装計画

## Context

目的は、同じGitリポジトリを編集しているチームメンバーの編集箇所（ファイルパス・行範囲のみ、本文やdiffは一切共有しない）をリアルタイムに共有し、マージ前に衝突の可能性へ早く気づけるようにすること。

同期方式はユーザーの意思決定により
**P2P（WebRTC、シグナリングサーバーはSDP/ICEハンドシェイクの中継のみ）**
に確定している。この計画はその制約の中で、README記載のMVP項目（拡張として動作／同じrepo+branchのメンバー表示／編集中ファイル・行範囲の表示／`.campdiffignore`によるフィルタ／重複範囲の衝突検知／サイドバーとエディタでの警告／サイドバーからのジャンプ）を段階的に実装する。

## アーキテクチャ決定：隠しWebviewブリッジ方式

VS Code拡張のExtension
HostはNode.jsプロセスであり、ネイティブの`RTCPeerConnection`を持たない。2案を比較検討した：

- **(a) 隠しWebviewブリッジ（採用）**:
  バックグラウンドの`WebviewPanel`（Electronのレンダラー＝Chromium、WebRTCフルサポート）内で実際のP2P接続を張り、`postMessage`でExtension
  Hostと橋渡しする。
- (b) `node-datachannel`等のネイティブNode.jsバインディングをExtension
  Host内で直接使う。

**(a)を採用する理由**:
(b)はプラットフォーム/アーキごとのプリビルドバイナリが必要になり、VS
CodeのExtension
Host自体がNode/ElectronのABI変更に弱いこと（`keytar`がまさにこの理由でVS
Codeコアから外された前例がある）を踏まえると、パッケージング・配布の負債が大きい。(a)はChromiumのWebRTCスタックをそのまま使えるため追加バイナリが不要で、`.vsix`はプラットフォーム非依存の小さなJS/TSのみで済む。またWeb版拡張（vscode.dev等）はローカルgit/ファイルシステムへの依存がある時点でどのみち対象外なので、(b)の「UIなしでも動く」利点は本製品では活きない。

**検証済みの懸念点**:
「隠しWebviewは本当にバックグラウンドでメッセージを送受信し続けるか」を公式ドキュメントとGitHub
Issueで確認した。

- VS Code公式ドキュメント: `retainContextWhenHidden: true`のとき「Scripts and
  other dynamic content keep running even when the tab is not active or
  visible」「You can also send messages to a hidden webview when
  retainContextWhenHidden is
  enabled」と明記されており、非表示時もスクリプト実行・メッセージ送受信は継続する。
- 「非表示時にメッセージを受信しない」という趣旨のバグ報告（[microsoft/vscode#47534](https://github.com/microsoft/vscode/issues/47534)）は**2019年5月に修正済みでクローズ**されている。過去の既知バグであり、現行動作の障害ではない。
- 唯一の実コストは公式ドキュメントが明記する「メモリオーバーヘッドが高い」という点のみ。これは想定内のトレードオフとして許容する（小さなバックグラウンドタブを1つ保持する）。

以上により、最大の技術的不確実性だった点は解消済みと判断してよい。ただし実装時にはPhase
2で実機による最終確認を行う（ドキュメント上の保証と実挙動の差異に備える）。

**ライフサイクル設計**:

- `WebviewView`（自前サイドバー内）ではなく`WebviewPanel`（エディタタブ）として作成する。`WebviewView`はコンテナが非表示だと破棄されるため、サイドバーを開いていなくても接続を維持できる`WebviewPanel`の方が適する。
- `retainContextWhenHidden: true`、分かりやすいタブ名（例:「camp-diff
  (background sync)」）、作成後は`.reveal()`しない。
- `panel.onDidDispose`で自動再生成（バックオフ付き）。ユーザーが誤ってタブを閉じた場合やメモリ逼迫による破棄の両方に対応。
- ホスト側から10秒間隔のハートビート（`postMessage({type:'ping'})`、15秒でタイムアウト）を送り、ブリッジが固まっていないか検知しつつ、サイドバーの「●
  Connected / ○ Disconnected」表示のデータソースとする。
- 既知のUX上の妥協点:
  タブバーに「camp-diff」タブが常に1つ表示される。隠す公式APIはないため、ドキュメントで説明する。

## 採用ライブラリ：`y-webrtc` + `y-protocols/awareness`

- `y-webrtc`は「シグナリングサーバー経由でルームの全員が自動的に見つかり合い、フルメッシュP2Pを張る」という要件にほぼそのまま合致する。内部で`simple-peer`を使っており、生の`RTCPeerConnection`を自前実装する必要がない。
- `awareness`プロトコル（y-protocols）は「誰が今どこにいるか」を共有するために作られた非永続の仕組みで、カーソル位置・ユーザー名などのbroadcastが主用途。camp-diffのpresenceペイロード（ファイルパス＋行範囲＋ユーザー名）とほぼ完全に一致する。
- プライバシー要件との整合性:
  シグナリングサーバーはSDP/ICEハンドシェイクのみ中継し、`awareness`の中身は一切見えない（P2Pデータチャネル確立後のみ流れる）。`Y.Doc`（本来は共同編集用の文書データ構造）は空のまま一切使わず、実データはすべて`awareness.setLocalState(...)`のみに載せる。これによりファイル内容が構造的に漏れ得ない設計になる。
- `awareness`はstale
  peer（既定約30秒で更新が止まったpeer）を自動GCする仕組みを内蔵しており、「相手のVS
  Codeが異常終了した場合」に自然に対応できる。加えて10秒間隔で`setLocalStateField`を触るハートビートを追加し、選択範囲を動かしていない間の意図しない期限切れを防ぐ。
- **要フラグの懸念**:
  `y-webrtc`は直近のリリース間隔が空いておりメンテナ1名という状況（Socket.dev調べ）。致命的ではないが長期メンテナンスリスクとして認識し、バージョン固定＋必要なら自前フォークで凌ぐ前提を置く。

## フォルダ構成

```
camp-diff/
  package.json                  # contributes: viewsContainers, views, commands, configuration
  tsconfig.json
  esbuild.js                    # node向け(extension.js) + browser向け(webview/presence-bridge.js) の2バンドル
  eslint.config.mjs
  .vscodeignore
  .vscode/launch.json, tasks.json
  media/icon.svg
  src/
    extension.ts                # activate()/deactivate()、各サービスの配線
    types.ts                    # PresenceState, FileRange, Member, ConflictInfo, RoomInfo
    config.ts                   # campDiff.* 設定の読み取り/監視
    git/
      gitService.ts             # vscode.git APIラップ: remote URL, branch, HEAD, 変更イベント
      roomKey.ts                # remote URL + branch -> 決定的なroom id
    identity/
      identityService.ts        # ユーザー名解決: 設定 -> git config -> プロンプト -> 永続化
    ignore/
      ignoreService.ts          # `ignore`パッケージで.campdiffignoreを読み込み/監視
    presence/
      editorTracker.ts          # 選択範囲/アクティブエディタ追跡 -> ローカルFileRange[]
      presenceStore.ts          # ローカル+リモートawareness stateをマージしたview model
      staleness.ts              # ローカルpresenceのidle/猶予期間による削除
    conflict/
      conflictDetector.ts       # overlap/近接判定の純粋関数（単体テスト可能）
    net/
      signalingConfig.ts        # シグナリングURL/ICEサーバーの解決
      webviewBridge.ts          # 隠しWebviewPanelの生成/再接続/ハートビート/postMessage
      bridgeProtocol.ts         # host<->webviewのメッセージ型定義
      webview/
        presence-bridge.ts      # ブラウザ側スクリプト: y-webrtc Providerとawareness（browserターゲットでバンドル）
        presence-bridge.html    # 最小限のホストページ、CSP（nonce + signaling URLへのconnect-src）
    ui/
      treeDataProvider.ts       # CampDiffTreeProvider: CONFLICTS + MEMBERS セクション
      treeItems.ts              # ConnectionStatusItem, ConflictItem, MemberItem, MemberFileItem
      statusBar.ts
      decorations.ts            # createTextEditorDecorationType による衝突範囲ハイライト
      commands.ts                # campDiff.openLocation, campDiff.setUsername, campDiff.reconnect
  signaling-server/              # 自前ホスト用の別パッケージ
    package.json
    src/server.ts                # y-webrtc同梱のシグナリングリレー（ws）の薄いラッパー
    Dockerfile
    README.md
  test/
    suite/
      conflictDetector.test.ts   # VS Codeホスト不要の純粋単体テスト
      roomKey.test.ts
      ignoreService.test.ts
    extension/extension.test.ts  # @vscode/test-electron による統合テスト
    runTest.ts
```

## フェーズ別実装計画

各フェーズは独立して動作確認できる粒度にする。

**Phase 0 — 雛形**
`package.json`/`tsconfig.json`/`esbuild.js`（node/browserの2ターゲット）、ESLint、`.vscode/launch.json`、ログを出すだけの`activate()`、placeholderの`TreeDataProvider`。
依存: `typescript`, `esbuild`, `@types/vscode`, `@types/node`,
`eslint`+`@typescript-eslint`, `@vscode/test-cli`, `@vscode/test-electron`,
`@vscode/vsce`（すべてdev）。 検証: F5でExtension Development
Hostが開き、Activity Barにアイコン、サイドバーにplaceholder項目が表示される。

**Phase 1 — ローカルのみのpresence（通信なし）**
`identityService`、`editorTracker`（選択範囲、空選択時はカーソル±K行にフォールバック）、ローカルのみの`presenceStore`、ツリーにMEMBERS
> You > ファイル/行範囲を表示、`openLocation`コマンド、ステータス行「○ Offline
(local only)」。 検証:
2つのファイルでテキスト選択→サイドバーの「You」配下がリアルタイム更新、クリックでジャンプ、idleタイムアウトで消える（テスト用に短縮）。

**Phase 2 — WebviewブリッジによるP2P同期（固定の開発用ルーム）**
ローカルのシグナリングサーバー、`webviewBridge.ts` +
`presence-bridge.ts`（y-webrtc Provider + awareness）+
`bridgeProtocol.ts`、`presenceStore`をawarenessに接続。 依存: `y-webrtc`, `yjs`,
`y-protocols`（webviewバンドル側）、`ws`（開発用シグナリングサーバー）。 検証:

1. `npm run dev:signaling`をローカル起動。
2. 同じフォルダを`--user-data-dir`を変えて2つのExtension Development
   Hostウィンドウで開き、それぞれ別ユーザー名を設定、ローカルシグナリングサーバーを指す。
3. ウィンドウAで選択→ウィンドウBのMEMBERSに1〜2秒で反映、逆も同様。
4. **重要な関門**:
   両ウィンドウでpresence用Webviewタブを非アクティブ（他のエディタタブを表示）にした状態で手順3を再現し、バックグラウンドでも更新が伝播することを確認する。
5. ウィンドウAのプロセスを強制終了し、awarenessのstaleタイムアウト内でウィンドウB側からAのpresenceが消えることを確認する。
6. **（セカンドオピニオンレビューでの指摘）同一ユーザーが同じrepoを2ウィンドウで開いた場合**、presenceを`ユーザー+マシンID+プロセスID`でnamespaceし、同一ファイルへの重複報告が矛盾したUI（衝突の点滅など）を起こさないことを確認する。この重複排除ロジックをPhase
   2で設計に含める。

**Phase 3 — Git由来のroom key** `gitService.ts`（`vscode.git`
APIの`getExtension('vscode.git').exports.getAPI(1)`経由）、`roomKey.ts`（正規化したremote
URL + branch）、remote/branch変更時の再接続、実際の「example/app ·
main」ステータス行、`vscode.git`が無効な場合やremote未設定時のフォールバック表示。
検証:
同じ実リポジトリ・ブランチの2ウィンドウが互いを認識、片方がブランチを切り替えるとMEMBERSから消える/戻る、無関係なリポジトリの3つ目のウィンドウは決して表示されない。

**Phase 4 — `.campdiffignore`フィルタ**
`ignoreService.ts`（`ignore`パッケージ）、`FileSystemWatcher`によるライブ再読み込み、`editorTracker`がローカル追跡前にこれを参照。
依存: `ignore`。 検証:
パターン追加→該当ファイルはローカルにも相手にも一切表示されない。否定パターンで再度表示される。`.campdiffignore`をライブ編集して再起動なしで反映される。

**Phase 5 — 衝突検知 + CONFLICTS UI**
`conflictDetector.ts`（メンバー全ペア×ファイルごとのoverlap/近接判定の純粋関数、presence更新のたびに再計算。小規模チーム規模なら十分軽量）、CONFLICTSセクション +
該当MemberFileItemへの⚠バッジ。 検証:
単体テストで境界値（重複、隣接、閾値内、閾値ギリギリ外、別ファイル、自分自身は除外）を確認。2ウィンドウで同一ファイルの重なる範囲を選択→両方のCONFLICTSに1〜2秒で表示、範囲を離すと消える。

**Phase 6 — エディタ装飾 + ナビゲーション**
`createTextEditorDecorationType`で衝突範囲をハイライト＋相手の名前を出すホバー、CONFLICTS/MEMBERS双方からの`openLocation`（未オープンなら開く、`revealRange`）。
検証:
装飾が正しい行・正しいツールチップで表示され、衝突解消で消える。ファイルが開いている/いない両方でナビゲーションが動く。

**Phase 7 — パッケージング・仕上げ** `.vscodeignore`、`vsce package`（Phase
0の設計判断のおかげでプラットフォーム別ビルド不要の単一小さな`.vsix`）、`signaling-server/`のDockerfile＋自前ホスト手順、マーケットプレイス用メタデータ、テレメトリなし（プライバシー方針と一貫）、CI（lint＋単体テスト＋headlessな`@vscode/test-electron`）。
検証: `vsce package`成功、クリーンなプロファイルに`.vsix`をインストールしてPhase
2/5の2ウィンドウテストを再実施（`--extensionDevelopmentPath`限定の前提がないか確認）。

## あいまいな仕様の解釈

- **「行範囲」の定義**:
  選択範囲が空でなければそれを使用。空（カーソルのみ）の場合はカーソル行±3行（`campDiff.cursorContextLines`設定、既定3）にフォールバック。表示中のビューポート全体は採用しない（ただ同じファイルを開いて似た場所をスクロールしているだけで衝突警告が乱発し、アラート疲れを起こすため）。`onDidChangeTextDocument`はテキスト内容を一切使わず、鮮度シグナルとしてのみ利用する（本文が漏れない設計を構造的に保証）。
- **近接判定の閾値**:
  3行以内（`campDiff.conflictProximityLines`、既定3）。gitの標準unified
  diffコンテキスト（`-U3`）に合わせており、行が重ならなくても同じdiffハンクに入り得る距離を根拠にしている。
- **room key**: 正規化したorigin remote
  URL（プロトコル/認証情報/`.git`サフィックス除去、大文字小文字正規化）+
  ブランチ名のSHA-256（切り詰め）。`campDiff.remoteName`設定（既定`origin`）でfork/upstream構成に対応。detached
  HEADはshort commit
  hashを疑似ブランチIDとしてフォールバック。remoteなしリポジトリはMVPでは非対応（無効状態を表示）とする。
- **ユーザー名解決順**: `campDiff.username`設定 → `git config user.name`（Git
  API経由） → OSユーザー名 →
  初回起動時の`showInputBox`プロンプト（結果を永続化）。変更用に`Set Username`コマンドを用意。

## シグナリングサーバー

最小限のWebSocketリレー（`y-webrtc`同梱の`bin/server.js`、または薄い自前ラッパー）。クライアントはroom
keyをtopicとして`subscribe`/`publish`し、サーバーはSDPオファー/アンサー・ICE
candidateのみを同topicの他のsubscriberへ中継する（awarenessのデータには一切触れない）。設定項目:
`campDiff.signalingServerUrls`（冗長化のため配列）、`campDiff.iceServers`（`RTCIceServer[]`のJSON、既定`stun:stun.l.google.com:19302`）、任意で`campDiff.roomPassword`（y-webrtcのアプリ層暗号化、defense-in-depth）。シグナリングサーバーは`wss://`でTLS終端することを推奨。TURN（自前`coturn`等）はMVP後の課題とするが、`iceServers`設定は初日からTURN認証情報を受け付けられる形にしておく。

## リスク・未解決事項

1. **NATトラバーサル**: 企業ネットワーク/VPN配下のチームはsymmetric
   NATでSTUNのみでは接続できないケースが少なくない。TURNは「あれば良い」ではなく「実運用にはほぼ必須」と捉え、MVP後の優先課題として明記する。
2. **誤ってバックグラウンドタブを閉じる**:
   `onDidDispose`での自動再生成・ステータス表示でカバーするが、完全に隠す公式APIはないため根本的な解消はできない。
3. **認証なし**: room keyの計算に必要なのはpublicなremote
   URLとbranch名のみで、正しいkeyを計算できる者は誰でも参加しユーザー名を名乗れる。小規模チーム向けMVPでは許容するが、意図的なnon-goalとして明記する（見落としではない）。
4. **フルメッシュのスケール限界**:
   小規模チーム（〜10数名程度）では問題ないが、人数が増えると接続数が二乗で増える。MVPでは許容し、過剰な設計はしない。
5. **`vscode.git`が無効な場合**:
   無効化されたユーザーには縮退状態を表示するのみで、`git`
   CLIへのフォールバックは今回のスコープ外（必要なら将来検討）。
6. **`y-webrtc`のメンテナンス状況**:
   リリース頻度が低くメンテナ1名。バージョン固定し、必要になれば自前フォークで対応する前提を持っておく。

## 検証方法（全体）

このプロダクトの中核動作はマルチウィンドウ・マルチユーザー前提のため、各フェーズの検証は必ず「同じフォルダを異なる`--user-data-dir`で開いた2つ以上のExtension
Development
Hostウィンドウ」で行う。単体テスト（`conflictDetector`、`roomKey`、`ignoreService`）はVS
Codeホスト不要で`@vscode/test-cli`から実行し、拡張全体の統合テストは`@vscode/test-electron`でheadless実行する。Phase
7では開発時限定の前提が紛れ込んでいないか、実際に`.vsix`をインストールした状態で再確認する。

## 対象ファイル（実装の要）

- `src/net/webviewBridge.ts`
- `src/net/webview/presence-bridge.ts`
- `src/git/roomKey.ts`
- `src/conflict/conflictDetector.ts`
- `src/ui/treeDataProvider.ts`

## 実装時のサブエージェント起動基準

基本方針は「デフォルトは自分で実装する」。単一ファイルの編集やフェーズ内の逐次実装、既存コードの単純な修正ではサブエージェントを介さない。起動は以下の状況に限定する。

- **Plan**: 設計判断に複数案のトレードオフ比較が要るとき。例:
  Webviewブリッジ方式の決定（済）と同様の粒度で、Phase
  5の衝突検知アルゴリズムの詳細設計や、Phase
  2のawareness peer重複排除の設計時に使う。
- **qwen-local**: 各フェーズの実装後、確定前のセカンドオピニオンとして。境界のあるdiffを渡し、findingsは最大3件で返させ、必ず自分でコードと照らして検証してから採否を決める（Phase
  2の「セカンドオピニオンレビューでの指摘」はこのパターンの実例）。
- **fork**: 調べ物の生ログ・生の検索結果を本文脈に残したくないとき。例:
  `y-webrtc`/awarenessのAPI仕様調査、VS
  Code Webviewライフサイクルに関する公式Issue調査（隠しWebviewの検証で行ったのと同種の作業）。
- **Explore**: コードが増えた後、シンボルや参照箇所を横断的に探すとき。Phase
  0時点の空リポジトリでは出番がなく、Phase 1以降で使う。
- **general-purpose**:
  監督不要で完結する大きめの単発作業を明示的に依頼されたときのみ。基本的には使わない想定。

起動しない基準（デフォルト）はプロジェクト規模にも由来する:
小規模チーム向けMVPであり、コンテキストを圧迫するほどの規模にはならないため、通常の実装作業はサブエージェントに委譲せず直接行う。
