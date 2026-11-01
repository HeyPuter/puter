/** @typedef {import('./types.js').RealtimeServerEvent} RealtimeServerEvent */

/**
 * An item `conversation.item.create` accepts: a text message, a function call
 * or a function call's output.
 *
 * @typedef {Record<string, unknown> & { type: string }} ConvoReplayItem
 */

/**
 * @typedef {Object} HistoryRecord
 * @property {string} id
 * @property {'message' | 'function_call' | 'function_call_output'} type
 * @property {string} [role]
 * @property {string} responseId
 * @property {boolean} final
 * @property {boolean} unsupported A part that can't be recreated as text.
 * @property {(string | null)[]} parts Text per content part; `null` for audio
 *   whose transcript hasn't arrived.
 * @property {string} received Transcript and text deltas as they arrived.
 * @property {string} shown The deltas the conversation delivered to the app.
 * @property {boolean} cancelled Finished after the SDK cancelled its response.
 * @property {number} audioMs Assistant audio received.
 * @property {number} [playedMs] Assistant audio heard, once truncated.
 * @property {string} [status]
 * @property {string} [callId]
 * @property {string} [name]
 * @property {string} [args]
 * @property {string} [output]
 */

/** @typedef {{ record: HistoryRecord; item: ConvoReplayItem }} ReplayEntry */

