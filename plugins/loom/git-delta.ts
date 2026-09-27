/** A single, unambiguous byte edit. Offsets are measured in UTF-8 bytes. */
type Edit = { start: number; removed: Buffer; inserted: Buffer }

export type DeltaProjection = {
  projection: Buffer
  aggregate: Buffer
  foreign: Buffer
}

function editBetween(before: Buffer, after: Buffer): Edit {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return {
    start,
    removed: before.subarray(start, beforeEnd),
    inserted: after.subarray(start, afterEnd),
  }
}

function replace(source: Buffer, edit: Edit) {
  return Buffer.concat([
    source.subarray(0, edit.start),
    edit.inserted,
    source.subarray(edit.start + edit.removed.length),
  ])
}

function countOccurrences(haystack: Buffer, needle: Buffer) {
  if (needle.length === 0) return 1
  let count = 0
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (haystack.subarray(offset, offset + needle.length).equals(needle)) count += 1
  }
  return count
}

/**
 * Project F->A (the admitted edit) onto H while retaining H->F (foreign work).
 * Only one-hunk, text-only edits with strict separation are accepted. Every
 * result is checked by replaying the foreign edit and comparing exact bytes.
 */
export function projectDisjointTextDelta(
  head: Buffer,
  foreign: Buffer,
  aggregate: Buffer,
): DeltaProjection | undefined {
  if ([head, foreign, aggregate].some((value) => value.includes(0))) return undefined
  if (head.length === 0 && foreign.length > 0) return undefined
  if (head.length === 0 && foreign.length === 0 && aggregate.length > 0) {
    return {
      projection: Buffer.from(aggregate),
      aggregate: Buffer.from(aggregate),
      foreign: Buffer.from(foreign),
    }
  }

  const foreignEdit = editBetween(head, foreign)
  const ownedEdit = editBetween(foreign, aggregate)
  if (
    foreignEdit.removed.length === 0 && ownedEdit.removed.length === 0 &&
    ownedEdit.start === foreignEdit.start + foreignEdit.inserted.length
  ) return undefined
  if (foreignEdit.removed.equals(ownedEdit.removed) && foreignEdit.inserted.equals(ownedEdit.inserted)) {
    return undefined
  }

  // Repeated removed text provides no unique anchor for replay.
  if (countOccurrences(head, foreignEdit.removed) > 1 && foreignEdit.removed.length > 0) return undefined
  if (countOccurrences(foreign, ownedEdit.removed) > 1 && ownedEdit.removed.length > 0) return undefined

  const foreignEnd = foreignEdit.start + foreignEdit.inserted.length
  const ownedEnd = ownedEdit.start + ownedEdit.removed.length
  let projectedStart: number
  if (ownedEnd <= foreignEdit.start) {
    projectedStart = ownedEdit.start
  } else if (ownedEdit.start >= foreignEnd) {
    projectedStart = ownedEdit.start - foreignEdit.inserted.length + foreignEdit.removed.length
  } else {
    // Includes overlap and competing insertions/replacements at a boundary.
    return undefined
  }

  const projectedEdit: Edit = {
    start: projectedStart,
    removed: ownedEdit.removed,
    inserted: ownedEdit.inserted,
  }
  if (!head.subarray(projectedStart, projectedStart + projectedEdit.removed.length).equals(projectedEdit.removed)) {
    return undefined
  }
  const projection = replace(head, projectedEdit)
  if (!replace(projection, { ...foreignEdit, start: foreignEdit.start <= projectedStart
    ? foreignEdit.start
    : foreignEdit.start + projectedEdit.inserted.length - projectedEdit.removed.length }).equals(aggregate)) {
    return undefined
  }

  return { projection, aggregate: Buffer.from(aggregate), foreign: Buffer.from(foreign) }
}
