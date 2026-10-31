/**
 * Letter shortcuts for palette menus (the area and project menus). Pure helpers, used by
 * Palette.svelte. A key runs its option only while the filter is empty, so typing still
 * filters once a query has started.
 */

export interface MenuOption {
  label: string;
  hint?: string;
  /** Single letter that runs this option; shown underlined in the label and as a key chip. */
  key?: string;
  /** Icon name from Icon.svelte. */
  icon?: string;
  /** Destructive: the label is red. */
  danger?: boolean;
  /** A color dot before the label (CSS color), e.g. in the area color menu. */
  swatch?: string;
  run: () => void;
}

/** The option whose letter is `key`, when the filter is empty and no modifier is held. */
export function optionForKey<T extends Pick<MenuOption, 'key'>>(
  options: T[],
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean },
  query: string,
): T | undefined {
  if (query || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return undefined;
  const k = e.key.toLowerCase();
  return options.find((o) => o.key?.toLowerCase() === k);
}

/** Split a label around the first occurrence of its letter, for underlining: ["Re", "m", "ove"]. */
export function splitMnemonic(label: string, key: string | undefined): [string, string, string] | null {
  if (!key) return null;
  const i = label.toLowerCase().indexOf(key.toLowerCase());
  if (i < 0) return null;
  return [label.slice(0, i), label.slice(i, i + 1), label.slice(i + 1)];
}
