#!/bin/sh
# Runs the firmware's plain-C++ logic (laser parser, relay rules) on this computer. Needs g++ or clang++.
set -e
cd "$(dirname "$0")"
CXX="${CXX:-c++}"
out="$(mktemp -d)"
for t in sen0366_test relay_test; do
  "$CXX" -std=c++17 -Wall -Wextra -I../include "$t.cpp" -o "$out/$t"
  "$out/$t"
done
