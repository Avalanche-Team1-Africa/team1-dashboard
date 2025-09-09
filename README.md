# 🌐 Avalanche Team1 Kenya Dashboard

A unified dashboard that tracks **GitHub activity across the Avalanche-Team1-Africa org**.  
This project makes it easy for builders, mentors, and sponsors to **benchmark progress, identify momentum, and celebrate contributions**.

---

## 🔥 Why this dashboard?
- **Transparency** → Real-time view of builder activity across all repos.  
- **Benchmarking** → Quickly see which projects are gaining traction.  
- **Motivation** → Shoutouts to top contributors and active repos.  
- **Onboarding** → New builders can discover which tracks and repos are most active.

---

## 📊 What does it show?
- **Top Repositories (30 days)** → by commit volume.  
- **Top Contributors (30 days)** → most active builders.  
- **Repo Activity Table**:
  - Track (FinTech, Gaming, Infra, AI/Automation, …)  
  - Commit counts  
  - Last commit date  
  - Top contributors per repo  
- **Filters**:
  - By Track (`track-gaming`, `track-fintech`, etc. or via `track_map.yaml`)  
  - By minimum commit count  

👉 Live Dashboard: [https://avalanche-team1-africa.github.io/team1-dashboard/](https://avalanche-team1-africa.github.io/team1-dashboard/)

---

## 🛠 How it works
1. **Collector script** (`scripts/collect_stats.py`)  
   - Runs daily via GitHub Actions.  
   - Calls the GitHub API to fetch repo activity.  
   - Generates a `stats.json` snapshot in `/public`.

2. **Static Site** (`site/`)  
   - A simple HTML+JS frontend.  
   - Fetches `stats.json` and renders tables/filters.  
   - Hosted automatically on GitHub Pages (via Actions deploy).

3. **GitHub Actions workflow** (`.github/workflows/collect.yml`)  
   - Schedules nightly runs + manual triggers.  
   - Builds the JSON and static UI.  
   - Publishes to Pages.

---

## 🚀 Quickstart for Builders
If you’re contributing to the org, your activity will automatically show up.  
Here’s how to **tag your repo** so it appears under the right track:

### Option 1 — Add topics to your repo
In your repo → Settings → Topics, add one of:
- `track-gaming`
- `track-fintech`
- `track-infra`
- `track-ai`

### Option 2 — Update `track_map.yaml`
If you can’t add topics, just add your repo name under the correct track.

```yaml
gaming:
  - my-game-repo
fintech:
  - defi-payments
infra:
  - rpc-service
ai:
  - ai-agent# team1-dashboard
A digital dashboard that tracks builder engagement



![alt text](image.png)

https://curly-adventure-69g4vpvgqxgq25v6-5500.app.github.dev/dashboard.html



Deployment Instructions


Set up GitHub Pages:

Your repository already has a GitHub Actions workflow configured in collect.yml
This workflow:
Runs the collect_stats.py script to fetch repository data
Copies the site directory to public/
Deploys to GitHub Pages
Configure GitHub Secrets:

For private repository access, you need a GitHub Personal Access Token (PAT) with repo scope
Go to your repository on GitHub
Navigate to Settings > Secrets and variables > Actions
Add a new repository secret named GH_PAT with your personal access token
Run the Workflow:

Go to the Actions tab in your GitHub repository
Select the "Build stats & deploy Pages" workflow
Click "Run workflow" and select the main branch
This will collect the latest stats and deploy your dashboard
Access Your Dashboard:

After deployment, your dashboard will be available at: https://avalanche-team1-africa.github.io/team1-dashboard/
Required Permissions
To access private repositories, make sure your GitHub token has:

repo scope for private repository access
read:org scope for organization access
Maintenance
The GitHub Actions workflow is set to run daily at 01:17 UTC, which will:

Collect fresh repository data
Update the stats.json file
Redeploy the dashboard
You can also manually trigger the workflow from the Actions tab whenever you want to update the dashboard.

Would you like me to explain any particular part of the implementation in more detail?