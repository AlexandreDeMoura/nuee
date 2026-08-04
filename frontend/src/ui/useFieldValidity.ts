import { useState } from 'react';

export interface FieldValidityOptions {
  /**
   * Returns true when a blur is the surrounding UI's doing rather than the
   * user's — a closing modal restoring focus, most of all. Such a blur must
   * never reveal an error the user has not had a chance to avoid.
   */
  isSuppressed?: () => boolean;
}

export interface FieldValidity<Field extends string> {
  /** Whether the value breaks its rule. True from the first render. */
  isInvalid: Readonly<Record<Field, boolean>>;
  /** Whether the user should see that yet. Never true before `isInvalid`. */
  showError: Readonly<Record<Field, boolean>>;
  /** The user has left the field, so its error may now surface. */
  markTouched: (field: Field) => void;
  /** Surface every error at once, for a submit the user knowingly attempted. */
  revealAll: () => void;
}

/**
 * Separates two questions that look like one and are not:
 *
 * - `isInvalid` — is the value wrong? Live from the first render, and what
 *   gating belongs on: disabled submits, withheld autosaves.
 * - `showError` — should the user be told? Only once they have left the field
 *   or knowingly submitted, and never on a blur the UI caused itself.
 *
 * Conflating them is what makes a pristine form accuse its first field of being
 * empty, and what makes an editor shout on every keystroke while a field is
 * being retyped. Deriving both here keeps the conjunction in one place.
 */
export function useFieldValidity<Field extends string>(
  isInvalid: Readonly<Record<Field, boolean>>,
  { isSuppressed }: FieldValidityOptions = {},
): FieldValidity<Field> {
  const [touched, setTouched] = useState<Readonly<Record<string, boolean>>>({});

  const fields = Object.keys(isInvalid) as Field[];
  const showError = {} as Record<Field, boolean>;

  for (const field of fields) {
    showError[field] = isInvalid[field] && touched[field] === true;
  }

  const markTouched = (field: Field) => {
    if (isSuppressed?.()) {
      return;
    }

    setTouched((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  };

  const revealAll = () => {
    setTouched(Object.fromEntries(fields.map((field) => [field, true])));
  };

  return { isInvalid, showError, markTouched, revealAll };
}
