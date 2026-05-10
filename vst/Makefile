.PHONY: build configure release debug clean test

build: configure release

configure:
	cmake -B build -DCMAKE_BUILD_TYPE=Release

release:
	cmake --build build --config Release -j8

debug:
	cmake -B build -DCMAKE_BUILD_TYPE=Debug
	cmake --build build --config Debug -j8

# Builds (configure if needed) and runs the pointsman_tests Catch2 binary.
# Engine vectors live in docs/ai/{rng,quantizer}-test-vectors.json — paths
# are baked into the binary as POINTSMAN_*_VECTORS_PATH.
test: configure
	cmake --build build --config Release --target pointsman_tests -j8
	./build/pointsman_tests

clean:
	rm -rf build
