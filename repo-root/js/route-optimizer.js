import { requireRole } from './auth.js';
import { withCenterParam } from './center.js';

const element = (id) => document.getElementById(id);
let result;

function message(text, error = false) {
  element('optimizer-status').textContent = text;
  element('optimizer-status').classList.toggle('error', error);
}

async function calculate() {
  const port = Number(element('optimizer-port').value);
  const token = element('optimizer-token').value.trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !token) {
    message('1024~65535 범위의 포트와 로컬 서버 연결 키를 입력하세요.', true);
    return;
  }
  let payload;
  try { payload = JSON.parse(element('optimizer-input').value); }
  catch { message('입력 JSON 형식을 확인하세요.', true); return; }
  result = null;
  element('optimizer-download').disabled = true;
  element('optimizer-result').replaceChildren();
  element('optimizer-workspace').disabled = true;
  message('로컬 PC에서 계산 중입니다…');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Optimizer-Token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '계산에 실패했습니다.');
    for (const route of data.routes) {
      const article = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = `차량 ${route.vehicle} · 물량 ${route.load}/${route.capacity} · 이동 ${route.minutes}분`;
      const stops = document.createElement('p');
      stops.textContent = route.stops.join(' → ');
      article.append(title, stops);
      element('optimizer-result').append(article);
    }
    result = data;
    message(`${data.routes.length}대 · 총 이동시간 ${data.totalMinutes}분. ${data.note}`);
  } catch (error) {
    message(error instanceof TypeError ? '로컬 서버 실행·연결 키·브라우저 로컬 네트워크 허용을 확인하세요. 연결이 제한되면 npm run dev로 로컬 앱에서 사용하세요.' : error.message, true);
  } finally {
    element('optimizer-workspace').disabled = false;
    element('optimizer-download').disabled = !result;
  }
}

async function init() {
  const profile = await requireRole('editor');
  if (!profile) return;
  element('user-badge').textContent = profile.display_name || profile.email;
  element('back-link').href = withCenterParam('/admin/');
  element('optimizer-input').value = JSON.stringify({
    stops: ['센터', '납품처 A', '납품처 B', '납품처 C'],
    minutes: [[0, 20, 30, 25], [20, 0, 15, 10], [30, 15, 0, 20], [25, 10, 20, 0]],
    demands: [0, 10, 15, 20], capacities: [30, 30], seconds: 5,
  }, null, 2);
  element('optimizer-run').onclick = calculate;
  element('optimizer-download').onclick = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '배차계산결과.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  element('optimizer-workspace').disabled = false;
  message('로컬 서버를 실행하고 입력 데이터를 확인한 뒤 계산하세요.');
}

init().catch((error) => message(error.message, true));
