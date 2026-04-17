import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import { isAppActor } from '../../core/actor.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { PuterController } from '../types.js';
import { isDriverStreamResult } from '../../drivers/meta.js';
import type { ChatCompletionDriver } from '../../drivers/ai-chat/ChatCompletionDriver.js';
import type { ICompleteArguments, IChatCompleteResult } from '../../drivers/ai-chat/types.js';

const GEMINI_DOWNLOAD_BASE = 'https://generativelanguage.googleapis.com/download/v1beta/files';

/**
 * OpenAI-/Anthropic-compatible HTTP surface on top of the
 * `puter-chat-completion` driver.
 *
 * Third-party SDKs (OpenAI's and Anthropic's official clients, LangChain,
 * etc.) point at their vendor's wire shape. These routes accept that wire
 * shape, translate to the internal `ICompleteArguments`, hand off to the
 * ChatCompletionDriver, and translate the result (or NDJSON stream) back
 * into the vendor's response / SSE shape.
 *
 * All routes live on `subdomain: 'api'` and reject app-under-user actors —
 * only user actors may proxy.
 */
export class PuterAIController extends PuterController {
    registerRoutes (router: PuterRouter): void {
        const apiOpts = { subdomain: 'api', requireAuth: true } as const;

        // Every route below carries the `/puterai` prefix for wire
        // compatibility with puter-js and existing API tests.
        router.post('/puterai/openai/v1/chat/completions', apiOpts, this.openaiChatCompletions);
        router.post('/puterai/openai/v1/completions', apiOpts, this.openaiCompletions);
        router.post('/puterai/openai/v1/responses', apiOpts, this.openaiResponses);
        router.post('/puterai/anthropic/v1/messages', apiOpts, this.anthropicMessages);

        // Model listing — enumerate available models per AI service
        router.get('/puterai/chat/models', apiOpts, this.#listModels('aiChat'));
        router.get('/puterai/chat/models/details', apiOpts, this.#modelDetails('aiChat'));
        router.get('/puterai/image/models', apiOpts, this.#listModels('aiImage'));
        router.get('/puterai/image/models/details', apiOpts, this.#modelDetails('aiImage'));
        router.get('/puterai/video/models', apiOpts, this.#listModels('aiVideo'));
        router.get('/puterai/video/models/details', apiOpts, this.#modelDetails('aiVideo'));

        // ── Video URL proxy ─────────────────────────────────────────
        // Reverse-proxies AI-generated video URLs that can't be given
        // directly to the client (auth-gated provider downloads). The
        // URL itself is HMAC-signed, so no additional auth gate.
        router.get('/puterai/video/proxy', { subdomain: 'api' }, this.#videoProxy);
    }

    #videoProxy = async (req: Request, res: Response): Promise<void> => {
        const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
        const provider = typeof req.query.provider === 'string' ? req.query.provider : '';
        const expires = typeof req.query.expires === 'string' ? req.query.expires : '';
        const signature = typeof req.query.signature === 'string' ? req.query.signature : '';

        if ( ! /^[a-zA-Z0-9_-]+$/.test(fileId) ) {
            res.status(400).send('Invalid or missing fileId parameter');
            return;
        }
        if ( ! expires || ! signature ) {
            res.status(403).send('Missing signature');
            return;
        }
        if ( Number(expires) < Date.now() / 1000 ) {
            res.status(403).send('Signature expired');
            return;
        }

        const secret = this.config.url_signature_secret;
        if ( ! secret ) {
            res.status(500).send('URL signature secret not configured');
            return;
        }
        const expected = crypto
            .createHash('sha256')
            .update(`${fileId}/video-proxy/${secret}/${expires}`)
            .digest('hex');
        // Constant-time compare so signature probing can't time-leak.
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expected, 'hex');
        if ( sigBuf.length !== expBuf.length || ! crypto.timingSafeEqual(sigBuf, expBuf) ) {
            res.status(403).send('Invalid signature');
            return;
        }

        if ( provider !== 'gemini' ) {
            res.status(400).send('Unsupported provider');
            return;
        }

        const geminiConfig = (this.config as unknown as { services?: Record<string, { apiKey?: string; secret_key?: string }> }).services?.gemini;
        const apiKey = geminiConfig?.apiKey ?? geminiConfig?.secret_key;
        if ( ! apiKey ) {
            res.status(500).send('Gemini API key not configured');
            return;
        }

        const upstream = await fetch(
            `${GEMINI_DOWNLOAD_BASE}/${fileId}:download?alt=media&key=${apiKey}`,
        );
        if ( ! upstream.ok ) {
            res.status(upstream.status).send('Failed to fetch video');
            return;
        }
        const contentType = upstream.headers.get('content-type');
        if ( contentType ) res.setHeader('Content-Type', contentType);

        if ( ! upstream.body ) {
            res.status(500).send('Empty response body');
            return;
        }
        Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream).pipe(res);
    };

    #listModels (driverKey: string) {
        return async (_req: Request, res: Response): Promise<void> => {
            const driver = (this.drivers as Record<string, unknown>)[driverKey] as { list?: () => string[] } | undefined;
            if ( !driver?.list ) throw new HttpError(501, 'Model listing not available');
            const models = driver.list();
            const HIDDEN = ['costly', 'fake', 'abuse', 'model-fallback-test-1'];
            res.json({ models: (models as string[]).filter(m => !HIDDEN.includes(m)) });
        };
    }

    #modelDetails (driverKey: string) {
        return async (_req: Request, res: Response): Promise<void> => {
            const driver = (this.drivers as Record<string, unknown>)[driverKey] as { models?: () => Array<{ id: string }> } | undefined;
            if ( !driver?.models ) throw new HttpError(501, 'Model details not available');
            const models = driver.models();
            const HIDDEN = ['costly', 'fake', 'abuse', 'model-fallback-test-1'];
            res.json({ models: (models as Array<{ id: string }>).filter(m => !HIDDEN.includes(m.id)) });
        };
    }

    // ── /openai/v1/chat/completions ─────────────────────────────────

    openaiChatCompletions = async (req: Request, res: Response): Promise<void> => {
        this.#rejectAppActor(req);

        const body = asRecord(req.body);
        const stream = !!body.stream;

        if ( ! Array.isArray(body.messages) ) {
            throw new HttpError(400, '`messages` must be an array of chat messages');
        }

        const completionId = `chatcmpl-${randomId()}`;
        const created = Math.floor(Date.now() / 1000);

        const completeArgs: ICompleteArguments = {
            messages: body.messages,
            model: toStringOrEmpty(body.model),
            stream,
            ...(body.tools ? { tools: body.tools as unknown[] } : {}),
            ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
            ...(body.max_tokens !== undefined ? { max_tokens: Number(body.max_tokens) } : {}),
            ...(body.provider ? { provider: toStringOrEmpty(body.provider) } : { provider: DEFAULTS.openaiChat }),
        };

        const result = await this.#driver().complete(completeArgs);
        const effectiveModel = completeArgs.model || '';

        if ( stream ) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let buffer = '';
            let usage: Record<string, unknown> | null = null;
            let toolCallIndex = 0;
            let sawToolCalls = false;

            const sendChunk = (delta: Record<string, unknown>, finishReason: string | null = null, extra: Record<string, unknown> = {}): void => {
                res.write(`data: ${JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model: effectiveModel,
                    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
                    ...extra,
                })}\n\n`);
            };

            pipeNdjsonStream(streamResult.stream, (ev) => {
                if ( ev.type === 'text' && typeof ev.text === 'string' ) {
                    sendChunk({ content: ev.text });
                } else if ( ev.type === 'tool_use' ) {
                    sawToolCalls = true;
                    sendChunk({
                        tool_calls: [{
                            index: toolCallIndex++,
                            id: ev.id,
                            type: 'function',
                            function: {
                                name: ev.name,
                                arguments: typeof ev.input === 'string' ? ev.input : JSON.stringify(ev.input ?? {}),
                            },
                        }],
                    });
                } else if ( ev.type === 'usage' ) {
                    usage = ev.usage as Record<string, unknown>;
                }
            }, {
                onEnd: () => {
                    const finishReason = sawToolCalls ? 'tool_calls' : 'stop';
                    sendChunk({}, finishReason, usage ? { usage: buildOpenAIUsage(usage) } : {});
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                onError: (err) => {
                    res.write(`data: ${JSON.stringify({ error: { message: err?.message ?? 'stream error', type: 'stream_error' } })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                getBuffer: () => buffer,
                setBuffer: (v) => { buffer = v; },
            });
            return;
        }

        const messageResult = result as Extract<IChatCompleteResult, { message?: unknown }>;
        const message = (messageResult.message ?? {}) as Record<string, unknown>;
        const toolCalls = (message.tool_calls as unknown[] | undefined) ?? normalizeToolCallsFromContent(message.content);
        const contentText = extractTextContent(message.content);

        res.json({
            id: completionId,
            object: 'chat.completion',
            created,
            model: effectiveModel,
            choices: [{
                index: 0,
                message: {
                    role: (message.role as string) || 'assistant',
                    content: contentText,
                    ...(toolCalls ? { tool_calls: toolCalls } : {}),
                },
                logprobs: null,
                finish_reason: (messageResult.finish_reason as string | undefined) ?? 'stop',
            }],
            usage: buildOpenAIUsage(messageResult.usage as Record<string, unknown> | undefined),
        });
    };

    // ── /openai/v1/completions ──────────────────────────────────────

    openaiCompletions = async (req: Request, res: Response): Promise<void> => {
        this.#rejectAppActor(req);

        const body = asRecord(req.body);
        const stream = !!body.stream;

        let messages = body.messages as unknown[] | undefined;
        if ( ! messages ) {
            messages = [{ role: 'user', content: getPromptText(body.prompt) }];
        }

        const completeArgs: ICompleteArguments = {
            messages,
            model: toStringOrEmpty(body.model),
            stream,
            ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
            ...(body.max_tokens !== undefined ? { max_tokens: Number(body.max_tokens) } : {}),
            ...(body.provider ? { provider: toStringOrEmpty(body.provider) } : { provider: DEFAULTS.openaiCompletion }),
        };

        const completionId = `cmpl-${randomId()}`;
        const created = Math.floor(Date.now() / 1000);
        const result = await this.#driver().complete(completeArgs);
        const effectiveModel = completeArgs.model || '';

        if ( stream ) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let buffer = '';
            let usage: Record<string, unknown> | null = null;

            const sendChunk = (text: string, finishReason: string | null = null, extra: Record<string, unknown> = {}): void => {
                res.write(`data: ${JSON.stringify({
                    id: completionId,
                    object: 'text_completion',
                    created,
                    model: effectiveModel,
                    choices: [{ text, index: 0, logprobs: null, finish_reason: finishReason }],
                    ...extra,
                })}\n\n`);
            };

            pipeNdjsonStream(streamResult.stream, (ev) => {
                if ( ev.type === 'text' && typeof ev.text === 'string' ) {
                    sendChunk(ev.text);
                } else if ( ev.type === 'usage' ) {
                    usage = ev.usage as Record<string, unknown>;
                }
            }, {
                onEnd: () => {
                    sendChunk('', 'stop', usage ? { usage: buildOpenAIUsage(usage) } : {});
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                onError: (err) => {
                    res.write(`data: ${JSON.stringify({ error: { message: err?.message ?? 'stream error', type: 'stream_error' } })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                getBuffer: () => buffer,
                setBuffer: (v) => { buffer = v; },
            });
            return;
        }

        const messageResult = result as Extract<IChatCompleteResult, { message?: unknown }>;
        res.json({
            id: completionId,
            object: 'text_completion',
            created,
            model: effectiveModel,
            choices: [{
                text: extractTextContent((messageResult.message as Record<string, unknown> | undefined)?.content),
                index: 0,
                logprobs: null,
                finish_reason: (messageResult.finish_reason as string | undefined) ?? 'stop',
            }],
            usage: buildOpenAIUsage(messageResult.usage as Record<string, unknown> | undefined),
        });
    };

    // ── /openai/v1/responses ────────────────────────────────────────

    openaiResponses = async (req: Request, res: Response): Promise<void> => {
        this.#rejectAppActor(req);

        const body = asRecord(req.body);
        const stream = !!body.stream;

        const providerName = toStringOrEmpty(body.provider) || DEFAULTS.openaiResponses;
        if ( providerName !== DEFAULTS.openaiResponses ) {
            throw new HttpError(400, `\`provider\` must be '${DEFAULTS.openaiResponses}'`);
        }

        const messages: unknown[] = [
            ...(body.instructions ? [{ role: 'system', content: body.instructions }] : []),
            ...responseInputToMessages(body.input),
        ];

        const completeArgs: ICompleteArguments = {
            messages,
            model: toStringOrEmpty(body.model),
            stream,
            ...(body.tools ? { tools: body.tools as unknown[] } : {}),
            ...(body.tool_choice ? { tool_choice: body.tool_choice } : {}),
            ...(body.parallel_tool_calls !== undefined ? { parallel_tool_calls: !!body.parallel_tool_calls } : {}),
            ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
            ...(body.max_output_tokens !== undefined ? { max_tokens: Number(body.max_output_tokens) } : {}),
            ...(body.top_p !== undefined ? { top_p: Number(body.top_p) } : {}),
            ...(body.reasoning ? { reasoning: body.reasoning as ICompleteArguments['reasoning'] } : {}),
            ...(body.text ? { text: body.text as ICompleteArguments['text'] } : {}),
            ...(body.include ? { include: body.include as unknown[] } : {}),
            ...(body.instructions ? { instructions: body.instructions as ICompleteArguments['instructions'] } : {}),
            ...(body.metadata ? { metadata: body.metadata as Record<string, string> } : {}),
            ...(body.conversation ? { conversation: body.conversation } : {}),
            ...(body.previous_response_id ? { previous_response_id: String(body.previous_response_id) } : {}),
            ...(body.prompt ? { prompt: body.prompt } : {}),
            ...(body.prompt_cache_key ? { prompt_cache_key: String(body.prompt_cache_key) } : {}),
            ...(body.prompt_cache_retention ? { prompt_cache_retention: body.prompt_cache_retention as ICompleteArguments['prompt_cache_retention'] } : {}),
            ...(body.store !== undefined ? { store: !!body.store } : {}),
            ...(body.truncation ? { truncation: body.truncation as ICompleteArguments['truncation'] } : {}),
            ...(body.background !== undefined ? { background: !!body.background } : {}),
            ...(body.service_tier ? { service_tier: body.service_tier as ICompleteArguments['service_tier'] } : {}),
            provider: providerName,
        };

        const responseId = generateId('resp');
        const createdAt = Math.floor(Date.now() / 1000);
        const result = await this.#driver().complete(completeArgs);
        const effectiveModel = completeArgs.model || '';

        if ( stream ) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let buffer = '';
            let sequenceNumber = 0;
            let usage: Record<string, unknown> | null = null;
            let messageItem: { id: string; type: string; role: string; status: string; content: Array<{ type: string; text: string; annotations: unknown[] }> } | null = null;
            let messageOutputIndex: number | null = null;
            const output: unknown[] = [];
            let textContent = '';

            const sendEvent = (event: Record<string, unknown>): void => {
                res.write(`event: ${event.type}\n`);
                res.write(`data: ${JSON.stringify({ ...event, sequence_number: ++sequenceNumber })}\n\n`);
            };

            sendEvent({
                type: 'response.created',
                response: createResponseShell({ responseId, createdAt, model: effectiveModel, body, output: [], status: 'in_progress' }),
            });

            pipeNdjsonStream(streamResult.stream, (ev) => {
                if ( ev.type === 'text' && typeof ev.text === 'string' ) {
                    if ( ! messageItem ) {
                        messageItem = { id: generateId('msg'), type: 'message', role: 'assistant', status: 'in_progress', content: [] };
                        output.push(messageItem);
                        messageOutputIndex = output.length - 1;
                        sendEvent({ type: 'response.output_item.added', output_index: messageOutputIndex, item: messageItem });
                        const part = { type: 'output_text', text: '', annotations: [] as unknown[] };
                        messageItem.content.push(part);
                        sendEvent({ type: 'response.content_part.added', output_index: messageOutputIndex, item_id: messageItem.id, content_index: 0, part });
                    }
                    textContent += ev.text;
                    messageItem.content[0].text = textContent;
                    sendEvent({ type: 'response.output_text.delta', output_index: messageOutputIndex, item_id: messageItem.id, content_index: 0, delta: ev.text });
                } else if ( ev.type === 'tool_use' ) {
                    const item = {
                        id: (ev.canonical_id as string | undefined) || generateId('fc'),
                        type: 'function_call',
                        call_id: ev.id,
                        name: ev.name,
                        arguments: typeof ev.input === 'string' ? ev.input : JSON.stringify(ev.input ?? {}),
                        status: 'completed',
                    };
                    output.push(item);
                    const outputIndex = output.length - 1;
                    sendEvent({ type: 'response.output_item.added', output_index: outputIndex, item: { ...item, status: 'in_progress', arguments: '' } });
                    sendEvent({ type: 'response.function_call_arguments.delta', output_index: outputIndex, item_id: item.id, delta: item.arguments });
                    sendEvent({ type: 'response.function_call_arguments.done', output_index: outputIndex, item_id: item.id, name: item.name, arguments: item.arguments });
                    sendEvent({ type: 'response.output_item.done', output_index: outputIndex, item });
                } else if ( ev.type === 'usage' ) {
                    usage = buildResponsesUsage(ev.usage as Record<string, unknown>);
                }
            }, {
                onEnd: () => {
                    if ( messageItem ) {
                        messageItem.status = 'completed';
                        sendEvent({ type: 'response.output_text.done', output_index: messageOutputIndex, item_id: messageItem.id, content_index: 0, text: textContent, logprobs: [] });
                        sendEvent({ type: 'response.content_part.done', output_index: messageOutputIndex, item_id: messageItem.id, content_index: 0, part: messageItem.content[0] });
                        sendEvent({ type: 'response.output_item.done', output_index: messageOutputIndex, item: messageItem });
                    }
                    sendEvent({
                        type: 'response.completed',
                        response: createResponseShell({ responseId, createdAt, model: effectiveModel, body, output, usage, status: 'completed' }),
                    });
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                onError: (err) => {
                    sendEvent({ type: 'error', error: { message: err?.message ?? 'stream error', type: 'stream_error' } });
                    res.write('data: [DONE]\n\n');
                    res.end();
                },
                getBuffer: () => buffer,
                setBuffer: (v) => { buffer = v; },
            });
            return;
        }

        const messageResult = result as Extract<IChatCompleteResult, { message?: unknown }>;
        const usage = buildResponsesUsage(messageResult.usage as Record<string, unknown> | undefined);
        const outputItems = responseOutputFromResult(messageResult);

        res.json(createResponseShell({
            responseId,
            createdAt,
            model: effectiveModel,
            body,
            output: outputItems,
            usage,
            status: 'completed',
        }));
    };

    // ── /anthropic/v1/messages ──────────────────────────────────────

    anthropicMessages = async (req: Request, res: Response): Promise<void> => {
        this.#rejectAppActor(req);

        const body = asRecord(req.body);
        const stream = !!body.stream;

        if ( ! Array.isArray(body.messages) ) {
            throw new HttpError(400, '`messages` must be an array of chat messages');
        }

        const normalizedMessages = normalizeAnthropicMessages(body.messages as unknown[], body.system);
        const tools = normalizeAnthropicTools(body.tools);

        const completeArgs: ICompleteArguments = {
            messages: normalizedMessages,
            model: toStringOrEmpty(body.model),
            stream,
            ...(tools ? { tools } : {}),
            ...(body.temperature !== undefined ? { temperature: Number(body.temperature) } : {}),
            ...(body.max_tokens !== undefined ? { max_tokens: Number(body.max_tokens) } : {}),
            ...(body.provider ? { provider: toStringOrEmpty(body.provider) } : { provider: DEFAULTS.anthropic }),
        };

        const messageId = `msg_${randomId()}`;
        const result = await this.#driver().complete(completeArgs);
        const effectiveModel = completeArgs.model || '';

        if ( stream ) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            const sendEvent = (eventType: string, data: Record<string, unknown>): void => {
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
                    model: effectiveModel,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 },
                },
            });

            let buffer = '';
            let usage: Record<string, unknown> | null = null;
            let contentIndex = 0;
            let blockOpen = false;
            let sawToolCalls = false;

            const openTextBlock = (): void => {
                if ( blockOpen ) return;
                sendEvent('content_block_start', {
                    type: 'content_block_start',
                    index: contentIndex,
                    content_block: { type: 'text', text: '' },
                });
                blockOpen = true;
            };
            const closeBlock = (): void => {
                if ( ! blockOpen ) return;
                sendEvent('content_block_stop', { type: 'content_block_stop', index: contentIndex });
                blockOpen = false;
                contentIndex++;
            };

            pipeNdjsonStream(streamResult.stream, (ev) => {
                if ( ev.type === 'text' && typeof ev.text === 'string' ) {
                    openTextBlock();
                    sendEvent('content_block_delta', {
                        type: 'content_block_delta',
                        index: contentIndex,
                        delta: { type: 'text_delta', text: ev.text },
                    });
                } else if ( ev.type === 'tool_use' ) {
                    sawToolCalls = true;
                    closeBlock();
                    sendEvent('content_block_start', {
                        type: 'content_block_start',
                        index: contentIndex,
                        content_block: { type: 'tool_use', id: ev.id, name: ev.name, input: {} },
                    });
                    blockOpen = true;
                    const inputStr = typeof ev.input === 'string' ? ev.input : JSON.stringify(ev.input ?? {});
                    sendEvent('content_block_delta', {
                        type: 'content_block_delta',
                        index: contentIndex,
                        delta: { type: 'input_json_delta', partial_json: inputStr },
                    });
                    closeBlock();
                } else if ( ev.type === 'usage' ) {
                    usage = ev.usage as Record<string, unknown>;
                }
            }, {
                onEnd: () => {
                    closeBlock();
                    const stopReason = sawToolCalls ? 'tool_use' : 'end_turn';
                    const resolvedUsage = buildAnthropicUsage(usage ?? {});
                    sendEvent('message_delta', {
                        type: 'message_delta',
                        delta: { stop_reason: stopReason, stop_sequence: null },
                        usage: { output_tokens: resolvedUsage.output_tokens },
                    });
                    sendEvent('message_stop', { type: 'message_stop' });
                    res.end();
                },
                onError: (err) => {
                    sendEvent('error', {
                        type: 'error',
                        error: { type: 'api_error', message: err?.message ?? 'stream error' },
                    });
                    res.end();
                },
                getBuffer: () => buffer,
                setBuffer: (v) => { buffer = v; },
            });
            return;
        }

        const messageResult = result as Extract<IChatCompleteResult, { message?: unknown }>;
        const message = (messageResult.message ?? {}) as Record<string, unknown>;
        const toolUseBlocks = extractToolUseBlocks(message);
        const textContent = extractTextContent(message.content);

        const contentBlocks: Array<Record<string, unknown>> = [];
        if ( textContent ) contentBlocks.push({ type: 'text', text: textContent });
        contentBlocks.push(...toolUseBlocks);
        if ( contentBlocks.length === 0 ) contentBlocks.push({ type: 'text', text: '' });

        res.json({
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: contentBlocks,
            model: effectiveModel,
            stop_reason: toolUseBlocks.length > 0 ? 'tool_use' : 'end_turn',
            stop_sequence: null,
            usage: buildAnthropicUsage(messageResult.usage as Record<string, unknown> | undefined),
        });
    };

    // ── Internals ───────────────────────────────────────────────────

    #driver (): ChatCompletionDriver {
        const driver = (this.drivers as unknown as { aiChat: ChatCompletionDriver }).aiChat;
        if ( ! driver ) throw new HttpError(500, 'Chat completion driver not registered');
        return driver;
    }

