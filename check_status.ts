const username = process.argv[2] || 'phaylali';
console.log(`\n🔍 Checking live status for channel: ${username}\n`);

async function checkTwitch() {
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{
        operationName: 'UseLive',
        variables: { channelLogin: username },
        query: 'query UseLive($channelLogin: String!) { user(login: $channelLogin) { stream { id type } } }'
      }])
    });
    const data = await res.json();
    const isLive = data[0]?.data?.user?.stream !== null;
    console.log(`🟪 Twitch: ${isLive ? '🔴 LIVE' : '⚫ OFFLINE'}`);
  } catch (e) {
    console.log(`🟪 Twitch: ❌ Failed to parse status`);
  }
}

async function checkKick() {
  try {
    const res = await fetch(`https://kick.com/api/v1/channels/${username}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.status === 403 || res.status === 503) {
      console.log(`🟩 Kick:   ⚠️ Cloudflare blocked the automated request.`);
      return;
    }
    const data = await res.json();
    const isLive = data?.livestream !== null && data?.livestream !== undefined;
    console.log(`🟩 Kick:   ${isLive ? '🔴 LIVE' : '⚫ OFFLINE'}`);
  } catch (e) {
    console.log(`🟩 Kick:   ❌ Failed to parse status (or channel not found)`);
  }
}

await Promise.all([checkTwitch(), checkKick()]);
