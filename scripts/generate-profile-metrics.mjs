import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_REPOSITORY_OWNER || "akshat12345212";

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const query = `
  query ProfileMetrics($login: String!) {
    user(login: $login) {
      followers { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        totalCount
        nodes {
          stargazerCount
          forkCount
          languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "akshat-profile-metrics",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status}`);
}

const payload = await response.json();
if (payload.errors) {
  throw new Error(payload.errors.map((error) => error.message).join("; "));
}

const user = payload.data.user;
const repos = user.repositories.nodes;
const calendar = user.contributionsCollection.contributionCalendar;
const days = calendar.weeks.flatMap((week) => week.contributionDays);

const stars = repos.reduce((sum, repo) => sum + repo.stargazerCount, 0);
const forks = repos.reduce((sum, repo) => sum + repo.forkCount, 0);
const languageTotals = new Map();

for (const repo of repos) {
  for (const edge of repo.languages.edges) {
    const current = languageTotals.get(edge.node.name) || { size: 0, color: edge.node.color || "#8B5CF6" };
    current.size += edge.size;
    languageTotals.set(edge.node.name, current);
  }
}

const languages = [...languageTotals.entries()]
  .map(([name, value]) => ({ name, ...value }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 6);
const languageSize = languages.reduce((sum, language) => sum + language.size, 0) || 1;

function streaks(contributionDays) {
  let current = 0;
  let longest = 0;
  let running = 0;

  for (const day of contributionDays) {
    if (day.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  for (let index = contributionDays.length - 1; index >= 0; index -= 1) {
    const day = contributionDays[index];
    const isToday = day.date === new Date().toISOString().slice(0, 10);
    if (day.contributionCount > 0) {
      current += 1;
    } else if (!isToday) {
      break;
    }
  }

  return { current, longest };
}

const { current, longest } = streaks(days);
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const card = (x, label, value, accent) => `
  <g transform="translate(${x} 58)">
    <rect width="248" height="112" rx="16" fill="#0B1020" stroke="#1E293B"/>
    <rect width="4" height="112" rx="2" fill="${accent}"/>
    <text x="24" y="40" fill="#64748B" font-size="14" letter-spacing="1.4">${label}</text>
    <text x="24" y="82" fill="#E2E8F0" font-size="32" font-weight="700">${value}</text>
  </g>`;

const languageRows = languages.map((language, index) => {
  const percent = language.size / languageSize;
  const y = 242 + index * 38;
  const width = Math.max(8, Math.round(percent * 360));
  return `
    <text x="70" y="${y}" fill="#CBD5E1" font-size="14">${escapeXml(language.name)}</text>
    <rect x="190" y="${y - 13}" width="360" height="10" rx="5" fill="#172033"/>
    <rect x="190" y="${y - 13}" width="${width}" height="10" rx="5" fill="${language.color}">
      <animate attributeName="width" from="0" to="${width}" dur="1.2s" fill="freeze"/>
    </rect>
    <text x="565" y="${y}" fill="#64748B" font-size="13">${Math.round(percent * 100)}%</text>`;
}).join("");

const maxCount = Math.max(...days.map((day) => day.contributionCount), 1);
const heatCells = calendar.weeks.map((week, weekIndex) => week.contributionDays.map((day, dayIndex) => {
  const intensity = day.contributionCount === 0 ? 0 : Math.max(1, Math.ceil((day.contributionCount / maxCount) * 4));
  const colors = ["#111827", "#164E63", "#0E7490", "#0891B2", "#22D3EE"];
  const x = 658 + weekIndex * 9;
  const y = 239 + dayIndex * 17;
  return `<rect x="${x}" y="${y}" width="7" height="13" rx="2" fill="${colors[intensity]}"><title>${day.date}: ${day.contributionCount} contributions</title></rect>`;
}).join("")).join("");

const generatedDate = new Date().toISOString().slice(0, 10);
const svg = `<svg width="1200" height="470" viewBox="0 0 1200 470" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1200" y2="470" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22D3EE"/><stop offset="0.52" stop-color="#8B5CF6"/><stop offset="1" stop-color="#EC4899"/>
    </linearGradient>
  </defs>
  <style>text{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}</style>
  <rect x="1" y="1" width="1198" height="468" rx="24" fill="#080B14" stroke="url(#edge)" stroke-width="2"/>
  <text x="48" y="35" fill="#94A3B8" font-size="15" letter-spacing="2">LIVE GITHUB SIGNAL</text>
  <circle cx="1138" cy="30" r="5" fill="#34D399"><animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite"/></circle>
  <text x="1125" y="35" text-anchor="end" fill="#64748B" font-size="12">updated ${generatedDate}</text>
  ${card(48, "PUBLIC REPOS", user.repositories.totalCount, "#22D3EE")}
  ${card(322, "STARS EARNED", stars, "#8B5CF6")}
  ${card(596, "CONTRIBUTIONS", calendar.totalContributions, "#EC4899")}
  ${card(870, "CURRENT STREAK", `${current} days`, "#34D399")}
  <text x="48" y="208" fill="#94A3B8" font-size="15" letter-spacing="1.6">MOST USED LANGUAGES</text>
  ${languageRows}
  <text x="636" y="208" fill="#94A3B8" font-size="15" letter-spacing="1.6">CONTRIBUTION CALENDAR</text>
  ${heatCells}
  <text x="636" y="390" fill="#64748B" font-size="13">${calendar.totalContributions} contributions · longest streak ${longest} days · ${user.followers.totalCount} followers · ${forks} forks</text>
</svg>`;

await mkdir("assets", { recursive: true });
await writeFile("assets/live-metrics.svg", svg, "utf8");
console.log(`Generated assets/live-metrics.svg for ${login}`);
