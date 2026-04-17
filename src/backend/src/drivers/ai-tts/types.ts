/**
 * Types for the `puter-tts` driver interface.
 */

export interface ITTSVoice {
    id: string;
    name: string;
    language?: {
        name: string;
        code: string;
    };
    description?: string;
    category?: string;
    provider: string;
    labels?: Record<string, string>;
    supported_models?: string[];
    supported_engines?: string[];
}

export interface ITTSEngine {
    id: string;
    name: string;
    provider: string;
    pricing_per_million_chars?: number;
}

export interface ISynthesizeArgs {
    text: string;
    voice?: string;
    model?: string;
    response_format?: string;
    output_format?: string;
    instructions?: string;
    ssml?: string;
    language?: string;
    engine?: string;
    voice_settings?: Record<string, unknown>;
    voiceSettings?: Record<string, unknown>;
    test_mode?: boolean;
    provider?: string;
}

export interface ITTSProvider {
    readonly providerName: string;

    /** List voices available from this provider. */
    listVoices (args?: Record<string, unknown>): Promise<ITTSVoice[]>;

    /** List engines/models available from this provider. */
    listEngines (): Promise<ITTSEngine[]>;

    /** Synthesize speech from text. Returns a DriverStreamResult. */
    synthesize (args: ISynthesizeArgs): Promise<unknown>;
}
