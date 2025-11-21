/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

module.exports = {
    TTopics: Symbol('TTopics'),
    TDetachable: Symbol('TDetachable'),
    TLogger: Symbol('TLogger'),

    AS: (obj, trait) => {
        if ( obj.constructor && obj.constructor.IMPLEMENTS && obj.constructor.IMPLEMENTS[trait] ) {
            return obj.as(trait);
        }
        return obj;
    },
};
