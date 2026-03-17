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

const DEFAULT_PROVIDER = 'openai-responses';

const generateId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const parseJsonMaybe = (value) => {
    if ( typeof value !== 'string' ) return value ?? {};
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const normalizeToolToResponsesTool = (tool) => {
    if ( !tool || typeof tool !== 'object' ) return tool;
    if ( tool.type !== 'function' ) return tool;
    return {
        ...tool.function,
        type: 'function',
    };
};

const normalizeContentPart = (part) => {
    if ( typeof part === 'string' ) {
        return { type: 'text', text: part };
    }
    if ( !part || typeof part !== 'object' ) {
        return { type: 'text', text: '' };
    }
    if ( part.type === 'input_text' ) {
        return { type: 'text', text: part.text ?? '' };
    }
    if ( part.type === 'output_text' ) {
        return { type: 'text', text: part.text ?? '' };
    }
    if ( part.type === 'input_image' ) {
        return {
            type: 'image_url',
            ...(part.detail ? { detail: part.detail } : {}),
            ...(part.image_url ? { image_url: { url: part.image_url } } : {}),
            ...(part.file_id ? { file_id: part.file_id } : {}),
        };
    }
    if ( part.type === 'input_audio' ) {
        return {
            type: 'input_audio',
            input_audio: part.input_audio,
        };
    }
    if ( part.type === 'input_file' ) {
        return {
            type: 'input_file',
            ...(part.file_data ? { file_data: part.file_data } : {}),
            ...(part.file_id ? { file_id: part.file_id } : {}),
            ...(part.file_url ? { file_url: part.file_url } : {}),
            ...(part.filename ? { filename: part.filename } : {}),
        };
    }
    return part;
};

const normalizeMessageContent = (content) => {
    if ( content === undefined || content === null ) return '';
    if ( typeof content === 'string' ) return content;
    if ( Array.isArray(content) ) {
        return content.map(normalizeContentPart);
    }
    return [normalizeContentPart(content)];
};

const responseInputToMessages = (input) => {
    if ( input === undefined || input === null ) return [];
    if ( typeof input === 'string' ) {
        return [{ role: 'user', content: input }];
    }
    if ( ! Array.isArray(input) ) {
        throw APIError.create('field_invalid', {
            key: 'input',
            expected: 'a string or array',
            got: typeof input,
        });
    }

    const messages = [];
    for ( const item of input ) {
        if ( typeof item === 'string' ) {
            messages.push({ role: 'user', content: item });
            continue;
        }
        if ( !item || typeof item !== 'object' ) continue;

        if ( item.type === 'function_call_output' ) {
            messages.push({
                role: 'tool',
                tool_call_id: item.call_id,
                content: typeof item.output === 'string'
                    ? item.output
                    : JSON.stringify(item.output ?? {}),
            });
            continue;
        }

        if ( item.type === 'function_call' ) {
            messages.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: item.call_id || item.id || generateId('call'),
                        canonical_id: item.id,
                        name: item.name,
                        input: parseJsonMaybe(item.arguments),
                    },
                ],
            });
            continue;
        }

        if ( item.type === 'message' || item.role ) {
            messages.push({
                role: item.role === 'developer' ? 'system' : (item.role || 'user'),
                content: normalizeMessageContent(item.content),
            });
            continue;
        }

        messages.push({
            role: 'user',
            content: normalizeMessageContent(item),
        });
    }

    return messages;
};

const buildUsage = (usage) => {
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    return {
        input_tokens: inputTokens,
        input_tokens_details: {
            cached_tokens: usage?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0,
        },
        output_tokens: outputTokens,
        output_tokens_details: {
            reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
        },
        total_tokens: inputTokens + outputTokens,
    };
};

