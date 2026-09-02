import { expect, mock, test } from "bun:test";
import { PendingReferenceWorker } from "../../src/infrastructure/messaging/pending-reference-worker";

test("claims pending references without a scheduled retry time", async () => {
  const execute = mock((_query: string) => Promise.resolve([]));
  const orm = {
    em: {
      fork: () => ({
        getConnection: () => ({ execute }),
      }),
    },
  };
  const wagering = { resolvePendingReference: mock(async () => "ignored") };
  const metrics = { increment: mock(() => undefined) };
  const worker = new PendingReferenceWorker(
    orm as never,
    wagering as never,
    metrics as never,
  );

  await worker.processBatch();

  expect(execute).toHaveBeenCalled();
  const [firstCall] = execute.mock.calls;
  expect(firstCall?.[0]).toContain("next_reference_attempt_at IS NULL");
});
