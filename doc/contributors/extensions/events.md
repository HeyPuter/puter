### `core.email.validate`

This event is emitted when an email is being validated.
The event can be used to block certain emails from being validated.

#### Property `email`

the email being validated
- **Type**: string
- **Mutability**: no-effect
- **Notes**: undefined
  - The email may have already been cleaned.
#### Property `allow`

whether the email is allowed
- **Type**: boolean
- **Mutability**: mutable
- **Notes**: undefined
  - If set to false, the email will be considered invalid.

### `core.request.measured`

This event is emitted when a requests incoming and outgoing bytes
have been measured.

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
