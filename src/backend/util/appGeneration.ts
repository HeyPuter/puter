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

// An origin-derived app uid comes back verbatim when its app is registered
// again, so anything keyed on the uid alone can outlive the app it was for.

/**
 * Allowed gap between a record's creation time (server clock) and its app row's
 * (possibly the database clock) before the record counts as older.
 */
export const APP_CLOCK_SKEW_SECONDS = 60;

/** An app row as read from the store, with its creation time. */
export interface AppGenerationRow {
    created_epoch?: unknown;
}

/**
 * Unix seconds before which a record tied to `app`'s uid belongs to an earlier
 * app with the same uid, or `null` when the creation time is unknown.
 */
export const appGenerationStart = (
    app: AppGenerationRow | null | undefined,
): number | null => {
    const created = Number(app?.created_epoch);
    if (!Number.isFinite(created) || created <= 0) return null;
    return created - APP_CLOCK_SKEW_SECONDS;
};

/** Whether a record made at `createdAt` (unix seconds) predates `app`. */
export const predatesApp = (
    createdAt: number,
    app: AppGenerationRow | null | undefined,
): boolean => {
    const start = appGenerationStart(app);
    return start !== null && createdAt > 0 && createdAt < start;
};
