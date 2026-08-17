import { LocalNotifications } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export const TIMER_NOTIFICATION_ID = 1001;
export const TIMER_CHANNEL_ID = "study_timer_channel";

let isChannelCreated = false;
let isListenerAdded = false;

/**
 * Initializes Local Notifications channels and permissions for Android & Web.
 */
export async function initTimerNotifications() {
  if (typeof window === "undefined") return;

  if (Capacitor.isNativePlatform()) {
    try {
      if (!isChannelCreated) {
        await LocalNotifications.createChannel({
          id: TIMER_CHANNEL_ID,
          name: "Study Timer Notifications",
          description: "High priority notifications when study countdown finishes",
          importance: 5, // High Importance (shows heads-up notification banner)
          visibility: 1, // Public
          sound: undefined,
          vibration: true,
          lights: true,
          lightColor: "#3B82F6"
        });
        isChannelCreated = true;
      }

      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        await LocalNotifications.requestPermissions();
      }

      if (!isListenerAdded) {
        LocalNotifications.addListener("localNotificationActionPerformed", (notification) => {
          console.log("[TimerNotification] Notification tapped by user:", notification);
          try {
            window.focus();
            window.dispatchEvent(new CustomEvent("open-study-timer"));
          } catch (e) {
            console.error("Error focusing timer modal on notification click:", e);
          }
        });
        isListenerAdded = true;
      }
    } catch (err) {
      console.warn("[TimerNotification] Failed initializing native notifications:", err);
    }
  } else if ("Notification" in window && Notification.permission === "default") {
    try {
      Notification.requestPermission().catch(() => {});
    } catch (e) {}
  }
}

/**
 * Schedules a high-priority native Android or browser notification for when the timer reaches zero.
 */
export async function scheduleTimerNotification(expectedFinishTimestamp: number, customTitle?: string, customBody?: string) {
  try {
    await initTimerNotifications();
    await cancelTimerNotification();

    const title = customTitle || "Study Timer Completed! 🔔";
    const body = customBody || "Your study session countdown has finished. Great job!";

    if (Capacitor.isNativePlatform()) {
      const scheduleTime = new Date(expectedFinishTimestamp);
      await LocalNotifications.schedule({
        notifications: [
          {
            id: TIMER_NOTIFICATION_ID,
            title,
            body,
            schedule: { at: scheduleTime, allowWhileIdle: true },
            channelId: TIMER_CHANNEL_ID,
            sound: "alarm",
            actionTypeId: "OPEN_STUDY_TIMER",
            extra: { openTimer: true },
            ongoing: false,
            autoCancel: true
          }
        ]
      });
      console.log(`[TimerNotification] Successfully scheduled native notification for ${scheduleTime.toISOString()}`);
    } else if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      const diffMs = Math.max(0, expectedFinishTimestamp - Date.now());
      setTimeout(() => {
        try {
          new Notification(title, {
            body,
            tag: "study-timer-alarm",
            requireInteraction: true
          });
        } catch (e) {}
      }, diffMs);
    }
  } catch (err) {
    console.warn("[TimerNotification] Failed scheduling timer notification:", err);
  }
}

/**
 * Cancels any active scheduled timer notification.
 */
export async function cancelTimerNotification() {
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({
        notifications: [{ id: TIMER_NOTIFICATION_ID }]
      });
    }
  } catch (err) {
    console.warn("[TimerNotification] Failed canceling notification:", err);
  }
}

/**
 * Listens to Capacitor App State changes (when app resumes from PDF viewer or background).
 */
export function registerAppStateChangeListener(onAppResume: () => void) {
  if (typeof window === "undefined") return () => {};

  if (Capacitor.isNativePlatform()) {
    const handleStateChange = App.addListener("appStateChange", (state) => {
      if (state.isActive) {
        console.log("[TimerNotification] App came back to foreground (active).");
        onAppResume();
      }
    });

    return () => {
      handleStateChange.then((h) => h.remove()).catch(() => {});
    };
  } else {
    const handleFocus = () => onAppResume();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }
}
