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
const { AdvancedBase } = require("@heyputer/putility");
const { WeakConstructorFeature } = require("../../traits/WeakConstructorFeature");

class Predicate extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ]
}

class Null extends Predicate {
    //
}

class And extends Predicate {
    //
}

class Or extends Predicate {
    async check (entity) {
        for ( const child of this.children ) {
            if ( await entity.check(child) ) {
                return true;
            }
        }
        return false;
    }
}

class Eq extends Predicate {
    async check (entity) {
        return (await entity.get(this.key)) == this.value;
    }
}

class IsNotNull extends Predicate {
    async check (entity) {
        return (await entity.get(this.key)) !== null;
    }
}

class Like extends Predicate {
    async check (entity) {
        // Convert SQL LIKE pattern to RegExp
        // TODO: Support escaping the pattern characters
        const regex = new RegExp(this.value.replaceAll('%', '.*').replaceAll('_', '.'), 'i');
        return regex.test(await entity.get(this.key));
    }
}

Predicate.prototype.and = function (other) {
    return new And({ children: [this, other] });
}

class PredicateUtil {
    static simplify (predicate) {
        if ( predicate instanceof And ) {
            const simplified = [];
            for ( const p of predicate.children ) {
                const s = PredicateUtil.simplify(p);
                if ( s instanceof And ) {
                    simplified.push(...s.children);
                } else if ( ! (s instanceof Null) ) {
                    simplified.push(s);
                }
            }
            if ( simplified.length === 0 ) {
                return new Null();
            }
            if ( simplified.length === 1 ) {
                return simplified[0];
            }
            return new And({ children: simplified });
        }

        if ( predicate instanceof Or ) {
            const simplified = [];
            for ( const p of predicate.children ) {
                const s = PredicateUtil.simplify(p);
                if ( s instanceof Or ) {
                    simplified.push(...s.children);
                } else if ( ! (s instanceof Null) ) {
                    simplified.push(s);
                }
            }
            if ( simplified.length === 0 ) {
                return new Null();
            }
            if ( simplified.length === 1 ) {
                return simplified[0];
            }
            return new Or({ children: simplified });
        }

        return predicate;
    }
}

module.exports = {
    Predicate,
    PredicateUtil,
    Null,
    And,
    Or,
    Eq,
    IsNotNull,
    Like,
};
