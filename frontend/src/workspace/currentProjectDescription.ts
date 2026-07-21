import { createContext, useContext } from 'react';

/**
 * The last successfully persisted project description.
 *
 * Discussion creation can copy this value into its frozen context snapshot.
 * Consumers cannot update the live project through this contract, and existing
 * snapshots must never retain a reference to it.
 */
export interface CurrentProjectDescription {
  readonly projectId: string;
  readonly currentDescription: string;
}

export const CurrentProjectDescriptionContext =
  createContext<CurrentProjectDescription | null>(null);

export function useCurrentProjectDescription(): CurrentProjectDescription {
  const context = useContext(CurrentProjectDescriptionContext);

  if (!context) {
    throw new Error(
      'useCurrentProjectDescription must be used inside a project workspace.',
    );
  }

  return context;
}
