import { createHash } from "node:crypto"
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolveDashboardBaseUrl } from "./dashboard-endpoint"
import {
  acceptanceReadiness,
  type AcceptancePlan,
} from "./acceptance"
import { effectiveTotalDispatchLimit, type BudgetState, type ExecutionLimits } from "./budget"
import type { KnowledgeReport } from "./knowledge"
import type { OpenQuestion } from "./oq"
import type { LoomRuntimeIdentity } from "./runtime"
import { runnable, type Workflow } from "./workflow"
import {
  nextRunnableWaves,
  workPlanContext,
  workTree,
  type WorkHierarchy,
  type WorkNodeStatus,
  type WorkTree,
} from "./work"

export function clippedSummary(value?: string, max = 180) {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1) + "…"
}

export function compactQuestions(questions: OpenQuestion[], workflow: Workflow) {
  const unresolved = questions.filter((question) => question.status !== "closed")
  return {
    open: unresolved.length,
    routes: (workflow.cancellation ? [] : unresolved)
      .filter((question) => !question.answer)
      .map((question) => ({
        questionId: question.id,
        responder: question.requiredAuthority,
        blocking: question.blocking,
      })),
    reconcile: (workflow.cancellation ? [] : unresolved)
      .filter((question) => Boolean(question.answer))
      .flatMap((question) =>
        question.consumerStepIds
          .filter((stepId) => !question.reconciliations[stepId])
          .map((stepId) => ({
            questionId: question.id,
            stepId,
            agent: workflow.steps.find((step) => step.id === stepId)?.agent,
          })),
      ),
  }
}

export function compactVerification(workflow: Workflow) {
  const requirements = workflow.verification ?? []
  return {
    open: requirements
      .filter((requirement) => requirement.status === "open")
      .map((requirement) => ({
        id: requirement.id,
        before: requirement.beforeStepId,
        kind: requirement.kind,
        statement: clippedSummary(requirement.statement, 140),
      })),
    satisfied: requirements.filter((requirement) => requirement.status === "satisfied").length,
  }
}

export function compactWorkflowState(
  workflow: Workflow,
  questions: OpenQuestion[],
  budget: BudgetState,
  limits: ExecutionLimits,
  acceptance?: AcceptancePlan,
  knowledge?: KnowledgeReport,
) {
  const ready = runnable(workflow)
  const finished = workflow.steps.filter((step) => ["complete", "passed", "failed"].includes(step.status))
  const failed = workflow.steps.filter((step) => step.status === "failed")
  const pending = workflow.steps.filter((step) => step.status === "pending")
  const readyIds = new Set(ready.map((step) => step.id))
  const blockedPending = pending.filter((step) => !readyIds.has(step.id))

  const state =
    workflow.cancellation ? "cancelled" :
    failed.length > 0 && ready.length === 0
      ? "blocked"
      : pending.length === 0
        ? "complete"
        : "active"

  return {
    workflowId: workflow.id,
    state,
    ...(workflow.cancellation ? { cancellation: { at: workflow.cancellation.at, reason: clippedSummary(workflow.cancellation.reason) } } : {}),
    progress: {
      finished: finished.length,
      total: workflow.steps.length,
      failed: failed.length,
    },
    now: ready.map((step) => ({ step: step.id, agent: step.agent, kind: step.kind })),
    recent: finished.slice(-5).map((step) => ({
      step: step.id,
      agent: step.agent,
      status: step.status,
      ...(step.summary ? { summary: clippedSummary(step.summary) } : {}),
    })),
    upcoming: (workflow.cancellation ? [] : blockedPending.slice(0, 6)).map((step) => ({
      step: step.id,
      agent: step.agent,
      waitsFor: step.dependsOn.filter(
        (dependency) =>
          !workflow.steps.some(
            (candidate) =>
              candidate.id === dependency && ["complete", "passed"].includes(candidate.status),
          ),
      ),
    })),
    questions: compactQuestions(questions, workflow),
    verification: compactVerification(workflow),
    budget: {
      dispatches: budget.totalDispatches,
      maxDispatches: effectiveTotalDispatchLimit(budget, limits),
      ...(budget.exhausted ? { exhausted: budget.exhausted } : {}),
    },
    acceptance: acceptance ? acceptanceReadiness(acceptance) : null,
    knowledge: knowledge ? { valid: knowledge.valid } : null,
  }
}

