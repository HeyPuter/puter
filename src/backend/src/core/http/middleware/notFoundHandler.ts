import type { RequestHandler } from 'express';
import { HttpError } from '../HttpError';

/**
 * Catch-all 404 middleware. Install last (just before the error handler);
 * any request that didn't match a route lands here.
 *
 * Throws an `HttpError(404)` rather than writing the response directly so
 * the same error-handler pipeline serializes the body — keeps the wire shape
 * consistent with every other failure (`{ error: '...', code: 'not_found' }`).
 */
export const createNotFoundHandler = (): RequestHandler => {
    return (_req, _res, next): void => {
        next(new HttpError(404, 'Not Found', { legacyCode: 'not_found' }));
    };
};
