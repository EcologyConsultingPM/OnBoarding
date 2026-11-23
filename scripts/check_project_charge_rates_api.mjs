import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";

// No environment credentials, network, database or browser are used. Evaluate
// the real route source and replace only its imported access-control helpers.
const root = new URL("../", import.meta.url);
const routeSource = await readFile(new URL("app/api/admin/project-charge-rates/route.js", root), "utf8");
const executable = routeSource.replace(/^import[^\n]*\n/gm, "").replace(/^export /gm, "") + "\nthis.handlers = { GET, POST };";
const projectId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const updatedAt = "2026-11-19T22:00:00.123456+00:00";
const sampleRates = { project_manager_rate: 137.25, senior_ecologist_rate: 189.5, ecologist_rate: 111.11 };
const rpcRates = { "Project Manager": sampleRates.project_manager_rate, "Senior Ecologist": sampleRates.senior_ecologist_rate, "Ecologist": sampleRates.ecologist_rate };
const card = {
  project_id: projectId,
  ...sampleRates,
  confirmed_at: updatedAt,
  confirmed_by: actorId,
  updated_at: updatedAt,
};
const bodyFor = (changes = {}) => ({ projectId, rates: { ...sampleRates }, expectedUpdatedAt: null, ...changes });
const copy = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;

async function run(options = {}) {
  const calls = [];
  const queries = [];
  const rpcs = [];
  const admin = {
    from(table) {
      const operation = { table, filters: [] };
      const result = () => {
        queries.push(copy(operation));
        if (table === "projects") return { data: options.projectMissing ? null : { id: projectId, name: "Mock project" }, error: options.projectError || null };
        if (table === "project_charge_rates") return { data: options.card === undefined ? null : options.card, error: options.cardError || null };
        if (table === "project_role_rates") return {
          data: options.suggestions === undefined ? [
            { role_name: "Project Manager", charge_rate: "137.25" },
            { role_name: "Senior Ecologist", charge_rate: 189.5 },
            { role_name: "Ecologist", charge_rate: 111.11 },
          ] : options.suggestions,
          error: options.suggestionsError || null,
        };
        throw new Error(`Unexpected table access: ${table}`);
      };
      const query = {
        select(columns) { operation.columns = columns; return query; },
        eq(column, value) { operation.filters.push(["eq", column, value]); return query; },
        is(column, value) { operation.filters.push(["is", column, value]); return query; },
        in(column, values) { operation.filters.push(["in", column, Array.from(values)]); return query; },
        limit(value) { operation.limit = value; return query; },
        async maybeSingle() { operation.maybeSingle = true; return result(); },
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject); },
      };
      return query;
    },
    async rpc(name, args) {
      rpcs.push({ name, args: copy(args) });
      if (options.rpcThrows) throw new Error("Sensitive SQL or private schema details");
      return { data: options.rpcData === undefined ? card : options.rpcData, error: options.rpcError || null };
    },
  };
  const context = vm.createContext({
    Response, Headers, URL, TextDecoder, Uint8Array,
    requireSession: async (request) => {
      calls.push("session");
      assert.equal(request.headers.get("authorization"), "Bearer mock-token");
      return {
        admin,
        isAdmin: options.staff !== true,
        user: { id: actorId },
        error: options.unauthenticated ? Response.json({ error: "Not authenticated." }, { status: 401, headers: { Vary: "Accept" } }) : null,
      };
    },
    requirePortalResource: async (access, resource) => {
      calls.push("resource");
      assert.equal(access.admin, admin);
      assert.equal(resource, "admin.projects.setup");
      return options.resourceDenied ? Response.json({ error: "Portal resource access denied." }, { status: 403 }) : null;
    },
  });
  vm.runInContext(executable, context, { filename: "project-charge-rates/route.js" });
  const method = options.method || "GET";
  const query = options.query === undefined ? `?projectId=${projectId}` : options.query;
  const headers = { Authorization: "Bearer mock-token", ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...options.headers };
  const init = { method, headers };
  if (method === "POST") {
    if (options.rawBody !== undefined) init.body = options.rawBody;
    else if (!options.emptyBody) init.body = JSON.stringify(options.body === undefined ? bodyFor() : options.body);
    if (options.stream) { init.body = options.stream; init.duplex = "half"; }
  }
  const response = await context.handlers[method](new Request(`https://example.test/api/admin/project-charge-rates${query}`, init));
  assert.equal(response.headers.get("cache-control"), "private, no-store", "Every response, including auth and error responses, must be private and non-cacheable.");
  assert(response.headers.get("vary").split(",").some((item) => item.trim().toLowerCase() === "authorization"));
  const body = await response.json();
  checks += 1;
  return { response, body, calls, queries, rpcs };
}

