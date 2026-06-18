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
 * Optional ClickHouse client.
 *
 * ClickHouse is NOT a hard dependency. Core Puter runs without it — the app
 * stats read path (open / unique-user counts) falls back to the primary SQL
 * database. `this.clients.clickhouse` is therefore typed as optional and is
 * `undefined` in default and self-hosted setups; callers MUST branch on its
 * presence and fall back to SQL.
 *
 * A production deployment can register a real ClickHouse client via an
 * extension (`extension.registerClient('clickhouse', client)`) to offload the
 * analytics queries off the primary database and keep the stats path fast at
 * scale. When registered, the instance flows into `this.clients.clickhouse`
 * everywhere it's typed.
 *
 * Only the surface the stats path actually consumes is declared here. Extend
 * this interface (don't widen to `any`) when a new query shape is needed.
 */
export interface ClickhouseQueryResult {
    json<T = Record<string, unknown>>(): Promise<T[]>;
}

export interface ClickhouseQueryParams {
    query: string;
    query_params?: Record<string, unknown>;
    format?: string;
}

export interface ClickhouseClient {
    query(params: ClickhouseQueryParams): Promise<ClickhouseQueryResult>;
}
