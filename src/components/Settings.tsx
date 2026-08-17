import React, { useRef, useState, useEffect } from "react";
import { safeLocalStorageSetItem } from "../lib/safeStorage";
import { 
  Sun, 
  Moon, 
  Smartphone, 
  Upload, 
  Trash2, 
  RefreshCcw,
  Check,
  Cloud,
  Mail,
  Download,
  AlertCircle,
  FileCheck,
  ShieldCheck,
  X,
  Building2,
  Share2,
  Palette,
  Loader2,
  IndianRupee,
  BarChart2,
  ArrowRight,
  TrendingUp
} from "lucide-react";
import { APP_VERSION } from "../config";
import { signInWithGoogleDrive, backupToGoogleDrive, restoreFromGoogleDrive } from "../lib/googleDrive";
import { generateAnnualReport } from "../utils/reportGenerator";
import { getPendingFeeMonths, getEvaluatedStudentLedger } from "../utils/feeBillingHelper";
import { 
  getInstitutionName, 
  saveInstitutionName, 
  getAllAdmins, 
  saveUserDocument, 
  deleteUserDocument,
  deleteUserAuthCredentials,
  subscribeToAnnouncements,
  saveAnnouncementDoc,
  deleteAnnouncementDoc
} from "../lib/firestoreService";
import { createNewUserAuth, getFirebaseAuth } from "../lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";

interface SettingsProps {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  visualTheme: string;
  onVisualThemeChange: (theme: string) => void;
  qrCode: string | null;
  onQrCodeChange: (dataUrl: string | null) => void;
  onResetData: () => void;
  students: any[];
  onRestoreData: (students: any[], qrCode: string | null) => void;
  isAdmin?: boolean;
}

