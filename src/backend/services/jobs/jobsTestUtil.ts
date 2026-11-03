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

import type { JobRunContext } from './JobScheduler.js';

/**
 * What a system job's `run` receives, for calling it directly: `saved` records
 * each `saveState`, and `abort` aborts the signal.
 */
export const testJobContext = (
    state: unknown = null,
): JobRunContext & { saved: unknown[]; abort: () => void } => {
    const controller = new AbortController();
    const saved: unknown[] = [];
    return {
        signal: controller.signal,
        state,
        saveState: async (next) => {
            saved.push(next);
        },
        saved,
        abort: () => controller.abort(),
    };
};
