//! Release gate, using the same Minisign global-signature and version binding as the updater.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::{env, fs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: verify_app_artifact <package> <signature> <announced-version>".into());
    }
    if fs::metadata(&args[0])?.len() > 256 * 1024 * 1024 {
        return Err("update package exceeds application size limit".into());
    }
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))?;
    let decode = |s: &str| -> Result<String, Box<dyn std::error::Error>> {
        Ok(String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(s.trim())?,
        )?)
    };
    let key = PublicKey::decode(&decode(
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .ok_or("missing key")?,
    )?)?;
    let signature = Signature::decode(&decode(&fs::read_to_string(&args[1])?)?)?;
    key.verify(&fs::read(&args[0])?, &signature, true)?;
    let version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|s| s.strip_prefix("version:"));
    if version != Some(args[2].as_str()) {
        return Err("signed version does not match announced version".into());
    }
    println!("Verified package signature and version {}", args[2]);
    Ok(())
}
