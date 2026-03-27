const { createReadStream, existsSync, statSync } = require('node:fs');
const { extname, join, normalize, resolve } = require('node:path');
const { createServer } = require('node:http');

const rootDir = resolve('.');
const host = '127.0.0.1';
const port = 5173;

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon'
};

function safeResolvePath(urlPath) {
    const cleanPath = decodeURIComponent((urlPath || '/').split('?')[0]);
    const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
    const absolutePath = normalize(join(rootDir, relativePath));

    if (!absolutePath.startsWith(rootDir)) {
        return null;
    }

    return absolutePath;
}

const server = createServer((request, response) => {
    const filePath = safeResolvePath(request.url || '/');

    if (!filePath || !existsSync(filePath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('404 Not Found');
        return;
    }

    const fileStat = statSync(filePath);
    if (fileStat.isDirectory()) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('403 Forbidden');
        return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
    console.log(`QuickShakePic running at http://${host}:${port}/`);
    console.log('Press Ctrl+C to stop the server.');
});

