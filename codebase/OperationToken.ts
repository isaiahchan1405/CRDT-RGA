import { Operation, ID } from "./Interfaces"

// To create a Operation reference
export class OperationToken<T> implements Operation<T> {
    private constructor(
        private type: string, 
        private id: ID, 
        private value?: T, 
        private parent?: ID) {}
    
    //Pick and Omit look unnessarily complicated but its not that deep, just
    //used to look more precise
    public static consInsert<T>(operation: Omit<Operation<T>, 'type'>) {
        return new OperationToken<T>('insert', operation.id, operation.value, operation.parent)
    }

    public static consDelete<T>(operation: Pick<Operation<T>, 'id'>) {
        return new OperationToken<T>('delete', operation.id)
    }

    public hash(token: OperationToken<T>) {
        const args: any[] = [token.type, token.id]

    }
}