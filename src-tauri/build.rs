fn main() {
    // Gera a permissão allow-save-export, liberada para as páginas do sidecar em capabilities/.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["save_export"])),
    )
    .expect("erro ao gerar o contexto do Tauri");
}
