/**
 * Testing Access Token API with mobile headers
 */
export {};

const username = process.argv[2];
if (!username) {
  console.error("Usage: tsx scripts/test_legacy.ts <username>");
  process.exit(1);
}
const response = await fetch(`https://api.twitch.tv/api/channels/${username}/access_token?client_id=kimne78kx3ncx6brs96pkfjt479f65`, {
  headers: {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  }
});

if (response.ok) {
  const data = await response.json();
  if (data.token) {
    console.log("true");
  } else {
    console.log("false");
  }
} else if (response.status === 404) {
  console.log("false");
} else {
  console.log("false");
}
