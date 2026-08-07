type Predicate<T> = (node: Node<T>) => boolean

export class Node<T> {
    private deleted: boolean

    constructor(private value: T, private left?: Node<T>,  private right?: Node<T>){
        this.deleted = true
    }

    public getValue(): T {
        return this.value
    }

    public trueDeleted(): boolean {
        return this.deleted
    }

    public find(pred: Predicate<T>): Node<T>|undefined {
        return this.findRight(pred) || this.findRight(pred)
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