import type { FSItem } from './fs-item.d.ts';

/** A button shown in an `alert()` dialog. */
export interface AlertButton {
    /** Text displayed on the button. */
    label: string;
    /** Value returned when this button is pressed. Defaults to `label` if not set. */
    value?: string;
    /** Visual style of the button. */
    type?: 'primary' | 'success' | 'info' | 'warning' | 'danger';
}

/** Options that configure an `alert()` dialog. */
export interface AlertOptions {
    /** Visual style of the alert dialog. */
    type?: 'primary' | 'success' | 'info' | 'warning' | 'danger';
    /** Icon URL shown in the dialog body. Takes precedence over `icon`. */
    body_icon?: string;
    /** Icon URL shown in the dialog body, used when `body_icon` is not set. */
    icon?: string;
}

export interface PromptOptions {
    defaultValue?: string;
}

/** A single item in a context menu. The string `'-'` may be used in place of an item to render a separator. */
export interface ContextMenuItem {
    /** Text displayed for the menu item. */
    label: string;
    /** Function executed when the item is clicked. Not required for items with submenus. */
    action?: () => void;
    /** Icon shown next to the label. Must be a base64-encoded image data URI starting with `data:image`; other strings are ignored. */
    icon?: string;
    /** Icon shown when the item is hovered or active. Must be a base64-encoded image data URI starting with `data:image`; other strings are ignored. */
    icon_active?: string;
    /** If `true`, the item is disabled and unclickable. Defaults to `false`. */
    disabled?: boolean;
    /** Submenu items. Specifying this creates a submenu. */
    items?: (ContextMenuItem | '-')[];
}

/** A handle to a window created by `createWindow()`. */
export interface WindowHandle {
    /** Identifier of the window, usable as the `window_id` argument to the `setWindow*` methods. */
    id: string;
}

/** Identifies a window: either a window id string or a window handle returned by `createWindow()`. */
export type WindowIdentifier = string | WindowHandle;

/** Options that configure a context menu. */
export interface ContextMenuOptions {
    /** Menu items and separators. Use the string `'-'` to insert a separator. */
    items: (ContextMenuItem | '-')[];
}

/** Options that configure a window created by `createWindow()`. */
export interface WindowOptions {
    /** If `true`, the window is placed at the center of the screen. */
    center?: boolean;
    /** Content of the window. */
    content?: string;
    /** If `true`, the parent window is blocked until this window is closed. */
    disable_parent_window?: boolean;
    /** If `true`, the window has a head containing the icon and close, minimize, and maximize buttons. */
    has_head?: boolean;
    /** Height of the window in pixels. */
    height?: number;
    /** If `true`, the user can resize the window. */
    is_resizable?: boolean;
    /** If `true`, the window is represented in the taskbar. */
    show_in_taskbar?: boolean;
    /** Title of the window. */
    title?: string;
    /** Width of the window in pixels. */
    width?: number;
}

/** Options that configure `launchApp()`. */
export interface LaunchAppOptions {
    /** Name of the app to launch. If not provided, a new instance of the current app is launched. */
    name?: string;
    app_name?: string;
    /** Arguments to pass to the app. */
    args?: Record<string, unknown>;
    /** Paths of existing files to open with the launched app. */
    file_paths?: string[];
    /** `FSItem` objects to open with the launched app. */
    items?: FSItem[];
    /** A pseudonym to launch the app under. */
    pseudonym?: string;
    callback?: (connection: AppConnection) => void;
}

/** Theme data delivered with the `themeChanged` event. */
export interface ThemeData {
    palette: {
        /** Hue of the theme color. */
        primaryHue: number;
        /** Saturation of the theme color as a percentage string, including the `%` sign. */
        primarySaturation: string;
        /** Lightness of the theme color as a percentage string, including the `%` sign. */
        primaryLightness: string;
        /** Opacity of the theme color, from `0` to `1`. */
        primaryAlpha: number;
        /** CSS color value for text. */
        primaryColor: string;
    };
}

