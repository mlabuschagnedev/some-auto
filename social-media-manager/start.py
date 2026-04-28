import atexit
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}

def _is_trycloudflare_url(value: str) -> bool:
    return "trycloudflare.com" in value.strip().lower()

def _find_cloudflared_exe() -> str | None:
    exe_from_path = shutil.which("cloudflared")
    if exe_from_path:
        return exe_from_path

    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    default_path = Path(program_files_x86) / "cloudflared" / "cloudflared.exe"
    if default_path.exists():
        return str(default_path)

    return None

def _terminate_previous_tunnel(pid_file: Path) -> None:
    if not pid_file.exists():
        return

    try:
        pid = int(pid_file.read_text(encoding="ascii").strip())
    except Exception:
        pid_file.unlink(missing_ok=True)
        return

    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    pid_file.unlink(missing_ok=True)


def _start_quick_tunnel(origin_url: str, runtime_dir: Path, timeout_seconds: int = 45) -> tuple[subprocess.Popen | None, str | None]:
    cloudflared_exe = _find_cloudflared_exe()
    if not cloudflared_exe:
        print("[INFO] cloudflared not found. Skipping auto tunnel setup.")
        return None, None

    runtime_dir.mkdir(parents=True, exist_ok=True)
    log_path = runtime_dir / "cloudflared-auto.log"
    pid_path = runtime_dir / "cloudflared-auto.pid"
    log_path.write_text("", encoding="utf-8")

    _terminate_previous_tunnel(pid_path)

    process = subprocess.Popen(
        [cloudflared_exe, "tunnel", "--url", origin_url, "--no-autoupdate", "--logfile", str(log_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    pid_path.write_text(str(process.pid), encoding="ascii")

    tunnel_regex = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        if process.poll() is not None:
            break
        try:
            contents = log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            contents = ""
        match = tunnel_regex.search(contents)
        if match:
            tunnel_url = match.group(0).rstrip("/")
            return process, tunnel_url
        time.sleep(0.5)

    process.terminate()
    return None, None


def _configure_public_base_url() -> subprocess.Popen | None:
    auto_tunnel_enabled = _is_truthy(os.environ.get("AUTO_TRYCLOUDFLARE_TUNNEL", "1"))
    current_public_base = os.environ.get("PUBLIC_BASE_URL", "").strip()

    if not auto_tunnel_enabled:
        return None

    if current_public_base and not _is_trycloudflare_url(current_public_base):
        return None

    app_port = os.environ.get("PORT", "5000")
    runtime_dir = Path(__file__).resolve().parent / "runtime"
    tunnel_process, tunnel_url = _start_quick_tunnel(f"http://127.0.0.1:{app_port}", runtime_dir)

    if tunnel_url:
        os.environ["PUBLIC_BASE_URL"] = tunnel_url
        print(f"[INFO] PUBLIC_BASE_URL auto-set to {tunnel_url}")
    else:
        if _is_trycloudflare_url(current_public_base):
            os.environ["PUBLIC_BASE_URL"] = ""
            print("[WARNING] Could not create Cloudflare quick tunnel. Cleared stale trycloudflare PUBLIC_BASE_URL.")
        else:
            print("[WARNING] Could not create Cloudflare quick tunnel. PUBLIC_BASE_URL unchanged.")

    return tunnel_process


# Update these values before running.
# You can also set them in your terminal instead of hardcoding here.
os.environ.setdefault("PUBLIC_BASE_URL", "")
os.environ.setdefault("APP_TIMEZONE", "Africa/Johannesburg")

tunnel_process = _configure_public_base_url()
if tunnel_process:
    atexit.register(tunnel_process.terminate)

from backend.app import app


if __name__ == "__main__":
    debug_enabled = _is_truthy(os.environ.get("FLASK_DEBUG", "1"))
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=debug_enabled, use_reloader=False)
