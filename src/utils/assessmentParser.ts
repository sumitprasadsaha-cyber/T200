import { ParsedAssessmentQuestion, TopicPracticeTest, TestAttemptRecord } from "../types";

export interface ParsedMetadata {
  chapter?: string;
  topic?: string;
  theme?: string;
}

export interface ParseResult {
  success: boolean;
  questions: ParsedAssessmentQuestion[];
  errors: string[];
  metadata?: ParsedMetadata;
}

const TESTS_STORAGE_KEY = "tuition_topic_practice_tests_bank";
const ATTEMPTS_STORAGE_KEY = "tuition_student_test_attempts";

/**
 * Normalizes test ID for topic practice tests
 */
export function buildTopicTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0,
  topicName: string = ""
): string {
  const normClass = (classGrade || "").toLowerCase().replace(/\s+/g, "_");
  const normSubj = (subject || "").toLowerCase().replace(/\s+/g, "_");
  const normTopic = (topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__${normTopic}`;
}

/**
 * Helper to check and extract metadata markers
 */
function extractMetadataLine(line: string, metadata: ParsedMetadata): boolean {
  const trimmed = line.trim();
  const chMatch = trimmed.match(/^Chapter\s*:\s*(.*)$/i);
  if (chMatch) {
    if (chMatch[1].trim()) metadata.chapter = chMatch[1].trim();
    return true;
  }
  const topMatch = trimmed.match(/^Topic\s*:\s*(.*)$/i);
  if (topMatch) {
    if (topMatch[1].trim()) metadata.topic = topMatch[1].trim();
    return true;
  }
  const thMatch = trimmed.match(/^Theme\s*:\s*(.*)$/i);
  if (thMatch) {
    if (thMatch[1].trim()) metadata.theme = thMatch[1].trim();
    return true;
  }
  return false;
}

/**
 * Helper to recognize section headers
 */
function matchSectionHeader(line: string): "mcq" | "assertion_reason" | "true_false" | null {
  const trimmed = line.trim();
  if (/^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?)$/i.test(trimmed)) {
    return "mcq";
  }
  if (
    /^Assertion\s*(?:&|and)\s*Reasoning$/i.test(trimmed) ||
    /^Assertion\s*(?:&|and)\s*Reason$/i.test(trimmed) ||
    /^Assertion\s*-\s*Reasoning$/i.test(trimmed)
  ) {
    return "assertion_reason";
  }
  if (
    /^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+or\s+False|T\/F)$/i.test(trimmed)
  ) {
    return "true_false";
  }
  return null;
}

/**
 * Helper to detect parser markers, headers, and dividers to ignore
 */
function isIgnoredMarkerOrDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^[⸻\-\=\_\*]{2,}$/.test(trimmed) || trimmed === "⸻") return true;
  if (
    /^(?:Sample\s+Test|Practice\s+Test|General\s+Instructions?|Time\s*:|Max\s*Marks\s*:|Total\s*Marks\s*:|Marks\s*:|Class\s*:|Subject\s*:)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Helper to detect question start lines (e.g. "1.", "2)", "15:", "30.")
 * Regex equivalent: ^\d+[\.\):]\s*
 */
function matchQuestionHeader(line: string): { qNum: number; remainder: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\d+)[\.\):]\s*(.*)$/);
  if (match) {
    return {
      qNum: parseInt(match[1], 10),
      remainder: match[2].trim()
    };
  }
  return null;
}

/**
 * Helper to match an MCQ option line
 */
function matchOptionLine(line: string): { letter: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Ensure Assertion (A) or Reason (R) or (A) Assertion or (R) Reason are not treated as option lines
  if (/^(?:Assertion|Reason)\b/i.test(trimmed)) {
    return null;
  }
  if (/^[\(\[]?(?:A|R)[\)\]]?\s*[:\-]?\s*(?:Assertion|Reason)\b/i.test(trimmed)) {
    return null;
  }
  const match = trimmed.match(
    /^(?:Option\s+([A-Ea-e1-5])[\.\)\:\-\s]*|[\(\[]([A-Ea-e1-5])[\)][\.\:\s]*|([A-Ea-e1-5])[\.\)\:\-]\s*)(.*)$/i
  );
  if (match) {
    let rawLetter = (match[1] || match[2] || match[3] || "A").toUpperCase();
    if (["1", "2", "3", "4", "5"].includes(rawLetter)) {
      const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
      rawLetter = numMap[rawLetter] || "A";
    }
    return {
      letter: rawLetter,
      text: (match[4] || "").trim()
    };
  }
  return null;
}

/**
 * Normalizes question options so that labels (A., B., C., D.) remain attached to their
 * corresponding option text as complete single strings, and any isolated labels or extra "A."
 * artifacts from parsing are cleanly repaired.
 */
export function normalizeQuestionOptions(options: string[]): string[] {
  if (!Array.isArray(options) || options.length === 0) return [];

  const rawList = options.map((opt) => String(opt || "").trim()).filter(Boolean);
  if (rawList.length === 0) return [];

  // Filter out isolated labels like ["A.", "B.", ...] or merge them with the next text item
  const merged: string[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];

    // Check if item is just an isolated label like "A.", "A)", "(A)", "A:", "Option A", "A"
    const isIsolatedLabel = /^(?:Option\s+[A-Ea-e1-5][\.\:\-]?|[A-Ea-e1-5][\.\)\:\-]?|[\(\[][A-Ea-e1-5][\)\]][\.\:\-]?)$/i.test(item);

    if (isIsolatedLabel) {
      const nextItem = rawList[i + 1];
      if (nextItem) {
        // If next item already has an option prefix, this isolated label is a stray artifact (e.g. extra "A."), skip it
        if (/^(?:Option\s+[A-Ea-e1-5]|[A-Ea-e1-5][\.\)\:\-]|[\(\[][A-Ea-e1-5][\)\]])/i.test(nextItem)) {
          continue;
        } else {
          // Merge isolated label with the next text line
          const cleanLetter = item.replace(/[^A-Ea-e1-5]/gi, "").toUpperCase().charAt(0) || "A";
          merged.push(`${cleanLetter}. ${nextItem}`);
          i++; // skip nextItem
          continue;
        }
      } else {
        // Stray isolated label at the end with no text
        continue;
      }
    }

    merged.push(item);
  }

  const standardLetters = ["A", "B", "C", "D", "E", "F"];
  return merged.map((opt, idx) => {
    const expectedLetter = standardLetters[idx] || String.fromCharCode(65 + idx);
    const match = opt.match(/^(?:Option\s+([A-Ea-e1-5])[\.\)\:\-\s]*|[\(\[]([A-Ea-e1-5])[\)][\.\:\s]*|([A-Ea-e1-5])[\.\)\:\-]\s+)(.*)$/i);
    if (match) {
      let rawLetter = (match[1] || match[2] || match[3] || expectedLetter).toUpperCase();
      if (["1", "2", "3", "4", "5"].includes(rawLetter)) {
        const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
        rawLetter = numMap[rawLetter] || expectedLetter;
      }
      const optText = (match[4] || "").trim();
      return `${rawLetter}. ${optText}`;
    } else {
      return `${expectedLetter}. ${opt}`;
    }
  });
}

/**
 * Parses raw pasted text into structured MCQ, Assertion & Reasoning, and True/False questions.
 */
export function parseAssessmentText(
  rawText: string,
  context: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
  }
): ParseResult {
  const errors: string[] = [];
  const questions: ParsedAssessmentQuestion[] = [];
  const metadata: ParsedMetadata = {};

  const text = rawText ? rawText.trim() : "";
  if (!text) {
    return {
      success: false,
      questions: [],
      errors: ["Please enter or paste questions text into the editor."],
      metadata
    };
  }

  // Normalize newlines
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Pre-process inline options if multiple options were pasted on a single line (e.g. "A) Opt1  B) Opt2  C) Opt3  D) Opt4")
  // Only split on genuine option boundaries:
  // - Must not split on sentences ending in "explanation of A." or "values of A." etc.
  // - Split inline Option B, C, D, E boundaries on the same line (preceded by spaces, not preceded by prepositions)
  // - Split inline Option A placed on the same line after question mark or colon
  const processedText = normalizedText
    .replace(
      /(?<!\b(?:of|for|is|and|to|with|in|on|from|by|explanation|reason|assertion|both|neither|either|than))\s+([\(]?[B-Eb-e2-5][\.\)\:\-]\s+[^\n]+)/gi,
      (match, p1) => "\n" + p1.trim()
    )
    .replace(
      /([?:])\s+([\(]?[Aa1][\.\)\:\-]\s+[^\n]+)/g,
      (match, p1, p2) => p1 + "\n" + p2.trim()
    );

  const rawLines = processedText.split("\n");

  let currentSection: "mcq" | "assertion_reason" | "true_false" = "mcq";

  interface RawQuestionBlock {
    qNum: number;
    section: "mcq" | "assertion_reason" | "true_false";
    lines: string[];
    rawBlockLines: string[];
  }

  const rawBlocks: RawQuestionBlock[] = [];
  let activeBlock: RawQuestionBlock | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines when no active block or just accumulate within active block if relevant
    if (!trimmed) {
      if (activeBlock && activeBlock.lines.length > 0) {
        // Keep newline separation in multiline questions (e.g., between Assertion and Reason)
        activeBlock.lines.push("");
      }
      continue;
    }

    // 1. Check for metadata line
    if (extractMetadataLine(trimmed, metadata)) {
      continue;
    }

    // 2. Check for section headers
    const sectionHeader = matchSectionHeader(trimmed);
    if (sectionHeader) {
      if (activeBlock) {
        rawBlocks.push(activeBlock);
        activeBlock = null;
      }
      currentSection = sectionHeader;
      continue;
    }

    // 3. Check for divider or other parser markers
    if (isIgnoredMarkerOrDivider(trimmed)) {
      continue;
    }

    // 4. Check if line starts a new numbered question
    const qHeader = matchQuestionHeader(trimmed);
    if (qHeader) {
      if (activeBlock) {
        rawBlocks.push(activeBlock);
      }
      activeBlock = {
        qNum: qHeader.qNum,
        section: currentSection,
        lines: qHeader.remainder ? [qHeader.remainder] : [],
        rawBlockLines: [rawLine]
      };
      continue;
    }

    // 5. If we have an active question block, append line
    if (activeBlock) {
      activeBlock.lines.push(trimmed);
      activeBlock.rawBlockLines.push(rawLine);
    }
  }

  if (activeBlock) {
    rawBlocks.push(activeBlock);
  }

  console.log(`[AssessmentParser] Found ${rawBlocks.length} raw question candidate blocks.`);

  // Process each block individually
  rawBlocks.forEach((block, idx) => {
    const cleanLines = block.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isIgnoredMarkerOrDivider(l) && !extractMetadataLine(l, metadata));

    if (cleanLines.length === 0) {
      errors.push(`Question #${block.qNum}: Skipped - empty question block.`);
      return;
    }

    // Extract explicit "Correct Answer: ..." line if present
    let explicitCorrectAnswer = "";
    const remainingLines: string[] = [];

    cleanLines.forEach((l) => {
      const caMatch = l.match(/^(?:Correct\s*)?Ans(?:wer)?\s*[:\-]\s*(.*)$/i);
      if (caMatch) {
        explicitCorrectAnswer = caMatch[1].trim();
      } else {
        remainingLines.push(l);
      }
    });

    // Extract image labels if present
    let extractedImageLabel = "";
    const linesAfterImage: string[] = [];
    remainingLines.forEach((l) => {
      const imgMatch = l.match(/\[Image(?:\s+Upload)?:\s*([^\]]+)\]/i);
      if (imgMatch) {
        extractedImageLabel = imgMatch[1].trim();
        const stripped = l.replace(/\[Image(?:\s+Upload)?:\s*([^\]]+)\]/gi, "").trim();
        if (stripped) linesAfterImage.push(stripped);
      } else {
        linesAfterImage.push(l);
      }
    });

    if (linesAfterImage.length === 0) {
      errors.push(`Question #${block.qNum}: Skipped - missing question text and options.`);
      return;
    }

    const fullBlockText = linesAfterImage.join("\n");

    // Detect if this question is True / False
    const isExplicitTFSection = block.section === "true_false";
    const hasTFAnswer =
      explicitCorrectAnswer.toLowerCase() === "true" ||
      explicitCorrectAnswer.toLowerCase() === "false" ||
      explicitCorrectAnswer.toLowerCase() === "t" ||
      explicitCorrectAnswer.toLowerCase() === "f";

    // Detect if lines contain True and False options
    const tfLines = linesAfterImage.filter(
      (l) => /^(?:True|False)\s*[✅❌]?$/i.test(l) || /^[A-B][\.\)]\s*(?:True|False)/i.test(l)
    );

    const isTFQuestion = isExplicitTFSection || hasTFAnswer || tfLines.length >= 2;

    // Detect if this question is Assertion & Reasoning
    const isExplicitAssertionSection = block.section === "assertion_reason";
    const isAssertionContent =
      /Assertion\s*\([A-Za-z]\)/i.test(fullBlockText) ||
      /Reason\s*\([A-Za-z]\)/i.test(fullBlockText) ||
      /^Assertion\s*:/i.test(fullBlockText) ||
      /^Reason\s*:/i.test(fullBlockText);

    const isAssertionQuestion = isExplicitAssertionSection || isAssertionContent;

    if (isTFQuestion) {
      // ----------------------------------------------------
      // TRUE / FALSE PARSING
      // ----------------------------------------------------
      // Remove standalone "True" / "False" option lines from statement
      const statementLines = linesAfterImage.filter(
        (l) =>
          !/^(?:True|False)\s*[✅❌]?$/i.test(l) &&
          !/^[A-B][\.\)]\s*(?:True|False)/i.test(l) &&
          !/^(?:Option\s+[A-B]|[A-B][\.\)\:\-])$/i.test(l)
      );

      let cleanQuestion = statementLines
        .join(" ")
        .replace(/—\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/-\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/\b(True|False)\s*[✅❌]?$/gi, "")
        .replace(/[✅❌]/g, "")
        .replace(/\s*\(trap\)/gi, "")
        .replace(/\s*\(correct\)/gi, "")
        .replace(/\s*\(answer\)/gi, "")
        .trim();

      // Resolve correct answer
      let resolvedAnswer = "";
      if (hasTFAnswer) {
        const ca = explicitCorrectAnswer.toLowerCase();
        resolvedAnswer = ca === "true" || ca === "t" ? "True" : "False";
      } else if (
        fullBlockText.includes("True ✅") ||
        fullBlockText.includes("— True") ||
        fullBlockText.includes("- True") ||
        /True\s*\(correct\)/i.test(fullBlockText)
      ) {
        resolvedAnswer = "True";
      } else if (
        fullBlockText.includes("False ❌") ||
        fullBlockText.includes("False ✅") ||
        fullBlockText.includes("— False") ||
        fullBlockText.includes("- False") ||
        /False\s*\(correct\)/i.test(fullBlockText)
      ) {
        resolvedAnswer = "False";
      }

      // Validation
      if (!cleanQuestion) {
        errors.push(`Question #${block.qNum}: Skipped - empty True/False statement.`);
        return;
      }

      if (!resolvedAnswer) {
        errors.push(`Question #${block.qNum}: Skipped - missing valid True/False correct answer.`);
        return;
      }

      questions.push({
        id: `q_tf_${block.qNum}_${Math.random().toString(36).substring(2, 7)}`,
        classGrade: context.classGrade,
        subject: context.subject,
        chapterNo: context.chapterNo,
        chapterName: context.chapterName,
        topicName: context.topicName,
        type: "true_false",
        question: cleanQuestion,
        options: ["True", "False"],
        correctAnswer: resolvedAnswer,
        imageLabel: extractedImageLabel || undefined,
        rawText: block.rawBlockLines.join("\n")
      });
    } else {
      // ----------------------------------------------------
      // MCQ or ASSERTION & REASONING PARSING
      // ----------------------------------------------------
      // Find option lines
      const optionIndices: number[] = [];
      linesAfterImage.forEach((l, i) => {
        if (matchOptionLine(l)) {
          optionIndices.push(i);
        }
      });

      if (optionIndices.length === 0) {
        errors.push(`Question #${block.qNum}: Skipped - no options (A, B, C, D) found.`);
        return;
      }

      const firstOptIdx = optionIndices[0];

      // Question text lines before the first option line
      const rawQLines = linesAfterImage.slice(0, firstOptIdx).filter((l) => l.toLowerCase() !== "question:");
      const questionText = rawQLines.join("\n").trim();

      if (!questionText) {
        errors.push(`Question #${block.qNum}: Skipped - empty question text.`);
        return;
      }

      // Extract options
      const optLines = linesAfterImage.slice(firstOptIdx);
      const rawParsedOptions: string[] = [];
      let inlineCorrectAnswer = "";

      optLines.forEach((optLine) => {
        const optMatch = matchOptionLine(optLine);
        if (optMatch) {
          const letter = optMatch.letter;
          let optVal = optMatch.text;

          const isCheckMark =
            optVal.includes("✅") ||
            /\(correct\)/i.test(optVal) ||
            /\(answer\)/i.test(optVal);

          optVal = optVal
            .replace(/[✅❌]/g, "")
            .replace(/\s*\(trap\)/gi, "")
            .replace(/\s*\(correct\)/gi, "")
            .replace(/\s*\(answer\)/gi, "")
            .trim();

          if (isCheckMark && !inlineCorrectAnswer) {
            inlineCorrectAnswer = letter;
          }

          if (optVal) {
            rawParsedOptions.push(`${letter}. ${optVal}`);
          } else {
            // Isolated label on this line (e.g. "A." with text on the next line)
            rawParsedOptions.push(`${letter}.`);
          }
        } else if (optLine.trim()) {
          // If option text wrapped onto a new line without a letter prefix, append to previous option
          if (rawParsedOptions.length > 0) {
            const lastIdx = rawParsedOptions.length - 1;
            const lastOpt = rawParsedOptions[lastIdx];
            if (lastOpt.endsWith(".")) {
              rawParsedOptions[lastIdx] = `${lastOpt} ${optLine.trim()}`;
            } else {
              rawParsedOptions[lastIdx] += " " + optLine.trim();
            }
          }
        }
      });

      const parsedOptions = normalizeQuestionOptions(rawParsedOptions);

      // Resolve correct answer letter
      let resolvedAnswer = "";
      if (explicitCorrectAnswer) {
        const letterMatch = explicitCorrectAnswer.match(/(?:Option\s*)?([A-Ea-e1-5])/i);
        if (letterMatch) {
          let letter = letterMatch[1].toUpperCase();
          if (["1", "2", "3", "4", "5"].includes(letter)) {
            const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
            letter = numMap[letter] || "A";
          }
          resolvedAnswer = letter;
        }
      }

      if (!resolvedAnswer && inlineCorrectAnswer) {
        resolvedAnswer = inlineCorrectAnswer;
      }

      // Validation
      if (parsedOptions.length < 2) {
        errors.push(`Question #${block.qNum}: Skipped - requires at least two valid options.`);
        return;
      }

      if (!resolvedAnswer) {
        errors.push(`Question #${block.qNum}: Skipped - missing valid Correct Answer.`);
        return;
      }

      // Verify that resolvedAnswer matches one of the parsed options
      const hasMatchingOption = parsedOptions.some((opt) => opt.startsWith(resolvedAnswer + "."));
      if (!hasMatchingOption) {
        // Fallback: check if the answer is valid among available option letters
        const availableLetters = parsedOptions.map((o) => o.charAt(0));
        if (!availableLetters.includes(resolvedAnswer)) {
          errors.push(`Question #${block.qNum}: Skipped - Correct Answer '${resolvedAnswer}' does not match available options.`);
          return;
        }
      }

      const qType: "mcq" | "assertion_reason" = isAssertionQuestion ? "assertion_reason" : "mcq";

      questions.push({
        id: `q_${qType}_${block.qNum}_${Math.random().toString(36).substring(2, 7)}`,
        classGrade: context.classGrade,
        subject: context.subject,
        chapterNo: context.chapterNo,
        chapterName: context.chapterName,
        topicName: context.topicName,
        type: qType,
        question: questionText,
        options: parsedOptions,
        correctAnswer: resolvedAnswer,
        imageLabel: extractedImageLabel || undefined,
        rawText: block.rawBlockLines.join("\n")
      });
    }
  });

  console.log(`[AssessmentParser] Successfully imported ${questions.length} questions. Errors encountered: ${errors.length}`);

  return {
    success: questions.length > 0,
    questions,
    errors,
    metadata
  };
}

