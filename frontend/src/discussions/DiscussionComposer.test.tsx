import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscussionSourceCatalog } from './discussionSourceCatalog';
import { DiscussionComposer } from './DiscussionComposer';

afterEach(cleanup);

const sourceCatalog: DiscussionSourceCatalog = {
  projectId: 'project-1',
  sources: [
    {
      id: 'bubble-retention',
      kind: 'bubble',
      secondaryLine: 'Accounts that never invite a teammate',
      title: 'Retention signal',
    },
    {
      id: 'document-ready',
      kind: 'document',
      readiness: { status: 'ready' },
      secondaryLine: 'PDF · 14 pages',
      title: 'Quarterly review',
    },
    {
      id: 'document-processing',
      kind: 'document',
      readiness: { reason: 'processing', status: 'not_ready' },
      secondaryLine: 'PDF · processing',
      title: 'Interview notes',
    },
  ],
};

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof DiscussionComposer>> = {},
) {
  const props: React.ComponentProps<typeof DiscussionComposer> = {
    isInitialPrompt: true,
    isSubmitting: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    sourceCatalog,
    value: '',
    ...overrides,
  };

  const result = render(<DiscussionComposer {...props} />);
  return { ...result, props };
}

function typeAtCaret(
  textarea: HTMLTextAreaElement,
  value: string,
  caret = value.length,
) {
  fireEvent.change(textarea, {
    target: { selectionStart: caret, value },
  });
}

function ControlledComposer() {
  const [value, setValue] = useState('');

  return (
    <DiscussionComposer
      isInitialPrompt
      isSubmitting={false}
      onChange={setValue}
      onSubmit={vi.fn()}
      sourceCatalog={sourceCatalog}
      value={value}
    />
  );
}

describe('DiscussionComposer mentions', () => {
  it('starts with locked project context and a live one-source freeze count', () => {
    renderComposer();

    expect(
      screen.getByLabelText('Project description, always included'),
    ).not.toBeNull();
    expect(screen.getByText('ALWAYS')).not.toBeNull();
    expect(
      screen.getByText('Type @ to bring in a bubble or document'),
    ).not.toBeNull();
    expect(screen.getByText(/1 SOURCE FREEZE WHEN YOU SEND/)).not.toBeNull();
  });

  it('opens a grouped combobox and skips unavailable documents with the keyboard', () => {
    const onMentionSourceSelect = vi.fn();
    const { props, rerender } = renderComposer({ onMentionSourceSelect });
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });

    typeAtCaret(textarea, '@');
    rerender(<DiscussionComposer {...props} value="@" />);

    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'BUBBLES' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'DOCUMENTS' })).not.toBeNull();
    expect(screen.getByText('3 MATCHES')).not.toBeNull();
    expect(screen.getByText('READY')).not.toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('option', {
        name: /Interview notes/,
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        'Still processing. It can be attached when it is ready.',
      ),
    ).not.toBeNull();

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onMentionSourceSelect).toHaveBeenCalledWith(
      sourceCatalog.sources[1],
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(textarea);
  });

  it('filters from the text after @ and Escape dismisses without changing the draft', () => {
    const onChange = vi.fn();
    const { props, rerender } = renderComposer({ onChange });
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });
    textarea.focus();

    typeAtCaret(textarea, 'Compare @retention');
    rerender(<DiscussionComposer {...props} value="Compare @retention" />);

    expect(screen.getByText('1 MATCH')).not.toBeNull();
    expect(screen.getByRole('option', { name: /Retention signal/ })).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Quarterly review/ })).toBeNull();

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('Compare @retention');
    expect(textarea.value).toBe('Compare @retention');
    expect(document.activeElement).toBe(textarea);
  });

  it('offers owning-feature actions when the project has no sources', () => {
    const onCreateBubble = vi.fn();
    const onUploadDocument = vi.fn();
    const emptyCatalog: DiscussionSourceCatalog = {
      projectId: 'project-1',
      sources: [],
    };
    const { props, rerender } = renderComposer({
      onCreateBubble,
      onUploadDocument,
      sourceCatalog: emptyCatalog,
    });
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });

    typeAtCaret(textarea, '@');
    rerender(<DiscussionComposer {...props} value="@" />);

    expect(
      screen.getByText(/project description is already included/i),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Upload a document' }),
    );
    expect(onUploadDocument).toHaveBeenCalledOnce();

    typeAtCaret(textarea, '@new');
    rerender(<DiscussionComposer {...props} value="@new" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a bubble' }));
    expect(onCreateBubble).toHaveBeenCalledOnce();
  });

  it('attaches a source as one chip and highlights its plain-text token', () => {
    const { container } = render(<ControlledComposer />);
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });

    typeAtCaret(textarea, 'Compare @ret');
    fireEvent.click(
      screen.getByRole('option', { name: /Retention signal/ }),
    );

    expect(textarea.value).toBe('Compare Retention signal ');
    expect(
      container.querySelector(
        '[data-discussion-mention-chip="bubble:bubble-retention"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-discussion-mention-token="bubble:bubble-retention"]',
      )?.textContent,
    ).toBe('Retention signal');
    expect(screen.getByText(/2 SOURCES FREEZE WHEN YOU SEND/)).not.toBeNull();
  });

  it('removes both chip and token, with a transient exiting chip', () => {
    const { container } = render(<ControlledComposer />);
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });

    typeAtCaret(textarea, '@ret');
    fireEvent.click(
      screen.getByRole('option', { name: /Retention signal/ }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove bubble: Retention signal' }),
    );

    expect(textarea.value).toBe(' ');
    expect(
      container.querySelector('[data-discussion-mention-chip]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-discussion-mention-chip-exiting]'),
    ).not.toBeNull();
    expect(screen.getByText(/1 SOURCE FREEZE WHEN YOU SEND/)).not.toBeNull();
  });

  it('detaches on token edits and atomically deletes from its trailing edge', () => {
    const { container } = render(<ControlledComposer />);
    const textarea = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });

    typeAtCaret(textarea, '@ret');
    fireEvent.click(
      screen.getByRole('option', { name: /Retention signal/ }),
    );
    typeAtCaret(textarea, 'Retention xignal ');

    expect(
      container.querySelector('[data-discussion-mention-chip]'),
    ).toBeNull();

    typeAtCaret(textarea, '@ret');
    fireEvent.click(
      screen.getByRole('option', { name: /Retention signal/ }),
    );
    textarea.setSelectionRange(
      'Retention signal'.length,
      'Retention signal'.length,
    );
    fireEvent.keyDown(textarea, { key: 'Backspace' });

    expect(textarea.value).toBe(' ');
    expect(
      container.querySelector('[data-discussion-mention-chip]'),
    ).toBeNull();
  });
});