    #rejectAppActor (req: Request): void {
        // Proxy routes are user-only; apps must call puter-chat-completion directly.
        if ( isAppActor(req.actor) ) {
            throw new HttpError(403, 'App actors may not proxy to upstream AI APIs');
        }
    }
}

// ── Shared helpers ──────────────────────────────────────────────────

const DEFAULTS = {
    openaiChat: 'openai-completion',
    openaiCompletion: 'openai-completion',
    openaiResponses: 'openai-responses',
    anthropic: 'claude',
} as const;

const randomId = (): string => crypto.randomUUID().replace(/-/g, '');
const generateId = (prefix: string): string => `${prefix}_${randomId()}`;

const asRecord = (value: unknown): Record<string, unknown> => {
    return (value && typeof value === 'object' && ! Array.isArray(value))
        ? (value as Record<string, unknown>)
        : {};
};

const toStringOrEmpty = (v: unknown): string => (typeof v === 'string' ? v : '');

const setSseHeaders = (res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
};

/**
 * The chat driver returns either a stream-result envelope or a plain
 * message result. Proxy routes invoked with `stream: true` expect the
 * former; 500 if the driver dropped the signal.
 */
const expectStream = (result: IChatCompleteResult): { stream: NodeJS.ReadableStream } => {
    if ( ! isDriverStreamResult(result as unknown) ) {
        throw new HttpError(500, 'expected streaming response');
    }
    return result as unknown as { stream: NodeJS.ReadableStream };
};

/**
 * The chat driver's stream emits one JSON object per line
 * (`{type: 'text', text}` / `{type: 'tool_use', ...}` / `{type: 'usage', ...}`).
 * This helper consumes the stream line-by-line and hands parsed events to
 * the caller's reducer, so the per-route translators can stay shape-focused.
 */
interface NdjsonPipeOptions {
    onEnd: () => void;
    onError: (err: Error) => void;
    getBuffer: () => string;
    setBuffer: (v: string) => void;
}

const pipeNdjsonStream = (
    stream: NodeJS.ReadableStream,
    onEvent: (event: Record<string, unknown>) => void,
    opts: NdjsonPipeOptions,
): void => {
    stream.on('data', (chunk: Buffer | string) => {
        opts.setBuffer(opts.getBuffer() + (typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
        let newlineIndex: number;
        let buf = opts.getBuffer();
        while ( (newlineIndex = buf.indexOf('\n')) >= 0 ) {
            const line = buf.slice(0, newlineIndex).trim();
            buf = buf.slice(newlineIndex + 1);
            if ( ! line ) continue;
            let event: Record<string, unknown>;
            try {
                event = JSON.parse(line) as Record<string, unknown>;
            } catch {
                continue;
            }
            onEvent(event);
        }
        opts.setBuffer(buf);
    });
    stream.on('end', opts.onEnd);
    stream.on('error', opts.onError);
};

// ── OpenAI/Anthropic shape helpers ───────────────────────────────────

const extractTextContent = (content: unknown): string => {
    if ( content === undefined || content === null ) return '';
    if ( typeof content === 'string' ) return content;
    if ( Array.isArray(content) ) {
        return content.map((part) => {
            if ( typeof part === 'string' ) return part;
            if ( part && typeof part === 'object' ) {
                const r = part as Record<string, unknown>;
                if ( typeof r.text === 'string' ) return r.text;
                if ( typeof r.content === 'string' ) return r.content;
            }
            return '';
        }).join('');
    }
    if ( typeof content === 'object' ) {
        const r = content as Record<string, unknown>;
        if ( typeof r.text === 'string' ) return r.text;
        if ( typeof r.content === 'string' ) return r.content;
    }
    return '';
};

const normalizeToolCallsFromContent = (content: unknown): Array<Record<string, unknown>> | undefined => {
    if ( ! Array.isArray(content) ) return undefined;
    const toolCalls: Array<Record<string, unknown>> = [];
    for ( const part of content ) {
        if ( !part || typeof part !== 'object' ) continue;
        const p = part as Record<string, unknown>;
        if ( p.type !== 'tool_use' ) continue;
        toolCalls.push({
            id: p.id,
            type: 'function',
            function: {
                name: p.name,
                arguments: typeof p.input === 'string' ? p.input : JSON.stringify(p.input ?? {}),
            },
        });
    }
    return toolCalls.length ? toolCalls : undefined;
};

const buildOpenAIUsage = (usage: Record<string, unknown> | undefined): Record<string, number> => {
    const u = usage ?? {};
    const promptTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
    const completionTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0);
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
    };
};

