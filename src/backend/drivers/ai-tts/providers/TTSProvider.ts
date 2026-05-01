/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
