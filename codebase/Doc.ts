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

export class Doc<T> {
    private head: Node<T>
    private clock: ClockWrapper
    private staging: Operation[]
    private buffer: Operation[]
    private operationLogs: {
        insert: Map<ID, {operation: Operation; children: Operation[]}>;
        delete: Set<ID>
    }

    // Takes care of concurrent/same-time operations, while handling duplicate operations(im not sure if TCP causes this, but ill just implement it rn)
    // and untimely sent operations
    private resolveConflict(operation: Operation<T>): Operation<T> | undefined {
        // Im not sure if cloning is neccessary, but its good to implement it later
        const opCopy = OperationToken.clone(operation)

        this.operationLogs.find(opCopy.)
        switch

        const resolveOperation = OperationToken.clone(operation);
        switch (operation.type) {
        case 'insert': {
            if (this.operations.insert.has(operation.id)) return undefined;
            const duplicate = this.operations.insert.get(
            resolveOperation.parent ?? ROOT_NODE_ID,
            )?.children;
            if (!duplicate) throw new Error('Not Found Node');
            const parent = duplicate.find(
            dp => compareToken(resolveOperation, dp) == -1,
            );
            if (parent) {
            resolveOperation.parent = parent.id;
            return this.resolveConflict(resolveOperation);
            }
            return resolveOperation;
        }
        case 'delete': {
            if (this.operations.delete.has(operation.id)) return undefined;
        }
        }
        return resolveOperation;
    }

    public insert(op: Operation<T>, parent?: Operation<T>): void {
        
    }
}