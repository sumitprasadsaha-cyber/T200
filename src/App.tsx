import React, { useState, useEffect } from "react";
import { LayoutDashboard, Users, Settings as SettingsIcon, BookOpen, RefreshCw, Sparkles, Timer, Clock, FolderKanban, Radio } from "lucide-react";
import { Student, StudentServiceStatus, ChapterNote, ClassNote } from "./types";
import { INITIAL_STUDENTS } from "./data";
import Dashboard from "./components/Dashboard";
import StudentList from "./components/StudentList";
import StudentDetails from "./components/StudentDetails";
import SubjectNotes from "./components/SubjectNotes";
import AdminNotesView from "./components/AdminNotesView";
import LiveStudentsView from "./components/LiveStudentsView";
import AddEditStudentModal from "./components/AddEditStudentModal";
import ProfilePictureModal from "./components/ProfilePictureModal";
import StudyTimerModal from "./components/StudyTimerModal";
import Settings from "./components/Settings";
import Login from "./components/Login";
import StudentDashboard, { StudentMyTab } from "./components/StudentDashboard";
import ErrorBoundary from "./components/ErrorBoundary";
import LoadingProgressModal from "./components/LoadingProgressModal";
import { progressService } from "./lib/progressService";
import { getMonthsUpToCurrent } from "./utils/monthHelper";
import { getFirebaseAuth, createNewUserAuth } from "./lib/firebase";
import { 
  getUserDocument, 
  subscribeToStudents, 
  subscribeToStudent, 
  saveStudentDoc, 
  deleteStudentDoc,
  saveUserDocument,
  deleteUserAuthCredentials,
  subscribeToClassNotes,
  getLocalClassNotes,
  areClassNotesEqual,
  getLocalStudents,
  saveClassNoteDoc,
  deleteClassNoteDoc,
  updateStudentPresence,
  markStudentOffline,
  subscribeToTestAttempts,
  verifyUserRoleFromDatabase,
  fetchStudentServiceStatus,
  getCachedAuthSession,
  saveCachedAuthSession,
  clearCachedAuthSession,
  fetchFreshAdminDashboardData
} from "./lib/firestoreService";
import { migrateLegacyNotesToClassNotes, filterClassNotesForStudent, getStudentSubjects, isSubjectMatching } from "./utils/classNoteHelper";
import { deleteFileFromStorage, uploadProfilePhoto } from "./lib/storageService";
import { safeLocalStorageSetItem, safeLocalStorageGetItem, safeLocalStorageRemoveItem } from "./lib/safeStorage";
import { supabase } from "./lib/supabaseClient";
import { APP_VERSION } from "./config";
import { initializeAdminSync, initializeStudentSync, cleanupOnLogout } from "./lib/appSync";
import { fetchStudentTestAttemptsFromSupabase } from "./lib/testScorePersistence";

function normalizeStudent(student: Partial<Student> | null | undefined): Student {
  const rawStatus = (student?.serviceStatus || student?.service_status || "active").toString().toLowerCase().trim();
  const validStatus: StudentServiceStatus = rawStatus === "paused" || rawStatus === "ended" ? rawStatus : "active";

  return {
    id: student?.id || "",
    name: student?.name || "Unnamed Student",
    classGrade: student?.classGrade || "",
    phone: student?.phone || "",
    parentPhone: student?.parentPhone || "",
    monthlyFee: student?.monthlyFee || 0,
    feePaidThisMonth: Boolean(student?.feePaidThisMonth),
    registrationDate: student?.registrationDate || new Date().toISOString(),
    feeMonths: student?.feeMonths || {},
    feeMonthsList: student?.feeMonthsList || [],
    feePaymentDates: student?.feePaymentDates || {},
    enrolledSubjects: student?.enrolledSubjects || [],
    avatarUrl:
      student?.avatarUrl ||
      (student as any)?.photoUrl ||
      (student as any)?.photoURL ||
      (student as any)?.profilePic ||
      (student as any)?.imageUrl ||
      (student as any)?.avatar ||
      "",
    avatarColor: student?.avatarColor || "",
    avatarStorageProvider: student?.avatarStorageProvider || undefined,
    avatarBucket: student?.avatarBucket || "",
    avatarStoragePath: student?.avatarStoragePath || "",
    notes: student?.notes || {},
    attendance: student?.attendance || {},
    email: student?.email || "",
    password: student?.password || "",
    reports: student?.reports || [],
    chapterProgress: student?.chapterProgress || {},
    testMarks: student?.testMarks || [],
    homeworkRecords: student?.homeworkRecords || [],
    adminNotes: student?.adminNotes || "",
    studyMaterialUsage: student?.studyMaterialUsage || [],
    serviceStatus: validStatus,
    service_status: validStatus,
  };
}

