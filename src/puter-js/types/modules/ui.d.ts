import type { FSItem } from './fs-item.d.ts';

export interface AlertButton {
    label: string;
    value?: string;
    type?: 'primary' | 'success' | 'info' | 'warning' | 'danger';
}

export interface AlertOptions {
    type?: 'primary' | 'success' | 'info' | 'warning' | 'danger';
}

export interface PromptOptions {
    defaultValue?: string;
}

export interface ContextMenuItem {
    label: string;
    action?: () => void;
    icon?: string;
    icon_active?: string;
    disabled?: boolean;
    items?: (ContextMenuItem | '-')[];
}

export interface WindowHandle {
    id: string;
}

export type WindowIdentifier = string | WindowHandle;

export interface ContextMenuOptions {
    items: (ContextMenuItem | '-')[];
}

export interface WindowOptions {
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

export interface LaunchAppOptions {
    name?: string;
    app_name?: string;
    args?: Record<string, unknown>;
    file_paths?: string[];
    items?: FSItem[];
    pseudonym?: string;
    callback?: (connection: AppConnection) => void;
}

export interface ThemeData {
    palette: {
        primaryHue: number;
        primarySaturation: string;
        primaryLightness: string;
        primaryAlpha: number;
        primaryColor: string;
    };
}

export interface MenubarOptions {
    items: (MenuItem | '-')[];
}

export interface MenuItem {
    label: string;
    id?: string;
    action?: () => void;
    items?: (MenuItem | '-')[];
    icon?: string;
    icon_active?: string;
    checked?: boolean;
    disabled?: boolean;
}

export interface FilePickerOptions {
    multiple?: boolean;
    accept?: string | string[];
    path?: string;
}

export interface ColorPickerOptions {
    defaultColor?: string;
}

export interface FontPickerOptions {
    defaultFont?: string;
}

export interface DirectoryPickerOptions {
    multiple?: boolean;
}

export interface NotificationOptions {
    title?: string;
    text?: string;
    icon?: string;
    round_icon?: boolean;
    roundIcon?: boolean;
    uid?: string;
    value?: unknown;
}

export interface AppConnectionCloseEvent {
    appInstanceID: string;
    statusCode?: number;
}

export interface LaunchAppResult {
    launched: boolean;
    requestedAppName?: string | null;
    openedAppName?: string | null;
    appInstanceID?: string | null;
    appUid?: string | null;
    redirectedToFallback?: boolean;
    deniedPrivateAccess?: boolean;
    privateAccess?: {
        hasAccess: boolean;
        fallbackAppName?: string;
        fallbackArgs?: Record<string, unknown>;
        reason?: string;
    };
}

export type CancelAwarePromise<T> = Promise<T> & { undefinedOnCancel?: Promise<T | undefined> };

export class AppConnection {
    readonly usesSDK: boolean;
    readonly response?: Record<string, unknown> & {
        launchResult?: LaunchAppResult;
    };

    on (eventName: 'message', handler: (message: unknown) => void): void;
    on (eventName: 'close', handler: (data: AppConnectionCloseEvent) => void): void;
    off (eventName: string, handler: (...args: unknown[]) => void): void;
    postMessage (message: unknown): void;
    close (): void;
}

export class UI {
    alert (message?: string, buttons?: AlertButton[], options?: AlertOptions): Promise<string>;
    prompt (message?: string, placeholder?: string, options?: PromptOptions): Promise<string | null>;
    notify (options?: NotificationOptions): Promise<string>;
    authenticateWithPuter (): Promise<void>;
    contextMenu (options: ContextMenuOptions): void;
    createWindow (options?: WindowOptions): Promise<WindowHandle>;
    exit (statusCode?: number): void;
    getLanguage (): Promise<string>;
    hideSpinner (): void;
    hideWindow (): void;
    showSpinner (html?: string): void;
    showWindow (): void;
    showColorPicker (defaultColor?: string): Promise<string>;
    showColorPicker (options?: ColorPickerOptions): Promise<string>;
    showDirectoryPicker (options?: DirectoryPickerOptions): Promise<FSItem | FSItem[]>;
    showFontPicker (defaultFont?: string): Promise<{ fontFamily: string }>;
    showFontPicker (options?: FontPickerOptions): Promise<{ fontFamily: string }>;
    showOpenFilePicker (options?: FilePickerOptions): CancelAwarePromise<FSItem | FSItem[]>;
    showSaveFilePicker (
        content?: unknown,
        suggestedName?: string,
    ): CancelAwarePromise<FSItem>;
    socialShare (url: string, message?: string, options?: { left?: number; top?: number }): void;
    setMenubar (options: MenubarOptions): void;
    setMenuItemIcon (itemId: string, icon: string): void;
    setMenuItemIconActive (itemId: string, icon: string): void;
    setMenuItemChecked (itemId: string, checked: boolean): void;
    setWindowHeight (height: number, window_id?: WindowIdentifier): void;
    setWindowPosition (x: number, y: number, window_id?: WindowIdentifier): void;
    setWindowSize (width: number, height: number, window_id?: WindowIdentifier): void;
    setWindowTitle (title: string, window_id?: WindowIdentifier): void;
    setWindowWidth (width: number, window_id?: WindowIdentifier): void;
    setWindowX (x: number, window_id?: WindowIdentifier): void;
    setWindowY (y: number, window_id?: WindowIdentifier): void;
    wasLaunchedWithItems (): boolean;
    onItemsOpened (handler: (items: FSItem[]) => void): void;
    onLaunchedWithItems (handler: (items: FSItem[]) => void): void;
    onWindowClose (handler: () => void): void;
    on (eventName: 'localeChanged', handler: (data: { language: string }) => void): void;
    on (eventName: 'themeChanged', handler: (data: ThemeData) => void): void;
    parentApp (): AppConnection | null;
    launchApp (appName?: string, args?: Record<string, unknown>, callback?: (connection: AppConnection) => void): Promise<AppConnection>;
    launchApp (options: LaunchAppOptions): Promise<AppConnection>;

    getEntriesFromDataTransferItems (dataTransferItems: DataTransferItemList, options?: { raw?: boolean }): Promise<Array<File | FileSystemEntry>>;

    // Broadcast helpers are only partially typed because the payloads are app-defined.
    broadcast (name: string, data: unknown): void;
    listenForBroadcast (name: string, handler: (data: unknown) => void): void;

    get FILE_SAVE_CANCELLED (): symbol;
    get FILE_OPEN_CANCELLED (): symbol;

    requestUpgrade (): Promise<unknown>;
}

// NOTE: UI contains additional internal helpers that are not surfaced here because they are not
// part of the stable app-facing API.
