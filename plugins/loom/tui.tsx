/** @jsxImportSource @opentui/solid */

import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { LoomRpc, type LoomSidebarSnapshot, type LoomSidebarTaskStatus } from "./rpc"
import { selectSidebarTasks } from "./sidebar"

const MAX_PLAN_ROWS = 12

function taskGlyph(status: LoomSidebarTaskStatus) {
  if (status === "complete") return "✓"
  if (status === "failed") return "!"
  if (status === "runnable") return "→"
  return "○"
}

function LoomSidebar(props: { sessionID?: string }) {
  const context = usePlugin()
  const rpc = context.client.rpc(LoomRpc)
  const [snapshot, setSnapshot] = createSignal<LoomSidebarSnapshot>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  const refresh = async () => {
    const sessionID = props.sessionID
    if (!sessionID) {
      setSnapshot(undefined)
      return
    }

    const current = ++generation
    try {
      const next = await rpc.sidebar({ sessionID }) as LoomSidebarSnapshot
      if (current === generation) setSnapshot(next)
    } catch {
      if (current === generation) setSnapshot(undefined)
    }
  }

  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void refresh(), 150)
  }

  createEffect(() => {
    props.sessionID
    void refresh()
  })

  const stop = context.data.listen(() => scheduleRefresh())

  onCleanup(() => {
    stop()
    if (timer) clearTimeout(timer)
  })

  return (
    <Show when={snapshot()?.active}>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={context.theme.text.base}>Loom</text>
        <text>
          {snapshot()!.state} · {snapshot()!.progress.finished}/{snapshot()!.progress.total}
        </text>

        <Show when={snapshot()!.tasks.length > 0}>
          <box flexDirection="column" gap={0} paddingTop={1}>
            <text fg={context.theme.text.base}>Plan</text>
            <For each={selectSidebarTasks(snapshot()!.tasks, MAX_PLAN_ROWS)}>
              {(task) => (
                <text>
                  {taskGlyph(task.status)} {task.title}
                </text>
              )}
            </For>
            <Show when={snapshot()!.tasks.length > selectSidebarTasks(snapshot()!.tasks, MAX_PLAN_ROWS).length}>
              <text>… +{snapshot()!.tasks.length - selectSidebarTasks(snapshot()!.tasks, MAX_PLAN_ROWS).length} more</text>
            </Show>
          </box>
        </Show>

        <Show when={snapshot()!.now.some((step) => !step.id.startsWith("task:"))}>
          <box flexDirection="column" gap={0} paddingTop={1}>
            <text fg={context.theme.text.base}>Now</text>
            <For each={snapshot()!.now.filter((step) => !step.id.startsWith("task:"))}>
              {(step) => <text>→ {step.label}</text>}
            </For>
          </box>
        </Show>

        <Show when={snapshot()!.openQuestions > 0 || snapshot()!.openVerification > 0}>
          <box flexDirection="column" gap={0} paddingTop={1}>
            <Show when={snapshot()!.openQuestions > 0}>
              <text>OQs: {snapshot()!.openQuestions}</text>
            </Show>
            <Show when={snapshot()!.openVerification > 0}>
              <text>Verification: {snapshot()!.openVerification} open</text>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "loom.tui",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <LoomSidebar sessionID={sessionID} />,
    })
  },
})
