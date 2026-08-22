import React, { useState, useMemo, useEffect } from "react";
import { 
  Users, 
  IndianRupee, 
  BarChart2, 
  RefreshCw,
  AlertCircle,
  TrendingUp,
  ArrowRight,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Calendar,
  X,
  Search,
  Phone,
  CheckCircle,
  XCircle,
  MinusCircle,
  FileText,
  Trash2,
  Bell
} from "lucide-react";
import { Student } from "../types";
import { getUnpaidOverdueMonths, hasAttendedInMonth, isFutureMonth } from "./StudentList";
import {
  getEvaluatedFeeStatus,
  getEvaluatedStudentLedger,
  getPendingFeeMonths,
  getPendingStudentsList
} from "../utils/feeBillingHelper";
import { getInstitutionName, subscribeToAnnouncements, saveAnnouncementDoc, deleteAnnouncementDoc } from "../lib/firestoreService";
import { progressService } from "../lib/progressService";

interface DashboardProps {
  students: Student[];
  onRefresh: () => Promise<any> | any;
  onNavigateToStudents: () => void;
  onNavigateToStudentDetails: (studentId: string) => void;
  onToggleAttendance: (studentId: string, date: string, isPresent: boolean | "na") => void;
}

function normalizeClassName(classGrade: string) {
  if (!classGrade || !classGrade.trim()) return "Unassigned Class";
  const trimmed = classGrade.trim();
  if (/^upsc$/i.test(trimmed) || /^class\s+upsc$/i.test(trimmed)) {
    return "UPSC";
  }
  if (/^class\s+/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `Class ${trimmed}`;
  }
  return trimmed;
}

