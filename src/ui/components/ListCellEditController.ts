/**
 * ListCellEditController -- pure state machine behind the inline list-value
 * editor in EditableCell.
 *
 * It owns BOTH the committed chips and the in-progress input buffer, which is
 * the key property that fixes the "manually added entry written twice" bug:
 * adding a chip clears the buffer here, so any stray flush (e.g. a blur that
 * fires when the DOM input loses focus) finds an empty buffer and cannot
 * re-add the value. A `finished` latch makes commit idempotent, so the
 * Enter/Tab/blur paths can never commit the same edit twice.
 *
 * The class is DOM-free so it can be unit-tested in the node test env.
 */
export interface ListCommit {
  /** The value to persist, or undefined to delete the property. */
  value: string[] | undefined;
}

export class ListCellEditController {
  private readonly initial: string[];
  private items: string[];
  private buffer = "";
  private finished = false;

  constructor(initial: string[]) {
    this.initial = [...initial];
    this.items = [...initial];
  }

  /** Snapshot of the current chips. A copy -- callers cannot mutate state. */
  get itemsView(): string[] {
    return [...this.items];
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Mirror the live input text into the controller. */
  setBuffer(text: string): void {
    this.buffer = text;
  }

  /**
   * Commit the buffered text as a chip and clear the buffer. Returns true if a
   * chip was added. A blank buffer adds nothing but is still cleared.
   */
  addBuffered(): boolean {
    const v = this.buffer.trim();
    this.buffer = "";
    if (!v) return false;
    this.items.push(v);
    return true;
  }

  /** Backspace-on-empty semantics: pop the last chip only if not mid-typing. */
  removeLast(): boolean {
    if (this.buffer !== "" || this.items.length === 0) return false;
    this.items.pop();
    return true;
  }

  /** Remove a chip by index (chip "x" button). */
  removeAt(idx: number): void {
    this.items.splice(idx, 1);
  }

  /**
   * Flush the buffer and produce the value to persist. Idempotent: only the
   * first finishing call returns a commit; later calls return null.
   */
  commit(): ListCommit | null {
    if (this.finished) return null;
    this.flushBuffer();
    this.finished = true;
    return { value: this.toValue() };
  }

  /**
   * Blur semantics: flush the buffer, then commit only if the list actually
   * changed; otherwise return "unchanged" so the host can exit edit mode
   * without a write. Idempotent like {@link commit}.
   */
  commitIfChanged(): ListCommit | "unchanged" | null {
    if (this.finished) return null;
    this.flushBuffer();
    this.finished = true;
    if (!this.changed()) return "unchanged";
    return { value: this.toValue() };
  }

  /** Abandon the edit (Esc). Blocks any later commit. */
  cancel(): void {
    this.finished = true;
  }

  private flushBuffer(): void {
    const v = this.buffer.trim();
    this.buffer = "";
    if (v) this.items.push(v);
  }

  private toValue(): string[] | undefined {
    return this.items.length === 0 ? undefined : [...this.items];
  }

  private changed(): boolean {
    return (
      this.items.length !== this.initial.length ||
      this.items.some((it, i) => it !== this.initial[i])
    );
  }
}
