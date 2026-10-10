import { useLayoutEffect } from "react"

/**
 * Grow the block to make room for a popover.
 *
 * The block is an iframe sized to its content, and an absolutely positioned
 * menu adds no height, so it would be cut off at the iframe's edge. While the
 * popover is open the container is given a minimum height that reaches past it,
 * which the SDK's auto-resize passes on to Notion.
 *
 * The height is applied on the next animation frame, never inside the resize
 * notification itself: changing layout there trips the browser's "ResizeObserver
 * loop" error, which the host treats as the block crashing.
 */
export function usePopoverSpace(container: HTMLElement | null, popover: HTMLElement | null): void {
  useLayoutEffect(() => {
    if (!container || !popover) return
    let frame: number | null = null
    const reserve = () => {
      const height = `${popover.offsetTop + popover.offsetHeight + 8}px`
      if (container.style.minHeight !== height) container.style.minHeight = height
    }
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        reserve()
      })
    }
    reserve()
    const observer = new ResizeObserver(schedule)
    observer.observe(popover)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      container.style.minHeight = ""
    }
  }, [container, popover])
}
