/**
 * Tiny PKCE loopback HTTP server used by the ChatGPT OAuth flow.
 *
 * Runs locally on the user's machine on a random port. Listens for a single
 * GET /callback?code=... request, hands the code to the resolver, and
 * shuts itself down.
 */

export interface LoopbackCallback {
  code: string;
  /** Raw `state` query param echoed back by the auth server ("" if absent). */
  state: string;
}

interface ServerHandle {
  port: number;
  close: () => void;
  /**
   * Resolves with the authorization code AND the echoed `state` once the
   * browser hits /callback. The caller MUST compare `state` to the value it
   * generated (CSRF / authorization-code-injection defence, RFC 6749 §10.12).
   */
  waitForCode: () => Promise<LoopbackCallback>;
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

/**
 * I-4 (AUDIT 2026-07-02): close an abandoned loopback server after this
 * long. Without it, a user who starts the OAuth flow and never completes the
 * browser step leaves 127.0.0.1:<port> bound until the next callback or a
 * plugin unload.
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export async function startLoopbackServer(
  preferredPort = 0,
): Promise<ServerHandle> {
  let http: HttpServerModule;
  try {
    http = nodeRequire<HttpServerModule>("http");
  } catch {
    throw new Error(
      "Node http module unavailable. Loopback OAuth requires desktop Obsidian.",
    );
  }

  let resolveCode: ((result: LoopbackCallback) => void) | null = null;
  let rejectCode: ((err: Error) => void) | null = null;
  let idleTimer: number | null = null;
  const clearIdle = () => {
    if (idleTimer !== null) {
      window.clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const codePromise = new Promise<LoopbackCallback>((resolve, reject) => {
    resolveCode = (result) => {
      clearIdle();
      resolve(result);
    };
    rejectCode = (err) => {
      clearIdle();
      reject(err);
    };
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/auth/callback") || url.startsWith("/callback")) {
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
      resolveCode?.({ code, state: params.state ?? "" });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", (err) => reject(err));
    server.listen(preferredPort, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind loopback server");
  }
  const port = addr.port;

  // Arm the idle timeout. Cleared on the first callback (resolve/reject) or on
  // an explicit close(); fires only when the flow is abandoned.
  idleTimer = window.setTimeout(() => {
    rejectCode?.(
      new Error("OAuth loopback timed out (no callback within 5 minutes)."),
    );
    try {
      server.close();
    } catch {
      /* already closing */
    }
  }, IDLE_TIMEOUT_MS);

  return {
    port,
    close: () => {
      clearIdle();
      try {
        server.close();
      } catch (e) {
        console.warn("frontmatter-operator: loopback close failed", e);
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
