import { fetchUrl } from '../../lib/networkUtils.js';
import { promptIfUpgradeRequired } from '../../lib/upgradePrompt.js';
import { RealtimeSession, createRealtimeSocket } from './convoTransport.js';
import { RealtimeEvents } from './realtimeEvents.js';
import { ConvoMicrophone, ConvoSpeaker } from './convoMedia.js';
import { ConvoHistory } from './convoHistory.js';

/** @typedef {import('./types.js').ConvoOptions} ConvoOptions */
/** @typedef {import('./types.js').ConvoSessionOptions} ConvoSessionOptions */
/** @typedef {import('./types.js').ConvoPlaybackPosition} ConvoPlaybackPosition */
/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */
/** @typedef {import('./types.js').RealtimeClientEvent} RealtimeClientEvent */
/** @typedef {{ code: string; message: string }} ConvoError */

const MODELS = new Set([
    'gpt-realtime-2.1-mini',
    'gpt-realtime-2.1',
    'gpt-realtime-2',
    'gpt-realtime-1.5',
    'gpt-realtime',
    'gpt-realtime-mini',
]);
const DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 128 * 1024;
const OPERATION_TIMEOUT_MS = 10_000;
// Outlasts the server's 15-second session setup, which includes sign-in.
const SESSION_TIMEOUT_MS = 20_000;
// Close codes after which a dropped connection is replaced: going away,
// abnormal closure, server error, service restart, try again later.
const RECONNECT_CODES = new Set([1001, 1006, 1011, 1012, 1013]);
// Failures while reconnecting that are worth another attempt.
const RETRYABLE_ERRORS = new Set([
    'session_closed',
    'operation_timeout',
    'connection_lost',
    'connection_timeout',
    'server_restarting',
    'upstream_error',
    'rate_limit_exceeded',
    'internal_error',
]);
// Ten attempts over about a minute, long enough for a server restart.
const RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 10_000;
// Per reconnect, the longest wait for a browser that reports being offline.
const OFFLINE_WAIT_MS = 120_000;
// RFC 6455 "Service Restart".
const CLOSE_RESTART = 1012;
// The server's request to reconnect once the conversation is idle.
const RECONNECT_NOTICE = 'puter.reconnect';
// Context restored after a reconnect. The byte cap stays under the server's
// 64 KiB upload burst, so the replay never trips its rate limit.
const MAX_REPLAY_ITEMS = 40;
const MAX_REPLAY_BYTES = 48 * 1024;
const encoder = new TextEncoder();

/**
 * @param {string} code
 * @param {string} message
 * @returns {ConvoError}
 */
const failure = (code, message) => ({ code, message });

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Applies a partial `session.update` payload. Nested objects merge, except
 * typed ones such as `turn_detection`, which replace like any other value.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
function mergeSession(base, patch) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        const current = merged[key];
        merged[key] =
            isPlainObject(value) && !('type' in value) && isPlainObject(current)
                ? mergeSession(current, value)
                : value;
    }
    return merged;
}

/**
 * @param {ConvoOptions} options
 * @param {boolean} [allowModel]
 * @returns {void}
 */
function validateOptions(options, allowModel = false) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
        throw failure('invalid_argument', 'Expected conversation options');
    for (const key of Object.keys(options)) {
        if (
            ![
                'instructions',
                'output',
                'voice',
                'turnDetection',
                ...(allowModel ? ['model'] : []),
            ].includes(key)
        )
            throw failure(
                'invalid_argument',
                `Unsupported conversation option: ${key}`,
            );
    }
    for (const [key, limit] of [
        ['instructions', 8192],
        ['voice', 128],
    ]) {
        const value = options[key];
        if (
            value !== undefined &&
            (typeof value !== 'string' ||
                value.length > limit ||
                (key === 'voice' && !value.length))
        )
            throw failure('invalid_argument', `Invalid ${key}`);
    }
    if (
        options.output !== undefined &&
        (!Array.isArray(options.output) ||
            !options.output.length ||
            options.output.length > 2 ||
            options.output.some(
                (value) => !['text', 'audio'].includes(value),
            ) ||
            new Set(options.output).size !== options.output.length)
    )
        throw failure(
            'invalid_argument',
            'Output must contain text, audio, or both',
        );
    if (
        options.turnDetection !== undefined &&
        typeof options.turnDetection !== 'boolean'
    )
        throw failure('invalid_argument', 'turnDetection must be boolean');
    if (allowModel && options.model !== undefined && !MODELS.has(options.model))
        throw failure('model_not_found', 'Unsupported realtime model');
}

/**
 * Bounds traversal before JSON serialization.
 *
 * @param {RealtimeServerEvent} event
 * @returns {{ json: string; bytes: number }}
 */
