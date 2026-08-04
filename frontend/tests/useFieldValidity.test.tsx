import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFieldValidity } from '../src/ui/useFieldValidity';

afterEach(cleanup);

function TestForm({ isSuppressed }: { isSuppressed?: () => boolean }) {
  const [title, setTitle] = useState('');
  const fields = useFieldValidity(
    { title: title.trim().length === 0 },
    { isSuppressed },
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        fields.revealAll();
      }}
    >
      <input
        aria-label="Title"
        value={title}
        onBlur={() => fields.markTouched('title')}
        onChange={(event) => setTitle(event.target.value)}
      />
      <output data-testid="is-invalid">{String(fields.isInvalid.title)}</output>
      <output data-testid="show-error">{String(fields.showError.title)}</output>
      <button type="submit">Submit</button>
    </form>
  );
}

const isInvalid = () => screen.getByTestId('is-invalid').textContent;
const showError = () => screen.getByTestId('show-error').textContent;

describe('useFieldValidity', () => {
  it('knows a pristine field is invalid without saying so', () => {
    render(<TestForm />);

    expect(isInvalid()).toBe('true');
    expect(showError()).toBe('false');
  });

  it('reveals the error once the user leaves the field', () => {
    render(<TestForm />);

    fireEvent.blur(screen.getByLabelText('Title'));

    expect(showError()).toBe('true');
  });

  it('stays quiet while a field is emptied mid-edit', () => {
    render(<TestForm />);

    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Draft' } });
    fireEvent.change(title, { target: { value: '' } });

    expect(isInvalid()).toBe('true');
    expect(showError()).toBe('false');
  });

  it('reveals everything on a submit the user knowingly attempted', () => {
    render(<TestForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(showError()).toBe('true');
  });

  it('ignores a blur the surrounding UI caused', () => {
    render(<TestForm isSuppressed={() => true} />);

    fireEvent.blur(screen.getByLabelText('Title'));

    expect(isInvalid()).toBe('true');
    expect(showError()).toBe('false');
  });

  it('hides a revealed error again once the value becomes valid', () => {
    render(<TestForm />);

    const title = screen.getByLabelText('Title');
    fireEvent.blur(title);
    expect(showError()).toBe('true');

    fireEvent.change(title, { target: { value: 'Launch plan' } });

    expect(isInvalid()).toBe('false');
    expect(showError()).toBe('false');
  });
});
