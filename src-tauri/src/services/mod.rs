//! Application workflows built from domain rules and infrastructure ports.
//!
//! Services coordinate use cases without depending on Tauri's IPC transport.

pub mod component_detector;
pub mod component_download;
pub mod component_paths;
pub mod component_probe;
pub mod download_registry;
pub mod download_verifier;
pub mod media_mapper;
