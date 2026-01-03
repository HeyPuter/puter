import { Message } from 'openai/resources/conversations/conversations.js';
import { ModerationCreateResponse } from 'openai/resources/moderations.js';
import { AIChatStream } from '../../utils/Streaming';

type ModelCost = Record<string, number>;

export interface IChatModel<T extends ModelCost = ModelCost> extends Record<string, unknown> {
    id: string,
    provider?: string,
    aliases?: string[]
    costs_currency: string,
    input_cost_key?: keyof T,
    output_cost_key?: keyof T,
    costs: T,
    context?: number,
    max_tokens: number,
}

export interface IOpenRouterExtras {
    // Structured outputs / JSON mode
    response_format?:
        | { type: 'text' }
        | { type: 'json_object' }
        | { type: 'json_schema'; json_schema: { name: string; schema?: object; strict?: boolean } };

    // Reasoning / thinking tokens (Anthropic, DeepSeek, etc.)
    reasoning?: {
        effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
        summary?: 'auto' | 'concise' | 'detailed';
        max_tokens?: number;
    };

    // Provider routing
    provider?: {
        order?: string[];
        only?: string[];
        ignore?: string[];
        allow_fallbacks?: boolean;
        require_parameters?: boolean;
        data_collection?: 'allow' | 'deny';
    };

    // Sampler parameters
    top_p?: number;
    top_k?: number;
    min_p?: number;
    top_a?: number;
    seed?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
}

export type PuterMessage = Message | any; // TODO DS: type this more strictly
export interface ICompleteArguments {
    messages: PuterMessage[];
    provider?: string;
    stream?: boolean;
    model: string;
    tools?: unknown[];
    max_tokens?: number;
    temperature?: number;
    reasoning?: { effort: 'low' | 'medium' | 'high' } | undefined;
    text?: string & { verbosity?: 'concise' | 'detailed' | undefined };
    reasoning_effort?: 'low' | 'medium' | 'high' | undefined;
    verbosity?: 'concise' | 'detailed' | undefined;
    moderation?: boolean;
    custom?: unknown;
    response?: {
        normalize?: boolean;
    };
    customLimitMessage?: string;

    // laziest way to do it without causing trouble for existing usage
    openrouter_extras?: IOpenRouterExtras 
}

export interface IChatProvider {
    models(): IChatModel[] | Promise<IChatModel[]>
    list(): string[] | Promise<string[]>
    checkModeration (text: string): Promise<{
        flagged: boolean;
        results: ModerationCreateResponse & {
            _request_id?: string | null;
        };
    }>
    getDefaultModel(): string;
    complete (arg: ICompleteArguments): Promise<{
        init_chat_stream: ({ chatStream }: {
            chatStream: AIChatStream;
        }) => Promise<void>;
        stream: true;
        finally_fn: () => Promise<void>;
        message?: never;
        usage?: never;
        finish_reason?: never;
        via_ai_chat_service?: true, // legacy field always true now
    } | {
        message: PuterMessage;
        usage: Record<string, number>;
        finish_reason: string;
        init_chat_stream?: never;
        stream?: never;
        finally_fn?: never;
        normalized?: boolean;
        via_ai_chat_service?: true, // legacy field always true now
    }>
}
