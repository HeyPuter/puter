/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * SSE transport (`startSse`) plus the Anthropic `/v1/messages` streaming writer
 * (`AnthropicSseWriter`), which turns the driver's NDJSON chunk protocol
 * (`drivers/ai-chat/utils/Streaming.js`) into the exact Anthropic event
 * sequence: `message_start` → `content_block_start/delta/stop`* →
 * `message_delta` → `message_stop`.
 */

import type { Response } from 'express';
import type { UsageDetails } from '../../drivers/ai-chat/types.js';
import { promoteStopForToolCalls } from '../../drivers/ai-chat/utils/stopReason.js';
import { anthropicUsage } from './anthropicWire.js';

// -- SSE transport ------------------------------------------------------------

/** Idle time before a keepalive ping is due. */
const PING_IDLE_MS = 15_000;
/** How often the idle clock is checked. */
const PING_CHECK_MS = 5_000;

export interface Sse {
    write(eventType: string, data: unknown): void;
    end(): void;
    readonly ended: boolean;
}

/**
 * A minimal `event: <type>\ndata: <json>\n\n` writer over an Express response.
 * With `ping: true`, a 5 s interval writes an Anthropic keepalive frame
 * whenever nothing has been written for 15 s — matching Claude Code's own
 * gateway behavior, so a long reasoning idle doesn't look like a dead
 * connection to a client that expects one.
 */
export const startSse = (res: Response, opts: { ping?: boolean } = {}): Sse => {
    let ended = false;
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;

    const write = (eventType: string, data: unknown): void => {
        if (ended) return;
        lastActivity = Date.now();
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const end = (): void => {
        if (ended) return;
        ended = true;
        if (timer) clearInterval(timer);
        res.end();
    };

    if (opts.ping) {
        timer = setInterval(() => {
            if (ended) return;
            if (Date.now() - lastActivity >= PING_IDLE_MS) {
                lastActivity = Date.now();
                res.write('event: ping\ndata: {"type": "ping"}\n\n');
            }
        }, PING_CHECK_MS);
        timer.unref?.();
    }

    res.once('close', () => {
        ended = true;
        if (timer) clearInterval(timer);
    });

    return {
        write,
        end,
        get ended() {
            return ended;
        },
    };
};

// -- Anthropic error-type table (mid-stream `event: error`) -------------------

const STREAM_ERROR_TYPES: Record<number, string> = {
    400: 'invalid_request_error',
    401: 'authentication_error',
    403: 'permission_error',
    404: 'not_found_error',
    413: 'request_too_large',
    429: 'rate_limit_error',
    504: 'timeout_error',
    529: 'overloaded_error',
};

const jsonOf = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value ?? {});

type OpenBlockKind =
    | 'text'
    | 'thinking'
    | 'tool_use'
    | 'server_tool_use'
    | 'compaction'
    | 'other';

interface OpenBlock {
    kind: OpenBlockKind;
    id?: string;
}

/**
 * Anthropic `/v1/messages` SSE writer: one instance per streaming request.
 * Consumes the driver's NDJSON chunks (`onChunk`) and writes the matching
 * Anthropic event(s); `start()` opens the message, `onChunk({type:'usage'|
 * 'error', ...})` closes it.
 */
export class AnthropicSseWriter {
    #sse: Sse;
    #id: string;
    #model: string;
    #requestId: string;
    #index = -1;
    #open: OpenBlock | null = null;
    #signedReasoning = false;
    #safeguards: unknown[] | undefined;
    #sawToolUse = false;
    /** Tool calls already opened by `tool_use_start`. */
    #startedToolIds = new Set<unknown>();
    #ended = false;

    constructor(
        sse: Sse,
        ids: { id: string; model: string; requestId: string },
    ) {
        this.#sse = sse;
        this.#id = ids.id;
        this.#model = ids.model;
        this.#requestId = ids.requestId;
    }

    get ended(): boolean {
        return this.#ended;
    }