/** Options that configure the menubar set by `setMenubar()`. */
export interface MenubarOptions {
    /** Menu items and separators. Use the string `'-'` to insert a separator. */
    items: (MenuItem | '-')[];
}

/** A single item in a menubar menu. The string `'-'` may be used in place of an item to render a separator. */
export interface MenuItem {
    /** Text displayed for the menu item. */
    label: string;
    id?: string;
    /** Function executed when the item is clicked. */
    action?: () => void;
    /** Submenu items. */
    items?: (MenuItem | '-')[];
    /** URL or data URI of an icon shown next to the label. */
    icon?: string;
    /** URL or data URI of an icon shown when the item is hovered or active. Falls back to `icon` if not provided. */
    icon_active?: string;
    /** If `true`, renders a checkmark next to the item. Use for toggleable options. */
    checked?: boolean;
    /** If `true`, the item is visible but cannot be clicked. */
    disabled?: boolean;
}

/** Options that configure `showOpenFilePicker()`. */
export interface FilePickerOptions {
    /** If `true`, the user can select multiple files. Defaults to `false`. */
    multiple?: boolean;
    /**
     * MIME types or file extensions accepted by the picker. Defaults to `*\/*`.
     * For example `'image/*'`, or `['.jpg', '.png']`.
     */
    accept?: string | string[];
    /**
     * Initial directory to open the picker in. Defaults to the user's Desktop.
     * The special prefix `%appdata%` resolves to the app's private appdata directory.
     */
    path?: string;
}

/** Options that configure `showColorPicker()`. */
export interface ColorPickerOptions {
    /** The color initially selected when the picker opens. */
    defaultColor?: string;
}

/** Options that configure `showFontPicker()`. */
export interface FontPickerOptions {
    /** The font initially selected when the picker opens. */
    defaultFont?: string;
}

/** Options that configure `showDirectoryPicker()`. */
export interface DirectoryPickerOptions {
    /** If `true`, the user can select multiple directories. Defaults to `false`. */
    multiple?: boolean;
}

/** Options that configure a notification shown by `notify()`. */
export interface NotificationOptions {
    /** Title shown in the notification. */
    title?: string;
    /** Body text shown under the title. */
    text?: string;
    /** Icon URL or Puter icon name (for example `bell.svg`). */
    icon?: string;
    /** Visual style used to pick a default icon and accent color when no `icon` is provided. */
    type?: 'info' | 'success' | 'warning' | 'error' | 'default';
    /** Time in milliseconds before the notification auto-dismisses. Defaults to `5000`; set to `0` to keep it until dismissed. */
    duration?: number;
    /** If `true`, renders the icon as a circle. */
    round_icon?: boolean;
    /** Alias for `round_icon`. */
    roundIcon?: boolean;
    /** Optional ID to associate with the notification. */
    uid?: string;
    /** Optional value stored on the notification element. */
    value?: unknown;
}

/** Data passed to the `close` handler on an `AppConnection`. */
export interface AppConnectionCloseEvent {
    /** Instance ID of the app that closed. */
    appInstanceID: string;
    statusCode?: number;
}

/** Data passed to the `connection` event handler when another app requests a connection to your app. */
export interface ConnectionEvent {
    /** Connection to the app that initiated the request. */
    conn: AppConnection;
    /** Call `accept(value)` to accept the connection; `value` is sent back to the requester. */
    accept: (value?: unknown) => void;
    /** Call `reject(value)` to reject the connection; `value` is sent back to the requester. */
    reject: (value?: unknown) => void;
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

/** Provides an interface for interaction with another app. */
export class AppConnection {
    /** Whether the target app is using Puter.js. If not, some features of `AppConnection` are unavailable. */
    readonly usesSDK: boolean;
    readonly response?: Record<string, unknown> & {
        launchResult?: LaunchAppResult;
    };

