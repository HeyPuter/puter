'use strict';

const grpc = require('@grpc/grpc-js');
const path = require('path');

// gRPC generated code
const genDir = path.join(__dirname, '../../../../../fs_tree_manager/js');
const {
    FSTreeManagerClient,
} = require(path.join(genDir, 'fs_tree_manager_grpc_pb.js'));
const {
    FSEntry,
    NewFSEntryRequest,
    RemoveFSEntryRequest,
    PurgeReplicaRequest,
    PullRequest,
    PullRequestItem,
    FetchReplicaRequest,
} = require(path.join(genDir, 'fs_tree_manager_pb.js'));

// protobuf built-in types
const { Struct } = require('google-protobuf/google/protobuf/struct_pb.js');

const config = require('../../../config');
const fsTreeManagerUrl = config.services?.['client-replica']?.fs_tree_manager_url;

// Create gRPC client
const client = new FSTreeManagerClient(fsTreeManagerUrl, grpc.credentials.createInsecure(), {
    // Reconnect backoff (defaults can be slow: ~20s→120s)
    //
    // ref:
    // - https://grpc.github.io/grpc/core/group__grpc__arg__keys.html
    // - https://github.com/grpc/grpc/blob/master/doc/connection-backoff.md
    'grpc.initial_reconnect_backoff_ms': 500,
    'grpc.min_reconnect_backoff_ms': 500,
    'grpc.max_reconnect_backoff_ms': 5000,

    // // Keepalive so dead TCPs are detected quickly
    // 'grpc.keepalive_time_ms': 15000,           // send PING every 15s
    // 'grpc.keepalive_timeout_ms': 5000,         // wait 5s for PING ack
    // 'grpc.keepalive_permit_without_calls': 1,  // allow pings when idle

    // // (Optional) be polite about PING cadence
    // 'grpc.http2.min_time_between_pings_ms': 10000,
});

/**
 * Sends a new filesystem entry to the gRPC service
 * @param {number} userId - The user ID for the request
 * @param {Object} metadata - The metadata for the FSEntry
 * @returns {Promise<void>} - Resolves when the entry is sent successfully
 * @throws {Error} - If the gRPC call fails
 */
async function sendFSNew(userId, metadata) {
    return new Promise((resolve, reject) => {
        if ( !userId ) {
            reject(new Error('User ID is required'));
            return;
        }
        if ( !metadata ) {
            reject(new Error('Metadata is required'));
            return;
        }

        const fsEntry = buildFsEntry(metadata);
        const request = new NewFSEntryRequest();
        request.setUserId(userId);
        request.setFsEntry(fsEntry);

        client.newFSEntry(request, (err, _response) => {
            if ( err ) {
                reject(new Error(`[xiaochen-error] Failed to send fs new entry: ${err.message}`));
                return;
            }
            // console.log(`[xiaochen-log] sendFSNew: ${userId}, ${metadata.path}`);
            resolve();
        });
    });
}

/**
 * Sends a remove filesystem entry to the gRPC service
 * @param {number} userId - The user ID for the request
 * @param {string} uuid - The UUID of the FSEntry to remove
 * @returns {Promise<void>} - Resolves when the entry is sent successfully
 * @throws {Error} - If the gRPC call fails
 */
async function sendFSRemove(userId, uuid) {
    return new Promise((resolve, reject) => {
        if ( !userId ) {
            reject(new Error('User ID is required'));
            return;
        }
        if ( !uuid ) {
            reject(new Error('UUID is required'));
            return;
        }

        const request = new RemoveFSEntryRequest();
        request.setUserId(userId);
        request.setUuid(uuid);

        client.removeFSEntry(request, (err, _response) => {
            if ( err ) {
                reject(new Error(`[xiaochen-error] Failed to send fs remove entry: ${err.message}`));
                return;
            }
            // console.log(`[xiaochen-log] sendFSRemove: ${userId}, ${uuid}`);
            resolve();
        });
    });
}

async function sendFSPurge(userId) {
    return new Promise((resolve, reject) => {
        if ( !userId ) {
            reject(new Error('User ID is required'));
            return;
        }

        const request = new PurgeReplicaRequest();
        request.setUserId(userId);

        client.purgeReplica(request, (err, _response) => {
            if ( err ) {
                reject(new Error(`[xiaochen-error] Failed to send fs purge replica: ${err.message}`));
                return;
            }
            resolve();
        });
    });
};

/**
 * Recursively sanitize values so they can be accepted by google.protobuf.Struct.
 * - undefined -> dropped
 * - Date -> ISO string
 * - BigInt -> string
 * - Buffer/Uint8Array -> base64 string
 * - Map -> plain object
 * - Set -> array
 * - Other non-JSON types -> string fallback
 *
 * NB: This function MUST mimic the behavior of safe-stable-stringify to ensure consistency.
 *
 * Notes on undefined:
 * - safe-stable-stringify.stringify has the same behavior on undefined as JSON.stringify (https://github.com/BridgeAR/safe-stable-stringify/blob/bafd93def367f38c4f5ebd598fde7970f331ca9c/test.js#L513)
 *   - undefined in object is dropped
 *   - undefined in array is converted to null
 *   - undefined in map/set is dropped
 * - Another solution is to use safe-stable-stringify.stringify + parse, it's safer and slower.
 */
function sanitizeForStruct(value) {
    if ( value === undefined ) {
        return null;
    }
    if ( value === null ) return null;

    const t = typeof value;
    if ( t === 'string' || t === 'number' || t === 'boolean' ) return value;

    if ( Array.isArray(value) ) {
        return value.map(sanitizeForStruct);
    }

    if ( value instanceof Date ) return value.toISOString();

    if ( typeof Buffer !== 'undefined' && Buffer.isBuffer(value) ) {
        return value.toString('base64');
    }
    if ( value instanceof Uint8Array ) {
        return Buffer.from(value).toString('base64');
    }

    if ( value instanceof Map ) {
        // TODO: Mimic the behavior of safe-stable-stringify on "undefined" values.
        return Object.fromEntries(Array.from(value.entries()).map(([k, v]) => [k, sanitizeForStruct(v)]));
    }
    if ( value instanceof Set ) {
        // TODO: Mimic the behavior of safe-stable-stringify on "undefined" values.
        return Array.from(value).map(sanitizeForStruct);
    }

    if ( value && value.constructor === Object ) {
        const out = {};
        for ( const [k, v] of Object.entries(value) ) {
            // Mimic the behavior of safe-stable-stringify.
            if ( v === undefined ) {
                continue;
            }
            out[k] = sanitizeForStruct(v);
        }
        return out;
    }

    if ( t === 'bigint' ) return value.toString();

    if ( typeof value.toJSON === 'function' ) {
        return sanitizeForStruct(value.toJSON());
    }

    return String(value);
}

/**
 * Build an FSEntry message from a plain JS metadata object.
 * @param {Object} metadataObj - The raw metadata object.
 * @returns {FSEntry}
 */
function buildFsEntry(metadataObj) {
    const sanitized = sanitizeForStruct(metadataObj);
    const struct = Struct.fromJavaScript(sanitized);
    const fsEntry = new FSEntry();
    fsEntry.setMetadata(struct);
    return fsEntry;
}

module.exports = {
    // gRPC client and protobuf classes
    client,
    FSEntry,
    NewFSEntryRequest,
    RemoveFSEntryRequest,
    PullRequest,
    PullRequestItem,
    FetchReplicaRequest,
    Struct,

    // Helper functions
    sendFSNew,
    sendFSRemove,
    sendFSPurge,
    buildFsEntry,
    sanitizeForStruct,
};
