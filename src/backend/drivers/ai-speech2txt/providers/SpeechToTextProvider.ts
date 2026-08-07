/*
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
 * Abstract base for speech-to-text providers. Each provider wraps a single
 * upstream API and exposes the unified `ISpeechToTextProvider` contract.
 */

import { Context } from '../../../core/context.js';
import { HttpError } from '../../../core/http/HttpError.js';
import type { Actor } from '../../../core/actor.js';
import type {
    ISpeechToTextDeps,
    ISpeechToTextModel,
    ISpeechToTextProvider,
    ITranscribeArgs,
} from '../types.js';

export abstract class SpeechToTextProvider implements ISpeechToTextProvider {
    abstract readonly providerName: string;

    constructor(protected deps: ISpeechToTextDeps) {}

    abstract listModels(): Promise<ISpeechToTextModel[]>;

    abstract transcribe(args: ITranscribeArgs): Promise<unknown>;

    /**
     * Translate to English. Providers whose upstream has no separate
     * translation endpoint override this to delegate to `transcribe`.
     */
    abstract translate(args: ITranscribeArgs): Promise<unknown>;

    getReportedCosts(): Record<string, unknown>[] {
        return [];
    }

    /** The authenticated caller, or a 401 if the request carries none. */
    protected requireActor(): Actor {
        const actor = Context.get('actor') as Actor | undefined;
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });
        return actor;
    }

    /** Reject the call unless the caller supplied audio. */
    protected requireFile(args: ITranscribeArgs): void {
        if (!args.file)
            throw new HttpError(400, '`file` is required', {
                legacyCode: 'bad_request',
            });
    }
}
