/**
 * Replaces `OMTypeError` from ES/OM implementation.
 * This might be removed or replaced in the future.
 */
export class CoercionTypeError extends Error {
    constructor ({ expected, got }) {
        const message = `expected ${expected}, got ${got}`;
        super(message);
        this.name = 'CoercionTypeError';
    }
}
