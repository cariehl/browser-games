//! SignalBench simulation core.
//!
//! * [`model`]      - the plant: battery, PDM, CAN nodes, loads, arm physics
//! * [`protocol`]   - wire protocol to the firmware's `hal_sim.c`
//! * [`engine`]     - lock-step engine, pacing, watchdog, telemetry
//! * [`supervisor`] - launches / restarts the firmware process
//! * [`script`]     - scenario scripts for headless SIL tests (CI)

pub mod engine;
pub mod model;
pub mod protocol;
pub mod script;
pub mod supervisor;

pub use engine::{Command, Sim, SimHandle, Snapshot};
