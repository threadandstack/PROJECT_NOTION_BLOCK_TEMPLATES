import { HUES, colourLabel, type NotionColour } from "./richText"

const TEXT_COLOURS: NotionColour[] = ["default", ...HUES]
const BACKGROUND_COLOURS: NotionColour[] = ["default", ...HUES.map((hue) => `${hue}_background` as const)]

type ColourGridProps = {
  /** The colour in use, or undefined when a selection mixes several. */
  value: string | undefined
  onPick: (colour: NotionColour) => void
  /** Keep focus where it is (the text) when a swatch is pressed. */
  keepFocus?: boolean
}

/**
 * Notion's colour menu: a row of "A" swatches for text colour and one for
 * background colour. "Default" appears in both rows, as it does in Notion.
 */
export function ColourGrid({ value, onPick, keepFocus }: ColourGridProps) {
  const row = (label: string, colours: NotionColour[], kind: "text" | "background") => (
    <div className="menu-section">
      <div className="menu-label">{label}</div>
      <div className="swatch-row" role="radiogroup" aria-label={label}>
        {colours.map((colour) => {
          const name =
            colour === "default"
              ? kind === "text"
                ? "Default text"
                : "Default background"
              : colourLabel(colour)
          return (
            <button
              key={`${kind}-${colour}`}
              type="button"
              role="radio"
              aria-checked={value === colour}
              aria-label={name}
              title={name}
              className={`swatch c-${colour} ${value === colour ? "is-selected" : ""}`}
              onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
              onClick={() => onPick(colour)}
            >
              A
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      {row("Text colour", TEXT_COLOURS, "text")}
      {row("Background colour", BACKGROUND_COLOURS, "background")}
    </>
  )
}
