import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  findTitleRow,
  formatDate,
  nextPosition,
  inOrder,
  pillForOption,
  reorder,
  statusGroups,
  toSteps,
} from "../blocks/steplist/src/steps.ts"

const workerUrl = new URL("../src/index.ts", import.meta.url)

/** A minimal stand-in for a row returned by `useDataSource`. */
function row(id, propertiesByKey) {
  return { id, propertiesByKey }
}

/** A Status property schema with Notion's three default groups. */
const statusSchema = {
  name: "Status",
  type: "status",
  options: [
    { id: "o-todo", name: "Not started", color: "default" },
    { id: "o-doing", name: "In flight", color: "blue" },
    { id: "o-done", name: "Shipped", color: "green" },
  ],
  groups: [
    { id: "g1", name: "To-do", option_ids: ["o-todo"] },
    { id: "g2", name: "In progress", option_ids: ["o-doing"] },
    { id: "g3", name: "Complete", option_ids: ["o-done"] },
  ],
}

test("declares the steplist block and the properties it binds", async () => {
  const source = await readFile(workerUrl, "utf8")

  assert.match(source, /worker\.customBlock\("steplist"/)
  assert.match(source, /name:\s*"Steplist"/)
  assert.match(source, /slashCommand:\s*"steplist"/)
  assert.match(source, /path:\s*"\.\/blocks\/steplist"/)
  assert.match(source, /command:\s*"npx vite build"/)

  for (const key of ["title", "detail", "status", "position", "date", "kind"]) {
    assert.match(source, new RegExp(`${key}:\\s*\\{`), `missing ${key} property`)
  }
})

test("orders steps by position, with unpositioned steps last", () => {
  const steps = toSteps(
    [
      row("c", { title: "Third", position: 3 }),
      row("z", { title: "No position" }),
      row("a", { title: "First", position: 1 }),
    ],
    statusSchema
  )

  assert.deepEqual(
    steps.map((step) => step.title),
    ["First", "Third", "No position"]
  )
})

test("derives the bullet phase from the status property's own groups", () => {
  const steps = toSteps(
    [
      row("a", { title: "a", position: 1, status: "Not started" }),
      row("b", { title: "b", position: 2, status: "In flight" }),
      row("c", { title: "c", position: 3, status: "Shipped" }),
      row("d", { title: "d", position: 4 }),
    ],
    statusSchema
  )

  assert.deepEqual(
    steps.map((step) => step.phase),
    ["todo", "active", "complete", "todo"]
  )
})

test("falls back to option names when the host supplies no groups", () => {
  const [done, doing] = toSteps(
    [
      row("a", { title: "a", position: 1, status: "Done" }),
      row("b", { title: "b", position: 2, status: "Doing" }),
    ],
    undefined
  )

  assert.equal(done.phase, "complete")
  assert.equal(doing.phase, "active")
})

test("reads a date property's start, all-day and timestamped", () => {
  const [allDay, timed] = toSteps(
    [
      row("a", { title: "a", position: 1, date: { type: "date", start_date: "2026-03-04" } }),
      row("b", {
        title: "b",
        position: 2,
        date: { type: "datetime", start_date: "2026-03-05", start_time: "09:30" },
      }),
    ],
    statusSchema
  )

  assert.equal(allDay.date, "2026-03-04")
  assert.equal(timed.date, "2026-03-05T09:30")
  assert.equal(typeof formatDate(allDay.date), "string")
})

test("ignores a date property that has no start", () => {
  const [step] = toSteps([row("a", { title: "a", date: undefined })], statusSchema)

  assert.equal(step.date, undefined)
  assert.equal(formatDate(step.date), undefined)
})

test("appends new steps after the highest position", () => {
  assert.equal(nextPosition([]), 1)
  assert.equal(
    nextPosition([{ position: 2 }, { position: 7 }, { position: undefined }]),
    8
  )
})

test("the block uses no form elements", async () => {
  // The custom-block sandbox disallows forms: a submit button's event never
  // fires, so Save would silently do nothing. Guard against reintroducing one.
  const dir = new URL("../blocks/steplist/src/", import.meta.url)
  const { readdir } = await import("node:fs/promises")

  for (const file of await readdir(dir)) {
    if (!file.endsWith(".tsx")) continue
    const source = await readFile(new URL(file, dir), "utf8")
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
    assert.doesNotMatch(code, /<form[\s>]/, `${file} renders a <form>`)
    assert.doesNotMatch(code, /type="submit"/, `${file} has a submit button`)
  }
})

test("titles take the status colour the workspace configured", async () => {
  const withColours = {
    ...statusSchema,
    options: [
      { id: "o-1", name: "Plain", color: "default" },
      { id: "o-2", name: "Grey", color: "gray" },
      { id: "o-3", name: "Tinted", color: "purple_background" },
      { id: "o-4", name: "Hot", color: "red" },
      { id: "o-5", name: "Odd", color: "chartreuse" },
      { id: "o-6", name: "Bare" },
    ],
  }

  const steps = toSteps(
    [
      row("a", { title: "a", position: 1, status: "Plain" }),
      row("b", { title: "b", position: 2, status: "Grey" }),
      row("c", { title: "c", position: 3, status: "Tinted" }),
      row("d", { title: "d", position: 4, status: "Hot" }),
      row("e", { title: "e", position: 5, status: "Odd" }),
      row("f", { title: "f", position: 6, status: "Bare" }),
      row("g", { title: "g", position: 7 }),
    ],
    withColours
  )

  assert.deepEqual(
    steps.map((step) => step.tone),
    [
      undefined, // default carries no hue, so the title stays black
      undefined, // nor does grey — a grey title would read as disabled
      "purple", // the _background suffix is normalised away
      "red",
      undefined, // an unrecognised colour is ignored rather than guessed at
      undefined, // an option with no colour at all
      undefined, // and no status at all
    ]
  )
})

test("colours come from Notion's own palette, in both themes", async () => {
  const { STATUS_TONES } = await import("../blocks/steplist/src/steps.ts")
  const css = await readFile(new URL("../blocks/steplist/src/index.css", import.meta.url), "utf8")
  const light = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")))
  const dark = css.slice(css.indexOf('[data-display-mode="dark"] {'), css.indexOf("}", css.indexOf('[data-display-mode="dark"] {')))

  for (const tone of STATUS_TONES) {
    assert.ok(css.includes(`.tone-${tone} { color: var(--n-${tone}-text); }`), `${tone} title`)
    assert.ok(css.includes(`.pill-${tone} { color: var(--n-${tone}-pill-text); background: var(--n-${tone}-pill-bg); }`), `${tone} pill`)
    for (const name of ["text", "bg", "pill-text", "pill-bg"]) {
      assert.ok(light.includes(`--n-${tone}-${name}:`), `${tone} ${name} has a light value`)
    }
    for (const name of ["bg", "pill-text", "pill-bg"]) {
      assert.ok(dark.includes(`--n-${tone}-${name}:`), `${tone} ${name} has a dark value`)
    }
  }
  assert.ok(css.includes(".pill-gray {"), "default and grey options get Notion's grey pill")

  // Values read from the Notion app's stylesheet. If these change, re-measure
  // rather than guess (see the palette comment in index.css).
  assert.ok(light.includes("--n-green-text: #50946e;"))
  assert.ok(light.includes("--n-blue-text: #387dc9;"))
  assert.ok(light.includes("--n-yellow-text: #cb9434;"))
  assert.ok(light.includes("--n-pink-text: #c14c8a;"))
  assert.ok(light.includes("--n-green-pill-bg: rgba(0,96,38,.157);"))

  // Titles must not fall back to grey anywhere.
  assert.doesNotMatch(css, /\.step-complete \.step-title/, "completed titles are being greyed out")
})

test("the heading row is not a step", () => {
  const rows = [
    row("s2", { title: "Second", position: 2 }),
    row("h", { title: "Launch plan", kind: "Title", position: 0 }),
    row("s1", { title: "First", position: 1, kind: "" }),
  ]
  assert.deepEqual(toSteps(rows, statusSchema).map((step) => step.title), ["First", "Second"])
  assert.equal(findTitleRow(rows)?.id, "h")
  assert.equal(findTitleRow(rows.filter((r) => r.id !== "h")), undefined)
  // Matching is forgiving of case, since the value may be typed in the database.
  assert.equal(findTitleRow([row("x", { kind: "title" })])?.id, "x")

  // The bridge drops a select value that isn't an option yet, so a heading row
  // can arrive with Row type empty. Its stored formatting still marks it.
  const unmarked = [
    row("s1", { title: "First", position: 1, detail: "Plain words about the step." }),
    row("h", { title: "Plan", position: 0, detail: '{"v":1,"r":[{"t":"Plan"}]}' }),
  ]
  assert.deepEqual(toSteps(unmarked, statusSchema).map((step) => step.title), ["First"])
  assert.equal(findTitleRow(unmarked)?.id, "h")
})

test("lists status options in Notion's groups, and colours each pill", () => {
  const groups = statusGroups(statusSchema)
  assert.deepEqual(
    groups.map((group) => [group.name, group.options.map((option) => option.name)]),
    [
      ["To-do", ["Not started"]],
      ["In progress", ["In flight"]],
      ["Complete", ["Shipped"]],
    ]
  )
  const ungrouped = statusGroups({ ...statusSchema, groups: [] })
  assert.deepEqual(ungrouped.map((group) => group.name), [""])

  assert.equal(pillForOption("green"), "green")
  assert.equal(pillForOption("pink_background"), "pink")
  assert.equal(pillForOption("default"), "gray")
  assert.equal(pillForOption(undefined), "gray")
})

test("a completed bullet is filled with its title's colour", async () => {
  const { STATUS_TONES } = await import("../blocks/steplist/src/steps.ts")
  const css = await readFile(new URL("../blocks/steplist/src/index.css", import.meta.url), "utf8")
  for (const tone of STATUS_TONES) {
    assert.ok(css.includes(`.ink-${tone} { --step-ink: var(--n-${tone}-text);`), `${tone} bullet ink`)
  }
  assert.match(css, /\.step-complete \.bullet \{\s*background: var\(--step-ink\)/)
  // No hue: the original near-black fill.
  assert.match(css, /--step-ink: var\(--bg-interactive-strong\)/)

  const step = await readFile(new URL("../blocks/steplist/src/Step.tsx", import.meta.url), "utf8")
  assert.match(step, /ink-\$\{step\.tone\}/)
  assert.match(step, /d="M2\.5 6\.2 5 8\.7l4\.5-5"/, "the stroked tick, not the check-circle")
})

test("disabled controls stay legible", async () => {
  const css = await readFile(
    new URL("../blocks/steplist/src/index.css", import.meta.url),
    "utf8"
  )
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "")

  // In light mode --content-disabled and --bg-control are both --gray-40, so
  // using the former as text on the latter renders an empty grey box. Dim the
  // control instead.
  assert.doesNotMatch(
    rules,
    /color:\s*var\(--content-disabled\)/,
    "--content-disabled is invisible on a control background; use opacity"
  )

  assert.match(
    rules,
    /\.ghost-button:disabled[\s\S]{0,200}opacity/,
    "disabled buttons should dim"
  )
})

// Readers need to see that a step has more in it, so the chevron is always
// shown (on steps with something to reveal), and the title says so on hover.
test("chevrons are always visible and the title explains them", async () => {
  const css = (
    await readFile(new URL("../blocks/steplist/src/index.css", import.meta.url), "utf8")
  ).replace(/\/\*[\s\S]*?\*\//g, "")
  const chevron = css.slice(css.indexOf(".chevron {"), css.indexOf("}", css.indexOf(".chevron {")))
  assert.doesNotMatch(chevron, /opacity:\s*0/, "the chevron is hidden at rest")
  assert.doesNotMatch(css, /:hover \.chevron/, "the chevron only appears on hover")

  const step = await readFile(new URL("../blocks/steplist/src/Step.tsx", import.meta.url), "utf8")
  assert.match(step, /"Click to reveal"/)
})

test("dragging a step renumbers only what moves", () => {
  const steps = toSteps(
    [
      row("a", { title: "A", position: 1 }),
      row("b", { title: "B", position: 2 }),
      row("c", { title: "C", position: 3 }),
      row("d", { title: "D", position: 4 }),
    ],
    statusSchema
  )
  const titles = (list) => list.map((step) => step.title)

  // D to the top: everything shifts down one.
  const up = reorder(steps, 3, 0)
  assert.deepEqual(titles(up.order), ["D", "A", "B", "C"])
  assert.deepEqual(up.changes.map(({ step, position }) => [step.title, position]), [["D", 1], ["A", 2], ["B", 3], ["C", 4]])

  // A short move only touches the two steps that swap.
  const swap = reorder(steps, 1, 2)
  assert.deepEqual(titles(swap.order), ["A", "C", "B", "D"])
  assert.deepEqual(swap.changes.map(({ step, position }) => [step.title, position]), [["C", 2], ["B", 3]])

  assert.deepEqual(reorder(steps, 2, 2).changes, [], "dropping in place writes nothing")

  // Unpositioned steps get positions as they're moved past.
  const loose = toSteps([row("x", { title: "X" }), row("y", { title: "Y" })], statusSchema)
  assert.deepEqual(reorder(loose, 1, 0).changes.map(({ step, position }) => [step.title, position]), [["Y", 1], ["X", 2]])

  // While Notion saves, the list shows the dragged order.
  assert.deepEqual(titles(inOrder(steps, ["c", "a", "b", "d"])), ["C", "A", "B", "D"])
  assert.equal(inOrder(steps, null), steps)
})

// One way to change a status (the pill); the bullet is for moving the step.
test("the bullet is a drag handle, not a status control", async () => {
  const step = await readFile(new URL("../blocks/steplist/src/Step.tsx", import.meta.url), "utf8")
  const bullet = step.slice(step.indexOf('className="bullet"') - 200, step.indexOf('className="bullet"') + 400)
  assert.doesNotMatch(bullet, /onOpenStatus/, "the bullet still opens the status menu")
  assert.match(bullet, /\{\.\.\.handle\}/, "the bullet doesn't carry the drag handlers")
  assert.match(bullet, /title="Drag to move"/)
})
