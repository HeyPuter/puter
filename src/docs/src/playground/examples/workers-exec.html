<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workers Exec - Puter.js Playground</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
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
        .success {
            background: #28a745;
        }
        .success:hover {
            background: #218838;
        }
        .warning {
            background: #ffc107;
            color: #212529;
        }
        .warning:hover {
            background: #e0a800;
        }
        .danger {
            background: #dc3545;
        }
        .danger:hover {
            background: #c82333;
        }
        input, textarea, select {
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
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #555;
        }
        .method-selector {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }
        .method-btn {
            padding: 8px 16px;
            border: 2px solid #007bff;
            background: white;
            color: #007bff;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .method-btn.active {
            background: #007bff;
            color: white;
        }
        .method-btn:hover {
            background: #007bff;
            color: white;
        }
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
        }
        .status-success {
            background: #28a745;
        }
        .status-error {
            background: #dc3545;
        }
        .status-pending {
            background: #ffc107;
        }
        .response-info {
            background: #e7f3ff;
            border: 1px solid #b3d9ff;
            border-radius: 4px;
            padding: 10px;
            margin-top: 10px;
            font-size: 14px;
        }
        .response-info .status {
            font-weight: bold;
            margin-right: 10px;
        }
        .response-info .time {
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Workers Exec - Authenticated Requests</h1>
        <p>Test authenticated requests to worker endpoints using <code>puter.workers.exec()</code>.</p>

        <!-- Setup Section -->
        <div class="section">
            <h3>📋 Setup</h3>
            <p>First, create a test worker with the following code:</p>
            <textarea id="workerCode" readonly>// Test worker with authentication
router.get('/api/hello', async (event) => {
    const authHeader = event.request.headers.get('puter-auth');
    return { 
        message: 'Hello from authenticated worker!', 
        authenticated: !!authHeader,
        timestamp: new Date().toISOString() 
    };
});

router.get('/api/user-profile', async (event) => {
    const authHeader = event.request.headers.get('puter-auth');
    if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return { 
        user: 'authenticated-user',
        profile: { name: 'John Doe', email: 'john@example.com' },
        timestamp: new Date().toISOString() 
    };
});

router.post('/api/data', async (event) => {
    const authHeader = event.request.headers.get('puter-auth');
    if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    const body = await event.request.json();
    return { 
        received: body,
        saved: true,
        timestamp: new Date().toISOString() 
    };
});

router.put('/api/settings', async (event) => {
    const authHeader = event.request.headers.get('puter-auth');
    if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    const body = await event.request.json();
    return { 
        updated: body,
        success: true,
        timestamp: new Date().toISOString() 
    };
});

router.delete('/api/resource/:id', async (event) => {
    const authHeader = event.request.headers.get('puter-auth');
    if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    const id = event.params.id;
    return { 
        deleted: id,
        success: true,
        timestamp: new Date().toISOString() 
    };
});

router.get('/api/health', async (event) => {
    return { 
        status: 'healthy',
        uptime: Date.now(),
        timestamp: new Date().toISOString() 
    };
});</textarea>
            <div class="form-group">
                <label>Worker Name:</label>
                <input type="text" id="workerName" placeholder="test-exec-worker" value="test-exec-worker">
            </div>
            <button onclick="createTestWorker()" class="success">🚀 Create Test Worker</button>
            <div id="setupOutput" class="output" style="display: none;"></div>
        </div>

        <!-- Request Builder Section -->
        <div class="section">
            <h3>🔧 Request Builder</h3>
            
            <div class="method-selector">
                <button class="method-btn active" onclick="setMethod('GET')">GET</button>
                <button class="method-btn" onclick="setMethod('POST')">POST</button>
                <button class="method-btn" onclick="setMethod('PUT')">PUT</button>
                <button class="method-btn" onclick="setMethod('DELETE')">DELETE</button>
            </div>

            <div class="form-group">
                <label>Endpoint:</label>
                <input type="text" id="endpoint" placeholder="/api/hello" value="/api/hello">
            </div>

            <div class="form-group" id="bodyGroup" style="display: none;">
                <label>Request Body (JSON):</label>
                <textarea id="requestBody" placeholder='{"key": "value"}'></textarea>
            </div>

            <div class="form-group">
                <label>Headers (optional):</label>
                <textarea id="headers" placeholder='{"Content-Type": "application/json"}'></textarea>
            </div>

            <button onclick="executeRequest()" class="success">🚀 Execute Request</button>
            <button onclick="testAllEndpoints()" class="warning">🧪 Test All Endpoints</button>
            
            <div id="requestOutput" class="output" style="display: none;"></div>
        </div>

        <!-- Quick Tests Section -->
        <div class="section">
            <h3>⚡ Quick Tests</h3>
            <button onclick="testHello()">👋 Test Hello</button>
            <button onclick="testUserProfile()">👤 Test User Profile</button>
            <button onclick="testPostData()">📝 Test POST Data</button>
            <button onclick="testPutSettings()">⚙️ Test PUT Settings</button>
            <button onclick="testDeleteResource()">🗑️ Test DELETE Resource</button>
            <button onclick="testHealth()">🏥 Test Health</button>
            <div id="quickTestsOutput" class="output" style="display: none;"></div>
        </div>

        <!-- Batch Operations Section -->
        <div class="section">
            <h3>📦 Batch Operations</h3>
            <button onclick="runBatchTests()">🔄 Run Batch Tests</button>
            <button onclick="testWithTimeout()">⏱️ Test with Timeout</button>
            <div id="batchOutput" class="output" style="display: none;"></div>
        </div>
    </div>

    <script src="https://js.puter.com/v2/"></script>
    <script>
        let currentMethod = 'GET';
        let workerUrl = '';

        function setMethod(method) {
            currentMethod = method;
            document.querySelectorAll('.method-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            const bodyGroup = document.getElementById('bodyGroup');
            if (method === 'GET' || method === 'DELETE') {
                bodyGroup.style.display = 'none';
            } else {
                bodyGroup.style.display = 'block';
            }
        }

        function showOutput(elementId, content, isError = false) {
            const output = document.getElementById(elementId);
            output.textContent = content;
            output.style.display = 'block';
            output.style.backgroundColor = isError ? '#f8d7da' : '#f8f9fa';
            output.style.borderColor = isError ? '#f5c6cb' : '#e9ecef';
        }

        async function createTestWorker() {
            try {
                const workerName = document.getElementById('workerName').value;
                const workerCode = document.getElementById('workerCode').value;
                
                showOutput('setupOutput', 'Creating test worker...');
                
                const result = await puter.workers.create(workerName, workerCode);
                workerUrl = await puter.workers.get(workerName);
                
                showOutput('setupOutput', `✅ Worker created successfully!\n\nWorker Name: ${workerName}\nWorker URL: ${workerUrl}\n\nYou can now test authenticated requests using puter.workers.exec()`);
            } catch (error) {
                showOutput('setupOutput', `❌ Error creating worker: ${error.message}`, true);
            }
        }

        async function executeRequest() {
            try {
                const endpoint = document.getElementById('endpoint').value;
                const requestBody = document.getElementById('requestBody').value;
                const headersText = document.getElementById('headers').value;
                
                let options = {
                    method: currentMethod
                };
                
                // Parse headers
                if (headersText.trim()) {
                    try {
                        options.headers = JSON.parse(headersText);
                    } catch (e) {
                        throw new Error('Invalid headers JSON format');
                    }
                }
                
                // Add body for POST/PUT requests
                if ((currentMethod === 'POST' || currentMethod === 'PUT') && requestBody.trim()) {
                    try {
                        options.body = requestBody;
                        if (!options.headers) options.headers = {};
                        if (!options.headers['Content-Type']) {
                            options.headers['Content-Type'] = 'application/json';
                        }
                    } catch (e) {
                        throw new Error('Invalid request body JSON format');
                    }
                }
                
                const startTime = Date.now();
                const response = await puter.workers.exec(endpoint, options);
                const endTime = Date.now();
                
                let responseData;
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    responseData = await response.json();
                } else {
                    responseData = await response.text();
                }
                
                const output = `✅ Request executed successfully!

📊 Response Info:
Status: ${response.status} ${response.statusText}
Time: ${endTime - startTime}ms
Content-Type: ${contentType || 'text/plain'}

📤 Request Details:
Method: ${currentMethod}
Endpoint: ${endpoint}
Headers: ${JSON.stringify(options.headers || {}, null, 2)}

📥 Response Data:
${JSON.stringify(responseData, null, 2)}`;
                
                showOutput('requestOutput', output);
            } catch (error) {
                showOutput('requestOutput', `❌ Error executing request: ${error.message}`, true);
            }
        }

        async function testHello() {
            try {
                const response = await puter.workers.exec('/api/hello');
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ Hello Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ Hello Test Failed: ${error.message}`, true);
            }
        }

        async function testUserProfile() {
            try {
                const response = await puter.workers.exec('/api/user-profile');
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ User Profile Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ User Profile Test Failed: ${error.message}`, true);
            }
        }

        async function testPostData() {
            try {
                const testData = { message: 'Hello from exec!', timestamp: Date.now() };
                const response = await puter.workers.exec('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(testData)
                });
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ POST Data Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ POST Data Test Failed: ${error.message}`, true);
            }
        }

        async function testPutSettings() {
            try {
                const settings = { theme: 'dark', notifications: true, language: 'en' };
                const response = await puter.workers.exec('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ PUT Settings Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ PUT Settings Test Failed: ${error.message}`, true);
            }
        }

        async function testDeleteResource() {
            try {
                const response = await puter.workers.exec('/api/resource/123', {
                    method: 'DELETE'
                });
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ DELETE Resource Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ DELETE Resource Test Failed: ${error.message}`, true);
            }
        }

        async function testHealth() {
            try {
                const response = await puter.workers.exec('/api/health');
                const data = await response.json();
                showOutput('quickTestsOutput', `✅ Health Test:\n${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                showOutput('quickTestsOutput', `❌ Health Test Failed: ${error.message}`, true);
            }
        }

        async function testAllEndpoints() {
            const tests = [
                { name: 'Hello', func: testHello },
                { name: 'User Profile', func: testUserProfile },
                { name: 'POST Data', func: testPostData },
                { name: 'PUT Settings', func: testPutSettings },
                { name: 'DELETE Resource', func: testDeleteResource },
                { name: 'Health', func: testHealth }
            ];
            
            let results = [];
            for (const test of tests) {
                try {
                    await test.func();
                    results.push(`✅ ${test.name}: Passed`);
                } catch (error) {
                    results.push(`❌ ${test.name}: Failed - ${error.message}`);
                }
            }
            
            showOutput('quickTestsOutput', `🧪 All Endpoints Test Results:\n\n${results.join('\n')}`);
        }

        async function runBatchTests() {
            try {
                const operations = [
                    { endpoint: '/api/hello', method: 'GET' },
                    { endpoint: '/api/user-profile', method: 'GET' },
                    { endpoint: '/api/health', method: 'GET' }
                ];
                
                const results = await Promise.allSettled(
                    operations.map(op => puter.workers.exec(op.endpoint, { method: op.method }))
                );
                
                const successful = results.filter(r => r.status === 'fulfilled');
                const failed = results.filter(r => r.status === 'rejected');
                
                let output = `📦 Batch Operations Results:\n\n`;
                output += `Completed: ${successful.length}/${operations.length} operations\n`;
                output += `Failed: ${failed.length} operations\n\n`;
                
                if (failed.length > 0) {
                    output += `Failed operations:\n`;
                    failed.forEach((f, i) => {
                        output += `${i + 1}. ${f.reason.message}\n`;
                    });
                }
                
                showOutput('batchOutput', output);
            } catch (error) {
                showOutput('batchOutput', `❌ Batch test failed: ${error.message}`, true);
            }
        }

        async function testWithTimeout() {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const startTime = Date.now();
                const response = await puter.workers.exec('/api/health', {
                    signal: controller.signal
                });
                const endTime = Date.now();
                
                clearTimeout(timeoutId);
                
                const data = await response.json();
                showOutput('batchOutput', `⏱️ Timeout Test (3s):\n\nResponse time: ${endTime - startTime}ms\nData: ${JSON.stringify(data, null, 2)}`);
            } catch (error) {
                if (error.name === 'AbortError') {
                    showOutput('batchOutput', `⏱️ Timeout Test: Request timed out after 3 seconds`, true);
                } else {
                    showOutput('batchOutput', `❌ Timeout Test Failed: ${error.message}`, true);
                }
            }
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Workers Exec Playground loaded');
        });
    </script>
</body>
</html> 