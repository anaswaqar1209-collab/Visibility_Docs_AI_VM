"""Start script — auto-frees port 8000, then launches the server."""
import os
import sys
import time
import subprocess
import logging
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning, module="langchain")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("run")

HOST = "0.0.0.0"
PORT = 8000


def free_port(port: int):
    """Find and kill any process listening on the given port."""
    try:
        if sys.platform == "win32":
            CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True,
                creationflags=CREATE_NO_WINDOW
            )
            for line in result.stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and f":{port}" in parts[1] and "LISTENING" in parts[3]:
                    pid = parts[-1]
                    subprocess.run(["taskkill", "/F", "/PID", pid],
                                   capture_output=True, creationflags=CREATE_NO_WINDOW)
                    logger.info(f"Killed PID {pid} (held port {port})")
                    time.sleep(1)
                    return
        else:
            result = subprocess.run(["lsof", "-t", f"-i:{port}"], capture_output=True, text=True)
            pids = result.stdout.strip().splitlines()
            for pid in pids:
                if pid:
                    subprocess.run(["kill", "-9", pid])
                    logger.info(f"Killed PID {pid} (held port {port})")
            if pids:
                time.sleep(1)
    except Exception as e:
        logger.warning(f"free_port error: {e}")


if __name__ == "__main__":
    free_port(PORT)
    logger.info(f"Starting server on {HOST}:{PORT}...")
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    from uvicorn.main import run
    run("app.main:app", host=HOST, port=PORT, log_level="info")
