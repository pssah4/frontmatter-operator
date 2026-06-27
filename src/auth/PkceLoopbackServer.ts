/**
 * Tiny PKCE loopback HTTP server used by the ChatGPT OAuth flow.
 *
 * Runs locally on the user's machine on a random port. Listens for a single
 * GET /callback?code=... request, hands the code to the resolver, and
 * shuts itself down.
 */

import { Notice } from "obsidian";

interface ServerHandle {
  port: number;
  close: () => void;
  /** Resolves with the authorization code once the browser hits /callback. */
  waitForCode: () => Promise<string>;
}

interface HttpServerModule {
  createServer: (
    handler: (
      req: { url?: string },
      res: {
        writeHead: (status: number, headers?: Record<string, string>) => void;
        end: (body?: string) => void;
      },
    ) => void,
  ) => {
    listen: (port: number, host: string, cb?: () => void) => void;
    close: (cb?: () => void) => void;
    address: () => { port: number } | string | null;
    on: (event: string, handler: (err: Error) => void) => void;
  };
}

function nodeRequire<T = unknown>(id: string): T {
  return (window as unknown as { require: (id: string) => T }).require(id);
}

export async function startLoopbackServer(): Promise<ServerHandle> {
  let http: HttpServerModule;
  try {
    http = nodeRequire<HttpServerModule>("http");
  } catch (err) {
    throw new Error(
      "Node http module unavailable. Loopback OAuth requires desktop Obsidian.",
    );
  }

  let resolveCode: ((code: string) => void) | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/callback")) {
      const params = parseQuery(url.split("?")[1] ?? "");
      const code = params.code;
      const error = params.error;
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>OAuth error</h1><p>${escapeHtml(error)}</p>`);
        rejectCode?.(new Error(error));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>OAuth error</h1><p>missing code</p>`);
        rejectCode?.(new Error("missing code"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<h1>Authorized</h1><p>You can close this tab and return to Obsidian.</p>`,
      );
      resolveCode?.(code);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", (err) => reject(err));
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind loopback server");
  }
  const port = addr.port;

  return {
    port,
    close: () => {
      try {
        server.close();
      } catch (e) {
        console.warn("frontmatter-editor: loopback close failed", e);
      }
    },
    waitForCode: () => codePromise,
  };
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
