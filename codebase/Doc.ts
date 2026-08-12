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
    private head: Node<T>
    private clock: ClockWrapper
    private staging: Operation[]
    private buffer: Operation[]
    // Permanently stores all operations, no garbage collection implemented
    private operationLogs: {
        insert: Map<ID, {operation: Operation; children: Operation[]}>;
        delete: Set<ID>
    }

    // Takes care of concurrent/same-time operations APPLIED TO THE SAME PARENT, 
    // while handling duplicate operations(im not sure if TCP causes this, but ill just implement it rn)
    // and untimely sent operations
    private resolveConflict(operation: Operation<T>): Operation<T> | undefined {
        // Im not sure if cloning is neccessary, but I suppose its good to make sure objects remain pure
        const opCopy = OperationToken.clone(operation)

        // Theres no need to add a already added operation (Idempotency)
        if (this.operationLogs.insert.has(opCopy.id) || this.operationLogs.delete.has(opCopy.id))
            return undefined

        switch (opCopy.type) {
            case 'delete':
                return opCopy
            case 'insert':
                // Check for ordering correctness - by comparing existing children and current operation to work with
                const duplicate = this.operationLogs.insert.get(opCopy.parent ?? ROOT_NODE_ID)?.children
                if (!duplicate) throw new Error('No Node Found');

                const parent = duplicate.find(dp => compareToken(opCopy, dp) == -1);
                if (parent) {
                    opCopy.parent = parent.id;
                    return this.resolveConflict(opCopy);
                }
                return opCopy;
            default:
                throw new Error('Invalid Operation Type')
        }
    }

    public insert(op: Operation<T>, parent?: Operation<T>): void {
        
    }
}