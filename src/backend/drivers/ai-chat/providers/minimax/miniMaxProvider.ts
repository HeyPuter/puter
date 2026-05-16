import axios, { AxiosInstance } from 'axios';

type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: any;
    name?: string;
    tool_call_id?: string;
};

type MiniMaxProviderConfig = {
    apiKey: string;
    apiBaseUrl?: string;
};

type CompleteArgs = {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    tools?: any[];
};

export class MiniMaxProvider {
    private client: AxiosInstance;
    private apiKey: string;
    private baseURL: string;

    constructor(config: MiniMaxProviderConfig) {
        this.apiKey = config.apiKey;
        this.baseURL = (
            config.apiBaseUrl || 'https://api.minimax.io/v1'
        ).replace(/\/$/, '');

        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
    }

    getDefaultModel() {
        return 'MiniMax-M2.7';
    }

    async complete({
        model,
        messages,
        temperature,
        max_tokens,
        stream = false,
        tools,
    }: CompleteArgs) {
        const payload: any = {
            model: model || this.getDefaultModel(),
            messages,
            ...(typeof temperature === 'number' ? { temperature } : {}),
            ...(typeof max_tokens === 'number' ? { max_tokens } : {}),
            ...(Array.isArray(tools) ? { tools } : {}),
            ...(stream ? { stream: true } : {}),
            extra_body: {
                reasoning_split: true,
            },
        };

        const res = await this.client.post('/chat/completions', payload, {
            responseType: stream ? 'stream' : 'json',
        });

        return res.data;
    }

    async listModels() {
        return [
            'MiniMax-M2.7',
            'MiniMax-M2.7-highspeed',
            'MiniMax-M2.5',
            'MiniMax-M2.5-highspeed',
            'MiniMax-M2.1',
            'MiniMax-M2.1-highspeed',
            'MiniMax-M2-her',
            'MiniMax-M2',
        ];
    }
}
