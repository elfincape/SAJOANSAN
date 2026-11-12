import json
import os
import queue
import secrets
import threading
import time
import traceback
import hashlib
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from browser import Browser, bounds

ORIGIN=os.environ['PUBLIC_ORIGIN'].rstrip('/')
AUTH_URL=os.environ['SUPABASE_URL'].rstrip('/')+'/auth/v1/user'
AUTH_KEY=os.environ['SUPABASE_ANON_KEY']
auth_cache={}
lock=threading.RLock()
session=None

class Session:
    def __init__(self,user_id):
        self.user_id=user_id
        self.token=secrets.token_urlsafe(32)
        self.state={'phase':'idle','authenticated':False,'busy':False,'message':'연결 대기'}
        self.commands=queue.Queue(maxsize=1)
        self.verification=queue.Queue(maxsize=5)
        self.cancel=threading.Event()
        self.touched=time.monotonic()
        self.idle_timeout=600
        self.closed=False
        threading.Thread(target=self.worker,daemon=True).start()

    def worker(self):
        global session
        browser=None
        try:
            while not self.closed:
                if time.monotonic()-self.touched>self.idle_timeout:
                    break
                try:
                    action,payload=self.commands.get(timeout=1)
                except queue.Empty:
                    continue
                try:
                    if action=='login':
                        browser=Browser(self.state,self.cancel,self.verification)
                        browser.login()
                    elif browser and self.state['authenticated']:
                        if action=='rooms': browser.rooms(payload['offset'])
                        elif action=='delete':
                            self.state.pop('result_image',None)
                            self.state.pop('result_version',None)
                            browser.preview(payload['rooms'])
                            browser.delete()
                            self.idle_timeout=300
                            completed=self.state['message']
                            try:
                                browser.trash()
                                self.state['result_image']=browser.page.screenshot()
                                self.state['result_version']=time.time_ns()
                                self.state['message']=completed+' · 5분간 미사용 시 연결이 종료됩니다.'
                            except Exception as error:
                                print('Trash capture: '+type(error).__name__,flush=True)
                                self.state['message']=completed+' 휴지통 화면을 가져오지 못했습니다. 5분간 미사용 시 연결이 종료됩니다.'
                        elif action=='trash': browser.trash()
                        elif action=='empty-trash': browser.empty_trash()
                except ValueError as error:
                    self.state.update(message=str(error))
                    if browser:
                        browser.plan=[]
                    self.state.pop('preview',None)
                    if not self.state['authenticated']:
                        self.state['phase']='failed'
                        self.state.pop('challenge',None)
                        self.state.pop('challenge_image',None)
                except Exception as error:
                    frames=traceback.extract_tb(error.__traceback__)
                    frame=next((f for f in reversed(frames) if f.filename.endswith('browser.py')),frames[-1])
                    print(f'{action}: {type(error).__name__} at {frame.name}:{frame.lineno}',flush=True)
                    self.state.update(message='톡클라우드 화면 처리에 실패했습니다. 다시 시도해 주세요.')
                    if browser: browser.plan=[]
                    self.state.pop('preview',None)
                    if not self.state['authenticated']:
                        self.state['phase']='failed'
                        self.state.pop('challenge',None)
                        self.state.pop('challenge_image',None)
                finally:
                    payload.clear()
                    self.state['busy']=False
                    self.touched=time.monotonic()
        finally:
            if browser:
                try: browser.close()
                except Exception: pass
            self.state.update(phase='closed',authenticated=False,busy=False)
            self.closed=True
            with lock:
                if session is self: session=None

