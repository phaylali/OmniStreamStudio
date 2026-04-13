/**
 * Debugging Twitch Status (User Client-ID)
 */
export {};

const username = process.argv[2];
if (!username) {
  console.error("Usage: tsx scripts/debug_status.ts <username>");
  process.exit(1);
}

const clientId = "jdilcqcoxfz0a6tslf4xrikthvjfxs";

async function debugStatus(user: string) {
  const gqlQuery = [{
    operationName: "ChannelShell",
    variables: { login: user.toLowerCase() },
    query: "query ChannelShell($login: String!) { user(login: $login) { stream { id type } } }"
  }];

  const response = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(gqlQuery)
  });

  if (response.ok) {
    const data = await response.json();
    console.log(JSON.stringify(data));
  } else {
    const text = await response.text();
    console.log("Error: " + response.status + " " + text);
  }
}

await debugStatus(username);
