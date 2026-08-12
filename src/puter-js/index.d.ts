// The published type surface of puter.js.
//
// This is the only hand-written declaration file in the package: it names what
// the SDK exports and nothing more. Every type it re-exports is generated from
// the JSDoc in `src/` by `npm run build:types` — edit the JSDoc, not `types/`.

import type { Puter } from './types/index.js';

export type { Puter };
export { puter, default } from './types/index.js';

declare global {
    interface Window {
        puter: Puter;
    }
}

// -- Shared --
export type {
    APILoggingConfig,
    ListPage,
    ListPaginationOptions,
    ListStreamOptions,
    PaginatedResult,
    PaginationOptions,
    PuterEnvironment,
    RequestCallbacks,
    ToolSchema,
} from './types/lib/types.js';
export type { default as APICallLogger } from './types/lib/APICallLogger.js';

// -- puter.ai --
export type {
    AIMessageContent,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatResponseChunk,
    ImageContent,
    Img2TxtOptions,
    ListTTSEnginesOptions,
    ListTTSVoicesOptions,
    Speech2SpeechOptions,
    Speech2TxtOptions,
    Speech2TxtResult,
    Speech2TxtWord,
    StreamingChatOptions,
    TextFormatSpeech2TxtOptions,
    Tool,
    ToolCall,
    TTSEngine,
    TTSVoice,
    Txt2ImgOptions,
    Txt2SpeechOptions,
    Txt2VidOptions,
} from './types/modules/ai/types.js';
export type { Txt2Speech } from './types/modules/ai/index.js';

// -- puter.apps --
export type {
    App,
    AppListOptions,
    AppUser,
    CheckAppNameResult,
    CreateAppOptions,
    CreateAppResult,
    GetUsersOptions,
    UpdateAppAttributes,
} from './types/modules/apps/types.js';

// -- puter.auth --
export type {
    AllowanceInfo,
    APIUsage,
    AppUsage,
    DetailedAppUsage,
    MonthlyUsage,
    SignInResult,
    User,
} from './types/modules/Auth.js';

// -- puter.debug --
export type { Debug } from './types/modules/Debug.js';

// -- puter.drivers --
export type { Driver } from './types/modules/Drivers.js';

// -- puter.email --
export type {
    EmailAttachment,
    EmailSendOptions,
    EmailSendResult,
} from './types/modules/Email.js';

// -- puter.fs --
export type {
    CopyOptions,
    DeleteOptions,
    MkdirOptions,
    MoveOptions,
    ReadOptions,
    ReaddirOptions,
    RenameOptions,
    SignResult,
    SpaceInfo,
    StatOptions,
    UploadBatchError,
    UploadItems,
    UploadOperationResult,
    UploadOptions,
    WriteOptions,
} from './types/modules/FileSystem/types.js';
export type {
    FileSignatureInfo,
    FSItem,
    InternalFSProperties,
} from './types/modules/FSItem.js';

// -- puter.hosting --
export type { Subdomain } from './types/modules/hosting/types.js';

// -- puter.kv --
export type {
    KVAddPath,
    KVIncrementPath,
    KVListOptions,
    KVListPage,
    KVListPaginationOptions,
    KVListStreamOptions,
    KVOptConfig,
    KVPair,
    KVScalar,
    KVSetBatch,
    KVSetItem,
    KVSetObject,
    KVUpdateObject,
    KVUpdatePath,
    KVValue,
} from './types/modules/kv/types.js';

// -- puter.net --
export type { Networking, SocketEvent } from './types/modules/networking/types.js';
export type { PSocket } from './types/modules/networking/PSocket.js';
export type { PTLSSocket } from './types/modules/networking/PTLS.js';

// -- puter.os --

// -- puter.peer --
export type {
    PuterPeerConnection,
    PuterPeerDescription,
    PuterPeerIceCandidate,
    PuterPeerMessage,
    PuterPeerOptions,
    PuterPeerServer,
    PuterPeerUser,
} from './types/modules/Peer.js';

// -- puter.perms --
export type {
    AppDataClass,
    AppDataFsScope,
    AppDataKvScope,
    AppDataScopePair,
    AppDataScopes,
    AppDataStore,
} from './types/modules/perms/types.js';

// -- puter.ui --
export type { AppConnection } from './types/modules/UI.js';
export type {
    AlertButton,
    AlertOptions,
    AppConnectionCloseEvent,
    CancelAwarePromise,
    ColorPickerOptions,
    ConnectionEvent,
    ContextMenuItem,
    ContextMenuOptions,
    DirectoryPickerOptions,
    FilePickerOptions,
    FontPickerOptions,
    LaunchAppOptions,
    LaunchAppResult,
    MenuItem,
    MenubarOptions,
    NotificationOptions,
    PromptOptions,
    ThemeData,
    WindowHandle,
    WindowIdentifier,
    WindowOptions,
} from './types/modules/UI.js';

// -- puter.util --
export type { default as Util, UtilRPC } from './types/modules/Util.js';

// -- puter.workers --
export type {
    WorkerDeployment,
    WorkerInfo,
} from './types/modules/Workers.js';

// -- Module instance types --
//
// Each `puter.<module>` handle. Named here rather than re-exported, because the
// generated modules export a constructor value plus its constructor type, and
// what a consumer annotates with is the instance.

export type AI = InstanceType<import('./types/modules/ai/index.js').AIConstructor>;
export type Apps = InstanceType<import('./types/modules/apps/index.js').AppsConstructor>;
export type Auth = InstanceType<import('./types/modules/Auth.js').AuthConstructor>;
export type Drivers = InstanceType<import('./types/modules/Drivers.js').DriversConstructor>;
export type Email = InstanceType<import('./types/modules/Email.js').EmailConstructor>;
export type FS = InstanceType<import('./types/modules/FileSystem/index.js').FSConstructor>;
export type Hosting = InstanceType<import('./types/modules/hosting/index.js').HostingConstructor>;
export type KV = InstanceType<import('./types/modules/kv/index.js').KVConstructor>;
export type OS = InstanceType<import('./types/modules/os/index.js').OSConstructor>;
export type Peer = InstanceType<import('./types/modules/Peer.js').PeerConstructor>;
export type Perms = InstanceType<import('./types/modules/perms/index.js').PermsConstructor>;
export type UI = InstanceType<import('./types/modules/UI.js').UIConstructor>;
export type WorkersHandler = InstanceType<import('./types/modules/Workers.js').WorkersConstructor>;
