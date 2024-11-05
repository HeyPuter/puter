module.exports = {
    TTopics: Symbol('TTopics'),
    TDetachable: Symbol('TDetachable'),
    TLogger: Symbol('TLogger'),

    AS: (obj, trait) => {
        if ( obj.constructor && obj.constructor.IMPLEMENTS && obj.constructor.IMPLEMENTS[trait] ) {
            return obj.as(trait);
        }
        return obj;
    }
};
