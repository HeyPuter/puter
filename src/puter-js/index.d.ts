// index.d.ts

declare global {
    interface Window {
        puter: Puter;
    }
}

declare class Puter {
    // Properties
    appID: string;
    env: 'app' | 'web' | 'gui' | 'nodejs' | 'service-worker';

    // Utility methods
    print(text: string, options?: { code?: boolean }): void;
    randName(separator?: string): string;
    exit(statusCode?: number): void;

    // Sub-modules
    ai: AI;
    apps: Apps;
    auth: Auth;
    drivers: Drivers;
    fs: FileSystem;
    hosting: Hosting;
    kv: KV;
    net: Networking;
    perms: Permissions;
    ui: UI;
    workers: Workers;
}

// AI Module
interface AI {
    // Streaming overloads
    chat(prompt: string, options: StreamingChatOptions): AsyncIterable<ChatResponseChunk>;
    chat(prompt: string, testMode: boolean, options: StreamingChatOptions): AsyncIterable<ChatResponseChunk>;
    chat(prompt: string, imageURL: string, testMode: boolean, options: StreamingChatOptions): AsyncIterable<ChatResponseChunk>;
    chat(prompt: string, imageURLArray: string[], testMode: boolean, options: StreamingChatOptions): AsyncIterable<ChatResponseChunk>;
    chat(messages: ChatMessage[], testMode: boolean, options: StreamingChatOptions): AsyncIterable<ChatResponseChunk>;

    // Non-streaming overloads
    chat(prompt: string, options?: NonStreamingChatOptions): Promise<ChatResponse>;
    chat(prompt: string, testMode?: boolean, options?: NonStreamingChatOptions): Promise<ChatResponse>;
    chat(prompt: string, imageURL?: string, testMode?: boolean, options?: NonStreamingChatOptions): Promise<ChatResponse>;
    chat(prompt: string, imageURLArray?: string[], testMode?: boolean, options?: NonStreamingChatOptions): Promise<ChatResponse>;
    chat(messages: ChatMessage[], testMode?: boolean, options?: NonStreamingChatOptions): Promise<ChatResponse>;

    img2txt(image: string | File | Blob, testMode?: boolean): Promise<string>;

    txt2img(prompt: string, testMode?: boolean): Promise<HTMLImageElement>;
    txt2img(prompt: string, options?: Txt2ImgOptions): Promise<HTMLImageElement>;

    txt2vid(prompt: string, testMode?: boolean): Promise<HTMLVideoElement>;
    txt2vid(prompt: string, options?: Txt2VidOptions): Promise<HTMLVideoElement>;

    txt2speech(text: string): Promise<HTMLAudioElement>;
    txt2speech(text: string, options?: Txt2SpeechOptions): Promise<HTMLAudioElement>;
    txt2speech(text: string, language?: string): Promise<HTMLAudioElement>;
    txt2speech(text: string, language?: string, voice?: string): Promise<HTMLAudioElement>;
    txt2speech(text: string, language?: string, voice?: string, engine?: string): Promise<HTMLAudioElement>;

    speech2txt(source: string | File | Blob): Promise<string | Speech2TxtResult>;
    speech2txt(source: string | File | Blob, options?: Speech2TxtOptions): Promise<string | Speech2TxtResult>;
    speech2txt(options: Speech2TxtOptions): Promise<string | Speech2TxtResult>;
    speech2txt(source: string | File | Blob, testMode?: boolean): Promise<string | Speech2TxtResult>;
    speech2txt(source: Speech2TxtOptions, testMode?: boolean): Promise<string | Speech2TxtResult>;
}

type StreamingChatOptions = Omit<ChatOptions, "stream"> & { stream: true };
type NonStreamingChatOptions = Omit<ChatOptions, "stream"> & { stream?: false | undefined };

interface ChatOptions {
    model?: string;
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
    tools?: ToolDefinition[];
}

interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
        strict?: boolean;
    };
}

interface ChatMessage {
    role: 'system' | 'assistant' | 'user' | 'function' | 'tool';
    content: string | ContentObject[];
    tool_call_id?: string;
}

interface ContentObject {
    type: 'text' | 'file';
    text?: string;
    puter_path?: string;
}

interface ChatResponse {
    message: {
        role: string;
        content: string;
        tool_calls?: ToolCall[];
    };
}

interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

interface Txt2ImgOptions {
    model?: 'gpt-image-1' | 'gpt-image-1-mini' | 'gemini-2.5-flash-image-preview' | 'dall-e-3';
    quality?: 'high' | 'medium' | 'low' | 'hd' | 'standard';
    input_image?: string;
    input_image_mime_type?: string;
}

interface Txt2VidOptions {
    prompt?: string;
    model?: string;
    duration?: number;
    seconds?: number;
    size?: string;
    resolution?: string;
    width?: number;
    height?: number;
    fps?: number;
    steps?: number;
    guidance_scale?: number;
    seed?: number;
    output_format?: string;
    output_quality?: number;
    negative_prompt?: string;
    reference_images?: string[];
    frame_images?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    provider?: string;
    service?: string;
    driver?: string;
    test_mode?: boolean;
}

interface Txt2SpeechOptions {
    language?: string;
    voice?: string;
    engine?: 'standard' | 'neural' | 'long-form' | 'generative' | string;
    provider?: 'aws-polly' | 'openai' | string;
    model?: 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd' | string;
    response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | string;
    instructions?: string;
}

interface Speech2TxtOptions {
    file?: string | File | Blob;
    audio?: string | File | Blob;
    model?: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'gpt-4o-transcribe-diarize' | 'whisper-1' | string;
    response_format?: 'json' | 'text' | 'diarized_json' | 'srt' | 'verbose_json' | 'vtt' | string;
    language?: string;
    prompt?: string;
    temperature?: number;
    logprobs?: boolean;
    timestamp_granularities?: string[];
    translate?: boolean;
    stream?: boolean;
    chunking_strategy?: string;
    known_speaker_names?: string[];
    known_speaker_references?: string[];
    extra_body?: Record<string, unknown>;
}

interface Speech2TxtResult {
    text?: string;
    language?: string;
    segments?: Array<Record<string, unknown>>;
    [key: string]: any;
}

interface ChatResponseChunk {
    text?: string;
    [key: string]: any;
}

// Apps Module
interface Apps {
    create(name: string, indexURL: string): Promise<App>;
    create(name: string, indexURL: string, title?: string): Promise<App>;
    create(name: string, indexURL: string, title?: string, description?: string): Promise<App>;
    create(options: CreateAppOptions): Promise<App>;

    delete(name: string): Promise<App>;
    get(name: string, options?: GetAppOptions): Promise<App>;
    list(options?: ListAppOptions): Promise<App[]>;
    update(name: string, attributes: UpdateAppAttributes): Promise<App>;
}

interface CreateAppOptions {
    name: string;
    indexURL: string;
    title?: string;
    description?: string;
    icon?: string;
    maximizeOnStart?: boolean;
    filetypeAssociations?: string[];
    dedupeName?: boolean;
}

interface GetAppOptions {
    stats_period?: StatsPeriod;
    icon_size?: null | 16 | 32 | 64 | 128 | 256 | 512;
}

interface ListAppOptions extends GetAppOptions { }

interface UpdateAppAttributes {
    name?: string;
    indexURL?: string;
    title?: string;
    description?: string;
    icon?: string;
    maximizeOnStart?: boolean;
    filetypeAssociations?: string[];
}

type StatsPeriod = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'month_to_date' | 'year_to_date' | 'last_12_months';

interface App {
    uid: string;
    name: string;
    icon: string;
    description: string;
    title: string;
    maximize_on_start: boolean;
    index_url: string;
    created_at: string;
    background: boolean;
    filetype_associations: string[];
    open_count: number;
    user_count: number;
}

// Auth Module
interface Auth {
    signIn(options?: { attempt_temp_user_creation?: boolean }): Promise<boolean>;
    signOut(): void;
    isSignedIn(): boolean;
    getUser(): Promise<User>;
    getMonthlyUsage(): Promise<MonthlyUsage>;
    getDetailedAppUsage(appId: string): Promise<DetailedAppUsage>;
}

interface User {
    uuid: string;
    username: string;
    email_confirmed: boolean;
}

interface AllowanceInfo {
    monthUsageAllowance: number;
    remaining: number;
}

interface AppUsage {
    count: number;
    total: number;
}

interface APIUsage {
    cost: number;
    count: number;
    units: number;
}

interface MonthlyUsage {
    allowanceInfo: AllowanceInfo;
    appTotals: Record<string, AppUsage>;
    usage: Record<string, APIUsage>;
}

interface DetailedAppUsage {
    total: number;
    [key: string]: APIUsage;
}

// Drivers Module
interface Drivers {
    call(interface: string, driver: string, method: string, args?: object): Promise<any>;
}

// FileSystem Module
interface FileSystem {
    copy(source: string, destination: string, options?: CopyOptions): Promise<FSItem>;
    delete(path: string, options?: DeleteOptions): Promise<void>;
    getReadURL(path: string, expiresIn?: number): Promise<string>;
    mkdir(path: string, options?: MkdirOptions): Promise<FSItem>;
    move(source: string, destination: string, options?: MoveOptions): Promise<FSItem>;
    read(path: string, options?: ReadOptions): Promise<Blob>;
    readdir(path: string, options?: ReaddirOptions): Promise<FSItem[]>;
    readdir(options?: ReaddirOptions): Promise<FSItem[]>;
    rename(path: string, newName: string): Promise<FSItem>;
    space(): Promise<SpaceInfo>;
    stat(path: string): Promise<FSItem>;
    upload(items: FileList | File[] | Blob[], dirPath?: string, options?: UploadOptions): Promise<FSItem[]>;
    write(path: string, data?: string | File | Blob, options?: WriteOptions): Promise<FSItem>;
}

interface CopyOptions {
    overwrite?: boolean;
    dedupeName?: boolean;
    newName?: string;
}

interface DeleteOptions {
    recursive?: boolean;
    descendantsOnly?: boolean;
}

interface MkdirOptions {
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
}

interface MoveOptions extends CopyOptions {
    createMissingParents?: boolean;
}

interface ReadOptions {
    offset?: number;
    byte_count?: number;
}

interface ReaddirOptions {
    path?: string;
    uid?: string;
}

interface WriteOptions {
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
}

interface UploadOptions {
    overwrite?: boolean;
    dedupeName?: boolean;
    name?: string;
}

interface SpaceInfo {
    capacity: number;
    used: number;
}

interface FSItem {
    id: string;
    uid: string;
    name: string;
    path: string;
    is_dir: boolean;
    parent_id: string;
    parent_uid: string;
    created: number;
    modified: number;
    accessed: number;
    size: number | null;
    writable: boolean;
    read(): Promise<Blob>;
    readdir(): Promise<FSItem[]>;
}

// Hosting Module
interface Hosting {
    create(subdomain: string, dirPath?: string): Promise<Subdomain>;
    delete(subdomain: string): Promise<boolean>;
    get(subdomain: string): Promise<Subdomain>;
    list(): Promise<Subdomain[]>;
    update(subdomain: string, dirPath?: string): Promise<Subdomain>;
}

interface Subdomain {
    uid: string;
    subdomain: string;
    root_dir: FSItem;
}

// Key-Value Store Module
interface KV {
    set(key: string, value: string | number | boolean | object | any[]): Promise<boolean>;
    get(key: string): Promise<any>;
    del(key: string): Promise<boolean>;
    incr(key: string, pathAndAmount: { [key: string]: number }): Promise<number>;
    incr(key: string, amount?: number): Promise<number>;
    decr(key: string, pathAndAmount: { [key: string]: number }): Promise<number>;
    decr(key: string, amount?: number): Promise<number>;
    list(pattern?: string, returnValues?: boolean): Promise<string[] | KVPair[]>;
    list(returnValues?: boolean): Promise<string[] | KVPair[]>;
    flush(): Promise<boolean>;
}

interface KVPair {
    key: string;
    value: any;
}

// Networking Module
interface Networking {
    fetch(url: string, options?: RequestInit): Promise<Response>;
    Socket: typeof Socket;
    tls: {
        TLSSocket: typeof TLSSocket;
    };
}

declare class Socket {
    constructor(hostname: string, port: number);
    write(data: ArrayBuffer | Uint8Array | string): void;
    close(): void;
    on(event: 'open', callback: () => void): void;
    on(event: 'data', callback: (buffer: Uint8Array) => void): void;
    on(event: 'error', callback: (reason: string) => void): void;
    on(event: 'close', callback: (hadError: boolean) => void): void;
}

declare class TLSSocket extends Socket {
    constructor(hostname: string, port: number);
}

// Permissions Module
interface Permissions {
    grantApp(app_uid: string, permissionString: string): Promise<object>;
    grantAppAnyUser(app_uid: string, permissionString: string): Promise<object>;
    grantGroup(group_uid: string, permissionString: string): Promise<object>;
    grantOrigin(origin: string, permissionString: string): Promise<object>;
    grantUser(username: string, permissionString: string): Promise<object>;
    revokeApp(app_uid: string, permissionString: string): Promise<object>;
    revokeAppAnyUser(app_uid: string, permissionString: string): Promise<object>;
    revokeGroup(group_uid: string, permissionString: string): Promise<object>;
    revokeOrigin(origin: string, permissionString: string): Promise<object>;
    revokeUser(username: string, permissionString: string): Promise<object>;
}

// UI Module
interface UI {
    alert(message?: string, buttons?: AlertButton[]): Promise<string>;
    prompt(message?: string, defaultValue?: string): Promise<string | null>;
    authenticateWithPuter(): Promise<boolean>;
    contextMenu(options: ContextMenuOptions): void;
    createWindow(options?: WindowOptions): void;
    exit(statusCode?: number): void;
    getLanguage(): Promise<string>;
    hideSpinner(): void;
    launchApp(appName?: string, args?: object): Promise<AppConnection>;
    launchApp(options: LaunchAppOptions): Promise<AppConnection>;
    on(eventName: 'localeChanged', handler: (data: { language: string }) => void): void;
    on(eventName: 'themeChanged', handler: (data: ThemeData) => void): void;
    onItemsOpened(handler: (items: FSItem[]) => void): void;
    onLaunchedWithItems(handler: (items: FSItem[]) => void): void;
    onWindowClose(handler: () => void): void;
    parentApp(): AppConnection | null;
    setMenubar(options: MenubarOptions): void;
    setWindowHeight(height: number): void;
    setWindowPosition(x: number, y: number): void;
    setWindowSize(width: number, height: number): void;
    setWindowTitle(title: string): void;
    setWindowWidth(width: number): void;
    setWindowX(x: number): void;
    setWindowY(y: number): void;
    showColorPicker(defaultColor?: string): Promise<string>;
    showColorPicker(options?: object): Promise<string>;
    showDirectoryPicker(options?: { multiple?: boolean }): Promise<FSItem | FSItem[]>;
    showFontPicker(defaultFont?: string): Promise<{ fontFamily: string }>;
    showFontPicker(options?: object): Promise<{ fontFamily: string }>;
    showOpenFilePicker(options?: FilePickerOptions): Promise<FSItem | FSItem[]>;
    showSaveFilePicker(data?: any, defaultFileName?: string): Promise<FSItem>;
    showSpinner(): void;
    socialShare(url: string, message?: string, options?: { left?: number; top?: number }): void;
    wasLaunchedWithItems(): boolean;
}

interface AlertButton {
    label: string;
    value?: string;
    type?: 'primary' | 'success' | 'info' | 'warning' | 'danger';
}

interface ContextMenuOptions {
    items: (ContextMenuItem | '-')[];
}

interface ContextMenuItem {
    label: string;
    action?: () => void;
    icon?: string;
    icon_active?: string;
    disabled?: boolean;
    items?: (ContextMenuItem | '-')[];
}

interface WindowOptions {
    center?: boolean;
    content?: string;
    disable_parent_window?: boolean;
    has_head?: boolean;
    height?: number;
    is_resizable?: boolean;
    show_in_taskbar?: boolean;
    title?: string;
    width?: number;
}

interface LaunchAppOptions {
    name?: string;
    args?: object;
}

interface ThemeData {
    palette: {
        primaryHue: number;
        primarySaturation: string;
        primaryLightness: string;
        primaryAlpha: number;
        primaryColor: string;
    };
}

interface MenubarOptions {
    items: MenuItem[];
}

interface MenuItem {
    label: string;
    action?: () => void;
    items?: MenuItem[];
}

interface FilePickerOptions {
    multiple?: boolean;
    accept?: string | string[];
}

interface AppConnection {
    usesSDK: boolean;
    on(eventName: 'message', handler: (message: any) => void): void;
    on(eventName: 'close', handler: (data: { appInstanceID: string }) => void): void;
    off(eventName: string, handler: Function): void;
    postMessage(message: any): void;
    close(): void;
}

// Workers Module
interface Workers {
    create(workerName: string, filePath: string): Promise<WorkerDeployment>;
    delete(workerName: string): Promise<boolean>;
    exec(workerURL: string, options?: WorkerExecOptions): Promise<Response>;
    get(workerName: string): Promise<WorkerInfo>;
    list(): Promise<WorkerInfo[]>;
}

interface WorkerDeployment {
    success: boolean;
    url: string;
    errors: any[];
}

interface WorkerExecOptions extends RequestInit {
    method?: string;
    headers?: object;
    body?: string | object;
    cache?: RequestCache;
    credentials?: RequestCredentials;
    mode?: RequestMode;
    redirect?: RequestRedirect;
    referrer?: string;
    signal?: AbortSignal;
}

interface WorkerInfo {
    name: string;
    url: string;
    file_path: string;
    file_uid: string;
    created_at: string;
}

// Global puter instance
declare const puter: Puter;

// Export the Puter class as both default and named export
export default puter;
export { puter };

// Also export all the interfaces for users who want to use them
export {
    AI, AlertButton, App, AppConnection, Apps,
    Auth, ChatMessage, ChatOptions, ChatResponse, ContentObject, ContextMenuItem, ContextMenuOptions, CopyOptions, CreateAppOptions, DeleteOptions, Drivers, FilePickerOptions, FileSystem, FSItem, GetAppOptions, Hosting,
    KV,
    KVPair, LaunchAppOptions, MenubarOptions,
    MenuItem, MkdirOptions,
    MoveOptions, Networking,
    Permissions, Puter, ReaddirOptions, ReadOptions, SpaceInfo, StatsPeriod, Subdomain, ThemeData, ToolCall, ToolDefinition, Txt2ImgOptions,
    Txt2SpeechOptions, UI, UpdateAppAttributes, User, WindowOptions, WorkerDeployment,
    WorkerExecOptions,
    WorkerInfo, Workers, WriteOptions
};
