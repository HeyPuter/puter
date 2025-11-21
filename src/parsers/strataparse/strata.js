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
export class DelegatingPStratumImplAPI {
    constructor (facade) {
        this.facade = facade;
    }
    get delegate () {
        return this.facade.delegate;
    }
}

export class DelegatingPStratumImplType {
    constructor (facade) {
        this.facade = facade;
    }
    getImplAPI () {
        return new DelegatingPStratumImplAPI(this.facade);
    }
}

export class TerminalPStratumImplType {
    getImplAPI () {
        return {};
    }
}

export class PStratum {
    constructor (impl) {
        this.impl = impl;

        const implTypeClass = this.impl.constructor.TYPE
            ?? DelegatingPStratumImplType;

        this.implType = new implTypeClass(this);
        this.api = this.implType.getImplAPI();

        this.lookValue = null;
        this.seqNo = 0;

        this.history = [];
        // TODO: make this configurable
        this.historyOn = !this.impl.reach;
    }

    setDelegate (delegate) {
        this.delegate = delegate;
    }

    look () {
        if ( this.looking ) {
            return this.lookValue;
        }
        this.looking = true;
        this.lookValue = this.impl.next(this.api);
        return this.lookValue;
    }

    next () {
        this.seqNo++;
        let toReturn;
        if ( this.looking ) {
            this.looking = false;
            toReturn = this.lookValue;
        } else {
            toReturn = this.impl.next(this.api);
        }
        this.history.push(toReturn.value);
        return toReturn;
    }

    fork () {
        const forkImpl = this.impl.fork(this.api);
        const fork = new PStratum(forkImpl);
        // DRY: sync state
        fork.looking = this.looking;
        fork.lookValue = this.lookValue;
        fork.seqNo = this.seqNo;
        fork.history = [...this.history];
        return fork;
    }

    join (friend) {
        // DRY: sync state
        this.looking = friend.looking;
        this.lookValue = friend.lookValue;
        this.seqNo = friend.seqNo;
        this.history = friend.history;
        this.impl.join(this.api, friend.impl);
    }

    reach (start, end) {
        if ( this.impl.reach ) {
            return this.impl.reach(this.api, start, end);
        }
        if ( this.historyOn ) {
            return this.history.slice(start, end);
        }
    }
}
