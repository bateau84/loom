"""Bounded native receipt interpretation for installed_native_review.py.

This reads observations; it never creates native identities, authorization,
admission links, or evidence of model comprehension. Unit inputs are not receipts.
"""
from __future__ import annotations


def source_basis(observed: list[dict], session: str, path: str, content: str) -> dict:
    # The caller owns synthetic source bytes. Presence is checked in the actual
    # observed boundary, never in a citation, a filename, or a context-hook claim.
    supplied, retrieved = [], []
    for index, event in enumerate(observed):
        data = event.get("data", {})
        if event.get("type") == "provider-request" \
                and data.get("headers", {}).get("x-opencode-session-id") == session \
                and content and any(content in text for text in provider_text(data.get("prompt"))):
            supplied.append(index + 1)
        if event.get("type") == "tool-after" and data.get("sessionID") == session \
                and data.get("tool") == "read" and data.get("status") == "completed" \
                and data.get("input", {}).get("path") == path and call_key(data) is not None \
                and content and any(content in text for text in text_parts(data.get("result", {}).get("content"))):
            retrieved.append({"receipt": index + 1, "call": list(call_key(data))})
    return {"supplied": supplied, "retrieved": retrieved, "same_review_invocation": "UNQUALIFIED"}


def text_parts(parts) -> list[str]:
    if isinstance(parts, str):
        return [parts]
    if not isinstance(parts, list):
        return []
    return [part["text"] for part in parts if isinstance(part, dict) and part.get("type") == "text"
            and isinstance(part.get("text"), str)]


def provider_text(prompt) -> list[str]:
    """Known AI SDK text boundaries only; metadata/tool arguments are not evidence supply."""
    found = []
    for message in prompt if isinstance(prompt, list) else []:
        if not isinstance(message, dict):
            continue
        parts = message.get("content")
        # A reviewer's own assistant assertions are never a source-delivery receipt.
        if message.get("role") in ("user", "system"):
            found.extend(text_parts(parts))
        if message.get("role") == "tool" and isinstance(parts, list):
            for part in parts:
                if not isinstance(part, dict):
                    continue
                output = part.get("output", {})
                if part.get("type") == "tool-result" and isinstance(output, dict) and output.get("type") == "text" and isinstance(output.get("value"), str):
                    found.append(output["value"])
    return found


def call_key(data: dict) -> tuple[str, str, str] | None:
    values = tuple(data.get(name) for name in ("sessionID", "messageID", "id"))
    return values if all(isinstance(value, str) and value for value in values) else None


def dispatch_receipts(observed: list[dict]) -> list[dict]:
    receipts = []
    # Fixture-local continuity only: these markers are neither native epochs
    # nor proof of restart. A markerless slice cannot establish this boundary.
    ready_receipts = []
    ready = None
    for index, event in enumerate(observed):
        if event.get("type") == "ready":
            ready = index + 1
        elif event.get("type") == "observer-failure":
            ready = None
        ready_receipts.append(ready)
    for index, event in enumerate(observed):
        data = event.get("data", {})
        if event.get("type") != "tool-before" or data.get("tool") != "subagent":
            continue
        key = call_key(data)
        ends = [(i, e["data"]) for i, e in enumerate(observed)
                if e.get("type") == "tool-after" and e.get("data", {}).get("tool") == "subagent"
                and call_key(e["data"]) == key]
        starts = [e for e in observed if e.get("type") == "tool-before"
                  and e.get("data", {}).get("tool") == "subagent" and call_key(e["data"]) == key]
        children = set()
        progress = []
        for i, item in enumerate(observed):
            if item.get("type") != "native-event":
                continue
            native = item.get("data", {})
            value = native.get("data", {})
            if native.get("type") == "session.tool.progress" \
                    and ready_receipts[index] is not None and ready_receipts[i] == ready_receipts[index] \
                    and key == (value.get("sessionID"), value.get("assistantMessageID"), value.get("id")):
                child = value.get("metadata", {}).get("sessionID")
                if isinstance(child, str) and child:
                    children.add(child)
                    progress.append(i + 1)
        for _, end in ends:
            result = end.get("result", {})
            for part in ("output", "metadata"):
                value = result.get(part, {}) if isinstance(result, dict) else {}
                child = value.get("sessionID") if isinstance(value, dict) else None
                if isinstance(child, str) and child:
                    children.add(child)
        # The awaited before hook precedes execution and progress publication.
        # The separate native-event consumer may deliver progress after after;
        # there is deliberately no progress-before-return requirement.
        reason = ("missing-native-key" if key is None else
                  "missing-observer-continuity" if ready_receipts[index] is None
                      or any(ready_receipts[i] != ready_receipts[index] for i, _ in ends) else
                  "reused-native-key" if len(starts) != 1 or len(ends) > 1 else
                  "reversed-hook-order" if any(i <= index for i, _ in ends) else
                  "reversed-progress-order" if any(i <= index + 1 for i in progress) else
                  "actor-or-input-conflict" if any(end.get("agent") != data.get("agent")
                      or end.get("input") != data.get("input") for _, end in ends) else
                  "conflicting-child" if len(children) > 1 else
                  "missing-child-observation" if not children else None)
        child = next(iter(children)) if reason is None else None
        receipts.append({"parent": list(key) if key else None,
                         "binding": "observed" if reason is None else "unknown" if reason.startswith("missing") else "ambiguous",
                         "child_session_id": child, "reason": reason, "admission_binding": "UNQUALIFIED",
                         "observer_ready_receipt": ready_receipts[index],
                         "before_receipt": index + 1,
                         "after_receipts": [i + 1 for i, _ in ends], "progress_receipts": progress})
    return receipts
