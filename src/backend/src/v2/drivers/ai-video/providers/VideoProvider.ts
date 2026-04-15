import type { IVideoModel, IVideoProvider, IGenerateVideoParams } from '../types.js';

/**
 * Abstract base for AI video providers. Each provider wraps a single
 * upstream API (OpenAI, Together, Gemini, ...) and exposes the unified
 * `IVideoProvider` contract.
 */
export class VideoProvider implements IVideoProvider {
    getDefaultModel (): string {
        return '';
    }
    models (): IVideoModel[] | Promise<IVideoModel[]> {
        return [];
    }
    async generate (_params: IGenerateVideoParams): Promise<unknown> {
        throw new Error('Method not implemented.');
    }
}