const createBaseResponse = ({ responseId, createdAt, model, body, output = [], usage, status }) => ({
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    instructions: body.instructions ?? null,
    metadata: body.metadata ?? null,
    model,
    output,
    output_text: output
        .filter(item => item?.type === 'message')
        .flatMap(item => item.content || [])
        .filter(part => part?.type === 'output_text')
        .map(part => part.text || '')
        .join(''),
    parallel_tool_calls: body.parallel_tool_calls ?? false,
    temperature: body.temperature ?? null,
    tool_choice: body.tool_choice ?? 'auto',
    tools: Array.isArray(body.tools) ? body.tools.map(normalizeToolToResponsesTool) : [],
    top_p: body.top_p ?? null,
    ...(body.max_output_tokens !== undefined ? { max_output_tokens: body.max_output_tokens } : {}),
    ...(body.previous_response_id ? { previous_response_id: body.previous_response_id } : {}),
    ...(body.store !== undefined ? { store: body.store } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(body.truncation ? { truncation: body.truncation } : {}),
    ...(usage ? { usage } : {}),
});

const responseOutputFromResult = (result) => {
    const output = [];
    const message = result?.message || {};
    const content = typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
            ? message.content
                .filter(part => part?.type === 'text')
                .map(part => part.text || '')
                .join('')
            : '';

    if ( content ) {
        output.push({
            id: generateId('msg'),
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
                {
                    type: 'output_text',
                    text: content,
                    annotations: [],
                },
            ],
        });
    }

    for ( const toolCall of message.tool_calls || [] ) {
        output.push({
            id: toolCall.canonical_id || generateId('fc'),
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments ?? '{}',
            status: 'completed',
        });
    }

    return output;
};

const svc_web = Context.get('services').get('web-server');
svc_web.allow_undefined_origin(/^\/puterai\/openai\/v1\/responses(\/.*)?$/);

