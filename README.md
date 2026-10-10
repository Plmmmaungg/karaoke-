# Karaoke Remote

A starter karaoke web app: one host plays YouTube videos, while multiple phones join with a room code and queue songs.

## Requirements
- Node.js 20 or newer
- A RapidAPI subscription/API that searches YouTube videos
- The API's endpoint URL, host, and key

## Setup (Windows / VS Code)

1. Extract the ZIP and open the `karaoke-remote` folder in VS Code.
2. Open the terminal (`Terminal > New Terminal`).
3. Run:

   ```bash
   npm run install:all
   ```

4. Copy `server/.env.example` to `server/.env`.
5. Fill in your RapidAPI values (details below).
6. Run:

   ```bash
   npm run dev
   ```

7. Open the frontend URL printed by Vite, usually `http://localhost:5173`.
8. Click **Create host room**. On another phone connected to the same Wi-Fi, open `http://YOUR-COMPUTER-LAN-IP:5173`, enter the room code, and join.
   - To find your computer LAN IP on Windows, run `ipconfig` and use the IPv4 address.
   - The phone and computer must be on the same Wi-Fi for local testing.
   - To use different networks, deploy the app/server to a public host and use HTTPS.

## Configure RapidAPI

RapidAPI providers use different endpoint URLs and response formats. This project deliberately does not assume a made-up endpoint.

In `server/.env`, set:

```env
RAPIDAPI_KEY=your_rapidapi_key
RAPIDAPI_HOST=the-api-host-from-rapidapi
RAPIDAPI_SEARCH_URL=https://provider.example/search?query={query}
RAPIDAPI_METHOD=GET
RAPIDAPI_QUERY_PARAM=query
```

Replace the URL with the actual search endpoint from your RapidAPI provider's **Endpoints** page. If the endpoint expects a different query parameter, set `RAPIDAPI_QUERY_PARAM` accordingly. If the provider requires extra query parameters, add them to the URL. The `{query}` placeholder is URL-encoded before the request is sent.

The server sends `X-RapidAPI-Key` and `X-RapidAPI-Host` headers. It attempts to normalize common response shapes (`items`, `results`, `videos`, `data`, etc.). If your provider has a unique response format, edit `normalizeResults()` in `server/index.js`.

**Never put your RapidAPI key in `client/` code or commit `server/.env` to GitHub.**

## How it works
- Host creates a room and receives a random room code.
- Guests join with the code and a nickname.
- Search results are returned through the server's RapidAPI adapter.
- Guests add songs to the shared queue; this does not load a video or change the host player.
- Host playback changes only when the host clicks Next or the current YouTube video ends.
- The server keeps room state in memory. Restarting the server clears rooms and queues.

## YouTube limitations
- Some videos block embedding or may be unavailable in a region.
- Browsers can block autoplay; the host may need to click Play once.
- The YouTube embedded player and its branding/controls must remain compliant with YouTube requirements.
- The site does not download videos or remove ads.
