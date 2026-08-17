import test from "node:test";
import assert from "node:assert/strict";
import { parseAssessmentText } from "./assessmentParser";

const mockContext = {
  classGrade: "Class 10",
  subject: "Science",
  chapterNo: 6,
  chapterName: "Life Processes",
  topicName: "Photosynthesis"
};

test("Parses standard practice test format with metadata, MCQs, Assertion & Reason, and True/False", () => {
  const sampleInput = `
Chapter: Life Processes

Topic: Photosynthesis

Theme: Biology Fundamentals

MCQs

1. Which organelle is known as the powerhouse of the cell?

A. Ribosome
B. Mitochondria
C. Chloroplast
D. Endoplasmic Reticulum

Correct Answer: B

⸻

2. What gas is released during light-dependent reactions of photosynthesis?

A. Carbon Dioxide
B. Oxygen
C. Nitrogen
D. Hydrogen

Correct Answer: B

⸻

Assertion & Reasoning

3. Assertion (A): Plants synthesize their own food through photosynthesis.

Reason (R): Photosynthesis converts light energy into chemical energy stored in glucose.

A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.

Correct Answer: A

⸻

True / False

4. Chlorophyll pigments reflect green wavelengths of light.

True
False

Correct Answer: True
`;

  const result = parseAssessmentText(sampleInput, mockContext);

  assert.equal(result.success, true);
  assert.equal(result.questions.length, 4);

  // Metadata check
  assert.equal(result.metadata?.chapter, "Life Processes");
  assert.equal(result.metadata?.topic, "Photosynthesis");
  assert.equal(result.metadata?.theme, "Biology Fundamentals");

  // Q1 check
  const q1 = result.questions[0];
  assert.equal(q1.type, "mcq");
  assert.equal(q1.question, "Which organelle is known as the powerhouse of the cell?");
  assert.equal(q1.options.length, 4);
  assert.equal(q1.correctAnswer, "B");

  // Q2 check
  const q2 = result.questions[1];
  assert.equal(q2.type, "mcq");
  assert.equal(q2.question, "What gas is released during light-dependent reactions of photosynthesis?");
  assert.equal(q2.options.length, 4);
  assert.equal(q2.correctAnswer, "B");

  // Q3 Assertion & Reasoning check
  const q3 = result.questions[2];
  assert.equal(q3.type, "assertion_reason");
  assert.ok(q3.question.includes("Assertion (A): Plants synthesize their own food through photosynthesis."));
  assert.ok(q3.question.includes("Reason (R): Photosynthesis converts light energy into chemical energy stored in glucose."));
  assert.equal(q3.options.length, 4);
  assert.equal(q3.correctAnswer, "A");

  // Q4 True / False check
  const q4 = result.questions[3];
  assert.equal(q4.type, "true_false");
  assert.equal(q4.question, "Chlorophyll pigments reflect green wavelengths of light.");
  assert.deepEqual(q4.options, ["True", "False"]);
  assert.equal(q4.correctAnswer, "True");
});

test("Parses varied numbering styles: 1., 2), 15:, 30. and ignores checkmarks", () => {
  const variedInput = `
1) What is the chemical formula for water?
A) H2O ✅
B) CO2
C) NaCl
D) CH4
Correct Answer: A

⸻

15: Plants absorb water through:
A. Stomata
B. Root hairs
C. Flower petals
D. Bark
Correct Answer: B

⸻

30. True / False
Stomata open when guard cells lose water.
True
False
Correct Answer: False
`;

  const result = parseAssessmentText(variedInput, mockContext);
  assert.equal(result.success, true);
  assert.equal(result.questions.length, 3);

  assert.equal(result.questions[0].question, "What is the chemical formula for water?");
  assert.equal(result.questions[0].correctAnswer, "A");
  assert.equal(result.questions[0].options[0], "A. H2O");

  assert.equal(result.questions[1].question, "Plants absorb water through:");
  assert.equal(result.questions[1].correctAnswer, "B");

  assert.equal(result.questions[2].type, "true_false");
  assert.equal(result.questions[2].correctAnswer, "False");
});

test("Skips malformed questions without failing the rest of the import", () => {
  const inputWithMalformed = `
1. Valid Question 1?
A. Opt 1
B. Opt 2
Correct Answer: A

⸻

2. This question has no options or answer.

⸻

3. Valid Question 3?
A. Opt A
B. Opt B
Correct Answer: B
`;

  const result = parseAssessmentText(inputWithMalformed, mockContext);
  assert.equal(result.success, true);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].question, "Valid Question 1?");
  assert.equal(result.questions[1].question, "Valid Question 3?");
  assert.ok(result.errors.length > 0);
});

test("Never generates placeholder text like 'Question 1' or 'Question 2'", () => {
  const input = `
1. Exact specific text of the first question without placeholder?
A. Yes
B. No
Correct Answer: A
`;

  const result = parseAssessmentText(input, mockContext);
  assert.equal(result.success, true);
  assert.equal(result.questions[0].question, "Exact specific text of the first question without placeholder?");
  assert.notEqual(result.questions[0].question, "Question 1");
});

test("Dynamically handles large question batches (e.g. 50 questions)", () => {
  let largeBatch = "MCQs\n\n";
  for (let i = 1; i <= 50; i++) {
    largeBatch += `${i}. Question number ${i} testing dynamic capacity?\n`;
    largeBatch += `A. Option A for ${i}\n`;
    largeBatch += `B. Option B for ${i}\n`;
    largeBatch += `C. Option C for ${i}\n`;
    largeBatch += `D. Option D for ${i}\n`;
    largeBatch += `Correct Answer: ${i % 2 === 0 ? "B" : "A"}\n\n⸻\n\n`;
  }

  const result = parseAssessmentText(largeBatch, mockContext);
  assert.equal(result.success, true);
  assert.equal(result.questions.length, 50);
  assert.equal(result.questions[49].question, "Question number 50 testing dynamic capacity?");
  assert.equal(result.questions[49].correctAnswer, "B");
});

test("Handles Assertion and Reasoning alternate header", () => {
  const input = `
Assertion and Reasoning

1. Assertion (A): The Sun is a star.

Reason (R): It generates its own heat and light through nuclear fusion.

A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.

Correct Answer: A
`;

  const result = parseAssessmentText(input, mockContext);
  assert.equal(result.success, true);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].type, "assertion_reason");
  assert.ok(result.questions[0].question.includes("Assertion (A): The Sun is a star."));
  assert.ok(result.questions[0].question.includes("Reason (R): It generates its own heat and light through nuclear fusion."));
});