export default function Dashboard({ 
  students, 
  onRefresh, 
  onNavigateToStudents, 
  onNavigateToStudentDetails,
  onToggleAttendance
}: DashboardProps) {
  const [instName, setInstName] = useState("Sumit Tuition App");

  useEffect(() => {
    let active = true;
    const loadInstitutionName = async () => {
      const name = await getInstitutionName();
      if (active) setInstName(name);
    };

    loadInstitutionName();
    const handleInstitutionNameUpdate = () => {
      void loadInstitutionName();
    };

    window.addEventListener("institution-name-updated", handleInstitutionNameUpdate);
    return () => {
      active = false;
      window.removeEventListener("institution-name-updated", handleInstitutionNameUpdate);
    };
  }, []);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activePopupId, setActivePopupId] = useState<string | null>(null);
  const [popupSearch, setPopupSearch] = useState("");
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});

  // Close popup on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activePopupId) {
        setActivePopupId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePopupId]);

  // Announcements/Alerts management
  const [announcements, setAnnouncements] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem("tuition_announcements");
      if (cached) return JSON.parse(cached);
    } catch {}
    return [];
  });
  const [newAnnouncement, setNewAnnouncement] = useState("");

  const handleAddAnnouncement = () => {
    if (!newAnnouncement.trim()) return;
    const item = {
      id: Date.now().toString(),
      text: newAnnouncement.trim(),
      date: new Date().toISOString().slice(0, 10)
    };
    saveAnnouncementDoc(item);
    setNewAnnouncement("");
  };

  const handleDeleteAnnouncement = (id: string) => {
    deleteAnnouncementDoc(id);
  };

  // Sync state in real-time
  useEffect(() => {
    const unsub = subscribeToAnnouncements((list) => {
      setAnnouncements(list);
    });

    const handleAnnouncementsUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        setAnnouncements(customEvent.detail);
      } else {
        try {
          const cached = localStorage.getItem("tuition_announcements");
          if (cached) setAnnouncements(JSON.parse(cached));
        } catch {}
      }
    };

    window.addEventListener("announcements-updated", handleAnnouncementsUpdate);

    return () => {
      unsub();
      window.removeEventListener("announcements-updated", handleAnnouncementsUpdate);
    };
  }, []);

  // Atomic database refresh handler
  const handleRefreshClick = async () => {
    if (isRefreshing) return; // Prevent duplicate clicks

    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const freshResult = await onRefresh();
      if (freshResult && typeof freshResult === "object") {
        if (Array.isArray(freshResult.announcements)) {
          setAnnouncements(freshResult.announcements);
        }
        if (freshResult.institutionName) {
          setInstName(freshResult.institutionName);
        }
      }
    } catch (err) {
      console.warn("[Dashboard] Refresh operation notice:", err);
      setRefreshError("Unable to refresh. Please try again.");
      setTimeout(() => {
        setRefreshError(null);
      }, 4000);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Today's dynamic ISO date key (YYYY-MM-DD)
  const todayIsoKey = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  // Format today's display date: Today: Wednesday • 22 July 2026
  const getTodayDisplayDate = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    
    const now = new Date();
    const dayName = days[now.getDay()];
    const dayNum = now.getDate();
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();
    
    return `Today: ${dayName} • ${dayNum} ${monthName} ${year}`;
  };

  // Calculate statistics dynamically
  const stats = useMemo(() => {
    const totalEnrolled = students.length;
    
    let pendingFeeCount = 0;
    let totalTarget = 0;
    let totalCollected = 0;
    let remainingDue = 0;

    let attendancePresentCount = 0;
    let attendanceAbsentCount = 0;
    let attendanceNotMarkedCount = 0;

    let totalCollectedAllMonths = 0;

    students.forEach(student => {
      // 1. Pending fee months and outstanding dues
      const pendingMonths = getPendingFeeMonths(student);
      if (pendingMonths.length > 0) {
        pendingFeeCount++;
        remainingDue += pendingMonths.length * (student.monthlyFee || 0);
      }

      // 2. Attendance calculations for today's dynamic date key
      const attVal = student.attendance?.[todayIsoKey];
      if (attVal === true) {
        attendancePresentCount++;
      } else if (attVal === false) {
        attendanceAbsentCount++;
      } else {
        attendanceNotMarkedCount++;
      }

      // 3. Sum up all payments actually made by each student for each month
      const ledger = getEvaluatedStudentLedger(student);
      Object.keys(ledger).forEach(month => {
        if (ledger[month] === "PAID") {
          totalCollectedAllMonths += student.monthlyFee || 0;
        }
      });
    });

    totalCollected = totalCollectedAllMonths;
    totalTarget = totalCollected + remainingDue;
    const totalRevenue = totalCollectedAllMonths;
    const collectionPercentage = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 100;

    return {
      totalEnrolled,
      pendingFeeCount,
      totalRevenue,
      totalTarget,
      totalCollected,
      remainingDue,
      collectionPercentage,
      attendancePresentCount,
      attendanceAbsentCount,
      attendanceNotMarkedCount
    };
  }, [students, todayIsoKey]);

  // Dynamic system date formatter: Tuesday 15/July/2026
  const getFormattedDate = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    
    const now = new Date();
    const dayName = days[now.getDay()];
    const dayNum = now.getDate();
    const monthName = months[now.getMonth()];
    const year = now.getFullYear();
    
    return `Today is ${dayName} - ${dayNum}/${monthName}/${year}`;
  };

  // Definition of available stats cards
  const cardsConfig = useMemo(() => {
    return {
      students: {
        id: "students",
        title: "Total Students",
        value: stats.totalEnrolled,
        subtext: "View Roster Summary",
        icon: <Users className="w-5 h-5" />,
        theme: "blue" as const,
        onClick: () => {
          setPopupSearch("");
          setActivePopupId("students");
        },
      },
      pending: {
        id: "pending",
        title: "Fees Pending",
        value: stats.pendingFeeCount,
        subtext: "Outstanding Accounts",
        icon: <AlertCircle className="w-5 h-5" />,
        theme: "rose" as const,
        onClick: () => {
          setPopupSearch("");
          setActivePopupId("pending");
        },
      },
      revenue: {
        id: "revenue",
        title: "Total Revenue",
        value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`,
        subtext: "Sum of All Payments",
        icon: <IndianRupee className="w-5 h-5" />,
        theme: "indigo" as const,
        onClick: () => {
          setPopupSearch("");
          setActivePopupId("revenue");
        },
      },
      overdue: {
        id: "overdue",
        title: "Overdue Amount",
        value: `₹${stats.remainingDue.toLocaleString("en-IN")}`,
        subtext: `${stats.pendingFeeCount} Due Accounts`,
        icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
        theme: "amber" as const,
        onClick: () => {
          setPopupSearch("");
          setActivePopupId("overdue");
        },
      },
      attendance: {
        id: "attendance",
        title: "Today's Attendance",
        value: `${stats.attendancePresentCount} / ${stats.totalEnrolled}`,
        subtext: "Click to Record",
        icon: <Calendar className="w-5 h-5" />,
        theme: "emerald" as const,
        onClick: () => {
          setPopupSearch("");
          setActivePopupId("attendance");
        },
      }
    };
  }, [stats]);


  // Group students class-wise for collapsible accordion
  const groupedStudentsByClass = useMemo(() => {
    const map: Record<string, Student[]> = {};
    const query = popupSearch.trim().toLowerCase();

    students.forEach((s) => {
      const className = normalizeClassName(s.classGrade);
      const matchesSearch =
        !query ||
        s.name.toLowerCase().includes(query) ||
        className.toLowerCase().includes(query) ||
        s.phone?.includes(query) ||
        (s.enrolledSubjects && s.enrolledSubjects.some((sub) => sub.toLowerCase().includes(query)));

      if (matchesSearch) {
        if (!map[className]) {
          map[className] = [];
        }
        map[className].push(s);
      }
    });

    const sortedClasses = Object.keys(map).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 999;
      const numB = parseInt(b.replace(/\D/g, "")) || 999;
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });

    return sortedClasses.map((className) => ({
      className,
      students: map[className],
    }));
  }, [students, popupSearch]);

  const pendingStudentsList = useMemo(() => {
    return students.filter(s => {
      const overdue = getUnpaidOverdueMonths(s);
      return overdue.length > 0 && (
        s.name.toLowerCase().includes(popupSearch.toLowerCase()) ||
        s.classGrade.toLowerCase().includes(popupSearch.toLowerCase()) ||
        s.phone?.includes(popupSearch)
      );
    });
  }, [students, popupSearch]);

  // Popup Meta configuration for headers
  const getPopupMeta = () => {
    switch (activePopupId) {
      case "attendance":
        return {
          icon: <Calendar className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
          title: "Today's Attendance",
          subtitle: "Live attendance for today"
        };
      case "students":
        return {
          icon: <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
          title: "Total Students",
          subtitle: "Enrolled students breakdown"
        };
      case "pending":
        return {
          icon: <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
          title: "Fees Pending",
          subtitle: "Outstanding accounts ledger"
        };
      case "overdue":
        return {
          icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
          title: "Overdue Amount",
          subtitle: "Overdue payment accounts"
        };
      case "revenue":
        return {
          icon: <IndianRupee className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
          title: "Total Revenue",
          subtitle: "Cumulative payment collection logs"
        };
      case "monthly_collection":
        return {
          icon: <BarChart2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
          title: "Monthly Fee Collection",
          subtitle: "Current month collection progress & status"
        };
      default:
        return {
          icon: <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
          title: "Dashboard Details",
          subtitle: "Active summary details"
        };
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-24 animate-fadeIn" id="dashboard-view">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-5" id="dashboard-header">
        <div className="flex flex-col">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-800 dark:text-slate-100" id="dashboard-title">
            {instName}
          </h1>
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1.5" id="dashboard-subtitle">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            {getFormattedDate()}
          </p>
        </div>
        <button
          onClick={handleRefreshClick}
          disabled={isRefreshing}
          className={`p-2 sm:p-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl border border-slate-200 dark:border-slate-700 transition-all focus:outline-hidden cursor-pointer ${
            isRefreshing ? "opacity-70 cursor-not-allowed" : ""
          }`}
          id="btn-refresh-dashboard"
          title={isRefreshing ? "Refreshing Dashboard..." : "Refresh statistics"}
        >
          <RefreshCw 
            className={`w-4 h-4 transition-colors ${isRefreshing ? "animate-spin text-blue-600 dark:text-blue-400" : ""}`} 
          />
        </button>
      </div>

      {/* User-friendly refresh error notice */}
      {refreshError && (
        <div className="flex items-center gap-2.5 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-xs font-bold text-amber-800 dark:text-amber-300 animate-fadeIn" id="dashboard-refresh-error">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{refreshError}</span>
        </div>
      )}

      {/* 1. First Row: Total Students & Today's Attendance (50:50 width, same length) */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4" id="dashboard-row-1">
        <DashboardCardWrapper card={cardsConfig.students} />
        <DashboardCardWrapper card={cardsConfig.attendance} />
      </div>

      {/* 2. Second Row: Fees Pending & Overdue Amount (50:50 width, same length) */}
      <div className="grid grid-cols-2 gap-3.5 sm:gap-4" id="dashboard-row-2">
        <DashboardCardWrapper card={cardsConfig.pending} />
        <DashboardCardWrapper card={cardsConfig.overdue} />
      </div>

      {/* Announcements Section */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-500" />
              Broadcast Notice Board
            </h3>
            <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5">
              Post instant updates visible on all student & parent mobile portals
            </p>
          </div>
        </div>

        <div className="flex gap-2.5 items-end">
          <div className="flex-1">
            <textarea
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 p-3 text-xs font-semibold text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-hidden resize-none h-18"
              placeholder="Type announcement or emergency alert text here..."
              value={newAnnouncement}
              onChange={(e) => setNewAnnouncement(e.target.value)}
              id="admin-dashboard-announcement-input"
            />
          </div>
          <button
            onClick={handleAddAnnouncement}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 shadow-md shadow-blue-500/10 cursor-pointer h-18 flex flex-col items-center justify-center gap-1 shrink-0"
          >
            <Bell className="w-4 h-4" />
            <span>Send Alert</span>
          </button>
        </div>

        {announcements.length > 0 && (
          <div className="mt-4 border-t border-slate-100 dark:border-slate-800/80 pt-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2.5">Active Announcements ({announcements.length})</p>
            <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1">
              {announcements.map((ann) => (
                <div key={ann.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 leading-relaxed">{ann.text}</p>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-1 block tracking-wider">Posted on {ann.date}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteAnnouncement(ann.id)}
                    className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                    title="Delete announcement"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --- REDESIGNED PREMIUM POPUP MODAL --- */}
      {activePopupId && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md transition-opacity duration-300 animate-fadeIn" 
          id="tile-detail-modal"
          onClick={() => setActivePopupId(null)}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl z-10 flex flex-col gap-3.5 border border-slate-100 dark:border-slate-800 max-h-[88vh] overflow-hidden animate-scaleUpCenter transition-all"
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl shrink-0">
                  {getPopupMeta().icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 truncate">
                    {getPopupMeta().title}
                  </h2>
                  <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider truncate">
                    {getPopupMeta().subtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActivePopupId(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full transition-colors cursor-pointer shrink-0 ml-2"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Searchbar inside popup (Sticky) */}
            {(activePopupId === "attendance" || activePopupId === "students" || activePopupId === "pending" || activePopupId === "overdue") && (
              <div className="relative shrink-0 sticky top-0 z-20 bg-white dark:bg-slate-900 pt-1 pb-1">
                <Search className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search students or classes..."
                  value={popupSearch}
                  onChange={(e) => setPopupSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}

            {/* Modal Content Scroll Viewport */}
            <div className="overflow-y-auto flex-1 pr-1 flex flex-col gap-3 min-h-[220px]">
              
              {/* POPUP 1: Today's Attendance Checklist */}
              {activePopupId === "attendance" && (
                <div className="flex flex-col gap-3.5">
                  {/* Dynamic Date & Summary Metrics Banner */}
                  <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between text-xs font-black text-slate-800 dark:text-slate-200">
                      <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                        <Calendar className="w-4 h-4" />
                        {getTodayDisplayDate()}
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-900/30 p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">Present</span>
                        <span className="text-base font-black text-emerald-700 dark:text-emerald-300">{stats.attendancePresentCount}</span>
                      </div>
                      <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200/50 dark:border-rose-900/30 p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] font-black uppercase text-rose-600 dark:text-rose-400">Absent</span>
                        <span className="text-base font-black text-rose-700 dark:text-rose-300">{stats.attendanceAbsentCount}</span>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200/50 dark:border-amber-900/30 p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400">Not Marked</span>
                        <span className="text-base font-black text-amber-700 dark:text-amber-300">{stats.attendanceNotMarkedCount}</span>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200/50 dark:border-blue-900/30 p-2 rounded-xl flex flex-col">
                        <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">Total</span>
                        <span className="text-base font-black text-blue-700 dark:text-blue-300">{stats.totalEnrolled}</span>
                      </div>
                    </div>
                  </div>

                  {/* Class-wise Collapsible Accordion Sections */}
                  <div className="flex flex-col gap-2.5">
                    {groupedStudentsByClass.length > 0 ? (
                      groupedStudentsByClass.map(({ className, students: classStudents }, classIdx) => {
                        const isExpanded = popupSearch.trim() !== "" || (expandedClasses[className] ?? (classIdx === 0));

                        return (
                          <div 
                            key={className}
                            className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 transition-all shadow-2xs"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedClasses(prev => ({
                                  ...prev,
                                  [className]: !isExpanded
                                }));
                              }}
                              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950/70 hover:bg-slate-100 dark:hover:bg-slate-850 flex items-center justify-between transition-colors cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                                  {className}
                                </span>
                                <span className="text-[10px] font-extrabold text-slate-500 dark:text-slate-400 bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                  {classStudents.length}
                                </span>
                              </div>
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {isExpanded && (
                              <div className="p-2.5 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20">
                                {classStudents.map(s => {
                                  const att = s.attendance?.[todayIsoKey];
                                  return (
                                    <div 
                                      key={s.id}
                                      className="p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2 shadow-2xs"
                                    >
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{s.name}</span>
                                        <span className="text-[10px] font-semibold text-slate-400 truncate">
                                          {s.enrolledSubjects && s.enrolledSubjects.length > 0 ? s.enrolledSubjects.join(", ") : "All Subjects"}
                                        </span>
                                      </div>

                                      {/* Present/Absent/NA Toggle Buttons */}
                                      <div className="flex gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => onToggleAttendance(s.id, todayIsoKey, true)}
                                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all cursor-pointer ${
                                            att === true 
                                              ? "bg-emerald-600 text-white shadow-xs scale-102" 
                                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:text-emerald-600"
                                          }`}
                                        >
                                          Present
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onToggleAttendance(s.id, todayIsoKey, false)}
                                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all cursor-pointer ${
                                            att === false 
                                              ? "bg-rose-600 text-white shadow-xs scale-102" 
                                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600"
                                          }`}
                                        >
                                          Absent
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onToggleAttendance(s.id, todayIsoKey, "na")}
                                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all cursor-pointer ${
                                            att === "na" 
                                              ? "bg-slate-500 text-white shadow-xs scale-102" 
                                              : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                                          }`}
                                        >
                                          N/A
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-slate-400 text-xs font-semibold">No students matching search</div>
                    )}
                  </div>
                </div>
              )}

              {/* POPUP 2: Total Students (Organized Class-wise) */}
              {activePopupId === "students" && (
                <div className="flex flex-col gap-2.5">
                  {groupedStudentsByClass.length > 0 ? (
                    groupedStudentsByClass.map(({ className, students: classStudents }, classIdx) => {
                      const isExpanded = popupSearch.trim() !== "" || (expandedClasses[className] ?? (classIdx === 0));

                      return (
                        <div 
                          key={className}
                          className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 transition-all shadow-2xs"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedClasses(prev => ({
                                ...prev,
                                [className]: !isExpanded
                              }));
                            }}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950/70 hover:bg-slate-100 dark:hover:bg-slate-850 flex items-center justify-between transition-colors cursor-pointer text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                                {className}
                              </span>
                              <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
                                {classStudents.length}
                              </span>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </button>

                          {isExpanded && (
                            <div className="p-2.5 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/20">
                              {classStudents.map(s => (
                                <div 
                                  key={s.id}
                                  onClick={() => {
                                    setActivePopupId(null);
                                    onNavigateToStudentDetails(s.id);
                                  }}
                                  className="p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center justify-between hover:border-blue-400/50 cursor-pointer transition-all hover:bg-slate-50 dark:hover:bg-slate-850"
                                >
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{s.name}</span>
                                    <span className="text-[10px] text-slate-400 truncate">
                                      Subjects: {s.enrolledSubjects?.join(", ") || "All"}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full shrink-0">
                                    Fee: ₹{s.monthlyFee}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-slate-400 text-xs font-semibold">No students matching search</div>
                  )}
                </div>
              )}

              {/* POPUP 3 & 4: Fees Pending / Overdue Amount */}
              {(activePopupId === "pending" || activePopupId === "overdue") && (
                <div className="flex flex-col gap-2.5">
                  {pendingStudentsList.length > 0 ? (
                    pendingStudentsList.map(s => {
                      const overdueMonths = getUnpaidOverdueMonths(s);
                      const totalDue = overdueMonths.length * s.monthlyFee;
                      return (
                        <div 
                          key={s.id}
                          className="p-3.5 bg-rose-50/30 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-2xl flex items-center justify-between gap-3"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{s.name} ({normalizeClassName(s.classGrade)})</span>
                            <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold mt-0.5">Overdue: {overdueMonths.join(", ")}</span>
                            <span className="text-[9px] text-slate-400 mt-0.5">Contact: {s.phone || "N/A"}</span>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className="text-xs font-black text-rose-600 dark:text-rose-400">₹{totalDue}</span>
                            <button
                              onClick={() => {
                                setActivePopupId(null);
                                onNavigateToStudentDetails(s.id);
                              }}
                              className="text-[9px] font-black uppercase text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                            >
                              Open Ledger
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-xs font-semibold">No pending fee payments.</div>
                  )}
                </div>
              )}

              {/* POPUP 5: Total Revenue Breakdown */}
              {activePopupId === "revenue" && (
                <div className="flex flex-col gap-3">
                  <span className="text-[10px] font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    Monthly Collection & Dues Sheet (March 2026 - March 2027)
                  </span>
                  
                  {[
                    "March 2026", "April 2026", "May 2026", "June 2026", 
                    "July 2026", "August 2026", "September 2026", "October 2026", 
                    "November 2026", "December 2026", "January 2027", "February 2027", "March 2027"
                  ].map(month => {
                    let monthCollection = 0;
                    let monthDues = 0;

                    const [mName, yStr] = month.split(" ");
                    const monthNames = [
                      "January", "February", "March", "April", "May", "June", 
                      "July", "August", "September", "October", "November", "December"
                    ];
                    const mIdx = monthNames.indexOf(mName);
                    const year = parseInt(yStr) || 2026;

                    students.forEach(s => {
                      const regDate = s.registrationDate || "2026-06-01";
                      let regYear = 2026;
                      let regMonthIdx = 5;

                      if (regDate.includes("/")) {
                        const parts = regDate.split("/");
                        if (parts.length === 3) {
                          regYear = parseInt(parts[2]) || 2026;
                          regMonthIdx = (parseInt(parts[1]) || 6) - 1;
                        }
                      } else {
                        const parts = regDate.split("-");
                        if (parts.length === 3) {
                          regYear = parseInt(parts[0]) || 2026;
                          regMonthIdx = (parseInt(parts[1]) || 6) - 1;
                        }
                      }

                      const isBeforeRegistration = year < regYear || (year === regYear && mIdx < regMonthIdx);
                      if (!isBeforeRegistration) {
                        const status = getEvaluatedFeeStatus(s, month);
                        if (status === "PAID") {
                          monthCollection += s.monthlyFee;
                        } else if (status === "UNPAID") {
                          monthDues += s.monthlyFee;
                        }
                      }
                    });

                    if (monthCollection === 0 && monthDues === 0) return null;

                    return (
                      <div 
                        key={month}
                        className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl flex items-center justify-between"
                      >
                        <span className="text-xs font-black text-slate-800 dark:text-slate-100">{month}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            Collection: ₹{monthCollection.toLocaleString("en-IN")}
                          </span>
                          <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                            Dues: ₹{monthDues.toLocaleString("en-IN")}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100/30 rounded-xl text-center">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Total Collection</span>
                      <h3 className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">₹{stats.totalRevenue.toLocaleString("en-IN")}</h3>
                    </div>
                    <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/30 rounded-xl text-center">
                      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Total Dues</span>
                      <h3 className="text-lg font-black text-rose-600 dark:text-rose-400 mt-0.5">₹{stats.remainingDue.toLocaleString("en-IN")}</h3>
                    </div>
                  </div>
                </div>
              )}

              {/* POPUP 6: Monthly Collection Tracker */}
              {activePopupId === "monthly_collection" && (
                <div className="flex flex-col gap-3.5">
                  <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col gap-3">
                    <div className="flex justify-between items-center text-xs font-extrabold text-slate-800 dark:text-slate-100">
                      <span>Term Target: ₹{stats.totalTarget.toLocaleString("en-IN")}</span>
                      <span className="text-blue-600 dark:text-blue-400">{stats.collectionPercentage}% Achieved</span>
                    </div>

                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-500"
                        style={{ width: `${stats.collectionPercentage}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 text-center text-xs font-bold">
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/30 rounded-xl text-emerald-700 dark:text-emerald-300">
                        Collected: ₹{stats.totalCollected.toLocaleString("en-IN")}
                      </div>
                      <div className="p-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 rounded-xl text-rose-700 dark:text-rose-300">
                        Overdue: ₹{stats.remainingDue.toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Current Month Status</span>
                    {students.map(s => {
                      const currentMonthName = `${new Date().toLocaleString("en-US", { month: "long" })} ${new Date().getFullYear()}`;
                      const status = getEvaluatedFeeStatus(s, currentMonthName);
                      const isPaid = status === "PAID";
                      const isUnpaid = status === "UNPAID";
                      return (
                        <div 
                          key={s.id}
                          className="p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center justify-between"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-slate-800 dark:text-slate-200">{s.name}</span>
                            <span className="text-[10px] text-slate-400">{normalizeClassName(s.classGrade)} • Fee: ₹{s.monthlyFee}</span>
                          </div>
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${
                            isPaid 
                              ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400" 
                              : isUnpaid
                              ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          }`}>
                            {isPaid ? "Paid" : isUnpaid ? "Unpaid" : "N/A"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* Modal Actions Footer */}
            <div className="sticky bottom-0 z-20 bg-white dark:bg-slate-900 pt-3 border-t border-slate-100 dark:border-slate-800 mt-1 flex gap-2 justify-end shrink-0">
              <button
                type="button"
                onClick={() => setActivePopupId(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Close Summary
              </button>
              <button
                type="button"
                onClick={() => {
                  setActivePopupId(null);
                  onNavigateToStudents();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Manage Students Tab
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Stats Card Wrapper with elegant sizing and touch feedback
interface CardItem {
  id: string;
  title: string;
  value: string | number;
  subtext: string;
  icon: React.ReactNode;
  theme: "blue" | "rose" | "indigo" | "amber" | "emerald";
  onClick?: () => void;
}

const DashboardCardWrapper: React.FC<{ card: CardItem }> = ({ card }) => {
  const themeClasses = {
    blue: "bg-gradient-to-br from-blue-600 to-sky-500 text-white border-blue-500/15 shadow-md",
    rose: "bg-gradient-to-br from-red-600 to-rose-500 text-white border-red-500/15 shadow-md",
    indigo: "bg-gradient-to-br from-slate-100 to-white dark:from-slate-900 dark:to-slate-800 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-sm",
    amber: "bg-gradient-to-br from-amber-500 to-yellow-400 text-slate-900 border-yellow-500/15 shadow-md",
    emerald: "bg-gradient-to-br from-emerald-600 to-teal-500 text-white border-emerald-500/15 shadow-md",
  };

  return (
    <div
      onClick={card.onClick}
      className={`relative p-4 sm:p-5 rounded-2xl border shadow-sm transition-all duration-300 flex flex-col justify-between cursor-pointer select-none group overflow-hidden h-full min-h-[120px] ${
        themeClasses[card.theme]
      } hover:scale-[1.015] hover:shadow-md`}
    >
      {/* Small top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-1 transition-opacity opacity-0 group-hover:opacity-100 ${
        card.theme === 'indigo' ? 'bg-blue-500' : 'bg-white/40'
      }`} />

      {/* Card Header */}
      <div className="flex justify-between items-start gap-1">
        <span className={`font-extrabold uppercase tracking-widest text-[10px] sm:text-xs leading-tight text-wrap break-words ${
          card.theme === "indigo" ? "text-slate-400 dark:text-slate-500" : card.theme === "amber" ? "text-amber-950/80" : "text-blue-50/90"
        }`}>
          {card.title}
        </span>
        <div className={`p-1.5 sm:p-2 rounded-xl shrink-0 ${
          card.theme === "indigo" ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200" : "bg-white/15 text-white"
        }`}>
          {card.icon}
        </div>
      </div>

      {/* Card Body */}
      <div className="mt-2.5">
        <span className="font-black tracking-tight leading-none text-xl sm:text-3xl text-wrap break-all">
          {card.value}
        </span>
        <p className={`font-extrabold uppercase tracking-wider mt-1.5 flex items-center gap-1 text-[9px] sm:text-[10px] leading-tight text-wrap break-words ${
          card.theme === "indigo" ? "text-blue-600 dark:text-blue-400" : card.theme === "amber" ? "text-amber-950" : "text-white/80"
        }`}>
          <span className="text-wrap break-words">{card.subtext}</span>
          <ArrowRight className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
        </p>
      </div>
    </div>
  );
};
