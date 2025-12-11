export interface IImageModel {
    id: string;
    name: string;
    description?: string;
    version?: string;
    costs_currency: string;
    index_cost_key?: string;
    costs: Record<string, number>;
    allowedQualityLevels?: string[];
    allowedRatios?: { w: number, h: number }[];
    provider?: string;
    aliases?: string[];
}

export interface IGenerateParams {
    prompt: string,
    ratio: { w: number, h: number }
    model: string,
    provider?: string,
    test_mode?: boolean
    quality?: string,
};
export interface IImageProvider {

    generate (params: IGenerateParams): Promise<string>;
    models (): Promise<IImageModel[]> | IImageModel[];
    getDefaultModel (): string;

}