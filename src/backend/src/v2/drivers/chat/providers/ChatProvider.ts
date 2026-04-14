import type { IChatModel, IChatProvider, ICompleteArguments, IChatCompleteResult } from '../types.js';

/**
 * Abstract base for AI chat providers. Each provider wraps a single
 * upstream API (Anthropic, OpenAI, …) and exposes the unified
 * `IChatProvider` contract.
 */
export class ChatProvider implements IChatProvider {
    getDefaultModel (): string {
        return '';
    }
    models (): IChatModel[] | Promise<IChatModel[]> {
        return [];
    }
    list (): string[] | Promise<string[]> {
        return [];
    }
    async complete (_arg: ICompleteArguments): Promise<IChatCompleteResult> {
        throw new Error('Method not implemented.');
    }
}
