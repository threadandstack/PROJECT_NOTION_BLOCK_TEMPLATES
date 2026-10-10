import {
  pages,
  type NotionPageId,
  type NotionPagePropertyInputMap,
  type NotionPagePropertyWriteMap,
  type NotionPropertyOption,
} from "@notionhq/custom-blocks"
import { useDataSource } from "@notionhq/custom-blocks/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { InlineText } from "./InlineText"
import { fromPlainText, fromStored, plainText, sameSegments, toNotionRichText, toStored, type Segment } from "./richText"
import { StatusMenu } from "./StatusMenu"
import { Step, type StepEdit } from "./Step"
import {
  findTitleRow,
  inOrder,
  reorder,
  nextPosition,
  statusGroups,
  statusOptions,
  TITLE_ROW_TYPE,
  toSteps,
  type Step as StepModel,
} from "./steps"
import { useDragReorder } from "./useDragReorder"
import { usePopoverSpace } from "./usePopoverSpace"

const DATA_SOURCE_KEY = "steps"
const PAGE_SIZE = 25
const MAX_ROWS = 999

/** A write result from either the per-row helper or the `pages` API. */
type WriteResult = { status: "success" } | { status: "error"; error: { message: string } }

/**
 * How long to wait for the host to answer a write before giving up on it.
 *
 * The bridge resolves a write when the host sends its result back, and a message
 * the host rejects as malformed is simply never answered — so without a deadline
 * one bad write leaves the step disabled for good, with no error to explain it.
 * Ten seconds is far longer than a normal round trip.
 */
const WRITE_TIMEOUT_MS = 10_000

