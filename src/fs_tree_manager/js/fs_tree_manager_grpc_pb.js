// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var fs_tree_manager_pb = require('./fs_tree_manager_pb.js');
var google_protobuf_struct_pb = require('google-protobuf/google/protobuf/struct_pb.js');
var google_protobuf_empty_pb = require('google-protobuf/google/protobuf/empty_pb.js');

function serialize_fs_tree_manager_FetchReplicaRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.FetchReplicaRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.FetchReplicaRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_FetchReplicaRequest(buffer_arg) {
  return fs_tree_manager_pb.FetchReplicaRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_MerkleTree(arg) {
  if (!(arg instanceof fs_tree_manager_pb.MerkleTree)) {
    throw new Error('Expected argument of type fs_tree_manager.MerkleTree');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_MerkleTree(buffer_arg) {
  return fs_tree_manager_pb.MerkleTree.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_NewFSEntryRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.NewFSEntryRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.NewFSEntryRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_NewFSEntryRequest(buffer_arg) {
  return fs_tree_manager_pb.NewFSEntryRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_PullRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.PullRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.PullRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_PullRequest(buffer_arg) {
  return fs_tree_manager_pb.PullRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_PurgeReplicaRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.PurgeReplicaRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.PurgeReplicaRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_PurgeReplicaRequest(buffer_arg) {
  return fs_tree_manager_pb.PurgeReplicaRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_PushRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.PushRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.PushRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_PushRequest(buffer_arg) {
  return fs_tree_manager_pb.PushRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_fs_tree_manager_RemoveFSEntryRequest(arg) {
  if (!(arg instanceof fs_tree_manager_pb.RemoveFSEntryRequest)) {
    throw new Error('Expected argument of type fs_tree_manager.RemoveFSEntryRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_fs_tree_manager_RemoveFSEntryRequest(buffer_arg) {
  return fs_tree_manager_pb.RemoveFSEntryRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_protobuf_Empty(arg) {
  if (!(arg instanceof google_protobuf_empty_pb.Empty)) {
    throw new Error('Expected argument of type google.protobuf.Empty');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_protobuf_Empty(buffer_arg) {
  return google_protobuf_empty_pb.Empty.deserializeBinary(new Uint8Array(buffer_arg));
}


// For all RPC requests, user identifier is always needed since replicas are
// stored separately for each user.
//
// We use user_id instead of user_name/user_uuid since it's more accessible:
// - fsentry include user_id but not user_name/user_uuid
// (https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/services/database/sqlite_setup/0001_create-tables.sql#L81)
// - user_id is included in the fs events listener where user_name/user_uuid are
// not available
// (https://github.com/HeyPuter/puter/blob/847b3a07a4ec59e724063f460a4c26cb62b04d42/src/backend/src/services/WSPushService.js#L165-L166)
//
// We provide simple {New/Remove}FSEntry APIs as a straightforward way to
// accommodate the wide variety of file system operations. These APIs should
// always results in an coherent MerkleTree.
var FSTreeManagerService = exports.FSTreeManagerService = {
  fetchReplica: {
    path: '/fs_tree_manager.FSTreeManager/FetchReplica',
    requestStream: false,
    responseStream: false,
    requestType: fs_tree_manager_pb.FetchReplicaRequest,
    responseType: fs_tree_manager_pb.MerkleTree,
    requestSerialize: serialize_fs_tree_manager_FetchReplicaRequest,
    requestDeserialize: deserialize_fs_tree_manager_FetchReplicaRequest,
    responseSerialize: serialize_fs_tree_manager_MerkleTree,
    responseDeserialize: deserialize_fs_tree_manager_MerkleTree,
  },
  pullDiff: {
    path: '/fs_tree_manager.FSTreeManager/PullDiff',
    requestStream: false,
    responseStream: false,
    requestType: fs_tree_manager_pb.PullRequest,
    responseType: fs_tree_manager_pb.PushRequest,
    requestSerialize: serialize_fs_tree_manager_PullRequest,
    requestDeserialize: deserialize_fs_tree_manager_PullRequest,
    responseSerialize: serialize_fs_tree_manager_PushRequest,
    responseDeserialize: deserialize_fs_tree_manager_PushRequest,
  },
  // Insert a new FSEntry into the tree, update its parent's children list as
// well.
newFSEntry: {
    path: '/fs_tree_manager.FSTreeManager/NewFSEntry',
    requestStream: false,
    responseStream: false,
    requestType: fs_tree_manager_pb.NewFSEntryRequest,
    responseType: google_protobuf_empty_pb.Empty,
    requestSerialize: serialize_fs_tree_manager_NewFSEntryRequest,
    requestDeserialize: deserialize_fs_tree_manager_NewFSEntryRequest,
    responseSerialize: serialize_google_protobuf_Empty,
    responseDeserialize: deserialize_google_protobuf_Empty,
  },
  // Remove an FSEntry (and all its descendants) from the tree, update its
// parent's children list as well.
removeFSEntry: {
    path: '/fs_tree_manager.FSTreeManager/RemoveFSEntry',
    requestStream: false,
    responseStream: false,
    requestType: fs_tree_manager_pb.RemoveFSEntryRequest,
    responseType: google_protobuf_empty_pb.Empty,
    requestSerialize: serialize_fs_tree_manager_RemoveFSEntryRequest,
    requestDeserialize: deserialize_fs_tree_manager_RemoveFSEntryRequest,
    responseSerialize: serialize_google_protobuf_Empty,
    responseDeserialize: deserialize_google_protobuf_Empty,
  },
  // For any fs operations that cannot be handled by New/Remove APIs, just purge
// the replica.
purgeReplica: {
    path: '/fs_tree_manager.FSTreeManager/PurgeReplica',
    requestStream: false,
    responseStream: false,
    requestType: fs_tree_manager_pb.PurgeReplicaRequest,
    responseType: google_protobuf_empty_pb.Empty,
    requestSerialize: serialize_fs_tree_manager_PurgeReplicaRequest,
    requestDeserialize: deserialize_fs_tree_manager_PurgeReplicaRequest,
    responseSerialize: serialize_google_protobuf_Empty,
    responseDeserialize: deserialize_google_protobuf_Empty,
  },
};

exports.FSTreeManagerClient = grpc.makeGenericClientConstructor(FSTreeManagerService, 'FSTreeManager');
