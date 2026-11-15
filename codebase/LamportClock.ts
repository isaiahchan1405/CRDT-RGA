/**
 * A logical clock: a counter that only moves forward.
 *
 * It doesn't measure real time, it orders events. Anything created after a
 * client has seen time t gets a time greater than t.
 */
export class LamportClock {
    constructor(public currTime = 0) {}

    /** Step forward before stamping a new local event. */
    public tick(): void {
        this.currTime++;
    }

    /** Catch up to a time seen elsewhere. Never moves backwards. */
    public update(observedTime: number): void {
        if (!Number.isFinite(observedTime)) return; // e.g. NaN from the root id
        this.currTime = Math.max(this.currTime, observedTime);
    }

    public getCurrTime(): number {
        return this.currTime;
    }

    /** Careful: after a reset this client can reuse ids it already gave out. */
    public reset(): void {
        this.currTime = 0;
    }
}
