import { MentionText } from './PortalMentions';
import { effectivePermission } from '../../domain/portal-permissions';
import type { PermissionConfig, PortalMember } from '../../domain/portal-types';
import { usePortal } from './PortalStore';
export function PortalPermissionPreview({
  rules,
  person,
}: {
  rules: PermissionConfig[];
  person: Pick<PortalMember, 'active' | 'role' | 'centers'>;
}) {
  const { state, centerName } = usePortal(),
    centers = state.context?.centers ?? [];
  return (
    <>
      <h3>적용 권한 미리보기</h3>
      <p>
        현재 입력한 역할·담당 센터와 페이지 조건을 함께 적용한 결과입니다. 저장
        전에는 실제 권한이 바뀌지 않습니다. 개별 기록의 담당자·소유자·처리
        상태에 따른 제한은 추가로 적용됩니다.
      </p>
      <div className="permission-preview-table">
        <table>
          <thead>
            <tr>
              <th>페이지·업무</th>
              {centers.map((c) => (
                <th key={c.code}>
                  <MentionText>{centerName(c.code)}</MentionText>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((config) => (
              <tr key={config.resource}>
                <th>
                  <MentionText>{config.title}</MentionText>
                </th>
                {centers.map((c) => {
                  const access = effectivePermission(config, person, c.code);
                  return (
                    <td key={c.code}>
                      <MentionText>
                        {access.edit
                          ? config.resource === 'notifications'
                            ? '알림 확인'
                            : config.resource === 'incidents'
                              ? '열람·처리 상태 변경'
                              : '열람·수정'
                          : access.read
                            ? '열람 전용'
                            : '접근 불가'}
                      </MentionText>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
