import { dashboardReadability } from "./readability"
import { dashboardValidation } from "./validation"

/** Browser code is served inline with the HTML. Projection values are always escaped. */
export const dashboardScript = `
(() => {
  const state = {
    fleet: { projects: [] }, loaded: false, signature: "", status: "all",
    hierarchyOpen: new Map(), routeMemory: new Map(), currentHash: location.hash,
    paused: false, displayEpoch: 0, inFlight: false, lastReceived: null, refreshFailed: false,
  };
  const main = document.getElementById("main");
  const heading = document.getElementById("page-heading");
  const crumbs = document.getElementById("breadcrumbs");
  const live = document.getElementById("live");
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
  const projectName = (project) => projectLabel(project);
  const projectHref = (project) => "#/directory/" + enc(project.projectId);
  const resolved = (w) => w.consistency === "ok" ? w.projection : null;
  function sessionIdForWorkflow(workflow) {
    const p = resolved(workflow);
    return contextFor(p)?.coordinatorSessionId || p?.activeSessionId || arr(p?.participatingSessionIds)[0] || ("workflow:" + workflow.workflowId);
  }
  const sessionHref = (project, sessionId) => projectHref(project) + "/session/" + enc(sessionId);
  const workflowHref = (project, workflow) => sessionHref(project, sessionIdForWorkflow(workflow)) + "/workflow/" + enc(workflow.workflowId);
  // The placement and destination survive label changes and distinguish duplicate destinations.
  const link = (href, label, place) => '<a data-key="' + esc('link:' + place + ':' + href) + '" href="' + esc(href) + '">' + esc(label) + '</a>';
  const projectById = (id) => state.fleet.projects.find((p) => p.projectId === id);
  const workflowById = (project, id) => project?.workflows.find((w) => w.workflowId === id);
  const plural = (n, singular, multiple = singular + "s") => count(n) + " " + (n === 1 ? singular : multiple);
  ${dashboardReadability}

  function route() {
    try {
      const hash = location.hash.startsWith("#/") ? location.hash.slice(2) : location.hash.replace(/^#/, "");
      const path = hash.split("?")[0];
      const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
      if (!parts.length || path === "main") return { kind: "fleet" };

      if (parts[0] === "directory" && parts[1]) {
        if (parts.length === 2) return { kind: "project", projectId: parts[1] };
        if (parts.length === 3 && parts[2] === "workflows") return { kind: "workflows", projectId: parts[1] };
        if (parts.length === 4 && parts[2] === "session") {
          return { kind: "session-group", projectId: parts[1], sessionId: parts[3] };
        }
        if (parts.length === 6 && parts[2] === "session" && parts[4] === "workflow") {
          return { kind: "workflow", projectId: parts[1], sessionId: parts[3], workflowId: parts[5] };
        }
        return { kind: "invalid" };
      }

      // Preserve old dashboard deep links while the information architecture moves
      // from Fleet → Workflow to Working directory → Session → Workflow.
      if (parts[0] === "project" && parts[1]) {
        if (parts.length === 2) return { kind: "project", projectId: parts[1] };
        if (parts.length === 4 && parts[2] === "workflow") {
          return { kind: "workflow", projectId: parts[1], workflowId: parts[3] };
        }
        if (parts.length === 6 && parts[2] === "workflow" && parts[4] === "session") {
          return { kind: "session-group", projectId: parts[1], sessionId: parts[5] };
        }
      }
      return { kind: "invalid" };
    } catch { return { kind: "invalid" }; }
  }
  function readFilters() {
    if (route().kind !== "fleet") return;
    const params = new URLSearchParams(location.hash.split("?").slice(1).join("?"));
    state.status = params.get("status") === "attention" ? "attention" : "all";
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
  function titleFor(project, w) { return workflowLabel(project, w); }
  function sessionsFor(project) {
    const groups = new Map();
    for (const workflow of project.workflows) {
      const sessionId = sessionIdForWorkflow(workflow);
      const current = groups.get(sessionId) || { id: sessionId, workflows: [] };
      current.workflows.push(workflow);
      groups.set(sessionId, current);
    }
    return [...groups.values()].map((session) => {
      session.workflows.sort((a, b) => {
        const at = Date.parse(resolved(a)?.recentActivityAt || "") || 0;
        const bt = Date.parse(resolved(b)?.recentActivityAt || "") || 0;
        return bt - at || b.workflowRevision - a.workflowRevision;
      });
      session.latest = session.workflows[0];
      session.recentActivityAt = resolved(session.latest)?.recentActivityAt || "";
      session.title = titleFor(project, session.latest).replace(/ · Run \\d+$/, "");
      session.attention = session.workflows.some(needsAttention);
      session.status = session.workflows.some((w) => w.consistency === "conflict") ? "conflict" :
        session.workflows.some((w) => resolved(w)?.status === "failed") ? "failed" :
        session.workflows.some((w) => resolved(w)?.status === "blocked") ? "blocked" :
        session.workflows.some((w) => w.sourceFreshness === "stale-source") ? "stale" :
        session.workflows.some((w) => resolved(w)?.status === "active") ? "active" :
        session.workflows.every((w) => ["complete", "cancelled"].includes(resolved(w)?.status)) ? "complete" : "idle";
      return session;
    }).sort((a, b) => (Date.parse(b.recentActivityAt) || 0) - (Date.parse(a.recentActivityAt) || 0) || a.id.localeCompare(b.id));
  }
  function allSessions() {
    return state.fleet.projects.flatMap((project) => sessionsFor(project).map((session) => ({project, session})))
      .sort((a, b) => (Date.parse(b.session.recentActivityAt) || 0) - (Date.parse(a.session.recentActivityAt) || 0));
  }
  function sessionById(project, sessionId) {
    return sessionsFor(project).find((session) => session.id === sessionId);
  }
  function deletableWorkflow(workflow) {
    const projection = resolved(workflow);
    if (projection?.status === "cancelled") return true;
    return projection?.status === "failed" &&
      Array.isArray(projection.runnableSteps) &&
      projection.runnableSteps.length === 0;
  }
  function badge(label, valueTone = "neutral", isState = false) {
    return '<span class="badge" data-tone="' + esc(valueTone) + '"' + (isState ? ' data-state="' + esc(label) + '"' : '') + '>' + esc(label) + '</span>';
  }
  function badges(w) {
    const p = resolved(w);
    const label = displayState(w);
    return badge(label, tone(w), true) +
      (p?.planningOnly === true ? badge("planning only", "neutral") : "") +
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
  function setHeading(eyebrow, title, subtitle, extra = "") {
    heading.innerHTML = '<div class="page-head"><div class="identity"><span class="eyebrow">' + esc(eyebrow) + '</span><h1 id="view-title">' + esc(title) + '</h1>' + (subtitle ? '<div class="subtitle">' + subtitle + '</div>' : '') + '</div><div class="badges">' + extra + '</div></div>';
    document.title = title + " · Loom";
  }
  function navigation(r) {
    const allSessionsCount = state.loaded ? allSessions().length : "—";
    const attention = state.loaded ? allSessions().filter(({session}) => session.attention).length : "—";
    document.getElementById("primary-nav").innerHTML =
      '<a class="nav-link" data-key="nav:home" href="#/"' + (r.kind === "fleet" && state.status !== "attention" ? ' aria-current="page"' : '') + '><span class="nav-symbol" aria-hidden="true">⌂</span>Control panel<span class="nav-count">' + allSessionsCount + '</span></a>' +
      '<a class="nav-link" data-key="nav:attention" href="#/?status=attention"' + (r.kind === "fleet" && state.status === "attention" ? ' aria-current="page"' : '') + '><span class="nav-symbol" aria-hidden="true">!</span>Needs attention<span class="nav-count">' + attention + '</span></a>';
    document.getElementById("project-nav").innerHTML = state.fleet.projects.map((p) =>
      '<a class="nav-link" data-key="nav:project:' + esc(p.projectId) + '" href="' + esc(projectHref(p)) + '"' + (r.projectId === p.projectId ? ' aria-current="location"' : '') + '><span class="project-name">' + esc(projectName(p)) + '<small>' + esc(p.canonicalLocation) + '</small></span><span class="nav-count">' + sessionsFor(p).length + '</span></a>'
    ).join("") || '<span class="meta">' + (state.loaded ? "No working directories projected." : "Waiting for projection…") + '</span>';
  }
  function empty(title, description, action = "") {
    return '<section class="panel empty"><span class="empty-icon" aria-hidden="true">◇</span><strong>' + esc(title) + '</strong><p class="notice">' + esc(description) + '</p>' + action + '</section>';
  }
  function sessionListRow(project, session) {
    const detail = session.workflows.length === 1 ? '1 workflow' : session.workflows.length + ' workflows';
    return '<a class="simple-row" data-key="session:' + esc(project.projectId + ':' + session.id) + '" href="' + esc(sessionHref(project, session.id)) + '">' +
      '<span class="identity"><span class="name">' + esc(session.title) + '</span><span class="meta">' + esc(projectName(project)) + ' · ' + esc(detail) + '</span></span>' +
      '<span class="session-state" data-tone="' + esc(session.status) + '">' + esc(session.status === "idle" ? "No active work" : session.status) + '</span>' +
      '<span class="meta">' + (session.recentActivityAt ? time(session.recentActivityAt) : 'Activity unavailable') + '</span><span class="go" aria-hidden="true">›</span></a>';
  }
  function renderFleet() {
    crumbs.innerHTML = '<span aria-current="page">Control panel</span>';
    const attentionOnly = state.status === "attention";
    setHeading("Control plane", attentionOnly ? "Needs attention" : "Control panel",
      attentionOnly ? "Sessions with failed, blocked, stale, or unresolved work." : "Your work, organized by working directory and session.");
    const sessions = allSessions().filter(({session}) => !attentionOnly || session.attention);
    const recent = sessions.slice(0, 8);
    const directories = state.fleet.projects.map((project) =>
      '<a class="simple-row" data-key="directory:' + esc(project.projectId) + '" href="' + esc(projectHref(project)) + '">' +
      '<span class="nav-symbol" aria-hidden="true">▣</span><span class="identity"><span class="name">' + esc(projectName(project)) + '</span><span class="meta">' + esc(project.canonicalLocation) + '</span></span>' +
      '<span class="meta">' + plural(sessionsFor(project).length, "session") + '</span><span class="go" aria-hidden="true">›</span></a>'
    ).join("");
    const sessionRows = recent.map(({project, session}) => sessionListRow(project, session)).join("");
    const attentionSessions = allSessions().filter(({session}) => session.attention).slice(0, 5);
    const attentionPanel = !attentionOnly && attentionSessions.length
      ? '<section class="panel"><div class="panel-head"><h2>Needs attention</h2><a class="quiet-link" data-key="home:attention" href="#/?status=attention">View all</a></div><div class="simple-list">' +
        attentionSessions.map(({project, session}) => sessionListRow(project, session)).join("") + '</div></section>'
      : '';
    main.innerHTML =
      '<div class="control-grid' + (attentionPanel ? '' : ' control-grid--two') + '">' +
      '<section class="panel"><div class="panel-head"><h2>Working directories</h2><span class="meta">' + state.fleet.projects.length + '</span></div><div class="simple-list">' +
      (directories || '<div class="panel-body"><p class="notice">No working directories are projected yet.</p></div>') + '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>' + (attentionOnly ? 'Sessions needing attention' : 'Recent sessions') + '</h2><span class="meta">' + recent.length + '</span></div><div class="simple-list">' +
      (sessionRows || '<div class="panel-body"><p class="notice">No sessions are currently projected.</p></div>') + '</div></section>' +
      attentionPanel + '</div>';
  }
  function hierarchyOpen(status) { return status === "active" || status === "blocked"; }
  function taskQuestions(project, objective, taskId) {
    const projection = objective?.projection;
    return project.workflows.flatMap((workflow) => {
      const p = resolved(workflow);
      const c = contextFor(p);
      return arr(c?.questions)
        .filter((q) =>
          q.work?.objectiveId === objective.objectiveId &&
          q.work?.generation === projection?.generation &&
          (q.work?.revision === undefined || q.work.revision === projection?.plan?.revision) &&
          q.work?.taskId === taskId
        )
        .map((q) => ({ workflow, q }));
    });
  }
  function compactTextList(items, emptyText) {
    return arr(items).length
      ? '<ul>' + arr(items).map((item) => '<li>' + description(item) + '</li>').join('') + '</ul>'
      : '<p class="notice">' + esc(emptyText) + '</p>';
  }
  function renderPlanOverview(project, objective) {
    const p = objective.projection;
    const plan = p?.plan;
    if (!plan) return '';
    const key = 'project:' + project.projectId + ':objective:' + objective.objectiveId + ':plan';
    const obligations = arr(plan.obligations).map((item) =>
      '<div class="row"><div class="name">' + description(item.statement) + '</div><div class="badges">' +
      badge(item.disposition || 'Disposition unavailable', item.disposition === 'blocked' ? 'warn' : item.disposition === 'implement' ? 'info' : 'neutral') +
      '</div><p class="meta">Owner Tasks: ' + esc(arr(item.taskIds).join(', ') || 'none') + '</p>' +
      technical(key + ':obligation:' + item.id, [['Obligation ID', item.id], ['Source authority', item.sourceRef], ['Deferral authority', item.dispositionAuthorityRef]]) + '</div>'
    ).join('');
    const risks = arr(plan.riskBoundaries).map((item) =>
      '<div class="row"><div class="name">' + esc(named(item.title, item.id)) + '</div><p>' + description(item.description) + '</p><p class="meta">Tasks: ' + esc(arr(item.taskIds).join(', ') || 'none') + '</p></div>'
    ).join('');
    const acceptance = arr(plan.acceptanceCoverage).map((item) =>
      '<div class="row"><div class="name">' + esc(named(item.title, item.id)) + '</div><p>' + description(item.criterion) + '</p><p class="meta">Tasks: ' + esc(arr(item.taskIds).join(', ') || 'none') + '</p></div>'
    ).join('');
    const amendments = arr(plan.amendments).map((item) =>
      '<div class="row"><div class="name">Revision ' + esc(item.revision) + '</div><p>' + description(item.reason) + '</p><p class="meta">' + esc(arr(item.operations).join(' · ') || 'metadata update') + ' · ' + time(item.at) + '</p></div>'
    ).join('');
    const invalidated = plan.invalidated
      ? '<div class="callout" data-tone="danger"><strong>Plan generation invalidated</strong><div class="notice">' + description(plan.invalidated.reason) + ' · ' + time(plan.invalidated.at) + '</div></div>'
      : '';
    return invalidated +
      '<div class="callout"><strong>Plan goal · revision ' + esc(plan.revision) + '</strong><div class="notice">' + description(plan.goal) + '</div></div>' +
      '<div class="detail-grid section"><div class="stack">' +
      disclosure(key + ':obligations', 'Accepted obligations · ' + arr(plan.obligations).length, '<div class="list">' + (obligations || '<p class="notice">No obligation map projected.</p>') + '</div>', false) +
      disclosure(key + ':risks', 'Risk boundaries · ' + arr(plan.riskBoundaries).length, '<div class="list">' + (risks || '<p class="notice">No risk boundaries projected.</p>') + '</div>', false) +
      '</div><div class="stack">' +
      disclosure(key + ':acceptance', 'Acceptance coverage · ' + arr(plan.acceptanceCoverage).length, '<div class="list">' + (acceptance || '<p class="notice">No Plan-level acceptance coverage projected.</p>') + '</div>', false) +
      disclosure(key + ':scope', 'Assumptions & out of scope', '<h3>Assumptions</h3>' + compactTextList(plan.assumptions, 'No explicit assumptions projected.') + '<h3 class="section">Out of scope</h3>' + compactTextList(plan.outOfScope, 'No explicit exclusions projected.'), false) +
      (amendments ? disclosure(key + ':amendments', 'Plan amendments · ' + arr(plan.amendments).length, '<div class="list">' + amendments + '</div>', false) : '') +
      '</div></div>';
  }
  function renderHierarchy(project) {
    if (!arr(project.workObjectives).length) return '<p class="notice">No current work hierarchy is projected. Task progress is unavailable, not zero.</p>';
    return '<div class="hierarchy">' + project.workObjectives.map((objective) => {
      const base = 'project:' + project.projectId + ':objective:' + objective.objectiveId;
      if (objective.consistency === "conflict") return '<div class="callout" data-tone="danger"><strong>Work hierarchy conflict</strong><div class="notice">Different reports describe this objective at work version ' + esc(objective.workVersion) + '. No hierarchy winner is selected.</div>' + technical(base, [['Objective ID', objective.objectiveId]]) + '</div>';
      const p = objective.projection;
      const phases = arr(p?.phases).map((phase) => {
        const phaseKey = base + ':phase:' + phase.phaseId;
        const waves = arr(phase.waves).map((wave) => {
          const waveKey = phaseKey + ':wave:' + wave.waveId;
          const taskRows = arr(wave.tasks).map((task) => {
            const taskKey = waveKey + ':task:' + task.taskId;
            const owner = workflowById(project, task.claimedByWorkflowId);
            const ownership = task.claimedByWorkflowId ? '<div class="meta">Owned by: ' +
              (owner
                ? '<a data-key="' + esc('owner:' + taskKey) + '" href="' + esc(workflowHref(project, owner)) + '">' + esc(titleFor(project, owner)) + '</a>'
                : '<a data-key="' + esc('owner:' + taskKey) + '" href="' + esc('#/project/' + enc(project.projectId) + '/workflow/' + enc(task.claimedByWorkflowId)) + '">Workflow outside this view</a>') +
              '</div>' : '';
            const questions = taskQuestions(project, objective, task.taskId);
            const questionRows = questions.map(({workflow, q}) =>
              '<div class="row"><div class="name">' + description(q.description) + '</div><p class="meta">' + esc(q.status) + ' · ' + esc(roleName(q.requiredAuthority)) + '</p>' +
              link(workflowHref(project, workflow), 'Open originating workflow →', 'oq-origin:' + q.id) + '</div>'
            ).join('');
            const details =
              (task.objective ? '<p><strong>Outcome:</strong> ' + description(task.objective) + '</p>' : '') +
              (task.rationale ? '<p><strong>Why:</strong> ' + description(task.rationale) + '</p>' : '') +
              (arr(task.constraints).length ? '<h4>Constraints</h4>' + compactTextList(task.constraints, '') : '') +
              (arr(task.acceptanceCriteria).length ? '<h4>Acceptance criteria</h4>' + compactTextList(task.acceptanceCriteria, '') : '') +
              (arr(task.subtasks).length ? '<h4>Subtasks / checklist</h4>' + compactTextList(task.subtasks, '') : '') +
              (arr(task.integration).length ? '<h4>Integration</h4>' + compactTextList(task.integration, '') : '') +
              (task.result?.summary ? '<h4>Completed result</h4><p>' + description(task.result.summary) + '</p><p class="meta">' + esc(task.result.evidenceClaims) + ' evidence claim(s) · ' + time(task.result.completedAt) + '</p>' : '') +
              (questions.length ? '<h4>Correlated OQs</h4><div class="list">' + questionRows + '</div>' : '<p class="notice">No open correlated OQ is projected for this Task.</p>');
            return '<li><details class="disclosure" data-hierarchy-key="' + esc(taskKey) + '"' + (task.status === 'active' || task.status === 'blocked' ? ' open' : '') + '><summary data-key="' + esc('hierarchy:' + taskKey) + '"><span class="name">' + esc(named(task.title, 'Unnamed task')) + ' — ' + esc(task.status) + (questions.length ? ' · ' + questions.length + ' OQ' + (questions.length === 1 ? '' : 's') : '') + '</span></summary><div class="panel-body">' + ownership + details + technical(taskKey, [['Task ID', task.taskId], ['claimed by workflow ID', task.claimedByWorkflowId]]) + '</div></details></li>';
          }).join("");
          const waveIntro = (wave.objective ? '<p class="notice">' + description(wave.objective) + '</p>' : '') +
            (arr(wave.constraints).length ? '<div class="meta">Constraints: ' + arr(wave.constraints).map((item) => description(item)).join(' · ') + '</div>' : '');
          return '<details ' + (hierarchyOpen(wave.status) ? 'open ' : '') + 'data-hierarchy-key="' + esc(waveKey) + '" data-status="' + esc(wave.status) + '"><summary data-key="' + esc('hierarchy:' + waveKey) + '"><span>' + esc(named(wave.title, 'Unnamed wave')) + ' — ' + esc(wave.status) + '</span></summary><div class="panel-body">' + waveIntro + '<ul>' + taskRows + '</ul>' + technical(waveKey, [['Wave ID', wave.waveId]]) + '</div></details>';
        }).join("");
        const phaseIntro = phase.objective ? '<p class="notice">' + description(phase.objective) + '</p>' : '';
        return '<details ' + (hierarchyOpen(phase.status) ? 'open ' : '') + 'data-hierarchy-key="' + esc(phaseKey) + '" data-status="' + esc(phase.status) + '"><summary data-key="' + esc('hierarchy:' + phaseKey) + '"><span>' + esc(named(phase.title, 'Unnamed phase')) + ' — ' + esc(phase.status) + '</span></summary><div class="panel-body">' + phaseIntro + waves + technical(phaseKey, [['Phase ID', phase.phaseId]]) + '</div></details>';
      }).join("");
      return '<details open data-hierarchy-key="' + esc(base) + '" data-status="' + esc(p?.status || 'unknown') + '"><summary data-key="' + esc('hierarchy:' + base) + '"><span class="name">' + esc(named(p?.title, 'Unnamed objective')) + '</span><span class="meta">Objective: ' + esc(p?.status || 'unknown') + ' · work version ' + esc(objective.workVersion) + ' · generation ' + esc(p?.generation) + (p?.plan ? ' · plan revision ' + esc(p.plan.revision) : '') + (objective.sourceFreshness === 'stale-source' ? ' · stale/offline source' : '') + '</span></summary><div class="panel-body">' + renderPlanOverview(project, objective) + phases + technical(base, [['Objective ID', objective.objectiveId], ['Anchor reference', p?.anchor]]) + '</div></details>';
    }).join("") + '</div>';
  }
  function renderProject(project) {
    crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home') + '<span aria-hidden="true">/</span><span aria-current="page">' + esc(projectName(project)) + '</span>';
    setHeading('Working directory', projectName(project), '<span class="path mono">' + esc(project.canonicalLocation) + '</span>');
    const sessions = sessionsFor(project);
    const failed = project.workflows.filter((workflow) => resolved(workflow)?.status === 'failed');
    const active = sessions.filter((session) => session.status === 'active').length;
    const sessionRows = sessions.map((session) => sessionListRow(project, session)).join('');
    const summary =
      '<dl class="facts"><div class="fact"><dt>Sessions</dt><dd>' + sessions.length + '</dd></div>' +
      '<div class="fact"><dt>Active now</dt><dd>' + active + '</dd></div>' +
      '<div class="fact"><dt>Failed workflows</dt><dd>' + failed.length + '</dd></div></dl>' +
      '<div class="action-row section"><a class="button-link" data-key="directory:manage-workflows" href="' + esc(projectHref(project) + '/workflows') + '">Manage workflows</a></div>';
    const coverage = project.projectionWindow;
    const windowNotice = coverage?.workflowsTruncated === true || coverage?.completedObjectivesTruncated === true
      ? '<div class="callout" data-history="limited"><strong>Recent view</strong><div class="notice">At least one publisher limits its history. Older sessions or completed work may be outside this view.</div></div>'
      : coverage?.workflowsTruncated === false && coverage?.completedObjectivesTruncated === false
        ? ''
        : '<div class="callout" data-history="unknown"><strong>History coverage unavailable</strong><div class="notice">Not every publisher reports its history limits. This view may be incomplete.</div></div>';
    main.innerHTML = windowNotice + '<div class="directory-layout"><section class="panel"><div class="panel-head"><h2>Sessions</h2><span class="meta">Most recent first</span></div><div class="simple-list">' +
      (sessionRows || '<div class="panel-body"><p class="notice">No sessions are currently projected for this directory.</p></div>') +
      '</div></section><aside class="stack">' + panel('Directory summary', summary) +
      disclosure('work-map:' + project.projectId, 'Advanced work map', '<p class="meta">Objective → Phase → Wave → Task</p><div class="section">' + renderHierarchy(project) + '</div>', false) +
      '</aside></div>';
  }
  function renderWorkflowManager(project) {
    crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home') + '<span aria-hidden="true">/</span>' +
      link(projectHref(project), projectName(project), 'crumb:directory') + '<span aria-hidden="true">/</span><span aria-current="page">Workflows</span>';
    setHeading('Working directory', 'Workflows', 'Manage execution records for ' + esc(projectName(project)) + '.');
    const items = sortWorkflows(project.workflows.map((workflow) => ({project, workflow})));
    const cleanup = items.filter(({workflow}) => deletableWorkflow(workflow));
    const cleanupButton = cleanup.length
      ? '<button class="danger-button" type="button" data-project-id="' + esc(project.projectId) + '" data-workflow-ids="' + esc(cleanup.map(({workflow}) => enc(workflow.workflowId)).join(',')) + '" data-return-href="' + esc(projectHref(project) + '/workflows') + '">Delete failed/cancelled workflows</button>'
      : '';
    const note = cleanup.length
      ? '<div class="callout" data-tone="danger"><strong>' + plural(cleanup.length, 'workflow') + ' can be cleaned up</strong><div class="notice">Deletion removes obsolete Loom execution records and stale session bindings. Files in the working directory and retained evidence are not changed.</div></div>'
      : '<div class="callout"><strong>No failed workflow clutter</strong><div class="notice">There are no failed or cancelled workflows available for deletion in this projected view.</div></div>';
    const rows = items.map(({workflow}) => {
      const p = resolved(workflow);
      const sessionId = sessionIdForWorkflow(workflow);
      const status = displayState(workflow);
      const deleteAction = deletableWorkflow(workflow)
        ? '<button class="icon-danger" type="button" aria-label="Delete ' + esc(titleFor(project, workflow)) + '" data-project-id="' + esc(project.projectId) + '" data-workflow-ids="' + esc(enc(workflow.workflowId)) + '" data-return-href="' + esc(projectHref(project) + '/workflows') + '">Delete</button>'
        : '';
      return '<div class="workflow-table-row"><span class="identity"><span class="name">' + esc(titleFor(project, workflow)) + '</span><span class="meta">' + (p?.recentActivityAt ? time(p.recentActivityAt) : 'Activity unavailable') + '</span></span>' +
        '<a class="quiet-link" data-key="' + esc('manager:session:' + sessionId) + '" href="' + esc(sessionHref(project, sessionId)) + '">Session</a>' +
        badge(status, tone(workflow), true) +
        '<span class="row-actions"><a class="quiet-link" data-key="' + esc('manager:workflow:' + workflow.workflowId) + '" href="' + esc(workflowHref(project, workflow)) + '">Open</a>' + deleteAction + '</span></div>';
    }).join('');
    main.innerHTML = note + '<section class="panel"><div class="panel-head"><div><h2>Workflow records</h2><p class="notice">Workflows are grouped under sessions in normal use. This view is for inspection and cleanup.</p></div>' + cleanupButton + '</div><div class="workflow-table">' +
      (rows || '<div class="panel-body"><p class="notice">No workflows are projected.</p></div>') + '</div></section>';
  }
  function panel(title, content, detail = '') {
    return '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + (detail ? '<span class="meta">' + esc(detail) + '</span>' : '') + '</div><div class="panel-body">' + content + '</div></section>';
  }
  function disclosure(key, title, content, open = false) {
    return '<details class="disclosure" data-hierarchy-key="' + esc(key) + '"' + (open ? ' open' : '') + '><summary data-key="' + esc('disclosure:' + key) + '">' + esc(title) + '</summary><div class="panel-body">' + content + '</div></details>';
  }
  function workflowCrumbs(project, w) {
    const sessionId = sessionIdForWorkflow(w);
    const session = sessionById(project, sessionId);
    crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home') + '<span aria-hidden="true">/</span>' +
      link(projectHref(project), projectName(project), 'crumb:directory') + '<span aria-hidden="true">/</span>' +
      link(sessionHref(project, sessionId), session?.title || 'Session', 'crumb:session') + '<span aria-hidden="true">/</span>' +
      '<span aria-current="page">' + esc(titleFor(project, w)) + '</span>';
  }
  function publisherDetails(project, w, open = false) {
    const rows = arr(w.participants).map((participant, index) => '<div class="row"><div class="name">Publisher ' + (index + 1) + '</div><div class="meta">Revision ' + esc(participant.workflowRevision) + ' · ' + (participant.live ? 'live publisher' : 'stale/offline publisher') + (participant.workflowRevision < w.workflowRevision ? ' · lagging revision' : '') + '</div><div class="meta">Lease expires: ' + esc(participant.leaseExpiresAt || 'Unavailable') + '</div>' + technical(project.projectId + ':' + w.workflowId + ':publisher:' + participant.instanceId, [['Publisher ID', participant.instanceId], ['Installation ID', participant.installationId]]) + '</div>').join('') || '<p class="notice">No participating publisher is projected.</p>';
    const content = '<h3>Participating publishers</h3><div class="list section">' + rows + '</div><h3 class="section">Authority provenance</h3><p class="notice">Workflow, OQ, verification, budget, Product Acceptance, hierarchy and knowledge values are Loom-authoritative. OpenCode session/model/token/cost telemetry is supplemental; missing telemetry never implies zero or success.</p><p class="meta section">Highest workflow revision: ' + esc(w.workflowRevision) + '. Publisher liveness and workflow source freshness are separate.</p>';
    return disclosure('publishers:' + project.projectId + ':' + w.workflowId, 'Publishers & provenance · ' + arr(w.participants).length, content, open);
  }
  function workflowWarnings(w) {
    const p = resolved(w);
    let result = '';
    if (w.sourceFreshness === 'stale-source') result += '<div class="callout" data-tone="stale"><strong>Latest-known state · stale source</strong><div class="notice">The publishers supplying the displayed snapshot are stale/offline. Other live publishers may report an older revision or lack these readable details; they do not make this snapshot current. Last meaningful activity: ' + time(p?.recentActivityAt) + '.</div></div>';
    if (p?.status === 'blocked' || p?.status === 'failed') result += '<div class="callout" data-tone="' + (p.status === 'failed' ? 'danger' : 'warn') + '"><strong>' + (p.status === 'failed' ? 'Workflow reports failure' : 'Workflow is blocked') + '</strong><div class="notice">Inspect the workflow’s reported results, questions and required checks. An open-item count alone does not establish the cause.</div></div>';
    return result;
  }
  function stepRows(steps, runnableIds) {
    return steps.map((step) => '<div class="step"><span class="step-symbol" aria-hidden="true">' + (step.status === 'complete' || step.status === 'passed' ? '✓' : step.status === 'failed' ? '×' : '→') + '</span><div class="identity"><div class="name">' + esc(stepName(step)) + '</div><div class="badges">' + badge(roleName(step.agent)) + badge(step.status || 'Status unavailable', step.status === 'failed' ? 'danger' : 'neutral') + (runnableIds.has(step.id) ? badge('Ready to dispatch', 'info') : '') + '</div></div></div>').join('');
  }
  function sessionRow(project, w, sessionId) {
    const href = sessionHref(project, sessionId);
    const name = sessionName(w, sessionId);
    return '<a class="row" data-key="session:' + esc(sessionId) + '" href="' + esc(href) + '" aria-label="Inspect ' + esc(name + ' for ' + titleFor(project, w)) + '"><span class="nav-symbol" aria-hidden="true">↳</span><span class="identity"><span class="name">' + esc(name) + '</span><span class="meta" style="display:block">' + esc(titleFor(project, w)) + '</span></span><span class="go" aria-hidden="true">↗</span></a>';
  }
  function renderWorkflow(project, w) {
    workflowCrumbs(project, w);
    const p = resolved(w);
    const c = contextFor(p);
    setHeading('Workflow · ' + projectName(project), titleFor(project, w), '<div class="meta">Latest recorded workflow state · revision ' + esc(w.workflowRevision) + '</div>', badges(w));
    if (w.consistency === 'conflict') {
      const candidates = arr(w.conflictCandidates).map((candidate, index) => '<div class="row"><div class="name">Report ' + (index + 1) + '</div><div>Reported status: ' + esc(candidate.status) + '</div>' + technical(project.projectId + ':' + w.workflowId + ':candidate:' + index, [['State digest', candidate.stateDigest]]) + '</div>').join('');
      main.innerHTML = '<div class="callout" data-tone="danger"><strong>Consistency conflict</strong><div class="notice">Publishers report different or incompatible Loom-authoritative state for the same highest workflow revision. No winner is selected; state-specific fields are withheld until the conflict resolves. Inspect the participating publishers in Loom; restarting alone is not proof of resolution.</div></div>' + panel('Conflicting snapshots', '<div class="list">' + candidates + '</div>') + '<div class="section">' + publisherDetails(project, w, true) + '</div>' + workflowTechnical(project, w);
      return;
    }
    if (!p) { main.innerHTML = empty('Workflow state unavailable.', 'No resolved workflow projection is available. Refresh to retry; no successful or failed state is inferred.') + workflowTechnical(project, w); return; }
    const tasks = p.hierarchyProgress?.tasks;
    const metricData = [
      [ratio(tasks), 'Tasks complete', progress(tasks)],
      [(c?.questionCountIsLowerBound ? 'At least ' : '') + count(p.openOqCount), 'Open questions (OQs)', ''],
      [count(p.openVerificationCount), 'Verification items', ''],
      [ratio(p.budget, 'used', 'limit'), 'Budget used/limit', budgetMeter(p.budget)],
    ];
    const metrics = '<div class="stats" aria-label="Workflow signals">' + metricData.map(([value, label, graphic]) => '<div class="stat"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span>' + graphic + '</div>').join('') + '</div>';
    const current = arr(p.currentSteps);
    const runnable = arr(p.runnableSteps);
    const runnableIds = new Set(runnable.map((step) => step.id));
    const additional = runnable.filter((step) => !current.some((s) => s.id === step.id));
    let work = stepRows(current, runnableIds) || '<p class="notice">No current step is projected. This does not imply that the workflow is complete.</p>';
    if (additional.length) work += '<h3 class="section">Also available next</h3><div class="section">' + stepRows(additional, runnableIds) + '</div>';
    const failures = arr(c?.steps).filter((step) => step.status === 'failed');
    if (failures.length) work += '<h3 class="section">Reported failures</h3><div class="list section">' + failures.map((step) => '<div class="row"><div class="name">' + esc(stepName(step)) + '</div><p class="notice">Reported result: ' + (step.reportedResult ? description(step.reportedResult) : 'No explanation was recorded.') + '</p></div>').join('') + '</div>';
    if (c?.truncated.steps) work += '<p class="notice section">The step list is limited. Inspect the remaining steps in Loom.</p>';
    work += '<p class="notice section">Ready means eligible for dispatch, not proof that an agent is currently running.</p><div class="section">' + link(projectHref(project), 'View project work map →', 'work-map') + '</div>';
    work += technical(project.projectId + ':' + w.workflowId + ':steps', [...current, ...additional].map((step) => [stepName(step) + ' — step ID', step.id]));
    const sessions = arr(p.participatingSessionIds).slice().sort();
    const coordinator = sessions.includes(c?.coordinatorSessionId) ? c.coordinatorSessionId : null;
    const ordered = coordinator ? [coordinator, ...sessions.filter((id) => id !== coordinator)] : sessions;
    const visible = ordered.slice(0, coordinator ? 1 : 2);
    const remaining = ordered.slice(visible.length);
    let sessionContent = '<div class="list">' + visible.map((id) => sessionRow(project, w, id)).join('') + '</div>';
    if (remaining.length) sessionContent += '<div class="section">' + disclosure('sessions:' + project.projectId + ':' + w.workflowId, 'More sessions · ' + remaining.length, '<div class="list">' + remaining.map((id) => sessionRow(project, w, id)).join('') + '</div>') + '</div>';
    if (!sessions.length) sessionContent = '<p class="notice">No participating OpenCode session is projected.</p>';
    sessionContent += '<p class="notice section">Session labels describe membership, not live activity. Session titles and per-agent activity are not available; numbered labels distinguish sessions in this view.</p>';
    const boundaries = '<dl class="facts">' +
      '<div class="fact"><dt>Next agent</dt><dd>' + esc(p.activeAgent ? roleName(p.activeAgent) : 'Not projected') + '</dd></div>' +
      '<div class="fact"><dt>Execution stage</dt><dd>' + esc(stageName(p)) + '</dd></div>' +
      '<div class="fact"><dt>Product Acceptance</dt><dd>' + badge(p.productAcceptance?.status || 'Not projected', p.productAcceptance?.status === 'failed' ? 'danger' : p.productAcceptance?.status === 'passed' ? 'ok' : 'neutral') + '</dd></div>' +
      '<div class="fact"><dt>Knowledge sync</dt><dd>' + (p.knowledgeSync?.valid === true ? badge('valid', 'ok') : p.knowledgeSync?.valid === false ? badge('stale', 'warn') : 'Not projected') + '</dd></div>' +
      '<div class="fact"><dt>Last meaningful activity</dt><dd>' + time(p.recentActivityAt) + '</dd></div></dl><p class="notice section">Counts are signals, not causal explanations. Budget measures agent dispatches, not money or task completion. Resolve questions and supply evidence through Loom; this dashboard cannot change them.</p>';
    const cleanupSessionId = sessionIdForWorkflow(w);
    const cleanupSession = sessionById(project, cleanupSessionId);
    const cleanupReturn = cleanupSession?.workflows.length === 1
      ? projectHref(project)
      : sessionHref(project, cleanupSessionId);
    const cleanupAction = deletableWorkflow(w)
      ? '<div class="cleanup-strip"><div><strong>Obsolete workflow?</strong><p class="notice">Failed/cancelled workflow records can be removed without changing project files.</p></div><button class="danger-button" type="button" data-project-id="' + esc(project.projectId) + '" data-workflow-ids="' + esc(enc(w.workflowId)) + '" data-return-href="' + esc(cleanupReturn) + '">Delete workflow</button></div>'
      : '';
    main.innerHTML = cleanupAction + workflowWarnings(w) + metrics + '<div class="detail-grid"><div class="stack">' +
      (c?.request ? panel('Requested outcome', '<p>' + description(c.request) + '</p>') : '') +
      panel('Current work', work, 'Latest projected step state') + boundaryPanels(project, w) + panel('OpenCode sessions', sessionContent, plural(sessions.length, 'session')) + '</div><div class="stack">' + panel('Gates & context', boundaries) + publisherDetails(project, w) + workflowTechnical(project, w) + '</div></div><p class="provenance">Loom-authoritative workflow state. Cleanup controls affect Loom runtime records only; project files are unchanged.</p>';
  }
  function renderSession(project, sessionId) {
    const session = sessionById(project, sessionId);
    crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home') + '<span aria-hidden="true">/</span>' +
      link(projectHref(project), projectName(project), 'crumb:directory') + '<span aria-hidden="true">/</span><span aria-current="page">Session</span>';
    if (!session) {
      setHeading('Session', 'Session not projected', 'This session may have completed, been cleaned up, or moved outside the current projection window.');
      main.innerHTML = empty('Session not available.', 'Return to the working directory to inspect current sessions.', link(projectHref(project), 'Return to working directory', 'return:directory'));
      return;
    }
    setHeading('Session · ' + projectName(project), session.title,
      session.recentActivityAt ? 'Last activity ' + time(session.recentActivityAt) : 'Activity time unavailable',
      badge(
        session.status,
        session.status === 'failed' || session.status === 'conflict' ? 'danger' :
          session.status === 'blocked' ? 'warn' :
          session.status === 'stale' ? 'stale' :
          session.status === 'active' ? 'info' :
          session.status === 'complete' ? 'ok' : 'neutral',
        true,
      ));
    const failed = session.workflows.filter((workflow) => deletableWorkflow(workflow));
    const bulkCleanupReturn = failed.length === session.workflows.length
      ? projectHref(project)
      : sessionHref(project, session.id);
    const cleanupButton = failed.length
      ? '<button class="danger-button" type="button" data-project-id="' + esc(project.projectId) + '" data-workflow-ids="' + esc(failed.map((workflow) => enc(workflow.workflowId)).join(',')) + '" data-return-href="' + esc(bulkCleanupReturn) + '">Delete failed/cancelled workflows</button>'
      : '';
    const workflowRows = session.workflows.map((workflow) => {
      const p = resolved(workflow);
      const current = arr(p?.currentSteps);
      const detail = current.length ? stepName(current[0]) : (p?.status === 'complete' ? 'Completed' : 'No current step projected');
      const cleanupReturn = session.workflows.length === 1
        ? projectHref(project)
        : sessionHref(project, session.id);
      const cleanup = deletableWorkflow(workflow)
        ? '<button class="icon-danger" type="button" aria-label="Delete ' + esc(titleFor(project, workflow)) + '" data-project-id="' + esc(project.projectId) + '" data-workflow-ids="' + esc(enc(workflow.workflowId)) + '" data-return-href="' + esc(cleanupReturn) + '">Delete</button>'
        : '';
      return '<div class="workflow-table-row"><a class="workflow-row-link" data-key="' + esc('session:workflow:' + workflow.workflowId) + '" href="' + esc(workflowHref(project, workflow)) + '"><span class="identity"><span class="name">' + esc(titleFor(project, workflow)) + '</span><span class="meta">' + esc(detail) + '</span></span></a>' +
        badge(displayState(workflow), tone(workflow), true) + '<span class="row-actions">' + cleanup + '</span></div>';
    }).join('');
    const questionCounts = session.workflows.map((workflow) => resolved(workflow)?.openOqCount);
    const openQuestions = questionCounts.every(number)
      ? questionCounts.reduce((sum, value) => sum + Number(value), 0)
      : null;
    const summary = '<dl class="facts"><div class="fact"><dt>Workflows</dt><dd>' + session.workflows.length + '</dd></div>' +
      '<div class="fact"><dt>Open questions</dt><dd>' + (openQuestions === null ? 'Unavailable' : openQuestions) + '</dd></div>' +
      '<div class="fact"><dt>Working directory</dt><dd>' + esc(projectName(project)) + '</dd></div></dl>';
    main.innerHTML = '<div class="session-layout"><section class="panel"><div class="panel-head"><div><h2>Workflows</h2><p class="notice">Execution work inside this session.</p></div>' + cleanupButton + '</div><div class="workflow-table">' + workflowRows + '</div></section>' +
      '<aside class="stack">' + panel('Session summary', summary) +
      panel('Where this fits', '<p class="notice"><strong>' + esc(projectName(project)) + '</strong> → <strong>' + esc(session.title) + '</strong> → workflow</p>') +
      technical('session:' + project.projectId + ':' + session.id, [['Session ID', session.id], ['Project ID', project.projectId]]) +
      '</aside></div>';
  }

  function deletionDialog(project, workflows, returnHref) {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    const titles = workflows.map((workflow) =>
      '<li><span>' + esc(titleFor(project, workflow)) + '</span>' + badge(displayState(workflow), 'danger', true) + '</li>'
    ).join('');
    dialog.innerHTML =
      '<form method="dialog" class="dialog-card"><div class="dialog-head"><div><span class="danger-symbol" aria-hidden="true">⌫</span><h2>Delete ' + workflows.length + ' failed/cancelled workflow' + (workflows.length === 1 ? '' : 's') + '?</h2></div><button class="dialog-close" value="cancel" aria-label="Close">×</button></div>' +
      '<p class="notice">These workflow records will be removed from Loom so they no longer clutter the control panel or interfere with future agent routing.</p>' +
      '<div class="callout section"><strong>Your code is not deleted.</strong><div class="notice">Files in the working directory are unchanged. Retained evidence and durable completed work results stay available.</div></div>' +
      '<ul class="delete-list">' + titles + '</ul><p class="dialog-error" role="alert" hidden></p>' +
      '<div class="dialog-actions"><button value="cancel">Cancel</button><button class="danger-button" type="button" data-confirm-delete>Delete workflows</button></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
    let pending = false;
    dialog.addEventListener('cancel', (event) => {
      if (pending) event.preventDefault();
    });
    dialog.showModal();
    dialog.querySelector('button[value="cancel"]').focus();
    dialog.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
      const confirm = dialog.querySelector('[data-confirm-delete]');
      const errorNode = dialog.querySelector('.dialog-error');
      const cancelControls = [...dialog.querySelectorAll('button[value="cancel"]')];
      pending = true;
      confirm.disabled = true;
      for (const control of cancelControls) control.disabled = true;
      confirm.textContent = 'Deleting…';
      errorNode.hidden = true;
      try {
        if (!window.__LOOM_CONTROL_TOKEN__) throw new Error('Dashboard controls are unavailable. Restart the Loom dashboard.');
        let response;
        try {
          response = await fetch('/api/control/workflows/delete', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-loom-control-token': window.__LOOM_CONTROL_TOKEN__,
            },
            body: JSON.stringify({
              projectId: project.projectId,
              workflowIds: workflows.map((workflow) => workflow.workflowId),
              reason: 'User removed obsolete failed/cancelled workflows from the Loom control panel.',
            }),
          });
        } catch {
          throw new Error('Could not confirm whether workflow deletion completed. Retry is safe; Loom treats already-completed cleanup as success.');
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Workflow deletion failed.');
        dialog.close();
        state.signature = '';
        await refresh(true);
        const destination = returnHref || projectHref(project);
        if (location.hash !== destination) {
          location.hash = destination;
        } else {
          main.focus({ preventScroll: true });
        }
        live.textContent = workflows.length + ' workflow' + (workflows.length === 1 ? '' : 's') + ' deleted from Loom.';
      } catch (error) {
        pending = false;
        errorNode.textContent = error instanceof Error ? error.message : String(error);
        errorNode.hidden = false;
        confirm.disabled = false;
        for (const control of cancelControls) control.disabled = false;
        confirm.textContent = 'Delete workflows';
      }
    });
  }

  function openDeletionControl(button) {
    const project = projectById(button.dataset.projectId);
    if (!project) return;
    const ids = String(button.dataset.workflowIds || '').split(',').filter(Boolean).map((id) => decodeURIComponent(id));
    const workflows = ids.map((id) => workflowById(project, id)).filter(Boolean);
    if (!workflows.length) return;
    deletionDialog(project, workflows, button.dataset.returnHref || projectHref(project));
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
    crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home') + (r.projectId ? '<span aria-hidden="true">/</span><span>Requested location</span>' : '');
    setHeading('Projection pending', 'Waiting for Loom state…', 'Your requested location is preserved.');
    const href = r.projectId ? '#/directory/' + enc(r.projectId) : '#/';
    main.innerHTML = empty('Requested state is not currently projected.', detail + ' Refresh to retry; absence in one projection does not by itself prove deletion.', link(href, r.projectId ? 'Return to working directory' : 'Return to control panel', 'return:parent')) +
      technical('waiting:' + location.hash, [['Project ID', r.projectId], ['Workflow ID', r.workflowId], ['Session ID', r.sessionId]]);
  }
  function focusKey(key) {
    return [...document.querySelectorAll('[data-key]')].find((node) => node.dataset.key === key && node.getClientRects().length);
  }
  function render(navigationChange = false) {
    captureHierarchyOpen();
    const focused = navigationChange ? '' : document.activeElement?.dataset?.key || '';
    const r = route();
    navigation(r);
    const project = r.projectId ? projectById(r.projectId) : undefined;
    const workflow = project && r.workflowId ? workflowById(project, r.workflowId) : undefined;
    if (!state.loaded) {
      setHeading('Control plane', 'Loom Control Panel', 'Connecting to the current projection.');
      main.innerHTML = empty('Loading Loom…', 'Missing data is not treated as a healthy zero.');
    } else if (r.kind === 'invalid') {
      setHeading('Navigation', 'Invalid control-panel address', 'No Loom object has been selected.');
      crumbs.innerHTML = link('#/', 'Control panel', 'crumb:home');
      main.innerHTML = empty('This control-panel address is not recognized.', 'Return to the control panel and choose a working directory.', link('#/', 'Return to control panel', 'return:home'));
    } else if (r.kind === 'fleet') {
      renderFleet();
    } else if (!project) {
      renderProjectionWait(r, 'The requested working directory may still be propagating or may no longer be projected.');
    } else if (r.kind === 'project') {
      renderProject(project);
    } else if (r.kind === 'workflows') {
      renderWorkflowManager(project);
    } else if (r.kind === 'session-group') {
      renderSession(project, r.sessionId);
    } else if (!workflow) {
      renderProjectionWait(r, project.projectionWindow?.workflowsTruncated === true
        ? 'The requested workflow is outside the current bounded projection window.'
        : 'The requested workflow may have been cleaned up or may no longer be projected.');
    } else {
      renderWorkflow(project, workflow);
    }
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
        const fallback = [...main.querySelectorAll('[data-key]')].find((node) => node.getClientRects().length) || main;
        fallback?.focus?.();
        live.textContent = 'The previously focused item is no longer available. Focus moved to the nearest available control.';
      }
    }
  }
  function updateFeed() {
    const last = state.lastReceived ? new Date(state.lastReceived).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : null;
    feed.dataset.health = state.paused ? 'paused' : state.refreshFailed ? 'error' : state.loaded ? 'connected' : 'connecting';
    feed.textContent = (state.paused ? 'Display updates paused' : state.refreshFailed ? 'Refresh unavailable' : state.loaded ? 'Projection received' : 'Connecting…') + (last ? ' · ' + last : '');
    feed.title = 'This is dashboard delivery, not workflow or publisher health.';
  }
  ${dashboardValidation}
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
      if (!response.ok) throw new Error('Control-panel projection request failed');
      const next = await response.json();
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
      projectionStatus.textContent = state.loaded ? 'Control-panel refresh failed. Showing the last known Loom projection. Use Refresh to retry; Loom execution is independent of the dashboard.' : 'Loom projection is currently unavailable. Use Refresh to retry. Loom execution is independent of the dashboard.';
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
  main.addEventListener('click', (event) => {
    const deletion = event.target.closest('[data-workflow-ids][data-project-id]');
    if (deletion) {
      event.preventDefault();
      openDeletionControl(deletion);
    }
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
