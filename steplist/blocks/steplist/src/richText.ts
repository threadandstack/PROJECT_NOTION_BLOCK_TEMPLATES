/**
 * Rich text for the Stepline's editable text: the run model, pure edit
 * functions and the stored form. Copied from the tilting callout's callout.ts
 * per the text-editor skill (.agents/skills/text-editor); keep the two in step.
 */

/**
 * The colours a span of Notion text can take: a plain hue colours the text, a
 * `_background` hue tints the fill behind it. These are Notion's own tokens.
 */
export const HUES = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const

export type Hue = (typeof HUES)[number]

export type NotionColour = "default" | Hue | `${Hue}_background`

/** The display name for a colour in the picker, in Notion's own words. */
export function colourLabel(colour: NotionColour): string {
  if (colour === "default") return "Default"
  const hue = colour.replace(/_background$/, "")
  const name = hue.charAt(0).toUpperCase() + hue.slice(1)
  return colour.endsWith("_background") ? `${name} background` : name
}

// ─── Rich text ─────────────────────────────────────────────────────────────

/** One run of text sharing the same formatting. */
export type Segment = {
  text: string
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  /** A Notion colour token; `default` for none. */
  colour: string
  href?: string
}

export type Style = Omit<Segment, "text">

/** The marks the toolbar toggles on and off. */
export type Mark = "bold" | "italic" | "underline" | "strikethrough" | "code"

export const PLAIN: Style = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  colour: "default",
}

/** Notion caps a single rich text item at 2,000 characters. */
const MAX_ITEM_LENGTH = 2000

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strikethrough === b.strikethrough &&
    a.underline === b.underline &&
    a.code === b.code &&
    a.colour === b.colour &&
    a.href === b.href
  )
}

function styleOf(segment: Segment): Style {
  const { text: _text, ...style } = segment
  return style
}

