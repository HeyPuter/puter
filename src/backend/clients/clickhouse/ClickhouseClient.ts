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

// Optional analytics client, registered by an extension. Only the surface the
// app-stats path consumes is declared; extend it rather than widening to `any`.

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
