/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

/**
 * Base class that provides utilities for working with inheritance chains and static properties.
 */
class BasicBase {
    /**
     * Gets the inheritance chain for the current instance, starting from the most derived class
     * and working up to BasicBase (excluded).
     * @returns {Array<Function>} Array of constructor functions in inheritance order
     */
    _get_inheritance_chain () {
        const chain = [];
        let cls = this.constructor;
        while ( cls && cls !== BasicBase ) {
            chain.push(cls);
            cls = cls.__proto__;
        }
        return chain.reverse();
    }

    /**
     * Merges static array properties from all classes in the inheritance chain.
     * Avoids duplicating the same array reference from contiguous members
     * of the inheritance chain (useful when using the decorator pattern with
     * multiple classes sharing a common base)
     * @param {string} key - The name of the static property to merge
     * @returns {Array} Combined array containing all values from the inheritance chain
     */
    _get_merged_static_array (key) {
        const chain = this._get_inheritance_chain();
        const values = [];
        let last = null;
        for ( const cls of chain ) {
            if ( cls[key] && cls[key] !== last ) {
                last = cls[key];
                values.push(...cls[key]);
            }
        }
        return values;
    }

    /**
     * Merges static object properties from all classes in the inheritance chain.
     * Properties from derived classes override those from base classes.
     * @param {string} key - The name of the static property to merge
     * @returns {Object} Combined object containing all properties from the inheritance chain
     */
    _get_merged_static_object (key) {
        // TODO: check objects by reference - same object in a subclass shouldn't count
        const chain = this._get_inheritance_chain();
        const values = {};
        for ( const cls of chain ) {
            if ( cls[key] ) {
                Object.assign(values, cls[key]);
            }
        }
        return values;
    }
}

module.exports = {
    BasicBase,
};