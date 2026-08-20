import { useStrings } from "../../../lib/i18n.js";
import type { PartVM } from "../types.js";
import { useChatActions } from "../chatContext.js";

type FilePart = Extract<PartVM, { kind: "file" }>;

function displayName(part: FilePart): string {
  if (part.filename !== undefined && part.filename.length > 0) return part.filename;
  if (part.url !== undefined) return part.url;
  return part.mime ?? "file";
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted-fg">
      <path
        d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914a1.5 1.5 0 0 1 .44 1.06V13.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 13.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M10.5 1v3.5a1 1 0 0 0 1 1H15" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** File attachment chip: image thumbnail preview or file chip, open via host. */
export function FilePartView(props: { readonly part: FilePart }) {
  const { t } = useStrings();
  const actions = useChatActions();
  const name = displayName(props.part);
  const path = props.part.filename ?? props.part.url ?? "";
  const isImage =
    props.part.mime?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path) ||
    (props.part.url !== undefined && props.part.url.startsWith("data:image/"));

  if (isImage && props.part.url) {
    return (
      <div className="my-1.5 inline-block max-w-full overflow-hidden rounded-xl border border-card-border/80 bg-black/20 shadow-2xs">
        <img
          src={props.part.url}
          alt={name}
          className="max-h-40 max-w-full rounded-lg object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-card-border/70 bg-card-bg/60 px-2.5 py-1 text-xs">
      <FileIcon />
      <span className="max-w-64 truncate font-medium text-fg">{name}</span>
      {props.part.mime !== undefined ? (
        <span className="text-muted-fg text-[11px]">{props.part.mime}</span>
      ) : null}
      <button
        type="button"
        className="text-accent hover:underline cursor-pointer text-[11px]"
        onClick={() => {
          if (path.length > 0) actions.openFile(path);
        }}
      >
        {t("dock.diffs.openFile")}
      </button>
    </div>
  );
}
