import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { planSchema } from "./schema";
export function validSignature(
  raw: string,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !secret)
    return false;
  return timingSafeEqual(
    Buffer.from(signature.slice(7), "hex"),
    createHmac("sha256", secret).update(raw).digest(),
  );
}
async function github(path: string) {
  const token = process.env.DELIVERY_GITHUB_TOKEN;
  if (!token)
    throw Error(
      "Configure DELIVERY_GITHUB_TOKEN com acesso de leitura aos repositórios",
    );
  const res = await fetch("https://api.github.com" + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok)
    throw Error(
      `GitHub retornou ${res.status}; confira permissão e limite de requisições`,
    );
  return res.json();
}
export async function reconcileProject(projectId: string) {
  const db = createAdminClient();
  const { data: p } = await db
    .from("delivery_projects")
    .select("repository")
    .eq("id", projectId)
    .single();
  if (!p?.repository || !/^[\w.-]+\/[\w.-]+$/.test(p.repository))
    throw Error("Vincule um repositório");
  const { data: row } = await db
    .from("delivery_plans")
    .select("document")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!row) throw Error("Crie um plano primeiro");
  const plan = planSchema.parse(row.document),
    linked = plan.tasks.filter((t) => t.issueNumber || t.pullNumber);
  if (linked.length > 100)
    throw Error("Sincronização limitada a 100 tarefas vinculadas por projeto");
  const evidence: Record<string, unknown> = {};
  for (const task of linked) {
    const base = `/repos/${p.repository}`;
    let issue = null,
      pull = null,
      checks = null,
      deployments = null;
    if (task.issueNumber) {
      const x = await github(`${base}/issues/${task.issueNumber}`);
      if (x.pull_request)
        throw Error(`${task.id}: número da issue aponta para um PR`);
      issue = {
        number: x.number,
        state: x.state,
        reason: x.state_reason,
        url: x.html_url,
        updatedAt: x.updated_at,
      };
    }
    if (task.pullNumber) {
      const x = await github(`${base}/pulls/${task.pullNumber}`);
      pull = {
        number: x.number,
        state: x.state,
        merged: x.merged,
        draft: x.draft,
        url: x.html_url,
        sha: x.head.sha,
      };
      const checkData = await github(
        `${base}/commits/${x.head.sha}/check-runs?per_page=100`,
      );
      checks = {
        total: checkData.total_count,
        truncated: checkData.total_count > 100,
        runs: checkData.check_runs.map(
          (c: {
            name: string;
            status: string;
            conclusion: string;
            html_url: string;
          }) => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            url: c.html_url,
          }),
        ),
      };
      const sha = x.merge_commit_sha || x.head.sha;
      const ds = await github(`${base}/deployments?sha=${sha}&per_page=5`);
      deployments = [];
      for (const d of ds) {
        const statuses = await github(
          `${base}/deployments/${d.id}/statuses?per_page=1`,
        );
        deployments.push({
          environment: d.environment,
          sha: d.sha,
          state: statuses[0]?.state ?? "unknown",
        });
      }
    }
    evidence[task.id] = { issue, pull, checks, deployments };
  }
  const { error } = await db
    .from("delivery_github")
    .upsert({
      project_id: projectId,
      repository: p.repository,
      evidence,
      synced_at: new Date().toISOString(),
    });
  if (error) throw Error("Falha ao registrar evidências");
  return { tasks: linked.length };
}
