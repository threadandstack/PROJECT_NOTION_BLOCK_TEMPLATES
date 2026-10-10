import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  applyStyle,
  clearFormatting,
  hasMark,
  replaceRange,
  sameSegments,
  sharedValue,
  toggleMark,
  type Mark,
  type Segment,
} from "./richText"
import { offsetOf, readRuns, readSelection, renderRuns, selectionBox, writeSelection, type Offsets } from "./editorDom"
import { FormatToolbar, type Panel, type ToolbarState } from "./FormatToolbar"
import { usePopoverSpace } from "./usePopoverSpace"

type InlineTextProps = {
  /** The saved text. Ignored while the text is being edited. */
  segments: Segment[]
  placeholder: string
  /** The callout's root, which the selection menu is positioned in. */
  container: HTMLElement | null
  /** Called when editing ends with changed text. */
  onCommit: (segments: Segment[]) => void
  onEditingChange: (editing: boolean) => void
}

type Snapshot = { segments: Segment[]; selection: Offsets }

type Menu = ToolbarState & { anchor: { left: number; top: number }; selection: Offsets; startWith: Panel }

const MARK_KEYS: Record<string, Mark> = { b: "bold", i: "italic", u: "underline", e: "code" }

/**
 * The callout's text, edited in place as in Notion: click and type, select to
 * format. Every change goes through the run model (so formatting is exact and
 * undo works) and the DOM is redrawn from it; the browser is only left to its
 * own devices while composing accented or East Asian characters.
 *
 * Nothing is written while typing. The text is saved once, when focus leaves
 * it, so a burst of edits is one write to Notion.
 */
