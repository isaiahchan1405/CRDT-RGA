export type ID = string;

export interface Operation<Item = any> {
    type: 'insert' | 'delete'
    id: ID
    value?: Item
    parent?: ID
}