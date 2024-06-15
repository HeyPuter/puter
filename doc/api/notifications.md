# Notification Endpoints

Endpoints for managing notifications.

## POST `/notif/mark-ack` (auth required)

### Description

The `/notif/mark-ack` endpoint marks the specified notification
as "acknowledged". This indicates that the user has chosen to either
dismiss or act on this notification.

### Parameters

| Name | Description | Default Value |
| ---- | ----------- | -------- |
| uid | UUID associated with the notification | **required** |

### Response

This endpoint responds with an empty object (`{}`).


## POST `/notif/mark-read` (auth required)

### Description

The `/notif/mark-read` endpoint marks that the specified notification
has been shown to the user. It will not "pop up" as a new notification
if they load the gui again.

### Parameters

| Name | Description | Default Value |
| ---- | ----------- | -------- |
| uid | UUID associated with the notification | **required** |

### Response

This endpoint responds with an empty object (`{}`).

### Request Example

```javascript
await fetch("https://api.puter.local/notif/mark-read", {
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  body: JSON.stringify({
    uid: 'a14ea3d5-828b-42f9-9613-35f43b0a3cb8',
  }),
  method: "POST",
});
```
## ENTITY STORAGE `puter-notifications`

The `puter-notifications` driver is an Entity Storage driver.
It is read-only.

### Request Examples

#### Select Unread Notifications

```javascript
await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
    interface: 'puter-notifications',
    method: 'select',
    args: { predicate: ['unread'] }
  }),
  "method": "POST",
});
```

#### Select First 200 Notifications

```javascript
await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
    interface: 'puter-notifications',
    method: 'select',
    args: {}
  }),
  "method": "POST",
});
```

#### Select Next 200 Notifications

```javascript
await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
    interface: 'puter-notifications',
    method: 'select',
    args: { offset: 200 }
  }),
  "method": "POST",
});
```