const buildAnthropicUsage = (usage: Record<string, unknown> | undefined): { input_tokens: number; output_tokens: number } => {
    const u = usage ?? {};
    return {
        input_tokens: Number(u.input_tokens ?? u.prompt_tokens ?? 0),
        output_tokens: Number(u.output_tokens ?? u.completion_tokens ?? 0),
    };
};

const buildResponsesUsage = (usage: Record<string, unknown> | undefined): Record<string, unknown> => {
    const u = usage ?? {};
    const inputTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
    const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0);
    const inputDetails = (u.input_tokens_details as Record<string, unknown> | undefined) ?? {};
    const outputDetails = (u.output_tokens_details as Record<string, unknown> | undefined) ?? {};
    return {
        input_tokens: inputTokens,
        input_tokens_details: {
            cached_tokens: Number(u.cached_tokens ?? inputDetails.cached_tokens ?? 0),
        },
        output_tokens: outputTokens,
        output_tokens_details: {
            reasoning_tokens: Number(outputDetails.reasoning_tokens ?? 0),
        },
        total_tokens: inputTokens + outputTokens,
    };
};

const getPromptText = (prompt: unknown): string => {
    if ( prompt === undefined || prompt === null ) return '';
    if ( Array.isArray(prompt) ) {
        if ( prompt.length === 0 ) return '';
        if ( prompt.length === 1 && typeof prompt[0] === 'string' ) return prompt[0];
        throw new HttpError(400, '`prompt` must be a string or single-item string array');
    }
    if ( typeof prompt !== 'string' ) throw new HttpError(400, '`prompt` must be a string');
    return prompt;
};

