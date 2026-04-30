/**
 * Abstract base for TTS providers. Each provider wraps a single upstream
 * API (OpenAI, ElevenLabs, AWS Polly) and exposes the unified
 * `ITTSProvider` contract.
 */

import type { MeteringService } from '../../../services/metering/MeteringService.js';
import type {
    ITTSProvider,
    ITTSVoice,
    ITTSEngine,
    ISynthesizeArgs,
} from '../types.js';

export abstract class TTSProvider implements ITTSProvider {
    abstract readonly providerName: string;

    protected meteringService: MeteringService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected providerConfig: any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(meteringService: MeteringService, config: any) {
        this.meteringService = meteringService;
        this.providerConfig = config;
    }

    async listVoices(_args?: Record<string, unknown>): Promise<ITTSVoice[]> {
        return [];
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return [];
    }

    async synthesize(_args: ISynthesizeArgs): Promise<unknown> {
        throw new Error('Method not implemented.');
    }

    /**
     * Provider-specific cost catalogue used by the TTSDriver's aggregated
     * `getReportedCosts()`. Subclasses override to expose their per-unit
     * metering costs. Shape matches the `WithCostsReporting` contract.
     */
    getReportedCosts(): Record<string, unknown>[] {
        return [];
    }
}
