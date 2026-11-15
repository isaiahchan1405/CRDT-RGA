import { Operation, ID } from "./Interfaces";
import { Node } from "./node";
import { ClockWrapper } from "./ClockWrapper";

/** Id of the sentinel node at the start of every document. */
const ROOT_ID = "DOC_ROOT";

/** A list node holding one insert operation. */
type OpNode<T> = Node<Operation<T>>;

/**
 * Sorts operations oldest-first, so parents are applied before their children.
 *
 * A delete shares its id with the insert it targets, so for equal ids the
 * insert must come first, otherwise the delete has nothing to delete yet.
 */
function compareOperations(a: Operation, b: Operation): number {
    if (a.id === b.id) {
        if (a.type === b.type) return 0;
        return a.type === "insert" ? -1 : 1;
    }
    return ClockWrapper.compareTime(a.id, b.id);
}

/**
 * One client's copy of the shared document.
 *
 * Clients exchange operations and call `merge()` with whatever they receive.
 * Once every copy has seen the same operations, every copy holds the same
 * list, no matter the order the operations arrived in or how often.
 */
export class Doc<T> {
    /** Sentinel at the start of the list. Real content starts at `root.right`. */
    private root: OpNode<T>;

    /** Every node ever inserted, by id. Deleted nodes stay, as tombstones. */
    private nodes: Map<ID, OpNode<T>>;

    /** Ids already deleted, so a repeated delete does nothing. */
    private deletedIds: Set<ID>;

    /** Operations waiting for their parent (or delete target) to arrive. */
    private waiting: Operation<T>[];

    /** Shared with whoever creates this client's ids, so merge() can advance it. */
    private clock: ClockWrapper;

    constructor(clientId: string, clock: ClockWrapper = new ClockWrapper(clientId)) {
        this.clock = clock;
        this.root = new Node<Operation<T>>({ type: "insert", id: ROOT_ID });
        this.nodes = new Map([[ROOT_ID, this.root]]);
        this.deletedIds = new Set();
        this.waiting = [];
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    /**
     * Applies a batch of operations, local or remote.
     * Safe to call with any batch, in any order, any number of times.
     */
    merge(operations: Operation<T>[]): void {
        this.advanceClockPast(operations);

        // Applying one operation can unblock another (e.g. a parent arriving
        // lets its waiting child in), so keep passing over the list until a
        // pass makes no progress.
        let pending = [...operations, ...this.waiting].sort(compareOperations);
        let madeProgress = true;

        while (pending.length > 0 && madeProgress) {
            const ready = pending.filter(op => this.isReady(op));
            const blocked = pending.filter(op => !this.isReady(op));

            ready.forEach(op => this.apply(op));

            madeProgress = ready.length > 0;
            pending = blocked;
        }

        this.waiting = pending;
    }

    /** Visible nodes in document order (no root, no deleted nodes). */
    public display(): OpNode<T>[] {
        const visible: OpNode<T>[] = [];

        for (let node = this.root.right; node; node = node.right) {
            if (!node.deleted) visible.push(node);
        }
        return visible;
    }

    // ---------------------------------------------------------------------
    // Applying operations
    // ---------------------------------------------------------------------

    /** Lamport rule: after seeing time t, our next id must be greater than t. */
    private advanceClockPast(operations: Operation<T>[]): void {
        for (const op of operations) {
            this.clock.updateTime(ClockWrapper.extract(op.id).time);
        }
    }

    /** True once whatever the operation points at exists locally. */
    private isReady(op: Operation<T>): boolean {
        if (op.type === "insert") return !op.parent || this.nodes.has(op.parent);
        return this.nodes.has(op.id);
    }

    /** Applies one ready operation. Repeats are ignored. */
    private apply(op: Operation<T>): void {
        if (this.alreadyApplied(op)) return;

        if (op.type === "insert") this.insertNode(op);
        else this.deleteNode(op);
    }

    /**
     * Repeats are expected (the network can redeliver), so a repeat must
     * change nothing. For inserts this also means the first insert with a
     * given id wins.
     */
    private alreadyApplied(op: Operation<T>): boolean {
        return op.type === "insert"
            ? this.nodes.has(op.id)
            : this.deletedIds.has(op.id);
    }

    /**
     * RGA insert: start at the parent, then step right past every node that is
     * newer than the new one. The new node goes where the stepping stops.
     *
     * Newer siblings end up first, and a sibling's children are always newer
     * than it, so a whole sibling subtree gets stepped over together. Every
     * copy makes the same comparisons, so every copy picks the same spot.
     *
     * Example: parent P has children Y (B::3) and X (A::2), list is P Y X.
     *   Insert Z (C::4): Y is older, stop at once      -> P Z Y X
     *   Insert V (D::2): Y is newer, X is older (A < D) -> P Y V X
     */
    private insertNode(op: Operation<T>): void {
        let anchor = this.getNode(op.parent ?? ROOT_ID);

        while (anchor.right && this.isNewer(anchor.right, op)) {
            anchor = anchor.right;
        }

        const node = anchor.append(new Node<Operation<T>>(op));
        this.nodes.set(op.id, node);
    }

    /**
     * Marks the node deleted but keeps it in the list, because an insert
     * made at the same time on another client may still use it as a parent.
     */
    private deleteNode(op: Operation<T>): void {
        this.getNode(op.id).softDelete();
        this.deletedIds.add(op.id);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private isNewer(node: OpNode<T>, op: Operation<T>): boolean {
        return ClockWrapper.compareTime(node.value.id, op.id) > 0;
    }

    /** isReady() is checked first, so a missing node here is a bug. */
    private getNode(id: ID): OpNode<T> {
        const node = this.nodes.get(id);
        if (!node) throw new Error(`No node with id ${id}`);
        return node;
    }
}
