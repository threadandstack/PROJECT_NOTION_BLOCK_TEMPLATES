import type {
  NotionDataSourcePage,
  NotionDataSourceValue,
  NotionPropertyOption,
  NotionPropertySchema,
} from "@notionhq/custom-blocks"
import { fromStored } from "./richText.ts"

/**
 * How a step's status reads visually on the rail. Derived from the bound Status
 * property's own groups rather than from option names, so the block adapts to
 * whatever status scheme a workspace already uses.
 */
export type StepPhase = "complete" | "active" | "todo"

export type Step = {
  row: NotionDataSourcePage
  id: string
  title: string
  detail: string
  status?: string
  /**
   * The colour the workspace gave this status option, normalised. Undefined
   * when there is no status, or when its colour carries no hue — those read as
   * ordinary text rather than as a tinted one.
   */
  tone?: StatusTone
  /** The status pill's colour. Unlike the title, grey and default pills are grey. */
  pill: PillTone
  position?: number
  date?: string
  phase: StepPhase
}

/** The hues a Notion option can carry. Grey and default are deliberately absent. */
export const STATUS_TONES = [
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const

export type StatusTone = (typeof STATUS_TONES)[number]

/** A status pill can also be grey, which is how Notion draws default and grey options. */
export type PillTone = StatusTone | "gray"

/**
 * The value of the Row type select that marks a row as the stepline's heading
 * rather than a step. Any other value, or none, is a step.
 */
export const TITLE_ROW_TYPE = "Title"

/**
 * Whether a row is the steplist's heading row: its Row type is Title, or its
 * Detail holds the heading's stored formatting, which only the block writes and
 * only on the heading row.
 *
 * The second test matters. Notion's bridge silently ignores a select value that
 * isn't already an option, so in a database whose Row type has no "Title"
 * option yet, the heading row the block creates arrives with Row type empty.
 */
export function isTitleRow(row: NotionDataSourcePage): boolean {
  if (asText(row.propertiesByKey.kind).trim().toLowerCase() === TITLE_ROW_TYPE.toLowerCase()) return true
  return fromStored(row.propertiesByKey.detail) !== null
}

/** The stepline's heading row: the first one marked Title, by ID so every viewer agrees. */
export function findTitleRow(rows: NotionDataSourcePage[]): NotionDataSourcePage | undefined {
  return rows.filter(isTitleRow).sort((a, b) => a.id.localeCompare(b.id))[0]
}

/** Notion's three built-in status groups, lower-cased for matching. */
const COMPLETE_GROUP = "complete"
const ACTIVE_GROUP = "in progress"

/** Fallbacks for workspaces whose status property has renamed its groups. */
const COMPLETE_WORDS = ["done", "complete", "completed", "shipped", "live"]
const ACTIVE_WORDS = ["in progress", "doing", "active", "started", "current"]

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * Notion returns a date property as a `NotionDateValue` union — all-day
 * (`date` / `daterange`) or timestamped (`datetime` / `datetimerange`). Every
 * variant carries `start_date`; the timestamped ones add `start_time`. We only
 * display the start, so the end of a range is deliberately dropped.
 */
function asDateStart(
  value: NotionDataSourceValue | undefined
): string | undefined {
  if (!value || typeof value !== "object" || !("start_date" in value)) {
    return undefined
  }

  const start = value.start_date
  if (typeof start !== "string") return undefined

  const time = "start_time" in value ? value.start_time : undefined
  return typeof time === "string" ? `${start}T${time}` : start
}

/** The Status property's options, in the order Notion lists them. */
export function statusOptions(
  schema: NotionPropertySchema | undefined
): NotionPropertyOption[] {
  if (!schema || schema.type !== "status") return []
  return schema.options ?? []
}

/**
 * Read the colour the workspace configured for a status option.
 *
 * Notion writes these as plain hue names, sometimes suffixed `_background`, and
 * `default`/`gray` for the untinted ones. Those two are treated as "no tone" so
 * the title stays ordinary text — a grey title would read as disabled, and the
 * common case of an untouched "Not started" is exactly that.
 */
function toneForStatus(
  status: string | undefined,
  schema: NotionPropertySchema | undefined
): StatusTone | undefined {
  if (!status || schema?.type !== "status") return undefined

  const colour = schema.options?.find((option) => option.name === status)?.color
  if (!colour) return undefined

  const hue = colour.replace(/_background$/, "")
  return STATUS_TONES.includes(hue as StatusTone) ? (hue as StatusTone) : undefined
}

/** A status option's pill colour: its hue, or grey for default and grey options. */
export function pillForOption(color: string | undefined): PillTone {
  const hue = (color ?? "").replace(/_background$/, "")
  return STATUS_TONES.includes(hue as StatusTone) ? (hue as StatusTone) : "gray"
}

function pillForStatus(status: string | undefined, schema: NotionPropertySchema | undefined): PillTone {
  if (!status || schema?.type !== "status") return "gray"
  return pillForOption(schema.options?.find((option) => option.name === status)?.color)
}

export type StatusGroup = { name: string; options: NotionPropertyOption[] }

/**
 * The status options in Notion's own groups (To-do, In progress, Complete), the
 * way Notion's status menu lists them. Options in no group, or a host that
 * sends no groups, fall into one unnamed list.
 */
export function statusGroups(schema: NotionPropertySchema | undefined): StatusGroup[] {
  const options = statusOptions(schema)
  if (schema?.type !== "status" || !schema.groups?.length) return options.length ? [{ name: "", options }] : []

  const placed = new Set<string>()
  const groups = schema.groups
    .map((group) => {
      const members = options.filter((option) => group.option_ids.includes(option.id))
      members.forEach((option) => placed.add(option.id))
      return { name: group.name, options: members }
    })
    .filter((group) => group.options.length > 0)
  const rest = options.filter((option) => !placed.has(option.id))
  return rest.length ? [...groups, { name: "", options: rest }] : groups
}

/**
 * Map a status option to a phase. Group membership is authoritative; the
 * word-list fallback only runs when the host gives us no groups.
 */
function phaseForStatus(
  status: string | undefined,
  schema: NotionPropertySchema | undefined
): StepPhase {
  if (!status) return "todo"

  if (schema?.type === "status") {
    const option = schema.options?.find((candidate) => candidate.name === status)
    const group = schema.groups?.find((candidate) =>
      option ? candidate.option_ids.includes(option.id) : false
    )
    if (group) {
      const name = group.name.toLowerCase()
      if (name.includes(COMPLETE_GROUP)) return "complete"
      if (name.includes(ACTIVE_GROUP)) return "active"
      return "todo"
    }
  }

  const name = status.toLowerCase()
  if (COMPLETE_WORDS.some((word) => name.includes(word))) return "complete"
  if (ACTIVE_WORDS.some((word) => name.includes(word))) return "active"
  return "todo"
}

/**
 * Turn raw rows into ordered steps. The heading row (Row type = Title) is not a
 * step and is left out.
 *
 * `position` is sorted client-side rather than through the query's `sorts`
 * because rows with no position must fall to the end in a stable, predictable
 * way — Notion sorts empty values last in both directions, which would shuffle
 * them against each other as they are edited.
 */
export function toSteps(
  rows: NotionDataSourcePage[],
  statusSchema: NotionPropertySchema | undefined
): Step[] {
  return rows
    .filter((row) => !isTitleRow(row))
    .map((row) => {
      const status = asText(row.propertiesByKey.status) || undefined
      return {
        row,
        id: row.id,
        title: asText(row.propertiesByKey.title),
        detail: asText(row.propertiesByKey.detail),
        status,
        tone: toneForStatus(status, statusSchema),
        pill: pillForStatus(status, statusSchema),
        position: asNumber(row.propertiesByKey.position),
        date: asDateStart(row.propertiesByKey.date),
        phase: phaseForStatus(status, statusSchema),
      }
    })
    .sort((a, b) => {
      const left = a.position ?? Number.POSITIVE_INFINITY
      const right = b.position ?? Number.POSITIVE_INFINITY
      if (left !== right) return left - right
      return a.id.localeCompare(b.id)
    })
}

/** The next position to hand a newly added step. */
export function nextPosition(steps: Step[]): number {
  const positions = steps
    .map((step) => step.position)
    .filter((position): position is number => position !== undefined)
  if (positions.length === 0) return 1
  return Math.max(...positions) + 1
}

/** Render a date property for display, falling back to the raw value. */
export function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  const hasTime = value.includes("T")
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  })
}
