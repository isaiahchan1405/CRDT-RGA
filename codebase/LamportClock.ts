export class LamportClock {
    public currTime: number;

    constructor(startTime = 0) {
        this.currTime = startTime;
    }

    public tick(): void {
        this.currTime++;
    }

    // Called on observing a remote time: never move backwards.
    public update(observedTime: number): void {
        if (Number.isFinite(observedTime)) this.currTime = Math.max(observedTime, this.currTime);
    }

    public getCurrTime(): number {
        return this.currTime;
    }

    public reset(): void {
        this.currTime = 0
    }
}
