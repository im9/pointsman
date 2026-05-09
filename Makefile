.PHONY: release release-m4l

# Default release target — currently m4l only. release-vst is deferred
# to vst implementation (see ADR 002 §Out of scope).
release: release-m4l

# Build + bake the m4l dev .amxd and ensure the release dir exists.
# Freeze is a manual step in Max (no CLI available). See ADR 002
# §Phase 0 and CLAUDE.md.
release-m4l:
	cd m4l && pnpm -r build && pnpm bake
	mkdir -p dist
	@echo ""
	@echo "Next: open m4l/Pointsman.amxd in Max → click the snowflake"
	@echo "      (Freeze) button in the patcher toolbar → File → Save As"
	@echo "      $(CURDIR)/dist/Pointsman.amxd"
