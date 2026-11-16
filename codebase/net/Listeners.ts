import { Unsubscribe } from "./Transport";

/** A set of callbacks that can all be called at once. */
export class Listeners<Args extends unknown[]> {
    private listeners = new Set<(...args: Args) => void>();

    add(listener: (...args: Args) => void): Unsubscribe {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(...args: Args): void {
        for (const listener of [...this.listeners]) listener(...args);
    }

    clear(): void {
        this.listeners.clear();
    }
}
