/** Typed error seam for the shared messenger protocol. */

export class MessengerError extends Error {}

export class MalformedMessageError extends MessengerError {
  constructor(detail: string) {
    super(`malformed message: ${detail}`);
    this.name = "MalformedMessageError";
  }
}

export class UnknownMessageTypeError extends MessengerError {
  constructor(readonly type: string) {
    super(`unknown message type: ${type}`);
    this.name = "UnknownMessageTypeError";
  }
}

/** Thrown when a reply envelope references a messageId with no inflight request. */
export class UnknownMessageIdError extends MessengerError {
  constructor(readonly messageId: string) {
    super(`reply for unknown messageId: ${messageId}`);
    this.name = "UnknownMessageIdError";
  }
}

/** Webview-side surface of a host handler failure (`status:"error"` reply). */
export class RemoteError extends MessengerError {
  constructor(message: string) {
    super(message);
    this.name = "RemoteError";
  }
}
