//! Adapters for processes, persistence, and platform-specific capabilities.
//!
//! Infrastructure implements the external boundaries required by services;
//! it must not define product policy.

pub mod process_supervisor;
pub mod ytdlp_process;
