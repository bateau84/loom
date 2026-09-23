/** Validate the fields the browser consumes before adopting a new snapshot. */
export const dashboardValidation = `
  function validFleet(value) {
    const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const text = (v) => typeof v === 'string';
    const id = (v) => {
      if (!text(v) || !v.length) return false;
      try { encodeURIComponent(v); return true; } catch { return false; }
    };
    const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const boolean = (v) => typeof v === 'boolean';
    const optional = (v, check) => v === undefined || check(v);
    const fields = (v, keys, check) => keys.every((key) => optional(v[key], check));
    const list = (v, check) => Array.isArray(v) && v.every(check);
    const step = (v) => record(v) && id(v.id) && fields(v, ['agent','kind','status','label'], text);
    const progress = (v) => record(v) && fields(v, ['complete','total','blocked','active','failed'], numeric);
    const scope = (v) => record(v) && fields(v, ['objectiveId','phaseId','waveId'], id) &&
      optional(v.generation, numeric) && optional(v.taskIds, (ids) => list(ids, id));
    const budget = (v) => record(v) && fields(v, ['used','limit'], numeric) && optional(v.exhausted, boolean);
    const acceptance = (v) => record(v) && optional(v.status, text) && fields(v, ['passed','failed','unproven'], numeric);
    const knowledge = (v) => record(v) && optional(v.valid, boolean) && optional(v.updatedAt, text);
    const projection = (p) => p == null || record(p) &&
      fields(p, ['workflowId','activeSessionId'], id) &&
      fields(p, ['anchor','status','executionStage','activeAgent','recentActivityAt','stateDigest'], text) &&
      fields(p, ['workflowRevision','openOqCount','openVerificationCount'], numeric) &&
      optional(p.currentSteps, (steps) => list(steps, step)) && optional(p.runnableSteps, (steps) => list(steps, step)) &&
      optional(p.participatingSessionIds, (ids) => list(ids, id)) && optional(p.workScope, scope) &&
      optional(p.hierarchyProgress, (v) => record(v) && fields(v, ['objective','phases','waves','tasks'], progress)) &&
      optional(p.budget, budget) && optional(p.productAcceptance, acceptance) && optional(p.knowledgeSync, knowledge);
    const task = (v) => record(v) && id(v.taskId) && fields(v, ['title','status'], text) && optional(v.claimedByWorkflowId, id);
    const wave = (v) => record(v) && id(v.waveId) && fields(v, ['title','status'], text) && optional(v.tasks, (tasks) => list(tasks, task));
    const phase = (v) => record(v) && id(v.phaseId) && fields(v, ['title','status'], text) && optional(v.waves, (waves) => list(waves, wave));
    const work = (v) => v == null || record(v) && fields(v, ['title','anchor','status','stateDigest'], text) &&
      fields(v, ['workVersion','generation'], numeric) && optional(v.phases, (phases) => list(phases, phase));
    const objective = (v) => record(v) && id(v.objectiveId) && fields(v, ['consistency','sourceFreshness'], text) &&
      optional(v.workVersion, numeric) && work(v.projection) && optional(v.conflictCandidates, (candidates) => list(candidates, work));
    const participant = (v) => record(v) && id(v.instanceId) && optional(v.installationId, id) &&
      optional(v.live, boolean) && fields(v, ['workflowRevision','generation'], numeric) && optional(v.leaseExpiresAt, text);
    const workflow = (v) => record(v) && id(v.workflowId) && optional(v.projectId, id) &&
      fields(v, ['consistency','sourceFreshness'], text) && optional(v.workflowRevision, numeric) && projection(v.projection) &&
      optional(v.conflictCandidates, (candidates) => list(candidates, (p) => record(p) && projection(p))) &&
      optional(v.participants, (participants) => list(participants, participant));
    // Optional readable context has its own version-aware decoder. Bad context only
    // degrades that detail panel; malformed core fields must not poison last-good state.
    return record(value) && list(value.projects, (p) => record(p) && id(p.projectId) &&
      fields(p, ['displayName','canonicalLocation'], text) && list(p.workflows, workflow) &&
      optional(p.workObjectives, (objectives) => list(objectives, objective)));
  }
`;
