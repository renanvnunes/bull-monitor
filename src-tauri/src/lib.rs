use std::sync::Mutex;

use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Processo do sidecar Bun, guardado para ser encerrado junto com o app.
struct Sidecar(Mutex<Option<CommandChild>>);

/// Linha que o sidecar escreve no stdout quando o servidor HTTP está pronto.
const READY_PREFIX: &str = "BULL_MONITOR_READY ";

/// Barra de título própria, injetada em toda página carregada na janela.
const TITLEBAR_SCRIPT: &str = include_str!("../titlebar.js");

/// Exportação de conexões: pede ao usuário onde salvar e grava o JSON que a página mandou.
/// O diálogo é aberto daqui, e não pelo plugin no JavaScript, para as páginas do sidecar só
/// ganharem este comando. Devolve o caminho salvo, ou `None` se o usuário cancelar.
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<Option<String>, String> {
    // O diálogo bloqueante não pode rodar na thread principal.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Exportar conexões")
            .set_file_name(filename)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    write_private(&path, contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// O arquivo tem senhas; no Linux/macOS só o usuário consegue lê-lo.
fn write_private(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(0o600);
        // Sobrescrevendo um arquivo existente, o mode acima não vale; ajusta na mão.
        if path.exists() {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    std::io::Write::write_all(&mut options.open(path)?, contents)
}

/// Grava o cookie de acesso do sidecar direto na webview e devolve a URL sem o `?token=`.
///
/// Deixar o sidecar trocar o token pelo cookie (302 com Set-Cookie) às vezes falhava no WebKit: o
/// redirecionamento saía antes de o cookie ser guardado e a página abria com "Unauthorized". Se
/// gravar o cookie falhar, a URL volta intacta e o sidecar faz a troca como antes.
fn authorize(window: &tauri::WebviewWindow, mut url: Url) -> Url {
    let Some(token) = url
        .query_pairs()
        .find(|(name, _)| name == "token")
        .map(|(_, value)| value.into_owned())
    else {
        return url;
    };
    // Mesmos atributos do cookie que o sidecar define em sidecar/src/index.ts.
    let host = url.host_str().unwrap_or_default();
    let cookie = format!("bm_token={token}; Domain={host}; Path=/; HttpOnly; SameSite=Lax");
    match tauri::webview::Cookie::parse(cookie).map(|c| window.set_cookie(c)) {
        Ok(Ok(())) => {
            url.set_query(None);
            url
        }
        _ => {
            eprintln!("[bull-monitor] não foi possível gravar o cookie; usando o token na URL");
            url
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_export])
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            // Criada aqui e não no tauri.conf.json para receber o script da barra de título.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Bull Monitor")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 500.0)
                .decorations(false)
                // Transparente para os cantos arredondados (desenhados no titlebar.js) aparecerem.
                .transparent(true)
                // Sem sombra: no Windows/macOS a nativa apareceria em volta dos cantos arredondados.
                .shadow(false)
                .initialization_script(TITLEBAR_SCRIPT)
                .build()?;

            let config_dir = app.path().app_config_dir()?;
            let ui_dir = app.path().resource_dir()?.join("bull-board-ui");

            let (mut events, child) = app
                .shell()
                .sidecar("bull-monitor-sidecar")?
                .env("BULL_MONITOR_CONFIG_DIR", config_dir)
                .env("BULL_BOARD_UI_PATH", ui_dir)
                // Se o app cair sem encerrar o sidecar, o stdin fecha e ele sai sozinho.
                .env("BULL_MONITOR_EXIT_ON_STDIN_CLOSE", "1")
                .spawn()?;
            app.state::<Sidecar>().0.lock().unwrap().replace(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8_lossy(&line);
                            let Some(url) = line.trim().strip_prefix(READY_PREFIX) else {
                                continue;
                            };
                            // A porta é escolhida pelo sistema e o token muda a cada execução,
                            // então a janela só sabe para onde ir depois desta linha.
                            match (handle.get_webview_window("main"), Url::parse(url)) {
                                (Some(window), Ok(url)) => {
                                    let _ = window.navigate(authorize(&window, url));
                                }
                                _ => eprintln!("[bull-monitor] URL inválida do sidecar: {url}"),
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[bull-monitor] sidecar encerrou: {:?}", payload.code);
                            handle.exit(1);
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Bull Monitor")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
