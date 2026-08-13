import { Operation, ID } from "./Interfaces"

// To create a Operation reference
export class OperationToken<T> implements Operation<T> {
    private constructor(
        public type: Operation<T>['type'], 
        public id: ID, 
        public value?: T, 
        public parent?: ID) {}
    
    //Pick and Omit look unnessarily complicated but its not that deep, just
    //used to look more precise
    public static consInsert<T>(operation: Omit<Operation<T>, 'type'>) {
        return new OperationToken<T>('insert', operation.id, operation.value, operation.parent)
    }

    public static consDelete<T>(operation: Pick<Operation<T>, 'id'>) {
        return new OperationToken<T>('delete', operation.id)
    }

    public static clone<T>(operation: Operation<T>): OperationToken<T> {
        switch (operation.type) {
            case 'insert':
                return OperationToken.consInsert(operation)
            case 'delete':
                return OperationToken.consDelete(operation)
            default:
                throw new Error('No such type')
        }
    }

    // Given id is unique, the string produced will be unique too
    public stringifyToken(token: Operation<T>): string {
        const args: any[] = [token.type, token.id]
        if (token.type == 'insert') args.push([token.value, token.parent])
        return JSON.stringify(args)
    }

    // Type management is a pain in the ass
    public tokenizeString(message: string): OperationToken<T> {
        const [type, id, value, parent]: any[] = JSON.parse(message)

        switch(type as OperationToken<T>['type']) {
            case 'insert':
                return OperationToken.consInsert({id, value, parent})
            case 'delete':
                return OperationToken.consDelete({id})
            default:
                throw new Error('No such type')
        }
    }
}