//! Tauri IPC adapters.
//!
//! Commands validate transport-level input and delegate application work to
//! services. Business rules do not belong in this layer.

pub mod components;
pub mod ipc;
pub mod media;
