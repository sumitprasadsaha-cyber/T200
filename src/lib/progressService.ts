/**
 * Unified Progress Service
 * Provides smooth, consistent real and simulated progress tracking across the app.
 * Adheres strictly to user-friendly messaging (no DB/SQL/API/technical terms).
 */

export interface ProgressState {
  isOpen: boolean;
  label: string;
  progress: number; // 0 to 100
  status: "loading" | "completed" | "error";
  isRealProgress: boolean;
}

type ProgressListener = (state: ProgressState) => void;

class ProgressManager {
  private state: ProgressState = {
    isOpen: false,
    label: "Loading…",
    progress: 0,
    status: "loading",
    isRealProgress: false,
  };

  private listeners = new Set<ProgressListener>();
  private simInterval: any = null;
  private autoDismissTimer: any = null;
  private isCompleting = false;

  private notify() {
    const cloned = { ...this.state };
    this.listeners.forEach((listener) => {
      try {
        listener(cloned);
      } catch (err) {
        console.warn("[ProgressManager] Listener notification error:", err);
      }
    });
  }

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): ProgressState {
    return { ...this.state };
  }

  /**
   * Sanitizes any technical, DB, or internal error/loading messages
   * into clean, user-friendly labels.
   */
  public sanitizeLabel(rawLabel?: string): string {
    if (!rawLabel || typeof rawLabel !== "string") {
      return "Loading…";
    }

    const lower = rawLabel.toLowerCase();

    if (lower.includes("sign in") || lower.includes("logging in") || lower.includes("authenticat")) {
      return "Signing in…";
    }
    if (lower.includes("sign out") || lower.includes("logging out")) {
      return "Signing out…";
    }
    if (lower.includes("session") || lower.includes("restoring auth")) {
      return "Restoring Session…";
    }
    if (lower.includes("upload") && (lower.includes("test") || lower.includes("practice"))) {
      return "Uploading Practice Test…";
    }
    if (lower.includes("upload") && (lower.includes("note") || lower.includes("pdf") || lower.includes("file"))) {
      return "Uploading Notes…";
    }
    if (lower.includes("upload") && (lower.includes("photo") || lower.includes("avatar") || lower.includes("image"))) {
      return "Uploading Photo…";
    }
    if (lower.includes("upload") && lower.includes("student")) {
      return "Saving Student Data…";
    }
    if (lower.includes("download") && (lower.includes("note") || lower.includes("pdf"))) {
      return "Downloading Notes…";
    }
    if (lower.includes("download") && (lower.includes("photo") || lower.includes("image"))) {
      return "Downloading Image…";
    }
    if (lower.includes("open") && (lower.includes("note") || lower.includes("cache") || lower.includes("pdf") || lower.includes("viewer"))) {
      return "Opening Notes…";
    }
    if (lower.includes("fetch") && (lower.includes("test") || lower.includes("practice") || lower.includes("question"))) {
      return "Fetching Practice Test…";
    }
    if (lower.includes("submit") && (lower.includes("test") || lower.includes("practice"))) {
      return "Submitting Test…";
    }
    if (lower.includes("score") || lower.includes("calculat")) {
      return "Calculating Test Scores…";
    }
    if (lower.includes("sync") || lower.includes("synchroniz")) {
      return "Syncing Progress…";
    }
    if (lower.includes("refresh") && lower.includes("dashboard")) {
      return "Refreshing Dashboard…";
    }
    if (lower.includes("refresh") && lower.includes("attendance")) {
      return "Refreshing Attendance…";
    }
    if (lower.includes("refresh") && lower.includes("fee")) {
      return "Refreshing Fees…";
    }
    if (lower.includes("refresh") && (lower.includes("subject") || lower.includes("chapter") || lower.includes("topic"))) {
      return "Refreshing Notes…";
    }
    if (lower.includes("refresh")) {
      return "Refreshing Data…";
    }
    if (lower.includes("restore") || lower.includes("backup")) {
      return "Restoring Data…";
    }
    if (lower.includes("report") || lower.includes("generate")) {
      return "Generating Report…";
    }
    if (lower.includes("save") || lower.includes("saving")) {
      return "Saving Changes…";
    }

    // Clean internal terms
    if (
      lower.includes("database") ||
      lower.includes("supabase") ||
      lower.includes("firestore") ||
      lower.includes("sql") ||
      lower.includes("query") ||
      lower.includes("rest call") ||
      lower.includes("api request") ||
      lower.includes("endpoint") ||
      lower.includes("record")
    ) {
      return "Loading Data…";
    }

    // Ensure label ends with ellipsis if it's an action
    let cleaned = rawLabel.trim();
    if (!cleaned.endsWith("…") && !cleaned.endsWith("...") && !cleaned.endsWith("!")) {
      cleaned += "…";
    }
    return cleaned;
  }

  /**
   * Starts displaying the progress bar.
   * If not using real progress, sets up smooth simulated progress advancement.
   */
  public start(options: {
    label: string;
    initialProgress?: number;
    isRealProgress?: boolean;
  }) {
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    this.isCompleting = false;
    const isReal = Boolean(options.isRealProgress);
    const startProgress = options.initialProgress !== undefined ? options.initialProgress : 12;

    this.state = {
      isOpen: true,
      label: this.sanitizeLabel(options.label),
      progress: Math.min(100, Math.max(0, startProgress)),
      status: "loading",
      isRealProgress: isReal,
    };
    this.notify();

    if (!isReal) {
      this.startSimulation();
    }
  }

  private startSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
    }

    // Smooth natural advancement that asymptotically pauses around 92-94%
    this.simInterval = setInterval(() => {
      if (this.isCompleting || !this.state.isOpen || this.state.isRealProgress) {
        clearInterval(this.simInterval);
        this.simInterval = null;
        return;
      }

      const current = this.state.progress;
      if (current < 92) {
        // Smooth logarithmic step
        const remaining = 93 - current;
        const step = Math.max(0.4, remaining * 0.07);
        const next = Math.min(93, current + step);
        this.state.progress = Math.round(next * 10) / 10;
        this.notify();
      }
    }, 75);
  }

  /**
   * Updates real progress percentage (0-100) and optional label.
   */
  public update(progress: number, label?: string) {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    const clamped = Math.min(100, Math.max(0, progress));
    this.state.isRealProgress = true;
    this.state.progress = Math.round(clamped * 10) / 10;
    if (label) {
      this.state.label = this.sanitizeLabel(label);
    }
    this.notify();

    if (clamped >= 100 && !this.isCompleting) {
      this.finish();
    }
  }

  /**
   * Updates just the action label.
   */
  public setLabel(label: string) {
    this.state.label = this.sanitizeLabel(label);
    this.notify();
  }

  /**
   * Successfully finishes progress: animates smoothly to 100%,
   * marks completion, and auto-dismisses after a brief pause.
   */
  public finish(customLabel?: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.simInterval) {
        clearInterval(this.simInterval);
        this.simInterval = null;
      }

      this.isCompleting = true;
      this.state.progress = 100;
      this.state.status = "completed";
      if (customLabel) {
        this.state.label = this.sanitizeLabel(customLabel);
      }
      this.notify();

      if (this.autoDismissTimer) {
        clearTimeout(this.autoDismissTimer);
      }

      this.autoDismissTimer = setTimeout(() => {
        this.state.isOpen = false;
        this.notify();
        this.isCompleting = false;
        resolve();
      }, 350);
    });
  }

  /**
   * Immediately dismisses the progress bar without completion animation (used on cancel or unmount).
   */
  public dismiss() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    this.isCompleting = false;
    this.state.isOpen = false;
    this.state.status = "loading";
    this.notify();
  }

  /**
   * Dismisses the progress bar gracefully on error.
   */
  public fail() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    if (this.autoDismissTimer) {
      clearTimeout(this.autoDismissTimer);
      this.autoDismissTimer = null;
    }
    this.isCompleting = false;
    this.state.isOpen = false;
    this.state.status = "error";
    this.notify();
  }

  /**
   * Helper to wrap any promise/async action with automatic progress handling.
   */
  public async runWithProgress<T>(
    options: {
      label: string;
      initialProgress?: number;
      isRealProgress?: boolean;
    },
    task: (helpers: {
      setProgress: (percent: number, label?: string) => void;
      setLabel: (label: string) => void;
    }) => Promise<T>
  ): Promise<T> {
    this.start(options);
    try {
      const result = await task({
        setProgress: (p, l) => this.update(p, l),
        setLabel: (l) => this.setLabel(l),
      });
      await this.finish();
      return result;
    } catch (error) {
      this.fail();
      throw error;
    }
  }
}

export const progressService = new ProgressManager();
