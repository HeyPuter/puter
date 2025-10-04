<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workers Management - Puter.js Playground</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
        }
        .section h3 {
            margin-top: 0;
            color: #555;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
            font-size: 14px;
        }
        button:hover {
            background: #0056b3;
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .danger {
            background: #dc3545;
        }
        .danger:hover {
            background: #c82333;
        }
        .success {
            background: #28a745;
        }
        .success:hover {
            background: #218838;
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            margin: 5px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
        }
        textarea {
            height: 120px;
            resize: vertical;
        }
        .output {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
            margin-top: 10px;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
        .worker-list {
            display: grid;
            gap: 10px;
        }
        .worker-item {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
        }
        .worker-name {
            font-weight: bold;
            color: #333;
        }
        .worker-url {
            color: #007bff;
            text-decoration: none;
            font-size: 14px;
        }
        .worker-url:hover {
            text-decoration: underline;
        }
        .worker-details {
            font-size: 12px;
            color: #666;
            margin-top: 5px;
        }
        .status {
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
        }
        .status.success {
            background: #d4edda;
            color: #155724;
        }
        .status.error {
            background: #f8d7da;
            color: #721c24;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔄 Workers Management</h1>
        <p>Manage your serverless workers with the Puter.js Workers API.</p>

        <!-- Create Worker Section -->
        <div class="section">
            <h3>Create New Worker</h3>
            <div>
                <label>Worker Name:</label>
                <input type="text" id="workerName" placeholder="my-api-worker" value="test-worker">
            </div>
            <div>
                <label>Worker Code:</label>
                <textarea id="workerCode">// Simple worker with routers
router.get('/api/hello', async (event) => {
    return { message: 'Hello from worker!', timestamp: new Date().toISOString() };
});

router.get('/api/health', async (event) => {
    return { status: 'ok', uptime: Date.now() };
});

router.post('/api/echo', async (event) => {
    const body = await event.request.json();
    return { received: body, echoed: true };
});

router.get('/api/random', async (event) => {
    return { number: Math.floor(Math.random() * 1000) };
});</textarea>
            </div>
            <button onclick="createWorker()" class="success">🚀 Create Worker</button>
            <div id="createOutput" class="output" style="display: none;"></div>
        </div>

        <!-- List Workers Section -->
        <div class="section">
            <h3>List All Workers</h3>
            <button onclick="listWorkers()">📋 List Workers</button>
            <div id="workersList" class="worker-list"></div>
        </div>

        <!-- Get Worker URL Section -->
        <div class="section">
            <h3>Get Worker URL</h3>
            <div>
                <label>Worker Name:</label>
                <input type="text" id="getWorkerName" placeholder="worker-name">
            </div>
            <button onclick="getWorkerUrl()">🔗 Get URL</button>
            <div id="getOutput" class="output" style="display: none;"></div>
        </div>

        <!-- Delete Worker Section -->
        <div class="section">
            <h3>Delete Worker</h3>
            <div>
                <label>Worker Name:</label>
                <input type="text" id="deleteWorkerName" placeholder="worker-name">
            </div>
            <button onclick="deleteWorker()" class="danger">🗑️ Delete Worker</button>
            <div id="deleteOutput" class="output" style="display: none;"></div>
        </div>

        <!-- Test Worker Section -->
        <div class="section">
            <h3>Test Worker</h3>
            <div>
                <label>Worker URL:</label>
                <input type="text" id="testWorkerUrl" placeholder="https://worker-name.puter.site">
            </div>
            <button onclick="testWorker()">🧪 Test Worker</button>
            <div id="testOutput" class="output" style="display: none;"></div>
        </div>
    </div>

    <script>
        let currentWorkers = {};

        // Create a new worker
        async function createWorker() {
            const name = document.getElementById('workerName').value.trim();
            const code = document.getElementById('workerCode').value.trim();
            const output = document.getElementById('createOutput');

            if (!name || !code) {
                showOutput(output, 'Please provide both worker name and code.', 'error');
                return;
            }

            try {
                // Save the worker code to a file in your Puter account
                const fileName = `${name}.js`;
                await puter.fs.write(fileName, code);

                // Create the worker using the file path
                const result = await puter.workers.create(name, fileName);
                
                showOutput(output, `✅ Worker created successfully!\n\nURL: ${result.url}\n\nYou can now test your worker at the URL above.`, 'success');
                
                // Refresh the workers list
                await listWorkers();
                
            } catch (error) {
                showOutput(output, `❌ Failed to create worker:\n${error.message}`, 'error');
            }
        }

        // List all workers
        async function listWorkers() {
            const container = document.getElementById('workersList');
            
            try {
                currentWorkers = await puter.workers.list();
                
                if (Object.keys(currentWorkers).length === 0) {
                    container.innerHTML = '<p>No workers found. Create your first worker above!</p>';
                    return;
                }

                container.innerHTML = '';
                
                Object.entries(currentWorkers).forEach(([name, details]) => {
                    const deployDate = new Date(details.deployTime * 1000);
                    const timeAgo = getTimeAgo(deployDate);
                    
                    const workerDiv = document.createElement('div');
                    workerDiv.className = 'worker-item';
                    workerDiv.innerHTML = `
                        <div class="worker-name">${name}</div>
                        <a href="${details.url}" target="_blank" class="worker-url">${details.url}</a>
                        <div class="worker-details">
                            Source: ${details.filePath}<br>
                            Deployed: ${deployDate.toLocaleString()} (${timeAgo})
                        </div>
                        <button onclick="testSpecificWorker('${name}', '${details.url}')" style="margin-top: 10px;">Test</button>
                        <button onclick="deleteSpecificWorker('${name}')" class="danger" style="margin-top: 10px;">Delete</button>
                    `;
                    container.appendChild(workerDiv);
                });
                
            } catch (error) {
                container.innerHTML = `<p>❌ Error listing workers: ${error.message}</p>`;
            }
        }

        // Get worker URL
        async function getWorkerUrl() {
            const name = document.getElementById('getWorkerName').value.trim();
            const output = document.getElementById('getOutput');

            if (!name) {
                showOutput(output, 'Please provide a worker name.', 'error');
                return;
            }

            try {
                const url = await puter.workers.get(name);
                showOutput(output, `✅ Worker URL: ${url}`, 'success');
            } catch (error) {
                showOutput(output, `❌ Error: ${error.message}`, 'error');
            }
        }

        // Delete a worker
        async function deleteWorker() {
            const name = document.getElementById('deleteWorkerName').value.trim();
            const output = document.getElementById('deleteOutput');

            if (!name) {
                showOutput(output, 'Please provide a worker name.', 'error');
                return;
            }

            if (!confirm(`Are you sure you want to delete worker "${name}"? This action cannot be undone.`)) {
                return;
            }

            try {
                await puter.workers.delete(name);
                showOutput(output, `✅ Worker "${name}" deleted successfully.`, 'success');
                
                // Refresh the workers list
                await listWorkers();
                
            } catch (error) {
                showOutput(output, `❌ Failed to delete worker: ${error.message}`, 'error');
            }
        }

        // Test a worker
        async function testWorker() {
            const url = document.getElementById('testWorkerUrl').value.trim();
            const output = document.getElementById('testOutput');

            if (!url) {
                showOutput(output, 'Please provide a worker URL.', 'error');
                return;
            }

            try {
                const results = {};
                
                // Test different endpoints
                const endpoints = [
                    { path: '/api/hello', method: 'GET' },
                    { path: '/api/health', method: 'GET' },
                    { path: '/api/random', method: 'GET' },
                    { path: '/api/echo', method: 'POST', body: { test: 'data', timestamp: Date.now() } }
                ];

                for (const endpoint of endpoints) {
                    try {
                        const response = await fetch(`${url}${endpoint.path}`, {
                            method: endpoint.method,
                            headers: endpoint.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
                            body: endpoint.body ? JSON.stringify(endpoint.body) : undefined
                        });
                        
                        const data = await response.json();
                        results[endpoint.path] = { status: response.status, data };
                    } catch (error) {
                        results[endpoint.path] = { error: error.message };
                    }
                }

                showOutput(output, `🧪 Test Results for ${url}:\n\n${JSON.stringify(results, null, 2)}`, 'success');
                
            } catch (error) {
                showOutput(output, `❌ Test failed: ${error.message}`, 'error');
            }
        }

        // Test a specific worker by name
        async function testSpecificWorker(name, url) {
            document.getElementById('testWorkerUrl').value = url;
            await testWorker();
        }

        // Delete a specific worker by name
        async function deleteSpecificWorker(name) {
            document.getElementById('deleteWorkerName').value = name;
            await deleteWorker();
        }

        // Helper function to show output
        function showOutput(element, message, type = 'success') {
            element.style.display = 'block';
            element.textContent = message;
            element.className = `output ${type}`;
        }

        // Helper function to get time ago
        function getTimeAgo(date) {
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return `${diffDays} days ago`;
            if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
            return `${Math.floor(diffDays / 30)} months ago`;
        }

        // Initialize the page
        window.addEventListener('load', async () => {
            await listWorkers();
        });
    </script>
</body>
</html> 