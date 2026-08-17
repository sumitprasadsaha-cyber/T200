import React from "react";
import { X, Download, FileText, Award, BookOpen, Layers, CheckCircle2, AlertTriangle } from "lucide-react";
import { SubjectReportData } from "../utils/chapterProgressHelper";
import { jsPDF } from "jspdf";

interface SubjectReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: SubjectReportData | null;
  studentName?: string;
  classGrade?: string;
}

export default function SubjectReportModal({
  isOpen,
  onClose,
  reportData,
  studentName = "Student",
  classGrade = "Class 10"
}: SubjectReportModalProps) {
  if (!isOpen || !reportData) return null;

  const handleExportPdf = () => {
    const doc = new jsPDF();
    const currentDate = new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    // Header Box
    doc.setFillColor(37, 99, 235); // Blue primary
    doc.rect(0, 0, 210, 36, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("TOPIC-WISE PRACTICE TEST PERFORMANCE REPORT", 14, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated on: ${currentDate}`, 14, 28);

    // Top Summary Box
    doc.setFillColor(248, 250, 252);
    doc.rect(14, 42, 182, 32, "F");
    doc.setDrawColor(226, 232, 240);
    doc.rect(14, 42, 182, 32, "S");

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(`Subject Name: ${reportData.subjectName}`, 18, 50);
    doc.text(`Student: ${studentName} (${classGrade})`, 110, 50);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`Overall Subject Percentage: ${reportData.overallSubjectPercentage}%`, 18, 59);
    doc.text(`Number of Chapters: ${reportData.totalChapters}`, 110, 59);
    doc.text(`Number of Topics: ${reportData.totalTopics}`, 18, 67);
    doc.text(`Total Tests Attempted: ${reportData.totalTestsAttempted}`, 110, 67);
    doc.text(`Average Highest Score: ${reportData.averageHighestScore}%`, 18, 73);

    // Table Headers
    let y = 82;
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 8, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 65, 85);

    doc.text("Chapter No & Chapter Name", 16, y + 5.5);
    doc.text("Topic Name", 75, y + 5.5);
    doc.text("Highest Test Score", 125, y + 5.5);
    doc.text("Remark", 160, y + 5.5);

    y += 10;
    doc.setFont("helvetica", "normal");

    reportData.chapters.forEach((chap) => {
      // Check page boundary
      if (y > 270) {
        doc.addPage();
        y = 20;
      }

      // Print Chapter Header ONCE
      doc.setFillColor(239, 246, 255);
      doc.rect(14, y, 182, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(29, 78, 216);
      doc.text(`Chapter ${chap.chapterNo}: ${chap.chapterName} (Chapter Progress: ${chap.chapterProgress}%)`, 16, y + 5);
      y += 8;

      // Print Topics
      chap.topics.forEach((topic) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(15, 23, 42);

        doc.text("—", 16, y + 4);
        let tName = topic.topicName;
        if (tName.length > 28) tName = tName.substring(0, 26) + "..";
        doc.text(tName, 75, y + 4);

        doc.setFont("helvetica", "bold");
        if (topic.highestScorePercentage >= 80) doc.setTextColor(16, 185, 129);
        else if (topic.highestScorePercentage >= 60) doc.setTextColor(37, 99, 235);
        else doc.setTextColor(239, 68, 68);

        doc.text(topic.highestScoreFormatted, 125, y + 4);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        let ws = topic.weaknessAndStrength;
        if (ws.length > 25) ws = ws.substring(0, 23) + "..";
        doc.text(ws, 160, y + 4);

        y += 6;
      });

      y += 2;
    });

    doc.save(`${reportData.subjectName}_Subject_Report_${studentName.replace(/\s+/g, "_")}.pdf`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                Subject Performance Report — {reportData.subjectName}
              </h2>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Topic-Wise Practice Test Summary for {studentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-md shadow-blue-500/20 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Subject</span>
              <span className="text-sm font-black text-slate-800 dark:text-slate-100 truncate mt-1">{reportData.subjectName}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 flex flex-col">
              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Overall Progress</span>
              <span className="text-sm font-black text-blue-700 dark:text-blue-300 mt-1">{reportData.overallSubjectPercentage}%</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chapters</span>
              <span className="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">{reportData.totalChapters}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Topics</span>
              <span className="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">{reportData.totalTopics}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tests Attempted</span>
              <span className="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">{reportData.totalTestsAttempted}</span>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 flex flex-col">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Avg Highest Score</span>
              <span className="text-sm font-black text-emerald-700 dark:text-emerald-300 mt-1">{reportData.averageHighestScore}%</span>
            </div>
          </div>

          {/* Chapters & Topics Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-extrabold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4 w-1/3">Chapter No & Chapter Name</th>
                    <th className="py-3 px-4 w-1/4">Topic Name</th>
                    <th className="py-3 px-4 w-1/5">Highest Test Score</th>
                    <th className="py-3 px-4">Remark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
                  {reportData.chapters.map((chapter) => (
                    <React.Fragment key={`chap_${chapter.chapterNo}`}>
                      {/* Chapter Header Row (Displayed ONCE per chapter) */}
                      <tr className="bg-blue-50/50 dark:bg-blue-950/30 border-t border-b border-blue-100 dark:border-blue-900/50">
                        <td colSpan={4} className="py-2.5 px-4 font-black text-blue-900 dark:text-blue-200 text-xs">
                          Chapter {chapter.chapterNo}: {chapter.chapterName}
                          <span className="ml-3 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded-full">
                            Chapter Progress: {chapter.chapterProgress}%
                          </span>
                        </td>
                      </tr>

                      {/* Topic Rows */}
                      {chapter.topics.map((topic, idx) => (
                        <tr key={`top_${chapter.chapterNo}_${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-4 pl-8 text-slate-400 text-[11px] italic font-medium">
                            {idx === 0 ? `Chapter ${chapter.chapterNo}` : ""}
                          </td>
                          <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">
                            {topic.topicName}
                          </td>
                          <td className="py-2.5 px-4 font-extrabold font-mono">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] inline-block ${
                                topic.highestScorePercentage >= 80
                                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                  : topic.highestScorePercentage >= 60
                                  ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                  : topic.highestScorePercentage > 0
                                  ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700"
                              }`}
                            >
                              {topic.highestScoreFormatted}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-600 dark:text-slate-300">
                            {topic.weaknessAndStrength}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}

                  {reportData.chapters.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                        No chapters or topic tests available for this subject yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
