/**
 * Secrets audit (DailyPlan Day 46 — Week 7 security pass).
 *
 * "Confirm no service-role key or AI key reaches the client bundle;
 *  `.env.example` complete. DoD: secrets server-only; documented."
 *
 * The third Week-7 audit, after Day 43 (RLS, the DB-layer tenancy posture) and
 * Day 44 (authz, the HTTP-layer identity posture). This one proves the SECRETS
 * posture: credential env vars (the Supabase service-role key, the AI API key)
 * are read only in server-side modules and can never be pulled into the browser
 * bundle, and `.env.example` documents exactly the env surface the code uses
 * with placeholder (never real) values (Rules.md §4).
 *
 * Everything here is pure and node-testable so the invariant is provable offline
 * with no Next build, no bundler, and no live credential. Four surfaces:
 *
 *  1. An ENV-VAR INVENTORY (`ENV_VAR_POSTURE`) — the single source of truth for
 *     every env var the app uses and its exposure: `public` (a `NEXT_PUBLIC_*`
 *     var, safe to inline into the browser bundle) or `server` (server-only),
 *     and whether a server var is a `secret` (a credential — the service-role
 *     key, the AI key). The test reconciles this against `.env.example` so a new
 *     key cannot ship undocumented (the same drift guard as Day 43's
 *     `POLICY_POSTURE` and Day 44's endpoint inventory).
 *
 *  2. A `.env.example` AUDIT (`parseEnvFile` / `auditEnvExample`) — parses the
 *     committed example file and enforces: it documents every inventoried key
 *     (and no stale/extra ones), each key's `NEXT_PUBLIC_` prefix matches its
 *     declared exposure, and no value looks like a real secret
 *     (`envValueLooksLikeSecret`) — only placeholders belong in a committed file.
 *
 *  3. A CLIENT-BUNDLE LEAK SCAN (`buildModuleGraph` / `auditClientBundle`) — the
 *     heart of the DoD. It walks the real module graph from every `"use client"`
 *     entry, following local imports transitively, and flags any client-reachable
 *     module that imports a server-only SECRET MODULE (`SECRET_MODULE_PATHS` —
 *     `db/supabase` with its service-role `serverClient`, `ai/client` with the AI
 *     key) or reads a server-only env var directly. The walk STOPS at `"use
 *     server"` boundaries: Next.js replaces a server-action import with an RPC
 *     reference, so a client form importing `@/lib/company/actions` does NOT drag
 *     that action's server-only dependencies into the browser bundle.
 *
 *  4. A `.gitignore` CHECK (`auditGitignore`) — confirms `.env.local` (and the
 *     env wildcard) are ignored so a real secret file can never be committed.
 *
 * Scope: the browser-bundle secret boundary, as the DoD names. The server-side
 * tenancy/authz surfaces are covered by Day 43 (RLS) and Day 44 (authz) and are
 * intentionally not re-audited here.
 */

// ── 1. Env-var inventory ─────────────────────────────────────────────────────

/** Whether a var is safe for the browser bundle (`public`) or server-only. */
export type EnvExposure = "public" | "server";

/**
 * One env var the app uses, with its intended posture. `exposure: "public"`
 * means a `NEXT_PUBLIC_*` var Next inlines into the client bundle (so it must
 * never be a credential). `secret: true` marks a server var that is a
 * credential — the two the DoD names (service-role key, AI key) — so the audit
 * can single them out. `required` is whether the app cannot run without it
 * (documented for completeness; the AI key is optional — absent → offline mock).
 */
export interface EnvVarPosture {
  name: string;
  exposure: EnvExposure;
  secret: boolean;
  required: boolean;
  /** One-line note on where/why it is used (mirrors `.env.example` comments). */
  note: string;
}