export type CompactWorkflowState = ReturnType<typeof compactWorkflowState>

export type StatusWorkSummary = {
  tree: WorkTree
  plan: ReturnType<typeof workPlanContext>
  nextRunnableWaves: ReturnType<typeof nextRunnableWaves>
  version: number
}

export type StatusView = CompactWorkflowState & {
  work: StatusWorkSummary | null
}

export function buildStatusView(
  workflow: Workflow,
  questions: OpenQuestion[],
  budget: BudgetState,
  limits: ExecutionLimits,
  acceptance?: AcceptancePlan,
  knowledge?: KnowledgeReport,
  work?: WorkHierarchy,
): StatusView {
  return {
    ...compactWorkflowState(workflow, questions, budget, limits, acceptance, knowledge),
    work: work
      ? {
          tree: workTree(work),
          plan: workPlanContext(work, undefined, "full"),
          nextRunnableWaves: nextRunnableWaves(work),
          version: work.version,
        }
      : null,
  }
}

function markdownCode(value: string) {
  return `\`${value.replaceAll("\`", "\\\`")}\``
}

function statusGlyph(status: string) {
  if (status === "complete" || status === "passed") return "✓"
  if (status === "failed" || status === "blocked") return "!"
  if (status === "active" || status === "runnable") return "→"
  if (status === "cancelled" || status === "superseded") return "×"
  return "○"
}

function workAttention(view: StatusView) {
  if (!view.work) return []
  const phases = view.work.tree.phases
  return phases.flatMap((phase) =>
    phase.waves
      .filter((wave) => wave.status === "active" || wave.status === "blocked")
      .map((wave) => ({
        phase: phase.title,
        wave: wave.title,
        status: wave.status,
        progress: wave.progress,
      })),
  )
}

export type StatusArtifact = {
  path: string
  uri: string
  webUrl: string
}

export async function dashboardBaseUrl(runtime: LoomRuntimeIdentity) {
  return resolveDashboardBaseUrl(runtime.stateRoot)
}

export async function dashboardWorkflowUrl(runtime: LoomRuntimeIdentity, workflowId: string) {
  const baseUrl = await dashboardBaseUrl(runtime)
  return `${baseUrl}/#/project/${encodeURIComponent(runtime.projectId)}/workflow/${encodeURIComponent(workflowId)}`
}

async function statusWebUrl(runtime: LoomRuntimeIdentity, path: string) {
  const route = [
    "status",
    runtime.installationId,
    runtime.projectId,
    basename(path),
  ].map((part) => encodeURIComponent(part)).join("/")
  return `${await dashboardBaseUrl(runtime)}/${route}`
}

export function statusPreviewCode(artifact: Pick<StatusArtifact, "path" | "uri">) {
  const path = JSON.stringify(artifact.path)
  const uri = JSON.stringify(artifact.uri)
  return [
    `const path = ${path};`,
    `const uri = ${uri};`,
    `if (!tools?.browser?.preview) return { kind: "loom-status-preview", status: "unavailable", reason: "browser-tool-unavailable", path, uri, retry: false };`,
    `try {`,
    `  const preview = await tools.browser.preview({ path });`,
    `  return { kind: "loom-status-preview", status: "opened", path, uri, retry: false, preview };`,
    `} catch (error) {`,
    `  const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);`,
    `  const disconnected = message.includes("browser.disconnected") || message.includes("No desktop browser is connected");`,
    `  return { kind: "loom-status-preview", status: disconnected ? "unavailable" : "error", reason: disconnected ? "browser-disconnected" : "browser-preview-error", path, uri, retry: false, message };`,
    `}`,
  ].join("\n")
}

