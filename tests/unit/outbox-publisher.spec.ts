import { describe, expect, test } from "bun:test";
import { OutboxPublisher } from "../../src/infrastructure/messaging/outbox-publisher";

describe("OutboxPublisher", () => {
  test("confirms the claim before calling SQS", async () => {
    let claimCommitted = false;
    let networkCalled = false;
    const message = {
      id: "event-1",
      payload: { aggregateId: "aggregate-1" },
      attemptCount: 0,
      nextAttemptAt: new Date(),
    };
    interface MockConnection {
      execute: (
        query: string,
      ) => Promise<Array<{ id: string; lease_token?: string }>>;
    }

    interface MockEntityManager {
      getConnection: () => MockConnection;
      find: () => Promise<Array<typeof message>>;
      transactional: <T>(
        callback: (transactionManager: MockEntityManager) => Promise<T>,
      ) => Promise<T>;
    }

    const connection: MockConnection = {
      execute: async (query: string) => {
        if (query.includes("RETURNING outbox_alias.id")) {
          return [{ id: message.id, lease_token: "lease-1" }];
        }
        return [];
      },
    };

    const manager: MockEntityManager = {
      getConnection: () => connection,
      find: async () => [message],
      transactional: async <T>(
        callback: (transactionManager: MockEntityManager) => Promise<T>,
      ) => {
        const result = await callback(manager);
        claimCommitted = true;
        return result;
      },
    };

    const fakeClient = {
      send: async () => {
        networkCalled = true;
        expect(claimCommitted).toBe(true);
        return { Successful: [{ Id: message.id }], Failed: [] };
      },
      destroy: () => undefined,
    };
    const orm = { em: { fork: () => manager } };
    const config = {
      awsRegion: "us-east-1",
      sqsEndpoint: "http://localhost:4566",
      awsAccessKeyId: "test",
      awsSecretAccessKey: "test",
      eventQueueUrl: "http://localhost:4566/events",
    };
    const metrics = { increment: () => undefined, set: () => undefined };
    const publisher = new OutboxPublisher(
      config as never,
      orm as never,
      metrics as never,
      fakeClient as never,
    );

    await expect(publisher.publishBatch()).resolves.toEqual({
      published: 1,
      retried: 0,
    });
    expect(networkCalled).toBe(true);
  });
});
