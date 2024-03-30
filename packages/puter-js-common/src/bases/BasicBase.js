class BasicBase {
    _get_inheritance_chain () {
        const chain = [];
        let cls = this.constructor;
        while ( cls && cls !== BasicBase ) {
            chain.push(cls);
            cls = cls.__proto__;
        }
        return chain.reverse();
    }

    _get_merged_static_array (key) {
        const chain = this._get_inheritance_chain();
        const values = [];
        for ( const cls of chain ) {
            if ( cls[key] ) {
                values.push(...cls[key]);
            }
        }
        return values;
    }

    _get_merged_static_object (key) {
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