import test from "node:test";
import assert from "node:assert/strict";
import { createPracticeTestChangeHandler } from "./practiceTestState";

test("practice test changes only invoke practice-test callbacks", () => {
  let practiceChanged = 0;

  const handler = createPracticeTestChangeHandler({
    onPracticeTestChanged: () => {
      practiceChanged += 1;
    },
  });

  handler();

  assert.equal(practiceChanged, 1);
});
