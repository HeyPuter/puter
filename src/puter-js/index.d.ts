import type { Puter } from './types/puter.d.ts';
import type { AI, ChatMessage, ChatOptions, ChatResponse, ChatResponseChunk, Img2TxtOptions, Speech2SpeechOptions, Speech2TxtOptions, Txt2ImgOptions, Txt2SpeechCallable, Txt2SpeechOptions, Txt2VidOptions } from './types/modules/ai.d.ts';
import type { Apps, AppListOptions, AppRecord, CreateAppOptions, UpdateAppAttributes } from './types/modules/apps.d.ts';
import type { Auth, APIUsage, AllowanceInfo, AppUsage, AuthUser, DetailedAppUsage, MonthlyUsage } from './types/modules/auth.d.ts';
import type { Debug } from './types/modules/debug.d.ts';
import type { Driver, DriverDescriptor, Drivers } from './types/modules/drivers.d.ts';
import type { FS, CopyOptions, DeleteOptions, MkdirOptions, MoveOptions, ReadOptions, ReaddirOptions, SignResult, SpaceInfo, UploadOptions, WriteOptions } from './types/modules/filesystem.d.ts';
import type { FSItem, FileSignatureInfo, InternalFSProperties } from './types/modules/fs-item.d.ts';
import type { Hosting, Subdomain } from './types/modules/hosting.d.ts';
import type { KV, KVIncrementPath, KVPair } from './types/modules/kv.d.ts';
import type { Networking, PSocket, PTLSSocket } from './types/modules/networking.d.ts';
import type { OS } from './types/modules/os.d.ts';
import type { Perms } from './types/modules/perms.d.ts';
import type { AlertButton, AppConnection, AppConnectionCloseEvent, CancelAwarePromise, ContextMenuItem, ContextMenuOptions, DirectoryPickerOptions, FilePickerOptions, LaunchAppOptions, MenuItem, MenubarOptions, ThemeData, UI, WindowOptions } from './types/modules/ui.d.ts';
import type Util, { UtilRPC } from './types/modules/util.d.ts';
import type { WorkerDeployment, WorkerInfo, WorkersHandler } from './types/modules/workers.d.ts';
import type { APICallLogger, APILoggingConfig, PaginationOptions, PaginatedResult, PuterEnvironment, RequestCallbacks, ToolSchema } from './types/shared.d.ts';

declare global {
    interface Window {
        puter: Puter;
    }
}

declare const puter: Puter;

export default puter;
export { puter };

export type {
    AI,
    APIUsage,
    APICallLogger,
    APILoggingConfig,
    AlertButton,
    AllowanceInfo,
    CancelAwarePromise,
    AppConnection,
    AppConnectionCloseEvent,
    AppListOptions,
    AppRecord,
    AppUsage,
    Apps,
    Auth,
    AuthUser,
    ChatMessage,
    ChatOptions,
    ChatResponse,
    ChatResponseChunk,
    ContextMenuItem,
    ContextMenuOptions,
    CopyOptions,
    CreateAppOptions,
    Debug,
    DeleteOptions,
    DetailedAppUsage,
    DirectoryPickerOptions,
    Driver,
    DriverDescriptor,
    Drivers,
    FSItem,
    FilePickerOptions,
    FileSignatureInfo,
    Hosting,
    Img2TxtOptions,
    InternalFSProperties,
    KV,
    KVIncrementPath,
    KVPair,
    LaunchAppOptions,
    MenuItem,
    MenubarOptions,
    MkdirOptions,
    MonthlyUsage,
    MoveOptions,
    Networking,
    OS,
    PaginatedResult,
    PaginationOptions,
    Perms,
    PSocket,
    PTLSSocket,
    Puter,
    PuterEnvironment,
    FS,
    ReadOptions,
    ReaddirOptions,
    RequestCallbacks,
    SignResult,
    SpaceInfo,
    Speech2SpeechOptions,
    Speech2TxtOptions,
    Subdomain,
    ThemeData,
    ToolSchema,
    Txt2ImgOptions,
    Txt2SpeechCallable,
    Txt2SpeechOptions,
    Txt2VidOptions,
    UI,
    UpdateAppAttributes,
    UploadOptions,
    Util,
    UtilRPC,
    WindowOptions,
    WorkerDeployment,
    WorkerInfo,
    WorkersHandler,
    WriteOptions,
    Puter
};

// NOTE: Provider-specific response bodies (AI, drivers, workers logging stream) intentionally
// remain loosely typed because the SDK does not yet expose stable shapes for those payloads.
