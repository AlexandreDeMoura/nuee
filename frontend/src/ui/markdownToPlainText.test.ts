import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from './markdownToPlainText';

describe('markdownToPlainText', () => {
  it('projects the supported markdown subset into collapsed plain text', () => {
    expect(
      markdownToPlainText(`# Key finding

Use a **phased** *rollout* with \`feature_flags\`.

- Validate [the brief](https://example.com/brief)
1. Launch a pilot

| Risk | Response |
| :--- | ---: |
| Delay | Add a checkpoint |

\`\`\`ts
const ready = true;
\`\`\`

Review supporting evidence [1].

[1]: https://example.com/evidence`),
    ).toBe(
      'Key finding Use a phased rollout with feature_flags. Validate the brief Launch a pilot Risk Response Delay Add a checkpoint Review supporting evidence 1.',
    );
  });

  it('omits unclosed fenced code and its contents', () => {
    expect(
      markdownToPlainText(`Useful introduction.

\`\`\`ts
const implementationDetail = true;`),
    ).toBe('Useful introduction.');
  });

  it('normalizes line endings and empty markdown', () => {
    expect(markdownToPlainText('## First\r\n\r\nSecond')).toBe('First Second');
    expect(markdownToPlainText('  \n')).toBe('');
  });
});
