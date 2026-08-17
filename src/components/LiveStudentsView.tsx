import React, { useState, useEffect, useMemo } from "react";
import { Search, Radio, Clock, Users, Filter, Sparkles, RefreshCw, CheckCircle2, Circle } from "lucide-react";
import { Student } from "../types";
import StudentAvatar from "./StudentAvatar";

interface LiveStudentsViewProps {
  students: Student[];
  onRefresh?: () => void;
}

// 2 minutes (120,000 ms) threshold to consider a student online
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

export function isStudentOnline(student: Student, thresholdMs = ONLINE_THRESHOLD_MS): boolean {
  if (!student.lastActiveAt) return false;
  const time = new Date(student.lastActiveAt).getTime();
  if (isNaN(time)) return false;
  return Date.now() - time <= thresholdMs;
}

export function formatLastActive(lastActiveAt?: string, isOnline?: boolean): string {
  if (!lastActiveAt) return "Offline";
  const time = new Date(lastActiveAt).getTime();
  if (isNaN(time)) return "Offline";

  const diffMs = Date.now() - time;
  if (diffMs < 0) return "Just now";

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (isOnline) {
    if (diffSeconds < 30) return "Just now";
    if (diffMinutes < 1) return "Just now";
    return `${diffMinutes} min ago`;
  }

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return new Date(lastActiveAt).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeClassGrade(classGrade?: string): string {
  if (!classGrade || !classGrade.trim()) return "Unassigned";
  const trimmed = classGrade.trim();
  if (/^class\s+/i.test(trimmed)) return trimmed;
  if (/^\d+$/.test(trimmed)) return `Class ${trimmed}`;
  return trimmed;
}

export default function LiveStudentsView({ students, onRefresh }: LiveStudentsViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClass, setSelectedClass] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "Online" | "Offline">("All");
  const [, setTick] = useState(0);

  // Re-render every 5 seconds to keep relative time formatting ("Just now", "2 min ago") fresh and accurate
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Extract unique sorted classes from existing student list
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.classGrade) {
        set.add(normalizeClassGrade(s.classGrade));
      }
    });
    const list = Array.from(set);
    list.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });
    return ["All", ...list];
  }, [students]);

  // Compute online vs total statistics
  const { onlineCount, offlineCount, totalCount } = useMemo(() => {
    let online = 0;
    let offline = 0;
    students.forEach((s) => {
      if (isStudentOnline(s)) {
        online++;
      } else {
        offline++;
      }
    });
    return {
      onlineCount: online,
      offlineCount: offline,
      totalCount: students.length,
    };
  }, [students]);

  // Filter student list by search, class, and status
  const filteredStudents = useMemo(() => {
    return students
      .filter((student) => {
        // Search by student name
        if (searchTerm.trim()) {
          const query = searchTerm.toLowerCase().trim();
          if (!student.name.toLowerCase().includes(query)) {
            return false;
          }
        }

        // Filter by class
        if (selectedClass !== "All") {
          const normClass = normalizeClassGrade(student.classGrade);
          if (normClass !== selectedClass) {
            return false;
          }
        }

        // Filter by status tab
        const online = isStudentOnline(student);
        if (statusFilter === "Online" && !online) return false;
        if (statusFilter === "Offline" && online) return false;

        return true;
      })
      .sort((a, b) => {
        // Sort online students first, then by last active timestamp descending, then name
        const aOnline = isStudentOnline(a);
        const bOnline = isStudentOnline(b);
        if (aOnline !== bOnline) {
          return aOnline ? -1 : 1;
        }

        const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        if (aTime !== bTime) {
          return bTime - aTime;
        }

        return a.name.localeCompare(b.name);
      });
  }, [students, searchTerm, selectedClass, statusFilter]);

  return (
    <div className="space-y-5 animate-fade-in" id="live-students-container">
      {/* Top Banner Card */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
        {/* Subtle background graphics */}
        <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -left-6 -top-6 w-28 h-28 bg-emerald-400/20 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-80" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-300" />
              </span>
              <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                🟢 Live Students
              </h1>
            </div>
            <p className="text-xs text-emerald-100 font-medium">
              Real-time monitoring of students currently active in the app
            </p>
          </div>

          {/* Top Total Online Counter Highlight */}
          <div className="flex items-center gap-2 bg-white/15 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/20 self-start sm:self-auto shrink-0 shadow-inner">
            <Radio className="w-5 h-5 text-emerald-200 animate-pulse" />
            <div>
              <div className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-100">
                Total Online
              </div>
              <div className="text-lg font-black text-white leading-tight">
                {onlineCount} <span className="text-xs font-semibold text-emerald-200">/ {totalCount} Students</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Controls Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
        {/* Search & Class Dropdown Row */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by student name..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter by Class Selector */}
          <div className="relative sm:w-48 shrink-0">
            <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 cursor-pointer appearance-none transition-all"
            >
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls === "All" ? "All Classes" : cls}
                </option>
              ))}
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs">
              ▼
            </span>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800/60">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
            <button
              onClick={() => setStatusFilter("All")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === "All"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setStatusFilter("Online")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                statusFilter === "Online"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-900/60"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Online ({onlineCount})
            </button>
            <button
              onClick={() => setStatusFilter("Offline")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === "Offline"
                  ? "bg-slate-700 text-white dark:bg-slate-700 dark:text-slate-200 shadow-xs"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              Offline ({offlineCount})
            </button>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              title="Refresh Live Data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Live Students Grid / List */}
      <div className="space-y-3">
        {filteredStudents.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200/80 dark:border-slate-800 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200">
                No students found
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                {searchTerm || selectedClass !== "All" || statusFilter !== "All"
                  ? "No students match your active filters or search term."
                  : "No students are currently registered in the database."}
              </p>
            </div>
            {(searchTerm || selectedClass !== "All" || statusFilter !== "All") && (
              <button
                onClick={() => {
                  setSearchTerm("");
                  setSelectedClass("All");
                  setStatusFilter("All");
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredStudents.map((student) => {
              const online = isStudentOnline(student);
              const lastActiveLabel = formatLastActive(student.lastActiveAt, online);
              const classLabel = normalizeClassGrade(student.classGrade);

              return (
                <div
                  key={student.id}
                  className={`bg-white dark:bg-slate-900 rounded-2xl p-4 border transition-all duration-200 flex items-center justify-between gap-3 shadow-xs ${
                    online
                      ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 hover:border-emerald-300 dark:hover:border-emerald-800"
                      : "border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  {/* Left: Profile Picture with Badge + Info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <StudentAvatar
                        student={student}
                        className="w-12 h-12 rounded-xl text-base shadow-xs"
                      />
                      {/* Online / Offline Status Badge over Avatar */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-900 ${
                          online
                            ? "bg-emerald-500 shadow-xs"
                            : "bg-slate-300 dark:bg-slate-600"
                        }`}
                        title={online ? "Online" : "Offline"}
                      />
                    </div>

                    <div className="min-w-0">
                      {/* Student Name */}
                      <h4 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 truncate leading-snug">
                        {student.name}
                      </h4>

                      {/* Class */}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {classLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status Indicator & Last Active */}
                  <div className="flex flex-col items-end shrink-0 text-right">
                    {/* Online Indicator Badge */}
                    {online ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold text-emerald-700 bg-emerald-100 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60 shadow-xs">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        🟢 Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Offline
                      </span>
                    )}

                    {/* Last Active */}
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1.5">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{lastActiveLabel}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
