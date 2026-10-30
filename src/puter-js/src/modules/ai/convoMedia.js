/** @typedef {import('./convo.js').Conversation} Conversation */
/** @typedef {import('./types.js').ConvoPlaybackPosition} ConvoPlaybackPosition */
/** @typedef {import('./types.js').ConvoSpeakerOptions} ConvoSpeakerOptions */
/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

const SAMPLE_RATE = 24000;
const MEDIA_TIMEOUT_MS = 10_000;
// Replies arrive faster than they play; this bounds what may be scheduled.
const MAX_SCHEDULED_SECONDS = 300;

/**
 * @template T
 * @param {Promise<T>} operation
 * @returns {Promise<T>}
 */
function mediaTimeout(operation) {
    let timer;
    return Promise.race([
        operation,
        new Promise((_, reject) => {
            timer = setTimeout(
                () =>
                    reject({
                        code: 'media_timeout',
                        message: 'Media initialization timed out',
                    }),
                MEDIA_TIMEOUT_MS,
            );
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Keeps SDK errors and replaces browser exceptions, whose `code` is numeric.
 *
 * @param {unknown} error
 * @param {string} message
 * @returns {{ code: string; message: string }}
 */
function mediaError(error, message) {
    const { code } = /** @type {{ code?: unknown }} */ (error ?? {});
    return typeof code === 'string'
        ? /** @type {{ code: string; message: string }} */ (error)
        : { code: 'media_error', message };
}

/**
 * Capture runs at the device rate (Firefox can't connect a microphone to a
 * context at another rate) and the worklet resamples; playback runs at 24 kHz.
 *
 * @param {number} [sampleRate]
 * @returns {AudioContext}
 */
function audioContext(sampleRate) {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined')
        throw {
            code: 'unsupported_environment',
            message: 'Audio helpers require a browser with Web Audio support',
        };
    return new AudioContext(sampleRate ? { sampleRate } : undefined);
}

// The worklet owns resampling. Chunks the main thread hasn't taken within
// about half a second are dropped rather than queued.
const CAPTURE_WORKLET = `
class PuterConvoCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.samples = new Int16Array(480);
        this.length = 0;
        this.phase = 0;
        this.sum = 0;
        this.count = 0;
        this.pending = 0;
        this.port.onmessage = () => { this.pending = Math.max(0, this.pending - 1); };
    }
    process(inputs) {
        const channel = inputs[0]?.[0];
        if (!channel) return true;
        for (const sample of channel) {
            this.sum += sample;
            this.count++;
            this.phase += 24000;
            while (this.phase >= sampleRate) {
                const value = Math.max(-1, Math.min(1, this.count ? this.sum / this.count : sample));
                this.samples[this.length++] = Math.round(value * (value < 0 ? 32768 : 32767));
                this.phase -= sampleRate;
                this.sum = 0;
                this.count = 0;
                if (this.length === 480) {
                    if (this.pending >= 25) {
                        this.length = 0;
                        continue;
                    }
                    this.pending++;
                    this.port.postMessage({ pcm: this.samples }, [this.samples.buffer]);
                    this.samples = new Int16Array(480);
                    this.length = 0;
                }
            }
        }
        return true;
    }
}
registerProcessor('puter-convo-capture', PuterConvoCapture);
`;

/** Optional browser microphone capture. */
export class ConvoMicrophone {
    /** @type {Conversation} */
    #convo;
    /** @type {MediaStream | null} */
    #stream = null;
    /** @type {AudioContext | null} */
    #context = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    #source = null;
    /** @type {AudioWorkletNode | null} */
    #node = null;
    /** @type {Promise<void> | null} */
    #starting = null;
    #generation = 0;
    #muted = false;
    /** @type {(() => void) | null} */
    #cancelStart = null;

    /**
     * @param {Conversation} convo
     * @internal
     */
    constructor(convo) {
        this.#convo = convo;
    }

    /**
     * Requests microphone permission and streams 20 ms PCM chunks.
     *
     * @returns {Promise<void>}
     */
    start() {
        try {
            this.#convo.assertConnected();
        } catch (error) {
            return Promise.reject(error);
        }
        if (this.#starting) return this.#starting;
        if (this.#stream) return Promise.resolve();
        const generation = ++this.#generation;
        this.#starting = this.#start(generation).catch((error) => {
            if (generation === this.#generation) this.stop();
            if (
                error?.name === 'NotAllowedError' ||
                error?.name === 'SecurityError'
            )
                throw {
                    code: 'permission_denied',
                    message: 'Microphone access was denied',
                };
            throw mediaError(error, 'Could not start microphone capture');
        });
        return this.#starting;
    }

    /**
     * @param {number} generation
     * @returns {Promise<void>}
     */
    async #start(generation) {
        if (
            typeof navigator === 'undefined' ||
            !navigator.mediaDevices?.getUserMedia
        )
            throw {
                code: 'unsupported_environment',
                message: 'Microphone capture requires browser media support',
            };
        const context = audioContext();
        this.#context = context;
        // A reconnect keeps capture running; chunks are dropped meanwhile.
        const current = () =>
            generation === this.#generation && this.#convo.state !== 'closed';
        const permission = navigator.mediaDevices
            .getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            })
            .then((stream) => {
                if (!current()) {
                    stream.getTracks().forEach((track) => track.stop());
                    throw {
                        code: 'session_closed',
                        message: 'Capture was stopped',
                    };
                }
                this.#stream = stream;
                return stream;
            });
        // Not timed: the user may take a while to answer the prompt. Stopping
        // ends the wait.
        const stopped = new Promise((_, reject) => {
            this.#cancelStart = () =>
                reject({
                    code: 'session_closed',
                    message: 'Capture was stopped',
                });
        });
        const stream = await Promise.race([permission, stopped]);
        this.#cancelStart = null;
        await mediaTimeout(context.resume());
        if (!current())
            throw { code: 'session_closed', message: 'Capture was stopped' };
        const url = URL.createObjectURL(
            new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }),
        );
        try {
            await mediaTimeout(context.audioWorklet.addModule(url));
        } finally {
            URL.revokeObjectURL(url);
        }
        if (!current())
            throw { code: 'session_closed', message: 'Capture was stopped' };
        this.#node = new AudioWorkletNode(context, 'puter-convo-capture');
        this.#source = context.createMediaStreamSource(stream);
        const node = this.#node;
        node.port.onmessage = ({ data }) => {
            if (!current()) return;
            node.port.postMessage('ack');
            if (this.#muted || this.#convo.state !== 'connected') return;
            try {
                this.#convo.appendAudio(data.pcm);
            } catch (error) {
                // A congested socket drops audio instead of ending capture.
                if (error?.code === 'queue_full') return;
                this.stop();
                this.#convo.reportMediaError(error);
            }
        };
        node.onprocessorerror = () => {
            this.stop();
            this.#convo.reportMediaError({
                code: 'media_error',
                message: 'Microphone processor failed',
            });
        };
        this.#source.connect(node);
        node.connect(context.destination);
    }

    /** @returns {void} */
    mute() {
        this.#muted = true;
        this.#stream?.getAudioTracks().forEach((track) => {
            track.enabled = false;
        });
    }
    /** @returns {void} */
    unmute() {
        this.#muted = false;
        this.#stream?.getAudioTracks().forEach((track) => {
            track.enabled = true;
        });
    }
    /**
     * Releases capture tracks and audio resources.
     *
     * @returns {void}
     */
    stop() {
        this.#generation++;
        this.#cancelStart?.();
        this.#cancelStart = null;
        this.#node?.disconnect();
        if (this.#node) {
            this.#node.port.onmessage = null;
            this.#node.port.close();
            this.#node.onprocessorerror = null;
        }
        this.#node = null;
        this.#source?.disconnect();
        this.#source = null;
        this.#stream?.getTracks().forEach((track) => track.stop());
        this.#stream = null;
        void this.#context?.close().catch(() => {});
        this.#context = null;
        this.#starting = null;
    }
}

