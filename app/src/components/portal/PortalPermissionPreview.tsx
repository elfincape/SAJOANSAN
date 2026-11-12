import {
  employeePermissionSummary,
  permissionTitle,
} from '../../domain/employee-permissions';
import type { PermissionConfig, PortalMember } from '../../domain/portal-types';
import { usePortal } from './PortalStore';
export function PortalPermissionPreview({
  rules,
  person,
}: {
  rules: PermissionConfig[];
  person: Pick<PortalMember, 'active' | 'role' | 'centers'> &
    Partial<Pick<PortalMember, 'id'>>;
}) {
  const { state, centerName } = usePortal();
  return (
    <details className="permission-simulation-details">
      <summary>역할·담당 범위 변경 후 권한 확인</summary>
      <p>저장 전 미리보기 · 업무별 설정은 직원별 업무 권한에서 변경합니다.</p>
      <div className="permission-preview-table">
        <table>
          <thead>
            <tr>
              <th scope="col">업무</th>
              <th scope="col">허용 동작</th>
              <th scope="col">자료 범위</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((config) => {
              const summary = employeePermissionSummary(
                config,
                person,
                state.context?.centers ?? [],
                centerName,
              );
              return (
                <tr key={config.resource}>
                  <th scope="row">{permissionTitle(config)}</th>
                  <td>
                    {summary.label}
                    {summary.reason && (
                      <small>
                        {summary.reason === '본인 전용'
                          ? '지정 사용자 전용'
                          : summary.reason}
                      </small>
                    )}
                  </td>
                  <td>
                    {summary.readScope}
                    {summary.edit &&
                      summary.editScope !== summary.readScope && (
                        <small>수정: {summary.editScope}</small>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