// ── OpenAI /responses input → message list ──────────────────────────

const parseJsonMaybe = (value: unknown): unknown => {
    if ( typeof value !== 'string' ) return value ?? {};
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const normalizeContentPart = (part: unknown): Record<string, unknown> => {
    if ( typeof part === 'string' ) return { type: 'text', text: part };
    if ( !part || typeof part !== 'object' ) return { type: 'text', text: '' };
    const p = part as Record<string, unknown>;
    if ( p.type === 'input_text' || p.type === 'output_text' ) {
        return { type: 'text', text: String(p.text ?? '') };
    }
    if ( p.type === 'input_image' ) {
        return {
            type: 'image_url',
            ...(p.detail ? { detail: p.detail } : {}),
            ...(p.image_url ? { image_url: { url: p.image_url } } : {}),
            ...(p.file_id ? { file_id: p.file_id } : {}),
        };
    }
    if ( p.type === 'input_audio' ) return { type: 'input_audio', input_audio: p.input_audio };
    if ( p.type === 'input_file' ) {
        return {
            type: 'input_file',
            ...(p.file_data ? { file_data: p.file_data } : {}),
            ...(p.file_id ? { file_id: p.file_id } : {}),
            ...(p.file_url ? { file_url: p.file_url } : {}),
            ...(p.filename ? { filename: p.filename } : {}),
        };
    }
    return p;
};

const normalizeMessageContent = (content: unknown): unknown => {
    if ( content === undefined || content === null ) return '';
    if ( typeof content === 'string' ) return content;
    if ( Array.isArray(content) ) return content.map(normalizeContentPart);
    return [normalizeContentPart(content)];
};

const responseInputToMessages = (input: unknown): unknown[] => {
    if ( input === undefined || input === null ) return [];
    if ( typeof input === 'string' ) return [{ role: 'user', content: input }];
    if ( ! Array.isArray(input) ) {
        throw new HttpError(400, '`input` must be a string or array');
    }

    const messages: unknown[] = [];
    for ( const item of input ) {
        if ( typeof item === 'string' ) {
            messages.push({ role: 'user', content: item });
            continue;
        }
        if ( !item || typeof item !== 'object' ) continue;
        const it = item as Record<string, unknown>;

        if ( it.type === 'function_call_output' ) {
            messages.push({
                role: 'tool',
                tool_call_id: it.call_id,
                content: typeof it.output === 'string' ? it.output : JSON.stringify(it.output ?? {}),
            });
            continue;
        }
        if ( it.type === 'function_call' ) {
            messages.push({
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: (it.call_id as string | undefined) || (it.id as string | undefined) || generateId('call'),
                    canonical_id: it.id,
                    name: it.name,
                    input: parseJsonMaybe(it.arguments),
                }],
            });
            continue;
        }
        if ( it.type === 'message' || it.role ) {
            messages.push({
                role: it.role === 'developer' ? 'system' : (it.role as string | undefined) || 'user',
                content: normalizeMessageContent(it.content),
            });
            continue;
        }
        messages.push({ role: 'user', content: normalizeMessageContent(it) });
    }
    return messages;
};

