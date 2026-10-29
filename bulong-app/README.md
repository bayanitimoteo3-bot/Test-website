# Bulong – run it in VS Code

1. Install Node.js (version 18 or newer) from nodejs.org.
2. In VS Code: File > Open Folder > choose this `bulong-app` folder.
3. Open the terminal (Terminal > New Terminal) and run:
   ```
   npm install
   npm start
   ```
4. Open http://localhost:3000 in your browser.

For auto-restart while editing, use `npm run dev`.

Messages are saved in `data/messages.json` (created automatically). Delete that file to reset.

## Files
- `server.js`  – the backend (API, filters, rate limit, reports)
- `public/index.html` – the website (map, read, write)

## API
- GET  /api/messages?region=ncr   (use `all` for the "everyone" board)
- GET  /api/counts
- POST /api/messages   { text, region }
- POST /api/messages/:id/hug
- POST /api/messages/:id/report   (hidden after 3 reports)

## Before going public
- Expand BAD_WORDS in server.js (Filipino + English).
- Add a privacy policy and terms.
- The JSON file is for local use. For a real site, swap the storage for Supabase (free tier) and host the server (or Supabase Edge Functions).
