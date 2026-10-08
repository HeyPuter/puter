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

import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { Context } from '../../core/context.js';
import { abortOnDisconnect } from '../../core/http/abortOnDisconnect.js';
import { HttpError } from '../../core/http/HttpError.js';
import { RouteOptions } from '../../core/http/index.js';
import { computeNetworkFingerprint } from '../../core/http/middleware/rateLimit.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import {
    COUNT_TOKENS,
    type ChatCompletionDriver,
} from '../../drivers/ai-chat/ChatCompletionDriver.js';
import type {
    IChatCompleteResult,
    IChatMessageResult,
    IChatModel,
    ICompleteArguments,
    UsageDetails,
} from '../../drivers/ai-chat/types.js';
import {
    outputFormatFromResponseFormat,
    rejectStatefulResponsesFields,
    toolChoiceFromWire,
} from '../../drivers/ai-chat/utils/openaiParams.js';
import {
    promoteStopForToolCalls,
    toFinishReason,
} from '../../drivers/ai-chat/utils/stopReason.js';
import { isDriverStreamResult } from '../../drivers/meta.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../../drivers/util/aiLimits.js';
import { PuterController } from '../types.js';
import { parseAnthropicRequest, toAnthropicMessage } from './anthropicWire.js';
import { pipeNdjsonStream } from './ndjsonStream.js';
import { AnthropicSseWriter, startSse } from './sse.js';
import {
    anthropicRequestId,
    renderAnthropicError,
    renderOpenAIError,
} from './wireErrors.js';

const GEMINI_DOWNLOAD_BASE =
    'https://generativelanguage.googleapis.com/download/v1beta/files';

/**
 * OpenAI-/Anthropic-compatible HTTP surface on top of the
 * `puter-chat-completion` driver.
 *
 * Third-party SDKs (OpenAI's and Anthropic's official clients, LangChain, etc.)
 * point at their vendor's wire shape. These routes accept that wire shape,
 * translate to the internal `ICompleteArguments`, hand off to the
 * ChatCompletionDriver, and translate the result (or NDJSON stream) back into
 * the vendor's response / SSE shape.
 *
 * All routes live on `subdomain: 'api'` and require a full-access API token
 * minted from the dashboard (user-scoped worker tokens also pass — workers are
 * never treated as root tokens). Apps, scoped tokens, and account session
 * ("root") tokens are rejected. The vendor-compatible routes additionally
 * require the account to be on a paid plan. The model listings stay open —
 * clients fetch the catalogue before they have any reason to authenticate — and
 * so does the video proxy, whose signed URLs are handed out by a generation the
 * account already paid for.
 */
export class PuterAIController extends PuterController {
    registerRoutes(router: PuterRouter): void {
        /**
         * The wire routes call the chat driver directly instead of going
         * through the `/drivers/call` dispatch, so the shared per-tier AI
         * rate-limit / concurrency policy must be declared as route gates here.
         * `scope` + `key` reproduce the dispatch's bucket key
         * (`driver:<iface>:<method>:<uid>`) exactly, so wire traffic and
         * `/drivers/call` traffic draw from one per-user budget rather than
         * each surface minting its own.
         */
        const aiPolicyScope = 'driver:puter-chat-completion:complete';
        const aiPolicyKey = (req: Request): string =>
            req.actor?.user?.uuid || computeNetworkFingerprint(req);
        const apiAuthOpts = {
            subdomain: 'api',
            // The wire routes want a delegated credential — a full-access
            // API token minted from the dashboard (or a user-scoped worker
            // token, which is never treated as a root token).
            // `requireUserActor` keeps apps out, `allowFullAccessToken`
            // admits the PAT, and `noUserSession` rejects the account's
            // session ("root") token — a copied session credential
            // shouldn't double as an AI API key. `requireVerified` keeps
            // fresh/unconfirmed accounts out, same as FS writes.
            requireUserActor: true,
            allowFullAccessToken: true,
            noUserSession: true,
            requireVerified: true,
            // The vendor-compatible wire surface is a paid feature: it is
            // what makes Puter a drop-in for a metered vendor API, and an
            // account on a free plan reaches the same models through
            // `/drivers/call` (and puter.js) without it. Free accounts get
            // 402 `subscription_required` here rather than a rate limit,
            // so the answer is "upgrade", not "slow down".
            requireSubscription: true,
            rateLimit: {
                ...AI_RATE_LIMIT.default!,
                scope: aiPolicyScope,
                key: aiPolicyKey,
            },
            concurrent: {
                ...AI_CONCURRENT.default!,
                scope: aiPolicyScope,
                key: aiPolicyKey,
            },
        } as RouteOptions;
        // The vendor-compatible routes render every error — including the
        // gate failures above (auth, plan, rate limit) — in their vendor's
        // own envelope, so a client built against the real Anthropic/OpenAI
        // SDK parses ours the same way. `fields` (and so `attempts`) never
        // reaches these bodies; the alarm gate still sees them.
        const anthropicAuthOpts = {
            ...apiAuthOpts,
            errorRenderer: renderAnthropicError,
        } as RouteOptions;
        const openaiAuthOpts = {
            ...apiAuthOpts,
            errorRenderer: renderOpenAIError,
        } as RouteOptions;
        // `count_tokens` is free upstream (Anthropic doesn't charge for it)
        // and reachable far more often than a real completion in an editor
        // loop that re-counts on every keystroke — its own, more generous
        // rate limit, and no concurrency gate (nothing to bound: there is no
        // long-lived upstream call to hold a slot open for).
        const {
            concurrent: _countTokensConcurrent,
            ...apiAuthOptsNoConcurrent
        } = apiAuthOpts;
        const countTokensOpts = {
            ...apiAuthOptsNoConcurrent,
            rateLimit: {
                scope: 'puterai-count-tokens',
                limit: 120,
                window: 60_000,
                key: aiPolicyKey,
            },
            errorRenderer: renderAnthropicError,
        } as RouteOptions;
        // Model listings are unauthenticated, so the only key available is
        // the address — which is an aggregate, not a user: a NAT, a school,
        // a mobile carrier gateway or a server-side renderer all arrive as
        // one address, and the SDK and GUI both fetch the catalogue on
        // startup. The ceiling therefore has to cover a whole network's page
        // loads. What it still protects is the serialisation cost of the
        // catalogue under a client stuck in a fetch loop.
        const publicOpts = {
            subdomain: 'api',
            requireAuth: false,
            rateLimit: {
                scope: 'puterai-models',
                limit: 3_000,
                window: 60_000,
                key: 'ip',
            },
        } as RouteOptions;

        // Every route below carries the `/puterai` prefix for wire
        // compatibility with puter-js and existing API tests.
        router.post(
            '/puterai/openai/v1/chat/completions',
            openaiAuthOpts,
            this.openaiChatCompletions,
        );
        router.post(
            '/puterai/openai/v1/completions',
            openaiAuthOpts,
            this.openaiCompletions,
        );
        router.post(
            '/puterai/openai/v1/responses',
            openaiAuthOpts,
            this.openaiResponses,
        );
        router.post(
            '/puterai/anthropic/v1/messages',
            anthropicAuthOpts,
            this.anthropicMessages,
        );
        router.post(
            '/puterai/anthropic/v1/messages/count_tokens',
            countTokensOpts,
            this.anthropicCountTokens,
        );

        // Anthropic model listing — Claude Code's `gatewayDiscovery` probes
        // `GET {base}/v1/models?limit=1000` against any non-first-party base
        // URL and filters ids by `/(claude|anthropic)/i`. Unauthenticated,
        // like the other model listings, and rendered in the Anthropic
        // envelope so an unknown id 404s the way the real API does.
        router.get(
            '/puterai/anthropic/v1/models',
            { ...publicOpts, errorRenderer: renderAnthropicError },
            this.#anthropicModels,
        );
        router.get(
            '/puterai/anthropic/v1/models/:id',
            { ...publicOpts, errorRenderer: renderAnthropicError },
            this.#anthropicModelById,
        );

        // Model listing — enumerate available models per AI service
        router.get(
            '/puterai/chat/models',
            publicOpts,
            this.#listModels('aiChat'),
        );
        router.get(
            '/puterai/chat/models/details',
            publicOpts,
            this.#modelDetails('aiChat'),
        );
        router.get(
            '/puterai/image/models',
            publicOpts,
            this.#listModels('aiImage'),
        );
        router.get(
            '/puterai/image/models/details',
            publicOpts,
            this.#modelDetails('aiImage'),
        );
        router.get(
            '/puterai/video/models',
            publicOpts,
            this.#listModels('aiVideo'),
        );
        router.get(
            '/puterai/video/models/details',
            publicOpts,
            this.#modelDetails('aiVideo'),
        );

        // -- Video URL proxy -----------------------------------------
        // Reverse-proxies AI-generated video URLs that can't be given
        // directly to the client (auth-gated provider downloads). The
        // URL itself is HMAC-signed, so no additional auth gate — and no
        // plan gate either: it delivers a video the account already paid to
        // generate, to whoever holds the link.
        router.get(
            '/puterai/video/proxy',
            {
                subdomain: 'api',
                // HMAC-signed but unauthenticated, and it streams provider
                // bandwidth through us — so the in-flight cap matters as
                // much as the window.
                rateLimit: {
                    scope: 'puterai-video-proxy',
                    limit: 60,
                    window: 60_000,
                    key: 'ip',
                },
                concurrent: {
                    scope: 'puterai-video-proxy',
                    limit: 5,
                    key: 'ip',
                },
            },
            this.#videoProxy,
        );
    }

