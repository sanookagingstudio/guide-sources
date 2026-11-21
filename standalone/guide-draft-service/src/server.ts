// Standalone HTTP service for `guide-source-draft@1.0.0`.
//
// Dependency-free Node ESM server: no Next.js, no Supabase client, no Postgres
// driver, no outbound network client. It reproduces the live bridge contract
// (`POST/GET /api/bridge/drafts`, `GET /api/bridge/drafts/:id`,
// `POST /api/bridge/drafts/:id/purge`, `GET /api/bridge/health`) over the mock
// file adapter so the contract can be tested in CI with no live connection.
//
// Route flags (all OFF by default) answer an honest 501 LIVE_ADAPTER_NOT_BUILT
// when turned ON, which is the connect-day switch and its rollback path.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  DRAFT_ROUTES,
  GUIDE_SOURCE_DRAFT_CONTRACT,
  QA_PREFIX,
  toDraftInput,
} from "./contract.js";
import { MOCK_ADAPTER, flagEnabled, flagSnapshot, liveStoreUrl, resolveAdapters } from "./adapters.js";
import { checkServiceToken, SERVICE_TOKEN_HEADER } from "./auth.js";

const MAX_BODY_BYTES = 64 * 1024;

const adapters = resolveAdapters(process.env);
if (!adapters) {
  console.error(
    `GUIDE_STANDALONE_REFUSED GUIDE_LIVE_STORE_URL is set (${liveStoreUrl(process.env) ? "configured" : "empty"}); this build runs the ${MOCK_ADAPTER} mock adapter only`
  );
  process.exit(2);
}

const sourceSha = String(process.env.GUIDE_SOURCE_SHA || "unknown");
const serviceToken = String(process.env.GUIDE_SOURCES_SERVICE_TOKEN || "");
const port = Number(process.env.GUIDE_PORT || 0);
const host = String(process.env.GUIDE_HOST || "127.0.0.1");

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body: Json): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const authFailure = (res: ServerResponse, state: "unconfigured" | "unauthorized"): void => {
  if (state === "unconfigured") {
    send(res, 503, { ok: false, code: "BRIDGE_NOT_CONFIGURED", detail: "the service token is not set on this process" });
    return;
  }
  send(res, 401, { ok: false, code: "UNAUTHORIZED" });
};

const liveNotBuilt = (res: ServerResponse, flag: string): void =>
  send(res, 501, {
    ok: false,
    code: "LIVE_ADAPTER_NOT_BUILT",
    flag,
    detail: "the live adapter for this route is not built; turn the flag off to use the mock adapter",
  });

async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function matches(pathname: string, method: string): { route: string; id?: string } | { mismatch: true } | null {
  if (pathname === "/health") return method === "GET" ? { route: "health" } : { mismatch: true };
  if (pathname === "/version") return method === "GET" ? { route: "version" } : { mismatch: true };
  if (pathname === "/api/bridge/health") return method === "GET" ? { route: "bridgeHealth" } : { mismatch: true };
  if (pathname === "/api/bridge/drafts") {
    if (method === "GET") return { route: "drafts.list" };
    if (method === "POST") return { route: "drafts.create" };
    return { mismatch: true };
  }
  const byId = /^\/api\/bridge\/drafts\/([^/]+)$/.exec(pathname);
  if (byId) {
    const id = decodeURIComponent(byId[1]);
    return method === "GET" ? { route: "drafts.get", id } : { mismatch: true };
  }
  const purge = /^\/api\/bridge\/drafts\/([^/]+)\/purge$/.exec(pathname);
  if (purge) {
    const id = decodeURIComponent(purge[1]);
    return method === "POST" ? { route: "drafts.purge", id } : { mismatch: true };
  }
  return null;
}

