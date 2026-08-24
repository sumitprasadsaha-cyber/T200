import React, { useState, useMemo, useRef } from "react";
import { 
  BookOpen, 
  Plus, 
  Upload, 
  Trash2, 
  Pencil, 
  Eye, 
  RefreshCw, 
  Search, 
  ChevronDown, 
  ChevronRight, 
  FileText, 
  Image as ImageIcon,
  X, 
  AlertTriangle, 
  CheckCircle2,
  FolderKanban,
  Sparkles,
  ShieldCheck,
  Globe,
  Users,
  Loader2
} from "lucide-react";
import { ClassNote, Student } from "../types";
import { uploadFileToR2, deleteFileFromStorage } from "../lib/storageService";
import { saveClassNoteDoc, deleteClassNoteDoc } from "../lib/firestoreService";
import { groupClassNotesHierarchy, normalizeClassGrade, isClassGradeMatching, isSubjectMatching, generateUPSCStoragePath, inferGSPaperFromSubject } from "../utils/classNoteHelper";
import { getFormattedTopicLabel, isFileNameRedundant } from "../utils/chapterNotesHelper";
import PdfViewer from "./PdfViewer";
import { isImageFile, invalidateNoteCache } from "../lib/nativePdfService";
import AdminPracticeTestModal from "./AdminPracticeTestModal";
import { getFullChapterQuestions } from "../utils/assessmentParser";

interface AdminNotesViewProps {
  notes: ClassNote[];
  students?: Student[];
  onRefresh?: () => void;
}

const DEFAULT_CLASSES = [
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11",
  "Class 12",
  "UPSC"
];

const DEFAULT_SUBJECTS_BY_CLASS: Record<string, string[]> = {
  "Class 6": ["Mathematics", "Science", "English", "Computer Science", "Social Science", "Hindi", "Bengali"],
  "Class 7": ["Mathematics", "Science", "English", "Computer Science", "Social Science", "Hindi", "Bengali"],
  "Class 8": ["Mathematics", "Science", "English", "Computer Science", "Social Science", "Hindi", "Bengali"],
  "Class 9": ["Mathematics", "Science", "English", "Computer Science", "Indian Heritage and Culture", "Economics", "History", "Geography"],
  "Class 10": ["Mathematics", "Science", "English", "Computer Science", "Indian Heritage and Culture", "Economics", "History", "Geography"],
  "Class 11": ["Physics", "Chemistry", "Mathematics", "Biology", "Computer Science", "English", "Economics", "Accountancy"],
  "Class 12": ["Physics", "Chemistry", "Mathematics", "Biology", "Computer Science", "English", "Economics", "Accountancy"],
  "UPSC": ["Polity", "Geography", "History", "Economy", "Environment", "Ethics", "Science & Technology", "Current Affairs", "International Relations", "General Studies"]
};

const UPSC_GS_PAPERS = [
  "General Studies Paper I",
  "General Studies Paper II",
  "General Studies Paper III",
  "General Studies Paper IV",
  "Essay",
  "CSAT"
];

