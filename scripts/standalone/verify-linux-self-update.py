import functools
import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


def request(url, data=None, client=urllib.request):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    data = None if data is None else json.dumps(data).encode()
    with client.open(urllib.request.Request(url, data=data, headers=headers), timeout=4) as response:
        return json.load(response)


def browser_session(host):
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    with client.open(f"{host['url']}/?ide_token={host['token']}", timeout=4):
        pass
    return client


archive, old_binary = map(Path, sys.argv[1:3])
version = sys.argv[3]
if os.geteuid() != 0 or not Path("/run/systemd/system").is_dir():
    raise RuntimeError("Run this verification on an isolated Linux host with systemd")

with tempfile.TemporaryDirectory(prefix="standalone-systemd-test-") as tmp:
    work = Path(tmp)
    discovery = work / "remote"
    executable = work / "installed/local-ai-agent"
    downloads = work / "downloads"
    release = downloads / f"standalone-v{version}"
    release.mkdir(parents=True)
    shutil.copy2(archive, release)
    shutil.copy2(Path(str(archive) + ".sha256"), release)
    shutil.copy2(Path(__file__).parent.parent / "install.sh", downloads)
    subprocess.run(["tar", "-xzf", str(archive), "-C", tmp], check=True)
    bundle = work / archive.name.removesuffix(".tar.gz")
    shutil.copy2(old_binary, bundle / "local-ai-agent")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(downloads))
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        env = dict(os.environ, HOME=tmp, IDE_AGENT_REMOTE_HOST_DIR=str(discovery),
                   MINDFS_RELAY_BASE_URL="http://127.0.0.1:1",
                   LOCAL_AI_AGENT_INSTALL_SCRIPT_BASE_URL=base, LOCAL_AI_AGENT_DOWNLOAD_BASE_URL=base)
        for key in ("IDE_AGENT_DATA_DIR", "IDE_AGENT_TOKEN", "MINDFS_STATIC_DIR", "XDG_CONFIG_HOME"):
            env.pop(key, None)
        try:
            subprocess.run(["sh", str(bundle / "install.sh"), str(executable.parent)], env=env, check=True, timeout=60)
            assert (discovery / "systemd-core.env").is_file()
            host = discovery / "host.json"
            before = json.loads(host.read_bytes())
            endpoint = before["url"] + "/api/standalone/update"
            client = browser_session(before)
            status = request(endpoint, {"version": version}, client)
            assert status["phase"] == "installing", status
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    after = json.loads(host.read_bytes())
                    status = request(endpoint, client=browser_session(after))
                except (urllib.error.URLError, TimeoutError, FileNotFoundError):
                    time.sleep(1)
                    continue
                if status["phase"] == "failed":
                    raise RuntimeError(status)
                if status["phase"] == "done":
                    assert status["current"] == version and after["url"] == before["url"], status
                    print(f"Linux systemd self-update completed on the original address, now running {version}.")
                    break
                time.sleep(1)
            else:
                raise RuntimeError(f"The update did not finish: {status}")
        finally:
            log = discovery / "logs/update.log"
            if log.exists():
                print(log.read_text(errors="replace"))
            if executable.exists():
                subprocess.run([str(executable), "-unregister"], env=env, check=True, timeout=60)
            server.shutdown()
            thread.join()
