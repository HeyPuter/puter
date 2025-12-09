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
    } | {
        message: PuterMessage;
        usage: Record<string, number>;
        finish_reason: string;
        init_chat_stream?: never;
        stream?: never;
        finally_fn?: never;
        normalized?: boolean;
    }>
}
