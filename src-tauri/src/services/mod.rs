//! Application workflows built from domain rules and infrastructure ports.
//!
//! Services coordinate use cases without depending on Tauri's IPC transport.

pub mod component_archive;
pub mod component_catalog;
pub mod component_detector;
pub mod component_download;
pub mod component_install_flow;
pub mod component_install_registry;
pub mod component_installer;
pub mod component_paths;
pub mod component_probe;
pub mod download_defaults;
pub mod download_registry;
pub mod download_verifier;
pub mod history_deletion;
pub mod intermediate_files;
pub mod media_mapper;
pub mod network_connection_test;
pub mod network_preferences;
pub mod playlist_quality;
pub mod playlist_size;
pub mod subscriptions;
pub mod thumbnail_preview;
