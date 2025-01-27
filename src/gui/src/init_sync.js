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
/**
 * @global
 * @function logger
 * @param {Array<any>} a - The arguments.
 */
/**
 * @global
 * @function use
 * @param {string} arg - The string argument.
 * @returns {any} The return value.
 */
/**
 * @global
 * @function def
 * @param {any} arg - The argument.
 * @returns {any} The return value.
 */

// An initial logger to log do before we get a more fancy logger
// (which we never really do yet, at the time of writing this);
// something like this was also done in backend and it proved useful.
(scope => {
    globalThis.logger = {
        info: (...a) => {},
        // info: (...a) => console.log('%c[INIT/INFO]', 'color: #4287f5', ...a),
    };
})(globalThis);
logger.info('start -> blocking initialization');

// A global promise (like TeePromise, except we can't import anything yet)
// that will be resolved by `init_async.js` when it completes.
(scope => {
    scope.init_promise = (() => {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        promise.resolve = resolve;
        promise.reject = reject;
        return promise;
    })();
})(globalThis);

// This is where `use()` and `def()` are defined.
//
// A global registry for class definitions. This allows us to expose
// classes to service scripts even when the frontend code is bundled.
// Additionally, it allows us to create hooks upon class registration,
// which we use to turn classes which extend HTMLElement into components
// (i.e. give them tag names because that is required).
//
// It's worth noting `use()` and `def()` for service scripts is exposed
// in initgui.js, in the `launch_services()` function. (at the time this
// comment was written)
(scope => {
    const registry_ = {
        classes_m: {},
        classes_l: [],
        hooks_on_register: [],
    };

    const on_self_registered_api = {
        on_other_registered: hook => registry_.hooks_on_register.push(hook),
    }

    scope.lib = {
        is_subclass (subclass, superclass) {
            if (subclass === superclass) return true;

            let proto = subclass.prototype;
            while (proto) {
                if (proto === superclass.prototype) return true;
                proto = Object.getPrototypeOf(proto);
            }

            return false;
        }
    };

    scope.def = (cls, id) => {
        id = id || cls.ID;
        if ( id === undefined ) {
            throw new Error('Class must have an ID');
        }

        if ( registry_.classes_m[id] ) {
            // throw new Error(`Class with ID ${id} already registered`);
            return;
        }

        registry_.classes_m[id] = cls;
        registry_.classes_l.push(cls);

        registry_.hooks_on_register.forEach(hook => hook({ cls }));

        // Find class that owns 'on_self_registered' hook
        let owner = cls;
        while (
            owner.__proto__ && owner.__proto__.on_self_registered
            && owner.__proto__.on_self_registered === cls.on_self_registered
        ) {
            owner = owner.__proto__;
        }

        if ( cls.on_self_registered ) {
            cls.on_self_registered.call(cls, {
                ...on_self_registered_api,
                is_owner: cls === owner,
            });
        }

        return cls;
    };

    scope.use = id => {
        if ( id === undefined ) {
            return registry_.classes_m;
        }

        if ( !registry_.classes_m[id] ) {
            throw new Error(`Class with ID ${id} not registered`);
        }

        return registry_.classes_m[id];
    }
})(globalThis);

logger.info('end -> blocking initialization');