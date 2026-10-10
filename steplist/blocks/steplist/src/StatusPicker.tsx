import type { NotionPropertyOption } from "@notionhq/custom-blocks"
import { useEffect, useId, useRef, useState } from "react"

type StatusPickerProps = {
  options: NotionPropertyOption[]
  value: string | undefined
  disabled?: boolean
  onSelect: (option: NotionPropertyOption) => void
}

/**
 * A small status menu. Notion's own select popovers are not available to a
 * sandboxed block, so this is a plain listbox — closed on outside click, on
 * Escape, and on selection.
 */
export function StatusPicker({
  options,
  value,
  disabled,
  onSelect,
}: StatusPickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  if (options.length === 0) {
    return (
      <p className="field-note">
        No status options are available. Bind the Status slot to a Status
        property to set one here.
      </p>
    )
  }

  return (
    <div className="status-picker" ref={containerRef}>
      <button
        type="button"
        className="status-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`status-swatch swatch-${colorOf(options, value)}`} />
        {value ?? "Set status"}
      </button>

      {open ? (
        <ul className="status-menu" id={listId} role="listbox">
          {options.map((option) => (
            <li key={option.id} role="none">
              <button
                type="button"
                role="option"
                aria-selected={option.name === value}
                className="status-option"
                onClick={() => {
                  setOpen(false)
                  onSelect(option)
                }}
              >
                <span
                  className={`status-swatch swatch-${option.color ?? "default"}`}
                />
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function colorOf(
  options: NotionPropertyOption[],
  value: string | undefined
): string {
  return options.find((option) => option.name === value)?.color ?? "default"
}
