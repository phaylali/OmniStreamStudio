import { config } from "dotenv";
config();

/**
 * Ultimate Twitch Status Checker (Strict Data Check)
 */
const username = process.argv[2];
if (!username) {
  process.stdout.write("false");
  process.exit(1);
}

async function checkScraperStatus(username: string): Promise<boolean> {
  try {
    const response = await fetch(`https://www.twitch.tv/${username.toLowerCase()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) return false;
    const text = await response.text();

    // 1. Strict Dynamic State (Most accurate)
    if (text.includes('"broadcast_type":"live"') || text.includes('"isLive":true')) {
      return true;
    }

    // 2. Stream Metadata Marker
    if (text.includes('"stream":{"__typename":"Stream"') || text.includes('"isLiveBroadcast":true')) {
      return true;
    }
    
    // 3. Player Video Metadata (The "True" source of truth in the shell)
    // Twitch often puts the current stream info in a JSON-LD or script tag
    if (text.includes('video.other') && text.includes(username.toLowerCase()) && text.includes('Streaming')) {
        return true;
    }

    // 4. Live Thumbnail in scripts
    // Even if redirected, the URL often appears in the source
    if (text.includes(`live_user_${username.toLowerCase()}-`)) {
        return true;
    }

    return false;
  } catch (err) {
    console.error(`Scraper error: ${err}`);
    return false;
  }
}

async function main() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;

  if (id && secret) {
     // Helix logic (same as before)
     const res = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" })
     });
     if (res.ok) {
        const { access_token } = await res.json() as any;
        const streams = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username.toLowerCase()}`, {
           headers: { "Client-Id": id, "Authorization": `Bearer ${access_token}` }
        });
        if (streams.ok) {
           const { data } = await streams.json() as any;
           process.stdout.write(data.length > 0 ? "true" : "false");
           return;
        }
     }
  }

  const isLive = await checkScraperStatus(username);
  process.stdout.write(isLive ? "true" : "false");
}

main().then(() => process.exit(0));

export { };