for (const method of ["GET", "POST"]) {
  let result = await run({ method, unauthenticated: true });
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.calls, ["session"]);
  assert.equal(result.queries.length + result.rpcs.length, 0);
  assert.equal(result.body.rates, undefined);
  assert.match(result.response.headers.get("vary"), /Accept/);

  result = await run({ method, staff: true });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.calls, ["session"], "Staff must be denied before resource checks or financial reads.");
  assert.equal(result.queries.length + result.rpcs.length, 0);
  assert.equal(result.body.rates, undefined);

  result = await run({ method, resourceDenied: true });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.calls, ["session", "resource"]);
  assert.equal(result.queries.length + result.rpcs.length, 0);

  result = await run({ method, projectMissing: true });
  assert.equal(result.response.status, 404);
  assert.deepEqual(result.queries, [{ table: "projects", columns: "id, name", filters: [["is", "deleted_at", null], ["eq", "id", projectId]], limit: 1, maybeSingle: true }]);
  assert.equal(result.rpcs.length, 0);
}

let result = await run();
assert.equal(result.response.status, 200);
assert.equal(result.body.rates, null);
assert.deepEqual(result.body.suggestions, sampleRates);
assert.deepEqual(result.calls, ["session", "resource"]);
assert.equal(result.rpcs.length, 0, "Reading suggested rates cannot confirm them.");
assert.deepEqual(result.queries.find((row) => row.table === "project_charge_rates"), {
  table: "project_charge_rates",
  columns: "project_id, project_manager_rate, senior_ecologist_rate, ecologist_rate, confirmed_at, confirmed_by, updated_at",
  filters: [["eq", "project_id", projectId]], limit: 1, maybeSingle: true,
});
assert.deepEqual(result.queries.find((row) => row.table === "project_role_rates"), {
  table: "project_role_rates", columns: "role_name, charge_rate", filters: [["in", "role_name", ["Project Manager", "Senior Ecologist", "Ecologist"]]], limit: 20,
});

result = await run({ card: { ...card, internal_cost: "must-not-leak" } });
assert.deepEqual(result.body.rates, card);
result = await run({ suggestions: [] });
assert.deepEqual(result.body.suggestions, { project_manager_rate: null, senior_ecologist_rate: null, ecologist_rate: null });
result = await run({ suggestions: [
  { role_name: "  SENIOR   ECOLOGIST ", charge_rate: "194.75" },
  { role_name: "Ecologist assistant", charge_rate: 999 },
  { role_name: "Project Manager", charge_rate: "" },
  { role_name: "Ecologist", charge_rate: -1 },
] });
assert.deepEqual(result.body.suggestions, { project_manager_rate: null, senior_ecologist_rate: 194.75, ecologist_rate: null });
result = await run({ suggestions: [
  { role_name: "Ecologist", charge_rate: 101 }, { role_name: "Ecologist", charge_rate: 102 },
] });
assert.equal(result.body.suggestions.ecologist_rate, null, "Do not choose an arbitrary duplicate company rate.");

for (const query of ["", "?projectId=bad", `?projectId=${projectId}&extra=1`, `?projectId=${projectId}&projectId=${projectId}`]) {
  result = await run({ query });
  assert.equal(result.response.status, 400);
  assert.equal(result.queries.length, 0);
}
for (const code of ["42P01", "PGRST205"]) {
  result = await run({ cardError: { code, message: "Sensitive missing table" } });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "MIGRATION_PENDING");
  assert.equal(result.rpcs.length, 0);
  assert(!JSON.stringify(result.body).includes("Sensitive"));
}
result = await run({ suggestionsError: { code: "PGRST205" } });
assert.equal(result.response.status, 409);
result = await run({ cardError: { code: "XX000", message: "Sensitive database detail" } });
assert.equal(result.response.status, 500);
assert(!JSON.stringify(result.body).includes("Sensitive"));

