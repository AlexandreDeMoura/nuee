import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RichResponse } from './RichResponse';

afterEach(cleanup);

describe('RichResponse', () => {
  it('renders every supported block type and inline formatting', () => {
    render(
      <RichResponse
        content={`# Answer
## Rollout
### Checks

Use a **phased rollout** with *small cohorts* and \`feature_flags\`.

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

    expect(screen.getByRole('heading', { level: 3, name: 'Answer' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Rollout' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 5, name: 'Checks' })).toBeTruthy();
    expect(screen.getByText('phased rollout', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('small cohorts', { selector: 'em' })).toBeTruthy();
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

  it('rejects javascript URLs and leaves unsupported syntax as literal text', () => {
    const { container } = render(
      <RichResponse
        content={`#### Unsupported heading

<script>window.compromised = true</script>

[unsafe](javascript:alert(1))

![tracking pixel](https://example.com/pixel.gif)

<img src=x onerror=alert(1)>`}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'tracking pixel' })).toBeNull();
    expect(container.textContent).toContain('#### Unsupported heading');
    expect(container.textContent).toContain(
      '<script>window.compromised = true</script>',
    );
    expect(container.textContent).toContain('[unsafe](javascript:alert(1))');
    expect(container.textContent).toContain(
      '![tracking pixel](https://example.com/pixel.gif)',
    );
  });

  it.each([
    [
      'comfortable',
      'space-y-3.5 text-[15.5px] leading-[1.65]',
    ],
    ['compact', 'space-y-2.5 text-[12.5px] leading-[1.6]'],
  ] as const)('renders the %s density scale', (density, expectedClasses) => {
    const { container } = render(
      <RichResponse content="Density sample" density={density} />,
    );
    const response = container.querySelector('[data-rich-response]');

    expect(response?.getAttribute('data-density')).toBe(density);
    expect(response?.className).toBe(expectedClasses);
  });

  it('uses comfortable density by default', () => {
    const { container } = render(<RichResponse content="Default scale" />);

    expect(
      container
        .querySelector('[data-rich-response]')
        ?.getAttribute('data-density'),
    ).toBe('comfortable');
  });
});
