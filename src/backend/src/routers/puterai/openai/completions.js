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

const getPromptText = (prompt) => {
    if ( prompt === undefined || prompt === null ) {
        return '';
    }
    if ( Array.isArray(prompt) ) {
        if ( prompt.length === 0 ) return '';
        if ( prompt.length === 1 ) {
            if ( typeof prompt[0] !== 'string' ) {
                throw APIError.create('field_invalid', {
                    key: 'prompt',
                    expected: 'a string',
                    got: typeof prompt[0],
                });
            }
            return prompt[0];
        }
        throw APIError.create('field_invalid', {
            key: 'prompt',
            expected: 'a string or single-item array',
            got: `array length ${prompt.length}`,
        });
    }
    if ( typeof prompt !== 'string' ) {
        throw APIError.create('field_invalid', {
            key: 'prompt',
            expected: 'a string',
            got: typeof prompt,
        });
    }
    return prompt;
};

const extractMessageText = (message) => {
    if ( message === undefined || message === null ) return '';
    if ( typeof message === 'string' ) return message;
    if ( typeof message !== 'object' ) return '';

    if ( Array.isArray(message.content) ) {
        return message.content.map((part) => {
            if ( typeof part === 'string' ) return part;
            if ( part && typeof part.text === 'string' ) return part.text;
            if ( part && typeof part.content === 'string' ) return part.content;
            return '';
        }).join('');
    }

    if ( typeof message.content === 'string' ) return message.content;
    if ( message.content && typeof message.content.text === 'string' ) return message.content.text;
    return '';
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
svc_web.allow_undefined_origin(/^\/puterai\/openai\/v1\/completions(\/.*)?$/);

module.exports = eggspress('/openai/v1/completions', {
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

    const ctx = Context.get();
    const services = ctx.get('services');
    const svcAiChat = services.get('ai-chat');

    let messages = body.messages;
    if ( ! messages ) {
        const prompt = getPromptText(body.prompt);
        messages = [{ role: 'user', content: prompt }];
    }

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
        messages,
        model,
        stream,
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
        ...(body.provider ? { provider: body.provider } : {}),
    };

    const completionId = `cmpl-${crypto.randomUUID().replace(/-/g, '')}`;
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

        const sendChunk = (text, finishReason = null, extra = {}) => {
            const payload = {
                id: completionId,
                object: 'text_completion',
                created,
                model,
                choices: [
                    {
                        text,
                        index: 0,
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
                    sendChunk(event.text);
                }
                if ( event.type === 'usage' ) {
                    usage = event.usage;
                }
            }
        });

        streamValue.on('end', () => {
            sendChunk('', 'stop', usage ? { usage: buildUsage(usage) } : {});
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

    const messageText = extractMessageText(result.message);
    const usage = buildUsage(result.usage);

    res.json({
        id: completionId,
        object: 'text_completion',
        created,
        model,
        choices: [
            {
                text: messageText,
                index: 0,
                logprobs: null,
                finish_reason: result.finish_reason ?? 'stop',
            },
        ],
        usage,
    });
});
