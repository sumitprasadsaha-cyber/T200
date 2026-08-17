export function createPracticeTestChangeHandler(options: {
  onPracticeTestChanged?: () => void;
} = {}) {
  const { onPracticeTestChanged } = options;

  return () => {
    if (onPracticeTestChanged) {
      onPracticeTestChanged();
    }
  };
}