// ----------------------------------------------------
// LOCAL STORAGE & PERSISTENCE HELPERS
// ----------------------------------------------------

import { 
  getLocalTestBank as getAllPracticeTests,
  getTopicPracticeTestSync as getTopicPracticeTest,
  getTopicPracticeTestSync,
  getTopicPracticeTest as getTopicPracticeTestAsync,
  saveTopicPracticeTest as saveServiceTopicTest,
  deleteTopicPracticeTest as deleteServiceTopicTest,
  getFullChapterQuestionsSync as getFullChapterQuestions,
  fetchAllPracticeTestsFromSupabase
} from "../lib/practiceTestService";

export { 
  getAllPracticeTests, 
  getTopicPracticeTest, 
  getTopicPracticeTestSync,
  getTopicPracticeTestAsync,
  getFullChapterQuestions, 
  fetchAllPracticeTestsFromSupabase 
};

export function saveTopicPracticeTest(test: TopicPracticeTest): void {
  saveServiceTopicTest(
    {
      classGrade: test.classGrade,
      subject: test.subject,
      chapterNo: test.chapterNo,
      chapterName: test.chapterName,
      topicName: test.topicName,
      rawText: test.rawText
    },
    test.questions
  );
}

export function deleteTopicPracticeTest(testIdOrTopic: string): void {
  const parts = testIdOrTopic.split("__");
  if (parts.length >= 4) {
    const classGrade = parts[0].replace(/_/g, " ");
    const subject = parts[1].replace(/_/g, " ");
    const chapterNo = parseInt(parts[2].replace("ch", ""), 10) || 1;
    const topicName = parts.slice(3).join("__");
    deleteServiceTopicTest(classGrade, subject, chapterNo, topicName);
  } else {
    const all = getAllPracticeTests();
    delete all[testIdOrTopic];
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("practice-tests-updated"));
    }
  }
}

