/**
 * /session/:id action routes: fork/share/abort/summarize/revert/command/shell/
 * prompt/message/todo/diff/permission/question. prompt_async returns 204 and the
 * scripted REPLAY drives SSE; sync POST /message awaits it.
 *
 * Unshare is DELETE /session/:id/share (the real verb) — POST .../unshare does
 * not exist and therefore hits the catch-all JSON 404.
 */
import type { MessageId } from "./types.js";
import type { SessionRecord } from "./state.js";
import { createAssistantMessage, createMockSession, createUserMessage } from "./state.js";
import { runReplay } from "./scenarios.js";
import { HttpError, sendApiError, sendJson, sendNoContent } from "./httpkit.js";
import type { MockHttpServer, Route } from "./server.js";

export function buildSessionRoutes(srv: MockHttpServer): Route[] {
  const byId = srv.sessionHandler.bind(srv);
  const modern = srv.modern.bind(srv);
  const json = sendJson;

  return [
    ["POST", "/session/:id/fork", modern("/session/:id/fork", byId((rec, { state, body }, res) => {
      const fork = createMockSession(state, `${rec.info.title} (fork)`, rec.info.id);
      const upto = typeof body.messageID === "string" ? body.messageID : undefined;
      const idx = upto === undefined ? -1 : rec.messages.findIndex((m) => m.info.id === upto);
      fork.messages = idx === -1 ? [...rec.messages] : rec.messages.slice(0, idx + 1);
      state.sessions.set(fork.info.id, fork);
      srv.emit({ type: "session.created", properties: { info: fork.info } });
      json(res, 200, fork.info);
    }))],

    ["POST", "/session/:id/share", byId((rec, _ctx, res) => {
      rec.info.share = { url: `https://mock.opncd.invalid/s/${rec.info.id}` };
      srv.emit({ type: "session.updated", properties: { info: rec.info } });
      json(res, 200, rec.info);
    })],
    ["DELETE", "/session/:id/share", byId((rec, _ctx, res) => {
      delete rec.info.share;
      srv.emit({ type: "session.updated", properties: { info: rec.info } });
      json(res, 200, rec.info);
    })],
    ["POST", "/session/:id/abort", byId((rec, { state }, res) => {
      state.abortRequested.add(rec.info.id);
      srv.emit({ type: "session.status", properties: { sessionID: rec.info.id, status: { type: "idle" } } });
      json(res, 200, true);
    })],
    ["POST", "/session/:id/summarize", byId((rec, _ctx, res) => {
      srv.emit({ type: "session.compacted", properties: { sessionID: rec.info.id } });
      json(res, 200, true);
    })],
    ["POST", "/session/:id/revert", byId((rec, { body, state }, res) => {
      const messageID = body.messageID;
      if (typeof messageID !== "string") throw new HttpError(400, "revert requires messageID");
      rec.info.revert = { messageID: messageID as MessageId };
      rec.info.time.updated = state.now();
      srv.emit({ type: "session.updated", properties: { info: rec.info } });
      json(res, 200, rec.info);
    })],
    ["POST", "/session/:id/unrevert", byId((rec, { state }, res) => {
      delete rec.info.revert;
      rec.info.time.updated = state.now();
      srv.emit({ type: "session.updated", properties: { info: rec.info } });
      json(res, 200, rec.info);
    })],

    ["POST", "/session/:id/command", byId((rec, { body, state }, res) => {
      const command = typeof body.command === "string" ? body.command : "unknown";
      const start = state.now();
      const user = createUserMessage(state, rec.info.id);
      const assistant = createAssistantMessage(state, rec.info.id, user.id);
      assistant.time.completed = state.now();
      assistant.finish = "stop";
      const parts = [{
        id: state.partId(), sessionID: rec.info.id, messageID: assistant.id, type: "text" as const,
        text: `ran /${command} (mock)`, time: { start, end: state.now() },
      }];
      rec.messages.push({ info: user, parts: [] }, { info: assistant, parts });
      srv.emit({ type: "command.executed", properties: { name: command, sessionID: rec.info.id, arguments: String(body.arguments ?? ""), messageID: assistant.id } });
      srv.emit({ type: "message.updated", properties: { info: assistant } });
      json(res, 200, { info: assistant, parts });
    })],
    ["POST", "/session/:id/shell", byId((rec, { body, state }, res) => {
      const command = typeof body.command === "string" ? body.command : "";
      const start = state.now();
      const user = createUserMessage(state, rec.info.id);
      const assistant = createAssistantMessage(state, rec.info.id, user.id);
      assistant.time.completed = state.now();
      assistant.finish = "stop";
      rec.messages.push({ info: user, parts: [] }, {
        info: assistant,
        parts: [{
          id: state.partId(), sessionID: rec.info.id, messageID: assistant.id, type: "tool" as const,
          callID: state.requestId("call"), tool: "bash",
          state: { status: "completed" as const, input: { command }, output: "mock shell output\n", title: command || "shell", metadata: {}, time: { start, end: state.now() } },
        }],
      });
      srv.emit({ type: "message.updated", properties: { info: assistant } });
      json(res, 200, assistant);
    })],

    ["POST", "/session/:id/prompt_async", modern("/session/:id/prompt_async", byId(async (rec, _ctx, res) => {
      runReplay(srv.state, rec, (event) => srv.emit(event));
      sendNoContent(res);
    }))],
    ["POST", "/session/:id/message", byId(async (rec, _ctx, res) => {
      const handle = runReplay(srv.state, rec, (event) => srv.emit(event));
      const message = await handle.done;
      json(res, 200, message);
    })],
    ["GET", "/session/:id/message", byId((rec, { query }, res) => {
      const limit = Number(query.get("limit") ?? "0");
      const messages = limit > 0 ? rec.messages.slice(-limit) : rec.messages;
      json(res, 200, messages);
    })],
    ["GET", "/session/:id/message/:messageID", byId((rec, { params }, res) => {
      const found = rec.messages.find((m) => m.info.id === params.messageID);
      if (found === undefined) {
        sendApiError(res, 404, `message not found: ${params.messageID ?? ""}`);
        return;
      }
      json(res, 200, found);
    })],

    ["GET", "/session/:id/todo", modern("/session/:id/todo", byId((rec: SessionRecord, _ctx, res) => json(res, 200, rec.todos)))],
    ["GET", "/session/:id/diff", byId((rec, _ctx, res) => {
      const diff = rec.messages.length === 0 ? [] : [{
        file: "src/example.ts", before: "export const value = 1;\n", after: "export const value = 2;\nexport const extra = true;\n", additions: 2, deletions: 0,
      }];
      json(res, 200, diff);
    })],

    ["POST", "/session/:id/permissions/:permissionID", byId((rec, { params, body, state }, res) => {
      const pending = state.pendingPermissions.get(params.permissionID ?? "");
      if (pending === undefined || pending.request.sessionID !== rec.info.id) {
        sendApiError(res, 404, `permission not found: ${params.permissionID ?? ""}`);
        return;
      }
      const response = body.response;
      if (response !== "once" && response !== "always" && response !== "reject") {
        throw new HttpError(400, "response must be once | always | reject");
      }
      pending.settle(response);
      json(res, 200, true);
    })],
    ["POST", "/session/:id/questions/:requestID", modern("/session/:id/questions/:requestID", byId((rec, { params, body, state }, res) => {
      const pending = state.pendingQuestions.get(params.requestID ?? "");
      if (pending === undefined || pending.request.sessionID !== rec.info.id) {
        sendApiError(res, 404, `question not found: ${params.requestID ?? ""}`);
        return;
      }
      pending.settle({ answers: body.answers, reject: body.reject === true });
      json(res, 200, true);
    }))],
    ["POST", "/api/session/:id/question/:requestID/reply", modern("/api/session/:id/question/:requestID/reply", byId((rec, { params, body, state }, res) => {
      const pending = state.pendingQuestions.get(params.requestID ?? "");
      if (pending === undefined || pending.request.sessionID !== rec.info.id) {
        sendApiError(res, 404, `question not found: ${params.requestID ?? ""}`);
        return;
      }
      pending.settle({ answers: body.answers, reject: body.reject === true });
      json(res, 200, true);
    }))],
  ];
}
