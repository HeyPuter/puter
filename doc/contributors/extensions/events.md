### `core.email.validate`

This event is emitted when an email is being validated.
The event can be used to block certain emails from being validated.

#### Property `email`

the email being validated
- **Type**: string
- **Mutability**: no-effect
- **Notes**:
  - The email may have already been cleaned.

#### Property `allow`

whether the email is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:
  - If set to false, the email will be considered invalid.

### `core.request.measured`

This event is emitted when a requests incoming and outgoing bytes
have been measured.

#### Example

```javascript
extension.on('core.request.measured', data => {
    const measurements = data.measurements;
    //    measurements = { sz_incoming: integer, sz_outgoing: integer }

    const actor = data.actor; // instance of Actor

    console.log('\x1B[36;1m === MEASUREMENT ===\x1B[0m\n', {
        actor: data.actor.uid,
        measurements: data.measurements
    });
});
```

### `core.fs.create.directory`

This event is emitted when a directory is created.

#### Property `node`

the directory that was created
- **Type**: FSNodeContext
- **Mutability**: no-effect

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect

### `core.ai.prompt.check-usage`

This event is emitted for ai prompt check usage operations.

#### Property `allow`

whether the operation is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:

#### Property `intended_service`

intended service
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `parameters`

parameters
- **Type**: any
- **Mutability**: mutable
- **Notes**:

### `core.ai.prompt.complete`

This event is emitted for ai prompt complete operations.

#### Property `username`

username
- **Type**: string
- **Mutability**: mutable
- **Notes**:

#### Property `intended_service`

intended service
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `parameters`

parameters
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `result`

result
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `model_used`

model used
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `service_used`

service used
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `core.ai.prompt.report-usage`

This event is emitted for ai prompt report usage operations.


### `core.ai.prompt.validate`

This event is emitted when a validate is being validated.
The event can be used to block certain validates from being validated.

#### Property `allow`

whether the operation is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:
  - If set to false, the ai will be considered invalid.

#### Property `intended_service`

intended service
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `parameters`

parameters
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `core.app.new-icon`

This event is emitted for app new icon operations.

#### Property `app_uid`

app uid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `data_url`

data url
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.app.rename`

This event is emitted for app rename operations.

#### Property `app_uid`

app uid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `data_url`

data url
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.apps.invalidate`

This event is emitted when a invalidate is being validated.
The event can be used to block certain invalidates from being validated.

#### Property `options`

options
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `apps`

apps
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

### `core.fs.create.file`

This event is emitted when a file is created.

#### Property `node`

the file that was affected
- **Type**: FSNodeContext
- **Mutability**: no-effect
- **Notes**:

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:


### `core.fs.create.shortcut`

This event is emitted when a shortcut is created.


### `core.fs.create.symlink`

This event is emitted when a symlink is created.


### `core.fs.move.file`

This event is emitted for fs move file operations.

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:

#### Property `moved`

moved
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `old_path`

path to the affected resource
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `core.fs.pending.file`

This event is emitted for fs pending file operations.


### `core.fs.storage.progress.copy`

This event reports progress of a copy operation.

#### Property `upload_tracker`

tracks progress of the operation
- **Type**: ProgressTracker
- **Mutability**: no-effect
- **Notes**:

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:

#### Property `meta`

additional metadata for the operation
- **Type**: object
- **Mutability**: no-effect
- **Notes**:

#### Property `item_path`

path to the affected resource
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `core.fs.storage.upload-progress`

This event reports progress of a upload-progress operation.


### `core.fs.write.file`

This event is emitted when a file is updated.

#### Property `node`

the file that was affected
- **Type**: FSNodeContext
- **Mutability**: no-effect
- **Notes**:

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:


### `core.ip.validate`

This event is emitted when a validate is being validated.
The event can be used to block certain validates from being validated.

#### Property `allow`

whether the operation is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:
  - If set to false, the ip will be considered invalid.

#### Property `ip`

ip
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `core.outer.fs.write-hash`

This event is emitted when a write-hash is updated.

#### Property `hash`

hash
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `uuid`

uuid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.item.added`

This event is emitted for outer gui item added operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.item.moved`

This event is emitted for outer gui item moved operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.item.pending`

This event is emitted for outer gui item pending operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.item.updated`

This event is emitted when a updated is updated.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.notif.ack`

This event is emitted for outer gui notif ack operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.notif.message`

This event is emitted for outer gui notif message operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `notification`

notification
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.notif.persisted`

This event is emitted for outer gui notif persisted operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.notif.unreads`

This event is emitted for outer gui notif unreads operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.outer.gui.submission.done`

This event is emitted for outer gui submission done operations.

#### Property `user_id_list`

user id list
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.puter-exec.submission.done`

This event is emitted for puter-exec submission done operations.

### `core.sns`

This event is emitted for sns operations.

#### Property `message`

message
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.template-service.hello`

This event is emitted for template-service hello operations.

#### Property `message`

message
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.usages.query`

This event is emitted for usages query operations.

#### Property `actor`

actor
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `usages`

usages
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.user.email-changed`

This event is emitted for user email changed operations.

#### Property `user_id`

user id
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `new_email`

new email
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.user.email-confirmed`

This event is emitted for user email confirmed operations.

#### Property `user_uid`

user uid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `email`

email
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `core.user.save_account`

This event is emitted for user save_account operations.

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: no-effect
- **Notes**:


### `core.web.socket.connected`

This event is emitted for web socket connected operations.

#### Property `socket`

socket
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: mutable
- **Notes**:


### `core.web.socket.user-connected`

This event is emitted for web socket user connected operations.

#### Property `socket`

socket
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: mutable
- **Notes**:


### `core.wisp.get-policy`

This event is emitted for wisp get policy operations.

#### Property `allow`

whether the operation is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:

#### Property `policy`

policy information for the operation
- **Type**: Policy
- **Mutability**: mutable
- **Notes**:


