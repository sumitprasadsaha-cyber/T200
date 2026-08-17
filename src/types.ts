export interface ClassNote {
  id: string;
  classGrade: string; // e.g. "Class 6", "Class 7", "Class 8", "Class 9", "Class 10"
  subject: string; // e.g. "Mathematics", "Science", "English", "Computer Science", "Indian Heritage and Culture", "Economics"
  chapterNo: number;
  chapterName: string;
  partLabel?: string; // e.g. "Topic 1", "Topic 2", or legacy part label
  topicNo?: number | string; // e.g. 1, 2, "1.1"
  topicName?: string; // e.g. "Introduction"
  pdfUrl: string;
  pdfFileName: string;
  storagePath?: string;
  bucket?: string;
  fileType?: "pdf" | "image";
  mimeType?: string;
  createdAt: string;
  updatedAt?: string;
  uploadedBy?: string;

  // Student Access Control metadata
  accessType?: "all" | "selected";
  allowedStudentIds?: string[];
  allowedClasses?: string[];
}

export interface ChapterNote {
  id: string;
  classGrade?: string;
  subject?: string;
  chapterNo: number; // Only number!
  chapterName: string; // Chapter name
  partLabel?: string; // Optional part label or legacy part label
  topicNo?: number | string; // e.g. 1, 2
  topicName?: string; // e.g. "Introduction"
  pdfUrl: string; // Base64 PDF content or URL
  pdfFileName: string; // Original PDF filename
  isCompleted?: boolean; // For tracking revision progress
  remark?: string; // Specific tutor remark on student's performance/difficulty
  createdAt: string;

  // Student Access Control metadata
  accessType?: "all" | "selected";
  allowedStudentIds?: string[];
  allowedClasses?: string[];

  // Supabase storage metadata
  storageProvider?: "supabase";
  bucket?: string;
  storagePath?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  fileType?: "pdf" | "image";
  uploadedAt?: string;
  uploadedBy?: string;
  downloadUrl?: string;
}

export interface ChapterProgressData {
  studentId: string;
  subjectId: string;
  chapterId: string;
  selectedStatus: string;
  calculatedProgress: number;
  remarks?: string;
  updatedAt: string;
}

export interface StudentReport {
  id: string;
  storageProvider: "supabase";
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadUrl: string;
}

export interface TestMarkRecord {
  id: string;
  subject: string;
  testName: string;
  marksObtained: number;
  totalMarks: number;
  date: string;
}

export interface HomeworkRecord {
  id: string;
  date: string;
  subject: string;
  title: string;
  completed: boolean;
  remark?: string;
}

export interface StudyMaterialUsageRecord {
  subject: string;
  chaptersViewed: number;
  totalChapters: number;
}

export type StudentServiceStatus = "active" | "paused" | "ended";

export interface Student {
  id: string;
  uid?: string; // Firebase Auth UID for deleting account
  rollNo?: string | number;
  name: string;
  classGrade: string; // "Class 8", "Class 9", "Class 10"
  phone: string;
  parentPhone: string;
  monthlyFee: number;
  feePaidThisMonth: boolean; // Legacy fallback
  registrationDate?: string; // YYYY-MM-DD joining date
  feeMonths?: Record<string, "paid" | "unpaid" | "na">; // e.g. {"June 2026": "unpaid", "July 2026": "paid"}
  feeMonthsList?: string[]; // e.g. ["March 2026", "April 2026"]
  feePaymentDates?: Record<string, string>; // e.g. {"June 2026": "2026-06-15"}
  enrolledSubjects: string[]; // e.g. ["Computer Science", "English", "Mathematics", "Science"]
  avatarUrl?: string; // custom image url
  avatarColor?: string; // fallback background color
  avatarStorageProvider?: "supabase";
  avatarBucket?: string;
  avatarStoragePath?: string;
  notes: Record<string, ChapterNote[]>; // subject -> list of pdf notes
  attendance: Record<string, boolean | "na">; // date (YYYY-MM-DD) -> present (true), absent (false), or N/A ("na")
  email?: string;
  password?: string;
  reports?: StudentReport[];
  chapterProgress?: Record<string, ChapterProgressData>; // key: `${subjectId}_${chapterId}` or `${chapterId}`
  lastActiveAt?: string; // ISO timestamp of last app activity
  serviceStatus?: StudentServiceStatus; // "active" | "paused" | "ended"
  service_status?: StudentServiceStatus; // Supabase column mapping
  
  // AI Analysis additional dimensions
  testMarks?: TestMarkRecord[];
  homeworkRecords?: HomeworkRecord[];
  adminNotes?: string;
  studyMaterialUsage?: StudyMaterialUsageRecord[];
  syllabusProgress?: Record<string, number>;
}

export type AIReportType =
  | "institution_overview"
  | "student_performance"
  | "class_report"
  | "attendance_insights"
  | "fee_insights"
  | "test_performance"
  | "homework_analytics"
  | "syllabus_insights"
  | "parent_communication"
  | "recommendations"
  | "monthly_report"
  | "ask_ai";

export interface AICachedReport {
  reportType: AIReportType;
  key: string;
  markdown: string;
  updatedAt: string;
}


export interface TuitionStats {
  totalEnrolled: number;
  presentToday: number;
  activeClassesCount: number;
  feesPendingCount: number;
  totalRevenue: number;
  monthlyTarget: number;
  monthlyCollected: number;
  subjectProgress: Record<string, number>; // subject -> progress %
}

// ----------------------------------------------------
// SMART TOPIC-WISE ASSESSMENT SYSTEM TYPES
// ----------------------------------------------------

export interface ParsedAssessmentQuestion {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  type: "mcq" | "true_false" | "assertion_reason";
  question: string;
  options: string[]; // Clean option text for student view (e.g. ["A. Plants and animals", "B. Internal and external forces"])
  correctAnswer: string; // "A" | "B" | "C" | "D" or "True" | "False"
  explanation?: string; // Optional explanation for the answer
  imageUrl?: string; // Optional image data URL or hosted image URL for diagram/image-based questions
  imageLabel?: string; // Optional diagram label, e.g. "Ocean-floor diagram"
  imagePosition?: "above" | "below"; // "above" or "below" the question text
  rawText?: string;
  published?: boolean;
  orderIndex?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TopicPracticeTest {
  id: string; // Unique test key: `${classGrade}_${subject}_ch${chapterNo}_${topicName}`
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  rawText: string;
  questions: ParsedAssessmentQuestion[];
  createdAt: string;
  updatedAt: string;
  uploadedBy?: string;
}

export interface TestAttemptRecord {
  id: string;
  studentId: string;
  studentName: string;
  testId?: string;
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string; // Topic Name OR "Full Chapter Test"
  testType: "topic" | "full_chapter";
  attemptNumber: number; // 1, 2, 3...
  date: string; // Formatted date string
  timestamp: number;
  timeTakenSeconds: number; // In seconds
  score: number; // Marks obtained, e.g. 18
  totalMarks?: number; // Total marks, e.g. 20
  totalQuestions: number; // e.g., 20
  percentage: number; // e.g., 90
  correctAnswersCount: number;
  wrongAnswersCount: number;
  unattemptedCount?: number;
  userAnswers: Record<string, string>; // questionId -> chosen answer
}