    #videoProxy = async (req: Request, res: Response): Promise<void> => {
        const fileId =
            typeof req.query.fileId === 'string' ? req.query.fileId : '';
        const provider =
            typeof req.query.provider === 'string' ? req.query.provider : '';
        const expires =
            typeof req.query.expires === 'string' ? req.query.expires : '';
        const signature =
            typeof req.query.signature === 'string' ? req.query.signature : '';

        if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
            res.status(400).send('Invalid or missing fileId parameter');
            return;
        }
        if (!expires || !signature) {
            res.status(403).send('Missing signature');
            return;
        }
        if (Number(expires) < Date.now() / 1000) {
            res.status(403).send('Signature expired');
            return;
        }

        const secret = this.config.url_signature_secret;
        if (!secret) {
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
        if (
            sigBuf.length !== expBuf.length ||
            !crypto.timingSafeEqual(sigBuf, expBuf)
        ) {
            res.status(403).send('Invalid signature');
            return;
        }

        if (provider !== 'gemini') {
            res.status(400).send('Unsupported provider');
            return;
        }

        // Same key used by `gemini-video-generation` driver to mint the asset.
        const apiKey =
            this.config.providers?.['gemini-video-generation']?.apiKey;
        if (!apiKey) {
            res.status(500).send('Gemini API key not configured');
            return;
        }

        const upstream = await fetch(
            `${GEMINI_DOWNLOAD_BASE}/${fileId}:download?alt=media&key=${apiKey}`,
        );
        if (!upstream.ok) {
            res.status(upstream.status).send('Failed to fetch video');
            return;
        }
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!upstream.body) {
            res.status(500).send('Empty response body');
            return;
        }
        Readable.fromWeb(
            upstream.body as unknown as import('node:stream/web').ReadableStream,
        ).pipe(res);
    };

    #listModels(driverKey: 'aiChat' | 'aiImage' | 'aiVideo') {
        return async (_req: Request, res: Response): Promise<void> => {
            const driver = this.drivers[driverKey];
            if (!driver?.list)
                throw new HttpError(501, 'Model listing not available', {
                    legacyCode: 'internal_error',
                });
            const models = await driver.list();
            res.json({
                models: models?.filter((m) => !HIDDEN_MODELS.includes(m)),
            });
        };
    }

    #modelDetails(driverKey: 'aiChat' | 'aiImage' | 'aiVideo') {
        return async (_req: Request, res: Response): Promise<void> => {
            const driver = this.drivers[driverKey];
            if (!driver?.models)
                throw new HttpError(501, 'Model details not available', {
                    legacyCode: 'internal_error',
                });
            const models = await driver.models();
            res.json({
                models: models?.filter((m) => !HIDDEN_MODELS.includes(m.id)),
            });
        };
    }

    // -- /openai/v1/chat/completions ---------------------------------

    openaiChatCompletions = async (
        req: Request,
        res: Response,
    ): Promise<void> => {
        const body = asRecord(req.body);
        const stream = !!body.stream;

        if (!Array.isArray(body.messages)) {
            throw new HttpError(
                400,
                '`messages` must be an array of chat messages',
                { legacyCode: 'bad_request' },
            );
        }

        const completionId = `chatcmpl-${randomId()}`;
        const created = Math.floor(Date.now() / 1000);
        const outputFormat = outputFormatFromResponseFormat(
            body.response_format,
        );

        const completeArgs: ICompleteArguments = {
            messages: mapDeveloperRoleToSystem(body.messages),
            model: toStringOrEmpty(body.model),
            stream,
            // This route does its own wire translation; pin the driver to the
            // provider-native shape so the release-date cutoff can't change
            // what the translators below receive.
            normalize: false,
            streamToolInput: true,
            ...(body.tools ? { tools: body.tools as unknown[] } : {}),
            ...(body.temperature !== undefined
                ? { temperature: Number(body.temperature) }
                : {}),
            ...(finiteMaxTokens(
                body.max_tokens ?? body.max_completion_tokens,
            ) ?? {}),
            ...toolChoiceFromBody(body, 'chat'),
            parallel_tool_calls:
                body.parallel_tool_calls === undefined
                    ? true
                    : !!body.parallel_tool_calls,
            ...stopSequencesFromBody(body),
            ...(outputFormat ? { outputFormat } : {}),
            ...(typeof body.reasoning_effort === 'string'
                ? {
                      reasoning_effort:
                          body.reasoning_effort as ICompleteArguments['reasoning_effort'],
                  }
                : {}),
            ...openaiCompatProvider(body),
        };

        const result = await this.#complete(res, completeArgs);
        const effectiveModel = completeArgs.model || '';

        if (stream) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let usageDetails: UsageDetails | undefined;
            let finishReason: string | undefined;
            let toolCallIndex = 0;
            let sawToolCalls = false;
            const toolCallIndexById = new Map<string, number>();

            const sendChunk = (
                delta: Record<string, unknown>,
                reason: string | null = null,
                extra: Record<string, unknown> = {},
            ): void => {
                res.write(
                    `data: ${JSON.stringify({
                        id: completionId,
                        object: 'chat.completion.chunk',
                        created,
                        model: effectiveModel,
                        choices: [
                            {
                                index: 0,
                                delta,
                                logprobs: null,
                                finish_reason: reason,
                            },
                        ],
                        ...extra,
                    })}\n\n`,
                );
            };

            pipeNdjsonStream(
                streamResult.stream,
                (ev) => {
                    if (ev.type === 'text' && typeof ev.text === 'string') {
                        sendChunk({ content: ev.text });
                    } else if (ev.type === 'tool_use_start') {
                        sawToolCalls = true;
                        const index = toolCallIndex++;
                        toolCallIndexById.set(ev.id as string, index);
                        sendChunk({
                            tool_calls: [
                                {
                                    index,
                                    id: ev.id,
                                    type: 'function',
                                    function: { name: ev.name, arguments: '' },
                                },
                            ],
                        });
                    } else if (ev.type === 'tool_input_delta') {
                        const index = toolCallIndexById.get(ev.id as string);
                        if (index !== undefined) {
                            sendChunk({
                                tool_calls: [
                                    {
                                        index,
                                        function: { arguments: ev.partialJson },
                                    },
                                ],
                            });
                        }
                    } else if (ev.type === 'tool_use') {
                        // Incremental deltas already streamed this call via
                        // tool_use_start/tool_input_delta above — nothing left
                        // to send. Otherwise, this is the only chunk for it.
                        if (!toolCallIndexById.has(ev.id as string)) {
                            sawToolCalls = true;
                            sendChunk({
                                tool_calls: [
                                    {
                                        index: toolCallIndex++,
                                        id: ev.id,
                                        type: 'function',
                                        function: {
                                            name: ev.name,
                                            arguments:
                                                typeof ev.input === 'string'
                                                    ? ev.input
                                                    : JSON.stringify(
                                                          ev.input ?? {},
                                                      ),
                                        },
                                    },
                                ],
                            });
                        }
                    } else if (ev.type === 'usage') {
                        usageDetails = ev.usageDetails as
                            UsageDetails | undefined;
                        finishReason = ev.finish_reason as string | undefined;
                    } else if (ev.type === 'error') {
                        res.write(
                            `data: ${JSON.stringify({
                                error: {
                                    message: ev.message ?? 'upstream error',
                                    type: 'upstream_error',
                                    code: ev.code ?? null,
                                },
                            })}\n\n`,
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                },
                {
                    onEnd: () => {
                        sendChunk(
                            {},
                            promoteStopForToolCalls(
                                finishReason ?? 'stop',
                                sawToolCalls,
                                'tool_calls',
                            ),
                            usageDetails
                                ? { usage: openaiUsage(usageDetails) }
                                : {},
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                    onError: (err) => {
                        res.write(
                            `data: ${JSON.stringify({ error: { message: err?.message ?? 'stream error', type: 'stream_error' } })}\n\n`,
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                },
            );
            return;
        }

        const messageResult = result as Extract<
            IChatCompleteResult,
            { message?: unknown }
        >;
        const message = (messageResult.message ?? {}) as Record<
            string,
            unknown
        >;
        const toolCalls =
            (message.tool_calls as unknown[] | undefined) ??
            normalizeToolCallsFromContent(message.content);
        const contentText = extractTextContent(message.content);

        res.json({
            id: completionId,
            object: 'chat.completion',
            created,
            model: effectiveModel,
            choices: [
                {
                    index: 0,
                    message: {
                        role: (message.role as string) || 'assistant',
                        content: contentText,
                        ...(toolCalls ? { tool_calls: toolCalls } : {}),
                    },
                    logprobs: null,
                    finish_reason: wireFinishReason(messageResult),
                },
            ],
            usage: openaiUsage(
                (messageResult as unknown as { usageDetails?: UsageDetails })
                    .usageDetails,
            ),
        });
    };

    // -- /openai/v1/completions --------------------------------------

    openaiCompletions = async (req: Request, res: Response): Promise<void> => {
        const body = asRecord(req.body);
        const stream = !!body.stream;

        let messages = body.messages as unknown[] | undefined;
        if (!messages) {
            messages = [{ role: 'user', content: getPromptText(body.prompt) }];
        }

        const completeArgs: ICompleteArguments = {
            messages,
            model: toStringOrEmpty(body.model),
            stream,
            // Pinned provider-native — this route translates the shape itself.
            normalize: false,
            ...(body.temperature !== undefined
                ? { temperature: Number(body.temperature) }
                : {}),
            ...(finiteMaxTokens(body.max_tokens) ?? {}),
            ...openaiCompatProvider(body),
        };

        const completionId = `cmpl-${randomId()}`;
        const created = Math.floor(Date.now() / 1000);
        const result = await this.#complete(res, completeArgs);
        const effectiveModel = completeArgs.model || '';

        if (stream) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let usageDetails: UsageDetails | undefined;
            let finishReason: string | undefined;

            const sendChunk = (
                text: string,
                reason: string | null = null,
                extra: Record<string, unknown> = {},
            ): void => {
                res.write(
                    `data: ${JSON.stringify({
                        id: completionId,
                        object: 'text_completion',
                        created,
                        model: effectiveModel,
                        choices: [
                            {
                                text,
                                index: 0,
                                logprobs: null,
                                finish_reason: reason,
                            },
                        ],
                        ...extra,
                    })}\n\n`,
                );
            };

            pipeNdjsonStream(
                streamResult.stream,
                (ev) => {
                    if (ev.type === 'text' && typeof ev.text === 'string') {
                        sendChunk(ev.text);
                    } else if (ev.type === 'usage') {
                        usageDetails = ev.usageDetails as
                            UsageDetails | undefined;
                        finishReason = ev.finish_reason as string | undefined;
                    } else if (ev.type === 'error') {
                        res.write(
                            `data: ${JSON.stringify({
                                error: {
                                    message: ev.message ?? 'upstream error',
                                    type: 'upstream_error',
                                    code: ev.code ?? null,
                                },
                            })}\n\n`,
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                },
                {
                    onEnd: () => {
                        sendChunk(
                            '',
                            finishReason ?? 'stop',
                            usageDetails
                                ? { usage: openaiUsage(usageDetails) }
                                : {},
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                    onError: (err) => {
                        res.write(
                            `data: ${JSON.stringify({ error: { message: err?.message ?? 'stream error', type: 'stream_error' } })}\n\n`,
                        );
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                },
            );
            return;
        }

        const messageResult = result as Extract<
            IChatCompleteResult,
            { message?: unknown }
        >;
        res.json({
            id: completionId,
            object: 'text_completion',
            created,
            model: effectiveModel,
            choices: [
                {
                    text: extractTextContent(
                        (
                            messageResult.message as
                                Record<string, unknown> | undefined
                        )?.content,
                    ),
                    index: 0,
                    logprobs: null,
                    finish_reason: wireFinishReason(messageResult),
                },
            ],
            usage: openaiUsage(
                (messageResult as unknown as { usageDetails?: UsageDetails })
                    .usageDetails,
            ),
        });
    };

    // -- /openai/v1/responses ----------------------------------------

    openaiResponses = async (req: Request, res: Response): Promise<void> => {
        const body = asRecord(req.body);
        const stream = !!body.stream;

        // Pinned, unlike the chat/completions routes: the translators below
        // read one provider's native Responses shape, so the preferred-route
        // and unhealthy-route logic cannot be allowed to swap it out.
        const providerName =
            toStringOrEmpty(body.provider) || DEFAULTS.openaiResponses;
        if (providerName !== DEFAULTS.openaiResponses) {
            throw new HttpError(
                400,
                `\`provider\` must be '${DEFAULTS.openaiResponses}'`,
                { legacyCode: 'bad_request' },
            );
        }

        // These reference OpenAI-held state this backend doesn't hold;
        // rejected up front rather than forwarded.
        rejectStatefulResponsesFields(body);

        const messages: unknown[] = [
            ...(body.instructions
                ? [{ role: 'system', content: body.instructions }]
                : []),
            ...responseInputToMessages(body.input),
        ];

        const completeArgs: ICompleteArguments = {
            messages,
            model: toStringOrEmpty(body.model),
            stream,
            // Pinned provider-native — this route translates the shape itself.
            normalize: false,
            streamToolInput: true,
            ...(body.tools ? { tools: body.tools as unknown[] } : {}),
            ...toolChoiceFromBody(body, 'responses'),
            parallel_tool_calls:
                body.parallel_tool_calls === undefined
                    ? true
                    : !!body.parallel_tool_calls,
            ...(body.temperature !== undefined
                ? { temperature: Number(body.temperature) }
                : {}),
            ...(body.max_output_tokens !== undefined
                ? { max_tokens: Number(body.max_output_tokens) }
                : {}),
            ...(body.top_p !== undefined ? { top_p: Number(body.top_p) } : {}),
            ...(body.reasoning
                ? {
                      reasoning:
                          body.reasoning as ICompleteArguments['reasoning'],
                  }
                : {}),
            ...(body.text
                ? { text: body.text as ICompleteArguments['text'] }
                : {}),
            ...(body.include ? { include: body.include as unknown[] } : {}),
            ...(body.instructions
                ? {
                      instructions:
                          body.instructions as ICompleteArguments['instructions'],
                  }
                : {}),
            ...(body.metadata
                ? { metadata: body.metadata as Record<string, string> }
                : {}),
            ...(body.context_management !== undefined
                ? { context_management: body.context_management }
                : {}),
            ...(body.compaction !== undefined
                ? {
                      compaction:
                          body.compaction as ICompleteArguments['compaction'],
                  }
                : {}),
            ...(body.prompt_cache_key
                ? { prompt_cache_key: String(body.prompt_cache_key) }
                : {}),
            ...(body.prompt_cache_retention
                ? {
                      prompt_cache_retention:
                          body.prompt_cache_retention as ICompleteArguments['prompt_cache_retention'],
                  }
                : {}),
            // forced off regardless of what the caller sent — OpenAI
            // defaults `store` to true, which would persist state server-side
            // on OpenAI's end that this route gives no way to retrieve.
            store: false,
            ...(body.truncation
                ? {
                      truncation:
                          body.truncation as ICompleteArguments['truncation'],
                  }
                : {}),
            ...(body.service_tier
                ? {
                      service_tier:
                          body.service_tier as ICompleteArguments['service_tier'],
                  }
                : {}),
            provider: providerName,
        };

        const responseId = generateId('resp');
        const createdAt = Math.floor(Date.now() / 1000);
        const result = await this.#complete(res, completeArgs);
        const effectiveModel = completeArgs.model || '';

        if (stream) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            let sequenceNumber = 0;
            let usage: Record<string, unknown> | null = null;
            let messageItem: {
                id: string;
                type: string;
                role: string;
                status: string;
                content: Array<{
                    type: string;
                    text: string;
                    annotations: unknown[];
                }>;
            } | null = null;
            let messageOutputIndex: number | null = null;
            const output: unknown[] = [];
            let textContent = '';
            const toolItemsById = new Map<
                string,
                {
                    outputIndex: number;
                    id: string;
                    name: unknown;
                    arguments: string;
                }
            >();

            const sendEvent = (event: Record<string, unknown>): void => {
                res.write(`event: ${event.type}\n`);
                res.write(
                    `data: ${JSON.stringify({ ...event, sequence_number: ++sequenceNumber })}\n\n`,
                );
            };

            sendEvent({
                type: 'response.created',
                response: createResponseShell({
                    responseId,
                    createdAt,
                    model: effectiveModel,
                    body,
                    output: [],
                    status: 'in_progress',
                }),
            });

            pipeNdjsonStream(
                streamResult.stream,
                (ev) => {
                    if (ev.type === 'text' && typeof ev.text === 'string') {
                        if (!messageItem) {
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
                                annotations: [] as unknown[],
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
                        textContent += ev.text;
                        messageItem.content[0].text = textContent;
                        sendEvent({
                            type: 'response.output_text.delta',
                            output_index: messageOutputIndex,
                            item_id: messageItem.id,
                            content_index: 0,
                            delta: ev.text,
                        });
                    } else if (ev.type === 'tool_use_start') {
                        const id =
                            (ev.canonical_id as string | undefined) ||
                            generateId('fc');
                        const outputIndex = output.length;
                        const entry = {
                            outputIndex,
                            id,
                            name: ev.name,
                            arguments: '',
                        };
                        toolItemsById.set(ev.id as string, entry);
                        output.push({
                            id,
                            type: 'function_call',
                            call_id: ev.id,
                            name: ev.name,
                            arguments: '',
                            status: 'in_progress',
                        });
                        sendEvent({
                            type: 'response.output_item.added',
                            output_index: outputIndex,
                            item: output[outputIndex],
                        });
                    } else if (ev.type === 'tool_input_delta') {
                        const entry = toolItemsById.get(ev.id as string);
                        if (entry) {
                            entry.arguments += ev.partialJson as string;
                            sendEvent({
                                type: 'response.function_call_arguments.delta',
                                output_index: entry.outputIndex,
                                item_id: entry.id,
                                delta: ev.partialJson,
                            });
                        }
                    } else if (ev.type === 'tool_use') {
                        const started = toolItemsById.get(ev.id as string);
                        if (started) {
                            // Already streamed incrementally above — finalize.
                            const item = output[started.outputIndex] as Record<
                                string,
                                unknown
                            >;
                            item.status = 'completed';
                            sendEvent({
                                type: 'response.function_call_arguments.done',
                                output_index: started.outputIndex,
                                item_id: started.id,
                                name: started.name,
                                arguments: started.arguments,
                            });
                            sendEvent({
                                type: 'response.output_item.done',
                                output_index: started.outputIndex,
                                item,
                            });
                        } else {
                            // No prior start — the whole call in one chunk.
                            const item = {
                                id:
                                    (ev.canonical_id as string | undefined) ||
                                    generateId('fc'),
                                type: 'function_call',
                                call_id: ev.id,
                                name: ev.name,
                                arguments:
                                    typeof ev.input === 'string'
                                        ? ev.input
                                        : JSON.stringify(ev.input ?? {}),
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
                    } else if (ev.type === 'compaction') {
                        // Native shape in the final `output[]`, plus the
                        // canonical SSE event shared with the Anthropic surface.
                        const item = {
                            type: 'compaction',
                            ...(ev.id !== undefined ? { id: ev.id } : {}),
                            encrypted_content: ev.encrypted_content,
                        };
                        const outputIndex = output.length;
                        output.push(item);
                        sendEvent({
                            type: 'response.output_item.added',
                            output_index: outputIndex,
                            item,
                        });
                        sendEvent({
                            type: 'response.output_item.done',
                            output_index: outputIndex,
                            item,
                        });
                        writeCompactionEvent(res, {
                            id: ev.id,
                            encrypted_content: ev.encrypted_content,
                        });
                    } else if (ev.type === 'usage') {
                        usage = responsesUsage(
                            ev.usageDetails as UsageDetails | undefined,
                        );
                    } else if (ev.type === 'error') {
                        sendEvent({
                            type: 'error',
                            error: {
                                message: ev.message ?? 'upstream error',
                                type: 'upstream_error',
                                code: ev.code ?? null,
                            },
                        });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                },
                {
                    onEnd: () => {
                        if (messageItem) {
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
                            response: createResponseShell({
                                responseId,
                                createdAt,
                                model: effectiveModel,
                                body,
                                output,
                                usage,
                                status: 'completed',
                            }),
                        });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                    onError: (err) => {
                        sendEvent({
                            type: 'error',
                            error: {
                                message: err?.message ?? 'stream error',
                                type: 'stream_error',
                            },
                        });
                        res.write('data: [DONE]\n\n');
                        res.end();
                    },
                },
            );
            return;
        }

        const messageResult = result as Extract<
            IChatCompleteResult,
            { message?: unknown }
        >;
        const usage = responsesUsage(
            (messageResult as unknown as { usageDetails?: UsageDetails })
                .usageDetails,
        );
        const outputItems = responseOutputFromResult(messageResult);

        res.json(
            createResponseShell({
                responseId,
                createdAt,
                model: effectiveModel,
                body,
                output: outputItems,
                usage,
                status: 'completed',
            }),
        );
    };

    // -- /anthropic/v1/messages --------------------------------------

    anthropicMessages = async (req: Request, res: Response): Promise<void> => {
        const body = asRecord(req.body);
        const args = parseAnthropicRequest(body, req.headers);
        const requestId = anthropicRequestId();
        res.setHeader('request-id', requestId);

        const messageId = `msg_${randomId()}`;
        // The Anthropic route needs the vendor's own 4xx, not a fallback
        // provider's translation of it — unlike puter.js / OpenAI-compat
        // callers, which keep falling back on a request-level failure.
        Context.set('strictUpstreamErrors', true);
        const result = await this.#complete(res, args);
        const effectiveModel = args.model || '';

        if (args.stream) {
            const streamResult = expectStream(result);
            setSseHeaders(res);

            const sse = startSse(res, { ping: true });
            const writer = new AnthropicSseWriter(sse, {
                id: messageId,
                model: effectiveModel,
                requestId,
            });
            writer.start();

            pipeNdjsonStream(streamResult.stream, (ev) => writer.onChunk(ev), {
                onError: (err) => {
                    if (!writer.ended) {
                        writer.onChunk({
                            type: 'error',
                            message: err?.message ?? 'stream error',
                        });
                    }
                },
            });
            return;
        }

        const messageResult = result as unknown as IChatMessageResult;
        res.json(
            toAnthropicMessage(messageResult, {
                id: messageId,
                model: effectiveModel,
            }),
        );
    };

    // -- /anthropic/v1/messages/count_tokens --------------------------

    anthropicCountTokens = async (
        req: Request,
        res: Response,
    ): Promise<void> => {
        const body = asRecord(req.body);
        const args = parseAnthropicRequest(body, req.headers, {
            countTokens: true,
        });
        const result = await this.#driver()[COUNT_TOKENS](args);
        res.setHeader('request-id', anthropicRequestId());
        res.json(result);
    };

    // -- /anthropic/v1/models[/:id] ------------------------------------

    async #claudeModels(): Promise<IChatModel[]> {
        const driver = this.drivers.aiChat;
        if (!driver?.models) return [];
        const models = await driver.models();
        return models.filter((m) => m.provider === 'claude');
    }

    #anthropicModels = async (req: Request, res: Response): Promise<void> => {
        res.setHeader('request-id', anthropicRequestId());
        const models = await this.#claudeModels();
        const limit = Number(req.query.limit);
        const sliced =
            Number.isFinite(limit) && limit > 0
                ? models.slice(0, limit)
                : models;
        res.json({
            data: sliced.map(anthropicModelEntry),
            has_more: sliced.length < models.length,
            first_id: sliced[0]?.id ?? null,
            last_id: sliced[sliced.length - 1]?.id ?? null,
        });
    };

    #anthropicModelById = async (
        req: Request,
        res: Response,
    ): Promise<void> => {
        res.setHeader('request-id', anthropicRequestId());
        const id = String(req.params.id ?? '');
        const models = await this.#claudeModels();
        const model = models.find(
            (m) => m.id === id || (m.aliases ?? []).includes(id),
        );
        if (!model) {
            throw new HttpError(404, `model: ${id}`, {
                legacyCode: 'not_found',
            });
        }
        res.json(anthropicModelEntry(model));
    };

    // -- Internals ---------------------------------------------------

    #driver(): ChatCompletionDriver {
        const driver = this.drivers.aiChat;
        if (!driver)
            throw new HttpError(500, 'Chat completion driver not registered', {
                legacyCode: 'internal_error',
            });
        return driver;
    }

    /** A completion that stops, and stops billing, when the caller hangs up. */
    #complete(
        res: Response,
        args: ICompleteArguments,
    ): Promise<IChatCompleteResult> {
        Context.set('abortSignal', abortOnDisconnect(res));
        return this.#driver().complete(args);
    }
}

// -- Shared helpers --------------------------------------------------

const DEFAULTS = {
    openaiChat: 'openai-completion',
    openaiResponses: 'openai-responses',
} as const;

/** Test-only chat models, kept out of the public listings. */
const HIDDEN_MODELS = ['costly', 'fake', 'abuse'];

/**
 * How the OpenAI-compat routes pin a provider. An explicit one is the caller's
 * choice; a named model is left unpinned so the driver picks the preferred
 * healthy route, as it does for puter.js callers. A request with no model has
 * no route to prefer, so it stays pinned and keeps taking its default model
 * from OpenAI rather than silently switching to another vendor's.
 */
const openaiCompatProvider = (
    body: Record<string, unknown>,
): { provider?: string } => {
    if (body.provider) return { provider: toStringOrEmpty(body.provider) };
    if (toStringOrEmpty(body.model)) return {};
    return { provider: DEFAULTS.openaiChat };
};

const randomId = (): string => crypto.randomUUID().replace(/-/g, '');
const generateId = (prefix: string): string => `${prefix}_${randomId()}`;

const asRecord = (value: unknown): Record<string, unknown> => {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
};

const toStringOrEmpty = (v: unknown): string =>
    typeof v === 'string' ? v : '';

// A user-supplied max_tokens must coerce to a finite number. A non-numeric
// value (e.g. the string "NaN") becomes NaN, which slips through the credit
// gate's `?? Infinity` and every `< 1` comparison, disabling the output cap.
// Drop it instead so the request runs with no client-requested cap rather than
// a poisoned one.
const finiteMaxTokens = (v: unknown): { max_tokens: number } | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? { max_tokens: n } : undefined;
};

/**
 * A non-stream completion's OpenAI-wire `finish_reason`. Claude's native
 * `message.stop_reason` reports the real reason (`finish_reason` itself is
 * always `stop` on the wire, like main); other providers already set
 * `finish_reason` to the right value, so this falls through to it.
 */
const wireFinishReason = (
    r: Extract<IChatCompleteResult, { message?: unknown }>,
): string => {
    const s = (r.message as Record<string, unknown> | undefined)?.stop_reason;
    return (
        toFinishReason(typeof s === 'string' ? s : undefined) ??
        (r.finish_reason as string | undefined) ??
        'stop'
    );
};

/**
 * `role: 'developer'` is OpenAI's newer spelling of a system message (reasoning
 * models); our driver vocabulary only knows `system`.
 */
const mapDeveloperRoleToSystem = (messages: unknown[]): unknown[] =>
    messages.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const msg = m as Record<string, unknown>;
        return msg.role === 'developer' ? { ...msg, role: 'system' } : msg;
    });

/** `body.tool_choice` (OpenAI wire) → the normalized `ToolChoice`, if set. */
const toolChoiceFromBody = (
    body: Record<string, unknown>,
    dialect: 'chat' | 'responses',
): { tool_choice?: ICompleteArguments['tool_choice'] } => {
    if (body.tool_choice === undefined) return {};
    const tc = toolChoiceFromWire(body.tool_choice, dialect);
    return tc ? { tool_choice: tc } : {};
};

/** `body.stop` (string or string[]) → the normalized `stopSequences`. */
const stopSequencesFromBody = (
    body: Record<string, unknown>,
): { stopSequences?: string[] } => {
    if (Array.isArray(body.stop)) {
        return body.stop.length ? { stopSequences: body.stop.map(String) } : {};
    }
    if (typeof body.stop === 'string') return { stopSequences: [body.stop] };
    return {};
};

const setSseHeaders = (res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
};

/**
 * Inline-compaction is emitted in a single canonical SSE shape that is
 * byte-identical across the `/responses` and `/anthropic/v1/messages` streaming
 * surfaces, so a streaming client parses compaction the same way regardless of
 * which upstream served the request. (Non-streaming bodies stay
 * provider-native.)
 */
const writeCompactionEvent = (
    res: Response,
    compaction: { id?: unknown; encrypted_content?: unknown },
): void => {
    const payload = {
        type: 'compaction',
        ...(compaction.id !== undefined ? { id: compaction.id } : {}),
        encrypted_content: compaction.encrypted_content,
    };
    res.write(`event: compaction\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

/**
 * The chat driver returns either a stream-result envelope or a plain message
 * result. Proxy routes invoked with `stream: true` expect the former; 500 if
 * the driver dropped the signal.
 */
const expectStream = (
    result: IChatCompleteResult,
): { stream: NodeJS.ReadableStream } => {
    if (!isDriverStreamResult(result as unknown)) {
        throw new HttpError(500, 'expected streaming response', {
            legacyCode: 'internal_error',
        });
    }
    return result as unknown as { stream: NodeJS.ReadableStream };
};

// -- OpenAI/Anthropic shape helpers -----------------------------------

const extractTextContent = (content: unknown): string => {
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    const r = part as Record<string, unknown>;
                    if (typeof r.text === 'string') return r.text;
                    if (typeof r.content === 'string') return r.content;
                }
                return '';
            })
            .join('');
    }
    if (typeof content === 'object') {
        const r = content as Record<string, unknown>;
        if (typeof r.text === 'string') return r.text;
        if (typeof r.content === 'string') return r.content;
    }
    return '';
};

const normalizeToolCallsFromContent = (
    content: unknown,
): Array<Record<string, unknown>> | undefined => {
    if (!Array.isArray(content)) return undefined;
    const toolCalls: Array<Record<string, unknown>> = [];
    for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (p.type !== 'tool_use') continue;
        toolCalls.push({
            id: p.id,
            type: 'function',
            function: {
                name: p.name,
                arguments:
                    typeof p.input === 'string'
                        ? p.input
                        : JSON.stringify(p.input ?? {}),
            },
        });
    }
    return toolCalls.length ? toolCalls : undefined;
};

/**
 * `UsageDetails` → the OpenAI Chat Completions `usage` shape. Cache reads and
 * cache writes count toward `prompt_tokens` (OpenAI reports them as a _subset_
 * of it, unlike Anthropic's separate counters), with the cached slice broken
 * back out under `prompt_tokens_details`.
 */
const openaiUsage = (d: UsageDetails | undefined): Record<string, unknown> => {
    if (!d) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const cacheRead = d.cacheReadTokens ?? 0;
    const cacheWrite =
        (d.cacheWrite5mTokens ?? 0) + (d.cacheWrite1hTokens ?? 0);
    const promptTokens = d.inputTokens + cacheRead + cacheWrite;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: d.outputTokens,
        total_tokens: promptTokens + d.outputTokens,
        prompt_tokens_details: { cached_tokens: cacheRead },
        ...(d.reasoningTokens !== undefined
            ? {
                  completion_tokens_details: {
                      reasoning_tokens: d.reasoningTokens,
                  },
              }
            : {}),
    };
};

/** `UsageDetails` → the OpenAI Responses `usage` shape. */
const responsesUsage = (
    d: UsageDetails | undefined,
): Record<string, unknown> => {
    if (!d) {
        return {
            input_tokens: 0,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 0,
            output_tokens_details: { reasoning_tokens: 0 },
            total_tokens: 0,
        };
    }
    const cacheRead = d.cacheReadTokens ?? 0;
    const cacheWrite =
        (d.cacheWrite5mTokens ?? 0) + (d.cacheWrite1hTokens ?? 0);
    const inputTokens = d.inputTokens + cacheRead + cacheWrite;
    return {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: cacheRead },
        output_tokens: d.outputTokens,
        output_tokens_details: { reasoning_tokens: d.reasoningTokens ?? 0 },
        total_tokens: inputTokens + d.outputTokens,
    };
};

const getPromptText = (prompt: unknown): string => {
    if (prompt === undefined || prompt === null) return '';
    if (Array.isArray(prompt)) {
        if (prompt.length === 0) return '';
        if (prompt.length === 1 && typeof prompt[0] === 'string')
            return prompt[0];
        throw new HttpError(
            400,
            '`prompt` must be a string or single-item string array',
            { legacyCode: 'bad_request' },
        );
    }
    if (typeof prompt !== 'string')
        throw new HttpError(400, '`prompt` must be a string', {
            legacyCode: 'bad_request',
        });
    return prompt;
};

// -- OpenAI /responses input → message list --------------------------

const parseJsonMaybe = (value: unknown): unknown => {
    if (typeof value !== 'string') return value ?? {};
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

const normalizeContentPart = (part: unknown): Record<string, unknown> => {
    if (typeof part === 'string') return { type: 'text', text: part };
    if (!part || typeof part !== 'object') return { type: 'text', text: '' };
    const p = part as Record<string, unknown>;
    if (p.type === 'input_text' || p.type === 'output_text') {
        return { type: 'text', text: String(p.text ?? '') };
    }
    if (p.type === 'input_image') {
        return {
            type: 'image_url',
            ...(p.detail ? { detail: p.detail } : {}),
            ...(p.image_url ? { image_url: { url: p.image_url } } : {}),
            ...(p.file_id ? { file_id: p.file_id } : {}),
        };
    }
    if (p.type === 'input_audio')
        return { type: 'input_audio', input_audio: p.input_audio };
    if (p.type === 'input_file') {
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
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(normalizeContentPart);
    return [normalizeContentPart(content)];
};

const responseInputToMessages = (input: unknown): unknown[] => {
    if (input === undefined || input === null) return [];
    if (typeof input === 'string') return [{ role: 'user', content: input }];
    if (!Array.isArray(input)) {
        throw new HttpError(400, '`input` must be a string or array', {
            legacyCode: 'bad_request',
        });
    }

    const messages: unknown[] = [];
    for (const item of input) {
        if (typeof item === 'string') {
            messages.push({ role: 'user', content: item });
            continue;
        }
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;

        if (it.type === 'compaction') {
            // Round-tripped compaction artifact: preserve it as a bare item so
            // `normalize_single_message` wraps it into an internal compaction
            // content block (providers map it back to their native input shape).
            messages.push({
                type: 'compaction',
                ...(it.id !== undefined ? { id: it.id } : {}),
                encrypted_content: it.encrypted_content,
            });
            continue;
        }
        if (it.type === 'function_call_output') {
            messages.push({
                role: 'tool',
                tool_call_id: it.call_id,
                content:
                    typeof it.output === 'string'
                        ? it.output
                        : JSON.stringify(it.output ?? {}),
            });
            continue;
        }
        if (it.type === 'function_call') {
            messages.push({
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id:
                            (it.call_id as string | undefined) ||
                            (it.id as string | undefined) ||
                            generateId('call'),
                        canonical_id: it.id,
                        name: it.name,
                        input: parseJsonMaybe(it.arguments),
                    },
                ],
            });
            continue;
        }
        if (it.type === 'message' || it.role) {
            messages.push({
                role:
                    it.role === 'developer'
                        ? 'system'
                        : (it.role as string | undefined) || 'user',
                content: normalizeMessageContent(it.content),
            });
            continue;
        }
        messages.push({ role: 'user', content: normalizeMessageContent(it) });
    }
    return messages;
};

// -- OpenAI /responses result → output items -------------------------

const responseOutputFromResult = (
    result: Extract<IChatCompleteResult, { message?: unknown }>,
): unknown[] => {
    const output: unknown[] = [];
    const message = (result.message ?? {}) as Record<string, unknown>;
    const content =
        typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? (message.content as unknown[])
                    .filter(
                        (part): part is Record<string, unknown> =>
                            !!part &&
                            typeof part === 'object' &&
                            (part as Record<string, unknown>).type === 'text',
                    )
                    .map((part) => String(part.text ?? ''))
                    .join('')
              : '';

    if (content) {
        output.push({
            id: generateId('msg'),
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: content, annotations: [] }],
        });
    }

    for (const toolCall of (message.tool_calls as unknown[] | undefined) ??
        []) {
        if (!toolCall || typeof toolCall !== 'object') continue;
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

    const compaction = (result as { compaction?: Record<string, unknown> })
        .compaction;
    if (compaction) {
        output.push({
            id: (compaction.id as string | undefined) || generateId('cmpct'),
            type: 'compaction',
            encrypted_content: compaction.encrypted_content,
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

const createResponseShell = ({
    responseId,
    createdAt,
    model,
    body,
    output,
    usage,
    status,
}: ResponseShellParams): Record<string, unknown> => ({
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
        .filter(
            (item): item is Record<string, unknown> =>
                !!item &&
                typeof item === 'object' &&
                (item as Record<string, unknown>).type === 'message',
        )
        .flatMap((item) => (item.content as unknown[] | undefined) ?? [])
        .filter(
            (part): part is Record<string, unknown> =>
                !!part &&
                typeof part === 'object' &&
                (part as Record<string, unknown>).type === 'output_text',
        )
        .map((part) => String(part.text ?? ''))
        .join(''),
    // The OpenAI routes default parallel tool use ON (unlike the legacy
    // puter.js/Claude default), so the echoed shell matches what the driver
    // actually ran with.
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    temperature: body.temperature ?? null,
    tool_choice: body.tool_choice ?? 'auto',
    tools: Array.isArray(body.tools)
        ? (body.tools as unknown[]).map(normalizeResponsesTool)
        : [],
    top_p: body.top_p ?? null,
    ...(body.max_output_tokens !== undefined
        ? { max_output_tokens: body.max_output_tokens }
        : {}),
    // always false — this route never persists state upstream,
    // whatever the caller asked for.
    store: false,
    ...(body.text ? { text: body.text } : {}),
    ...(body.truncation ? { truncation: body.truncation } : {}),
    ...(usage ? { usage } : {}),
});

const normalizeResponsesTool = (tool: unknown): unknown => {
    if (!tool || typeof tool !== 'object') return tool;
    const t = tool as Record<string, unknown>;
    if (t.type !== 'function') return t;
    return { ...(t.function as Record<string, unknown>), type: 'function' };
};

// -- Anthropic model listing -------------------------------------------

/** A Claude catalog entry → the Anthropic `/v1/models` wire shape. */
const anthropicModelEntry = (model: IChatModel): Record<string, unknown> => ({
    type: 'model',
    id: model.id,
    display_name: typeof model.name === 'string' ? model.name : model.id,
    created_at: model.release_date ? `${model.release_date}T00:00:00Z` : null,
});
