export type ViewState = 'dashboard' | 'chat' | 'trace' | 'config';

export interface AppState {
  activeView: ViewState;
  isAddCredentialModalOpen: boolean;
}
