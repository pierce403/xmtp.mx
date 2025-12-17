import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', 'out');
const port = Number(process.env.PORT || 3000);

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function toSafeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.posix.normalize(decoded);
  const withoutTraversal = normalized.replace(/^(\.\.(\/|\\|$))+/, '');
  return withoutTraversal;
}

async function resolveFilePath(pathname) {
  const safePath = toSafeFilePath(pathname);
  let filePath = path.join(rootDir, safePath);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    return filePath;
  } catch {
    // try appending index.html for paths without an extension
    if (!path.extname(filePath)) {
      const indexPath = path.join(filePath, 'index.html');
      try {
        await stat(indexPath);
        return indexPath;
      } catch {
        // fall through
      }
    }

    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = await resolveFilePath(pathname);
  const finalPath = filePath ?? (await resolveFilePath('/404.html'));

  if (!finalPath) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = path.extname(finalPath).toLowerCase();
  res.setHeader('Content-Type', mimeByExt[ext] || 'application/octet-stream');
  res.statusCode = filePath ? 200 : 404;

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(finalPath);
  stream.on('error', () => {
    res.statusCode = 500;
    res.end('Internal Server Error');
  });
  stream.pipe(res);
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving ${rootDir} at http://localhost:${port}`);
});

