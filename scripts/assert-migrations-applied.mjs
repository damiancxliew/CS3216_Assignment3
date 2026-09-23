// Reads `supabase migration list --output-format json` on stdin and fails when
// the database is missing a migration the repository has.
const input = await new Promise((resolve, reject) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => resolve(text));
  process.stdin.on("error", reject);
});

// The CLI prints progress lines before the JSON document.
const start = input.indexOf("{");
if (start === -1) {
  console.error("no JSON in `supabase migration list` output");
  process.exit(1);
}

const { migrations = [] } = JSON.parse(input.slice(start));
const pending = migrations.filter((m) => m.local && !m.remote).map((m) => m.local);

if (pending.length) {
  console.log(`::error::migrations missing from the database: ${pending.join(", ")}`);
  process.exit(1);
}

console.log(`database is up to date (${migrations.length} migrations)`);
