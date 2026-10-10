import type { NotionPropertyOption } from "@notionhq/custom-blocks"
import { useEffect, useId, useState, type ButtonHTMLAttributes } from "react"
import { StatusPicker } from "./StatusPicker"
import { formatDate, type Step as StepModel } from "./steps"

export type StepEdit = {
  title: string
  detail: string
  /** Only set when the status was changed. */
  status?: NotionPropertyOption
}

type StepProps = {
  step: StepModel
  index: number
  isLast: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  statusOptions: NotionPropertyOption[]
  expanded: boolean
  /** Whether the stepline as a whole is being edited. */
  editable: boolean
  editing: boolean
  busy: boolean
  onToggle: () => void
  /** Open the status menu below the pill clicked; absent when there are no statuses to pick. */
  onOpenStatus?: (anchor: HTMLElement) => void
  /** Pointer and key handlers that make the bullet a drag handle. */
  handle: ButtonHTMLAttributes<HTMLButtonElement>
  /** Whether this step is the one being dragged. */
  dragging: boolean
  onStartEditing: () => void
  onStopEditing: () => void
  onSave: (edit: StepEdit) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

export function Step({
  step,
  index,
  isLast,
  canMoveUp,
  canMoveDown,
  statusOptions,
  expanded,
  editable,
  editing,
  busy,
  onToggle,
  onOpenStatus,
  handle,
  dragging,
  onStartEditing,
  onStopEditing,
  onSave,
  onMove,
  onRemove,
}: StepProps) {
  const panelId = useId()
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useEffect(() => {
    if (!expanded || !editable) setConfirmingRemove(false)
  }, [expanded, editable])

  const date = formatDate(step.date)
  // Only offer to open a step when opening it shows something: its detail, or
  // (while editing the steplist) its actions.
  const revealable = Boolean(step.detail) || editable || expanded
  const title = step.title || "Untitled step"

  return (
    <li
      className={`step step-${step.phase} ${step.tone ? `ink-${step.tone}` : ""} ${expanded ? "is-expanded" : ""} ${dragging ? "is-dragging" : ""}`}
    >
      <div className="rail">
        {/*
          The bullet is the step's drag handle, like Notion's ⋮⋮: press and
          drag to move the step. Status is changed from the pill by the title.
        */}
        <button
          type="button"
          className="bullet"
          title="Drag to move"
          aria-label={`Step ${index}. Drag to move, or press ⌘⇧↑ or ⌘⇧↓`}
          aria-roledescription="drag handle"
          {...handle}
        >
          {step.phase === "complete" ? <CheckMark /> : index}
        </button>
        {isLast ? null : <span className="connector" aria-hidden="true" />}
      </div>

      <div className="step-body">
        {/*
          The row toggles the step open, but holds the status pill, which is a
          button of its own, so it is a div with button behaviour rather than a
          <button> (buttons cannot nest).
        */}
        <div
          role="button"
          tabIndex={0}
          className="step-header"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onToggle()
            }
          }}
        >
          <span
            className="step-title-wrap"
            data-tooltip={revealable ? (expanded ? "Click to hide" : "Click to reveal") : undefined}
          >
            <span className={`step-title ${step.tone ? `tone-${step.tone}` : ""}`}>
              {title}
            </span>
          </span>
          {step.status && onOpenStatus ? (
            <button
              type="button"
              className={`status-tag status-button pill-${step.pill}`}
              aria-haspopup="menu"
              aria-label={`Status: ${step.status}. Change status`}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation()
                onOpenStatus(event.currentTarget)
              }}
            >
              {step.status}
            </button>
          ) : step.status ? (
            <span className={`status-tag pill-${step.pill}`}>{step.status}</span>
          ) : null}
          {date ? <span className="step-date">{date}</span> : null}
          {revealable ? <Chevron expanded={expanded} /> : null}
        </div>

        <div className="step-panel" id={panelId} hidden={!expanded}>
          {editing ? (
            <StepForm
              step={step}
              statusOptions={statusOptions}
              busy={busy}
              onCancel={onStopEditing}
              onSave={onSave}
            />
          ) : (
            <>
              {step.detail ? (
                <p className="detail-read">{step.detail}</p>
              ) : editable ? (
                <p className="detail-empty">No detail for this step yet.</p>
              ) : null}

              {/*
                Actions belong to editing the stepline, not to reading it — a
                step that is simply open shows its words and nothing else.
              */}
              {editable ? (
                <div className="step-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy}
                    onClick={onStartEditing}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy || !canMoveUp}
                    onClick={() => onMove(-1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busy || !canMoveDown}
                    onClick={() => onMove(1)}
                  >
                    Move down
                  </button>

                  {confirmingRemove ? (
                    <>
                      <button
                        type="button"
                        className="ghost-button danger is-confirming"
                        disabled={busy}
                        onClick={onRemove}
                      >
                        Confirm remove
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={busy}
                        onClick={() => setConfirmingRemove(false)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghost-button danger"
                      disabled={busy}
                      onClick={() => setConfirmingRemove(true)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : null}

              {editable && confirmingRemove ? (
                <p className="field-note">
                  This moves the step to Notion's archive. You can restore it
                  from the database.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * The edit form. Drafts are local until Save, so nothing is written to Notion
 * until it is asked for, and Cancel leaves the step exactly as it was.
 *
 * Deliberately not a `<form>`: the custom-block sandbox disallows form elements,
 * so a submit button's event never fires and Save silently does nothing. Enter in
 * the title field stands in for submitting.
 */
function StepForm({
  step,
  statusOptions,
  busy,
  onCancel,
  onSave,
}: {
  step: StepModel
  statusOptions: NotionPropertyOption[]
  busy: boolean
  onCancel: () => void
  onSave: (edit: StepEdit) => void
}) {
  const [title, setTitle] = useState(step.title)
  const [detail, setDetail] = useState(step.detail)
  const [status, setStatus] = useState<NotionPropertyOption | null>(null)

  function submit() {
    onSave({
      title: title.trim(),
      detail: detail.trim(),
      ...(status ? { status } : {}),
    })
  }

  return (
    <div className="step-form">
      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          className="field-input"
          aria-label="Step title"
          placeholder="Name this step"
          value={title}
          disabled={busy}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          }}
        />
      </label>

      <label className="field">
        <span className="field-label">Detail</span>
        <textarea
          className="field-input field-textarea"
          aria-label="Step detail"
          placeholder="What happens at this step?"
          rows={3}
          value={detail}
          disabled={busy}
          onChange={(event) => setDetail(event.target.value)}
        />
      </label>

      <div className="field">
        <span className="field-label">Status</span>
        <StatusPicker
          options={statusOptions}
          value={status?.name ?? step.status}
          disabled={busy}
          onSelect={setStatus}
        />
      </div>

      <div className="step-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={submit}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`chevron ${expanded ? "is-open" : ""}`}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 2.5 7.5 6 4 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M2.5 6.2 5 8.7l4.5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
