import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  scopeSchema,
  planSchema,
  approvalErrors,
  clientScope,
  diffScopes,
  validatePlanScope,
} from "../src/lib/delivery/schema";
import {
  proposePlan,
  progress,
  implementationDoc,
} from "../src/lib/delivery/planning";
import { validSignature } from "../src/lib/delivery/github";
import { deliveryMcp } from "../src/lib/delivery/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { POST as mcpPost } from "../src/app/api/delivery/mcp/route";
const fixture = JSON.parse(
  readFileSync("examples/delivery/synthetic.scope.json", "utf8"),
);
test("MCP HTTP protocol exposes contracts, rejects invalid scope and requires authorization", async () => {
  const denied = await mcpPost(
    new Request("http://localhost/api/delivery/mcp", { method: "POST" }),
  );
  assert.equal(denied.status, 401);
  async function rpc(method: string, params: unknown) {
    const server = deliveryMcp(
      "20000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      assert.equal(response.status, 200);
      return await response.json();
    } finally {
      await server.close();
    }
  }
  const list = await rpc("tools/list", {});
  assert(
    list.result.tools.some(
      (t: { name: string }) => t.name === "salvar_rascunho",
    ),
  );
  assert(
    !list.result.tools.some((t: { name: string }) => /aprovar/.test(t.name)),
  );
  const contract = await rpc("tools/call", {
    name: "obter_contrato",
    arguments: {},
  });
  assert(
    JSON.parse(contract.result.content[0].text).scope.definitions.Scope
      .properties.requirements,
  );
  const invalid = await rpc("tools/call", {
    name: "validar_escopo",
    arguments: { document: {} },
  });
  assert(JSON.parse(invalid.result.content[0].text).fieldErrors.requirements);
});
test("synthetic fixture preserves requirements and unresolved decisions without invented estimates", () => {
  const s = scopeSchema.parse(fixture);
  assert.equal(s.modules.length, 13);
  assert.equal(s.requirements.length, 75);
  assert.equal(s.decisions.length, 3);
  assert(s.requirements.every((r) => r.hours === null));
  assert(approvalErrors(s).length > 0);
  const p = planSchema.parse(proposePlan(s, 1));
  assert.equal(
    p.tasks.filter((t) => !t.foundation).length,
    s.requirements.filter((r) => r.inclusion === "included").length,
  );
  validatePlanScope(p, s);
  assert.equal(progress(p).weighted, null);
  assert(implementationDoc(s, p).includes("Pendente de planejamento."));
  assert(!JSON.stringify(clientScope(s)).includes('"hours"'));
  assert(!JSON.stringify(clientScope(s)).includes("planningNotes"));
});
test("scope rejects duplicate IDs, dangling references and inconsistent decisions; diff uses permanent IDs", () => {
  const s = structuredClone(fixture);
  s.requirements.push(s.requirements[0]);
  assert(!scopeSchema.safeParse(s).success);
  const changed = structuredClone(fixture);
  changed.requirements[0].moduleId = "MISSING";
  assert(!scopeSchema.safeParse(changed).success);
  changed.requirements[0].moduleId = fixture.requirements[0].moduleId;
  changed.requirements[0].title = "Alterado";
  const d = diffScopes(fixture, changed);
  assert.equal(d.changed.length, 1);
  assert.equal(d.added.length, 0);
});
test("planning rejects cycles, invalid dates, nonincluded requirements and unsupported completion", () => {
  const p = proposePlan(fixture, 1);
  p.tasks[0].dependencies = [p.tasks[1].id];
  p.tasks[1].dependencies = [p.tasks[0].id];
  assert(!planSchema.safeParse(p).success);
  p.tasks[0].dependencies = [];
  p.tasks[1].dependencies = [];
  p.tasks[0].start = "2026-02-30";
  p.tasks[0].end = "2026-03-01";
  assert(!planSchema.safeParse(p).success);
  p.tasks[0].start = null;
  p.tasks[0].end = null;
  p.tasks[0].status = "done";
  assert(!planSchema.safeParse(p).success);
  p.tasks[0].status = "todo";
  p.tasks[0].requirementIds = ["NONEXISTENT"];
  assert.throws(() => validatePlanScope(p, fixture));
});
test("webhook accepts only valid SHA256 signature", () => {
  const raw = '{"action":"closed"}',
    secret = "synthetic-test-secret";
  const sig =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert(validSignature(raw, sig, secret));
  assert(!validSignature(raw + " ", sig, secret));
  assert(!validSignature(raw, null, secret));
  assert(!validSignature(raw, sig, ""));
});
test("database migration: isolation, immutable snapshots, optimistic locking, idempotency and approvals", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.leads(id uuid primary key); grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
 insert into leads values ('10000000-0000-4000-8000-000000000001');`);
    await db.exec(
      readFileSync("supabase/migrations/0019_delivery.sql", "utf8"),
    );
    const owner = "00000000-0000-4000-8000-000000000001",
      other = "00000000-0000-4000-8000-000000000002",
      project = "20000000-0000-4000-8000-000000000001";
    await db.query(
      "insert into delivery_projects(id,lead_id,name,owner_id) values($1,$2,$3,$4)",
      [project, "10000000-0000-4000-8000-000000000001", "Piloto", owner],
    );
    const write = (
      actor: string,
      action: string,
      expected: number,
      request: string,
      data: unknown,
    ) =>
      db.query("select delivery_write($1,$2,$3,$4,$5,$6::jsonb) as result", [
        project,
        actor,
        action,
        expected,
        request,
        JSON.stringify(data),
      ]);
    const req = "30000000-0000-4000-8000-000000000001";
    await assert.rejects(
      write(other, "save_scope", 0, req, fixture),
      /Acesso negado/,
    );
    await write(owner, "save_scope", 0, req, fixture);
    await write(owner, "save_scope", 0, req, fixture);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from delivery_scopes",
        )
      ).rows[0].count,
      1,
    );
    await assert.rejects(
      write(
        owner,
        "save_scope",
        0,
        "30000000-0000-4000-8000-000000000002",
        fixture,
      ),
      /Conflito/,
    );
    await assert.rejects(
      write(owner, "save_scope", 1, req, { ...fixture, title: "different" }),
      /conteúdo diferente/,
    );
    await assert.rejects(
      write(owner, "approve", 1, req, { evidence: "Email confirmado" }),
      /revisão/,
    );
    await write(owner, "review", 1, req, {});
    await assert.rejects(
      write(owner, "approve", 1, req, {
        approver: "Cliente teste",
        evidence: "Confirmação sintética",
      }),
      /pendentes/,
    );
    const resolved = structuredClone(fixture);
    for (const r of resolved.requirements)
      if (r.inclusion === "pending") r.inclusion = "excluded";
    for (const d of resolved.decisions) d.answer = d.options[0];
    await write(
      owner,
      "save_scope",
      1,
      "30000000-0000-4000-8000-000000000002",
      resolved,
    );
    await write(owner, "review", 2, req, {});
    await write(owner, "approve", 2, req, {
      approver: "Cliente teste",
      evidence: "Confirmação sintética",
    });
    const plan = proposePlan(resolved, 2);
    await write(owner, "save_plan", 0, req, plan);
    await assert.rejects(write(owner, "save_plan", 0, req, plan), /Conflito/);
    await write(owner, "baseline", 1, req, plan);
    await assert.rejects(write(owner, "baseline", 2, req, plan), /Baseline/);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`,
    );
    assert.equal(
      (await db.query("select * from delivery_projects")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select * from delivery_tokens"),
      /permission denied/,
    );
    await assert.rejects(
      write(owner, "save_scope", 1, req, fixture),
      /permission denied/,
    );
    await db.exec(
      `select set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    assert.equal(
      (await db.query("select * from delivery_projects")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("update delivery_scopes set document='{}'"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
