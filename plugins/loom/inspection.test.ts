import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import loomPlugin from "./index"
import { observationsSupportKind } from "./evidence"
import { findPaths, grepText, selectText, statPaths } from "./inspection"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-inspection-"))
  roots.push(root)
  await mkdir(join(root, "docs", "reports"), { recursive: true })
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "docs", "reports", "b.md"), "beta\nProduct Acceptance: pending\nomega\n")
  await writeFile(join(root, "docs", "reports", "a.md"), "alpha\nProduct Acceptance: pass\nomega\n")
  await writeFile(join(root, "docs", "reports", "nested.txt"), "root\n")
  await mkdir(join(root, "docs", "reports", "nested"), { recursive: true })
  await writeFile(join(root, "docs", "reports", "nested", "deep.md"), "Product Acceptance: deep\n")
  await writeFile(
    join(root, "src", "results.log"),
    "case PASS 10\ncase FAIL 30\ncase FAIL 20\ncase FAIL 20\n",
  )
  return root
}

type RegisteredTool = {
  name: string
  input: any
  execute: (input: any, tool?: any) => Promise<{ content: string }>
}

async function pluginHarness(root: string) {
  const registered = new Map<string, RegisteredTool>()
  const toolHooks = new Map<string, (event: any) => any>()
  const storage = new Map<string, unknown>()

  const ctx: any = {
    location: {
      directory: root,
      project: { canonical: root },
    },
    rpc: {
      register: async () => {},
    },
    agent: {
      transform: async (fn: (editor: any) => any) => {
        await fn({
          get: () => undefined,
          default: () => {},
        })
      },
    },
    tool: {
      transform: async (fn: (editor: any) => any) => {
        await fn({
          namespace: () => {},
          add: (definition: RegisteredTool) => registered.set(definition.name, definition),
        })
      },
      hook: async (name: string, fn: (event: any) => any) => {
        toolHooks.set(name, fn)
      },
    },
    permission: {
      hook: async () => {},
    },
    session: {
      hook: async () => {},
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      scan: async () => [],
    },
  }

  await (loomPlugin as any).setup(ctx)
  return { registered, toolHooks, storage }
}

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true })
  }
})

