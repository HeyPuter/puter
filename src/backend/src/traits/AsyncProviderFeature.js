/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
class AsyncProviderFeature {
    install_in_instance (instance) {
        instance.valueListeners_ = {};
        instance.valueFactories_ = {};
        instance.values_ = {};
        instance.rejections_ = {};

        instance.provideValue = AsyncProviderFeature.prototype.provideValue;
        instance.rejectValue = AsyncProviderFeature.prototype.rejectValue;
        instance.awaitValue = AsyncProviderFeature.prototype.awaitValue;
        instance.onValue = AsyncProviderFeature.prototype.onValue;
        instance.setFactory = AsyncProviderFeature.prototype.setFactory;
    }

    provideValue (key, value) {
        this.values_[key] = value;

        let listeners = this.valueListeners_[key];
        if ( ! listeners ) return;

        delete this.valueListeners_[key];

        for ( let listener of listeners ) {
            if ( Array.isArray(listener) ) listener = listener[0];
            listener(value);
        }
    }

    rejectValue (key, err) {
        this.rejections_[key] = err;

        let listeners = this.valueListeners_[key];
        if ( ! listeners ) return;

        delete this.valueListeners_[key];

        for ( let listener of listeners ) {
            if ( ! Array.isArray(listener) ) continue;
            if ( ! listener[1] ) continue;
            listener = listener[1];

            listener(err);
        }
    }

    awaitValue (key) {
        return new Promise ((rslv, rjct) => {
            this.onValue(key, rslv, rjct);
        });
    }

    onValue (key, fn, rjct) {
        if ( this.values_[key] ) {
            fn(this.values_[key]);
            return;
        }

        if ( this.rejections_[key] ) {
            if ( rjct ) {
                rjct(this.rejections_[key]);
            } else throw this.rejections_[key];
            return;
        }

        if ( ! this.valueListeners_[key] ) {
            this.valueListeners_[key] = [];
        }
        this.valueListeners_[key].push([fn, rjct]);

        if ( this.valueFactories_[key] ) {
            const fn = this.valueFactories_[key];
            delete this.valueFactories_[key];
            (async () => {
                try {
                    const value = await fn();
                    this.provideValue(key, value);
                } catch (e) {
                    this.rejectValue(key, e);
                }
            })();
        }
    }

    async setFactory (key, factoryFn) {
        if ( this.valueListeners_[key] ) {
            let v;
            try {
                v = await factoryFn();
            } catch (e) {
                this.rejectValue(key, e);
            }
            this.provideValue(key, v);
            return;
        }

        this.valueFactories_[key] = factoryFn;
    }
}

module.exports = {
    AsyncProviderFeature,
};