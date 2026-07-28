import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RichResponse } from '../src/discussions';

afterEach(cleanup);

describe('RichResponse', () => {
  it('renders the approved rich-text subset without truncating the response', () => {
    render(
      <RichResponse
        content={`# Answer

Use a **phased rollout** with \`feature_flags\`.

- Validate licensing
- Confirm support coverage
1. Run the pilot
2. Review the evidence

| Risk | Response |
| --- | --- |
| Delay | Add a checkpoint |
| Cost | Set a ceiling |

\`\`\`ts
const ready = risks.every((risk) => risk.closed);
\`\`\`

See [the launch brief](https://example.com/brief) and supporting evidence [1].

[1]: https://example.com/evidence`}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Answer' })).toBeTruthy();
    expect(screen.getByText('phased rollout', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('feature_flags', { selector: 'code' })).toBeTruthy();
    expect(screen.getAllByRole('list')).toHaveLength(2);

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Risk' })).toBeTruthy();
    expect(within(table).getByText('Add a checkpoint')).toBeTruthy();

    const codeBlock = document.querySelector('pre[data-code-language="ts"]');
    expect(codeBlock?.textContent).toContain('risks.every');

    const directCitation = screen.getByRole('link', {
      name: 'the launch brief',
    });
    const referenceCitation = screen.getByRole('link', { name: '1' });

    expect(directCitation.getAttribute('href')).toBe(
      'https://example.com/brief',
    );
    expect(referenceCitation.getAttribute('href')).toBe(
      'https://example.com/evidence',
    );
    expect(directCitation.getAttribute('rel')).toContain('noopener');
    expect(directCitation.getAttribute('target')).toBe('_blank');
  });

  it('keeps raw HTML and unsafe or unsupported links inert', () => {
    const { container } = render(
      <RichResponse
        content={`<script>window.compromised = true</script>

[unsafe](javascript:alert(1))

![tracking pixel](https://example.com/pixel.gif)

<img src=x onerror=alert(1)>`}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'tracking pixel' })).toBeNull();
    expect(container.textContent).toContain(
      '<script>window.compromised = true</script>',
    );
    expect(container.textContent).toContain('[unsafe](javascript:alert(1))');
    expect(container.textContent).toContain(
      '![tracking pixel](https://example.com/pixel.gif)',
    );
  });
});
