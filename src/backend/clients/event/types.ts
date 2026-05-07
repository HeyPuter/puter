/**
 * Shape of every payload emitted on the event bus, keyed by event name.
 *
 * Domain objects (User, Actor, FSEntry, Socket, ...) are typed as `unknown`
 * here on purpose — pulling their real types in would couple this module to
 * most of the backend and risk import cycles. Refine at the listener if
 * you need narrowed access.
 *
 * Conventions:
 * - `*.validate` events carry an `allow` flag listeners flip to reject;
 *   they tend to grow listener-specific fields, so they accept extras via
 *   an index signature.
 * - `outer.gui.*` events ride the `{ user_id_list, response }` envelope
 *   the SocketService fans out to user-scoped channels.
 */

// GUI write events spread an entry plus per-event metadata into `response`.
// The exact field set varies by emit site (FSController / LegacyFSController /
// WebDAVController each project a slightly different shape) so the envelope
// stays loose; listeners narrow on whichever fields they actually consume.
type GuiEvent<R = Record<string, unknown>> = {
    user_id_list: number[];
    response: R;
};

export type EventMap = {
    // ---- Server lifecycle ----
    serverStart: Record<string, never>;
    serverPrepareShutdown: Record<string, never>;
    serverShutdown: Record<string, never>;

    // ---- AI ----
    'ai.prompt.validate': {
        username: string;
        intended_service: string;
        parameters: unknown;
        allow?: boolean;
        abuse?: unknown;
        custom?: unknown;
        [key: string]: unknown;
    };
    'ai.prompt.complete': {
        username: string;
        completionId: string;
        intended_service: string;
        parameters: unknown;
        result: unknown;
        model_used: string;
        service_used: string;
    };
    'ai.prompt.cost-calculated': {
        completionId: string;
        username: string;
        usage: unknown;
        input_tokens: number;
        output_tokens: number;
        input_ucents: number;
        output_ucents: number;
        total_ucents: number;
        costs_currency: string;
        model_used: string;
        service_used: string;
        intended_service: string;
        model_details: {
            id: string;
            provider: string;
            input_cost_key: string;
            output_cost_key: string;
            costs: unknown;
            costs_currency: string;
        };
    };
    'ai.log.image': {
        actor: unknown;
        completionId: string;
        parameters: unknown;
        intended_service: string;
        model_used: string;
        service_used: string;
    };

    // ---- Apps ----
    'app.changed': {
        app_uid: string;
        action: string;
        app?: unknown;
        old_app?: unknown;
    };
    'app.new-icon': { app_uid: string; data_url: string };
    'app.opened': { app_uid: string; user_id: number; ts: number };
    'app.rename': {
        app_uid: string;
        old_name: string;
        new_name: string;
        app: unknown;
    };
    'app.from-origin': { origin: string };
    'app.privateAccess.check': {
        app: unknown;
        actor: unknown;
        result: {
            allowed: boolean;
            reason?: string;
            redirectUrl?: string;
            checkedBy?: string;
        };
    };
    'app.privateAccess.resolveLaunch': {
        app: unknown;
        actor: unknown;
        result: { allowed: boolean; reason?: string; error?: string };
    };

    // ---- Auth / signup ----
    'puter.signup.validate': {
        allow: boolean;
        email?: string;
        ip?: string | null;
        source?: 'oidc';
        req?: unknown;
        data?: unknown;
        abuse?: unknown;
        custom?: unknown;
        [key: string]: unknown;
    };
    'puter.signup.success': {
        user_id: number;
        user_uuid: string;
        email: string;
        username: string;
        ip?: string | null;
        [key: string]: unknown;
    };
    'email.validate': {
        email: string;
        allow: boolean;
        message: string | null;
        [key: string]: unknown;
    };
    'user.save_account': {
        user_id: number;
        old_username?: string;
        new_username?: string;
        email?: string;
    };
    'user.email-confirmed': {
        user_id: number;
        user_uid: string;
        email: string;
    };
    'user.username-changed': {
        user_id: number;
        old_username: string;
        new_username: string;
    };
    'user.email-changed': { user_id: number; new_email: string };

    // ---- Filesystem ----
    'fs.copy.node': {
        source: unknown;
        copy: unknown;
        sourceObjectKey: string;
        copyObjectKey: string;
    };
    'fs.move.node': { node: unknown; fromPath: string; toPath: string };
    'fs.remove.node': { node: unknown; entry: unknown; target: unknown };
    'fs.storage.upload-progress': {
        upload_tracker: unknown;
        context: unknown;
        meta: {
            user_id: number;
            userId: number;
            item_uid: string;
            item_path: string;
            [key: string]: unknown;
        };
    };
    'storage.quota.bonus': { userId: number; extra: number };

    // ---- Outer / GUI broadcast ----
    'outer.cacheUpdate': {
        cacheKey: string[];
        data?: unknown;
        ttlSeconds?: number;
    };
    'outer.fs.write-hash': { hash: string; uuid: string };
    'outer.gui.item.added': GuiEvent;
    'outer.gui.item.updated': GuiEvent;
    'outer.gui.item.moved': GuiEvent;
    'outer.gui.item.pending': GuiEvent;
    'outer.gui.item.removed': GuiEvent;
    'outer.gui.notif.ack': GuiEvent<{ uid: string }>;
    'outer.gui.notif.persisted': GuiEvent<{ uid: string }>;
    'outer.gui.notif.message': GuiEvent<{ uid: string; notification: unknown }>;
    'outer.gui.notif.unreads': GuiEvent<{
        unreads: { uid: string; notification: unknown }[];
    }>;

    // ---- Subdomains ----
    'subdomain.delete': { subdomain: string };
    'subdomain.update': { subdomain: string };

    // ---- Thumbnails ----
    'thumbnail.read': {
        uri: string;
        size?: string;
        thumbnail?: string | null;
    };
    'thumbnail.created': { url: string };
    'thumbnail.upload.prepare': {
        items: { index: number; item_uid: string }[];
        uploadUrl?: string;
        thumbnailUrl?: string;
    };

    // ---- Web sockets ----
    'web.socket.connected': { socket: unknown; user: unknown };
    'web.socket.user-connected': { socket: unknown; user: unknown };

    // ---- Extension hooks / misc ----
    'puter.gui.addons': {
        prependHeadContent?: string[];
        prependBodyContent?: string[];
    };
    'whoami.details': {
        user: unknown;
        details: {
            uuid?: string;
            username?: string;
            email?: string;
            app_name?: string;
        };
        isUser: boolean;
    };
    'wisp.get-policy': {
        app: unknown;
        actor: unknown;
        allow: boolean;
        policy?: unknown;
    };
    'ip.validate': { allow: boolean; ip: string };
} & {
    // SocketService re-emits each fanout-eligible event under
    // `sent-to-user.<wireName>` so per-user channels can subscribe by wire name.
    [K in `sent-to-user.${string}`]: { user_id: number; response: unknown };
};

export type EventKey = keyof EventMap & string;

// "a.b.c" -> "a.*" | "a.b.*"
// Generates a wildcard for every non-final dot-separated prefix of K.
export type WildcardPrefixes<K extends string> =
    K extends `${infer Head}.${infer Tail}`
        ?
              | `${Head}.*`
              | (Tail extends `${string}.${string}`
                    ? `${Head}.${WildcardPrefixes<Tail>}`
                    : never)
        : never;

export type ListenKey = EventKey | WildcardPrefixes<EventKey>;

export type MatchingEvents<P extends ListenKey> = P extends `${infer Prefix}.*`
    ? Extract<EventKey, `${Prefix}.${string}`>
    : P & EventKey;

export type EventListener<K extends EventKey = EventKey> = (
    key: K,
    data: EventMap[K],
    meta: unknown,
) => Promise<void> | void;
