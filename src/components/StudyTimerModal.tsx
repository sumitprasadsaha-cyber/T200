import React, { useState, useEffect, useRef } from "react";
import {
  Timer as TimerIcon,
  Clock,
  Play,
  Pause,
  RotateCcw,
  X,
  Bell,
  Volume2,
  Flag,
  ArrowLeftRight,
  Plus,
  Minus,
  Sparkles,
  Check,
  VolumeX
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  scheduleTimerNotification,
  cancelTimerNotification,
  registerAppStateChangeListener,
  initTimerNotifications
} from "../lib/timerNotificationService";
import { safeLocalStorageSetItem } from "../lib/safeStorage";
import { Haptics } from "@capacitor/haptics";

interface StudyTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTimerRunningChange?: (isRunning: boolean) => void;
}

type Mode = "timer" | "stopwatch";

const STORAGE_KEY = "study_timer_persistent_state";

export default function StudyTimerModal({ isOpen, onClose, onTimerRunningChange }: StudyTimerModalProps) {
  const [mode, setMode] = useState<Mode>("timer");

  // Read saved state on mount if present; validate running timer
  const getSavedState = () => {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const finishTime = parsed?.expectedFinishTimestamp || parsed?.targetEndTime;
      // If timer was saved as running but finish time is in the past, clean up stale state
      if (parsed?.isTimerRunning && finishTime && finishTime <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  };

  const saved = getSavedState();

  // --- TIMER STATE ---
  const [timerInitialSeconds, setTimerInitialSeconds] = useState<number>(
    saved?.timerInitialSeconds || 25 * 60
  );
  const [timerStartTimestamp, setTimerStartTimestamp] = useState<number | null>(
    saved?.timerStartTimestamp || null
  );
  const [timerDuration, setTimerDuration] = useState<number>(
    saved?.timerDuration || saved?.timerInitialSeconds || 25 * 60
  );
  const [expectedFinishTimestamp, setExpectedFinishTimestamp] = useState<number | null>(
    saved?.isTimerRunning && (saved?.expectedFinishTimestamp || saved?.targetEndTime) > Date.now()
      ? (saved.expectedFinishTimestamp || saved.targetEndTime)
      : null
  );

  // Calculate remaining seconds using real system time (expectedFinishTimestamp - currentSystemTime)
  const initialLeft = () => {
    const finishTime = saved?.expectedFinishTimestamp || saved?.targetEndTime;
    if (saved?.isTimerRunning && finishTime && finishTime > Date.now()) {
      const rem = Math.max(0, Math.ceil((finishTime - Date.now()) / 1000));
      return rem;
    }
    if (saved?.timerSecondsLeft !== undefined && !saved?.isTimerRunning) {
      return saved.timerSecondsLeft;
    }
    return 25 * 60;
  };

  const [timerSecondsLeft, setTimerSecondsLeft] = useState<number>(initialLeft());
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(
    saved?.isTimerRunning && (saved?.expectedFinishTimestamp || saved?.targetEndTime)
      ? ((saved.expectedFinishTimestamp || saved.targetEndTime) > Date.now())
      : false
  );
  // Timer must ALWAYS start idle (no alarm ringing on startup or login)
  const [isAlarmRinging, setIsAlarmRinging] = useState<boolean>(false);

  // Custom setup inputs (in minutes)
  const [customMinutes, setCustomMinutes] = useState<number>(
    saved?.timerInitialSeconds ? Math.round(saved.timerInitialSeconds / 60) : 25
  );

  // --- STOPWATCH STATE ---
  const [stopwatchMs, setStopwatchMs] = useState<number>(saved?.stopwatchMs || 0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState<boolean>(saved?.isStopwatchRunning || false);
  const [laps, setLaps] = useState<number[]>(saved?.laps || []);

  // Refs for interval loops & audio & background worker
  const timerIntervalRef = useRef<any>(null);
  const timerEndTimeRef = useRef<number | null>(
    saved?.isTimerRunning && (saved?.expectedFinishTimestamp || saved?.targetEndTime) > Date.now()
      ? (saved.expectedFinishTimestamp || saved.targetEndTime)
      : null
  );
  const workerRef = useRef<Worker | null>(null);
  const stopwatchIntervalRef = useRef<any>(null);
  const alarmIntervalRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Save persistent state to localStorage
  const saveStateToStorage = (overrides?: Record<string, any>) => {
    if (typeof localStorage === "undefined") return;
    try {
      const finishTime = overrides?.expectedFinishTimestamp ?? expectedFinishTimestamp ?? timerEndTimeRef.current;
      const stateToSave = {
        mode,
        timerInitialSeconds,
        timerStartTimestamp: overrides?.timerStartTimestamp ?? timerStartTimestamp,
        timerDuration: overrides?.timerDuration ?? timerDuration,
        expectedFinishTimestamp: finishTime,
        targetEndTime: finishTime,
        timerSecondsLeft: finishTime ? Math.max(0, Math.ceil((finishTime - Date.now()) / 1000)) : timerSecondsLeft,
        isTimerRunning,
        isAlarmRinging,
        stopwatchMs,
        isStopwatchRunning,
        laps,
        ...overrides
      };
      safeLocalStorageSetItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error("Failed saving timer state:", e);
    }
  };

  // Notify parent component if timer/stopwatch is currently active/running
  const isRunning = isTimerRunning || isStopwatchRunning;
  useEffect(() => {
    onTimerRunningChange?.(isRunning);
  }, [isRunning, onTimerRunningChange]);

  const stopAlarm = () => {
    setIsAlarmRinging(false);
    cancelTimerNotification();
    saveStateToStorage({ isAlarmRinging: false });
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close();
        }
      } catch (e) {
        console.error("Audio close error:", e);
      }
      audioCtxRef.current = null;
    }
  };

  // Sound chime & Notification producer
  const triggerAlarm = () => {
    // Request notification permissions if supported
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    // Fire browser desktop / system notification if granted
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      try {
        const notif = new Notification("Study Timer Finished!", {
          body: "Your study session countdown has completed. Tap to open.",
          tag: "study-timer-alarm",
          requireInteraction: true
        });
        notif.onclick = () => {
          try {
            window.focus();
            window.dispatchEvent(new CustomEvent("open-study-timer"));
          } catch (e) {}
        };
      } catch (e) {
        // ignore
      }
    }

    const playBeep = () => {
      // 1. Audio Ringing (when phone audio/ringing is on)
      try {
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close();
        }

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          audioCtxRef.current = ctx;

          if (ctx.state === "suspended") {
            ctx.resume();
          }

          const emitNote = (delay: number, freq: number, dur: number, type: OscillatorType = "sine") => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.7, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + dur);
          };

          const t = 0;
          emitNote(t, 523.25, 0.3, "triangle"); // C5
          emitNote(t + 0.15, 659.25, 0.3, "sine"); // E5
          emitNote(t + 0.3, 783.99, 0.35, "triangle"); // G5
          emitNote(t + 0.5, 1046.5, 0.6, "sine"); // C6
        }
      } catch (e) {
        console.error("Audio error:", e);
      }

      // 2. Vibration (works when phone is on vibration / silent mode or ringing)
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate([600, 300, 600, 300, 1200]);
        } catch (e) {
          // ignore
        }
      }
      try {
        Haptics.vibrate({ duration: 1500 }).catch(() => {});
      } catch (e) {
        // ignore
      }
    };

    stopAlarm();
    setIsAlarmRinging(true);
    saveStateToStorage({ isAlarmRinging: true, isTimerRunning: false, timerSecondsLeft: 0, targetEndTime: null });
    playBeep();
    alarmIntervalRef.current = setInterval(playBeep, 2500);
  };

  // --- BACKGROUND WEB WORKER INITIALIZATION ---
  useEffect(() => {
    if (typeof window === "undefined" || !window.Worker) return;

    try {
      const workerBlob = new Blob([`
        let intervalId = null;
        self.onmessage = function(e) {
          if (e.data.action === 'start') {
            if (intervalId) clearInterval(intervalId);
            const targetEndTime = e.data.targetEndTime;
            intervalId = setInterval(function() {
              const now = Date.now();
              const remaining = Math.max(0, Math.ceil((targetEndTime - now) / 1000));
              self.postMessage({ type: 'tick', remaining: remaining, isExpired: now >= targetEndTime });
              if (now >= targetEndTime) {
                clearInterval(intervalId);
                intervalId = null;
              }
            }, 500);
          } else if (e.data.action === 'stop') {
            if (intervalId) clearInterval(intervalId);
            intervalId = null;
          }
        };
      `], { type: "application/javascript" });

      const blobUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(blobUrl);

      worker.onmessage = (e) => {
        if (e.data.type === "tick") {
          setTimerSecondsLeft(e.data.remaining);
          if (e.data.isExpired) {
            setIsTimerRunning(false);
            timerEndTimeRef.current = null;
            triggerAlarm();
          }
        }
      };

      workerRef.current = worker;

      return () => {
        worker.terminate();
        URL.revokeObjectURL(blobUrl);
      };
    } catch (e) {
      console.warn("Could not initialize inline Web Worker:", e);
    }
  }, []);

  // --- TIMER EFFECT ---
  useEffect(() => {
    if (isTimerRunning) {
      if (!timerEndTimeRef.current) {
        timerEndTimeRef.current = Date.now() + timerSecondsLeft * 1000;
      }

      const targetEnd = timerEndTimeRef.current;

      saveStateToStorage({
        isTimerRunning: true,
        targetEndTime: targetEnd,
        timerSecondsLeft
      });

      // Schedule high-priority native notification for background/locked screen/native PDF viewer
      scheduleTimerNotification(targetEnd);

      // Start Web Worker countdown
      if (workerRef.current) {
        workerRef.current.postMessage({
          action: "start",
          targetEndTime: targetEnd
        });
      }

      const updateTimer = () => {
        if (!timerEndTimeRef.current) return;
        const now = Date.now();
        const diffMs = timerEndTimeRef.current - now;
        const remaining = Math.max(0, Math.ceil(diffMs / 1000));

        setTimerSecondsLeft(remaining);

        if (remaining <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsTimerRunning(false);
          timerEndTimeRef.current = null;
          triggerAlarm();
        }
      };

      updateTimer();
      timerIntervalRef.current = setInterval(updateTimer, 500);

      // Lifecycle sync when app comes to foreground or resumes from native PDF viewer / background
      const handleSync = () => {
        if (!timerEndTimeRef.current) return;
        const now = Date.now();
        const remaining = Math.max(0, Math.ceil((timerEndTimeRef.current - now) / 1000));
        setTimerSecondsLeft(remaining);

        if (now >= timerEndTimeRef.current) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          setIsTimerRunning(false);
          timerEndTimeRef.current = null;
          triggerAlarm();
        }
      };

      const cleanupAppStateListener = registerAppStateChangeListener(handleSync);
      window.addEventListener("focus", handleSync);
      document.addEventListener("visibilitychange", handleSync);
      window.addEventListener("pageshow", handleSync);

      return () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (workerRef.current) {
          workerRef.current.postMessage({ action: "stop" });
        }
        cleanupAppStateListener();
        window.removeEventListener("focus", handleSync);
        document.removeEventListener("visibilitychange", handleSync);
        window.removeEventListener("pageshow", handleSync);
      };
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (workerRef.current) {
        workerRef.current.postMessage({ action: "stop" });
      }
      cancelTimerNotification();
    }
  }, [isTimerRunning]);

  // Initial check on mount: ensure timer remains completely idle unless an active running timer exists
  useEffect(() => {
    if (!isTimerRunning) {
      cancelTimerNotification();
      if (timerEndTimeRef.current && timerEndTimeRef.current <= Date.now()) {
        timerEndTimeRef.current = null;
        setExpectedFinishTimestamp(null);
        if (typeof localStorage !== "undefined") {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch (e) {}
        }
      }
    }
  }, []);

  // --- STOPWATCH EFFECT ---
  useEffect(() => {
    if (isStopwatchRunning) {
      const startTime = Date.now() - stopwatchMs;
      const updateStopwatch = () => {
        const ms = Date.now() - startTime;
        setStopwatchMs(ms);
        saveStateToStorage({ stopwatchMs: ms, isStopwatchRunning: true });
      };

      updateStopwatch();
      stopwatchIntervalRef.current = setInterval(updateStopwatch, 30);

      const handleSync = () => {
        updateStopwatch();
      };

      window.addEventListener("focus", handleSync);
      document.addEventListener("visibilitychange", handleSync);

      return () => {
        if (stopwatchIntervalRef.current) clearInterval(stopwatchIntervalRef.current);
        window.removeEventListener("focus", handleSync);
        document.removeEventListener("visibilitychange", handleSync);
      };
    } else {
      if (stopwatchIntervalRef.current) clearInterval(stopwatchIntervalRef.current);
      saveStateToStorage({ isStopwatchRunning: false, stopwatchMs });
    }
  }, [isStopwatchRunning]);

  useEffect(() => {
    return () => {
      stopAlarm();
    };
  }, []);

  // --- TIMER CONTROLS ---
  const handleStartTimer = () => {
    initTimerNotifications();

    const secs = timerSecondsLeft <= 0 ? timerInitialSeconds : timerSecondsLeft;
    const nowMs = Date.now();
    const finishMs = nowMs + secs * 1000;

    setTimerSecondsLeft(secs);
    setTimerStartTimestamp(nowMs);
    setTimerDuration(secs);
    setExpectedFinishTimestamp(finishMs);
    timerEndTimeRef.current = finishMs;

    stopAlarm();
    setIsTimerRunning(true);
    scheduleTimerNotification(finishMs);
    saveStateToStorage({
      isTimerRunning: true,
      timerStartTimestamp: nowMs,
      timerDuration: secs,
      expectedFinishTimestamp: finishMs,
      targetEndTime: finishMs,
      timerSecondsLeft: secs,
      isAlarmRinging: false
    });
  };

  const handlePauseTimer = () => {
    timerEndTimeRef.current = null;
    setExpectedFinishTimestamp(null);
    setIsTimerRunning(false);
    cancelTimerNotification();
    saveStateToStorage({
      isTimerRunning: false,
      expectedFinishTimestamp: null,
      targetEndTime: null,
      timerSecondsLeft
    });
  };

  const handleResetTimer = () => {
    timerEndTimeRef.current = null;
    setTimerStartTimestamp(null);
    setExpectedFinishTimestamp(null);
    setIsTimerRunning(false);
    stopAlarm();
    cancelTimerNotification();
    setTimerSecondsLeft(timerInitialSeconds);
    saveStateToStorage({
      isTimerRunning: false,
      timerStartTimestamp: null,
      expectedFinishTimestamp: null,
      targetEndTime: null,
      timerSecondsLeft: timerInitialSeconds,
      isAlarmRinging: false
    });
  };

  const handleSetPreset = (minutes: number) => {
    const secs = minutes * 60;
    timerEndTimeRef.current = null;
    setTimerStartTimestamp(null);
    setExpectedFinishTimestamp(null);
    setIsTimerRunning(false);
    stopAlarm();
    cancelTimerNotification();
    setTimerInitialSeconds(secs);
    setTimerDuration(secs);
    setTimerSecondsLeft(secs);
    setCustomMinutes(minutes);
    saveStateToStorage({
      isTimerRunning: false,
      timerStartTimestamp: null,
      expectedFinishTimestamp: null,
      targetEndTime: null,
      timerInitialSeconds: secs,
      timerDuration: secs,
      timerSecondsLeft: secs,
      isAlarmRinging: false
    });
  };

  const handleApplyCustomMinutes = (mins: number) => {
    const valid = Math.max(1, Math.min(300, mins));
    setCustomMinutes(valid);
    const secs = valid * 60;
    timerEndTimeRef.current = null;
    setTimerStartTimestamp(null);
    setExpectedFinishTimestamp(null);
    setIsTimerRunning(false);
    stopAlarm();
    cancelTimerNotification();
    setTimerInitialSeconds(secs);
    setTimerDuration(secs);
    setTimerSecondsLeft(secs);
    saveStateToStorage({
      isTimerRunning: false,
      timerStartTimestamp: null,
      expectedFinishTimestamp: null,
      targetEndTime: null,
      timerInitialSeconds: secs,
      timerDuration: secs,
      timerSecondsLeft: secs,
      isAlarmRinging: false
    });
  };

  // --- STOPWATCH CONTROLS ---
  const handleStartStopwatch = () => {
    setIsStopwatchRunning(true);
    saveStateToStorage({ isStopwatchRunning: true });
  };

  const handlePauseStopwatch = () => {
    setIsStopwatchRunning(false);
    saveStateToStorage({ isStopwatchRunning: false });
  };

  const handleResetStopwatch = () => {
    setIsStopwatchRunning(false);
    setStopwatchMs(0);
    setLaps([]);
    saveStateToStorage({ isStopwatchRunning: false, stopwatchMs: 0, laps: [] });
  };

  const handleAddLap = () => {
    const updatedLaps = [stopwatchMs, ...laps];
    setLaps(updatedLaps);
    saveStateToStorage({ laps: updatedLaps });
  };

  // Format helper for Timer
  const formatTimerDisplay = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // Format helper for Stopwatch
  const formatStopwatchDisplay = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const hundredths = Math.floor((ms % 1000) / 10);

    const pad = (n: number) => String(n).padStart(2, "0");

    if (hrs > 0) {
      return {
        main: `${pad(hrs)}:${pad(mins)}:${pad(secs)}`,
        ms: pad(hundredths)
      };
    }
    return {
      main: `${pad(mins)}:${pad(secs)}`,
      ms: pad(hundredths)
    };
  };

  // Circular calculations
  const radius = 90;
  const circumference = 2 * Math.PI * radius;

  // Timer Progress fraction (1.0 -> 0.0)
  const timerProgress = timerInitialSeconds > 0 ? timerSecondsLeft / timerInitialSeconds : 0;
  const timerStrokeDashoffset = circumference * (1 - timerProgress);

  // Stopwatch Progress fraction (spins every 60s)
  const swSeconds = (stopwatchMs / 1000) % 60;
  const swProgress = swSeconds / 60;
  const swStrokeDashoffset = circumference * (1 - swProgress);

  // Render modal UI if user has opened modal OR if alarm is currently ringing
  if (!isOpen && !isAlarmRinging) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-full max-w-sm sm:max-w-md bg-white dark:bg-[#111827] rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-[#0d131f]/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                {mode === "timer" ? <TimerIcon className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">
                  {mode === "timer" ? "Study Timer" : "Practice Stopwatch"}
                </h3>
                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  {mode === "timer" ? "Countdown & Alarm" : "Elapsed Time & Laps"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle Mode Button */}
              <button
                onClick={() => {
                  stopAlarm();
                  setMode(mode === "timer" ? "stopwatch" : "timer");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                title={`Switch to ${mode === "timer" ? "Stopwatch" : "Timer"}`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-blue-500" />
                <span className="capitalize">{mode === "timer" ? "Stopwatch" : "Timer"}</span>
              </button>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Alarm Ringing Banner */}
          {isAlarmRinging && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-rose-500 text-white px-4 py-2.5 flex items-center justify-between animate-pulse"
            >
              <div className="flex items-center gap-2 text-xs font-bold">
                <Bell className="w-4 h-4 animate-bounce" />
                <span>Time's up! Session completed.</span>
              </div>
              <button
                onClick={stopAlarm}
                className="px-2.5 py-1 text-[11px] font-black uppercase tracking-wider bg-white text-rose-600 hover:bg-rose-50 rounded-lg shadow cursor-pointer"
              >
                Dismiss Alarm
              </button>
            </motion.div>
          )}

          {/* Main Body */}
          <div className="p-6 flex flex-col items-center justify-center">
            {/* CIRCULAR TIMER DISPLAY */}
            <div className="relative w-56 h-56 flex items-center justify-center my-2">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                {/* Background Track */}
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  className="stroke-slate-100 dark:stroke-slate-800/80 fill-none"
                  strokeWidth="10"
                />
                {/* Animated Progress Circle */}
                <circle
                  cx="100"
                  cy="100"
                  r={radius}
                  className={`fill-none transition-all duration-300 ease-out ${
                    mode === "timer"
                      ? isAlarmRinging
                        ? "stroke-rose-500"
                        : "stroke-blue-500 dark:stroke-blue-400"
                      : "stroke-emerald-500 dark:stroke-emerald-400"
                  }`}
                  strokeWidth="10"
                  strokeDasharray={circumference}
                  strokeDashoffset={mode === "timer" ? timerStrokeDashoffset : swStrokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>

              {/* Center Content */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                {mode === "timer" ? (
                  <>
                    <span className="text-3xl sm:text-4xl font-black font-mono text-slate-800 dark:text-slate-100 tracking-tight">
                      {formatTimerDisplay(timerSecondsLeft)}
                    </span>
                    <span className="mt-1 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase">
                      {isTimerRunning ? "Counting Down" : timerSecondsLeft === 0 ? "Finished" : "Paused"}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline justify-center font-mono">
                      <span className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
                        {formatStopwatchDisplay(stopwatchMs).main}
                      </span>
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-1">
                        .{formatStopwatchDisplay(stopwatchMs).ms}
                      </span>
                    </div>
                    <span className="mt-1 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase">
                      {isStopwatchRunning ? "Measuring Time" : "Stopwatch"}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* CONTROLS */}
            {mode === "timer" ? (
              <div className="w-full flex flex-col items-center gap-4 mt-2">
                {/* Quick Presets */}
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  {[5, 10, 15, 25, 45, 60].map((mins) => {
                    const isActive = timerInitialSeconds === mins * 60;
                    return (
                      <button
                        key={mins}
                        onClick={() => handleSetPreset(mins)}
                        className={`px-2.5 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                          isActive
                            ? "bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20"
                            : "bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200/60 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
                        }`}
                      >
                        {mins}m
                      </button>
                    );
                  })}
                </div>

                {/* Custom Minutes Adjuster */}
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/60 px-3 py-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Custom:</span>
                  <button
                    onClick={() => handleApplyCustomMinutes(customMinutes - 5)}
                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={customMinutes}
                    onChange={(e) => handleApplyCustomMinutes(parseInt(e.target.value) || 1)}
                    className="w-12 text-center text-xs font-extrabold bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                  <span className="text-xs font-medium text-slate-400">mins</span>
                  <button
                    onClick={() => handleApplyCustomMinutes(customMinutes + 5)}
                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Start / Pause / Reset Action Buttons */}
                <div className="flex items-center gap-3 mt-1">
                  {!isTimerRunning ? (
                    <button
                      onClick={handleStartTimer}
                      className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseTimer}
                      className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    onClick={handleResetTimer}
                    className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    title="Reset Timer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center gap-4 mt-2">
                {/* Stopwatch Action Buttons */}
                <div className="flex items-center gap-3">
                  {!isStopwatchRunning ? (
                    <button
                      onClick={handleStartStopwatch}
                      className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Start</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseStopwatch}
                      className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95"
                    >
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pause</span>
                    </button>
                  )}

                  {isStopwatchRunning && (
                    <button
                      onClick={handleAddLap}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl font-bold text-sm transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    >
                      <Flag className="w-4 h-4 text-emerald-500" />
                      <span>Lap</span>
                    </button>
                  )}

                  <button
                    onClick={handleResetStopwatch}
                    className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl transition-all cursor-pointer border border-slate-200/60 dark:border-slate-700"
                    title="Reset Stopwatch"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* Laps List */}
                {laps.length > 0 && (
                  <div className="w-full max-h-32 overflow-y-auto mt-2 space-y-1.5 pr-1 text-xs">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block mb-1">
                      Recorded Laps
                    </span>
                    {laps.map((lapMs, index) => {
                      const lapNo = laps.length - index;
                      const formatted = formatStopwatchDisplay(lapMs);
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-100 dark:border-slate-800 font-mono"
                        >
                          <span className="font-bold text-slate-500">Lap {lapNo}</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {formatted.main}.<span className="text-emerald-500">{formatted.ms}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