export const ENV_VAR_POSTURE: readonly EnvVarPosture[] = [
  // ── App ──
  {
    name: "NEXT_PUBLIC_APP_URL",
    exposure: "public",
    secret: false,
    required: false,
    note: "Public base URL for absolute invite links (Day 24).",
  },
  // ── Supabase ──
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    exposure: "public",
    secret: false,
    required: true,
    note: "Supabase project URL — public by design.",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    exposure: "public",
    secret: false,
    required: true,
    note: "Supabase anon key — public; RLS enforces tenancy (Rules.md §5).",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    exposure: "server",
    secret: true,
    required: true,
    note: "Full DB access — SERVER ONLY, never in the client bundle (Rules.md §4).",
  },
  // ── AI provider ──
  {
    name: "AI_PROVIDER",
    exposure: "server",
    secret: false,
    required: false,
    note: "anthropic | openai | groq (server-side config).",
  },
  {
    name: "AI_API_KEY",
    exposure: "server",
    secret: true,
    required: false,
    note: "Model API key — SERVER ONLY; blank ⇒ offline mock (Rules.md §4).",
  },
  {
    name: "AI_MODEL",
    exposure: "server",
    secret: false,
    required: false,
    note: "Model id (server-side config).",
  },
  {
    name: "AI_TEMPERATURE",
    exposure: "server",
    secret: false,
    required: false,
    note: "Sampling temperature (server-side config).",
  },
];

/** The declared posture for a var name, or undefined if not inventoried. */
export function postureForEnvVar(name: string): EnvVarPosture | undefined {
  return ENV_VAR_POSTURE.find((e) => e.name === name);
}

/**
 * Exposure implied by naming alone: a `NEXT_PUBLIC_` prefix is Next's contract
 * for "inline into the client bundle", so such a var is `public`; everything
 * else is server-only. Used to cross-check the declared posture against the
 * name (a credential must never carry the public prefix).
 */
export function exposureFromName(name: string): EnvExposure {
  return name.startsWith("NEXT_PUBLIC_") ? "public" : "server";
}

// ── 2. .env.example audit ────────────────────────────────────────────────────

export interface EnvFileEntry {
  key: string;
  value: string;
  /** 1-based line number (for pointing at a bad entry). */
  line: number;
}

const ENV_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * Parse a dotenv-style file into `KEY=value` entries, skipping blank lines and
 * `#` comments. Values keep their literal text (placeholders here — this parses
 * the committed example, not a real `.env.local`). A surrounding pair of quotes
 * is stripped so a quoted placeholder reads the same as an unquoted one.
 */
export function parseEnvFile(text: string): EnvFileEntry[] {
  const out: EnvFileEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === "" || raw.startsWith("#")) continue;
    const m = ENV_LINE_RE.exec(raw);
    if (!m) continue;
    let value = m[2].trim();
    if (value.length >= 2 && /^(".*"|'.*')$/.test(value)) {
      value = value.slice(1, -1);
    }
    out.push({ key: m[1], value, line: i + 1 });
  }
  return out;
}

/**
 * Markers that identify a value as an intentional placeholder (so the
 * secret-shaped heuristic below doesn't false-positive on `your-service-role-key`
 * or a localhost URL). Lower-cased comparison.
 */
const PLACEHOLDER_MARKERS = [
  "your-",
  "your_",
  "example",
  "placeholder",
  "changeme",
  "change-me",
  "todo",
  "xxxx",
  "<",
  "localhost",
  "127.0.0.1",
  "sk-...",
  "...",
];

/**
 * Heuristic: does a committed value look like a REAL secret rather than a
 * placeholder? Catches the shapes the two credentials actually take — a Supabase
 * JWT (`eyJ...`) and an Anthropic-style key (`sk-ant-...` / `sk-...`) — plus any
 * long, high-entropy, space-free token that isn't an obvious placeholder. Kept
 * conservative so a legitimate placeholder never trips it; the test proves it
 * both passes the real file and catches a planted key.
 */
