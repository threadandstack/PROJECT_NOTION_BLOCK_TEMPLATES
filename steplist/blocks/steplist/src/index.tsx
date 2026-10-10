import "@notionhq/custom-blocks/nds.css"
import {
  NotionCustomBlock,
  NotionTokenScope,
} from "@notionhq/custom-blocks/react"
import ReactDOM from "react-dom/client"
import { App } from "./App"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

ReactDOM.createRoot(root).render(
  <NotionCustomBlock
    autoResize
    errorFallback={(error) => (
      <div className="notice notice-error" role="alert">
        {error.message}
      </div>
    )}
  >
    <NotionTokenScope>
      <App />
    </NotionTokenScope>
  </NotionCustomBlock>
)
