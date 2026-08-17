import React, { useState, useEffect, useRef } from "react";
import { X, Save, GraduationCap, Phone, CreditCard, User, BookOpen, Sparkles, HelpCircle, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Student } from "../types";

interface AddEditStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (studentData: Omit<Student, "id" | "notes" | "attendance" | "feeMonths">) => void;
  studentToEdit?: Student | null;
}

// Full categorized list of Core Academic Subjects matching requests
export const SUBJECT_CATEGORIES = [
  {
    name: "Languages",
    subjects: ["English", "Hindi", "Nepali"]
  },
  {
    name: "Select Subjects",
    subjects: [
      "Science",
      "Physics",
      "Chemistry",
      "Biology",
      "Mathematics",
      "Social Science",
      "History",
      "Geography",
      "Economics",
      "Political Science"
    ]
  },
  {
    name: "Competitive Exams",
    subjects: ["SSC", "UPSC", "Railways", "Banking (Competitive)", "Defence"]
  }
];

export default function AddEditStudentModal({
  isOpen,
  onClose,
  onSave,
  studentToEdit
}: AddEditStudentModalProps) {
  const getTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [name, setName] = useState("");
  const [classNum, setClassNum] = useState<number>(9); // Slider range 1-12
  const [phoneVal, setPhoneVal] = useState("");
  const [parentPhoneVal, setParentPhoneVal] = useState("");
  const [monthlyFee, setMonthlyFee] = useState(1000);
  const [feePaidThisMonth, setFeePaidThisMonth] = useState(false);
  const [registrationDate, setRegistrationDate] = useState(getTodayString());
  const [enrolledSubjects, setEnrolledSubjects] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [phoneError, setPhoneError] = useState(false);
  const [parentPhoneError, setParentPhoneError] = useState(false);
  const [emailVal, setEmailVal] = useState("");
  const [passwordVal, setPasswordVal] = useState("");

  const cleanTo10Digits = (val: string) => {
    if (!val) return "";
    let d = val.replace(/\D/g, "");
    if (d.length === 12 && d.startsWith("91")) {
      d = d.substring(2);
    }
    return d.slice(-10);
  };

  // Sub-tabs for categorizing the selection to prevent giant visual scroll
  const [activeSubjectTab, setActiveSubjectTab] = useState("Languages");

  // Load values on edit
  useEffect(() => {
    if (studentToEdit) {
      setName(studentToEdit.name);
      const parsedNum = parseInt(studentToEdit.classGrade.replace(/[^0-9]/g, "")) || 9;
      setClassNum(parsedNum);
      setPhoneVal(cleanTo10Digits(studentToEdit.phone));
      setParentPhoneVal(cleanTo10Digits(studentToEdit.parentPhone));
      setMonthlyFee(studentToEdit.monthlyFee);
      setFeePaidThisMonth(studentToEdit.feePaidThisMonth);
      setRegistrationDate(studentToEdit.registrationDate || getTodayString());
      setEnrolledSubjects(studentToEdit.enrolledSubjects);
      setEmailVal(studentToEdit.email || "");
      setPasswordVal(studentToEdit.password || "");
    } else {
      setName("");
      setClassNum(9);
      setPhoneVal("");
      setParentPhoneVal(""); // Optional, start completely blank
      setMonthlyFee(1000);
      setFeePaidThisMonth(false);
      setRegistrationDate(getTodayString());
      setEnrolledSubjects([]); // Start clean with blank empty
      setEmailVal("");
      setPasswordVal("");
    }
    setError("");
    setPhoneError(false);
    setParentPhoneError(false);
  }, [studentToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubjectToggle = (subject: string) => {
    if (enrolledSubjects.includes(subject)) {
      setEnrolledSubjects(enrolledSubjects.filter(s => s !== subject));
    } else {
      setEnrolledSubjects([...enrolledSubjects, subject]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPhoneError(false);
    setParentPhoneError(false);

    if (!name.trim()) {
      setError("Student name is required");
      return;
    }
    
    const isStudentPhoneValid = phoneVal.length === 10;
    
    const hasParentPhone = parentPhoneVal.trim().length > 0;
    const isParentPhoneValid = !hasParentPhone || parentPhoneVal.length === 10;

    if (!isStudentPhoneValid) {
      setPhoneError(true);
    }
    if (!isParentPhoneValid) {
      setParentPhoneError(true);
    }

    if (!isStudentPhoneValid || !isParentPhoneValid) {
      setError("Please fix the incorrect contact number formats (marked in red). Contact number must be exactly 10 digits.");
      return;
    }

    if (!registrationDate) {
      setError("Registration date is required");
      return;
    }

    if (!emailVal.trim()) {
      setError("Registered email is required.");
      return;
    }

    if (!passwordVal) {
      setError("Login password is required.");
      return;
    }

    onSave({
      name: name.trim(),
      classGrade: `Class ${classNum}`,
      phone: `+91${phoneVal}`,
      parentPhone: hasParentPhone ? `+91${parentPhoneVal}` : "",
      monthlyFee: Number(monthlyFee) || 0,
      feePaidThisMonth,
      registrationDate,
      enrolledSubjects,
      email: emailVal.trim().toLowerCase(),
      password: passwordVal
    });
    onClose();
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter") {
      const target = e.target as HTMLElement;
      // Don't intercept Enter on buttons, submit inputs, or custom subject input
      if (
        target.tagName === "BUTTON" || 
        target.getAttribute("type") === "submit" ||
        target.id === "custom-subject-input"
      ) {
        return;
      }
      
      e.preventDefault();
      const form = e.currentTarget;
      const focusableElements = Array.from(
        form.querySelectorAll('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[type="submit"]')
      ) as HTMLElement[];
      
      const index = focusableElements.indexOf(target);
      if (index > -1 && index < focusableElements.length - 1) {
        focusableElements[index + 1].focus();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 overflow-hidden overflow-y-auto" id="add-edit-student-modal">
      <div className="fixed inset-0" onClick={onClose} />

      <form 
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 shadow-2xl z-10 flex flex-col gap-4 border border-slate-100 dark:border-slate-800 max-h-[90vh] overflow-y-auto overflow-x-hidden my-auto max-w-full"
      >
        {/* Header */}
        <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
              {studentToEdit ? "Edit Student Record" : "Register New Student"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <p className="p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30 rounded-xl text-xs font-bold leading-relaxed">
            {error}
          </p>
        )}

        {/* Input fields */}
        <div className="flex flex-col gap-3.5">
          {/* Field: Full Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-500" />
              Full Name
            </label>
            <input
              type="text"
              placeholder="e.g. Aanya Patel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
              required
            />
          </div>

          {/* Row: Class (SLIDER with discrete dots) & Tuition Fee */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Field: Class (Slider from 1 to 12 with markers/dots on steps 2, 3, ..., 11) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5 justify-between">
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-blue-500" />
                  Class / Grade
                </span>
                <span className="bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  Class {classNum}
                </span>
              </label>
              
              <div className="flex flex-col gap-2 px-3.5 py-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
                {/* Custom dot slider container */}
                <div className="relative flex items-center mt-1">
                  <input
                    type="range"
                    min="1"
                    max="12"
                    value={classNum}
                    onChange={(e) => setClassNum(Number(e.target.value))}
                    className="w-full accent-blue-600 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg cursor-pointer appearance-none z-10"
                  />
                  {/* Dots for step 1, 2, 3, ..., 11, 12 */}
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-between pointer-events-none px-1">
                    {Array.from({ length: 12 }).map((_, idx) => {
                      const val = idx + 1;
                      const isActive = classNum >= val;
                      return (
                        <div
                          key={val}
                          className={`w-2.5 h-2.5 rounded-full border transition-all ${
                            isActive 
                              ? "bg-blue-600 border-blue-600 scale-110" 
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
                
                {/* Labels 1 to 12 below the track */}
                <div className="flex justify-between text-[9px] font-extrabold text-slate-400 dark:text-slate-600 px-0.5 mt-1.5">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <span 
                      key={idx} 
                      className={`cursor-pointer transition-colors ${classNum === idx + 1 ? "text-blue-600 dark:text-blue-400 scale-110 font-black" : ""}`}
                      onClick={() => setClassNum(idx + 1)}
                    >
                      {idx + 1}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Field: Monthly Fee */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                Monthly Tuition Fee (₹)
              </label>
              <input
                type="number"
                value={monthlyFee || ""}
                onChange={(e) => setMonthlyFee(Number(e.target.value))}
                placeholder="e.g. 1000"
                min="0"
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all h-[52px]"
                required
              />
            </div>
          </div>

          {/* Row: Student Contact Number & Parent's or Guardian contact No. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Renamed Student Contact Number */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-blue-500" />
                Student Contact Number
              </label>
              <div className={`flex items-center w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border rounded-xl text-slate-800 dark:text-slate-100 transition-all focus-within:ring-2 focus-within:ring-blue-500/20 ${
                phoneError
                  ? "border-rose-500 bg-rose-50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200"
                  : "border-slate-200 dark:border-slate-800"
              }`}>
                <span className="text-sm font-bold text-slate-400 dark:text-slate-500 mr-2 border-r border-slate-200 dark:border-slate-800 pr-2 select-none">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="98765 43210"
                  value={phoneVal}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setPhoneVal(val);
                    setPhoneError(false);
                  }}
                  className="w-full bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden text-sm font-semibold"
                  required
                />
              </div>
              {phoneError && (
                <span className="text-[10px] text-rose-500 font-extrabold">
                  * Must enter exactly 10 digits
                </span>
              )}
            </div>

            {/* Renamed Parent's or Guardian contact No. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-blue-500" />
                Parent's or Guardian contact No. (Optional)
              </label>
              <div className={`flex items-center w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border rounded-xl text-slate-800 dark:text-slate-100 transition-all focus-within:ring-2 focus-within:ring-blue-500/20 ${
                parentPhoneError
                  ? "border-rose-500 bg-rose-50 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200"
                  : "border-slate-200 dark:border-slate-800"
              }`}>
                <span className="text-sm font-bold text-slate-400 dark:text-slate-500 mr-2 border-r border-slate-200 dark:border-slate-800 pr-2 select-none">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="88776 65544 (Optional)"
                  value={parentPhoneVal}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setParentPhoneVal(val);
                    setParentPhoneError(false);
                  }}
                  className="w-full bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden text-sm font-semibold"
                />
              </div>
              {parentPhoneError && (
                <span className="text-[10px] text-rose-500 font-extrabold">
                  * Must enter exactly 10 digits
                </span>
              )}
            </div>
          </div>

          {/* Field: Date of Registration / Joining Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              Date of Registration (Tuition Joining Date)
            </label>
            <input
              type="date"
              value={registrationDate}
              onChange={(e) => setRegistrationDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
              required
            />
          </div>

          {/* Student Login Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Student Login Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 flex items-center justify-center text-blue-500 font-extrabold text-xs">@</span>
                Registered Email (Required)
              </label>
              <input
                type="email"
                placeholder="student@example.com"
                value={emailVal}
                onChange={(e) => setEmailVal(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
                required
              />
            </div>

            {/* Student Login Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <span className="text-blue-500">🔒</span>
                Login Password (Compulsory)
              </label>
              <input
                type="text"
                placeholder="Set a password"
                value={passwordVal}
                onChange={(e) => setPasswordVal(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold transition-all"
                required
              />
            </div>
          </div>

          {/* Enrolled Subjects Box */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5 justify-between">
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                Select Subjects
              </span>
            </label>

            {/* Category selection bar to prevent cluttered list */}
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800/80">
              {SUBJECT_CATEGORIES.map(cat => (
                <button
                  type="button"
                  key={cat.name}
                  onClick={() => setActiveSubjectTab(cat.name)}
                  className={`flex-1 py-1.5 text-[10px] sm:text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    activeSubjectTab === cat.name
                      ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs border border-slate-200/20"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Active Category Subject list rendering (No resizing, alphabetically sorted, flat grid) */}
            <div className="bg-slate-50 dark:bg-slate-950/40 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-850/50 mt-1 max-h-[180px] overflow-y-auto scrollbar-none">
              {SUBJECT_CATEGORIES.map(category => {
                if (category.name !== activeSubjectTab) return null;

                // Sort alphabetically
                const sortedSubjects = [...category.subjects].sort((a, b) => a.localeCompare(b));

                return (
                  <div key={category.name} className="grid grid-cols-2 gap-2">
                    {sortedSubjects.map((subj) => {
                      const isSelected = enrolledSubjects.includes(subj);

                      return (
                        <button
                          type="button"
                          key={subj}
                          onClick={() => handleSubjectToggle(subj)}
                          className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                            isSelected
                              ? "border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-black"
                              : "border-slate-150 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all shrink-0 ${
                            isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                          }`}>
                            {isSelected && (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="w-2.5 h-2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <span className="truncate flex-1 text-[11px] sm:text-xs">{subj}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Custom Subject Addition field */}
            <div className="flex gap-2 items-center mt-2 pb-1" id="custom-subject-adder">
              <input
                type="text"
                placeholder="Add other custom subject..."
                id="custom-subject-input"
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-850 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = e.currentTarget.value.trim();
                    if (val && !enrolledSubjects.includes(val)) {
                      setEnrolledSubjects([...enrolledSubjects, val]);
                      e.currentTarget.value = "";
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("custom-subject-input") as HTMLInputElement;
                  const val = input?.value.trim();
                  if (val && !enrolledSubjects.includes(val)) {
                    setEnrolledSubjects([...enrolledSubjects, val]);
                    input.value = "";
                  }
                }}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/20 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
              >
                Add
              </button>
            </div>

            {/* Selected Subjects Tags */}
            {enrolledSubjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {enrolledSubjects.map(subj => (
                  <span 
                    key={subj} 
                    className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-black px-2.5 py-1 rounded-full border border-blue-500/10"
                  >
                    {subj}
                    <button 
                      type="button" 
                      onClick={() => setEnrolledSubjects(enrolledSubjects.filter(s => s !== subj))}
                      className="hover:text-blue-800 dark:hover:text-blue-300 font-bold shrink-0 ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-2.5 justify-end pt-3.5 border-t border-slate-100 dark:border-slate-800 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-500/10 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{studentToEdit ? "Save Details" : "Register Student"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
