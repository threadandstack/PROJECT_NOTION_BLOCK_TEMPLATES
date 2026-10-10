# Steplist

A Notion custom block: a numbered list of steps under a heading, rendered inline
in a page. Each step is a row in a Notion database, so the content lives in
Notion and stays editable from the database as well as from the block.

- **A heading** above the steps. Click it and type, as in Notion; select text to
  format it.
- **Change a status in place.** Click a step's status pill, or its bullet, for a
  small status menu grouped To-do / In progress / Complete.
- **Notion's own colours.** A step's title takes its status's colour and the
  pill looks exactly like Notion's, in light and dark mode.
- **Completed steps** fill their bullet with that colour and a tick.
- **Open a step** to read its detail. Steps with detail show a chevron, and
  hovering a title says "Click to reveal".
- **Edit the list** with "Edit steplist" (shown on hover): edit, reorder, add
  and remove steps. Removing archives the row, so it can be restored.

## The database it uses

When you insert the block, Notion asks you to bind it to a database with these
properties. Name them the same and they match automatically.

| Property | Type | What it's for |
|---|---|---|
| Title | Title | The step's label |
| Detail | Text | What shows when a step is opened |
| Status | Status | Drives the bullet and the colour. Must be a Status, not a Select |
| Position | Number | Sort order; the numbering follows it |
| Date | Date | Optional date beside the title |
| Row type | Select | Leave empty for steps. The block sets it to "Title" on the row that holds the heading |

Give **Row type** an option called **Title** before you add a heading. Notion's
block bridge can't create select options, so without it the heading row can't be
labelled in the database (the block still recognises it).

## Install and preview

```bash
npm install
npm run dev
```

Open http://localhost:9873. The dev shell previews the block against
`data/steps.json` (pick **Steps (sample)** in its *Data* panel). It's read-only:
saving, and the status menu, can only be tried in a real workspace.

```bash
npm run check && npm test
```

## Deploy

```bash
ntn login
ntn workers deploy --name steplist
```

The first deploy creates the worker in the workspace `ntn` is logged into and
records it in `workers.json` (kept out of git). After that, `ntn workers deploy`
updates the same worker. Then type `/steplist` on any page.

## How it's built

- `src/index.ts` declares the block and the database it binds to.
- `blocks/steplist/src/` is the React app Notion embeds: `App.tsx` (data and
  writes), `Step.tsx` (one step), `StatusMenu.tsx`, `steps.ts` (turning rows into
  steps), and an in-place text editor (`InlineText.tsx`, `FormatToolbar.tsx`,
  `richText.ts`, `editorDom.ts`).
- `index.css` holds Notion's in-app palette, read from the Notion app's own
  stylesheet, as `--n-<hue>-*` variables.

A few things that took finding out, in case you build your own block:

- The bridge **silently ignores** a write it doesn't like (for example
  `link: null` in rich text, or a select option that doesn't exist yet). Every
  write here has a timeout so a dropped write can't hang the block.
- The bridge **drops title formatting** both ways, so the heading's formatting
  is stored as JSON in its row's Detail.
- `<form>` elements don't work in the sandbox, and nothing can load from the
  network, Notion's own domains included.

Made by [Thread & Stack](https://threadandstack.com).
