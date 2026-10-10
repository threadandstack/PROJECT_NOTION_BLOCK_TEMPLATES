import { useRef, useState, type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent } from "react"

/** How far the pointer must travel before a press on a bullet becomes a drag. */
const DRAG_THRESHOLD_PX = 4

export type DragState = {
  /** The step being dragged. */
  from: number
  /** Where it would land: its index once dropped. */
  to: number
  /** The drop line's offset from the top of the list. */
  top: number
}

type Options = {
  list: HTMLElement | null
  count: number
  disabled: boolean
  onDrop: (from: number, to: number) => void
}

/**
 * Drag a step by its bullet to move it, as Notion's block handle does: press,
 * drag, and a blue line shows where it will land; let go to drop it. A press
 * that doesn't move is not a drag (and does nothing). ⌘⇧↑ / ⌘⇧↓ on a focused
 * bullet moves the step without a mouse, Notion's shortcut for moving blocks.
 *
 * Pointer events with capture rather than HTML drag and drop: they behave the
 * same for mouse, pen and touch, and keep tracking even if the pointer leaves
 * the bullet or the iframe.
 */
export function useDragReorder({ list, count, disabled, onDrop }: Options) {
  const session = useRef<{ index: number; startY: number; active: boolean } | null>(null)
  const latest = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  function update(next: DragState | null) {
    latest.current = next
    setDrag(next)
  }

  /** The landing index and drop-line position for a pointer at viewport y. */
  function target(from: number, y: number): DragState | null {
    if (!list) return null
    // Steps only: the drop line is a list item too.
    const rows = [...list.children].filter(
      (node): node is HTMLLIElement => node instanceof HTMLLIElement && node.classList.contains("step")
    )
    const others = rows.filter((_, index) => index !== from)
    if (others.length === 0) return null
    const origin = list.getBoundingClientRect().top
    // Land after every other step whose middle is above the pointer.
    const to = others.filter((row) => {
      const box = row.getBoundingClientRect()
      return y > box.top + box.height / 2
    }).length
    const top =
      to < others.length
        ? others[to].getBoundingClientRect().top - origin
        : others[others.length - 1].getBoundingClientRect().bottom - origin
    return { from, to, top }
  }

  function end() {
    session.current = null
    update(null)
  }

  function handleProps(index: number): ButtonHTMLAttributes<HTMLButtonElement> {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (disabled || count < 2 || event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        session.current = { index, startY: event.clientY, active: false }
      },
      onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
        const current = session.current
        if (!current) return
        if (!current.active) {
          if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return
          current.active = true
        }
        update(target(current.index, event.clientY))
      },
      onPointerUp() {
        const dropped = session.current?.active ? latest.current : null
        end()
        if (dropped && dropped.to !== dropped.from) onDrop(dropped.from, dropped.to)
      },
      onPointerCancel: end,
      onLostPointerCapture() {
        if (session.current) end()
      },
      onKeyDown(event) {
        if (disabled || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0
        if (!step) return
        event.preventDefault()
        const to = index + step
        if (to >= 0 && to < count) onDrop(index, to)
      },
    }
  }

  return { drag, handleProps }
}
