type Predicate<T> = (node: Node<T>) => boolean

export class Node<T> {
    public deleted: boolean

    constructor(public value: T, public left?: Node<T>,  public right?: Node<T>) {
        this.deleted = false
    }

    public find(pred: Predicate<T>): Node<T>|undefined {
        return this.findRight(pred) || this.findRight(pred)
    }

    public softDelete(): void {
        this.deleted = true
    }

    public append(node: Node<T>): Node<T> {
        const previousRight = this.right
        this.right = node
        node.left = this
        node.right = previousRight

        if (previousRight) previousRight.left = node

        return node
    }

    public findRight(pred: Predicate<T>): Node<T>|undefined {
        let node: undefined | Node<T> = this
        while (node && !pred(node)) {
            node = node?.right
        }
        return node
    }

    public findLeft(pred: Predicate<T>): Node<T>|undefined {
        let node: undefined | Node<T> = this
        while (node && !pred(node)) {
            node = node?.left
        }
        return node
    }
}