set -eu
id talkcloud >/dev/null 2>&1 || useradd --system --home-dir /opt/talkcloud --shell /usr/sbin/nologin talkcloud
python3 -m venv /opt/talkcloud/venv
/opt/talkcloud/venv/bin/pip install -r /opt/talkcloud/requirements.txt
PLAYWRIGHT_BROWSERS_PATH=/opt/talkcloud/browsers /opt/talkcloud/venv/bin/python -m playwright install --with-deps chromium --only-shell
chown -R talkcloud:talkcloud /opt/talkcloud
install -m 644 /opt/talkcloud/deploy/talkcloud.service /etc/systemd/system/talkcloud.service
systemctl daemon-reload
systemctl enable --now talkcloud.service