const server = createServer(async (req, res) => {
  const method = String(req.method || "GET").toUpperCase();
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://standalone.local").pathname.replace(/\/+$/, "") || "/";
  } catch {
    send(res, 400, { ok: false, code: "INVALID_URL" });
    return;
  }

  const matched = matches(pathname, method);
  if (!matched) {
    send(res, 404, { ok: false, code: "NOT_FOUND" });
    return;
  }
  if ("mismatch" in matched) {
    res.setHeader("allow", "GET, POST");
    send(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const header = (name: string): string | undefined => {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  switch (matched.route) {
    case "health":
    case "bridgeHealth": {
      const body: Json = {
        ok: true,
        status: "ok",
        service: "guide-sources-standalone",
        contract: GUIDE_SOURCE_DRAFT_CONTRACT,
        contract_version: GUIDE_SOURCE_DRAFT_CONTRACT,
        adapter: adapters.kind,
        store: adapters.store.kind(),
        live_connections: 0,
        flags: flagSnapshot(process.env),
        at: new Date().toISOString(),
      };
      if (matched.route === "health") body.source_sha = sourceSha;
      send(res, 200, body);
      return;
    }
    case "version": {
      send(res, 200, {
        ok: true,
        service: "guide-sources-standalone",
        contract: GUIDE_SOURCE_DRAFT_CONTRACT,
        contract_version: GUIDE_SOURCE_DRAFT_CONTRACT,
        source_sha: sourceSha,
        adapter: adapters.kind,
        live_connections: 0,
        routes: DRAFT_ROUTES.map((route) => ({ ...route, live_enabled: flagEnabled(process.env, route.live_flag) })),
      });
      return;
    }
    case "drafts.create": {
      const auth = checkServiceToken(header, serviceToken);
      if (auth !== "ok") return authFailure(res, auth);
      if (flagEnabled(process.env, "GUIDE_LIVE_DRAFT_CREATE")) return liveNotBuilt(res, "GUIDE_LIVE_DRAFT_CREATE");

      const body = await readJsonBody(req);
      if (!body.ok) {
        if (body.tooLarge) return send(res, 413, { ok: false, code: "BODY_TOO_LARGE" });
        return send(res, 400, { ok: false, code: "INVALID_JSON", fields: ["body must be JSON"] });
      }
      const input = toDraftInput(body.value);
      if ("error" in input) {
        if (input.error === "secret_material") {
          return send(res, 400, { ok: false, code: "SECRET_MATERIAL_REFUSED", fields: input.fields });
        }
        return send(res, 400, { ok: false, code: "DRAFT_INCOMPLETE", fields: input.fields });
      }
      const store = await adapters.store.put(input.record);
      send(res, 201, {
        ok: true,
        contract: GUIDE_SOURCE_DRAFT_CONTRACT,
        contract_version: GUIDE_SOURCE_DRAFT_CONTRACT,
        draft_id: input.record.draft_id,
        qa: input.record.qa,
        store,
        created_at: input.record.created_at,
        url: `/api/bridge/drafts/${encodeURIComponent(input.record.draft_id)}`,
      });
      return;
    }
    case "drafts.list": {
      const auth = checkServiceToken(header, serviceToken);
      if (auth !== "ok") return authFailure(res, auth);
      if (flagEnabled(process.env, "GUIDE_LIVE_DRAFT_READ")) return liveNotBuilt(res, "GUIDE_LIVE_DRAFT_READ");

      const qaOnly = new URL(req.url || "/", "http://standalone.local").searchParams.get("qa") === "1";
      const drafts = await adapters.store.list(qaOnly);
      send(res, 200, {
        ok: true,
        contract: GUIDE_SOURCE_DRAFT_CONTRACT,
        store: adapters.store.kind(),
        qa_only: qaOnly,
        count: drafts.length,
        drafts: drafts.map((draft) => ({ draft_id: draft.draft_id, qa: draft.qa, title: draft.title, updated_at: draft.updated_at })),
      });
      return;
    }
    case "drafts.get": {
      const auth = checkServiceToken(header, serviceToken);
      if (auth !== "ok") return authFailure(res, auth);
      if (flagEnabled(process.env, "GUIDE_LIVE_DRAFT_READ")) return liveNotBuilt(res, "GUIDE_LIVE_DRAFT_READ");

      const draft = await adapters.store.get(String(matched.id));
      if (!draft) return send(res, 404, { ok: false, code: "DRAFT_NOT_FOUND" });
      send(res, 200, { ok: true, draft });
      return;
    }
    case "drafts.purge": {
      const auth = checkServiceToken(header, serviceToken);
      if (auth !== "ok") return authFailure(res, auth);
      if (flagEnabled(process.env, "GUIDE_LIVE_DRAFT_PURGE")) return liveNotBuilt(res, "GUIDE_LIVE_DRAFT_PURGE");

      const draftId = String(matched.id);
      const draft = await adapters.store.get(draftId);
      if (!draft) return send(res, 404, { ok: false, code: "DRAFT_NOT_FOUND" });
      if (draft.qa !== true || !draft.draft_id.startsWith(QA_PREFIX)) {
        return send(res, 403, {
          ok: false,
          code: "QA_ONLY",
          detail: `only a ${QA_PREFIX}* draft marked qa may be purged`,
        });
      }
      const deleted = await adapters.store.deleteQa(draftId);
      if (!deleted) return send(res, 404, { ok: false, code: "DRAFT_NOT_FOUND" });
      send(res, 200, { ok: true, deleted: true, draft_id: draftId, store: adapters.store.kind() });
      return;
    }
    default:
      send(res, 404, { ok: false, code: "NOT_FOUND" });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  console.log(`GUIDE_STANDALONE_LISTENING http://${host}:${bound}`);
  console.log(`GUIDE_STANDALONE_ADAPTER ${MOCK_ADAPTER} store=${adapters.store.kind()} live_connections=0`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

export { SERVICE_TOKEN_HEADER };