export function App() {
  const [limit, setLimit] = useState(PAGE_SIZE)
  // Editing is a mode for the whole stepline, not a state of each step: reading
  // it should show words, not controls.
  const [editable, setEditable] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  // The status menu: which step it is for and where it opens.
  const [statusMenu, setStatusMenu] = useState<{ stepId: string; anchor: { left: number; top: number } } | null>(
    null
  )
  const [menuNode, setMenuNode] = useState<HTMLDivElement | null>(null)
  usePopoverSpace(root, statusMenu ? menuNode : null)

  const query = useDataSource(DATA_SOURCE_KEY, { limit })
  const { items, propertySchemasByKey, propertyIdsByKey, isLoading, hasMore, error } = query

  const options = useMemo(
    () => statusOptions(propertySchemasByKey.status),
    [propertySchemasByKey.status]
  )
  const groups = useMemo(() => statusGroups(propertySchemasByKey.status), [propertySchemasByKey.status])
  const savedSteps = useMemo(
    () => toSteps(items, propertySchemasByKey.status),
    [items, propertySchemasByKey.status]
  )

  // A dragged step moves at once; this holds the new order until Notion has
  // saved every position, so the list doesn't shuffle as each write lands.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const steps = useMemo(() => inOrder(savedSteps, pendingOrder), [savedSteps, pendingOrder])
  useEffect(() => {
    if (pendingOrder && savedSteps.map((step) => step.id).join() === pendingOrder.join()) setPendingOrder(null)
  }, [savedSteps, pendingOrder])

  /**
   * Run one write, keeping the affected step disabled until it settles and
   * surfacing any failure. Reads refresh through the live subscription, so
   * there is nothing to reconcile here on success.
   */
  const write = useCallback(
    async (id: string, run: () => Promise<WriteResult>) => {
      setBusyId(id)
      setWriteError(null)

      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<WriteResult>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: "error",
              error: {
                message:
                  "Notion didn't respond to that change. It may not have been saved — reopen the step to check.",
              },
            }),
          WRITE_TIMEOUT_MS
        )
      })

      try {
        const result = await Promise.race([run(), timeout])
        if (result.status === "error") setWriteError(result.error.message)
        return result.status === "success"
      } catch (cause) {
        setWriteError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        clearTimeout(timer)
        setBusyId(null)
      }
    },
    []
  )

  const toggle = useCallback(
    (id: string) => {
      setExpanded((current) => {
        const next = new Set(current)
        if (!next.delete(id)) next.add(id)
        return next
      })
      // Collapsing a step being edited drops the edit rather than leaving an
      // open form hidden behind a closed panel.
      if (editingId === id) setEditingId(null)
    },
    [editingId]
  )

  /** Save every changed field together, so one edit is one write. */
  function save(step: StepModel, edit: StepEdit) {
    const properties: NotionPagePropertyInputMap = {}

    if (edit.title !== step.title.trim()) {
      properties.title = {
        type: "title",
        title: [{ type: "text", text: { content: edit.title } }],
      }
    }
    if (edit.detail !== step.detail.trim()) {
      properties.detail = {
        type: "rich_text",
        rich_text: edit.detail
          ? [{ type: "text", text: { content: edit.detail } }]
          : [],
      }
    }
    if (edit.status && edit.status.name !== step.status) {
      properties.status = { type: "status", status: { id: edit.status.id } }
    }

    // Nothing changed — close the form without troubling Notion.
    if (Object.keys(properties).length === 0) {
      setEditingId(null)
      return
    }

    void write(step.id, async () => {
      const result = await step.row.update({ properties })
      if (result.status === "success") setEditingId(null)
      return result
    })
  }

  /**
   * Swap a step with its neighbour by exchanging their positions. Steps with no
   * position yet take their current index, so an unordered list sorts itself out
   * the first time anything is moved.
   */
  function move(index: number, direction: -1 | 1) {
    const step = steps[index]
    const neighbour = steps[index + direction]
    if (!step || !neighbour) return

    const here = step.position ?? index + 1
    const there = neighbour.position ?? index + direction + 1

    void write(step.id, async () => {
      const moved = await step.row.update({
        properties: { position: { type: "number", number: there } },
      })
      if (moved.status === "error") return moved
      return neighbour.row.update({
        properties: { position: { type: "number", number: here } },
      })
    })
  }

  /** Drop a dragged step at its new place: renumber, writing only what changed. */
  function reorderTo(from: number, to: number) {
    const { order, changes } = reorder(steps, from, to)
    if (changes.length === 0) return
    setPendingOrder(order.map((step) => step.id))
    void write(order[to].id, async () => {
      const results = await Promise.all(
        changes.map(({ step, position }) =>
          step.row.update({ properties: { position: { type: "number", number: position } } })
        )
      )
      const failed = results.find((result) => result.status === "error")
      if (failed) setPendingOrder(null)
      return failed ?? { status: "success" }
    })
  }

    function remove(step: StepModel) {
    void write(step.id, async () => {
      const result = await step.row.archive()
      if (result.status === "success") {
        setExpanded((current) => {
          const next = new Set(current)
          next.delete(step.id)
          return next
        })
        if (editingId === step.id) setEditingId(null)
      }
      return result
    })
  }

  function toggleEditable() {
    setEditable((current) => {
      if (current) setEditingId(null)
      return !current
    })
  }

  /** A new step has nothing to read, so it opens straight into its edit form. */
  function addStep() {
    void write("new", async () => {
      const result = await pages.create({
        parent: { type: "data_source_key", key: DATA_SOURCE_KEY },
        properties: {
          title: {
            type: "title",
            title: [{ type: "text", text: { content: "New step" } }],
          },
          position: { type: "number", number: nextPosition(steps) },
        },
      })
      if (result.status === "success") {
        setExpanded((current) => new Set(current).add(result.page.id))
        setEditingId(result.page.id)
      }
      return result
    })
  }

  // ── The heading ──────────────────────────────────────────────────────────
  //
  // The H3 is a row in the Steps database whose Row type is "Title": its Title
  // holds the plain words and its Detail the formatted ones (see richText.ts).
  // Rows are created the first time someone writes a heading.
  const titleRow = useMemo(() => findTitleRow(items), [items])
  const savedTitle = useMemo(() => {
    if (!titleRow) return []
    const words = typeof titleRow.propertiesByKey.title === "string" ? titleRow.propertiesByKey.title : ""
    const stored = fromStored(titleRow.propertiesByKey.detail)
    return stored && plainText(stored) === words ? stored : fromPlainText(words)
  }, [titleRow])
  const [pendingTitle, setPendingTitle] = useState<Segment[] | null>(null)
  useEffect(() => {
    setPendingTitle((pending) => (pending && sameSegments(pending, savedTitle) ? null : pending))
  }, [savedTitle])

  // Heading writes run one at a time, and a second one made before the new row
  // shows up in the query updates that row instead of creating another.
  const titleQueue = useRef<Promise<unknown>>(Promise.resolve())
  const createdTitleId = useRef<string | null>(null)
  const latestTitleRow = useRef(titleRow)
  latestTitleRow.current = titleRow

  function saveTitle(segments: Segment[]) {
    setPendingTitle(segments)
    titleQueue.current = titleQueue.current.then(() =>
      write("title", async () => {
        const properties: NotionPagePropertyInputMap = {
          title: { type: "title", title: toNotionRichText(segments) },
          detail: { type: "rich_text", rich_text: toNotionRichText(fromPlainText(toStored(segments))) },
        }
        const row = latestTitleRow.current
        if (row) return row.update({ properties })
        if (createdTitleId.current) {
          return pages.update({
            pageId: createdTitleId.current as NotionPageId,
            properties: byPropertyId(properties, propertyIdsByKey),
          })
        }
        const created = await pages.create({
          parent: { type: "data_source_key", key: DATA_SOURCE_KEY },
          properties: {
            ...properties,
            kind: { type: "select", select: { name: TITLE_ROW_TYPE } },
            position: { type: "number", number: 0 },
          },
        })
        if (created.status === "success") createdTitleId.current = created.page.id
        return created
      })
    )
  }

  // ── Status ───────────────────────────────────────────────────────────────

  const closeStatusMenu = useCallback(() => setStatusMenu(null), [])

  function openStatusMenu(step: StepModel, element: HTMLElement) {
    if (!root) return
    if (statusMenu?.stepId === step.id) {
      setStatusMenu(null)
      return
    }
    const box = element.getBoundingClientRect()
    const origin = root.getBoundingClientRect()
    setStatusMenu({ stepId: step.id, anchor: { left: box.left - origin.left, top: box.bottom - origin.top + 4 } })
  }

  function setStatus(step: StepModel, option: NotionPropertyOption) {
    void write(step.id, () => step.row.update({ properties: { status: { type: "status", status: { id: option.id } } } }))
  }

  const [list, setList] = useState<HTMLOListElement | null>(null)
  const { drag, handleProps } = useDragReorder({
    list,
    count: steps.length,
    disabled: busyId !== null,
    onDrop: reorderTo,
  })

  const menuStep = statusMenu ? steps.find((step) => step.id === statusMenu.stepId) : undefined

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        Couldn't load the steplist: {error.message}
      </div>
    )
  }

  if (isLoading && steps.length === 0) {
    return (
      <div className="notice" aria-busy="true">
        Loading steplist…
      </div>
    )
  }

  return (
    /*
     * The edit control lives on hover, so a stepline at rest is just its steps.
     * `focus-within` matters as much as hover: without it the control would be
     * unreachable by keyboard.
     */
    <main ref={setRoot} className={`stepline-root ${editable ? "is-editable" : ""}`}>
      <div className="stepline-toolbar">
        <button
          type="button"
          className={editable ? "primary-button" : "ghost-button"}
          onClick={toggleEditable}
        >
          {editable ? "Done" : "Edit steplist"}
        </button>
      </div>

      {propertyIdsByKey.kind !== undefined ? (
        <div className="plan-title" role="heading" aria-level={3}>
          <InlineText
            segments={pendingTitle ?? savedTitle}
            placeholder="Untitled plan"
            container={root}
            onEditingChange={() => setStatusMenu(null)}
            onCommit={saveTitle}
          />
        </div>
      ) : null}

      {writeError ? (
        <div className="notice notice-error" role="alert">
          {writeError}
        </div>
      ) : null}

      {steps.length === 0 ? (
        <p className="empty">
          {editable
            ? "No steps yet. Add the first one below."
            : "No steps yet. Choose “Edit steplist” to add one."}
        </p>
      ) : (
        <ol ref={setList} className={`stepline ${drag ? "is-dragging" : ""}`}>
          {steps.map((step, index) => (
            <Step
              key={step.id}
              step={step}
              index={index + 1}
              isLast={index === steps.length - 1}
              handle={handleProps(index)}
              dragging={drag?.from === index}
              canMoveUp={index > 0}
              canMoveDown={index < steps.length - 1}
              statusOptions={options}
              expanded={expanded.has(step.id)}
              editable={editable}
              editing={editingId === step.id}
              busy={busyId === step.id}
              onToggle={() => toggle(step.id)}
              onOpenStatus={options.length > 0 ? (element) => openStatusMenu(step, element) : undefined}
              onStartEditing={() => setEditingId(step.id)}
              onStopEditing={() => setEditingId(null)}
              onSave={(edit) => save(step, edit)}
              onMove={(direction) => move(index, direction)}
              onRemove={() => remove(step)}
            />
          ))}
          {drag ? <li className="drop-line" aria-hidden="true" style={{ top: drag.top - 1 }} /> : null}
        </ol>
      )}

      {statusMenu && menuStep ? (
        <StatusMenu
          groups={groups}
          value={menuStep.status}
          anchor={statusMenu.anchor}
          menuRef={setMenuNode}
          onPick={(option) => setStatus(menuStep, option)}
          onClose={closeStatusMenu}
        />
      ) : null}

      <div className="stepline-footer">
        {editable ? (
          <button
            type="button"
            className="add-button"
            disabled={busyId !== null}
            onClick={addStep}
          >
            + Add step
          </button>
        ) : null}

        {hasMore && limit < MAX_ROWS ? (
          <button
            type="button"
            className="ghost-button"
            disabled={isLoading}
            onClick={() => setLimit((current) => Math.min(current + PAGE_SIZE, MAX_ROWS))}
          >
            {isLoading ? "Loading…" : "Show more steps"}
          </button>
        ) : null}

        {hasMore && limit >= MAX_ROWS ? (
          <span className="field-note">
            Showing the first {MAX_ROWS} steps — this steplist has more.
          </span>
        ) : null}
      </div>
    </main>
  )
}

/** `pages.update` takes raw property IDs, each repeated in its value. */
function byPropertyId(
  properties: NotionPagePropertyInputMap,
  ids: Record<string, string | undefined>
): NotionPagePropertyWriteMap {
  const written: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    const id = ids[key]
    if (id) written[id] = { ...value, id }
  }
  return written as NotionPagePropertyWriteMap
}
