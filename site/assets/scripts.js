// Dynamic dashboard that fetches GitHub data directly
// If GitHub token is available, it will use that for higher rate limits
// Otherwise it falls back to unauthenticated requests (60/hour limit)

// Helper function to get query string parameters
function qs(name) {
  const p = new URLSearchParams(location.search);
  return p.get(name);
}

// Format numbers for better readability
function formatNumber(num) {
  return num.toLocaleString();
}

// Format dates for better readability
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  
  // Check if it's a valid date
  if (isNaN(date.getTime())) return dateStr;
  
  const now = new Date();
  const diff = now - date;
  const day = 24 * 60 * 60 * 1000;
  
  // If less than 1 day ago, show relative time
  if (diff < day) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return hours === 0 ? 'Just now' : `${hours}h ago`;
  }
  
  // If less than 7 days ago, show days ago
  if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return `${days}d ago`;
  }
  
  // Otherwise show date
  return date.toLocaleDateString();
}

// Main loading function
async function load() {
  const org = qs("org") || "Avalanche-Team1-Africa";
  const windowDays = parseInt(qs("days") || "30", 10);
  
  document.getElementById("stats-url").textContent = `https://api.github.com/orgs/${org}/repos`;
  document.getElementById("status-indicator").textContent = "Loading data from GitHub API...";
  document.getElementById("status-indicator").style.color = "#5e9dff";
  
  // Calculate dates for filtering commits
  const now = new Date();
  const since = new Date(now);
  since.setDate(now.getDate() - windowDays);
  const sinceISO = since.toISOString();
  
  // Object to store all our collected data
  const data = {
    org: org,
    generated_at: now.toISOString(),
    window_days: windowDays,
    repos: [],
    leaderboards: {
      top_repos_30d: [],
      top_contributors_30d: []
    }
  };
  
  try {
    // Step 1: Fetch repos from the organization
    const repos = await fetchAllRepos(org);
    const activeRepos = repos.filter(r => !r.archived && !r.disabled && !r.fork);
    
    document.getElementById("status-indicator").textContent = `Found ${activeRepos.length} repositories, fetching activity...`;
    
    // Step 2: Fetch commits for each repo within the time window
    const repoPromises = activeRepos.map(repo => fetchRepoActivity(repo, sinceISO));
    data.repos = await Promise.all(repoPromises);
    
    // Step 3: Calculate leaderboards
    calculateLeaderboards(data);
    
    document.getElementById("status-indicator").textContent = "Data loaded successfully";
    document.getElementById("status-indicator").style.color = "#4CAF50";
  } catch (e) {
    document.getElementById("meta").textContent = "Failed to load data: " + e.message;
    document.getElementById("status-indicator").textContent = "Error loading data";
    document.getElementById("status-indicator").style.color = "#F44336";
    console.error(e);
    return;
  }

  document.getElementById("meta").textContent =
    `Org: ${data.org} • Window: last ${data.window_days} days • Generated: ${new Date(data.generated_at).toLocaleString()}`;
  
  document.getElementById("update-time").textContent = new Date(data.generated_at).toLocaleString();

  // Render top repositories table
  renderTable(
    document.getElementById("top-repos"),
    ["#", "Repository", "Commits"],
    (data.leaderboards?.top_repos_30d || []).map((x, i) => [
      i + 1, 
      `<a href="https://github.com/${data.org}/${x.repo}" target="_blank">${x.repo}</a>`, 
      formatNumber(x.commits)
    ])
  );

  // Render top contributors table
  renderTable(
    document.getElementById("top-contrib"),
    ["#", "Contributor", "Commits"],
    (data.leaderboards?.top_contributors_30d || []).map((x, i) => [
      i + 1, 
      `<a href="https://github.com/${x.login}" target="_blank">${x.login}</a>`, 
      formatNumber(x.commits)
    ])
  );

  // Set up track filter
  const set = new Set();
  (data.repos || []).forEach(r => r.track && set.add(r.track));
  const trackSel = document.getElementById("track");
  trackSel.innerHTML = ''; // Clear any existing options
  const tracks = ["All", ...Array.from(set).sort()];
  tracks.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; 
    opt.textContent = t;
    trackSel.appendChild(opt);
  });

  const minInput = document.getElementById("min-commits");

  // Filter function for repo activity
  function applyFilters() {
    const track = trackSel.value;
    const min = parseInt(minInput.value || "0", 10);
    
    // Filter and sort repos
    const filteredRepos = (data.repos || [])
      .filter(r => (track === "All" ? true : r.track === track))
      .filter(r => (r.commits_count || 0) >= min)
      .sort((a,b) => (b.commits_count || 0) - (a.commits_count || 0));
    
    // Update filter count
    document.getElementById("filter-count").textContent = 
      `Showing ${filteredRepos.length} of ${data.repos?.length || 0} repositories`;
    
    // Format for table display
    const rows = filteredRepos.map(r => [
      `<a href="https://github.com/${data.org}/${r.name}" target="_blank">${r.name}</a>` + 
      (r.isPrivate ? ' <span class="private-badge" title="Private Repository">🔒</span>' : ''),
      r.track || "-",
      formatNumber(r.commits_count || 0),
      (r.contributors || []).slice(0,3).map(c => 
        `<a href="https://github.com/${c.login}" target="_blank">${c.login}</a> (${c.commits})`
      ).join(", ") || "-",
      formatDate(r.last_commit_at),
    ]);
    
    renderTable(
      document.getElementById("repos"),
      ["Repository", "Track", "Commits", "Top Contributors", "Last Commit"],
      rows
    );
  }

  // Set up event listeners
  trackSel.addEventListener("change", applyFilters);
  minInput.addEventListener("input", applyFilters);
  
  // Initial filter application
  applyFilters();
}

