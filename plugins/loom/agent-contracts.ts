import { readFile } from "node:fs/promises"

// Optional Loom policy: it is NOT present in the portable agents/*.md.
export const LOOM_AGENT_ROLES = [
  "acceptance",
  "architect",
  "brainstorm",
  "critic",
  "designer",
  "diagnostic",
  "documenter",
  "general",
  "planner",
  "research",
  "reviewer",
  "specifier",
  "worker"
] as const
export type LoomAgentRole = (typeof LOOM_AGENT_ROLES)[number]
export const LOOM_ROLE_PERMISSIONS = {
  "acceptance": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/acceptance/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "architect": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/architecture/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/dependencies/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/architect/commit-messages/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "brainstorm": [
    {
      "action": "shell",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "critic": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/critic/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "designer": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/design/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/designer/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "diagnostic": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/diagnostic/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "documenter": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/system/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/user/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "README.md",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/documenter/commit-messages/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git add *",
      "effect": "allow"
    },
    {
      "action": "shell",
      "resource": "git -c core.hooksPath=/dev/null commit *",
      "effect": "allow"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "general": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/anchors/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/general/**",
      "effect": "allow"
    },
    {
      "action": "question",
      "resource": "*",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "designer",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "specifier",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "architect",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "reviewer",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "critic",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "worker",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "acceptance",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "planner",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "brainstorm",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "research",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "diagnostic",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "documenter",
      "effect": "allow"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "planner": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "research": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/research/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "reviewer": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/reviewer/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/requirements/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/design/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/architecture/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "specifier": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/requirements/**",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "ephemeral-reports/specifier/commit-messages/**",
      "effect": "allow"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ],
  "worker": [
    {
      "action": "edit",
      "resource": "*",
      "effect": "allow"
    },
    {
      "action": "edit",
      "resource": "docs/anchors/**",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/requirements/**",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/design/**",
      "effect": "deny"
    },
    {
      "action": "edit",
      "resource": "docs/architecture/**",
      "effect": "deny"
    },
    {
      "action": "subagent",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "external_directory",
      "resource": "*",
      "effect": "deny"
    },
    {
      "action": "shell",
      "resource": "git *",
      "effect": "ask"
    }
  ]
} as const

// Load during plugin setup; missing/empty contracts must fail closed rather than
// silently running a partially governed Loom session.
export async function loadLoomAgentContracts(root: URL = new URL("./contracts/", import.meta.url)) {
  const shared = (await readFile(new URL("shared.md", root), "utf8")).trim()
  if (!shared) throw new Error("Loom shared runtime contract is empty.")
  const parts = await Promise.all(LOOM_AGENT_ROLES.map(async role => {
    const specific = (await readFile(new URL(`${role}.md`, root), "utf8")).trim()
    if (!specific) throw new Error(`Loom runtime contract is empty for ${role}.`)
    return [role, `${shared}\n\n${specific}`] as const
  }))
  return new Map<string, string>([["*", shared], ...parts])
}
