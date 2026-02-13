const page = `
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Puter Worker Sandbox Playground</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #0f172a;
            --panel: #111827;
            --panel-2: #1f2937;
            --text: #e5e7eb;
            --muted: #94a3b8;
            --accent: #22d3ee;
            --danger: #fb7185;
            --ok: #34d399;
            --border: #334155;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            background: radial-gradient(circle at top, #1e293b, var(--bg) 55%);
            color: var(--text);
            min-height: 100vh;
            padding: 20px;
        }
        .wrap {
            max-width: 980px;
            margin: 0 auto;
        }
        h1 {
            margin: 0 0 8px;
            font-size: 24px;
        }
        p {
            margin: 0 0 14px;
            color: var(--muted);
        }
        .toolbar {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        button {
            border: 1px solid var(--border);
            background: var(--panel-2);
            color: var(--text);
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
        }
        button:hover {
            border-color: var(--accent);
        }
        .layout {
            display: grid;
            gap: 12px;
            grid-template-columns: 1fr;
        }
        @media (min-width: 900px) {
            .layout {
                grid-template-columns: 1fr 1fr;
            }
        }
        .card {
            border: 1px solid var(--border);
            border-radius: 10px;
            background: color-mix(in srgb, var(--panel) 88%, black 12%);
            overflow: hidden;
        }
        .card h2 {
            margin: 0;
            padding: 10px 12px;
            font-size: 14px;
            border-bottom: 1px solid var(--border);
            background: color-mix(in srgb, var(--panel-2) 90%, black 10%);
        }
        textarea {
            display: block;
            width: 100%;
            min-height: 420px;
            border: 0;
            resize: vertical;
            background: transparent;
            color: var(--text);
            padding: 12px;
            outline: none;
            font-size: 13px;
            line-height: 1.5;
        }
        #logs {
            margin: 0;
            padding: 12px;
            min-height: 420px;
            max-height: 70vh;
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 13px;
            line-height: 1.45;
        }
        .line { margin: 0 0 8px; }
        .info { color: var(--muted); }
        .ok { color: var(--ok); }
        .warn { color: #fbbf24; }
        .error { color: var(--danger); }
        code {
            color: var(--accent);
        }
    </style>
</head>
<body>
    <main class="wrap">
        <h1>Puter Worker Sandbox Playground</h1>
        <p>Use this page to interact with the puter APIs in the same sandbox as your worker.</p>
        <div class="toolbar">
            <button id="run">Run</button>
            <button id="clear">Clear Logs</button>
        </div>
        <section class="layout">
            <article class="card">
                <h2>Code</h2>
                <textarea id="code" spellcheck="false">console.log(JSON.stringify(await puter.kv.list({limit: 100})))</textarea>
            </article>
            <article class="card">
                <h2>Logs</h2>
                <pre id="logs"></pre>
            </article>
        </section>
    </main>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (() => {
            const codeEl = document.getElementById('code');
            const logsEl = document.getElementById('logs');
            const runBtn = document.getElementById('run');
            const clearBtn = document.getElementById('clear');

            const originalConsole = {
                log: console.log.bind(console),
                info: console.info.bind(console),
                warn: console.warn.bind(console),
                error: console.error.bind(console),
            };

            const safeStringify = (value) => {
                if (typeof value === 'string') return value;
                if (value instanceof Error) return value.stack || value.message || String(value);
                try { return JSON.stringify(value, null, 2); }
                catch { return String(value); }
            };

            const appendLog = (level, parts) => {
                const line = document.createElement('div');
                line.className = 'line ' + level;
                line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + parts.map(safeStringify).join(' ');
                logsEl.appendChild(line);
                logsEl.scrollTop = logsEl.scrollHeight;
            };

            ['log', 'info', 'warn', 'error'].forEach((level) => {
                console[level] = (...args) => {
                    appendLog(level === 'log' ? 'ok' : level, args);
                    originalConsole[level](...args);
                };
            });

            window.addEventListener('error', (event) => {
                appendLog('error', [event.error || event.message]);
            });

            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

            runBtn.addEventListener('click', async () => {
                const source = codeEl.value;
                appendLog('info', ['Running...']);
                try {
                    const runInSandbox = new AsyncFunction(source);
                    const result = await runInSandbox.call(window);
                    appendLog('ok', ['Result:', result]);
                } catch (err) {
                    appendLog('error', ['Execution failed:', err]);
                }
            });

            clearBtn.addEventListener('click', () => {
                logsEl.textContent = '';
            });
        })();
    </script>
</body>
</html>
`;

extension.get('/', { noauth: true, subdomain: 'worker-sandbox' }, (req, res) => {
    res.type('html').send(page);
});
