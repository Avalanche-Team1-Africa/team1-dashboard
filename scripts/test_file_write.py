#!/usr/bin/env python3
import os
import json

# Create a test file with minimal GitHub stats format
test_data = {
    "org": "Avalanche-Team1-Africa",
    "generated_at": "2025-09-04T12:00:00Z",
    "window_days": 30,
    "repos": [],
    "leaderboards": {
        "top_repos_30d": [],
        "top_contributors_30d": []
    }
}

# Get absolute path to script directory
script_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(script_dir)
site_dir = os.path.join(parent_dir, "site")

# Print debug info
print(f"Script directory: {script_dir}")
print(f"Parent directory: {parent_dir}")
print(f"Site directory: {site_dir}")
print(f"Site directory exists: {os.path.exists(site_dir)}")

# Create the site directory if it doesn't exist
os.makedirs(site_dir, exist_ok=True)
print(f"Site directory created/confirmed: {os.path.exists(site_dir)}")

# Save to file
stats_file = os.path.join(site_dir, "stats.json")
print(f"Attempting to save to: {stats_file}")

try:
    with open(stats_file, "w") as f:
        json.dump(test_data, f, indent=2)
    print(f"Successfully wrote to {stats_file}")
except Exception as e:
    print(f"Error writing file: {e}")
