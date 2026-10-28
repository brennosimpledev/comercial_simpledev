import { Scope, Plan } from "./schema";
export function proposePlan(scope: Scope, version: number): Plan {
  const foundation = [
    ["BASE-01", "Confirmar responsáveis, domínio e contas"],
    ["BASE-02", "Configurar GitHub, ambientes e hospedagem"],
    ["BASE-03", "Configurar Supabase, permissões e backup"],
    ["BASE-04", "Configurar e-mail e cofre Bitwarden"],
  ];
  const tasks: Plan["tasks"] = foundation.map(([id, title]) => ({
    id,
    title,
    requirementIds: [],
    foundation: true,
    category: "infrastructure",
    owner: "",
    hours: null,
    dependencies: [],
    start: null,
    end: null,
    status: "todo",
    acceptance: [],
    evidence: "",
    issueNumber: null,
    pullNumber: null,
  }));
  for (const [index, r] of scope.requirements
    .filter((r) => r.inclusion === "included")
    .entries())
    tasks.push({
      id: `DEV-${String(index + 1).padStart(4, "0")}`,
      title: r.title,
      requirementIds: [r.id],
      foundation: false,
      category: "development",
      owner: "",
      hours: r.hours,
      dependencies: [],
      start: null,
      end: null,
      status: "todo",
      acceptance: r.acceptance,
      evidence: "",
      issueNumber: null,
      pullNumber: null,
    });
  for (const [id, title, category] of [
    ["QA-01", "Validar critérios de aceite", "qa"],
    ["SEC-01", "Revisar segurança e isolamento de dados", "security"],
    ["DEP-01", "Preparar entrega e rollback", "deployment"],
    ["VAL-01", "Validação assistida e análise de uso", "validation"],
  ] as const)
    tasks.push({
      id,
      title,
      category,
      foundation: true,
      requirementIds: [],
      owner: "",
      hours: null,
      dependencies: [],
      start: null,
      end: null,
      status: "todo",
      acceptance: [],
      evidence: "",
      issueNumber: null,
      pullNumber: null,
    });
  return {
    schemaVersion: 1,
    scopeVersion: version,
    architecture: "",
    dataModel: "",
    permissions: "",
    integrations: "",
    testStrategy: "",
    weeklyCapacity: null,
    tasks,
  };
}
export function implementationDoc(scope: Scope, plan: Plan) {
  return (
    `# ${scope.title}\n\nEscopo aprovado v${plan.scopeVersion}. Documento interno de planejamento.\n\n## Objetivo\n${scope.objective}\n\n` +
    [
      ["Arquitetura", plan.architecture],
      ["Modelo de dados", plan.dataModel],
      ["Permissões", plan.permissions],
      ["Integrações", plan.integrations],
      ["Estratégia de testes", plan.testStrategy],
    ]
      .map(([k, v]) => `## ${k}\n${v || "Pendente de planejamento."}\n`)
      .join("\n") +
    "\n## Requisitos incluídos\n" +
    scope.requirements
      .filter((r) => r.inclusion === "included")
      .map(
        (r) =>
          `### ${r.id}: ${r.title}\n${r.description}\n\nCritérios de aceite:\n${r.acceptance.length ? r.acceptance.map((a) => "- " + a).join("\n") : "Pendente."}\n`,
      )
      .join("\n") +
    "\n## Checklist de execução\n" +
    plan.tasks
      .map(
        (t) =>
          `- [${t.status === "done" ? "x" : " "}] ${t.id}: ${t.title} — ${t.owner || "Sem responsável"}; requisitos: ${t.requirementIds.join(", ") || "Fundação"}; dependências: ${t.dependencies.join(", ") || "A definir"}; evidência: ${t.evidence || "Pendente"}`,
      )
      .join("\n") +
    "\n\n## Riscos\n" +
    scope.risks.map((x) => "- " + x).join("\n") +
    "\n\n## Fora do escopo\n" +
    scope.exclusions.map((x) => "- " + x).join("\n")
  );
}
export function progress(plan: Plan) {
  const known = plan.tasks.every((t) => t.hours !== null);
  const total = plan.tasks.reduce((n, t) => n + (t.hours ?? 0), 0);
  return {
    done: plan.tasks.filter((t) => t.status === "done").length,
    total: plan.tasks.length,
    weighted:
      known && total > 0
        ? Math.round(
            (100 *
              plan.tasks
                .filter((t) => t.status === "done")
                .reduce((n, t) => n + t.hours!, 0)) /
              total,
          )
        : null,
  };
}