// ----------------------------------------------------
// TEST ATTEMPTS HELPERS
// ----------------------------------------------------

import { 
  getLocalTestAttempts, 
  saveTestAttemptDoc, 
  subscribeToTestAttempts,
  saveLocalTestAttemptsCache
} from "../lib/firestoreService";
import { 
  syncTestAttemptsToSupabaseStorage, 
  fetchTestAttemptsFromSupabaseStorage 
} from "../lib/practiceTestService";
import {
  savePracticeTestAttemptToSupabase,
  fetchStudentTestAttemptsFromSupabase,
  getCachedAttemptsFromMemory,
  mergeAttemptsIntoMemoryAndCache,
  notifyScoreUpdate
} from "../lib/testScorePersistence";

export { subscribeToTestAttempts, fetchStudentTestAttemptsFromSupabase };

if (typeof window !== "undefined") {
  (async () => {
    try {
      const remote = await fetchTestAttemptsFromSupabaseStorage();
      if (remote && remote.length > 0) {
        const local = getLocalTestAttempts();
        const mergedMap = new Map<string, TestAttemptRecord>();
        for (const item of remote) {
          if (item && item.id) mergedMap.set(item.id, item);
        }
        for (const item of local) {
          if (item && item.id) mergedMap.set(item.id, item);
        }
        const mergedList = Array.from(mergedMap.values());
        mergedList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        saveLocalTestAttemptsCache(mergedList);
      }
    } catch (e) {
      console.warn("[AssessmentParser] Bootstrapping attempts from Supabase storage warning:", e);
    }
  })();
}

