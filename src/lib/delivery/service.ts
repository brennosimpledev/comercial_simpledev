import { createAdminClient } from "@/lib/supabase/admin";
import {
  scopeSchema,
  planSchema,
  approvalErrors,
  validatePlanScope,
  diffScopes,
} from "./schema";
import { z } from "zod";
export async function projectAccess(projectId: string, userId: string) {
  z.string().uuid().parse(projectId);
  const db = createAdminClient();
  const { data: p, error } = await db
    .from("delivery_projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !p) throw Error("Projeto indisponível");
  if (p.owner_id !== userId) {
    const { data: m } = await db
      .from("delivery_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!m) throw Error("Acesso negado");
  }
  return p;
}
export async function listProjects(userId: string) {
  const db = createAdminClient();
  const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] =
    await Promise.all([
      db.from("delivery_projects").select("*").eq("owner_id", userId),
      db.from("delivery_members").select("project_id").eq("user_id", userId),
    ]);
  if (ownedError || memberError) throw Error("Falha ao listar projetos");
  const memberIds = (memberships ?? []).map((m) => m.project_id);
  const { data: shared, error: sharedError } = memberIds.length
    ? await db.from("delivery_projects").select("*").in("id", memberIds)
    : { data: [], error: null };
  if (sharedError) throw Error("Falha ao listar projetos");
  const projects = [...(owned ?? []), ...(shared ?? [])];
  return projects.filter(
    (project, index) => projects.findIndex((item) => item.id === project.id) === index,
  );
}
export async function searchLeads(query: string) {
  const term = z.string().trim().min(2).max(120).parse(query).replace(/[%_]/g, "");
  const { data, error } = await createAdminClient()
    .from("leads")
    .select("id,nome,estagio,status")
    .ilike("nome", `%${term}%`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw Error("Falha ao buscar leads");
  return data ?? [];
}
export async function createProjectForUser(
  userId: string,
  input: { name: string; leadId: string },
) {
  const name = z.string().trim().min(3).max(200).parse(input.name);
  const leadId = z.string().uuid().parse(input.leadId);
  const db = createAdminClient();
  // CRM lead access is team-wide for authenticated staff. Verify the lead before
  // creating the project; the MCP token never receives the service key.
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw Error("Lead indisponível");
  const { data, error } = await db
    .from("delivery_projects")
    .insert({ name, lead_id: leadId, owner_id: userId })
    .select("id,name,lead_id,owner_id,revision,scope_status,created_at")
    .single();
  if (error || !data) throw Error("Falha ao criar projeto");
  return data;
}
export async function renameProject(projectId: string, userId: string, name: string) {
  await projectAccess(projectId, userId);
  const cleanName = z.string().trim().min(3).max(200).parse(name);
  const { data, error } = await createAdminClient()
    .from("delivery_projects")
    .update({ name: cleanName })
    .eq("id", projectId)
    .select("id,name,lead_id,owner_id,revision,scope_status")
    .single();
  if (error || !data) throw Error("Falha ao atualizar projeto");
  return data;
}
export async function projectBundle(projectId: string, userId: string) {
  const project = await projectAccess(projectId, userId),
    db = createAdminClient();
  const results = await Promise.all([
    db
      .from("delivery_scopes")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false }),
    db
      .from("delivery_plans")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle(),
    db
      .from("delivery_events")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("delivery_github")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle(),
    db.from("delivery_members").select("user_id").eq("project_id", projectId),
    db
      .from("delivery_tokens")
      .select("id,created_at,expires_at,revoked_at,project_id")
      .eq("user_id", userId)
      .or(`project_id.is.null,project_id.eq.${projectId}`),
  ]);
  for (const r of results)
    if (r.error) throw Error("Falha ao carregar projeto");
  return {
    project,
    scopes: results[0].data ?? [],
    plan: results[1].data,
    events: results[2].data ?? [],
    github: results[3].data,
    members: results[4].data ?? [],
    tokens: results[5].data ?? [],
    isOwner: project.owner_id === userId,
  };
}
export const commandSchema = z
  .object({
    action: z.enum([
      "save_scope",
      "review",
      "approve",
      "save_plan",
      "baseline",
    ]),
    expected: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    data: z.unknown(),
  })
  .strict();
export async function writeProject(
  projectId: string,
  userId: string,
  input: unknown,
  connector = false,
) {
  const cmd = commandSchema.parse(input),
    p = await projectAccess(projectId, userId),
    db = createAdminClient();
  if (connector && !["save_scope", "review", "save_plan"].includes(cmd.action))
    throw Error("Aprovação e baseline somente no CRM");
  let document: unknown = cmd.data;
  if (cmd.action === "save_scope") document = scopeSchema.parse(cmd.data);
  else if (cmd.action === "approve") {
    document = z
      .object({
        approver: z.string().min(3).max(200),
        evidence: z.string().min(5).max(4000),
      })
      .strict()
      .parse(cmd.data);
    const { data } = await db
      .from("delivery_scopes")
      .select("document")
      .eq("project_id", projectId)
      .eq("version", cmd.expected)
      .single();
    const errors = approvalErrors(scopeSchema.parse(data?.document));
    if (errors.length) throw Error(errors.join("; "));
  } else if (cmd.action === "save_plan" || cmd.action === "baseline") {
    const plan = planSchema.parse(cmd.data);
    if (
      cmd.action === "baseline" &&
      plan.tasks.some(
        (t) => !t.start || !t.owner.trim() || !t.hours || !t.acceptance.length,
      )
    )
      throw Error(
        "Baseline exige datas, responsáveis, estimativas e critérios em todas as tarefas",
      );
    const { data } = await db
      .from("delivery_scopes")
      .select("document")
      .eq("project_id", projectId)
      .eq("version", p.approved_version)
      .single();
    const approved = scopeSchema.parse(data?.document);
    validatePlanScope(plan, approved);
    if (cmd.action === "baseline") {
      const uncovered = approved.requirements.filter(
        (r) =>
          r.inclusion === "included" &&
          !plan.tasks.some((t) => t.requirementIds.includes(r.id)),
      );
      if (uncovered.length)
        throw Error(
          "Requisitos sem tarefas: " + uncovered.map((r) => r.id).join(", "),
        );
    }
    document = plan;
  }
  const { data, error } = await db.rpc("delivery_write", {
    p_project: projectId,
    p_actor: userId,
    p_action: cmd.action,
    p_expected: cmd.expected,
    p_request: cmd.requestId,
    p_data: document ?? {},
  });
  if (error) throw Error(error.message);
  return data;
}
export async function compareVersions(
  projectId: string,
  userId: string,
  a: number,
  b: number,
) {
  await projectAccess(projectId, userId);
  const { data, error } = await createAdminClient()
    .from("delivery_scopes")
    .select("version,document")
    .eq("project_id", projectId)
    .in("version", [a, b]);
  if (error) throw Error("Falha ao comparar versões");
  return diffScopes(
    scopeSchema.parse(data?.find((x) => x.version === a)?.document),
    scopeSchema.parse(data?.find((x) => x.version === b)?.document),
  );
}
