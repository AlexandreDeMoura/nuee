import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Territory } from '../src/api';
import { KnowledgeExtractionProposalReview } from '../src/knowledge-extraction/KnowledgeExtractionProposalReview';
import { createKnowledgeExtractionState } from '../src/knowledge-extraction/knowledgeExtractionStateMachine';
import type { KnowledgeExtractionController } from '../src/knowledge-extraction/useKnowledgeExtraction';

afterEach(cleanup);

const territory: Territory = {
  id: 'territory-research',
  project_id: 'project-1',
  kind: 'manual',
  title: 'Research',
  position_x: 10,
  position_y: 20,
  visible_count: 4,
  created_at: '2026-08-12T08:00:00.000Z',
  updated_at: '2026-08-12T08:00:00.000Z',
};

function reviewingController(): KnowledgeExtractionController {
  const proposal = {
    title: 'Qualified conclusion',
    summary: 'A concise summary.',
    content: 'The complete extracted knowledge.',
  };

  return {
    state: {
      ...createKnowledgeExtractionState({
        discussionId: 'discussion-1',
        projectId: 'project-1',
      }),
      extractionId: 'extraction-1',
      generatedProposal: proposal,
      proposal,
      status: 'reviewing',
    },
    editProposal: vi.fn(),
  } as unknown as KnowledgeExtractionController;
}

describe('KnowledgeExtractionProposalReview destinations', () => {
  it('defaults to Ungrouped and submits a new territory with current placement', () => {
    const onApproveAsNewBubble = vi.fn();

    render(
      <KnowledgeExtractionProposalReview
        controller={reviewingController()}
        getTerritoryCreationPlacement={() => ({
          position_x: -120,
          position_y: 75,
        })}
        onApproveAsNewBubble={onApproveAsNewBubble}
        onReject={vi.fn()}
        territories={[territory]}
      />,
    );

    expect(
      (screen.getByRole('radio', { name: /Ungrouped/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByRole('radio', { name: /Research/ })).not.toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /New territory/ }));
    fireEvent.change(screen.getByLabelText('New territory title'), {
      target: { value: '  Decisions  ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve as new bubble' }),
    );

    expect(onApproveAsNewBubble).toHaveBeenCalledWith({
      kind: 'new',
      position_x: -120,
      position_y: 75,
      title: 'Decisions',
    });
  });
});
