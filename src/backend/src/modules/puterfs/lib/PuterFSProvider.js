const putility = require('@heyputer/putility');
const { MultiDetachable } = putility.libs.listener;
const { TDetachable } = putility.traits;

const { NodeInternalIDSelector, NodeChildSelector, NodeUIDSelector, RootNodeSelector, NodePathSelector } = require("../../../filesystem/node/selectors");
const { Context } = require("../../../util/context");
const fsCapabilities = require('../../../filesystem/definitions/capabilities');

class PuterFSProvider {
    get_capabilities () {
        return new Set([
            fsCapabilities.THUMBNAIL,
            fsCapabilities.UUID,
            fsCapabilities.OPERATION_TRACE,
            fsCapabilities.READDIR_UUID_MODE,

            fsCapabilities.READ,
            fsCapabilities.WRITE,
            fsCapabilities.CASE_SENSITIVE,
            fsCapabilities.SYMLINK,
            fsCapabilities.TRASH,
        ]);
    }

    async stat ({
        selector,
        options,
        controls,
        node,
    }) {
        // For Puter FS nodes, we assume we will obtain all properties from
        // fsEntryService/fsEntryFetcher, except for 'thumbnail' unless it's
        // explicitly requested.

        const {
            traceService,
            fsEntryService,
            fsEntryFetcher,
            resourceService,
        } = Context.get('services').values;

        if ( options.tracer == null ) {
            options.tracer = traceService.tracer;
        }

        if ( options.op ) {
            options.trace_options = {
                parent: options.op.span,
            };
        }

        let entry;

        await new Promise (rslv => {
            const detachables = new MultiDetachable();

            const callback = (resolver) => {
                detachables.as(TDetachable).detach();
                rslv();
            }

            // either the resource is free
            {
                // no detachale because waitForResource returns a
                // Promise that will be resolved when the resource
                // is free no matter what, and then it will be
                // garbage collected.
                resourceService.waitForResource(
                    selector
                ).then(callback.bind(null, 'resourceService'));
            }

            // or pending information about the resource
            // becomes available
            {
                // detachable is needed here because waitForEntry keeps
                // a map of listeners in memory, and this event may
                // never occur. If this never occurs, waitForResource
                // is guaranteed to resolve eventually, and then this
                // detachable will be detached by `callback` so the
                // listener can be garbage collected.
                const det = fsEntryService.waitForEntry(
                    node, callback.bind(null, 'fsEntryService'));
                if ( det ) detachables.add(det);
            }
        });

        if ( resourceService.getResourceInfo(this.uid) ) {
            entry = await fsEntryService.get(this.uid, options);
            controls.log.debug('got an entry from the future');
        } else {
            entry = await fsEntryFetcher.find(
                selector, options);
        }

        if ( ! entry ) {
            controls.log.info(`entry not found: ${selector.describe(true)}`);
        }

        if ( entry === null || typeof entry !== 'object' ) {
            return null;
        }

        if ( entry.id ) {
            controls.provide_selector(
                new NodeInternalIDSelector('mysql', entry.id, {
                    source: 'FSNodeContext optimization'
                })
            );
        }

        return entry;
    }

    async readdir ({ context, node }) {
        const uuid = await node.get('uid');
        const services = context.get('services');
        const svc_fsentry = services.get('fsEntryService');
        const child_uuids = await svc_fsentry
            .fast_get_direct_descendants(uuid);
        return child_uuids;
    }
}

module.exports = {
    PuterFSProvider,
};
