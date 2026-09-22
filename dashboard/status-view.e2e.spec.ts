import { expect, test } from "@playwright/test"
import { renderStatusHtml, type StatusView } from "../plugins/loom/status-view"

function view(): StatusView {
  return {
    workflowId: "wf-browser",
    state: "active",
    progress: { finished: 2, total: 5, failed: 0 },
    now: [{ step: "task:api", agent: "worker", kind: "work" }],
    recent: [],
    upcoming: [],
    questions: { open: 0, routes: [], reconcile: [] },
    verification: { open: [], satisfied: 1 },
    budget: { dispatches: 3, maxDispatches: 20 },
    acceptance: null,
    knowledge: { valid: true },
    work: {
      version: 2,
      nextRunnableWaves: [],
      tree: {
        objective: { id: "objective:browser", title: "Browser validation", status: "active", progress: { finished: 1, total: 3 } },
        generation: 1,
        phases: [{
          id: "phase-1",
          title: "Implementation",
          status: "active",
          progress: { finished: 1, total: 3 },
          waves: [
            {
              id: "wave-active",
              title: "Active wave",
              status: "active",
              progress: { finished: 0, total: 2 },
              tasks: [
                { id: "api", title: "Implement API", status: "pending" },
                { id: "later", title: "Later task", status: "pending" },
              ],
            },
            {
              id: "wave-done",
              title: "Completed wave",
              status: "complete",
              progress: { finished: 1, total: 1 },
              tasks: [{ id: "done", title: "Completed task", status: "complete" }],
            },
          ],
        }],
      },
    },
  }
}

test("workflow status artifact supports keyboard-native expansion and filtering", async ({ page }) => {
  await page.setContent(renderStatusHtml(view()))

  await expect(page.getByRole("heading", { name: "Loom workflow status" })).toBeVisible()
  await expect(page.getByText("Implement API", { exact: true })).toBeVisible()
  await expect(page.locator("details.wave").first()).toHaveAttribute("open", "")

  await page.getByRole("button", { name: "Collapse all" }).click()
  await expect(page.locator("details.wave").first()).not.toHaveAttribute("open", "")

  await page.getByRole("button", { name: "Expand all" }).click()
  await expect(page.locator("details.wave").first()).toHaveAttribute("open", "")

  await page.getByLabel("Search work").fill("Completed task")
  await expect(page.getByText("Completed task", { exact: true })).toBeVisible()
  await expect(page.getByText("Implement API", { exact: true })).not.toBeVisible()
  await expect(page.getByRole("status")).toContainText("1 visible task")

  await page.getByLabel("Search work").fill("Implementation")
  await expect(page.getByText("Implement API", { exact: true })).toBeVisible()
  await expect(page.getByText("Later task", { exact: true })).toBeVisible()
  await expect(page.getByText("Completed task", { exact: true })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("3 visible tasks")

  await page.getByLabel("Search work").fill("")
  await page.getByLabel("Status").selectOption("runnable")
  await expect(page.getByText("Implement API", { exact: true })).toBeVisible()
  await expect(page.getByText("Later task", { exact: true })).not.toBeVisible()
})
