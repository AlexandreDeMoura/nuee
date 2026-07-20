export function formatUpdatedAt(updatedAt: string, now = new Date()): string {
  const timestamp = new Date(updatedAt).getTime();

  if (!Number.isFinite(timestamp)) {
    return 'Recently';
  }

  const elapsedMilliseconds = Math.max(0, now.getTime() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);

  if (elapsedMinutes < 1) {
    return 'Just now';
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 14) {
    return `${elapsedDays}d ago`;
  }

  const elapsedWeeks = Math.floor(elapsedDays / 7);

  if (elapsedDays < 60) {
    return `${elapsedWeeks}w ago`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);

  if (elapsedDays < 730) {
    return `${elapsedMonths}mo ago`;
  }

  return `${Math.floor(elapsedDays / 365)}y ago`;
}