/** Join neighbouring runs that format identically, and drop empty ones. */
export function merge(segments: Segment[]): Segment[] {
  const merged: Segment[] = []
  for (const segment of segments) {
    if (!segment.text) continue
    const last = merged[merged.length - 1]
    if (last && sameStyle(last, segment)) {
      last.text += segment.text
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

export function plainText(segments: Segment[]): string {
  return segments.map((segment) => segment.text).join("")
}

export function fromPlainText(text: string): Segment[] {
  return merge([{ ...PLAIN, text }])
}

export function sameSegments(a: Segment[], b: Segment[]): boolean {
  return toStored(a) === toStored(b)
}

type RichTextItem = {
  type: "text"
  text: { content: string; link?: { url: string } }
  annotations?: Partial<{
    bold: true
    italic: true
    strikethrough: true
    underline: true
    code: true
    color: string
  }>
}

/**
 * Write runs as Notion rich text items, splitting any that are too long.
 *
 * Only what is set is sent. Notion's public API takes `link: null` and a full
 * set of `false` annotations, but the custom block host does not: it drops the
 * whole write without answering, so the save just times out. An absent field
 * means "none" to both, so leaving them out is always safe.
 */
export function toNotionRichText(segments: Segment[]): RichTextItem[] {
  return merge(segments).flatMap((segment) => {
    const annotations: NonNullable<RichTextItem["annotations"]> = {}
    if (segment.bold) annotations.bold = true
    if (segment.italic) annotations.italic = true
    if (segment.strikethrough) annotations.strikethrough = true
    if (segment.underline) annotations.underline = true
    if (segment.code) annotations.code = true
    if (segment.colour !== "default") annotations.color = segment.colour

    const chunks: string[] = []
    for (let start = 0; start < segment.text.length; start += MAX_ITEM_LENGTH) {
      chunks.push(segment.text.slice(start, start + MAX_ITEM_LENGTH))
    }
    return chunks.map((content) => ({
      type: "text" as const,
      text: segment.href ? { content, link: { url: segment.href } } : { content },
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    }))
  })
}

// ─── Editing ───────────────────────────────────────────────────────────────
//
// The editor works on character offsets into the plain text (UTF-16 units, the
// same units the browser's selection uses), so every edit is a pure function
// from runs to runs and can be tested without a browser.

type Char = { char: string; style: Style }

function explode(segments: Segment[]): Char[] {
  const chars: Char[] = []
  for (const segment of segments) {
    const style = styleOf(segment)
    for (let i = 0; i < segment.text.length; i++) chars.push({ char: segment.text[i], style })
  }
  return chars
}

function implode(chars: Char[]): Segment[] {
  return merge(chars.map(({ char, style }) => ({ ...style, text: char })))
}

/** Restyle the characters in [start, end). */
export function applyStyle(
  segments: Segment[],
  start: number,
  end: number,
  patch: Partial<Style>
): Segment[] {
  return implode(
    explode(segments).map((entry, index) =>
      index >= start && index < end ? { char: entry.char, style: { ...entry.style, ...patch } } : entry
    )
  )
}

/** Whether every character in [start, end) carries the mark. */
export function hasMark(segments: Segment[], start: number, end: number, mark: Mark): boolean {
  const chars = explode(segments).slice(start, end)
  return chars.length > 0 && chars.every((entry) => entry.style[mark])
}

/** The value shared by every character in [start, end), or undefined if they differ. */
export function sharedValue<K extends "colour" | "href">(
  segments: Segment[],
  start: number,
  end: number,
  key: K
): Style[K] | undefined {
  const chars = explode(segments).slice(start, end)
  if (chars.length === 0) return undefined
  const first = chars[0].style[key]
  return chars.every((entry) => entry.style[key] === first) ? first : undefined
}

/** Turn a mark on across the range, or off if the whole range already has it. */
export function toggleMark(segments: Segment[], start: number, end: number, mark: Mark): Segment[] {
  return applyStyle(segments, start, end, { [mark]: !hasMark(segments, start, end, mark) })
}

/** Strip every mark and colour from the range. Links stay, as in Notion. */
export function clearFormatting(segments: Segment[], start: number, end: number): Segment[] {
  const { colour, bold, italic, strikethrough, underline, code } = PLAIN
  return applyStyle(segments, start, end, { colour, bold, italic, strikethrough, underline, code })
}

/**
 * Replace [start, end) with typed text, formatted as in Notion: typing over a
 * selection keeps the selection's formatting, and typing at a caret continues
 * the character before it, except that a link or inline code does not grow
 * past its end.
 */
export function replaceRange(segments: Segment[], start: number, end: number, text: string): Segment[] {
  const chars = explode(segments)
  const before = (start < end ? chars[start] : chars[start - 1])?.style ?? chars[end]?.style ?? PLAIN
  const continues = chars[end]?.style
  const style: Style = { ...before }
  if (style.href && continues?.href !== style.href) delete style.href
  if (style.code && !continues?.code) style.code = false

  const normalised = text.replace(/\r\n?/g, "\n")
  const typed: Char[] = []
  for (let i = 0; i < normalised.length; i++) typed.push({ char: normalised[i], style })
  return implode([...chars.slice(0, start), ...typed, ...chars.slice(end)])
}

// ─── Storage ───────────────────────────────────────────────────────────────
//
// Notion's custom block bridge flattens title formatting in both directions, so
// formatted text is also kept as compact JSON in a plain field the bridge
// carries faithfully. For the Stepline's heading that field is the title row's
// Detail, which a title row has no other use for.

type StoredRun = {
  t: string
  b?: 1
  i?: 1
  s?: 1
  u?: 1
  c?: 1
  k?: string
  h?: string
}

export function toStored(segments: Segment[]): string {
  const runs = merge(segments).map((segment) => {
    const run: StoredRun = { t: segment.text }
    if (segment.bold) run.b = 1
    if (segment.italic) run.i = 1
    if (segment.strikethrough) run.s = 1
    if (segment.underline) run.u = 1
    if (segment.code) run.c = 1
    if (segment.colour !== "default") run.k = segment.colour
    if (segment.href) run.h = segment.href
    return run
  })
  return JSON.stringify({ v: 1, r: runs })
}

/** Read stored runs, or null if the value is missing or not ours. */
export function fromStored(value: unknown): Segment[] | null {
  if (typeof value !== "string" || !value.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  const runs = (parsed as { v?: unknown; r?: unknown })?.r
  if ((parsed as { v?: unknown })?.v !== 1 || !Array.isArray(runs)) return null

  const segments: Segment[] = []
  for (const raw of runs) {
    const run = raw as Partial<StoredRun>
    if (typeof run?.t !== "string") return null
    segments.push({
      text: run.t,
      bold: run.b === 1,
      italic: run.i === 1,
      strikethrough: run.s === 1,
      underline: run.u === 1,
      code: run.c === 1,
      colour: typeof run.k === "string" ? run.k : "default",
      ...(typeof run.h === "string" ? { href: run.h } : {}),
    })
  }
  return merge(segments)
}
