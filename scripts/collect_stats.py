#!/usr/bin/env python3
import os, json, time, datetime
import requests
from collections import defaultdict

try:
    import yaml
except Exception:
    yaml = None

# ---------------- CONFIG ----------------
GITHUB_TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
if not GITHUB_TOKEN:
    raise SystemExit("Missing GH_TOKEN/GITHUB_TOKEN in env")

ORG = os.environ.get("ORG", "Avalanche-Team1-Africa")
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "30"))

TRACK_MAP_PATH = "track_map.yaml"
track_map = {}
if yaml and os.path.exists(TRACK_MAP_PATH):
    with open(TRACK_MAP_PATH, "r") as f:
        raw = yaml.safe_load(f) or {}
    for track, repos in raw.items():
        for r in repos or []:
            track_map[r.lower()] = track

session = requests.Session()
session.headers.update({"Authorization": f"Bearer {GITHUB_TOKEN}"})

# ---------------- HELPERS ----------------
def gql(query, variables=None):
    r = session.post(
        "https://api.github.com/graphql",
        json={"query": query, "variables": variables or {}},
    )
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(j["errors"])
    return j["data"]

def list_org_repos():
    repos = []
    q = """
    query($org:String!, $cursor:String) {
      organization(login:$org) {
        repositories(
          first:100, 
          after:$cursor, 
          privacy:PUBLIC, 
          orderBy:{field:UPDATED_AT, direction:DESC}
        ) {
          nodes { 
            name 
            nameWithOwner 
            isArchived 
            isDisabled 
            updatedAt 
            pushedAt
            repositoryTopics(first:20){nodes{topic{name}}}
            defaultBranchRef { 
              target { ... on Commit { history(first:0){ totalCount } } } 
            }
          }
          pageInfo{endCursor hasNextPage}
        }
      }
    }
    """
    cursor = None
    while True:
        data = gql(q, {"org": ORG, "cursor": cursor})
        rs = data["organization"]["repositories"]
        for n in rs["nodes"]:
            topics = [t["topic"]["name"] for t in n["repositoryTopics"]["nodes"]]
            repos.append({
                "name": n["name"],
                "full": n["nameWithOwner"],
                "archived": n["isArchived"],
                "disabled": n["isDisabled"],
                "updatedAt": n["updatedAt"],
                "pushedAt": n["pushedAt"],
                "topics": topics,
            })
        if not rs["pageInfo"]["hasNextPage"]:
            break
        cursor = rs["pageInfo"]["endCursor"]
    return repos

def commit_activity(repo_full, since_iso):
    """Fetch commits since a given ISO date, return [] if repo is empty."""
    owner, name = repo_full.split("/")
    url = f"https://api.github.com/repos/{owner}/{name}/commits"
    params = {"since": since_iso, "per_page": 100}
    commits = []
    while True:
        r = session.get(url, params=params)
        # Handle repos with no commits (empty repos)
        if r.status_code == 409:
            print(f"⚠️ Skipping {repo_full} (no commits yet)")
            return []
        r.raise_for_status()
        page = r.json()
        commits.extend(page)
        nxt = r.links.get("next", {}).get("url")
        if not nxt:
            break
        url = nxt
        params = None
        time.sleep(0.2)
    return commits

def infer_track(repo_name, topics):
    for t in topics:
        if t.startswith("track-"):
            return t.replace("track-", "")
    return track_map.get(repo_name.lower())

# ---------------- MAIN ----------------
def main():
    now = datetime.datetime.utcnow()
    since = now - datetime.timedelta(days=WINDOW_DAYS)
    since_iso = since.replace(microsecond=0).isoformat() + "Z"

    repos = list_org_repos()
    org_stats = {
        "org": ORG,
        "generated_at": now.isoformat() + "Z",
        "window_days": WINDOW_DAYS,
        "repos_total": len(repos),
        "repos": [],
        "leaderboards": {}
    }

    contributor_totals = defaultdict(int)
    repo_activity = []

    for r in repos:
        if r["archived"] or r["disabled"]:
            continue

        commits = commit_activity(r["full"], since_iso)
        by_author = defaultdict(int)
        last_commit_iso = None

        for c in commits:
            author = (c.get("author") or {}).get("login") \
                     or (c.get("commit") or {}).get("author", {}).get("name", "unknown")
            by_author[author] += 1
            dt = c["commit"]["author"]["date"]
            if (not last_commit_iso) or (dt > last_commit_iso):
                last_commit_iso = dt

        track = infer_track(r["name"], r["topics"])
        repo_info = {
            "name": r["name"],
            "full": r["full"],
            "topics": r["topics"],
            "track": track,
            "commits_count": len(commits),
            "contributors": [
                {"login": k, "commits": v}
                for k, v in sorted(by_author.items(), key=lambda x: x[1], reverse=True)
            ],
            "last_commit_at": last_commit_iso or r["pushedAt"] or "N/A",
        }

        repo_activity.append((repo_info["name"], repo_info["commits_count"]))
        for k, v in by_author.items():
            contributor_totals[k] += v
        org_stats["repos"].append(repo_info)

    # Leaderboards
    org_stats["leaderboards"]["top_repos_30d"] = sorted(
        [{"repo": n, "commits": c} for n, c in repo_activity],
        key=lambda x: x["commits"], reverse=True
    )[:10]

    org_stats["leaderboards"]["top_contributors_30d"] = sorted(
        [{"login": k, "commits": v} for k, v in contributor_totals.items()],
        key=lambda x: x["commits"], reverse=True
    )[:15]

    # Save to JSON
    os.makedirs("public", exist_ok=True)
    with open("public/stats.json", "w") as f:
        json.dump(org_stats, f, indent=2)

# ---------------- ENTRY ----------------
if __name__ == "__main__":
    main()
