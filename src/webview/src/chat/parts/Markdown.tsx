import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";

/**
 * Sanitized markdown renderer (todo 13 XSS guard).
 *
 * Defense in depth, plan-preferred order: react-markdown WITHOUT rehype-raw
 * (raw HTML in source — `<script>`, `<img onerror>` — never becomes a DOM
 * node at all), then rehype-sanitize with the schema below as the belt to
 * the suspenders (protocol filtering for links/images), and only then
 * rehype-highlight, whose hljs classNames are injected post-sanitize and
 * therefore safe. No `dangerouslySetInnerHTML` anywhere => DOMPurify is not
 * needed (plan preference order honored).
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^(language|hljs)-[\w-]+$/],
      ["className", "hljs"],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^hljs-[\w-]+$/]],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", "hljs"]],
  },
};

const remarkPlugins: PluggableList = [remarkGfm];
const rehypePlugins: PluggableList = [
  [rehypeSanitize, sanitizeSchema],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];

export function Markdown(props: { readonly text: string; readonly className?: string }) {
  return (
    <div className={`prose-oc min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${props.className ?? "leading-relaxed"}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {props.text}
      </ReactMarkdown>
    </div>
  );
}
