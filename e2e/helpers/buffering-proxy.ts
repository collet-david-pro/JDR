import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { main } from './env';

/**
 * HTTP proxy to the E2E server that behaves like a host which buffers responses (projet.md 10.3):
 * - `buffer`: a text/event-stream response is accumulated and only sent when upstream ends it
 *   (the server closes a stream after 25 s): the client sees silence, then everything at once;
 * - `cut`: same, and any request lasting more than `cutAfterMs` (10 s) is cut (truncated response, then reset).
 * Cookies, methods, headers and bodies pass through unchanged.
 */
export type ProxyMode = 'buffer' | 'cut';

export interface BufferingProxy {
  readonly baseURL: string;
  mode: ProxyMode | 'pass';
  close(): Promise<void>;
}

export async function startBufferingProxy(
  initial: ProxyMode | 'pass' = 'buffer',
  cutAfterMs = 10_000,
): Promise<BufferingProxy> {
  const sockets = new Set<Socket>();
  const proxy: BufferingProxy = {
    baseURL: '',
    mode: initial,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: main.port, method: req.method, path: req.url, headers: req.headers },
      (up) => {
        const stream = String(up.headers['content-type'] ?? '').startsWith('text/event-stream');
        if (!stream || proxy.mode === 'pass') {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        up.on('data', (c: Buffer) => chunks.push(c));
        up.on('end', () => {
          const headers = { ...up.headers };
          delete headers['transfer-encoding'];
          const body = Buffer.concat(chunks);
          headers['content-length'] = String(body.length);
          res.writeHead(up.statusCode ?? 502, headers);
          res.end(body);
        });
        up.on('error', () => res.destroy());
      },
    );
    upstream.on('error', () => res.destroy());
    res.on('close', () => upstream.destroy());
    const timer = setTimeout(() => {
      if (proxy.mode === 'cut') {
        upstream.destroy();
        if (res.headersSent) {
          req.socket.destroy();
          return;
        }
        // Headers and a truncated body, then a reset: Firefox and WebKit silently retry a request
        // that dies before any response byte, which would hide the cut from the client.
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
        res.write('{"data"');
        setTimeout(() => req.socket.destroy(), 50);
      }
    }, cutAfterMs);
    res.on('close', () => clearTimeout(timer));
    req.pipe(upstream);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  (proxy as { baseURL: string }).baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return proxy;
}
