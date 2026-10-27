.PHONY: test compile lint check smoke

test:
	node --test test/*.test.cjs

compile:
	gh aw compile --dir workflows --strict --no-emit

lint:
	markdownlint-cli2 "**/*.md" "#node_modules" "#.superpowers"

check: test compile lint

smoke:
	./scripts/install-smoke.sh
