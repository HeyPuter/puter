export interface IImageModel {
    id: string;
    name: string;
    puterId?: string;
    provider?: string;
    aliases?: string[];
    description?: string;
    version?: string;
    costs_currency: string;
    index_cost_key?: string;
    index_input_cost_key?: string;
    costs: Record<string, number>;
    allowedQualityLevels?: string[];
    allowedRatios?: { w: number, h: number }[];
}

export interface IGenerateParams {
    prompt: string,
    ratio: { w: number, h: number }
    model: string,
    provider?: string,
    test_mode?: boolean
    quality?: string,
    input_image?: string,
    input_image_mime_type?: string,
    input_images?: string[],
};
export interface IImageProvider {

    generate (params: IGenerateParams): Promise<string>;
    models (): Promise<IImageModel[]> | IImageModel[];
    getDefaultModel (): string;

}
