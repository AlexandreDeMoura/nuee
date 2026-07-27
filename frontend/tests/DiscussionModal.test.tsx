import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiscussionModal } from '../src/discussions';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function DraftModal({
  onMinimize,
  onSubmit,
}: {
  onMinimize: () => void;
  onSubmit?: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState('');

  return (
    <DiscussionModal
      onDraftPromptChange={setPrompt}
      onDraftSubmit={onSubmit}
      onMinimize={onMinimize}
      visibleDiscussion={{
        key: 1,
        kind: 'draft',
        prompt,
        title: 'New discussion',
      }}
    />
  );
}

describe('DiscussionModal', () => {
  it('renders an accessible write-first shell and submits a normalized prompt', () => {
    const onSubmit = vi.fn();

    render(<DraftModal onMinimize={vi.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog', { name: 'New discussion' });
    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });
    const continueButton = screen.getByRole('button', {
      name: 'Continue discussion',
    });

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(prompt);
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(prompt, {
      target: { value: '  Which risk matters most?  ' },
    });
    expect((continueButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(continueButton);
    expect(onSubmit).toHaveBeenCalledWith('Which risk matters most?');
  });

  it('traps focus, minimizes with Escape, and restores prior focus', () => {
    function Harness() {
      const [isOpen, setIsOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open discussion
          </button>
          {isOpen && <DraftModal onMinimize={() => setIsOpen(false)} />}
        </>
      );
    }

    render(<Harness />);

    const opener = screen.getByRole('button', { name: 'Open discussion' });
    opener.focus();
    fireEvent.click(opener);

    const minimize = screen.getByRole('button', {
      name: 'Minimize discussion',
    });
    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });

    minimize.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(prompt);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does not treat backdrop pointer input as a close action', () => {
    const onMinimize = vi.fn();
    render(<DraftModal onMinimize={onMinimize} />);

    const overlay = document.querySelector('[data-discussion-overlay]');
    expect(overlay).not.toBeNull();

    fireEvent.pointerDown(overlay!);
    fireEvent.mouseDown(overlay!);

    expect(onMinimize).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
