import { Operation, ID } from "./Interfaces";
import { Node } from "./node";
import { ClockWrapper } from "./ClockWrapper";

// Ascending total order over operations (older first). An insert and a delete
// sharing an id (a delete targets its insert's id) are ordered insert-first.
const compareToken = (a: Operation, b: Operation): number => {
  if (a.id == b.id) {
    if (a.type == b.type) return 0
    return a.type == 'insert' ? -1 : 1;
  }

  return ClockWrapper.compareTime(a.id, b.id);
}
const ROOT_NODE_ID = 'DOC_ROOT';

export class Doc<T> {
    private head: Node<Operation<T>>
    private clock: ClockWrapper
    private buffer: Operation<T>[]
    // id -> list node, for O(1) lookup of parents/delete targets.
    // Permanently stores all inserts (tombstones included), no garbage collection implemented
    private nodes: Map<ID, Node<Operation<T>>>
    private deleted: Set<ID>

    // Pass the clock used to mint this client's ids so merge() can advance it.
    constructor(clientId: string, clock: ClockWrapper = new ClockWrapper(clientId)) {
        this.clock = clock
        this.buffer = []

        const rootOperation: Operation<T> = { type: 'insert', id: ROOT_NODE_ID }
        this.head = new Node<Operation<T>>(rootOperation)
        this.nodes = new Map([[ROOT_NODE_ID, this.head]])
        this.deleted = new Set()
    }

    // Idempotency: true if this exact operation (or a colliding id) was already applied
    private isDuplicate(operation: Operation<T>): boolean {
        return operation.type == 'insert'
            ? this.nodes.has(operation.id)
            : this.deleted.has(operation.id)
    }

    // RGA insert: start at the parent, then skip over every following node with a
    // greater (newer) id. Concurrent siblings end up newest-first, and a sibling's
    // descendants always have greater ids than it (Lamport causality), so whole
    // subtrees get skipped together. Every replica lands on the same position.
    private applyInsert(operation: Operation<T>): void {
        const parent = this.nodes.get(operation.parent ?? ROOT_NODE_ID)
        if (!parent) throw new Error('ID-Decoupled Node Found')

        let anchor: Node<Operation<T>> = parent
        while (anchor.right && ClockWrapper.compareTime(anchor.right.value.id, operation.id) > 0) {
            anchor = anchor.right
        }

        this.nodes.set(operation.id, anchor.append(new Node<Operation<T>>(operation)))
    }

    private applyDelete(operation: Operation<T>): void {
        const target = this.nodes.get(operation.id)
        if (!target) throw new Error('ID-Decoupled Node Found')

        target.softDelete()
        this.deleted.add(operation.id)
    }

    private apply(operation: Operation<T>): void {
        if (this.isDuplicate(operation)) return

        switch (operation.type) {
            case 'insert':
                this.applyInsert(operation)
                break
            case 'delete':
                this.applyDelete(operation)
                break
            default:
                throw new Error('Invalid Operation Type')
        }
    }

    // Visible (non-tombstoned) nodes, excluding the root sentinel
    public display(): Node<Operation<T>>[] {
        const cleaned: Node<Operation<T>>[] = []
        let dummy = this.head.right
        while (dummy) {
            if (!dummy.deleted) cleaned.push(dummy)
            dummy = dummy.right
        }
        return cleaned
    }

    private canProcessOperation(operation: Operation<T>): boolean {
        switch (operation.type) {
            case 'insert':
                // True if parent is the root, if not the root, check if it really is logged
                return !operation.parent || this.nodes.has(operation.parent)
            case 'delete':
                return this.nodes.has(operation.id);
            default:
                throw new Error('Invalid Operation Type')
        }
    }

    merge(operations: Operation<T>[]): void {
        for (const op of operations) {
            this.clock.updateTime(ClockWrapper.extract(op.id).time)
        }

        // Retry until no progress: an op whose parent is still missing stays buffered
        let pending = [...operations, ...this.buffer.splice(0)].sort(compareToken)
        let progressed = true
        while (pending.length && progressed) {
            progressed = false
            const blocked: Operation<T>[] = []
            for (const operation of pending) {
                if (this.canProcessOperation(operation)) {
                    this.apply(operation)
                    progressed = true
                } else {
                    blocked.push(operation)
                }
            }
            pending = blocked
        }
        this.buffer.push(...pending)
    }
}
