import React, { useState, useEffect } from "react";
import {
  Sparkles,
  BarChart3,
  UserCheck,
  Building2,
  CalendarCheck,
  CreditCard,
  GraduationCap,
  FileCheck2,
  BookOpenCheck,
  MessageSquare,
  Lightbulb,
  FileText,
  Bot,
  RefreshCw,
  Copy,
  Share2,
  Download,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  Send,
  User,
  ChevronRight,
  WifiOff,
  Flame,
  Award,
  TrendingUp,
  Clock,
  SendHorizontal
} from "lucide-react";
import jsPDF from "jspdf";
import { Student, AIReportType } from "../types";
import { generateAIReport, askAIChat, buildStructuredPayload } from "../lib/aiService";

interface AIInsightsProps {
  students: Student[];
}

export default function AIInsights({ students }: AIInsightsProps) {
  // Navigation active tab (1 out of 12 AI sections)
  const [activeSection, setActiveSection] = useState<AIReportType>("institution_overview");

  // Selection states for targeted reports
  const [selectedStudentId, setSelectedStudentId] = useState<string>(() => {
    return students.length > 0 ? students[0].id : "";
  });

  const [selectedClassGrade, setSelectedClassGrade] = useState<string>("All");

  const [commType, setCommType] = useState<string>("Progress Report");

  // AI Content state per section
  const [reports, setReports] = useState<Record<string, { markdown: string; isCached: boolean; updatedAt?: string }>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Chat interface state
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: "user" | "model"; text: string; time: string }>>([
    {
      id: "welcome-1",
      role: "model",
      text: "Hello Admin! I'm your Sumit Tuition App AI Assistant. Ask me anything about student performance, pending fees, attendance risks, or class progress.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputQuery, setInputQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Online / Offline monitor
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Sync selectedStudentId when students change
  useEffect(() => {
    if (students.length > 0 && !students.some(s => s.id === selectedStudentId)) {
      setSelectedStudentId(students[0].id);
    }
  }, [students, selectedStudentId]);

  // Extract unique classes
  const availableClasses = React.useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.classGrade) set.add(s.classGrade);
    });
    return Array.from(set).sort();
  }, [students]);

  // Derived high level stats for Institution Overview Card
  const stats = React.useMemo(() => {
    const payload = buildStructuredPayload(students);
    return payload.institution;
  }, [students]);

  // Load report for active section
  const fetchReport = async (forceRefresh: boolean = false) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      let filterContext: any = {};
      let promptExtra = "";

      if (activeSection === "student_performance" || activeSection === "parent_communication") {
        filterContext.studentId = selectedStudentId;
      }
      if (activeSection === "class_report") {
        filterContext.classGrade = selectedClassGrade;
      }
      if (activeSection === "parent_communication") {
        filterContext.communicationType = commType;
        promptExtra = `Generate a ready-to-send ${commType} for parent of selected student. Make it polite, professional, and clear.`;
      }

      const res = await generateAIReport(
        activeSection,
        students,
        filterContext,
        promptExtra,
        forceRefresh
      );

      const reportKey = `${activeSection}_${filterContext.studentId || "all"}_${filterContext.classGrade || "all"}_${filterContext.communicationType || "none"}`;

      setReports((prev) => ({
        ...prev,
        [reportKey]: res,
      }));
    } catch (err: any) {
      console.error("AI Insights fetch error:", err);
      setErrorMsg("Unable to load Insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Trigger report fetch when switching tab or changing target student/class
  useEffect(() => {
    if (activeSection !== "ask_ai") {
      fetchReport(false);
    }
  }, [activeSection, selectedStudentId, selectedClassGrade, commType]);

  // Get current active report key & item
  const currentReportKey = `${activeSection}_${
    activeSection === "student_performance" || activeSection === "parent_communication" ? selectedStudentId : "all"
  }_${activeSection === "class_report" ? selectedClassGrade : "all"}_${
    activeSection === "parent_communication" ? commType : "none"
  }`;

  const currentReport = reports[currentReportKey];

  // Copy to clipboard helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Share helper
  const handleShare = async (title: string, text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Sumit Tuition App AI - ${title}`,
          text: text,
        });
      } catch (e) {
        handleCopy(text, "share_fallback");
      }
    } else {
      handleCopy(text, "share_fallback");
    }
  };

  // Download raw markdown file
  const handleDownloadTxt = (title: string, text: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${title.toLowerCase().replace(/\s+/g, "_")}_report.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export PDF helper
  const handleExportPdf = (title: string, markdownText: string) => {
    try {
      const doc = new jsPDF();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`Sumit Tuition App - ${title}`, 14, 18);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Generated on: ${new Date().toLocaleString()} | Institution AI Intelligence`, 14, 25);

      doc.setDrawColor(220);
      doc.line(14, 28, 196, 28);

      doc.setFontSize(10);
      doc.setTextColor(30);

      const cleanText = markdownText.replace(/[*#_`]/g, "");
      const splitLines = doc.splitTextToSize(cleanText, 180);

      doc.text(splitLines, 14, 36);
      doc.save(`SumitTuitionApp_${title.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Failed to export PDF. Copying text instead.");
      navigator.clipboard.writeText(markdownText);
    }
  };

  // Handle Ask AI chat submission
  const handleSendQuery = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim()) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg = {
      id: userMsgId,
      role: "user" as const,
      text: textToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    if (!queryText) setInputQuery("");
    setChatLoading(true);

    try {
      const reply = await askAIChat(
        textToSend,
        students,
        chatMessages.map((m) => ({ role: m.role, text: m.text }))
      );

      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "model",
          text: reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err: any) {
      console.error("AI Insights chat error:", err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: "model",
          text: "⚠️ **Error:** Unable to process request. Please try again.",
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // 12 Menu Items definition
  const menuItems: { id: AIReportType; label: string; icon: any; badge?: string }[] = [
    { id: "institution_overview", label: "Overview", icon: Building2 },
    { id: "student_performance", label: "Student Report", icon: UserCheck },
    { id: "class_report", label: "Class Report", icon: GraduationCap },
    { id: "attendance_insights", label: "Attendance Insights", icon: CalendarCheck },
    { id: "fee_insights", label: "Fee Insights", icon: CreditCard },
    { id: "test_performance", label: "Test Performance", icon: BarChart3 },
    { id: "homework_analytics", label: "Homework Analytics", icon: FileCheck2 },
    { id: "syllabus_insights", label: "Syllabus Progress", icon: BookOpenCheck },
    { id: "parent_communication", label: "Parent Messaging", icon: MessageSquare, badge: "Templates" },
    { id: "recommendations", label: "AI Advice", icon: Lightbulb },
    { id: "monthly_report", label: "Monthly Report", icon: FileText, badge: "PDF" },
    { id: "ask_ai", label: "Ask AI Assistant", icon: Bot, badge: "Chat" },
  ];

  return (
    <div className="space-y-6 pb-12 animate-fadeIn" id="ai-insights-container">
      {/* Top AI Header */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 dark:from-blue-900 dark:via-indigo-950 dark:to-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 z-10 relative">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 shadow-inner">
              <Sparkles className="w-6 h-6 text-yellow-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">AI Insights & Intelligence</h1>
                <span className="bg-yellow-400/20 text-yellow-200 border border-yellow-300/30 text-[10px] font-black uppercase px-2 py-0.5 rounded-full tracking-widest">
                  Gemini 3.6
                </span>
              </div>
              <p className="text-xs sm:text-sm text-blue-100/90 font-medium mt-0.5">
                Automated student analytics, trend detection, parent messaging & recommendations
              </p>
            </div>
          </div>

          {!isOnline && (
            <div className="flex items-center gap-2 bg-amber-500/20 border border-amber-300/30 text-amber-100 text-xs font-bold px-3 py-1.5 rounded-xl">
              <WifiOff className="w-4 h-4 text-amber-300" />
              <span>Offline Mode (Using Cached Reports)</span>
            </div>
          )}
        </div>

        {/* 12 Menu Navigation Horizontal Scroll */}
        <div className="mt-6 pt-4 border-t border-white/10 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? "bg-white text-blue-900 shadow-md scale-102 font-extrabold"
                    : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-white/80"}`} />
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                      isActive ? "bg-blue-100 text-blue-700" : "bg-white/20 text-white"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* SECTION 1: INSTITUTION OVERVIEW */}
      {/* ---------------------------------------------------- */}
      {activeSection === "institution_overview" && (
        <div className="space-y-5 animate-fadeIn">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Students</p>
              <p className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{stats.totalStudents}</p>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">100% Active</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Average Attendance</p>
              <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{stats.averageAttendancePercentage}%</p>
              <span className="text-[11px] font-medium text-slate-500">Across all classes</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Collection This Month</p>
              <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">₹{stats.collectionThisMonth.toLocaleString()}</p>
              <span className="text-[11px] font-medium text-slate-500">{stats.currentMonth}</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pending Fees</p>
              <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">₹{stats.pendingFees.toLocaleString()}</p>
              <span className="text-[11px] font-bold text-rose-500">{stats.studentsAtRiskCount} Students Due</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Students At Risk</p>
              <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.studentsAtRiskCount}</p>
              <span className="text-[11px] font-medium text-slate-500">Attendance / Fees</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Avg Test Score</p>
              <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.averageTestScore}%</p>
              <span className="text-[11px] font-medium text-slate-500">Academic Standing</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Homework Completion</p>
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{stats.homeworkCompletionRatePercentage}%</p>
              <span className="text-[11px] font-medium text-slate-500">Submission Rate</span>
            </div>

            <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Analysis</p>
              <button
                onClick={() => fetchReport(true)}
                disabled={loading}
                className="mt-2 text-xs font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 py-1.5 px-3 rounded-xl transition-all border border-blue-200/50 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Re-Analyze</span>
              </button>
            </div>
          </div>

          {/* AI Generated Overview Card */}
          <ReportCardContainer
            title="Institution AI Executive Summary"
            subtitle="Automated high-level strategic analysis based on current ledger, attendance, and test records."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare("Institution Overview", txt)}
            onDownloadPdf={(txt) => handleExportPdf("Institution_Overview", txt)}
            onDownloadTxt={(txt) => handleDownloadTxt("Institution_Overview", txt)}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 2: STUDENT PERFORMANCE REPORT */}
      {/* ---------------------------------------------------- */}
      {activeSection === "student_performance" && (
        <div className="space-y-5 animate-fadeIn">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="w-full sm:w-auto flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 rounded-xl">
                <User className="w-5 h-5" />
              </div>
              <div className="w-full sm:w-64">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Select Student</label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full mt-0.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.classGrade || "Class N/A"})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => fetchReport(true)}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Regenerate Report</span>
            </button>
          </div>

          <ReportCardContainer
            title={`Performance Report: ${students.find((s) => s.id === selectedStudentId)?.name || "Student"}`}
            subtitle="Strengths, weaknesses, attendance trend, test marks, fee status, risk level, & action plan."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare("Student Performance Report", txt)}
            onDownloadPdf={(txt) => handleExportPdf(`Student_Report_${selectedStudentId}`, txt)}
            onDownloadTxt={(txt) => handleDownloadTxt(`Student_Report_${selectedStudentId}`, txt)}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 3: CLASS REPORT */}
      {/* ---------------------------------------------------- */}
      {activeSection === "class_report" && (
        <div className="space-y-5 animate-fadeIn">
          {/* Controls Bar */}
          <div className="bg-white dark:bg-[#111827] p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="w-full sm:w-auto flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 rounded-xl">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div className="w-full sm:w-64">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Select Class Grade</label>
                <select
                  value={selectedClassGrade}
                  onChange={(e) => setSelectedClassGrade(e.target.value)}
                  className="w-full mt-0.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="All">All Classes Combined</option>
                  {availableClasses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => fetchReport(true)}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Analyze Class</span>
            </button>
          </div>

          <ReportCardContainer
            title={`Class Analytics Report (${selectedClassGrade})`}
            subtitle="Highest & lowest attendance, fee collection %, average marks, top performers & students needing support."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare(`Class Report ${selectedClassGrade}`, txt)}
            onDownloadPdf={(txt) => handleExportPdf(`Class_Report_${selectedClassGrade}`, txt)}
            onDownloadTxt={(txt) => handleDownloadTxt(`Class_Report_${selectedClassGrade}`, txt)}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTIONS 4 to 8, 10: GENERIC INSIGHT CARDS */}
      {/* ---------------------------------------------------- */}
      {[
        "attendance_insights",
        "fee_insights",
        "test_performance",
        "homework_analytics",
        "syllabus_insights",
        "recommendations",
      ].includes(activeSection) && (
        <div className="space-y-5 animate-fadeIn">
          <ReportCardContainer
            title={menuItems.find((m) => m.id === activeSection)?.label || "AI Insight"}
            subtitle="Automated deep data synthesis generated across all registered students & class ledgers."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare(activeSection, txt)}
            onDownloadPdf={(txt) => handleExportPdf(activeSection, txt)}
            onDownloadTxt={(txt) => handleDownloadTxt(activeSection, txt)}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 9: PARENT COMMUNICATION GENERATOR */}
      {/* ---------------------------------------------------- */}
      {activeSection === "parent_communication" && (
        <div className="space-y-5 animate-fadeIn">
          <div className="bg-white dark:bg-[#111827] p-4.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Student</label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (Parent: {s.parentPhone || "N/A"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Message Type</label>
                <select
                  value={commType}
                  onChange={(e) => setCommType(e.target.value)}
                  className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="Progress Report">Progress Report</option>
                  <option value="Attendance Report">Attendance Alert</option>
                  <option value="Fee Reminder">Fee Payment Reminder</option>
                  <option value="Homework Reminder">Homework Alert</option>
                  <option value="Motivational Message">Motivational Note</option>
                  <option value="PTM Invitation">PTM Invitation</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => fetchReport(true)}
                disabled={loading}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-yellow-300" />
                <span>Generate Parent Message</span>
              </button>
            </div>
          </div>

          <ReportCardContainer
            title={`Ready-to-Send Message (${commType})`}
            subtitle="Review, edit, copy, share or send directly to parent on WhatsApp."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare(`Parent Communication - ${commType}`, txt)}
            onDownloadPdf={(txt) => handleExportPdf(`Parent_Communication_${commType}`, txt)}
            onDownloadTxt={(txt) => handleDownloadTxt(`Parent_Communication_${commType}`, txt)}
            extraActions={
              currentReport?.markdown ? (
                <a
                  href={`https://wa.me/${(
                    students.find((s) => s.id === selectedStudentId)?.parentPhone || ""
                  ).replace(/[^00-9]/g, "")}?text=${encodeURIComponent(
                    currentReport.markdown.replace(/[*#_`]/g, "")
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send via WhatsApp</span>
                </a>
              ) : null
            }
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 11: MONTHLY INSTITUTION REPORT */}
      {/* ---------------------------------------------------- */}
      {activeSection === "monthly_report" && (
        <div className="space-y-5 animate-fadeIn">
          <ReportCardContainer
            title="Comprehensive Monthly Institution Report"
            subtitle="Complete breakdown of attendance, revenue, fee ledger, academic standings, and recommendations."
            markdown={currentReport?.markdown}
            isCached={currentReport?.isCached}
            updatedAt={currentReport?.updatedAt}
            loading={loading}
            error={errorMsg}
            onRegenerate={() => fetchReport(true)}
            onCopy={(txt) => handleCopy(txt, currentReportKey)}
            isCopied={copiedKey === currentReportKey}
            onShare={(txt) => handleShare("Monthly Institution Report", txt)}
            onDownloadPdf={(txt) => handleExportPdf("Monthly_Institution_Report", txt)}
            onDownloadTxt={(txt) => handleDownloadTxt("Monthly_Institution_Report", txt)}
          />
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* SECTION 12: ASK AI (INTERACTIVE CHAT) */}
      {/* ---------------------------------------------------- */}
      {activeSection === "ask_ai" && (
        <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col h-[620px] animate-fadeIn">
          {/* Chat Header */}
          <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-md">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">Interactive AI Administrator Assistant</h3>
                <p className="text-[10px] text-slate-400 font-medium">Real-time dynamic query analysis over student ledger & records</p>
              </div>
            </div>

            <button
              onClick={() =>
                setChatMessages([
                  {
                    id: `welcome-${Date.now()}`,
                    role: "model",
                    text: "Chat context cleared. What would you like to ask about Sumit Tuition App?",
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ])
              }
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold rounded-lg transition-all"
              title="Clear Chat History"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Prompts Suggestions Chips */}
          <div className="p-3 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200/60 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-yellow-500" /> Prompts:
            </span>
            {[
              "Which students are at risk?",
              "Who has not paid fees?",
              "Show attendance below 75%",
              "Which class improved most this month?",
              "Generate PTM report",
              "Summarize Class 10 performance",
            ].map((promptText, i) => (
              <button
                key={i}
                onClick={() => handleSendQuery(promptText)}
                disabled={chatLoading}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-500 text-[11px] font-semibold text-slate-700 dark:text-slate-300 rounded-lg whitespace-nowrap transition-all shadow-2xs hover:text-blue-600 cursor-pointer disabled:opacity-50"
              >
                {promptText}
              </button>
            ))}
          </div>

          {/* Chat Messages Log */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold shadow-sm ${
                    msg.role === "user"
                      ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[85%] sm:max-w-[80%] rounded-2xl p-4 shadow-sm text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-none"
                      : "bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-tl-none"
                  }`}
                >
                  {msg.role === "model" ? (
                    <MarkdownRenderer content={msg.text} />
                  ) : (
                    <p className="whitespace-pre-wrap font-medium">{msg.text}</p>
                  )}

                  <div
                    className={`text-[9px] mt-2 text-right ${
                      msg.role === "user" ? "text-blue-100" : "text-slate-400"
                    }`}
                  >
                    {msg.time}
                  </div>
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex gap-3 items-center">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  <Bot className="w-4 h-4 animate-bounce" />
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-2xl rounded-tl-none text-xs text-slate-500 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span>AI Assistant is analyzing student records...</span>
                </div>
              </div>
            )}
          </div>

          {/* Chat Input Box */}
          <div className="p-3 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuery();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                placeholder="Ask AI anything (e.g., 'Summarize Class 10 fee collection')"
                disabled={chatLoading}
                className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-medium rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={chatLoading || !inputQuery.trim()}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center cursor-pointer disabled:opacity-50"
              >
                <SendHorizontal className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// REUSABLE REPORT CONTAINER COMPONENT
// ----------------------------------------------------
interface ReportCardContainerProps {
  title: string;
  subtitle: string;
  markdown?: string;
  isCached?: boolean;
  updatedAt?: string;
  loading: boolean;
  error?: string | null;
  onRegenerate: () => void;
  onCopy: (txt: string) => void;
  isCopied: boolean;
  onShare: (txt: string) => void;
  onDownloadPdf: (txt: string) => void;
  onDownloadTxt: (txt: string) => void;
  extraActions?: React.ReactNode;
}

function ReportCardContainer({
  title,
  subtitle,
  markdown,
  isCached,
  updatedAt,
  loading,
  error,
  onRegenerate,
  onCopy,
  isCopied,
  onShare,
  onDownloadPdf,
  onDownloadTxt,
  extraActions,
}: ReportCardContainerProps) {
  return (
    <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden transition-all">
      {/* Header Bar */}
      <div className="p-5 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-slate-800 dark:text-slate-100">{title}</h3>
            {isCached && (
              <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider">
                Cached
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>
        </div>

        {/* Action Controls */}
        {markdown && !loading && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {extraActions}

            <button
              onClick={() => onCopy(markdown)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              title="Copy Report"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>

            <button
              onClick={() => onShare(markdown)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              title="Share Report"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => onDownloadPdf(markdown)}
              className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 border border-rose-200/50 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1"
              title="Export PDF"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>

            <button
              onClick={() => onDownloadTxt(markdown)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              title="Download Markdown"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              onClick={onRegenerate}
              className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-xl transition-all cursor-pointer"
              title="Regenerate with fresh AI call"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Body */}
      <div className="p-5 sm:p-6 min-h-[220px]">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-extrabold text-slate-600 dark:text-slate-300 animate-pulse">
              Synthesizing student data and building AI insights...
            </p>
          </div>
        ) : error ? (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl flex items-center gap-3 text-rose-700 dark:text-rose-300 text-xs font-semibold">
            <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
            <div className="flex-1">
              <p className="font-bold">Generation Issue</p>
              <p>{error}</p>
            </div>
            <button
              onClick={onRegenerate}
              className="px-3 py-1.5 bg-rose-600 text-white font-bold rounded-lg text-xs hover:bg-rose-700 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : markdown ? (
          <div>
            <MarkdownRenderer content={markdown} />
            {updatedAt && (
              <p className="text-[10px] text-slate-400 font-medium mt-6 pt-3 border-t border-slate-100 dark:border-slate-800 text-right">
                Report generated at: {new Date(updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400">
            <Sparkles className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-xs font-semibold">Click regenerate to construct AI analysis.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// CUSTOM CLEAN MARKDOWN RENDERER COMPONENT
// ----------------------------------------------------
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split("\n");
  const renderedElements: React.ReactNode[] = [];

  let keyIdx = 0;

  lines.forEach((line) => {
    keyIdx++;
    const trimmed = line.trim();

    if (!trimmed) {
      renderedElements.push(<div key={keyIdx} className="h-2" />);
      return;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      renderedElements.push(
        <h3 key={keyIdx} className="text-sm font-black text-slate-800 dark:text-slate-100 mt-3 mb-1.5 flex items-center gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span>{formatInlineBold(trimmed.replace(/^###\s+/, ""))}</span>
        </h3>
      );
      return;
    }

    if (trimmed.startsWith("## ")) {
      renderedElements.push(
        <h2 key={keyIdx} className="text-base font-black text-blue-600 dark:text-blue-400 mt-4 mb-2 pb-1 border-b border-slate-200 dark:border-slate-800">
          {formatInlineBold(trimmed.replace(/^##\s+/, ""))}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith("# ")) {
      renderedElements.push(
        <h1 key={keyIdx} className="text-lg font-black text-slate-900 dark:text-white mt-4 mb-2">
          {formatInlineBold(trimmed.replace(/^#\s+/, ""))}
        </h1>
      );
      return;
    }

    // Bullet lists
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const listContent = trimmed.replace(/^[-*]\s+/, "");
      renderedElements.push(
        <div key={keyIdx} className="flex items-start gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 my-1 pl-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
          <div className="flex-1">{formatInlineBold(listContent)}</div>
        </div>
      );
      return;
    }

    // Blockquotes
    if (trimmed.startsWith("> ")) {
      renderedElements.push(
        <blockquote key={keyIdx} className="p-2.5 bg-blue-50/60 dark:bg-blue-950/30 border-l-3 border-blue-500 rounded-r-xl text-xs font-medium text-blue-900 dark:text-blue-200 my-2">
          {formatInlineBold(trimmed.replace(/^>\s+/, ""))}
        </blockquote>
      );
      return;
    }

    // Normal Paragraphs
    renderedElements.push(
      <p key={keyIdx} className="text-xs font-normal text-slate-700 dark:text-slate-300 leading-relaxed my-1">
        {formatInlineBold(trimmed)}
      </p>
    );
  });

  return <div className="space-y-0.5 text-slate-800 dark:text-slate-100">{renderedElements}</div>;
}

// Inline formatting helper for **bold** text
function formatInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-bold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
