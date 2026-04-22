"""`workbench` CLI — launch the runtime with `python -m workbench` or
via the `workbench` entry point.

Thin wrapper over uvicorn so operators don't need to memorize the
module path. Pairs with the env vars resolved in
:mod:`workbench.config`.
"""

from __future__ import annotations

import uvicorn

from workbench.config import load_config


def main() -> None:
    cfg = load_config()
    uvicorn.run(
        "workbench.app:app",
        host=cfg.host,
        port=cfg.port,
        log_level=cfg.log_level,
    )


if __name__ == "__main__":
    main()
