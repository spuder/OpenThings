/**
 * Area colors (#99): the palette an area's color is picked from, and the color an area gets.
 * Every choice is an existing list token in app.css, so areas add no new colors to the app. Calendar
 * apps can't read CSS tokens, so each choice also has a fixed hex (its light-mode value, for CalDAV
 * `calendar-color` and `X-APPLE-CALENDAR-COLOR`) and the nearest CSS color name (RFC 7986 `COLOR`
 * only takes names). Pure, shared by the app and the server.
 */

export interface ColorChoice {
  id: string;
  label: string;
  /** CSS custom property in app.css. */
  token: string;
  hex: string;
  /** Nearest CSS3 color name, for iCalendar COLOR. */
  css: string;
}

export const COLORS: ColorChoice[] = [
  { id: 'blue', label: 'Blue', token: '--inbox', hex: '#2f86ed', css: 'dodgerblue' },
  { id: 'teal', label: 'Teal', token: '--anytime', hex: '#2aa198', css: 'lightseagreen' },
  { id: 'orange', label: 'Orange', token: '--habits', hex: '#e3743b', css: 'chocolate' },
  { id: 'purple', label: 'Purple', token: '--matrix', hex: '#8a63d2', css: 'mediumpurple' },
  { id: 'green', label: 'Green', token: '--logbook', hex: '#3fa66b', css: 'mediumseagreen' },
  { id: 'indigo', label: 'Indigo', token: '--week', hex: '#5e5ce6', css: 'slateblue' },
  { id: 'gold', label: 'Gold', token: '--dump', hex: '#c79a3b', css: 'goldenrod' },
  { id: 'slate', label: 'Slate blue', token: '--evening', hex: '#5a78d1', css: 'royalblue' },
  { id: 'tan', label: 'Tan', token: '--someday', hex: '#b8a27a', css: 'tan' },
  { id: 'red', label: 'Red', token: '--upcoming', hex: '#e0453c', css: 'tomato' },
  { id: 'yellow', label: 'Yellow', token: '--star', hex: '#f2b72e', css: 'gold' },
];

/** Areas with no color of their own cycle through these, in sidebar order. */
const AUTOMATIC = COLORS.slice(0, 10);

/** Blocks and events with no area. */
export const NO_AREA = { token: '--text-3', hex: '#a1a1a6', css: 'darkgray' } as const;

export function colorChoice(id: string | null | undefined): ColorChoice | undefined {
  return id ? COLORS.find((c) => c.id === id) : undefined;
}

type AreaLike = { id: string; color?: string | null };

/** The color an area shows: the one picked for it, else automatic by its place in the sidebar. Undefined for no or an unknown area. */
export function areaColor(areaId: string | null | undefined, areas: AreaLike[]): ColorChoice | undefined {
  const i = areaId ? areas.findIndex((a) => a.id === areaId) : -1;
  if (i < 0) return undefined;
  return colorChoice(areas[i].color) ?? AUTOMATIC[i % AUTOMATIC.length];
}

/** The same, as a CSS color for the app. */
export function areaCss(areaId: string | null | undefined, areas: AreaLike[]): string {
  return `var(${areaColor(areaId, areas)?.token ?? NO_AREA.token})`;
}
