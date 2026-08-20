import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  Award, 
  Clock, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft, 
  Send,
  HelpCircle,
  Trophy,
  Sparkles,
  BookOpen,
  FileCheck,
  ZoomIn,
  Loader2
} from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import { ParsedAssessmentQuestion, TestAttemptRecord } from "../types";
import { 
  saveTestAttempt, 
  getStudentNextAttemptNumber,
  getStudentTestAttempts,
  normalizeQuestionOptions
} from "../utils/assessmentParser";
import {
  buildTopicTestId,
  fetchQuestions
} from "../lib/practiceTestService";
import { fetchStudentScore } from "../lib/testScorePersistence";

interface StudentPracticeTestModalProps {
  isOpen?: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string; // Specific topic name OR "Full Chapter Test"
  testType: "topic" | "full_chapter";
  serviceStatus?: string;
}

export default function StudentPracticeTestModal({
  isOpen,
  onClose,
  studentId,
  studentName,
  classGrade,
  subject,
  chapterNo,
  chapterName,
  topicName,
  testType,
  serviceStatus
}: StudentPracticeTestModalProps) {
  const normStatus = String(serviceStatus || "").toLowerCase();

  if (normStatus === "paused") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
            <XCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">Services Paused</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
            Your learning services are temporarily paused. Please contact the academy for assistance.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (normStatus === "ended") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
            <XCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">Services Ended</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
            Your academy services have ended. Please contact the administrator if you believe this is an error.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  // Test State
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ParsedAssessmentQuestion[]>([]);
  const [testStage, setTestStage] = useState<"intro" | "active" | "result">("intro");
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [zoomImage, setZoomImage] = useState<{ url: string; label?: string } | null>(null);
  
  // Timer State
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Result & Attempt record state
  const [lastAttemptRecord, setLastAttemptRecord] = useState<TestAttemptRecord | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const testStageRef = useRef<"intro" | "active" | "result">("intro");
  testStageRef.current = testStage;

  // Ref for scroll container
  const modalScrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to top when stage or question index changes
  useEffect(() => {
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [testStage, currentQuestionIdx]);

  // Fetch fresh questions and student score directly from Supabase when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setFetchError(null);
    setQuestions([]);

    // Run simultaneous parallel fetch directly from Supabase
    const loadSimultaneously = async () => {
      try {
        const qListPromise = fetchQuestions(classGrade, subject, chapterNo, topicName, testType, { publishedOnly: true });
        const scorePromise = studentId 
          ? fetchStudentScore(studentId, classGrade, subject, chapterNo, topicName, testType).catch((err) => {
              console.warn("[StudentPracticeTestModal] Non-blocking score fetch warning:", err);
              return null;
            })
          : Promise.resolve(null);

        const [qList, studentScore] = await Promise.all([qListPromise, scorePromise]);

        if (isMounted) {
          setFetchError(null);
          if (Array.isArray(qList) && qList.length > 0) {
            setQuestions(qList);
          } else {
            setQuestions([]);
          }
          if (studentScore && testStageRef.current !== "result") {
            setLastAttemptRecord(studentScore);
          }
        }
      } catch (err: any) {
        console.warn("[StudentPracticeTestModal] Notice loading test data:", err?.message || err);
        if (isMounted) {
          setFetchError("Unable to load Practice Test. Please try again.");
          setQuestions([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadSimultaneously();

    const handleRealtimeUpdate = () => {
      if (testStageRef.current !== "result") {
        loadSimultaneously();
      }
    };
    window.addEventListener("practice-tests-updated", handleRealtimeUpdate);
    window.addEventListener("test-attempts-updated", handleRealtimeUpdate);

    setTestStage("intro");
    setCurrentQuestionIdx(0);
    setUserAnswers({});
    setElapsedSeconds(0);

    // Calculate next attempt number
    const nextNum = getStudentNextAttemptNumber(
      studentId,
      classGrade,
      subject,
      chapterNo,
      topicName,
      testType
    );
    setAttemptCount(nextNum);

    return () => {
      isMounted = false;
      window.removeEventListener("practice-tests-updated", handleRealtimeUpdate);
      window.removeEventListener("test-attempts-updated", handleRealtimeUpdate);
    };
  }, [isOpen, studentId, classGrade, subject, chapterNo, topicName, testType]);

  // Timer loop
  useEffect(() => {
    if (testStage === "active") {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [testStage]);

  if (!isOpen) return null;

  const handleStartTest = () => {
    if (questions.length === 0) return;
    setTestStage("active");
    setCurrentQuestionIdx(0);
    setUserAnswers({});
    setElapsedSeconds(0);
  };

  const handleSelectAnswer = (questionId: string, answerKey: string) => {
    setUserAnswers((prev) => ({
      ...prev,
      [questionId]: answerKey
    }));
  };

  const handleSubmitTest = () => {
    if (timerRef.current) clearInterval(timerRef.current);

    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;

    questions.forEach((q) => {
      const studentAns = userAnswers[q.id];
      if (!studentAns) {
        unattemptedCount++;
        return;
      }

      if (q.type !== "true_false") {
        // q.correctAnswer is e.g. "B" or "1. B"
        // studentAns is option letter e.g. "B" or full string
        if (studentAns.toLowerCase().startsWith(q.correctAnswer.toLowerCase())) {
          correctCount++;
        } else {
          wrongCount++;
        }
      } else {
        // True / False
        if (studentAns.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim()) {
          correctCount++;
        } else {
          wrongCount++;
        }
      }
    });

    const totalQuestions = questions.length;
    const score = correctCount;
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    const formattedDate = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
    const topicId = (topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
    const chapterId = `ch_${chapterNo}`;
    const subjectId = (subject || "").toLowerCase().replace(/\s+/g, "_");

    const attemptRecord: TestAttemptRecord = {
      id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      studentId,
      studentName,
      testId,
      topicId,
      chapterId,
      subjectId,
      classGrade,
      subject,
      chapterNo,
      chapterName,
      topicName: testType === "full_chapter" ? "🏆 Full Chapter Test" : topicName,
      testType,
      attemptNumber: attemptCount,
      date: formattedDate,
      timestamp: Date.now(),
      timeTakenSeconds: elapsedSeconds,
      score,
      totalMarks: totalQuestions,
      totalQuestions,
      percentage,
      correctAnswersCount: correctCount,
      wrongAnswersCount: wrongCount,
      unattemptedCount,
      userAnswers
    };

    saveTestAttempt(attemptRecord);
    setLastAttemptRecord(attemptRecord);
    setTestStage("result");
  };

  const formatTime = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const currentQuestion = questions[currentQuestionIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn overflow-hidden">
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden">
        
        {/* Compact Mobile Header */}
        <div className="px-3.5 py-2.5 sm:px-6 sm:py-3 bg-blue-600 dark:bg-blue-700 text-white flex items-center justify-between shrink-0 min-h-[72px] sm:min-h-[84px] shadow-md border-b border-blue-700/50">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 pr-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/15 dark:bg-white/20 backdrop-blur-md rounded-xl border border-white/20 shrink-0 flex items-center justify-center">
              {testType === "full_chapter" ? (
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
              ) : (
                <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1 flex flex-col justify-center">
              <p className="text-[11px] sm:text-xs font-semibold leading-tight text-blue-100 uppercase tracking-wider">
                {testType === "full_chapter" ? "Full Chapter Test" : "Topic Practice Test"}
              </p>
              <h2 className="text-xs sm:text-sm font-bold leading-snug text-white mt-0.5 break-words whitespace-normal max-w-full">
                {testType === "full_chapter" ? `Chapter ${chapterNo}: ${chapterName}` : topicName}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {testStage === "active" && (
              <div className="h-[28px] sm:h-[32px] px-2.5 bg-blue-700/80 dark:bg-blue-800/80 border border-white/25 rounded-full flex items-center gap-1.5 text-xs font-mono font-bold text-white shadow-xs">
                <Clock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>{formatTime(elapsedSeconds)}</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 sm:w-8 sm:h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition cursor-pointer shrink-0"
              title="Close"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body - overflow-x-hidden and touch-pan-y ensure smooth non-wobble vertical scrolling */}
        <div ref={modalScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 scrollbar-thin touch-pan-y">
          
          {/* INTRO STAGE */}
          {testStage === "intro" && (
            <div className="text-center py-4 sm:py-6 space-y-5 max-w-lg mx-auto">
              <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 rounded-full w-16 h-16 sm:w-20 sm:h-20 mx-auto flex items-center justify-center border border-indigo-200 dark:border-indigo-800 shadow-sm">
                {testType === "full_chapter" ? (
                  <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" />
                ) : (
                  <FileCheck className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-600 dark:text-indigo-400" />
                )}
              </div>

              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 break-words max-w-full px-1">
                  {testType === "full_chapter" ? `Chapter ${chapterNo}: ${chapterName}` : topicName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">
                  [{classGrade}] {subject} • Ch {chapterNo}: {chapterName}
                </p>
              </div>

              {isLoading ? (
                <div className="py-8 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : fetchError ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-semibold">
                  Unable to load Practice Test. Please try again.
                </div>
              ) : questions.length === 0 ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-semibold">
                  No Practice Test Available.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Questions</p>
                      <p className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">{questions.length}</p>
                    </div>
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Attempt</p>
                      <p className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400">#{attemptCount}</p>
                    </div>
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Attempts</p>
                      <p className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 truncate mt-0.5">Unlimited</p>
                    </div>
                  </div>

                  <button
                    onClick={handleStartTest}
                    className="w-full py-3 sm:py-3.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>Start Test Now</span>
                    <ChevronRight className="w-4 h-4 stroke-[3]" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* ACTIVE TEST STAGE */}
          {testStage === "active" && currentQuestion && (
            <div className="space-y-4">
              
              {/* Question Navigation Header - Wrapped to prevent overflow */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[11px] sm:text-xs font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/80 border border-blue-100 dark:border-blue-900/50 px-2.5 py-1 rounded-lg">
                  Question {currentQuestionIdx + 1} of {questions.length}
                </span>
                <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                  {currentQuestion.type === "mcq" ? "MCQ" : (currentQuestion.type === "assertion_reason" ? "ASSERTION & REASON" : "TRUE / FALSE")}
                </span>
                <span className="text-[11px] sm:text-xs font-extrabold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                  {Object.keys(userAnswers).length} / {questions.length} Answered
                </span>
              </div>

              {/* Question Card - Clear & Balanced Typography */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 my-2 shadow-2xs space-y-3">
                {/* IMAGE ABOVE QUESTION IF imagePosition IS 'above' */}
                {currentQuestion.imageUrl && currentQuestion.imagePosition === "above" && (
                  <div
                    className="text-center pb-2 cursor-pointer group"
                    onClick={() => setZoomImage({ url: currentQuestion.imageUrl!, label: currentQuestion.imageLabel || currentQuestion.question })}
                  >
                    <div className="relative inline-block max-w-full">
                      <img
                        src={currentQuestion.imageUrl}
                        referrerPolicy="no-referrer"
                        alt="Question Diagram"
                        className="max-h-72 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain mx-auto shadow-sm group-hover:scale-[1.01] transition-transform"
                      />
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-xs flex items-center gap-1 shadow-sm">
                        <ZoomIn className="w-3 h-3 text-blue-400" />
                        <span>Tap to Zoom</span>
                      </div>
                    </div>
                    {currentQuestion.imageLabel && (
                      <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
                        Diagram: {currentQuestion.imageLabel}
                      </p>
                    )}
                  </div>
                )}

                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug sm:leading-relaxed whitespace-pre-line break-words">
                  {currentQuestion.question}
                </h3>

                {/* IMAGE BELOW QUESTION IF imagePosition IS 'below' OR DEFAULT */}
                {currentQuestion.imageUrl && currentQuestion.imagePosition !== "above" ? (
                  <div
                    className="text-center pt-2 cursor-pointer group"
                    onClick={() => setZoomImage({ url: currentQuestion.imageUrl!, label: currentQuestion.imageLabel || currentQuestion.question })}
                  >
                    <div className="relative inline-block max-w-full">
                      <img
                        src={currentQuestion.imageUrl}
                        referrerPolicy="no-referrer"
                        alt="Question Diagram"
                        className="max-h-72 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain mx-auto shadow-sm group-hover:scale-[1.01] transition-transform"
                      />
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-xs flex items-center gap-1 shadow-sm">
                        <ZoomIn className="w-3 h-3 text-blue-400" />
                        <span>Tap to Zoom</span>
                      </div>
                    </div>
                    {currentQuestion.imageLabel && (
                      <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
                        Diagram: {currentQuestion.imageLabel}
                      </p>
                    )}
                  </div>
                ) : !currentQuestion.imageUrl && currentQuestion.imageLabel ? (
                  <div className="p-2.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center gap-1.5">
                    <span>Diagram Reference: {currentQuestion.imageLabel}</span>
                  </div>
                ) : null}
              </div>

              {/* Options Section */}
              <div className="my-3">
                {(() => {
                  const studentAns = userAnswers[currentQuestion.id];
                  const hasAnswered = studentAns !== undefined && studentAns !== null;

                  const isOptionCorrect = (optValue: string) => {
                    const corrNorm = currentQuestion.correctAnswer.trim().toLowerCase();
                    const optNorm = optValue.trim().toLowerCase();
                    const optChar = optNorm.charAt(0);
                    const corrChar = corrNorm.charAt(0);
                    return optChar === corrChar || optNorm.startsWith(corrNorm) || corrNorm.startsWith(optNorm);
                  };

                  const isStudentCorrect = hasAnswered && isOptionCorrect(studentAns);

                    const currentOptions = currentQuestion.type !== "true_false"
                      ? normalizeQuestionOptions(currentQuestion.options)
                      : currentQuestion.options;

                    return (
                      <>
                        {currentQuestion.type !== "true_false" ? (
                          <div className="space-y-2.5">
                            {currentOptions.map((opt, oIdx) => {
                            const letter = opt.charAt(0);
                            const isThisSelected = studentAns === letter;
                            const isThisCorrect = isOptionCorrect(letter);

                            let btnStyle = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-300";
                            let badge = null;

                            if (hasAnswered) {
                              if (isThisSelected) {
                                if (isThisCorrect) {
                                  btnStyle = "bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/30";
                                  badge = (
                                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                      <span>Correct!</span>
                                    </span>
                                  );
                                } else {
                                  btnStyle = "bg-rose-50 dark:bg-rose-950/70 border-rose-500 text-rose-900 dark:text-rose-200 font-bold ring-2 ring-rose-500/30";
                                  badge = (
                                    <span className="text-xs font-black text-rose-600 dark:text-rose-400 flex items-center gap-1 shrink-0">
                                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                                      <span>Incorrect</span>
                                    </span>
                                  );
                                }
                              } else if (isThisCorrect) {
                                btnStyle = "bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/30";
                                badge = (
                                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Correct Answer</span>
                                  </span>
                                );
                              } else {
                                btnStyle = "opacity-40 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400";
                              }
                            } else if (isThisSelected) {
                              btnStyle = "bg-blue-600 text-white border-blue-600 font-bold shadow-sm";
                            }

                            return (
                              <button
                                key={oIdx}
                                type="button"
                                onClick={() => handleSelectAnswer(currentQuestion.id, letter)}
                                className={`w-full min-h-[48px] p-3 sm:p-3.5 rounded-xl text-left text-xs sm:text-sm font-semibold transition-all border flex items-start sm:items-center justify-between gap-2.5 cursor-pointer ${btnStyle}`}
                              >
                                <span className="flex-1 break-words leading-snug">{opt}</span>
                                {badge ? (
                                  badge
                                ) : (
                                  <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${isThisSelected ? "border-white bg-white/20" : "border-slate-300 dark:border-slate-600"}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                          {["True", "False"].map((tfVal) => {
                            const isThisSelected = studentAns === tfVal;
                            const isThisCorrect = isOptionCorrect(tfVal);

                            let btnStyle = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-300";
                            let icon = null;

                            if (hasAnswered) {
                              if (isThisSelected) {
                                if (isThisCorrect) {
                                  btnStyle = "bg-emerald-600 text-white border-emerald-600 shadow-md font-black";
                                  icon = <CheckCircle2 className="w-4 h-4 text-white shrink-0" />;
                                } else {
                                  btnStyle = "bg-rose-600 text-white border-rose-600 shadow-md font-black";
                                  icon = <XCircle className="w-4 h-4 text-white shrink-0" />;
                                }
                              } else if (isThisCorrect) {
                                btnStyle = "bg-emerald-100 dark:bg-emerald-950/80 border-emerald-500 text-emerald-800 dark:text-emerald-200 font-extrabold ring-2 ring-emerald-500/40";
                                icon = <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
                              } else {
                                btnStyle = "opacity-40 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400";
                              }
                            } else if (isThisSelected) {
                              btnStyle = "bg-blue-600 text-white border-blue-600 shadow-md font-black";
                            }

                            return (
                              <button
                                key={tfVal}
                                type="button"
                                onClick={() => handleSelectAnswer(currentQuestion.id, tfVal)}
                                className={`h-11 sm:h-12 px-3 rounded-xl font-bold text-sm sm:text-base transition-all border flex items-center justify-center gap-2 cursor-pointer ${btnStyle}`}
                              >
                                <span>{tfVal}</span>
                                {icon}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Instant Answer Feedback Callout Banner */}
                      {hasAnswered && (
                        <div className={`p-3 sm:p-3.5 rounded-xl border flex flex-col gap-2 font-bold text-xs sm:text-sm mt-3 ${
                          isStudentCorrect
                            ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                            : "bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
                        }`}>
                          <div className="flex items-center gap-2.5">
                            {isStudentCorrect ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-xs sm:text-sm text-emerald-700 dark:text-emerald-300">Correct!</p>
                                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Great job! You selected the right answer.</p>
                                </div>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-xs sm:text-sm text-rose-700 dark:text-rose-300">Incorrect</p>
                                  <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium">
                                    Correct Answer: <span className="font-black underline">{currentQuestion.correctAnswer}</span>
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                          {currentQuestion.explanation && (
                            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px] font-normal text-slate-700 dark:text-slate-300 leading-relaxed">
                              <span className="font-bold">Explanation: </span>
                              {currentQuestion.explanation}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Bottom Navigation Buttons */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4 pt-3 mt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  disabled={currentQuestionIdx === 0}
                  onClick={() => setCurrentQuestionIdx((prev) => prev - 1)}
                  className="h-11 sm:h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                {currentQuestionIdx < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentQuestionIdx((prev) => prev + 1)}
                    className="h-11 sm:h-12 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Next Question</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmitTest}
                    className="h-11 sm:h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-xl shadow-md shadow-emerald-900/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-4 h-4" />
                    <span>Submit Test</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* RESULT STAGE */}
          {testStage === "result" && lastAttemptRecord && (
            <div className="space-y-5">
              
              {/* Score Header Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 bg-slate-900 text-white text-center shadow-xl border border-slate-700/80 relative overflow-hidden">
                <div className="p-2.5 bg-amber-500/20 rounded-full w-12 h-12 mx-auto mb-2 flex items-center justify-center border border-amber-400/30">
                  <Award className="w-6 h-6 text-amber-400" />
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">
                  {testType === "full_chapter" ? "Full Chapter Test Result" : "Topic Result"}
                </p>
                <h3 className="text-xs sm:text-sm font-bold text-slate-100 mt-0.5 break-words whitespace-normal max-w-full">
                  {testType === "full_chapter" ? `Chapter ${chapterNo}: ${chapterName}` : topicName}
                </h3>

                {/* Score & Percentage Display */}
                <div className="my-3 p-3 sm:p-4 rounded-xl bg-slate-950/90 border border-amber-400/40 shadow-inner max-w-md mx-auto">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                    Marks Obtained
                  </div>
                  <div className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    {lastAttemptRecord.score} / {lastAttemptRecord.totalQuestions}
                  </div>
                  <div className="text-xl font-black text-amber-300 mt-0.5">
                    {lastAttemptRecord.percentage}%
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mt-3 text-xs font-bold text-slate-200 border-t border-slate-800/80 pt-3">
                  <div className="px-2.5 py-1 bg-emerald-950/90 text-emerald-300 rounded-lg border border-emerald-500/40 font-bold shadow-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Correct: {lastAttemptRecord.correctAnswersCount}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-rose-950/90 text-rose-300 rounded-lg border border-rose-500/40 font-bold shadow-xs flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Wrong: {lastAttemptRecord.wrongAnswersCount}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-amber-950/90 text-amber-300 rounded-lg border border-amber-500/40 font-bold shadow-xs flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Not Attempted: {lastAttemptRecord.unattemptedCount ?? (lastAttemptRecord.totalQuestions - lastAttemptRecord.correctAnswersCount - lastAttemptRecord.wrongAnswersCount)}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-slate-800 text-blue-300 rounded-lg border border-blue-500/40 font-bold shadow-xs flex items-center gap-1">
                    <Trophy className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>Attempt #{lastAttemptRecord.attemptNumber}</span>
                  </div>
                </div>
              </div>

              {/* Question-by-Question Review */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Detailed Answer Review
                </h4>

                <div className="space-y-2.5">
                  {questions.map((q, idx) => {
                    const userAns = userAnswers[q.id];
                    const isAttempted = !!userAns;
                    let isCorrect = false;

                    if (isAttempted) {
                      if (q.type !== "true_false") {
                        isCorrect = userAns.toLowerCase().startsWith(q.correctAnswer.toLowerCase());
                      } else {
                        isCorrect = userAns.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim();
                      }
                    }

                    return (
                      <div
                        key={q.id}
                        className={`p-3.5 rounded-xl border space-y-1.5 ${
                          !isAttempted
                            ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60"
                            : isCorrect
                            ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60"
                            : "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-snug break-words flex-1">
                            Q{idx + 1}. {q.question}
                          </span>
                          {!isAttempted ? (
                            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800 flex items-center gap-1 shrink-0">
                              <HelpCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Not Attempted
                            </span>
                          ) : isCorrect ? (
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Correct
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/80 px-2 py-0.5 rounded-md border border-rose-300 dark:border-rose-800 flex items-center gap-1 shrink-0">
                              <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" /> Wrong
                            </span>
                          )}
                        </div>

                        <div className="text-xs space-y-0.5 pt-1 font-semibold">
                          <p className="text-slate-600 dark:text-slate-400">
                            Your Choice:{" "}
                            {!isAttempted ? (
                              <strong className="text-amber-700 dark:text-amber-400 italic">Not Attempted</strong>
                            ) : (
                              <strong className={isCorrect ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}>
                                {userAns}
                              </strong>
                            )}
                          </p>
                          <p className="text-emerald-700 dark:text-emerald-300">
                            Correct Answer: <strong>{q.correctAnswer}</strong>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons - sticky at bottom for easy closing */}
              <div className="sticky -bottom-4 sm:-bottom-6 -mx-4 sm:-mx-6 p-4 sm:p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 z-10 shadow-lg mt-6">
                <button
                  onClick={handleStartTest}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Re-attempt Test</span>
                </button>

                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md"
                >
                  Close & Return
                </button>
              </div>

            </div>
          )}

        </div>

      </div>

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
