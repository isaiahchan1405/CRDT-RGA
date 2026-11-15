/** Unique id of the form "<clientId>::<lamportTime>", e.g. "A::3". */
export type ID = string;

/** What clients send each other. Never changed after it is created. */
export interface Operation<Item = any> {
    type: "insert" | "delete";

    /** Insert: the new node's own id. Delete: the id of the node to delete. */
    id: ID;

    /** Insert only: the content. */
    value?: Item;

    /** Insert only: the node to insert after. Missing = top of the document. */
    parent?: ID;
}
