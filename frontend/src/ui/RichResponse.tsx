import type { ReactNode } from 'react';

interface RichResponseProps {
  content: string;
  density?: 'compact' | 'comfortable';
}

type CitationReferences = ReadonlyMap<string, string>;

const inlineTokenPattern =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)]+\)|\[[^\]\n]+\]\[[^\]\n]+\]|\[[^\]\n]+\])/g;
const listItemPattern = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
const citationDefinitionPattern =
  /^\s*\[([^\]\n]+)\]:\s*(\S+)(?:\s+["'(].*)?$/;

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());

    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function citationLink(
  href: string,
  label: string,
  key: string,
): ReactNode {
  return (
    <a
      className="font-medium text-[#3f63a8] underline decoration-[#aebed8] underline-offset-2 hover:text-[#294b87] focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25"
      data-citation
      href={href}
      key={key}
      rel="noreferrer noopener"
      target="_blank"
    >
      {label}
    </a>
  );
}

function inlineContent(
  content: string,
  references: CitationReferences,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(inlineTokenPattern)) {
    const index = match.index;
    const token = match[0];

    if (index > cursor) {
      nodes.push(content.slice(cursor, index));
    }

    if (token.startsWith('`')) {
      nodes.push(
        <code
          className="rounded bg-[#edf1f6] px-1.25 py-0.5 text-[0.92em] text-[#28384e] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          key={`inline-code:${index}`}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong className="font-semibold text-[#273446]" key={`strong:${index}`}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={`emphasis:${index}`}>{token.slice(1, -1)}</em>,
      );
    } else {
      const directLink = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const referenceLink = token.match(/^\[([^\]]+)\]\[([^\]]+)\]$/);
      const shortReference = token.match(/^\[([^\]]+)\]$/);
      const isImage =
        index > 0 && content[index - 1] === '!';
      let label: string | null = null;
      let href: string | null = null;

      if (!isImage && directLink) {
        label = directLink[1];
        href = safeExternalUrl(directLink[2]);
      } else if (!isImage && referenceLink) {
        label = referenceLink[1];
        href = references.get(referenceLink[2].toLowerCase()) ?? null;
      } else if (!isImage && shortReference) {
        label = shortReference[1];
        href = references.get(shortReference[1].toLowerCase()) ?? null;
      }

      nodes.push(
        label && href
          ? citationLink(href, label, `citation:${index}`)
          : token,
      );
    }

    cursor = index + token.length;
  }

  if (cursor < content.length) {
    nodes.push(content.slice(cursor));
  }

  return nodes;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function isTableStart(lines: readonly string[], index: number): boolean {
  return (
    index + 1 < lines.length &&
    lines[index].includes('|') &&
    isTableDivider(lines[index + 1]) &&
    tableCells(lines[index]).length === tableCells(lines[index + 1]).length
  );
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index];

  return (
    /^ {0,3}```/.test(line) ||
    /^ {0,3}#{1,3}\s+/.test(line) ||
    listItemPattern.test(line) ||
    isTableStart(lines, index)
  );
}

function preparedContent(content: string): {
  lines: string[];
  references: Map<string, string>;
} {
  const references = new Map<string, string>();
  const lines = content.replace(/\r\n?/g, '\n').split('\n');

  return {
    lines: lines.map((line) => {
      const definition = line.match(citationDefinitionPattern);
      const href = definition ? safeExternalUrl(definition[2]) : null;

      if (definition && href) {
        references.set(definition[1].toLowerCase(), href);
        return '';
      }

      return line;
    }),
    references,
  };
}

const densityClasses = {
  compact: 'space-y-2.5 text-[12.5px] leading-[1.6]',
  comfortable: 'space-y-3.5 text-[15.5px] leading-[1.65]',
} as const;

export function RichResponse({
  content,
  density = 'comfortable',
}: RichResponseProps) {
  const { lines, references } = preparedContent(content);
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```\s*([A-Za-z0-9_+-]*)\s*$/);

    if (fence) {
      const codeLines: string[] = [];
      const language = fence[1];
      index += 1;

      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <pre
          className="max-w-full overflow-x-auto rounded-xl border border-[#dde3ea] bg-[#202a37] px-4.75 py-3.5 text-[14px] leading-[1.65] text-[#edf2f7] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          data-code-language={language || undefined}
          key={`code:${blockKey}`}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      blockKey += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = tableCells(lines[index]);
      const rows: string[][] = [];
      index += 2;

      while (
        index < lines.length &&
        lines[index].trim().length > 0 &&
        lines[index].includes('|')
      ) {
        const cells = tableCells(lines[index]);

        if (cells.length !== headers.length) {
          break;
        }

        rows.push(cells);
        index += 1;
      }

      blocks.push(
        <div
          className="max-w-full overflow-x-auto rounded-xl border border-[#dde3ea]"
          key={`table:${blockKey}`}
        >
          <table className="w-full min-w-[432px] border-collapse text-left text-[14px] leading-[1.5]">
            <thead className="bg-[#eef2f7] text-[#344050]">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th
                    className="border-r border-[#dde3ea] px-3.5 py-2.5 font-semibold last:border-r-0"
                    key={`header:${cellIndex}`}
                    scope="col"
                  >
                    {inlineContent(header, references)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {rows.map((row, rowIndex) => (
                <tr className="border-t border-[#e6eaf0]" key={`row:${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      className="border-r border-[#e6eaf0] px-3.5 py-2.5 align-top text-[#4b596b] last:border-r-0"
                      key={`cell:${cellIndex}`}
                    >
                      {inlineContent(cell, references)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      blockKey += 1;
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,3})\s+(.+)$/);

    if (heading) {
      const headingClasses =
        heading[1].length === 1
          ? 'text-[18px]'
          : heading[1].length === 2
            ? 'text-[16px]'
            : 'text-[15px] uppercase tracking-[0.04em]';
      const children = inlineContent(heading[2], references);

      blocks.push(
        heading[1].length === 1 ? (
          <h3
            className={`font-semibold leading-[1.4] text-[#273446] ${headingClasses}`}
            key={`heading:${blockKey}`}
          >
            {children}
          </h3>
        ) : heading[1].length === 2 ? (
          <h4
            className={`font-semibold leading-[1.4] text-[#273446] ${headingClasses}`}
            key={`heading:${blockKey}`}
          >
            {children}
          </h4>
        ) : (
          <h5
            className={`font-semibold leading-[1.4] text-[#526174] ${headingClasses}`}
            key={`heading:${blockKey}`}
          >
            {children}
          </h5>
        ),
      );
      blockKey += 1;
      index += 1;
      continue;
    }

    const listItem = line.match(listItemPattern);

    if (listItem) {
      const ordered = /^\d/.test(listItem[2]);
      const items: string[] = [];
      const start = ordered ? Number.parseInt(listItem[2], 10) : undefined;

      while (index < lines.length) {
        const nextItem = lines[index].match(listItemPattern);

        if (!nextItem || /^\d/.test(nextItem[2]) !== ordered) {
          break;
        }

        items.push(nextItem[3]);
        index += 1;
      }

      const listClasses = ordered
        ? 'list-decimal'
        : 'list-disc';
      const children = items.map((item, itemIndex) => (
        <li className="pl-1.25" key={`item:${itemIndex}`}>
          {inlineContent(item, references)}
        </li>
      ));

      blocks.push(
        ordered ? (
          <ol
            className={`space-y-1.75 pl-6 text-[#3d4b5d] marker:font-semibold marker:text-[#66768b] ${listClasses}`}
            key={`list:${blockKey}`}
            start={start}
          >
            {children}
          </ol>
        ) : (
          <ul
            className={`space-y-1.75 pl-6 text-[#3d4b5d] marker:text-[#7f8da0] ${listClasses}`}
            key={`list:${blockKey}`}
          >
            {children}
          </ul>
        ),
      );
      blockKey += 1;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;

    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !isBlockStart(lines, index)
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(
      <p className="text-[#3d4b5d]" key={`paragraph:${blockKey}`}>
        {inlineContent(paragraphLines.join(' '), references)}
      </p>,
    );
    blockKey += 1;
  }

  return (
    <div
      className={densityClasses[density]}
      data-density={density}
      data-rich-response
    >
      {blocks}
    </div>
  );
}
