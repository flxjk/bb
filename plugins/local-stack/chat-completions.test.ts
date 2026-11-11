import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatCompletionError,
  completeChat,
  listChatModels,
} from "./chat-completions.js";

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

interface StubServer {
  baseUrl: string;
  requests: RecordedRequest[];
}

const open: Array<{ server: Server; closed: boolean }> = [];

afterEach(async () => {
  await Promise.all(
    open.splice(0).map(async (entry) => {
      if (entry.closed || !entry.server.listening) return;
      entry.closed = true;
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    }),
  );
});

async function startStub(
  respond: (request: RecordedRequest) => {
    status?: number;
    body: string;
  },
): Promise<StubServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const request: RecordedRequest = {
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        authorization:
          typeof incoming.headers.authorization === "string"
            ? incoming.headers.authorization
            : undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      const answer = respond(request);
      outgoing.writeHead(answer.status ?? 200, {
        "content-type": "application/json",
      });
      outgoing.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub server did not bind a TCP port");
  }
  open.push({ server, closed: false });
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function completion(text: string): string {
  return JSON.stringify({
    choices: [{ message: { role: "assistant", content: text } }],
  });
}

const SIGNAL = (): AbortSignal => AbortSignal.timeout(5_000);

describe("completeChat", () => {
  it("posts the model and prompt and returns the provider's text", async () => {
    const stub = await startStub(() => ({ body: completion("  A title.  ") }));

    const text = await completeChat({
      baseUrl: stub.baseUrl,
      apiKey: "sk-test",
      model: "deepseek-chat",
      prompt: "Name this thread.",
      timeoutMs: 4_500,
      signal: SIGNAL(),
    });

    expect(text).toBe("  A title.  ");
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe("/chat/completions");
    expect(stub.requests[0]?.authorization).toBe("Bearer sk-test");
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Name this thread." }],
      stream: false,
      temperature: 0,
    });
  });

  it("sends no Authorization header without a key", async () => {
    const stub = await startStub(() => ({ body: completion("ok") }));

    await completeChat({
      baseUrl: stub.baseUrl,
      apiKey: null,
      model: "lfm3:1.7b",
      prompt: "hi",
      timeoutMs: 4_500,
      signal: SIGNAL(),
    });

    expect(stub.requests[0]?.authorization).toBeUndefined();
  });

  it("turns a provider error body into a readable failure", async () => {
    const stub = await startStub(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: "Invalid API key" } }),
    }));

    const error = await completeChat({
      baseUrl: stub.baseUrl,
      apiKey: "wrong",
      model: "m",
      prompt: "hi",
      timeoutMs: 4_500,
      signal: SIGNAL(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatCompletionError);
    const failure = error as ChatCompletionError;
    expect(failure.status).toBe(401);
    expect(failure.message).toContain("HTTP 401");
    expect(failure.message).toContain("Invalid API key");
  });

  it("reports an unreachable provider with its address", async () => {
    const stub = await startStub(() => ({ body: completion("ok") }));
    const baseUrl = stub.baseUrl;
    const entry = open.at(-1);
    if (entry !== undefined && entry.server.listening) {
      entry.closed = true;
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    }

    const error = await completeChat({
      baseUrl,
      apiKey: null,
      model: "m",
      prompt: "hi",
      timeoutMs: 2_000,
      signal: SIGNAL(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).message).toContain(baseUrl);
  });

  it("fails clearly when the provider answers without message text", async () => {
    const stub = await startStub(() => ({
      body: JSON.stringify({ choices: [{ message: { content: "   " } }] }),
    }));

    await expect(
      completeChat({
        baseUrl: stub.baseUrl,
        apiKey: null,
        model: "m",
        prompt: "hi",
        timeoutMs: 4_500,
        signal: SIGNAL(),
      }),
    ).rejects.toThrow(/without any message text/u);
  });
});

describe("listChatModels", () => {
  it("returns the provider's model ids, sorted", async () => {
    const stub = await startStub(() => ({
      body: JSON.stringify({
        data: [{ id: "z-model" }, { id: "a-model" }, { id: 7 }, "junk"],
      }),
    }));

    const models = await listChatModels({
      baseUrl: stub.baseUrl,
      apiKey: "sk-test",
      timeoutMs: 5_000,
      signal: SIGNAL(),
    });

    expect(models).toEqual(["a-model", "z-model"]);
    expect(stub.requests[0]?.url).toBe("/models");
    expect(stub.requests[0]?.authorization).toBe("Bearer sk-test");
  });

  it("fails with the status when the provider rejects the key", async () => {
    const stub = await startStub(() => ({
      status: 403,
      body: JSON.stringify({ error: "forbidden" }),
    }));

    const error = await listChatModels({
      baseUrl: stub.baseUrl,
      apiKey: "wrong",
      timeoutMs: 5_000,
      signal: SIGNAL(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatCompletionError);
    expect((error as ChatCompletionError).status).toBe(403);
  });
});
