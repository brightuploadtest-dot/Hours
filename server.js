const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const DB_FILE = path.join(__dirname, 'database.json');

// MIME types dictionary for static file server
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    // Enable CORS to support direct wireless API requests from phones on the local network
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 1. API GET Endpoint: Fetch central synced database state
    if (req.url === '/api/sync' && req.method === 'GET') {
        if (fs.existsSync(DB_FILE)) {
            fs.readFile(DB_FILE, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to read database' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(data);
                }
            });
        } else {
            // Safe fallback when database file doesn't exist yet
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ periods: [], activePeriodId: '' }));
        }
        return;
    }

    // 2. API POST Endpoint: Write/Update central synced database state
    if (req.url === '/api/sync' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                // Assert valid JSON syntax to block database corruption
                JSON.parse(body);
                fs.writeFile(DB_FILE, body, 'utf8', (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to write database' }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                });
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            }
        });
        return;
    }

    // 3. Static File Server Route
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    
    // Defensive directory traversal path injection guard
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Access Denied');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 Not Found');
            } else {
                res.writeHead(500);
                res.end('500 Internal Error');
            }
        } else {
            const headers = { 'Content-Type': contentType };
            if (req.url.endsWith('service-worker.js')) {
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
            }
            res.writeHead(200, headers);
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`🚀 CLIENT HOUR TRACKER - ZERO-DEPENDENCY SYNC SERVER`);
    console.log(`==================================================`);
    console.log(`💻 Local URL:   http://localhost:${PORT}/`);
    console.log(`📱 Mobile URL:  http://192.168.4.23:${PORT}/`);
    console.log(`📁 Database:    ${DB_FILE}`);
    console.log(`==================================================`);
    console.log(`Server is running and listening for sync requests...`);
});
