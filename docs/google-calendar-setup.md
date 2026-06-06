# Connecting Google Calendar to Memosa

Memosa can auto-record your meetings by reading your Google Calendar. It uses
**read-only** access, runs the OAuth flow entirely on your Mac, and stores the
token in the macOS Keychain — your events never touch a Memosa server.

To connect, you need a free Google Cloud **OAuth client ID** (one-time setup,
~5 minutes). Under the PKCE desktop flow Memosa uses, the client ID is **not a
secret**, so it's safe to paste into the app.

## Steps

1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Create a project (e.g. "Memosa") or select an existing one.
3. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
4. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name + your email. You can leave it in **Testing** mode and add
     your own Google account under **Test users** (no Google verification needed
     for personal use).
   - Add the scope `.../auth/calendar.readonly` (optional at this stage; Memosa
     requests it during sign-in).
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Name it anything.
   - Create, then copy the **Client ID** (you do **not** need the client secret).
6. In Memosa: **Settings → Calendar**, paste the Client ID, click **Connect
   Google**, and approve the read-only access in the browser window that opens.
7. Toggle **Auto-record meetings** on. Memosa will warn you ~2 minutes before a
   meeting and start recording automatically when it begins.

## Notes

- The OAuth redirect uses a temporary local listener at
  `http://localhost:8899/callback`. If your Google client requires an explicit
  redirect URI, add exactly that value.
- Only your **primary** calendar is read for now.
- All-day events are ignored for auto-record.
- Disconnect any time from **Settings → Calendar → Disconnect**, which clears the
  token from the Keychain.
