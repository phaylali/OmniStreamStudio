const username = process.argv[2];
const response = await fetch(`https://www.twitch.tv/${username}`);
console.log("FINAL URL: " + response.url);
console.log("STATUS: " + response.status);
