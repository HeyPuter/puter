/* eslint-disable @stylistic/indent */
const { db } = extension.import('data');

extension.on('init', async () => {
    console.log('Initializing Example DB extension');

    try {
        // The "CREATE TABLE IF NOT EXIST" pattern is sometimes appropriate
        // for extensions.
        await db.write(`
            CREATE TABLE IF NOT EXISTS example_extension_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL,
                value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, []);
        console.log('Example table created or already exists');

        // Create some sample data once during initialization
        const existingData = await db.read('SELECT COUNT(*) as count FROM example_extension_data');
        if ( existingData[0].count === 0 ) {
            await db.write(`
                INSERT INTO example_extension_data (name, value) VALUES 
                (?, ?), (?, ?), (?, ?)
            `, [
                'sample-1', 'This is sample data created during extension initialization',
                'sample-2', 'Database operations are working correctly',
                'sample-3', `Created at ${new Date().toISOString()}`,
            ]);
            console.log('Sample data created');
        }
    // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
    } catch (error) {
        console.error('Error creating example table:', error);
    }
});

// The /example-db endpoint shows sample data.
extension.get('/example-db', { noauth: true }, async (req, res) => {
    const su = extension.import('service:su');

    await su.sudo(async () => {
        try {
            res.set('Content-Type', 'text/plain');

            const exampleData = await db.read(
                'SELECT * FROM example_extension_data ORDER BY created_at DESC LIMIT 5',
            );

            let response = '=== Example DB Extension Demo ===\n\n';
            response += '=== Example Table Data (last 5 records) ===\n';
            exampleData.forEach(row => {
                response += `ID: ${row.id}, Name: ${row.name}, Value: ${row.value}, Created: ${row.created_at}\n`;
            });

            res.send(response);

        // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
        } catch (error) {
            console.error('Database operation error:', error);
            res.status(500).send(`Database error: ${error.message}`);
        }
    });
});

// The /example-db/cleanup endpoint erases sample data.
extension.get('/example-db/cleanup', async (req, res) => {
    const su = extension.import('service:su');

    await su.sudo(async () => {
        try {
            res.set('Content-Type', 'text/plain');

            // Clean up old test data (older than 1 hour) - only sample data
            const deleteResult = await db.write(
                'DELETE FROM example_extension_data WHERE name LIKE "sample-%" AND created_at < datetime("now", "-1 hour")',
                [],
            );

            res.send(`Cleaned up ${deleteResult.anyRowsAffected ? 'some' : 'no'} old sample records`);

        // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
        } catch (error) {
            console.error('Cleanup error:', error);
            res.status(500).send(`Cleanup error: ${error.message}`);
        }
    });
});

// The /example-db/search endpoint searches data based on the "q" query parameter.
//
// For example, try one of these:
// - GET /example-db/search?q=3
// - GET /example-db/search?q=sam
extension.get('/example-db/search', { noauth: true }, async (req, res) => {
    const su = extension.import('service:su');

    await su.sudo(async () => {
        try {
            res.set('Content-Type', 'text/plain');

            // Get search term from query parameter (safely parameterized)
            const searchTerm = req.query.q ?? 'test';
            if ( typeof searchTerm !== 'string' ) {
                res.status(400).send('Not like that - only strings please!');
                return;
            }

            // Safe parameterized search - prevents SQL injection
            const searchResults = await db.read(
                'SELECT * FROM example_extension_data WHERE name LIKE ? OR value LIKE ? ORDER BY created_at DESC LIMIT 10',
                [`%${searchTerm}%`, `%${searchTerm}%`],
            );

            let response = `=== Search Results for "${searchTerm}" ===\n\n`;
            if ( searchResults.length === 0 ) {
                response += 'No results found.\n';
            } else {
                searchResults.forEach(row => {
                    response += `ID: ${row.id}, Name: ${row.name}, Value: ${row.value}\n`;
                });
            }

            res.send(response);

        // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
        } catch (error) {
            console.error('Search error:', error);
            res.status(500).send(`Search error: ${error.message}`);
        }
    });
});

// /example-db/stats shows some stats that might be interesting
//
// This is only enabled in development environments to prevent abuse.
//
// eslint-disable-next-line no-undef
if ( global_config.env === 'dev' ) {
    extension.get('/example-db/stats', { noauth: true }, async (req, res) => {
        const su = extension.import('service:su');

        await su.sudo(async () => {
            try {
                res.set('Content-Type', 'application/json');

                const stats = {
                    apps: await db.read('SELECT COUNT(*) as count FROM apps'),
                    users: await db.read('SELECT COUNT(*) as count FROM user'),
                    sessions: await db.read('SELECT COUNT(*) as count FROM sessions'),
                    fsentries: await db.read('SELECT COUNT(*) as count FROM fsentries'),
                    notifications: await db.read('SELECT COUNT(*) as count FROM notification'),
                    example_records: await db.read('SELECT COUNT(*) as count FROM example_extension_data'),
                };

                const result = {};
                for ( const [key, value] of Object.entries(stats) ) {
                    result[key] = value[0].count;
                }

                res.json(result);

            // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
            } catch (error) {
                console.error('Stats error:', error);
                res.status(500).json({ error: error.message });
            }
        });
    });

    // /example-db/add-data shows a simple HTML form for adding test data.
    //
    // The form itself is simply to aid in demonstration purposes rather than
    // being an example for building a form, so it is terse, uncommented, and
    // was generated by a robot.
    extension.get('/example-db/add-data', { noauth: true }, async (req, res) => {
        res.set('Content-Type', 'text/html');
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Add Test Data - Example DB</title>
</head>
<body>
    <h1>Add Test Data to Example DB</h1>
    <form id="dataForm">
        <div id="rows">
            <div class="row">
                <input type="text" name="name" placeholder="Name" required>
                <input type="text" name="value" placeholder="Value" required>
                <button type="button" onclick="removeRow(this)">Remove</button>
            </div>
        </div>
        <button type="button" onclick="addRow()">Add Row</button>
        <br><br>
        <button type="button" onclick="submitData()">Submit All Data</button>
    </form>

    <script>
        function addRow() {
            const rows = document.getElementById('rows');
            const newRow = document.createElement('div');
            newRow.className = 'row';
            newRow.innerHTML = \`
                <input type="text" name="name" placeholder="Name" required>
                <input type="text" name="value" placeholder="Value" required>
                <button type="button" onclick="removeRow(this)">Remove</button>
            \`;
            rows.appendChild(newRow);
        }
        function removeRow(button) {
            if (document.querySelectorAll('.row').length > 1) {
                button.parentElement.remove();
            }
        }
        async function submitData() {
            const form = document.getElementById('dataForm');
            const formData = new FormData(form);
            const data = { name: [], value: [] };
            const nameInputs = form.querySelectorAll('input[name="name"]');
            const valueInputs = form.querySelectorAll('input[name="value"]');
            for (let i = 0; i < nameInputs.length; i++) {
                if (nameInputs[i].value.trim() && valueInputs[i].value.trim()) {
                    data.name.push(nameInputs[i].value.trim());
                    data.value.push(valueInputs[i].value.trim());
                }
            }
            if (data.name.length === 0) {
                alert('Please enter at least one row of data');
                return;
            }
            try {
                const response = await fetch('/example-db/add-data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                if (response.ok) {
                    const result = await response.text();
                    document.body.innerHTML = result;
                } else {
                    const error = await response.text();
                    alert('Error: ' + error);
                }
            } catch (error) {
                alert('Error submitting data: ' + error.message);
            }
        }
    </script>
</body>
</html>
        `);
    });

    // The POST handler for /example-db/add-data demonstrates adding some rows
    extension.post('/example-db/add-data', { noauth: true }, async (req, res) => {
        const su = extension.import('service:su');

        await su.sudo(async () => {
            try {
                const names = req.body.name || [];
                const values = req.body.value || [];

                if ( !Array.isArray(names) || !Array.isArray(values) || names.length !== values.length ) {
                    res.status(400).send('Invalid form data');
                    return;
                }

                if ( names.length === 0 ) {
                    res.status(400).send('No data to insert');
                    return;
                }

                // Build parameterized query for multiple inserts
                const placeholders = names.map(() => '(?, ?)').join(', ');
                const params = [];
                for ( let i = 0; i < names.length; i++ ) {
                    params.push(names[i], values[i]);
                }

                await db.write(
                    `INSERT INTO example_extension_data (name, value) VALUES ${placeholders}`,
                    params,
                );

                res.set('Content-Type', 'text/html');
                res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Data Added - Example DB</title>
</head>
<body>
    <h1>Success!</h1>
    <p>Added ${names.length} record(s) to the database.</p>
    <a href="/example-db/add-data">Add More Data</a> | 
    <a href="/example-db">View Data</a>
</body>
</html>
                `);

            // eslint-disable-next-line @stylistic/space-before-function-paren, custom/control-structure-spacing
            } catch (error) {
                console.error('Add data error:', error);
                res.status(500).send(`Error adding data: ${error.message}`);
            }
        });
    });
}