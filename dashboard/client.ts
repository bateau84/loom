/** Browser code is served inline with the HTML. Projection values are always escaped. */
export const dashboardScript = `
(() => {
  const state = {
    fleet: { projects: [] }, loaded: false, signature: "", status: "all", project: "", agent: "",
    hierarchyOpen: new Map(), routeMemory: new Map(), currentHash: location.hash,
    paused: false, displayEpoch: 0, inFlight: false, lastReceived: null, refreshFailed: false,
  };
  const main = document.getElementById("main");
  const heading = document.getElementById("page-heading");
  const crumbs = document.getElementById("breadcrumbs");
  const live = document.getElementById("live");
  const filters = document.getElementById("filters");
  const statusFilter = document.getElementById("status-filter");
  const projectFilter = document.getElementById("project-filter");
  const agentFilter = document.getElementById("agent-filter");
  const projectionStatus = document.getElementById("projection-status");
  const refreshButton = document.getElementById("refresh");
  const pauseButton = document.getElementById("pause");
  const feed = document.getElementById("feed");
  const theme = document.getElementById("theme");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");
  const enc = encodeURIComponent;
  const arr = (value) => Array.isArray(value) ? value : [];
  const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const count = (value) => number(value) ? String(value) : "Unavailable";
  const shortId = (id) => String(id).length > 22 ? String(id).slice(0, 10) + "…" + String(id).slice(-8) : String(id);
  const projectName = (project) => project.displayName || project.canonicalLocation || project.projectId;
  const projectHref = (project) => "#/project/" + enc(project.projectId);
  const workflowHref = (project, workflow) => projectHref(project) + "/workflow/" + enc(workflow.workflowId);
  const link = (href, label) => '<a href="' + esc(href) + '">' + esc(label) + '</a>';
  const resolved = (w) => w.consistency === "ok" ? w.projection : null;
  const projectById = (id) => state.fleet.projects.find((p) => p.projectId === id);
  const workflowById = (project, id) => project?.workflows.find((w) => w.workflowId === id);
  const plural = (n, singular, multiple = singular + "s") => count(n) + " " + (n === 1 ? singular : multiple);

  function route() {
    try {
      const hash = location.hash.startsWith("#/") ? location.hash.slice(2) : location.hash.replace(/^#/, "");
      const path = hash.split("?")[0];
      const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
      if (!parts.length || path === "main") return { kind: "fleet" };
      if (parts[0] !== "project" || !parts[1]) return { kind: "invalid" };
      if (parts.length === 2) return { kind: "project", projectId: parts[1] };
      if (parts[2] !== "workflow" || !parts[3]) return { kind: "invalid" };
      if (parts.length === 4) return { kind: "workflow", projectId: parts[1], workflowId: parts[3] };
      if (parts.length === 6 && parts[4] === "session") return { kind: "session", projectId: parts[1], workflowId: parts[3], sessionId: parts[5] };
      return { kind: "invalid" };
    } catch { return { kind: "invalid" }; }
  }
  function readFilters() {
    if (route().kind !== "fleet") return;
    const params = new URLSearchParams(location.hash.split("?").slice(1).join("?"));
    const status = params.get("status") || "all";
    state.status = ["all", "attention", "active", "complete", "cancelled", "stale"].includes(status) ? status : "all";
    state.project = params.get("project") || "";
    state.agent = params.get("agent") || "";
    statusFilter.value = state.status;
    projectFilter.value = state.project;
    agentFilter.value = state.agent;
  }
  function fleetHref(status = state.status, project = state.project, agent = state.agent) {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (project) params.set("project", project);
    if (agent) params.set("agent", agent);
    const query = params.toString();
    return "#/" + (query ? "?" + query : "");
  }
  function setFilters(status, project, agent) {
    state.status = status; state.project = project; state.agent = agent;
    statusFilter.value = status; projectFilter.value = project; agentFilter.value = agent;
    history.replaceState(null, "", fleetHref());
    state.currentHash = location.hash;
    render();
    live.textContent = plural(filteredWorkflows().length, "matching workflow") + ".";
  }
  function displayState(w) {
    if (w.consistency === "conflict") return "consistency conflict";
    const p = resolved(w);
    if (p?.status === "failed" || p?.status === "blocked") return p.status;
    if (w.sourceFreshness === "stale-source") return "stale/offline";
    return p?.status || "unknown";
  }
  function tone(w) {
    const label = displayState(w);
    if (["consistency conflict", "failed"].includes(label)) return "danger";
    if (label === "blocked") return "warn";
    if (label === "stale/offline") return "stale";
    if (label === "active") return "info";
    if (label === "complete") return "ok";
    return "neutral";
  }
  function needsAttention(w) {
    const p = resolved(w);
    return !p || ["failed", "blocked"].includes(p.status) || w.sourceFreshness === "stale-source" ||
      p.budget?.exhausted === true || p.openOqCount > 0 || p.openVerificationCount > 0;
  }
  function priority(w) {
    const p = resolved(w);
    if (w.consistency === "conflict") return 0;
    if (p?.status === "failed") return 1;
    if (p?.status === "blocked") return 2;
    if (w.sourceFreshness === "stale-source") return 7;
    if (needsAttention(w)) return 3;
    return p?.status === "active" ? 4 : p?.status === "complete" ? 5 : 6;
  }
  function sortWorkflows(items) {
    return items.slice().sort((a, b) => priority(a.workflow) - priority(b.workflow) ||
      (a.project.projectId + ":" + a.workflow.workflowId).localeCompare(b.project.projectId + ":" + b.workflow.workflowId));
  }
  function scopedWorkflows() {
    const needle = state.project.trim().toLowerCase();
    const agentNeedle = state.agent.trim().toLowerCase();
    return state.fleet.projects.flatMap((project) => project.workflows.filter((w) =>
      (!needle || [project.displayName, project.canonicalLocation, project.projectId].some((v) => String(v || "").toLowerCase().includes(needle))) &&
      (!agentNeedle || String(resolved(w)?.activeAgent || "").toLowerCase().includes(agentNeedle))
    ).map((workflow) => ({ project, workflow })));
  }
  function filteredWorkflows() {
    return sortWorkflows(scopedWorkflows().filter(({workflow: w}) => {
      const p = resolved(w);
      if (state.status === "attention") return needsAttention(w);
      if (state.status === "stale") return w.sourceFreshness === "stale-source";
      if (state.status === "active") return p?.status === "active" && w.sourceFreshness === "live";
      if (state.status === "complete" || state.status === "cancelled") return p?.status === state.status;
      return true;
    }));
  }
  function titleFor(project, w) {
    const p = resolved(w);
    const objective = arr(project.workObjectives).find((o) => o.objectiveId === p?.workScope?.objectiveId && o.consistency === "ok" && o.projection?.generation === p?.workScope?.generation);
    if (objective?.projection?.title) return objective.projection.title;
    if (p?.anchor) {
      const parts = p.anchor.split(/[\\\\/]/).filter(Boolean);
      const leaf = parts.pop();
      return leaf === "anchor.md" && parts.length ? parts.pop() : leaf || p.anchor;
    }
    return "Workflow " + shortId(w.workflowId);
  }
  function badge(label, valueTone = "neutral", isState = false) {
    return '<span class="badge" data-tone="' + esc(valueTone) + '"' + (isState ? ' data-state="' + esc(label) + '"' : '') + '>' + esc(label) + '</span>';
  }
  function badges(w) {
    const p = resolved(w);
    const label = displayState(w);
    return badge(label, tone(w), true) +
      (w.sourceFreshness === "stale-source" && label !== "stale/offline" ? badge("stale/offline", "stale", true) : "") +
      (p?.budget?.exhausted === true ? badge("budget exhausted", "warn") : "");
  }
  function relative(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "Time unavailable";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < -5) return "Future timestamp — check clock";
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }
  function time(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
    return '<time data-relative datetime="' + esc(value) + '" title="' + esc(value) + '">' + esc(relative(value)) + '</time>';
  }
  function ratio(value, numerator = "complete", denominator = "total") {
    return value && number(value[numerator]) && number(value[denominator]) ? value[numerator] + "/" + value[denominator] : "Unavailable";
  }
  function progress(value) {
    if (!value || !number(value.complete) || !number(value.total) || value.total <= 0 || value.complete > value.total) return "";
    return '<progress max="' + value.total + '" value="' + value.complete + '" aria-label="Tasks complete: ' + value.complete + ' of ' + value.total + '"></progress>';
  }
  function budgetMeter(budget) {
    if (!budget || !number(budget.used) || !number(budget.limit) || budget.limit <= 0) return "";
    const max = Math.max(budget.limit, budget.used);
    return '<meter min="0" max="' + max + '" high="' + budget.limit * 0.8 + '" optimum="0" value="' + budget.used + '" aria-label="Dispatch budget: ' + budget.used + ' used, limit ' + budget.limit + '"></meter>';
  }
  function attentionText(w) {
    const p = resolved(w);
    if (!p) return "Authoritative workflow fields are unavailable.";
    const parts = [];
    if (p.openOqCount > 0) parts.push(plural(p.openOqCount, "open question"));
    if (p.openVerificationCount > 0) parts.push(plural(p.openVerificationCount, "verification item"));
    if (p.budget?.exhausted === true) parts.push("dispatch budget exhausted");
    return parts.join(" · ");
  }
  function setHeading(eyebrow, title, subtitle, extra = "") {
    heading.innerHTML = '<div class="page-head"><div class="identity"><span class="eyebrow">' + esc(eyebrow) + '</span><h1 id="view-title">' + esc(title) + '</h1>' + (subtitle ? '<div class="subtitle">' + subtitle + '</div>' : '') + '</div><div class="badges">' + extra + '</div></div>';
    document.title = title + " · Loom Operations";
  }
  function navigation(r) {
    const all = state.fleet.projects.flatMap((p) => p.workflows);
    const total = state.loaded ? all.length : "—";
    const attention = state.loaded ? all.filter(needsAttention).length : "—";
    document.getElementById("primary-nav").innerHTML =
      '<a class="nav-link" data-key="nav:fleet" href="' + esc(fleetHref()) + '"' + (r.kind === "fleet" && state.status !== "attention" ? ' aria-current="page"' : '') + '><span class="nav-symbol" aria-hidden="true">▦</span>Fleet overview<span class="nav-count">' + total + '</span></a>' +
      '<a class="nav-link" data-key="nav:attention" href="#/?status=attention"' + (r.kind === "fleet" && state.status === "attention" ? ' aria-current="page"' : '') + '><span class="nav-symbol" aria-hidden="true">!</span>Needs attention<span class="nav-count">' + attention + '</span></a>';
    document.getElementById("project-nav").innerHTML = state.fleet.projects.map((p) =>
      '<a class="nav-link" data-key="nav:project:' + esc(p.projectId) + '" href="' + esc(projectHref(p)) + '"' + (r.projectId === p.projectId ? ' aria-current="location"' : '') + '><span class="project-name">' + esc(p.displayName || shortId(p.projectId)) + '<small>' + esc(p.canonicalLocation) + '</small></span><span class="nav-count">' + p.workflows.length + '</span></a>'
    ).join("") || '<span class="meta">' + (state.loaded ? "No projects projected." : "Waiting for projection…") + '</span>';
  }
  function summaryMetrics(items, interactive) {
    const ws = items.map((item) => item.workflow);
    const metrics = [
      ["all", "Projected workflows", ws.length],
      ["attention", "Needs attention", ws.filter(needsAttention).length],
      ["active", "Active · live source", ws.filter((w) => resolved(w)?.status === "active" && w.sourceFreshness === "live").length],
      ["complete", "Complete · projected", ws.filter((w) => resolved(w)?.status === "complete").length],
    ];
    return '<div class="stats" aria-label="Workflow summary">' + metrics.map(([status, label, value]) => {
      const tag = interactive ? "button" : "div";
      return '<' + tag + ' class="stat"' + (interactive ? ' type="button" data-key="summary:' + status + '" data-status="' + status + '" aria-pressed="' + (state.status === status) + '"' : '') + (status === "attention" && value > 0 ? ' data-tone="warn"' : '') + '><strong>' + value + '</strong><span>' + label + '</span></' + tag + '>';
    }).join("") + '</div>';
  }
  function workflowCard(project, w) {
    const p = resolved(w);
    const tasks = p?.hierarchyProgress?.tasks;
    const current = arr(p?.currentSteps);
    const currentText = current.length ? current[0].label || current[0].id : "No current step projected";
    const participants = arr(w.participants);
    return '<a class="workflow panel" data-key="' + esc(project.projectId + ":" + w.workflowId) + '" data-tone="' + tone(w) + '" href="' + esc(workflowHref(project, w)) + '">' +
      '<div class="workflow-head"><div class="identity"><div class="project-cue">' + esc(projectName(project)) + '</div><div class="name">' + esc(titleFor(project, w)) + '</div><div class="path">' + esc(p?.anchor || project.canonicalLocation) + '</div></div><div class="badges">' + badges(w) + '</div></div>' +
      (p ? '<div class="card-step"><div class="meta">' + esc(p.activeAgent || "Agent not projected") + ' · current work</div>' + esc(currentText) + (current.length > 1 ? ' <span class="meta">+' + (current.length - 1) + ' more</span>' : '') + '</div><div class="card-metrics"><div><strong>' + esc(ratio(tasks)) + '</strong><span>Tasks complete</span>' + progress(tasks) + '</div><div><strong>' + esc(ratio(p.budget, "used", "limit")) + '</strong><span>Budget used/limit</span></div><div><strong>' + participants.filter((v) => v.live).length + '/' + participants.length + '</strong><span>Live publishers</span></div></div>' : '<div class="notice">Conflicting highest-revision snapshots: ' + arr(w.conflictCandidates).length + '. No winner is selected.</div>') +
      '<div class="card-foot"><span class="' + (attentionText(w) ? "card-reasons" : "meta") + '">' + esc(attentionText(w) || "Open questions: " + count(p?.openOqCount) + " · Verification: " + count(p?.openVerificationCount)) + '</span><span class="meta">' + (p ? 'Activity ' + time(p.recentActivityAt) : 'State withheld') + ' · rev ' + esc(w.workflowRevision) + ' <span aria-hidden="true">↗</span></span></div></a>';
  }
  function empty(title, description, action = "") {
    return '<section class="panel empty"><span class="empty-icon" aria-hidden="true">◇</span><strong>' + esc(title) + '</strong><p class="notice">' + esc(description) + '</p>' + action + '</section>';
  }
  function renderFleet() {
    crumbs.innerHTML = '<span aria-current="page">Fleet</span>';
    setHeading("Workspace overview", "What’s happening in Loom", "Current work, open boundaries, and the next place to look.");
    const items = filteredWorkflows();
    const scoped = scopedWorkflows();
    const scopeLabel = state.project.trim() || state.agent.trim() ? "Summary follows the project and agent filters." : "Summary covers the currently projected fleet, not all historical work.";
    const summary = '<p class="filter-note">' + scopeLabel + '</p>' + summaryMetrics(scoped, true);
    if (!items.length) {
      const workflowCount = state.fleet.projects.reduce((sum, p) => sum + p.workflows.length, 0);
      const hasFilters = state.status !== "all" || state.project.trim() || state.agent.trim();
      let content;
      if (!state.fleet.projects.length) content = empty("No Loom instances discovered.", "Start an OpenCode + Loom process to populate Fleet. Refreshing this view does not start or change work.");
      else if (workflowCount === 0) content = empty("No active or recent workflows.", "Loom instances are publishing, but no workflows are currently inside the dashboard projection window.");
      else if (hasFilters) content = empty("No workflows match the current filters.", "Broaden your project, agent, or status filter to show other projected work.", '<button type="button" data-key="empty:clear" data-clear-filters>Clear filters</button>');
      else content = empty("No projected workflows.", "The dashboard is waiting for a workflow projection.");
      main.innerHTML = summary + content;
      return;
    }
    main.innerHTML = summary + '<div class="panel-head"><h2>Workflows <span class="meta">' + items.length + ' shown</span></h2><span class="meta">Attention first · select a workflow to inspect</span></div><section class="grid section" aria-label="Fleet workflows">' + items.map(({project, workflow}) => workflowCard(project, workflow)).join("") + '</section>';
  }
  function hierarchyOpen(status) { return status === "active" || status === "blocked"; }
  function renderHierarchy(project) {
    if (!arr(project.workObjectives).length) return '<p class="notice">No current work hierarchy is projected. Task progress is unavailable, not zero.</p>';
    return '<div class="hierarchy">' + project.workObjectives.map((objective) => {
      if (objective.consistency === "conflict") return '<div class="callout" data-tone="danger"><strong>Work hierarchy conflict</strong><div class="notice">' + esc(objective.objectiveId) + ' · work version ' + esc(objective.workVersion) + '. No hierarchy winner is selected.</div></div>';
      const p = objective.projection;
      const base = 'project:' + project.projectId + ':objective:' + objective.objectiveId;
      const phases = arr(p?.phases).map((phase) => {
        const phaseKey = base + ':phase:' + phase.phaseId;
        const waves = arr(phase.waves).map((wave) => {
          const waveKey = phaseKey + ':wave:' + wave.waveId;
          return '<details ' + (hierarchyOpen(wave.status) ? 'open ' : '') + 'data-hierarchy-key="' + esc(waveKey) + '" data-status="' + esc(wave.status) + '"><summary data-key="' + esc('hierarchy:' + waveKey) + '"><span>' + esc(wave.title || wave.waveId) + ' — ' + esc(wave.status) + '</span></summary><ul>' + arr(wave.tasks).map((task) =>
            '<li><span class="name">' + esc(task.title || task.taskId) + '</span> — ' + esc(task.status) + (task.claimedByWorkflowId ? '<div class="meta">' + link(projectHref(project) + '/workflow/' + enc(task.claimedByWorkflowId), 'claimed by ' + task.claimedByWorkflowId) + '</div>' : '') + '</li>'
          ).join("") + '</ul></details>';
        }).join("");
        return '<details ' + (hierarchyOpen(phase.status) ? 'open ' : '') + 'data-hierarchy-key="' + esc(phaseKey) + '" data-status="' + esc(phase.status) + '"><summary data-key="' + esc('hierarchy:' + phaseKey) + '"><span>' + esc(phase.title || phase.phaseId) + ' — ' + esc(phase.status) + '</span></summary>' + waves + '</details>';
      }).join("");
      return '<details open data-hierarchy-key="' + esc(base) + '" data-status="' + esc(p?.status || 'unknown') + '"><summary data-key="' + esc('hierarchy:' + base) + '"><span class="name">' + esc(p?.title || objective.objectiveId) + '</span><span class="meta">Objective: ' + esc(p?.status || 'unknown') + ' · version ' + esc(objective.workVersion) + (objective.sourceFreshness === 'stale-source' ? ' · stale/offline source' : '') + '</span></summary>' + phases + '</details>';
    }).join("") + '</div>';
  }
  function renderProject(project) {
    crumbs.innerHTML = link(fleetHref(), 'Fleet') + '<span aria-hidden="true">/</span><span aria-current="page">' + esc(projectName(project)) + '</span>';
    setHeading('Project workspace', projectName(project), '<span class="path mono">' + esc(project.canonicalLocation) + '</span>');
    const items = sortWorkflows(project.workflows.map((workflow) => ({project, workflow})));
    const windowNotice = project.projectionWindow?.workflowsTruncated || project.projectionWindow?.completedObjectivesTruncated
      ? '<div class="callout"><strong>Bounded projection</strong><div class="notice">Some older work is outside the current projection window. This is not the full project history; existing deep links remain valid navigation targets.</div></div>' : '';
    main.innerHTML = summaryMetrics(items, false) + windowNotice +
      '<section class="panel"><div class="panel-head"><h2>Work map</h2><span class="meta">Objective → Phase → Wave → Task</span></div><div class="panel-body">' + renderHierarchy(project) + '</div></section>' +
      '<section class="section"><div class="panel-head"><h2>Workflows</h2><span class="meta">' + plural(items.length, 'projected workflow') + '</span></div><div class="grid section">' + (items.map(({workflow}) => workflowCard(project, workflow)).join('') || '<p class="notice">No workflows are currently projected for this project.</p>') + '</div></section>';
  }
  function panel(title, content, detail = '') {
    return '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + (detail ? '<span class="meta">' + esc(detail) + '</span>' : '') + '</div><div class="panel-body">' + content + '</div></section>';
  }
  function disclosure(key, title, content, open = false) {
    return '<details class="disclosure" data-hierarchy-key="' + esc(key) + '"' + (open ? ' open' : '') + '><summary data-key="' + esc('disclosure:' + key) + '">' + esc(title) + '</summary><div class="panel-body">' + content + '</div></details>';
  }
  function workflowCrumbs(project, w, session = false) {
    crumbs.innerHTML = link(fleetHref(), 'Fleet') + '<span aria-hidden="true">/</span>' + link(projectHref(project), projectName(project)) + '<span aria-hidden="true">/</span>' +
      (session ? link(workflowHref(project, w), titleFor(project, w)) + '<span aria-hidden="true">/</span><span aria-current="page">Session</span>' : '<span aria-current="page">' + esc(titleFor(project, w)) + '</span>');
  }
  function publisherDetails(project, w, open = false) {
    const rows = arr(w.participants).map((participant) => '<div class="row"><div class="name mono">' + esc(participant.instanceId) + '</div><div class="meta">Revision ' + esc(participant.workflowRevision) + ' · ' + (participant.live ? 'live publisher' : 'stale/offline publisher') + (participant.workflowRevision < w.workflowRevision ? ' · lagging revision' : '') + '</div><div class="meta">Lease expires: ' + esc(participant.leaseExpiresAt || 'Unavailable') + '</div></div>').join('') || '<p class="notice">No participating publisher is projected.</p>';
    const content = '<h3>Participating publishers</h3><div class="list section">' + rows + '</div><h3 class="section">Authority provenance</h3><p class="notice">Workflow, OQ, verification, budget, Product Acceptance, hierarchy and knowledge values are Loom-authoritative. OpenCode session/model/token/cost telemetry is supplemental; missing telemetry never implies zero or success.</p><p class="meta section">Highest workflow revision: ' + esc(w.workflowRevision) + '. Publisher liveness and workflow source freshness are separate.</p>';
    return disclosure('publishers:' + project.projectId + ':' + w.workflowId, 'Publishers & provenance · ' + arr(w.participants).length, content, open);
  }
  function workflowWarnings(w) {
    const p = resolved(w);
    let result = '';
    if (w.sourceFreshness === 'stale-source') result += '<div class="callout" data-tone="stale"><strong>Latest-known state · stale source</strong><div class="notice">The publishers carrying revision ' + esc(w.workflowRevision) + ' are stale/offline. A live lower-revision publisher does not replace this snapshot. Last meaningful activity: ' + time(p?.recentActivityAt) + '.</div></div>';
    if (p?.status === 'blocked' || p?.status === 'failed') result += '<div class="callout" data-tone="' + (p.status === 'failed' ? 'danger' : 'warn') + '"><strong>' + (p.status === 'failed' ? 'Workflow reports failure' : 'Workflow is blocked') + '</strong><div class="notice">The projection does not include a detailed cause. Inspect the current work and open boundaries below; continue diagnosis in Loom rather than treating a count as the cause.</div></div>';
    return result;
  }
  function stepRows(steps, runnableIds) {
    return steps.map((step) => '<div class="step"><span class="step-symbol" aria-hidden="true">' + (step.status === 'complete' ? '✓' : step.status === 'failed' ? '×' : step.status === 'blocked' ? '!' : '→') + '</span><div class="identity"><div class="name">' + esc(step.label || step.id) + '</div><div class="badges">' + badge(step.agent || 'Agent unavailable') + badge(step.status || 'Status unavailable', step.status === 'failed' ? 'danger' : step.status === 'blocked' ? 'warn' : 'neutral') + (runnableIds.has(step.id) ? badge('runnable', 'info') : '') + '</div></div></div>').join('');
  }
  function sessionRow(project, w, sessionId, active) {
    const href = workflowHref(project, w) + '/session/' + enc(sessionId);
    return '<a class="row" data-key="session:' + esc(sessionId) + '" href="' + esc(href) + '" aria-label="OpenCode session ' + esc(sessionId) + '"><span class="nav-symbol" aria-hidden="true">' + (active ? '▶' : '↳') + '</span><span class="identity"><span class="name">' + (active ? 'Active session' : 'Participating session') + '</span><span class="meta mono" style="display:block" title="' + esc(sessionId) + '">' + esc(shortId(sessionId)) + '</span></span><span class="go" aria-hidden="true">↗</span></a>';
  }
  function renderWorkflow(project, w) {
    workflowCrumbs(project, w);
    const p = resolved(w);
    setHeading('Workflow · ' + projectName(project), titleFor(project, w), '<div class="path mono">' + esc(p?.anchor || 'No resolved Anchor reference') + '</div><div class="meta">Workflow ' + esc(w.workflowId) + ' · revision ' + esc(w.workflowRevision) + '</div>', badges(w));
    if (w.consistency === 'conflict') {
      const candidates = arr(w.conflictCandidates).map((candidate) => '<div class="row"><div class="meta mono">Digest ' + esc(candidate.stateDigest) + '</div><div>Status ' + esc(candidate.status) + '</div></div>').join('');
      main.innerHTML = '<div class="callout" data-tone="danger"><strong>Consistency conflict</strong><div class="notice">Publishers report different Loom-authoritative state for the same highest workflow revision. No winner is selected; state-specific fields are withheld until the conflict resolves.</div></div>' + panel('Conflicting snapshots', '<div class="list">' + candidates + '</div>') + '<div class="section">' + publisherDetails(project, w, true) + '</div>';
      return;
    }
    if (!p) { main.innerHTML = empty('Workflow state unavailable.', 'No resolved workflow projection is available. Refresh to retry; no successful or failed state is inferred.'); return; }
    const tasks = p.hierarchyProgress?.tasks;
    const metricData = [
      [ratio(tasks), 'Tasks complete', progress(tasks)],
      [count(p.openOqCount), 'Open questions (OQs)', ''],
      [count(p.openVerificationCount), 'Verification items', ''],
      [ratio(p.budget, 'used', 'limit'), 'Budget used/limit', budgetMeter(p.budget)],
    ];
    const metrics = '<div class="stats" aria-label="Workflow signals">' + metricData.map(([value, label, graphic]) => '<div class="stat"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span>' + graphic + '</div>').join('') + '</div>';
    const current = arr(p.currentSteps);
    const runnable = arr(p.runnableSteps);
    const runnableIds = new Set(runnable.map((step) => step.id));
    const additional = runnable.filter((step) => !current.some((s) => s.id === step.id));
    let work = stepRows(current, runnableIds) || '<p class="notice">No current step is projected. This does not imply that the workflow is complete.</p>';
    if (additional.length) work += '<h3 class="section">Also runnable</h3><div class="section">' + stepRows(additional, runnableIds) + '</div>';
    work += '<div class="section">' + link(projectHref(project), 'View project work map →') + '</div>';
    const sessions = arr(p.participatingSessionIds);
    const active = sessions.includes(p.activeSessionId) ? p.activeSessionId : null;
    const other = sessions.filter((id) => id !== active);
    const visible = active ? [active] : other.slice(0, 2);
    const remaining = active ? other : other.slice(2);
    let sessionContent = '<div class="list">' + visible.map((id) => sessionRow(project, w, id, id === active)).join('') + '</div>';
    if (remaining.length) sessionContent += '<div class="section">' + disclosure('sessions:' + project.projectId + ':' + w.workflowId, 'More sessions · ' + remaining.length, '<div class="list">' + remaining.map((id) => sessionRow(project, w, id, false)).join('') + '</div>') + '</div>';
    if (!sessions.length) sessionContent = '<p class="notice">No participating OpenCode session is projected.</p>';
    sessionContent += '<p class="notice section">Session links show membership. Model, token, cost, and output telemetry are not enabled here.</p>';
    const attention = attentionText(w);
    const boundaries = (attention ? '<div class="callout"><strong>Open boundaries</strong><div class="notice">' + esc(attention) + '.</div></div>' : '') + '<dl class="facts">' +
      '<div class="fact"><dt>Current agent</dt><dd>' + esc(p.activeAgent || 'Not projected') + '</dd></div>' +
      '<div class="fact"><dt>Execution stage</dt><dd class="mono">' + esc(p.executionStage || 'Not projected') + '</dd></div>' +
      '<div class="fact"><dt>Product Acceptance</dt><dd>' + badge(p.productAcceptance?.status || 'Not projected', p.productAcceptance?.status === 'failed' ? 'danger' : p.productAcceptance?.status === 'passed' ? 'ok' : 'neutral') + '</dd></div>' +
      '<div class="fact"><dt>Knowledge sync</dt><dd>' + (p.knowledgeSync?.valid === true ? badge('valid', 'ok') : p.knowledgeSync?.valid === false ? badge('stale', 'warn') : 'Not projected') + '</dd></div>' +
      '<div class="fact"><dt>Last meaningful activity</dt><dd>' + time(p.recentActivityAt) + '</dd></div></dl><p class="notice section">Counts are signals, not causal explanations. OQ owners, gate evidence, and detailed blockers are not included in this projection.</p>';
    main.innerHTML = workflowWarnings(w) + metrics + '<div class="detail-grid"><div class="stack">' + panel('Current work', work, 'Latest projected step state') + panel('OpenCode sessions', sessionContent, plural(sessions.length, 'session')) + '</div><div class="stack">' + panel('Gates & context', boundaries) + publisherDetails(project, w) + '</div></div><p class="provenance">Read-only · Loom-authoritative workflow state. Display refresh does not control execution.</p>';
  }
  function renderSession(project, w, sessionId) {
    workflowCrumbs(project, w, true);
    setHeading('Session context · ' + projectName(project), 'OpenCode session', '<span class="mono path">' + esc(sessionId) + '</span>', badges(w));
    const p = resolved(w);
    const present = arr(p?.participatingSessionIds).includes(sessionId);
    const membership = w.consistency === 'conflict'
      ? '<div class="callout" data-tone="danger"><strong>Session membership unresolved</strong><div class="notice">Workflow publishers conflict. No session membership or workflow-state winner is selected.</div></div>'
      : present ? '<dl class="facts"><div class="fact"><dt>Session ID</dt><dd class="mono">' + esc(sessionId) + '</dd></div><div class="fact"><dt>Workflow</dt><dd>' + link(workflowHref(project, w), titleFor(project, w)) + '<div class="meta mono">' + esc(w.workflowId) + '</div></dd></div></dl>'
      : '<p class="notice">This participating session is no longer available in the selected projection. The requested URL is retained; absence does not prove deletion.</p>';
    main.innerHTML = workflowWarnings(w) + panel('Loom membership', membership) + '<section class="panel section"><div class="panel-head"><h2>OpenCode telemetry</h2>' + badge('Supplemental · not enabled') + '</div><div class="panel-body"><p class="notice">Not enabled / unavailable. Missing telemetry is not treated as zero or success.</p></div></section><p class="section">' + link(workflowHref(project, w), '← Return to workflow') + '</p>';
  }
  function remember(map, key, value, limit) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  }
  function captureHierarchyOpen() {
    for (const node of main.querySelectorAll('details[data-hierarchy-key]')) remember(state.hierarchyOpen, node.dataset.hierarchyKey, node.open, 500);
  }
  function restoreHierarchyOpen() {
    for (const node of main.querySelectorAll('details[data-hierarchy-key]')) {
      const open = state.hierarchyOpen.get(node.dataset.hierarchyKey);
      if (open !== undefined) node.open = open;
    }
  }
  function renderProjectionWait(r, detail) {
    crumbs.innerHTML = link(fleetHref(), 'Fleet') + (r.projectId ? '<span aria-hidden="true">/</span><span>' + esc(shortId(r.projectId)) + '</span>' : '');
    setHeading('Projection pending', 'Waiting for Loom projection…', 'Your requested location is preserved.');
    const href = r.workflowId && r.projectId ? '#/project/' + enc(r.projectId) : fleetHref();
    main.innerHTML = empty('Requested state is not currently projected.', detail + ' The dashboard does not treat repeated reads of the same projection as proof that the target disappeared.', link(href, r.workflowId ? 'Return to Project' : 'Return to Fleet'));
  }
  function focusKey(key) {
    return [...document.querySelectorAll('[data-key]')].find((node) => node.dataset.key === key && node.getClientRects().length);
  }
  function render(navigationChange = false) {
    captureHierarchyOpen();
    const focused = navigationChange ? '' : document.activeElement?.dataset?.key || '';
    const r = route();
    navigation(r);
    filters.hidden = r.kind !== 'fleet' || !state.loaded;
    const project = r.projectId ? projectById(r.projectId) : undefined;
    const workflow = project && r.workflowId ? workflowById(project, r.workflowId) : undefined;
    if (!state.loaded) {
      setHeading('Workspace overview', 'Loom Operations', 'Connecting to the read-only projection.');
      main.innerHTML = empty('Loading Loom projection…', 'Missing data is not treated as a healthy zero.');
    } else if (r.kind === 'invalid') {
      setHeading('Navigation', 'Invalid dashboard address', 'No workflow has been selected.');
      crumbs.innerHTML = link(fleetHref(), 'Fleet');
      main.innerHTML = empty('This dashboard address is not recognized.', 'Use Fleet navigation to select a project or workflow. The address has not been silently rewritten.', link(fleetHref(), 'Return to Fleet'));
    } else if (r.kind === 'fleet') renderFleet();
    else if (!project) renderProjectionWait(r, 'The requested project may still be propagating, stale, or no longer projected.');
    else if (r.kind === 'project') renderProject(project);
    else if (!workflow) renderProjectionWait(r, project.projectionWindow?.workflowsTruncated === true ? 'The requested workflow is outside the current bounded projection window; absence is not proven.' : 'The requested workflow may still be propagating or may no longer be projected.');
    else if (r.kind === 'workflow') renderWorkflow(project, workflow);
    else renderSession(project, workflow, r.sessionId);
    restoreHierarchyOpen();
    if (navigationChange) {
      const remembered = state.routeMemory.get(location.hash);
      const target = remembered?.key && focusKey(remembered.key);
      (target || main).focus({ preventScroll: true });
      window.scrollTo(0, remembered?.scroll || 0);
      live.textContent = document.title;
    } else if (focused) {
      const next = focusKey(focused);
      if (next) next.focus({ preventScroll: true });
      else {
        const fallback = [...main.querySelectorAll('.workflow[data-key], a.row[data-key]')].find((node) => node.getClientRects().length) || (!filters.hidden ? statusFilter : main);
        fallback?.focus();
        live.textContent = 'The previously focused item is no longer available. Focus moved to the nearest available dashboard control.';
      }
    }
  }
  function updateFeed() {
    const last = state.lastReceived ? new Date(state.lastReceived).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : null;
    feed.dataset.health = state.paused ? 'paused' : state.refreshFailed ? 'error' : state.loaded ? 'connected' : 'connecting';
    feed.textContent = (state.paused ? 'Display updates paused' : state.refreshFailed ? 'Refresh unavailable' : state.loaded ? 'Projection received' : 'Connecting…') + (last ? ' · ' + last : '');
    feed.title = 'This is dashboard delivery, not workflow or publisher health.';
  }
  function validFleet(value) {
    const text = (v) => v === undefined || typeof v === 'string';
    const list = (v, predicate) => v === undefined || Array.isArray(v) && v.every(predicate);
    const step = (v) => v && typeof v.id === 'string' && text(v.label) && text(v.agent) && text(v.status);
    const projection = (p) => p == null || typeof p === 'object' && text(p.anchor) && text(p.activeAgent) &&
      list(p.currentSteps, step) && list(p.runnableSteps, step) && list(p.participatingSessionIds, (id) => typeof id === 'string');
    const objective = (o) => o && typeof o.objectiveId === 'string' && (!o.projection || list(o.projection.phases, (phase) =>
      phase && typeof phase.phaseId === 'string' && list(phase.waves, (wave) => wave && typeof wave.waveId === 'string' &&
        list(wave.tasks, (task) => task && typeof task.taskId === 'string'))));
    return value && Array.isArray(value.projects) && value.projects.every((p) => p && typeof p.projectId === 'string' &&
      text(p.displayName) && text(p.canonicalLocation) && list(p.workObjectives, objective) && Array.isArray(p.workflows) && p.workflows.every((w) =>
        w && typeof w.workflowId === 'string' && projection(w.projection) && list(w.conflictCandidates, (candidate) => candidate && projection(candidate)) &&
        list(w.participants, (participant) => participant && typeof participant.instanceId === 'string')));
  }
  async function refresh(manual = false) {
    if (state.inFlight) return;
    state.inFlight = true;
    const epoch = state.displayEpoch;
    refreshButton.disabled = true;
    if (manual) refreshButton.textContent = 'Refreshing…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/fleet', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Fleet request failed');
      const next = await response.json();
      // Pausing freezes the displayed snapshot, including an already pending read.
      if (!manual && (state.paused || epoch !== state.displayEpoch)) return;
      if (!validFleet(next)) throw new Error('Invalid fleet projection');
      const signature = JSON.stringify(next.projects);
      const changed = !state.loaded || signature !== state.signature;
      state.fleet = next; state.signature = signature; state.loaded = true;
      state.lastReceived = Date.now(); state.refreshFailed = false;
      main.setAttribute('aria-busy', 'false');
      projectionStatus.hidden = true; projectionStatus.textContent = '';
      if (changed) render();
      for (const node of document.querySelectorAll('time[data-relative]')) node.textContent = relative(node.dateTime);
      if (manual) live.textContent = 'Projection refreshed. Loom execution is unchanged.';
    } catch {
      if (!manual && (state.paused || epoch !== state.displayEpoch)) return;
      state.refreshFailed = true;
      main.setAttribute('aria-busy', 'false');
      projectionStatus.hidden = false;
      projectionStatus.textContent = state.loaded ? 'Dashboard refresh failed. Showing the last known Loom projection. Use Refresh to retry; Loom execution is independent of the dashboard.' : 'Dashboard projection is currently unavailable. Use Refresh to retry. Loom execution is independent of the dashboard.';
      if (!state.loaded) {
        setHeading('Connection unavailable', 'Projection unavailable.', 'Your dashboard URL is preserved.');
        main.innerHTML = empty('No projection could be loaded.', 'Retry using Refresh. This display failure does not imply that Loom execution stopped.');
      }
    } finally {
      clearTimeout(timeout); state.inFlight = false;
      refreshButton.disabled = false; refreshButton.textContent = 'Refresh';
      updateFeed();
    }
  }
  function applyTheme() {
    document.documentElement.dataset.theme = theme.value === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme.value;
  }
  try {
    const preference = localStorage.getItem('loom-dashboard-theme');
    if (['dark', 'light', 'system'].includes(preference)) theme.value = preference;
  } catch { /* Storage may be unavailable; the in-page theme control still works. */ }
  applyTheme();
  theme.addEventListener('change', () => {
    applyTheme();
    try { localStorage.setItem('loom-dashboard-theme', theme.value); } catch {}
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (theme.value === 'system') applyTheme(); });
  if (matchMedia('(max-width:55rem)').matches) document.getElementById('projects-menu').open = false;
  statusFilter.addEventListener('change', () => setFilters(statusFilter.value, state.project, state.agent));
  projectFilter.addEventListener('input', () => setFilters(state.status, projectFilter.value, state.agent));
  agentFilter.addEventListener('input', () => setFilters(state.status, state.project, agentFilter.value));
  document.getElementById('clear-filters').addEventListener('click', () => setFilters('all', '', ''));
  main.addEventListener('click', (event) => {
    const status = event.target.closest('button[data-status]');
    if (status) setFilters(status.dataset.status, state.project, state.agent);
    if (event.target.closest('[data-clear-filters]')) { setFilters('all', '', ''); statusFilter.focus(); }
  });
  document.querySelector('.skip').addEventListener('click', (event) => { event.preventDefault(); main.focus(); });
  refreshButton.addEventListener('click', () => refresh(true));
  pauseButton.addEventListener('click', () => {
    state.paused = !state.paused;
    state.displayEpoch += 1;
    pauseButton.setAttribute('aria-pressed', String(state.paused));
    pauseButton.textContent = state.paused ? 'Resume updates' : 'Pause updates';
    updateFeed();
    live.textContent = state.paused ? 'Display updates paused. Loom execution continues independently.' : 'Display updates resumed.';
    if (!state.paused) refresh();
  });
  addEventListener('hashchange', () => {
    remember(state.routeMemory, state.currentHash, {key:document.activeElement?.dataset?.key || '', scroll:window.scrollY}, 100);
    state.currentHash = location.hash;
    readFilters();
    render(true);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.paused) refresh(); });
  readFilters(); navigation(route()); refresh();
  setInterval(() => { if (!state.paused && !document.hidden) refresh(); }, 3000);
})();
`;