    start(): void {
        this.#sse.write('message_start', {
            type: 'message_start',
            message: {
                id: this.#id,
                type: 'message',
                role: 'assistant',
                content: [],
                model: this.#model,
                stop_reason: null,
                stop_sequence: null,
                usage: anthropicUsage({ inputTokens: 0, outputTokens: 0 }),
            },
        });
    }

    #openBlock(
        kind: OpenBlockKind,
        contentBlock: Record<string, unknown>,
        id?: string,
    ): void {
        this.#index++;
        this.#open = { kind, id };
        this.#sse.write('content_block_start', {
            type: 'content_block_start',
            index: this.#index,
            content_block: contentBlock,
        });
    }

    #delta(delta: Record<string, unknown>): void {
        this.#sse.write('content_block_delta', {
            type: 'content_block_delta',
            index: this.#index,
            delta,
        });
    }

    #close(): void {
        if (!this.#open) return;
        this.#sse.write('content_block_stop', {
            type: 'content_block_stop',
            index: this.#index,
        });
        this.#open = null;
    }

    #ensureText(): void {
        if (this.#open?.kind === 'text') return;
        this.#close();
        this.#openBlock('text', { type: 'text', text: '' });
    }

    #reasoningDetail(detail: Record<string, unknown> | undefined): void {
        if (!detail) return;
        if (detail.type === 'thinking') {
            if (this.#open?.kind === 'thinking') {
                this.#delta({
                    type: 'signature_delta',
                    signature: detail.signature ?? '',
                });
            }
            this.#close();
        } else if (detail.type === 'redacted_thinking') {
            // No preceding `reasoning_start` for a redacted block — open and
            // close it here, same as the provider's own emission order.
            this.#close();
            this.#openBlock('other', {
                type: 'redacted_thinking',
                data: detail.data,
            });
            this.#close();
        }
        // An OpenAI Responses `reasoning` detail has no Anthropic stream
        // analog — dropped here; the non-stream route keeps it verbatim.
    }

    #serverBlock(block: Record<string, unknown>): void {
        this.#close();
        if (block.type === 'server_tool_use') {
            this.#openBlock(
                'server_tool_use',
                {
                    type: 'server_tool_use',
                    id: block.id,
                    name: block.name,
                    input: {},
                },
                block.id as string | undefined,
            );
            this.#delta({
                type: 'input_json_delta',
                partial_json: jsonOf(block.input),
            });
            this.#close();
        } else {
            // A server-tool *result* block (web_search_tool_result, …) arrives
            // whole — no deltas.
            this.#openBlock('other', block);
            this.#close();
        }
    }

    onChunk(ev: Record<string, unknown>): void {
        if (this.#ended) return;
        switch (ev.type) {
            case 'text':
                if (typeof ev.text === 'string') {
                    this.#ensureText();
                    this.#delta({ type: 'text_delta', text: ev.text });
                }
                break;
            case 'reasoning_start':
                this.#signedReasoning = ev.format === 'anthropic';
                if (this.#signedReasoning) {
                    this.#close();
                    this.#openBlock('thinking', {
                        type: 'thinking',
                        thinking: '',
                        signature: '',
                    });
                }
                break;
            case 'reasoning':
                if (
                    this.#signedReasoning &&
                    this.#open?.kind === 'thinking' &&
                    typeof ev.reasoning === 'string'
                ) {
                    this.#delta({
                        type: 'thinking_delta',
                        thinking: ev.reasoning,
                    });
                }
                break;
            case 'reasoning_detail':
                this.#reasoningDetail(
                    ev.detail as Record<string, unknown> | undefined,
                );
                break;
            case 'tool_use_start':
                this.#startedToolIds.add(ev.id);
                this.#close();
                this.#openBlock(
                    'tool_use',
                    { type: 'tool_use', id: ev.id, name: ev.name, input: {} },
                    ev.id as string | undefined,
                );
                break;
            case 'tool_input_delta':
                if (
                    this.#open?.kind === 'tool_use' &&
                    this.#open.id === ev.id &&
                    typeof ev.partialJson === 'string'
                ) {
                    this.#delta({
                        type: 'input_json_delta',
                        partial_json: ev.partialJson,
                    });
                }
                break;
            case 'tool_use':
                this.#sawToolUse = true;
                if (
                    this.#open?.kind === 'tool_use' &&
                    this.#open.id === ev.id
                ) {
                    this.#close(); // already streamed incrementally
                } else if (this.#startedToolIds.has(ev.id)) {
                    // Streamed and closed already (a parallel call that ended
                    // after the next one opened) — never emit it twice.
                } else {
                    this.#close();
                    this.#openBlock(
                        'tool_use',
                        {
                            type: 'tool_use',
                            id: ev.id,
                            name: ev.name,
                            input: {},
                        },
                        ev.id as string | undefined,
                    );
                    this.#delta({
                        type: 'input_json_delta',
                        partial_json: jsonOf(ev.input),
                    });
                    this.#close();
                }
                break;
            case 'server_tool':
                this.#serverBlock(ev.block as Record<string, unknown>);
                break;
            case 'compaction':
                this.#close();
                this.#openBlock('compaction', {
                    type: 'compaction',
                    content: null,
                });
                this.#delta({
                    type: 'compaction_delta',
                    content: ev.encrypted_content,
                });
                this.#close();
                // Legacy canonical frame, shared with the OpenAI-compatible
                // routes — kept alongside the native block for a caller still
                // watching for it; unknown SSE events are spec-ignored.
                this.#sse.write('compaction', {
                    type: 'compaction',
                    ...(ev.id !== undefined ? { id: ev.id } : {}),
                    encrypted_content: ev.encrypted_content,
                });
                break;
            case 'safeguard_results':
                this.#safeguards = ev.results as unknown[];
                break;
            case 'usage':
                this.#finish(ev);
                break;
            case 'error':
                this.#error(ev);
                break;
            default:
                break;
        }
    }

    #finish(ev: Record<string, unknown>): void {
        this.#close();
        const stopReason = promoteStopForToolCalls(
            (ev.stopReason as string | undefined) ??
                (this.#sawToolUse ? 'tool_use' : 'end_turn'),
            this.#sawToolUse,
            'tool_use',
        );
        const stopDetails = ev.stopDetails as
            Record<string, unknown> | null | undefined;
        const usageDetails = (ev.usageDetails as UsageDetails | undefined) ?? {
            inputTokens: 0,
            outputTokens: 0,
        };
        const contextManagement = ev.contextManagement as
            Record<string, unknown> | undefined;
        this.#sse.write('message_delta', {
            type: 'message_delta',
            delta: {
                stop_reason: stopReason,
                stop_sequence:
                    (ev.stopSequence as string | null | undefined) ?? null,
                ...(stopDetails ? { stop_details: stopDetails } : {}),
                ...(this.#safeguards
                    ? { safeguard_results: this.#safeguards }
                    : {}),
            },
            usage: anthropicUsage(usageDetails),
            ...(contextManagement
                ? { context_management: contextManagement }
                : {}),
        });
        this.#sse.write('message_stop', { type: 'message_stop' });
        this.#ended = true;
        this.#sse.end();
    }

    /**
     * An in-band error chunk: writes `event: error` and ends the stream with no
     * `message_delta`/`message_stop` — a mid-stream failure is not a completed
     * message.
     */
    #error(ev: Record<string, unknown>): void {
        const status = typeof ev.status === 'number' ? ev.status : 500;
        const type = STREAM_ERROR_TYPES[status] ?? 'api_error';
        this.#sse.write('error', {
            type: 'error',
            error: { type, message: ev.message ?? 'stream error' },
            request_id: this.#requestId,
        });
        this.#ended = true;
        this.#sse.end();
    }
}
