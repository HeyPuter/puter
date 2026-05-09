// NOT ALL OF THEM, ADD OLD ONES AS NEEDED, IF NEEDED. DO NOT ADD NEW ONES THOUGH.
export type LegacyErrorCodes =
    | 'unknown_error'
    | 'disallowed_value'
    | 'invalid_token'
    | 'item_with_same_name_exists'
    | 'cannot_move_directory_into_itself'
    | 'cannot_copy_directory_into_itself'
    | 'directory_depth_limit_exceeded'
    | 'cannot_move_to_root'
    | 'cannot_copy_to_root'
    | 'cannot_write_to_root'
    | 'cannot_overwrite_a_directory'
    | 'cannot_read_a_directory'
    | 'source_and_dest_are_the_same'
    | 'dest_is_not_a_directory'
    | 'dest_does_not_exist'
    | 'source_does_not_exist'
    | 'subject_does_not_exist'
    | 'shortcut_target_not_found'
    | 'shortcut_target_is_a_directory'
    | 'shortcut_target_is_a_file'
    | 'forbidden'
    | 'storage_limit_reached'
    | 'internal_error'
    | 'response_timeout'
    | 'app_name_already_in_use'
    | 'app_index_url_already_in_use'
    | 'subdomain_limit_reached'
    | 'subdomain_reserved'
    | 'subdomain_not_owned'
    | 'email_already_in_use'
    | 'email_not_allowed'
    | 'username_already_in_use'
    | 'too_many_username_changes'
    | 'token_invalid'
    | 'insufficient_funds'
    | 'token_missing'
    | 'token_auth_failed'
    | 'token_expired'
    | 'permission_denied'
    | 'account_suspended'
    | 'bad_request'
    | 'not_found'
    | 'conflict'
    | 'unauthorized'
    | 'too_many_requests'
    | 'oidc_revalidation_required'
    | 'user_tokens_only'
    | 'session_required'
    | 'temporary_accounts_not_allowed'
    | 'password_required'
    | 'password_mismatch'
    | 'field_not_allowed_for_create';

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
 * Options accepted by `HttpError`. All optional.
 */
export interface HttpErrorOptions {
    /** Underlying error. Set as the standard `Error.cause`. */
    cause?: unknown;
    /**
     * Stable wire-format error code that legacy clients key on (e.g.
     * `item_with_same_name_exists`, `forbidden`, `subject_does_not_exist`).
     * Serialized as `code` in the response body for back-compat.
     */
    legacyCode?: LegacyErrorCodes | (string & {});
    /**
     * Modern, structured error code. If both `legacyCode` and `code` are set,
     * the legacy one takes the `code` slot in the response body and `code`
     * is emitted as `errorCode`, so clients keying on either field find
     * what they expect.
     */
    code?: string;
    /** Additional fields merged into the response body. */
    fields?: Record<string, unknown>;
}

/**
 * The single error type controllers and services throw to surface an HTTP
 * failure. The terminal `errorHandler` middleware catches it, serializes a
 * JSON body, and sets the response status.
 *
 * Usage:
 * ```ts
 * throw new HttpError(404, 'Item not found');
 * throw new HttpError(409, 'Cannot overwrite directory', { legacyCode: 'is_directory' });
 * throw new HttpError(403, 'Forbidden', { legacyCode: 'forbidden', fields: { target } });
 * ```
 *
 * Express 5 forwards thrown errors (sync and async) to error-handling
 * middleware automatically — no `next(err)` ceremony required.
 */
export class HttpError extends Error {
    readonly statusCode: number;
    readonly legacyCode?: LegacyErrorCodes | (string & {});
    readonly code?: string;
    readonly fields?: Record<string, unknown>;

    constructor(
        statusCode: number,
        message: string,
        options: HttpErrorOptions = {},
    ) {
        super(
            message,
            options.cause !== undefined ? { cause: options.cause } : undefined,
        );
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.legacyCode = options.legacyCode;
        this.code = options.code;
        this.fields = options.fields;
    }
}

/**
 * Type guard that survives module-graph duplication (defensive — cross-realm
 * `instanceof` can be unreliable in test setups). Pure runtime convenience;
 * normal callers can use `instanceof HttpError`.
 */
export const isHttpError = (e: unknown): e is HttpError => {
    if (e instanceof HttpError) return true;
    return Boolean(
        e &&
        typeof e === 'object' &&
        (e as { name?: unknown }).name === 'HttpError' &&
        typeof (e as { statusCode?: unknown }).statusCode === 'number',
    );
};
