"""Project-local entry points; credentials stay in ignored .env.local or environment."""
import json
import os
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent
python = root / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if not python.is_file():
    raise SystemExit('Restore sources with install.py, then uv sync --project .agent-tools/jev')
local = root / '.env.local'
allowed = {'TYPESAFE_API_KEY', 'TEXT_MODEL_API_KEY', 'TEXT_MODEL', 'TEXT_MODEL_BASE_URL'}
if local.exists():
    for key, value in json.loads(local.read_text()).items():
        if key in allowed:
            os.environ.setdefault(key, value)
os.environ.setdefault('BH_HOME', str(root / 'state' / 'browser-harness'))
os.environ.setdefault('HERMES_HOME', str(root / 'state' / 'hermes'))
os.environ.setdefault('JEVMCP_STATE_DIR', str(root / 'state'))
os.environ.setdefault('JEVMCP_PROFILE_DIR', str(root / 'state' / 'chrome-profile'))
os.environ.setdefault('JEVMCP_HEADLESS', '1')
os.environ.setdefault('JEV_ULTRAFAST_REPO', str(root / 'sources' / 'ultrafast'))
chrome = shutil.which('chromium') or shutil.which('google-chrome')
if chrome:
    os.environ.setdefault('JEVMCP_CHROME', chrome)
    os.environ.setdefault('BH_CHROME_PATH', chrome)
paths = [str(root / 'sources' / 'hermes')]
if os.environ.get('PYTHONPATH'):
    paths.append(os.environ['PYTHONPATH'])
os.environ['PYTHONPATH'] = os.pathsep.join(paths)
modes = {'mcp': ['-m', 'jev_ultrafast_mcp'], 'ultrafast': ['-m', 'jev_ultrafast.demo'],
         'hermes': ['-m', 'jevkit'],
         'browser': [str(root.parents[1] / '.agents/skills/jev-browser-use/scripts/jev_browser_agent.py')]}
if len(sys.argv) < 2 or sys.argv[1] not in modes:
    raise SystemExit('Usage: python3 .agent-tools/jev/run.py {mcp|ultrafast|hermes|browser} [args]')
os.execv(str(python), [str(python), *modes[sys.argv[1]], *sys.argv[2:]])
