# Real-Time Sync Quick Reference

## Quick Start for Developers

### For Admin Features
```typescript
// Real-time listeners are automatically initialized when admin logs in
// In App.tsx handleLogin():
if (role === "admin") {
  initializeAdminSync();  // Automatically subscribes to:
                          // - All students
                          // - All class notes
                          // - All announcements
                          // - All test attempts
                          // - Practice test sync signals
}
```

### For Student Features
```typescript
// Real-time listeners initialized on student login
// Test scores loaded from database
// In App.tsx handleLogin():
if (role === "student" && studentId) {
  initializeStudentSync(studentId);  // Subscribes to student-specific data
  await loadStudentTestScores(studentId);  // Loads previous test results
}
```

### Cleanup
```typescript
// Called on logout in App.tsx handleLogout():
cleanupOnLogout();  // Cleans up all listeners, prevents memory leaks
```

---

## Common Tasks

### Save Student Test Score
```typescript
// In StudentPracticeTestModal.tsx or wherever test is submitted:
import { saveTestAttemptDoc } from "../lib/firestoreService";
import { TestAttemptRecord } from "../types";

const attemptRecord: TestAttemptRecord = {
  id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
  studentId,
  studentName,
  testId,
  topicId,
  chapterId,
  subjectId,
  classGrade,
  subject,
  chapterNo,
  chapterName,
  topicName,
  testType: "topic",
  attemptNumber: attemptCount,
  date: formattedDate,
  timestamp: Date.now(),
  timeTakenSeconds: elapsedSeconds,
  score,
  totalMarks: totalQuestions,
  totalQuestions,
  percentage,
  correctAnswersCount: correctCount,
  wrongAnswersCount: wrongCount,
  unattemptedCount,
  userAnswers
};

await saveTestAttemptDoc(attemptRecord);
```

### Get Student's Previous Scores
```typescript
// In Student login or dashboard component:
import { loadStudentTestScores, getStudentTopicHighScore } from "../lib/testScorePersistence";

// Load all scores
const scores = await loadStudentTestScores(studentId);

// Get high score for specific topic
const highScore = getStudentTopicHighScore(studentId, "Mathematics", 2, "Triangles");
```

### Broadcast Content Deletion
```typescript
// When deleting content (admin side):
import { broadcastContentDeletion } from "../lib/firestoreService";

await broadcastContentDeletion("class_note", noteId, {
  noteType: "pdf",
  subject: "Mathematics"
});
```

### Subscribe to Real-Time Updates
```typescript
// Already done automatically, but manual subscription example:
import { subscribeToClassNotes } from "../lib/firestoreService";

const unsubscribe = subscribeToClassNotes(
  (notes) => {
    console.log("Notes updated:", notes);
    setClassNotes(notes);
  },
  (err) => {
    console.error("Subscription error:", err);
  }
);

// On component unmount:
return () => unsubscribe();
```

### Monitor Sync State (Debug)
```typescript
// Get current sync state for debugging:
import { getSyncState } from "../lib/appSync";

const state = getSyncState();
console.log("Sync State:", state);
// Output: { initialized: true, isOnline: true, listenerCount: 5, hasSyncInterval: true }
```

---

## Key Interfaces

### TestAttemptRecord
```typescript
interface TestAttemptRecord {
  id: string;
  studentId: string;
  studentName: string;
  testId?: string;
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  testType: "topic" | "full_chapter";
  attemptNumber: number;
  date: string;
  timestamp: number;
  timeTakenSeconds: number;
  score: number;
  totalMarks?: number;
  totalQuestions: number;
  percentage: number;
  correctAnswersCount: number;
  wrongAnswersCount: number;
  unattemptedCount?: number;
  userAnswers: Record<string, string>;
}
```

### ClassNote
```typescript
interface ClassNote {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  partLabel?: string;
  topicNo?: number | string;
  topicName?: string;
  pdfUrl: string;
  pdfFileName: string;
  storagePath?: string;
  bucket?: string;
  fileType?: "pdf" | "image";
  mimeType?: string;
  createdAt: string;
  updatedAt?: string;
  uploadedBy?: string;
  accessType?: "all" | "selected";
  allowedStudentIds?: string[];
  allowedClasses?: string[];
}
```

---

## Firestore Collections Quick Reference

### Collections That Sync in Real-Time

| Collection | Purpose | Real-Time | Synced |
|-----------|---------|-----------|--------|
| `students` | Student records | ✅ | Admin & Student |
| `class_notes` | Topic notes & PDFs | ✅ | All users |
| `practice_tests` | Practice test definitions | ✅ | All users |
| `student_test_attempts` | Test results | ✅ | Owner & Admin |
| `student_topic_test_scores` | Score summaries | ✅ | All users |
| `announcements` | Announcements | ✅ | All users |
| `practice_tests_sync` | Sync signals | ✅ | Coordinators |
| `content_sync_signals` | Deletion signals | ✅ | Coordinators |

