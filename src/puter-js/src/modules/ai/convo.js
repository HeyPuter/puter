import { fetchUrl } from '../../lib/networkUtils.js';
import { RealtimeSession, createRealtimeSocket } from './assistant.js';
import { RealtimeEvents } from './realtimeEvents.js';
import { ConvoMicrophone, ConvoSpeaker } from './convoMedia.js';

/** @typedef {import('./types.js').ConvoOptions} ConvoOptions */
/** @typedef {import('./types.js').ConvoSessionOptions} ConvoSessionOptions */
/** @typedef {import('./types.js').ConvoPlaybackPosition} ConvoPlaybackPosition */
/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */
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
const encoder = new TextEncoder();

/**
 * @param {string} code
 * @param {string} message
 * @returns {ConvoError}
 */
const failure = (code, message) => ({ code, message });

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
 * @returns {string}
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
    if (encoder.encode(json).byteLength > MAX_MESSAGE_BYTES)
        throw failure('input_too_large', 'Event exceeds 64 KiB');
    return json;
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
    /** @type {Promise<void> | null} */
    #connection = null;
    /**
     * @type {Set<{
     *     type: string;
     *     matches: (event: RealtimeServerEvent) => boolean;
     *     resolve: (event: RealtimeServerEvent) => void;
     *     reject: (error: ConvoError) => void;
     *     timer: ReturnType<typeof setTimeout>;
     *     eventId?: string;
     * }>}
     */
    #pending = new Set();
    #sequence = 0;
    #configuring = false;
    #activeResponse = '';
    /**
     * @type {{
     *     id: string;
     *     itemId?: string;
     *     promise: Promise<void>;
     * } | null}
     */
    #interruption = null;
    #cancelled = new Set();
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
     * Opens and configures the session. Concurrent calls share one attempt.
     *
     * @returns {Promise<void>}
     */
    connect() {
        if (this.#state === 'closed')
            return Promise.reject(
                failure('session_closed', 'Conversation is closed'),
            );
        if (this.#connection) return this.#connection;
        if (!this.#puter.authToken)
            return Promise.reject(
                failure('auth_required', 'Authentication required'),
            );
        this.#state = 'connecting';
        this.#connection = (async () => {
            try {
                this.#session = new RealtimeSession(
                    createRealtimeSocket(this.#puter, this.model),
                );
                this.#session.on('*', (event) => this.#receive(event));
                await this.#wait('session.created');
                await this.#configure(this.#options);
                if (this.#state === 'closed')
                    throw failure('session_closed', 'Conversation is closed');
                this.#state = 'connected';
                this.emitRealtime({
                    type: 'ready',
                    model: this.model,
                    provider: 'openai',
                });
            } catch (error) {
                this.close();
                throw error;
            }
        })();
        return this.#connection;
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
     * @param {RealtimeServerEvent} event
     * @returns {void}
     */
    send(event) {
        this.assertConnected();
        this.#write(event);
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
     * @param {ConvoSessionOptions} options
     * @returns {Promise<void>}
     */
    async #configure(options) {
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
        const audio = next.output.includes('audio');
        const eventId = this.#eventId();
        const session = {
            type: 'realtime',
            output_modalities: [audio ? 'audio' : 'text'],
            ...(next.instructions !== undefined
                ? { instructions: next.instructions }
                : {}),
            audio: {
                input: {
                    format: { type: 'audio/pcm', rate: 24000 },
                    turn_detection:
                        next.turnDetection === false
                            ? null
                            : { type: 'server_vad' },
                },
                output: {
                    format: { type: 'audio/pcm', rate: 24000 },
                    ...(next.voice ? { voice: next.voice } : {}),
                },
            },
        };
        try {
            await this.#request(
                'session.updated',
                { type: 'session.update', event_id: eventId, session },
                () => true,
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
        this.#write(
            {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text }],
                },
            },
            { type: 'response.create' },
        );
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
        this.#write({ type: 'input_audio_buffer.append', audio: btoa(binary) });
    }

    /**
     * Commits audio and requests a response in manual turn mode.
     *
     * @returns {void}
     */
    commitAudio() {
        this.assertConnected();
        if (this.#options.turnDetection !== false)
            throw failure(
                'invalid_argument',
                'Disable turnDetection before manually committing audio',
            );
        this.#write(
            { type: 'input_audio_buffer.commit' },
            { type: 'response.create' },
        );
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
        const playback = position ?? this.speaker.playbackPosition();
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
        if (!id && !playback) return Promise.resolve();
        if (id) {
            this.#cancelled.add(id);
            if (this.#cancelled.size > 32)
                this.#cancelled.delete(this.#cancelled.values().next().value);
        }
        this.speaker.clearPlayback();
        const waits = [];
        if (this.#activeResponse) {
            const matches = (event) => event.response?.id === id;
            waits.push(
                source === 'speech'
                    ? this.#wait('response.done', matches)
                    : this.#request(
                          'response.done',
                          {
                              type: 'response.cancel',
                              response_id: id,
                              event_id: this.#eventId(),
                          },
                          matches,
                      ),
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
                this.#interruption = null;
            });
        this.#interruption = { id, itemId: playback?.itemId, promise };
        this.emitRealtime({ type: 'interrupted', source, responseId: id });
        return promise;
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
        this.microphone.stop();
        void this.speaker.stop().catch(() => {});
        this.#rejectPending(
            failure('session_closed', 'Conversation is closed'),
        );
        this.#session?.close();
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
     * @param {RealtimeServerEvent} event
     * @returns {void}
     */
    #receive(event) {
        if (this.#state === 'closed') return;
        if (event.type === 'close') {
            this.#finish(event);
            return;
        }
        if (event.type === 'response.created')
            this.#activeResponse = event.response?.id ?? '';
        for (const operation of [...this.#pending]) {
            if (event.type === operation.type && operation.matches(event)) {
                clearTimeout(operation.timer);
                this.#pending.delete(operation);
                operation.resolve(event);
            } else if (
                event.type === 'error' &&
                (!event.error?.event_id ||
                    !operation.eventId ||
                    event.error.event_id === operation.eventId)
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
        if (
            event.type === 'response.done' &&
            event.response?.id === this.#activeResponse
        )
            this.#activeResponse = '';
        if (event.type === 'response.output_text.delta')
            this.emitRealtime({
                type: 'text',
                delta: event.delta,
                responseId: event.response_id,
            });
        if (event.type === 'response.output_audio_transcript.delta') {
            this.emitRealtime({
                type: 'transcript',
                role: 'assistant',
                text: event.delta,
                final: false,
            });
            if (this.#options.output.includes('text'))
                this.emitRealtime({
                    type: 'text',
                    delta: event.delta,
                    responseId: event.response_id,
                });
        }
        if (event.type === 'response.output_audio_transcript.done')
            this.emitRealtime({
                type: 'transcript',
                role: 'assistant',
                text: event.transcript,
                final: true,
            });
        if (
            event.type ===
            'conversation.item.input_audio_transcription.completed'
        )
            this.emitRealtime({
                type: 'transcript',
                role: 'user',
                text: event.transcript,
                final: true,
            });
        if (
            event.type === 'response.output_audio.delta' &&
            !this.#cancelled.has(event.response_id) &&
            (this.speaker.active || this.hasRealtimeListeners('audio'))
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
                    responseId: event.response_id,
                    itemId: event.item_id,
                    contentIndex: event.content_index,
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
    }

    /** @returns {string} */
    #eventId() {
        return `puter_convo_${++this.#sequence}`;
    }
    /**
     * @param {...RealtimeServerEvent} events
     * @returns {void}
     */
    #write(...events) {
        if (!this.#session || this.#session.socket.readyState !== 1)
            throw failure('session_closed', 'Conversation socket is closed');
        const messages = events.map((event) => encodeEvent(event));
        const bytes = messages.reduce(
            (sum, json) => sum + encoder.encode(json).byteLength,
            0,
        );
        if (this.#session.socket.bufferedAmount + bytes > MAX_BUFFERED_BYTES)
            throw failure('queue_full', 'Realtime send queue exceeds 128 KiB');
        for (const json of messages) this.#session.socket.send(json);
    }
    /**
     * @param {string} type
     * @param {(event: RealtimeServerEvent) => boolean} [matches]
     * @param {string} [eventId]
     * @returns {Promise<RealtimeServerEvent>}
     */
    #wait(type, matches = () => true, eventId) {
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
                }, OPERATION_TIMEOUT_MS),
            };
            this.#pending.add(operation);
        });
    }
    /**
     * @param {string} type
     * @param {RealtimeServerEvent} event
     * @param {(event: RealtimeServerEvent) => boolean} matches
     * @returns {Promise<RealtimeServerEvent>}
     */
    #request(type, event, matches) {
        const result = this.#wait(type, matches, event.event_id);
        try {
            this.#write(event);
        } catch (error) {
            this.#rejectPending(error);
        }
        return result;
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
            interactiveReauth: false,
            retry: false,
            signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
        });
    } catch {
        throw failure('auth_failed', 'Could not verify authentication');
    }
    if (!response.ok) throw failure('auth_required', 'Authentication required');
    return new Conversation(puter, settings);
}
