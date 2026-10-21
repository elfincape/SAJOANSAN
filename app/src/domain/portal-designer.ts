import type { PortalSpec, PortalField } from './portal-types';
import { koreaDate } from './operations';
export const designerLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
export interface DesignerDraft {
  title: string;
  description: string;
  cadence: string;
  days: number[];
  external_process: string;
  integration: string;
  capture_range: string;
  worksheet: string;
  dispatch_field: string;
  due_time: string;
  steps: string;
  completion: string;
  fields: (PortalField & { options_text: string; control: string })[];
}
export function designerDraft(
  title: string,
  spec: PortalSpec = {},
): DesignerDraft {
  return {
    title,
    description: spec.description ?? '',
    cadence:
      spec.ui_cadence ??
      (
        { daily: 'daily', weekdays: 'weekly', monthly: 'monthly' } as Record<
          string,
          string
        >
      )[spec.repeat?.kind ?? ''] ??
      'none',
    days: spec.repeat?.days ?? [1, 2, 3, 4, 5, 6, 7],
    external_process: (spec.external_process ?? []).join('\n'),
    integration: spec.integration?.kind ?? 'none',
    capture_range: spec.integration?.capture_range ?? 'A1:E20',
    worksheet: spec.integration?.worksheet ?? '',
    dispatch_field: spec.integration?.dispatch_field ?? '',
    due_time: spec.due_time ?? '',
    steps: (spec.steps ?? []).map((s) => s.label).join('\n'),
    completion: spec.completion_condition ?? '',
    fields: (spec.fields ?? []).map((f) => ({
      ...f,
      control:
        f.control ??
        ({ boolean: 'checkbox', number: 'number' } as Record<string, string>)[
          f.type
        ] ??
        'text',
      options_text: (f.options ?? []).join('\n'),
    })),
  };
}
export function designerSpec(
  draft: DesignerDraft,
  spec: PortalSpec,
  generated: Map<string, string>,
): PortalSpec {
  const repeat: NonNullable<PortalSpec['repeat']> = {
    kind:
      draft.cadence === 'weekly'
        ? 'weekdays'
        : draft.cadence === 'none'
          ? 'none'
          : draft.cadence,
  };
  if (draft.cadence === 'daily') {
    repeat.days = draft.days;
    if (!repeat.days.length) throw Error('실행 요일을 하나 이상 선택하세요.');
    if (repeat.days.length < 7) repeat.kind = 'weekdays';
  }
  if (draft.cadence === 'weekly') repeat.days = [1];
  if (draft.cadence === 'monthly') repeat.day = 1;
  const used = new Set<string>(),
    steps = designerLines(draft.steps).map((label, index) => {
      let key = spec.steps?.find(
        (s) => s.label === label && !used.has(s.key),
      )?.key;
      const slot = index + ':' + label;
      if (!key) {
        if (!generated.has(slot))
          generated.set(
            slot,
            'step_' + crypto.randomUUID().replaceAll('-', ''),
          );
        key = generated.get(slot)!;
      }
      used.add(key);
      return { key, label };
    }),
    next: PortalSpec = {
      manual_issue: true,
      ui_cadence: draft.cadence,
      effective_from: koreaDate(),
      description: draft.description,
      repeat,
      fields: draft.fields.map((f) => ({
        key: f.key,
        label: f.label.trim(),
        type:
          f.control === 'number'
            ? 'number'
            : f.control === 'checkbox'
              ? 'boolean'
              : 'string',
        control: f.control,
        required_on_complete: f.required_on_complete === true,
        ...(f.control === 'select'
          ? { options: [...new Set(designerLines(f.options_text))] }
          : {}),
      })),
      steps,
      completion_condition: draft.completion,
      external_process: designerLines(draft.external_process),
    };
  if (draft.integration === 'coupang_entry') {
    if (!draft.dispatch_field)
      throw Error('배차정보를 작성할 입력 항목을 추가하세요.');
    next.integration = {
      kind: 'coupang_entry',
      dispatch_field: draft.dispatch_field,
      capture_range: draft.capture_range.toUpperCase(),
      worksheet: draft.worksheet.trim(),
      ...(spec.integration?.step_keys
        ? {
            step_keys: Object.fromEntries(
              Object.entries(spec.integration.step_keys).filter(([, key]) =>
                steps.some((s) => s.key === key),
              ),
            ),
          }
        : {}),
    };
  }
  if (draft.due_time) next.due_time = draft.due_time;
  return next;
}
