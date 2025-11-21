/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

const { FeatureBase } = require('../bases/FeatureBase');
const { TDetachable } = require('../traits/traits');

// NOTE: copied from src/backend/src/util/listenerutil.js,
//       which is now deprecated.

class MultiDetachable extends FeatureBase {
    static FEATURES = [
        require('../features/TraitsFeature'),
    ];

    constructor () {
        super();
        this.delegates = [];
        this.detached_ = false;
    }

    add (delegate) {
        if ( this.detached_ ) {
            delegate.detach();
            return;
        }

        this.delegates.push(delegate);
    }

    static IMPLEMENTS = {
        [TDetachable]: {
            detach () {
                this.detached_ = true;
                for ( const delegate of this.delegates ) {
                    delegate.detach();
                }
            },
        },
    };
}

class AlsoDetachable extends FeatureBase {
    static FEATURES = [
        require('../features/TraitsFeature'),
    ];

    constructor () {
        super();
        this.also = () => {
        };
    }

    also (also) {
        this.also = also;
        return this;
    }

    static IMPLEMENTS = {
        [TDetachable]: {
            detach () {
                this.detach_();
                this.also();
            },
        },
    };
}

// TODO: this doesn't work, but I don't know why yet.
class RemoveFromArrayDetachable extends AlsoDetachable {
    constructor (array, element) {
        super();
        this.array = new WeakRef(array);
        this.element = element;
    }

    detach_ () {
        const array = this.array.deref();
        if ( ! array ) return;
        const index = array.indexOf(this.element);
        if ( index !== -1 ) {
            array.splice(index, 1);
        }
    }
}

module.exports = {
    MultiDetachable,
    RemoveFromArrayDetachable,
};
