type Predicate<T> = (node: Node<T>) => boolean;

/**
 * A node in a doubly linked list.
 *
 * Nodes are never unlinked. Deleting one only sets `deleted`, so it stays
 * in place and can still be found.
 */
export class Node<T> {
    /** Hidden from the document, but still usable as a parent. */
    public deleted = false;

    constructor(
        public value: T,
        public left?: Node<T>,
        public right?: Node<T>,
    ) {}

    public softDelete(): void {
        this.deleted = true;
    }

    /** Inserts `node` directly after this one and returns it. */
    public append(node: Node<T>): Node<T> {
        const oldRight = this.right;

        node.left = this;
        node.right = oldRight;
        this.right = node;
        if (oldRight) oldRight.left = node;

        return node;
    }

    /** First match searching left, then right (both include this node). */
    public find(pred: Predicate<T>): Node<T> | undefined {
        return this.findLeft(pred) ?? this.findRight(pred);
    }

    /** First match from this node going right. */
    public findRight(pred: Predicate<T>): Node<T> | undefined {
        let node: Node<T> | undefined = this;
        while (node && !pred(node)) node = node.right;
        return node;
    }

    /** First match from this node going left. */
    public findLeft(pred: Predicate<T>): Node<T> | undefined {
        let node: Node<T> | undefined = this;
        while (node && !pred(node)) node = node.left;
        return node;
    }
}
