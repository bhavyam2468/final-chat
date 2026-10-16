//! Loopback helpers: pick a free port, and ask an HTTP endpoint whether it is ready.
//!
//! Deliberately dependency-free: readiness probes are plain `GET` requests to 127.0.0.1 with a
//! short timeout, which is all a supervisor needs. Writing them by hand keeps reqwest/hyper out
//! of the dependency graph (and therefore out of the build time and the audit surface).

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

/// Ask the OS for an unused port by binding port 0 and letting go of it again.
///
/// The port is not reserved: another process could take it in the microseconds before the child
/// binds it. The supervisor treats that as a failed start and retries with a fresh port, so the
/// race is handled rather than assumed away.
pub fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Block until `127.0.0.1:port` accepts connections, or the deadline passes.
pub fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

/// True when something is listening on `127.0.0.1:port` right now.
pub fn port_in_use(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// One HTTP GET with a connection timeout. Returns `(status, body)` when the server answered.
pub fn http_get(url: &str, timeout: Duration) -> std::io::Result<(u16, String)> {
    let rest = url.strip_prefix("http://").unwrap_or(url);
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "bad port"))?),
        None => (authority.to_string(), 80),
    };
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nAccept: */*\r\nUser-Agent: minimalist-ai-desktop\r\n\r\n");
    stream.write_all(request.as_bytes())?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw)?;
    let text = String::from_utf8_lossy(&raw).to_string();
    let status = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "no HTTP status line"))?;
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Ok((status, body))
}

/// Poll `url` until it answers with `expect`. Returns false on timeout.
pub fn wait_for_http(url: &str, expect: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok((status, _)) = http_get(url, Duration::from_millis(1500)) {
            if status == expect {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

/// Ask the app server to stop itself (a request, then it exits by itself). Cross-platform, unlike
/// signals — this is what the shell uses before it escalates.
pub fn request_shutdown(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return false;
    };
    let body = r#"{"action":"stop"}"#;
    let request = format!(
        "POST /api/desktop HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.set_write_timeout(Some(Duration::from_millis(800))).ok();
    stream.write_all(request.as_bytes()).is_ok()
}