export function statusPresentation(artifact: StatusArtifact | undefined) {
  if (!artifact) return undefined
  return {
    kind: "artifact" as const,
    preferred: "web" as const,
    webUrl: artifact.webUrl,
    path: artifact.path,
    uri: artifact.uri,
    desktopPreview: {
      optional: true,
      tool: "execute",
      code: statusPreviewCode(artifact),
    },
  }
}

export function renderStatusMarkdown(view: StatusView, artifact?: StatusArtifact) {
  const lines = [
    `## Loom · ${statusGlyph(view.state)} ${view.state} · ${view.progress.finished}/${view.progress.total}`,
    "",
    `- **Workflow:** ${markdownCode(view.workflowId)}`,
  ]

  if (view.cancellation) {
    lines.push(`- **Cancelled:** ${clippedSummary(view.cancellation.reason)}. Completed work is preserved; unfinished checks are not passes. A replacement workflow may now start.`)
  }
  if (view.work) {
    const objective = view.work.tree.objective
    lines.push(
      `- **Objective:** ${statusGlyph(objective.status)} ${objective.title} · ${objective.progress.finished}/${objective.progress.total} tasks`,
    )
    if (view.work.plan) {
      lines.push(
        `- **Plan:** generation ${view.work.plan.generation} · revision ${view.work.plan.revision}${view.work.plan.invalidated ? " · invalidated" : ""} · ${clippedSummary(view.work.plan.goal)}`,
      )
    }
    for (const item of workAttention(view).slice(0, 3)) {
      lines.push(
        `- **Work:** ${statusGlyph(item.status)} ${item.phase} / ${item.wave} · ${item.progress.finished}/${item.progress.total}`,
      )
    }
  }

  if (view.now.length) {
    lines.push("", "### Now")
    for (const step of view.now.slice(0, 5)) {
      lines.push(`- → **${step.agent}** · ${markdownCode(step.step)}`)
    }
    if (view.now.length > 5) lines.push(`- … +${view.now.length - 5} more runnable steps`)
  }

  const attention: string[] = []
  if (view.questions.open) attention.push(`${view.questions.open} OQ${view.questions.open === 1 ? "" : "s"}`)
  if (view.verification.open.length) attention.push(`${view.verification.open.length} verification open`)
  if (view.progress.failed) attention.push(`${view.progress.failed} failed`)
  if (view.budget.exhausted) attention.push("dispatch budget exhausted")

  lines.push(
    "",
    `**Budget:** ${view.budget.dispatches}/${view.budget.maxDispatches}` +
      (attention.length ? ` · **Attention:** ${attention.join(" · ")}` : ""),
  )
  if (view.acceptance) lines.push(`**Product Acceptance:** ${view.acceptance}`)
  if (view.knowledge) lines.push(`**Knowledge:** ${view.knowledge.valid ? "valid" : "stale"}`)

  if (artifact) {
    lines.push(
      "",
      "### Presentation",
      `- **Open:** [Interactive workflow status](${artifact.webUrl})`,
      `- **Local artifact:** ${markdownCode(fileURLToPath(artifact.uri))}`,
      "- **Web UI:** the HTTP link is the normal presentation path. Loom starts the read-only dashboard with OpenCode by default; `bun run dashboard` remains available for foreground/debug use.",
      "- **Desktop:** native OpenCode browser preview is optional metadata only and is not required for normal status viewing.",
    )
  }

  return lines.join("\n")
}

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function attr(value: unknown) {
  return esc(value)
}

function htmlStatus(status: string) {
  return `<span class="status" data-status="${attr(status)}">${esc(statusGlyph(status))} ${esc(status)}</span>`
}

function taskRuntimeStatus(view: StatusView, taskId: string, stored: WorkNodeStatus) {
  if (stored !== "pending") return stored
  return view.now.some((step) => step.step === `task:${taskId}`) ? "runnable" : stored
}

