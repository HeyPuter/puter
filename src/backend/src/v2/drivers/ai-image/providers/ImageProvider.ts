/**
 * Base class for image generation providers.
 *
 * Concrete providers (OpenAI, Gemini, etc.) extend this and implement
 * `generate`, `models`, and `getDefaultModel`.
 */

import type { IImageProvider, IImageModel, IGenerateParams } from '../types.js';

export abstract class ImageProvider implements IImageProvider {
    abstract generate (params: IGenerateParams): Promise<string>;
    abstract models (): IImageModel[] | Promise<IImageModel[]>;
    abstract getDefaultModel (): string;
}
