/** Test oracle only. Observe raw provider entry before scripted completion guards.
 * Counts requests and repeated actionable user inputs, not just successful writes.
 * A terminal scripted response is not a general proof of successful host consumption.
 */
export function observeRequest(state, role, prompt) {
  const view = state.request_oracle ??= { counts: {}, terminal: {}, violations: [] }
  view.counts[role] = (view.counts[role] ?? 0) + 1
  if (view.terminal[role]) {
    view.violations.push({ kind: 'request-after-terminal', role, request: view.counts[role] })
  }
  // Repeated history across successive requests is normal. Repeated actionable
  // inputs within ONE request are not; don't count copies quoted by tools/agents.
  const current = new Map()
  for (const message of prompt ?? []) {
    if (message.role !== 'user') continue
    const text = typeof message.content === 'string' ? message.content
      : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const pattern = /(?:Answer recorded for question |Answer ready for assignment |Native continuation for assignment |Assignment )([^\s]+)(?: reports completion\.)?/g
    for (const match of text.matchAll(pattern)) {
      const key = match[0]
      const count = (current.get(key) ?? 0) + 1
      current.set(key, count)
      if (count === 2 && !view.violations.some(v => v.kind === 'duplicate-actionable-input' && v.role === role && v.key === key)) {
        view.violations.push({ kind: 'duplicate-actionable-input', role, key })
      }
    }
  }
  return view
}

export function observeResponse(state, role, response) {
  const view = state.request_oracle ??= { counts: {}, terminal: {}, violations: [] }
  if (response.text?.startsWith('WORKER_FINISHED completion=') || response.text === 'PRIMARY_COORDINATION_FINISHED') {
    view.terminal[role] = true
  }
}

/** Missing IDs must not turn an answer-thread read into a completion receipt. */
export function isCompletionRead(input, completion) {
  return typeof completion?.id === 'string' && completion.id.length > 0
    && input.operation === 'query' && input.record_id === completion.id
}
