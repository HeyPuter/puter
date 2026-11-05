import { PuterJSError } from '../../../lib/PuterJSError.js';

// A driver failure arrives flat or nested under `error`.
export const toDriverError = (error) => {
    const nested = /** @type {{ error?: unknown } | null} */ (error)?.error;
    if (nested && typeof nested === 'object') return PuterJSError.from(nested);
    return PuterJSError.from(error);
};
