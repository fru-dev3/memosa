use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

pub const REDIRECT_URI: &str = "http://localhost:8899/callback";

pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
}

pub fn generate_pkce() -> PkceChallenge {
    let verifier: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    PkceChallenge {
        verifier,
        challenge,
    }
}

pub fn build_auth_url(client_id: &str, pkce: &PkceChallenge) -> String {
    // REDIRECT_URI = "http://localhost:8899/callback"
    // percent-encoded: "http%3A%2F%2Flocalhost%3A8899%2Fcallback"
    let encoded_redirect = percent_encode(REDIRECT_URI);
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={}\
         &redirect_uri={}\
         &response_type=code\
         &scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly\
         &code_challenge={}\
         &code_challenge_method=S256\
         &access_type=offline\
         &prompt=consent",
        client_id, encoded_redirect, pkce.challenge,
    )
}

/// Percent-encode a string for use as a URL query parameter value.
fn percent_encode(input: &str) -> String {
    let mut output = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        match byte {
            // Unreserved characters per RFC 3986 — pass through unchanged
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char);
            }
            other => {
                output.push('%');
                output.push(
                    char::from_digit((other >> 4) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
                output.push(
                    char::from_digit((other & 0xf) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
            }
        }
    }
    output
}

/// Bind to 127.0.0.1:8899, wait for a single GET /callback?code=... request,
/// extract the code, send a success HTML page, then return the code.
/// This is a blocking operation — call it inside `tokio::task::spawn_blocking`.
pub fn start_local_callback_server_blocking() -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:8899")
        .map_err(|e| format!("Failed to bind to port 8899: {}", e))?;

    // Accept one connection
    let (stream, _) = listener
        .accept()
        .map_err(|e| format!("Failed to accept connection: {}", e))?;

    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| format!("Failed to read request: {}", e))?;

    // request_line looks like: GET /callback?code=XXXX&... HTTP/1.1
    let code = extract_code_from_request_line(&request_line)
        .ok_or_else(|| "No code found in OAuth callback".to_string())?;

    let html = "<html><body>\
        <h2>Authentication successful!</h2>\
        <p>You can close this tab and return to Memosa.</p>\
        </body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let mut writer = &stream;
    writer
        .write_all(response.as_bytes())
        .map_err(|e| format!("Failed to write response: {}", e))?;

    Ok(code)
}

fn extract_code_from_request_line(request_line: &str) -> Option<String> {
    // GET /callback?code=XXXX&... HTTP/1.1
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "code" {
                return Some(v.to_string());
            }
        }
    }
    None
}

#[derive(Deserialize, Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    #[allow(dead_code)]
    pub token_type: String,
}

/// Exchange authorization code for tokens.
pub async fn exchange_code(
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", REDIRECT_URI),
    ];
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed ({}): {}", status, body));
    }

    res.json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

/// Refresh an expired access token.
pub async fn refresh_access_token(
    client_id: &str,
    refresh_tok: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id),
        ("refresh_token", refresh_tok),
        ("grant_type", "refresh_token"),
    ];
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed ({}): {}", status, body));
    }

    res.json::<TokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))
}
