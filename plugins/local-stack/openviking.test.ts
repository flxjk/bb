import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenVikingClient,
  OpenVikingError,
  isVikingUri,
  normalizeBaseUrl,
} from "./openviking.js";

interface RecordedRequest {
  method: string;
  url: string;
  apiKey: string | undefined;
  body: string;
}

interface StubGateway {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const open: StubGateway[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((gateway) => gateway.close()));
});

async function startGateway(
  respond: (request: RecordedRequest) => {
    status?: number;
    body: string;
    contentType?: string;
  },
): Promise<StubGateway> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const request: RecordedRequest = {
        method: incoming.method ?? "GET",
        url: incoming.url ?? "/",
        apiKey:
          typeof incoming.headers["x-api-key"] === "string"
            ? incoming.headers["x-api-key"]
            : undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      const answer = respond(request);
      outgoing.writeHead(answer.status ?? 200, {
        "content-type": answer.contentType ?? "application/json",
      });
      outgoing.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub gateway did not bind a TCP port");
  }
  const gateway: StubGateway = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  open.push(gateway);
  return gateway;
}

function clientFor(
  gateway: StubGateway,
  apiKey: string | null = null,
): OpenVikingClient {
  return new OpenVikingClient({
    baseUrl: gateway.baseUrl,
    apiKey,
    timeoutMs: 5_000,
  });
}

function envelope(result: unknown): string {
  return JSON.stringify({
    status: "ok",
    result,
    error: null,
    telemetry: null,
    profile: null,
  });
}

describe("isVikingUri", () => {
  it("accepts viking:// URIs and rejects lookalikes", () => {
    expect(isVikingUri("viking://user/default/memories")).toBe(true);
    expect(isVikingUri("viking:/user")).toBe(false);
    expect(isVikingUri("https://viking.example/user")).toBe(false);
    expect(isVikingUri("")).toBe(false);
  });
});

describe("normalizeBaseUrl", () => {
  it("falls back to the loopback default for blank input", () => {
    expect(normalizeBaseUrl("")).toBe("http://127.0.0.1:1933");
    expect(normalizeBaseUrl("   ")).toBe("http://127.0.0.1:1933");
  });

  it("trims whitespace and one trailing slash", () => {
    expect(normalizeBaseUrl(" http://127.0.0.1:1933/ ")).toBe(
      "http://127.0.0.1:1933",
    );
  });
});

describe("OpenVikingClient gateway failures", () => {
  it("reports a gateway error envelope with its code, message and details", async () => {
    const gateway = await startGateway(() => ({
      body: JSON.stringify({
        status: "error",
        result: null,
        error: {
          code: "INVALID_ARGUMENT",
          message: "body.uri: Field required",
          details: { field: "uri" },
        },
      }),
    }));

    const error = await clientFor(gateway)
      .ls("viking://user/default/memories")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVikingError);
    const failure = error as OpenVikingError;
    expect(failure.code).toBe("INVALID_ARGUMENT");
    expect(failure.message).toBe("body.uri: Field required");
    expect(failure.details).toEqual({ field: "uri" });
  });

  it("reports an unreachable gateway as a NETWORK error", async () => {
    const gateway = await startGateway(() => ({ body: envelope(null) }));
    const baseUrl = gateway.baseUrl;
    await gateway.close();

    const error = await new OpenVikingClient({
      baseUrl,
      apiKey: null,
      timeoutMs: 2_000,
    })
      .health()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVikingError);
    const failure = error as OpenVikingError;
    expect(failure.code).toBe("NETWORK");
    expect(failure.message).toContain(baseUrl);
  });

  it("reports a non-JSON body as a PROTOCOL error rather than crashing", async () => {
    const gateway = await startGateway(() => ({
      body: "<html>502 Bad Gateway</html>",
      contentType: "text/html",
    }));

    const error = await clientFor(gateway)
      .status()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenVikingError);
    expect((error as OpenVikingError).code).toBe("PROTOCOL");
  });
});

