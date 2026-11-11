import { afterEach, describe, expect, it } from "vitest";
import {
  afterCommit,
  isAppUpdateSendHoldSet,
  setAppUpdateSendHold,
} from "../src/index.js";
import { createMigratedConnection } from "../src/testing.js";

const connections: ReturnType<typeof createMigratedConnection>[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
});

describe("afterCommit", () => {
  it("discards rolled-back savepoints and keeps committed callbacks in order", () => {
    const db = createMigratedConnection();
    connections.push(db);
    const order: number[] = [];
    db.transaction((tx) => {
      afterCommit(tx, () => {
        setAppUpdateSendHold(db, true);
        order.push(1);
      });
      expect(() =>
        tx.transaction((nested) => {
          afterCommit(nested, () => order.push(999));
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      tx.transaction((nested) => {
        afterCommit(nested, () => order.push(2));
      });
      expect(order).toEqual([]);
    });
    expect(order).toEqual([1, 2]);
    expect(isAppUpdateSendHoldSet(db)).toBe(true);
  });
});
