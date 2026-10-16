# Native re-delegation comparison

## Reviewed baseline

The user reports that Reviewer and Critic independently reproduced the 17 selector
tests and all six installed-host cases at `925a79f`. That closes independent review
of the **narrow feasibility result**, not production readiness. The earlier
experiment stays as a comparison control.

## Independent comparison review completed

The user subsequently reports that independent review **passes `c2db6e7`** with
no additional material defect within its declared scope. Reviewer personally
verified 29/29 focused tests, all 12 real-host scenarios, and all 100 supplied CI
artifact files byte-for-byte. The review confirms reuse of the same Worker Session
and original `work_ref`, authoritative retrieval, native completion return, and no
direct Worker synthetic continuation or Loom completion nudge in the native path.

The second-yield negative control reproduces a stall; its PASS is not recovery.
The improved duplicate checks detect extra continuations, not prevent them.
The next-action endpoint is still a coordinating ledger write, not practical
live-model usefulness or production readiness. These review facts are recorded
from the user's report; this documentation update does not claim another review
run or independently recovered Reviewer transcript.

Use [primary-first coordination](coordination.md) as the next implementation
candidate. Preserve this experiment and its direct-bridge controls rather than
transplanting the selector. Durable answer delivery, uncertain admission recovery,
cancellation, assignment routing and broader background/replay coverage remain open.

Four findings remain in its selector/provider: sticky native ownership without
sufficient assignment/primary/generation scope; `resumed` saved before native
admission; work-reference comparison depending on JSON property order; and
scripted no-op guards that can hide extra actionable continuations. This change
does not transplant or repair that selector. Characterization tests make three of
those existing defects explicit; raw-request checks address the fourth test gap.

## Compare two return paths

The direct path resumes Worker and then uses the experimental completion bridge.
The alternative sends the answer reference to the **original primary Session**.
Primary retrieves the authoritative thread and invokes native `subagent` with the
**same Worker Session**. Worker retrieves the thread, reports completion for its
retained work reference and returns through the native call. Primary then reads
the actual completion and records its next coordinating action.

The alternative sends no direct Worker synthetic input and no Loom completion
nudge. It does not call `resumeAfterAnswer`, `offer` or `beginSend` for its transport.
The unchanged selector is still present for identity/control traces, not used to
choose this alternative's answer destination or native return.

An answer remains a response, not approval or independently verified completion.
The successful reviewed result does not make best-effort answer-to-primary
sending a durable retry implementation. It still needs an assignment association, a saved
answer-delivery intent, safe handling of ambiguous admission and cancellation.

## Cases and pass conditions

Run the original six cases unchanged in intent, then `--comparison`:

| Case | Expected observation |
| --- | --- |
| `primary-redelegate` | Exact primary receives answer, retrieves it and re-delegates natively; no Loom completion nudge; one coordinating write. |
| `native-yielded-bridge` | A newer native **foreground** generation also yields before the answer; sticky selector suppresses the late handback. This is an explicit negative control, not a recovered task. |
| `native-yielded-redelegate` | Same pre-answer yield; the answer goes to Primary and a fresh native delegation owns the completion return. |
| `primary-redelegate-restart` | Managed host restart before answer release; native recovery restores Research, then the alternative completes without another user prompt. |
| `duplicate-worker` | After the normal bridge round trip settles, inject a second actionable answer input. Raw Worker request check must detect it even though the provider guard prevents another completion write. |
| `duplicate-primary` | After normal settlement, inject a second completion input. Raw Primary request check must detect it despite unchanged coordinating-write counts. |

The pre-answer yielded-generation cases use a foreground native call to make its
return and release visible. They do not establish every background-generation or
external-client ownership race. The existing `native-covered` case still covers a
background native generation that remains active until the answer arrives.

Every ordinary case requires the original delegation returned and Primary idle
before the answer. In the yielded cases the newer call must also have returned
`completed` without an answer or assignment completion, with Worker idle. Research
is kept active so its unrelated native notification cannot mask a missing return.
Only the initial user prompt is submitted. Test barrier release is not a prompt.

Positive alternative cases check the exact parent/child Session IDs and observed
native-call identity, one post-answer re-delegation, a completed native return,
full-thread reads by Primary and Worker, and the authoritative completion read
before the coordinating write. These checks do not infer work completion from a
native run ending. The failure control must finish Worker while leaving Primary
without a coordinating write during the observation window.

## Duplicate checks independent of script guards

`request-oracle.mjs` records **provider entry before the state-dependent script**.
It flags a new Worker/Primary request after that role's terminal response and
multiple actionable notice texts within one prepared user-message history.
Repeating history across normal tool steps is not counted as another delivery;
copies in tool and assistant messages are not new actionable inputs.

The oracle observes; it does not block requests. The counterchecks must run the
extra model step while the old write guards still leave one completion and one
coordinating write. A timeout, failed provider or unchanged write count alone is
not a detected countercheck. Their PASS means the intentional duplicate was
**detected**, not that duplicate execution is acceptable or prevented.

Raw requests, scripted responses, full callback results and call-start/return
traces are retained. Observed counts are evidence for these runs, not a universal
exactly-once guarantee. Terminal scripted output is also not a receipt proving a
successful model request consumed it. No production module, tool, dependency,
permission, scheduler or host implementation is changed.

## Running

```sh
node --test tests/handback-experiment.test.mjs tests/handback-comparison.test.mjs
python3 tests/installed_handback_experiment.py --comparison \
  --opencode /path/to/exact-2.0.29/opencode --report-directory /new/report/path
```

The installed CI runs both scenario groups and retains both reports. Interpret
results at the tested commit; design expectations in this document are not test
results. Live-model behavior and production transport/recovery remain separate.
