import { Uploadable } from 'openai';
import { TypedValue } from '../../../drivers/meta/Runtime.js';

export interface IVideoModel {
    id: string;
    name: string;
    version: string;
    description?: string;
    costs_currency: string;
    index_cost_key?: string;
    costs: Record<string, number>;
    allowedDurationsSeconds?: number[];
    allowedResolutions?: string[];
    defaultUsageKey?: string;
    aliases?: string[];
    provider?: string;
}

export interface IVideoGenerateParams {
    prompt: string;
    model: string;
    provider?: string;
    test_mode?: boolean;
    duration?: number | string;
    seconds?: number | string;
    size?: string;
    resolution?: string;
    input_reference?: Uploadable;
    [key: string]: unknown;
}

export type IVideoGenerationResult = TypedValue;

export interface IVideoProvider {
    generate (params: IVideoGenerateParams): Promise<IVideoGenerationResult>;
    models (): Promise<IVideoModel[]> | IVideoModel[];
    getDefaultModel (): string;
}
