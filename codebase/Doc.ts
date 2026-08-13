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

    private recordOperation(operation: Operation<T>) {
        switch (operation.type) {
            case 'insert':
                this.operationLogs.insert.set(operation.id, { operation, children: [] })
                const parentId = operation.parent ?? ROOT_NODE_ID
                const parent = this.operationLogs.insert.get(parentId)!
                parent.children.push(operation)
                parent.children.sort(compareToken)
                this.operationLogs.insert.set(parentId, parent)
                break
            case 'delete':
                this.operationLogs.delete.add(operation.id);
                break;
            }
    }

    // Corrects the operations through resolvedOperation, then add to the linked-llist
    private apply(operation: Operation<T>) {
        const resolvedOperation = this.resolveConflict(operation);
        
        // Idempotency
        if (!resolvedOperation) return;

        switch (resolvedOperation.type) {
            case 'delete': 
                this.head.find(node => node.value.id == resolvedOperation.id)!.softDelete()
                return
            
            case 'insert': 
                let parentPrime: Node<Operation<T>> | undefined

                // It has no parent - Top of the list/document
                if (!resolvedOperation.parent) parentPrime = this.head
                else parentPrime = this.head.find(node => node.value.id == resolvedOperation.parent)
                
                if (!parentPrime) throw new Error('ID-Decoupled Node Found')

                parentPrime.append(new Node<Operation<T>>(resolvedOperation))
                return
            
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

    public 

    public insert(op: Operation<T>, parent?: Operation<T>): void {
        
    }
}