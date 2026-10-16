// No console window on Windows in release builds; the log file is the interface there.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    minimalist_ai_lib::run()
}
