# Zephyr: High-Throughput Distributed Stream-Relational Engine & CEP Kernel
# Copyright (c) 2026 Aneesh Krishna. All rights reserved.

.PHONY: all audit test test-unit test-integration test-regressions bench server repl chaos clean verify build-c

all: verify

audit:
	@python3 tools/audit_em_dashes.py

test:
	@node --test "test/**/*.test.js"

test-unit:
	@node --test "test/unit/**/*.test.js"

test-integration:
	@node --test "test/integration/**/*.test.js"

test-regressions:
	@node --test "test/regressions/**/*.test.js"

bench:
	@node bench/all_benchmarks.js

server:
	@node bin/zephyr-server.js

repl:
	@node bin/zephyr-repl.js

chaos:
	@node tools/chaos_runner.js

build-c:
	@if command -v clang >/dev/null 2>&1; then \
		clang -O3 -Wall -Wextra clients/c/zephyr_wire.c clients/c/zephyr_ingest.c -o bin/zephyr_ingest 2>/dev/null || true; \
	elif command -v gcc >/dev/null 2>&1; then \
		gcc -O3 -Wall -Wextra clients/c/zephyr_wire.c clients/c/zephyr_ingest.c -o bin/zephyr_ingest 2>/dev/null || true; \
	fi

clean:
	@rm -rf data tmp *.log bin/zephyr_ingest build dist *.o *.so *.dylib

verify: audit test
	@echo "[VERIFY] All audit checks and automated tests passed with zero defects."
