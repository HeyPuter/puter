/**
 * Instead of `myObject.hasOwnProperty(k)`, always write:
 * `safeHasOwnProperty(myObject, k)`.
 *
 * This is a less verbose way to call `Object.prototype.hasOwnProperty.call`.
 * This prevents unexpected behavior when `hasOwnProperty` is overridden,
 * which is especially possible for objects parsed from user-sent JSON.
 *
 * explanation: https://eslint.org/docs/latest/rules/no-prototype-builtins
 * @param {*} o
 * @param  {...any} a
 * @returns
 */
export const safeHasOwnProperty = (o, ...a) => {
    return Object.prototype.hasOwnProperty.call(o, ...a);
};
