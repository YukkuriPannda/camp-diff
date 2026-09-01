# camp-diff クラス図（ドラフト）

`docs/implementation-plan.md` のフォルダ構成をもとにした、主要クラス/モジュールの関係図。Extension Host・Webview・ネットワークの3領域に分けて表示している。試作段階のスケッチなので、実装が進んだら乖離がないか見直すこと。

```mermaid
classDiagram
    namespace ExtensionHost {
        class GitService {
            +getRemoteUrl() string
            +getBranch() string
            +getHeadCommit() string
        }
        class RoomKey {
            +compute(remoteUrl, branch) string
        }
        class IdentityService {
            +resolveUsername() string
            +setUsername(name)
        }
        class IgnoreService {
            +isIgnored(path) bool
            +reload()
        }
        class DiffService {
            +refresh()
        }
        class DiffParser {
            +parseUnifiedDiffRanges(diff) FileRange[]
        }
        class PresenceStore {
            -localState PresenceState
            -remoteStates Map~string, PresenceState~
            +merge(update)
        }
        class ConflictDetector {
            +detectConflicts(members) ConflictInfo[]
        }
        class WebviewBridge {
            +postMessage(msg)
            +reconnect()
        }
        class TreeDataProvider {
            +getChildren() TreeItem[]
            +getTreeItem() TreeItem
        }
        class DecorationController {
            +applyDecorations(conflicts)
        }
        class StatusBarController {
            +update(status)
        }
    }

    namespace Webview {
        class PresenceBridge {
            <<browser script>>
        }
        class YWebrtcProvider {
            <<third-party>>
            +awareness
        }
    }

    namespace Network {
        class SignalingServer {
            <<external>>
            +relay(sdp, ice)
        }
        class TeammatePeer {
            <<mirrored instance>>
        }
    }

    class PresenceState {
        +username string
        +ranges FileRange[]
        +timestamp number
    }
    class FileRange {
        +path string
        +startLine number
        +endLine number
    }
    class ConflictInfo {
        +path string
        +members string[]
        +range FileRange
    }

    GitService --> RoomKey : remote + branch
    RoomKey --> WebviewBridge : room id
    IdentityService --> PresenceStore : username
    IgnoreService --> DiffService : filters
    GitService --> DiffService : repository root + git path
    DiffParser --> DiffService : FileRange[]
    DiffService --> PresenceStore : local FileRange[]
    PresenceStore --> ConflictDetector : Member[]
    PresenceStore --> TreeDataProvider : Member[]
    ConflictDetector --> TreeDataProvider : ConflictInfo[]
    ConflictDetector --> DecorationController : ConflictInfo[]
    WebviewBridge --> StatusBarController : connection heartbeat
    PresenceStore --> WebviewBridge : local presence out
    WebviewBridge --> PresenceStore : remote presence in
    WebviewBridge --> PresenceBridge : postMessage (host to webview)
    PresenceBridge --> WebviewBridge : postMessage (webview to host)
    PresenceBridge --> YWebrtcProvider : setLocalState / on(change)
    YWebrtcProvider ..> SignalingServer : SDP/ICE handshake only
    YWebrtcProvider --> TeammatePeer : WebRTC data channel (P2P)

    PresenceStore o-- PresenceState
    PresenceState o-- FileRange
    ConflictDetector ..> ConflictInfo
```

## 見方

- **ExtensionHost**: Node.jsプロセス側のクラス群。`docs/implementation-plan.md`のフォルダ構成にある`src/git`〜`src/ui`に対応。
- **Webview**: 隠しWebviewPanel内で動くブラウザ側スクリプト。`y-webrtc`は自前クラスではなくサードパーティ。
- **Network**: シグナリングサーバー（SDP/ICEの中継のみ）とチームメイト側のインスタンス（同じ構造のミラー）。
- `WebviewBridge`⇄`PresenceBridge`間の`postMessage`が、Extension HostとWebviewというプロセス境界を越える唯一の経路。
- `YWebrtcProvider`から先、実際のpresenceデータ（ファイルパス・行範囲）が流れるのは`TeammatePeer`への実線（WebRTC data channel）のみで、シグナリングサーバーへは点線（ハンドシェイクのみ）にとどまる。
