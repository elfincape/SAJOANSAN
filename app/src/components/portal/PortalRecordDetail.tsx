import { usePortal } from './PortalStore';
import { PortalTaskDetail } from './PortalTaskDetail';
import { PortalIncidentDetail } from './PortalIncidents';
export function PortalRecordDetail() {
  const { state } = usePortal();
  return state.selected?.type === 'task' && !state.ticket ? (
    <PortalTaskDetail key={state.selected.row.id} task={state.selected.row} />
  ) : state.selected?.type === 'incident' && !state.ticket ? (
    <PortalIncidentDetail
      key={state.selected.row.id + ':' + state.selected.row.version}
      row={state.selected.row}
    />
  ) : null;
}