describe("OpenVikingClient requests", () => {
  it("sends the API key only when one is configured", async () => {
    const gateway = await startGateway(() => ({ body: envelope({}) }));

    await clientFor(gateway).status();
    await clientFor(gateway, "secret-key").status();

    expect(gateway.requests[0]?.apiKey).toBeUndefined();
    expect(gateway.requests[1]?.apiKey).toBe("secret-key");
  });

  it("writes with the requested mode and reports the gateway's byte count", async () => {
    const gateway = await startGateway(() => ({
      body: envelope({
        uri: "viking://user/default/memories/a.md",
        written_bytes: 12,
        mode: "append",
      }),
    }));

    const result = await clientFor(gateway).write(
      "viking://user/default/memories/a.md",
      "# hello",
      "append",
    );

    expect(JSON.parse(gateway.requests[0]?.body ?? "{}")).toEqual({
      uri: "viking://user/default/memories/a.md",
      content: "# hello",
      mode: "append",
    });
    expect(result).toEqual({
      uri: "viking://user/default/memories/a.md",
      writtenBytes: 12,
      mode: "append",
      taskId: null,
    });
  });

  it("falls back to the content length when the gateway omits the byte count", async () => {
    const gateway = await startGateway(() => ({ body: envelope({}) }));

    const result = await clientFor(gateway).write(
      "viking://user/default/memories/a.md",
      "abcd",
    );

    expect(result.writtenBytes).toBe(4);
    expect(result.mode).toBe("replace");
  });

  it("deletes through the filesystem route", async () => {
    const gateway = await startGateway(() => ({ body: envelope(null) }));

    await clientFor(gateway).remove("viking://user/default/memories/a.md");

    expect(gateway.requests[0]?.method).toBe("DELETE");
    expect(gateway.requests[0]?.url).toBe(
      "/api/v1/fs?uri=viking%3A%2F%2Fuser%2Fdefault%2Fmemories%2Fa.md",
    );
  });
});

describe("OpenVikingClient payload parsing", () => {
  it("drops malformed listing entries instead of failing the call", async () => {
    const gateway = await startGateway(() => ({
      body: envelope([
        { uri: "viking://user/default/memories/a.md", size: 3, isDir: false },
        { size: 9 },
        "not an entry",
      ]),
    }));

    const entries = await clientFor(gateway).ls(
      "viking://user/default/memories",
    );

    expect(entries).toEqual([
      {
        uri: "viking://user/default/memories/a.md",
        size: 3,
        isDir: false,
        modTime: null,
        abstract: null,
      },
    ]);
  });

  it("surfaces the retrieval errors a missing local embedding model produces", async () => {
    const gateway = await startGateway(() => ({
      body: envelope({
        entries: [],
        rendered: "",
        stats: {
          retrieval_errors: [
            "EmbeddingConfigurationError: Local embedding is enabled but 'llama-cpp-python' is not installed.",
          ],
        },
      }),
    }));

    const result = await clientFor(gateway).search("reasonix", { limit: 5 });

    expect(result.entries).toEqual([]);
    expect(result.retrievalErrors).toEqual([
      "EmbeddingConfigurationError: Local embedding is enabled but 'llama-cpp-python' is not installed.",
    ]);
    expect(JSON.parse(gateway.requests[0]?.body ?? "{}")).toEqual({
      query: "reasonix",
      limit: 5,
    });
  });

  it("reads health even though /health is not wrapped in an envelope", async () => {
    const gateway = await startGateway(() => ({
      body: JSON.stringify({
        status: "ok",
        healthy: true,
        version: "0.0.0",
        auth_mode: "dev",
      }),
    }));

    const health = await clientFor(gateway).health();

    expect(health).toEqual({
      healthy: true,
      version: "0.0.0",
      authMode: "dev",
    });
    expect(gateway.requests[0]?.url).toBe("/health");
  });
});