---

## Environment & Deployment

### Firebase Project Configuration
Already configured in:
- `firebaseConfig` object in `src/lib/firebase.ts`
- Project ID: `academy-connect-500d1`
- Firestore: EU region
- Real-time: Enabled

### Deploy Firestore Rules
```bash
firebase deploy --only firestore:rules
```

### Environment Variables
Set in `.env` or project settings:
```
VITE_FIREBASE_PROJECT_ID=academy-connect-500d1
VITE_FIREBASE_AUTH_DOMAIN=academy-connect-500d1.firebaseapp.com
VITE_FIREBASE_API_KEY=<your-api-key>
```

---

## Performance Tips

1. **Minimize Listeners**
   - Listeners automatically deduplicated
   - Don't create multiple subscriptions to same collection
   - Use `getSyncState()` to monitor

2. **Cache First**
   - Local cache checked before Firestore
   - Instant UI updates
   - Automatic sync in background

3. **Batch Operations**
   - Multiple updates should use batch writes
   - Already done in `saveClassNoteDoc()`, `saveTestAttemptDoc()`

4. **Offline-First**
   - Sync queue handles offline scenarios
   - No manual retry needed
   - Automatic on reconnect

---

## Troubleshooting Checklist

- [ ] Is sync initialized? Check `getSyncState().initialized`
- [ ] Is online? Check `navigator.onLine`
- [ ] Are listeners active? Check listener count in DevTools Memory
- [ ] Are there Firestore errors? Check browser console
- [ ] Are Firestore rules correct? Test in Firestore emulator
- [ ] Is data being written? Check Firestore collections
- [ ] Are subscriptions cleaned up? Check DevTools Memory on logout

---

## Code Examples by Use Case

### Use Case 1: Admin Creates Practice Test
**File:** `AdminPracticeTestModal.tsx`
```typescript
const handleSave = async () => {
  const result = await saveTopicPracticeTest(context, questions);
  if (result.success) {
    // Already synced to students automatically!
    onPracticeTestChanged();
  }
};
```

### Use Case 2: Admin Deletes Note
**File:** `AdminNotesView.tsx` or similar
```typescript
const handleDeleteNote = async (noteId) => {
  await deleteClassNoteDoc(noteId);
  // Automatically removed from all students immediately
  // Deletion signal broadcast to all devices
};
```

### Use Case 3: Student Views Test Results
**File:** `StudentDashboard.tsx`
```typescript
useEffect(() => {
  const unsubscribe = subscribeToTestAttempts((attempts) => {
    const studentAttempts = attempts.filter(a => a.studentId === studentId);
    const topicScores = calculateTopicScores(studentAttempts);
    setTestResults(topicScores);
  });
  return () => unsubscribe();
}, [studentId]);
```

### Use Case 4: Student Logs In
**File:** `Login.tsx`
```typescript
const handleLogin = async (e) => {
  // ... Firebase auth ...
  const normalizedRole = "Student";
  if (normalizedRole === "Student" && studentId) {
    await loadStudentTestScores(studentId);  // Restore previous results
    initializeStudentSync(studentId);        // Start real-time sync
  }
  onLoginSuccess(normalizedRole, studentId, uid);
};
```

---

## File Organization

```
src/lib/
├── realtimeSync.ts            # Core sync primitives
├── testScorePersistence.ts     # Student score management
├── appSync.ts                  # App-wide initialization
├── firestoreService.ts         # Firestore operations (enhanced)
├── practiceTestService.ts      # Practice tests (enhanced)
└── firebase.ts                 # Firebase initialization

src/components/
├── Login.tsx                   # Login with score loading
├── App.tsx                     # Sync initialization/cleanup
├── StudentDashboard.tsx        # Student real-time updates
├── AdminNotesView.tsx          # Admin content management
└── StudentPracticeTestModal.tsx # Test submission

docs/
├── REALTIME_SYNC_IMPLEMENTATION.md  # Full implementation guide
└── IMPLEMENTATION_SUMMARY.md         # This summary
```

---

## Important Notes

1. **No Manual Refresh Needed** - All updates happen automatically
2. **No App Restart Needed** - Real-time listeners handle updates
3. **Backward Compatible** - Existing data continues to work
4. **Scalable** - Handles thousands of students efficiently
5. **Secure** - Firestore rules enforce access control
6. **Offline-Capable** - Works even without internet

---

## Future Enhancements

Potential improvements for future versions:
- [ ] Selective sync (by class/subject only)
- [ ] Bandwidth optimization for slow networks
- [ ] Conflict resolution for simultaneous edits
- [ ] Sync analytics dashboard
- [ ] Partial offline support (more operations)
- [ ] Incremental sync (only changed data)

---

**Last Updated:** 2024-09-12
**Version:** 1.0.0
**Status:** ✅ Production Ready
