import { expect, test } from "bun:test"
import { canonical, digest } from "../src/model.js"
import { retrospectiveSourceView, renderRetrospectiveSourceHTML, renderRetrospectiveSourceMarkdown } from "../src/retrospective-source-view.js"

test("bounded original fragments reconstruct the exact canonical value including Unicode", () => {
  const value = { text: "å💡 <script>never execute</script> ```".repeat(200), outcome: "failure" }
  const original = { population_id: "population", manifest_sha256: "f".repeat(64), member_key: "member",
    source: { sha256: digest(value) }, status: "available", value }
  let offset = 0, reconstructed = "", count = 0
  for (;;) {
    const page = retrospectiveSourceView(original, { source_offset: offset, source_limit: 79 })
    expect(page.representation).toBe("original-owner-view-fragment")
    expect("value" in page).toBe(false)
    if (!("content_json" in page)) throw new Error("Expected bounded original fragment")
    reconstructed += page.content_json
    expect(page.coverage.whole_original_returned).toBe(false)
    expect(page.coverage.from).toBe(offset)
    count++
    if (!page.navigation.next) break
    expect(page.navigation.next.member_key).toBe(original.member_key)
    expect(page.navigation.next.manifest_sha256).toBe(original.manifest_sha256)
    offset = page.navigation.next.source_offset
  }
  expect(count).toBeGreaterThan(2)
  expect(reconstructed).toBe(canonical(value))
  expect(JSON.parse(reconstructed)).toEqual(value)
  expect(digest(JSON.parse(reconstructed))).toBe(original.source.sha256)
})

test("source fragments reject wrong offsets and never present a gap as empty original content", () => {
  const value = { text: "💡" }
  const original = { status: "available", value, source: { sha256: digest(value) } }
  const encoded = canonical(value), split = encoded.indexOf("💡") + 1
  for (const source_offset of [-1, split, encoded.length, Number.MAX_SAFE_INTEGER])
    expect(() => retrospectiveSourceView(original, { source_offset })).toThrow()
  const gap = retrospectiveSourceView({ status: "changed", gap: { code: "original-changed" } }, {})
  expect(gap.representation).toBe("unavailable")
  expect("value" in gap).toBe(false)
  expect("content_json" in gap).toBe(false)
})

test("source document presentations retain the exact view and render hostile evidence inertly", () => {
  const value = { text: "```\n<script>alert('evidence')</script>\n```" }
  const view = retrospectiveSourceView({ status: "available", value, source: { sha256: digest(value) } }, {})
  expect(view).toMatchObject({ value, representation: "original-owner-view", coverage: { whole_original_returned: true } })
  const markdown = renderRetrospectiveSourceMarkdown(view), html = renderRetrospectiveSourceHTML(view)
  expect(markdown).toContain("````json")
  expect(markdown).toContain(JSON.stringify(view, null, 2))
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script")
  expect(html).toContain("default-src 'none'")
  expect(html).toContain(digest(value))
})

test("trusted preview and incremental read requests survive exact-source fragmentation", () => {
  for (const request of [{ operation: "preview-source", selection: { target: { kind: "session", id: "ordinary" } }, preview_sha256: "a".repeat(64), member_key: "source" },
    { operation: "learning-source", batch_id: "earlier", member_key: "retained-source", source_index: 0 }]) {
    const value = { text: "recorded original".repeat(50) }
    const page = retrospectiveSourceView({ status: "available", value, source: { sha256: digest(value) }, read_request: request }, { source_limit: 30 })
    expect(page.navigation.next).toEqual({ ...request, source_offset: 30, source_limit: 30 })
    expect(page.navigation.next).not.toHaveProperty("population_id")
  }
})
