import React, { useState, useMemo, useEffect } from "react";
import { Search, X, Check, CheckSquare, Square, Filter, Users } from "lucide-react";
import { Student } from "../types";

interface SelectStudentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (selectedStudentIds: string[]) => void;
  initialSelectedIds?: string[];
  students: Student[];
  title?: string;
}

export default function SelectStudentsModal({
  isOpen,
  onClose,
  onSave,
  initialSelectedIds = [],
  students,
  title = "Select Students"
}: SelectStudentsModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>("All");

  // Re-initialize selectedIds when modal opens or initialSelectedIds changes
  useEffect(() => {
    if (isOpen) {
      if (initialSelectedIds && initialSelectedIds.length > 0) {
        setSelectedIds([...initialSelectedIds]);
      } else {
        // Default to all active student IDs if none provided
        setSelectedIds(students.map((s) => s.id));
      }
      setSearchQuery("");
      setSelectedClassFilter("All");
    }
  }, [isOpen, initialSelectedIds, students]);

  // Extract list of unique classes present in students list
  const availableClasses = useMemo(() => {
    const classesSet = new Set<string>();
    students.forEach((s) => {
      if (s.classGrade) classesSet.add(s.classGrade);
    });
    return Array.from(classesSet).sort();
  }, [students]);

  // Filter students by Search Query and Class Filter
  const filteredStudents = useMemo(() => {
    let result = students;

    if (selectedClassFilter !== "All") {
      result = result.filter((s) => s.classGrade === selectedClassFilter);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((s) => {
        const matchName = s.name.toLowerCase().includes(query);
        const matchClass = (s.classGrade || "").toLowerCase().includes(query);
        const matchPhone = (s.phone || "").includes(query);
        return matchName || matchClass || matchPhone;
      });
    }

    return result;
  }, [students, searchQuery, selectedClassFilter]);

  if (!isOpen) return null;

  const handleToggleStudent = (studentId: string) => {
    setSelectedIds((prev) =>
      prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId]
    );
  };

  const handleSelectAll = () => {
    // Select all currently filtered students without losing selections from hidden ones
    const filteredIds = filteredStudents.map((s) => s.id);
    const combined = Array.from(new Set([...selectedIds, ...filteredIds]));
    setSelectedIds(combined);
  };

  const handleClearAll = () => {
    // Clear selections for currently filtered students, or clear all if no filter
    if (searchQuery || selectedClassFilter !== "All") {
      const filteredIdsSet = new Set(filteredStudents.map((s) => s.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredIdsSet.has(id)));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectClassBatch = (classGrade: string) => {
    const classStudentIds = students
      .filter((s) => s.classGrade === classGrade)
      .map((s) => s.id);
    const allSelected = classStudentIds.every((id) => selectedIds.includes(id));

    if (allSelected) {
      // Deselect entire class
      const classSet = new Set(classStudentIds);
      setSelectedIds((prev) => prev.filter((id) => !classSet.has(id)));
    } else {
      // Select entire class
      const combined = Array.from(new Set([...selectedIds, ...classStudentIds]));
      setSelectedIds(combined);
    }
  };

  const handleSave = () => {
    onSave(selectedIds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-850 dark:text-slate-100 text-sm sm:text-base">
                {title}
              </h3>
              <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                {selectedIds.length} {selectedIds.length === 1 ? "Student" : "Students"} Selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters and Controls */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 shrink-0 bg-white dark:bg-slate-900">
          
          {/* Search Input */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search Student by name, class, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Action Bar: Select All, Clear All, and Class Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                className="px-2.5 py-1 text-[11px] font-bold bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 border border-blue-150 dark:border-blue-900/40 rounded-lg transition cursor-pointer"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg transition cursor-pointer"
              >
                Clear All
              </button>
            </div>

            {/* Filter by Class Pills */}
            {availableClasses.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
                  Class:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedClassFilter("All")}
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition shrink-0 cursor-pointer ${
                    selectedClassFilter === "All"
                      ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  All
                </button>
                {availableClasses.map((cls) => {
                  const isFiltered = selectedClassFilter === cls;
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setSelectedClassFilter(cls)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition shrink-0 cursor-pointer ${
                        isFiltered
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      {cls}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Select Class Batch Buttons */}
          {availableClasses.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
                Select by Class:
              </span>
              {availableClasses.map((cls) => {
                const classStudentIds = students
                  .filter((s) => s.classGrade === cls)
                  .map((s) => s.id);
                const countSelected = classStudentIds.filter((id) => selectedIds.includes(id)).length;
                const isAllInClassSelected = classStudentIds.length > 0 && countSelected === classStudentIds.length;

                return (
                  <button
                    key={`batch-${cls}`}
                    type="button"
                    onClick={() => handleSelectClassBatch(cls)}
                    className={`px-2 py-1 text-[10px] font-bold rounded-lg border transition shrink-0 flex items-center gap-1 cursor-pointer ${
                      isAllInClassSelected
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                        : countSelected > 0
                        ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                        : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                    }`}
                  >
                    <span>{cls}</span>
                    <span className="opacity-75">({countSelected}/{classStudentIds.length})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Student Checklist Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5 min-h-[220px] max-h-[380px]">
          {filteredStudents.length > 0 ? (
            filteredStudents.map((student) => {
              const isChecked = selectedIds.includes(student.id);

              return (
                <label
                  key={student.id}
                  onClick={() => handleToggleStudent(student.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition cursor-pointer ${
                    isChecked
                      ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/80"
                      : "bg-white dark:bg-slate-900 border-slate-150 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-850"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 text-blue-600 dark:text-blue-400">
                      {isChecked ? (
                        <CheckSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Square className="w-5 h-5 text-slate-350 dark:text-slate-600" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        {student.name}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {student.classGrade && (
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md">
                            {student.classGrade}
                          </span>
                        )}
                        {student.phone && (
                          <span className="text-[10px] text-slate-400">
                            {student.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0 ${
                      isChecked
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isChecked ? "Allowed" : "Restricted"}
                  </span>
                </label>
              );
            })
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400">
              <Users className="w-8 h-8 stroke-[1.2] mb-2 text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                No active students match your filter.
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Try searching with a different term or clearing filters.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between shrink-0 gap-3">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {selectedIds.length} of {students.length} Selected
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Save Permissions</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
