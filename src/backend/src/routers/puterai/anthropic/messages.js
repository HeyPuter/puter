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
'use strict';

const crypto = require('node:crypto');
const APIError = require('../../../api/APIError.js');
const eggspress = require('../../../api/eggspress.js');
const { TypedValue } = require('../../../services/drivers/meta/Runtime.js');
const { Context } = require('../../../util/context.js');
const auth2 = require('../../../middleware/auth2.js');

const DEFAULT_PROVIDER = 'claude';

/**
 * Translate Anthropic-style tool definitions to the OpenAI/Puter internal
 * format so that `svcAiChat.complete()` handles them uniformly.
 */
const normalizeTools = (tools) => {
    if ( !Array.isArray(tools) || tools.length === 0 ) return undefined;
    return tools.map((t) => {
        // Already in OpenAI format (e.g. from passthrough)
        if ( t.type === 'function' && t.function ) return t;
        // Anthropic format: { name, description, input_schema }
        return {
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters: t.input_schema || { type: 'object', properties: {} },
            },
        };
    });
};

/**
 * Extract plain text from a Puter/OpenAI-style message content field.
 */
const extractTextContent = (content) => {
    if ( content === undefined || content === null ) return '';
    if ( typeof content === 'string' ) return content;
    if ( Array.isArray(content) ) {
        return content.map((part) => {
            if ( typeof part === 'string' ) return part;
            if ( part && typeof part.text === 'string' ) return part.text;
            if ( part && typeof part.content === 'string' ) return part.content;
            return '';
        }).join('');
    }
    if ( typeof content === 'object' ) {
        if ( typeof content.text === 'string' ) return content.text;
        if ( typeof content.content === 'string' ) return content.content;
    }
    return '';
};

/**
 * Build an Anthropic-style usage object from internal usage data.
 */
const buildUsage = (usage) => {
    return {
        input_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
    };
};

/**
 * Extract tool_use blocks from an internal message result and return them
 * as Anthropic content blocks.
 */
const extractToolUseBlocks = (message) => {
    const blocks = [];

    // Check for OpenAI-style tool_calls on the message object
    if ( message.tool_calls && Array.isArray(message.tool_calls) ) {
        for ( const tc of message.tool_calls ) {
            blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function?.name ?? '',
                input: typeof tc.function?.arguments === 'string'
                    ? (() => {
                        try {
                            return JSON.parse(tc.function.arguments);
                        } catch {
                            return {};
                        }
                    })()
                    : (tc.function?.arguments ?? {}),
            });
        }
    }

    // Check for tool_use blocks inside array-style content
    if ( Array.isArray(message.content) ) {
        for ( const part of message.content ) {
            if ( !part || typeof part !== 'object' ) continue;
            if ( part.type === 'tool_use' ) {
                blocks.push({
                    type: 'tool_use',
                    id: part.id,
                    name: part.name,
                    input: typeof part.input === 'string'
                        ? (() => {
                            try {
                                return JSON.parse(part.input);
                            } catch {
                                return {};
                            }
                        })()
                        : (part.input ?? {}),
                });
            }
        }
    }

    return blocks;
};

/**
 * Translate Anthropic-format messages into Puter/OpenAI-format messages.
 * Specifically, this converts `tool_result` content blocks into `tool` role
 * messages that Puter's internal pipeline expects.
 */
const normalizeMessages = (messages, system) => {
    const result = [];

    // Inject system message at the start if supplied
    if ( system ) {
        if ( typeof system === 'string' ) {
            result.push({ role: 'system', content: system });
        } else if ( Array.isArray(system) ) {
            const text = system.map((s) => {
                if ( typeof s === 'string' ) return s;
                if ( s && typeof s.text === 'string' ) return s.text;
                return '';
            }).join('\n');
            if ( text ) result.push({ role: 'system', content: text });
        }
    }

    for ( const msg of messages ) {
        // Anthropic places tool_result blocks inside user messages.
        // Convert each to a separate `role: 'tool'` message.
        if ( msg.role === 'user' && Array.isArray(msg.content) ) {
            const toolResults = [];
            const otherParts = [];
            for ( const part of msg.content ) {
                if ( part && part.type === 'tool_result' ) {
                    toolResults.push(part);
                } else {
                    otherParts.push(part);
                }
            }

            // Push non-tool content first (if any)
            if ( otherParts.length > 0 ) {
                result.push({ role: 'user', content: otherParts });
            }

            // Convert each tool_result to a `tool` message
            for ( const tr of toolResults ) {
                let contentStr = '';
                if ( typeof tr.content === 'string' ) {
                    contentStr = tr.content;
                } else if ( Array.isArray(tr.content) ) {
                    contentStr = tr.content.map((p) => {
                        if ( typeof p === 'string' ) return p;
                        if ( p && typeof p.text === 'string' ) return p.text;
                        return '';
                    }).join('');
                }
                result.push({
                    role: 'tool',
                    tool_call_id: tr.tool_use_id,
                    content: contentStr,
                });
            }

            // If the message was entirely tool_results, we already handled it
            if ( otherParts.length === 0 && toolResults.length > 0 ) continue;
            if ( toolResults.length > 0 ) continue; // already pushed otherParts above
        }

        result.push(msg);
    }

    return result;
};

const svc_web = Context.get('services').get('web-server');
svc_web.allow_undefined_origin(/^\/puterai\/anthropic\/v1\/messages(\/.*)?$/);

