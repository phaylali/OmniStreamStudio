const user = process.argv[2];
const res = await fetch(`https://www.twitch.tv/${user}`, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  }
});
const text = await res.text();
console.log(text.substring(0, 1000));
console.log("Includes isLive: " + text.includes('"isLive":true'));
