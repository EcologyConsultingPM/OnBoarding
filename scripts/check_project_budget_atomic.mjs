import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// In-memory PostgreSQL only: no URLs, credentials, production writes or network.
const root = new URL("..", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const migration = await read("sql/2026-11-19-project-budget-save-atomic.sql");
const closeout = await read("sql/2026-11-03-project-close-report.sql");
const manageHelper = closeout.match(/create or replace function public\.project_closeout_can_manage\(p_actor_id uuid\)[\s\S]*?\$\$;/)?.[0];
assert(manageHelper, "Use the existing real administrator helper, not a permissive double.");
const require = createRequire(import.meta.url);
let modulePath;
try { modulePath = require.resolve("@electric-sql/pglite"); }
catch { modulePath = require.resolve("/home/ubuntu/tmp/closeout-db-test/node_modules/@electric-sql/pglite"); }
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  otherProject: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  staff: "10000000-0000-4000-8000-000000000004",
  source: "10000000-0000-4000-8000-000000000005",
  variation: "10000000-0000-4000-8000-000000000006",
  extra: "10000000-0000-4000-8000-000000000007",
  allocation: "10000000-0000-4000-8000-000000000008",
  entry: "10000000-0000-4000-8000-000000000009",
};
const expected = { approved_value: 100.1, approved_hours: 10.25 };
const patch = { name: "Updated project", budget_dollars: 200.25, budget_hours: 20.5 };
const sourcePatch = { approved_value: 200.25, approved_hours: 20.5 };
const signature = "public.ec_save_project_original_budget(uuid,uuid,uuid,jsonb,jsonb,jsonb)";
const call = async ({ projectId = ids.project, actorId = ids.actor, sourceId = ids.source, expectedSource = expected, projectPatch = patch, sourceBudgetPatch = sourcePatch } = {}) => {
  const result = await db.query(`select public.ec_save_project_original_budget($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::jsonb,$6::jsonb) as result limit 1`,
    [projectId, actorId, sourceId, JSON.stringify(expectedSource), JSON.stringify(projectPatch), JSON.stringify(sourceBudgetPatch)]);
  return result.rows[0].result;
};
const rows = async (table) => (await db.query(`select to_jsonb(t) as row from public.${table} t order by t.id limit 100`)).rows.map((r) => r.row);
const snapshot = async () => Object.fromEntries(await Promise.all(["projects", "project_budget_sources", "project_budget_allocations", "project_tracker_entries", "admin_audit_log"].map(async (table) => [table, await rows(table)])));
async function rejectsUnchanged(args, pattern, code) {
  const before = await snapshot();
  await assert.rejects(call(args), (error) => {
    assert.match(error.message, pattern);
    if (code) assert.equal(error.code, code);
    return true;
  });
  assert.deepEqual(await snapshot(), before, "Rejected save must not change project, source, itemised budgets, actuals or audit log.");
}
async function reset() {
  await db.exec(`
    truncate public.admin_audit_log, public.project_tracker_entries, public.project_budget_allocations, public.project_budget_sources, public.projects;
    update auth.users set deleted_at=null,banned_until=null;
    delete from public.portal_visibility_overrides;
    insert into public.projects(id,name,client_name,client_contact,description,scope_of_works,project_lead_user_id,start_date,end_date,budget_dollars,budget_hours,default_hourly_rate,created_by)
      values('${ids.project}','Original project','Keep client','Keep contact','Keep notes','Keep scope','${ids.actor}','2026-10-01','2026-12-31',100.10,10.25,180,'${ids.actor}'),
      ('${ids.otherProject}','Other project',null,null,null,null,null,null,null,999,99,null,'${ids.actor}');
    insert into public.project_budget_sources(id,project_id,source_type,approval_status,approved_value,approved_hours,updated_by)
      values('${ids.source}','${ids.project}','original','approved',100.10,10.25,'${ids.staff}'),
      ('${ids.variation}','${ids.project}','variation','approved',300.50,30.75,'${ids.staff}');
    insert into public.project_budget_allocations(id,project_id,budget_source_id,allocation_value,allocation_hours,hours_consumed,charge_out_spend,internal_cost,status)
      values('${ids.allocation}','${ids.project}','${ids.source}',80,8,2,360,140,'active');
    insert into public.project_tracker_entries(id,project_id,budget_source_id,budget_allocation_id,staff_user_id,hours,work_date)
      values('${ids.entry}','${ids.project}','${ids.source}','${ids.allocation}','${ids.staff}',2,'2026-11-01');
  `);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz);
    create table public.admin_emails(email text primary key);
    create table public.portal_visibility_overrides(user_id uuid,resource_key text,is_visible boolean);
    insert into auth.users values('${ids.actor}','ordinary-admin@example.test',null,null),('${ids.staff}','staff@example.test',null,null);
    insert into public.admin_emails values('ordinary-admin@example.test');
    create table public.projects(
      id uuid primary key,name text not null,client_name text,client_contact text,sharepoint_link text,sharepoint_label text,
      description text,scope_of_works text,project_lead_user_id uuid references auth.users(id),
      overseeing_senior_ecologist_user_id uuid references auth.users(id),start_date date,end_date date,
      budget_hours numeric(12,2),budget_dollars numeric(14,2),default_hourly_rate numeric(12,2),
      status text not null default 'active',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      created_by uuid references auth.users(id),deleted_at timestamptz,deleted_by uuid references auth.users(id),
      check(status in ('planning','active','on_hold','complete','archived'))
    );
    create table public.project_budget_sources(
      id uuid primary key,project_id uuid not null references public.projects(id),source_type text not null,
      approval_status text not null,approved_value numeric(14,2) not null check(approved_value>=0),
      approved_hours numeric(12,2) not null check(approved_hours>=0),service_period_start date,service_period_end date,
      updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
    );
    create table public.project_budget_allocations(
      id uuid primary key,project_id uuid references public.projects(id),budget_source_id uuid references public.project_budget_sources(id),
      allocation_value numeric,allocation_hours numeric,hours_consumed numeric,charge_out_spend numeric,internal_cost numeric,status text
    );
    create table public.project_tracker_entries(
      id uuid primary key,project_id uuid references public.projects(id),budget_source_id uuid references public.project_budget_sources(id),
      budget_allocation_id uuid references public.project_budget_allocations(id),staff_user_id uuid,hours numeric,work_date date
    );
    create table public.admin_audit_log(
      id uuid primary key default gen_random_uuid(),actor_id uuid references auth.users(id),action text not null,entity_type text not null,
      entity_id uuid,project_id uuid references public.projects(id),resource_key text,before_data jsonb,after_data jsonb,reason text,created_at timestamptz default now()
    );
    alter table public.projects enable row level security;
    alter table public.project_budget_sources enable row level security;
    create policy retained_source_policy on public.project_budget_sources using (false);
  `);
  await db.exec(manageHelper);
  const policyBefore = (await db.query("select policyname,qual from pg_policies where schemaname='public' order by policyname limit 20")).rows;
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query("select policyname,qual from pg_policies where schemaname='public' order by policyname limit 20")).rows, policyBefore);
  const grants = (await db.query(`select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as authenticated,has_function_privilege('service_role',$1,'execute') as service_role limit 1`, [signature])).rows[0];
  assert.deepEqual(grants, { anon: false, authenticated: false, service_role: true });
  const fn = (await db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure limit 1", [signature])).rows[0];
  assert.equal(fn.prosecdef, true); assert(fn.proconfig.some((c) => c.startsWith("search_path=")));
  assert.match(migration, /where p\.id = p_project_id for update/);
  assert.match(migration, /where s\.project_id = p_project_id order by s\.id for update/);
  await reset();
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role};`);
    await assert.rejects(call(), (error) => error.code === "42501");
    await db.exec("reset role;");
  }

  // Success through service_role with no direct table grants (SECURITY DEFINER).
  const before = await snapshot();
  await db.exec("set role service_role;");
  let result = await call({ projectPatch: { ...patch, client_contact: null } });
  await db.exec("reset role;");
  assert.equal(result.sourceBudgetSynchronized, true);
  assert.equal(result.project.budget_dollars, 200.25, "Variations stay additive, not folded into the project original baseline.");
  assert.equal(result.project.budget_hours, 20.5);
  assert.equal(result.project.name, "Updated project");
  assert.equal(result.project.client_name, "Keep client"); assert.equal(result.project.client_contact, null);
  assert.equal(result.project.description, "Keep notes"); assert.equal(result.project.scope_of_works, "Keep scope");
  assert.equal(result.project.project_lead_user_id, ids.actor); assert.equal(result.project.start_date, "2026-10-01");
  assert(!Object.hasOwn(result.project, "deleted_at")); assert(!Object.hasOwn(result.project, "created_by"));
  const after = await snapshot();
  const savedSource = after.project_budget_sources.find((r) => r.id === ids.source);
  assert.equal(savedSource.approved_value, 200.25); assert.equal(savedSource.approved_hours, 20.5); assert.equal(savedSource.updated_by, ids.actor);
  assert.deepEqual(after.project_budget_sources.find((r) => r.id === ids.variation), before.project_budget_sources.find((r) => r.id === ids.variation));
  assert.deepEqual(after.projects.find((r) => r.id === ids.otherProject), before.projects.find((r) => r.id === ids.otherProject));
  assert.deepEqual(after.project_budget_allocations, before.project_budget_allocations); assert.deepEqual(after.project_tracker_entries, before.project_tracker_entries);
  assert.equal(after.admin_audit_log.length, 1);
  const audit = after.admin_audit_log[0];
  assert.equal(audit.actor_id, ids.actor); assert.equal(audit.project_id, ids.project); assert.equal(audit.action, "project_original_budget_saved");
  assert.equal(audit.before_data.source.approved_value, 100.1); assert.equal(audit.after_data.source.approved_value, 200.25);
  assert.equal(audit.after_data.variations_unchanged, true); assert.equal(audit.after_data.actual_entries_unchanged, true);

  // Same-value source patch still checks its snapshot and commits project edits.
  await reset();
  const sameBefore = await rows("project_budget_sources");
  result = await call({ projectPatch: { budget_dollars: 100.1, description: "New notes" }, sourceBudgetPatch: {} });
  assert.equal(result.sourceBudgetSynchronized, true); assert.equal(result.project.description, "New notes");
  assert.equal(result.project.budget_hours, 10.25); assert.deepEqual(await rows("project_budget_sources"), sameBefore);
  await rejectsUnchanged({ expectedSource: { ...expected, approved_hours: 10 }, projectPatch: { budget_dollars: 100.1 }, sourceBudgetPatch: {} }, /amounts changed concurrently/, "40001");

  // A single budget dimension preserves the other; explicit restore is atomic.
  await reset();
  await db.exec(`update public.projects set deleted_at=now(),deleted_by='${ids.actor}' where id='${ids.project}';`);
  result = await call({ projectPatch: { budget_hours: 0, deleted_at: null, deleted_by: null }, sourceBudgetPatch: { approved_hours: 0 } });
  assert.equal(result.project.budget_hours, 0); assert.equal(result.project.budget_dollars, 100.1);
  assert.equal((await rows("projects")).find((r) => r.id === ids.project).deleted_at, null);
  await reset();
  result = await call({ projectPatch: { budget_hours: 0, budget_dollars: 0 }, sourceBudgetPatch: { approved_hours: 0, approved_value: 0 } });
  assert.equal(result.project.budget_hours, 0); assert.equal(result.project.budget_dollars, 0);

  // Simulate changes committed after API preflight but before the RPC lock.
  // PGlite is single-session, so this tests stale snapshots, not parallel races.
  for (const mutation of [
    `update public.project_budget_sources set approved_value=101 where id='${ids.source}'`,
    `update public.project_budget_sources set approved_hours=11 where id='${ids.source}'`,
    `update public.project_budget_sources set approval_status='draft' where id='${ids.source}'`,
    `update public.project_budget_sources set source_type='variation' where id='${ids.source}'`,
    `update public.project_budget_sources set project_id='${ids.otherProject}' where id='${ids.source}'`,
    `insert into public.project_budget_sources(id,project_id,source_type,approval_status,approved_value,approved_hours) values('${ids.extra}','${ids.project}','original','approved',1,1)`,
    `update public.project_budget_sources set service_period_start='2026-11-01',service_period_end='2026-11-30' where id='${ids.source}'`,
    `insert into public.project_budget_sources(id,project_id,source_type,approval_status,approved_value,approved_hours,service_period_start,service_period_end) values('${ids.extra}','${ids.project}','variation','approved',1,1,'2026-11-01','2026-11-30')`,
    `update public.project_budget_sources set service_period_start='2026-11-01',service_period_end='2026-11-30',approval_status='draft' where id='${ids.variation}'`,
  ]) {
    await reset(); await db.exec(mutation);
    await rejectsUnchanged({}, /changed|sources appeared/, "40001");
  }
  await reset(); await rejectsUnchanged({ sourceId: ids.variation }, /unique approved original source changed/, "40001");
  await rejectsUnchanged({ projectId: ids.otherProject }, /unique approved original source changed/, "40001");
  await rejectsUnchanged({ projectId: ids.extra }, /Project not found/, "P0002");
  await rejectsUnchanged({ actorId: ids.staff }, /active administrator/, "42501");
  for (const mutation of [
    `update auth.users set deleted_at=now() where id='${ids.actor}'`,
    `update auth.users set banned_until=now()+interval '1 day' where id='${ids.actor}'`,
    `insert into public.portal_visibility_overrides values('${ids.actor}','admin.projects',false)`,
  ]) {
    await reset(); await db.exec(mutation); await rejectsUnchanged({}, /active administrator/, "42501");
  }

  await reset();
  for (const args of [
    { expectedSource: {} }, { expectedSource: null }, { expectedSource: { ...expected, id: ids.source } },
    { projectPatch: null }, { sourceBudgetPatch: null }, { projectPatch: { ...patch, created_by: ids.staff } },
    { projectPatch: { ...patch, deleted_at: null } }, { projectPatch: { ...patch, deleted_at: "2026-11-01", deleted_by: null } },
    { projectPatch: { ...patch, name: null } }, { projectPatch: { ...patch, status: "invalid" } },
    { projectPatch: { name: "No budget" }, sourceBudgetPatch: {} },
    { sourceBudgetPatch: { ...sourcePatch, source_type: "variation" } },
    { sourceBudgetPatch: {} }, { sourceBudgetPatch: { ...sourcePatch, approved_value: 201 } },
    { projectPatch: { budget_dollars: 200.25 }, sourceBudgetPatch: sourcePatch },
  ]) await rejectsUnchanged(args, /expected|objects|patch|restore|name|status|explicit|agree/i, "22023");
  for (const bad of [null, "", "1.001", -1, true, "NaN", "Infinity", "1e3", "0x10", 1000000000.01]) {
    await rejectsUnchanged({ projectPatch: { ...patch, budget_dollars: bad } }, /decimal|exceed/, "22023");
    await rejectsUnchanged({ sourceBudgetPatch: { ...sourcePatch, approved_value: bad } }, /decimal/, "22023");
  }
  await rejectsUnchanged({ projectPatch: { ...patch, project_lead_user_id: ids.extra } }, /foreign key/, "23503");
  await rejectsUnchanged({ projectPatch: { ...patch, start_date: "2026-02-30" } }, /date\/time field value out of range/, "22008");

  // Force a failure at each write stage, proving rollback after earlier writes.
  await db.exec(`create function public.test_reject_atomic_write() returns trigger language plpgsql as $$ begin raise exception 'forced atomic write failure'; end; $$;`);
  for (const table of ["projects", "project_budget_sources", "admin_audit_log"]) {
    await reset();
    await db.exec(`update public.projects set deleted_at=now(),deleted_by='${ids.actor}' where id='${ids.project}';
      create trigger test_atomic_failure before insert or update on public.${table} for each row execute function public.test_reject_atomic_write();`);
    await rejectsUnchanged({ projectPatch: { ...patch, deleted_at: null, deleted_by: null } }, /forced atomic write failure/, "P0001");
    await db.exec(`drop trigger test_atomic_failure on public.${table};`);
  }
  await db.exec(`create function public.test_skip_atomic_write() returns trigger language plpgsql as $$ begin return null; end; $$;
    create function public.test_distort_atomic_write() returns trigger language plpgsql as $$ begin
      if tg_table_name='projects' then new.budget_dollars:=new.budget_dollars+1;
      else new.approved_value:=new.approved_value+1; end if;
      return new;
    end; $$;`);
  for (const table of ["projects", "project_budget_sources", "admin_audit_log"]) {
    await reset();
    await db.exec(`create trigger test_atomic_failure before insert or update on public.${table} for each row execute function public.test_skip_atomic_write();`);
    await rejectsUnchanged({}, /did not complete|audit was not recorded/, "P0001");
    await db.exec(`drop trigger test_atomic_failure on public.${table};`);
  }
  for (const table of ["projects", "project_budget_sources"]) {
    await reset();
    await db.exec(`create trigger test_atomic_failure before update on public.${table} for each row execute function public.test_distort_atomic_write();`);
    await rejectsUnchanged({}, /did not reconcile/, "P0001");
    await db.exec(`drop trigger test_atomic_failure on public.${table};`);
  }
  console.log("Atomic original budget SQL passed: re-runnable migration; real admin helper and service-role grants; original-only baseline; unchanged variations/itemised budgets/actuals; partial fields, restore, decimals/zero and same-value saves; stale source/identity/monthly conflicts; invalid inputs; project/source/audit failures roll back every write. PGlite is isolated and single-session.");
} finally {
  await db.close();
}
