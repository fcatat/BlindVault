export type ViewState = 
  | 'dashboard' | 'chat' | 'rules' | 'config' | 'tasks'
  | 'local_model' | 'sso' | 'audit' | 'multi_model' | 'policy' | 'hardware';



export interface AppState {
  activeView: ViewState;
  isAddCredentialModalOpen: boolean;
}
