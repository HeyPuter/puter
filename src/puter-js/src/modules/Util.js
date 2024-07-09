/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
import { CallbackManager, Dehydrator, Hydrator } from "../lib/xdrpc";

/**
 * The Util module exposes utilities within puter.js itself.
 * These utilities may be used internally by other modules.
 */
export default class Util {
    constructor () {
        // This is in `puter.util.rpc` instead of `puter.rpc` because
        // `puter.rpc` is reserved for an app-to-app RPC interface.
        // This is a lower-level RPC interface used to communicate
        // with iframes.
        this.rpc = new UtilRPC();
    }
}

class UtilRPC {
    constructor () {
        this.callbackManager = new CallbackManager();
        this.callbackManager.attach_to_source(window);
    }

    getDehydrator () {
        return new Dehydrator({ callbackManager: this.callbackManager });
    }

    getHydrator ({ target }) {
        return new Hydrator({ target });
    }
}
