import { OperationToken } from "./OperationToken";
import { Operation } from "./Interfaces";
import { Node } from "./node";
import { ClockWrapper } from "./ClockWrapper";

export class Doc<T> {
    private head: Node<T>
    private clock: ClockWrapper
    private staging: Operation<T>[]
    private buffer: Operation<T>[]

    public insert(op: Operation<T>, parent?: Operation<T>): void {
        
    }
}