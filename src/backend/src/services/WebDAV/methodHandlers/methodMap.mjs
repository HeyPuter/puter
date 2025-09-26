import { COPY } from './COPY.mjs';
import { DELETE } from './DELETE.mjs';
import { HEAD_GET } from './HEAD_GET.mjs';
import { LOCK } from './LOCK.mjs';
import { MKCOL } from './MKCOL.mjs';
import { MOVE } from './MOVE.mjs';
import { OPTIONS } from './OPTIONS.mjs';
import { PROPFIND } from './PROPFIND.mjs';
import { PROPPATCH } from './PROPPATCH.mjs';
import { PUT } from './PUT.mjs';
import { UNLOCK } from './UNLOCK.mjs';

/**
 * Map of HTTP methods to their corresponding handler functions.
 * @type {Record<string, import('./method.mjs').HandlerFunction>}
 */
export const davMethodMap = {
    HEAD: HEAD_GET,
    GET: HEAD_GET,
    LOCK,
    UNLOCK,
    COPY,
    MOVE,
    DELETE,
    PROPFIND,
    PUT,
    MKCOL,
    PROPPATCH,
    OPTIONS,
};
