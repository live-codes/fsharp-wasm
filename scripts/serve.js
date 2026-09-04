const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2]);
const port = parseInt(process.argv[3] || '8080', 10);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.dll': 'application/octet-stream',
    '.br': 'application/octet-stream',
    '.gz': 'application/octet-stream',
    '.dat': 'application/octet-stream',
    '.pdb': 'application/octet-stream',
    '.css': 'text/css; charset=utf-8',
};

http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    // Resolve under root; the leading "." keeps it relative so path.resolve can't escape.
    let filePath = path.resolve(root, '.' + urlPath);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404); res.end('Not found'); return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = types[ext] || 'application/octet-stream';
        if (ext === '.br' || ext === '.gz') {
            // serve .br/.gz with the right Content-Encoding only when requested via content negotiation;
            // for the demo the browser requests uncompressed files, which also exist.
        }
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
        fs.createReadStream(filePath).pipe(res);
    });
}).listen(port, () => {
    console.log(`Serving ${root} on http://localhost:${port}`);
});