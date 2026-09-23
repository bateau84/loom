/** Human labels for the generated browser client; IDs remain routing keys, not names. */
export const dashboardReadability = `
  const stepLabels = {
    diagnostic: 'Investigate the problem', research: 'Research the solution',
    designer: 'Design the experience', specifier: 'Define the behavior',
    architect: 'Design the architecture', worker: 'Implement the change',
    plan: 'Plan the work', 'knowledge-sync': 'Update project documentation',
    'review-task': 'Review the work', 'review-think': 'Review the proposed solution',
    'review-architecture': 'Review the architecture', 'review-implementation': 'Review implementation',
    'product-acceptance': 'Check the product against its goals',
    'designer-validation': 'Validate the implemented experience',
    'review-product': 'Review the finished product', 'critic-solution': 'Challenge the proposed solution',
    'critic-final': 'Challenge the finished product',
  };
  const roleLabels = { general:'Coordinator', user:'You', worker:'Implementation agent',
    designer:'Designer', specifier:'Behavior specialist', architect:'Architect', reviewer:'Reviewer',
    critic:'Critic', research:'Researcher', diagnostic:'Diagnostic agent', planner:'Planner',
    documenter:'Documentation agent', acceptance:'Acceptance agent' };
  function roleName(value) { return Object.hasOwn(roleLabels, value) ? roleLabels[value] : 'Agent'; }
  function named(value, fallback = '') {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const text = value.trim();
    if (/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24,}|ses_[a-z0-9]+)$/i.test(text)) return fallback;
    return text;
  }
  function pathName(value, fallback) {
    const parts = String(value || '').split(/[\\\\/]/).filter(Boolean);
    let leaf = parts.pop() || '';
    if (/^(anchor|index|readme)\\.md$/i.test(leaf)) leaf = parts.pop() || '';
    const text = named(leaf.replace(/\\.md$/i, ''), '').replace(/[_-]+/g, ' ');
    return text ? text[0].toUpperCase() + text.slice(1) : fallback;
  }
  function contextFor(p) {
    const c = p?.context;
    const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const text = (v) => object(v) && typeof v.text === 'string' && typeof v.truncated === 'boolean';
    const step = (v) => object(v) && typeof v.id === 'string' && typeof v.agent === 'string' &&
      typeof v.kind === 'string' && typeof v.status === 'string' && (v.label === undefined || typeof v.label === 'string') &&
      (v.reportedResult === undefined || text(v.reportedResult));
    if (!object(c) || c.version !== 1 || !Array.isArray(c.steps) || c.steps.length > 100 || !c.steps.every(step) ||
      !Array.isArray(c.questions) || c.questions.length > 24 || !c.questions.every((q) => object(q) && typeof q.id === 'string' && text(q.description) &&
        ['open','answered'].includes(q.status) && typeof q.requiredAuthority === 'string' && typeof q.blocking === 'boolean') ||
      !Array.isArray(c.verification) || c.verification.length > 24 || !c.verification.every((v) => object(v) && typeof v.id === 'string' && text(v.description) &&
        typeof v.kind === 'string' && typeof v.requestedBy === 'string' && (v.beforeStep === undefined || step(v.beforeStep))) ||
      !object(c.truncated) || !['steps','questions','verification'].every((key) => typeof c.truncated[key] === 'boolean') ||
      typeof c.questionCountIsLowerBound !== 'boolean' || (c.request !== undefined && !text(c.request)) ||
      (c.coordinatorSessionId !== undefined && typeof c.coordinatorSessionId !== 'string')) return undefined;
    return c;
  }
  function projectLabel(project) {
    return named(project.displayName) || pathName(project.canonicalLocation, 'Unnamed project');
  }
  function workflowBase(project, w) {
    const p = resolved(w);
    const objective = arr(project.workObjectives).find((o) => o.objectiveId === p?.workScope?.objectiveId &&
      o.consistency === 'ok' && o.projection?.generation === p?.workScope?.generation);
    if (objective) {
      const waves = arr(objective.projection?.phases).flatMap((phase) => arr(phase.waves));
      const tasks = waves.flatMap((wave) => arr(wave.tasks)).filter((task) => arr(p.workScope?.taskIds).includes(task.taskId));
      if (tasks.length === 1 && named(tasks[0].title)) return tasks[0].title;
      const wave = waves.find((candidate) => candidate.waveId === p.workScope?.waveId);
      if (named(wave?.title)) return wave.title;
      if (named(objective.projection?.title)) return objective.projection.title;
    }
    const request = named(contextFor(p)?.request?.text);
    if (request) return request.length > 120 ? request.slice(0, 120) + '…' : request;
    return pathName(p?.anchor, 'Unnamed workflow');
  }
  function workflowLabel(project, w) {
    const base = workflowBase(project, w);
    const same = project.workflows.filter((other) => workflowBase(project, other) === base).map((other) => other.workflowId).sort();
    return same.length > 1 ? base + ' · Run ' + (same.indexOf(w.workflowId) + 1) : base;
  }
  function stepName(step) {
    if (named(step?.label)) return step.label;
    if (Object.hasOwn(stepLabels, step?.id)) return stepLabels[step.id];
    if (step?.kind === 'gate') return 'Review by ' + roleName(step.agent);
    if (step?.agent === 'worker') return 'Implementation task';
    return step ? roleName(step.agent) + ' task' : 'Step details unavailable';
  }
  function stageName(p) {
    const steps = [...arr(p?.currentSteps), ...arr(p?.runnableSteps), ...arr(contextFor(p)?.steps)];
    const match = steps.find((s) => s.agent + ':' + s.id === p?.executionStage);
    return match ? stepName(match) : 'Stage details unavailable';
  }
  function sessionName(w, sessionId) {
    const p = resolved(w);
    const ids = arr(p?.participatingSessionIds).slice().sort();
    if (!ids.includes(sessionId)) return 'Session details unavailable';
    if (contextFor(p)?.coordinatorSessionId === sessionId) return 'Coordinator session';
    return 'Session ' + (ids.indexOf(sessionId) + 1);
  }
  function description(value) {
    return esc(value.text) + (value.truncated ? ' <span class="meta">(shortened; full text is in Loom)</span>' : '');
  }
  function technical(key, rows) {
    return '<details class="disclosure section" data-technical data-hierarchy-key="' + esc('technical:' + key) + '"><summary data-key="' + esc('technical:' + key) + '">Technical details</summary><dl class="facts panel-body">' + rows.filter(([, value]) => value !== undefined && value !== '').map(([label, value]) =>
      '<div class="fact"><dt>' + esc(label) + '</dt><dd class="mono">' + esc(value) + '</dd></div>').join('') + '</dl></details>';
  }
  function workflowTechnical(project, w, sessionId) {
    const p = resolved(w);
    return technical(project.projectId + ':' + w.workflowId + ':' + (sessionId || ''), [
      ['Project ID', project.projectId], ['Project location', project.canonicalLocation],
      ['Workflow ID', w.workflowId], ['Workflow revision', w.workflowRevision],
      ['Anchor reference', p?.anchor], ['Internal execution stage', p?.executionStage],
      ['Session ID', sessionId],
    ]);
  }
  function boundaryPanels(project, w) {
    const p = resolved(w);
    const c = contextFor(p);
    if (!c) return panel('Questions & checks', '<p class="notice">This publisher shares counts only, or its readable details are incompatible. Update and restart its Loom process to see question text, answer owners, and checks still needed. Missing details do not mean there is nothing to resolve.</p>');
    const key = project.projectId + ':' + w.workflowId;
    const questions = c.questions.map((q) => '<div class="row"><div class="name">' + description(q.description) + '</div><p>' +
      (q.status === 'answered' ? 'Answer recorded · affected steps still need to apply or acknowledge it.' : q.requiredAuthority === 'user' ? 'Awaiting your answer.' : 'Awaiting an answer from ' + esc(roleName(q.requiredAuthority)) + '.') + '</p><p class="meta">' +
      (q.blocking ? 'Marked blocking for affected steps; not necessarily the whole workflow.' : 'Not marked as a blocking question.') + '</p>' +
      technical(key + ':question:' + q.id, [['Question ID', q.id], ['Answer authority', q.requiredAuthority]]) + '</div>').join('');
    const requirements = c.verification.map((v) => '<div class="row"><div class="name">' + description(v.description) + '</div><p>Before: ' + esc(stepName(v.beforeStep)) + '</p><p class="meta">Requested by ' + esc(roleName(v.requestedBy)) + ' · ' + esc(({test:'Test evidence',build:'Build evidence',lint:'Code checks',security:'Security checks',runtime:'Runtime evidence',integration:'Integration evidence','product-acceptance':'Product acceptance evidence',other:'Supporting evidence'})[v.kind] || 'Supporting evidence') + '</p>' +
      technical(key + ':verification:' + v.id, [['Verification ID', v.id], ['Gate ID', v.beforeStep?.id]]) + '</div>').join('');
    const partial = (limited) => limited ? '<p class="notice section">Showing a limited selection, not the complete list. Inspect the remaining items in Loom.</p>' : '';
    return panel('Open questions', '<div class="list">' + (questions || '<p class="notice">' + (p.openOqCount === 0 && !c.questionCountIsLowerBound ? 'No unresolved questions recorded.' : 'Question details are not included in this snapshot.') + '</p>') + '</div>' + partial(c.truncated.questions)) +
      panel('Checks still needed', '<div class="list">' + (requirements || '<p class="notice">' + (p.openVerificationCount === 0 ? 'No open verification requirements recorded. This is not a claim that every test passed.' : 'Verification details are not included in this snapshot.') + '</p>') + '</div>' + partial(c.truncated.verification));
  }
`;
