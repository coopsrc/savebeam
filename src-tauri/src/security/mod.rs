//! Shared security policies for paths, redaction, and external components.
//!
//! Keeping these policies explicit makes them reusable across commands,
//! services, and infrastructure adapters.

pub mod download_args;
pub mod network_proxy;
pub mod redaction;