/** Optional bounded browser PCM playback. */
export class ConvoSpeaker {
    /** @type {Conversation} */
    #convo;
    /** @type {AudioContext | null} */
    #context = null;
    /** @type {Promise<void> | null} */
    #starting = null;
    /**
     * @type {Set<{
     *     node: AudioBufferSourceNode;
     *     start: number;
     *     end: number;
     *     itemId: string;
     *     contentIndex: number;
     *     offset: number;
     *     responseId: string;
     * }>}
     */
    #sources = new Set();
    /** @type {(ConvoPlaybackPosition & { responseId: string }) | null} */
    #last = null;
    #nextAt = 0;
    #bargeIn = true;
    // The response whose overflow was last reported, so it's reported once.
    #overflowed = '';

    /**
     * @param {Conversation} convo
     * @internal
     */
    constructor(convo) {
        this.#convo = convo;
    }
    /**
     * @returns {boolean}
     * @internal
     */
    get bargeIn() {
        return this.#context !== null && this.#bargeIn;
    }
    /**
     * @returns {string}
     * @internal
     */
    get responseId() {
        return this.#sources.size ? (this.#last?.responseId ?? '') : '';
    }
    /**
     * @returns {boolean}
     * @internal
     */
    get active() {
        return this.#context !== null;
    }

