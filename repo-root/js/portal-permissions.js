export function permissionAllowed(context, resource, action = 'read', center) {
  const access = context?.access?.[resource];
  if (!access) return false;
  if (!['read', 'edit'].includes(action)) return false;
  const allows = (key) =>
    center
      ? (access[key + '_centers'] ?? []).includes(center)
      : access[key] === true;
  return allows(action) || (action === 'read' && allows('edit'));
}
// This preview mirrors operations_permission_for_actor; the server remains authoritative.
export const centerEditResources = [
  'tasks',
  'forms',
  'trash',
  'drivers',
  'vehicles',
  'companies',
  'delivery_points',
  'routes',
  'transfers',
  'charter',
  'dispatch_parser',
  'one_top',
];
export function effectivePermission(config, person, center) {
  if (!person?.active || !config) return { read: false, edit: false };
  if (person.role === 'admin') return { read: true, edit: true };
  if (config.admin_only) return { read: false, edit: false };
  const memberships = person.centers ?? [];
  const matches = (rule) =>
    !!rule &&
    (rule.everyone === true ||
      (rule.roles ?? []).includes(person.role) ||
      (rule.centers ?? []).some((c) => memberships.includes(c))) &&
    (rule.scope === 'all' ||
      (rule.scope === 'own' &&
        (center ? memberships.includes(center) : memberships.length > 0)));
  const edit =
    (person.role === 'editor' ||
      ['incidents', 'notifications'].includes(config.resource)) &&
    matches(config.write_rule) &&
    (!centerEditResources.includes(config.resource) ||
      (center ? memberships.includes(center) : memberships.length > 0));
  return { read: matches(config.read_rule) || edit, edit };
}
export function renderPermissionPreview({
  host,
  rules,
  person,
  centers,
  node,
  centerName,
}) {
  host.replaceChildren(
    node('h3', '적용 권한 미리보기'),
    node(
      'p',
      '현재 입력한 역할·담당 센터와 페이지 조건을 함께 적용한 결과입니다. 저장 전에는 실제 권한이 바뀌지 않습니다. 개별 기록의 담당자·소유자·처리 상태에 따른 제한은 추가로 적용됩니다.',
    ),
  );
  const wrap = node('div', undefined, 'permission-preview-table'),
    table = node('table'),
    head = node('thead'),
    heading = node('tr');
  for (const title of [
    '페이지·업무',
    ...centers.map((c) => centerName(c.code)),
  ])
    heading.append(node('th', title));
  head.append(heading);
  table.append(head);
  const body = node('tbody');
  for (const config of rules ?? []) {
    const row = node('tr');
    row.append(node('th', config.title));
    for (const center of centers) {
      const access = effectivePermission(config, person, center.code);
      row.append(
        node(
          'td',
          access.edit
            ? config.resource === 'notifications'
              ? '알림 확인'
              : config.resource === 'incidents'
                ? '열람·처리 상태 변경'
                : '열람·수정'
            : access.read
              ? '열람 전용'
              : '접근 불가',
        ),
      );
    }
    body.append(row);
  }
  table.append(body);
  wrap.append(table);
  host.append(wrap);
}
export function renderPermissions({
  context,
  centers,
  node,
  button,
  field,
  items,
  panel,
  centerName,
  save,
  selected,
  onSelect,
}) {
  items.replaceChildren();
  panel.replaceChildren(
    node(
      'p',
      '페이지·업무를 선택하면 허용 대상과 자료 범위를 설정할 수 있습니다.',
    ),
  );
  items.append(
    node(
      'p',
      '사용자 역할·담당 센터 → 페이지 허용 조건 → 최종 접근 권한 순서로 적용됩니다. 관리자는 항상 허용되며, 수정 권한에는 열람이 포함됩니다.',
    ),
  );
  const search = field(items, '페이지·업무 검색', 'permission_search');
  search.type = 'search';
  const list = node('div');
  items.append(list);
  const order = ['포털', '운영관리 목록', '운영 관리', '도구'];
  function summary(rule) {
    return (
      (rule.everyone
        ? '활성 사용자 전체'
        : [
            (rule.roles ?? [])
              .filter((r) => r !== 'admin')
              .map(
                (r) => ({ editor: '센터 업무 담당', viewer: '조회 전용' })[r],
              )
              .join(', '),
            (rule.centers ?? []).map(centerName).join(', '),
          ]
            .filter(Boolean)
            .join(' 또는 ') || '관리자만') +
      ' · ' +
      (rule.scope === 'own' ? '본인 담당 센터 자료' : '전체 센터 자료')
    );
  }
  function drawList() {
    list.replaceChildren();
    let section = '';
    for (const config of [...context.rules].sort(
      (a, b) => order.indexOf(a.section) - order.indexOf(b.section),
    )) {
      if (
        !config.title.toLowerCase().includes(search.value.trim().toLowerCase())
      )
        continue;
      if (config.section !== section) {
        section = config.section;
        list.append(node('h3', section));
      }
      const row = button(
        '',
        () => {
          onSelect?.(config.resource);
          edit(config);
        },
        list,
        'task-row permission-row',
      );
      row.dataset.resource = config.resource;
      row.setAttribute('aria-pressed', String(config.resource === selected));
      row.append(
        node('strong', config.title),
        node(
          'small',
          config.admin_only
            ? '관리자 전용 · 변경 불가'
            : '열람: ' + summary(config.read_rule),
        ),
        ...(config.admin_only
          ? []
          : [node('small', '수정: ' + summary(config.write_rule))]),
      );
    }
    if (!list.childElementCount)
      list.append(node('p', '일치하는 페이지·업무가 없습니다.'));
  }
  search.oninput = drawList;
  drawList();
  if (selected) {
    const config = context.rules.find((c) => c.resource === selected);
    if (config) edit(config);
  }
  function edit(config) {
    selected = config.resource;
    for (const row of list.querySelectorAll('[data-resource]'))
      row.setAttribute(
        'aria-pressed',
        String(row.dataset.resource === selected),
      );
    panel.replaceChildren(node('h2', config.title + ' 권한'));
    if (config.admin_only) {
      panel.append(
        node(
          'p',
          '계정·권한·외부 연결과 원본을 관리하는 관리자 전용 기능입니다. 일반 사용자에게 허용할 수 없습니다.',
        ),
      );
      return;
    }
    const form = node('form', undefined, 'portal-form permission-form'),
      columns = node('div', undefined, 'permission-columns');
    for (const [key, title] of [
      ['read_rule', '열람 허용'],
      ['write_rule', '수정 허용'],
    ]) {
      const rule = config[key],
        group = node('fieldset');
      group.append(node('legend', title));
      const everyone = field(
        group,
        '활성 사용자 전체',
        key + '_everyone',
        rule.everyone,
        'checkbox',
      );
      everyone.parentElement.classList.add('member-choice');
      group.append(
        node(
          'small',
          '전체 허용을 끄면 아래 역할 또는 센터 소속 중 하나를 만족하는 사용자에게 허용합니다.',
        ),
      );
      const admin = field(
        group,
        '관리자 · 항상 허용',
        key + '_admin',
        true,
        'checkbox',
      );
      admin.disabled = true;
      admin.parentElement.classList.add('member-choice');
      const viewerWrite = ['incidents', 'notifications'].includes(
        config.resource,
      );
      for (const [role, label] of [
        ['editor', '센터 업무 담당'],
        ['viewer', '조회 전용'],
      ]) {
        const el = field(
          group,
          label,
          key + '_' + role,
          (rule.roles ?? []).includes(role),
          'checkbox',
        );
        el.parentElement.classList.add('member-choice');
        el.dataset.permanentlyDisabled = String(
          key === 'write_rule' && role === 'viewer' && !viewerWrite,
        );
      }
      const members = node('fieldset');
      members.append(node('legend', '허용 대상의 담당 센터'));
      for (const center of centers) {
        const el = field(
          members,
          centerName(center.code),
          key + '_center_' + center.code,
          (rule.centers ?? []).includes(center.code),
          'checkbox',
        );
        el.parentElement.classList.add('member-choice');
      }
      group.append(members);
      const scope = node('fieldset');
      scope.append(node('legend', '접근할 자료 범위'));
      for (const [value, label] of [
        ['all', '전체 센터 자료'],
        ['own', '본인 담당 센터 자료만'],
      ]) {
        const wrap = node('label', label, 'member-choice'),
          input = node('input');
        input.type = 'radio';
        input.name = key + '_scope';
        input.value = value;
        input.checked = rule.scope === value;
        wrap.prepend(input);
        scope.append(wrap);
      }
      group.append(scope);
      if (key === 'write_rule')
        group.append(
          node(
            'p',
            centerEditResources.includes(config.resource)
              ? '실제 수정은 센터 업무 담당자의 담당 센터 안에서만 가능합니다. 전체 센터 자료를 선택해도 담당 밖 수정은 허용되지 않습니다.'
              : config.resource === 'incidents'
                ? '조회 전용도 허용 조건에 따라 처리완료·재개할 수 있습니다. 내용 작성·수정은 센터 담당 권한이 필요합니다.'
                : config.resource === 'notifications'
                  ? '알림 확인에 적용됩니다. 업무 내용 수정 권한을 부여하지 않습니다.'
                  : '조회 전용 사용자는 업무 내용을 수정할 수 없습니다.',
          ),
        );
      const sync = () => {
        for (const el of group.querySelectorAll('input[type=checkbox]'))
          if (el !== everyone && el !== admin)
            el.disabled =
              everyone.checked || el.dataset.permanentlyDisabled === 'true';
      };
      everyone.onchange = sync;
      sync();
      columns.append(group);
    }
    form.append(
      columns,
      node(
        'p',
        '담당 센터 조건은 허용할 사용자를 고릅니다. 자료 범위는 그 사용자가 접근할 센터 자료를 고릅니다. 이 두 설정은 서로 다릅니다.',
      ),
      node('button', '페이지 권한 저장', 'primary'),
    );
    panel.append(form);
    const value = (key) => ({
      everyone: form.elements[key + '_everyone'].checked,
      roles: [
        'admin',
        ...['editor', 'viewer'].filter(
          (role) =>
            form.elements[key + '_' + role].checked &&
            form.elements[key + '_' + role].dataset.permanentlyDisabled !==
              'true',
        ),
      ],
      centers: centers
        .filter((c) => form.elements[key + '_center_' + c.code].checked)
        .map((c) => c.code)
        .sort(),
      scope: form.elements[key + '_scope'].value,
    });
    const simulation = node('section', undefined, 'permission-simulation'),
      choice = node('select');
    choice.setAttribute('aria-label', '미리볼 사용자 역할');
    for (const [role, label] of [
      ['editor', '센터 업무 담당'],
      ['viewer', '조회 전용'],
      ['admin', '관리자'],
    ]) {
      const option = node('option', label);
      option.value = role;
      choice.append(option);
    }
    simulation.append(node('h3', '사용자 속성으로 확인'), choice);
    const checks = node('fieldset');
    checks.append(node('legend', '미리볼 사용자의 담당 센터'));
    for (const c of centers) {
      const el = field(
        checks,
        centerName(c.code),
        'preview_' + c.code,
        false,
        'checkbox',
      );
      el.parentElement.classList.add('member-choice');
    }
    simulation.append(checks);
    const preview = node('div');
    simulation.append(preview);
    panel.append(simulation);
    const update = () =>
      renderPermissionPreview({
        host: preview,
        rules: [
          {
            ...config,
            read_rule: value('read_rule'),
            write_rule: value('write_rule'),
          },
        ],
        person: {
          role: choice.value,
          active: true,
          centers: centers
            .filter(
              (c) =>
                checks.querySelector('[name="preview_' + c.code + '"]').checked,
            )
            .map((c) => c.code),
        },
        centers,
        node,
        centerName,
      });
    form.onchange = update;
    simulation.onchange = update;
    update();
    form.onsubmit = (e) => {
      e.preventDefault();
      save(config, { read: value('read_rule'), write: value('write_rule') });
    };
  }
}
