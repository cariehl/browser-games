cmake_minimum_required(VERSION 3.16)
project(signalbench_firmware C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Debug)
endif()

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wshadow -Wconversion -Wno-sign-conversion -Werror=implicit-function-declaration)
endif()

option(SB_ENABLE_COVERAGE "Build unit tests with gcov coverage" OFF)

# ---- SDK: HAL backed by the simulator -------------------------------------
add_library(sb_hal_sim STATIC sdk/src/hal_sim.c)
target_include_directories(sb_hal_sim PUBLIC sdk/include)
if(WIN32)
  target_link_libraries(sb_hal_sim PUBLIC ws2_32)
endif()

# ---- Application logic (pure modules, no HAL dependency except tmp102) ----
set(APP_LOGIC
  app/scheduler.c
  app/debounce.c
  app/patterns.c
  app/siren.c
  app/pdm.c
  app/power.c
  app/arm.c
  app/tmp102.c)

add_library(sb_app_logic STATIC ${APP_LOGIC})
target_include_directories(sb_app_logic PUBLIC app sdk/include)

# ---- Firmware images -------------------------------------------------------
add_executable(app app/main.c)
target_link_libraries(app PRIVATE sb_app_logic sb_hal_sim)

add_executable(blinky examples/blinky.c)
target_link_libraries(blinky PRIVATE sb_hal_sim)

add_executable(pdm_hello examples/pdm_hello.c)
target_link_libraries(pdm_hello PRIVATE sb_hal_sim)

# Put every image next to each other in build/bin for the simulator's "Flash".
set_target_properties(app blinky pdm_hello PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

# ---- Unit tests (host build, no simulator) ---------------------------------
enable_testing()
add_library(unity STATIC third_party/unity/unity.c)
target_include_directories(unity PUBLIC third_party/unity)
target_compile_options(unity PRIVATE -w)

function(sb_add_test name)
  add_executable(${name} tests/${name}.c ${ARGN})
  target_include_directories(${name} PRIVATE app sdk/include)
  target_link_libraries(${name} PRIVATE unity)
  if(SB_ENABLE_COVERAGE)
    target_compile_options(${name} PRIVATE --coverage -O0)
    target_link_options(${name} PRIVATE --coverage)
  endif()
  set_target_properties(${name} PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/tests)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

# Each test compiles the module under test directly (no HAL linked), so any
# accidental hardware dependency fails to link.
sb_add_test(test_debounce        app/debounce.c)
sb_add_test(test_scheduler       app/scheduler.c)
sb_add_test(test_patterns_siren  app/patterns.c app/siren.c)
sb_add_test(test_pdm             app/pdm.c)
sb_add_test(test_power           app/power.c)
sb_add_test(test_arm             app/arm.c)
sb_add_test(test_tmp102          app/tmp102.c)
