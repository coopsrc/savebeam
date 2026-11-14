//! Tauri IPC adapters.
//!
//! Commands validate transport-level input and delegate application work to
//! services. Business rules do not belong in this layer.

pub mod components;
pub mod concurrency;
pub mod diagnostics;
pub mod downloads;
pub mod ipc;
pub mod media;
pub mod network;
pub mod records;
pub mod subscriptions;
pub mod versions;