for (const bad of [0, -1, 0.001, 1.234, 1000000.01, "137.25", "", null, true, false, [], {}, Infinity, NaN]) {
  for (const field of Object.keys(sampleRates)) {
    result = await run({ method: "POST", body: bodyFor({ rates: { ...sampleRates, [field]: bad } }) });
    assert.equal(result.response.status, 400, `Invalid ${field} ${JSON.stringify(bad)} must fail before reads/RPC.`);
    assert.equal(result.queries.length + result.rpcs.length, 0);
  }
}
for (const invalidBody of [
  null, [], "text", {},
  bodyFor({ projectId: "invalid" }),
  bodyFor({ unexpected: true }),
  bodyFor({ actorId }),
  bodyFor({ rates: { ...sampleRates, confirmed_at: updatedAt } }),
  bodyFor({ rates: { project_manager_rate: 123 } }),
  bodyFor({ expectedUpdatedAt: "" }),
  bodyFor({ expectedUpdatedAt: 123 }),
  bodyFor({ expectedUpdatedAt: "not-a-timestamp" }),
  bodyFor({ expectedUpdatedAt: "2026-11-19" }),
  { projectId, rates: sampleRates },
]) {
  result = await run({ method: "POST", body: invalidBody });
  assert.equal(result.response.status, 400);
  assert.equal(result.queries.length + result.rpcs.length, 0);
}
for (const rawBody of ["{", '{"rates":NaN}', "not json"]) {
  result = await run({ method: "POST", rawBody });
  assert.equal(result.response.status, 400);
  assert.equal(result.rpcs.length, 0);
}
result = await run({ method: "POST", emptyBody: true });
assert.equal(result.response.status, 400);
result = await run({ method: "POST", headers: { "Content-Type": "text/plain" } });
assert.equal(result.response.status, 415);
result = await run({ method: "POST", headers: { "Content-Length": "8193" } });
assert.equal(result.response.status, 413);
assert.equal(result.queries.length + result.rpcs.length, 0);
result = await run({ method: "POST", rawBody: " ".repeat(8193), headers: { "Content-Length": "1" } });
assert.equal(result.response.status, 413, "Do not trust declared length over actual body size.");
result = await run({ method: "POST", rawBody: `"${"é".repeat(4096)}"` });
assert.equal(result.response.status, 413, "Body limits count UTF-8 bytes, not characters.");
const bodyText = JSON.stringify(bodyFor());
result = await run({ method: "POST", rawBody: bodyText + " ".repeat(8192 - Buffer.byteLength(bodyText)) });
assert.equal(result.response.status, 200, "The exact 8 KB limit remains valid.");

