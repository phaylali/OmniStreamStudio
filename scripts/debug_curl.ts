import { spawnSync } from "child_process";

const username = process.argv[2];
const thumbUrl = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${username.toLowerCase()}-320x180.jpg`;

const result = spawnSync("curl", [
  "-sI", "-L", "-A", "Mozilla/5.0", thumbUrl
]);

console.log("CURL OUTPUT:");
console.log(result.stdout.toString());
