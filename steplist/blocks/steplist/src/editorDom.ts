import { merge, PLAIN, type Segment, type Style } from "./richText"

/**
 * The editable text's DOM, kept outside React. React re-rendering a
 * contenteditable element moves the caret and fights the browser, so the
 * editor draws runs into the element itself and reads the selection back as
 * character offsets into the plain text.
 */

/** Class names for one run, shared with the stylesheet. */
export function runClasses(segment: Style): string {
  return [
    segment.bold && "rt-bold",
    segment.italic && "rt-italic",
    segment.underline && "rt-underline",
    segment.strikethrough && "rt-strike",
    segment.href && "rt-link",
    segment.colour !== "default" && `c-${segment.colour}`,
  ]
    .filter(Boolean)
    .join(" ")
}

/** Replace the element's content with the runs. */
export function renderRuns(root: HTMLElement, segments: Segment[]): void {
  const nodes: Node[] = segments.map((segment, index) => {
    const span = document.createElement("span")
    span.dataset.run = String(index)
    const classes = runClasses(segment)
    if (classes) span.className = classes
    if (segment.href) span.title = segment.href
    if (segment.code) {
      const code = document.createElement("code")
      code.className = "rt-code"
      code.textContent = segment.text
      span.append(code)
    } else {
      span.textContent = segment.text
    }
    return span
  })
  // A trailing line break only shows (and only takes the caret) when something
  // follows it, so a final newline gets a placeholder <br>.
  if (segments.at(-1)?.text.endsWith("\n")) {
    const br = document.createElement("br")
    br.dataset.filler = ""
    nodes.push(br)
  }
  root.replaceChildren(...nodes)
}

/**
 * Read the element back into runs, for the few edits the browser makes itself
 * (composing accented or East Asian text). Text keeps the style of the run it
 * landed in.
 */
export function readRuns(root: HTMLElement, previous: Segment[]): Segment[] {
  const segments: Segment[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) {
      if (!("filler" in node.dataset)) segments.push({ ...PLAIN, text: "\n" })
      continue
    }
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent) continue
    const run = (node.parentElement?.closest("[data-run]") as HTMLElement | null)?.dataset.run
    const source = run === undefined ? undefined : previous[Number(run)]
    const { text: _text, ...style } = source ?? { ...PLAIN, text: "" }
    segments.push({ ...style, text: node.textContent })
  }
  return merge(segments)
}

/** The character offset of a DOM position inside the element. */
export function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return 0
  }
  return range.toString().length
}

export type Offsets = { start: number; end: number }

/** The current selection as offsets, or null if it is not inside the element. */
export function readSelection(root: HTMLElement): Offsets | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  }
}

function positionAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.length) return { node, offset: remaining }
    remaining -= node.length
    last = node
  }
  return last ? { node: last, offset: last.length } : { node: root, offset: 0 }
}

/** Select [start, end) inside the element. */
export function writeSelection(root: HTMLElement, { start, end }: Offsets): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return
  const from = positionAt(root, start)
  const to = positionAt(root, end)
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Where the current selection sits, relative to another element. */
export function selectionBox(relativeTo: HTMLElement): DOMRect | null {
  const selection = relativeTo.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const rects = selection.getRangeAt(0).getClientRects()
  const last = rects[rects.length - 1]
  const first = rects[0]
  if (!first || !last) return null
  const origin = relativeTo.getBoundingClientRect()
  const left = Math.min(first.left, last.left) - origin.left
  return new DOMRect(left, first.top - origin.top, last.right - origin.left - left, last.bottom - first.top)
}