export function InlineText({ segments, placeholder, container, onCommit, onEditingChange }: InlineTextProps) {
  const root = useRef<HTMLDivElement>(null)
  const model = useRef<Segment[]>(segments)
  const editing = useRef(false)
  const history = useRef<{ undo: Snapshot[]; redo: Snapshot[]; lastTyped: number }>({
    undo: [],
    redo: [],
    lastTyped: 0,
  })
  const [menu, setMenu] = useState<Menu | null>(null)
  const [menuNode, setMenuNode] = useState<HTMLDivElement | null>(null)
  const menuKey = useRef(0)

  usePopoverSpace(container, menu ? menuNode : null)

  // Show the saved text whenever it is not being edited.
  useLayoutEffect(() => {
    const node = root.current
    if (!node || editing.current) return
    model.current = segments
    renderRuns(node, segments)
  }, [segments])

  const describe = useCallback(
    (selection: Offsets, startWith: Panel = "none"): Menu | null => {
      const node = root.current
      if (!node || !container || selection.start === selection.end) return null
      const box = selectionBox(container)
      if (!box) return null
      const runs = model.current
      const { start, end } = selection
      return {
        selection,
        startWith,
        anchor: { left: box.left, top: box.bottom + 6 },
        marks: {
          bold: hasMark(runs, start, end, "bold"),
          italic: hasMark(runs, start, end, "italic"),
          underline: hasMark(runs, start, end, "underline"),
          strikethrough: hasMark(runs, start, end, "strikethrough"),
          code: hasMark(runs, start, end, "code"),
        },
        colour: sharedValue(runs, start, end, "colour"),
        href: sharedValue(runs, start, end, "href"),
      }
    },
    [container]
  )

  /** Apply an edit: record it for undo, redraw, and put the selection back. */
  const change = useCallback(
    (next: Segment[], selection: Offsets, kind: "typing" | "other" = "other") => {
      const node = root.current
      if (!node) return
      const before = readSelection(node) ?? selection
      const now = Date.now()
      const log = history.current
      // Consecutive typing is undone a burst at a time, not a letter at a time.
      if (kind !== "typing" || now - log.lastTyped > 1000) {
        log.undo.push({ segments: model.current, selection: before })
        if (log.undo.length > 100) log.undo.shift()
      }
      log.lastTyped = kind === "typing" ? now : 0
      log.redo = []
      model.current = next
      renderRuns(node, next)
      writeSelection(node, selection)
      setMenu((open) => (open ? describe(selection) : open))
    },
    [describe]
  )

  const restore = useCallback(
    (from: "undo" | "redo") => {
      const node = root.current
      const log = history.current
      const snapshot = log[from].pop()
      if (!node || !snapshot) return
      const other = from === "undo" ? "redo" : "undo"
      log[other].push({ segments: model.current, selection: readSelection(node) ?? snapshot.selection })
      log.lastTyped = 0
      model.current = snapshot.segments
      renderRuns(node, snapshot.segments)
      writeSelection(node, snapshot.selection)
    },
    []
  )

  // Text input arrives as `beforeinput`, which says what the user meant
  // (insert this, delete back a word) before the browser touches the DOM.
  useEffect(() => {
    const node = root.current
    if (!node) return

    function onBeforeInput(event: InputEvent) {
      if (!node) return
      const type = event.inputType
      if (type === "insertCompositionText") return // Left to the browser; read back on compositionend.

      if (type === "historyUndo" || type === "historyRedo") {
        event.preventDefault()
        restore(type === "historyUndo" ? "undo" : "redo")
        return
      }

      const target = event.getTargetRanges()[0]
      const current = readSelection(node)
      const range: Offsets | null = target
        ? {
            start: offsetOf(node, target.startContainer, target.startOffset),
            end: offsetOf(node, target.endContainer, target.endOffset),
          }
        : current
      if (!range) return
      event.preventDefault()

      let text: string | null = null
      if (type === "insertText" || type === "insertReplacementText") {
        text = event.data ?? event.dataTransfer?.getData("text/plain") ?? ""
      } else if (type === "insertFromPaste" || type === "insertFromDrop") {
        text = event.dataTransfer?.getData("text/plain") ?? ""
      } else if (type === "insertParagraph" || type === "insertLineBreak") {
        text = "\n"
      } else if (type.startsWith("delete")) {
        text = ""
        // A plain Backspace/Delete with nothing selected and no target range
        // removes one character.
        if (range.start === range.end && !target) {
          if (type === "deleteContentBackward") range.start = Math.max(0, range.start - 1)
          else if (type === "deleteContentForward") range.end += 1
        }
      } else {
        return // Formatting commands from the browser's own menus are ignored.
      }

      const next = replaceRange(model.current, range.start, range.end, text)
      const caret = range.start + text.length
      change(next, { start: caret, end: caret }, type === "insertText" ? "typing" : "other")
    }

    function onCompositionEnd() {
      if (!node) return
      const selection = readSelection(node) ?? { start: 0, end: 0 }
      change(readRuns(node, model.current), selection)
    }

    node.addEventListener("beforeinput", onBeforeInput)
    node.addEventListener("compositionend", onCompositionEnd)
    return () => {
      node.removeEventListener("beforeinput", onBeforeInput)
      node.removeEventListener("compositionend", onCompositionEnd)
    }
  }, [change, restore])

  // The selection menu follows the selection, as Notion's does.
  useEffect(() => {
    function onSelectionChange() {
      const node = root.current
      if (!node || !editing.current) return
      // While the link field has focus the text has none; keep the menu open.
      if (menuNode?.contains(document.activeElement)) return
      const selection = readSelection(node)
      setMenu(selection && selection.start !== selection.end ? describe(selection) : null)
    }
    document.addEventListener("selectionchange", onSelectionChange)
    return () => document.removeEventListener("selectionchange", onSelectionChange)
  }, [describe, menuNode])

  function format(edit: (runs: Segment[], start: number, end: number) => Segment[]) {
    const selection = menu?.selection ?? (root.current && readSelection(root.current))
    if (!selection || selection.start === selection.end) return
    change(edit(model.current, selection.start, selection.end), selection)
  }

  function finish() {
    editing.current = false
    setMenu(null)
    history.current.lastTyped = 0
    onEditingChange(false)
    if (!sameSegments(model.current, segments)) onCommit(model.current)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const command = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (event.key === "Escape" || (command && event.key === "Enter")) {
      event.preventDefault()
      root.current?.blur()
    } else if (command && key === "z") {
      event.preventDefault()
      restore(event.shiftKey ? "redo" : "undo")
    } else if (command && key === "y") {
      event.preventDefault()
      restore("redo")
    } else if (command && event.shiftKey && key === "s") {
      event.preventDefault()
      format((runs, start, end) => toggleMark(runs, start, end, "strikethrough"))
    } else if (command && !event.shiftKey && MARK_KEYS[key]) {
      event.preventDefault()
      format((runs, start, end) => toggleMark(runs, start, end, MARK_KEYS[key]))
    } else if (command && key === "k") {
      event.preventDefault()
      const node = root.current
      const selection = node && readSelection(node)
      if (!selection || selection.start === selection.end) return
      menuKey.current += 1
      setMenu(describe(selection, "link"))
    }
  }

  const leaves = (next: EventTarget | null) =>
    !(next instanceof Node) || !(root.current?.contains(next) || menuNode?.contains(next))

  const menuElement =
    menu && container
      ? createPortal(
          <FormatToolbar
            key={menuKey.current}
            {...menu}
            menuRef={setMenuNode}
            onBlur={(event) => {
              if (editing.current && leaves(event.relatedTarget)) finish()
            }}
            onMark={(mark) => format((runs, start, end) => toggleMark(runs, start, end, mark))}
            onColour={(colour) => format((runs, start, end) => applyStyle(runs, start, end, { colour }))}
            onClear={() => format(clearFormatting)}
            onLink={(href) =>
              format((runs, start, end) => applyStyle(runs, start, end, { href: href ?? undefined }))
            }
            onDone={() => {
              const node = root.current
              if (!node) return
              node.focus()
              writeSelection(node, menu.selection)
            }}
          />,
          container
        )
      : null

  return (
    <>
      <div
        ref={root}
        className="callout-editable"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Callout text"
        data-placeholder={placeholder}
        spellCheck
        onFocus={() => {
          if (editing.current) return
          editing.current = true
          history.current = { undo: [], redo: [], lastTyped: 0 }
          onEditingChange(true)
        }}
        onBlur={(event) => {
          if (leaves(event.relatedTarget)) finish()
        }}
        onKeyDown={onKeyDown}
      />
      {menuElement}
    </>
  )
}
