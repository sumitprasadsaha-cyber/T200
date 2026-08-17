import React, { useState, useEffect, useMemo } from "react";
import { 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  FileText, 
  Sparkles, 
  Eye, 
  Trash2, 
  ListChecks, 
  History, 
  HelpCircle,
  Copy,
  Pencil,
  ArrowUp,
  ArrowDown,
  Globe,
  Lock,
  Loader2,
  Image as ImageIcon,
  Upload,
  ZoomIn
} from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import { TopicPracticeTest, TestAttemptRecord, ParsedAssessmentQuestion } from "../types";
import {
  parseAssessmentText, 
  getAllTestAttempts,
  subscribeToTestAttempts
} from "../utils/assessmentParser";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import {
  getTopicPracticeTest,
  saveTopicPracticeTest,
  deleteAssessmentQuestion,
  updateAssessmentQuestion,
  reorderAssessmentQuestions,
  deleteTopicPracticeTest,
  deleteTopicPracticeTestDirect,
  deleteAllPracticeTestsFromDatabase,
  fetchAllPracticeTestsFromSupabase,
  buildTopicTestId
} from "../lib/practiceTestService";
import { uploadQuestionImageToStorage } from "../lib/storageService";
import { createPracticeTestChangeHandler } from "../utils/practiceTestState";
import { supabase } from "../lib/supabaseClient";
import { deduplicateAttempts } from "../lib/testScorePersistence";

interface AdminPracticeTestModalProps {
  isOpen: boolean;
  onClose: () => void;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  onPracticeTestChanged?: () => void;
}

const SAMPLE_TEST_TEXT = `Chapter 8: World Geography: Some Glimpses

Topic 1: The Blue Planet – Oceans

Sample Test

MCQs

1. Approximately what percentage of Earth’s surface is covered by oceans?

A. 29%
B. 50%
C. 71% ✅
D. 97%

Correct Answer: C

⸻

2. Oceans contain approximately what percentage of all the water on Earth?

A. 29%
B. 71%
C. 90%
D. 97% ✅

Correct Answer: D

⸻

Assertion & Reasoning

3. Assertion (A): Oceans help regulate the Earth’s climate.

Reason (R): Oceans absorb heat and release it slowly while also adding moisture to the atmosphere.

A. Both A and R are true, and R is the correct explanation of A. ✅
B. Both A and R are true, but R is not the correct explanation of A.
C. A is true, but R is false.
D. A is false, but R is true.

Correct Answer: A

⸻

4. Assertion (A): The ocean floor is completely flat.

Reason (R): The ocean floor contains features such as continental shelves, slopes, abyssal plains and trenches.

A. Both A and R are true, and R is the correct explanation of A.
B. Both A and R are true, but R is not the correct explanation of A.
C. A is true, but R is false.
D. A is false, but R is true. ✅

Correct Answer: D

⸻

True / False

5. The Earth is called the “Blue Planet” because most of its surface is covered by oceans.

True ✅
False

Correct Answer: True

⸻

6. Ocean trenches are shallower than continental shelves.

True
False ✅

Correct Answer: False

⸻

MCQs with Image

7. [Image Upload: Ocean-floor diagram]

Question:
Which feature shown in the image represents the deepest part of the ocean floor?

A. Continental shelf
B. Continental slope
C. Abyssal plain
D. Ocean trench ✅

Correct Answer: D

⸻

8. [Image Upload: Marine food-chain diagram]

Question:
Which organism forms the base of the marine food chain shown in the image?

A. Large fish
B. Small fish
C. Plankton ✅
D. Giant marine animals

Correct Answer: C`;

