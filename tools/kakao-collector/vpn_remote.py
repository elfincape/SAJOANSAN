"""Expose the dashboard on the macOS Tailscale interface to the paired owner's devices."""
import ipaddress
import json
import os
import re
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
PORT = 18749
IP_BOUND_IF = 25  # Darwin netinet/in.h


def cli_json(*args):
    result = subprocess.run([str(CLI), *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env={**os.environ, "TAILSCALE_BE_CLI": "1"}, timeout=8, check=True)
    return json.loads(result.stdout)


def same_owner_peer(address, owner):
    try:
        ip, port = address[:2]
        if ipaddress.ip_address(ip) not in TAIL_IPS:
            return False
        who = cli_json("whois", "--json", f"{ip}:{port}")
        node = who["Node"]
        return (node["User"] == owner == who["UserProfile"]["ID"] and not node.get("Tags")
                and f"{ip}/32" in node["Addresses"])
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


def serve_private(dashboard, handler):
    if not CLI.is_file():
        dashboard.vpn_status = "Tailscale 설치 필요"
        return
    subprocess.run(["/usr/bin/open", "-gj", str(APP)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        dashboard.vpn_url = f"http://{current[0]}:{PORT}/" if current else ""
        dashboard.vpn_status = status
        time.sleep(60 if current else 15)
