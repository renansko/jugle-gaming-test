import { describe, expect, test } from "bun:test";
import { OutboxPublisher } from "../../src/infrastructure/messaging/outbox-publisher";

interface PublisherTestManager {
  getConnection(): {
    execute(query: string, params?: unknown[]): Promise<unknown[]>;
  };
  find(): Promise<unknown[]>;
  transactional<T>(
    callback: (transactionManager: PublisherTestManager) => Promise<T>,
  ): Promise<T>;
}

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

  test("finalizes successful entries and retries only failed batch entries", async () => {
    const messages = [
      {
        id: "event-1",
        payload: { aggregateId: "aggregate-1" },
        attemptCount: 0,
        nextAttemptAt: new Date(),
      },
      {
        id: "event-2",
        payload: { aggregateId: "aggregate-2" },
        attemptCount: 0,
        nextAttemptAt: new Date(),
      },
    ];
    const executions: Array<{ query: string; params?: unknown[] }> = [];
    let claimedLeaseToken: unknown;
    const manager: PublisherTestManager = {
      getConnection: () => ({
        execute: async (query: string, params?: unknown[]) => {
          executions.push({ query, params });
          if (query.includes("RETURNING outbox_alias.id")) {
            claimedLeaseToken = params?.[2];
            return messages.map((message) => ({
              id: message.id,
              lease_token: claimedLeaseToken,
            }));
          }
          if (query.includes("COUNT(*)::text AS pending")) {
            return [{ pending: "1", lagMs: "0" }];
          }
          return [];
        },
      }),
      find: async () => messages,
      transactional: async <T>(
        callback: (transactionManager: PublisherTestManager) => Promise<T>,
      ) => callback(manager),
    };
    let sentEntries: Array<{
      Id: string;
      MessageDeduplicationId: string;
    }> = [];
    const client = {
      send: async (command: { input: { Entries?: typeof sentEntries } }) => {
        sentEntries = command.input.Entries ?? [];
        return {
          Successful: [{ Id: "event-1" }],
          Failed: [{ Id: "event-2", Code: "InternalError" }],
        };
      },
      destroy: () => undefined,
    };
    const publisher = new OutboxPublisher(
      {
        awsRegion: "us-east-1",
        sqsEndpoint: "http://localhost:4566",
        awsAccessKeyId: "test",
        awsSecretAccessKey: "test",
        eventQueueUrl: "http://localhost:4566/events",
      } as never,
      { em: { fork: () => manager } } as never,
      { increment: () => undefined, set: () => undefined } as never,
      client as never,
    );

    await expect(publisher.publishBatch()).resolves.toEqual({
      published: 1,
      retried: 1,
    });
    expect(sentEntries).toEqual([
      expect.objectContaining({
        Id: "event-1",
        MessageDeduplicationId: "event-1",
      }),
      expect.objectContaining({
        Id: "event-2",
        MessageDeduplicationId: "event-2",
      }),
    ]);

    const publishedUpdate = executions.find((execution) =>
      execution.query.includes("SET published_at = NOW()"),
    );
    const retryUpdate = executions.find((execution) =>
      execution.query.includes("SET attempt_count = attempt_count + 1"),
    );
    expect(publishedUpdate?.params).toEqual(["event-1", claimedLeaseToken]);
    expect(retryUpdate?.params?.slice(1)).toEqual([
      "event-2",
      claimedLeaseToken,
    ]);
  });

  test("retries the same stable event IDs after an ambiguous transport failure", async () => {
    const message = {
      id: "stable-event-id",
      payload: { aggregateId: "aggregate-1" },
      attemptCount: 0,
      nextAttemptAt: new Date(),
    };
    const executions: Array<{ query: string; params?: unknown[] }> = [];
    let claimedLeaseToken: unknown;
    const manager: PublisherTestManager = {
      getConnection: () => ({
        execute: async (query: string, params?: unknown[]) => {
          executions.push({ query, params });
          if (query.includes("RETURNING outbox_alias.id")) {
            claimedLeaseToken = params?.[2];
            return [{ id: message.id, lease_token: claimedLeaseToken }];
          }
          if (query.includes("COUNT(*)::text AS pending")) {
            return [{ pending: "1", lagMs: "0" }];
          }
          return [];
        },
      }),
      find: async () => [message],
      transactional: async <T>(
        callback: (transactionManager: PublisherTestManager) => Promise<T>,
      ) => callback(manager),
    };
    let sentDeduplicationId: string | undefined;
    const client = {
      send: async (command: {
        input: { Entries?: Array<{ MessageDeduplicationId: string }> };
      }) => {
        sentDeduplicationId =
          command.input.Entries?.[0]?.MessageDeduplicationId;
        throw new Error("connection lost after send");
      },
      destroy: () => undefined,
    };
    const publisher = new OutboxPublisher(
      {
        awsRegion: "us-east-1",
        sqsEndpoint: "http://localhost:4566",
        awsAccessKeyId: "test",
        awsSecretAccessKey: "test",
        eventQueueUrl: "http://localhost:4566/events",
      } as never,
      { em: { fork: () => manager } } as never,
      { increment: () => undefined, set: () => undefined } as never,
      client as never,
    );

    await expect(publisher.publishBatch()).resolves.toEqual({
      published: 0,
      retried: 1,
    });
    expect(sentDeduplicationId).toBe(message.id);

    const retryUpdate = executions.find((execution) =>
      execution.query.includes("SET attempt_count = attempt_count + 1"),
    );
    expect(retryUpdate?.params?.slice(1)).toEqual([
      message.id,
      claimedLeaseToken,
    ]);
  });

  test("generates unique lease tokens for separate publisher instances and matches token on finalize", async () => {
    const messageA = {
      id: "event-a",
      payload: { aggregateId: "agg-a" },
      attemptCount: 0,
      nextAttemptAt: new Date(),
    };
    const messageB = {
      id: "event-b",
      payload: { aggregateId: "agg-b" },
      attemptCount: 0,
      nextAttemptAt: new Date(),
    };

    const claimedTokens: string[] = [];
    const finalizeQueries: Array<{ query: string; params?: unknown[] }> = [];

    const createManager = (msg: typeof messageA) => {
      const manager: PublisherTestManager = {
        getConnection: () => ({
          execute: async (query: string, params?: unknown[]) => {
            if (query.includes("RETURNING outbox_alias.id")) {
              const token = String(params?.[2]);
              claimedTokens.push(token);
              return [{ id: msg.id, lease_token: token }];
            }
            if (query.includes("SET published_at = NOW()")) {
              finalizeQueries.push({ query, params });
              return [];
            }
            if (query.includes("COUNT(*)::text AS pending")) {
              return [{ pending: "0", lagMs: "0" }];
            }
            return [];
          },
        }),
        find: async () => [msg],
        transactional: async <T>(
          callback: (transactionManager: PublisherTestManager) => Promise<T>,
        ) => callback(manager),
      };
      return manager;
    };

    const client = {
      send: async (command: { input: { Entries?: Array<{ Id: string }> } }) => {
        const id = command.input.Entries?.[0]?.Id ?? "event";
        return { Successful: [{ Id: id }], Failed: [] };
      },
      destroy: () => undefined,
    };

    const config = {
      awsRegion: "us-east-1",
      sqsEndpoint: "http://localhost:4566",
      awsAccessKeyId: "test",
      awsSecretAccessKey: "test",
      eventQueueUrl: "http://localhost:4566/events",
    };
    const metrics = { increment: () => undefined, set: () => undefined };

    const pubA = new OutboxPublisher(
      config as never,
      { em: { fork: () => createManager(messageA) } } as never,
      metrics as never,
      client as never,
    );
    const pubB = new OutboxPublisher(
      config as never,
      { em: { fork: () => createManager(messageB) } } as never,
      metrics as never,
      client as never,
    );

    const [resA, resB] = await Promise.all([
      pubA.publishBatch(),
      pubB.publishBatch(),
    ]);

    expect(resA).toEqual({ published: 1, retried: 0 });
    expect(resB).toEqual({ published: 1, retried: 0 });
    expect(claimedTokens).toHaveLength(2);
    expect(claimedTokens[0]).not.toBe(claimedTokens[1]);

    const finalizeA = finalizeQueries.find((q) => q.params?.[0] === "event-a");
    const finalizeB = finalizeQueries.find((q) => q.params?.[0] === "event-b");
    expect(finalizeA?.params?.[1]).toBe(claimedTokens[0]);
    expect(finalizeB?.params?.[1]).toBe(claimedTokens[1]);
  });
});
