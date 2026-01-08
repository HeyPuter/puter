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
const { AdvancedBase } = require('@heyputer/putility');
const { WeakConstructorFeature } = require('../../traits/WeakConstructorFeature');

class Predicate extends AdvancedBase {
    static FEATURES = [
        new WeakConstructorFeature(),
    ];
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

class StartsWith extends Predicate {
    async check (entity) {
        return (await entity.get(this.key)).startsWith(this.value);
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
};

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

    static write_human_readable (predicate) {
        if ( predicate instanceof Eq ) {
            return `${predicate.key}=${predicate.value}`;
        }

        if ( predicate instanceof And ) {
            const parts = predicate.children.map(child =>
                PredicateUtil.write_human_readable(child));
            return parts.join(' and ');
        }

        if ( predicate instanceof Or ) {
            const parts = predicate.children.map(child =>
                PredicateUtil.write_human_readable(child));
            return parts.join(' or ');
        }

        if ( predicate instanceof StartsWith ) {
            return `${predicate.key} starts with "${predicate.value}"`;
        }

        if ( predicate instanceof IsNotNull ) {
            return `${predicate.key} is not null`;
        }

        if ( predicate instanceof Like ) {
            return `${predicate.key} like "${predicate.value}"`;
        }

        if ( predicate instanceof Null ) {
            return '';
        }

        return String(predicate);
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
    StartsWith,
};
