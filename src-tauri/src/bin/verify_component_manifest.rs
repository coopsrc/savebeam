use std::{env, fs::File, io::BufReader};

use savebeam_lib::{
    domain::component_manifest::ComponentManifest,
    services::component_catalog::COMPONENT_MANIFEST_PUBLIC_KEY,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args_os()
        .nth(1)
        .ok_or("usage: verify_component_manifest <signed-components.json>")?;
    let manifest: ComponentManifest = serde_json::from_reader(BufReader::new(File::open(path)?))?;
    manifest.verify(&COMPONENT_MANIFEST_PUBLIC_KEY)?;
    Ok(())
}