// ── OpenAI /responses result → output items ─────────────────────────

const responseOutputFromResult = (result: Extract<IChatCompleteResult, { message?: unknown }>): unknown[] => {
    const output: unknown[] = [];
    const message = (result.message ?? {}) as Record<string, unknown>;
    const content = typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
            ? (message.content as unknown[])
                .filter((part): part is Record<string, unknown> => !!part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text')
                .map((part) => String(part.text ?? ''))
                .join('')
            : '';

    if ( content ) {
        output.push({
            id: generateId('msg'),
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: content, annotations: [] }],
        });
    }

    for ( const toolCall of (message.tool_calls as unknown[] | undefined) ?? [] ) {
        if ( !toolCall || typeof toolCall !== 'object' ) continue;
        const tc = toolCall as Record<string, unknown>;
        const fn = (tc.function as Record<string, unknown> | undefined) ?? {};
        output.push({
            id: (tc.canonical_id as string | undefined) || generateId('fc'),
            type: 'function_call',
            call_id: tc.id,
            name: fn.name,
            arguments: fn.arguments ?? '{}',
            status: 'completed',
        });
    }

    return output;
};

interface ResponseShellParams {
    responseId: string;
    createdAt: number;
    model: string;
    body: Record<string, unknown>;
    output: unknown[];
    usage?: Record<string, unknown> | null;
    status: string;
}