export default function App() {
  // --- Authentication States ---
  // Synchronously restore cached session to prevent any premature redirect or flash
  const [auth, setAuth] = useState<{
    isAuthenticated: boolean;
    role: "admin" | "student" | null;
    loggedInStudentId: string | null;
  }>(() => {
    const cached = getCachedAuthSession();
    if (cached && (cached.role === "admin" || cached.role === "student")) {
      return {
        isAuthenticated: true,
        role: cached.role,
        loggedInStudentId: cached.studentId || null,
      };
    }
    return {
      isAuthenticated: false,
      role: null,
      loggedInStudentId: null,
    };
  });

  const [isAuthInitializing, setIsAuthInitializing] = useState<boolean>(() => {
    const cached = getCachedAuthSession();
    return !Boolean(cached?.role);
  });

  const safeSetLocalStorage = (key: string, val: string) => {
    safeLocalStorageSetItem(key, val);
  };

  // Synchronize with Firebase Authentication state & verify role solely from database
  useEffect(() => {
    let unsubscribe: any = null;
    let isMounted = true;

    async function initAuthSync() {
      try {
        const firebaseAuth = await getFirebaseAuth();
        if (firebaseAuth && isMounted) {
          unsubscribe = firebaseAuth.onAuthStateChanged(async (firebaseUser: any) => {
            if (!isMounted) return;

            if (firebaseUser) {
              try {
                // Instantly confirm state if cached session matches user
                const cachedSession = getCachedAuthSession();
                if (cachedSession && (cachedSession.uid === firebaseUser.uid || (firebaseUser.email && cachedSession.email?.toLowerCase() === firebaseUser.email.toLowerCase()))) {
                  setAuth({
                    isAuthenticated: true,
                    role: cachedSession.role,
                    loggedInStudentId: cachedSession.studentId || null,
                  });
                  if (cachedSession.role === "student" && cachedSession.studentId) {
                    setSelectedStudentId(cachedSession.studentId);
                  }
                  setIsAuthInitializing(false);
                }

                // Verify / refresh latest role from database
                const roleResult = await verifyUserRoleFromDatabase(firebaseUser.uid, firebaseUser.email);
                if (!isMounted) return;

                if (roleResult.role === "Student") {
                  const studentId = roleResult.studentId || null;
                  saveCachedAuthSession({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || "",
                    role: "student",
                    studentId,
                  });
                  setAuth({
                    isAuthenticated: true,
                    role: "student",
                    loggedInStudentId: studentId,
                  });
                  if (studentId) {
                    setSelectedStudentId(studentId);
                  }
                  setIsAuthInitializing(false);
                } else if (roleResult.role === "Admin") {
                  saveCachedAuthSession({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email || "",
                    role: "admin",
                    studentId: null,
                  });
                  setAuth({
                    isAuthenticated: true,
                    role: "admin",
                    loggedInStudentId: null,
                  });
                  setIsAuthInitializing(false);
                } else {
                  // If role could not be resolved from network, preserve existing cached session
                  const fallbackSession = getCachedAuthSession();
                  if (fallbackSession) {
                    setAuth({
                      isAuthenticated: true,
                      role: fallbackSession.role,
                      loggedInStudentId: fallbackSession.studentId || null,
                    });
                    if (fallbackSession.role === "student" && fallbackSession.studentId) {
                      setSelectedStudentId(fallbackSession.studentId);
                    }
                  }
                  setIsAuthInitializing(false);
                }
              } catch (err) {
                console.warn("[App Auth Sync] Non-fatal role verification notice:", err);
                // Do not sign the user out on network failure; keep authenticated session
                const fallbackSession = getCachedAuthSession();
                if (fallbackSession) {
                  setAuth({
                    isAuthenticated: true,
                    role: fallbackSession.role,
                    loggedInStudentId: fallbackSession.studentId || null,
                  });
                  if (fallbackSession.role === "student" && fallbackSession.studentId) {
                    setSelectedStudentId(fallbackSession.studentId);
                  }
                }
                setIsAuthInitializing(false);
              }
            } else {
              // Firebase reports no active user session
              clearCachedAuthSession();
              setAuth({
                isAuthenticated: false,
                role: null,
                loggedInStudentId: null,
              });
              setIsAuthInitializing(false);
            }
          });
        }
      } catch (err) {
        console.warn("Firebase Auth synchronization notice:", err);
        if (isMounted) {
          setIsAuthInitializing(false);
        }
      }
    }

    initAuthSync();

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Hook up real-time firestore subscription for students list (Admin) or single student (Student)
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    if (auth.role === "admin") {
      const unsubscribe = subscribeToStudents((updatedStudents) => {
        setStudents((updatedStudents || []).map(normalizeStudent));
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    } else if (auth.role === "student" && auth.loggedInStudentId) {
      const unsubscribe = subscribeToStudent(auth.loggedInStudentId, (updatedStudent) => {
        setStudents((prev) => {
          const exists = prev.some((s) => s.id === updatedStudent.id);
          if (exists) {
            return prev.map((s) => s.id === updatedStudent.id ? updatedStudent : s);
          } else {
            return [updatedStudent];
          }
        });
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [auth.isAuthenticated, auth.role, auth.loggedInStudentId]);

  // Immediately fetch student's service status directly from Supabase after login (never use cached values)
  useEffect(() => {
    if (auth.isAuthenticated && auth.role === "student" && auth.loggedInStudentId) {
      const studentId = auth.loggedInStudentId;
      fetchStudentServiceStatus(studentId).then((latestStatus) => {
        setStudents((prev) => {
          return prev.map((s) => {
            if (s.id === studentId) {
              return {
                ...s,
                serviceStatus: latestStatus,
                service_status: latestStatus,
              };
            }
            return s;
          });
        });
      });
    }
  }, [auth.isAuthenticated, auth.role, auth.loggedInStudentId]);

  // Synchronize practice test attempts & topic scores from Supabase & Firestore permanently
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    if (auth.role === "student" && auth.loggedInStudentId) {
      fetchStudentTestAttemptsFromSupabase(auth.loggedInStudentId);
    }

    const unsubscribe = subscribeToTestAttempts(() => {
      if (auth.role === "student" && auth.loggedInStudentId) {
        fetchStudentTestAttemptsFromSupabase(auth.loggedInStudentId);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [auth.isAuthenticated, auth.role, auth.loggedInStudentId]);

  // Real-time Student Presence Heartbeat
  useEffect(() => {
    if (auth.role !== "student" || !auth.loggedInStudentId) return;

    const studentId = auth.loggedInStudentId;

    // Send immediate heartbeat on mount/login
    updateStudentPresence(studentId);

    // Heartbeat every 20s
    const intervalId = setInterval(() => {
      updateStudentPresence(studentId);
    }, 20000);

    // Ping on user activity/focus
    let lastPing = Date.now();
    const handleActivity = () => {
      const now = Date.now();
      if (now - lastPing > 15000) {
        lastPing = now;
        updateStudentPresence(studentId);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updateStudentPresence(studentId);
        lastPing = Date.now();
      }
    };

    const handleUnload = () => {
      markStudentOffline(studentId);
    };

    window.addEventListener("focus", handleActivity);
    window.addEventListener("click", handleActivity, { passive: true });
    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("focus", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      markStudentOffline(studentId);
    };
  }, [auth.role, auth.loggedInStudentId]);

  const handleLogin = (role: "admin" | "student", studentId: string | null) => {
    saveCachedAuthSession({
      role,
      studentId,
    });
    setAuth({
      isAuthenticated: true,
      role,
      loggedInStudentId: studentId,
    });
    setIsAuthInitializing(false);
    if (role === "student" && studentId) {
      setSelectedStudentId(studentId);
      // Initialize real-time sync for student
      initializeStudentSync(studentId);
    } else if (role === "admin") {
      // Initialize real-time sync for admin
      initializeAdminSync();
    }
  };

  const handleLogout = async () => {
    await progressService.runWithProgress({ label: "Signing out…" }, async () => {
      if (auth.role === "student" && auth.loggedInStudentId) {
        markStudentOffline(auth.loggedInStudentId);
      }

      // Clear cached auth session
      clearCachedAuthSession();

      // Clean up all listeners and sync resources
      cleanupOnLogout();

      // Sign out explicitly from Firebase
      try {
        const firebaseAuth = await getFirebaseAuth();
        if (firebaseAuth) {
          await firebaseAuth.signOut().catch((err) => console.warn("Firebase sign out warning:", err));
        }
      } catch {}

      setAuth({
        isAuthenticated: false,
        role: null,
        loggedInStudentId: null,
      });
      setSelectedStudentId(null);
      setActiveSubject(null);
      setActiveTab("Dashboard");
    });
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshAdminDashboard = async () => {
    const freshData = await fetchFreshAdminDashboardData();
    if (freshData && Array.isArray(freshData.students) && freshData.students.length > 0) {
      setStudents(freshData.students);
    }
    return freshData;
  };

  const handleManualRefresh = async () => {
    await progressService.runWithProgress({ label: "Refreshing Data…" }, async () => {
      setIsRefreshing(true);
      try {
        const refreshedStudents = getLocalStudents();
        if (refreshedStudents.length > 0) {
          setStudents(refreshedStudents);
        }
        const refreshedNotes = getLocalClassNotes();
        if (refreshedNotes.length > 0) {
          setClassNotes(refreshedNotes);
        }
      } catch (err) {
        console.error("Manual refresh error:", err);
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  // --- Navigation States ---
  const [activeTab, setActiveTab] = useState<"Dashboard" | "LiveStudents" | "Notes" | "Students" | "My" | "Settings">("Dashboard");
  const [classNotes, setClassNotes] = useState<ClassNote[]>(() => getLocalClassNotes());

  // Subscribe to central class notes real-time updates
  useEffect(() => {
    const unsub = subscribeToClassNotes((updatedNotes) => {
      if (!updatedNotes || updatedNotes.length === 0) return;
      setClassNotes((prev) => (areClassNotesEqual(prev, updatedNotes) ? prev : updatedNotes));
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(() => {
    // If a student session was preserved, preset selected student ID
    const cachedAuth = localStorage.getItem("tuition_auth_state");
    if (cachedAuth) {
      try {
        const parsed = JSON.parse(cachedAuth);
        if (parsed.role === "student") {
          return parsed.loggedInStudentId;
        }
      } catch (e) {}
    }
    return null;
  });
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [studentFilter, setStudentFilter] = useState<"All" | "Pending">("All");

  // --- Display Theme State ---
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("tuition_app_theme") as any) || "light";
  });

  const [visualTheme, setVisualTheme] = useState<string>(() => {
    return localStorage.getItem("tuition_app_visual_theme") || "sapphire";
  });

  // --- Global QR Code for WhatsApp Billings ---
  const [qrCode, setQrCode] = useState<string | null>(() => {
    return localStorage.getItem("tuition_payment_qr_code");
  });

  // --- Student State with local persistence ---
  const [students, setStudents] = useState<Student[]>(() => {
    const cached = localStorage.getItem("tuition_students_data");
    if (cached === null) {
      return []; // Start clean with no students, no class tabs, and no names
    }
    
    let parsed: Student[] = [];
    try {
      parsed = JSON.parse(cached);
    } catch (e) {
      console.error("Failed parsing student cache:", e);
      return [];
    }

    // Initialize feeMonths for all students if not present
    return parsed.map((student) => {
      const normalized = normalizeStudent(student);
      if (!normalized.feeMonths || Object.keys(normalized.feeMonths).length === 0) {
        const regDate = normalized.registrationDate || "2026-06-01";
        const [regYearStr, regMonthStr] = regDate.split("-");
        const regYear = parseInt(regYearStr) || 2026;
        const regMonthIdx = (parseInt(regMonthStr) || 6) - 1;

        if (regYear === 2026 && regMonthIdx === 5) {
          return {
            ...normalized,
            feeMonths: {
              "June 2026": normalized.id === "student-3" || normalized.id === "student-5" ? "unpaid" : "paid"
            }
          };
        }

        return {
          ...normalized,
          feeMonths: {
            "June 2026": normalized.id === "student-3" || normalized.id === "student-5" ? "unpaid" : "paid",
            "July 2026": normalized.feePaidThisMonth ? "paid" : "unpaid"
          }
        };
      }
      return normalized;
    });
  });

  // Find active student object if selected
  const activeStudent = React.useMemo(() => {
    const targetId = auth.role === "student" ? auth.loggedInStudentId : selectedStudentId;
    const found = students.find((s) => s.id === targetId);
    return found ? normalizeStudent(found) : null;
  }, [students, selectedStudentId, auth.role, auth.loggedInStudentId]);

  useEffect(() => {
    if (auth.role === "student" && activeStudent?.id) {
      const storedStudentTheme = localStorage.getItem(`tuition_student_visual_theme_${activeStudent.id}`);
      const nextTheme = storedStudentTheme || localStorage.getItem("tuition_app_visual_theme") || "sapphire";
      setVisualTheme(nextTheme);
    } else {
      const adminTheme = localStorage.getItem("tuition_app_visual_theme") || "sapphire";
      setVisualTheme(adminTheme);
    }
  }, [auth.role, activeStudent?.id]);

  // Save changes to local persistence
  useEffect(() => {
    safeSetLocalStorage("tuition_students_data", JSON.stringify(students));
  }, [students]);

  // Automatic Migration: Migrate any legacy notes stored inside student objects to central classNotes
  useEffect(() => {
    if (students.length > 0) {
      const { migratedNotes, addedCount } = migrateLegacyNotesToClassNotes(students, classNotes);
      if (addedCount > 0) {
        console.log(`[App] Automatically migrated ${addedCount} legacy notes to central ClassNotes repository.`);
        migratedNotes.forEach((cn) => {
          saveClassNoteDoc(cn);
        });
      }
    }
  }, [students]);

  // Handle Theme application
  useEffect(() => {
    safeSetLocalStorage("tuition_app_theme", theme);
    const root = window.document.documentElement;
    
    if (theme === "dark") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    }
  }, [theme]);

  const handleVisualThemeChange = (theme: string) => {
    if (auth.role === "student" && activeStudent?.id) {
      safeSetLocalStorage(`tuition_student_visual_theme_${activeStudent.id}`, theme);
    } else {
      safeSetLocalStorage("tuition_app_visual_theme", theme);
    }
    setVisualTheme(theme);
  };

  // Handle premium visual theme application
  useEffect(() => {
    if (auth.role !== "student") {
      safeSetLocalStorage("tuition_app_visual_theme", visualTheme);
    }
    const root = window.document.documentElement;
    root.classList.remove("theme-sunset", "theme-ocean", "theme-neon", "theme-cosmic", "theme-sapphire", "theme-olive", "theme-emerald", "theme-ruby", "theme-amber", "theme-gold", "theme-white");
    root.classList.add(`theme-${visualTheme}`);
  }, [auth.role, visualTheme]);

  // Save QR Code to local storage
  const handleSaveQrCode = (dataUrl: string | null) => {
    setQrCode(dataUrl);
    if (dataUrl) {
      safeSetLocalStorage("tuition_payment_qr_code", dataUrl);
    } else {
      localStorage.removeItem("tuition_payment_qr_code");
    }
  };

  // --- Modal States ---
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [isAvatarOpen, setIsAvatarOpen] = useState(false);
  const [isTimerOpen, setIsTimerOpen] = useState(false);
  const [isTimerActive, setIsTimerActive] = useState(false);

  useEffect(() => {
    const handleOpenTimer = () => {
      setIsTimerOpen(true);
    };
    window.addEventListener("open-study-timer", handleOpenTimer);
    return () => window.removeEventListener("open-study-timer", handleOpenTimer);
  }, []);

  // Find notes for the current active subject
  const currentSubjectNotes = React.useMemo(() => {
    if (!activeStudent || !activeSubject) return [];
    const fromClassNotes: ChapterNote[] = filterClassNotesForStudent(classNotes, activeStudent)
      .filter((n) => isSubjectMatching(n.subject, activeSubject))
      .map((cn) => ({
        id: cn.id,
        classGrade: cn.classGrade,
        subject: cn.subject,
        chapterNo: cn.chapterNo,
        chapterName: cn.chapterName,
        partLabel: cn.partLabel,
        topicNo: cn.topicNo,
        topicName: cn.topicName,
        pdfUrl: cn.pdfUrl,
        pdfFileName: cn.pdfFileName,
        storagePath: cn.storagePath,
        bucket: cn.bucket,
        fileType: cn.fileType,
        mimeType: cn.mimeType,
        createdAt: cn.createdAt,
        uploadedBy: cn.uploadedBy,
        accessType: cn.accessType || "all",
        allowedStudentIds: cn.allowedStudentIds || [],
      }));

    let legacyRaw: ChapterNote[] = [];
    if (activeStudent.notes) {
      for (const [k, v] of Object.entries(activeStudent.notes)) {
        if (isSubjectMatching(k, activeSubject) && Array.isArray(v)) {
          legacyRaw = [...legacyRaw, ...v];
        }
      }
    }

    const combined = [...fromClassNotes];
    legacyRaw.forEach((legNote) => {
      if (!combined.some((n) => n.id === legNote.id)) {
        combined.push(legNote);
      }
    });

    return combined;
  }, [activeStudent, activeSubject, classNotes]);

  // --- State Mutators ---

  // Reset & Delete all application data
  const handleResetData = () => {
    setStudents([]);
    setQrCode(null);
    safeLocalStorageRemoveItem("tuition_payment_qr_code");
    safeLocalStorageSetItem("tuition_students_data", JSON.stringify([]));
    setActiveTab("Dashboard");
    setSelectedStudentId(null);
    setActiveSubject(null);
    setStudentFilter("All");
  };

  // Restore state from a backup file or Drive
  const handleRestoreData = (restoredStudents: Student[], restoredQrCode: string | null) => {
    setStudents(restoredStudents);
    if (restoredQrCode) {
      setQrCode(restoredQrCode);
      safeLocalStorageSetItem("tuition_payment_qr_code", restoredQrCode);
    }
  };

  // Add or update student details
  const handleSaveStudent = async (
    studentData: Omit<Student, "id" | "notes" | "attendance" | "feeMonths"> & { email?: string; password?: string }
  ) => {
    if (studentToEdit) {
      // Edit mode
      const updatedStudent = {
        ...studentToEdit,
        ...studentData,
        notes: studentToEdit.notes || {},
        attendance: studentToEdit.attendance || {},
        feeMonths: studentToEdit.feeMonths || {},
      };
      setStudents((prev) =>
        prev.map((s) => (s.id === studentToEdit.id ? updatedStudent : s))
      );
      await saveStudentDoc(updatedStudent);
      setStudentToEdit(null);
    } else {
      // Add mode
      const studentId = `student-${Date.now()}`;
      const regDate = studentData.registrationDate ? new Date(studentData.registrationDate) : new Date();
      const regMonth = regDate.getMonth(); // 0-11
      const allMonths = [
        "January 2026", "February 2026", "March 2026", "April 2026", "May 2026", "June 2026",
        "July 2026", "August 2026", "September 2026", "October 2026", "November 2026", "December 2026"
      ];
      
      const feeMonths: Record<string, "paid" | "unpaid" | "na"> = {};
      allMonths.forEach((m, idx) => {
        if (idx < regMonth) {
          feeMonths[m] = "na";
        }
      });

      const newStudent: Student = {
        ...studentData,
        id: studentId,
        avatarColor: getRandomAvatarColor(),
        feeMonths,
        notes: studentData.enrolledSubjects.reduce((acc, subj) => {
          acc[subj] = [];
          return acc;
        }, {} as Record<string, ChapterNote[]>),
        attendance: {},
      };

      // Handle student Login account generation
      if (studentData.email) {
        try {
          const tempPassword = studentData.password || "123456";
          const uid = await createNewUserAuth(studentData.email, tempPassword);
          
          // Store uid in student document for later deletion
          newStudent.uid = uid;
          
          const studentUserDoc = {
            uid,
            name: studentData.name,
            email: studentData.email.toLowerCase(),
            role: "Student",
            studentId: studentId,
            active: true,
            temporaryPasswordRequired: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: null
          };
          await saveUserDocument(uid, studentUserDoc);
        } catch (authErr: any) {
          console.error("Failed to register student auth details:", authErr);
        }
      }

      setStudents((prev) => [newStudent, ...prev]);
      await saveStudentDoc(newStudent);
    }
  };

  // Delete student
  const handleDeleteStudent = async (studentId: string) => {
    const student = students.find(s => s.id === studentId);
    setStudents((prev) => prev.filter((s) => s.id !== studentId));
    await deleteStudentDoc(studentId);
    
    // Delete student auth credentials if uid exists
    if (student?.uid) {
      await deleteUserAuthCredentials(student.uid);
    }
    
    if (selectedStudentId === studentId) {
      setSelectedStudentId(null);
      setActiveSubject(null);
    }
  };

  // Toggle Fee paid status for legacy fallback
  const handleToggleFeePayment = async (studentId: string) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const isPaid = !s.feePaidThisMonth;
          const updatedMonths = { ...(s.feeMonths || {}) };
          updatedMonths["July 2026"] = isPaid ? "paid" : "unpaid";
          updated = {
            ...s,
            feePaidThisMonth: isPaid,
            feeMonths: updatedMonths
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  // Explicit monthly fee toggler
  const handleSetFeeStatus = async (studentId: string, monthYear: string, status: "paid" | "unpaid" | "na", paymentDate?: string) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const updatedMonths = { ...(s.feeMonths || {}) };
          updatedMonths[monthYear] = status;
          
          const updatedPaymentDates = { ...(s.feePaymentDates || {}) };
          if (status === "paid") {
            updatedPaymentDates[monthYear] = paymentDate || new Date().toISOString().split("T")[0];
          } else {
            delete updatedPaymentDates[monthYear];
          }

          const isJulyPaid = monthYear === "July 2026" ? (status === "paid") : s.feePaidThisMonth;
          updated = {
            ...s,
            feePaidThisMonth: isJulyPaid,
            feeMonths: updatedMonths,
            feePaymentDates: updatedPaymentDates
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  const handleAddFeeMonth = async (studentId: string, month: string) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const currentList = s.feeMonthsList && s.feeMonthsList.length > 0
            ? s.feeMonthsList
            : getMonthsUpToCurrent();
          if (currentList.includes(month)) return s;
          const updatedList = [...currentList, month];
          const ALL_ACADEMIC_MONTHS = [
            "March 2026", "April 2026", "May 2026", "June 2026", 
            "July 2026", "August 2026", "September 2026", "October 2026", 
            "November 2026", "December 2026", "January 2027", "February 2027", "March 2027"
          ];
          updatedList.sort((a, b) => ALL_ACADEMIC_MONTHS.indexOf(a) - ALL_ACADEMIC_MONTHS.indexOf(b));
          updated = {
            ...s,
            feeMonthsList: updatedList
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 55);
  };

  // Toggle attendance for a date
  const handleToggleAttendance = async (
    studentId: string,
    date: string,
    isPresent: boolean | "na"
  ) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          updated = {
            ...s,
            attendance: {
              ...s.attendance,
              [date]: isPresent,
            },
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  // Add chapter note with pdf and student access permissions
  const handleAddNote = async (
    studentId: string,
    subject: string,
    chapterNo: number,
    chapterName: string,
    pdfUrl: string,
    pdfFileName: string,
    accessTypeOrIsCompleted: "all" | "selected" | boolean = "all",
    allowedStudentIdsOrRemark: string[] | string = []
  ) => {
    let accessType: "all" | "selected" = "all";
    let allowedStudentIds: string[] = [];

    if (typeof accessTypeOrIsCompleted === "string") {
      accessType = accessTypeOrIsCompleted as "all" | "selected";
    }
    if (Array.isArray(allowedStudentIdsOrRemark)) {
      allowedStudentIds = allowedStudentIdsOrRemark;
    }

    let finalPdfUrl = pdfUrl;
    let extraMetadata: Partial<ChapterNote> = {};
    
    if (pdfUrl && pdfUrl.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(pdfUrl);
        finalPdfUrl = parsed.storagePath || parsed.downloadUrl || pdfUrl;
        extraMetadata = {
          storageProvider: "supabase",
          bucket: parsed.bucket,
          storagePath: parsed.storagePath,
          fileName: parsed.fileName,
          fileSize: parsed.fileSize,
          mimeType: parsed.mimeType,
          uploadedAt: parsed.uploadedAt,
          uploadedBy: parsed.uploadedBy,
          downloadUrl: parsed.downloadUrl
        };
      } catch (e) {
        console.error("[handleAddNote] Failed to parse JSON metadata for pdfUrl:", e);
      }
    }

    const newNote: ChapterNote = {
      id: `note-${Date.now()}`,
      chapterNo,
      chapterName,
      pdfUrl: finalPdfUrl,
      pdfFileName,
      isCompleted: typeof accessTypeOrIsCompleted === "boolean" ? accessTypeOrIsCompleted : false,
      remark: typeof allowedStudentIdsOrRemark === "string" ? allowedStudentIdsOrRemark : "",
      createdAt: new Date().toISOString(),
      accessType,
      allowedStudentIds: accessType === "selected" ? allowedStudentIds : [],
      ...extraMetadata
    };

    const updatedStudentsList: Student[] = [];
    setStudents((prev) =>
      prev.map((s) => {
        const isEnrolled = s.enrolledSubjects ? s.enrolledSubjects.includes(subject) : true;
        if (isEnrolled || s.id === studentId) {
          const subjectNotes = s.notes[subject] || [];
          const updatedStudent = {
            ...s,
            notes: {
              ...s.notes,
              [subject]: [...subjectNotes, newNote],
            },
          };
          updatedStudentsList.push(updatedStudent);
          return updatedStudent;
        }
        return s;
      })
    );
    setTimeout(async () => {
      for (const updatedSt of updatedStudentsList) {
        await saveStudentDoc(updatedSt);
      }
    }, 50);
  };

  // Update chapter note access permissions across all student records
  const handleUpdateNoteAccess = async (
    subject: string,
    noteId: string,
    accessType: "all" | "selected",
    allowedStudentIds: string[]
  ) => {
    const updatedStudentsList: Student[] = [];
    setStudents((prev) =>
      prev.map((s) => {
        const subjectNotes = s.notes[subject];
        if (!subjectNotes || subjectNotes.length === 0) return s;

        let modified = false;
        const newNotes = subjectNotes.map((note) => {
          if (note.id === noteId) {
            modified = true;
            return {
              ...note,
              accessType,
              allowedStudentIds: accessType === "selected" ? allowedStudentIds : []
            };
          }
          return note;
        });

        if (modified) {
          const updatedStudent = {
            ...s,
            notes: {
              ...s.notes,
              [subject]: newNotes
            }
          };
          updatedStudentsList.push(updatedStudent);
          return updatedStudent;
        }
        return s;
      })
    );

    setTimeout(async () => {
      for (const updatedSt of updatedStudentsList) {
        await saveStudentDoc(updatedSt);
      }
    }, 50);
  };

  // Delete note from a subject
  const handleDeleteNote = async (
    studentId: string,
    subject: string,
    noteId: string
  ) => {
    // Locate note in classNotes or student.notes
    const targetStudent = students.find((s) => s.id === studentId);
    const targetClassNote =
      classNotes.find((n) => n.id === noteId) ||
      getLocalClassNotes().find((n) => n.id === noteId);
    const legacyNote = targetStudent?.notes?.[subject]?.find((n) => n.id === noteId);

    const bucket = targetClassNote?.bucket || legacyNote?.bucket || "academy-connect-files";
    const rawStoragePath =
      targetClassNote?.storagePath ||
      legacyNote?.storagePath ||
      targetClassNote?.pdfUrl ||
      legacyNote?.pdfUrl ||
      "";

    console.log(`[Delete Note Flow] Initiating note deletion process: noteId="${noteId}", studentId="${studentId}", subject="${subject}"`);

    // A. Delete file from Supabase Storage first
    if (rawStoragePath) {
      try {
        await deleteFileFromStorage(rawStoragePath, bucket);
        console.log(`[Delete Note Flow] Storage file removed: ${rawStoragePath}`);
      } catch (storageErr: any) {
        const errMsg = storageErr?.message || String(storageErr);
        const isNotFound =
          errMsg.toLowerCase().includes("not found") ||
          errMsg.toLowerCase().includes("does not exist") ||
          errMsg.toLowerCase().includes("not_found") ||
          (storageErr as any)?.status === 404 ||
          (storageErr as any)?.status === "404" ||
          (storageErr as any)?.statusCode === 404 ||
          (storageErr as any)?.statusCode === "404";

        if (isNotFound) {
          console.warn(`[Delete Note Flow] Storage object already removed: ${rawStoragePath}. Proceeding with database record deletion.`);
        } else {
          console.error(`[Delete Note Flow] Storage deletion error:`, storageErr);
          throw new Error(`Storage deletion failed: ${errMsg}`);
        }
      }
    }

    // B. Clear Cache Storage entries for this note
    try {
      if ("caches" in window) {
        const cache = await caches.open("student-pdf-cache");
        const urlsToClear = [
          targetClassNote?.pdfUrl,
          targetClassNote?.storagePath,
          legacyNote?.pdfUrl,
          legacyNote?.storagePath,
          rawStoragePath,
        ].filter(Boolean) as string[];

        for (const url of urlsToClear) {
          try {
            await cache.delete(url);
          } catch (e) {
            // ignore
          }
        }
      }
    } catch (cacheErr) {
      console.warn(`[Delete Note Flow] Cache clear warning:`, cacheErr);
    }

    // C. Delete note document from database (Firestore & local storage)
    await deleteClassNoteDoc(noteId);

    // D. Refresh local state immediately across Admin and Student views
    setClassNotes((prev) => prev.filter((n) => n.id !== noteId));
    setStudents((prev) =>
      prev.map((st) => {
        if (!st.notes) return st;
        let changed = false;
        const updatedNotes: Record<string, ChapterNote[]> = {};
        for (const [subKey, arr] of Object.entries(st.notes)) {
          if (Array.isArray(arr)) {
            const filtered = arr.filter((n) => n.id !== noteId);
            if (filtered.length !== arr.length) changed = true;
            if (filtered.length > 0) updatedNotes[subKey] = filtered;
          } else {
            updatedNotes[subKey] = arr;
          }
        }
        return changed ? { ...st, notes: updatedNotes } : st;
      })
    );
  };

  // Toggle note complete state
  const handleToggleNoteComplete = async (
    studentId: string,
    subject: string,
    noteId: string
  ) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const subjectNotes = s.notes[subject] || [];
          updated = {
            ...s,
            notes: {
              ...s.notes,
              [subject]: subjectNotes.map((n) => {
                if (n.id === noteId) {
                  return { ...n, isCompleted: !n.isCompleted };
                }
                return n;
              }),
            },
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  // Update chapter note remark
  const handleUpdateChapterRemark = async (
    studentId: string,
    subject: string,
    noteId: string,
    remark: string
  ) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const subjectNotes = s.notes[subject] || [];
          updated = {
            ...s,
            notes: {
              ...s.notes,
              [subject]: subjectNotes.map((n) => {
                if (n.id === noteId) {
                   return { ...n, remark };
                }
                return n;
              }),
            },
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  // Edit chapter note (chapter number and chapter name)
  const handleEditNote = async (
    studentId: string,
    subject: string,
    noteId: string,
    newChapterNo: number,
    newChapterName: string
  ) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          const subjectNotes = s.notes[subject] || [];
          updated = {
            ...s,
            notes: {
              ...s.notes,
              [subject]: subjectNotes.map((n) => {
                if (n.id === noteId) {
                  return {
                    ...n,
                    chapterNo: newChapterNo,
                    chapterName: newChapterName
                  };
                }
                return n;
              }),
            },
          };
          return updated;
        }
        return s;
      })
    );
    if (updated) {
      await saveStudentDoc(updated);
    }
  };

  // Update full student record
  const handleUpdateStudent = async (updatedStudent: Student) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    await saveStudentDoc(updatedStudent);
  };

  // Update enrolled subjects directly
  const handleUpdateEnrolledSubjects = async (
    studentId: string,
    enrolledSubjects: string[]
  ) => {
    let updated: Student | null = null;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id === studentId) {
          updated = {
            ...s,
            enrolledSubjects,
          };
          return updated;
        }
        return s;
      })
    );
    setTimeout(async () => {
      if (updated) await saveStudentDoc(updated);
    }, 50);
  };

  // Save profile photo
  const handleSaveProfilePhoto = async (studentId: string, dataUrl: string) => {
    const studentToUpdate = students.find((s) => s.id === studentId);
    if (!studentToUpdate) return;

    let updatedStudent: Student;

    try {
      if (studentToUpdate.avatarStoragePath) {
        try {
          await deleteFileFromStorage(studentToUpdate.avatarStoragePath);
        } catch {
          // ignore cleanup errors if old file doesn't exist
        }
      }

      // Upload base64 image as file to Storage
      const metadata = await uploadProfilePhoto(studentId, dataUrl, `${studentId}_avatar.png`);

      updatedStudent = {
        ...studentToUpdate,
        avatarUrl: metadata.downloadUrl || dataUrl,
        avatarStorageProvider: "supabase",
        avatarBucket: metadata.bucket,
        avatarStoragePath: metadata.storagePath,
      };
    } catch (err) {
      console.error("[App] Failed to save profile photo to storage, using dataUrl fallback:", err);
      updatedStudent = {
        ...studentToUpdate,
        avatarUrl: dataUrl,
      };
    }

    // 1. Save to Firestore / local storage immediately (triggers real-time snapshot sync to all connected clients)
    await saveStudentDoc(updatedStudent);

    // 2. Update local state
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? updatedStudent : s))
    );
  };

  // Remove profile photo
  const handleRemoveProfilePhoto = async (studentId: string) => {
    const studentToUpdate = students.find((s) => s.id === studentId);
    if (!studentToUpdate) return;

    if (studentToUpdate.avatarStoragePath) {
      try {
        await deleteFileFromStorage(studentToUpdate.avatarStoragePath);
      } catch {}
    }

    const updatedStudent: Student = {
      ...studentToUpdate,
      avatarUrl: "",
      avatarStoragePath: "",
      avatarBucket: "",
    };

    await saveStudentDoc(updatedStudent);
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? updatedStudent : s))
    );
  };

  // Triggering edit from student list
  const handleTriggerEdit = (student: Student) => {
    setStudentToEdit(student);
    setIsAddEditOpen(true);
  };

  // Triggering add modal
  const handleTriggerAdd = () => {
    setStudentToEdit(null);
    setIsAddEditOpen(true);
  };

  // Fallback random colors for avatars
  const getRandomAvatarColor = () => {
    const colors = [
      "bg-blue-600",
      "bg-sky-600",
      "bg-indigo-600",
      "bg-blue-800",
      "bg-cyan-600",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Helper to trigger navigation to pending students directly
  const handleNavigateToPendingStudents = () => {
    setActiveTab("Students");
    setStudentFilter("Pending");
    setSelectedStudentId(null);
    setActiveSubject(null);
  };

  if (isAuthInitializing && !auth.isAuthenticated) {
    return (
      <div className={`min-h-screen bg-slate-100 dark:bg-[#090d16] flex items-center justify-center p-4 font-sans antialiased theme-${visualTheme}`} id="app-auth-loading">
        <div className="w-full max-w-xs bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-xl p-5 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3 animate-pulse">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="w-full flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 px-0.5">
            <span>Restoring Session…</span>
            <span className="font-mono text-blue-600 dark:text-blue-400">85%</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800/90 h-2 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60">
            <div className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-full animate-pulse transition-all duration-300 w-[85%]" />
          </div>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className={`min-h-screen bg-slate-100 dark:bg-[#090d16] flex items-center justify-center p-4 font-sans antialiased selection:bg-blue-500 selection:text-white theme-${visualTheme}`} id="app-shell">
        <Login
          onLoginSuccess={(role, studentId, userId) => {
            handleLogin(role.toLowerCase() as "admin" | "student", studentId);
          }}
        />
      </div>
    );
  }

  const renderMainContent = () => {
    if (auth.role === "admin" && activeSubject && activeStudent) {
      return (
        <SubjectNotes
          subject={activeSubject}
          studentName={activeStudent.name}
          studentId={activeStudent.id}
          classGrade={activeStudent.classGrade}
          notes={currentSubjectNotes}
          onBack={() => setActiveSubject(null)}
          onAddNote={(chapterNo, chapterName, pdfUrl, pdfFileName, accessType, allowedStudentIds) =>
            handleAddNote(activeStudent.id, activeSubject, chapterNo, chapterName, pdfUrl, pdfFileName, accessType, allowedStudentIds)
          }
          onEditNote={(noteId, chapterNo, chapterName) =>
            handleEditNote(activeStudent.id, activeSubject, noteId, chapterNo, chapterName)
          }
          onDeleteNote={(noteId) =>
            handleDeleteNote(activeStudent.id, activeSubject, noteId)
          }
          onUpdateNoteAccess={(subj, noteId, accessType, allowedStudentIds) =>
            handleUpdateNoteAccess(subj, noteId, accessType, allowedStudentIds)
          }
          isAdmin={auth.role === "admin"}
          enrolledSubjects={getStudentSubjects(activeStudent, classNotes)}
          onSelectSubject={(subj) => setActiveSubject(subj)}
          students={students}
        />
      );
    }

    if (auth.role === "admin") {
      if (selectedStudentId && activeStudent) {
        return (
          <StudentDetails
            student={activeStudent}
            qrCode={qrCode}
            isAdmin={auth.role === "admin"}
            onBack={() => {
              setSelectedStudentId(null);
              setActiveTab("Students");
            }}
            onSelectSubject={(subject) => setActiveSubject(subject)}
            onToggleAttendance={(date, isPresent) =>
              handleToggleAttendance(activeStudent.id, date, isPresent)
            }
            onToggleFeePayment={() => handleToggleFeePayment(activeStudent.id)}
            onSetFeeStatus={(monthYear, status, paymentDate) => handleSetFeeStatus(activeStudent.id, monthYear, status, paymentDate)}
            onAddFeeMonth={(month) => handleAddFeeMonth(activeStudent.id, month)}
            onOpenAvatarModal={() => setIsAvatarOpen(true)}
            onAddNote={(subject, chapterNo, chapterName, pdfUrl, pdfFileName, isCompleted, remark) =>
              handleAddNote(activeStudent.id, subject, chapterNo, chapterName, pdfUrl, pdfFileName, isCompleted, remark)
            }
            onToggleChapterCompletion={(subject, noteId) => handleToggleNoteComplete(activeStudent.id, subject, noteId)}
            onDeleteNote={(subject, noteId) => handleDeleteNote(activeStudent.id, subject, noteId)}
            onUpdateChapterRemark={(subject, noteId, remark) => handleUpdateChapterRemark(activeStudent.id, subject, noteId, remark)}
            onUpdateEnrolledSubjects={(subjects) => handleUpdateEnrolledSubjects(activeStudent.id, subjects)}
          />
        );
      }

      return (
        <>
          {activeTab === "Dashboard" && (
            <Dashboard
              students={students}
              onRefresh={handleRefreshAdminDashboard}
              onNavigateToStudents={handleNavigateToPendingStudents}
              onNavigateToStudentDetails={(id) => {
                setSelectedStudentId(id);
                setActiveSubject(null);
              }}
              onToggleAttendance={(studentId, date, isPresent) =>
                handleToggleAttendance(studentId, date, isPresent)
              }
            />
          )}

          {activeTab === "LiveStudents" && (
            <LiveStudentsView
              students={students}
              onRefresh={() => {
                setStudents([...students]);
              }}
            />
          )}

          {activeTab === "Notes" && (
            <AdminNotesView
              notes={classNotes}
              students={students}
              onRefresh={() => {
                const refreshedNotes = getLocalClassNotes();
                setClassNotes(refreshedNotes);
                const refreshedStudents = getLocalStudents();
                setStudents(refreshedStudents);
              }}
            />
          )}

          {activeTab === "Students" && (
            <StudentList
              students={students}
              filter={studentFilter}
              onFilterChange={setStudentFilter}
              onSelectStudent={(id) => {
                setSelectedStudentId(id);
                setActiveSubject(null);
              }}
              onEditStudent={handleTriggerEdit}
              onDeleteStudent={handleDeleteStudent}
              onAddStudent={handleTriggerAdd}
              onUpdateServiceStatus={(studentId, newStatus) => {
                setStudents((prev) =>
                  prev.map((s) => (s.id === studentId ? { ...s, serviceStatus: newStatus, service_status: newStatus } : s))
                );
              }}
            />
          )}

          {activeTab === "Settings" && (
            <Settings 
              theme={theme} 
              onThemeChange={setTheme} 
              visualTheme={visualTheme}
              onVisualThemeChange={handleVisualThemeChange}
              qrCode={qrCode}
              onQrCodeChange={handleSaveQrCode}
              onResetData={handleResetData} 
              students={students}
              onRestoreData={handleRestoreData}
              isAdmin={true}
            />
          )}
        </>
      );
    }

    if (activeStudent) {
      return (
        <>
          {activeTab === "Dashboard" && (
            <StudentDashboard
              student={activeStudent}
              onSelectSubject={(subject) => {
                setActiveSubject(subject);
                setActiveTab("My");
              }}
              onNavigateToTab={setActiveTab}
              onOpenAvatarModal={() => setIsAvatarOpen(true)}
              onUpdateChapterRemark={(subject, noteId, remark) => handleUpdateChapterRemark(activeStudent.id, subject, noteId, remark)}
              onDeleteNote={(subject, noteId) => handleDeleteNote(activeStudent.id, subject, noteId)}
              onUpdateStudent={handleUpdateStudent}
              isAdmin={false}
              onRefresh={handleManualRefresh}
              isRefreshing={isRefreshing}
            />
          )}

          {activeTab === "My" && (
            <StudentMyTab
              student={activeStudent}
              initialSubject={activeSubject}
              onSelectSubject={(subject) => setActiveSubject(subject)}
              onUpdateChapterRemark={(subject, noteId, remark) => handleUpdateChapterRemark(activeStudent.id, subject, noteId, remark)}
              onDeleteNote={(subject, noteId) => handleDeleteNote(activeStudent.id, subject, noteId)}
              onUpdateStudent={handleUpdateStudent}
              isAdmin={false}
            />
          )}

          {activeTab === "Settings" && (
            <Settings 
              theme={theme} 
              onThemeChange={setTheme} 
              visualTheme={visualTheme}
              onVisualThemeChange={handleVisualThemeChange}
              qrCode={qrCode}
              onQrCodeChange={handleSaveQrCode}
              onResetData={handleResetData} 
              students={students}
              onRestoreData={handleRestoreData}
              isAdmin={false}
            />
          )}
        </>
      );
    }

    return null;
  };

  return (
    <div className={`min-h-screen w-full bg-slate-100 dark:bg-[#090d16] flex flex-col items-center justify-start p-0 sm:p-4 md:p-6 font-sans antialiased selection:bg-blue-500 selection:text-white theme-${visualTheme}`} id="app-shell">
      {/* 
        Sleek, responsive container.
        Scales up dynamically on wider devices and tablets to fit screen size.
      */}
      <div 
        id="main-frame"
        className="relative w-full max-w-7xl h-screen sm:h-[calc(100vh-2rem)] md:h-[calc(100vh-3rem)] bg-white dark:bg-[#111827] sm:rounded-2xl border-0 sm:border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col shadow-2xl transition-all duration-300"
        style={{ contentVisibility: "auto" }}
      >
        {/* Sleek top banner showing user role and logout */}
        <div className="px-4 py-3 bg-slate-50 dark:bg-[#0d131f] border-b border-slate-150 dark:border-slate-800/80 flex items-center justify-between z-20 shrink-0" id="session-top-header">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.32em] text-slate-600 dark:text-slate-300">
              {auth.role === "admin" ? "Admin Console" : "Student Portal"}
            </span>
            {auth.role === "admin" && (
              <span className="rounded-full border border-slate-200/70 bg-white/80 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                v{APP_VERSION}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {auth.role !== "admin" && (
              <button
                onClick={() => setIsTimerOpen(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer border ${
                  isTimerActive
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border-emerald-200 dark:border-emerald-800 shadow-sm"
                    : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border-blue-100 dark:border-blue-900/40"
                }`}
                title="Open Study Timer & Stopwatch"
              >
                {isTimerActive ? (
                  <Clock className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                ) : (
                  <Timer className="w-3.5 h-3.5 text-blue-500" />
                )}
                <span>Timer</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg transition-all cursor-pointer border border-rose-100/30"
            >
              Logout
            </button>
          </div>
        </div>



        {/* Scrollable primary content viewport */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-5 sm:pt-6 pb-24" id="main-content-scroll">
          
          {/* View Routing Engine */}
          <ErrorBoundary fallbackTitle="View Error">
            {renderMainContent()}
          </ErrorBoundary>
        </div>

        {/* 
          Global Bottom Navigation:
          NOW FIXED AT BOTTOM ALWAYS, for both admin and students.
          Allows instant navigation back or tabs swap!
        */}
        {auth.role !== null && (
          <nav 
            className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 py-3 px-4 sm:px-6 flex justify-around items-center z-30 shadow-lg"
            id="bottom-navigation-bar"
          >
            {/* Nav Tab 1: Dashboard */}
            <button
              onClick={() => {
                setActiveTab("Dashboard");
                if (auth.role === "admin") {
                  setSelectedStudentId(null);
                }
                setActiveSubject(null);
              }}
              className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                activeTab === "Dashboard" && (auth.role === "student" || !selectedStudentId)
                  ? "text-blue-600 dark:text-blue-400 scale-102 font-bold"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
              id="nav-btn-dashboard"
            >
              <LayoutDashboard className="w-5 h-5 stroke-[2]" />
              <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5">
                {auth.role === "student" ? "dashboard" : "Dashboard"}
              </span>
            </button>

            {/* Nav Tab 2: Live Students (Admin only) */}
            {auth.role === "admin" && (
              <button
                onClick={() => {
                  setActiveTab("LiveStudents");
                  setSelectedStudentId(null);
                  setActiveSubject(null);
                }}
                className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                  activeTab === "LiveStudents"
                    ? "text-emerald-600 dark:text-emerald-400 scale-102 font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
                id="nav-btn-live-students"
              >
                <div className="relative">
                  <Radio className="w-5 h-5 stroke-[2]" />
                  <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                </div>
                <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5 flex items-center gap-1">
                  🟢 Live
                </span>
              </button>
            )}

            {/* Nav Tab 2: Notes (Admin only) */}
            {auth.role === "admin" && (
              <button
                onClick={() => {
                  setActiveTab("Notes");
                  setSelectedStudentId(null);
                  setActiveSubject(null);
                }}
                className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                  activeTab === "Notes"
                    ? "text-blue-600 dark:text-blue-400 scale-102 font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
                id="nav-btn-notes"
              >
                <FolderKanban className="w-5 h-5 stroke-[2]" />
                <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5">
                  Notes
                </span>
              </button>
            )}

            {/* Nav Tab 2: My Study Space (Students only) */}
            {auth.role === "student" && (
              <button
                onClick={() => {
                  setActiveTab("My");
                  setActiveSubject(null);
                }}
                className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                  activeTab === "My"
                    ? "text-blue-600 dark:text-blue-400 scale-102 font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
                id="nav-btn-my"
              >
                <BookOpen className="w-5 h-5 stroke-[2]" />
                <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5">
                  My Study Space
                </span>
              </button>
            )}

            {/* Nav Tab 3: Students (Admin only) */}
            {auth.role === "admin" && (
              <button
                onClick={() => {
                  setActiveTab("Students");
                  setSelectedStudentId(null);
                  setActiveSubject(null);
                }}
                className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                  (activeTab === "Students" || selectedStudentId)
                    ? "text-blue-600 dark:text-blue-400 scale-102 font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                }`}
                id="nav-btn-students"
              >
                <Users className="w-5 h-5 stroke-[2]" />
                <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5">
                  Students
                </span>
              </button>
            )}

            {/* Nav Tab 3: Settings */}
            <button
              onClick={() => {
                setActiveTab("Settings");
                if (auth.role === "admin") {
                  setSelectedStudentId(null);
                }
                setActiveSubject(null);
              }}
              className={`flex flex-col items-center gap-0.5 sm:gap-1 transition-all flex-1 py-1 ${
                activeTab === "Settings"
                  ? "text-blue-600 dark:text-blue-400 scale-102 font-bold"
                  : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              }`}
              id="nav-btn-settings"
            >
              <SettingsIcon className="w-5 h-5 stroke-[2]" />
              <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase mt-0.5">
                Settings
              </span>
            </button>
          </nav>
        )}

        {/* --- Floating / Portal Modals --- */}
        
        {/* Register/Edit Student Dialog */}
        <AddEditStudentModal
          isOpen={isAddEditOpen}
          onClose={() => setIsAddEditOpen(false)}
          onSave={handleSaveStudent}
          studentToEdit={studentToEdit}
        />

        {/* Update Profile Avatar Sheet */}
        {activeStudent && (
          <ProfilePictureModal
            isOpen={isAvatarOpen}
            onClose={() => setIsAvatarOpen(false)}
            onSelectPhoto={(dataUrl) => handleSaveProfilePhoto(activeStudent.id, dataUrl)}
            existingPhoto={activeStudent.avatarUrl}
            onRemovePhoto={() => handleRemoveProfilePhoto(activeStudent.id)}
          />
        )}

        {/* Study Timer & Stopwatch Modal */}
        <StudyTimerModal
          isOpen={isTimerOpen}
          onClose={() => setIsTimerOpen(false)}
          onTimerRunningChange={setIsTimerActive}
        />

        {/* Global Loading Progress Modal */}
        <LoadingProgressModal />
      </div>
    </div>
  );
}