export function envValueLooksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  const lower = v.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) return false;

  // Supabase anon/service keys are JWTs: three base64url segments, dot-joined.
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return true;
  // Provider API keys (Anthropic `sk-ant-...`, OpenAI `sk-...`, Groq `gsk_...`).
  if (/^sk-[A-Za-z0-9]/.test(v) || /^gsk_[A-Za-z0-9]/.test(v)) return true;
  // A generic long, space-free, high-entropy token (base64/hex-ish).
  if (v.length >= 40 && /^[A-Za-z0-9+/=_.-]+$/.test(v) && !v.includes(" ")) {
    return true;
  }
  return false;
}

export interface EnvExampleAudit {
  /** Inventoried keys with no entry in `.env.example` (undocumented). */
  missingFromExample: string[];
  /** `.env.example` keys absent from the inventory (stale/unaudited). */
  extraInExample: string[];
  /** Keys whose `NEXT_PUBLIC_` prefix disagrees with the declared exposure. */
  exposureMismatches: {
    key: string;
    declared: EnvExposure;
    fromName: EnvExposure;
  }[];
  /** Keys whose committed value looks like a real secret (must be none). */
  secretValueLeaks: { key: string; line: number }[];
  /** Duplicate keys in the file (a copy-paste hazard). */
  duplicateKeys: string[];
}

/**
 * Audit the committed `.env.example` against the inventory. A clean result —
 * all five arrays empty — is the "`.env.example` complete" half of the DoD:
 * every env var the code uses is documented, nothing stale lingers, the public
 * prefix matches each var's exposure, and no real secret value was committed.
 */
export function auditEnvExample(exampleText: string): EnvExampleAudit {
  const entries = parseEnvFile(exampleText);
  const exampleKeys = entries.map((e) => e.key);
  const exampleKeySet = new Set(exampleKeys);
  const inventoryKeys = ENV_VAR_POSTURE.map((e) => e.name);
  const inventorySet = new Set(inventoryKeys);

  const missingFromExample = inventoryKeys
    .filter((k) => !exampleKeySet.has(k))
    .sort();
  const extraInExample = exampleKeys
    .filter((k) => !inventorySet.has(k))
    .sort();

  const exposureMismatches: EnvExampleAudit["exposureMismatches"] = [];
  for (const posture of ENV_VAR_POSTURE) {
    const fromName = exposureFromName(posture.name);
    if (fromName !== posture.exposure) {
      exposureMismatches.push({
        key: posture.name,
        declared: posture.exposure,
        fromName,
      });
    }
  }

  const secretValueLeaks = entries
    .filter((e) => envValueLooksLikeSecret(e.value))
    .map((e) => ({ key: e.key, line: e.line }));

  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const k of exampleKeys) {
    if (seen.has(k) && !duplicateKeys.includes(k)) duplicateKeys.push(k);
    seen.add(k);
  }

  return {
    missingFromExample,
    extraInExample,
    exposureMismatches,
    secretValueLeaks,
    duplicateKeys,
  };
}

// ── 3. Client-bundle leak scan ───────────────────────────────────────────────

/**
 * Server-only modules that read a CREDENTIAL at module scope. Importing one of
 * these into the client graph would be the leak the DoD forbids:
 *  - `src/lib/db/supabase.ts` — `serverClient()` uses `SUPABASE_SERVICE_ROLE_KEY`
 *    (its own docstring: "SERVER ONLY. Never import into a client component.").
 *  - `src/lib/ai/client.ts` — `getModelClient()` uses `AI_API_KEY`.
 * Paths are repo-relative (POSIX separators), matching the module-graph keys.
 */
export const SECRET_MODULE_PATHS: readonly string[] = [
  "src/lib/db/supabase.ts",
  "src/lib/ai/client.ts",
];

/** `"use client"` directive at the top of a module (first statement). */
export function hasUseClientDirective(src: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(
    src,
  );
}

/** `"use server"` directive at the top of a module (a server-action boundary). */
export function hasUseServerDirective(src: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use server["']/.test(
    src,
  );
}

/** Strip line and block comments so commented-out code can't match (or hide) a pattern. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const IMPORT_FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;

/**
 * Non-code asset extensions that are imported for their side effect / URL, not
 * as modules (`import "./globals.css"`). They carry no secret and are not graph
 * edges, so they are excluded rather than reported as unresolved.
 */
