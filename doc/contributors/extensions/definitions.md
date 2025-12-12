## Definitions

### `core.config` - Configuration

Puter's configuration object. This includes values from `config.json` or their
defaults, and computed values like `origin` and `api_origin`.

```javascript
const config = use('core.config');

extension.get('/get-origin', { noauth: true }, (req, res) => {
    res.send(config.origin);
})
```