    /**
     * Listen to an event from the target app.
     * - `message`: the target app sent a message with `postMessage()`; the handler receives the message.
     * - `close`: the target app closed; the handler receives an object with the closed app's `appInstanceID`.
     */
    on (eventName: 'message', handler: (message: unknown) => void): void;
    on (eventName: 'close', handler: (data: AppConnectionCloseEvent) => void): void;
    /** Remove an event listener added with `on(eventName, handler)`. */
    off (eventName: string, handler: (...args: unknown[]) => void): void;
    /** Send a message to the target app. Does nothing if the target app is not using the SDK or the connection is not open. */
    postMessage (message: unknown): void;
    /** Attempt to close the target app. An app may close apps it launched with `launchApp()`. Does nothing without permission or if already closed. */
    close (): void;
}

/**
 * The UI API: tools for creating rich user interfaces and interacting with the
 * Puter desktop environment, including dialogs, window management, file pickers,
 * and desktop integration.
 */
export class UI {
    /**
     * Displays an alert dialog. Blocks the parent window until the user presses a button.
     * Resolves to the pressed button's `value` (or its `label` if `value` is unset).
     */
    alert (message?: string, buttons?: AlertButton[], options?: AlertOptions): Promise<string>;
    /**
     * Displays a prompt dialog. Blocks the parent window until the user responds.
     * Resolves to the input value on OK, or `false` if the user cancels.
     */
    prompt (message?: string, placeholder?: string, options?: PromptOptions): Promise<string | false>;
    /** Displays a desktop notification. Resolves to the notification UID. */
    notify (options?: NotificationOptions): Promise<string>;
    /** Presents a dialog for the user to authenticate with their Puter account. Resolves once authenticated; rejects if the user cancels. */
    authenticateWithPuter (): Promise<void>;
    /** Displays a context menu at the current cursor position. Menu item actions run when clicked. */
    contextMenu (options: ContextMenuOptions): void;
    /** Creates and displays a window. Resolves to a window handle whose `id` can be passed to the `setWindow*` methods. */
    createWindow (options?: WindowOptions): Promise<WindowHandle>;
    /** Retrieves the current language/locale code from the Puter environment (e.g. `en`, `fr`, `es`, `de`). */
    getLanguage (): Promise<string>;
    /** Hides the active spinner instance. */
    hideSpinner (): void;
    /** Hides the window of the application. */
    hideWindow (): void;
    /**
     * Shows an overlay with a spinner in the center of the screen. If called
     * multiple times, only one spinner is shown until all instances are hidden.
     * @param html Custom message rendered under the spinner; accepts plain text or HTML. Defaults to `"Working..."`.
     */
    showSpinner (html?: string): void;
    /** Shows the window of the application. */
    showWindow (): void;
    /** Presents a color picker dialog and resolves to the selected color. */
    showColorPicker (defaultColor?: string): Promise<string>;
    showColorPicker (options?: ColorPickerOptions): Promise<string>;
    /**
     * Presents a directory picker for the user's Puter cloud storage. Resolves to
     * one `FSItem` or an array of `FSItem` objects depending on selection count.
     */
    showDirectoryPicker (options?: DirectoryPickerOptions): Promise<FSItem | FSItem[]>;
    /** Presents a font picker for previewing and selecting a font. */
    showFontPicker (defaultFont?: string): Promise<{ fontFamily: string }>;
    showFontPicker (options?: FontPickerOptions): Promise<{ fontFamily: string }>;
    /**
     * Presents a file picker for the user's Puter cloud storage. Resolves to one
     * `FSItem` or an array of `FSItem` objects depending on selection count.
     */
    showOpenFilePicker (options?: FilePickerOptions): CancelAwarePromise<FSItem | FSItem[]>;
    /**
     * Presents a file picker for choosing where and with what name to save a file.
     * Resolves to an `FSItem` for the saved file. If the user cancels, the promise stays pending.
     * @param content Data to write. When `type` is `'url'`, a URL whose contents are saved; when `'move'` or `'copy'`, the source path of an existing file.
     * @param suggestedName Default file name to pre-fill in the dialog.
     * @param type How `content` is interpreted: `'url'`, `'move'`, or `'copy'`. Auto-detected as `'url'` when `content` is a `URL` object.
     */
    showSaveFilePicker (
        content?: unknown,
        suggestedName?: string,
        type?: 'url' | 'move' | 'copy',
    ): CancelAwarePromise<FSItem>;
    /**
     * Presents a dialog for sharing a link on various social media platforms.
     * @param url The URL to share.
     * @param message Message to prefill in the post. Only supported by some platforms.
     * @param options Dialog position; `left` and `top` both default to `0`.
     */
    socialShare (url: string, message?: string, options?: { left?: number; top?: number }): void;
    /** Creates a menubar, a horizontal bar at the top of the window containing menus. */
    setMenubar (options: MenubarOptions): void;
    setMenuItemIcon (itemId: string, icon: string): void;
    setMenuItemIconActive (itemId: string, icon: string): void;
    setMenuItemChecked (itemId: string, checked: boolean): void;
    /**
     * Dynamically sets the window height. Minimum is `200`; smaller values are clamped to `200`.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowHeight (height: number, window_id?: WindowIdentifier): void;
    /**
     * Sets the window position.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowPosition (x: number, y: number, window_id?: WindowIdentifier): void;
    /**
     * Dynamically sets the window width and height. Minimum for each is `200`; smaller values are clamped to `200`.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowSize (width: number, height: number, window_id?: WindowIdentifier): void;
    /**
     * Dynamically sets the window title.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowTitle (title: string, window_id?: WindowIdentifier): void;
    /**
     * Dynamically sets the window width. Minimum is `200`; smaller values are clamped to `200`.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowWidth (width: number, window_id?: WindowIdentifier): void;
    /**
     * Sets the window X position.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowX (x: number, window_id?: WindowIdentifier): void;
    /**
     * Sets the window Y position.
     * @param window_id Targets a specific window; accepts a window id string or a handle from `createWindow()`. Defaults to the app's main window.
     */
    setWindowY (y: number, window_id?: WindowIdentifier): void;
    /** Returns whether the app was launched to open one or more items (via double-clicking, the 'Open With...' menu, etc.). */
    wasLaunchedWithItems (): boolean;
    /** @deprecated Also fires when items are dropped on the app; new code should handle the `drop` event instead. */
    onItemsOpened (handler: (items: FSItem[]) => void): void;
    /**
     * Registers a callback invoked when the app is launched with items (via
     * double-clicking or the 'Open With...' menu). The handler receives an array
     * of items, each a file or directory.
     */
    onLaunchedWithItems (handler: (items: FSItem[]) => void): void;
    /** Registers a function run when the window is about to close. Not called when the app exits via `puter.exit()`. */
    onWindowClose (handler: () => void): void;
    /**
     * Listen to a broadcast event from Puter. If the broadcast was received before
     * the handler was attached, the handler is called immediately with the most recent value.
     * - `localeChanged`: sent on startup and when the user's locale changes.
     * - `themeChanged`: sent on startup and when the user's desktop theme changes.
     * - `connection`: sent when another app requests a connection to your app.
     */
    on (eventName: 'localeChanged', handler: (data: { language: string }) => void): void;
    on (eventName: 'themeChanged', handler: (data: ThemeData) => void): void;
    on (eventName: 'connection', handler: (data: ConnectionEvent) => void): void;
    /** Obtains a connection to the app that launched this app, or `null` if there is no parent app. */
    parentApp (): AppConnection | null;
    /**
     * Dynamically launches another app. If no app name is given, a new instance of
     * the current app is launched. Resolves to an `AppConnection` once launched.
     */
    launchApp (appName?: string, args?: Record<string, unknown>, callback?: (connection: AppConnection) => void): Promise<AppConnection>;
    launchApp (options: LaunchAppOptions): Promise<AppConnection>;

    getEntriesFromDataTransferItems (dataTransferItems: DataTransferItemList, options?: { raw?: boolean }): Promise<Array<File | FileSystemEntry>>;

    requestUpgrade (): Promise<unknown>;
}

// NOTE: UI contains additional internal helpers that are not surfaced here because they are not
// part of the stable app-facing API.
