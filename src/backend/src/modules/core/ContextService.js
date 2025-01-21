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

const BaseService = require("../../services/BaseService");
const { Context } = require("../../util/context");

/**
 * ContextService provides a way for other services to register a hook to be
 * called when a context/subcontext is created.
 * 
 * Contexts are used to provide contextual information in the execution
 * context (dynamic scope). They can also be used to identify a "span";
 * a span is a labelled frame of execution that can be used to track
 * performance, errors, and other metrics.
 */
class ContextService extends BaseService {
    register_context_hook (event, hook) {
        Context.context_hooks_[event].push(hook);
    }
}

module.exports = {
    ContextService,
};
