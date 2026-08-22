import React, { useState, useMemo, useEffect } from "react";
import { Search, Edit2, Trash2, Plus, AlertCircle, Phone, Calendar, ShieldCheck, CheckCircle2, PauseCircle, XCircle, X, Loader2 } from "lucide-react";
import { Student, StudentServiceStatus } from "../types";
import { getMonthsUpToCurrent } from "../utils/monthHelper";
import StudentAvatar from "./StudentAvatar";
import { updateStudentServiceStatus, fetchStudentServiceStatus } from "../lib/firestoreService";

interface StudentListProps {
  students: Student[];
  filter?: "All" | "Pending";
  onFilterChange?: (filter: "All" | "Pending") => void;
  onSelectStudent: (studentId: string) => void;
  onEditStudent: (student: Student) => void;
  onDeleteStudent: (studentId: string) => void;
  onAddStudent: () => void;
  onUpdateServiceStatus?: (studentId: string, status: StudentServiceStatus) => void;
}

// Utility to find overdue months
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

import {
  isCurrentOrFutureMonth,
  hasAttendanceInMonth as hasAttendanceInMonthCentral,
  getPendingFeeMonths
} from "../utils/feeBillingHelper";

export function isFutureMonth(monthYearStr: string, currentDateTime: Date = new Date()): boolean {
  return isCurrentOrFutureMonth(monthYearStr, currentDateTime);
}

export function hasAttendedInMonth(student: Student, monthYearStr: string): boolean {
  return hasAttendanceInMonthCentral(student, monthYearStr);
}

export function getUnpaidOverdueMonths(student: Student, currentDateTime: Date = new Date()): string[] {
  return getPendingFeeMonths(student, currentDateTime);
}

