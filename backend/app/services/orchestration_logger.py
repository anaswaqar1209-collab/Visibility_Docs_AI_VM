"""Orchestration logger -- prints beautiful step-by-step pipeline progress to terminal."""

import time
import sys
import io

# Force UTF-8 on stdout/stderr if possible
if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    except Exception:
        pass


# ANSI colors
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"
    GRAY = "\033[90m"
    GREEN_BG = "\033[102m"
    RED_BG = "\033[101m"
    BLACK = "\033[30m"


def _enable_ansi():
    if sys.platform == "win32":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass


_enable_ansi()

H = "-"  # horizontal line char
V = "|"  # vertical line char
TL = "+-"  # top-left
TR = "-+"  # top-right
BL = "+-"  # bottom-left
BR = "-+"  # bottom-right


class OrchestrationLogger:
    def __init__(self, document_title: str = "", document_id: str = ""):
        self.document_title = document_title
        self.document_id = document_id
        self.start_time = time.time()
        self._step_count = 0
        self._total_steps = 0

    def set_total_steps(self, n: int):
        self._total_steps = n

    def _step_header(self, label: str):
        self._step_count += 1
        step_str = f"STEP {self._step_count}/{self._total_steps}" if self._total_steps else f"STEP {self._step_count}"
        print()
        print(f"  {C.BOLD}{C.CYAN}{TL}{step_str}: {label} {TR}{C.RESET}")
        print(f"  {C.CYAN}{V}{C.RESET}")

    def _line(self, text: str, color=C.WHITE):
        print(f"  {C.CYAN}{V}{C.RESET} {color}{text}{C.RESET}")

    # -- Public API --

    def start(self, subtitle: str = ""):
        print()
        print(f"  {C.BOLD}{C.WHITE}+{H*60}+{C.RESET}")
        print(f"  {C.BOLD}{C.WHITE}{V}{C.RESET}  {C.BOLD}{C.BLUE}VISIBILITY DOCS AI - AGENT ORCHESTRATION{C.RESET}{C.WHITE}        {V}{C.RESET}")
        print(f"  {C.BOLD}{C.WHITE}+{H*60}+{C.RESET}")
        print()
        print(f"  {C.BOLD}{C.YELLOW}[DOC]{C.RESET}  Document: {C.BOLD}{self.document_title}{C.RESET}")
        if self.document_id:
            print(f"  {C.DIM}   ID: {self.document_id}{C.RESET}")
        if subtitle:
            print(f"  {C.DIM}   {subtitle}{C.RESET}")

    def step(self, label: str):
        self._step_header(label)

    def info(self, msg: str):
        self._line(f" [i]  {msg}")

    def ok(self, msg: str):
        self._line(f"  {C.GREEN}[OK]{C.RESET}  {msg}")

    def warn(self, msg: str):
        self._line(f"  {C.YELLOW}[!]{C.RESET}  {msg}", C.YELLOW)

    def fail(self, msg: str):
        self._line(f"  {C.RED}[FAIL]{C.RESET}  {msg}", C.RED)

    def agent_call(self, agent_name: str, prompt_file: str = "", provider: str = ""):
        parts = [f"Agent: {C.BOLD}{agent_name}{C.RESET}"]
        if prompt_file:
            parts.append(f"Prompt: {C.DIM}{prompt_file}{C.RESET}")
        if provider:
            parts.append(f"Provider: {C.DIM}{provider}{C.RESET}")
        self._line("  " + "  |  ".join(parts), C.MAGENTA)

    def result(self, key: str, value: str, color=C.WHITE):
        self._line(f"  -> {key}: {color}{value}{C.RESET}")

    def end(self, status: str = "processed"):
        total = time.time() - self.start_time
        print()
        if status in ("processed", "completed"):
            badge = f"{C.GREEN_BG}{C.BLACK} [OK] {C.RESET}"
            color = C.GREEN
        else:
            badge = f"{C.RED_BG}{C.BLACK} [FAIL] {C.RESET}"
            color = C.RED
        print(f"  {C.BOLD}{color}+{H*60}+{C.RESET}")
        print(f"  {C.BOLD}{color}{V}{C.RESET}  {badge}  {C.BOLD}PIPELINE COMPLETE{C.RESET}  |  Status: {C.BOLD}{status}{C.RESET}  |  Total: {C.BOLD}{total:.1f}s{C.RESET}  {color}{V}{C.RESET}")
        print(f"  {C.BOLD}{color}+{H*60}+{C.RESET}")
        print()

    def divider(self):
        print(f"  {C.DIM}{H*62}{C.RESET}")


# Singleton
_orch_logger: OrchestrationLogger | None = None


def get_logger() -> OrchestrationLogger:
    global _orch_logger
    if _orch_logger is None:
        _orch_logger = OrchestrationLogger()
    return _orch_logger


def reset_logger(title: str = "", doc_id: str = "") -> OrchestrationLogger:
    global _orch_logger
    _orch_logger = OrchestrationLogger(title, doc_id)
    return _orch_logger
