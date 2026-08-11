import {
  TERRITORY_TITLE_MAX_LENGTH,
  type TerritoryDestination,
} from '@nuee/shared-types';

export type TerritoryDestinationValidationResult =
  | {
      valid: true;
      destination: TerritoryDestination;
    }
  | {
      valid: false;
      fieldErrors: Record<string, string>;
    };

export function normalizeTerritoryDestination(
  input: unknown,
): TerritoryDestinationValidationResult {
  if (input === undefined) {
    return { valid: true, destination: { kind: 'ungrouped' } };
  }

  if (!isRecord(input)) {
    return {
      valid: false,
      fieldErrors: { destination: 'Destination must be an object.' },
    };
  }

  const fieldErrors: Record<string, string> = {};

  if (input.kind === 'ungrouped') {
    rejectUnknownFields(input, ['kind'], fieldErrors);
    return result(fieldErrors, { kind: 'ungrouped' });
  }

  if (input.kind === 'existing') {
    rejectUnknownFields(input, ['kind', 'territory_id'], fieldErrors);
    const territoryId = requiredIdentifier(input.territory_id, fieldErrors);

    return territoryId === undefined
      ? { valid: false, fieldErrors }
      : result(fieldErrors, {
          kind: 'existing',
          territory_id: territoryId,
        });
  }

  if (input.kind === 'new') {
    rejectUnknownFields(
      input,
      ['kind', 'title', 'position_x', 'position_y'],
      fieldErrors,
    );
    const title = requiredTitle(input.title, fieldErrors);
    const positionX = requiredCoordinate(
      input.position_x,
      'position_x',
      'Horizontal',
      fieldErrors,
    );
    const positionY = requiredCoordinate(
      input.position_y,
      'position_y',
      'Vertical',
      fieldErrors,
    );

    return title === undefined ||
      positionX === undefined ||
      positionY === undefined
      ? { valid: false, fieldErrors }
      : result(fieldErrors, {
          kind: 'new',
          title,
          position_x: positionX,
          position_y: positionY,
        });
  }

  rejectUnknownFields(
    input,
    ['kind', 'territory_id', 'title', 'position_x', 'position_y'],
    fieldErrors,
  );
  fieldErrors.kind =
    'Destination kind must be "ungrouped", "existing", or "new".';
  return { valid: false, fieldErrors };
}

function requiredIdentifier(
  value: unknown,
  fieldErrors: Record<string, string>,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fieldErrors.territory_id = 'Territory identifier is required.';
    return undefined;
  }

  return value.trim();
}

function requiredTitle(
  value: unknown,
  fieldErrors: Record<string, string>,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fieldErrors.title = 'Title is required.';
    return undefined;
  }

  const title = value.trim();

  if (title.length > TERRITORY_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Title must be ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`;
    return undefined;
  }

  return title;
}

function requiredCoordinate(
  value: unknown,
  field: 'position_x' | 'position_y',
  label: 'Horizontal' | 'Vertical',
  fieldErrors: Record<string, string>,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fieldErrors[field] = `${label} position must be a finite number.`;
    return undefined;
  }

  return value;
}

function rejectUnknownFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
  fieldErrors: Record<string, string>,
): void {
  for (const field of Object.keys(input)) {
    if (!allowedFields.includes(field)) {
      fieldErrors[field] = 'Unknown field.';
    }
  }
}

function result(
  fieldErrors: Record<string, string>,
  destination: TerritoryDestination,
): TerritoryDestinationValidationResult {
  return Object.keys(fieldErrors).length === 0
    ? { valid: true, destination }
    : { valid: false, fieldErrors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