export function getAllTestAttempts(): TestAttemptRecord[] {
  return getCachedAttemptsFromMemory();
}

export function saveTestAttempt(attempt: TestAttemptRecord): void {
  // Immediately update local cache & memory and dispatch events for instant UI score display
  try {
    mergeAttemptsIntoMemoryAndCache([attempt]);
    notifyScoreUpdate();
  } catch (localErr) {
    console.warn("[AssessmentParser] Local attempt cache error:", localErr);
  }

  // Continue asynchronous backend sync in the background
  savePracticeTestAttemptToSupabase(attempt).catch((err) => {
    console.warn("[AssessmentParser] saveTestAttempt error:", err);
  });
}

export function getStudentTestAttempts(
  studentIdentifier: string = "",
  classGrade?: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType?: "topic" | "full_chapter"
): TestAttemptRecord[] {
  const all = getAllTestAttempts();
  const normIdent = (studentIdentifier || "").toLowerCase().trim();
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  if (studentIdentifier && all.length === 0) {
    fetchStudentTestAttemptsFromSupabase(studentIdentifier).catch(() => {});
  }

  return all.filter((a) => {
    if (studentIdentifier) {
      const matchId = (a.studentId || "").toLowerCase().trim() === normIdent;
      const matchName = (a.studentName || "").toLowerCase().trim() === normIdent;
      if (!matchId && !matchName) return false;
    }
    if (testType && a.testType !== testType) return false;
    if (classGrade) {
      const aClass = (a.classGrade || "").toLowerCase().trim();
      if (aClass && normClass && aClass !== normClass && !aClass.includes(normClass) && !normClass.includes(aClass)) return false;
    }
    if (subject) {
      const aSubj = (a.subject || "").toLowerCase().trim();
      if (aSubj && normSubj && aSubj !== normSubj && !aSubj.includes(normSubj) && !normSubj.includes(aSubj)) return false;
    }
    if (chapterNo !== undefined && Number(a.chapterNo) !== Number(chapterNo)) return false;
    if (topicName && testType === "topic") {
      const aTopic = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
      return aTopic === normTopic || aTopic.includes(normTopic) || normTopic.includes(aTopic);
    }
    return true;
  });
}

export function getStudentNextAttemptNumber(
  studentId: string,
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  testType: "topic" | "full_chapter"
): number {
  const existing = getStudentTestAttempts(
    studentId,
    classGrade,
    subject,
    chapterNo,
    topicName,
    testType
  );
  return existing.length + 1;
}
