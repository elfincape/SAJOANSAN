import { renderPermissionPreview } from './portal-permissions.js';
export const memberRoleLabels = {
  admin: '관리자 · 배송팀',
  editor: '센터 업무 담당',
  viewer: '조회 전용',
};
export function renderMembers({
  members,
  centers,
  node,
  button,
  field,
  save,
  items,
  panel,
  centerName,
  rules = [],
  selected,
  onSelect,
}) {
  items.replaceChildren();
  panel.replaceChildren(
    node(
      'p',
      '사용자를 선택하면 역할·담당 센터와 적용될 페이지 권한을 함께 확인할 수 있습니다.',
    ),
  );
  items.append(
    node(
      'p',
      '역할은 가능한 업무 수준, 담당 센터는 자료 수정 범위를 정합니다. 페이지 권한 조건을 만족해야 해당 업무에 접근할 수 있습니다.',
    ),
  );
  const search = field(items, '사용자 검색', 'member_search');
  search.type = 'search';
  const list = node('div');
  items.append(list);
  function draw() {
    list.replaceChildren();
    for (const person of members) {
      if (
        ![person.name, person.email]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search.value.trim().toLowerCase())
      )
        continue;
      const row = button(
        '',
        () => {
          onSelect?.(person.id);
          edit(person);
        },
        list,
        'task-row member-row',
      );
      row.dataset.memberId = person.id;
      row.setAttribute('aria-pressed', String(person.id === selected));
      row.append(
        node('strong', person.name),
        node(
          'small',
          (memberRoleLabels[person.role] ?? person.role) +
            (person.active ? '' : ' · 비활성'),
        ),
        node(
          'small',
          person.role === 'admin'
            ? '전체 센터 관리'
            : person.centers.map(centerName).join(', ') || '담당 센터 없음',
        ),
      );
    }
    if (!list.childElementCount)
      list.append(node('p', '일치하는 사용자가 없습니다.'));
  }
  search.oninput = draw;
  draw();
  if (selected) {
    const person = members.find((p) => p.id === selected);
    if (person) edit(person);
  }
  function edit(person) {
    selected = person.id;
    for (const row of list.querySelectorAll('[data-member-id]'))
      row.setAttribute(
        'aria-pressed',
        String(row.dataset.memberId === selected),
      );
    panel.replaceChildren(
      node('h2', person.name + ' · 역할·센터 설정'),
      node(
        'p',
        person.active
          ? '활성 계정'
          : '비활성 계정 · 설정을 저장해도 활성화 전에는 접근할 수 없습니다.',
      ),
    );
    const form = node('form', undefined, 'portal-form');
    const name = field(form, '표시이름', 'name', person.display_name ?? '');
    name.required = true;
    name.maxLength = 100;
    const roles = node('fieldset');
    roles.append(node('legend', '사용자 역할'));
    for (const [value, label] of Object.entries(memberRoleLabels)) {
      const wrap = node('label', label, 'member-choice'),
        radio = node('input');
      radio.type = 'radio';
      radio.name = 'role';
      radio.value = value;
      radio.checked = person.role === value;
      wrap.prepend(radio);
      roles.append(wrap);
    }
    form.append(roles);
    const group = node('fieldset');
    group.append(node('legend', '담당 센터 · 여러 센터 선택 가능'));
    for (const center of centers) {
      const el = field(
        group,
        centerName(center.code),
        'center_' + center.code,
        person.centers.includes(center.code),
        'checkbox',
      );
      el.parentElement.classList.add('member-choice');
    }
    form.append(group);
    const guidance = node('p');
    form.append(guidance, node('button', '역할·담당 센터 저장', 'primary'));
    panel.append(form);
    const link = node('a', '페이지별 허용 조건 설정');
    link.href = '/portal/?view=permissions';
    panel.append(link);
    const preview = node('section', undefined, 'permission-simulation');
    panel.append(preview);
    const draft = () => ({
      ...person,
      role: form.elements.role.value,
      centers: centers
        .filter((c) => form.elements['center_' + c.code].checked)
        .map((c) => c.code)
        .sort(),
    });
    const update = () => {
      const value = draft();
      for (const el of group.querySelectorAll('input'))
        el.disabled = value.role === 'admin';
      guidance.textContent =
        value.role === 'admin'
          ? '관리자는 페이지 조건과 관계없이 모든 센터에 접근합니다. 센터 선택은 관리자 권한을 제한하지 않습니다.'
          : value.role === 'viewer'
            ? '조회 전용은 허용된 페이지를 열람합니다. 담당 센터는 본인 센터 자료 조건에 사용됩니다. 특이사항 처리 상태·알림 확인은 별도 페이지 조건을 따릅니다.'
            : value.centers.length
              ? '담당 센터의 업무를 페이지 수정 조건 안에서 처리할 수 있습니다. 담당 밖 자료는 열람 조건에 따라 표시됩니다.'
              : '담당 센터가 없어 센터 업무·기초자료를 수정할 수 없습니다. 센터를 선택하세요.';
      renderPermissionPreview({
        host: preview,
        rules,
        person: value,
        centers,
        node,
        centerName,
      });
    };
    form.onchange = update;
    update();
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save(person, {
        name: form.elements.name.value,
        role: draft().role,
        centers: draft().centers,
      });
    };
  }
}