class Handler(BaseHTTPRequestHandler):
    def authenticate(self):
        authorization=self.headers.get('Authorization','')
        if not authorization.startswith('Bearer ') or len(authorization)>8192:
            return False
        key=hashlib.sha256(authorization.encode()).hexdigest()
        with lock:
            cached=auth_cache.get(key)
            if cached and cached[1]>time.monotonic():
                self.user_id=cached[0]
                return True
        try:
            request=urllib.request.Request(AUTH_URL,headers={'Authorization':authorization,'apikey':AUTH_KEY})
            with urllib.request.urlopen(request,timeout=8) as response:
                user=json.load(response)
            self.user_id=user['id']
            if not isinstance(self.user_id,str) or not self.user_id: return False
            with lock:
                now=time.monotonic()
                for expired in [k for k,v in auth_cache.items() if v[1]<=now]: auth_cache.pop(expired,None)
                if len(auth_cache)<100: auth_cache[key]=(self.user_id,now+15)
            return True
        except Exception:
            return False

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self,*args):
        pass

    def send(self,status,body,content='application/json; charset=utf-8',cookie=None):
        if isinstance(body,dict): body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        if cookie: self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(body)

    def owner(self):
        cookie=SimpleCookie()
        try: cookie.load(self.headers.get('Cookie',''))
        except Exception: return None
        token=cookie.get('tc_session')
        if session and session.user_id==self.user_id and token and secrets.compare_digest(token.value,session.token):
            return session
        return None

    def do_GET(self):
        self.path=urlsplit(self.path).path
        if self.path=='/health': return self.send(200,{'ok':True})
        if not self.authenticate(): return self.send(401,{'error':'관리허브 로그인이 필요합니다.'})
        if self.path=='/api/availability': return self.send(200,{'available':session is None})
        if self.path in ('/api/state','/api/challenge','/api/result-image'):
            with lock:
                s=self.owner()
                if not s: return self.send(401,{'error':'다른 사용자가 작업 중입니다.' if session else '카카오톡 QR로 연결하세요.'})
                if self.path=='/api/challenge':
                    frame=s.state.get('challenge_image')
                    return self.send(200,frame,'image/png') if frame else self.send(404,{'error':'보안문제가 없습니다.'})
                if self.path=='/api/result-image':
                    frame=s.state.get('result_image')
                    return self.send(200,frame,'image/png') if frame else self.send(404,{'error':'완료 화면이 없습니다.'})
                return self.send(200,{key:value for key,value in s.state.items() if key not in ('challenge_image','result_image')})
        return self.send(404,{'error':'관리허브에서 이용하세요.'})

    def do_POST(self):
        global session
        if not self.authenticate(): return self.send(401,{'error':'관리허브 로그인이 필요합니다.'})
        if self.headers.get('Origin')!=ORIGIN:
            return self.send(403,{'error':'허용되지 않은 요청입니다.'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.send(415,{'error':'잘못된 요청 형식입니다.'})
        try:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=16384: raise ValueError()
            body=json.loads(self.rfile.read(n))
            if not isinstance(body,dict): raise ValueError()
        except Exception:
            return self.send(400,{'error':'요청 내용을 확인하세요.'})
        action=self.path.removeprefix('/api/')
        with lock:
            s=self.owner()
            if action=='login':
                if session: return self.send(409,{'error':'현재 한 사용자가 연결 중입니다. 작업 종료 후 다시 연결하세요.'})
                if body != {'method':'qr'}:
                    return self.send(400,{'error':'카카오톡 QR로 연결하세요.'})
                s=session=Session(self.user_id)
                s.state.update(phase='connecting',busy=True,message='카카오 계정에 연결 중입니다.')
                s.commands.put(('login',body))
                return self.send(202,{'ok':True},cookie='tc_session='+s.token+'; Secure; HttpOnly; SameSite=Strict; Path=/api/talkcloud; Max-Age=3600')
            if not s: return self.send(401,{'error':'로그인 연결이 필요합니다.'})
            s.touched=time.monotonic()
            if action=='activity':
                return self.send(200,{'ok':True})
            if action in ('logout','cancel'):
                s.cancel.set()
                if action=='logout': s.closed=True
                return self.send(200,{'ok':True})
            if action=='verification':
                if not s.state.get('challenge') or s.state['authenticated']:
                    return self.send(409,{'error':'현재 카카오 로그인 확인 단계가 아닙니다.'})
                kind=body.get('kind')
                if kind!='refresh': return self.send(400,{'error':'QR 화면 갱신만 지원합니다.'})
                try: s.verification.put_nowait(body)
                except queue.Full: return self.send(409,{'error':'앞선 입력을 처리하고 있습니다.'})
                return self.send(202,{'ok':True})
            if s.state['busy']: return self.send(409,{'error':'현재 작업이 끝난 후 실행하세요.'})
            if not s.state['authenticated']: return self.send(401,{'error':'로그인을 완료하세요.'})
            if action not in ('rooms','delete','trash','empty-trash'): return self.send(404,{'error':'없는 작업입니다.'})
            try:
                if action=='delete':
                    if not isinstance(body.get('rooms'),list) or not 1<=len(body['rooms'])<=20: raise ValueError()
                    for rule in body['rooms']: bounds(rule)
                if action=='rooms':
                    offset=body.get('offset',0)
                    if type(offset)!=int or offset<0 or offset>10000: raise ValueError()
                if action=='empty-trash' and body.get('confirm') is not True: raise ValueError()
            except Exception:
                return self.send(400,{'error':'방과 날짜 조건을 확인하세요.'})
            s.cancel.clear()
            s.state['busy']=True
            s.commands.put((action,body))
            self.send(202,{'ok':True})

if __name__=='__main__':
    ThreadingHTTPServer(('127.0.0.1',19220),Handler).serve_forever()
