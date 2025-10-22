/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

/**
 * A context object that manages hierarchical property inheritance and sub-context creation.
 * Properties are copied with their descriptors to maintain getter/setter behavior.
 */
class Context {
    /**
     * Creates a new Context instance with the provided values.
     * @param {Object} [values={}] - Initial values to set on the context, with their property descriptors preserved
     */
    constructor (values = {}) {
        const descs = Object.getOwnPropertyDescriptors(values);
        for ( const k in descs ) {
            Object.defineProperty(this, k, descs[k]);
        }
    }
    /**
     * Creates a sub-context that follows specific properties from a source object.
     * The returned context will have getters that reference the source object's properties.
     * @param {Object} source - The source object to follow properties from
     * @param {string[]} keys - Array of property names to follow from the source
     * @returns {Context} A new sub-context with getters pointing to the source properties
     */
    follow (source, keys) {
        const values = {};
        for ( const k of keys ) {
            Object.defineProperty(values, k, {
                get: () => source[k]
            });
        }
        return this.sub(values);
    }
    /**
     * Creates a sub-context that inherits from the current context with additional or overridden values.
     * Nested Context instances are recursively sub-contexted with corresponding new values.
     * @param {Object} [newValues={}] - New values to add or override in the sub-context
     * @returns {Context} A new context that inherits from this context with the new values applied
     */
    sub (newValues) {
        if ( newValues === undefined ) newValues = {};
        const sub = Object.create(this);

        const alreadyApplied = {};
        for ( const k in sub ) {
            if ( sub[k] instanceof Context ) {
                const newValuesForK =
                    newValues.hasOwnProperty(k)
                        ? newValues[k] : undefined;
                sub[k] = sub[k].sub(newValuesForK);
                alreadyApplied[k] = true;
            }
        }

        const descs = Object.getOwnPropertyDescriptors(newValues);
        for ( const k in descs ){
            if ( alreadyApplied[k] ) continue;
            Object.defineProperty(sub, k, descs[k]);
        }

        return sub;
    }
}

module.exports = {
    Context,
};