module.exports = eggspress('/anthropic/v1/messages', {
    json: true,
    jsonCanBeLarge: true,
    allowedMethods: ['POST'],
    mw: [(req, _res, next) => {
        if ( !req.headers.authorization && req.headers['x-api-key'] ) {
            req.headers.authorization = `Bearer ${req.headers['x-api-key']}`;
        }
        next();
    }, auth2],
}, async (req, res) => {
    // We don't allow apps
    if ( Context.get('actor').type.app ) {
        throw APIError.create('permission_denied');
    }

    const body = req.body || {};
    const stream = !!body.stream;

    if ( ! Array.isArray(body.messages) ) {
        throw APIError.create('field_invalid', {
            key: 'messages',
            expected: 'an array of chat messages',
            got: typeof body.messages,
        });
    }

    const ctx = Context.get();
    const services = ctx.get('services');
    const svcAiChat = services.get('ai-chat');

    let model = body.model;
    if ( ! model ) {
        const providerName = body.provider || DEFAULT_PROVIDER;
        const provider = svcAiChat.getProvider(providerName);
        if ( ! provider ) {
            throw APIError.create('field_missing', { key: 'model' });
        }
        model = provider.getDefaultModel();
    }

    // Translate messages from Anthropic format to Puter internal format
    const normalizedMessages = normalizeMessages(body.messages, body.system);
    const tools = normalizeTools(body.tools);

    const completeArgs = {
        messages: normalizedMessages,
        model,
        stream,
        ...(tools ? { tools } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
    };

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '')}`;

    const result = await svcAiChat.complete(completeArgs);

    // ================================================================
    // STREAMING RESPONSE — Anthropic SSE format
    // ================================================================
    if ( stream ) {
        if ( ! (result instanceof TypedValue) ) {
            throw APIError.create('internal_error', { message: 'expected streaming response' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        const sendEvent = (eventType, data) => {
            res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        // message_start
        sendEvent('message_start', {
            type: 'message_start',
            message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
            },
        });

        let buffer = '';
        let usage = null;
        let contentIndex = 0;
        let blockOpen = false;
        let sawToolCalls = false;

        const openTextBlock = () => {
            if ( blockOpen ) return;
            sendEvent('content_block_start', {
                type: 'content_block_start',
                index: contentIndex,
                content_block: { type: 'text', text: '' },
            });
            blockOpen = true;
        };

        const closeBlock = () => {
            if ( ! blockOpen ) return;
            sendEvent('content_block_stop', {
                type: 'content_block_stop',
                index: contentIndex,
            });
            blockOpen = false;
            contentIndex++;
        };

        const streamValue = result.value;
        streamValue.on('data', (chunk) => {
            buffer += chunk.toString('utf8');
            let newlineIndex;
            while ( (newlineIndex = buffer.indexOf('\n')) >= 0 ) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                if ( ! line ) continue;
                let event;
                try {
                    event = JSON.parse(line);
                } catch {
                    continue;
                }

                if ( event.type === 'text' && typeof event.text === 'string' ) {
                    openTextBlock();
                    sendEvent('content_block_delta', {
                        type: 'content_block_delta',
                        index: contentIndex,
                        delta: { type: 'text_delta', text: event.text },
                    });
                }

                if ( event.type === 'tool_use' ) {
                    sawToolCalls = true;
                    closeBlock(); // close any open text block first
                    sendEvent('content_block_start', {
                        type: 'content_block_start',
                        index: contentIndex,
                        content_block: {
                            type: 'tool_use',
                            id: event.id,
                            name: event.name,
                            input: {},
                        },
                    });
                    blockOpen = true;

                    // Emit the input as a single JSON delta
                    const inputStr = typeof event.input === 'string'
                        ? event.input
                        : JSON.stringify(event.input ?? {});
                    sendEvent('content_block_delta', {
                        type: 'content_block_delta',
                        index: contentIndex,
                        delta: { type: 'input_json_delta', partial_json: inputStr },
                    });
                    closeBlock();
                }

                if ( event.type === 'usage' ) {
                    usage = event.usage;
                }
            }
        });

        streamValue.on('end', () => {
            closeBlock();

            const stopReason = sawToolCalls ? 'tool_use' : 'end_turn';
            const resolvedUsage = buildUsage(usage || {});

            sendEvent('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: resolvedUsage.output_tokens },
            });

            sendEvent('message_stop', { type: 'message_stop' });
            res.end();
        });

        streamValue.on('error', (err) => {
            sendEvent('error', {
                type: 'error',
                error: {
                    type: 'api_error',
                    message: err?.message || 'stream error',
                },
            });
            res.end();
        });

        return;
    }

    // ================================================================
    // NON-STREAMING RESPONSE — Anthropic message object
    // ================================================================
    const message = result.message || {};
    const toolUseBlocks = extractToolUseBlocks(message);
    const textContent = extractTextContent(message.content);

    const contentBlocks = [];
    if ( textContent ) {
        contentBlocks.push({ type: 'text', text: textContent });
    }
    contentBlocks.push(...toolUseBlocks);

    // If there's no content at all, include an empty text block
    if ( contentBlocks.length === 0 ) {
        contentBlocks.push({ type: 'text', text: '' });
    }

    const stopReason = toolUseBlocks.length > 0 ? 'tool_use' : 'end_turn';

    res.json({
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: contentBlocks,
        model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: buildUsage(result.usage),
    });
});
