# camp-diff signaling server

`y-webrtc`互換の最小WebSocketリレーです。ルームtopicの購読とpublishだけを中継し、presenceのユーザー名・ファイルパス・行範囲はWebRTCのP2Pデータチャネルを通るため、このサーバーでは扱いません。

## 起動

リポジトリルートで依存関係を導入してから起動します。

```powershell
npm install
npm run dev:signaling
```

既定では`ws://localhost:4444`で待ち受けます。`HOST`と`PORT`環境変数で変更できます。本番運用ではリバースプロキシ等でTLS終端し、`wss://`を使ってください。

Dockerでは次のように起動できます。

```powershell
docker build -t camp-diff-signaling ./signaling-server
docker run --rm -p 4444:4444 camp-diff-signaling
```

## 2ウィンドウ疎通確認

Phase 2では全ウィンドウが固定ルーム`campdiff-dev-room`へ参加します。

1. `npm run dev:signaling`を起動したままにする。
2. `npm run watch`を別ターミナルで起動する。
3. 同じ作業対象リポジトリを、異なる`--user-data-dir`を指定した2つのExtension Development Hostで開く。
4. 各ウィンドウで`camp-diff: Set Username`を実行し、異なる名前を設定する。
5. `campDiff.signalingServerUrls`が両方とも`["ws://localhost:4444"]`になっていることを確認する。
6. ウィンドウAでファイルの範囲を選択し、1〜2秒以内にウィンドウBの`MEMBERS`へ反映されることを確認する。逆方向も確認する。
7. 両方で`camp-diff (background sync)`以外のエディタタブをアクティブにし、手順6を繰り返してバックグラウンド同期を確認する。
8. ウィンドウAを強制終了し、awarenessのstaleタイムアウト後にウィンドウBからAが消えることを確認する。
9. 同じユーザー名でも2ウィンドウを開き、各セッションが`hostname`とExtension HostのPIDで区別され、同じセッションが重複表示されないことを確認する。

PowerShellから起動する場合の例です。`code`コマンドのパスは環境に合わせてください。

```powershell
code --new-window --user-data-dir "$env:TEMP\camp-diff-a" --extensions-dir "$env:TEMP\camp-diff-ext-a" --extensionDevelopmentPath="C:\path\to\camp-diff" "C:\path\to\target-repo"
code --new-window --user-data-dir "$env:TEMP\camp-diff-b" --extensions-dir "$env:TEMP\camp-diff-ext-b" --extensionDevelopmentPath="C:\path\to\camp-diff" "C:\path\to\target-repo"
```

`campDiff.roomPassword`を使う場合は両ウィンドウで同じ値にします。企業ネットワークやVPNではSTUNだけでは接続できない場合があるため、その場合は`campDiff.iceServers`にTURNを追加してください。
