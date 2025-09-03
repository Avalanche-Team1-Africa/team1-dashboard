// Static dashboard that fetches stats.json and renders tables.
// Default is local ./stats.json (published to gh-pages by the workflow).
const DEFAULT_URL = "./stats.json";

function qs(name) {
  const p = new URLSearchParams(location.search);
  return p.get(name);
}

async function load() {
  const url = qs("stats") || DEFAULT_URL;
  document.getElementById("stats-url").textContent = url;

  let data;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    data = await r.json();
  } catch (e) {
    document.getElementById("meta").textContent = "Failed to load stats: " + e.message;
    return;
  }

  document.getElementById("meta").textContent =
    `Org: ${data.org} • Window: last ${data.window_days} days • Generated: ${new Date(data.generated_at).toLocaleString()}`;

  renderTable(
    document.getElementById("top-repos"),
    ["#", "Repo", "Commits"],
    (data.leaderboards?.top_repos_30d || []).map((x, i) => [i + 1, x.repo, x.commits])
  );

  renderTable(
    document.getElementById("top-contrib"),
    ["#", "Contributor", "Commits"],
    (data.leaderboards?.top_contributors_30d || []).map((x, i) => [i + 1, x.login, x.commits])
  );

  const set = new Set();
  (data.repos || []).forEach(r => r.track && set.add(r.track));
  const trackSel = document.getElementById("track");
  const tracks = ["All", ...Array.from(set).sort()];
  tracks.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    trackSel.appendChild(opt);
  });

  const minInput = document.getElementById("min-commits");

  function applyFilters() {
    const track = trackSel.value;
    const min = parseInt(minInput.value || "0", 10);
    const rows = (data.repos || [])
      .filter(r => (track === "All" ? true : r.track === track))
      .filter(r => (r.commits_count || 0) >= min)
      .sort((a,b) => (b.commits_count || 0) - (a.commits_count || 0))
      .map(r => [
        r.name,
        r.track || "-",
        r.commits_count || 0,
        (r.contributors || []).slice(0,3).map(c => `${c.login}(${c.commits})`).join(", ") || "-",
        r.last_commit_at ? new Date(r.last_commit_at).toLocaleString() : "-",
      ]);
    renderTable(
      document.getElementById("repos"),
      ["Repo", "Track", "Commits", "Top Contributors", "Last Commit"],
      rows
    );
  }

  trackSel.addEventListener("change", applyFilters);
  minInput.addEventListener("input", applyFilters);
  applyFilters();
}

function renderTable(el, headers, rows) {
  const thead = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>";
  const tbody = "<tbody>" + rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
  el.innerHTML = thead + tbody;
}

load();
