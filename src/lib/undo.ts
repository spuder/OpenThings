/** A bounded stack of undo steps. Each step knows how to reverse one user action. */
export interface UndoStep {
  label: string;
  run: () => void;
}

export class UndoStack {
  private steps: UndoStep[] = [];
  constructor(private limit = 50) {}

  push(label: string, run: () => void) {
    this.steps.push({ label, run });
    if (this.steps.length > this.limit) this.steps.shift();
  }

  /** Reverse the latest action. Returns its label, or null when there is nothing to undo. */
  undo(): string | null {
    const step = this.steps.pop();
    if (!step) return null;
    step.run();
    return step.label;
  }

  get size() {
    return this.steps.length;
  }

  clear() {
    this.steps = [];
  }
}

/** The previous values of `fields` on `row`, so an update can be reversed. */
export function previousValues<T extends object>(row: T, fields: Partial<T>): Partial<T> {
  const prev: Partial<T> = {};
  for (const k of Object.keys(fields) as (keyof T)[]) prev[k] = row[k];
  return prev;
}
