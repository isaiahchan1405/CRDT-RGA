export type ID = string;

export interface Operation<Item> {
    type: 'insert' | 'delete'
    parent: ID
    value?: Item
    id?: ID
}