function encodeEvent(event) {
    if (
        !event ||
        typeof event !== 'object' ||
        Array.isArray(event) ||
        typeof event.type !== 'string' ||
        !event.type.length ||
        event.type.length > 128
    )
        throw failure(
            'invalid_event',
            'Expected a JSON event with a nonempty type',
        );
    const pending = [{ value: event, depth: 0 }];
    let nodes = 0;
    let characters = 0;
    while (pending.length) {
        const { value, depth } = pending.pop();
        if (++nodes > 2048 || depth > 16)
            throw failure('input_too_large', 'Event structure is too large');
        if (typeof value === 'string') characters += value.length;
        else if (value !== null && typeof value === 'object') {
            if (Array.isArray(value) && value.length > 2048)
                throw failure('input_too_large', 'Event array is too large');
            let fields = 0;
            for (const key in value) {
                if (!Object.hasOwn(value, key)) continue;
                if (++fields > 2048 || pending.length >= 2048)
                    throw failure(
                        'input_too_large',
                        'Event has too many fields',
                    );
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !('value' in descriptor))
                    throw failure(
                        'invalid_event',
                        'Event fields must be JSON values',
                    );
                characters += key.length;
                pending.push({ value: descriptor.value, depth: depth + 1 });
            }
        } else if (
            value !== null &&
            !['number', 'boolean', 'undefined'].includes(typeof value)
        )
            throw failure('invalid_event', 'Event fields must be JSON values');
        if (characters > MAX_MESSAGE_BYTES)
            throw failure('input_too_large', 'Event exceeds 64 KiB');
    }
    const json = JSON.stringify(event);
    const bytes = encoder.encode(json).byteLength;
    if (bytes > MAX_MESSAGE_BYTES)
        throw failure('input_too_large', 'Event exceeds 64 KiB');
    return { json, bytes };
}

/**
 * A prepared realtime conversation with optional media helpers.
 *
 * @extends {RealtimeEvents<import('./types.js').ConvoEventMap>}
 */
export class Conversation extends RealtimeEvents {
    /** @type {import('../../index.js').Puter} */
    #puter;
    /** @type {ConvoOptions} */
    #options;
    /** @type {'prepared' | 'connecting' | 'connected' | 'closed'} */
    #state = 'prepared';
    /** @type {RealtimeSession | null} */
    #session = null;
    /** @type {(() => void) | null} */
    #unsubscribe = null;
    /** @type {Promise<void> | null} */
    #connection = null;
    /** @type {{ type: 'close'; code: number; reason: string } | null} */
    #lastClose = null;
    /**
     * @type {Set<{
     *     type: string;
     *     matches: (event: RealtimeServerEvent) => boolean;
     *     resolve: (event: RealtimeServerEvent) => void;
     *     reject: (error: ConvoError) => void;
     *     timer: ReturnType<typeof setTimeout>;
     *     eventId?: string;
     *     anyError?: boolean;
     * }>}
     */
    #pending = new Set();
    #sequence = 0;
    #configuring = false;
    #activeResponse = '';
    // `session.update` event IDs awaiting `session.updated`, in send order.
    /** @type {string[]} */
    #sessionUpdates = [];
    /** @type {Map<string, Record<string, unknown>>} */
    #sentSessions = new Map();
    // Every acknowledged session setting, SDK and native, reapplied after a
    // reconnect.
    /** @type {Record<string, unknown>} */
    #sessionState = {};
    /** @type {string | undefined} */
    #acknowledgedUpdate;
    // Ends the reconnect loop's current wait early.
    /** @type {(() => void) | null} */
    #reconnectWait = null;
    #reconnecting = false;
    /**
     * @type {{
     *     resolve: () => void;
     *     reject: (error: ConvoError) => void;
     * }[]}
     */
    #reconnectWaiters = [];
    // `response.create` event IDs whose response hasn't been created yet.
    /** @type {Set<string>} */
    #requestedResponses = new Set();
    #turnDetection = true;
    /**
     * @type {{
     *     id: string;
     *     itemId?: string;
     *     promise: Promise<void>;
     * } | null}
     */
    #interruption = null;
    #cancelled = new Set();
    #history = new ConvoHistory((id) => this.#cancelled.has(id));
    // A pending reconnect notice, carried out once the conversation is idle.
    /**
     * @type {{
     *     reason: string;
     *     timer: ReturnType<typeof setTimeout> | null;
     * } | null}
     */
    #handover = null;
    // The user has started a turn the provider hasn't answered or dropped.
    #userTurn = false;
    // Audio appended in manual turn mode and not yet committed or cleared.
    #bufferedAudio = false;
    #autoResponse = true;
    #transcribes = false;
    // Replayed `conversation.item.create` event IDs on the current session.
    /** @type {Map<string, import('./convoHistory.js').ReplayEntry>} */
    #replayEvents = new Map();
    #replayReported = false;
    /** @type {ConvoMicrophone} */
    microphone;
    /** @type {ConvoSpeaker} */
    speaker;