const ITEM_EVENTS = new Set([
    'conversation.item.added',
    'conversation.item.done',
    'response.output_item.added',
    'response.output_item.done',
]);
const DONE_EVENTS = new Set([
    'conversation.item.done',
    'response.output_item.done',
]);
const TEXT_DELTAS = new Set([
    'response.output_text.delta',
    'response.output_audio_transcript.delta',
]);
// PCM16 at 24 kHz mono.
const AUDIO_BYTES_PER_MS = 48;
// Twice the replay cap, leaving room for items that can't be replayed.
const MAX_RECORDS = 80;
const MAX_DELETED = 256;
const encoder = new TextEncoder();

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `text` cut to at most `limit` characters, back to the last word boundary when
 * the cut falls inside a word.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function cutText(text, limit) {
    if (limit >= text.length) return text;
    if (limit <= 0) return '';
    const cut = text.slice(0, limit);
    if (/\s/.test(text[limit])) return cut.trimEnd();
    const space = cut.search(/\s\S*$/);
    return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * The text of each message part, `null` for audio without a transcript, or
 * `undefined` for a part that can't be recreated as text.
 *
 * @param {unknown} part
 * @returns {string | null | undefined}
 */
function partText(part) {
    if (!isPlainObject(part)) return undefined;
    if (part.type === 'input_text' || part.type === 'output_text')
        return typeof part.text === 'string' ? part.text : undefined;
    if (part.type === 'input_audio' || part.type === 'output_audio')
        return typeof part.transcript === 'string' ? part.transcript : null;
    return undefined;
}

/**
 * Finished conversation items the SDK can recreate on a new provider session,
 * kept so a reconnect can restore context. Mirrors what the provider holds,
 * except that assistant output is cut to what the user saw or heard.
 *
 * @internal
 */
export class ConvoHistory {
    /** @type {HistoryRecord[]} */
    #records = [];
    /** @type {Map<string, HistoryRecord>} */
    #byId = new Map();
    /** @type {Set<string>} */
    #deleted = new Set();
    /** @type {(responseId: string) => boolean} */
    #isCancelled;
    // Replayed entries whose copy on the new session hasn't arrived yet.
    /** @type {ReplayEntry[]} */
    #echoes = [];
    // IDs of those copies, until their `conversation.item.done`.
    /** @type {Set<string>} */
    #echoIds = new Set();

    /**
     * @param {(responseId: string) => boolean} isCancelled Whether the SDK
     *   cancelled a response.
     */
    constructor(isCancelled) {
        this.#isCancelled = isCancelled;
    }

    /**
     * @param {RealtimeServerEvent} event
     * @returns {boolean} Whether the event announces the new session's copy of
     *   a replayed item.
     */
    observe(event) {
        if (ITEM_EVENTS.has(event.type))
            return this.#upsert(
                event.item,
                event.previous_item_id,
                event.response_id,
                DONE_EVENTS.has(event.type),
            );
        const record =
            typeof event.item_id === 'string'
                ? this.#byId.get(event.item_id)
                : undefined;
        switch (event.type) {
            case 'conversation.item.input_audio_transcription.completed':
            case 'conversation.item.input_audio_transcription.failed': {
                const index = Number(event.content_index ?? 0);
                if (!record || !(index in record.parts)) break;
                record.parts[index] =
                    event.type.endsWith('.completed') &&
                    typeof event.transcript === 'string'
                        ? event.transcript
                        : '';
                break;
            }
            case 'conversation.item.truncated':
                if (record && Number.isFinite(event.audio_end_ms))
                    record.playedMs = Number(event.audio_end_ms);
                break;
            case 'conversation.item.deleted':
                if (typeof event.item_id === 'string')
                    this.forget(event.item_id);
                break;
            case 'response.output_audio.delta':
                if (record && typeof event.delta === 'string')
                    record.audioMs +=
                        Math.floor((event.delta.length * 3) / 4) /
                        AUDIO_BYTES_PER_MS;
                break;
            default:
                if (
                    record &&
                    TEXT_DELTAS.has(event.type) &&
                    typeof event.delta === 'string'
                ) {
                    record.received += event.delta;
                    if (!this.#isCancelled(String(event.response_id ?? '')))
                        record.shown += event.delta;
                }
        }
        return false;
    }

    /**
     * Drops an item the app deleted, and keeps it from coming back.
     *
     * @param {string} itemId
     * @returns {void}
     */
    forget(itemId) {
        this.#deleted.add(itemId);
        if (this.#deleted.size > MAX_DELETED)
            this.#deleted.delete(this.#deleted.values().next().value);
        const record = this.#byId.get(itemId);
        if (record) this.#remove(record);
    }

    /**
     * Records that local playback of an item stopped after `playedMs`.
     *
     * @param {string} itemId
     * @param {number} playedMs
     * @returns {void}
     */
    truncate(itemId, playedMs) {
        const record = this.#byId.get(itemId);
        if (!record) return;
        record.playedMs = Math.min(record.playedMs ?? Infinity, playedMs);
    }

    /**
     * Whether a finished function call since the last user message has no
     * output yet. Calls cut off by a cancellation don't count.
     *
     * @returns {boolean}
     */
    get awaitingToolOutput() {
        const answered = new Set();
        for (let i = this.#records.length - 1; i >= 0; i--) {
            const record = this.#records[i];
            if (record.role === 'user') return false;
            if (record.type === 'function_call_output')
                answered.add(record.callId);
            else if (
                record.type === 'function_call' &&
                record.final &&
                record.status !== 'incomplete' &&
                !answered.has(record.callId)
            )
                return true;
        }
        return false;
    }

    /**
     * The newest recreatable items, oldest first, within `maxItems` and
     * `maxBytes` of encoded `conversation.item.create` events. Stops at the
     * first item that doesn't fit, so the window has no gaps from the budget.
     *
     * @param {number} maxItems
     * @param {number} maxBytes
     * @returns {{ entries: ReplayEntry[]; omittedItems: number }}
     */
    replay(maxItems, maxBytes) {
        /** @type {ReplayEntry[]} */
        const entries = [];
        let bytes = 0;
        for (
            let i = this.#records.length - 1;
            i >= 0 && entries.length < maxItems;
            i--
        ) {
            const record = this.#records[i];
            const item = this.#replayItem(record);
            if (!item) continue;
            // The event wrapper and its ID add well under 128 bytes.
            const size = encoder.encode(JSON.stringify(item)).byteLength + 128;
            if (bytes + size > maxBytes) break;
            bytes += size;
            entries.push({ record, item });
        }
        entries.reverse();
        const calls = new Set(
            entries
                .filter(({ item }) => item.type === 'function_call')
                .map(({ item }) => item.call_id),
        );
        const filtered = entries.filter(
            ({ item }) =>
                item.type !== 'function_call_output' || calls.has(item.call_id),
        );
        const restorable = this.#records.filter((record) =>
            this.#replayItem(record),
        ).length;
        return {
            entries: filtered,
            omittedItems: restorable - filtered.length,
        };
    }

    /**
     * Marks `entries` as sent to a new session, which answers with copies of
     * them under new IDs.
     *
     * @param {ReplayEntry[]} entries
     * @returns {void}
     */
    replayed(entries) {
        this.#echoes = [...entries];
        this.#echoIds.clear();
    }

    /**
     * Drops a replayed item the provider refused.
     *
     * @param {ReplayEntry} entry
     * @returns {void}
     */
    refused(entry) {
        this.#echoes = this.#echoes.filter((echo) => echo !== entry);
        this.#remove(entry.record);
    }

    /**
     * @param {HistoryRecord} record
     * @returns {void}
     */
    #remove(record) {
        const index = this.#records.indexOf(record);
        if (index >= 0) this.#records.splice(index, 1);
        if (this.#byId.get(record.id) === record) this.#byId.delete(record.id);
    }

    /**
     * @param {unknown} item
     * @param {unknown} previousItemId
     * @param {unknown} responseId
     * @param {boolean} done
     * @returns {boolean} Whether `item` is the new session's copy of a replayed
     *   item.
     */
    #upsert(item, previousItemId, responseId, done) {
        if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id)
            return false;
        if (this.#echoIds.has(item.id)) {
            if (done) this.#echoIds.delete(item.id);
            return true;
        }
        if (this.#deleted.has(item.id)) return false;
        let record = this.#byId.get(item.id);
        if (!record) {
            const fresh = this.#create(item);
            if (!fresh) return false;
            record = fresh;
            const echo = this.#takeEcho(item);
            if (echo) {
                // The copy takes the original's place under its new ID.
                this.#records[this.#records.indexOf(echo.record)] = record;
                this.#byId.delete(echo.record.id);
                this.#byId.set(record.id, record);
                this.#update(record, item);
                record.final = true;
                if (!done) this.#echoIds.add(record.id);
                return true;
            }
            const after =
                typeof previousItemId === 'string'
                    ? this.#byId.get(previousItemId)
                    : undefined;
            const index = after ? this.#records.indexOf(after) + 1 : -1;
            if (index > 0) this.#records.splice(index, 0, record);
            else this.#records.push(record);
            if (this.#records.length > MAX_RECORDS) {
                const [oldest] = this.#records.splice(0, 1);
                this.#byId.delete(oldest.id);
            }
            this.#byId.set(record.id, record);
        }
        if (typeof responseId === 'string' && responseId)
            record.responseId = responseId;
        this.#update(record, item);
        if (done || item.status === 'completed' || item.status === 'incomplete')
            record.final = true;
        if (record.final && record.role === 'assistant')
            record.cancelled = this.#isCancelled(record.responseId);
        return false;
    }

    /**
     * @param {Record<string, any>} item
     * @returns {HistoryRecord | null}
     */
    #create(item) {
        if (
            item.type !== 'message' &&
            item.type !== 'function_call' &&
            item.type !== 'function_call_output'
        )
            return null;
        if (
            item.type === 'message' &&
            !['user', 'assistant', 'system'].includes(item.role)
        )
            return null;
        return {
            id: item.id,
            type: item.type,
            role: item.type === 'message' ? item.role : undefined,
            responseId: '',
            final: false,
            unsupported: false,
            parts: [],
            received: '',
            shown: '',
            cancelled: false,
            audioMs: 0,
        };
    }

    /**
     * @param {HistoryRecord} record
     * @param {Record<string, any>} item
     * @returns {void}
     */
    #update(record, item) {
        if (typeof item.status === 'string') record.status = item.status;
        if (record.type === 'message') {
            if (!Array.isArray(item.content)) return;
            record.unsupported = false;
            record.parts = item.content.map((part, i) => {
                const text = partText(part);
                if (text === undefined) record.unsupported = true;
                // A finished item can repeat its audio without the transcript.
                return text ?? record.parts[i] ?? null;
            });
            return;
        }
        if (typeof item.call_id === 'string') record.callId = item.call_id;
        if (record.type === 'function_call') {
            if (typeof item.name === 'string') record.name = item.name;
            if (typeof item.arguments === 'string')
                record.args = item.arguments;
        } else if (typeof item.output === 'string') record.output = item.output;
    }

    /**
     * The `conversation.item.create` item that recreates `record`, or `null`.
     *
     * @param {HistoryRecord} record
     * @returns {ConvoReplayItem | null}
     */
    #replayItem(record) {
        if (!record.final) return null;
        if (record.type === 'function_call') {
            if (
                record.status === 'incomplete' ||
                !record.callId ||
                !record.name ||
                typeof record.args !== 'string'
            )
                return null;
            return {
                type: 'function_call',
                call_id: record.callId,
                name: record.name,
                arguments: record.args,
            };
        }
        if (record.type === 'function_call_output') {
            if (!record.callId || typeof record.output !== 'string')
                return null;
            return {
                type: 'function_call_output',
                call_id: record.callId,
                output: record.output,
            };
        }
        if (record.unsupported || record.parts.includes(null)) return null;
        if (record.role === 'assistant') {
            const text = this.#assistantText(record);
            if (!text.trim()) return null;
            return {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text }],
            };
        }
        const content = /** @type {string[]} */ (record.parts)
            .filter((text) => text.trim())
            .map((text) => ({ type: 'input_text', text }));
        if (!content.length) return null;
        return { type: 'message', role: record.role, content };
    }

    /**
     * Assistant text cut to what the user saw or heard: the deltas delivered
     * before the SDK cancelled the response, and the share of the transcript
     * matching the audio played before a truncation.
     *
     * @param {HistoryRecord} record
     * @returns {string}
     */
    #assistantText(record) {
        const full =
            /** @type {string[]} */ (record.parts).join('\n') ||
            record.received;
        let limit = full.length;
        if (record.cancelled) limit = Math.min(limit, record.shown.length);
        if (record.playedMs !== undefined)
            limit = Math.min(
                limit,
                record.audioMs > 0
                    ? Math.floor(
                          (full.length *
                              Math.min(record.playedMs, record.audioMs)) /
                              record.audioMs,
                      )
                    : 0,
            );
        return cutText(full, limit);
    }

    /**
     * The pending replayed entry `item` is the new session's copy of.
     *
     * @param {Record<string, any>} item
     * @returns {ReplayEntry | undefined}
     */
    #takeEcho(item) {
        const index = this.#echoes.findIndex(
            ({ item: sent }) =>
                sent.type === item.type &&
                (sent.type === 'message'
                    ? sent.role === item.role &&
                      JSON.stringify(
                          /** @type {any[]} */ (sent.content).map(
                              (part) => part.text,
                          ),
                      ) ===
                          JSON.stringify(
                              Array.isArray(item.content)
                                  ? item.content.map(partText)
                                  : null,
                          )
                    : sent.call_id === item.call_id),
        );
        if (index < 0) return undefined;
        const [echo] = this.#echoes.splice(index, 1);
        if (!this.#records.includes(echo.record)) return undefined;
        return echo;
    }
}
