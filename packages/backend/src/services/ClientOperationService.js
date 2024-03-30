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
const { Context } = require("../util/context");

const CONTEXT_KEY = Context.make_context_key('operation-trace');
class ClientOperationTracker {
    constructor (parameters) {
        this.name = parameters.name || 'untitled';
        this.tags = parameters.tags || [];
        this.frame = parameters.frame || null;
        this.metadata = parameters.metadata || {};
        this.objects = parameters.objects || [];
    }
}

class ClientOperationService {
    constructor ({ services }) {
        this.operations_ = [];
    }

    async add_operation (parameters) {
        const tracker = new ClientOperationTracker(parameters);

        return tracker;
    }

    ckey (key) {
        return CONTEXT_KEY + ':' + key;
    }
}

module.exports = {
    ClientOperationService,
};