module.exports = eggspress('/openai/v1/responses', {
    auth2: true,
    json: true,
    jsonCanBeLarge: true,
    allowedMethods: ['POST'],
}, async (req, res) => {
    if ( Context.get('actor').type.app ) {
        throw APIError.create('permission_denied');
    }

    const body = req.body || {};
    const stream = !!body.stream;

    const ctx = Context.get();
    const services = ctx.get('services');
    const svcAiChat = services.get('ai-chat');
    const providerName = body.provider || DEFAULT_PROVIDER;

    if ( providerName !== DEFAULT_PROVIDER ) {
        throw APIError.create('field_invalid', {
            key: 'provider',
            expected: DEFAULT_PROVIDER,
            got: providerName,
        });
    }

    let model = body.model;
    if ( ! model ) {
        const provider = svcAiChat.getProvider(providerName);
        if ( ! provider ) {
            throw APIError.create('field_missing', { key: 'model' });
        }
        model = provider.getDefaultModel();
    }

    const messages = [
        ...(body.instructions ? [{ role: 'system', content: body.instructions }] : []),
        ...responseInputToMessages(body.input),
    ];

    const completeArgs = {
        messages,
        model,
        stream,
        ...(body.tools ? { tools: body.tools } : {}),
        ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
        ...(body.parallel_tool_calls !== undefined ? { parallel_tool_calls: body.parallel_tool_calls } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_output_tokens !== undefined ? { max_tokens: body.max_output_tokens } : {}),
        ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        ...(body.text ? { text: body.text } : {}),
        ...(body.include ? { include: body.include } : {}),
        ...(body.instructions ? { instructions: body.instructions } : {}),
        ...(body.metadata ? { metadata: body.metadata } : {}),
        ...(body.conversation ? { conversation: body.conversation } : {}),
        ...(body.previous_response_id ? { previous_response_id: body.previous_response_id } : {}),
        ...(body.prompt ? { prompt: body.prompt } : {}),
        ...(body.prompt_cache_key ? { prompt_cache_key: body.prompt_cache_key } : {}),
        ...(body.prompt_cache_retention ? { prompt_cache_retention: body.prompt_cache_retention } : {}),
        ...(body.store !== undefined ? { store: body.store } : {}),
        ...(body.truncation ? { truncation: body.truncation } : {}),
        ...(body.background !== undefined ? { background: body.background } : {}),
        ...(body.service_tier ? { service_tier: body.service_tier } : {}),
        provider: providerName,
    };

    const responseId = generateId('resp');
    const createdAt = Math.floor(Date.now() / 1000);
    const result = await svcAiChat.complete(completeArgs);

    if ( stream ) {
        if ( ! (result instanceof TypedValue) ) {
            throw APIError.create('internal_error', { message: 'expected streaming response' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');

        let buffer = '';
        let sequenceNumber = 0;
        let usage = null;
        let messageItem = null;
        let messageOutputIndex = null;
        const output = [];
        let textContent = '';

        const sendEvent = (event) => {
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify({
                ...event,
                sequence_number: ++sequenceNumber,
            })}\n\n`);
        };

        sendEvent({
            type: 'response.created',
            response: createBaseResponse({
                responseId,
                createdAt,
                model,
                body,
                output: [],
                status: 'in_progress',
            }),
        });

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
                    if ( ! messageItem ) {
                        messageItem = {
                            id: generateId('msg'),
                            type: 'message',
                            role: 'assistant',
                            status: 'in_progress',
                            content: [],
                        };
                        output.push(messageItem);
                        messageOutputIndex = output.length - 1;
                        sendEvent({
                            type: 'response.output_item.added',
                            output_index: messageOutputIndex,
                            item: messageItem,
                        });
                        const part = {
                            type: 'output_text',
                            text: '',
                            annotations: [],
                        };
                        messageItem.content.push(part);
                        sendEvent({
                            type: 'response.content_part.added',
                            output_index: messageOutputIndex,
                            item_id: messageItem.id,
                            content_index: 0,
                            part,
                        });
                    }

                    textContent += event.text;
                    messageItem.content[0].text = textContent;
                    sendEvent({
                        type: 'response.output_text.delta',
                        output_index: messageOutputIndex,
                        item_id: messageItem.id,
                        content_index: 0,
                        delta: event.text,
                    });
                }

                if ( event.type === 'tool_use' ) {
                    const item = {
                        id: event.canonical_id || generateId('fc'),
                        type: 'function_call',
                        call_id: event.id,
                        name: event.name,
                        arguments: typeof event.input === 'string'
                            ? event.input
                            : JSON.stringify(event.input ?? {}),
                        status: 'completed',
                    };
                    output.push(item);
                    const outputIndex = output.length - 1;
                    sendEvent({
                        type: 'response.output_item.added',
                        output_index: outputIndex,
                        item: {
                            ...item,
                            status: 'in_progress',
                            arguments: '',
                        },
                    });
                    sendEvent({
                        type: 'response.function_call_arguments.delta',
                        output_index: outputIndex,
                        item_id: item.id,
                        delta: item.arguments,
                    });
                    sendEvent({
                        type: 'response.function_call_arguments.done',
                        output_index: outputIndex,
                        item_id: item.id,
                        name: item.name,
                        arguments: item.arguments,
                    });
                    sendEvent({
                        type: 'response.output_item.done',
                        output_index: outputIndex,
                        item,
                    });
                }

                if ( event.type === 'usage' ) {
                    usage = buildUsage(event.usage);
                }
            }
        });

        streamValue.on('end', () => {
            if ( messageItem ) {
                messageItem.status = 'completed';
                sendEvent({
                    type: 'response.output_text.done',
                    output_index: messageOutputIndex,
                    item_id: messageItem.id,
                    content_index: 0,
                    text: textContent,
                    logprobs: [],
                });
                sendEvent({
                    type: 'response.content_part.done',
                    output_index: messageOutputIndex,
                    item_id: messageItem.id,
                    content_index: 0,
                    part: messageItem.content[0],
                });
                sendEvent({
                    type: 'response.output_item.done',
                    output_index: messageOutputIndex,
                    item: messageItem,
                });
            }

            sendEvent({
                type: 'response.completed',
                response: createBaseResponse({
                    responseId,
                    createdAt,
                    model,
                    body,
                    output,
                    usage,
                    status: 'completed',
                }),
            });
            res.write('data: [DONE]\n\n');
            res.end();
        });

        streamValue.on('error', (err) => {
            sendEvent({
                type: 'error',
                error: {
                    message: err?.message || 'stream error',
                    type: 'stream_error',
                },
            });
            res.write('data: [DONE]\n\n');
            res.end();
        });

        return;
    }

    const usage = buildUsage(result.usage);
    const output = responseOutputFromResult(result);

    res.json(createBaseResponse({
        responseId,
        createdAt,
        model,
        body,
        output,
        usage,
        status: 'completed',
    }));
});