    /**
     * Starts playback without requesting microphone access.
     *
     * @param {ConvoSpeakerOptions} [options]
     * @returns {Promise<void>}
     */
    start(options = {}) {
        try {
            this.#convo.assertConnected();
        } catch (error) {
            return Promise.reject(error);
        }
        if (
            !options ||
            typeof options !== 'object' ||
            (options.bargeIn !== undefined &&
                typeof options.bargeIn !== 'boolean')
        )
            return Promise.reject({
                code: 'invalid_argument',
                message: 'bargeIn must be boolean',
            });
        this.#bargeIn = options.bargeIn ?? true;
        if (this.#starting) return this.#starting;
        try {
            this.#context = audioContext(SAMPLE_RATE);
        } catch (error) {
            return Promise.reject(
                mediaError(error, 'Could not start playback'),
            );
        }
        const context = this.#context;
        this.#starting = mediaTimeout(context.resume())
            .then(() => {
                if (context !== this.#context)
                    throw {
                        code: 'session_closed',
                        message: 'Playback was stopped',
                    };
            })
            .catch((error) => {
                if (context === this.#context) void this.stop();
                throw mediaError(error, 'Could not start playback');
            });
        return this.#starting;
    }

    /**
     * @param {Int16Array} pcm
     * @param {RealtimeServerEvent} event
     * @returns {void}
     * @internal
     */
    enqueue(pcm, event) {
        const context = this.#context;
        if (!context || context.state !== 'running' || !pcm.length) return;
        const duration = pcm.length / SAMPLE_RATE;
        const start = Math.max(context.currentTime, this.#nextAt);
        if (start + duration - context.currentTime > MAX_SCHEDULED_SECONDS) {
            const responseId = String(event.response_id ?? '');
            if (this.#overflowed !== responseId) {
                this.#overflowed = responseId;
                this.#convo.reportMediaError({
                    code: 'queue_full',
                    message: `Playback exceeds ${MAX_SCHEDULED_SECONDS} seconds`,
                });
            }
            return;
        }
        const itemId = String(event.item_id ?? '');
        const contentIndex = Number(event.content_index ?? 0);
        const previous = [...this.#sources].at(-1);
        const offset =
            previous?.itemId === itemId &&
            previous.contentIndex === contentIndex
                ? previous.offset + previous.end - previous.start
                : this.#last?.itemId === itemId
                  ? this.#last.playedMs / 1000
                  : 0;
        const buffer = context.createBuffer(1, pcm.length, SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(context.destination);
        const source = {
            node,
            start,
            end: start + duration,
            itemId,
            contentIndex,
            offset,
            responseId: String(event.response_id ?? ''),
        };
        this.#sources.add(source);
        this.#last = {
            itemId,
            contentIndex,
            playedMs: offset * 1000,
            responseId: source.responseId,
        };
        node.onended = () => {
            this.#sources.delete(source);
            node.disconnect();
            if (this.#last?.itemId === itemId)
                this.#last.playedMs = Math.max(
                    this.#last.playedMs,
                    (offset + duration) * 1000,
                );
        };
        this.#nextAt = source.end;
        node.start(start);
    }

    /**
     * How much the listener has heard: the context clock less output latency
     * (Bluetooth adds hundreds of milliseconds). Between chunks, when nothing
     * is scheduled, it is the end of what played for `responseId`.
     *
     * @param {string} [responseId] The response still generating, if any.
     * @returns {ConvoPlaybackPosition | undefined}
     * @internal
     */
    playbackPosition(responseId) {
        const context = this.#context;
        const heard =
            (context?.currentTime ?? 0) -
            (context?.outputLatency || context?.baseLatency || 0);
        for (const source of this.#sources) {
            if (source.end > heard)
                return {
                    itemId: source.itemId,
                    contentIndex: source.contentIndex,
                    playedMs: Math.floor(
                        (source.offset + Math.max(0, heard - source.start)) *
                            1000,
                    ),
                };
        }
        const last = this.#last;
        if (last && responseId && last.responseId === responseId)
            return {
                itemId: last.itemId,
                contentIndex: last.contentIndex,
                playedMs: Math.floor(last.playedMs),
            };
        return undefined;
    }

    /**
     * @returns {void}
     * @internal
     */
    clearPlayback() {
        for (const source of this.#sources) {
            source.node.onended = null;
            source.node.stop();
            source.node.disconnect();
        }
        this.#sources.clear();
        this.#last = null;
        this.#nextAt = 0;
    }

    /**
     * Releases playback resources.
     *
     * @returns {Promise<void>}
     */
    async stop() {
        this.clearPlayback();
        const context = this.#context;
        this.#context = null;
        this.#starting = null;
        if (context && context.state !== 'closed') await context.close();
    }
}