const createResponseShell = ({ responseId, createdAt, model, body, output, usage, status }: ResponseShellParams): Record<string, unknown> => ({
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
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && (item as Record<string, unknown>).type === 'message')
        .flatMap((item) => ((item.content as unknown[] | undefined) ?? []))
        .filter((part): part is Record<string, unknown> => !!part && typeof part === 'object' && (part as Record<string, unknown>).type === 'output_text')
        .map((part) => String(part.text ?? ''))
        .join(''),
    parallel_tool_calls: body.parallel_tool_calls ?? false,
    temperature: body.temperature ?? null,
    tool_choice: body.tool_choice ?? 'auto',
    tools: Array.isArray(body.tools) ? (body.tools as unknown[]).map(normalizeResponsesTool) : [],
    top_p: body.top_p ?? null,
    ...(body.max_output_tokens !== undefined ? { max_output_tokens: body.max_output_tokens } : {}),
    ...(body.previous_response_id ? { previous_response_id: body.previous_response_id } : {}),
    ...(body.store !== undefined ? { store: body.store } : {}),
    ...(body.text ? { text: body.text } : {}),
    ...(body.truncation ? { truncation: body.truncation } : {}),
    ...(usage ? { usage } : {}),
});

const normalizeResponsesTool = (tool: unknown): unknown => {
    if ( !tool || typeof tool !== 'object' ) return tool;
    const t = tool as Record<string, unknown>;
    if ( t.type !== 'function' ) return t;
    return { ...(t.function as Record<string, unknown>), type: 'function' };
};

