### `ai.prompt.check-usage`

This event is emitted for ai prompt check usage operations.

#### Property `completionId`

completionId
- **Type**: any
- **Mutability**: mutable
- **Notes**:

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


### `ai.prompt.complete`

This event is emitted for ai prompt complete operations.

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


### `ai.prompt.cost-calculated`

This event is emitted for ai prompt cost calculated operations.


### `ai.prompt.report-usage`

This event is emitted for ai prompt report usage operations.


### `ai.prompt.validate`

This event is emitted when a validate is being validated.
The event can be used to block certain validates from being validated.

#### Property `completionId`

completionId
- **Type**: any
- **Mutability**: mutable
- **Notes**:

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


### `app.new-icon`

This event is emitted for app new icon operations.

#### Property `data_url`

data url
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `app.rename`

This event is emitted for app rename operations.

#### Property `data_url`

data url
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `apps.invalidate`

This event is emitted when a invalidate is being validated.
The event can be used to block certain invalidates from being validated.

#### Property `apps`

apps
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `captcha.check`

This event is emitted for captcha check operations.

#### Property `required`

required
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


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


### `core.request.measured`

This event is emitted when a requests incoming and outgoing bytes
have been measured.

#### Example

```javascript
extension.on('core.request.measured', data => {
    const measurements = data.measurements;
    //    measurements = { sz_incoming: integer, sz_outgoing: integer }

    const actor = data.actor; // instance of Actor

    console.log('[36;1m === MEASUREMENT ===[0m
', {
        actor: data.actor.uid,
        measurements: data.measurements
    });
});
```

### `credit.check-available`

This event is emitted for credit check available operations.

#### Property `available`

available
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `cost_uuid`

cost uuid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `credit.funding-update`

This event is emitted when a funding-update is updated.

#### Property `available`

available
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `cost_uuid`

cost uuid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `credit.record-cost`

This event is emitted for credit record cost operations.

#### Property `available`

available
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `cost_uuid`

cost uuid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `driver.create-call-context`

This event is emitted when a create-call-context is created.

#### Property `usages`

usages
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `email.validate`

This event is emitted when a validate is being validated.
The event can be used to block certain validates from being validated.

#### Property `allow`

whether the operation is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**:
  - If set to false, the email will be considered invalid.

#### Property `email`

email
- **Type**: any
- **Mutability**: mutable
- **Notes**:
  - The email may have already been cleaned.


### `fs.create.directory`

This event is emitted when a directory is created.


### `fs.create.file`

This event is emitted when a file is created.

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:


### `fs.create.shortcut`

This event is emitted when a shortcut is created.


### `fs.create.symlink`

This event is emitted when a symlink is created.


### `fs.move.file`

This event is emitted for fs move file operations.

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


### `fs.pending.file`

This event is emitted for fs pending file operations.


### `fs.storage.progress.copy`

This event reports progress of a copy operation.

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


### `fs.storage.upload-progress`

This event reports progress of a upload-progress operation.


### `fs.write.file`

This event is emitted when a file is updated.

#### Property `context`

current context
- **Type**: Context
- **Mutability**: no-effect
- **Notes**:


### `ip.validate`

This event is emitted when a validate is being validated.
The event can be used to block certain validates from being validated.

#### Property `res`

res
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `end_`

end 
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `end`

end
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `outer.fs.write-hash`

This event is emitted when a write-hash is updated.

#### Property `uuid`

uuid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.item.added`

This event is emitted for outer gui item added operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.item.moved`

This event is emitted for outer gui item moved operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.item.pending`

This event is emitted for outer gui item pending operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.item.updated`

This event is emitted when a updated is updated.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.notif.ack`

This event is emitted for outer gui notif ack operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.notif.message`

This event is emitted for outer gui notif message operations.

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


### `outer.gui.notif.persisted`

This event is emitted for outer gui notif persisted operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.notif.unreads`

This event is emitted for outer gui notif unreads operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.submission.done`

This event is emitted for outer gui submission done operations.

#### Property `response`

response
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `outer.gui.usage.update`

This event is emitted when a update is updated.


### `outer.thread.notify-subscribers`

This event is emitted for outer thread notify subscribers operations.

#### Property `uid`

uid
- **Type**: string
- **Mutability**: no-effect
- **Notes**:

#### Property `action`

action
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `data`

data
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `puter.signup`

This event is emitted for puter signup operations.

#### Property `ip`

ip
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `user_agent`

user agent
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `body`

body
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `request.measured`

This event is emitted for request measured operations.

#### Property `req`

req
- **Type**: any
- **Mutability**: no-effect
- **Notes**:

#### Property `res`

res
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `request.will-be-handled`

This event is emitted for request will be handled operations.

#### Property `res`

res
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `end_`

end 
- **Type**: any
- **Mutability**: mutable
- **Notes**:

#### Property `end`

end
- **Type**: any
- **Mutability**: mutable
- **Notes**:


### `sns`

This event is emitted for sns operations.

#### Property `message`

message
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `template-service.hello`

This event is emitted for template-service hello operations.


### `usages.query`

This event is emitted for usages query operations.

#### Property `usages`

usages
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `user.email-changed`

This event is emitted for user email changed operations.

#### Property `new_email`

new email
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `user.email-confirmed`

This event is emitted for user email confirmed operations.

#### Property `email`

email
- **Type**: any
- **Mutability**: no-effect
- **Notes**:


### `user.save_account`

This event is emitted for user save_account operations.

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: no-effect
- **Notes**:


### `web.socket.connected`

This event is emitted for web socket connected operations.

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: mutable
- **Notes**:


### `web.socket.user-connected`

This event is emitted for web socket user connected operations.

#### Property `user`

user associated with the operation
- **Type**: User
- **Mutability**: mutable
- **Notes**:


### `wisp.get-policy`

This event is emitted for wisp get policy operations.

#### Property `policy`

policy information for the operation
- **Type**: Policy
- **Mutability**: mutable
- **Notes**:


