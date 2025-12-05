import Stream from 'node:stream';

export interface IChatModel extends Record<string, unknown> {
    id: string,
    aliases?: string[]
    cost: {
        currency: string,
    }
}

export interface IChatProvider {
    models(): IChatModel[] | Promise<IChatModel[]>
    list(): string[] | Promise<string[]>
    complete (arg: {
        messages: unknown[];
        stream?: boolean | undefined;
        model: string;
        tools?: unknown[] | undefined;
        max_tokens?: number | undefined;
        temperature?: number | undefined;
    }): Promise<{
        init_chat_stream: ({ chatStream }: {
            chatStream: Stream;
        }) => Promise<void>;
        stream: boolean;
        finally_fn: () => Promise<void>;
        message?: undefined;
        usage?: undefined;
        finish_reason?: undefined;
    } | {
        message: unknown;
        usage: unknown;
        finish_reason: string;
        init_chat_stream?: undefined;
        stream?: undefined;
        finally_fn?: string;
    }>
}