const ASSET_EXTENSION_RE =
  /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|json)$/i;

/**
 * Local import specifiers a module references (`@/...` alias or a `./` / `../`
 * relative path). Third-party specifiers (`react`, `next/*`, `zod`,
 * `@supabase/*`, `@anthropic-ai/sdk`) and non-code asset imports (CSS, images,
 * fonts) are excluded — neither pulls an app-owned secret module. Covers
 * `import … from "x"`, `export … from "x"`, and bare `import "x"`; type-only
 * imports are included (conservatively treated as graph edges).
 */
export function findLocalImportSpecifiers(src: string): string[] {
  const clean = stripComments(src);
  const found = new Set<string>();
  for (const re of [IMPORT_FROM_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const m of clean.matchAll(re)) {
      const spec = m[1];
      if (ASSET_EXTENSION_RE.test(spec)) continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) found.add(spec);
    }
  }
  return [...found];
}

/**
 * Server-only env vars a module reads DIRECTLY via `process.env.NAME` or
 * `process.env["NAME"]`. A public (`NEXT_PUBLIC_*`) read is fine in client code
 * (Next inlines it) and is excluded; an un-inventoried name is reported too (it
 * is server-only by naming and should not be in the bundle). Dynamic
 * `process.env[variable]` reads resolve no literal and are not reported here —
 * they live inside the secret modules, which the import rule already flags.
 */
export function findServerEnvReads(src: string): string[] {
  const clean = stripComments(src);
  const names = new Set<string>();
  const dot = /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const bracket = /\bprocess\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g;
  for (const re of [dot, bracket]) {
    for (const m of clean.matchAll(re)) {
      const name = m[1];
      if (exposureFromName(name) === "server") names.add(name);
    }
  }
  return [...names];
}

// ── Module-graph modelling ───────────────────────────────────────────────────

export interface SourceModule {
  /** Repo-relative path, POSIX separators (e.g. `src/components/review/x.tsx`). */
  path: string;
  src: string;
}

export interface GraphModule {
  path: string;
  isClient: boolean;
  isServer: boolean;
  /** Resolved repo-relative paths of this module's local imports. */
  imports: string[];
  /** Local import specifiers that could not be resolved to a known file. */
  unresolved: string[];
  secretImports: string[];
  serverEnvReads: string[];
}

