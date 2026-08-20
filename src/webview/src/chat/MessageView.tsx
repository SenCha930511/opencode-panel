import { UserCheckpointButton } from "./messageOps/MessageActionsMenu.js";
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
 * User messages render as rounded cards with a subtle checkpoint (revert)
 * icon on hover. Assistant messages render borderless with no actions menu.
 */
export function MessageView(props: {
  readonly message: MessageVM;
  readonly store?: MessageStore;
}) {
  const { message } = props;
  const isUser = message.role === "user";

  const orderedParts = isUser
    ? [
        ...message.parts.filter((p) => p.kind === "file"),
        ...message.parts.filter((p) => p.kind !== "file"),
      ]
    : message.parts;

  return (
    <article
      data-role={message.role}
      data-in-flight={message.inFlight}
      className={`group relative text-[13px] transition-all break-words [overflow-wrap:anywhere] ${
        isUser
          ? "my-1.5 w-full rounded-2xl border border-card-border/80 bg-panel-bg p-3 shadow-md text-fg"
          : "my-1.5 w-full px-0.5 py-1 text-fg"
      }`}
    >
      <div className="space-y-1.5 min-w-0 max-w-full overflow-hidden text-[13px] break-words [overflow-wrap:anywhere]">
        {orderedParts
          // Whitespace-only text parts render as empty rows that leak stray
          // spacing between real blocks; nothing meaningful is dropped.
          .filter((part) => part.kind !== "text" || part.text.trim().length > 0)
          .map((part) => (
            <PartView key={part.id} part={part} />
          ))}
      </div>
      {isUser && (
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <UserCheckpointButton
            message={message}
            {...(props.store === undefined ? {} : { store: props.store })}
          />
        </div>
      )}
    </article>
  );
}

