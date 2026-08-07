export class LamportClock {
    private currTime: number;

    constructor(startTime = 0) {
        this.currTime = startTime;
    }

    public update(): void {
        this.currTime++;
    }

    public getCurrTime(): number {
        return this.currTime;
    }

    public reset(): void {
        this.currTime = 0
    }
}