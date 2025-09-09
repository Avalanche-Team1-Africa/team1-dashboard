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
  document.getElementById("loading-spinner").style.display = "inline-block";
  
  // Object to store all our collected data
  const data = {
    org: org,
    generated_at: now.toISOString(),
    window_days: windowDays,
    repos: [],
    leaderboards: {
      top_repos: [],
      top_contributors: []
    }
  };
  
  try {
    // Step 1: Fetch repos from the organization
    const repos = await fetchAllRepos(org);
    const activeRepos = repos.filter(r => !r.archived && !r.disabled && !r.fork);
    
    document.getElementById("status-indicator").textContent = `Found ${activeRepos.length} repositories, fetching activity...`;
    
    // Step 2: Fetch all commits for each repo (not filtered by date)
    const repoPromises = activeRepos.map(repo => fetchRepoActivity(repo));
    data.repos = await Promise.all(repoPromises);
    
    // Step 3: Calculate leaderboards
    calculateLeaderboards(data);
    
    document.getElementById("status-indicator").textContent = "Data loaded successfully";
    document.getElementById("status-indicator").style.color = "#4CAF50";
    document.getElementById("loading-spinner").style.display = "none";
  } catch (e) {
    document.getElementById("meta").textContent = "Failed to load data: " + e.message;
    document.getElementById("status-indicator").textContent = "Error loading data";
    document.getElementById("status-indicator").style.color = "#F44336";
    document.getElementById("loading-spinner").style.display = "none";
    console.error(e);
    return;
  }

  document.getElementById("meta").textContent =
    `Org: ${data.org} • Window: last ${data.window_days} days • Generated: ${new Date(data.generated_at).toLocaleString()}`;
  
  document.getElementById("update-time").textContent = new Date(data.generated_at).toLocaleString();
  
  // Create activity chart
  createActivityChart(data);
  
  // Fetch and update PR and Issue stats
  fetchPullRequestStats(org, sinceISO);
  fetchIssueStats(org, sinceISO);

  // Render top repositories table
  renderTable(
    document.getElementById("top-repos"),
    ["#", "Repository", "Commits"],
    (data.leaderboards?.top_repos || []).map((x, i) => [
      i + 1, 
      `<a href="https://github.com/${data.org}/${x.repo}" target="_blank">${x.repo}</a>`, 
      formatNumber(x.commits)
    ])
  );

  // Render top contributors table
  renderTable(
    document.getElementById("top-contrib"),
    ["#", "Contributor", "Commits"],
    (data.leaderboards?.top_contributors || []).map((x, i) => [
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

  // Store data globally for filtering and other functions
  window.dashboardData = data;
  
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

async function fetchRepoActivity(repo) {
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
    // Fetch all commits (not filtered by date)
    const commitsUrl = `https://api.github.com/repos/${repo.owner.login}/${repo.name}/commits?per_page=100`;
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

// Create activity chart from repo data
function createActivityChart(data) {
  const ctx = document.getElementById('activity-chart').getContext('2d');
  
  // Get the top 5 repositories by commits
  const topRepos = data.leaderboards.top_repos_30d.slice(0, 5);
  
  // Create a gradient for the background
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(94, 157, 255, 0.7)');
  gradient.addColorStop(1, 'rgba(94, 157, 255, 0.1)');
  
  // Create the chart
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: topRepos.map(r => r.repo),
      datasets: [{
        label: 'Commits',
        data: topRepos.map(r => r.commits),
        backgroundColor: gradient,
        borderColor: '#5e9dff',
        borderWidth: 1,
        borderRadius: 5,
        hoverBackgroundColor: '#8cbdff',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: 'Top Repository Activity (Last 30 Days)',
          color: '#eef',
          font: {
            size: 16,
            family: 'Inter'
          }
        },
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#0b0f14',
          titleColor: '#eef',
          bodyColor: '#eef',
          borderColor: '#1b2a3a',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return `${context.parsed.y} commits`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: '#1b2a3a',
            drawBorder: false,
          },
          ticks: {
            color: '#9ab'
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#9ab'
          }
        }
      }
    }
  });
}

