# heretek-devcontainers — Step 0 baseline Makefile
# Robust to missing files in Step 0: every optional step is guarded by [ -f ... ].

.PHONY: check accept verify test

check:
	@if [ -f scripts/verify-stack.ts ]; then \
		echo "==> bun run scripts/verify-stack.ts"; \
		bun run scripts/verify-stack.ts; \
	else \
		echo "==> verify-stack.ts not present yet (Step 0) — skipping verifier"; \
	fi
	@if ls test/*.test.ts >/dev/null 2>&1; then \
		echo "==> bun test"; \
		bun test; \
	else \
		echo "==> no tests yet (Step 0) — skipping bun test"; \
	fi

accept:
	@for w in 1 2 3; do \
		if [ -f scripts/accept/wave-$$w.sh ]; then \
			echo "==> bash scripts/accept/wave-$$w.sh"; \
			bash scripts/accept/wave-$$w.sh; \
		else \
			echo "==> scripts/accept/wave-$$w.sh not present — skipping"; \
		fi; \
	done

verify:
	@if [ -f scripts/verify-stack.ts ]; then \
		bun run scripts/verify-stack.ts; \
	else \
		echo "verify-stack.ts not present yet (Step 0) — skipping"; \
	fi

test:
	@if ls test/*.test.ts >/dev/null 2>&1; then \
		bun test; \
	else \
		echo "no tests yet (Step 0) — skipping"; \
	fi
