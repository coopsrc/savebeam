use std::{
    env,
    fs::File,
    io::{self, BufReader, Write},
};

use savebeam_lib::domain::component_manifest::ComponentManifest;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args_os()
        .nth(1)
        .ok_or("usage: component_manifest_payload <unsigned-components.json>")?;
    let manifest: ComponentManifest = serde_json::from_reader(BufReader::new(File::open(path)?))?;
    if !manifest.signature.is_empty() {
        return Err("input must have an empty signature field".into());
    }
    manifest.validate()?;
    io::stdout().write_all(&manifest.signed_payload()?)?;
    Ok(())
}
