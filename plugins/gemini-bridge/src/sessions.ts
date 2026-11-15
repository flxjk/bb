import type { Content } from "@google/genai";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  GEMINI_MAX_HISTORY_CONTENTS,
  GEMINI_SESSION_FILE,
} from "./vocabulary.js";

export interface GeminiSession {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  contents: Content[];
  turns: number;
  archived: boolean;
  persisted: boolean;
}

const persistedSessionSchema = z.object({
  providerThreadId: z.string().min(1),
  threadId: z.string().min(1),
  cwd: z.string().min(1),
  contents: z.array(z.unknown()),
  turns: z.number().int().nonnegative(),
  archived: z.boolean(),
});

const persistedFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(persistedSessionSchema),
});

function isContent(value: unknown): value is Content {
  return typeof value === "object" && value !== null;
}

export class GeminiSessionStore {
  private readonly filePath: string;
  private readonly sessions = new Map<string, GeminiSession>();
  private writeScheduled = false;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, GEMINI_SESSION_FILE);
    this.load();
  }

  get(providerThreadId: string): GeminiSession | undefined {
    return this.sessions.get(providerThreadId);
  }

  create(args: {
    threadId: string;
    providerThreadId: string;
    cwd: string;
    archived?: boolean;
    turns?: number;
  }): GeminiSession {
    const session: GeminiSession = {
      threadId: args.threadId,
      providerThreadId: args.providerThreadId,
      cwd: args.cwd,
      contents: [],
      turns: args.turns ?? 0,
      archived: args.archived ?? false,
      persisted: true,
    };
    this.sessions.set(args.providerThreadId, session);
    this.schedule();
    return session;
  }

  adopt(session: GeminiSession): void {
    this.sessions.set(session.providerThreadId, session);
  }

  forget(providerThreadId: string): void {
    if (this.sessions.delete(providerThreadId)) this.schedule();
  }

  appendContent(session: GeminiSession, contents: readonly Content[]): void {
    session.contents.push(...contents);
    const overflow = session.contents.length - GEMINI_MAX_HISTORY_CONTENTS;
    if (overflow > 0) session.contents.splice(0, overflow);
    this.schedule();
  }

  markTurns(session: GeminiSession, turns: number): void {
    session.turns = turns;
    this.schedule();
  }

  setArchived(session: GeminiSession, archived: boolean): void {
    session.archived = archived;
    this.schedule();
  }

  setPersisted(session: GeminiSession, persisted: boolean): void {
    session.persisted = persisted;
    this.schedule();
  }

  flush(): void {
    this.writeScheduled = false;
    const sessions = [...this.sessions.values()]
      .filter((session) => session.persisted)
      .map((session) => ({
        providerThreadId: session.providerThreadId,
        threadId: session.threadId,
        cwd: session.cwd,
        contents: session.contents,
        turns: session.turns,
        archived: session.archived,
      }));
    const payload = `${JSON.stringify({ version: 1, sessions })}\n`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tempPath, payload);
      renameSync(tempPath, this.filePath);
    } catch {}
  }

  private schedule(): void {
    if (this.writeScheduled) return;
    this.writeScheduled = true;
    const timer = setTimeout(() => this.flush(), 250);
    timer.unref?.();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const file = persistedFileSchema.safeParse(parsed);
    if (!file.success) return;
    for (const entry of file.data.sessions) {
      this.sessions.set(entry.providerThreadId, {
        threadId: entry.threadId,
        providerThreadId: entry.providerThreadId,
        cwd: entry.cwd,
        contents: entry.contents.filter(isContent),
        turns: entry.turns,
        archived: entry.archived,
        persisted: true,
      });
    }
  }
}
