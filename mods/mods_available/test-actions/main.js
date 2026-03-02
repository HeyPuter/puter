/*
 * Test-actions extension: declarative actions page for testing user suspension
 * and other admin actions. All changes in this single file.
 */

const { db } = extension.import('data');
const { invalidate_cached_user } = use('core.util.helpers');

// Declarative actions: id, label, and inputs drive the generated GUI.
const ACTIONS = [
    {
        id: 'suspend-user',
        label: 'Suspend user',
        inputs: [
            { name: 'username', label: 'Username', type: 'text' },
        ],
    },
    // Add more actions here; each needs a handler in INVOKE_HANDLERS.
];

// Handlers for each action id. Receives (req, res, body).
const INVOKE_HANDLERS = {
    'suspend-user': async (req, res, body) => {
        const username = body?.username?.trim();
        if ( ! username ) {
            return res.status(400).json({ ok: false, error: 'username is required' });
        }
        const svc_get_user = req.services.get('get-user');
        const user = await svc_get_user.get_user({ username });
        if ( ! user ) {
            return res.status(404).json({ ok: false, error: 'User not found' });
        }
        await db.write('UPDATE `user` SET suspended = 1 WHERE id = ? LIMIT 1', [user.id]);
        invalidate_cached_user(user);
        // Cache invalidation would require backend helpers (ESM); skipped here.
        return res.json({ ok: true, message: `User "${username}" suspended.` });
    },
};

const PAGE_HTML = (actionsJson) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Test actions</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 1rem; }
    .action { border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .action h2 { font-size: 1rem; margin: 0 0 0.75rem 0; }
    .field { margin-bottom: 0.75rem; }
    .field label { display: block; font-size: 0.875rem; margin-bottom: 0.25rem; color: #444; }
    .field input { width: 100%; padding: 0.5rem; }
    button.invoke { padding: 0.5rem 1rem; cursor: pointer; margin-top: 0.25rem; }
    .message { margin-top: 0.75rem; font-size: 0.875rem; }
    .message.error { color: #c00; }
    .message.success { color: #060; }
  </style>
</head>
<body>
  <h1>Test actions</h1>
  <div id="root"></div>
  <script>
    const ACTIONS = ${actionsJson};
    const root = document.getElementById('root');
    function render() {
      root.innerHTML = ACTIONS.map(action => {
        const cardId = 'action-' + action.id;
        const fields = (action.inputs || []).map(inp =>
          '<div class="field"><label for="' + cardId + '-' + inp.name + '">' + (inp.label || inp.name) + '</label>' +
          '<input type="' + (inp.type || 'text') + '" id="' + cardId + '-' + inp.name + '" name="' + inp.name + '"></div>'
        ).join('');
        return '<div class="action" data-action-id="' + action.id + '">' +
          '<h2>' + (action.label || action.id) + '</h2>' +
          '<form class="action-form">' + fields +
          '<button type="submit" class="invoke">Invoke</button>' +
          '<div class="message" id="msg-' + action.id + '"></div></form></div>';
      }).join('');
      root.querySelectorAll('.action-form').forEach(form => {
        const card = form.closest('.action');
        const actionId = card.dataset.actionId;
        const msgEl = document.getElementById('msg-' + actionId);
        form.onsubmit = async (e) => {
          e.preventDefault();
          msgEl.textContent = '';
          msgEl.className = 'message';
          const fd = new FormData(form);
          const body = {};
          for (const [k, v] of fd) body[k] = v;
          try {
            const r = await fetch('/test-actions/invoke/' + encodeURIComponent(actionId), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              credentials: 'same-origin'
            });
            const data = await r.json().catch(() => ({}));
            if (r.ok) {
              msgEl.textContent = data.message || 'Done.';
              msgEl.className = 'message success';
            } else {
              msgEl.textContent = data.error || 'Request failed.';
              msgEl.className = 'message error';
            }
          } catch (err) {
            msgEl.textContent = err.message || 'Network error.';
            msgEl.className = 'message error';
          }
        };
      });
    }
    render();
  </script>
</body>
</html>
`;

extension.get('/test-actions', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(PAGE_HTML(JSON.stringify(ACTIONS)));
});

extension.post('/test-actions/invoke/:actionId', async (req, res) => {
    const actionId = req.params.actionId;
    const handler = INVOKE_HANDLERS[actionId];
    if ( ! handler ) {
        return res.status(404).json({ ok: false, error: 'Unknown action' });
    }
    return handler(req, res, req.body || {});
});

extension.on('ai.prompt.validate', async event => {
    console.log('ai.prompt.validate');
    const messages = event.parameters?.messages ?? [];
    console.log(`ai prompt validate: ${messages.length} messages`);

    console.log('is user suspended?', event.actor.type.user.suspended);
});
