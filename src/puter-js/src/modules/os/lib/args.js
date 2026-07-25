// Shared argument parsing for the puter.os methods. Each accepts either a
// single options object or trailing positional `success`/`error` callbacks.

/**
 * @param {unknown[]} args
 * @returns {{ success?: Function, error?: Function, query?: Record<string, string> }}
 */
export const parseCallbackOptions = (args) =>
    (typeof args[0] === 'object' && args[0] !== null)
        ? args[0]
        : { success: args[0], error: args[1] };
