import { ModerationCreateResponse } from 'openai/resources/moderations.js';
import { IChatModel, IChatProvider, ICompleteArguments } from './types';

/**
 * Abstract base class for AI chat providers, and default hollow implementation;
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
    async checkModeration (_text: string): ReturnType<IChatProvider['checkModeration']> {
        return {
            flagged: false,
            results: {} as ModerationCreateResponse,
        };
    }
    async complete (_arg: ICompleteArguments): ReturnType<IChatProvider['complete']> {
        throw new Error('Method not implemented.');
    }
}