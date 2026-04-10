// Preamble: Before this we used Gemini's SDK directly and as we found out
// its actually kind of terrible. So we use the openai sdk now
// (except for image models, where we need the native SDK for image I/O)
import openai, { OpenAI } from 'openai';
import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Context } from '../../../../../util/context.js';
import APIError from '../../../../../api/APIError.js';
import { MeteringService } from '../../../../MeteringService/MeteringService.js';
import { handle_completion_output, process_input_messages } from '../../../utils/OpenAIUtil.js';
import { IChatModel, IChatProvider, ICompleteArguments, PuterMessage } from '../types.js';
import { AIChatStream, AIChatTextStream } from '../../../utils/Streaming.js';
import { GEMINI_IMAGE_CHAT_MODELS, GEMINI_MODELS } from './models.js';
import { GEMINI_ESTIMATED_IMAGE_TOKENS } from '../../../image/providers/GeminiImageGenerationProvider/models.js';
import { Actor } from '../../../../auth/Actor.js';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';

export class GeminiChatProvider implements IChatProvider {

    meteringService: MeteringService;
    openai: OpenAI;
    genai: GoogleGenAI;

    defaultModel = 'gemini-2.5-flash';

    constructor ( meteringService: MeteringService, config: { apiKey: string })
    {
        this.meteringService = meteringService;
        this.openai = new openai.OpenAI({
            apiKey: config.apiKey,
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
        this.genai = new GoogleGenAI({ apiKey: config.apiKey });
    }

    getDefaultModel () {
        return this.defaultModel;
    }

    async models () {
        return GEMINI_MODELS;
    }
    async list () {
        return (await this.models()).map(m => [m.id, ... (m.aliases || [])]).flat();
    }

    async complete ({ messages, stream, model, tools, max_tokens, temperature, image_config }: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor');
        messages = await process_input_messages(messages);

        // delete cache_control
        messages = messages.map(m => {
            delete m.cache_control;
            return m;
        });

        const modelUsed = (await this.models()).find(m => [m.id, ...(m.aliases || [])].includes(model)) || (await this.models()).find(m => m.id === this.getDefaultModel())!;

        if ( GEMINI_IMAGE_CHAT_MODELS.includes(modelUsed.id) ) {
            return this.completeImageGeneration({ messages, stream, modelUsed, image_config, temperature });
        }

        const sdk_params: ChatCompletionCreateParams = {
            messages: messages,
            model: modelUsed.id,
            ...(tools ? { tools } : {}),
            ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
            ...(temperature ? { temperature } : {}),
            stream,
            ...(stream ? {
                stream_options: { include_usage: true },
            } : {}),
        } as ChatCompletionCreateParams;

        let completion;
        try {
            completion = await this.openai.chat.completions.create(sdk_params);
        } catch (e) {
            console.error('Gemini completion error: ', e);
            throw e;
        }

        return handle_completion_output({
            usage_calculator: ({ usage }) => {
                const trackedUsage = {
                    prompt_tokens: (usage.prompt_tokens ?? 0) - (usage.prompt_tokens_details?.cached_tokens ?? 0),
                    completion_tokens: usage.completion_tokens ?? 0,
                    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
                };

                const costsOverrideFromModel = Object.fromEntries(Object.entries(trackedUsage).map(([k, v]) => {
                    return [k, v * (modelUsed.costs[k])];
                }));
                this.meteringService.utilRecordUsageObject(trackedUsage, actor, `gemini:${modelUsed?.id}`, costsOverrideFromModel);

                return trackedUsage;
            },
            stream,
            completion,
        });

    }

    private static extractTextFromContent (content: PuterMessage['content']): string {
        if ( typeof content === 'string' ) return content;
        if ( Array.isArray(content) ) {
            return content
                .filter((p: Record<string, unknown>) => p.type === 'text' || typeof p === 'string')
                .map((p: Record<string, unknown>) => (p as { text?: string }).text ?? p)
                .join('\n');
        }
        return '';
    }

    private translateMessagesToGemini (messages: PuterMessage[]): {
        contents: Record<string, unknown>[],
        systemInstruction?: string,
    } {
        let systemInstruction: string | undefined;
        const contents: Record<string, unknown>[] = [];

        for ( const msg of messages ) {
            if ( msg.role === 'system' ) {
                const text = GeminiChatProvider.extractTextFromContent(msg.content);
                if ( text ) systemInstruction = systemInstruction ? `${systemInstruction}\n${text}` : text;
                continue;
            }

            // Only translate user and assistant (model) messages; drop tool messages
            if ( msg.role !== 'user' && msg.role !== 'assistant' ) continue;

            const role = msg.role === 'assistant' ? 'model' : 'user';
            const parts: Record<string, unknown>[] = [];

            // First pass: collect parts and find if any has thoughtSignature
            let sharedThoughtSignature: string | undefined;
            if ( Array.isArray(msg.content) ) {
                for ( const part of msg.content ) {
                    if ( part.type === 'image_url' && part.thoughtSignature ) {
                        sharedThoughtSignature = part.thoughtSignature;
                        break;
                    }
                }
            }

            if ( typeof msg.content === 'string' ) {
                parts.push({ text: msg.content });
            } else if ( Array.isArray(msg.content) ) {
                for ( const part of msg.content ) {
                    if ( typeof part === 'string' ) {
                        const textPart: Record<string, unknown> = { text: part };
                        if ( sharedThoughtSignature ) {
                            textPart.thoughtSignature = sharedThoughtSignature;
                        }
                        parts.push(textPart);
                    } else if ( part.type === 'text' ) {
                        const textPart: Record<string, unknown> = { text: part.text };
                        if ( sharedThoughtSignature ) {
                            textPart.thoughtSignature = sharedThoughtSignature;
                        }
                        parts.push(textPart);
                    } else if ( part.type === 'image_url' && part.image_url?.url ) {
                        const url: string = part.image_url.url;
                        const thoughtSignature = part.thoughtSignature;
                        if ( url.startsWith('data:') ) {
                            const commaIdx = url.indexOf(',');
                            if ( commaIdx !== -1 ) {
                                const header = url.substring(5, commaIdx);
                                const mimeType = header.replace(';base64', '');
                                const data = url.substring(commaIdx + 1);
                                const imagePart: Record<string, unknown> = { inlineData: { mimeType, data } };
                                if ( thoughtSignature ) {
                                    imagePart.thoughtSignature = thoughtSignature;
                                }
                                parts.push(imagePart);
                            }
                        } else {
                            const imagePart: Record<string, unknown> = { fileData: { fileUri: url } };
                            if ( thoughtSignature ) {
                                imagePart.thoughtSignature = thoughtSignature;
                            }
                            parts.push(imagePart);
                        }
                    }
                }
            }

            if ( parts.length > 0 ) {
                contents.push({ role, parts });
            }
        }

        return { contents, systemInstruction };
    }

    private toMicroCents (cents: number): number {
        return (!Number.isFinite(cents) || cents <= 0) ? 1 : Math.ceil(cents * 1_000_000);
    }

    private tokenCostInCents (count: number, centsPerMillion: number): number {
        return (count > 0 && centsPerMillion > 0) ? (count / 1_000_000) * centsPerMillion : 0;
    }

    private static extractImageUsageMetadata (response: GenerateContentResponse): {
        promptTokenCount: number,
        candidatesTokenCount: number,
        outputImageTokenCount: number,
        thoughtsTokenCount: number,
    } {
        const usage = (response as GenerateContentResponse & { usageMetadata?: Record<string, unknown> }).usageMetadata;

        let outputImageTokenCount = 0;
        const details = (usage as Record<string, unknown>)?.candidatesTokensDetails;
        if ( Array.isArray(details) ) {
            for ( const entry of details ) {
                if ( entry?.modality === 'IMAGE' ) {
                    outputImageTokenCount += (typeof entry.tokenCount === 'number' ? entry.tokenCount : 0);
                }
            }
        }

        const toSafe = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? Math.floor(v) : 0;
        return {
            promptTokenCount: toSafe((usage as Record<string, unknown>)?.promptTokenCount),
            candidatesTokenCount: toSafe((usage as Record<string, unknown>)?.candidatesTokenCount),
            outputImageTokenCount,
            thoughtsTokenCount: toSafe((usage as Record<string, unknown>)?.thoughtsTokenCount),
        };
    }

    private meterImageGeneration (
        actor: Actor,
        modelUsed: IChatModel,
        response: GenerateContentResponse,
        estimatedPromptTokens: number,
        estimatedImageTokens: number,
    ) {
        const usage = GeminiChatProvider.extractImageUsageMetadata(response);
        const inputTokenCount = usage.promptTokenCount || estimatedPromptTokens;
        const outputImageTokenCount = usage.outputImageTokenCount || estimatedImageTokens;
        const outputTextTokenCount = Math.max(0, usage.candidatesTokenCount - outputImageTokenCount) + usage.thoughtsTokenCount;

        const costs = modelUsed.costs;
        const usagePrefix = `gemini:${modelUsed.id}`;
        this.meteringService.batchIncrementUsages(actor, [
            {
                usageType: `${usagePrefix}:input`,
                usageAmount: Math.max(inputTokenCount, 1),
                costOverride: this.toMicroCents(this.tokenCostInCents(inputTokenCount, costs.prompt_tokens)),
            },
            {
                usageType: `${usagePrefix}:output:text`,
                usageAmount: Math.max(outputTextTokenCount, 1),
                costOverride: this.toMicroCents(this.tokenCostInCents(outputTextTokenCount, costs.completion_tokens)),
            },
            {
                usageType: `${usagePrefix}:output:image`,
                usageAmount: Math.max(outputImageTokenCount, 1),
                costOverride: this.toMicroCents(this.tokenCostInCents(outputImageTokenCount, costs.output_image)),
            },
        ]);

        return { inputTokenCount, outputTextTokenCount, outputImageTokenCount };
    }

    private static parseGeminiImageResponse (response: GenerateContentResponse): {
        content: string,
        images: { type: string, image_url: { url: string }, thoughtSignature?: string }[],
    } {
        const parts = response?.candidates?.[0]?.content?.parts ?? [];
        let content = '';
        const images: { type: string, image_url: { url: string }, thoughtSignature?: string }[] = [];

        for ( const part of parts ) {
            if ( part.text ) {
                content += part.text;
            } else if ( part.inlineData?.data ) {
                const mimeType = part.inlineData.mimeType ?? 'image/png';
                const image: { type: string, image_url: { url: string }, thoughtSignature?: string } = {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${part.inlineData.data}`,
                    },
                };
                // Preserve thoughtSignature from Gemini for multi-turn image editing
                if ( (part as Record<string, unknown>).thoughtSignature ) {
                    image.thoughtSignature = (part as Record<string, unknown>).thoughtSignature as string;
                }
                images.push(image);
            }
        }

        if ( !content && images.length > 0 ) {
            content = 'Generated image.';
        }

        return { content, images };
    }

    private async completeImageGeneration ({ messages, stream, modelUsed, image_config, temperature }: {
        messages: PuterMessage[],
        stream: boolean | undefined,
        modelUsed: IChatModel,
        image_config?: { aspect_ratio?: string, image_size?: string },
        temperature?: number,
    }): ReturnType<IChatProvider['complete']> {
        const actor = Context.get('actor') as Actor;
        const { contents, systemInstruction } = this.translateMessagesToGemini(messages);

        // Resolve and validate image_size against model's allowed quality levels
        let imageSize = image_config?.image_size;
        const allowed = modelUsed.allowedQualityLevels;
        if ( allowed && allowed.length > 0 ) {
            if ( imageSize && !allowed.includes(imageSize) ) {
                throw APIError.create('field_invalid', null, {
                    key: 'image_config.image_size',
                    expected: allowed.join(', '),
                    got: imageSize,
                });
            }
            if ( ! imageSize ) imageSize = allowed[0];
        }

        const geminiImageConfig: Record<string, string> = {};
        if ( image_config?.aspect_ratio ) geminiImageConfig.aspectRatio = image_config.aspect_ratio;
        if ( imageSize ) geminiImageConfig.imageSize = imageSize;

        const config: Record<string, unknown> = {
            responseModalities: ['TEXT', 'IMAGE'],
        };
        if ( Object.keys(geminiImageConfig).length > 0 ) {
            config.imageConfig = geminiImageConfig;
        }
        if ( systemInstruction ) {
            config.systemInstruction = systemInstruction;
        }
        if ( temperature !== undefined ) {
            config.temperature = temperature;
        }

        // Pre-flight cost estimate for image input tokens
        const inputImageCount = contents
            .reduce((n, c) => n + ((c.parts as Record<string, unknown>[]) ?? []).filter((p) => p.inlineData || p.fileData).length, 0);
        const estimatedPromptTokens = inputImageCount * 560;

        const imageTokenKey = imageSize ? `${modelUsed.id}:${imageSize}` : modelUsed.id;
        const estimatedImageTokens = GEMINI_ESTIMATED_IMAGE_TOKENS[imageTokenKey];
        if ( estimatedImageTokens === undefined ) {
            throw new Error(`No estimated image token count configured for '${imageTokenKey}'.`);
        }

        const estimatedCost = this.toMicroCents(
            this.tokenCostInCents(estimatedPromptTokens, modelUsed.costs.prompt_tokens) +
            this.tokenCostInCents(estimatedImageTokens, modelUsed.costs.output_image) +
            this.tokenCostInCents(50, modelUsed.costs.completion_tokens),
        );
        const usageAllowed = await this.meteringService.hasEnoughCredits(actor, estimatedCost);
        if ( ! usageAllowed ) {
            throw APIError.create('insufficient_funds');
        }

        if ( stream ) {
            const streamResponse = await this.genai.models.generateContentStream({
                model: modelUsed.id,
                contents,
                config,
            });

            const init_chat_stream = async ({ chatStream }: { chatStream: AIChatStream }) => {
                const message = chatStream.message();
                const textblock = message.contentBlock({ type: 'text' }) as AIChatTextStream;

                let lastResponse: GenerateContentResponse | undefined;
                for await ( const chunk of streamResponse ) {
                    lastResponse = chunk;
                    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
                    for ( const part of parts ) {
                        if ( part.text ) {
                            textblock.addText(part.text);
                        } else if ( part.inlineData?.data ) {
                            const mimeType = part.inlineData.mimeType ?? 'image/png';
                            const image: Record<string, unknown> = {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${part.inlineData.data}`,
                                },
                            };
                            if ( (part as Record<string, unknown>).thoughtSignature ) {
                                image.thoughtSignature = (part as Record<string, unknown>).thoughtSignature;
                            }
                            textblock.addImage(image);
                        }
                    }
                }

                if ( lastResponse ) {
                    const metered = this.meterImageGeneration(actor, modelUsed, lastResponse, estimatedPromptTokens, estimatedImageTokens);
                    textblock.end();
                    message.end();
                    chatStream.end({
                        prompt_tokens: metered.inputTokenCount,
                        completion_tokens: metered.outputTextTokenCount + metered.outputImageTokenCount,
                    });
                } else {
                    textblock.end();
                    message.end();
                    chatStream.end({ prompt_tokens: 0, completion_tokens: 0 });
                }
            };

            return {
                stream: true as const,
                init_chat_stream,
                finally_fn: async () => {
                },
            };
        }

        const response = await this.genai.models.generateContent({
            model: modelUsed.id,
            contents,
            config,
        });

        const metered = this.meterImageGeneration(actor, modelUsed, response, estimatedPromptTokens, estimatedImageTokens);

        const { content, images } = GeminiChatProvider.parseGeminiImageResponse(response);

        return {
            message: {
                role: 'assistant',
                content,
                ...(images.length > 0 ? { images } : {}),
            },
            usage: {
                prompt_tokens: metered.inputTokenCount,
                completion_tokens: metered.outputTextTokenCount + metered.outputImageTokenCount,
            },
            finish_reason: 'stop',
        };
    }

    checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        throw new Error('No moderation logic.');
    }
}