// ── Anthropic → internal messages ───────────────────────────────────

const normalizeAnthropicTools = (tools: unknown): unknown[] | undefined => {
    if ( ! Array.isArray(tools) || tools.length === 0 ) return undefined;
    return tools.map((t) => {
        if ( !t || typeof t !== 'object' ) return t;
        const tt = t as Record<string, unknown>;
        if ( tt.type === 'function' && tt.function ) return tt;
        return {
            type: 'function',
            function: {
                name: tt.name,
                description: tt.description || '',
                parameters: tt.input_schema || { type: 'object', properties: {} },
            },
        };
    });
};

const normalizeAnthropicMessages = (messages: unknown[], system: unknown): unknown[] => {
    const result: unknown[] = [];

    if ( system ) {
        if ( typeof system === 'string' ) {
            result.push({ role: 'system', content: system });
        } else if ( Array.isArray(system) ) {
            const text = system.map((s) => {
                if ( typeof s === 'string' ) return s;
                if ( s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string' ) {
                    return String((s as Record<string, unknown>).text);
                }
                return '';
            }).join('\n');
            if ( text ) result.push({ role: 'system', content: text });
        }
    }

    for ( const msg of messages ) {
        if ( !msg || typeof msg !== 'object' ) continue;
        const m = msg as Record<string, unknown>;
        if ( m.role === 'user' && Array.isArray(m.content) ) {
            const toolResults: Array<Record<string, unknown>> = [];
            const otherParts: unknown[] = [];
            for ( const part of m.content ) {
                if ( part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool_result' ) {
                    toolResults.push(part as Record<string, unknown>);
                } else {
                    otherParts.push(part);
                }
            }
            if ( otherParts.length > 0 ) {
                result.push({ role: 'user', content: otherParts });
            }
            for ( const tr of toolResults ) {
                let contentStr = '';
                if ( typeof tr.content === 'string' ) {
                    contentStr = tr.content;
                } else if ( Array.isArray(tr.content) ) {
                    contentStr = tr.content.map((p) => {
                        if ( typeof p === 'string' ) return p;
                        if ( p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string' ) {
                            return String((p as Record<string, unknown>).text);
                        }
                        return '';
                    }).join('');
                }
                result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: contentStr });
            }
            if ( otherParts.length === 0 && toolResults.length > 0 ) continue;
            if ( toolResults.length > 0 ) continue;
        }
        result.push(m);
    }

    return result;
};

const extractToolUseBlocks = (message: Record<string, unknown>): Array<Record<string, unknown>> => {
    const blocks: Array<Record<string, unknown>> = [];

    const toolCalls = message.tool_calls;
    if ( Array.isArray(toolCalls) ) {
        for ( const tc of toolCalls ) {
            if ( !tc || typeof tc !== 'object' ) continue;
            const t = tc as Record<string, unknown>;
            const fn = (t.function as Record<string, unknown> | undefined) ?? {};
            blocks.push({
                type: 'tool_use',
                id: t.id,
                name: fn.name ?? '',
                input: typeof fn.arguments === 'string'
                    ? safeParseJson(fn.arguments)
                    : (fn.arguments ?? {}),
            });
        }
    }

    if ( Array.isArray(message.content) ) {
        for ( const part of message.content ) {
            if ( !part || typeof part !== 'object' ) continue;
            const p = part as Record<string, unknown>;
            if ( p.type !== 'tool_use' ) continue;
            blocks.push({
                type: 'tool_use',
                id: p.id,
                name: p.name,
                input: typeof p.input === 'string' ? safeParseJson(p.input) : (p.input ?? {}),
            });
        }
    }

    return blocks;
};

const safeParseJson = (s: string): unknown => {
    try {
        return JSON.parse(s);
    } catch {
        return {};
    }
};
