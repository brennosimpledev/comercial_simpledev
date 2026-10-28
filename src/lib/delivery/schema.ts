import { z } from "zod";
const id = z.string().regex(/^[A-Z][A-Z0-9_-]{1,63}$/);
const text = z.string().trim().min(1).max(10000);
const item = z.object({ id, name: text }).strict();
export const scopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: text,
    objective: text,
    sources: z
      .array(z.object({ name: text, reference: text }).strict())
      .max(100),
    roles: z.array(item).min(1).max(100),
    modules: z.array(item).min(1).max(200),
    requirements: z
      .array(
        z
          .object({
            id,
            moduleId: id,
            roleIds: z.array(id),
            title: text,
            description: text,
            inclusion: z.enum(["included", "optional", "pending", "excluded"]),
            decisionId: id.optional(),
            acceptance: z.array(text).max(30),
            hours: z.number().nonnegative().max(10000).nullable(),
            assumptions: z.array(text).max(30),
            source: text,
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    decisions: z
      .array(
        z
          .object({
            id,
            question: text,
            options: z.array(text).min(2),
            answer: text.nullable(),
          })
          .strict(),
      )
      .max(100),
    exclusions: z.array(text).max(100),
    risks: z.array(text).max(100),
    planningNotes: z.array(text).max(100),
  })
  .strict()
  .superRefine((s, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    for (const [kind, items] of Object.entries({
      roles: s.roles,
      modules: s.modules,
      requirements: s.requirements,
      decisions: s.decisions,
    }))
      if (new Set(items.map((x) => x.id)).size !== items.length)
        fail(`IDs duplicados: ${kind}`);
    for (const r of s.requirements) {
      if (!s.modules.some((m) => m.id === r.moduleId))
        fail(`${r.id}: módulo inexistente`);
      if (r.roleIds.some((id) => !s.roles.some((x) => x.id === id)))
        fail(`${r.id}: perfil inexistente`);
      if (r.decisionId && !s.decisions.some((d) => d.id === r.decisionId))
        fail(`${r.id}: decisão inexistente`);
      if (r.inclusion === "pending" && !r.decisionId)
        fail(`${r.id}: decisão obrigatória`);
    }
    for (const d of s.decisions)
      if (d.answer && !d.options.includes(d.answer))
        fail(`${d.id}: resposta fora das opções`);
  });
export type Scope = z.infer<typeof scopeSchema>;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida",
  );
export const taskSchema = z
  .object({
    id,
    title: text,
    requirementIds: z.array(id),
    foundation: z.boolean(),
    category: z.enum([
      "planning",
      "infrastructure",
      "development",
      "qa",
      "security",
      "deployment",
      "validation",
    ]),
    owner: z.string().max(200),
    hours: z.number().positive().max(10000).nullable(),
    dependencies: z.array(id),
    start: date.nullable(),
    end: date.nullable(),
    status: z.enum(["todo", "doing", "review", "blocked", "done"]),
    acceptance: z.array(text),
    evidence: z.string().max(4000),
    issueNumber: z.number().int().positive().nullable(),
    pullNumber: z.number().int().positive().nullable(),
  })
  .strict();
export const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    scopeVersion: z.number().int().positive(),
    architecture: z.string().max(30000),
    dataModel: z.string().max(30000),
    permissions: z.string().max(30000),
    integrations: z.string().max(30000),
    testStrategy: z.string().max(30000),
    weeklyCapacity: z.number().positive().max(1000).nullable(),
    tasks: z.array(taskSchema).min(1).max(2000),
  })
  .strict()
  .superRefine((p, c) => {
    const fail = (message: string) => c.addIssue({ code: "custom", message });
    const tasks = new Map(p.tasks.map((t) => [t.id, t]));
    if (tasks.size !== p.tasks.length) fail("IDs de tarefas duplicados");
    const visiting = new Set<string>(),
      visited = new Set<string>();
    function visit(id: string) {
      if (visiting.has(id)) {
        fail("Dependências cíclicas");
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of tasks.get(id)?.dependencies ?? [])
        if (tasks.has(dep)) visit(dep);
      visiting.delete(id);
      visited.add(id);
    }
    for (const t of p.tasks) {
      if (!t.foundation && !t.requirementIds.length)
        fail(`${t.id}: vincule um requisito`);
      if (
        (t.start === null) !== (t.end === null) ||
        (t.start && t.end && t.start > t.end)
      )
        fail(`${t.id}: período inválido`);
      if (t.status === "done" && (!t.evidence.trim() || !t.acceptance.length))
        fail(`${t.id}: conclusão exige evidência e critérios`);
      for (const dep of t.dependencies) {
        const d = tasks.get(dep);
        if (!d) fail(`${t.id}: dependência inexistente`);
        else if (t.start && d.end && t.start <= d.end)
          fail(`${t.id}: início deve ser posterior à dependência`);
      }
      visit(t.id);
    }
  });
export type Plan = z.infer<typeof planSchema>;
export function validatePlanScope(plan: Plan, scope: Scope) {
  for (const task of plan.tasks)
    for (const ref of task.requirementIds)
      if (
        !scope.requirements.some(
          (r) => r.id === ref && r.inclusion === "included",
        )
      )
        throw Error(`${task.id}: requisito ${ref} não incluído`);
}
export function approvalErrors(s: Scope) {
  return [
    ...s.requirements
      .filter((r) => r.inclusion === "pending")
      .map((r) => `${r.id}: inclusão pendente`),
    ...s.decisions
      .filter((d) => !d.answer)
      .map((d) => `${d.id}: decisão pendente`),
  ];
}
export function diffScopes(before: Scope, after: Scope) {
  const a = new Map(before.requirements.map((r) => [r.id, r])),
    b = new Map(after.requirements.map((r) => [r.id, r]));
  return {
    added: after.requirements.filter((r) => !a.has(r.id)),
    removed: before.requirements.filter((r) => !b.has(r.id)),
    changed: after.requirements.filter(
      (r) => a.has(r.id) && JSON.stringify(a.get(r.id)) !== JSON.stringify(r),
    ),
    otherChanges: [
      "title",
      "objective",
      "sources",
      "roles",
      "modules",
      "decisions",
      "exclusions",
      "risks",
      "planningNotes",
    ].filter(
      (k) =>
        JSON.stringify(before[k as keyof Scope]) !==
        JSON.stringify(after[k as keyof Scope]),
    ),
  };
}
export function clientScope(s: Scope) {
  return {
    ...s,
    planningNotes: undefined,
    requirements: s.requirements.map(({ hours, assumptions, ...r }) => r),
  };
}
