.PHONY: build configure release debug clean test

build: configure release

configure:
	cmake -B build -DCMAKE_BUILD_TYPE=Release

release:
	cmake --build build --config Release -j8

debug:
	cmake -B build -DCMAKE_BUILD_TYPE=Debug
	cmake --build build --config Debug -j8

# pointsman_tests target is rebuilt in ADR 003 Phase 1 (Catch2 v3 +
# nlohmann/json v3 via FetchContent). Phase 0 ships build-only.
test:
	@echo "tests not yet wired — see docs/ai/adr/003-pointsman-vst-architecture.md Phase 1"
	@exit 1

clean:
	rm -rf build