export default function StudentList({
  students,
  filter = "All",
  onFilterChange,
  onSelectStudent,
  onEditStudent,
  onDeleteStudent,
  onAddStudent,
  onUpdateServiceStatus
}: StudentListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("All");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  // Manage Services Modal State
  const [selectedServiceStudent, setSelectedServiceStudent] = useState<Student | null>(null);
  const [currentStatus, setCurrentStatus] = useState<StudentServiceStatus>("active");
  const [selectedStatus, setSelectedStatus] = useState<StudentServiceStatus>("active");
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(false);
  const [isSavingStatus, setIsSavingStatus] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handleOpenServiceModal = async (student: Student) => {
    const raw = student.serviceStatus || student.service_status || "active";
    const initialStatus: StudentServiceStatus = raw === "paused" || raw === "ended" ? raw : "active";
    
    setSelectedServiceStudent(student);
    setCurrentStatus(initialStatus);
    setSelectedStatus(initialStatus);
    setSaveMessage(null);
    setIsLoadingStatus(true);

    if (process.env.NODE_ENV !== "production") {
      console.log(`[StudentServiceStatus] Dialog opened for student ${student.id} (${student.name}). Initial status:`, initialStatus);
    }

    try {
      const fetched = await fetchStudentServiceStatus(student.id);
      if (process.env.NODE_ENV !== "production") {
        console.log(`[StudentServiceStatus] Fetched status from database for ${student.id}:`, fetched);
      }
      if (fetched) {
        setCurrentStatus(fetched);
        setSelectedStatus(fetched);
      }
    } catch (err) {
      console.warn(`[StudentServiceStatus] Error fetching status for ${student.id}:`, err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const handleSelectStatus = (newStatus: StudentServiceStatus) => {
    setSelectedStatus(newStatus);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[StudentServiceStatus] Selected status changed to:`, newStatus);
    }
  };

  const handleSaveStatus = async () => {
    if (!selectedServiceStudent) return;
    setIsSavingStatus(true);
    setSaveMessage(null);

    const targetId = selectedServiceStudent.id;
    const newStatus = selectedStatus;

    if (process.env.NODE_ENV !== "production") {
      console.log(`[StudentServiceStatus] Database update payload:`, { studentId: targetId, status: newStatus });
    }

    try {
      const success = await updateStudentServiceStatus(targetId, newStatus);
      if (success) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[StudentServiceStatus] Update success for ${targetId}. Refreshed status:`, newStatus);
        }
        setCurrentStatus(newStatus);
        setSelectedStatus(newStatus);
        const updated: Student = {
          ...selectedServiceStudent,
          serviceStatus: newStatus,
          service_status: newStatus
        };
        setSelectedServiceStudent(updated);

        if (onUpdateServiceStatus) {
          onUpdateServiceStatus(targetId, newStatus);
        }

        setSaveMessage(`Service status successfully saved as ${newStatus.toUpperCase()}`);
        setTimeout(() => {
          setSelectedServiceStudent(null);
        }, 500);
      } else {
        throw new Error("Update returned false");
      }
    } catch (err) {
      console.error("[StudentServiceStatus] Failed to save status:", err);
      setSaveMessage("Failed to update status in database. Please try again.");
    } finally {
      setIsSavingStatus(false);
    }
  };

  // Synchronize filter prop changes (e.g. navigation from Dashboard cards)
  useEffect(() => {
    if (filter) {
      setActiveTab(filter);
    }
  }, [filter]);

  // Compute dynamic class tabs based on current registered student body
  const tabsList = useMemo(() => {
    if (!students || !Array.isArray(students)) return ["All"];
    const classesSet = new Set<string>();
    
    students.forEach((s) => {
      if (s && s.classGrade && typeof s.classGrade === "string" && s.classGrade.trim()) {
        classesSet.add(s.classGrade.trim());
      }
    });

    const classes = Array.from(classesSet);
    
    // Sort classes (Class 1..12, then UPSC)
    classes.sort((a, b) => {
      const isAUpsc = /^upsc$/i.test(a.trim()) || /^class\s+upsc$/i.test(a.trim());
      const isBUpsc = /^upsc$/i.test(b.trim()) || /^class\s+upsc$/i.test(b.trim());
      if (isAUpsc && !isBUpsc) return 1;
      if (!isAUpsc && isBUpsc) return -1;
      const numA = parseInt((a || "").replace(/[^0-9]/g, "")) || 0;
      const numB = parseInt((b || "").replace(/[^0-9]/g, "")) || 0;
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });

    return ["All", ...classes];
  }, [students]);

  // Filter students by search bar query and active segment tab
  const filteredStudents = useMemo(() => {
    if (!students || !Array.isArray(students)) return [];

    return students.filter((student) => {
      if (!student) return false;

      const studentClass = (student.classGrade || "").toString().trim();
      const studentName = (student.name || "").toString().trim();
      const studentPhone = (student.phone || "").toString().trim();

      // Tab segregation logic
      if (activeTab !== "All" && studentClass !== activeTab) {
        return false;
      }
      
      // Search query filter
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;

      const termDigits = term.replace(/[^0-9]/g, "");
      const classDigits = studentClass.replace(/[^0-9]/g, "");

      const matchesClass = 
        studentClass.toLowerCase().includes(term) ||
        (termDigits.length > 0 && classDigits === termDigits) ||
        (termDigits.length > 0 && studentClass.toLowerCase().includes(`class ${termDigits}`)) ||
        (termDigits.length > 0 && studentClass.toLowerCase().includes(`grade ${termDigits}`));

      return (
        studentName.toLowerCase().includes(term) ||
        studentPhone.toLowerCase().includes(term) ||
        matchesClass
      );
    });
  }, [students, searchTerm, activeTab]);

  // Helper to extract name initials
  const getInitials = (name: string) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    if (onFilterChange) {
      onFilterChange("All");
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-24 relative min-h-[500px] animate-fadeIn" id="students-view">
      {/* Title */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100 mt-0.5" id="students-title">
          STUDENT DIRECTORY
        </h1>
      </div>

      {/* Search Input */}
      <div className="relative" id="search-container">
        <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
          <Search className="w-4 h-4" />
        </span>
        <input
          type="text"
          placeholder="Search by name, phone, or class..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
          id="student-search-input"
        />
      </div>

      {/* Segmented Tabs (Horizontal Scroll on narrow devices) */}
      <div className="flex border-b border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none gap-1 mt-1 -mx-4 px-4 sm:mx-0 sm:px-0" id="class-tabs-container">
        {tabsList.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`py-2.5 px-4 text-xs font-extrabold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
              id={`tab-${tab.replace(" ", "-")}`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Student List Grid */}
      <div className="flex flex-col gap-3" id="student-list-container">
        {filteredStudents.length > 0 ? (
          filteredStudents.map((student) => {
            const initials = getInitials(student.name);
            const overdueMonths = getUnpaidOverdueMonths(student);
            const isPending = overdueMonths.length > 0;

            return (
              <div
                key={student.id}
                onClick={() => onSelectStudent(student.id)}
                className={`flex items-center justify-between p-4 bg-white dark:bg-slate-900 rounded-2xl border transition-all hover:scale-[1.01] hover:shadow-md cursor-pointer group ${
                  isPending 
                    ? "border-rose-100 dark:border-rose-950 bg-gradient-to-r from-white to-rose-50/10 dark:from-slate-900 dark:to-rose-950/5" 
                    : "border-slate-100 dark:border-slate-800"
                }`}
                id={`student-row-${student.id}`}
              >
                {/* Left side: Avatar & info */}
                <div className="flex items-center gap-3.5">
                  {/* Photo or initials fallback */}
                  <div className="relative shrink-0">
                    <StudentAvatar
                      student={student}
                      className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-slate-200 dark:border-slate-700/80 shadow-xs"
                      initialsClassName="text-base sm:text-lg font-black"
                      id={`student-avatar-${student.id}`}
                    />
                    {/* Tiny visual exclamation indicator if payment is overdue */}
                    {isPending && (
                      <span className="absolute -top-0.5 -right-0.5 bg-rose-600 text-white p-0.5 rounded-full border-2 border-white dark:border-slate-900 z-10 shadow-xs">
                        <AlertCircle className="w-3 h-3 stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Info details */}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm sm:text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {student.name}
                      </span>
                      {/* Service status indicator tag */}
                      {((student.serviceStatus || student.service_status) === "paused") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-extrabold uppercase tracking-wider">
                          🟡 Paused
                        </span>
                      )}
                      {((student.serviceStatus || student.service_status) === "ended") && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-extrabold uppercase tracking-wider">
                          🔴 Ended
                        </span>
                      )}
                      {((student.serviceStatus || student.service_status) === "active" || !(student.serviceStatus || student.service_status)) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-extrabold uppercase tracking-wider">
                          🟢 Active
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[10px] sm:text-xs font-semibold text-slate-400 dark:text-slate-500">
                      <span>{student.classGrade}</span>
                      <span>•</span>
                      <span>₹{student.monthlyFee}/mo</span>
                    </div>

                    {/* Pending billing banner warning */}
                    {isPending && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                        <Calendar className="w-3 h-3" />
                        <span>Pending: {overdueMonths.join(", ")}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: Action Buttons */}
                <div 
                  className="flex items-center gap-2" 
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Manage Services button */}
                  <button
                    onClick={() => handleOpenServiceModal(student)}
                    className="py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    id={`btn-manage-services-${student.id}`}
                    title="Manage Student Services"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="hidden sm:inline">Manage Services</span>
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => onEditStudent(student)}
                    className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 dark:bg-slate-800 dark:hover:bg-blue-950/30 dark:hover:text-blue-400 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                    id={`btn-edit-${student.id}`}
                    title="Edit Student"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete button with double-tap iframe-proof confirm state */}
                  {confirmDeleteId === student.id ? (
                    <div className="flex items-center gap-1.5 animate-fadeIn">
                      <button
                        onClick={() => {
                          onDeleteStudent(student.id);
                          setConfirmDeleteId(null);
                        }}
                        className="py-1.5 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-xs"
                        title="Confirm deletion"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-all cursor-pointer border border-slate-200 dark:border-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(student.id)}
                      className="p-2 bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/20 dark:hover:text-rose-400 rounded-xl transition-all border border-slate-100 dark:border-slate-800 cursor-pointer"
                      id={`btn-delete-${student.id}`}
                      title="Delete Student"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900/50" id="no-students-placeholder">
            <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No students found</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try adjusting your search query or filters.</p>
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        onClick={onAddStudent}
        className="fixed bottom-20 right-6 sm:bottom-24 w-12 h-12 sm:w-14 sm:h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-500/10 hover:scale-105 active:scale-95 transition-all cursor-pointer z-20"
        id="btn-add-student-fab"
        title="Add New Student"
      >
        <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3]" />
      </button>

      {/* Manage Services Modal Dialog */}
      {selectedServiceStudent && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn"
          onClick={() => setSelectedServiceStudent(null)}
          id="manage-services-modal-overlay"
        >
          <div 
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 dark:border-slate-800 relative space-y-5 animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
            id="manage-services-modal"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 rounded-2xl border border-blue-100 dark:border-blue-900/50">
                  <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                    Manage Student Services
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    {selectedServiceStudent.name} • {selectedServiceStudent.classGrade?.toUpperCase().includes("UPSC") ? "UPSC" : (selectedServiceStudent.classGrade?.startsWith("Class") ? selectedServiceStudent.classGrade : `Class ${selectedServiceStudent.classGrade}`)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedServiceStudent(null)}
                className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-all cursor-pointer"
                id="btn-close-service-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Save feedback banner */}
            {saveMessage && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{saveMessage}</span>
              </div>
            )}

            {/* Current Status Banner */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Current Status:</span>
              <span className={`font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1.5 ${
                currentStatus === "paused"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                  : currentStatus === "ended"
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-700"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
              }`}>
                {isLoadingStatus && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                {currentStatus === "paused" && "🟡 Paused"}
                {currentStatus === "ended" && "🔴 Ended"}
                {currentStatus === "active" && "🟢 Active"}
              </span>
            </div>

            {/* Service Action Options */}
            <div className="space-y-2.5">
              <label className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Select Service Status</label>
              
              {/* 🟢 Active */}
              <button
                disabled={isSavingStatus}
                onClick={() => handleSelectStatus("active")}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  selectedStatus === "active"
                    ? "bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
                }`}
                id="btn-status-active"
              >
                <span className="text-lg">🟢</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100">Active (Start Services)</span>
                    {selectedStatus === "active" && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Full access to study notes, practice tests, test scores, announcements, and all learning features.
                  </p>
                </div>
              </button>

              {/* 🟡 Paused */}
              <button
                disabled={isSavingStatus}
                onClick={() => handleSelectStatus("paused")}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  selectedStatus === "paused"
                    ? "bg-amber-50/60 dark:bg-amber-950/30 border-amber-500 ring-2 ring-amber-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300"
                }`}
                id="btn-status-paused"
              >
                <span className="text-lg">🟡</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100">Paused</span>
                    {selectedStatus === "paused" && (
                      <PauseCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Account remains valid with login & test scores history access, but notes and practice tests are blocked.
                  </p>
                </div>
              </button>

              {/* 🔴 Ended */}
              <button
                disabled={isSavingStatus}
                onClick={() => handleSelectStatus("ended")}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                  selectedStatus === "ended"
                    ? "bg-rose-50/60 dark:bg-rose-950/30 border-rose-500 ring-2 ring-rose-500/20"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300"
                }`}
                id="btn-status-ended"
              >
                <span className="text-lg">🔴</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-sm text-slate-800 dark:text-slate-100">Ended</span>
                    {selectedStatus === "ended" && (
                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Permanently stops services. Blocks all learning features. Preserves student account, attendance & payment history.
                  </p>
                </div>
              </button>
            </div>

            {/* Done Button */}
            <div className="pt-2">
              <button
                disabled={isSavingStatus}
                onClick={handleSaveStatus}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl font-bold text-sm transition-all cursor-pointer shadow-xs flex items-center justify-center gap-2"
                id="btn-done-service-modal"
              >
                {isSavingStatus ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving Status...</span>
                  </>
                ) : (
                  <span>Close & Save</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