export default function Settings({ 
  theme, 
  onThemeChange, 
  visualTheme,
  onVisualThemeChange,
  qrCode, 
  onQrCodeChange, 
  onResetData,
  students,
  onRestoreData,
  isAdmin = true
}: SettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonImportInputRef = useRef<HTMLInputElement>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedReportYear, setSelectedReportYear] = useState(2026);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [settingsInstName, setSettingsInstName] = useState("Sumit Tuition App");

  // Calculate financial statistics for total revenue & fee collection tracker
  const financialStats = React.useMemo(() => {
    let totalCollectedAllMonths = 0;
    let remainingDue = 0;
    let pendingFeeCount = 0;

    (students || []).forEach(student => {
      const pendingMonths = getPendingFeeMonths(student);
      if (pendingMonths.length > 0) {
        pendingFeeCount++;
        remainingDue += pendingMonths.length * (student.monthlyFee || 0);
      }

      const ledger = getEvaluatedStudentLedger(student);
      Object.keys(ledger).forEach(month => {
        if (ledger[month] === "PAID") {
          totalCollectedAllMonths += student.monthlyFee || 0;
        }
      });
    });

    const totalCollected = totalCollectedAllMonths;
    const totalTarget = totalCollected + remainingDue;
    const totalRevenue = totalCollectedAllMonths;
    const collectionPercentage = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 100;

    return {
      totalRevenue,
      totalCollected,
      totalTarget,
      remainingDue,
      pendingFeeCount,
      collectionPercentage
    };
  }, [students]);

  // Load Institution Name on mount
  useEffect(() => {
    getInstitutionName().then((name) => {
      setSettingsInstName(name);
    });
  }, []);

  // Announcements State & Handlers
  const [announcements, setAnnouncements] = useState<any[]>(() => {
    const cached = localStorage.getItem("tuition_announcements");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // fallback
      }
    }
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
    triggerNotification("Announcement posted successfully!");
  };

  const handleDeleteAnnouncement = (id: string) => {
    deleteAnnouncementDoc(id);
    triggerNotification("Announcement deleted.");
  };

  useEffect(() => {
    const unsub = subscribeToAnnouncements((list) => {
      setAnnouncements(list);
    });
    return () => {
      unsub();
    };
  }, []);

  const handleSaveSettingsInstName = async () => {
    if (!settingsInstName.trim()) {
      triggerNotification("Academy name cannot be empty.", true);
      return;
    }
    try {
      await saveInstitutionName(settingsInstName.trim());
      triggerNotification("Academy name saved successfully!");
    } catch (err: any) {
      triggerNotification("Failed to save academy name.", true);
    }
  };

  // --- Administrator CRUD States and Handlers ---
  const [admins, setAdmins] = useState<any[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("");
  const [editingAdmin, setEditingAdmin] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const loadAdmins = async () => {
    if (!isAdmin) return;
    setLoadingAdmins(true);
    try {
      const adminList = await getAllAdmins();
      const filtered = adminList.filter((a: any) => a.email?.toLowerCase() !== "sumitprasadsaha2@gmail.com");
      const removedAdmins = adminList.filter((a: any) => a.email?.toLowerCase() === "sumitprasadsaha2@gmail.com");
      for (const r of removedAdmins) {
        const uid = r.uid || r.id;
        if (uid) {
          try {
            await deleteUserDocument(uid);
          } catch (err) {
            console.warn("Failed deleting user doc for sumitprasadsaha2@gmail.com:", err);
          }
        }
      }
      setAdmins(filtered);
    } catch (e) {
      console.error("Error loading admins:", e);
    } finally {
      setLoadingAdmins(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, [isAdmin]);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()) {
      triggerNotification("Please fill in all fields.", true);
      return;
    }
    if (adminPassword !== adminConfirmPassword) {
      triggerNotification("Passwords do not match.", true);
      return;
    }
    try {
      setLoadingAdmins(true);
      const uid = await createNewUserAuth(adminEmail.toLowerCase().trim(), adminPassword);
      const newAdmin = {
        uid,
        name: adminName.trim(),
        email: adminEmail.toLowerCase().trim(),
        phone: "+919609598095",
        role: "Admin",
        status: "Active",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: null
      };
      await saveUserDocument(uid, newAdmin);
      triggerNotification("Admin account created successfully!");
      setAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setAdminConfirmPassword("");
      setShowAddAdmin(false);
      await loadAdmins();
    } catch (err: any) {
      console.error(err);
      triggerNotification("Unable to create administrator. Please try again.", true);
    } finally {
      setLoadingAdmins(false);
    }
  };

  const handleEditAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    if (!editName.trim()) {
      triggerNotification("Name cannot be empty.", true);
      return;
    }
    try {
      setLoadingAdmins(true);
      const updatedAdmin = {
        ...editingAdmin,
        name: editName.trim(),
        updatedAt: new Date().toISOString()
      };
      await saveUserDocument(editingAdmin.uid, updatedAdmin);
      triggerNotification("Admin updated successfully!");
      setEditingAdmin(null);
      await loadAdmins();
    } catch (err: any) {
      console.error(err);
      triggerNotification("Unable to update administrator. Please try again.", true);
    } finally {
      setLoadingAdmins(false);
    }
  };

  const handleToggleAdminStatus = async (adminToToggle: any) => {
    const activeCount = admins.filter(a => a.active).length;
    if (adminToToggle.active && activeCount <= 1) {
      triggerNotification("Cannot disable the last active administrator.", true);
      return;
    }
    try {
      setLoadingAdmins(true);
      const updatedAdmin = {
        ...adminToToggle,
        active: !adminToToggle.active,
        updatedAt: new Date().toISOString()
      };
      await saveUserDocument(adminToToggle.uid, updatedAdmin);
      triggerNotification(`Administrator ${updatedAdmin.active ? 'enabled' : 'disabled'} successfully!`);
      await loadAdmins();
    } catch (err: any) {
      console.error(err);
      triggerNotification("Unable to update administrator status. Please try again.", true);
    } finally {
      setLoadingAdmins(false);
    }
  };

  const handleDeleteAdmin = async (targetAdmin: any) => {
    const uidToDelete = targetAdmin?.uid || targetAdmin?.id;
    if (!uidToDelete) {
      triggerNotification("Invalid administrator ID.", true);
      return;
    }
    const activeCount = admins.filter(a => a.active).length;
    if (admins.length <= 1 || (targetAdmin?.active && activeCount <= 1)) {
      triggerNotification("Cannot delete or disable the last active administrator.", true);
      return;
    }
    try {
      setLoadingAdmins(true);
      await deleteUserDocument(uidToDelete);
      await deleteUserAuthCredentials(uidToDelete);
      triggerNotification("Administrator deleted successfully!");
      setDeletingAdminTarget(null);
      await loadAdmins();
    } catch (err: any) {
      console.error(err);
      triggerNotification("Unable to delete administrator. Please try again.", true);
    } finally {
      setLoadingAdmins(false);
    }
  };

  // States for state-based inline modal confirmations
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showRemoveQrConfirm, setShowRemoveQrConfirm] = useState(false);
  const [deletingAdminTarget, setDeletingAdminTarget] = useState<any | null>(null);

  // Google Drive Connection States
  const [connectedUser, setConnectedUser] = useState<any>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [isDriveOperating, setIsDriveOperating] = useState(false);

  // Email storage for data recovery
  const [backupEmail, setBackupEmail] = useState(() => {
    return localStorage.getItem("tuition_backup_email") || "sumitprasadsaha@gmail.com";
  });

  const saveEmail = (email: string) => {
    setBackupEmail(email);
    safeLocalStorageSetItem("tuition_backup_email", email);
  };

  const triggerNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(""), 4000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  };

  const handleReset = () => {
    onResetData();
    setShowResetConfirm(false);
    triggerNotification("All application data has been permanently cleared.");
  };

  const handleRemoveQr = () => {
    onQrCodeChange(null);
    setShowRemoveQrConfirm(false);
    triggerNotification("Payment QR Code removed.");
  };

  const handleQrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          onQrCodeChange(reader.result);
          triggerNotification("Payment QR Code updated successfully!");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownloadQr = () => {
    if (!qrCode) {
      triggerNotification("No payment QR code found to download.", true);
      return;
    }
    const link = document.createElement("a");
    link.href = qrCode;
    link.download = `payment_qr_${new Date().getTime()}.png`;
    link.click();
    triggerNotification("Payment QR code downloaded.");
  };

  const handleShareQr = async () => {
    if (!qrCode) {
      triggerNotification("No payment QR code found to share.", true);
      return;
    }
    try {
      const shareText = "Payment QR code for tuition fee payment";
      const shareUrl = qrCode;
      if (navigator.share) {
        await navigator.share({
          title: "Payment QR Code",
          text: shareText,
          url: shareUrl
        });
      } else {
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`;
        window.open(whatsappUrl, "_blank", "noopener,noreferrer");
      }
      triggerNotification("Payment QR code share action completed.");
    } catch (err) {
      console.error(err);
      triggerNotification("Unable to share QR code right now.", true);
    }
  };

  const handleExportStudentBackup = () => {
    try {
      const payload = {
        students: students.filter((student) => Boolean(student?.id)),
        qrCode,
        exportDate: new Date().toISOString()
      };
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", jsonString);
      downloadAnchor.setAttribute("download", `student_backup_${new Date().getTime()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      triggerNotification("Student backup exported locally.");
    } catch (err) {
      triggerNotification("Failed to export student backup.", true);
    }
  };

  const handleImportStudentBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && Array.isArray(parsed.students)) {
          onRestoreData(parsed.students, parsed.qrCode || null);
          triggerNotification("Student backup restored locally.");
        } else {
          triggerNotification("Invalid backup format.", true);
        }
      } catch (err) {
        triggerNotification("Failed to restore local backup.", true);
      }
    };
    reader.readAsText(file);
  };

  // --- GOOGLE DRIVE BACKUP & RESTORE INTEGRATION ---
  const handleConnectDrive = async () => {
    setIsDriveOperating(true);
    setErrorMsg("");
    try {
      const result = await signInWithGoogleDrive();
      if (result) {
        setConnectedUser(result.user);
        setGoogleAccessToken(result.accessToken);
        triggerNotification(`Connected successfully as ${result.user.email}!`);
      }
    } catch (err: any) {
      console.error(err);
      triggerNotification(
        "Google Sign-In failed. Please use offline JSON backup below.", 
        true
      );
    } finally {
      setIsDriveOperating(false);
    }
  };

  const handleDriveBackup = async () => {
    if (!googleAccessToken) {
      triggerNotification("Please connect your Google Drive account first.", true);
      return;
    }
    setIsDriveOperating(true);
    try {
      const payload = {
        students,
        qrCode,
        backupEmail,
        timestamp: new Date().toISOString()
      };
      await backupToGoogleDrive(googleAccessToken, payload);
      triggerNotification(`Roster backup stored successfully on Drive for ${backupEmail}!`);
    } catch (err: any) {
      console.error(err);
      triggerNotification("Drive backup failed. Please try again.", true);
    } finally {
      setIsDriveOperating(false);
    }
  };

  const handleDriveRestore = async () => {
    if (!googleAccessToken) {
      triggerNotification("Please connect your Google Drive account first.", true);
      return;
    }
    setIsDriveOperating(true);
    try {
      const restored = await restoreFromGoogleDrive(googleAccessToken);
      if (restored && Array.isArray(restored.students)) {
        onRestoreData(restored.students, restored.qrCode || null);
        if (restored.backupEmail) {
          saveEmail(restored.backupEmail);
        }
        triggerNotification("Application data recovered successfully from Google Drive!");
      } else {
        triggerNotification("Invalid backup file found on Google Drive.", true);
      }
    } catch (err: any) {
      console.error(err);
      triggerNotification("Restore failed. Please try again.", true);
    } finally {
      setIsDriveOperating(false);
    }
  };

  // --- OFFLINE JSON IMPORT/EXPORT (Iframe-proof alternative) ---
  const handleExportJSON = () => {
    try {
      const payload = {
        students,
        qrCode,
        backupEmail,
        exportDate: new Date().toISOString()
      };
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(payload, null, 2)
      )}`;
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", jsonString);
      downloadAnchor.setAttribute("download", `tuition_ledger_backup_${backupEmail.split("@")[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      triggerNotification("Offline backup file downloaded successfully!");
    } catch (err) {
      triggerNotification("Failed to export backup file.", true);
    }
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed && Array.isArray(parsed.students)) {
            onRestoreData(parsed.students, parsed.qrCode || null);
            if (parsed.backupEmail) {
              saveEmail(parsed.backupEmail);
            }
            triggerNotification("Offline data restored successfully from file!");
          } else {
            triggerNotification("Invalid file format. Student array is missing.", true);
          }
        } catch (err) {
          triggerNotification("Failed to parse file. Ensure it is a valid JSON backup.", true);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-24 animate-fadeIn" id="settings-view">
      {/* Title */}
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100" id="settings-title">
          {isAdmin ? "Settings" : "SETTINGS"}
        </h1>
        {isAdmin && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your academy and app preferences.
          </p>
        )}
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 rounded-xl text-xs font-bold flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-105 dark:border-rose-900/30 rounded-xl text-xs font-bold flex items-start gap-2.5 animate-fadeIn leading-relaxed">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Settings Grid */}
      <div className="flex flex-col gap-5">
            <div className="rounded-2xl border border-slate-105 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-none">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                    <Sun className="w-4 h-4" />
                    App Theme
                  </span>
                  <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">Choose light/dark mode.</span>
                </div>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => onThemeChange("light")} 
                    className={`rounded-xl border py-3 text-xs font-bold transition-all cursor-pointer ${
                      theme === "light" 
                        ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 font-black" 
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    }`}
                  >
                    Light Mode
                  </button>
                  <button 
                    onClick={() => onThemeChange("dark")} 
                    className={`rounded-xl border py-3 text-xs font-bold transition-all cursor-pointer ${
                      theme === "dark" 
                        ? "border-blue-500 bg-blue-950/20 text-blue-400 font-black" 
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    }`}
                  >
                    Dark Mode
                  </button>
                </div>
              </div>

              <div className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-4">
                <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <Palette className="w-4 h-4" />
                  Color Accent Theme
                </span>
                <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">Select custom accent color theme.</span>
                
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: "amber", name: "Amber", bg: "bg-amber-500" },
                    { key: "sapphire", name: "Sapphire", bg: "bg-blue-600" },
                    { key: "emerald", name: "Emerald", bg: "bg-emerald-500" },
                    { key: "ruby", name: "Ruby", bg: "bg-rose-600" }
                  ].map((color) => {
                    const isSelected = visualTheme === color.key;
                    return (
                      <button
                        key={color.key}
                        onClick={() => onVisualThemeChange(color.key)}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition-all cursor-pointer ${
                          isSelected
                            ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400"
                            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                        }`}
                      >
                        <span className={`h-3 w-3 rounded-full ${color.bg} shrink-0 ring-2 ring-white/20`} />
                        <span>{color.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

        {isAdmin && (
          <>
            {/* SECTION: Academy Customization */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col">
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" />
                  Academy Name
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Configure the display name of your institution.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 items-center mt-1">
                <input
                  type="text"
                  placeholder="e.g. Sumit Tuition App"
                  value={settingsInstName}
                  onChange={(e) => setSettingsInstName(e.target.value)}
                  className="flex-1 w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500/10 h-[42px]"
                />
                <button
                  type="button"
                  onClick={handleSaveSettingsInstName}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider h-[42px] transition-all cursor-pointer flex items-center justify-center gap-1 shrink-0"
                >
                  Save Name
                </button>
              </div>
            </div>

            {/* SECTION: Total Revenue & Monthly Fee Collection Tracker */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col">
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  Financial Analytics & Revenue
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Overview of total revenue and monthly fee collection status.
                </span>
              </div>

              {/* Total Revenue Card */}
              <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Total Revenue
                  </span>
                  <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 mt-0.5">
                    ₹{financialStats.totalRevenue.toLocaleString("en-IN")}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    Sum of All Payments
                  </span>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-2xl">
                  <IndianRupee className="w-6 h-6" />
                </div>
              </div>

              {/* Monthly Fee Collection Tracker Card */}
              <div className="bg-slate-50 dark:bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-100 dark:border-slate-800/80 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
                      Monthly fee Collection tracker
                    </h3>
                    <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5">
                      Target Amount: ₹{financialStats.totalTarget.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl">
                    <BarChart2 className="w-5 h-5" />
                  </div>
                </div>

                <div className="flex justify-between items-end mt-1">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Collected
                    </span>
                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400 mt-0.5">
                      ₹{financialStats.totalCollected.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/80 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-900/50">
                    {financialStats.collectionPercentage}% Collected
                  </span>
                </div>

                <div className="w-full bg-slate-200 dark:bg-slate-800 h-3 rounded-full mt-1 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${financialStats.collectionPercentage}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider mt-1">
                  <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Overdue Amount: ₹{financialStats.remainingDue.toLocaleString("en-IN")}</span>
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">
                    Unpaid Students: {financialStats.pendingFeeCount}
                  </span>
                </div>
              </div>
            </div>

            {/* SECTION 4: Annual Financial & Audit Report */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
              <div className="flex flex-col">
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileCheck className="w-4 h-4 text-blue-500" />
                  Annual Financial & Audit Report (PDF)
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
                  Generate and download a comprehensive, print-ready PDF ledger audit report for any April-to-March Financial Year session.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-1">
                <div className="flex-1">
                  <select
                    value={selectedReportYear}
                    onChange={(e) => setSelectedReportYear(parseInt(e.target.value))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 font-bold focus:outline-hidden text-xs cursor-pointer"
                  >
                    <option value={2025}>April 2025 - March 2026 Session</option>
                    <option value={2026}>April 2026 - March 2027 Session (Active)</option>
                    <option value={2027}>April 2027 - March 2028 Session</option>
                  </select>
                </div>
                <button
                  disabled={isGeneratingReport}
                  onClick={async () => {
                    if (isGeneratingReport) return;
                    setIsGeneratingReport(true);
                    try {
                      await generateAnnualReport(selectedReportYear, students);
                      triggerNotification("PDF Financial Report generated and downloaded successfully!");
                    } catch (e: any) {
                      console.error(e);
                      triggerNotification("Unable to generate report. Please try again.", true);
                    } finally {
                      setIsGeneratingReport(false);
                    }
                  }}
                  className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/10 transition-all shrink-0"
                >
                  {isGeneratingReport ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{isGeneratingReport ? "Generating..." : "Download PDF Report"}</span>
                </button>
              </div>
            </div>

            {/* SECTION 6: Administrator Settings Panel (Admins Only) */}
            {isAdmin && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      Administrator Settings Panel
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
                      Register, modify, disable, delete, or reset passwords of other administrators.
                    </span>
                  </div>
                  
                  <button
                    onClick={() => setShowAddAdmin(!showAddAdmin)}
                    className="py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-black uppercase tracking-wider transition-all cursor-pointer shadow-md shadow-blue-500/10 shrink-0"
                  >
                    {showAddAdmin ? "Cancel" : "Add Admin"}
                  </button>
                </div>

                {/* Add Admin Form */}
                {showAddAdmin && (
                  <form onSubmit={handleAddAdmin} className="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-105 dark:border-slate-900/50 flex flex-col gap-3 animate-fadeIn">
                    <span className="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400">
                      Create New Administrator
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Full Name</label>
                        <input
                          type="text"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                          placeholder="Admin's Name"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 text-xs font-medium focus:outline-hidden"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Login Email</label>
                        <input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="admin@example.com"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 text-xs font-medium focus:outline-hidden"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Password</label>
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 text-xs font-medium focus:outline-hidden"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Confirm Password</label>
                        <input
                          type="password"
                          value={adminConfirmPassword}
                          onChange={(e) => setAdminConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-100 text-xs font-medium focus:outline-hidden"
                          required
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loadingAdmins}
                      className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all mt-1 disabled:opacity-50"
                    >
                      {loadingAdmins ? "Creating account..." : "Register Admin"}
                    </button>
                  </form>
                )}

                {/* Edit Admin Inline Form */}
                {editingAdmin && (
                  <form onSubmit={handleEditAdmin} className="p-4 bg-amber-50/20 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/30 rounded-xl flex flex-col gap-3 animate-fadeIn">
                    <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400">
                      Edit Administrator: {editingAdmin.email}
                    </span>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-850 dark:text-slate-100 text-xs font-medium focus:outline-hidden"
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={loadingAdmins}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                      >
                        {loadingAdmins ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAdmin(null)}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* Admins List */}
                <div className="flex flex-col gap-2 mt-2">
                  {admins.length === 0 ? (
                    <div className="text-center py-4 text-xs text-slate-400">
                      No registered administrators found.
                    </div>
                  ) : (
                    admins.map((adminItem, index) => (
                      <div 
                        key={adminItem.uid || adminItem.id || adminItem.email || `admin-${index}`}
                        className="p-3.5 bg-slate-50 dark:bg-slate-950/30 border border-slate-100 dark:border-slate-900/40 rounded-xl flex items-center justify-between gap-4"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                              {adminItem.name}
                            </span>
                            <span className={`px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-md ${
                              adminItem.active 
                                ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100/30" 
                                : "bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100/30"
                            }`}>
                              {adminItem.active ? "Active" : "Disabled"}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">
                            {adminItem.email}
                          </span>
                        </div>

                        {/* Admin Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleToggleAdminStatus(adminItem)}
                            className={`p-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                              adminItem.active
                                ? "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400"
                                : "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400"
                            }`}
                            title={adminItem.active ? "Deactivate Account" : "Activate Account"}
                          >
                            {adminItem.active ? "Disable" : "Enable"}
                          </button>

                          <button
                            onClick={() => {
                              setEditingAdmin(adminItem);
                              setEditName(adminItem.name);
                              setEditEmail(adminItem.email);
                            }}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                            title="Edit Admin Name"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => setDeletingAdminTarget(adminItem)}
                            disabled={admins.length <= 1}
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer"
                            title="Delete Administrator"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Delete Administrator Confirmation Modal */}
        {deletingAdminTarget && (
          <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col gap-4 animate-fadeIn">
              <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Delete Administrator?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    This will permanently delete admin privileges for {deletingAdminTarget.name}.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {deletingAdminTarget.name}
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  {deletingAdminTarget.email}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeletingAdminTarget(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
                  disabled={loadingAdmins}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteAdmin(deletingAdminTarget)}
                  className="px-5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  disabled={loadingAdmins}
                >
                  {loadingAdmins ? "Deleting..." : "Delete Administrator"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Branding Footer with custom typography */}
        <div className="mt-8 flex flex-col items-center justify-center gap-1.5 border-t border-slate-100 pt-6 text-center dark:border-slate-850">
          <span className="text-xl sm:text-2xl font-black tracking-wide normal-case text-blue-600 dark:text-blue-400" style={{ fontFamily: "'Dancing Script', cursive" }}>
            Developed and Designed by Sumit
          </span>
          <span className="text-[10px] font-black tracking-[0.15em] text-slate-500 dark:text-slate-450 uppercase">Sumit Tuition App</span>
          <span className="text-[8px] font-extrabold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">Version {APP_VERSION}</span>
          <span className="text-[8px] font-black tracking-widest text-slate-500 dark:text-slate-400 uppercase">—POWERED BY ANDROID—</span>
        </div>
      </div>
    </div>
  );
}
