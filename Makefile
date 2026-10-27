.PHONY: test compile lint check smoke e2e

test:
	node --test test/*.test.cjs

compile:
	gh aw compile --dir workflows --strict --no-emit

lint:
	markdownlint-cli2 "**/*.md" "#node_modules" "#.superpowers"

check: test compile lint

smoke:
	./scripts/install-smoke.sh

e2e:
	bash test/e2e/scenarios.sh $(SCENARIOS)
