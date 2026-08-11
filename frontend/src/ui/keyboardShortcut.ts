const isApplePlatform =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Writes a primary-modifier chord the way the current platform spells it. */
export function primaryShortcutLabel(key: string): string {
  const printedKey = key.toUpperCase();

  return isApplePlatform ? `⌘${printedKey}` : `Ctrl+${printedKey}`;
}

/** Matches a primary-modifier chord with no other modifier held. */
export function isPrimaryShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === key.toLowerCase()
  );
}
