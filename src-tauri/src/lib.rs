mod lottery;

use lottery::generate_tickets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![generate_tickets])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
