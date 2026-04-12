/**
 * Final Twitch Status Scraper
 */
const username = process.argv[2];
if (!username) {
  console.log("false");
  process.exit(1);
}

async function checkStatus(user) {
  try {
    const response = await fetch(`https://www.twitch.tv/${user}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });

    if (!response.ok) return false;
    const html = await response.text();

    // Multiple markers for live state
    const isLive = html.includes('"isLive":true') ||
      html.includes('"type":"live"') ||
      html.includes('isLiveBroadcast":true') ||
      html.includes('id="live-channel-status-indicator"') ||
      html.includes('viewerCount');

    return isLive;
  } catch (e) {
    return false;
  }
}

const isLive = await checkStatus(username);
process.stdout.write(isLive ? "true" : "false");
process.exit(0);

export { };
