export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loom Operations</title>
<style>
:root {
  --font-ui: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --bg: #0b1020;
  --surface: #121a2f;
  --surface-2: #18223b;
  --text: #eef2ff;
  --muted: #aab4d0;
  --border: #33415f;
  --focus: #8bb7ff;
  --danger: #ff8c9a;
  --warn: #ffd479;
  --ok: #91e6b3;
  --stale: #c5b3ff;
  --shadow: 0 12px 36px rgb(0 0 0 / 0.24);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-ui); overflow-x: clip; }
body { padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left)); }
a { color: inherit; }
button, select, input { font: inherit; }
button, select, input, a { outline: none; }
button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible { box-shadow: 0 0 0 3px var(--focus); }
.shell { width: min(118rem, 100%); margin: 0 auto; }
.topbar { display: grid; gap: 0.75rem; grid-template-columns: 1fr; align-items: end; margin-bottom: 1rem; }
.title { margin: 0; font-size: clamp(1.4rem, 3vw, 2.2rem); }
.subtitle { color: var(--muted); margin: 0.25rem 0 0; }
.filters { display: flex; gap: 0.65rem; flex-wrap: wrap; align-items: end; }
.field { display: grid; gap: 0.3rem; color: var(--muted); font-size: 0.9rem; }
.field input, .field select { min-height: 2.5rem; padding: 0.55rem 0.7rem; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 0.55rem; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 0.8rem; box-shadow: var(--shadow); }
.grid { display: grid; gap: 0.75rem; }
.workflow { display: grid; gap: 0.55rem; padding: 0.9rem; text-decoration: none; }
.workflow:hover { background: var(--surface-2); }
.workflow-head { display: flex; gap: 0.5rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.identity { min-width: 0; }
.name { font-weight: 700; overflow-wrap: anywhere; }
.path, .meta { color: var(--muted); font-size: 0.88rem; overflow-wrap: anywhere; }
.badges { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.badge { border: 1px solid var(--border); border-radius: 999px; padding: 0.18rem 0.48rem; font-size: 0.78rem; white-space: nowrap; }
.badge[data-tone="danger"] { color: var(--danger); }
.badge[data-tone="warn"] { color: var(--warn); }
.badge[data-tone="ok"] { color: var(--ok); }
.badge[data-tone="stale"] { color: var(--stale); }
.badge[data-state]::before { display: inline-block; margin-right: 0.28rem; font-weight: 800; }
.badge[data-state="consistency conflict"]::before { content: "⚠"; }
.badge[data-state="failed"]::before { content: "×"; }
.badge[data-state="blocked"]::before { content: "!"; }
.badge[data-state="stale/offline"]::before { content: "◷"; }
.badge[data-state="active"]::before { content: "▶"; }
.badge[data-state="complete"]::before { content: "✓"; }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.45rem; }
.stat { padding: 0.45rem 0.55rem; border-radius: 0.5rem; background: var(--surface-2); }
.stat strong { display: block; font-size: 1rem; }
.stat span { color: var(--muted); font-size: 0.78rem; }
.breadcrumbs { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0 0 0.75rem; color: var(--muted); }
.breadcrumbs a { color: var(--text); }
.detail { padding: 1rem; }
.section { margin-top: 1rem; }
.section h2 { font-size: 1rem; margin: 0 0 0.6rem; }
.list { display: grid; gap: 0.45rem; }
.row { padding: 0.55rem 0.65rem; border: 1px solid var(--border); border-radius: 0.55rem; background: var(--surface-2); }
.hierarchy { display: grid; gap: 0.6rem; }
.hierarchy ul { margin: 0.35rem 0 0 1rem; padding: 0; }
.empty { padding: 2rem; color: var(--muted); text-align: center; }
.notice { padding: 0.7rem; border: 1px solid var(--border); border-radius: 0.55rem; color: var(--muted); }
.projection-status { margin: 0 0 0.75rem; }
[hidden] { display: none !important; }
.sr-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
@media (min-width: 52rem) {
  .topbar { grid-template-columns: 1fr auto; }
  .stats { grid-template-columns: repeat(5, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div>
      <h1 class="title">Loom Operations</h1>
      <p class="subtitle">Read-only fleet view of Loom-authoritative state. OpenCode telemetry is supplemental when present.</p>
    </div>
    <div class="filters" aria-label="Fleet filters">
      <label class="field">Status
        <select id="status-filter">
          <option value="all">All</option>
          <option value="attention">Needs attention</option>
          <option value="active">Active</option>
          <option value="complete">Complete</option>
          <option value="stale">Stale/offline</option>
        </select>
      </label>
      <label class="field">Project
        <input id="project-filter" type="search" autocomplete="off" placeholder="Filter project">
      </label>
      <label class="field">Agent
        <input id="agent-filter" type="search" autocomplete="off" placeholder="Filter current agent">
      </label>
    </div>
  </header>
  <nav id="breadcrumbs" class="breadcrumbs" aria-label="Location"></nav>
  <div id="projection-status" class="notice projection-status" role="status" hidden></div>
  <main id="main" tabindex="-1"></main>
  <div id="live" class="sr-live" aria-live="polite" aria-atomic="true"></div>
</div>
<script>
(() => {
  const state = { fleet: { projects: [] }, status: "all", project: "", agent: "", lastKeys: new Set() };
  const main = document.getElementById("main");
  const crumbs = document.getElementById("breadcrumbs");
  const live = document.getElementById("live");
  const statusFilter = document.getElementById("status-filter");
  const projectFilter = document.getElementById("project-filter");
  const agentFilter = document.getElementById("agent-filter");
  const projectionStatus = document.getElementById("projection-status");

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  );
  const enc = encodeURIComponent;
  const dec = decodeURIComponent;

  function route() {
    const hash = location.hash.startsWith("#/") ? location.hash.slice(2) : location.hash.replace(/^#/, "");
    const parts = hash.split("/").filter(Boolean).map(dec);
    if (parts[0] !== "project") return { kind: "fleet" };
    if (!parts[1]) return { kind: "fleet" };
    if (parts[2] !== "workflow") return { kind: "project", projectId: parts[1] };
    if (!parts[3]) return { kind: "project", projectId: parts[1] };
    if (parts[4] === "session" && parts[5]) return { kind: "session", projectId: parts[1], workflowId: parts[3], instanceId: parts[5] };
    return { kind: "workflow", projectId: parts[1], workflowId: parts[3] };
  }

  function projectById(id) { return state.fleet.projects.find((p) => p.projectId === id); }
  function workflowById(project, id) { return project?.workflows.find((w) => w.workflowId === id); }
  function resolved(w) { return w.consistency === "ok" ? w.projection : null; }
  function displayState(w) {
    if (w.consistency === "conflict") return "consistency conflict";
    const p = resolved(w);
    if (p?.status === "failed") return "failed";
    if (p?.status === "blocked") return "blocked";
    if (w.sourceFreshness === "stale-source") return "stale/offline";
    return p?.status || "unknown";
  }
  function tone(w) {
    const p = resolved(w);
    if (w.consistency === "conflict" || p?.status === "failed") return "danger";
    if (p?.status === "blocked") return "warn";
    if (w.sourceFreshness === "stale-source") return "stale";
    return "ok";
  }
  function needsAttention(w) {
    const p = resolved(w);
    return w.consistency === "conflict" || p?.status === "failed" || p?.status === "blocked" || w.sourceFreshness === "stale-source";
  }
  function filteredWorkflows() {
    const needle = state.project.trim().toLowerCase();
    const agentNeedle = state.agent.trim().toLowerCase();
    return state.fleet.projects.flatMap((project) =>
      project.workflows
        .filter((w) => {
          if (needle && !((project.displayName || project.canonicalLocation || project.projectId).toLowerCase().includes(needle))) return false;
          if (agentNeedle && !(resolved(w)?.activeAgent || "").toLowerCase().includes(agentNeedle)) return false;
          if (state.status === "attention") return needsAttention(w);
          if (state.status === "stale") return w.sourceFreshness === "stale-source";
          if (state.status === "active") return resolved(w)?.status === "active" && w.sourceFreshness === "live";
          if (state.status === "complete") return resolved(w)?.status === "complete";
          return true;
        })
        .map((workflow) => ({ project, workflow }))
    );
  }

  function badges(w) {
    const p = resolved(w);
    const stateLabel = displayState(w);
    return [
      '<span class="badge" data-state="' + esc(stateLabel) + '" data-tone="' + tone(w) + '">' + esc(stateLabel) + '</span>',
      '<span class="badge">rev ' + esc(w.workflowRevision) + '</span>',
      p?.activeAgent ? '<span class="badge">agent ' + esc(p.activeAgent) + '</span>' : "",
      p?.budget?.exhausted ? '<span class="badge" data-tone="warn">budget exhausted</span>' : "",
    ].join("");
  }

  function workflowCard(project, w) {
    const href = '#/project/' + enc(project.projectId) + '/workflow/' + enc(w.workflowId);
    const key = project.projectId + ":" + w.workflowId;
    const p = resolved(w);
    const identity = p?.anchor || w.workflowId;
    const conflictMeta = w.consistency === "conflict"
      ? 'Conflicting highest-revision snapshots: ' + esc(w.conflictCandidates?.length ?? 0)
      : 'Last meaningful activity: ' + esc(p?.recentActivityAt || "unknown");
    const taskProgress = p?.hierarchyProgress?.tasks;
    const budgetValue = p?.budget
      ? (p.budget.used ?? "—") + "/" + (p.budget.limit ?? "—")
      : "—";
    return '<a class="workflow panel" data-key="' + esc(key) + '" href="' + href + '">' +
      '<div class="workflow-head"><div class="identity"><div class="name">' + esc(project.displayName || project.projectId) + ' · ' + esc(identity) + '</div><div class="path">' + esc(project.canonicalLocation) + '</div></div><div class="badges">' + badges(w) + '</div></div>' +
      '<div class="stats">' +
        '<div class="stat"><strong>' + esc(p?.openOqCount ?? "—") + '</strong><span>Open OQs</span></div>' +
        '<div class="stat"><strong>' + esc(p?.openVerificationCount ?? "—") + '</strong><span>Verification</span></div>' +
        '<div class="stat"><strong>' + esc(budgetValue) + '</strong><span>Budget used/limit</span></div>' +
        '<div class="stat"><strong>' + esc(taskProgress ? taskProgress.complete + "/" + taskProgress.total : "—") + '</strong><span>Tasks complete</span></div>' +
        '<div class="stat"><strong>' + esc(p?.runnableSteps?.length ?? "—") + '</strong><span>Runnable</span></div>' +
        '<div class="stat"><strong>' + esc(w.participants?.filter((participant) => participant.live).length ?? 0) + '/' + esc(w.participants?.length ?? 0) + '</strong><span>Live publishers</span></div>' +
      '</div>' +
      '<div class="meta">' + conflictMeta + '</div>' +
    '</a>';
  }

  function renderFleet() {
    crumbs.innerHTML = '<span>Fleet</span>';
    const items = filteredWorkflows();
    if (!items.length) {
      const workflowCount = state.fleet.projects.reduce((total, project) => total + project.workflows.length, 0);
      const hasFilters = state.status !== "all" || state.project.trim() || state.agent.trim();
      if (!state.fleet.projects.length) {
        main.innerHTML = '<section class="panel empty"><strong>No Loom instances discovered.</strong><div>Start an OpenCode + Loom process to populate Fleet.</div></section>';
      } else if (workflowCount === 0) {
        main.innerHTML = '<section class="panel empty"><strong>No active or recent workflows.</strong><div>Loom instances are publishing, but no workflows are currently inside the dashboard projection window.</div></section>';
      } else if (hasFilters) {
        main.innerHTML = '<section class="panel empty"><strong>No workflows match the current filters.</strong><div>Change or clear a Fleet filter to show other projected work.</div></section>';
      } else {
        main.innerHTML = '<section class="panel empty"><strong>No projected workflows.</strong></section>';
      }
      return;
    }
    main.innerHTML = '<section class="grid" aria-label="Fleet workflows">' + items.map(({project, workflow}) => workflowCard(project, workflow)).join("") + '</section>';
  }

  function renderHierarchy(project) {
    if (!project.workObjectives?.length) return '<div class="notice">No current work hierarchy is projected.</div>';
    return '<div class="hierarchy">' + project.workObjectives.map((objective) => {
      if (objective.consistency === "conflict") {
        return '<div class="row"><div class="name">' + esc(objective.objectiveId) + '</div><div class="meta">Consistency conflict at work version ' + esc(objective.workVersion) + '. No hierarchy winner is selected.</div></div>';
      }
      const p = objective.projection;
      return '<div class="row"><div class="name">' + esc(p?.title || objective.objectiveId) + '</div>' +
        '<div class="meta">Objective: ' + esc(p?.status || "unknown") + ' · version ' + esc(objective.workVersion) + '</div>' +
        '<ul>' + (p?.phases || []).map((phase) =>
          '<li>' + esc(phase.title || phase.phaseId) + ' — ' + esc(phase.status) +
          '<ul>' + (phase.waves || []).map((wave) =>
            '<li>' + esc(wave.title || wave.waveId) + ' — ' + esc(wave.status) +
            '<ul>' + (wave.tasks || []).map((task) => '<li>' + esc(task.title || task.taskId) + ' — ' + esc(task.status) + (task.claimedByWorkflowId ? ' · claimed by ' + esc(task.claimedByWorkflowId) : '') + '</li>').join("") + '</ul></li>'
          ).join("") + '</ul></li>'
        ).join("") + '</ul></div>';
    }).join("") + '</div>';
  }

  function renderProject(project) {
    crumbs.innerHTML = '<a href="#/">Fleet</a><span>›</span><span>' + esc(project.displayName || project.projectId) + '</span>';
    main.innerHTML = '<section class="panel detail"><h2 class="name">' + esc(project.displayName || project.projectId) + '</h2><div class="path">' + esc(project.canonicalLocation) + '</div>' +
      '<div class="section"><h2>Objective → Phase → Wave → Task</h2>' + renderHierarchy(project) + '</div>' +
      '<div class="section"><h2>Workflows</h2><div class="grid">' + project.workflows.map((w) => workflowCard(project, w)).join("") + '</div></div></section>';
  }

  function renderWorkflow(project, w) {
    crumbs.innerHTML = '<a href="#/">Fleet</a><span>›</span><a href="#/project/' + enc(project.projectId) + '">' + esc(project.displayName || project.projectId) + '</a><span>›</span><span>' + esc(w.workflowId) + '</span>';

    const publisherRows = (w.participants || []).map((participant) =>
      '<div class="row">' + esc(participant.instanceId) + ' · revision ' + esc(participant.workflowRevision) + ' · ' + (participant.live ? 'live' : 'stale/offline') + '</div>'
    ).join("") || '<div class="notice">No participating publisher is projected.</div>';

    if (w.consistency === "conflict") {
      const candidates = (w.conflictCandidates || []).map((candidate) =>
        '<div class="row">Digest ' + esc(candidate.stateDigest) + ' · status ' + esc(candidate.status) + '</div>'
      ).join("");
      main.innerHTML = '<section class="panel detail">' +
        '<div class="workflow-head"><div><h2 class="name">Workflow ' + esc(w.workflowId) + '</h2><div class="meta">Revision ' + esc(w.workflowRevision) + '</div></div><div class="badges">' + badges(w) + '</div></div>' +
        '<div class="section"><h2>Consistency conflict</h2><div class="notice">Publishers report different Loom-authoritative state for the same highest workflow revision. No winner is selected; state-specific fields are withheld until the conflict resolves.</div><div class="list">' + candidates + '</div></div>' +
        '<div class="section"><h2>Participating publishers</h2><div class="list">' + publisherRows + '</div></div>' +
        '</section>';
      return;
    }

    const p = resolved(w);
    const current = (p?.currentSteps || []).map((step) => '<div class="row">' + esc(step.label || step.id) + ' · ' + esc(step.agent) + ' · ' + esc(step.status) + '</div>').join("") || '<div class="notice">No current runnable step.</div>';
    const sessions = (p?.participatingSessionIds || []).map((sessionId) =>
      '<a class="row" data-key="session:' + esc(sessionId) + '" href="#/project/' + enc(project.projectId) + '/workflow/' + enc(w.workflowId) + '/session/' + enc(sessionId) + '">' +
      'OpenCode session ' + esc(sessionId) + '</a>'
    ).join("") || '<div class="notice">No participating OpenCode session is projected.</div>';

    main.innerHTML = '<section class="panel detail">' +
      '<div class="workflow-head"><div><h2 class="name">' + esc(p?.anchor || w.workflowId) + '</h2><div class="meta">Workflow ' + esc(w.workflowId) + '</div></div><div class="badges">' + badges(w) + '</div></div>' +
      '<div class="stats section"><div class="stat"><strong>' + esc(p?.openOqCount ?? "—") + '</strong><span>Open OQs</span></div><div class="stat"><strong>' + esc(p?.openVerificationCount ?? "—") + '</strong><span>Verification</span></div><div class="stat"><strong>' + esc(p?.budget ? (p.budget.used ?? "—") + "/" + (p.budget.limit ?? "—") : "—") + '</strong><span>Budget used/limit</span></div><div class="stat"><strong>' + esc(p?.productAcceptance?.status ?? "not started") + '</strong><span>Product Acceptance</span></div><div class="stat"><strong>' + esc(p?.knowledgeSync?.valid === true ? "valid" : p?.knowledgeSync ? "stale" : "not available") + '</strong><span>Knowledge</span></div></div>' +
      '<div class="section"><h2>Current / runnable steps</h2><div class="list">' + current + '</div></div>' +
      '<div class="section"><h2>OpenCode sessions</h2><div class="list">' + sessions + '</div></div>' +
      '<div class="section"><h2>Participating publishers</h2><div class="list">' + publisherRows + '</div></div>' +
      '<div class="section"><h2>Authority provenance</h2><div class="notice">Workflow, OQ, verification, budget, Product Acceptance, hierarchy and knowledge values above are Loom-authoritative. Session/model/token/cost telemetry is supplemental and is not enabled unless explicitly projected.</div></div>' +
      '</section>';
  }

  function renderSession(project, w, sessionId) {
    const p = resolved(w);
    const present = (p?.participatingSessionIds || []).includes(sessionId);
    crumbs.innerHTML = '<a href="#/">Fleet</a><span>›</span><a href="#/project/' + enc(project.projectId) + '">' + esc(project.displayName || project.projectId) + '</a><span>›</span><a href="#/project/' + enc(project.projectId) + '/workflow/' + enc(w.workflowId) + '">' + esc(w.workflowId) + '</a><span>›</span><span>Session</span>';
    main.innerHTML = '<section class="panel detail"><h2 class="name">OpenCode session</h2>' +
      (present ? '<div class="list"><div class="row">Session ID: ' + esc(sessionId) + '</div><div class="row">Workflow: ' + esc(w.workflowId) + '</div></div>' : '<div class="notice">This participating session is no longer available in the selected projection.</div>') +
      '<div class="section"><h2>OpenCode telemetry</h2><div class="notice">Not enabled / unavailable. Missing telemetry is not treated as zero or success.</div></div></section>';
  }

  function render() {
    const focused = document.activeElement?.dataset?.key || "";
    const r = route();
    const project = r.projectId ? projectById(r.projectId) : undefined;
    const workflow = project && r.workflowId ? workflowById(project, r.workflowId) : undefined;
    if (r.kind === "fleet") renderFleet();
    else if (!project) {
      live.textContent = "The selected project is no longer available. Returned to Fleet.";
      location.hash = "#/";
      renderFleet();
    } else if (r.kind === "project") renderProject(project);
    else if (!workflow) {
      live.textContent = "The selected workflow is no longer available. Returned to Project.";
      location.hash = "#/project/" + enc(project.projectId);
      renderProject(project);
    } else if (r.kind === "workflow") renderWorkflow(project, workflow);
    else renderSession(project, workflow, r.instanceId);

    if (focused) {
      const keyed = [...document.querySelectorAll("[data-key]")];
      const next = keyed.find((node) => node.dataset.key === focused);
      if (next) next.focus();
      else {
        const fallback = keyed[0] || statusFilter || projectFilter || agentFilter;
        fallback?.focus();
        live.textContent = "The previously focused item is no longer available. Focus moved to the nearest available dashboard control.";
      }
    }
  }

  async function refresh() {
    try {
      const response = await fetch("/api/fleet", { cache: "no-store" });
      if (!response.ok) throw new Error("fleet request failed");
      state.fleet = await response.json();
      projectionStatus.hidden = true;
      projectionStatus.textContent = "";
      render();
    } catch {
      live.textContent = "Dashboard projection is currently unavailable.";
      projectionStatus.hidden = false;
      projectionStatus.textContent = state.fleet.projects.length
        ? "Dashboard refresh failed. Showing the last known Loom projection."
        : "Dashboard projection is currently unavailable. Loom execution is independent of the dashboard.";
      if (!state.fleet.projects.length) main.innerHTML = '<section class="panel empty"><strong>Projection unavailable.</strong><div>Loom execution is independent of the dashboard.</div></section>';
    }
  }

  statusFilter.addEventListener("change", () => { state.status = statusFilter.value; render(); });
  projectFilter.addEventListener("input", () => { state.project = projectFilter.value; render(); });
  agentFilter.addEventListener("input", () => { state.agent = agentFilter.value; render(); });
  addEventListener("hashchange", render);
  refresh();
  setInterval(refresh, 3000);
})();
</script>
</body>
</html>`;
}
