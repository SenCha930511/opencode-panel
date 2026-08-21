/**
 * Pure assembly of the todo-3 `init` payload the host posts to a webview
 * after its `ready` handshake (plan todo 10).
 *
 * Payload slices, per the plan:
 *  - locale/strings: todo-4 `buildInitStrings(vscode.env.language)` — the env
 *    language is injected by the activation layer, keeping this module
 *    node-testable.
 *  - settings: the current todo-6 config snapshot.
 *  - server: the todo-8 state snapshot — `{url, version}` once managed/
 *    attached, `{url:"", version:null}` otherwise; NO credentials ever ride
 *    this payload (secrets stay in SecretStorage, server URLs are the only
 *    endpoint datum and are always credential-free by todo-6 construction).
 *  - capabilities: todo-7 capabilities from `manager.onboardClient()` when
 *    connected (managed/attached), mapped onto the todo-3 wire aliases
 *    fork/question/todo. DEVIATION (documented, binding): todo-3 protocol.ts
 *    types `InitPayload.capabilities` as a NON-nullable ServerCapabilities
 *    and todo-10 forbids touching src/shared, so "not connected" is carried
 *    as the all-false zero record instead of literal `null` — a connected
 *    server with every feature probed-negative is indistinguishable from
 *    disconnected at the protocol level; the `server.url === ""` slice
 *    disambiguates state for the UI.
 */

import type { PanelConfigAccessor } from "../host/config.js";
import { buildInitStrings } from "../host/locale.js";
import type { Capabilities } from "../server/capabilities.js";
import type { ServerManager, ServerManagerState } from "../server/ServerManager.js";
import type {
  InitPayload,
  ServerCapabilities,
  ServerInfo,
} from "../shared/protocol.js";

/** Narrow seam over the todo-8 manager — the only surface init assembly needs. */
export type InitManagerSurface = Pick<ServerManager, "state" | "onboardClient">;

export interface InitPayloadDeps {
  readonly envLanguage: string;
  readonly config: PanelConfigAccessor;
  readonly manager: InitManagerSurface;
}

const DISCONNECTED_SERVER: ServerInfo = { url: "", version: null };

const ZERO_CAPABILITIES: ServerCapabilities = {
  fork: false,
  question: false,
  todo: false,
};

function assertNever(value: never): never {
  throw new Error(`unreachable server state: ${JSON.stringify(value)}`);
}

/** Defined baseUrl only while the lifecycle reports a live connection. */
function connectedBaseUrl(state: ServerManagerState): string | null {
  switch (state.kind) {
    case "managed":
    case "attached":
      return state.baseUrl;
    case "stopped":
    case "probing":
    case "stopping":
    case "error":
      return null;
    default:
      return assertNever(state);
  }
}

function wireCapabilities(capabilities: Capabilities): ServerCapabilities {
  return {
    fork: capabilities.hasFork,
    question: capabilities.hasQuestion,
    todo: capabilities.hasTodo,
    omo: capabilities.omoDetected,
    omoMcpNote: capabilities.omoMcpNote,
  };
}

/**
 * Builds `buildInitPayload`, the single producer of init payloads for both
 * views. State reads stay synchronous; capability detection is awaited only
 * when the manager already reports a live connection (managed/attached), so
 * building a payload can never START the server as a side effect. A server
 * that dies between the state read and detection degrades to an honest
 * unknown-version snapshot at its last known URL, never to a throw.
 */
export function createInitPayloadBuilder(deps: InitPayloadDeps): () => Promise<InitPayload> {
  return async () => {
    const settings = { ...deps.config.read() };
    const { locale, strings } = buildInitStrings(deps.envLanguage, settings.language);
    const state = deps.manager.state;
    const baseUrl = connectedBaseUrl(state);
    let server: ServerInfo = DISCONNECTED_SERVER;
    let capabilities: ServerCapabilities = ZERO_CAPABILITIES;
    if (baseUrl !== null) {
      const onboard = await deps.manager.onboardClient();
      if (onboard.ok) {
        capabilities = wireCapabilities(onboard.connection.capabilities);
        const { version } = onboard.connection.capabilities;
        server = { url: onboard.connection.baseUrl, version: version === "" ? null : version };
      } else {
        server = { url: baseUrl, version: null };
      }
    }
    return { locale, settings, strings, server, capabilities };
  };
}
