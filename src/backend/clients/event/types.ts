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

import type {
    Request as ExpressRequest,
    Response as ExpressResponse,
} from 'express';
import { Actor } from '../../core';
import { FSEntry } from '../../stores/fs/FSEntry';

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
        appUid: string;
        userUid: string;
        requestHost: string;
        requestPath: string;
        actor?: Actor;
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
        trail?: Array<string>;
        /** Device signals forwarded verbatim from the signup request body. */
        fingerprint?: string | null;
        dfp_telemetry_id?: string | null;
        [key: string]: unknown;
    };
    'puter.signup.success': {
        user_id: number;
        user_uuid: string;
        email: string;
        username: string;
        ip?: string | null;
        fingerprint?: string | null;
        /** True when the created account is a temp user (no email/password). */
        is_temp?: boolean;
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
    // Fired after an account is torn down (self-serve, admin, or temp-user
    // logout cleanup). Listeners purge external state tied to the account —
    // e.g. the marketplace extension cancels the user's Stripe subscriptions.
    // The row is already gone by emit time, so identifiers ride the payload.
    'user.delete': {
        user_id: number;
        user_uuid?: string;
        stripe_customer_id?: string | null;
    };

    // ---- Filesystem ----
    'fs.copy.node': {
        source: unknown;
        copy: unknown;
        sourceObjectKey: string;
        copyObjectKey: string;
    };
    'fs.move.node': { node: FSEntry; fromPath: string; toPath: string };
    'fs.remove.node': { node: FSEntry; entry: FSEntry; target: FSEntry };
    'fs.write.file': { node: FSEntry; entry: FSEntry; target: FSEntry };
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
    'site.htmlServed': {
        subdomain: string;
        entry: unknown;
        host: string;
        requestPath: string;
        requestUrl?: string;
        requestHash?: string;
        mime: string;
    };

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
} & {
    // Generic per-driver-method lifecycle, emitted by DriverController for
    // EVERY driver call under a key scoped to the interface + method:
    // `driver.<iface>.<method>.before|after|error|reject`. Wildcard
    // subscribers can listen to `driver.*` for everything, `driver.<iface>.*`
    // for one interface, or the exact key for one method. The `.before` phase
    // is emitted via `emitAndWait`, so a listener may set `allow = false`
    // (with an optional `rejectReason`) to veto the call before it runs — a
    // vetoed call emits `.reject` instead of running.
    [K in `driver.${string}`]: DriverMethodLifecycleEvent;
} & {
    // Generic per-route-endpoint lifecycle, emitted by the route materializer
    // for EVERY non-middleware route under a key scoped to the HTTP method +
    // normalized path: `route.<method>.<path>.before|after|error|reject`. Same
    // wildcard + veto semantics as the driver lifecycle above.
    [K in `route.${string}`]: RouteLifecycleEvent;
};

/**
 * Phase of a request/method lifecycle. `reject` is emitted when a `before`
 * listener vetoes the call (sets `allow = false`); the call never runs and no
 * `after`/`error` follows.
 */
export type LifecyclePhase = 'before' | 'after' | 'error' | 'reject';

/**
 * Payload for `driver.<iface>.<method>.<phase>` events.
 *
 * One shape across all phases; read `phase` (or the key suffix) to
 * branch. `allow`/`rejectReason` are only meaningful on the `before` phase
 * (emitted via `emitAndWait`).
 */
export type DriverMethodLifecycleEvent = {
    phase: LifecyclePhase;
    iface: string;
    method: string;
    /** Resolved concrete driver name. */
    driver: string;
    /** Full actor object, if the request is authenticated. */
    actor?: Actor;
    /** Stable actor id (see `actorUid`), if the request is authenticated. */
    actorUid?: string;
    /** Call arguments. Present on every phase. */
    args?: unknown;
    /** Return value. Present on `after`. */
    result?: unknown;
    /** Thrown error. Present on `error`. */
    error?: unknown;
    /** Wall-clock duration of the invocation. Present on `after`/`error`. */
    durationMs?: number;
    /** Veto channel for `before`: set `false` to block the call. */
    allow?: boolean;
    /** Optional human-readable reason surfaced to the caller when vetoed. */
    rejectReason?: string;
};

/**
 * Payload for `route.<method>.<path>.<phase>` events. Mirrors
 * {@link DriverMethodLifecycleEvent} for HTTP endpoints.
 */
export type RouteLifecycleEvent = {
    phase: LifecyclePhase;
    /** HTTP method, lowercased (`get`, `post`, ...). */
    method: string;
    /** Full route path including the controller prefix. */
    path: string;
    /**
     * The live express request/response for this call. Present on every phase.
     * On `before` a listener can read the parsed body/headers or write its own
     * response; on terminal phases they're useful for logging. These are real
     * in-process objects — never serialize or forward them across nodes.
     */
    req: ExpressRequest;
    res: ExpressResponse;
    /** Full actor object, if the request is authenticated. */
    actor?: Actor;
    /** Stable actor id (see `actorUid`), if the request is authenticated. */
    actorUid?: string;
    /** Response status code. Present on `after`/`error`. */
    statusCode?: number;
    /** Wall-clock duration from `before` to terminal phase. */
    durationMs?: number;
    /** Set when the request did not complete normally (abort / >=500). */
    error?: unknown;
    /** Veto channel for `before`: set `false` to block the request. */
    allow?: boolean;
    /** Optional human-readable reason surfaced to the caller when vetoed. */
    rejectReason?: string;
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

export type EventMetadata = { from_outside?: boolean };
export type EventListener<K extends EventKey = EventKey> = (
    key: K,
    data: EventMap[K],
    meta: EventMetadata,
) => Promise<void> | void;