function nodeOpen(status: string) {
  return status === "active" || status === "blocked"
}

function hierarchyHtml(view: StatusView) {
  if (!view.work) {
    return '<section class="panel"><h2>Work hierarchy</h2><p class="muted">No persistent Objective is attached.</p></section>'
  }

  const tree = view.work.tree
  const phases = tree.phases
    .map((phase) => {
      const waves = phase.waves
        .map((wave) => {
          const tasks = wave.tasks
            .map((task) => {
              const status = taskRuntimeStatus(view, task.id, task.status)
              return `<li class="task node" data-node data-status="${attr(status)}" data-label="${attr(task.title + " " + task.id)}">
                <span class="task-title">${htmlStatus(status)} <span>${esc(task.title)}</span></span>
                <code>${esc(task.id)}</code>
              </li>`
            })
            .join("")

          return `<details class="node wave" data-node data-status="${attr(wave.status)}" data-label="${attr(wave.title + " " + wave.id)}" ${nodeOpen(wave.status) ? "open" : ""}>
            <summary>
              <span>${htmlStatus(wave.status)} <strong>${esc(wave.title)}</strong></span>
              <span class="progress">${wave.progress.finished}/${wave.progress.total}</span>
            </summary>
            <ul>${tasks}</ul>
          </details>`
        })
        .join("")

      return `<details class="node phase" data-node data-status="${attr(phase.status)}" data-label="${attr(phase.title + " " + phase.id)}" ${nodeOpen(phase.status) ? "open" : ""}>
        <summary>
          <span>${htmlStatus(phase.status)} <strong>${esc(phase.title)}</strong></span>
          <span class="progress">${phase.progress.finished}/${phase.progress.total}</span>
        </summary>
        <div class="children">${waves}</div>
      </details>`
    })
    .join("")

  return `<section class="panel">
    <div class="section-head">
      <div>
        <h2>Objective → Phase → Wave → Task</h2>
        <p class="muted">Version ${esc(view.work.version)} · generation ${esc(tree.generation)}</p>
      </div>
      <div class="actions">
        <button id="expand-all" type="button">Expand all</button>
        <button id="collapse-all" type="button">Collapse all</button>
      </div>
    </div>
    <details class="node objective" data-node data-status="${attr(tree.objective.status)}" data-label="${attr(tree.objective.title + " " + tree.objective.id)}" open>
      <summary>
        <span>${htmlStatus(tree.objective.status)} <strong>${esc(tree.objective.title)}</strong></span>
        <span class="progress">${tree.objective.progress.finished}/${tree.objective.progress.total}</span>
      </summary>
      <div class="children">${phases}</div>
    </details>
  </section>`
}

function currentHtml(view: StatusView) {
  const current = view.now.length
    ? view.now
        .map(
          (step) =>
            `<li><span class="agent">${esc(step.agent)}</span><code>${esc(step.step)}</code><span class="muted">${esc(step.kind)}</span></li>`,
        )
        .join("")
    : '<li class="muted">No runnable step.</li>'

  const upcoming = view.upcoming.length
    ? view.upcoming
        .map(
          (step) =>
            `<li><span class="agent">${esc(step.agent)}</span><code>${esc(step.step)}</code><span class="muted">waits for ${esc(step.waitsFor.join(", ") || "dependency release")}</span></li>`,
        )
        .join("")
    : '<li class="muted">No blocked upcoming step.</li>'

  return `<section class="split">
    <div class="panel"><h2>Now</h2><ul class="flat">${current}</ul></div>
    <div class="panel"><h2>Upcoming</h2><ul class="flat">${upcoming}</ul></div>
  </section>`
}

