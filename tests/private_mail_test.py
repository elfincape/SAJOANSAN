import datetime as dt
import importlib.util
import pathlib
import socket
import ssl
import tempfile
import threading
import unittest
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

spec = importlib.util.spec_from_file_location('collector', pathlib.Path(__file__).parents[1] / 'scripts/private-mail/collector.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
RAW = b'Date: Sat, 17 Oct 2026 01:00:00 +0000\r\nSubject: fixture\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello\r\n.line\r\n'


class Bridge:
    def __init__(self):
        self.saved = set()
        self.fail = True

    def call(self, operation, **kw):
        if operation == 'seen':
            return {'seen': kw['uidl'] in self.saved}
        if self.fail:
            raise RuntimeError('temporary store failure')
        self.saved.add(kw['message']['uidl'])
        return {'ok': True}


class PopTests(unittest.TestCase):
    def test_tls_pop_replay(self):
        # Real loopback POP3S with a test-only CA; production uses system trust.
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
        now = dt.datetime.now(c.UTC)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(days=1))
                .not_valid_after(now+dt.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]), critical=False)
                .sign(key, hashes.SHA256()))
        commands, errors = [], []
        with tempfile.TemporaryDirectory() as tmp:
            certfile, keyfile = pathlib.Path(tmp)/'cert.pem', pathlib.Path(tmp)/'key.pem'
            certfile.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(certfile,keyfile)
            listener = socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
            port = listener.getsockname()[1]
            def serve():
                try:
                    for _ in range(3):
                        conn,_ = listener.accept()
                        with server_context.wrap_socket(conn,server_side=True) as conn:
                            conn.sendall(b'+OK fake POP ready\r\n')
                            f=conn.makefile('rb')
                            while True:
                                line=f.readline().decode().strip();commands.append(line.split(' ')[0])
                                if line.startswith(('USER','PASS')):conn.sendall(b'+OK\r\n')
                                elif line=='UIDL':conn.sendall(b'+OK\r\n1 stable-uid\r\n.\r\n')
                                elif line=='LIST':conn.sendall(b'+OK\r\n1 '+str(len(RAW)).encode()+b'\r\n.\r\n')
                                elif line.startswith('TOP'):conn.sendall(b'+OK\r\n'+RAW.split(b'\r\n\r\n')[0]+b'\r\n\r\n.\r\n')
                                elif line.startswith('RETR'):conn.sendall(b'+OK\r\n'+RAW.replace(b'\r\n.',b'\r\n..')+b'.\r\n')
                                elif line=='QUIT':conn.sendall(b'+OK\r\n');break
                                else:raise AssertionError('Forbidden command')
                except Exception as error:errors.append(error)
                finally:listener.close()
            thread=threading.Thread(target=serve,daemon=True);thread.start()
            bridge=Bridge();context=ssl.create_default_context(cafile=str(certfile))
            for i in range(3):
                pop=c.ReadOnlyPOP('localhost',port,context=context,timeout=5);pop.user('fake');pop.pass_('fake')
                if i==0:
                    with self.assertRaises(RuntimeError):c.sync(pop,bridge,dt.datetime(2026,8,18,tzinfo=c.UTC))
                    bridge.fail=False
                else:
                    counts=c.sync(pop,bridge,dt.datetime(2026,8,18,tzinfo=c.UTC));self.assertEqual(counts['saved'],1 if i==1 else 0)
                with self.assertRaises(RuntimeError):pop._putcmd('DELE 1')
                with self.assertRaises(RuntimeError):pop._putcmd('PASS fake\r\nDELE 1')
                pop.quit()
            thread.join(5);self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
        self.assertNotIn('DELE',commands);self.assertEqual(commands.count('RETR'),2);self.assertEqual(len(bridge.saved),1)
        self.assertEqual(c.package(RAW,b'uid')['files'][0]['data'],c.base64.b64encode(RAW).decode())

    def test_mime_names_and_limits(self):
        self.assertNotIn('/',c.clean_name('../../evil.exe'))
        with self.assertRaises(ValueError):c.package(b'x'*(c.LIMIT+1),b'uid')
        self.assertIsNone(c.message_date(b'Date: invalid\r\n\r\n'))
        self.assertEqual(c.ssl.create_default_context().verify_mode,ssl.CERT_REQUIRED)

    def test_batch_date_and_duplicate_bounds(self):
        class Fake:
            def uidl(self):return b'+OK',[b'1 old',b'2 undated',b'3 huge',b'4 recent'],0
            def list(self):return b'+OK',[b'1 100',b'2 100',b'3 999999999',b'4 100'],0
            def top(self,*args):raise c.poplib.error_proto('TOP unsupported')
            def retr(self,n):
                raw={1:RAW.replace(b'2026',b'2020'),2:b'Date: invalid\r\n\r\nhello',4:RAW}[n]
                return b'+OK',raw.rstrip(b'\r\n').split(b'\r\n'),len(raw)
        bridge=Bridge();bridge.fail=False
        cutoff=dt.datetime(2026,8,18,tzinfo=c.UTC)
        first=c.sync(Fake(),bridge,cutoff,batch=1)
        self.assertEqual(first['deferred'],3)
        self.assertEqual(first['cursor'],c.digest(b'recent'))
        counts=c.sync(Fake(),bridge,cutoff,cursor=first['cursor'])
        self.assertIsNone(counts['cursor'])
        self.assertEqual((counts['saved'],counts['skipped'],counts['undated'],counts['oversized']),(0,1,1,1))
        class Duplicate(Fake):
            def uidl(self):return b'+OK',[b'1 same',b'2 same'],0
        with self.assertRaises(RuntimeError):c.sync(Duplicate(),bridge,cutoff)
        read=object.__new__(c.ReadOnlyPOP)
        read._getresp=lambda:b'+OK'
        read._getline=lambda:(b'X'*(c.LIMIT+1),c.LIMIT+1)
        with self.assertRaises(RuntimeError):read._getlongresp()

    def test_forwarded_eml_remains_attachment(self):
        raw=(b'Date: Sat, 17 Oct 2026 01:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n'
             b'--x\r\nContent-Type: text/plain\r\n\r\nouter body\r\n'
             b'--x\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment; filename="forwarded.eml"\r\n\r\n'+RAW+b'\r\n--x--\r\n')
        files=c.package(raw,b'uid')['files']
        self.assertEqual([f['kind'] for f in files],['eml','text','attachment'])
        self.assertEqual(files[2]['name'],'forwarded.eml')

    def test_mime_limit_does_not_block_following_mail(self):
        poison=b'Date: Sat, 17 Oct 2026 01:00:00 +0000\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n'+(b'--x\r\nContent-Type: text/plain\r\n\r\nx\r\n'*55)+b'--x--\r\n'
        class Fake:
            def uidl(self):return b'+OK',[b'1 good',b'2 poison'],0
            def list(self):return b'+OK',[b'1 100',b'2 5000'],0
            def top(self,*args):raise c.poplib.error_proto('unsupported')
            def retr(self,n):
                raw=poison if n==2 else RAW
                return b'+OK',raw.rstrip(b'\r\n').split(b'\r\n'),len(raw)
        bridge=Bridge();bridge.fail=False
        counts=c.sync(Fake(),bridge,dt.datetime(2026,8,18,tzinfo=c.UTC))
        self.assertEqual((counts['saved'],counts['oversized']),(1,1))

if __name__=='__main__':unittest.main()
