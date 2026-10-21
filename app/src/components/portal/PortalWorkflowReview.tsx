import type {
  PortalField,
  PortalInputs,
  PortalTask,
} from '../../domain/portal-types';
import { MentionText } from './PortalMentions';
const display = (value: unknown) =>
  value === true
    ? '예'
    : value === false
      ? '아니요'
      : value === '' || value == null
        ? '미입력'
        : String(value);
export function PortalWorkflowReview({
  task,
  values,
  fields,
  includeNote,
}: {
  task: PortalTask;
  values: PortalInputs;
  fields: PortalField[];
  includeNote: boolean;
}) {
  const changes = [
    ...fields,
    ...(includeNote
      ? [{ key: 'work_note', label: '업무 내용', type: 'text' }]
      : []),
  ]
    .map((field) => {
      const before = task.inputs?.[field.key],
        after = values[field.key];
      const same =
        field.type === 'number'
          ? (before == null && (after === '' || after == null)) ||
            (before !== '' &&
              before != null &&
              after !== '' &&
              after != null &&
              Number(before) === Number(after))
          : field.type === 'boolean'
            ? (before === true) === (after === true)
            : String(before ?? '') === String(after ?? '');
      return { ...field, before, after, same };
    })
    .filter((field) => !field.same);
  if (!changes.length) return null;
  return (
    <details className="task-change-review">
      <summary>저장 전 변경 내용 확인 · {changes.length}개 항목</summary>
      <p>
        현재 입력한 내용입니다. 아래 저장 또는 업무 완료를 선택하면 반영됩니다.
      </p>
      <div className="task-change-table-wrap">
        <table>
          <caption>저장된 내용과 현재 입력 비교</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">저장된 내용</th>
              <th scope="col">현재 입력</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((field) => (
              <tr key={field.key}>
                <th scope="row">
                  <MentionText>{field.label}</MentionText>
                </th>
                <td>
                  <MentionText>{display(field.before)}</MentionText>
                </td>
                <td>
                  <MentionText>{display(field.after)}</MentionText>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
