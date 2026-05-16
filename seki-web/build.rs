use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=migrations");

    let Ok(entries) = fs::read_dir("migrations") else {
        return;
    };

    for entry in entries.flatten() {
        println!("cargo:rerun-if-changed={}", entry.path().display());
    }
}
