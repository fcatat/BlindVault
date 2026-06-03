export type ViewState = 'dashboard' | 'chat' | 'rules' | 'config';

export interface AppState {
  activeView: ViewState;
  isAddCredentialModalOpen: boolean;
}