export default function AdminPracticeTestModal({
  isOpen,
  onClose,
  classGrade,
  subject,
  chapterNo,
  chapterName,
  topicName,
  onPracticeTestChanged
}: AdminPracticeTestModalProps) {
  const [activeTab, setActiveTab] = useState<"editor" | "preview" | "attempts">("editor");
  const [rawText, setRawText] = useState("");
  const [validationErrorMsg, setValidationErrorMsg] = useState<string[]>([]);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);
  const [savedTest, setSavedTest] = useState<TopicPracticeTest | null>(null);
  const [attemptsList, setAttemptsList] = useState<TestAttemptRecord[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);

  // Single Question Edit Modal state
  const [editingQuestion, setEditingQuestion] = useState<ParsedAssessmentQuestion | null>(null);
  const [editQText, setEditQText] = useState("");
  const [editQOptions, setEditQOptions] = useState<string[]>([]);
  const [editQCorrectAns, setEditQCorrectAns] = useState("");
  const [editQType, setEditQType] = useState<"mcq" | "true_false" | "assertion_reason">("mcq");
  const [editQImageUrl, setEditQImageUrl] = useState("");
  const [editQImageLabel, setEditQImageLabel] = useState("");
  const [editQImagePosition, setEditQImagePosition] = useState<"above" | "below">("below");
  const [uploadingImageQId, setUploadingImageQId] = useState<string | null>(null);
  const [isUploadingEditImage, setIsUploadingEditImage] = useState(false);
  const [zoomImage, setZoomImage] = useState<{ url: string; label?: string } | null>(null);

  const notifyPracticeTestChanged = createPracticeTestChangeHandler({
    onPracticeTestChanged,
  });

  // Load existing saved test from Supabase on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);

    const loadData = async () => {
      try {
        const testFromDb = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName);
        if (isMounted && testFromDb) {
          setSavedTest(testFromDb);
          setRawText(testFromDb.rawText || "");
          setValidationSuccess(`Practice Test loaded: ${testFromDb.questions.length} questions available.`);
        } else if (isMounted) {
          setSavedTest(null);
          setRawText("");
          setValidationSuccess(null);
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn("[AdminPracticeTestModal] Error loading test from Supabase:", err);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const fetchDirectAttempts = async () => {
      try {
        const expectedTestId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
        const { data, error } = await supabase
          .from("student_practice_test_attempts")
          .select("*")
          .or(`test_id.eq.${expectedTestId},and(class_grade.ilike.${classGrade},subject.ilike.${subject},chapter_no.eq.${chapterNo},topic_name.ilike.${topicName})`)
          .range(0, 9999);

        if (!error && Array.isArray(data) && isMounted) {
          const converted: TestAttemptRecord[] = data.map((row) => ({
            id: row.id || `att_${row.timestamp || Date.now()}`,
            studentId: row.student_id || "",
            studentName: row.student_name || "Student",
            testId: row.test_id,
            topicId: row.topic_id,
            chapterId: row.chapter_id,
            subjectId: row.subject_id,
            classGrade: row.class_grade || "",
            subject: row.subject || "",
            chapterNo: row.chapter_no || 0,
            chapterName: row.chapter_name || "",
            topicName: row.topic_name || "",
            testType: row.test_type || "topic",
            attemptNumber: row.attempt_number || 1,
            date: row.date || new Date().toISOString(),
            timestamp: row.timestamp || Date.now(),
            timeTakenSeconds: row.time_taken_seconds || 0,
            score: row.score || 0,
            totalMarks: row.total_marks || row.total_questions || 0,
            totalQuestions: row.total_questions || 0,
            percentage: row.percentage || 0,
            correctAnswersCount: row.correct_answers_count || 0,
            wrongAnswersCount: row.wrong_answers_count || 0,
            userAnswers: row.user_answers || {}
          }));
          setAttemptsList((prev) => deduplicateAttempts([...prev, ...converted]));
        }
      } catch (err) {
        console.warn("[AdminPracticeTestModal] Error loading direct attempts:", err);
      }
    };

    loadData();
    fetchDirectAttempts();
    setValidationErrorMsg([]);

    // Subscribe to database & real-time test attempts
    const unsubscribeAttempts = subscribeToTestAttempts((all) => {
      if (isMounted) {
        setAttemptsList(all);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAttempts();
    };
  }, [isOpen, classGrade, subject, chapterNo, topicName]);

  const selectedTopicAttempts = useMemo(() => {
    const normClass = (classGrade || "").toLowerCase().trim();
    const normSubj = (subject || "").toLowerCase().trim();
    const normTopic = (topicName || "").toLowerCase().trim();
    const expectedTestId = buildTopicTestId(classGrade, subject, chapterNo, topicName);

    return attemptsList.filter((a) => {
      if (a.testType && a.testType !== "topic") return false;

      const isTestIdMatch = Boolean(a.testId && a.testId === expectedTestId);

      const aClass = (a.classGrade || "").toLowerCase().trim();
      const aSubj = (a.subject || "").toLowerCase().trim();
      const aTopic = (a.topicName || "").toLowerCase().trim();

      const isClassMatch = aClass === normClass;
      const isSubjMatch = aSubj === normSubj;
      const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);
      const isTopicMatch = aTopic === normTopic;

      return isTestIdMatch || (isClassMatch && isSubjMatch && isChapterMatch && isTopicMatch);
    });
  }, [attemptsList, classGrade, subject, chapterNo, topicName]);

  const uniqueStudentAttempts = useMemo(() => {
    const groups: Record<string, TestAttemptRecord[]> = {};

    for (const att of selectedTopicAttempts) {
      const key = (att.studentId && att.studentId.trim())
        ? att.studentId.trim()
        : (att.studentName || "Unknown").trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(att);
    }

    const result: Array<{
      studentId: string;
      studentName: string;
      highestScore: number;
      totalMarks: number;
      highestMarksFormatted: string;
      totalAttempts: number;
      latestTimestamp: number;
    }> = [];

    for (const key of Object.keys(groups)) {
      const studentAttempts = groups[key];
      if (studentAttempts.length === 0) continue;

      let bestAttempt = studentAttempts[0];
      let latestTs = studentAttempts[0].timestamp || 0;

      for (const att of studentAttempts) {
        const ts = att.timestamp || 0;
        if (ts > latestTs) latestTs = ts;

        const bestTotal = bestAttempt.totalMarks || bestAttempt.totalQuestions || 1;
        const attTotal = att.totalMarks || att.totalQuestions || 1;

        const bestRatio = bestAttempt.score / bestTotal;
        const attRatio = att.score / attTotal;

        if (attRatio > bestRatio) {
          bestAttempt = att;
        } else if (attRatio === bestRatio) {
          if (att.score > bestAttempt.score) {
            bestAttempt = att;
          } else if (att.score === bestAttempt.score && ts > (bestAttempt.timestamp || 0)) {
            bestAttempt = att;
          }
        }
      }

      const totalMarks = bestAttempt.totalMarks || bestAttempt.totalQuestions || 0;
      const highestScore = bestAttempt.score || 0;
      const highestMarksFormatted = `${highestScore}/${totalMarks}`;

      result.push({
        studentId: bestAttempt.studentId || key,
        studentName: bestAttempt.studentName || "Student",
        highestScore,
        totalMarks,
        highestMarksFormatted,
        totalAttempts: studentAttempts.length,
        latestTimestamp: latestTs
      });
    }

    // Sort per Requirement 6:
    // 1. Highest Marks (descending)
    // 2. Fewer attempts (ascending)
    // 3. Latest submission (descending)
    result.sort((a, b) => {
      const ratioA = a.totalMarks > 0 ? a.highestScore / a.totalMarks : 0;
      const ratioB = b.totalMarks > 0 ? b.highestScore / b.totalMarks : 0;

      if (ratioB !== ratioA) {
        return ratioB - ratioA;
      }
      if (b.highestScore !== a.highestScore) {
        return b.highestScore - a.highestScore;
      }
      if (a.totalAttempts !== b.totalAttempts) {
        return a.totalAttempts - b.totalAttempts;
      }
      return b.latestTimestamp - a.latestTimestamp;
    });

    return result;
  }, [selectedTopicAttempts]);

  if (!isOpen) return null;

  const handlePasteSample = () => {
    setRawText(SAMPLE_TEST_TEXT);
    setValidationErrorMsg([]);
    setValidationSuccess(null);
  };

  const handleValidateAndSave = async () => {
    setValidationErrorMsg([]);
    setValidationSuccess(null);

    const parseRes = parseAssessmentText(rawText, {
      classGrade,
      subject,
      chapterNo,
      chapterName,
      topicName
    });

    if (!parseRes.success || parseRes.questions.length === 0) {
      setValidationErrorMsg(
        parseRes.errors.length > 0
          ? parseRes.errors
          : ["Failed to parse any valid questions from text."]
      );
      return;
    }

    try {
      setIsSaving(true);
      const res = await saveTopicPracticeTest(
        {
          classGrade,
          subject,
          chapterNo,
          chapterName,
          topicName,
          rawText
        },
        parseRes.questions
      );

      if (res.success) {
        // Fetch fresh questions directly from Supabase for this Practice Test (Part C - Refresh)
        const fetched = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
        const freshTest = fetched || {
          id: buildTopicTestId(classGrade, subject, chapterNo, topicName),
          classGrade,
          subject,
          chapterNo,
          chapterName,
          topicName,
          rawText,
          questions: parseRes.questions,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uploadedBy: "Admin"
        };
        setSavedTest(freshTest);

        const mcqCount = freshTest.questions.filter((q) => q.type === "mcq").length;
        const tfCount = freshTest.questions.filter((q) => q.type === "true_false").length;

        setValidationSuccess(
          `Practice Test saved successfully. Total ${freshTest.questions.length} Questions (${mcqCount} MCQs, ${tfCount} True/False).`
        );

        notifyPracticeTestChanged();
      } else {
        const errorDetail = res.error || res.message || "Operation failed. Please try again.";
        setValidationErrorMsg([
          "Failed to save Practice Test.",
          errorDetail
        ]);
      }
    } catch (err: any) {
      console.error("[AdminPracticeTestModal] Save error:", err);
      setValidationErrorMsg([
        "Failed to save Practice Test.",
        err.message || "An unexpected error occurred. Please try again."
      ]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTest = () => {
    setDeleteToast(null);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteTest = async () => {
    setDeleteToast(null);
    setIsSaving(true);

    const testInfo = { classGrade, subject, chapterNo, topicName };
    console.log(`[AdminPracticeTestModal] Requesting deletion of practice test:`, testInfo);

    try {
      const result = await deleteTopicPracticeTest(classGrade, subject, chapterNo, topicName);
      if (!result.success) {
        const errMsg = result.message || "Unable to delete practice test.";
        console.error(`[AdminPracticeTestModal] Deletion failed for test:`, testInfo, errMsg);
        setDeleteToast(errMsg);
        setValidationErrorMsg([errMsg]);
        setIsDeleteConfirmOpen(false);
        return;
      }

      console.log(`[AdminPracticeTestModal] Practice test deleted successfully:`, testInfo);
      setSavedTest(null);
      setRawText("");
      setValidationSuccess("Practice Test deleted successfully.");
      setValidationErrorMsg([]);
      setActiveTab("editor");
      notifyPracticeTestChanged();
      if (onPracticeTestChanged) {
        onPracticeTestChanged();
      }
      setIsDeleteConfirmOpen(false);
    } catch (err: any) {
      const errMsg = err?.message || "Unable to delete practice test.";
      console.error(`[AdminPracticeTestModal] Exception deleting practice test:`, testInfo, err);
      setDeleteToast(errMsg);
      setValidationErrorMsg([errMsg]);
      setIsDeleteConfirmOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDeleteAllTests = async () => {
    setDeleteToast(null);
    setIsSaving(true);
    console.log("[AdminPracticeTestModal] Requesting permanent deletion of ALL practice tests across database...");

    try {
      const result = await deleteAllPracticeTestsFromDatabase();
      if (!result.success) {
        const errMsg = result.error || result.message || "Unable to delete all practice tests.";
        console.error("[AdminPracticeTestModal] Delete all practice tests failed:", errMsg);
        setDeleteToast(errMsg);
        setValidationErrorMsg([errMsg]);
        setIsDeleteAllConfirmOpen(false);
        return;
      }

      console.log("[AdminPracticeTestModal] All practice tests deleted successfully:", result.deletedCounts);
      setSavedTest(null);
      setRawText("");
      setAttemptsList([]);
      setValidationSuccess(
        `All Practice Tests permanently deleted (${result.deletedCounts?.questions || 0} questions, ${result.deletedCounts?.studentMarks || 0} student test marks removed).`
      );
      setValidationErrorMsg([]);
      setActiveTab("editor");
      notifyPracticeTestChanged();
      if (onPracticeTestChanged) {
        onPracticeTestChanged();
      }
      setIsDeleteAllConfirmOpen(false);
    } catch (err: any) {
      const errMsg = err?.message || "Failed to delete all practice tests.";
      console.error("[AdminPracticeTestModal] Exception deleting all practice tests:", err);
      setDeleteToast(errMsg);
      setValidationErrorMsg([errMsg]);
      setIsDeleteAllConfirmOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSingleQuestion = async (qId: string) => {
    if (!savedTest) return;
    if (!confirm("Delete this question?")) return;

    const res = await deleteAssessmentQuestion(qId);
    if (!res.success) {
      setValidationErrorMsg(["Failed to delete question.", res.message]);
    } else {
      setValidationSuccess(res.message || "Question deleted successfully.");
      setValidationErrorMsg([]);
      const updatedQuestions = savedTest.questions.filter((q) => q.id !== qId);
      if (updatedQuestions.length === 0) {
        setSavedTest(null);
      } else {
        setSavedTest({ ...savedTest, questions: updatedQuestions });
      }
      notifyPracticeTestChanged();
    }
  };

  const handleTogglePublished = async (q: ParsedAssessmentQuestion) => {
    if (!savedTest) return;
    const newPublished = q.published === false ? true : false;
    await updateAssessmentQuestion(q.id, { published: newPublished });
    const fresh = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
    setSavedTest(fresh);
    notifyPracticeTestChanged();
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };

  const handleMoveQuestion = async (index: number, direction: "up" | "down") => {
    if (!savedTest) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= savedTest.questions.length) return;

    const newQuestions = [...savedTest.questions];
    const temp = newQuestions[index];
    newQuestions[index] = newQuestions[targetIdx];
    newQuestions[targetIdx] = temp;

    await reorderAssessmentQuestions(classGrade, subject, chapterNo, topicName, newQuestions);
    const fresh = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
    setSavedTest(fresh);
    notifyPracticeTestChanged();
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };

  const handleUploadQuestionImage = async (qId: string, file?: File) => {
    if (!file || !savedTest) return;
    try {
      setUploadingImageQId(qId);
      const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
      // Storage path key scoped specifically to this question ID
      const questionStorageKey = `${testId}_q_${qId}`;
      const metadata = await uploadQuestionImageToStorage(questionStorageKey, file, file.name);
      if (metadata && metadata.downloadUrl) {
        const updatedQuestions = savedTest.questions.map((q) =>
          q.id === qId ? { ...q, imageUrl: metadata.downloadUrl } : q
        );
        const updatedTest = { ...savedTest, questions: updatedQuestions };
        setSavedTest(updatedTest);

        await saveTopicPracticeTest(
          {
            classGrade,
            subject,
            chapterNo,
            chapterName: savedTest.chapterName || `Chapter ${chapterNo}`,
            topicName,
            rawText: savedTest.rawText || "",
          },
          updatedQuestions
        );
        notifyPracticeTestChanged();
        if (onPracticeTestChanged) {
          onPracticeTestChanged();
        }
      }
    } catch (err: any) {
      console.error("[AdminPracticeTestModal] Error uploading image:", err);
      alert(`Image upload failed: ${err.message || err}`);
    } finally {
      setUploadingImageQId(null);
    }
  };

  const handleRemoveQuestionImage = async (qId: string) => {
    if (!savedTest) return;
    const updatedQuestions = savedTest.questions.map((q) =>
      q.id === qId ? { ...q, imageUrl: undefined } : q
    );
    setSavedTest({ ...savedTest, questions: updatedQuestions });

    await saveTopicPracticeTest(
      {
        classGrade,
        subject,
        chapterNo,
        chapterName: savedTest.chapterName || `Chapter ${chapterNo}`,
        topicName,
        rawText: savedTest.rawText || "",
      },
      updatedQuestions
    );

    const fresh = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
    if (fresh && fresh.questions && fresh.questions.length > 0) setSavedTest(fresh);
    notifyPracticeTestChanged();
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };

  const handleToggleImagePosition = async (q) => {
    if (!savedTest) return;
    const newPos: "above" | "below" = q.imagePosition === "above" ? "below" : "above";
    const updatedQuestions = savedTest.questions.map((item) =>
      item.id === q.id ? { ...item, imagePosition: newPos } : item
    );
    setSavedTest({ ...savedTest, questions: updatedQuestions });

    await saveTopicPracticeTest(
      {
        classGrade,
        subject,
        chapterNo,
        chapterName: savedTest.chapterName || `Chapter ${chapterNo}`,
        topicName,
        rawText: savedTest.rawText || "",
      },
      updatedQuestions
    );

    const fresh = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
    if (fresh && fresh.questions && fresh.questions.length > 0) setSavedTest(fresh);
    notifyPracticeTestChanged();
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };

  const handleOpenEditQuestion = (q: ParsedAssessmentQuestion) => {
    setEditingQuestion(q);
    setEditQText(q.question);
    setEditQOptions([...q.options]);
    setEditQCorrectAns(q.correctAnswer);
    setEditQType(q.type);
    setEditQImageUrl(q.imageUrl || "");
    setEditQImageLabel(q.imageLabel || "");
    setEditQImagePosition(q.imagePosition || "below");
  };

  const handleSaveQuestionEdit = async () => {
    if (!editingQuestion || !editQText.trim()) return;

    await updateAssessmentQuestion(editingQuestion.id, {
      question: editQText.trim(),
      options: editQOptions,
      correctAnswer: editQCorrectAns,
      type: editQType,
      imageUrl: editQImageUrl.trim() || undefined,
      imageLabel: editQImageLabel.trim() || undefined,
      imagePosition: editQImagePosition
    });

    setEditingQuestion(null);
    const fresh = await getTopicPracticeTest(classGrade, subject, chapterNo, topicName, { forceFresh: true });
    setSavedTest(fresh);
    notifyPracticeTestChanged();
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 shrink-0">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-200">
                Smart Assessment Engine
              </p>
              <h2 className="text-sm sm:text-base font-black leading-snug break-words">
                Practice Test: {topicName}
              </h2>
              <p className="text-xs text-blue-100/90 break-words mt-0.5">
                [{classGrade}] {subject} • Ch {chapterNo}: {chapterName}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 px-6 pt-2 shrink-0 gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab("editor")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === "editor"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Paste & Parse Editor</span>
          </button>

          <button
            onClick={() => setActiveTab("preview")}
            disabled={!savedTest}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              activeTab === "preview"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Stored Questions ({savedTest?.questions.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab("attempts")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === "attempts"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Student Attempts ({uniqueStudentAttempts.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          
          {isLoading && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl flex items-center justify-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-300 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>Fetching practice test questions...</span>
            </div>
          )}

          {/* TAB 1: Editor */}
          {activeTab === "editor" && (
            <div className="space-y-4">
              {/* Instructions banner */}
              <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <HelpCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-700 dark:text-slate-300">
                    <p className="font-bold text-slate-900 dark:text-slate-100 mb-0.5">
                      Automatic Question Parsing & Assessment
                    </p>
                    <p>
                      Paste questions text below. Mark correct option with <span className="font-bold text-emerald-600">✅</span> symbol. True/False questions are detected automatically with <span className="font-bold">True ✅</span> or <span className="font-bold">False ❌</span>. Each question is saved as an individual row linked to Class, Subject, Chapter, and Topic.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePasteSample}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Paste Sample Format
                </button>
              </div>

              {/* Validation Success Message */}
              {validationSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>{validationSuccess}</span>
                </div>
              )}

              {/* Validation Error Message */}
              {validationErrorMsg.length > 0 && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-rose-900 dark:text-rose-200">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Failed to save Practice Test ({validationErrorMsg.length}):</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 pl-1 font-mono text-[11px] max-h-32 overflow-y-auto">
                    {validationErrorMsg.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Editor Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Pasted Questions Content:
                  </label>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    {rawText.length} characters
                  </span>
                </div>
                
                <textarea
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setValidationErrorMsg([]);
                    setValidationSuccess(null);
                  }}
                  rows={14}
                  placeholder={`Multiple Choice Questions (MCQs)\n1. What is the formula for area of a circle?\nA. 2πr\nB. πr² ✅\nC. 2πr²\nD. πd\n\nTrue or False\n1. Earth revolves around the Sun. — True ✅\n2. Light travels slower than sound. — False ❌`}
                  className="w-full p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-y"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Parsed Question Preview & Management */}
          {activeTab === "preview" && savedTest && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Total Questions Stored: <strong className="text-slate-900 dark:text-slate-100">{savedTest.questions.length}</strong>
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 px-2.5 py-1 rounded-lg">
                    Published & Active
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {savedTest.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className={`p-4 rounded-xl border space-y-2 transition-all ${
                      q.published === false
                        ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 opacity-80"
                        : "bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded">
                          Q{idx + 1}
                        </span>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded">
                          {q.type === "mcq" ? "MCQ" : (q.type === "assertion_reason" ? "Assertion & Reason" : "True / False")}
                        </span>
                        {q.published === false && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Unpublished
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Reorder Up / Down */}
                        <button
                          disabled={idx === 0}
                          onClick={() => handleMoveQuestion(idx, "up")}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={idx === savedTest.questions.length - 1}
                          onClick={() => handleMoveQuestion(idx, "down")}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        {/* Toggle Publish */}
                        <button
                          onClick={() => handleTogglePublished(q)}
                          className={`px-2 py-1 text-[10px] font-bold rounded-lg cursor-pointer flex items-center gap-1 ${
                            q.published === false
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          }`}
                          title="Toggle Published State"
                        >
                          {q.published === false ? (
                            <>
                              <Lock className="w-3 h-3" /> Publish
                            </>
                          ) : (
                            <>
                              <Globe className="w-3 h-3" /> Published
                            </>
                          )}
                        </button>

                        {/* Edit Question */}
                        <button
                          onClick={() => handleOpenEditQuestion(q)}
                          className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400 rounded-lg transition-all cursor-pointer"
                          title="Edit Question"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Question */}
                        <button
                          onClick={() => handleDeleteSingleQuestion(q.id)}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 rounded-lg transition-all cursor-pointer"
                          title="Delete Question"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Image / Diagram Banner or Upload */}
                    {q.imageUrl ? (
                      <div className="space-y-2 my-2">
                        {/* If position is 'above', show image before text tag */}
                        {q.imagePosition === "above" && (
                          <div
                            className="relative group cursor-pointer inline-block border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-900 p-1"
                            onClick={() => setZoomImage({ url: q.imageUrl!, label: q.imageLabel || q.question })}
                          >
                            <img src={q.imageUrl} referrerPolicy="no-referrer" alt="Diagram" className="h-28 max-w-full object-contain rounded-lg mx-auto" />
                            <div className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 backdrop-blur-xs">
                              <ZoomIn className="w-3 h-3 text-blue-400" />
                              <span>Zoom</span>
                            </div>
                          </div>
                        )}

                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 pt-1 whitespace-pre-line">
                          {q.question}
                        </p>

                        {/* If position is 'below' or default, show image after text tag */}
                        {q.imagePosition !== "above" && (
                          <div
                            className="relative group cursor-pointer inline-block border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-900 p-1"
                            onClick={() => setZoomImage({ url: q.imageUrl!, label: q.imageLabel || q.question })}
                          >
                            <img src={q.imageUrl} referrerPolicy="no-referrer" alt="Diagram" className="h-28 max-w-full object-contain rounded-lg mx-auto" />
                            <div className="absolute top-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 backdrop-blur-xs">
                              <ZoomIn className="w-3 h-3 text-blue-400" />
                              <span>Zoom</span>
                            </div>
                          </div>
                        )}

                        {/* Image Toolbar / Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {q.imageLabel ? `Diagram: ${q.imageLabel}` : "Image Attached"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleImagePosition(q)}
                              className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 font-bold text-[10px] hover:bg-indigo-100 cursor-pointer transition-all"
                              title="Toggle position relative to question text"
                            >
                              Position: {q.imagePosition === "above" ? "Above Question" : "Below Question"}
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1">
                              {uploadingImageQId === q.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" /> Uploading...
                                </>
                              ) : (
                                <>
                                  <Upload className="w-3 h-3" /> Change Image
                                </>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadingImageQId === q.id}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadQuestionImage(q.id, file);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => handleRemoveQuestionImage(q.id)}
                              className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 pt-1 whitespace-pre-line">
                          {q.question}
                        </p>

                        <div className="flex items-center justify-between gap-2 py-1.5 mt-1 border-t border-slate-100 dark:border-slate-800">
                          {q.imageLabel ? (
                            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900/60">
                              Diagram: {q.imageLabel}
                            </span>
                          ) : <span />}
                          <label className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/80 hover:dark:bg-blue-900 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 cursor-pointer flex items-center gap-1.5 transition-all shadow-2xs">
                            {uploadingImageQId === q.id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading to Supabase...
                              </>
                            ) : (
                              <>
                                <Upload className="w-3.5 h-3.5" /> Upload Image for Question
                              </>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingImageQId === q.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadQuestionImage(q.id, file);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {q.options.map((opt, oIdx) => {
                        const optLetter = opt.charAt(0);
                        const isCorrect = q.type === "mcq" ? optLetter === q.correctAnswer : opt === q.correctAnswer;

                        return (
                          <div
                            key={oIdx}
                            className={`p-2.5 rounded-lg text-xs font-semibold border flex items-center justify-between ${
                              isCorrect
                                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 font-bold"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <span>{opt}</span>
                            {isCorrect && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Student Attempts */}
          {activeTab === "attempts" && (
            <div className="space-y-4">
              {uniqueStudentAttempts.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                  <ListChecks className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">No student attempts recorded yet for this topic test.</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Student attempts will automatically be recorded here in real-time when students submit this practice test.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-500 flex items-center justify-between">
                    <span>
                      Showing <strong className="text-slate-900 dark:text-slate-100">{uniqueStudentAttempts.length}</strong> student(s) who attempted this topic test
                    </span>
                  </div>

                  <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-sm">
                    <div className="bg-slate-50 dark:bg-slate-800/80 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 grid grid-cols-12 gap-2 text-[11px] font-extrabold uppercase text-slate-500 tracking-wider">
                      <div className="col-span-6 sm:col-span-6">Student Name</div>
                      <div className="col-span-3 sm:col-span-3 text-center">Highest Marks</div>
                      <div className="col-span-3 sm:col-span-3 text-right">Number of Attempts</div>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {uniqueStudentAttempts.map((item) => (
                        <div
                          key={item.studentId || item.studentName}
                          className="px-4 py-3 grid grid-cols-12 gap-2 items-center hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <div className="col-span-6 sm:col-span-6 font-bold text-xs text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black text-xs shrink-0">
                              {item.studentName.charAt(0).toUpperCase()}
                            </div>
                            <span className="truncate">{item.studentName}</span>
                          </div>

                          <div className="col-span-3 sm:col-span-3 text-center">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60">
                              {item.highestMarksFormatted}
                            </span>
                          </div>

                          <div className="col-span-3 sm:col-span-3 text-right">
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                              {item.totalAttempts} {item.totalAttempts === 1 ? "Attempt" : "Attempts"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="relative flex items-center gap-2">
            {(savedTest || rawText.trim().length > 0) && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleDeleteTest}
                className="px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl transition cursor-pointer flex items-center gap-1.5 border border-rose-200/60 dark:border-rose-900/40 disabled:opacity-50"
                title="Delete practice test for this topic"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isSaving ? "Deleting..." : "Delete Test"}</span>
              </button>
            )}
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setIsDeleteAllConfirmOpen(true)}
              className="px-2.5 py-2 text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-400 dark:hover:bg-rose-950/40 rounded-xl transition cursor-pointer flex items-center gap-1 border border-slate-200 dark:border-slate-800 hover:border-rose-200 disabled:opacity-50"
              title="Permanently delete all practice tests, questions, and marks from the entire database"
            >
              <Trash2 className="w-3 h-3 text-rose-500" />
              <span>Delete All Tests (DB)</span>
            </button>
            {deleteToast && (
              <div className="absolute -top-14 left-0 w-full min-w-[280px] rounded-2xl bg-rose-600 text-white text-[11px] font-semibold px-3 py-2 shadow-lg shadow-rose-600/25 z-50">
                {deleteToast}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>

            {activeTab === "editor" && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleValidateAndSave}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Validate & Save Test</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>

      <ConfirmDeleteModal
        isOpen={isDeleteConfirmOpen}
        title="Delete Practice Test?"
        message={`Are you sure you want to permanently delete the practice test for "${topicName}"? This will remove all saved questions for this topic.`}
        isDeleting={isSaving}
        onCancel={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDeleteTest}
      />

      <ConfirmDeleteModal
        isOpen={isDeleteAllConfirmOpen}
        title="Delete ALL Practice Tests in Database?"
        message="Are you sure you want to permanently delete ALL Practice Tests, Questions, and Student Test Marks from the entire database? This will clear all assessment data across all subjects and chapters."
        isDeleting={isSaving}
        onCancel={() => setIsDeleteAllConfirmOpen(false)}
        onConfirm={handleConfirmDeleteAllTests}
      />

      {/* SINGLE QUESTION EDIT MODAL */}
      {editingQuestion && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Edit Question Details</span>
              </h3>
              <button
                onClick={() => setEditingQuestion(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">Question Text:</label>
                <textarea
                  value={editQText}
                  onChange={(e) => setEditQText(e.target.value)}
                  rows={3}
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">Correct Answer:</label>
                <input
                  type="text"
                  value={editQCorrectAns}
                  onChange={(e) => setEditQCorrectAns(e.target.value)}
                  placeholder="e.g. B or True"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-bold text-emerald-600"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">Diagram / Image Label (Optional):</label>
                <input
                  type="text"
                  value={editQImageLabel}
                  onChange={(e) => setEditQImageLabel(e.target.value)}
                  placeholder="e.g. Ocean-floor diagram"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-semibold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">Question Image & Position:</label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="px-3 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl font-bold cursor-pointer flex items-center gap-1.5 shrink-0">
                      {isUploadingEditImage ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                          <span>Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>Upload File</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isUploadingEditImage}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            try {
                              setIsUploadingEditImage(true);
                              const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
                              const qId = editingQuestion?.id || `q_${Date.now()}`;
                              const questionStorageKey = `${testId}_q_${qId}`;
                              const metadata = await uploadQuestionImageToStorage(questionStorageKey, file, file.name);
                              if (metadata && metadata.downloadUrl) {
                                setEditQImageUrl(metadata.downloadUrl);
                              }
                            } catch (err: any) {
                              console.error("Image upload failed:", err);
                              alert(`Image upload failed: ${err.message || err}`);
                            } finally {
                              setIsUploadingEditImage(false);
                              e.target.value = "";
                            }
                          }
                        }}
                      />
                    </label>
                    <input
                      type="text"
                      value={editQImageUrl}
                      onChange={(e) => setEditQImageUrl(e.target.value)}
                      placeholder="Or paste Image URL..."
                      className="flex-1 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-[11px]"
                    />
                  </div>

                  {/* Position selector when image is present */}
                  {editQImageUrl && (
                    <div className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                      <span className="font-bold text-slate-700 dark:text-slate-300 text-[11px]">Image Position:</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditQImagePosition("above")}
                          className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                            editQImagePosition === "above"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          Above Question
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditQImagePosition("below")}
                          className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                            editQImagePosition === "below"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          Below Question
                        </button>
                      </div>
                    </div>
                  )}

                  {editQImageUrl && (
                    <div className="relative inline-block border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden p-1 bg-white dark:bg-slate-950">
                      <img src={editQImageUrl} alt="Preview" className="h-20 max-w-full object-contain rounded-lg" />
                      <button
                        type="button"
                        onClick={() => setEditQImageUrl("")}
                        className="absolute top-1 right-1 bg-rose-600 text-white p-1 rounded-full shadow-md hover:bg-rose-700 cursor-pointer"
                        title="Remove Image"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {editQType !== "true_false" && (
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">Options (one per line):</label>
                  <textarea
                    value={editQOptions.join("\n")}
                    onChange={(e) => setEditQOptions(e.target.value.split("\n").filter(Boolean))}
                    rows={4}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingQuestion(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuestionEdit}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- IMAGE ZOOM MODAL --- */}
      {zoomImage && (
        <ImageZoomModal
          imageUrl={zoomImage.url}
          imageLabel={zoomImage.label}
          onClose={() => setZoomImage(null)}
        />
      )}
    </div>
  );
}
