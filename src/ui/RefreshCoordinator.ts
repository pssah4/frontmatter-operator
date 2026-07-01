/**
 * RefreshCoordinator -- decides WHEN the live view should refresh.
 *
 * Policy: refresh on every vault change so the table never shows stale data,
 * EXCEPT while a batch operation (bulk edit, snapshot restore, AI generate)
 * is running. A batch writes many notes; refreshing per note would redraw the
 * table dozens of times and fight the running job. Instead the coordinator
 * suspends refreshes for the duration of the batch and fires a single refresh
 * once it finishes -- but only if something actually changed.
 *
 * Pure and DOM-free so the policy is unit-tested independently of Obsidian.
 * The `flush` callback is where the host schedules its (debounced) redraw.
 */
export class RefreshCoordinator {
  private depth = 0;
  private pending = false;

  constructor(private readonly flush: () => void) {}

  /** True while one or more batch operations are in progress. */
  get isSuspended(): boolean {
    return this.depth > 0;
  }

  /** Enter a batch. Nestable. */
  beginBatch(): void {
    this.depth++;
  }

  /** Leave a batch. Flushes once when the outermost batch ends and at least
   *  one change was requested while suspended. Unbalanced calls are ignored. */
  endBatch(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth === 0 && this.pending) {
      this.pending = false;
      this.flush();
    }
  }

  /** A change happened. Flush now, or remember it for the end of the batch. */
  request(): void {
    if (this.depth > 0) {
      this.pending = true;
      return;
    }
    this.flush();
  }
}
