// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const { AdvancedBase } = require("../../../putility");
const { Context } = require("../util/context");
const { ContextAwareFeature } = require("../traits/ContextAwareFeature");
const { OtelFeature } = require("../traits/OtelFeature");
const APIError = require("../api/APIError");
const { AssignableMethodsFeature } = require("../traits/AssignableMethodsFeature");

// CONTEXT_KEY is used to create a unique context key for operation tracing
// and is utilized throughout the OperationTraceService to manage frames.
const CONTEXT_KEY = Context.make_context_key('operation-trace');


/**
* @class OperationFrame
* @description The `OperationFrame` class represents a frame within an operation trace. It is designed to manage the state, attributes, and hierarchy of frames within an operational context. This class provides methods to set status, calculate effective status, add tags, attributes, messages, errors, children, and describe the frame. It also includes methods to recursively search through frames to find attributes and handle frame completion.
*/
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
            `frame:${this.id}`,
            { concern: 'filesystem' },
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
    /**
    * Sets the status of the frame and updates the effective status.
    * This method logs the status change and updates the parent frame's effective status if necessary.
    *
    * @param {Object} status - The new status to set.
    */
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


    /**
    * Gets the effective status of the operation frame.
    *
    * This method returns the effective status of the current operation frame,
    * considering the statuses of its children. The effective status is the
    * aggregated status of the frame and its children, reflecting the current
    * progress or state of the operation.
    *
    * @return {Object} The effective status of the operation frame.
    */
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


    /**
    * Recursively traverses the frame hierarchy to find the root frame.
    *
    * @returns {OperationFrame} The root frame of the current frame hierarchy.
    */
    get_root_frame () {
        let frame = this;
        while ( frame.parent ) {
            frame = frame.parent;
        }
        return frame;
    }


    /**
    * Marks the operation frame as done.
    * This method sets the status of the operation frame to 'done' and updates
    * the effective status accordingly. It triggers a recalculation of the
    * effective status for parent frames if necessary.
    */
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


        /**
        * Recursively builds a string representation of the frame and its children.
        *
        * @param {boolean} show_tree - If true, includes the tree structure of child frames.
        * @param {OperationFrame} highlight_frame - The frame to highlight in the output.
        * @returns {string} - A string representation of the frame and its children.
        */
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


/**
* @class OperationTraceService
* @classdesc The OperationTraceService class manages operation frames and their statuses.
* It provides methods to add frames, track their progress, and handle their completion.
* This service is essential for monitoring and logging the lifecycle of operations within the system.
*/
class OperationTraceService {
    static CONCERN = 'filesystem';

    constructor ({ services }) {
        this.log = services.get('log-service').create('operation-trace', {
            concern: this.constructor.CONCERN,
        });

        // TODO: replace with kv.js set
        this.ongoing = {};
    }


    /**
    * Adds a new operation frame to the trace.
    *
    * This method creates a new frame with the given label and context,
    * and adds it to the ongoing operations. If a context is provided,
    * it logs the context description. The frame is then added to the
    * parent frame if one exists, and the frame's description is logged.
    *
    * @param {string} label - The label for the new operation frame.
    * @param {?Object} [x] - The context for the operation frame.
    * @returns {OperationFrame} The new operation frame.
    */
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


/**
* @class BaseOperation
* @extends AdvancedBase
* @description The BaseOperation class extends AdvancedBase and serves as the foundation for
* operations within the system. It integrates various features such as context awareness,
* observability through OpenTelemetry (OtelFeature), and assignable methods. This class is
* designed to be extended by specific operation classes to provide a common structure and
* functionality for running and tracing operations.
*/
class BaseOperation extends AdvancedBase {
    static FEATURES = [
        new ContextAwareFeature(),
        new OtelFeature(['run']),
        new AssignableMethodsFeature(),
    ]


    /**
    * Executes the operation with the provided values.
    *
    * This method initiates an operation frame within the context, sets the operation status to working,
    * executes the `_run` method, and handles post-run logic. It also manages the status of child frames
    * and handles errors, updating the frame's attributes accordingly.
    *
    * @param {Object} values - The values to be used in the operation.
    * @returns {Promise<*>} - The result of the operation.
    * @throws {Error} - If the frame is missing or any other error occurs during the operation.
    */
    async run (values) {
        this.values = values;

        values.user = values.user ??
            (values.actor ? values.actor.type.user : undefined);

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
            this.constructor.name, {
                operation: frame.id,
                ...(this.constructor.CONCERN ? {
                    concern: this.constructor.CONCERN,
                } : {})
            });

        // Run operation in new context
        try {
            // Actual delegate call (this._run) with context and checkpoints
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


    /**
     * Actions to perform after running.
     * 
     * If child operation frames think they're still pending, mark them as stuck;
     * all child frames at least reach working state before the parent operation
     * completes. 
     */
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