export default function AdminNotesView({ notes, students = [], onRefresh }: AdminNotesViewProps) {
  // Tabs & Upload state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Upload Form fields
  const [selectedClass, setSelectedClass] = useState("Class 10");
  const [customClass, setCustomClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("Mathematics");
  const [customSubject, setCustomSubject] = useState("");
  const [generalStudiesPaper, setGeneralStudiesPaper] = useState("General Studies Paper I");
  const [chapterNo, setChapterNo] = useState<number | "">(1);
  const [chapterTitle, setChapterTitle] = useState("");
  const [topicNo, setTopicNo] = useState("");
  const [topicName, setTopicName] = useState("");
  const [partLabel, setPartLabel] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  
  // Progress & feedback
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formError, setFormError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit/Rename Modal state
  const [editingNote, setEditingNote] = useState<ClassNote | null>(null);
  const [editClass, setEditClass] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editGeneralStudiesPaper, setEditGeneralStudiesPaper] = useState("General Studies Paper I");
  const [editChapterNo, setEditChapterNo] = useState<number | "">(1);
  const [editChapterTitle, setEditChapterTitle] = useState("");
  const [editTopicNo, setEditTopicNo] = useState("");
  const [editTopicName, setEditTopicName] = useState("");
  const [editPartLabel, setEditPartLabel] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);

  // Replace PDF Modal state
  const [replaceNote, setReplaceNote] = useState<ClassNote | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  // Delete Modal state
  const [deletingNote, setDeletingNote] = useState<ClassNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Manage Access Modal state (Chapter-level)
  const [manageAccessChapter, setManageAccessChapter] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    parts: ClassNote[];
  } | null>(null);
  const [selectedClassesForAccess, setSelectedClassesForAccess] = useState<string[]>([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [accessMsg, setAccessMsg] = useState("");

  // PDF / Image Preview modal
  const [previewPdf, setPreviewPdf] = useState<{
    url: string;
    title: string;
    noteId?: string;
    storagePath?: string;
    bucket?: string;
    fileName?: string;
    mimeType?: string;
    fileType?: "pdf" | "image" | string;
  } | null>(null);

  // Practice Test Editor state
  const [practiceTestTarget, setPracticeTestTarget] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
  } | null>(null);

  // Accordion open/close state (collapsed by default)
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [expandedGSPapers, setExpandedGSPapers] = useState<Record<string, boolean>>({});
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
  const [, setTestUpdateVersion] = useState(0);

  React.useEffect(() => {
    const handleUpdate = () => {
      setTestUpdateVersion((v) => v + 1);
    };
    window.addEventListener("practice-tests-updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("practice-tests-updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const toggleClassExpand = (cls: string) => {
    setExpandedClasses((prev) => {
      const isExpanded = !!prev[cls];
      if (isExpanded) {
        return {};
      } else {
        return { [cls]: true };
      }
    });
  };

  const toggleGSPaperExpand = (gsKey: string) => {
    setExpandedGSPapers((prev) => {
      const isExpanded = !!prev[gsKey];
      if (isExpanded) {
        const next = { ...prev };
        delete next[gsKey];
        return next;
      } else {
        return { ...prev, [gsKey]: true };
      }
    });
  };

  const toggleSubjectExpand = (subjKey: string, classGrade: string) => {
    setExpandedSubjects((prev) => {
      const isExpanded = !!prev[subjKey];
      if (isExpanded) {
        const next = { ...prev };
        delete next[subjKey];
        return next;
      } else {
        // Accordion: keep only one subject open under this class
        const next: Record<string, boolean> = {};
        Object.keys(prev).forEach((k) => {
          if (!k.startsWith(`${classGrade}_`)) {
            next[k] = prev[k];
          }
        });
        next[subjKey] = true;
        return next;
      }
    });
  };

  const toggleChapterExpand = (chKey: string, parentSubjPrefix: string) => {
    setExpandedChapters((prev) => {
      const isExpanded = !!prev[chKey];
      if (isExpanded) {
        const next = { ...prev };
        delete next[chKey];
        return next;
      } else {
        // Accordion: keep only one chapter open under this subject
        const next: Record<string, boolean> = {};
        Object.keys(prev).forEach((k) => {
          if (!k.startsWith(parentSubjPrefix)) {
            next[k] = prev[k];
          }
        });
        next[chKey] = true;
        return next;
      }
    });
  };

  // All unique available classes for selection
  const allAvailableClasses = useMemo(() => {
    const classesSet = new Set<string>(DEFAULT_CLASSES);
    (students || []).forEach((s) => {
      if (s.classGrade) {
        classesSet.add(normalizeClassGrade(s.classGrade));
      }
    });
    return Array.from(classesSet).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      if (numA !== numB) return numA - numB;
      return a.localeCompare(b);
    });
  }, [students]);

  const handleOpenManageAccessForChapter = (
    classGrade: string,
    subject: string,
    chGroup: { chapterNo: number; chapterName: string; parts: ClassNote[] }
  ) => {
    setManageAccessChapter({
      classGrade,
      subject,
      chapterNo: chGroup.chapterNo,
      chapterName: chGroup.chapterName,
      parts: chGroup.parts,
    });

    const firstNote = chGroup.parts[0];
    if (firstNote?.allowedClasses && Array.isArray(firstNote.allowedClasses) && firstNote.allowedClasses.length > 0) {
      setSelectedClassesForAccess(firstNote.allowedClasses.map((c) => normalizeClassGrade(c)));
    } else if (firstNote?.allowedStudentIds && firstNote.allowedStudentIds.length > 0 && students) {
      const studentClasses = new Set<string>();
      students.forEach((s) => {
        if (firstNote.allowedStudentIds?.includes(s.id) && s.classGrade) {
          studentClasses.add(normalizeClassGrade(s.classGrade));
        }
      });
      if (studentClasses.size > 0) {
        setSelectedClassesForAccess(Array.from(studentClasses));
      } else {
        setSelectedClassesForAccess([normalizeClassGrade(classGrade)]);
      }
    } else {
      setSelectedClassesForAccess([normalizeClassGrade(classGrade)]);
    }
    setAccessMsg("");
  };

  const handleToggleClassForAccess = (cls: string) => {
    const normClass = normalizeClassGrade(cls);
    setSelectedClassesForAccess((prev) =>
      prev.includes(normClass)
        ? prev.filter((c) => c !== normClass)
        : [...prev, normClass]
    );
  };

  const handleSelectAllClasses = () => {
    setSelectedClassesForAccess([...allAvailableClasses]);
  };

  const handleClearAllClasses = () => {
    setSelectedClassesForAccess([]);
  };

  const handleSaveManageAccess = async () => {
    if (!manageAccessChapter) return;
    setIsSavingAccess(true);
    setAccessMsg("");
    try {
      const normalizedSelected = selectedClassesForAccess.map((c) => normalizeClassGrade(c).toLowerCase());
      const matchedStudentIds = (students || [])
        .filter((s) => normalizedSelected.includes(normalizeClassGrade(s.classGrade).toLowerCase()))
        .map((s) => s.id);

      for (const note of manageAccessChapter.parts) {
        const updated: ClassNote = {
          ...note,
          accessType: "selected",
          allowedClasses: selectedClassesForAccess,
          allowedStudentIds: matchedStudentIds,
          updatedAt: new Date().toISOString(),
        };
        await saveClassNoteDoc(updated);
      }

      setAccessMsg(`Permissions saved successfully! Shared with ${selectedClassesForAccess.length} class(es).`);
      if (onRefresh) onRefresh();
      setTimeout(() => {
        setManageAccessChapter(null);
      }, 900);
    } catch (err: any) {
      setAccessMsg(err?.message || "Failed to save permissions.");
    } finally {
      setIsSavingAccess(false);
    }
  };

  // Subjects options depending on selected class
  const availableSubjects = useMemo(() => {
    const cls = selectedClass === "Other" ? customClass : selectedClass;
    const norm = normalizeClassGrade(cls);
    const defaults = DEFAULT_SUBJECTS_BY_CLASS[norm] || [
      "Mathematics",
      "Science",
      "English",
      "Computer Science",
      "Indian Heritage and Culture",
      "Economics",
    ];
    return defaults;
  }, [selectedClass, customClass]);

  // Check if current selected class in upload modal is UPSC
  const isUPSC = useMemo(() => {
    const cls = selectedClass === "Other" ? customClass : selectedClass;
    return normalizeClassGrade(cls) === "UPSC";
  }, [selectedClass, customClass]);

  // Filter notes based on Admin search query
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((note) => {
      const cls = (note.classGrade || "").toLowerCase();
      const subj = (note.subject || "").toLowerCase();
      const chNo = `chapter ${note.chapterNo}`.toLowerCase() || `${note.chapterNo}`;
      const title = (note.chapterName || "").toLowerCase();
      const part = (note.partLabel || "").toLowerCase();
      const filename = (note.pdfFileName || "").toLowerCase();
      return (
        cls.includes(q) ||
        subj.includes(q) ||
        chNo.includes(q) ||
        title.includes(q) ||
        part.includes(q) ||
        filename.includes(q)
      );
    });
  }, [notes, searchQuery]);

  // Grouped hierarchy
  const hierarchy = useMemo(() => {
    return groupClassNotesHierarchy(filteredNotes);
  }, [filteredNotes]);

  // Handle Save / Upload PDF Note
  const handleUploadSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSuccessMsg("");

    const finalClass = (selectedClass === "Other" ? customClass : selectedClass).trim();
    const finalSubject = (selectedSubject === "Other" ? customSubject : selectedSubject).trim();
    const isUPSCClass = normalizeClassGrade(finalClass) === "UPSC";

    if (!finalClass) {
      setFormError("Please select or enter a Class.");
      return;
    }
    if (!finalSubject) {
      setFormError("Please select or enter a Subject.");
      return;
    }
    if (isUPSCClass && !generalStudiesPaper.trim()) {
      setFormError("Please select a General Studies Paper.");
      return;
    }
    if (chapterNo === "" || isNaN(Number(chapterNo)) || Number(chapterNo) < 1) {
      setFormError(isUPSCClass ? "Please enter a valid Module Number." : "Please enter a valid Chapter Number.");
      return;
    }
    if (!chapterTitle.trim()) {
      setFormError(isUPSCClass ? "Please enter a Module Name." : "Please enter a Chapter Title.");
      return;
    }
    if (!pdfFile) {
      setFormError("Please choose a PDF or Image file to upload.");
      return;
    }

    const isPdf = pdfFile.type === "application/pdf" || pdfFile.name.toLowerCase().endsWith(".pdf");
    const isImg = pdfFile.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(pdfFile.name);

    if (!isPdf && !isImg) {
      setFormError("Please select a valid PDF document or Image file.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(15);

    try {
      const cleanTopicNo = topicNo.trim();
      const cleanTopicName = topicName.trim();
      let computedLabel = "";
      if (cleanTopicNo && cleanTopicName) {
        computedLabel = `Topic ${cleanTopicNo} – ${cleanTopicName}`;
      } else if (cleanTopicNo) {
        computedLabel = `Topic ${cleanTopicNo}`;
      } else if (cleanTopicName) {
        computedLabel = cleanTopicName;
      }
      const cleanPartLabel = computedLabel || partLabel.trim();

      let fileExtension = pdfFile.name.includes(".")
        ? pdfFile.name.split(".").pop()
        : (isImg ? "jpg" : "pdf");
      if (!fileExtension) fileExtension = isImg ? "jpg" : "pdf";

      let uploadPath = "";
      let renamedFileName = pdfFile.name;

      if (isUPSCClass) {
        const upscPathInfo = generateUPSCStoragePath(
          generalStudiesPaper.trim(),
          finalSubject,
          Number(chapterNo),
          chapterTitle.trim(),
          cleanTopicNo,
          cleanTopicName,
          pdfFile.name,
          fileExtension
        );
        uploadPath = upscPathInfo.storagePath;
        renamedFileName = upscPathInfo.fileName;
      } else {
        if (cleanPartLabel) {
          const hasExtension = cleanPartLabel.toLowerCase().endsWith(`.${fileExtension.toLowerCase()}`);
          renamedFileName = hasExtension ? cleanPartLabel : `${cleanPartLabel}.${fileExtension}`;
        }
        uploadPath = `class_notes/${normalizeClassGrade(finalClass).replace(/\s+/g, "_")}/${finalSubject.replace(/\s+/g, "_")}/${Date.now()}_${renamedFileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      }

      const uploadRes = await uploadFileToR2(
        "academy-connect-files",
        uploadPath,
        pdfFile,
        renamedFileName,
        "Admin",
        (percent) => setUploadProgress(percent)
      );

      const mime = pdfFile.type || (isImg ? "image/jpeg" : "application/pdf");
      const fType: "pdf" | "image" = isImg ? "image" : "pdf";
      const nowIso = new Date().toISOString();

      const newNote: ClassNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        classGrade: normalizeClassGrade(finalClass),
        subject: finalSubject,
        chapterNo: Number(chapterNo),
        chapterName: chapterTitle.trim(),
        moduleNo: isUPSCClass ? Number(chapterNo) : undefined,
        moduleName: isUPSCClass ? chapterTitle.trim() : undefined,
        module_number: isUPSCClass ? Number(chapterNo) : undefined,
        module_name: isUPSCClass ? chapterTitle.trim() : undefined,
        generalStudiesPaper: isUPSCClass ? generalStudiesPaper.trim() : undefined,
        gs_paper: isUPSCClass ? generalStudiesPaper.trim() : undefined,
        partLabel: cleanPartLabel ? cleanPartLabel : undefined,
        topicNo: cleanTopicNo ? cleanTopicNo : undefined,
        topicName: cleanTopicName ? cleanTopicName : undefined,
        topic_number: isUPSCClass && cleanTopicNo ? cleanTopicNo : undefined,
        topic_name: isUPSCClass && cleanTopicName ? cleanTopicName : undefined,
        pdfUrl: uploadRes.downloadUrl,
        pdfFileName: renamedFileName,
        fileName: renamedFileName,
        filename: renamedFileName,
        storagePath: uploadRes.storagePath,
        storage_path: uploadRes.storagePath,
        bucket: uploadRes.bucket,
        fileType: fType,
        mimeType: mime,
        mime_type: mime,
        createdAt: nowIso,
        uploadedAt: nowIso,
        uploaded_at: nowIso,
        uploadedBy: "Admin",
      };

      await saveClassNoteDoc(newNote);

      const newClsKey = newNote.classGrade;
      const newSubjKey = `${newNote.classGrade}_${newNote.subject}`;
      const newChKey = `${newNote.classGrade}_${newNote.subject}_Ch${newNote.chapterNo}_${newNote.chapterName}`;

      if (isUPSCClass) {
        const gsKey = `UPSC_${generalStudiesPaper.trim()}`;
        setExpandedGSPapers((prev) => ({ ...prev, [gsKey]: true }));
      }
      setExpandedClasses({ [newClsKey]: true });
      setExpandedSubjects({ [newSubjKey]: true });
      setExpandedChapters({ [newChKey]: true });

      setUploadProgress(100);
      setSuccessMsg("Note uploaded successfully!");

      // Reset Form
      setGeneralStudiesPaper("General Studies Paper I");
      setChapterTitle("");
      setTopicNo("");
      setTopicName("");
      setPartLabel("");
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => {
        setIsUploadModalOpen(false);
        setIsUploading(false);
        setUploadProgress(0);
        setSuccessMsg("");
        if (onRefresh) onRefresh();
      }, 800);
    } catch (err: any) {
      console.error("Failed uploading note:", err);
      const specificErr = err?.message || "Unable to upload notes. Please try again.";
      setFormError(specificErr);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Open Edit/Rename Modal
  const handleOpenEdit = (note: ClassNote) => {
    setEditingNote(note);
    setEditClass(note.classGrade);
    setEditSubject(note.subject);
    setEditGeneralStudiesPaper(note.generalStudiesPaper || (note as any).gs_paper || inferGSPaperFromSubject(note.subject) || "General Studies Paper I");
    setEditChapterNo(note.chapterNo);
    setEditChapterTitle(note.chapterName);
    setEditTopicNo(note.topicNo !== undefined ? String(note.topicNo) : "");
    setEditTopicName(note.topicName || "");
    setEditPartLabel(note.partLabel || "");
  };

  // Save Rename / Edit
  const handleSaveEdit = async () => {
    if (!editingNote) return;
    if (!editClass.trim() || !editSubject.trim() || editChapterNo === "" || !editChapterTitle.trim()) {
      alert("Please fill in all required fields.");
      return;
    }

    setIsEditSaving(true);
    try {
      const isEditUPSC = normalizeClassGrade(editClass.trim()) === "UPSC";
      const cleanTopicNo = editTopicNo.trim();
      const cleanTopicName = editTopicName.trim();
      let computedLabel = "";
      if (cleanTopicNo && cleanTopicName) {
        computedLabel = `Topic ${cleanTopicNo} – ${cleanTopicName}`;
      } else if (cleanTopicNo) {
        computedLabel = `Topic ${cleanTopicNo}`;
      } else if (cleanTopicName) {
        computedLabel = cleanTopicName;
      }
      const cleanPartLabel = computedLabel || editPartLabel.trim();
      let updatedFileName = editingNote.pdfFileName;

      if (cleanPartLabel) {
        const currentFileName = editingNote.pdfFileName || (editingNote as any).fileName || "";
        let ext = currentFileName.includes(".")
          ? currentFileName.split(".").pop()
          : (editingNote.fileType === "image" ? "jpg" : "pdf");
        if (!ext) ext = editingNote.fileType === "image" ? "jpg" : "pdf";

        const hasExtension = cleanPartLabel.toLowerCase().endsWith(`.${ext.toLowerCase()}`);
        updatedFileName = hasExtension ? cleanPartLabel : `${cleanPartLabel}.${ext}`;
      }

      const updatedNote: ClassNote = {
        ...editingNote,
        classGrade: normalizeClassGrade(editClass.trim()),
        subject: editSubject.trim(),
        chapterNo: Number(editChapterNo),
        chapterName: editChapterTitle.trim(),
        moduleNo: isEditUPSC ? Number(editChapterNo) : undefined,
        moduleName: isEditUPSC ? editChapterTitle.trim() : undefined,
        module_number: isEditUPSC ? Number(editChapterNo) : undefined,
        module_name: isEditUPSC ? editChapterTitle.trim() : undefined,
        generalStudiesPaper: isEditUPSC ? editGeneralStudiesPaper.trim() : undefined,
        gs_paper: isEditUPSC ? editGeneralStudiesPaper.trim() : undefined,
        partLabel: cleanPartLabel ? cleanPartLabel : undefined,
        topicNo: cleanTopicNo ? cleanTopicNo : undefined,
        topicName: cleanTopicName ? cleanTopicName : undefined,
        topic_number: isEditUPSC && cleanTopicNo ? cleanTopicNo : undefined,
        topic_name: isEditUPSC && cleanTopicName ? cleanTopicName : undefined,
        pdfFileName: updatedFileName,
        fileName: updatedFileName,
        filename: updatedFileName,
      };

      const newClsKey = updatedNote.classGrade;
      const newSubjKey = `${updatedNote.classGrade}_${updatedNote.subject}`;
      const newChKey = `${updatedNote.classGrade}_${updatedNote.subject}_Ch${updatedNote.chapterNo}_${updatedNote.chapterName}`;

      if (isEditUPSC) {
        const gsKey = `UPSC_${editGeneralStudiesPaper.trim()}`;
        setExpandedGSPapers((prev) => ({ ...prev, [gsKey]: true }));
      }
      setExpandedClasses((prev) => ({ ...prev, [newClsKey]: true }));
      setExpandedSubjects((prev) => ({ ...prev, [newSubjKey]: true }));
      setExpandedChapters((prev) => ({ ...prev, [newChKey]: true }));

      await saveClassNoteDoc(updatedNote);
      setEditingNote(null);
      if (onRefresh) onRefresh();
    } catch (e: any) {
      console.error(e);
      alert("Unable to update topic. Please try again.");
    } finally {
      setIsEditSaving(false);
    }
  };

  // Open Replace Modal with Pre-flight Validation and Pipeline Logging
  const handleOpenReplace = (note: ClassNote) => {
    console.log(`[ReplacePipeline] 1. User tapped Replace for note "${note.id}"`);
    console.log(`[ReplacePipeline] 2. Loaded existing note record:`, note);

    const isUPSC = normalizeClassGrade(note.classGrade) === "UPSC";
    const noteId = note.id;
    const bucket = note.bucket || "academy-connect-files";
    const storagePath = note.storagePath || (note as any).storage_path || "";
    const filename = note.pdfFileName || (note as any).fileName || (note as any).filename || (storagePath ? storagePath.split("/").pop() : "");
    const mimeType = note.mimeType || (note as any).mime_type || (note.fileType === "image" ? "image/jpeg" : "application/pdf");

    console.log(`[ReplacePipeline] 3. Resolved note id: "${noteId}"`);
    console.log(`[ReplacePipeline] 4. Resolved bucket: "${bucket}"`);
    console.log(`[ReplacePipeline] 5. Resolved storage_path: "${storagePath}"`);
    console.log(`[ReplacePipeline] Resolved filename: "${filename}", mime_type: "${mimeType}"`);

    // Verify existing metadata
    const missing: string[] = [];
    if (!noteId) missing.push("note id");
    if (!bucket) missing.push("bucket");
    if (!storagePath) missing.push("storage_path");
    if (!filename) missing.push("filename");
    if (!mimeType) missing.push("mime_type");

    if (missing.length > 0) {
      const errorMsg = `Invalid note metadata: Missing required fields (${missing.join(", ")}). Unable to replace file.`;
      console.error(`[ReplacePipeline] Pre-validation failed:`, errorMsg, note);
      alert(errorMsg);
      return;
    }

    setReplaceError(null);
    setReplaceNote(note);
    setReplaceFile(null);
    if (replaceFileInputRef.current) {
      replaceFileInputRef.current.value = "";
    }
  };

  // Save Replace PDF / Image
  const handleSaveReplacePdf = async () => {
    if (!replaceNote) {
      const err = "No target note selected for replacement.";
      console.error(`[ReplacePipeline] ${err}`);
      setReplaceError(err);
      return;
    }

    if (!replaceFile) {
      const err = "Please select a new PDF document or Image file to proceed with replacement.";
      console.error(`[ReplacePipeline] ${err}`);
      setReplaceError(err);
      return;
    }

    const isPdf = replaceFile.type === "application/pdf" || replaceFile.name.toLowerCase().endsWith(".pdf");
    const isImg = replaceFile.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(replaceFile.name);

    if (!isPdf && !isImg) {
      const err = "Invalid file type: Please select a valid PDF (.pdf) or Image file (.jpg, .png, .webp).";
      setReplaceError(err);
      alert(err);
      return;
    }

    const isUPSC = normalizeClassGrade(replaceNote.classGrade) === "UPSC";
    const noteId = replaceNote.id;
    const bucket = replaceNote.bucket || "academy-connect-files";
    const oldStoragePath = replaceNote.storagePath || (replaceNote as any).storage_path || "";
    const oldFilename = replaceNote.pdfFileName || (replaceNote as any).fileName || (replaceNote as any).filename || (oldStoragePath ? oldStoragePath.split("/").pop() : "");
    const oldMimeType = replaceNote.mimeType || (replaceNote as any).mime_type || (replaceNote.fileType === "image" ? "image/jpeg" : "application/pdf");

    console.log(`[ReplacePipeline] Starting replace execution for note "${noteId}" (Class: "${replaceNote.classGrade}", UPSC: ${isUPSC})`);
    console.log(`[ReplacePipeline] 2. Loaded existing note record:`, replaceNote);
    console.log(`[ReplacePipeline] 3. Resolved note id: "${noteId}"`);
    console.log(`[ReplacePipeline] 4. Resolved bucket: "${bucket}"`);
    console.log(`[ReplacePipeline] 5. Resolved storage_path: "${oldStoragePath}"`);
    console.log(`[ReplacePipeline] 6. Selected new file: "${replaceFile.name}" (${(replaceFile.size / (1024 * 1024)).toFixed(2)} MB, type: "${replaceFile.type}")`);

    // Verify existing metadata
    const missingMetadata: string[] = [];
    if (!noteId) missingMetadata.push("note id");
    if (!bucket) missingMetadata.push("bucket");
    if (!oldStoragePath) missingMetadata.push("storage_path");
    if (!oldFilename) missingMetadata.push("filename");
    if (!oldMimeType) missingMetadata.push("mime_type");

    if (missingMetadata.length > 0) {
      const errorMsg = `Missing required note metadata: ${missingMetadata.join(", ")}. Replacement halted.`;
      console.error(`[ReplacePipeline] Metadata validation failed: ${errorMsg}`);
      setReplaceError(errorMsg);
      alert(errorMsg);
      return;
    }

    // Verify storage path format
    if (typeof oldStoragePath !== "string" || oldStoragePath.trim() === "") {
      const errorMsg = "Invalid storage path on existing note record.";
      console.error(`[ReplacePipeline] ${errorMsg}`);
      setReplaceError(errorMsg);
      alert(errorMsg);
      return;
    }

    setIsReplacing(true);
    setReplaceError(null);

    try {
      let fileExtension = replaceFile.name.includes(".")
        ? replaceFile.name.split(".").pop()
        : (isImg ? "jpg" : "pdf");
      if (!fileExtension) fileExtension = isImg ? "jpg" : "pdf";

      let uploadPath = "";
      let renamedFileName = replaceFile.name;

      if (isUPSC) {
        // UPSC HIERARCHY: GS Paper -> Subject -> Module -> Topic (NO Chapter / Chapter Number)
        const gsPaper = replaceNote.generalStudiesPaper || (replaceNote as any).gs_paper || inferGSPaperFromSubject(replaceNote.subject) || "General Studies Paper I";
        const subject = replaceNote.subject.trim();
        const moduleNo = (replaceNote as any).module_number ?? (replaceNote as any).moduleNo ?? replaceNote.chapterNo ?? 1;
        const moduleName = (replaceNote as any).module_name || (replaceNote as any).moduleName || replaceNote.chapterName || `Module ${moduleNo}`;
        const topicNo = (replaceNote as any).topic_number ?? replaceNote.topicNo;
        const topicName = (replaceNote as any).topic_name || replaceNote.topicName || replaceNote.partLabel;

        console.log(`[ReplacePipeline] UPSC Hierarchy resolved:`, {
          gsPaper,
          subject,
          moduleNo,
          moduleName,
          topicNo,
          topicName,
        });

        const upscPathInfo = generateUPSCStoragePath(
          gsPaper,
          subject,
          moduleNo,
          moduleName,
          topicNo,
          topicName,
          replaceFile.name,
          fileExtension
        );
        uploadPath = upscPathInfo.storagePath;
        renamedFileName = upscPathInfo.fileName;
      } else {
        // Standard class hierarchy: Class -> Subject -> Chapter -> Topic
        const cleanPartLabel = (replaceNote.partLabel || "").trim();
        if (cleanPartLabel) {
          const hasExtension = cleanPartLabel.toLowerCase().endsWith(`.${fileExtension.toLowerCase()}`);
          renamedFileName = hasExtension ? cleanPartLabel : `${cleanPartLabel}.${fileExtension}`;
        }
        uploadPath = `class_notes/${normalizeClassGrade(replaceNote.classGrade).replace(/\s+/g, "_")}/${replaceNote.subject.replace(/\s+/g, "_")}/${Date.now()}_${renamedFileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      }

      console.log(`[ReplacePipeline] Target storage upload path: "${uploadPath}" (filename: "${renamedFileName}")`);

      // 7. Deleting old storage object (if applicable)
      if (oldStoragePath) {
        console.log(`[ReplacePipeline] 7. Deleting old storage object (if applicable): "${oldStoragePath}" from bucket "${bucket}"`);
        try {
          await deleteFileFromStorage(oldStoragePath, bucket);
          console.log(`[ReplacePipeline] Old storage object removed: "${oldStoragePath}"`);
        } catch (delErr) {
          // If existing object was already missing or deleted, do not abort
          console.warn(`[ReplacePipeline] Notice: Existing storage object was not present or already removed (proceeding with upload):`, delErr);
        }
      }

      // 8. Uploading new file
      console.log(`[ReplacePipeline] 8. Uploading new file to Cloudflare R2 Storage: "${uploadPath}"`);
      let uploadRes: { storagePath: string; downloadUrl: string; bucket: string };
      try {
        uploadRes = await uploadFileToR2(
          bucket,
          uploadPath,
          replaceFile,
          renamedFileName,
          "Admin",
          (percent) => setUploadProgress(percent)
        );
      } catch (uploadErr: any) {
        const uploadDetail = uploadErr?.message || "Supabase Storage upload error";
        console.error(`[ReplacePipeline] Storage upload failed:`, uploadErr);
        throw new Error(`Storage upload failed: ${uploadDetail}`);
      }

      // 9. Upload complete
      console.log(`[ReplacePipeline] 9. Upload complete:`, uploadRes);

      // 10. Updating database record
      console.log(`[ReplacePipeline] 10. Updating database record for note "${noteId}"`);
      const mime = replaceFile.type || (isImg ? "image/jpeg" : "application/pdf");
      const fType: "pdf" | "image" = isImg ? "image" : "pdf";
      const nowIso = new Date().toISOString();

      const updatedNote: ClassNote = {
        ...replaceNote,
        // Update ONLY file-related fields and update timestamps:
        pdfUrl: uploadRes.downloadUrl,
        pdfFileName: renamedFileName,
        fileName: renamedFileName,
        filename: renamedFileName,
        storagePath: uploadRes.storagePath,
        storage_path: uploadRes.storagePath,
        bucket: uploadRes.bucket,
        fileType: fType,
        fileSize: replaceFile.size,
        file_size: replaceFile.size,
        mimeType: mime,
        mime_type: mime,
        updatedAt: nowIso,
        updated_at: nowIso,
        // Explicitly preserve all UPSC / class / subject / module / topic / access / created timestamps
        id: replaceNote.id,
        classGrade: replaceNote.classGrade,
        subject: replaceNote.subject,
        chapterNo: replaceNote.chapterNo,
        chapterName: replaceNote.chapterName,
        moduleNo: replaceNote.moduleNo,
        moduleName: replaceNote.moduleName,
        module_number: replaceNote.module_number,
        module_name: replaceNote.module_name,
        generalStudiesPaper: replaceNote.generalStudiesPaper,
        gs_paper: (replaceNote as any).gs_paper,
        partLabel: replaceNote.partLabel,
        topicNo: replaceNote.topicNo,
        topicName: replaceNote.topicName,
        topic_number: (replaceNote as any).topic_number,
        topic_name: (replaceNote as any).topic_name,
        accessType: replaceNote.accessType,
        allowedStudentIds: replaceNote.allowedStudentIds,
        allowedClasses: replaceNote.allowedClasses,
        createdAt: replaceNote.createdAt,
        uploadedAt: replaceNote.uploadedAt || replaceNote.createdAt,
        uploaded_at: (replaceNote as any).uploaded_at || replaceNote.createdAt,
        uploadedBy: replaceNote.uploadedBy || "Admin",
      };

      try {
        await saveClassNoteDoc(updatedNote);
        console.log(`[ReplacePipeline] Database record updated successfully for note "${noteId}"`);
      } catch (dbErr: any) {
        const dbDetail = dbErr?.message || "Supabase DB update error";
        console.error(`[ReplacePipeline] Database update failed:`, dbErr);
        throw new Error(`Database update failed: ${dbDetail}`);
      }

      // Invalidate caches
      try {
        await invalidateNoteCache(noteId);
        if (oldStoragePath) await invalidateNoteCache(oldStoragePath);
        if (uploadRes.storagePath) await invalidateNoteCache(uploadRes.storagePath);
        window.dispatchEvent(new CustomEvent("notes-updated", { detail: { noteId, updatedNote } }));
      } catch (cacheErr) {
        console.warn("[ReplacePipeline] Cache invalidation notice:", cacheErr);
      }

      // 11. Refreshing notes
      console.log(`[ReplacePipeline] 11. Refreshing notes`);
      setReplaceNote(null);
      setReplaceFile(null);
      if (replaceFileInputRef.current) replaceFileInputRef.current.value = "";
      if (onRefresh) onRefresh();

      // 12. Success
      console.log(`[ReplacePipeline] 12. Success: Note "${noteId}" replaced cleanly`);
    } catch (e: any) {
      const actualError = e?.message || "An unexpected error occurred during replacement.";
      console.error(`[ReplacePipeline] Execution stopped with error:`, e);
      setReplaceError(actualError);
      alert(`Replace failed: ${actualError}`);
    } finally {
      setIsReplacing(false);
    }
  };

  // Permanent Delete confirmation with cascading cleanup auditing
  const handleConfirmDelete = async () => {
    if (!deletingNote || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const deletedNoteId = deletingNote.id;
      const targetClass = deletingNote.classGrade;
      const targetSubject = deletingNote.subject;
      const targetChapterNo = deletingNote.chapterNo;
      const targetChapterName = deletingNote.chapterName;
      const targetPartLabel = deletingNote.partLabel || deletingNote.id;
      const bucket = deletingNote.bucket || "academy-connect-files";
      const rawStoragePath = deletingNote.storagePath || deletingNote.pdfUrl || "";

      // 1. Delete actual uploaded file from Supabase Storage using its stored storage path/key
      if (rawStoragePath) {
        try {
          await deleteFileFromStorage(rawStoragePath, bucket);
          console.log(`[AdminNotesView] Successfully deleted storage file: ${rawStoragePath}`);
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
            console.warn(`[AdminNotesView] Storage object already removed or missing: ${rawStoragePath}. Proceeding with database record deletion.`);
          } else {
            console.error(`[AdminNotesView] Storage deletion error:`, storageErr);
            throw new Error(`Storage deletion failed: ${errMsg}`);
          }
        }
      }

      // 2. Only after storage object is removed (or already missing): Delete database record
      await deleteClassNoteDoc(deletedNoteId);

      // 3. Clear deleting target and trigger immediate UI refresh
      setDeletingNote(null);
      if (onRefresh) onRefresh();
    } catch (e: any) {
      console.error("[AdminNotesView] Delete note error:", e);
      const realErrMsg = e?.message || "Database deletion failed.";
      setDeleteError(realErrMsg);
      alert(`Delete failed: ${realErrMsg}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12" id="admin-notes-container">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-blue-300 text-xs font-bold uppercase tracking-widest mb-1">
              <FolderKanban className="w-4 h-4" />
              Central Notes Repository
            </div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              📚 Notes Management
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-lg">
              Upload study notes once by Class and Subject. Eligible students automatically receive them in real-time.
            </p>
          </div>

          <button
            onClick={() => {
              setFormError("");
              setSuccessMsg("");
              setIsUploadModalOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-blue-900/50 transition-all cursor-pointer border border-blue-400/30 shrink-0"
            id="admin-upload-note-btn"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            Upload Notes
          </button>
        </div>
      </div>

      {/* Search Bar & Stats */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Class, Subject, Chapter, Title..."
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            id="admin-notes-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <span>Total Uploaded PDFs: <strong className="text-slate-900 dark:text-slate-100">{notes.length}</strong></span>
        </div>
      </div>

      {/* Class -> Subject -> Chapter -> Part Hierarchy View */}
      {hierarchy.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 shadow-sm">
          <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
            {searchQuery ? "No matching notes found" : "No study notes uploaded yet"}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? "Try adjusting your search query to find notes by Class or Subject."
              : "Click 'Upload Notes' to add PDFs for Class 6 to 12. All enrolled students will automatically receive them."}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg shadow hover:bg-blue-500 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Upload First Note
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {hierarchy.map((clsGroup) => {
            const isClsExpanded = !!expandedClasses[clsGroup.classGrade];

            return (
              <div
                key={clsGroup.classGrade}
                className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-md overflow-hidden transition-all"
              >
                {/* Class Grade Header */}
                <button
                  type="button"
                  onClick={() => toggleClassExpand(clsGroup.classGrade)}
                  className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between transition-all cursor-pointer text-left border-b border-slate-100 dark:border-slate-800"
                >
                  <div className="flex items-center gap-3">
                    <span className="p-2 bg-blue-600 text-white rounded-lg shadow-sm font-black text-xs">
                      🎓
                    </span>
                    <div>
                      <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                        {clsGroup.classGrade}
                      </h2>
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {clsGroup.subjects.length} {clsGroup.subjects.length === 1 ? "Subject" : "Subjects"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="text-xs font-bold bg-slate-200 dark:bg-slate-700/60 px-2.5 py-0.5 rounded-full text-slate-700 dark:text-slate-300">
                      {clsGroup.subjects.reduce((sum, s) => sum + s.chapters.reduce((cSum, ch) => cSum + ch.parts.length, 0), 0)} Notes
                    </span>
                    {isClsExpanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-500" />
                    )}
                  </div>
                </button>

                {/* Subjects under Class */}
                {isClsExpanded && (
                  <div className="p-4 sm:p-5 space-y-4 bg-slate-50/50 dark:bg-slate-900/40">
                    {clsGroup.subjects.map((subjGroup) => {
                      const subjKey = `${clsGroup.classGrade}_${subjGroup.subject}`;
                      const isSubjExpanded = !!expandedSubjects[subjKey];

                      return (
                        <div
                          key={subjGroup.subject}
                          className="bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/70 overflow-hidden shadow-sm"
                        >
                          {/* Subject Header */}
                          <button
                            type="button"
                            onClick={() => toggleSubjectExpand(subjKey, clsGroup.classGrade)}
                            className="w-full px-4 py-3 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center justify-between cursor-pointer text-left border-b border-blue-100/50 dark:border-slate-700/50"
                          >
                            <div className="flex items-center gap-2.5">
                              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                                {subjGroup.subject}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100/80 dark:bg-blue-900/50 px-2 py-0.5 rounded">
                                {subjGroup.chapters.length} {subjGroup.chapters.length === 1 ? "Chapter" : "Chapters"}
                              </span>
                              {isSubjExpanded ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                          </button>

                          {/* Chapters under Subject */}
                          {isSubjExpanded && (
                            <div className="p-3 sm:p-4 space-y-3">
                              {subjGroup.chapters.map((chGroup) => {
                                const chKey = `${clsGroup.classGrade}_${subjGroup.subject}_Ch${chGroup.chapterNo}_${chGroup.chapterName}`;
                                const parentSubjPrefix = `${clsGroup.classGrade}_${subjGroup.subject}_`;
                                const isChExpanded = !!expandedChapters[chKey];

                                return (
                                  <div
                                    key={chKey}
                                    className="bg-slate-50 dark:bg-slate-900/80 rounded-xl border border-slate-200/70 dark:border-slate-700/70 overflow-hidden shadow-2xs"
                                  >
                                    {/* Chapter number with name on same row (collapsible trigger) */}
                                    <div className="w-full px-3.5 py-2.5 bg-slate-100/80 dark:bg-slate-800/80 flex items-center justify-between transition-colors gap-3">
                                      <button
                                        type="button"
                                        onClick={() => toggleChapterExpand(chKey, parentSubjPrefix)}
                                        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer text-left"
                                      >
                                        <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                            <span className="text-xs font-black text-indigo-700 dark:text-indigo-300 shrink-0">
                                              Chapter {chGroup.chapterNo}:
                                            </span>
                                            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug break-words">
                                              {chGroup.chapterName}
                                            </span>
                                          </div>
                                        </div>
                                      </button>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {/* Manage Access Button for Chapter */}
                                        <button
                                          type="button"
                                          onClick={() => handleOpenManageAccessForChapter(clsGroup.classGrade, subjGroup.subject, chGroup)}
                                          className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/80 border border-blue-200 dark:border-blue-800/60 transition-all cursor-pointer text-xs font-bold flex items-center gap-1.5 shadow-2xs"
                                          title="Manage Student Access / Permissions for this Chapter"
                                        >
                                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                          <span className="hidden sm:inline">Manage Access</span>
                                        </button>

                                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                          {chGroup.parts.length} {chGroup.parts.length === 1 ? "Topic" : "Topics"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => toggleChapterExpand(chKey, parentSubjPrefix)}
                                          className="p-1 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 rounded cursor-pointer"
                                        >
                                          {isChExpanded ? (
                                            <ChevronDown className="w-4 h-4 text-slate-400" />
                                          ) : (
                                            <ChevronRight className="w-4 h-4 text-slate-400" />
                                          )}
                                        </button>
                                      </div>
                                    </div>

                                    {/* Parts (collapsible) (arranged in ascending order as per part no.) */}
                                    {isChExpanded && (
                                      <div className="p-3 space-y-2 bg-white dark:bg-slate-900/40">
                                        {chGroup.parts.map((note) => (
                                          <div
                                            key={note.id}
                                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2.5 bg-slate-50/80 dark:bg-slate-800/60 rounded-lg border border-slate-200/80 dark:border-slate-700/80 hover:border-blue-400 dark:hover:border-blue-500 transition-all shadow-2xs"
                                          >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                              <div className="p-1.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md shrink-0">
                                                <FileText className="w-4 h-4" />
                                              </div>
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  {note.partLabel ? (
                                                    <>
                                                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800/40">
                                                        {getFormattedTopicLabel(note)}
                                                      </span>
                                                      {!isFileNameRedundant(note.partLabel, note.pdfFileName) && note.pdfFileName && (
                                                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                          {note.pdfFileName}
                                                        </span>
                                                      )}
                                                    </>
                                                  ) : (
                                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                                                      {getFormattedTopicLabel(note) || note.pdfFileName || `${note.chapterName}.pdf`}
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                                  <span className="text-[10px] text-slate-400">
                                                    Uploaded {new Date(note.createdAt).toLocaleDateString()}
                                                  </span>
                                                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded ${
                                                    (note.allowedClasses && note.allowedClasses.length > 0) || note.accessType === "selected"
                                                      ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" 
                                                      : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                                                  }`}>
                                                    {note.allowedClasses && note.allowedClasses.length > 0
                                                      ? `${note.allowedClasses.length} Class${note.allowedClasses.length === 1 ? '' : 'es'}`
                                                      : note.accessType === "selected"
                                                      ? `${note.allowedStudentIds?.length || 0} Students`
                                                      : "All Students"}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>

                                            {/* Compact Icon-only Action Buttons */}
                                            <div className="flex items-center gap-1.5 shrink-0 pt-1.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/50 dark:border-slate-700/50 justify-end">
                                              {/* Practice Test Button */}
                                              <button
                                                type="button"
                                                onClick={() => setPracticeTestTarget({
                                                  classGrade: note.classGrade || clsGroup.classGrade,
                                                  subject: note.subject || subjGroup.subject,
                                                  chapterNo: note.chapterNo || chGroup.chapterNo,
                                                  chapterName: note.chapterName || chGroup.chapterName,
                                                  topicName: getFormattedTopicLabel(note) || note.topicName || note.partLabel || "Topic 1"
                                                })}
                                                className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/60 dark:border-emerald-800/40 transition-all cursor-pointer text-xs font-bold flex items-center gap-1 shadow-2xs"
                                                title="Manage Practice Test for this Topic"
                                              >
                                                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                <span>Practice Test</span>
                                              </button>

                                              {/* View PDF */}
                                              <button
                                                onClick={() => setPreviewPdf({
                                                  url: note.pdfUrl || "",
                                                  title: `[${note.classGrade}] ${note.subject} - Ch ${note.chapterNo}: ${note.chapterName}${note.partLabel ? ` (${note.partLabel})` : ""}`,
                                                  noteId: note.id,
                                                  storagePath: note.storagePath || note.pdfUrl,
                                                  bucket: note.bucket,
                                                  fileName: note.fileName || note.pdfFileName || note.filename || `${note.chapterName || "Note"}.${note.fileType === "image" ? "png" : "pdf"}`,
                                                  mimeType: note.mimeType || note.mime_type,
                                                  fileType: note.fileType,
                                                })}
                                                className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200/50 dark:border-blue-800/40 transition-all cursor-pointer"
                                                title="View PDF"
                                              >
                                                <Eye className="w-3.5 h-3.5" />
                                              </button>

                                              {/* Replace PDF */}
                                              <button
                                                onClick={() => handleOpenReplace(note)}
                                                className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200/50 dark:border-indigo-800/40 transition-all cursor-pointer"
                                                title="Replace PDF file"
                                              >
                                                <RefreshCw className="w-3.5 h-3.5" />
                                              </button>

                                              {/* Edit / Rename */}
                                              <button
                                                onClick={() => handleOpenEdit(note)}
                                                className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200/50 dark:border-amber-800/40 transition-all cursor-pointer"
                                                title="Rename or edit note details"
                                              >
                                                <Pencil className="w-3.5 h-3.5" />
                                              </button>

                                              {/* Delete */}
                                              <button
                                                onClick={() => setDeletingNote(note)}
                                                className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200/50 dark:border-rose-800/40 transition-all cursor-pointer"
                                                title="Delete note permanently"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================== */}
      {/* UPLOAD NOTES DIALOG / MODAL                          */}
      {/* ==================================================== */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                <h3 className="text-base font-bold">Upload Study Notes</h3>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSave} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Class * */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Class <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedClass}
                  onChange={(e) => {
                    const newCls = e.target.value;
                    setSelectedClass(newCls);
                    const norm = normalizeClassGrade(newCls === "Other" ? customClass : newCls);
                    const defs = DEFAULT_SUBJECTS_BY_CLASS[norm];
                    if (defs && defs.length > 0 && !defs.includes(selectedSubject)) {
                      setSelectedSubject(defs[0]);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {DEFAULT_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                  <option value="Other">Custom Class...</option>
                </select>

                {selectedClass === "Other" && (
                  <input
                    type="text"
                    value={customClass}
                    onChange={(e) => {
                      const newCustom = e.target.value;
                      setCustomClass(newCustom);
                      const norm = normalizeClassGrade(newCustom);
                      const defs = DEFAULT_SUBJECTS_BY_CLASS[norm];
                      if (defs && defs.length > 0 && !defs.includes(selectedSubject)) {
                        setSelectedSubject(defs[0]);
                      }
                    }}
                    placeholder="Enter custom class (e.g. Class 5)"
                    className="w-full mt-2 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                )}
              </div>

              {/* Subject * */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Subject <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {availableSubjects.map((subj) => (
                    <option key={subj} value={subj}>
                      {subj}
                    </option>
                  ))}
                  <option value="Other">Custom Subject...</option>
                </select>

                {selectedSubject === "Other" && (
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="Enter subject name (e.g. History)"
                    className="w-full mt-2 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                )}
              </div>

              {/* General Studies Paper (Only for UPSC) */}
              {isUPSC && (
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    General Studies Paper <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={generalStudiesPaper}
                    onChange={(e) => setGeneralStudiesPaper(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    {UPSC_GS_PAPERS.map((paper) => (
                      <option key={paper} value={paper}>
                        {paper}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Chapter Number & Title */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    {isUPSC ? "Module Number" : "Chapter Number"} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={chapterNo}
                    onChange={(e) => setChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="1"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    {isUPSC ? "Module Name" : "Chapter Title"} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder={isUPSC ? "e.g. Indian Polity Fundamentals" : "e.g. Indian Culture"}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              {/* Topic (No.) & Topic (Name) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Topic (No.) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={topicNo}
                    onChange={(e) => setTopicNo(e.target.value)}
                    placeholder="e.g. 1"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                    Topic (Name) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="e.g. Introduction & Basics"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* PDF or Image File */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  PDF or Image File <span className="text-rose-500">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
                      const isImg = file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(file.name);
                      if (!isPdf && !isImg) {
                        setFormError("Please select a valid PDF document or Image file.");
                        setPdfFile(null);
                        return;
                      }
                      setPdfFile(file);
                      setFormError("");
                    }
                  }}
                  className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-800 dark:file:text-slate-200 cursor-pointer"
                  required
                />
                {pdfFile && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold block mt-1">
                    Selected: {pdfFile.name} ({(pdfFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                )}
              </div>

              {/* Upload Progress Bar */}
              {isUploading && (
                <div className="space-y-1 pt-2">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-600 dark:text-blue-400">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                  disabled={isUploading}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Save
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* EDIT / RENAME NOTE MODAL                             */}
      {/* ==================================================== */}
      {editingNote && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
                <Pencil className="w-4 h-4 text-amber-500" />
                Rename / Edit Note Details
              </div>
              <button
                onClick={() => setEditingNote(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Class
                </label>
                <input
                  type="text"
                  value={editClass}
                  onChange={(e) => setEditClass(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Chapter Number
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editChapterNo}
                    onChange={(e) => setEditChapterNo(e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Chapter Title
                  </label>
                  <input
                    type="text"
                    value={editChapterTitle}
                    onChange={(e) => setEditChapterTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Topic (No.) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={editTopicNo}
                    onChange={(e) => setEditTopicNo(e.target.value)}
                    placeholder="e.g. 1"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Topic (Name) <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={editTopicName}
                    onChange={(e) => setEditTopicName(e.target.value)}
                    placeholder="e.g. Introduction"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 font-semibold"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isEditSaving}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 rounded-lg shadow cursor-pointer flex items-center gap-1.5"
                >
                  {isEditSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* REPLACE PDF / IMAGE FILE MODAL                       */}
      {/* ==================================================== */}
      {replaceNote && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
                <RefreshCw className="w-4 h-4 text-indigo-500" />
                Replace Note Document / Image
              </div>
              <button
                onClick={() => {
                  setReplaceNote(null);
                  setReplaceError(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Replace Error Alert */}
              {replaceError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div>
                    <span className="font-bold block">Replacement Error:</span>
                    <span>{replaceError}</span>
                  </div>
                </div>
              )}

              {/* Target Note Details */}
              <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900/40 text-xs space-y-1">
                <span className="font-extrabold text-indigo-900 dark:text-indigo-200 block">
                  Target Note:
                </span>
                {normalizeClassGrade(replaceNote.classGrade) === "UPSC" ? (
                  <>
                    <div className="text-slate-700 dark:text-slate-300 font-medium">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] mr-1.5">
                        UPSC
                      </span>
                      {replaceNote.generalStudiesPaper || (replaceNote as any).gs_paper || inferGSPaperFromSubject(replaceNote.subject)}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 text-[11px]">
                      {replaceNote.subject} &bull; Module {(replaceNote as any).module_number ?? (replaceNote as any).moduleNo ?? replaceNote.chapterNo ?? 1}: {(replaceNote as any).module_name || (replaceNote as any).moduleName || replaceNote.chapterName || `Module ${replaceNote.chapterNo}`}
                    </div>
                    {((replaceNote as any).topic_number !== undefined || replaceNote.topicNo !== undefined || replaceNote.topicName || (replaceNote as any).topic_name || replaceNote.partLabel) && (
                      <div className="text-indigo-600 dark:text-indigo-400 font-semibold text-[11px]">
                        Topic: {getFormattedTopicLabel({
                          topicNo: (replaceNote as any).topic_number ?? replaceNote.topicNo,
                          topicName: (replaceNote as any).topic_name || replaceNote.topicName || replaceNote.partLabel,
                          partLabel: replaceNote.partLabel,
                          pdfFileName: replaceNote.pdfFileName
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-600 dark:text-slate-300">
                    [{replaceNote.classGrade}] {replaceNote.subject} &mdash; Chapter {replaceNote.chapterNo}: {replaceNote.chapterName}
                    {replaceNote.partLabel && ` (${replaceNote.partLabel})`}
                  </div>
                )}
                <div className="text-slate-400 dark:text-slate-500 text-[10px] pt-0.5">
                  Current file: <span className="font-mono">{replaceNote.pdfFileName || (replaceNote as any).fileName || "document.pdf"}</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Select New PDF or Image File
                </label>
                <input
                  ref={replaceFileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      console.log(`[ReplacePipeline] 6. Selected new file: "${f.name}" (${(f.size / (1024 * 1024)).toFixed(2)} MB, type: "${f.type}")`);
                      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
                      const isImg = f.type.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(f.name);
                      if (!isPdf && !isImg) {
                        const err = "Please select a valid PDF document (.pdf) or image file (.jpg, .png, etc.).";
                        setReplaceError(err);
                        alert(err);
                        setReplaceFile(null);
                        return;
                      }
                      setReplaceError(null);
                      setReplaceFile(f);
                    }
                  }}
                  className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-950/60 dark:file:text-indigo-300 hover:file:bg-indigo-100 cursor-pointer"
                />
                {replaceFile && (
                  <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-1">
                    Ready to upload: {replaceFile.name} ({(replaceFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </div>
                )}
              </div>

              {/* Upload Progress */}
              {isReplacing && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    <span>Uploading & Replacing...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setReplaceNote(null);
                    setReplaceError(null);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  disabled={isReplacing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReplacePdf}
                  disabled={!replaceFile || isReplacing}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg shadow cursor-pointer flex items-center gap-1.5"
                >
                  {isReplacing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Replacing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      Replace File
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* MANAGE STUDENT ACCESS MODAL (CHAPTER LEVEL)          */}
      {/* ==================================================== */}
      {manageAccessChapter && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8">
            <div className="px-6 py-4 bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold">Manage Student Access</h3>
              </div>
              <button
                onClick={() => setManageAccessChapter(null)}
                className="text-slate-300 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-100 dark:border-blue-900/50">
                <span className="text-xs font-bold text-blue-900 dark:text-blue-200 block">
                  [{manageAccessChapter.classGrade}] – {manageAccessChapter.subject}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-300 font-semibold block mt-0.5">
                  Chapter {manageAccessChapter.chapterNo}: {manageAccessChapter.chapterName} ({manageAccessChapter.parts.length} {manageAccessChapter.parts.length === 1 ? "PDF File" : "PDF Files"})
                </span>
              </div>

              {accessMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{accessMsg}</span>
                </div>
              )}

              {/* Class Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-slate-500 tracking-wider">
                    Select Classes To Share Notes With
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={handleClearAllClasses}
                      className="text-[10px] font-bold text-slate-500 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-52 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  {allAvailableClasses.map((cls) => {
                    const normClass = normalizeClassGrade(cls);
                    const isSelected = selectedClassesForAccess.includes(normClass);
                    const countInClass = (students || []).filter(
                      (s) => normalizeClassGrade(s.classGrade) === normClass
                    ).length;

                    return (
                      <button
                        key={cls}
                        type="button"
                        onClick={() => handleToggleClassForAccess(cls)}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? "bg-blue-50 border-blue-500 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-500 ring-2 ring-blue-500/20"
                            : "bg-white border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                          }`}>
                            {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-xs font-bold truncate">{cls}</span>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400 shrink-0 ml-1">
                          {countInClass} std
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Students Receiving Access Preview */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-slate-500 tracking-wider">
                    Students With Access
                  </label>
                  <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                    {(students || []).filter((s) =>
                      selectedClassesForAccess.includes(normalizeClassGrade(s.classGrade))
                    ).length} Student(s) Total
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  {students && students.length > 0 ? (
                    (() => {
                      const accessStudents = students.filter((s) =>
                        selectedClassesForAccess.includes(normalizeClassGrade(s.classGrade))
                      );

                      if (accessStudents.length === 0) {
                        return (
                          <div className="p-3 text-center text-xs text-slate-400 font-semibold">
                            No students in selected classes.
                          </div>
                        );
                      }

                      return accessStudents.map((s) => (
                        <div
                          key={s.id}
                          className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-slate-800 dark:text-slate-200 block truncate">
                              {s.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {s.classGrade} {s.rollNo ? `• Roll #${s.rollNo}` : ""}
                            </span>
                          </div>
                          <span className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded">
                            Granted
                          </span>
                        </div>
                      ));
                    })()
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400 font-semibold">
                      No registered students found.
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setManageAccessChapter(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                  disabled={isSavingAccess}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveManageAccess}
                  className="px-5 py-2 text-xs font-extrabold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
                  disabled={isSavingAccess}
                >
                  {isSavingAccess ? "Saving..." : "Save Permissions"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* DELETE CONFIRMATION MODAL                            */}
      {/* ==================================================== */}
      {deletingNote && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col gap-4 animate-fadeIn">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Delete Chapter Topic?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1">
              <div className="font-bold text-slate-800 dark:text-slate-200">
                {deletingNote.classGrade} • {deletingNote.subject}
              </div>
              <div className="text-slate-600 dark:text-slate-400">
                Chapter {deletingNote.chapterNo}: {deletingNote.chapterName} {deletingNote.partLabel ? `(${deletingNote.partLabel})` : ""}
              </div>
              <div className="text-[11px] text-slate-400 font-mono truncate">
                File: {deletingNote.pdfFileName}
              </div>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setDeletingNote(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer disabled:opacity-50"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  "Delete Permanently"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* PRACTICE TEST MODAL                                  */}
      {/* ==================================================== */}
      {practiceTestTarget && (
        <AdminPracticeTestModal
          isOpen={!!practiceTestTarget}
          onClose={() => setPracticeTestTarget(null)}
          onPracticeTestChanged={() => {
            // Background update - keep modal open
          }}
          classGrade={practiceTestTarget.classGrade}
          subject={practiceTestTarget.subject}
          chapterNo={practiceTestTarget.chapterNo}
          chapterName={practiceTestTarget.chapterName}
          topicName={practiceTestTarget.topicName}
        />
      )}

      {/* ==================================================== */}
      {/* PDF / IMAGE VIEWER MODAL                             */}
      {/* ==================================================== */}
      {previewPdf && (
        <PdfViewer
          url={previewPdf.url}
          title={previewPdf.title}
          noteId={previewPdf.noteId}
          onClose={() => setPreviewPdf(null)}
          storagePath={previewPdf.storagePath}
          bucket={previewPdf.bucket}
          fileName={previewPdf.fileName}
          mimeType={previewPdf.mimeType}
          fileType={previewPdf.fileType}
        />
      )}
    </div>
  );
}