result = await run({ method: "POST" });
assert.equal(result.response.status, 200);
assert.deepEqual(result.body, { rates: card });
assert.deepEqual(result.rpcs, [{ name: "ec_save_project_charge_rates", args: {
  p_project_id: projectId, p_actor_id: actorId, p_expected_updated_at: null, p_rates: rpcRates,
} }]);
assert.deepEqual(result.queries.map((row) => row.table), ["projects"], "No direct inserts, company updates or historical/budget writes are permitted.");
result = await run({ method: "POST", body: bodyFor({ expectedUpdatedAt: updatedAt }), rpcData: { rates: { ...card, private_metadata: "not-public" } } });
assert.equal(result.response.status, 200);
assert.equal(result.rpcs[0].args.p_expected_updated_at, updatedAt, "Keep microsecond CAS timestamps unchanged.");
assert.deepEqual(result.body.rates, card);
for (const valid of [0.01, 9.99, 999999.99, 1000000]) {
  result = await run({ method: "POST", body: bodyFor({ rates: Object.fromEntries(Object.keys(sampleRates).map((key) => [key, valid])) }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.rpcs.length, 1);
}
for (const [code, status] of [["40001", 409], ["42883", 409], ["PGRST202", 409], ["42501", 403], ["P0002", 404], ["22023", 400], ["23514", 400], ["XX000", 500]]) {
  result = await run({ method: "POST", rpcError: { code, message: "Sensitive SQL details: internal project budgets" } });
  assert.equal(result.response.status, status);
  assert.equal(result.rpcs.length, 1, "Errors must not silently retry a write.");
  assert(!JSON.stringify(result.body).includes("Sensitive"));
  if (code === "40001") { assert.equal(result.body.code, "STALE_RATES"); assert.match(result.body.error, /Reload/); }
}
for (const invalidCard of [null, [], { rates: null }, { ...card, project_id: actorId }, { ...card, confirmed_at: null }, { ...card, updated_at: null }]) {
  result = await run({ method: "POST", rpcData: invalidCard });
  assert.equal(result.response.status, 500);
  assert.equal(result.rpcs.length, 1);
}
result = await run({ method: "POST", rpcThrows: true });
assert.equal(result.response.status, 500);
assert(!JSON.stringify(result.body).includes("Sensitive"));

const componentSource = await readFile(new URL("components/ProjectChargeRates.js", root), "utf8");
const stylesheet = await readFile(new URL("app/globals.css", root), "utf8");
const labelRule = stylesheet.match(/\.project-charge-rates\s+\.aps-field\s*\{([^}]+)\}/);
assert(labelRule, "Charge-rate labels must have styling scoped to their light surface.");
const labelColour = labelRule[1].match(/\bcolor:\s*#([\da-f]{6})\b/i)?.[1];
assert(labelColour, "Charge-rate labels must use an explicit dark text colour.");
const luminance = (hex) => {
  const channels = hex.match(/.{2}/g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
for (const background of ["f3f1e9", "ffffff"]) {
  const values = [luminance(labelColour), luminance(background)].sort((a, b) => b - a);
  assert((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, "Charge-rate labels must have sufficient contrast against the light surface.");
}
assert.match(componentSource, /new AbortController\(\)/);
assert.match(componentSource, /controller\.abort\(\)/);
assert.match(componentSource, /latestScopeRef\.current === scopeKey/);
assert.match(componentSource, /state\.scopeKey === scopeKey/);
assert.match(componentSource, /expectedUpdatedAt: view\.rates\?\.updated_at \|\| null/);
assert.match(componentSource, /Suggested company rates — not yet confirmed for this project/);
assert.match(componentSource, /Save project first/);
assert.match(componentSource, /Save rates for this project/);
assert.match(componentSource, /Reload rates and suggestions/);
assert.match(componentSource, /step="0\.01"/);
assert.match(componentSource, /min="0\.01"/);
assert.match(componentSource, /max="1000000"/);
assert(!componentSource.includes("localStorage"), "Financial editor values are not persisted in browser storage.");

// Compile the actual JSX with the installed Next compiler, then exercise hooks
// in a small deterministic harness. No DOM, browser or HTTP service is needed.
const require = createRequire(import.meta.url);
const swc = require("next/dist/build/swc");
const compiled = await swc.transform(componentSource, {
  filename: "ProjectChargeRates.js",
  jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "classic", pragma: "createElement" } } },
  module: { type: "es6" },
});
const componentCode = compiled.code.replace(/^import[^\n]*\n/gm, "").replace("export default function", "function") + "\nthis.Component = ProjectChargeRates;";
const settle = () => new Promise((resolve) => setImmediate(resolve));

function componentHarness(initialProps) {
  const slots = [];
  const requests = [];
  let pendingEffects = [];
  let cursor = 0;
  let props = initialProps;
  let tree;
  const context = vm.createContext({
    AbortController,
    createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } }),
    useState(initial) {
      const position = cursor++;
      if (!slots[position]) slots[position] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[position].value, (next) => { slots[position].value = typeof next === "function" ? next(slots[position].value) : next; }];
    },
    useRef(initial) {
      const position = cursor++;
      if (!slots[position]) slots[position] = { current: initial };
      return slots[position];
    },
    useEffect(callback, dependencies) {
      const position = cursor++;
      const previous = slots[position];
      if (!previous || dependencies.some((value, index) => value !== previous.dependencies[index])) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[position] = { dependencies, cleanup: callback() };
        });
      }
    },
    fetch(url, init) {
      return new Promise((resolve) => requests.push({ url, init, respond: (body, status = 200) => resolve(Response.json(body, { status })) }));
    },
  });
  vm.runInContext(componentCode, context, { filename: "ProjectChargeRates.compiled.js" });
  const render = (nextProps = props, flush = true) => {
    props = nextProps;
    cursor = 0;
    tree = context.Component(props);
    if (flush) {
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    }
    return tree;
  };
  const nodes = (type) => {
    const found = [];
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      if (node.type === type) found.push(node);
      walk(node.props.children);
    };
    walk(tree);
    return found;
  };
  const text = () => {
    const collect = (node) => Array.isArray(node) ? node.map(collect).join(" ") : node && typeof node === "object" ? collect(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
    return collect(tree);
  };
  render();
  return { render, nodes, text, requests };
}

