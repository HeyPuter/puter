- Feature Name: Consistent FSEntry Fields
- Status: In Progress
- Created: 2025-10-21

## Summary

We propose making the FSEntry fields more consistent and user-friendly. This will simplify end-to-end testing and backend logic, while also aiding future development and issue diagnosis.

## Motivation

Currently, there are several issues with the FSEntry fields.

### FSEntry Parent

There are 4 attributes in a fsentry that are related to parent:

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

`parent_id`/`parent_uid`/`dirname`/`dirpath` are consitent with each other most of the time, but may out of sync in some cases (TODO: need more investigation).

### FSEntry ID/UID/UUID/MYSQL_ID

There are 4 attributes in a fsentry that are related to id:

- `id`
- `uid`
- `uuid`
- `mysql_id`

## Proposal

Here we propose a more integrated FSEntry schema:

- `uuid`: The uuid of the FSEntry.
- `parent_uuid`: The uuid of the parent FSEntry.