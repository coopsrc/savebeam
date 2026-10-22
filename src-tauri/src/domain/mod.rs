//! Core domain models and rules.
//!
//! This module stays independent from Tauri, child processes, databases, and
//! operating-system APIs.

pub mod component;
pub mod component_manifest;
pub mod download;
pub mod download_defaults;
pub mod error;
pub mod media;
pub mod network;
pub mod playlist_quality;
