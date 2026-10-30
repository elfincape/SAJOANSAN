import { Search } from 'lucide-react';

export interface WorkspaceCommand {
  id: string;
  title: string;
  description?: string;
  group: string;
  run: () => void;
}

export function WorkspaceCommands({ commands, disabled = false }: { commands: WorkspaceCommand[]; disabled?: boolean }) {
  const search = commands.find(command => command.id === 'workspace-search' || command.id === 'search');
  if (!search) return null;
  return <button type="button" className="workspace-command-trigger" aria-label="업무 자료 검색" disabled={disabled} onClick={search.run}>
    <Search aria-hidden="true" size={18} strokeWidth={1.5} />
    <span>업무 검색</span>
  </button>;
}