    /**
     * @param {import('../../index.js').Puter} puter
     * @param {ConvoOptions} options
     * @internal
     */
    constructor(puter, options) {
        super();
        this.#puter = puter;
        this.#options = {
            ...options,
            output: options.output ? [...options.output] : ['audio'],
            model: options.model ?? DEFAULT_MODEL,
        };
        this.#turnDetection = this.#options.turnDetection !== false;
        this.microphone = new ConvoMicrophone(this);
        this.speaker = new ConvoSpeaker(this);
    }

    /** @returns {'prepared' | 'connecting' | 'connected' | 'closed'} */
    get state() {
        return this.#state;
    }
    /** @returns {string} */
    get model() {
        return this.#options.model;
    }

    /**
     * Opens and configures the session. Concurrent calls share one attempt;
     * during a reconnection, resolves once it succeeds.
     *
     * @returns {Promise<void>}
     */
    connect() {
        if (this.#state === 'closed')
            return Promise.reject(
                failure('session_closed', 'Conversation is closed'),
            );
        if (this.#reconnecting)
            return new Promise((resolve, reject) =>
                this.#reconnectWaiters.push({ resolve, reject }),
            );
        if (this.#connection) return this.#connection;
        if (!this.#puter.authToken)
            return Promise.reject(
                failure('auth_required', 'Authentication required'),
            );
        this.#state = 'connecting';
        this.#connection = (async () => {
            try {
                await this.#open();
                this.#state = 'connected';
                this.emitRealtime({
                    type: 'ready',
                    model: this.model,
                    provider: 'openai',
                });
                this.#scheduleHandover();
            } catch (error) {
                this.#finish(
                    this.#lastClose ?? {
                        type: 'close',
                        code: 1000,
                        reason: '',
                    },
                );
                throw error;
            }
        })();
        return this.#connection;
    }

    /**
     * Opens a socket, waits for the provider session and applies settings.
     *
     * @param {boolean} [reapply] Reapply every acknowledged setting instead of
     *   the SDK options alone, and restore earlier conversation items.
     * @returns {Promise<void>}
     */
    async #open(reapply = false) {
        let socket;
        try {
            socket = createRealtimeSocket(this.#puter, this.model);
        } catch {
            throw failure(
                'unsupported_environment',
                'Realtime conversations require WebSocket support',
            );
        }
        this.#session = new RealtimeSession(socket);
        this.#unsubscribe = this.#session.on('*', (event) =>
            this.#receive(event),
        );
        await this.#wait(
            'session.created',
            undefined,
            undefined,
            true,
            SESSION_TIMEOUT_MS,
        );
        if (reapply && Object.keys(this.#sessionState).length)
            await this.#reapplySession();
        else await this.#configure(this.#options, true);
        if (reapply) this.#replayHistory();
        if (this.#state === 'closed')
            throw failure('session_closed', 'Conversation is closed');
    }

    /**
     * Sends the acknowledged session state, split by top-level setting so each
     * update stays under the message limit.
     *
     * @returns {Promise<void>}
     */
    async #reapplySession() {
        /** @type {Record<string, unknown>[]} */
        const updates = [];
        /** @type {Record<string, unknown>} */
        let session = { type: 'realtime' };
        for (const [key, value] of Object.entries(this.#sessionState)) {
            if (key === 'type') continue;
            const next = { ...session, [key]: value };
            if (
                Object.keys(session).length > 1 &&
                encoder.encode(JSON.stringify(next)).byteLength >
                    MAX_MESSAGE_BYTES - 256
            ) {
                updates.push(session);
                session = { type: 'realtime', [key]: value };
            } else session = next;
        }
        updates.push(session);
        for (const update of updates) {
            const eventId = this.#eventId();
            await this.#request(
                'session.updated',
                { type: 'session.update', event_id: eventId, session: update },
                () => this.#acknowledgedUpdate === eventId,
            );
        }
    }

    /**
     * Sends the newest recreatable conversation items to a new session. Not
     * acknowledged: the provider handles them before anything sent later, and a
     * refusal is reported without failing the reconnect.
     *
     * @returns {void}
     */
    #replayHistory() {
        this.#replayEvents.clear();
        this.#replayReported = false;
        const entries = this.#history.replay(
            MAX_REPLAY_ITEMS,
            MAX_REPLAY_BYTES,
        );
        if (!entries.length) return;
        const events = entries.map(({ item }) => ({
            type: 'conversation.item.create',
            event_id: this.#eventId(),
            item,
        }));
        try {
            this.#write(events);
        } catch (error) {
            if (error?.code === 'session_closed') throw error;
            this.#replayFailed(error?.message);
            return;
        }
        events.forEach((event, i) =>
            this.#replayEvents.set(event.event_id, entries[i]),
        );
        this.#history.replayed(entries);
    }

    /**
     * @param {string} [detail]
     * @returns {void}
     */
    #replayFailed(detail) {
        if (this.#replayReported) return;
        this.#replayReported = true;
        this.reportMediaError(
            failure(
                'context_restore_failed',
                `Earlier conversation items could not be restored${detail ? `: ${detail}` : ''}`,
            ),
        );
    }

    /**
     * Replaces a dropped connection, or one the server asked the client to
     * leave, keeping settings, listeners, media and recent conversation items.
     *
     * @param {{ code: number; reason: string }} event
     * @returns {Promise<void>}
     */
    async #reconnect(event) {
        this.#state = 'connecting';
        this.#reconnecting = true;
        this.#endHandover();
        // Playback stops here, so only what was heard is restored.
        const heard = this.speaker.playbackPosition(this.#activeResponse);
        if (heard) this.#history.truncate(heard.itemId, heard.playedMs);
        this.#detach();
        this.#resetTurnState();
        this.#rejectPending(
            failure('connection_lost', 'Connection lost; reconnecting'),
        );
        this.emitRealtime({
            type: 'reconnecting',
            code: event.code,
            reason: event.reason,
        });
        const offlineUntil = Date.now() + OFFLINE_WAIT_MS;
        for (let attempt = 0; attempt < RECONNECT_ATTEMPTS; attempt++) {
            const delay = Math.min(
                RECONNECT_DELAY_MS * 2 ** attempt,
                RECONNECT_MAX_DELAY_MS,
            );
            // Jittered so clients dropped together don't return together.
            await this.#pause(delay * (0.5 + Math.random()));
            if (this.#state === 'closed') return;
            await this.#whileOffline(offlineUntil);
            if (this.#state === 'closed') return;
            try {
                await this.#open(true);
                this.#state = 'connected';
                this.#reconnecting = false;
                for (const waiter of this.#reconnectWaiters.splice(0))
                    waiter.resolve();
                this.emitRealtime({
                    type: 'ready',
                    model: this.model,
                    provider: 'openai',
                    reconnected: true,
                });
                this.#scheduleHandover();
                return;
            } catch (error) {
                if (this.#state === 'closed') return;
                this.#detach();
                this.#rejectPending(
                    failure('connection_lost', 'Connection lost; reconnecting'),
                );
                if (!RETRYABLE_ERRORS.has(error?.code)) {
                    this.#finish({
                        type: 'close',
                        code: 1008,
                        reason: error?.message ?? 'Reconnection failed',
                    });
                    return;
                }
            }
        }
        this.#finish({ type: 'close', code: event.code, reason: event.reason });
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #pause(ms) {
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                this.#reconnectWait = null;
                resolve();
            };
            const timer = setTimeout(done, ms);
            this.#reconnectWait = done;
        });
    }

    /**
     * Waits, until `deadline` at most, while the browser reports being offline,
     * so attempts aren't spent on a connection that can't open.
     *
     * @param {number} deadline
     * @returns {Promise<void>}
     */
    #whileOffline(deadline) {
        const scope = /** @type {any} */ (globalThis);
        const remaining = deadline - Date.now();
        if (
            typeof navigator === 'undefined' ||
            navigator.onLine !== false ||
            typeof scope.addEventListener !== 'function' ||
            remaining <= 0
        )
            return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                scope.removeEventListener('online', done);
                this.#reconnectWait = null;
                resolve();
            };
            const timer = setTimeout(done, remaining);
            scope.addEventListener('online', done);
            this.#reconnectWait = done;
        });
    }

    /**
     * Whether the conversation can move to a new session without cutting
     * anything off: no reply requested, generating or playing, no user turn or
     * transcript in progress, no tool output awaited and no acknowledgment
     * pending.
     *
     * @returns {boolean}
     */
    #idle() {
        return (
            this.#state === 'connected' &&
            !this.#activeResponse &&
            !this.#requestedResponses.size &&
            !this.#pending.size &&
            !this.#interruption &&
            !this.#configuring &&
            !this.#userTurn &&
            !this.#bufferedAudio &&
            !this.speaker.playing &&
            !(this.#transcribes && this.#history.awaitingTranscript) &&
            !this.#history.awaitingToolOutput
        );
    }

    /**
     * Checks for a pending reconnect notice whether the conversation is idle,
     * after promise callbacks already queued have run, and reconnects if so.
     * Until then the session keeps working; if the server closes it first, the
     * usual reconnect takes over.
     *
     * @returns {void}
     */
    #scheduleHandover() {
        const handover = this.#handover;
        if (!handover || handover.timer || this.#state !== 'connected') return;
        handover.timer = setTimeout(() => {
            handover.timer = null;
            if (this.#handover !== handover || !this.#idle()) return;
            void this.#reconnect({
                code: CLOSE_RESTART,
                reason: handover.reason,
            });
        }, 0);
    }

    /** @returns {void} */
    #endHandover() {
        if (this.#handover?.timer) clearTimeout(this.#handover.timer);
        this.#handover = null;
    }

    /**
     * @returns {void}
     * @internal
     */
    playbackEnded() {
        this.#scheduleHandover();
    }

    /** @returns {void} */
    #detach() {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        const session = this.#session;
        this.#session = null;
        if (session && session.socket.readyState < 2) session.close();
    }

    /** @returns {void} */
    #resetTurnState() {
        this.#activeResponse = '';
        this.#sessionUpdates = [];
        this.#sentSessions.clear();
        this.#requestedResponses.clear();
        this.#interruption = null;
        this.#cancelled.clear();
        this.#userTurn = false;
        this.#bufferedAudio = false;
        this.speaker.clearPlayback();
    }

    /**
     * @returns {void}
     * @internal
     */
    assertConnected() {
        if (this.#state !== 'connected')
            throw failure(
                this.#state === 'closed'
                    ? 'session_closed'
                    : 'session_not_ready',
                'Conversation is not connected',
            );
    }

    /**
     * Send a native OpenAI client event.
     *
     * @param {RealtimeClientEvent} event
     * @returns {void}
     */
    send(event) {
        this.assertConnected();
        if (event && typeof event === 'object' && !Array.isArray(event))
            event = { ...event, event_id: event.event_id ?? this.#eventId() };
        this.#write([event]);
    }

    /**
     * @param {ConvoSessionOptions} options
     * @returns {Promise<void>}
     */
    async configure(options) {
        this.assertConnected();
        validateOptions(options);
        await this.#configure(options);
    }

    /**
     * Sends the given settings; `full` sends every SDK-managed setting, as a
     * new session needs. A partial update leaves settings made through native
     * events alone.
     *
     * @param {ConvoSessionOptions} options
     * @param {boolean} [full]
     * @returns {Promise<void>}
     */
    async #configure(options, full = false) {
        if (this.#configuring)
            throw failure(
                'operation_in_progress',
                'A configuration update is pending',
            );
        this.#configuring = true;
        const next = {
            ...this.#options,
            ...options,
            output: [...(options.output ?? this.#options.output)],
        };
        /** @type {Record<string, any>} */
        const session = { type: 'realtime' };
        if (full || options.output)
            session.output_modalities = [
                next.output.includes('audio') ? 'audio' : 'text',
            ];
        if (options.instructions !== undefined)
            session.instructions = options.instructions;
        const input = {
            ...(full ? { format: { type: 'audio/pcm', rate: 24000 } } : {}),
            ...(full || options.turnDetection !== undefined
                ? {
                      turn_detection:
                          next.turnDetection === false
                              ? null
                              : { type: 'server_vad' },
                  }
                : {}),
        };
        const output = {
            ...(full ? { format: { type: 'audio/pcm', rate: 24000 } } : {}),
            ...(options.voice ? { voice: options.voice } : {}),
        };
        if (Object.keys(input).length || Object.keys(output).length)
            session.audio = {
                ...(Object.keys(input).length ? { input } : {}),
                ...(Object.keys(output).length ? { output } : {}),
            };
        const eventId = this.#eventId();
        try {
            await this.#request(
                'session.updated',
                { type: 'session.update', event_id: eventId, session },
                () => this.#acknowledgedUpdate === eventId,
            );
            this.#options = next;
        } finally {
            this.#configuring = false;
        }
    }

    /**
     * Adds a text turn and requests a reply.
     *
     * @param {string} text
     * @returns {void}
     */
    sendText(text) {
        this.assertConnected();
        if (typeof text !== 'string' || !text.trim())
            throw failure('invalid_argument', 'Text must be a nonempty string');
        if (text.length > 8192)
            throw failure('input_too_large', 'Text exceeds 8192 characters');
        this.#write([
            {
                type: 'conversation.item.create',
                event_id: this.#eventId(),
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text }],
                },
            },
            { type: 'response.create', event_id: this.#eventId() },
        ]);
    }

    /**
     * Appends PCM16 24 kHz mono audio, at most 12000 samples.
     *
     * @param {Int16Array} pcm
     * @returns {void}
     */
    appendAudio(pcm) {
        this.assertConnected();
        if (!(pcm instanceof Int16Array) || !pcm.length)
            throw failure(
                'invalid_argument',
                'Expected nonempty PCM16 samples',
            );
        if (pcm.length > 12000)
            throw failure(
                'input_too_large',
                'Audio chunk exceeds 12000 samples',
            );
        let binary = '';
        const bytes = new DataView(new ArrayBuffer(pcm.length * 2));
        for (let i = 0; i < pcm.length; i++)
            bytes.setInt16(i * 2, pcm[i], true);
        for (const byte of new Uint8Array(bytes.buffer))
            binary += String.fromCharCode(byte);
        this.#write(
            [
                {
                    type: 'input_audio_buffer.append',
                    event_id: this.#eventId(),
                    audio: btoa(binary),
                },
            ],
            MAX_BUFFERED_BYTES,
        );
    }

    /**
     * Commits audio and requests a response in manual turn mode.
     *
     * @returns {void}
     */
    commitAudio() {
        this.assertConnected();
        if (this.#turnDetection)
            throw failure(
                'invalid_argument',
                'Disable turnDetection before manually committing audio',
            );
        this.#write([
            { type: 'input_audio_buffer.commit', event_id: this.#eventId() },
            { type: 'response.create', event_id: this.#eventId() },
        ]);
    }

    /**
     * Stops local playback immediately and waits for cancellation and
     * truncation.
     *
     * @param {ConvoPlaybackPosition} [position]
     * @returns {Promise<void>}
     */
    interrupt(position) {
        this.assertConnected();
        return this.#interrupt(position, 'manual');
    }

    /**
     * @param {ConvoPlaybackPosition | undefined} position
     * @param {'manual' | 'speech'} source
     * @returns {Promise<void>}
     */
    #interrupt(position, source) {
        const playback =
            position ?? this.speaker.playbackPosition(this.#activeResponse);
        if (
            playback &&
            (typeof playback.itemId !== 'string' ||
                !playback.itemId.length ||
                !Number.isInteger(playback.contentIndex) ||
                playback.contentIndex < 0 ||
                !Number.isFinite(playback.playedMs) ||
                playback.playedMs < 0)
        )
            return Promise.reject(
                failure('invalid_argument', 'Invalid playback position'),
            );
        const id = this.#activeResponse || this.speaker.responseId;
        if (this.#interruption)
            return (!id || this.#interruption.id === id) &&
                (!position || this.#interruption.itemId === position.itemId)
                ? this.#interruption.promise
                : Promise.reject(
                      failure(
                          'operation_in_progress',
                          'Another response interruption is pending',
                      ),
                  );
        // A requested reply that hasn't started yet is cancelled once it does.
        const requested = !id && this.#requestedResponses.size > 0;
        if (!id && !playback && !requested) return Promise.resolve();
        if (id) this.#markCancelled(id);
        this.speaker.clearPlayback();
        const waits = [];
        const cancel = (/** @type {string} */ responseId) =>
            this.#request(
                'response.done',
                {
                    type: 'response.cancel',
                    response_id: responseId,
                    event_id: this.#eventId(),
                },
                (event) => event.response?.id === responseId,
            );
        if (this.#activeResponse) {
            waits.push(
                source === 'speech'
                    ? this.#wait(
                          'response.done',
                          (event) => event.response?.id === id,
                      )
                    : cancel(id),
            );
        } else if (requested) {
            waits.push(
                this.#wait('response.created').then((created) => {
                    const responseId = created.response?.id;
                    if (typeof responseId !== 'string') return;
                    this.#markCancelled(responseId);
                    return cancel(responseId);
                }),
            );
        }
        if (playback)
            waits.push(
                this.#request(
                    'conversation.item.truncated',
                    {
                        type: 'conversation.item.truncate',
                        item_id: playback.itemId,
                        content_index: playback.contentIndex,
                        audio_end_ms: Math.floor(playback.playedMs),
                        event_id: this.#eventId(),
                    },
                    (event) =>
                        event.item_id === playback.itemId &&
                        event.content_index === playback.contentIndex,
                ),
            );
        const promise = Promise.all(waits)
            .then(() => {})
            .finally(() => {
                if (this.#interruption?.promise === promise)
                    this.#interruption = null;
            });
        this.#interruption = { id, itemId: playback?.itemId, promise };
        this.emitRealtime({ type: 'interrupted', source, responseId: id });
        return promise;
    }

    /**
     * @param {string} id
     * @returns {void}
     */
    #markCancelled(id) {
        this.#cancelled.add(id);
        if (this.#cancelled.size > 32)
            this.#cancelled.delete(this.#cancelled.values().next().value);
    }

    /**
     * Ends the session and releases SDK-owned media.
     *
     * @returns {void}
     */
    close() {
        this.#finish({ type: 'close', code: 1000, reason: '' });
    }

    /**
     * @param {RealtimeServerEvent} event
     * @returns {void}
     */
    #finish(event) {
        if (this.#state === 'closed') return;
        this.#state = 'closed';
        this.#reconnecting = false;
        this.#reconnectWait?.();
        this.#endHandover();
        this.#replayEvents.clear();
        this.microphone.stop();
        void this.speaker.stop().catch(() => {});
        this.#rejectPending(
            failure('session_closed', 'Conversation is closed'),
        );
        for (const waiter of this.#reconnectWaiters.splice(0))
            waiter.reject(
                failure(
                    'session_closed',
                    event.reason || 'Conversation is closed',
                ),
            );
        this.#detach();
        this.#cancelled.clear();
        this.emitRealtime(event);
        this.clearRealtimeListeners();
    }

    /**
     * @param {ConvoError} error
     * @returns {void}
     * @internal
     */
    reportMediaError(error) {
        this.emitRealtime({
            type: 'error',
            code: error.code,
            message: error.message,
            error,
        });
    }

    /**
     * Shows the upgrade prompt for refusals a plan or more credit clears.
     *
     * @param {unknown} error
     * @returns {void}
     */
    #promptUpgrade(error) {
        try {
            promptIfUpgradeRequired(
                error,
                {
                    method: 'puter.ai.convo',
                    subscriptionMessage:
                        'Realtime conversations require a subscription.',
                },
                this.#puter,
            );
        } catch {
            // The prompt is best effort; the caller still gets the error.
        }
    }

    /**
     * @param {RealtimeServerEvent} event
     * @returns {void}
     */
    #receive(event) {
        if (this.#state === 'closed') return;
        if (event.type === 'close') {
            this.#lastClose = {
                type: 'close',
                code: event.code,
                reason: event.reason,
            };
            if (this.#state === 'connecting') {
                // `connect()` or the reconnect loop handles the failure.
                this.#rejectPending(
                    failure(
                        'session_closed',
                        event.reason || 'Realtime connection closed',
                    ),
                );
            } else if (RECONNECT_CODES.has(event.code)) {
                void this.#reconnect(event);
            } else {
                this.#finish(event);
            }
            return;
        }
        if (event.type === 'error') {
            const entry = this.#replayEvents.get(event.error?.event_id);
            if (entry) {
                this.#replayEvents.delete(event.error.event_id);
                this.#history.refused(entry);
                this.#replayFailed(event.error?.message);
                return;
            }
        }
        if (event.type === RECONNECT_NOTICE)
            this.#handover ??= {
                reason:
                    typeof event.reason === 'string' && event.reason
                        ? event.reason
                        : 'server_restarting',
                timer: null,
            };
        this.#history.observe(event);
        this.#trackTurn(event);
        if (event.type === 'response.created') {
            this.#activeResponse = event.response?.id ?? '';
            const [requested] = this.#requestedResponses;
            if (requested) this.#requestedResponses.delete(requested);
        }
        if (event.type === 'session.updated') {
            const id = this.#sessionUpdates.shift();
            this.#acknowledgedUpdate = id;
            const applied = id && this.#sentSessions.get(id);
            if (applied) {
                this.#sentSessions.delete(id);
                this.#sessionState = mergeSession(this.#sessionState, applied);
            }
        }
        if (
            event.type === 'session.created' ||
            event.type === 'session.updated'
        ) {
            const input = event.session?.audio?.input;
            if (input && 'turn_detection' in input) {
                this.#turnDetection = input.turn_detection != null;
                this.#autoResponse =
                    input.turn_detection?.create_response !== false;
            }
            if (input && 'transcription' in input)
                this.#transcribes = input.transcription != null;
        }
        if (event.type === 'error') {
            const failed = event.error?.event_id;
            if (failed) {
                this.#requestedResponses.delete(failed);
                const index = this.#sessionUpdates.indexOf(failed);
                if (index >= 0) this.#sessionUpdates.splice(index, 1);
                this.#sentSessions.delete(failed);
            }
            this.#promptUpgrade(event.error);
        }
        for (const operation of [...this.#pending]) {
            if (event.type === operation.type && operation.matches(event)) {
                clearTimeout(operation.timer);
                this.#pending.delete(operation);
                operation.resolve(event);
            } else if (
                event.type === 'error' &&
                (operation.anyError ||
                    (operation.eventId &&
                        event.error?.event_id === operation.eventId))
            ) {
                clearTimeout(operation.timer);
                this.#pending.delete(operation);
                operation.reject(
                    failure(
                        event.error?.code ?? 'upstream_error',
                        event.error?.message ?? 'Realtime request failed',
                    ),
                );
            }
        }
        this.#acknowledgedUpdate = undefined;
        if (
            event.type === 'response.done' &&
            event.response?.id === this.#activeResponse
        )
            this.#activeResponse = '';
        const cancelled = this.#cancelled.has(event.response_id);
        const responseId = String(event.response_id ?? '');
        if (event.type === 'response.output_text.delta' && !cancelled)
            this.emitRealtime({
                type: 'text',
                delta: String(event.delta ?? ''),
                responseId,
            });
        if (
            event.type === 'response.output_audio_transcript.delta' &&
            !cancelled
        ) {
            this.emitRealtime({
                type: 'transcript',
                role: 'assistant',
                text: String(event.delta ?? ''),
                final: false,
            });
            if (this.#options.output.includes('text'))
                this.emitRealtime({
                    type: 'text',
                    delta: String(event.delta ?? ''),
                    responseId,
                });
        }
        if (event.type === 'response.output_audio_transcript.done')
            this.emitRealtime({
                type: 'transcript',
                role: 'assistant',
                text: String(event.transcript ?? ''),
                final: true,
            });
        if (
            event.type ===
            'conversation.item.input_audio_transcription.completed'
        )
            this.emitRealtime({
                type: 'transcript',
                role: 'user',
                text: String(event.transcript ?? ''),
                final: true,
            });
        if (
            event.type === 'response.output_audio.delta' &&
            !cancelled &&
            (this.speaker.active ||
                this.hasRealtimeListeners('audio') ||
                this.hasRealtimeListeners('*'))
        ) {
            if (typeof event.delta === 'string') {
                let binary;
                try {
                    binary = atob(event.delta);
                } catch {
                    this.reportMediaError(
                        failure('invalid_audio', 'Invalid base64 audio'),
                    );
                    this.close();
                    return;
                }
                if (binary.length % 2) {
                    this.reportMediaError(
                        failure(
                            'invalid_audio',
                            'PCM16 audio must have whole samples',
                        ),
                    );
                    this.close();
                    return;
                }
                const view = new DataView(new ArrayBuffer(binary.length));
                for (let i = 0; i < binary.length; i++)
                    view.setUint8(i, binary.charCodeAt(i));
                const pcm = new Int16Array(Math.floor(binary.length / 2));
                for (let i = 0; i < pcm.length; i++)
                    pcm[i] = view.getInt16(i * 2, true);
                this.speaker.enqueue(pcm, event);
                this.emitRealtime({
                    type: 'audio',
                    pcm,
                    sampleRate: 24000,
                    responseId,
                    itemId: String(event.item_id ?? ''),
                    contentIndex: Number(event.content_index ?? 0),
                });
            }
        }
        if (
            event.type === 'input_audio_buffer.speech_started' &&
            this.speaker.bargeIn
        ) {
            void this.#interrupt(undefined, 'speech').catch((error) =>
                this.reportMediaError(error),
            );
        }
        if (event.type === 'response.done')
            this.emitRealtime({
                type: 'turn.done',
                responseId: event.response?.id,
                usage: event.response?.usage,
                status: event.response?.status,
            });
        this.emitRealtime(event);
        this.#scheduleHandover();
    }

    /**
     * @param {RealtimeServerEvent} event
     * @returns {void}
     */
    #trackTurn(event) {
        switch (event.type) {
            case 'input_audio_buffer.speech_started':
                this.#userTurn = true;
                break;
            case 'input_audio_buffer.committed':
                this.#bufferedAudio = false;
                // Server turn detection answers a committed turn on its own.
                if (!this.#turnDetection || !this.#autoResponse)
                    this.#userTurn = false;
                break;
            case 'input_audio_buffer.cleared':
                this.#bufferedAudio = false;
                this.#userTurn = false;
                break;
            case 'response.created':
                this.#userTurn = false;
                break;
        }
    }

    /** @returns {string} */
    #eventId() {
        return `puter_convo_${++this.#sequence}`;
    }
    /**
     * Sends events together or not at all. `limit` caps the socket's send
     * queue; audio gets less room than control events so a backlog of audio
     * never blocks a cancel or truncate.
     *
     * @param {RealtimeServerEvent[]} events
     * @param {number} [limit]
     * @returns {void}
     */
    #write(events, limit = MAX_BUFFERED_BYTES + MAX_MESSAGE_BYTES) {
        const socket = this.#session?.socket;
        if (!socket || socket.readyState !== 1)
            throw failure('session_closed', 'Conversation socket is closed');
        const messages = events.map((event) => encodeEvent(event));
        const bytes = messages.reduce((sum, m) => sum + m.bytes, 0);
        if ((socket.bufferedAmount ?? 0) + bytes > limit)
            throw failure('queue_full', 'Realtime send queue is full');
        for (const [i, { json }] of messages.entries()) {
            const event = events[i];
            if (event.type === 'session.update') {
                this.#sessionUpdates.push(event.event_id);
                // A copy, so later changes to the caller's object don't leak in.
                const { session } = JSON.parse(json);
                if (isPlainObject(session))
                    this.#sentSessions.set(event.event_id, session);
            }
            if (event.type === 'response.create')
                this.#requestedResponses.add(event.event_id);
            if (
                event.type === 'conversation.item.delete' &&
                typeof event.item_id === 'string'
            )
                this.#history.forget(event.item_id);
            if (
                event.type === 'input_audio_buffer.append' &&
                !this.#turnDetection
            )
                this.#bufferedAudio = true;
            socket.send(json);
        }
    }
    /**
     * @param {string} type
     * @param {(event: RealtimeServerEvent) => boolean} [matches]
     * @param {string} [eventId] Rejects on an error for this event.
     * @param {boolean} [anyError] Rejects on any error.
     * @param {number} [timeoutMs]
     * @returns {Promise<RealtimeServerEvent>}
     */
    #wait(
        type,
        matches = () => true,
        eventId,
        anyError = false,
        timeoutMs = OPERATION_TIMEOUT_MS,
    ) {
        if (this.#pending.size >= 8)
            return Promise.reject(
                failure(
                    'operation_in_progress',
                    'Too many pending realtime operations',
                ),
            );
        return new Promise((resolve, reject) => {
            const operation = {
                type,
                matches,
                eventId,
                anyError,
                resolve,
                reject,
                timer: setTimeout(() => {
                    this.#pending.delete(operation);
                    reject(
                        failure(
                            'operation_timeout',
                            `Timed out waiting for ${type}`,
                        ),
                    );
                    this.#scheduleHandover();
                }, timeoutMs),
            };
            this.#pending.add(operation);
        });
    }
    /**
     * Sends `event` and waits for its acknowledgment. A failed send rejects
     * only this request.
     *
     * @param {string} type
     * @param {RealtimeServerEvent} event
     * @param {(event: RealtimeServerEvent) => boolean} matches
     * @returns {Promise<RealtimeServerEvent>}
     */
    #request(type, event, matches) {
        if (this.#pending.size >= 8)
            return Promise.reject(
                failure(
                    'operation_in_progress',
                    'Too many pending realtime operations',
                ),
            );
        try {
            this.#write([event]);
        } catch (error) {
            return Promise.reject(error);
        }
        return this.#wait(type, matches, event.event_id);
    }
    /**
     * @param {ConvoError} error
     * @returns {void}
     */
    #rejectPending(error) {
        for (const operation of this.#pending) {
            clearTimeout(operation.timer);
            operation.reject(error);
        }
        this.#pending.clear();
    }
}

/**
 * Prepares a conversation and verifies sign-in without opening a realtime
 * connection.
 *
 * @this {import('./index.js').AIModule}
 * @param {ConvoOptions} [options]
 * @returns {Promise<Conversation>}
 */
export async function convo(options = {}) {
    validateOptions(options, true);
    const settings = {
        ...options,
        ...(options.output ? { output: [...options.output] } : {}),
    };
    const { puter } = this;
    if (!puter.authToken && puter.env === 'web') {
        try {
            await puter.ui.authenticateWithPuter();
        } catch {
            throw failure('auth_canceled', 'Authentication canceled');
        }
    }
    if (!puter.authToken)
        throw failure('auth_required', 'Authentication required');
    let response;
    try {
        response = await fetchUrl(`${puter.APIOrigin}/whoami`, {
            authToken: puter.authToken,
            retry: false,
            signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        });
    } catch {
        throw failure('auth_failed', 'Could not verify authentication');
    }
    if (response.status === 401 || response.status === 403)
        throw failure('auth_required', 'Authentication required');
    if (!response.ok)
        throw failure('auth_failed', 'Could not verify authentication');
    return new Conversation(puter, settings);
}
