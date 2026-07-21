export type WorkspacePanelView =
  | 'discussions'
  | 'documents'
  | 'project'
  | 'inspector';

export function getDefaultPanelView(discussionCount: number): WorkspacePanelView {
  return discussionCount > 0 ? 'discussions' : 'project';
}