/** Normalize a POSIX-ish path, collapsing `.` and `..` segments. */
function normalizePath(p: string): string {
  const parts = p.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Resolve a local import specifier to a repo-relative module path, given the set
 * of known file paths. `@/x` maps to `src/x` (the tsconfig/vitest alias); a
 * relative specifier resolves against the importer's directory. Tries the bare
 * path then the TS/TSX and index suffixes, returning the first that exists in
 * `known` — or null for a third-party or unresolvable specifier.
 */
export function resolveLocalImport(
  fromPath: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith(".")) {
    const dir = fromPath.includes("/")
      ? fromPath.slice(0, fromPath.lastIndexOf("/"))
      : "";
    base = normalizePath(`${dir}/${specifier}`);
  } else {
    return null; // third-party
  }
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = normalizePath(base + suffix);
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the module graph from a set of source modules: resolve each module's
 * local imports and flag its own secret-module imports and server env reads.
 * Pure — the caller supplies the sources (the test reads them from disk).
 */
export function buildModuleGraph(
  modules: readonly SourceModule[],
): Map<string, GraphModule> {
  const known = new Set(modules.map((m) => m.path));
  const secretSet = new Set(SECRET_MODULE_PATHS);
  const graph = new Map<string, GraphModule>();

  for (const m of modules) {
    const specifiers = findLocalImportSpecifiers(m.src);
    const imports: string[] = [];
    const unresolved: string[] = [];
    const secretImports: string[] = [];
    for (const spec of specifiers) {
      const resolved = resolveLocalImport(m.path, spec, known);
      if (resolved === null) {
        unresolved.push(spec);
        continue;
      }
      imports.push(resolved);
      if (secretSet.has(resolved)) secretImports.push(resolved);
    }
    graph.set(m.path, {
      path: m.path,
      isClient: hasUseClientDirective(m.src),
      isServer: hasUseServerDirective(m.src),
      imports,
      unresolved,
      secretImports,
      serverEnvReads: findServerEnvReads(m.src),
    });
  }
  return graph;
}

export interface ClientBundleLeak {
  /** The client-reachable module path. */
  path: string;
  /** Secret modules it imports (should be empty). */
  secretImports: string[];
  /** Server-only env vars it reads directly (should be empty). */
  serverEnvReads: string[];
}

export interface ClientBundleAudit {
  /** Every module reachable in the client bundle (sorted). */
  reachable: string[];
  /** `"use server"` modules reached as import targets — boundaries, not bundled (sorted). */
  boundaries: string[];
  /** Client-reachable modules that would leak a secret (must be empty). */
  leaks: ClientBundleLeak[];
}

/**
 * Walk the client bundle from every `"use client"` entry and report any secret
 * leak. Traversal follows local imports but STOPS at a `"use server"` module:
 * Next replaces a server-action import with an RPC reference, so the action's
 * server-only transitive deps (and the secret modules behind them) are not
 * bundled into the browser — importing `@/lib/company/actions` from a client
 * form is safe by design. A module with no `"use client"`/`"use server"`
 * directive that is reached from a client entry IS in the bundle, so it is
 * walked and flagged. A clean `leaks: []` is the "no secret in the client
 * bundle" half of the DoD.
 */
export function auditClientBundle(
  graph: ReadonlyMap<string, GraphModule>,
): ClientBundleAudit {
  const reachable = new Set<string>();
  const boundaries = new Set<string>();

  const entries = [...graph.values()].filter((m) => m.isClient);
  const queue = entries.map((m) => m.path);

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (reachable.has(path)) continue;
    reachable.add(path);
    const mod = graph.get(path);
    if (!mod) continue;
    for (const dep of mod.imports) {
      const depMod = graph.get(dep);
      if (!depMod) continue;
      if (depMod.isServer) {
        // Server-action boundary: an RPC reference in the bundle, not the code.
        boundaries.add(dep);
        continue;
      }
      if (!reachable.has(dep)) queue.push(dep);
    }
  }

  const leaks: ClientBundleLeak[] = [];
  for (const path of reachable) {
    const mod = graph.get(path)!;
    if (mod.secretImports.length > 0 || mod.serverEnvReads.length > 0) {
      leaks.push({
        path,
        secretImports: [...mod.secretImports].sort(),
        serverEnvReads: [...mod.serverEnvReads].sort(),
      });
    }
  }

  return {
    reachable: [...reachable].sort(),
    boundaries: [...boundaries].sort(),
    leaks: leaks.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// ── 4. .gitignore check ──────────────────────────────────────────────────────

export interface GitignoreAudit {
  /** `.env.local` is covered (directly or by a matching wildcard). */
  ignoresEnvLocal: boolean;
  /** The bare `.env` file is covered. */
  ignoresEnvFile: boolean;
}

/**
 * Confirm `.gitignore` keeps real secret files out of the repo. A real
 * `.env.local` (and the bare `.env`) must be ignored so a developer can never
 * accidentally commit live credentials (Rules.md §4 — "`.env.local` is
 * gitignored; only `.env.example` is committed").
 */
export function auditGitignore(text: string): GitignoreAudit {
  const patterns = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  const set = new Set(patterns);
  const ignoresEnvLocal =
    set.has(".env.local") ||
    set.has(".env*.local") ||
    set.has(".env.*.local") ||
    set.has(".env*") ||
    set.has("*.local");
  const ignoresEnvFile = set.has(".env") || set.has(".env*");
  return { ignoresEnvLocal, ignoresEnvFile };
}
