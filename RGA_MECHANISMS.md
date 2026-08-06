# How This RGA Implementation Works

This document explains every mechanism in the `rga` package (`rga/src`), aimed at
a reader who is comfortable with data structures (linked lists, trees, maps,
sorting) but has never worked with CRDTs or distributed systems before. Every
unfamiliar term is defined the first time it's used.

## 1. The problem, restated in data-structure terms

Normally, when you edit a linked list, there is one copy of it, and one thread
touching it at a time. Here, there are **N independent copies** of the same
list (one per "peer" / editor), each of which can be mutated locally at any
time, with no coordination. Occasionally, a copy sends the operations it
performed (insert/delete) to the other copies, which apply them to their own
list.

The requirement: no matter what order those operations arrive in, no matter
how long they take to arrive, and no matter how many peers are editing at
once — every copy must end up holding **the exact same list**, element for
element, in the same order.

This is hard because a plain linked list breaks under concurrent edits:

- If two peers each insert a new node "at position 3," they can't agree on
  position 3 without asking each other first — and by definition, they aren't
  asking each other (no coordination).
- If peer A deletes node X while peer B is concurrently inserting "after X,"
  and A's delete arrives at B's copy first (physically unlinking X), B's
  insert now has nowhere to attach.

Everything below is a mechanism for solving one of these two problems, using
only tools you already know: unique keys, sorting, sentinel nodes, and
adjacency lists.

## 2. Giving every element a name that everyone can agree on

**Files:** [`lamport-clock.ts`](../rga/src/lamport-clock.ts), [`id.ts`](../rga/src/id.ts)

The first problem — "position 3 means different things on different
copies" — is solved by never referring to a position at all. Instead, every
inserted element gets a unique ID at creation time, and all future references
to "where does this go" are phrased as "attach this after the element with ID
X," never "insert at index 3."

For two peers to independently generate IDs that never collide, and that can
still be **sorted into one global order** later, each ID is built from two
parts:

```
"<clientId>::<counter>"        e.g. "Lee::3", "Kim::7"
```

- **`clientId`** — a string unique per peer (`"Lee"`, `"Kim"`, `"Choi"` in the
  demo). Guarantees two different peers never produce the same ID even if
  their counters happen to match.
- **`counter`** — a **Lamport clock** (`LamportClock` class). This is just an
  integer that only ever goes up. Think of it as a version number instead of
  a timestamp:
  - `tick()` — increment and return, called every time this peer creates a
    new operation. (`++this.time`)
  - `update(time)` — set the counter to `max(current, time)`, called whenever
    this peer *observes* an operation from someone else. (`Math.max(time, this.time)`)

  The `update` step is the important part: it means that after you see an
  operation stamped `7`, your own next-generated ID will be `8` or higher —
  never something that could be confused as "earlier" than what you just saw.
  This gives you a form of causal ordering without anyone owning a shared
  clock: **if operation B was created after some peer saw operation A, B's
  number is guaranteed larger than A's number.** (The converse isn't
  guaranteed — two truly concurrent operations, created before either peer
  saw the other, can have their counters land in either order. That's fine;
  see §4.)

`ClockId.compare(a, b)` turns two IDs into a total order (i.e., a comparator
usable with `Array.sort`, giving a definite answer for *any* pair, never
"equal" for distinct IDs):

1. Compare the counters numerically.
2. If equal, break the tie by comparing `clientId` strings lexicographically.

Because every peer runs the exact same comparator on the exact same IDs, they
always agree on the relative order of any two elements — even ones neither
peer has seen the other create yet. This total order is the backbone every
other mechanism in this document builds on.

## 3. The physical structure: a doubly linked list of tombstones

**File:** [`node.ts`](../rga/src/node.ts)

The document itself is a plain doubly linked list (`Node<T>` with `.left` /
`.right`). Nothing exotic here — except for one field: `deleted: boolean`.

### Why a linked list and not an array

Because every insert is specified as "attach after node X" (an identity, not
an index), the operation you need is *splice a node in given a pointer to its
neighbor* — which is O(1) on a linked list and O(n) on an array (shifting
every subsequent element). Given how this structure grows (every keystroke
from every peer, forever), paying O(n) per character would be far worse, and
translating "the node with ID X" into "index 7" would itself require an O(n)
scan on every operation, since indices are constantly shifting under
concurrent edits anyway.

### Why "doubly"

Traversal needs to go both directions:
- `getTail()` / `getHead()` walk to either end (used when splicing in a node
  that is itself the head of a short chain).
- `findLeft` / `findRight` search outward from an arbitrary point in either
  direction; `find()` tries right first, then left, since operations
  referencing recent history tend to be near the tail.

### Why "tombstone" instead of really deleting

This is the answer to problem #2 from §1 (delete-then-insert-after-it race).
`softDelete()` just sets `deleted = true` — the node stays fully linked in
the list, it's simply skipped when reading the visible content
(`Doc.list()` filters `!node.deleted`). A **tombstone** is the standard term
for "a deleted record kept around as a placeholder." Keeping it means any
operation that references that ID as an anchor — even one created by another
peer who hasn't yet heard about the delete — always finds a valid node to
attach to. The node's identity survives its own deletion.