describe("Loom structured inspection", () => {
  test("finds and sorts bounded paths without shell composition", async () => {
    const root = await fixture()
    const result = await findPaths(root, {
      path: "docs/reports",
      maxDepth: 1,
      type: "file",
      name: "*.md",
      sort: "path",
    })

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "docs/reports/a.md",
      "docs/reports/b.md",
    ])
    expect(result.matched).toBe(2)
  })

  test("grep searches literal text with glob and context", async () => {
    const root = await fixture()
    const result = await grepText(root, {
      path: "docs/reports",
      pattern: "product acceptance",
      glob: "*.md",
      caseSensitive: false,
      context: 1,
      maxDepth: 1,
      sort: "path",
    })

    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({
      path: "docs/reports/a.md",
      line: 2,
      text: "Product Acceptance: pass",
      before: ["alpha"],
      after: ["omega"],
    })
  })

  test("grep treats regex metacharacters as literal text", async () => {
    const root = await fixture()
    await writeFile(join(root, "src", "regex-looking.txt"), "(a+)+$\naaaaaaaa\n")

    const result = await grepText(root, {
      path: "src/regex-looking.txt",
      pattern: "(a+)+$",
    })

    expect(result.matched).toBe(1)
    expect(result.matches[0]?.text).toBe("(a+)+$")
  })

  test("grep searches the full logical line beyond 16 KiB", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "src", "long-line.txt"),
      "x".repeat(20_000) + "needle-after-16k" + "\n",
    )

    const result = await grepText(root, {
      path: "src/long-line.txt",
      pattern: "needle-after-16k",
    })

    expect(result.matched).toBe(1)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.line).toBe(1)
  })

  test("grep bounds retained results while still reporting total matches", async () => {
    const root = await fixture()
    const dense = Array.from({ length: 1_200 }, (_, index) => "needle " + (index + 1)).join("\n")
    await writeFile(join(root, "src", "dense.log"), dense)

    const result = await grepText(root, {
      path: "src/dense.log",
      pattern: "needle",
      sort: "line",
      order: "desc",
      limit: 50,
    })

    expect(result.matched).toBe(1_200)
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(50)
    expect(result.matches[0]?.line).toBe(1_200)
    expect(result.matches[49]?.line).toBe(1_151)
  })

  test("grep fails closed on oversized files instead of returning incomplete absence", async () => {
    const root = await fixture()
    const path = join(root, "src", "oversized.txt")
    await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1, 120))

    await expect(
      grepText(root, {
        path: "src/oversized.txt",
        pattern: "needle",
      }),
    ).rejects.toThrow("too large")

    await expect(
      statPaths(root, {
        paths: ["src/oversized.txt"],
        lineCount: true,
      }),
    ).rejects.toThrow("too large")
  })

  test("grep fails closed when the total search byte budget would be exceeded", async () => {
    const root = await fixture()
    const budgetDir = join(root, "budget")
    await mkdir(budgetDir)
    const block = Buffer.alloc(2 * 1024 * 1024, 120)

    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(budgetDir, "part-" + index + ".txt"), block)
    }

    await expect(
      grepText(root, {
        path: "budget",
        pattern: "needle",
      }),
    ).rejects.toThrow("byte budget exceeded")
  })

  test("select rejects an empty custom delimiter before field expansion", async () => {
    const root = await fixture()

    await expect(
      selectText(root, {
        path: "src/results.log",
        delimiter: "",
      }),
    ).rejects.toThrow("must not be empty")
  })

  test("select rejects rows with more than 256 fields", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "src", "too-many-fields.csv"),
      Array.from({ length: 257 }, (_, index) => String(index)).join(",") + "\n",
    )

    await expect(
      selectText(root, {
        path: "src/too-many-fields.csv",
        delimiter: "comma",
      }),
    ).rejects.toThrow("too many fields")
  })

  test("select rejects excessive row work before building an unbounded row graph", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "src", "too-many-rows.log"),
      Array.from({ length: 20_001 }, () => "x").join("\n"),
    )

    await expect(
      selectText(root, {
        path: "src/too-many-rows.log",
      }),
    ).rejects.toThrow("too many rows")
  })

  test("select filters, projects, sorts, and deduplicates fields", async () => {
    const root = await fixture()
    const result = await selectText(root, {
      path: "src/results.log",
      where: { field: 2, op: "eq", value: "FAIL" },
      fields: [2, 3],
      sort: { field: 3, order: "desc", numeric: true },
      unique: true,
    })

    expect(result.rows.map((row) => row.fields)).toEqual([
      ["FAIL", "30"],
      ["FAIL", "20"],
    ])
    expect(result.matched).toBe(2)
  })

  test("select supports tail-style bounded output", async () => {
    const root = await fixture()
    const result = await selectText(root, {
      path: "src/results.log",
      fields: [2, 3],
      from: "end",
      limit: 2,
    })

    expect(result.rows.map((row) => row.fields)).toEqual([
      ["FAIL", "20"],
      ["FAIL", "20"],
    ])
  })

  test("stats reports bytes and optional line counts", async () => {
    const root = await fixture()
    const result = await statPaths(root, {
      paths: ["docs/reports/a.md", "src/results.log"],
      lineCount: true,
    })

    expect(result.count).toBe(2)
    expect(result.totalBytes).toBeGreaterThan(0)
    const linesByPath = new Map(result.entries.map((entry) => [entry.path, entry.lines]))
    expect(linesByPath.get("docs/reports/a.md")).toBe(3)
    expect(linesByPath.get("src/results.log")).toBe(4)
    expect(result.totalLines).toBe(7)
  })

  test("rejects lexical path escape", async () => {
    const root = await fixture()
    await expect(findPaths(root, { path: "../outside" })).rejects.toThrow(
      "must stay inside the project",
    )
  })

  test("rejects symlinks that resolve outside the project", async () => {
    const root = await fixture()
    const outside = await mkdtemp(join(tmpdir(), "loom-inspection-outside-"))
    roots.push(outside)
    await writeFile(join(outside, "secret.txt"), "secret\n")
    await symlink(join(outside, "secret.txt"), join(root, "outside-link"))

    await expect(grepText(root, { path: "outside-link", pattern: "secret" })).rejects.toThrow(
      "resolves outside the project",
    )
  })

  test("caps find output when more than 500 entries match", async () => {
    const root = await fixture()
    const many = join(root, "many")
    await mkdir(many)
    await Promise.all(
      Array.from({ length: 520 }, (_, index) =>
        writeFile(join(many, "entry-" + String(index).padStart(3, "0") + ".txt"), "x\n"),
      ),
    )

    const result = await findPaths(root, {
      path: "many",
      maxDepth: 1,
      type: "file",
      limit: 10_000,
    })

    expect(result.matched).toBe(520)
    expect(result.truncated).toBe(true)
    expect(result.entries).toHaveLength(500)
  })

  test("plugin registers all inspection tools and executes them through the real registration boundary", async () => {
    const root = await fixture()
    const { registered } = await pluginHarness(root)

    for (const name of ["find", "grep", "select", "stats"]) {
      expect(registered.has(name)).toBe(true)
    }

    const grepTool = registered.get("grep")!
    expect(grepTool.input.properties.regex).toBeUndefined()

    const result = await grepTool.execute(
      {
        path: "docs/reports",
        pattern: "Product Acceptance",
        glob: "*.md",
        maxDepth: 1,
        sort: "path",
      },
      { agent: "reviewer", sessionID: "session-integration" },
    )

    expect(result.content).toContain("docs/reports/a.md")
    expect(result.content).toContain("docs/reports/b.md")
  })

  test("failed inspection stays failed and cannot support a success claim", async () => {
    const root = await fixture()
    const { registered, toolHooks, storage } = await pluginHarness(root)
    const before = toolHooks.get("execute.before")!
    const after = toolHooks.get("execute.after")!
    const input = { path: "../outside" }

    await before({
      tool: "loom_find",
      callID: "call-failed-find",
      sessionID: "session-failed-evidence",
      input,
    })

    let failure: unknown
    try {
      await registered.get("find")!.execute(input, {
        agent: "reviewer",
        sessionID: "session-failed-evidence",
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)

    await after({
      tool: "loom_find",
      callID: "call-failed-find",
      sessionID: "session-failed-evidence",
      agent: "reviewer",
      status: "error",
      error: failure,
    })

    const observations = [...storage.values()].filter(
      (value: any) => value && typeof value === "object" && value.tool === "loom_find",
    ) as any[]

    expect(observations).toHaveLength(1)
    expect(observations[0].status).toBe("error")
    expect(observationsSupportKind("runtime", observations)).toBe(false)
    expect(observationsSupportKind("integration", observations)).toBe(false)
    expect(observationsSupportKind("product-acceptance", observations)).toBe(false)
    expect(observationsSupportKind("other", observations)).toBe(false)
  })

  test("inspection tool calls are captured as Loom evidence while control tools stay excluded", async () => {
    const root = await fixture()
    const { registered, toolHooks, storage } = await pluginHarness(root)
    const before = toolHooks.get("execute.before")!
    const after = toolHooks.get("execute.after")!

    const input = { path: "docs/reports", maxDepth: 1, type: "file", sort: "path" }
    await before({
      tool: "loom_find",
      callID: "call-find",
      sessionID: "session-evidence",
      input,
    })
    const result = await registered.get("find")!.execute(input, {
      agent: "reviewer",
      sessionID: "session-evidence",
    })
    await after({
      tool: "loom_find",
      callID: "call-find",
      sessionID: "session-evidence",
      agent: "reviewer",
      status: "completed",
      result: result.content,
    })

    const observations = [...storage.values()].filter(
      (value: any) => value && typeof value === "object" && value.tool === "loom_find",
    ) as any[]
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      sessionID: "session-evidence",
      agent: "reviewer",
      tool: "loom_find",
      status: "completed",
      path: "docs/reports",
    })

    const beforeControlCount = [...storage.values()].filter(
      (value: any) => value && typeof value === "object" && value.tool === "loom_status",
    ).length

    await after({
      tool: "loom_status",
      callID: "call-status",
      sessionID: "session-evidence",
      agent: "reviewer",
      status: "completed",
      result: "status",
    })

    const afterControlCount = [...storage.values()].filter(
      (value: any) => value && typeof value === "object" && value.tool === "loom_status",
    ).length
    expect(afterControlCount).toBe(beforeControlCount)
  })
})
