/**
 * Active-session seam contract (todo 13): the chat domain's selection must
 * follow the panel's prune — a stale selection left behind in the chat keeps
 * the composer prompting a dead session (server answers 404).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActiveSession,
  getActiveSession,
  resetActiveSessionForTest,
  setActiveSession,
  subscribeActiveSession,
} from "../activeSession.js";

beforeEach(() => {
  resetActiveSessionForTest();
});

describe("clearActiveSession", () => {
  it("drops the selection and notifies subscribers", () => {
    // Given: a selected session in the chat domain
    setActiveSession("ses_gone");
    const seen: string[] = [];
    subscribeActiveSession(() => {
      seen.push(getActiveSession() ?? "<cleared>");
    });

    // When: the panel prunes it (list no longer contains the id)
    clearActiveSession();

    // Then
    expect(getActiveSession()).toBeUndefined();
    expect(seen).toEqual(["<cleared>"]);
  });

  it("is a silent no-op when nothing is selected", () => {
    // Given/When
    let emitted = 0;
    subscribeActiveSession(() => {
      emitted += 1;
    });
    clearActiveSession();

    // Then
    expect(emitted).toBe(0);
  });
});
