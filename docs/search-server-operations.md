# 검색 서버 운영

2026-10-16 배포. Ubuntu 22.04 / 1GB micro, `211.233.219.199`.

- nginx: 80 인증서 검증·HTTPS 이동, 443 `/search`와 `/health`만 공개.
- `sajo-search.service`: XERJ rc95 musl. 전용 사용자, 루프백 19200~19202, 메모리 400MB 제한. Rayon/Tokio 스레드 각 1.
- `sajo-search-api.service`: Python API `/opt/sajo-search/search-server.py`, 루프백 19210, 메모리 160MB 제한.
- API 환경은 `/etc/sajo-search.env`, XERJ 키는 `/var/lib/sajo-search/data/admin.key`. 키를 저장소에 복사하지 않는다.
- `sajo-cert-renew.timer`: 하루 두 번 Certbot 갱신 확인, 성공 시 nginx reload. IP 인증서는 유효기간이 짧으므로 타이머를 유지한다.

API 변경 시 `scripts/search-server.py`를 서버 경로에 전송하고 `python3 -m py_compile /opt/sajo-search/search-server.py`, `systemctl restart sajo-search-api` 후 HTTPS `/health`를 확인한다. 시작 직후에는 소켓 준비 전 잠시 연결이 거절될 수 있다.

확인 명령: `systemctl status sajo-search sajo-search-api nginx`, `systemctl list-timers sajo-cert-renew.timer`, `journalctl -u sajo-search-api`. API는 JWT·검색어·본문을 로그에 남기지 않는다.

검색은 사용자 JWT로 기존 `operations_search` 권한과 부모 기록 RLS를 검사한다. 별도 service-role 키가 없다. 요청당 최대 두 개의 TXT/CSV/텍스트 PDF만 추출하며, 실패한 문서는 5분 뒤 재시도한다. 파일 10MB·PDF 100페이지·본문 20만 자 제한. 스캔 PDF OCR은 지원하지 않는다. 색인은 원본의 대체 저장소가 아니며 재생성 가능하다. 문서 수가 많으면 센터를 선택한다.

프론트엔드 `VITE_DOCUMENT_SEARCH_URL`로 주소를 바꿀 수 있다. 미설정 시 위 서버의 HTTPS 주소를 사용한다. 서버 장애 시 기존 업무·파일명 검색은 계속 동작한다.

실제 계정의 문서 검색과 권한 회수·삭제 시나리오는 사용자 로그인 상태에서 별도로 확인해야 한다. 공개 HTTPS 정상 응답 및 미인증 401은 확인했다.
