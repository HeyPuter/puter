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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const { Context } = require("../util/context");
const { ContextAwareTrait } = require("../traits/ContextAwareTrait");
const { OtelTrait } = require("../traits/OtelTrait");
const APIError = require("../api/APIError");
const { AssignableMethodsTrait } = require("../traits/AssignableMethodsTrait");

const CONTEXT_KEY = Context.make_context_key('operation-trace');

class OperationFrame {
    constructor ({ parent, label, x }) {
        this.parent = parent;
        this.label = label;
        this.tags = [];
        this.attributes = {};
        this.messages = [];
        this.error_ = null;
        this.children = [];
        this.status_ = this.constructor.FRAME_STATUS_PENDING;
        this.effective_status_ = this.status_;
        this.id = require('uuid').v4();

        this.log = (x ?? Context).get('services').get('log-service').create(
            `frame:${this.id}`
        );
    }

    static FRAME_STATUS_PENDING = { label: 'pending' };
    static FRAME_STATUS_WORKING = { label: 'working', };
    static FRAME_STATUS_STUCK = { label: 'stuck' };
    static FRAME_STATUS_READY = { label: 'ready' };
    static FRAME_STATUS_DONE = { label: 'done' };

    set status (status) {
        this.status_ = status;
        this._calc_effective_status();

        this.log.info(
            `FRAME STATUS ${status.label} ` +
            (status !== this.effective_status_
                ? `(effective: ${this.effective_status_.label}) `
                : ''),
            {
                tags: this.tags,
                ...this.attributes,
            }
        );

        if ( this.parent ) {
            this.parent._calc_effective_status();
        }
    }
    _calc_effective_status () {
        for ( const child of this.children ) {
            if ( child.status === OperationFrame.FRAME_STATUS_STUCK ) {
                this.effective_status_ = OperationFrame.FRAME_STATUS_STUCK;
                return;
            }
        }

        if ( this.status_ === OperationFrame.FRAME_STATUS_DONE ) {
            for ( const child of this.children ) {
                if ( child.status !== OperationFrame.FRAME_STATUS_DONE ) {
                    this.effective_status_ = OperationFrame.FRAME_STATUS_READY;
                    return;
                }
            }
        }

        this.effective_status_ = this.status_;
        if ( this.parent ) {
            this.parent._calc_effective_status();
        }

        // TODO: operation trace service should hook a listener instead
        if ( this.effective_status_ === OperationFrame.FRAME_STATUS_DONE ) {
            const svc_operationTrace = Context.get('services').get('operationTrace');
            delete svc_operationTrace.ongoing[this.id];
        }
    }

    get status () {
        return this.effective_status_;
    }

    tag (...tags) {
        this.tags.push(...tags);
        return this;
    }

    attr (key, value) {
        this.attributes[key] = value;
        return this;
    }

    // recursively go through frames to find the attribute
    get_attr (key) {
        if ( this.attributes[key] ) return this.attributes[key];
        if ( this.parent ) return this.parent.get_attr(key);
    }

    log (message) {
        this.messages.push(message);
        return this;
    }

    error (err) {
        this.error_ = err;
        return this;
    }

    push_child (frame) {
        this.children.push(frame);
        return this;
    }

    get_root_frame () {
        let frame = this;
        while ( frame.parent ) {
            frame = frame.parent;
        }
        return frame;
    }

    done () {
        this.status = OperationFrame.FRAME_STATUS_DONE;
    }

