import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import type { NotionColour, Mark } from "./richText"
import { ColourGrid } from "./ColourGrid"

export type ToolbarState = {
  marks: Record<Mark, boolean>
  colour: string | undefined
  href: string | undefined
}

type FormatToolbarProps = ToolbarState & {
  /** Where the selection ends, relative to the callout. The menu opens below it. */
  anchor: { left: number; top: number }
  onMark: (mark: Mark) => void
  onColour: (colour: NotionColour) => void
  onClear: () => void
  /** Set a link, or remove it with null. */
  onLink: (href: string | null) => void
  /** Hand focus back to the text, restoring its selection. */
  onDone: () => void
  menuRef: (node: HTMLDivElement | null) => void
  /** Open with a panel showing, e.g. the link field for ⌘K. */
  startWith?: Panel
  onBlur: (event: React.FocusEvent) => void
}

export type Panel = "none" | "colour" | "link"

/**
 * The selection menu, drawn to match Notion's own: a white card of icon
 * buttons, active marks shown in blue. Buttons keep focus in the text (so the
 * selection survives a click); only the link field takes focus.
 */
export function FormatToolbar(props: FormatToolbarProps) {
  const { anchor, marks, colour, href, onMark, onColour, onClear, onLink, onDone, menuRef } = props
  const [panel, setPanel] = useState<Panel>(props.startWith ?? "none")
  const card = useRef<HTMLDivElement | null>(null)
  const [left, setLeft] = useState(anchor.left)

  // Keep the card inside the block: shift it left if it would overflow.
  useLayoutEffect(() => {
    const node = card.current
    const parent = node?.offsetParent as HTMLElement | null
    if (!node || !parent) return
    const max = parent.clientWidth - node.offsetWidth - 8
    setLeft(Math.max(8, Math.min(anchor.left, max)))
  }, [anchor.left, panel])

  const button = (label: string, active: boolean, onClick: () => void, icon: ReactNode, shortcut?: string) => (
    <button
      type="button"
      className={`menu-button ${active ? "is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label}  ${shortcut}` : label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  return (
    <div
      ref={(node) => {
        card.current = node
        menuRef(node)
      }}
      className="format-menu"
      role="toolbar"
      aria-label="Text formatting"
      style={{ left, top: anchor.top }}
      onBlur={props.onBlur}
    >
      <div className="menu-grid">
        {button(
          "Colour",
          panel === "colour",
          () => setPanel(panel === "colour" ? "none" : "colour"),
          <span className={`colour-glyph ${colour && colour !== "default" ? `c-${colour}` : ""}`}>A</span>
        )}
        {button("Bold", marks.bold, () => onMark("bold"), <span className="glyph glyph-bold">B</span>, "⌘B")}
        {button("Italic", marks.italic, () => onMark("italic"), <span className="glyph glyph-italic">I</span>, "⌘I")}
        {button(
          "Underline",
          marks.underline,
          () => onMark("underline"),
          <span className="glyph glyph-underline">U</span>,
          "⌘U"
        )}
        {button("Clear formatting", false, onClear, <ClearIcon />)}
        {button("Link", panel === "link" || Boolean(href), () => setPanel(panel === "link" ? "none" : "link"), <LinkIcon />, "⌘K")}
        {button(
          "Strikethrough",
          marks.strikethrough,
          () => onMark("strikethrough"),
          <span className="glyph glyph-strike">S</span>,
          "⌘⇧S"
        )}
        {button("Code", marks.code, () => onMark("code"), <CodeIcon />, "⌘E")}
      </div>

      {panel === "colour" ? (
        <div className="menu-panel">
          <ColourGrid
            value={colour}
            keepFocus
            onPick={(picked) => {
              onColour(picked)
              setPanel("none")
            }}
          />
        </div>
      ) : null}

      {panel === "link" ? (
        <LinkPanel
          href={href}
          onApply={(next) => {
            onLink(next)
            setPanel("none")
            onDone()
          }}
          onCancel={() => {
            setPanel("none")
            onDone()
          }}
        />
      ) : null}
    </div>
  )
}

function LinkPanel({
  href,
  onApply,
  onCancel,
}: {
  href: string | undefined
  onApply: (href: string | null) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(href ?? "")
  return (
    <div className="menu-panel link-panel">
      <input
        className="menu-input"
        autoFocus
        value={value}
        placeholder="Paste a link…"
        aria-label="Link address"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onApply(normaliseUrl(value))
          } else if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      {href ? (
        <button type="button" className="menu-row-button" onClick={() => onApply(null)}>
          Remove link
        </button>
      ) : null}
    </div>
  )
}

/** Accept "example.com" as Notion does, by assuming https. Empty removes the link. */
export function normaliseUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

// Icons drawn to Notion's 20px grid, using the current text colour.

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M8.6 11.4a3 3 0 0 0 4.2 0l2.7-2.7a3 3 0 0 0-4.2-4.2l-1 1M11.4 8.6a3 3 0 0 0-4.2 0l-2.7 2.7a3 3 0 0 0 4.2 4.2l1-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M7 6 3 10l4 4M13 6l4 4-4 4M11.2 4.5 8.8 15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M3.5 4.5h9M8 4.5v11M12.5 12l4 4M16.5 12l-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
