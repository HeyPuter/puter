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

import type { IConfig } from '../types.js';

/** A namespace must fit the jobs and schedules tables and a Redis key segment. */
const JOBS_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const warned = new Set<string>();

/**
 * The namespace system jobs and schedules are keyed by, so deployments sharing
 * a database or Redis stay apart: `jobs.namespace`, else `domain`, else
 * `default`. One that can't be held (a domain with a port, say) falls back to
 * `default`, with one logged error per value.
 */
export const resolveJobsNamespace = (config: IConfig): string => {
    const configured = config.jobs?.namespace ?? config.domain ?? 'default';
    if (JOBS_NAMESPACE_PATTERN.test(configured)) return configured;
    if (!warned.has(configured)) {
        warned.add(configured);
        console.error(
            `[jobs] namespace "${configured}" (jobs.namespace, else domain) must match ${JOBS_NAMESPACE_PATTERN}; using "default". Set jobs.namespace to keep deployments sharing a database apart.`,
        );
    }
    return 'default';
};
