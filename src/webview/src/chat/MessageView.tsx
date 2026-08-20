import { MessageActionsMenu } from "./messageOps/MessageActionsMenu.js";
import type { MessageStore } from "./messageStore.js";
import type { MessageVM, PartVM } from "./types.js";
import { TextPartView } from "./parts/TextPartView.js";
import { ReasoningPartView } from "./parts/ReasoningPartView.js";
import { GenericToolCard } from "./parts/ToolPartView.js";
import { FilePartView } from "./parts/FilePartView.js";
import { PatchPartView } from "./parts/PatchPartView.js";
import { JsonPartView } from "./parts/JsonPartView.js";

/** Part-type dispatch: one renderer per kind, exhaustive by construction. */
export function PartView(props: { readonly part: PartVM }) {
  const { part } = props;
  switch (part.kind) {
    case "text":
      return <TextPartView part={part} />;
    case "reasoning":
      return <ReasoningPartView part={part} />;
    case "tool":
      return <GenericToolCard part={part} />;
    case "file":
      return <FilePartView part={part} />;
    case "patch":
      return <PatchPartView part={part} />;
    case "unknown":
      return <JsonPartView part={part} />;
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

const ROLE_CLASS: Readonly<Record<string, string>> = {
  user: "text-accent",
  assistant: "text-ok",
};

/**
 * One `{info, parts}` row: role marker + every part in payload order.
 *
 * T19 INTEGRATION (FIX-E, additive): the todo-19 documented mount site for
 * the per-message hover menu — `<article class="group relative">` plus the
 * menu absolutely anchored, hover-revealed via the group. `store` is the
 * optional regenerate seam (MessageList threads its own store through;
 * without it the Regenerate row hides, per the T19 contract).
 */
export function MessageView(props: {
  readonly message: MessageVM;
  readonly store?: MessageStore;
}) {
  const { message } = props;
  const isUser = message.role === "user";
  
  return (
    <article
      data-role={message.role}
      data-in-flight={message.inFlight}
      className={`group relative text-[13px] transition-all break-words [overflow-wrap:anywhere] ${
        isUser
          ? "my-2.5 w-full rounded-2xl border border-card-border/80 bg-card-bg/60 p-3 shadow-2xs text-fg"
          : "my-2 w-full px-0.5 py-1 text-fg"
      }`}
    >
      <div className="space-y-1.5 min-w-0 max-w-full overflow-hidden text-[13px] break-words [overflow-wrap:anywhere]">
        {message.parts.map((part) => (
          <PartView key={part.id} part={part} />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-end">
        <MessageActionsMenu
          message={message}
          {...(props.store === undefined ? {} : { store: props.store })}
          className="hidden group-hover:flex"
        />
      </div>
    </article>
  );
}
