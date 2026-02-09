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

const DEFAULT_PROVIDER = 'openai-completion';

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

const normalizeToolCallsFromContent = (content) => {
    if ( ! Array.isArray(content) ) return undefined;
    const toolCalls = [];
    for ( const part of content ) {
        if ( !part || typeof part !== 'object' ) continue;
        if ( part.type !== 'tool_use' ) continue;
        toolCalls.push({
            id: part.id,
            type: 'function',
            function: {
                name: part.name,
                arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
            },
        });
    }
    return toolCalls.length ? toolCalls : undefined;
};

const buildUsage = (usage) => {
    const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
    };
};

const svc_web = Context.get('services').get('web-server');
svc_web.allow_undefined_origin(/^\/puterai\/openai\/v1\/chat\/completions(\/.*)?$/);

module.exports = eggspress('/openai/v1/chat/completions', {
    auth2: true,
    json: true,
    jsonCanBeLarge: true,
    allowedMethods: ['POST'],
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

    const completeArgs = {
        messages: body.messages,
        model,
        stream,
        ...(body.tools ? { tools: body.tools } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
    };

    const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
    const created = Math.floor(Date.now() / 1000);

    const result = await svcAiChat.complete(completeArgs);

    if ( stream ) {
        if ( ! (result instanceof TypedValue) ) {
            throw APIError.create('internal_error', { message: 'expected streaming response' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        let buffer = '';
        let usage = null;
        let toolCallIndex = 0;
        let sawToolCalls = false;

        const sendChunk = (delta, finishReason = null, extra = {}) => {
            const payload = {
                id: completionId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [
                    {
                        index: 0,
                        delta,
                        logprobs: null,
                        finish_reason: finishReason,
                    },
                ],
                ...extra,
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
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
                    sendChunk({ content: event.text });
                }
                if ( event.type === 'tool_use' ) {
                    sawToolCalls = true;
                    sendChunk({
                        tool_calls: [
                            {
                                index: toolCallIndex++,
                                id: event.id,
                                type: 'function',
                                function: {
                                    name: event.name,
                                    arguments: typeof event.input === 'string' ? event.input : JSON.stringify(event.input ?? {}),
                                },
                            },
                        ],
                    });
                }
                if ( event.type === 'usage' ) {
                    usage = event.usage;
                }
            }
        });

        streamValue.on('end', () => {
            const finishReason = sawToolCalls ? 'tool_calls' : 'stop';
            sendChunk({}, finishReason, usage ? { usage: buildUsage(usage) } : {});
            res.write('data: [DONE]\n\n');
            res.end();
        });

        streamValue.on('error', (err) => {
            res.write(`data: ${JSON.stringify({
                error: {
                    message: err?.message || 'stream error',
                    type: 'stream_error',
                },
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
        });

        return;
    }

    const message = result.message || {};
    const toolCalls = message.tool_calls || normalizeToolCallsFromContent(message.content);
    const contentText = extractTextContent(message.content);

    res.json({
        id: completionId,
        object: 'chat.completion',
        created,
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: message.role || 'assistant',
                    content: contentText,
                    ...(toolCalls ? { tool_calls: toolCalls } : {}),
                },
                logprobs: null,
                finish_reason: result.finish_reason ?? 'stop',
            },
        ],
        usage: buildUsage(result.usage),
    });
});
