import { OperationToken } from "./OperationToken";
import { Operation, ID } from "./Interfaces";
import { Node } from "./node";
import { ClockWrapper } from "./ClockWrapper";

// implements the comparison of ids
const compareToken = (a: Operation, b: Operation) => {
  if (a.id == b.id && a.type != b.type) {
    return a.type == 'insert' ? -1 : 1;
  }

  return ClockWrapper.compareTime(a.id, b.id);
}
const ROOT_NODE_ID = 'DOC_ROOT';

export class Doc<T> {
    private head!: Node<Operation<T>>
    private clock!: ClockWrapper
    private staging!: Operation<T>[]
    private buffer!: Operation<T>[]
    // Permanently stores all operations, no garbage collection implemented
    private operationLogs! : {
        insert: Map<ID, {operation: Operation<T>; children: Operation<T>[]}>
        delete: Set<ID>
    }

    constructor(clientId: string) {
        this.clock = new ClockWrapper(clientId)
        this.staging = []
        this.buffer = []

        const rootOperation: Operation<T> = { type: 'insert', id: ROOT_NODE_ID }
        this.head = new Node<Operation<T>>(rootOperation)
        this.operationLogs = {
            insert: new Map([[ROOT_NODE_ID, { operation: rootOperation, children: [] }]]),
            delete: new Set()
        }
    }

    // Takes care of concurrent/same-time operations APPLIED TO THE SAME PARENT,
    // while handling duplicate operations(im not sure if TCP causes this, but ill just implement it rn)
    // and untimely sent operations
    private resolveConflict(operation: Operation<T>): Operation<T> | undefined {
        const opCopy = OperationToken.clone(operation)

        switch (opCopy.type) {
            case 'delete':
                if (this.operationLogs.delete.has(opCopy.id)) return undefined
                return opCopy

            case 'insert': 
                if (this.operationLogs.insert.has(opCopy.id)) return undefined

                const duplicate = this.operationLogs.insert.get(opCopy.parent ?? ROOT_NODE_ID)?.children
                if (!duplicate) throw new Error('ID-Decoupled Node Found')

                const parentPrime = duplicate.find(dp => compareToken(opCopy, dp) == -1);
                if (parentPrime) {
                    opCopy.parent = parentPrime.id
                    return this.resolveConflict(opCopy)
                }
                return opCopy

            default:
                throw new Error('Invalid Operation Type')
        }
    }

    private recordOperation(operation: Operation<T>):void {
        switch (operation.type) {
            case 'insert':
                this.operationLogs.insert.set(operation.id, { operation, children: [] })
                const parentId = operation.parent ?? ROOT_NODE_ID
                const parentContent = this.operationLogs.insert.get(parentId)!

                parentContent.children.push(operation)
                parentContent.children.sort(compareToken)
                this.operationLogs.insert.set(parentId, parentContent)
                break
            case 'delete':
                this.operationLogs.delete.add(operation.id);
                break;
            }
    }

    // Corrects the operations through resolvedOperation, then add to the linked-llist
    private apply(operation: Operation<T>): void {
        const resolvedOperation = this.resolveConflict(operation);
        
        // Idempotency
        if (!resolvedOperation) return

        switch (resolvedOperation.type) {
            case 'delete': 
                this.head.find(node => node.value.id == resolvedOperation.id)!.softDelete()
            
            case 'insert': 
                let parentPrime: Node<Operation<T>> | undefined

                // It has no parent - Top of the list/document
                if (!resolvedOperation.parent) parentPrime = this.head
                else parentPrime = this.head.find(node => node.value.id == resolvedOperation.parent)
                
                if (!parentPrime) throw new Error('ID-Decoupled Node Found')

                parentPrime.append(new Node<Operation<T>>(resolvedOperation))
            
            default:
                throw new Error('Invalid Operation Type')
        }

        this.recordOperation(operation);
    }

    public display(): Node<Operation<T>>[] {
        let dummy: Node<Operation<T>> | undefined = this.head
        const cleaned: Node<Operation<T>>[] = []
        while(dummy){
            if (!dummy.deleted) 
                cleaned.push(dummy) 
                dummy = dummy.right
        }
        return cleaned
    }

    private canProcessOperation(operation: Operation<T>): boolean {
        switch (operation.type) {
            case 'insert':
                // True if parent is the root, if not the root, check if it really is logged
                return !operation.parent || this.operationLogs.insert.has(operation.parent)
            case 'delete':
                return this.operationLogs.insert.has(operation.id);
            default:
                throw new Error('Invalid Operation Type')
        }
    }

    merge(operations: Operation<T>[]): void {
        const times = operations.map(op => ClockWrapper.extract(op.id).time)

        const maxClock = Math.max(...times)
        this.clock.updateTime(maxClock)    

        const buffer = this.buffer.splice(0)
        const targets = [...operations, ...buffer].sort(compareToken)
        targets.forEach(operation => {
            if (!this.canProcessOperation(operation)) {
                this.buffer.push(operation)
                return
            }
            this.apply(operation)
        }
        )
    }
}