import { createContext, useContext } from 'react';

/**
 * The last successfully persisted project description.
 *
 * Discussion creation snapshots the authoritative server value rather than
 * reading this client context. Consumers cannot update the live project
 * through this contract.
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
