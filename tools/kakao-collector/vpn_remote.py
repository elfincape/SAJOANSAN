"""Expose the dashboard on the macOS Tailscale interface to the paired owner's devices."""
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

from collector import Store

APP = Path("/Applications/Tailscale.app")
CLI = APP / "Contents/MacOS/Tailscale"
TAIL_IPS = ipaddress.ip_network("100.64.0.0/10")
TAIL_IPV6 = ipaddress.ip_network("fd7a:115c:a1e0::/48")
PORT = 18749
IP_BOUND_IF = 25  # Darwin netinet/in.h


def cli_json(*args):
    result = subprocess.run([str(CLI), *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env={**os.environ, "TAILSCALE_BE_CLI": "1"}, timeout=8, check=True)
    return json.loads(result.stdout)


def same_owner_peer(address, owner):
    try:
        ip, port = address[:2]
        addr = ipaddress.ip_address(ip)
        if addr not in TAIL_IPS and addr not in TAIL_IPV6:
            return False
        peer = f"[{addr}]:{port}" if addr.version == 6 else f"{addr}:{port}"
        who = cli_json("whois", "--json", peer)
        node = who["Node"]
        return (node["User"] == owner == who["UserProfile"]["ID"] and not node.get("Tags")
                and f"{addr}/{addr.max_prefixlen}" in node["Addresses"])
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return False


def vpn_interface(ip):
    listing = subprocess.check_output(["/sbin/ifconfig", "-a"], text=True, timeout=8)
    for block in re.split(r"\n(?=\S)", listing):
        iface = block.partition(":")[0]
        if re.fullmatch(r"utun\d+", iface) and re.search(r"^\s+inet "+re.escape(ip)+r"\s", block, re.M):
            return socket.if_nametoindex(iface)
    raise ValueError("Tailscale 네트워크 연결 대기")


def endpoint(root):
    info = cli_json("status", "--json")
    if info.get("BackendState") != "Running":
        raise ValueError("Tailscale 로그인 또는 연결 대기")
    node = info["Self"]
    owner, device = node.get("UserID"), node.get("ID")
    if not owner or not device or node.get("Tags") or str(owner) not in info.get("User", {}):
        raise ValueError("Tailscale 개인 기기 계정 확인 필요")
    ip = next((s for s in node["TailscaleIPs"] if ipaddress.ip_address(s) in TAIL_IPS), None)
    if not ip:
        raise ValueError("Tailscale IPv4 연결 대기")
    index = vpn_interface(ip)
    with Store(root) as store:
        paired = store.setting("private_vpn_owner")
        if paired is None:
            store.configure("private_vpn_owner", [owner, device])
        elif paired != [owner, device]:
            raise ValueError("처음 연결한 Tailscale 계정과 기기로 로그인해 주세요")
    return ip, index, owner


def register_numeric_host(config, dns, ip, target):
    # For an HTTP Host without the MagicDNS suffix, Serve appends that suffix
    # before selecting a web handler, including when Host is an IPv4 literal.
    source = dns + ":80"
    alias = ip + "." + dns.split(".", 1)[1] + ":80"
    web = config.get("Web", {})
    route = {"Handlers": {"/": {"Proxy": target}}}
    if web.get(source) != route or config.get("AllowFunnel", {}).get(source):
        return False
    if alias in web:
        return web[alias] == route
    # Only edit a configuration dedicated entirely to this collector.
    if config != {"TCP": {"80": {"HTTP": True}}, "Web": {source: route}}:
        return False
    config["Web"][alias] = route
    subprocess.run([str(CLI), "debug", "localapi", "POST", "serve-config", "-"],
                   input=json.dumps(config).encode(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   env={**os.environ, "TAILSCALE_BE_CLI": "1"}, timeout=8, check=True)
    return (cli_json("serve", "status", "--json") or {}).get("Web", {}).get(alias) == route


def standard_listener(dashboard, handler, owner, ip):
    # Serve injects the authenticated peer address. A private backend path also
    # separates these requests from arbitrary callers on the loopback interface.
    dns = cli_json("status", "--json")["Self"]["DNSName"].rstrip(".").lower()
    if not re.fullmatch(r"[a-z0-9.-]+\.ts\.net", dns):
        raise ValueError("Invalid private DNS name")
    with Store(dashboard.root) as store:
        key = store.setting("private_serve_key")
        if not key:
            key = secrets.token_urlsafe(32)
            store.configure("private_serve_key", key)
    hosts = {ip, dns, dns.split(".")[0]}
    hosts |= {h + ":80" for h in hosts}
    def connection(request, peer, _server):
        request.settimeout(30)
        handler(request, peer, dashboard, owner, key, hosts, ip)
    server = ThreadingHTTPServer(("127.0.0.1", 18750), connection)
    try:
        target = f"http://127.0.0.1:18750/{key}"
        config = cli_json("serve", "status", "--json") or {}
        handlers = config.get("Web", {}).get(f"{dns}:80", {}).get("Handlers", {})
        if handlers != {"/": {"Proxy": target}}:
            if "80" in config.get("TCP", {}) or handlers:
                raise ValueError("Tailscale 80번 포트가 이미 사용 중입니다")
            subprocess.run([str(CLI), "serve", "--bg", "--http=80", target], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=12, check=True,
                           env={**os.environ, "TAILSCALE_BE_CLI": "1"})
            confirmed = cli_json("serve", "status", "--json") or {}
            if confirmed.get("Web", {}).get(f"{dns}:80", {}).get("Handlers") != {"/": {"Proxy": target}}:
                raise ValueError("Tailscale 기본 주소 연결 대기")
        config = cli_json("serve", "status", "--json") or {}
        try:
            numeric = register_numeric_host(config, dns, ip, target)
        except (OSError, ValueError, subprocess.SubprocessError):
            numeric = False
        threading.Thread(target=server.serve_forever, daemon=True).start()
    except BaseException:
        server.server_close()
        raise
    return server, f"http://{ip if numeric else dns}/"


def serve_private(dashboard, handler, forwarded_handler):
    if not CLI.is_file():
        dashboard.vpn_status = "Tailscale 설치 필요"
        return
    subprocess.run(["/usr/bin/open", "-gj", str(APP)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    standard = standard_for = None
    standard_url = ""
    current = listener = None
    while True:
        try:
            desired = endpoint(dashboard.root)
            status = "같은 계정의 VPN 기기에서 접속 가능"
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as err:
            desired = None
            status = str(err) if type(err) is ValueError and str(err).startswith(("처음", "Tailscale")) else "Tailscale 승인 또는 연결 대기"
        if current != desired and listener:
            listener.shutdown()
            listener.server_close()
            current = listener = None
        if desired and current is None:
            ip, index, owner = desired

            def connection(request, peer, _server, owner=owner):
                request.settimeout(30)
                handler(request, peer, dashboard, owner)

            server = ThreadingHTTPServer((ip, PORT), connection, bind_and_activate=False)
            try:
                server.socket.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, index)
                server.server_bind()
                server.server_activate()
            except OSError:
                server.server_close()
                status = "VPN 주소에 제어 화면을 열 수 없습니다"
            else:
                listener, current = server, desired
                threading.Thread(target=server.serve_forever, daemon=True).start()
        if standard and standard_for != desired:
            standard.shutdown()
            standard.server_close()
            standard = standard_for = None
            standard_url = ""
        if desired and standard is None:
            try:
                standard, standard_url = standard_listener(dashboard, forwarded_handler, desired[2], desired[0])
                standard_for = desired
                status = "같은 계정의 VPN 기기에서 접속 가능"
            except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                pass
        dashboard.vpn_url = standard_url or (f"http://{current[0]}:{PORT}/" if current else "")
        dashboard.vpn_status = status
        time.sleep(60 if current else 15)
