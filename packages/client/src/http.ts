// The only module that knows how a request is shaped: base-URL joining, JSON parsing, and turning
// a non-2xx reply into a PerchError. Every resource module below is just a list of routes over this.

import { NETWORK, NOT_API, PerchError, type ApiErrorBody } from "./errors";

/**
 * Narrower than `typeof fetch` on purpose: we only ever pass a string URL, so a hand-written
 * fake (a test, a Tauri build) satisfies it without reproducing the whole DOM signature.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ClientOptions = {
  /** Origin the server is on, e.g. `http://127.0.0.1:4600`. A trailing slash is fine. */
  baseUrl: string;
  /** Injected so tests can fake the network and a Tauri build can use its own transport. */
  fetch?: FetchLike;
};

/** Every method takes one of these, so a React effect can cancel its request on unmount. */
export type CallOptions = { signal?: AbortSignal };

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type RequestOptions = CallOptions & {
  method?: string;
  query?: QueryParams;
  /** Sent as a JSON body; `undefined` means no body at all. */
  body?: unknown;
  /** Overridden by the NDJSON and SSE routes. */
  accept?: string;
};

export type Transport = {
  readonly baseUrl: string;
  url(path: string, query?: QueryParams): string;
  /** Resolves only on a 2xx; the body is left unread for the streaming routes. */
  send(path: string, options?: RequestOptions): Promise<Response>;
  json<T>(path: string, options?: RequestOptions): Promise<T>;
};

export function searchString(query?: QueryParams): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** `baseUrl` may or may not end in a slash, and may carry a path prefix; both must work. */
export function joinUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return base + suffix + searchString(query);
}

/** An abort is the caller's own doing, so it propagates as-is rather than becoming a PerchError. */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Whether a reply came from something other than this API: a dev server's 404 page, a proxy's
 * error page, a captive portal. Their bodies are HTML, and pasting a page of markup into an error
 * message buries the one fact that matters — the status — under 500 characters of `<!DOCTYPE`.
 */
function looksLikeHtml(response: Response, text: string): boolean {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;
  return /^\s*<(?:!doctype|html|\?xml)\b/i.test(text);
}

async function errorFor(response: Response, route: string): Promise<PerchError> {
  let text = "";
  try {
    text = await response.text();
  } catch {
    /* a body that failed mid-read tells us nothing the status does not */
  }
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const api = body as Partial<ApiErrorBody> | undefined;
  const status = `${response.status} ${response.statusText || "request failed"}`;
  const html = body === undefined && looksLikeHtml(response, text);
  // Prefer the server's own message; fall back to a short plain-text body, then the status. An
  // HTML page is not a message — it is evidence that whatever answered is not this API, which the
  // `not_api` code says in a form a caller can branch on.
  let message = api?.error?.message;
  if (!message && body === undefined && !html && text.trim() !== "") {
    message = text.trim().slice(0, 500);
  }
  if (!message) message = html ? `${status} (an HTML page, not this API)` : status;
  return new PerchError(message, {
    status: response.status,
    route,
    code: api?.error?.code ?? (html ? NOT_API : undefined),
    body,
  });
}

export function createTransport(options: ClientOptions): Transport {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  // Read off globalThis at call time: a page that polyfills fetch late still works.
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function send(path: string, opts: RequestOptions = {}): Promise<Response> {
    const method = opts.method ?? "GET";
    const route = `${method} ${path}`;
    const headers: Record<string, string> = { Accept: opts.accept ?? "application/json" };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;

    let response: Response;
    try {
      response = await doFetch(joinUrl(baseUrl, path, opts.query), init);
    } catch (err) {
      if (isAbort(err, opts.signal)) throw err;
      const message = err instanceof Error ? err.message : "the request failed";
      throw new PerchError(message, { status: 0, route, code: NETWORK, cause: err });
    }
    if (!response.ok) throw await errorFor(response, route);
    return response;
  }

  async function json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const response = await send(path, opts);
    const text = await response.text();
    if (text.trim() === "") return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new PerchError("the reply was not JSON", {
        status: response.status,
        route: `${opts.method ?? "GET"} ${path}`,
        code: NOT_API,
        cause: err,
      });
    }
  }

  return {
    baseUrl,
    url: (path, query) => joinUrl(baseUrl, path, query),
    send,
    json,
  };
}
