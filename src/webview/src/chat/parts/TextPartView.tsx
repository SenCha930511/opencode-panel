import type { PartVM } from "../types.js";
import { Markdown } from "./Markdown.js";

export function TextPartView(props: { readonly part: Extract<PartVM, { kind: "text" }> }) {
  return <Markdown text={props.part.text} />;
}
