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

import type {
    IVideoModel,
    IVideoProvider,
    IGenerateVideoParams,
} from '../types.js';

/**
 * Abstract base for AI video providers. Each provider wraps a single
 * upstream API (OpenAI, Together, Gemini, ...) and exposes the unified
 * `IVideoProvider` contract.
 */
export class VideoProvider implements IVideoProvider {
    getDefaultModel(): string {
        return '';
    }
    models(): IVideoModel[] | Promise<IVideoModel[]> {
        return [];
    }
    async generate(_params: IGenerateVideoParams): Promise<unknown> {
        throw new Error('Method not implemented.');
    }
}
