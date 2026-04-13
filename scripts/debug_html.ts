export {};

const user = process.argv[2];
if (!user) {
  console.error("Usage: tsx scripts/debug_html.ts <username>");
  process.exit(1);
}

const res = await fetch(`https://www.twitch.tv/${user}`, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
});

if (!res.ok) {
  console.error(`HTTP error: ${res.status}`);
  process.exit(1);
}

const text = await res.text();
console.log(text.substring(0, 1000));
console.log("Includes isLive: " + text.includes('"isLive":true'));
