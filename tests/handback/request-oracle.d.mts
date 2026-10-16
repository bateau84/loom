export type RequestOracle = {
  counts: Record<string, number>
  terminal: Record<string, boolean>
  violations: Array<{kind: string; role: string; request?: number; key?: string}>
}
type State = {request_oracle?: RequestOracle}
type Prompt = Array<{role: string; content: string | Array<{type: string; text?: string}>}>
export function observeRequest(state: State, role: string, prompt: Prompt): RequestOracle
export function observeResponse(state: State, role: string, response: {text?: string}): void
export function isCompletionRead(input: {operation?: unknown; record_id?: unknown}, completion?: {id?: unknown}): boolean