const props = { session: { access_token: "mock-token" }, projectId, projectName: "First mock job" };
let ui = componentHarness({ ...props, projectId: null });
assert.match(ui.text(), /Save project first/);
assert.equal(ui.requests.length, 0);
ui = componentHarness(props);
assert.equal(ui.requests.length, 1);
assert.equal(ui.requests[0].init.method, "GET", "Mounting cannot write suggestions.");
assert.equal(ui.requests[0].init.headers.Authorization, "Bearer mock-token");
ui.requests[0].respond({ rates: null, suggestions: { ...sampleRates, ecologist_rate: null } });
await settle(); ui.render();
assert.match(ui.text(), /Suggested company rates — not yet confirmed for this project/);
for (const label of ["Project Manager", "Senior Ecologist", "Ecologist"]) {
  assert.match(ui.text(), new RegExp(`${label} \\s*\\(\\$/hour\\)`), `${label} must remain visible as a labelled rate field.`);
}
assert.equal(ui.nodes("label").length, 3, "The three rate inputs must retain their accessible labels.");
assert.equal(ui.nodes("input").find((node) => node.props.name === "ecologist_rate").props.value, "");
assert.equal(ui.nodes("button")[0].props.disabled, true, "Blank suggestions block saving.");
ui.nodes("input").find((node) => node.props.name === "ecologist_rate").props.onChange({ target: { value: "111.11" } });
ui.render();
const firstSave = ui.nodes("button")[0].props.onClick();
assert.equal(ui.requests.length, 2);
assert.equal(ui.requests[1].init.method, "POST");
assert.deepEqual(JSON.parse(ui.requests[1].init.body), bodyFor());
ui.requests[1].respond({ error: "Another administrator changed this card." }, 409);
await firstSave; ui.render();
assert.match(ui.text(), /Reload rates/);
assert.equal(ui.nodes("button")[0].props.disabled, true);
assert.equal(ui.requests.length, 2, "Conflict responses do not silently retry or reload.");
ui.nodes("button")[1].props.onClick();
ui.render();
assert.equal(ui.requests.length, 3);
assert.equal(ui.requests[2].init.method, "GET", "Only explicit reload fetches the new card and suggestions.");
ui.requests[2].respond({ rates: card, suggestions: sampleRates });
await settle(); ui.render();
assert.match(ui.text(), /Confirmed for this project/);
const confirmedSave = ui.nodes("button")[0].props.onClick();
assert.equal(JSON.parse(ui.requests[3].init.body).expectedUpdatedAt, updatedAt);
ui.requests[3].respond({ rates: card });
await confirmedSave; ui.render();
assert.match(ui.text(), /Rates saved and confirmed/);

const otherProps = { ...props, projectId: actorId, projectName: "Second mock job" };
const otherCard = { ...card, project_id: actorId, ecologist_rate: 222.22 };
ui = componentHarness(props);
ui.render(otherProps);
assert.equal(ui.requests[0].init.signal.aborted, true);
ui.requests[1].respond({ rates: otherCard, suggestions: sampleRates });
await settle(); ui.render();
ui.requests[0].respond({ rates: card, suggestions: sampleRates });
await settle(); ui.render();
assert.equal(ui.nodes("input").find((node) => node.props.name === "ecologist_rate").props.value, "222.22", "A late GET cannot replace the selected project's card.");

ui = componentHarness(props);
ui.requests[0].respond({ rates: card, suggestions: sampleRates });
await settle(); ui.render();
const pendingSave = ui.nodes("button")[0].props.onClick();
ui.render(otherProps);
assert.equal(ui.requests[1].init.signal.aborted, true);
ui.requests[2].respond({ rates: otherCard, suggestions: sampleRates });
await settle(); ui.render();
ui.requests[1].respond({ rates: card });
await pendingSave; ui.render();
assert.equal(ui.nodes("input").find((node) => node.props.name === "ecologist_rate").props.value, "222.22", "A late POST response cannot update another project's state.");
assert(!ui.text().includes("Rates saved and confirmed"), "Do not show a saved notification for the wrong project.");

console.log(`Project charge rates API passed ${checks} mocked route scenarios: access order, staff privacy, resource denial, scoped/deleted project reads, company-only suggestions, strict fields/rates/8 KB JSON, exact RPC arguments, CAS conflicts, migration errors, sanitized failures and private cache headers. Browser-free component checks passed: blank-save protection, explicit reload after 409, unchanged CAS timestamp, confirmed/saved status, AbortController cleanup and stale GET/POST suppression across project switches.`);