export function renderStatusHtml(view: StatusView) {
  const objectiveProgress = view.work?.tree.objective.progress
  const taskProgress = objectiveProgress ? `${objectiveProgress.finished}/${objectiveProgress.total}` : "—"
  const acceptance = view.acceptance ?? "not started"
  const knowledge = view.knowledge ? (view.knowledge.valid ? "valid" : "stale") : "not available"

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loom workflow status</title>
<style>
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; --border: color-mix(in srgb, currentColor 18%, transparent); --muted: color-mix(in srgb, currentColor 62%, transparent); --surface: color-mix(in srgb, Canvas 94%, currentColor 6%); --accent: LinkText; }
* { box-sizing: border-box; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
header { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
h1, h2, p { margin-top: 0; }
h1 { font-size: clamp(1.35rem, 3vw, 2rem); margin-bottom: 4px; }
h2 { font-size: 1rem; margin-bottom: 12px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.status { white-space: nowrap; font-size: .9rem; }
.status[data-status="blocked"], .status[data-status="failed"] { font-weight: 700; }
.status[data-status="active"], .status[data-status="runnable"] { font-weight: 700; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; margin-bottom: 18px; }
.card, .panel { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.card { padding: 12px; }
.card strong { display: block; font-size: 1.15rem; margin-bottom: 2px; }
.panel { padding: 16px; margin-bottom: 14px; }
.split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.split .panel { margin-bottom: 0; }
.toolbar { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-bottom: 14px; }
.field { display: grid; gap: 4px; min-width: min(260px, 100%); flex: 1; }
label { font-size: .85rem; font-weight: 650; }
input, select, button { font: inherit; min-height: 40px; border-radius: 7px; border: 1px solid var(--border); background: Canvas; color: CanvasText; padding: 7px 10px; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.section-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
details { border-top: 1px solid var(--border); }
details:first-of-type { border-top: 0; }
summary { cursor: pointer; display: flex; gap: 10px; justify-content: space-between; align-items: center; min-height: 44px; padding: 8px 4px; }
summary > span:first-child { min-width: 0; }
.progress { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.children { padding-left: 18px; }
ul { margin: 0; padding-left: 22px; }
.task { padding: 8px 4px; border-top: 1px solid var(--border); }
.task-title { display: inline-flex; gap: 7px; margin-right: 8px; }
.flat { list-style: none; padding: 0; display: grid; gap: 9px; }
.flat li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.agent { font-weight: 700; }
[hidden] { display: none !important; }
#result-count { min-height: 1.2em; }
@media (max-width: 680px) { main { padding: 14px; } .split { grid-template-columns: 1fr; } .children { padding-left: 9px; } .actions { width: 100%; } .actions button { flex: 1; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Loom workflow status</h1>
      <div>${htmlStatus(view.state)} · <code>${esc(view.workflowId)}</code></div>
    </div>
    <div class="muted">Read-only presentation of Loom-authoritative state</div>
  </header>

  ${view.cancellation ? `<section class="panel" aria-label="Cancellation"><h2>Workflow cancelled</h2><p>${esc(view.cancellation.reason)}</p><p>Completed work is preserved. Unfinished checks are not passes. Start a new workflow to continue.</p></section>` : ""}
  <section class="cards" aria-label="Workflow summary">
    <div class="card"><strong>${esc(view.progress.finished)}/${esc(view.progress.total)}</strong><span>Workflow steps</span></div>
    <div class="card"><strong>${esc(taskProgress)}</strong><span>Objective tasks</span></div>
    <div class="card"><strong>${esc(view.questions.open)}</strong><span>Open OQs</span></div>
    <div class="card"><strong>${esc(view.verification.open.length)}</strong><span>Verification open</span></div>
    <div class="card"><strong>${esc(view.budget.dispatches)}/${esc(view.budget.maxDispatches)}</strong><span>Dispatch budget</span></div>
    <div class="card"><strong>${esc(acceptance)}</strong><span>Product Acceptance</span></div>
    <div class="card"><strong>${esc(knowledge)}</strong><span>Knowledge</span></div>
  </section>

  ${currentHtml(view)}

  <section class="panel" aria-label="Hierarchy controls">
    <div class="toolbar">
      <div class="field"><label for="search">Search work</label><input id="search" type="search" placeholder="Phase, Wave, Task or ID"></div>
      <div class="field"><label for="status-filter">Status</label><select id="status-filter">
        <option value="all">All</option>
        <option value="attention">Needs attention</option>
        <option value="runnable">Runnable</option>
        <option value="active">Active</option>
        <option value="blocked">Blocked</option>
        <option value="pending">Pending</option>
        <option value="complete">Complete</option>
      </select></div>
    </div>
    <div id="result-count" class="muted" role="status" aria-live="polite"></div>
  </section>

  ${hierarchyHtml(view)}
</main>
<script>
(() => {
  const search = document.getElementById("search");
  const filter = document.getElementById("status-filter");
  const result = document.getElementById("result-count");
  const root = document.querySelector(".objective");

  const statusMatch = (status, wanted) => {
    if (wanted === "all") return true;
    if (wanted === "attention") return ["active", "blocked", "failed", "runnable"].includes(status);
    return status === wanted;
  };

  const ownMatch = (node, query, wanted) => {
    const label = (node.dataset.label || "").toLowerCase();
    return (!query || label.includes(query)) && statusMatch(node.dataset.status || "", wanted);
  };

  const apply = () => {
    if (!root) return;
    const query = search.value.trim().toLowerCase();
    const wanted = filter.value;
    const constrained = Boolean(query) || wanted !== "all";
    let visibleTasks = 0;

    const phases = [...root.querySelectorAll("details.phase")];
    for (const phase of phases) {
      const phaseOwn = ownMatch(phase, query, wanted);
      const waves = [...phase.querySelectorAll(":scope > .children > details.wave")];
      let phaseHasVisible = false;

      for (const wave of waves) {
        const waveOwn = ownMatch(wave, query, wanted);
        let waveHasVisible = false;
        for (const task of wave.querySelectorAll(":scope > ul > .task")) {
          const visible = phaseOwn || waveOwn || ownMatch(task, query, wanted);
          task.hidden = !visible;
          if (visible) {
            visibleTasks++;
            waveHasVisible = true;
          }
        }
        const waveVisible = phaseOwn || waveOwn || waveHasVisible;
        wave.hidden = !waveVisible;
        if (constrained && waveVisible) wave.open = true;
        phaseHasVisible ||= waveVisible;
      }

      const phaseVisible = phaseOwn || phaseHasVisible;
      phase.hidden = !phaseVisible;
      if (constrained && phaseVisible) phase.open = true;
    }

    result.textContent = constrained ? visibleTasks + " visible task" + (visibleTasks === 1 ? "" : "s") : "";
  };

  search.addEventListener("input", apply);
  filter.addEventListener("change", apply);
  document.getElementById("expand-all")?.addEventListener("click", () => {
    document.querySelectorAll("details:not([hidden])").forEach((node) => { node.open = true; });
  });
  document.getElementById("collapse-all")?.addEventListener("click", () => {
    document.querySelectorAll("details:not(.objective)").forEach((node) => { node.open = false; });
  });
  apply();
})();
</script>
</body>
</html>
`
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWrite(path: string, content: string) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  const handle = await open(temp, "wx", 0o600)
  let replaced = false
  try {
    await handle.writeFile(content, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, path)
    replaced = true
    await syncDirectory(directory)
  } finally {
    if (!replaced) await unlink(temp).catch(() => {})
  }
}

export async function writeStatusArtifact(
  runtime: LoomRuntimeIdentity,
  view: StatusView,
) {
  const key = createHash("sha256").update(view.workflowId).digest("hex").slice(0, 20)
  const path = join(
    runtime.runtimeRoot,
    "artifacts",
    runtime.installationId,
    runtime.projectId,
    "workflow-status",
    `workflow-${key}.html`,
  )
  await atomicWrite(path, renderStatusHtml(view))
  return {
    path,
    uri: pathToFileURL(path).href,
    webUrl: await statusWebUrl(runtime, path),
  }
}
