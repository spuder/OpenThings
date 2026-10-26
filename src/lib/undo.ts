/** A bounded stack of undo steps. Each step knows how to reverse one user action. */
export interface UndoStep {
  label: string;
  run: () => void;
}

export class UndoStack {
  private steps: UndoStep[] = [];
  /** Steps collected inside `group()`, undone together as one. */
  private open: UndoStep[] | null = null;
  constructor(private limit = 50) {}

  push(label: string, run: () => void) {
    if (this.open) {
      this.open.push({ label, run });
      return;
    }
    this.steps.push({ label, run });
    if (this.steps.length > this.limit) this.steps.shift();
  }

  /**
   * Run `fn` and make every step it pushes a single undo step called `label` (bulk actions on a
   * multi-selection). Steps are reversed newest first. Nested groups join the outer one.
   */
  group(label: string, fn: () => void) {
    if (this.open) return fn();
    const steps: UndoStep[] = [];
    this.open = steps;
    try {
      fn();
    } finally {
      this.open = null;
      if (steps.length === 1) this.push(steps[0].label, steps[0].run);
      else if (steps.length) this.push(label, () => { for (const s of [...steps].reverse()) s.run(); });
    }
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
