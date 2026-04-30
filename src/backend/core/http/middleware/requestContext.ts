import { v4 as uuidv4 } from 'uuid';
import type { RequestHandler } from 'express';
import { runWithContext } from '../../context';
import '../expressAugmentation';

/**
 * Wraps the remaining middleware + handler chain in a per-request
 * `AsyncLocalStorage` scope.
 *
 * Install order in `PuterServer#installGlobalMiddleware`:
 *
 *     body parsers  →  authProbe  →  **requestContext**  →  routes
 *
 * Running AFTER the auth probe means `req.actor` is already populated
 * when we snapshot it into the context. Everything downstream — gates,
 * per-route parsers, controller handlers, and any services they call —
 * runs inside the ALS scope and can reach the context via
 * `Context.get('actor')`, `Context.get('req')`, etc.
 */
export const createRequestContextMiddleware = (): RequestHandler => {
    return (req, _res, next) => {
        runWithContext(
            {
                actor: req.actor,
                req,
                requestId: uuidv4(),
            },
            () => next(),
        );
    };
};
