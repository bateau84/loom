import { describe, expect, test } from "bun:test"
import {
  acceptIntent,
  askIntentQuestion,
  prepareIntentDraft,
  resolveIntentQuestion,
  startIntent,
} from "./intent"

describe("Loom intent interview", () => {
  test("asks only one unresolved user question at a time", () => {
    const session = startIntent("I want a carpet", "now")
    askIntentQuestion({
      session,
      branch: "purpose",
      question: "What should the carpet optimize for?",
      recommendation: "Comfort and durability.",
      why: "Those choices drive later trade-offs.",
      now: "now",
    })

    expect(() =>
      askIntentQuestion({
        session,
        branch: "style",
        question: "Which style?",
        recommendation: "Neutral.",
        why: "Broad fit.",
        now: "later",
      }),
    ).toThrow()
  })

  test("repository/research resolutions require evidence", () => {
    const session = startIntent("Improve this app", "now")
    askIntentQuestion({
      session,
      branch: "existing-behavior",
      question: "Does the current app already preserve history?",
      recommendation: "Inspect before asking the user.",
      why: "The repository can answer it.",
      now: "now",
    })

    expect(() =>
      resolveIntentQuestion({
        session,
        resolution: "Yes",
        source: "repository",
        now: "later",
      }),
    ).toThrow()

    resolveIntentQuestion({
      session,
      resolution: "Yes",
      source: "repository",
      evidence: ["docs/system/data.md"],
      now: "later",
    })
    expect(session.decisions[0]?.source).toBe("repository")
  })

  test("draft requires goal success scope and exclusions", () => {
    const session = startIntent("Build music discovery", "now")

    expect(() =>
      prepareIntentDraft({
        session,
        goal: "Find music",
        success: [],
        scope: ["web app"],
        exclusions: ["no autonomous unsubscribe"],
        userOwned: [],
        context: [],
        now: "later",
      }),
    ).toThrow()
  })

  test("accepted Anchor is an explicit state transition", () => {
    const session = startIntent("Build music discovery", "now")
    prepareIntentDraft({
      session,
      goal: "Discover music from subscribed YouTube channels.",
      success: ["New qualifying videos reach configured playlists."],
      scope: ["single-user web application"],
      exclusions: ["no autonomous subscription removal"],
      userOwned: ["subjective routing policy"],
      context: ["existing historical corpus should be preserved"],
      now: "later",
    })

    const accepted = acceptIntent({
      session,
      anchorPath: "docs/anchors/yuhaul/anchor.md",
      now: "accepted",
    })

    expect(session.state).toBe("accepted")
    expect(accepted.path).toBe("docs/anchors/yuhaul/anchor.md")
  })
})
