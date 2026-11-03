/**
 * Sends to one messenger at a steady pace: each take() waits for its turn, perSecond turns a second. pause() holds
 * every turn for a while (the messenger answered «too many requests»).
 */
export class RateLimiter {
  private next = 0;
  private pausedUntil = 0;

  constructor(private readonly perSecond: number) {}

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const at = Math.max(now, this.next, this.pausedUntil);
      if (at <= now) {
        this.next = now + 1000 / this.perSecond;
        return;
      }
      // waits, then looks again: a pause may have come meanwhile
      await new Promise((resolve) => setTimeout(resolve, at - now));
    }
  }

  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }
}