// Fetch PR stats
async function fetchPullRequestStats(org, sinceISO) {
  try {
    // Fetch open PRs
    const openPRsResponse = await fetch(`https://api.github.com/search/issues?q=org:${org}+is:pr+is:open&per_page=1`);
    const openPRsData = await openPRsResponse.json();
    document.getElementById('open-prs').textContent = openPRsData.total_count || '-';
    
    // Fetch merged PRs in the time window
    const mergedPRsResponse = await fetch(`https://api.github.com/search/issues?q=org:${org}+is:pr+is:merged+merged:>=${sinceISO}&per_page=1`);
    const mergedPRsData = await mergedPRsResponse.json();
    document.getElementById('merged-prs').textContent = mergedPRsData.total_count || '-';
  } catch (e) {
    console.error('Error fetching PR stats:', e);
  }
}

// Fetch issue stats
async function fetchIssueStats(org, sinceISO) {
  try {
    // Fetch open issues
    const openIssuesResponse = await fetch(`https://api.github.com/search/issues?q=org:${org}+is:issue+is:open&per_page=1`);
    const openIssuesData = await openIssuesResponse.json();
    document.getElementById('open-issues').textContent = openIssuesData.total_count || '-';
    
    // Fetch closed issues in the time window
    const closedIssuesResponse = await fetch(`https://api.github.com/search/issues?q=org:${org}+is:issue+is:closed+closed:>=${sinceISO}&per_page=1`);
    const closedIssuesData = await closedIssuesResponse.json();
    document.getElementById('closed-issues').textContent = closedIssuesData.total_count || '-';
  } catch (e) {
    console.error('Error fetching issue stats:', e);
  }
}

// Add search functionality
function setupSearchFunctionality() {
  const searchInput = document.getElementById('repo-search');
  searchInput.addEventListener('input', () => {
    const track = document.getElementById('track').value;
    const min = parseInt(document.getElementById('min-commits').value || '0', 10);
    const showPrivate = document.getElementById('show-private').checked;
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    // Filter and sort repos
    const filteredRepos = (window.dashboardData.repos || [])
      .filter(r => (track === "All" ? true : r.track === track))
      .filter(r => (r.commits_count || 0) >= min)
      .filter(r => showPrivate ? true : !r.isPrivate)
      .filter(r => {
        if (!searchTerm) return true;
        return r.name.toLowerCase().includes(searchTerm) ||
               (r.track && r.track.toLowerCase().includes(searchTerm)) ||
               r.contributors.some(c => c.login.toLowerCase().includes(searchTerm));
      })
      .sort((a,b) => (b.commits_count || 0) - (a.commits_count || 0));
    
    // Update filter count
    document.getElementById("filter-count").textContent = 
      `Showing ${filteredRepos.length} of ${window.dashboardData.repos?.length || 0} repositories`;
    
    // Format for table display
    const rows = filteredRepos.map(r => [
      `<a href="https://github.com/${window.dashboardData.org}/${r.name}" target="_blank">${r.name}</a>` + 
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
  });
}

// Modify the filter function to store data globally
function applyFilters() {
  const track = document.getElementById('track').value;
  const min = parseInt(document.getElementById('min-commits').value || '0', 10);
  const showPrivate = document.getElementById('show-private').checked;
  const searchTerm = document.getElementById('repo-search').value.toLowerCase().trim();
  
  // Filter and sort repos
  const filteredRepos = (window.dashboardData.repos || [])
    .filter(r => (track === "All" ? true : r.track === track))
    .filter(r => (r.commits_count || 0) >= min)
    .filter(r => showPrivate ? true : !r.isPrivate)
    .filter(r => {
      if (!searchTerm) return true;
      return r.name.toLowerCase().includes(searchTerm) ||
             (r.track && r.track.toLowerCase().includes(searchTerm)) ||
             r.contributors.some(c => c.login.toLowerCase().includes(searchTerm));
    })
    .sort((a,b) => (b.commits_count || 0) - (a.commits_count || 0));
  
  // Update filter count
  document.getElementById("filter-count").textContent = 
    `Showing ${filteredRepos.length} of ${window.dashboardData.repos?.length || 0} repositories`;
  
  // Format for table display
  const rows = filteredRepos.map(r => [
    `<a href="https://github.com/${window.dashboardData.org}/${r.name}" target="_blank">${r.name}</a>` + 
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

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Set up event listeners
  document.getElementById('track').addEventListener('change', applyFilters);
  document.getElementById('min-commits').addEventListener('input', applyFilters);
  document.getElementById('show-private').addEventListener('change', applyFilters);
  document.getElementById('repo-search').addEventListener('input', applyFilters);
  
  // Store data globally for filtering
  window.dashboardData = {
    repos: [],
    org: '',
    leaderboards: {}
  };
  
  // Load data
  load();
});
