import type { NotionPropertyOption } from "@notionhq/custom-blocks"
import { useEffect, useRef } from "react"
import { pillForOption, type StatusGroup } from "./steps"

type StatusMenuProps = {
  groups: StatusGroup[]
  value: string | undefined
  /** Where to open, relative to the stepline: just below the pill or bullet clicked. */
  anchor: { left: number; top: number }
  onPick: (option: NotionPropertyOption) => void
  onClose: () => void
  menuRef: (node: HTMLDivElement | null) => void
}

/**
 * The status dropdown, kept as quiet as Notion's own: a small card listing the
 * options as pills under their group names, the current one ticked. Picking one
 * applies it at once. Escape, a click elsewhere or focus leaving closes it.
 */
export function StatusMenu({ groups, value, anchor, onPick, onClose, menuRef }: StatusMenuProps) {
  const card = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const current = card.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    ;(current ?? card.current?.querySelector<HTMLButtonElement>("button"))?.focus()

    function onPointerDown(event: MouseEvent) {
      if (!card.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [onClose])

  return (
    <div
      ref={(node) => {
        card.current = node
        menuRef(node)
      }}
      className="status-dropdown"
      role="menu"
      aria-label="Status"
      style={{ left: anchor.left, top: anchor.top }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          const items = [...(card.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
          const at = items.indexOf(document.activeElement as HTMLButtonElement)
          const next = items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]
          next?.focus()
        }
      }}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !card.current?.contains(event.relatedTarget)) onClose()
      }}
    >
      {groups.map((group) => (
        <div key={group.name || "options"} className="status-dropdown-group">
          {group.name ? <div className="status-dropdown-label">{group.name}</div> : null}
          {group.options.map((option) => {
            const selected = option.name === value
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="status-dropdown-item"
                onClick={() => {
                  onClose()
                  if (!selected) onPick(option)
                }}
              >
                <span className={`status-tag pill-${pillForOption(option.color)}`}>{option.name}</span>
                {selected ? <Tick /> : null}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Tick() {
  return (
    <svg className="status-dropdown-tick" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.5 6.2 5 8.7l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