// GitHub API helper functions
async function fetchAllRepos(org) {
  const repos = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const response = await fetch(`https://api.github.com/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`);
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const pageRepos = await response.json();
    if (pageRepos.length === 0) {
      hasMore = false;
    } else {
      repos.push(...pageRepos);
      page++;
    }
    
    // Check if we've hit the end based on Link header
    const linkHeader = response.headers.get('Link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      hasMore = false;
    }
  }
  
  return repos;
}

async function fetchRepoActivity(repo, sinceISO) {
  const repoInfo = {
    name: repo.name,
    full: repo.full_name,
    topics: repo.topics || [],
    track: inferTrackFromTopics(repo),
    commits_count: 0,
    contributors: [],
    last_commit_at: repo.pushed_at
  };
  
  try {
    // Fetch commits since the cutoff date
    const commitsUrl = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/commits?since=${sinceISO}&per_page=100`;
    const response = await fetch(commitsUrl);
    
    if (!response.ok) {
      // Handle empty repos or other issues
      if (response.status === 409) {
        console.warn(`Repository ${repo.name} has no commits yet`);
        return repoInfo;
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const commits = await response.json();
    const byAuthor = new Map();
    let lastCommitAt = null;
    
    commits.forEach(commit => {
      const author = commit.author?.login || commit.commit?.author?.name || "unknown";
      byAuthor.set(author, (byAuthor.get(author) || 0) + 1);
      
      const commitDate = commit.commit?.author?.date;
      if (commitDate && (!lastCommitAt || commitDate > lastCommitAt)) {
        lastCommitAt = commitDate;
      }
    });
    
    // Update repo info
    repoInfo.commits_count = commits.length;
    repoInfo.last_commit_at = lastCommitAt || repo.pushed_at;
    repoInfo.contributors = [...byAuthor.entries()]
      .map(([login, commits]) => ({ login, commits }))
      .sort((a, b) => b.commits - a.commits);
      
  } catch (e) {
    console.error(`Error fetching commits for ${repo.name}:`, e);
  }
  
  return repoInfo;
}

function inferTrackFromTopics(repo) {
  const topics = repo.topics || [];
  
  // First check for track-* topics
  for (const topic of topics) {
    if (topic.startsWith('track-')) {
      return topic.replace('track-', '');
    }
  }
  
  // Simple heuristics based on repo name/description
  const name = repo.name.toLowerCase();
  const description = (repo.description || '').toLowerCase();
  
  if (name.includes('frontend') || name.includes('ui') || name.includes('web') || 
      description.includes('frontend') || description.includes('ui') || description.includes('web interface')) {
    return 'frontend';
  }
  
  if (name.includes('backend') || name.includes('api') || name.includes('server') ||
      description.includes('backend') || description.includes('api') || description.includes('server')) {
    return 'backend';
  }
  
  if (name.includes('blockchain') || name.includes('smart-contract') || name.includes('web3') ||
      description.includes('blockchain') || description.includes('smart contract') || description.includes('web3')) {
    return 'blockchain';
  }
  
  if (name.includes('data') || name.includes('analytics') ||
      description.includes('data') || description.includes('analytics')) {
    return 'data';
  }
  
  // Default track
  return 'other';
}

function calculateLeaderboards(data) {
  // Calculate top repos
  const repoMap = new Map();
  data.repos.forEach(repo => {
    repoMap.set(repo.name, repo.commits_count || 0);
  });
  
  data.leaderboards.top_repos_30d = [...repoMap.entries()]
    .map(([repo, commits]) => ({ repo, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 10);
  
  // Calculate top contributors
  const contributorMap = new Map();
  data.repos.forEach(repo => {
    (repo.contributors || []).forEach(c => {
      contributorMap.set(c.login, (contributorMap.get(c.login) || 0) + c.commits);
    });
  });
  
  data.leaderboards.top_contributors_30d = [...contributorMap.entries()]
    .map(([login, commits]) => ({ login, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 15);
}

// Table rendering function
function renderTable(el, headers, rows) {
  const thead = "<thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead>";
  const tbody = "<tbody>" + rows.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
  el.innerHTML = thead + tbody;
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
  load();
});
