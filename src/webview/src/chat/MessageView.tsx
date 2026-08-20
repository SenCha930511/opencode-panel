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
      className={`group relative my-2.5 text-sm transition-all ${
        isUser
          ? "ml-auto max-w-[90%] rounded-2xl rounded-tr-xs border border-card-border/80 bg-user-msg-bg/90 px-3.5 py-2.5 shadow-2xs"
          : "w-full py-1 text-fg"
      }`}
    >
      <div className="space-y-2 min-w-0 max-w-full overflow-hidden text-sm">
        {message.parts.map((part) => (
          <PartView key={part.id} part={part} />
        ))}
      </div>
      <MessageActionsMenu
        message={message}
        {...(props.store === undefined ? {} : { store: props.store })}
        className="absolute right-2 top-2 z-10 hidden group-hover:flex"
      />
    </article>
  );
}
