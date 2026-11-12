import re
import time
import queue
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

BASE = 'https://talkcloud.kakao.com'

def bounds(rule):
    end = date.fromisoformat(rule['to'])
    mode = rule['mode']
    start = date(2010, 1, 1)
    if mode == 'before':
        end -= timedelta(days=1)
    elif mode == 'day':
        start = end
    elif mode == 'range':
        start = date.fromisoformat(rule['from'])
    elif mode != 'through':
        raise ValueError('날짜 조건을 확인하세요.')
    if start > end or end > date.today():
        raise ValueError('날짜 범위를 확인하세요.')
    return start.isoformat(), end.isoformat()

class Browser:
    def __init__(self, state, cancelled, verification):
        self.state = state
        self.cancelled = cancelled
        self.verification = verification
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(headless=True, args=['--disable-dev-shm-usage'])
        self.context = self.browser.new_context(locale='ko-KR', timezone_id='Asia/Seoul', viewport={'width':1280,'height':900}, accept_downloads=False)
        self.page = self.context.new_page()
        self.page.set_default_timeout(12000)
        self.known = {}
        self.plan = []

    def check(self):
        if self.cancelled.is_set():
            raise ValueError('작업이 중지됐습니다.')

    def close(self):
        try:
            self.context.close()
            self.browser.close()
        finally:
            self.pw.stop()

    def login(self, account, password, method='password'):
        self.page.goto('https://accounts.kakao.com/login/?continue=https://talkcloud.kakao.com/#login', wait_until='domcontentloaded')
        if method=='qr':
            self.page.get_by_role('button',name='QR코드 로그인',exact=True).click()
            self.page.wait_for_url('https://accounts.kakao.com/qr_login/**')
            self.page.locator('canvas').wait_for()
        else:
            self.page.locator('input[name="loginId"]').fill(account)
            self.page.locator('input[name="password"]').fill(password)
            self.page.get_by_role('button', name='로그인', exact=True).click()
        password = None
        self.state.update(phase='auth', message='카카오 로그인 결과를 확인하고 있습니다.')
        deadline = time.monotonic()+600
        challenge_version=0
        while time.monotonic()<deadline:
            self.check()
            if self.page.url.startswith(BASE+'/') and '/product' not in self.page.url:
                if self.page.get_by_role('link',name='휴지통',exact=True).is_visible():
                    self.state.pop('challenge',None)
                    self.state.pop('challenge_image',None)
                    self.state.update(authenticated=True,phase='ready',message='연결됐습니다. 방 목록을 불러옵니다.')
                    self.rooms(0)
                    return
            body = self.page.locator('body').inner_text()
            if re.search('비밀번호가 일치하지|계정을 찾을 수 없|잘못된 비밀번호',body):
                raise ValueError('카카오 계정 또는 비밀번호를 확인하세요.')
            if self.page.url.startswith('https://accounts.kakao.com/'):
                mode='qr' if '/qr_login/' in self.page.url else 'security' if re.search('보안문자|로봇이 아닙니다|CAPTCHA|아래 문제에 답해',body,re.I) else 'login'
                refresh=self.state.get('challenge',{}).get('mode')!=mode
                try:
                    action=self.verification.get_nowait()
                    if action['kind']=='click': self.page.mouse.click(action['x'],action['y'])
                    elif action['kind']=='text': self.page.keyboard.insert_text(action['text'])
                    elif action['kind']=='key': self.page.keyboard.press(action['key'])
                    action.clear()
                    self.page.wait_for_timeout(700)
                    refresh=True
                except queue.Empty:
                    pass
                if refresh:
                    challenge_version+=1
                    self.state['challenge_image']=self.page.screenshot(style='input[name="password"],input[name="loginId"]{color:transparent!important;caret-color:transparent!important;text-shadow:none!important}')
                    self.state['challenge']={'version':challenge_version,'width':1280,'height':900,'mode':mode}
                if mode=='qr':
                    self.state['message']='모바일 카카오톡 → 더보기 → QR코드 스캔으로 아래 코드를 스캔하고 로그인에 동의해 주세요.'
                elif mode=='security':
                    self.state['message']='아래 카카오 화면에서 보안문제를 직접 풀어 주세요.'
                elif re.search('2단계 인증|카카오톡.*인증|인증 요청',body):
                    self.state['message']='모바일 카카오톡의 인증 요청을 확인해 주세요. 추가 선택이 있으면 아래 화면에서 진행하세요.'
                else:
                    self.state['message']='카카오 로그인 화면이 남아 있습니다. 아래 화면에서 로그인 또는 추가 확인을 진행해 주세요.'
            else:
                self.state.pop('challenge',None)
                self.state.pop('challenge_image',None)
                if re.search('2단계 인증|카카오톡.*인증|인증 요청',body):
                    self.state['message']='모바일 카카오톡에 도착한 인증 요청을 승인해 주세요.'
                else:
                    self.state['message']='톡클라우드 연결을 확인하고 있습니다.'
            self.page.wait_for_timeout(1200)
        raise ValueError('로그인 승인 시간이 만료됐습니다. 다시 연결해 주세요.')

    def room(self, rid):
        if rid not in self.known:
            raise ValueError('현재 계정에서 확인한 방만 선택할 수 있습니다.')
        self.page.goto(BASE+rid,wait_until='domcontentloaded')
        self.page.get_by_role('button',name='파일정보',exact=True).wait_for()
        self.page.locator('main .txt').filter(has_text=re.compile(r'[\d,]+개의 파일\s*/')).wait_for(timeout=30000)
        selected=self.page.locator('a[role="tab"][aria-selected="true"]')
        if selected.get_attribute('href')!=rid or '/search' in self.page.url:
            raise ValueError('채팅방 선택 확인에 실패했습니다. 삭제하지 않습니다.')

    def rooms(self, offset):
        self.page.goto(BASE+'/photo',wait_until='domcontentloaded')
        self.page.get_by_role('tablist',name='채팅방 목록').wait_for()
        self.page.wait_for_function("() => [...document.querySelectorAll('a[role=\"tab\"][href^=\"/photo/\"]')].some(e=>e.getAttribute('href')!='/photo/all' && e.textContent.trim()!=='전체')",timeout=30000)
        rows=self.page.locator('a[role="tab"][href^="/photo/"]').evaluate_all("els=>els.map(e=>({id:e.getAttribute('href'),name:e.querySelector('.txt_name')?.textContent.trim()||e.textContent.trim()}))")
        rows=[r for r in rows if re.fullmatch(r'/photo/[a-zA-Z0-9_=-]+',r['id']) and r['id']!='/photo/all' and r['name']!='전체']
        self.known={r['id']:r['name'] for r in rows}
        result=[]
        for r in rows[offset:offset+20]:
            self.check()
            self.room(r['id'])
            body=self.page.locator('main').inner_text()
            match=re.search(r'[\d,]+개의 파일\s*/\s*[\d.]+\s*[KMGT]?B',body)
            result.append({**r,'size':match.group() if match else '용량 확인 불가'})
            self.state.update(rooms=list(result),message=f'방 용량 확인 중 · {len(result)} / {min(20,len(rows)-offset)}')
        self.state.update(rooms=result,message='방과 날짜를 선택하세요.')

    def cards(self):
        return self.page.locator('li[data-target="talk"]').evaluate_all("""els=>els.map(e=>({id:e.querySelector('input')?.id,date:e.querySelector('.txt_sub')?.textContent.trim(),video:!!e.querySelector('video')||!!e.querySelector('.info_desc')?.textContent.trim(),kind:e.querySelector('.thm_type')?.className})).filter(e=>e.id)""")

    def scroll(self):
        box=self.page.locator('.scroll_talk').bounding_box()
        if not box:
            raise ValueError('사진 목록 영역을 확인할 수 없습니다.')
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.wheel(0,max(100,min(350,int(box['height']/2))))
        self.page.wait_for_timeout(650)

    def scan(self, rid, start, end):
        self.room(rid)
        total_text=self.page.locator('main').inner_text()
        total_match=re.search(r'([\d,]+)개의 파일',total_text)
        if not total_match:
            raise ValueError('방의 전체 파일 수를 확인하지 못했습니다.')
        total=int(total_match.group(1).replace(',',''))
        found={}
        seen=set()
        same=0
        deadline=time.monotonic()+300
        while time.monotonic()<deadline:
            self.check()
            cards=self.cards()
            before=len(seen)
            for c in cards:
                seen.add(c['id'])
                m=re.fullmatch(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})',c['date'] or '')
                if not m:
                    raise ValueError('사진 날짜를 확인할 수 없어 중단했습니다.')
                day=date(*map(int,m.groups())).isoformat()
                if start<=day<=end and not c['video']:
                    found[c['id']]=day
            if len(seen)==before:
                same+=1
            else:
                same=0
            if len(seen)>=total:
                return found
            if same>=25:
                print(f'Incomplete photo list: seen={len(seen)}, expected={total}, visible={len(cards)}',flush=True)
                print(self.page.locator('li[data-target="talk"]').last.evaluate("e=>{const a=[];for(let p=e.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight)a.push({tag:p.tagName,class:p.className,top:p.scrollTop,height:p.clientHeight,total:p.scrollHeight,overflow:getComputedStyle(p).overflowY})}return a}"),flush=True)
                raise ValueError('전체 목록을 불러오지 못했습니다. 다시 조회하세요.')
            self.state.update(message='선택한 방의 사진을 정리하고 있습니다.')
            self.scroll()
        raise ValueError('목록 확인 제한시간을 초과했습니다. 삭제하지 않았습니다.')

    def preview(self, rules):
        self.plan=[]
        self.state.pop('preview',None)
        if not rules or len(rules)>20:
            raise ValueError('한 번에 1~20개 방을 선택하세요.')
        if len({r['id'] for r in rules})!=len(rules):
            raise ValueError('중복 방 선택입니다.')
        for r in rules:
            start,end=bounds(r)
            ids=self.scan(r['id'],start,end)
            self.plan.append({'id':r['id'],'start':start,'end':end,'files':ids})
        count=sum(len(r['files']) for r in self.plan)
        self.state.update(message='선택한 기간의 사진을 휴지통으로 이동합니다.')

    def delete(self):
        if not self.plan:
            raise ValueError('먼저 삭제 대상을 조회하세요.')
        deleted=0
        for r in self.plan:
            remaining=dict(r['files'])
            while remaining:
                self.check()
                self.room(r['id'])
                selected=[]
                stale=0
                seen=set()
                deadline=time.monotonic()+300
                while len(selected)<100 and stale<8 and time.monotonic()<deadline:
                    self.check()
                    cards=self.cards()
                    before=len(seen)
                    for c in cards:
                        seen.add(c['id'])
                        if c['id'] not in remaining or c['id'] in selected:
                            continue
                        m=re.fullmatch(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})',c['date'] or '')
                        if not m or c['video'] or date(*map(int,m.groups())).isoformat()!=remaining[c['id']]:
                            raise ValueError('조회한 사진 정보가 변경돼 중단했습니다.')
                        card=self.page.locator('li[data-target="talk"]').filter(has=self.page.locator('input[id="'+c['id']+'"]'))
                        card.hover()
                        card.locator('label').click()
                        selected.append(c['id'])
                        if len(selected)>=100:
                            break
                    stale=stale+1 if len(seen)==before else 0
                    if len(selected)>=100 or set(remaining).issubset(selected):
                        break
                    self.scroll()
                if not selected:
                    raise ValueError('조회한 사진을 다시 찾지 못했습니다. 대상을 다시 조회하세요.')
                label=self.page.get_by_role('button',name=re.compile('개 선택됨 선택 취소')).inner_text()
                if int(re.search(r'[\d,]+',label).group().replace(',',''))!=len(selected):
                    raise ValueError('선택 수가 일치하지 않아 삭제하지 않습니다.')
                if self.page.locator('a[role="tab"][aria-selected="true"]').get_attribute('href')!=r['id']:
                    raise ValueError('채팅방이 바뀌어 삭제하지 않습니다.')
                self.check()
                self.page.get_by_role('link',name='삭제하기',exact=True).click()
                self.page.get_by_text('선택한 파일을 휴지통으로 이동하시겠습니까?',exact=False).wait_for()
                self.check()
                self.page.get_by_role('button',name='확인',exact=True).click()
                self.page.get_by_role('button',name=re.compile('개 선택됨 선택 취소')).wait_for(state='hidden')
                for fid in selected:
                    remaining.pop(fid)
                deleted+=len(selected)
                self.state.update(message=f'사진 {deleted}개 휴지통 이동 처리 중')
            check=self.scan(r['id'],r['start'],r['end'])
            if set(check)&set(r['files']):
                raise ValueError('일부 사진이 남아 있습니다. 재조회가 필요합니다.')
        self.plan=[]
        self.state.pop('preview',None)
        self.state.update(message=f'완료 · 사진 {deleted}개를 휴지통으로 이동했습니다.')

    def trash(self):
        self.page.goto(BASE+'/trashcan',wait_until='domcontentloaded')
        self.page.get_by_role('heading',name='휴지통',exact=True).wait_for()
        text=self.page.locator('main').inner_text()
        size=re.search(r'/\s*([\d.]+\s*[KMGT]?B)',text)
        self.state.update(trash=size.group(1) if size else '비어 있거나 용량 확인 불가')

    def empty_trash(self):
        self.trash()
        self.check()
        self.page.get_by_role('button',name='휴지통 비우기',exact=True).click()
        self.page.get_by_text('휴지통에 있는 모든 항목을 삭제하시겠습니까?',exact=True).wait_for()
        self.check()
        self.page.get_by_role('button',name='확인',exact=True).click()
        self.page.wait_for_timeout(1000)
        self.trash()
        self.state.update(message='휴지통 비우기 요청을 처리했습니다. 표시된 잔여 용량을 확인하세요.')
