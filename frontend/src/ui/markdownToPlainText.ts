const tableDividerCellPattern = /^:?-{3,}:?$/;
const codeFenceStartPattern = /^ {0,3}```\s*[A-Za-z0-9_+-]*\s*$/;
const codeFenceEndPattern = /^ {0,3}```\s*$/;

function isTableDivider(line: string) {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

  return cells.length > 0 && cells.every((cell) => tableDividerCellPattern.test(cell));
}

export function markdownToPlainText(markdown: string) {
  let insideCodeFence = false;
  const linesWithoutCode = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => {
      if (!insideCodeFence && codeFenceStartPattern.test(line)) {
        insideCodeFence = true;
        return false;
      }

      if (insideCodeFence) {
        if (codeFenceEndPattern.test(line)) {
          insideCodeFence = false;
        }

        return false;
      }

      return true;
    });

  return linesWithoutCode
    .filter((line) => !isTableDivider(line))
    .map((line) =>
      line
        .replace(/^ {0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
        .replace(/^\s*\[[^\]\n]+\]:\s*\S+.*$/, ''),
    )
    .join('\n')
    .replace(/!?\[([^\]\n]+)\]\([^)]+\)/g, '$1')
    .replace(/!?\[([^\]\n]+)\]\[[^\]\n]+\]/g, '$1')
    .replace(/\[([^\]\n]+)\]/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\|/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
