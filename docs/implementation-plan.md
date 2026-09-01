# camp-diff 実装方針

## 目的

同じGitリポジトリ・ブランチで作業するメンバーの変更箇所を共有し、マージ前に衝突候補へ気づけるようにします。ファイル本文や差分テキストは送信しません。

## 現在の同期方式

- Extension Hostから`ws`でチームの中継サーバーへ直接接続します。
- remote URLとブランチから導出したroom keyをtopicとして購読します。
- 10秒ごとのheartbeatと30秒のstale判定で異常終了したメンバーを除去します。
- 複数の`campDiff.signalingServerUrls`へ接続でき、切断時は指数バックオフで再接続します。
- Webview、WebviewPanel、別ウィンドウ、ネイティブWebRTCモジュールは使いません。

WebviewPanelは非表示でも動作を維持できますが、通常のエディタタブを必ず作ります。WebviewViewはサイドバーが非表示になるとスクリプトが停止します。常時同期と「画面を出さない」を両立するため、通信をExtension Hostへ移しました。

## 共有範囲

- 常時共有: セッションID、表示名、変更中のファイルパス、更新時刻。
- オンデマンド共有: 行範囲。相手が「メンバー > ファイル名」を展開している間だけ、そのファイルの範囲を送ります。
- 共有しない: ファイル本文、追加・削除されたテキスト、Git資格情報。

要求とpresenceはroom全体へbroadcastされます。受信側は自分が展開していないファイルの範囲を画面および`PresenceStore`へ渡しません。

## セキュリティ

`campDiff.roomPassword`を設定すると、presence payloadをscryptで導出した鍵とAES-256-GCMで暗号化してから中継します。同じroom keyとパスワードを持つクライアントだけが復号できます。パスワード未設定時は中継サーバーから内容を読めるため、本番では共有パスワードと`wss://`を推奨します。

認証はありません。room keyと共有パスワードを知るクライアントは任意の表示名やpresenceを送信できます。

## 主な実装

- `src/net/presenceBridge.ts`: 接続、再接続、heartbeat、stale除去、オンデマンド範囲制御。
- `src/net/relayProtocol.ts`: 中継メッセージの検証と暗号化・復号。
- `src/net/presenceProtocol.ts`: 受信presenceのランタイム検証。
- `signaling-server/src/server.ts`: topic単位のsubscribe/publish中継。永続化なし。
- `test/extension/suite/presenceBridge.test.ts`: 実WebSocketを使う双方向presence・行範囲・衝突検知の統合テスト。
- `test/package/suite/installedExtension.test.ts`: クリーンなVSIXが起動し、同期タブを作らないことの検証。
