- Feature Name: Client Replica Filesystem
- Status: In Progress
- Date: 2025-08-21

## Table of Contents

- [Summary](#summary)
- [Motivation](#motivation)
- [Implementation](#implementation)
  - [Data Structure](#data-structure)
  - [Client-Replica Initialization](#client-replica-initialization)
  - [Client-Replica Synchronization](#client-replica-synchronization)
  - [File System Operations Upon Fetching](#file-system-operations-upon-fetching)
  - [FS-Tree Manager](#fs-tree-manager)
  - [FS Hooks](#fs-hooks)
  - [Adaptation to the Existing Codebase](#adaptation-to-the-existing-codebase)
  - [Anomaly - Stale Fetch Due to Local Update](#anomaly---stale-fetch-due-to-local-update)
  - [Anomaly - Stale Fetch Due to Failed Event Notification](#anomaly---stale-fetch-due-to-failed-event-notification)
  - [Anomaly - Overlapping FS Syncs](#anomaly---overlapping-fs-syncs)
  - [Puter-JS Variables](#puter-js-variables)
  - [Client-Replica Lifecycle](#client-replica-lifecycle)
  - [Code Location](#code-location)
- [Scalability](#scalability)
  - [First Stage - Single Instance](#first-stage---single-instance)
  - [Second Stage - Partitioned FS-Tree Manager](#second-stage---partitioned-fs-tree-manager)
- [Fault Tolerance](#fault-tolerance)
- [Metrics](#metrics)
  - [Change Propagation Time](#change-propagation-time)
- [Optimization in the Future](#optimization-in-the-future)
- [Failure Scenarios](#failure-scenarios)
  - [FS-Tree Manager Failure](#fs-tree-manager-failure)
  - [FS-Update Notification Failure](#fs-update-notification-failure)
- [Alternatives and Trade-offs](#alternatives-and-trade-offs)
  - [Last-Updated Time for "Stale Replica Fetch"](#last-updated-time-for-stale-replica-fetch)
  - [Alternative Storage Models](#alternative-storage-models)
- [TODO](#todo)

## Summary

**Client Replica Filesystem** is a mechanism that keeps a **full replica** of a user’s filesystem tree on the client and regularly sync updates from the server. This feature allows:

* Rapid file system operations for read-only APIs such as `stat`, `readdir`, and `search`. No network round trips are needed.
* Lower network I/O along with reduced database and CPU load on the server.

## Motivation

The **puter filesystem** is a critical component of Puter, it provides a POSIX-like filesystem interface to `puter-js` and powers the filesystem operations in the GUI web client. APIs provided by the filesystem include:

- Read-only APIs: `stat`, `readdir`, `search`.
- Write APIs: `mkdir`, `write`, `copy`, `move`, `rename`, `delete`, etc.

Currently, all of these operations are handled through the synchronous HTTP API and suffer from latency issues caused by network round trips and database index contention. For example, when a user opens a folder in the GUI web client, the request will go all the way to database to find what's inside the folder. There are 20 million filesystem entries in the database and the latency will keep increasing as the number of files grows.

To tackle this issue, we propose maintaining a **full replica** of the filesystem rooted at the user’s home directory on the client (e.g., for user Tim, all filesystem nodes under `/Tim` are stored locally). This allows users to perform read-only operations on the client replica without waiting for a server response. Updates to the filesystem will be fetched from the server periodically.

![](assets/20251008_134412_puter-client_replica_overview.drawio.svg)



![](assets/20251008_134726_puter-client_replica_network.drawio.svg)

## Implementation

### Data Structure

**Merkle Tree** is used to quickly compare two file system trees and synchronize them by sending only the differences.

In our implementation, we use two key ideas:

1. **Bidirectional Nodes**
   Each node stores references to both its parent and children.

   * **Top-down traversal**: used for tree comparison and path lookup.
   * **Bottom-up traversal**: used to recalculate hashes when a node is updated.
2. **Heap (Index by UUID)**
   We maintain a heap-like structure (UUID → node map) to:

   * Enable fast node lookups by UUID.
   * Prevent duplicate nodes in the tree.

> A Merkle tree is a hash tree where leaves are hashes of the values of individual nodes. Parent nodes higher in the tree are hashes of their respective children. The principal advantage of Merkle tree is that each branch of the tree can be checked independently without requiring nodes to download the entire tree or the entire data set. Moreover, Merkle trees help in reducing the amount of data that needs to be transferred while checking for inconsistencies among replicas. For instance, if the hash values of the root of two trees are equal, then the values of the leaf nodes in the tree are equal and the nodes require no synchronization. If not, it implies that the values of some replicas are different. In such cases, the nodes may exchange the hash values of children and the process continues until it reaches the leaves of the trees, at which point the hosts can identify the nodes that are “out of sync”.

### Client-Replica Initialization

Both initialization and synchronization are done via websocket to save network traffic.

Initial fetch is done via websocket event `replica/fetch`.

### Client-Replica Synchronization

Since CRDT is not used, synchronization between client and server is one-way — the client only fetches changes from the server. Each node in the tree includes a `hash` field that is the hash of **all its children's hashes + its own metadata**. So its safe to say 2 trees are the same if and only if their root nodes have the same hash.

Synchronize is done via websocket event `replica/pull_diff`.

Client start a sync by sending a request to the server:

```json
{
  "pull_request": [
    {
      "uuid": "<uuid>",
      "merkle_hash": "<hash>"
    }
  ]
}
```

Server send push requests when there are differences between the client and server. This action is simple, just send requested nodes and their children to the client.

```json
{
  "push_request": [
    {
      "uuid": "<uuid>",
      "merkle_hash": "<hash>",
      "fs_entry": "...",
      "children": [
        {
          "uuid": "<same_1>",
          "merkle_hash": "<hash>",
          "fs_entry": "..."
        },
        {
          "uuid": "<same_2>",
          "merkle_hash": "<hash>",
          "fs_entry": "..."
        },
        {
          "uuid": "<diff_1>",
          "merkle_hash": "<hash>",
          "fs_entry": "..."
        },
        {
          "uuid": "<diff_2>",
          "merkle_hash": "<hash>",
          "fs_entry": "..."
        }
      ]
    }
  ]
}
```

Client does the following actions in sequence:

1. Update the fs_entry for the level-1 node.
2. Compare the children list with the client-replica.
   2.a For nodes with the same uuid and hash, skip.
   2.b For nodes with the same uuid and different hash, update the fs_entry for the node. Then add the node to the next pull request (as level-1 node).
   2.c For nodes that missing from the server response, remove it and all its ancestors from the local replica.
   2.d For nodes that missing from the client-replica, add it the local replica. Then add the node to the next pull request (as level-1 node).
3. Send the next pull request to the server if there are any nodes to update.
4. Stop when 1) there are no nodes to update or 2) the server response is empty.

There are some details to consider:

- Client Memory Usage: In the POC implementation, a tree consists of 100K nodes takes around 10MB browser memory. A hard limit of 20MB (i.e., 200K nodes) can be set at server side to avoid taking too much memory. When a user has too much file nodes under his home directory, server can send an error back to the client.
- Initialization Time: According to the data size mentioned above, the initialization will finish within 1 second. But it's still great to put it in a background task to avoid blocking the UI thread.
- Permission: Permission check should be enforced on both client side and server side. A user can only fetch the tree started from his home directory. A simpler design is to remove the args from `puter.fs.fetch_tree` and make it "fetch all files for the current user".

### File System Operations Upon Fetching

To make the system consistent, the local replica will work with all existing file system APIs except `read` and `write`. A simple implementation is to have a switch branch for local replica:

```js
const readdir = async function (...args) {
    // ... (existing code)

    if (this.local_replica.available) {
        return this.local_replica.readdir(options.path);
    }

    // ... (existing code which fetches from server)
}
```

### FS-Tree Manager

Just a standalone service that manages the FS-Tree.

- It only creates a new in-memory FS tree when a user requests it and memory usage is below the threshold.
- It periodically purges FS trees that haven't been synced for a while.
- It periodically purges FS trees that haven't been accessed for a while.

### FS Hooks

#### Hooks in Puter Backend

NB: Put hooks in WSPushService may cause duplicate events, remove them in the future.

- [X] mkdir (`fs.create.*` event) (code: `src/backend/src/services/WSPushService.js`)
- [X] new file
  - code: `src/backend/src/filesystem/hl_operations/hl_mkdir.js`
  - implementation: newFSEntry
- [X] write file
  - code: `src/backend/src/filesystem/hl_operations/hl_write.js`
  - implementation: newFSEntry
- [X] rename (code: `src/backend/src/routers/filesystem_api/rename.js`)
- [X] move (`fs.move.*` event) (code: `src/backend/src/services/WSPushService.js`)
  - TODO: move dir (with children) does not work
- [X] delete file/dir (code: `src/backend/src/filesystem/hl_operations/hl_remove.js`)

#### Hooks in Puter-JS

- [X] mkdir

  - code: `src/puter-js/src/modules/FileSystem/operations/mkdir.js`
  - implementation: newFSEntry
- [ ] new file
- [ ] write file
- [X] rename

  - code: `src/puter-js/src/modules/FileSystem/operations/rename.js`
  - implementation: dedicated rename api (since complete fsentry is not available)
- [X] move

  - code: `src/puter-js/src/modules/FileSystem/operations/move.js`
  - implementation: removeFSEntry + newFSEntry
- [X] delete file/dir

  - code: `src/puter-js/src/modules/FileSystem/operations/deleteFSEntry.js`
  - implementation: removeFSEntry + findNodeByPath (since only path is available)
- [X] stat (code: `src/puter-js/src/modules/FileSystem/operations/stat.js`)
- [X] readdir (code: `src/puter-js/src/modules/FileSystem/operations/readdir.js`)
- [ ] search

### Adaptation to the Existing Codebase

#### FSEntry Parent

As of now, there are 4 attributes in a fsentry that are related to parent:

- `parent_id`
- `parent_uid`
- `dirname`
- `dirpath`

`parent_id`/`parent_uid` is defined as database columns ([link](https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/services/database/sqlite_setup/0001_create-tables.sql#L82-L83)) and there are some subtle differences:

- `parent_id` may be an int id or a string uuid.
- `parent_uid` is string uuid most of the time.

`dirname`/`dirpath` is calculated in the process of business logic ([link](https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/filesystem/FSNodeContext.js#L829-L830)) and often returned to the client.

- `dirname` may be the last part of `path` or the whole `path`.
- `dirpath` is always the whole `path`.

`parent_id`/`parent_uid`/`dirname`/`dirpath` are consitent with each other most of the time, but may out of sync in some cases (e.g: move operation). The receivers (i.e: puter-js, fs-tree-manager) may validate the consistency of these attributes but **MUST** throw an error if they are inconsistent. Other approaches such as silent fail or fallback to one of them are **PROHIBITED** since the inconsistency will propagate during sync process and hard to diagnose.

The fix of inconsistency should be done inside the puter backend and marked as `client-replica patch`.

FSEntry receivers should rely on `parent_uid` field.

#### FSEntry ID/UID/UUID/MYSQL_ID

TODO

- uuid may missing from it
- id may be a string uuid
- uid is often seen in fsentry, it's a string uuid most of the time

#### User ID/UUID

TODO

- id is a int id most of the time
- id is more accessible than uuid (TODO: explain why)

#### Heterogeneous FSEntry

FS-Tree Manager accepts FSEntry from 2 different sources:

- database, fields: [link](https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/services/database/sqlite_setup/0001_create-tables.sql#L70)
- puter backend, which does some post-processing in `getSafeEntry` ([link](https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/filesystem/FSNodeContext.js#L771)), including but not limited to:

  - add dirname, dirpath
  - add id, uid, remove uuid
  - remove user_id
  - remove bucket, bucket_region
  - bool/int is_dir -> boolean
  - int/other size -> int

These differences poses 3 challenges for FS-Tree Manager:

1. It fetches the tree from database then push it to the client without post-processing, which leads to inconsistent FSEntry from puter-js' point of view.
2. It has to maintain FSEntry in 2 different formats, which is error-prone.
3. There is a high chance of inconsistency between the in-memory FS Tree and the database.

To cope with these challenges, we propose the following workarounds:

- Just return the raw FSEntry to the client for now. Adapt to the post-processing format in the future.
- Store both formats in the FS-Tree Manager for now. Add a normalizer in the input procedure in the future.
- Drop the in-memory FS Tree directly during “anti-entropy sync.”

### Anomaly - Stale Fetch Due to Local Update

A stale fetch can happens immediately after a local update:

1. At time `t`, a FS updated happens and local-replica is updated.
2. At time `t + 1`, a sync happens, the client fetches the stale replica from server.
3. At time `t + 2`, the FS update event reaches the FS-Tree Manager and the in-memory FS Tree is updated.

The nature of this anomaly is that FS update has to be reflected to the client-replica as soon as possible so the read APIs can see the update, while there might be a delay between the FS update and the FS-Tree Manager's update.

The naive solution is to stop periodic syncs for 3 seconds after any local update.

A better solution is introduce `last_updated_time` to all replicas but it introduces other pitfalls like clock skew and extra complexity.

TOOD: add a diagram so it's easier to understand.

### Anomaly - Stale Fetch Due to Failed Event Notification

TODO

### Anomaly - Overlapping FS Syncs

TODO

### Puter-JS Variables

- `puter.fs.replica.available` - whether the client-replica is available
- `puter.fs.replica.last_local_update` - the timestamp of the last local update
- `puter.fs.replica.setDebug(true/false)` - toggle debug widget and logs, may be merged with `puter.debugMode` in the future
- `puter.fs.replica.fs_tree` - the in-memory FS Tree, should only be used by internal code
- `puter.fs.replica.local_read` - count of local read operations performed by puter-js, used for debugging
- `puter.fs.replica.remote_read` - count of remote read operations performed by puter-js, used for debugging

### Client-Replica Lifecycle

1. Fetch the replica from server on `puter.setAuthToken`, establish a websocket connection if it's missing.
2. On websocket connected, start the pull diff process.
3. On websocket disconnected, stop the pull diff process.

**Race Condition**:

- `fetch replica` and `pull diff` is protected by a lock.

### Code Location

- `src/puter-js/src/modules/FileSystem/replica` - puter-js client
- `src/backend/src/routers/filesystem_api/fs_tree_manager` - puter backend
- `src/fs_tree_manager` - fs-tree-manager service, including golang server and protobuf definitions
- `doc/RFCS/20250821_client_replica_file_system.md` - this document, currently include all infromation about the client-replica file system

## Scalability

### First Stage - Single Instance

The first stage is to have a single instance of the FS-Tree Manager. We will use following strategies to avoid out-of-memory (OOM) issues:

- On server initialization, don't cache any FS tree.
- Only build FS tree when a request comes in.
- Evict FS tree from memory when it's not used for 10 minutes. Use `last_access_time` for the eviction logic.
- Set a hard limit of 4GB for the FS-Tree Manager, reject to create new FS tree when the memory usage reaches the limit.



![](assets/20251008_134849_puter-client_replica_deployment1.drawio.svg)

### Second Stage - Partitioned FS-Tree Manager

Use consistent hashing (by userid) to partition the FS-Tree Manager.

TODO: Add more details on how to add/remove instances.

TODO: We may need a GUI control panel for partition management.

## Fault Tolerance

TODO:

scenario 1: FS-Tree Manager is unavailable on all APIs.

scenario 2: FS-Tree Manager is only unavailable on fetch/sync APIs.

scenario 3: FS-Tree Manager is only unavailable on fs update APIs.

## Metrics

### Change Propagation Time

The time it takes for a change made on one client (such as creating, renaming, or deleting a file or folder) to appear and become visible on another client.

The **Change Propagation Time** on original synchronize model is negligible. But with the new model, the **Average Change Propagation Time** will be 6 seconds. And the **Maximum Change Propagation Time** will be 15 seconds when internal services are functioning normally.

## Optimization in the Future

- In the initial implementation, FS-Tree Manager can only serve a request if it holds the entire FS tree in memory. We can optimize it by only holding the root node in memory and fetch the children on demand.
- Replace some part of HTTP API with websocket to reduce round trips and latency.

## Failure Scenarios

### FS-Tree Manager Failure

### FS-Update Notification Failure

## Alternatives and Trade-offs

### Last-Updated Time for "Stale Replica Fetch"

### Alternative Storage Models

## TODO

- [ ] puter-js readdir support path with `~` (e.g: `~/Desktop`)