There is also a real, hard `delete()` (splice the node fully out, relinking
`left`/`right` around it). This is *not* used for normal edits — see §6 for
the one narrow case where it's safe.

## 4. The logical structure: an index of "who wanted to attach where"

**File:** [`doc.ts`](../rga/src/doc.ts), the `operations.insert` map

This is the piece that resolves the first problem from §1: two peers
concurrently inserting "after the same anchor."

Alongside the physical linked list, `Doc` keeps a plain `Map<ID, { operation,
children: Operation[] }>`. For every insert operation ever applied, it looks
up the record for that operation's **stated parent** and pushes the operation
into that record's `children` array, then re-sorts the array with the same
total-order comparator from §2 (`compareToken`, a thin wrapper around
`ClockId.compare` that also makes an insert sort before a delete of the same
ID — see the source for the exact tie-break).

Think of this as a **secondary index**, analogous to an adjacency list you'd
build alongside a tree to answer "list all of X's children, in sorted
order," except here "parent" means "the anchor this operation was *authored*
against" — which is not necessarily where the operation ends up physically
attached (that's decided in §5). It exists purely so that, the next time some
operation also claims the same parent, we can cheaply find every rival that
already claimed it and rank against them.

## 5. Resolving concurrent inserts: `resolveConflict`

**File:** [`doc.ts`](../rga/src/doc.ts), method `resolveConflict`

Here's the core scenario: peers "Lee" and "Kim" both had the document
`"P"` (some anchor node) and both concurrently typed a character right after
it. Neither knew about the other's edit. Lee's insert has ID `Lee::2`, Kim's
has ID `Kim::5`. Both operations say `parent: "P"`. When both operations
eventually reach every peer, every peer must attach them to the list in the
same relative order — otherwise the documents diverge.

The naive approach — "just find node P and append after it" for both — fails
immediately: whichever operation is applied *second*, locally, ends up
adjacent to P, and the first one gets pushed one slot further out. Since
different peers may receive `Lee::2` and `Kim::5` in different orders, they'd
end up with different final layouts. This is exactly the "index 3 means
different things" problem, recurring one level down.

The fix: before physically attaching anything, `resolveConflict` computes
*where in rank order* the new operation belongs among every other operation
that also claimed the same parent — using the §4 index — and rewrites the
operation's `parent` to point at the correct immediate neighbor, before ever
touching the linked list.

```ts
private resolveConflict(operation) {
  const resolveOperation = clone(operation)
  // ...insert case:
  if (already applied) return undefined            // idempotency, see below
  const siblings = childrenOf(resolveOperation.parent)   // sorted ascending by rank
  const higherRankedSibling = siblings.find(dp => rank(resolveOperation) < rank(dp))
  if (higherRankedSibling) {
    resolveOperation.parent = higherRankedSibling.id     // "someone with higher priority
    return this.resolveConflict(resolveOperation)        //  already took this slot — recheck
  }                                                       //  against THEIR children instead"
  return resolveOperation
}
```

Read it as a recursive descent: "does anyone who already attached to my
intended parent outrank me? If so, I actually belong *after* them instead —
go check whether anyone attached to *them* outranks me too, and so on." The
recursion bottoms out at the first parent whose already-attached children are
all lower-ranked than the incoming operation (or has none) — that's the
correct physical attach point.

The net effect, once you trace it through: among any set of operations that
all name the same original parent, they end up chained in **descending rank
order**, with the highest-ranked one physically adjacent to the shared
anchor. Crucially, this happens **regardless of the order the operations are
applied in** — you can verify this yourself by hand-simulating three
concurrent inserts (say ranks `2`, `3`, `5`, all parented to `P`) in every
possible arrival order; each one converges to the same final chain
`P → 5 → 3 → 2`. That order-independence is precisely the convergence
guarantee this whole file exists to provide.

Two more details worth calling out in `resolveConflict`:

- **Idempotency check** (`if (this.operations.insert.has(operation.id)) return undefined`):
  if this exact operation was already applied (e.g., delivered twice over an
  unreliable network), it's silently dropped instead of inserted a second
  time. Same for deletes, checked against `operations.delete`. This is what
  lets `merge()` be safely called with overlapping or re-sent data.
- **Cloning**: the function clones the operation before mutating `.parent`
  on it, rather than mutating the caller's object, since the recursive call
  needs a fresh, independent copy at each level.

## 6. Applying an operation

**File:** [`doc.ts`](../rga/src/doc.ts), method `apply`

Once `resolveConflict` has produced the *correct* parent ID, `apply` does the
mechanical part:

- **Delete:** find the node with the target ID anywhere in the list
  (`head.find(...)`) and `softDelete()` it (tombstone, §3).
- **Insert:** find the node with the resolved parent ID, and
  `parent.append(new Node(operation))` — an O(1) splice, per §3.

Then, regardless of type, `recordOperation` updates the bookkeeping from §4
using the operation's **original, unresolved** parent — so the index always
reflects "who was authored against whom," which is what §5 needs to compare
future rivals against.

## 7. Handling operations that arrive out of order: `merge`

**File:** [`doc.ts`](../rga/src/doc.ts), method `merge`, plus `canProcessOperation` / `this.buffer`

Networks don't guarantee delivery order. You might receive "delete node X"
before you've ever received "insert node X" — or an insert whose parent
hasn't shown up yet. Applying either immediately would crash (nothing to
find). `canProcessOperation` is the guard:

- An **insert** is processable once its parent is already known (or it has
  no parent, meaning it attaches to the root).
- A **delete** is processable once its target ID is already known.

`merge(operations)` is called with a batch of remote operations:

1. Updates the local Lamport clock to at least the highest counter seen in
   the batch (§2's `update` step).
2. Combines the new batch with anything left over from a *previous* call
   that couldn't be processed yet (`this.buffer`), and sorts everything by
   rank. (Sorting isn't required for correctness — §5 converges regardless
   of order — but since a Lamport clock guarantees an operation's rank is
   always higher than anything its creator had already seen, sorting means
   dependencies are very likely processed before their dependents *within
   this same batch*, minimizing how much ends up deferred.)
3. Walks the sorted list: anything not yet processable goes back into
   `this.buffer` for the *next* call to `merge` to retry; everything else is
   `apply`'d immediately.

This pattern — "if a message's prerequisite hasn't arrived, hold it and
retry later" — is a general technique for tolerating out-of-order delivery
any time messages have dependencies on each other, independent of CRDTs.

## 8. Reducing what you have to send: `commit`

**File:** [`doc.ts`](../rga/src/doc.ts), method `commit`, plus `this.staging`

Every local `insert`/`delete` call also pushes its operation onto
`this.staging` — an outbox of operations not yet handed off to the network
layer. `commit()` drains it and does one optimization: if this peer, before
ever telling anyone else, both inserted a character *and* deleted it again
(e.g., typed a letter then immediately backspaced it), there is no reason to
ever announce either operation — no other peer's copy could possibly hold a
reference to an ID that was never broadcast. In that specific case only, the
insert and delete cancel out of the outbox, and the node is **fully unlinked**
from the local list (the hard `delete()` from §3, safe here precisely because
nothing external could be anchored to it). Everything else in `staging` is
returned as-is, to be sent over the network by whatever transport the caller
uses.

## 9. Moving operations across the wire: `OperationToken`

**File:** [`operation-token.ts`](../rga/src/operation-token.ts)

A small value-object wrapper around the plain `Operation` shape
(`{type, id, parent?, value?}`), with two static factories (`ofInsert`,
`ofDelete`) and a `hash`/`fromHash` pair that serialize an operation to a JSON
string and back. `clone()` is implemented as `fromHash(hash(x))` — a
round-trip through serialization — which is a simple, foolproof way to get a
deep, fully independent copy without worrying about missing a field, at the
cost of being slightly slower than a hand-written copy. Given operations are
small and cloning is not a hot-path bottleneck here, that trade-off is fine.

## 10. Putting it all together: one keystroke, end to end

1. User types a character. `Doc.insert(value, parentId)` generates a new ID
   via `ClockId.gen()` (ticks the local Lamport clock, §2), builds an insert
   operation, and calls `apply()` (§6) — which resolves any *local* conflict
   (there usually isn't one yet, since nothing else has happened
   concurrently on this exact peer) and splices the new node into this
   peer's own linked list immediately, so the UI updates instantly without
   waiting on the network.
2. The operation is pushed to `staging` (§8).
3. At some point, `commit()` drains `staging` (minus any insert/delete pairs
   that cancelled out) and the caller broadcasts the result.
4. A remote peer receives the batch and calls `merge()` (§7), which updates
   its clock, sorts, defers anything whose dependencies haven't arrived yet,
   and `apply()`s the rest.
5. For each remote insert, `apply` → `resolveConflict` (§5) figures out
   exactly which existing node it must attach after so that *every* peer,
   regardless of what order they received things in, ends up with the
   identical final chain.
6. Reading the document is just `Doc.list()`: walk the linked list head to
   tail, skip anything tombstoned (§3).

## Glossary (CRDT term → what it is, in plain terms)

| Term | Plain-terms meaning |
|---|---|
| CRDT | A data structure with a merge rule guaranteeing that applying the same set of operations in any order/any number of times produces the same result. |
| Lamport clock | A monotonically increasing counter used as a stand-in for "happened-before" ordering, without relying on synchronized wall-clock time. |
| Total order | A comparator that gives a definite, consistent answer for any two distinct items — no ties, no ambiguity — so every replica sorts things identically. |
| Tombstone | A deleted record that is kept (flagged, not removed) so it can still be referenced by others. |
| Convergence | The guarantee that all replicas end up in the same state once they've seen the same set of operations, regardless of arrival order. |
| Causal delivery / buffering | Holding a message that depends on another message which hasn't arrived yet, and retrying once the dependency shows up. |
| Idempotency | Applying the same operation more than once has no additional effect beyond applying it once. |
