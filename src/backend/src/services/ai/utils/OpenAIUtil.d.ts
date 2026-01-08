import type {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionContentPart,
    ChatCompletionMessageParam,
    ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import type { CompletionUsage } from 'openai/resources/completions';
import { IChatModel, IChatProvider } from '../chat/providers/types';

export interface ToolUseContent {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
    extra_content?: unknown;
}

export interface ToolResultContent {
    type: 'tool_result';
    tool_use_id: string;
    content: unknown;
}

export type NormalizedContent =
    | ChatCompletionContentPart
    | ToolUseContent
    | ToolResultContent
    | ({ type?: 'image_url'; image_url: unknown; [key: string]: unknown });

export interface NormalizedMessage extends Partial<ChatCompletionMessageParam> {
    role?: ChatCompletionMessageParam['role'] | string;
    content?: NormalizedContent[] | null;
    tool_calls?: ChatCompletionMessageToolCall[];
    tool_call_id?: string;
    [key: string]: unknown;
}

export type UsageCalculator = (args: { usage: CompletionUsage }) => Record<string, number>;

export interface ChatStream {
    message(): {
        contentBlock: (params: { type: 'text' } | { type: 'tool_use'; id: string; name: string; extra_content?: unknown }) => {
            addText?(text: string): void;
            addReasoning?(reasoning: string): void;
            addExtraContent?(extra_content: unknown): void;
            addPartialJSON?(partial_json: string): void;
            end(): void;
        };
        end(): void;
    };
    end(): void;
}

export type StreamingToolCall = ChatCompletionChunk.Choice.Delta.ToolCall & { extra_content?: unknown };

export type CompletionChunk = Omit<ChatCompletionChunk, 'choices' | 'usage'> & {
    choices: Array<
        Omit<ChatCompletionChunk['choices'][number], 'delta'> & {
            delta: ChatCompletionChunk['choices'][number]['delta'] & {
                reasoning_content?: string | null;
                reasoning?: string | null;
                extra_content?: unknown;
                tool_calls?: StreamingToolCall[];
            };
        }
    >;
    usage?: CompletionUsage | null;
};

export interface StreamDeviations {
    index_usage_from_stream_chunk?: (chunk: CompletionChunk) => Partial<CompletionUsage> | null | undefined;
    chunk_but_like_actually?: (chunk: CompletionChunk) => Partial<CompletionChunk>;
    index_tool_calls_from_stream_choice?: (choice: CompletionChunk['choices'][number]) => StreamingToolCall[] | undefined;
}

export interface CompletionDeviations<TCompletion = ChatCompletion> {
    coerce_completion_usage?: (completion: TCompletion) => Partial<CompletionUsage>;
    chunk_but_like_actually?: (chunk: CompletionChunk) => Partial<CompletionChunk>;
    index_tool_calls_from_stream_choice?: (choice: CompletionChunk['choices'][number]) => StreamingToolCall[] | undefined;
    index_usage_from_stream_chunk?: (chunk: CompletionChunk) => Partial<CompletionUsage> | null | undefined;

}

export function process_input_messages<TMessage extends NormalizedMessage> (messages: TMessage[]): Promise<TMessage[]>;
export function process_input_messages_responses_api<TMessage extends NormalizedMessage> (messages: TMessage[]): Promise<TMessage[]>;

export function create_usage_calculator (params: { model_details: IChatModel }): UsageCalculator;

export function extractMeteredUsage (usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    prompt_tokens_details?: { cached_tokens?: number | null } | null;
}): {
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
};

export function create_chat_stream_handler (params: {
    deviations?: StreamDeviations;
    completion: AsyncIterable<CompletionChunk>;
    usage_calculator?: UsageCalculator;
}): (args: { chatStream: ChatStream }) => Promise<void>;

type CompletionChoice<TCompletion> = TCompletion extends { choices: Array<infer Choice> }
    ? Choice
    : ChatCompletion['choices'][number];

export function handle_completion_output<TCompletion = ChatCompletion> (params: {
    deviations?: CompletionDeviations<TCompletion>;
    stream?: boolean;
    completion: AsyncIterable<CompletionChunk> | TCompletion;
    moderate?: (text: string) => Promise<{ flagged: boolean }>;
    usage_calculator?: UsageCalculator;
    finally_fn?: () => Promise<void>;
}): ReturnType<IChatProvider['complete']>;

export function handle_completion_output_responses_api<TCompletion = ChatCompletion> (params: {
    deviations?: CompletionDeviations<TCompletion>;
    stream?: boolean;
    completion: AsyncIterable<CompletionChunk> | TCompletion;
    moderate?: (text: string) => Promise<{ flagged: boolean }>;
    usage_calculator?: UsageCalculator;
    finally_fn?: () => Promise<void>;
}): ReturnType<IChatProvider['complete']>;



