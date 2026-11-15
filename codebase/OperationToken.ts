import { Operation, ID } from "./Interfaces";

/**
 * A concrete Operation.
 *
 * Build one with `consInsert` or `consDelete`, so an operation can't carry
 * fields that don't belong to its type (e.g. a delete with a value).
 */
export class OperationToken<T> implements Operation<T> {
    private constructor(
        public type: Operation<T>["type"],
        public id: ID,
        public value?: T,
        public parent?: ID,
    ) {}

    /** Insert `value` after node `parent` (no parent = top of the document). */
    public static consInsert<T>(op: Omit<Operation<T>, "type">): OperationToken<T> {
        return new OperationToken<T>("insert", op.id, op.value, op.parent);
    }

    /** Delete the node with this id. */
    public static consDelete<T>(op: Pick<Operation<T>, "id">): OperationToken<T> {
        return new OperationToken<T>("delete", op.id);
    }

    /** A fresh copy, without any fields that don't belong to its type. */
    public static clone<T>(op: Operation<T>): OperationToken<T> {
        return op.type === "insert"
            ? OperationToken.consInsert(op)
            : OperationToken.consDelete(op);
    }

    // -----------------------------------------------------------------
    // Sending over the network
    //
    // Format is a flat JSON array:
    //   insert -> ["insert", id, value, parent]
    //   delete -> ["delete", id]
    // stringifyToken and tokenizeString must change together.
    // -----------------------------------------------------------------

    public static stringifyToken<T>(op: Operation<T>): string {
        return op.type === "insert"
            ? JSON.stringify([op.type, op.id, op.value, op.parent])
            : JSON.stringify([op.type, op.id]);
    }

    public static tokenizeString<T>(message: string): OperationToken<T> {
        const [type, id, value, parent] = JSON.parse(message);

        switch (type) {
            case "insert":
                // JSON turns undefined into null inside arrays, so turn it back
                return OperationToken.consInsert({
                    id,
                    value: value ?? undefined,
                    parent: parent ?? undefined,
                });
            case "delete":
                return OperationToken.consDelete({ id });
            default:
                throw new Error(`Unknown operation type: ${type}`);
        }
    }
}