    describe (show_tree, highlight_frame) {
        let s = this.label + ` (${this.children.length})`;
        if ( this.tags.length ) {
            s += ' ' + this.tags.join(' ');
        }
        if ( this.attributes ) {
            s += ' ' + JSON.stringify(this.attributes);
        }

        if ( this.children.length == 0 ) return s;

        // It's ASCII box drawing time!
        const prefix_child = '├─';
        const prefix_last = '└─';
        const prefix_deep = '│ ';
        const prefix_deep_end = '  ';

        const recurse = (frame, prefix) => {
            const children = frame.children;
            for ( let i = 0; i < children.length; i++ ) {
                const child = children[i];
                const is_last = i == children.length - 1;
                if ( child === highlight_frame ) s += `\x1B[36;1m`;
                s += '\n' + prefix + (is_last ? prefix_last : prefix_child) + child.describe();
                if ( child === highlight_frame ) s += `\x1B[0m`;
                recurse(child, prefix + (is_last ? prefix_deep_end : prefix_deep));
            }
        }

        if ( show_tree ) recurse(this, '');
        return s;
    }
}

class OperationTraceService {
    constructor ({ services }) {
        this.log = services.get('log-service').create('operation-trace');

        // TODO: replace with kv.js set
        this.ongoing = {};
    }

    async add_frame (label) {
        return this.add_frame_sync(label);
    }

    add_frame_sync (label, x) {
        if ( x ) {
            this.log.noticeme(
                'add_frame_sync() called with explicit context: ' +
                x.describe()
            );
        }
        let parent = (x ?? Context).get(this.ckey('frame'));
        const frame = new OperationFrame({
            parent: parent || null,
            label,
            x
        });
        parent && parent.push_child(frame);
        this.log.info(`FRAME START ` + frame.describe());
        if ( ! parent ) {
            // NOTE: only uncomment in local testing for now;
            //   this will cause a memory leak until frame
            //   done-ness is accurate
            this.ongoing[frame.id] = frame;
        }
        return frame;
    }

    ckey (key) {
        return CONTEXT_KEY + ':' + key;
    }
}

class BaseOperation extends AdvancedBase {
    static TRAITS = [
        new ContextAwareTrait(),
        new OtelTrait(['run']),
        new AssignableMethodsTrait(),
    ]

    async run (values) {
        this.values = values;

        // getting context with a new operation frame
        let x, frame; {
            x = Context.get();
            const operationTraceSvc = x.get('services').get('operationTrace');
            frame = await operationTraceSvc.add_frame(this.constructor.name);
            x = x.sub({ [operationTraceSvc.ckey('frame')]: frame });
        }

        // the frame will be an explicit property as well as being in context
        // (for convenience)
        this.frame = frame;

        // let's make the logger for it too
        this.log = x.get('services').get('log-service').create(
            this.constructor.name, { operation: frame.id });

        // Run operation in new context
        try {
            return await x.arun(async () => {
                const x = Context.get();
                const operationTraceSvc = x.get('services').get('operationTrace');
                const frame = x.get(operationTraceSvc.ckey('frame'));
                if ( ! frame ) {
                    throw new Error('missing frame');
                }
                frame.status = OperationFrame.FRAME_STATUS_WORKING;
                this.checkpoint('._run()');
                const res = await this._run();
                this.checkpoint('._post_run()');
                const { any_async } = this._post_run();
                this.checkpoint('delegate .run_() returned');
                frame.status = any_async
                    ? OperationFrame.FRAME_STATUS_READY
                    : OperationFrame.FRAME_STATUS_DONE;
                return res;
            });
        } catch (e) {
            if ( e instanceof APIError ) {
                frame.attr('api-error', e.toString());
            } else {
                frame.error(e);
            }
            throw e;
        }
    }

    checkpoint (name) {
        this.frame.checkpoint = name;
    }

    field (key, value) {
        this.frame.attributes[key] = value;
    }

    _post_run () {
        let any_async = false;
        for ( const child of this.frame.children ) {
            if ( child.status === OperationFrame.FRAME_STATUS_PENDING ) {
                child.status = OperationFrame.FRAME_STATUS_STUCK;
            }

            if ( child.status === OperationFrame.FRAME_STATUS_WORKING ) {
                child.async = true;
                any_async = true;
            }
        }
        return { any_async };
    }
}

module.exports = {
    CONTEXT_KEY,
    OperationTraceService,
    BaseOperation,
    OperationFrame,
};
