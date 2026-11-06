#!/usr/bin/env python3
"""Fail a CI deploy when the latest commit's author cannot deploy.

Vercel attributes a deploy made from a git checkout to that author and Blocks it
when the account is not on the team, naming neither the email nor the reason.
Reads the roster over the network, so it is not part of tools/check.sh, which is
offline.
"""

import json
import os
import sys
import urllib.request


def main():
    author = os.environ.get("AGMX_AUTHOR", "").strip()
    team = os.environ.get("VERCEL_ORG_ID", "").strip()
    token = os.environ.get("VERCEL_TOKEN", "").strip()

    if not (author and team and token):
        print("::warning::AGMX_AUTHOR, VERCEL_ORG_ID or VERCEL_TOKEN is unset —"
              " author check skipped.")
        return 0

    request = urllib.request.Request(
        f"https://api.vercel.com/v1/teams/{team}/members?teamId={team}",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            members = json.load(response)
    except Exception as exc:
        print(f"::warning::could not read the team roster ({type(exc).__name__}) —"
              " letting Vercel decide.")
        return 0

    if not isinstance(members, list):
        print(f"::warning::unexpected roster response: {str(members)[:200]}")
        return 0

    # A deployment is matched to an account by email, but the roster also carries
    # usernames, and an author who set their git email to the account handle rather
    # than the address would otherwise be reported as missing.
    allowed = set()
    for member in members:
        for field in ("email", "username"):
            value = (member.get(field) or "").lower()
            if value:
                allowed.add(value)

    if author.lower() in allowed:
        role = next((m.get("role") for m in members
                     if (m.get("email") or "").lower() == author.lower()), "member")
        print(f"OK: {author} may deploy to team {team} (role: {role}).")
        return 0

    names = ", ".join(sorted({m.get("email") or m.get("username") or "?"
                              for m in members})) or "nobody"
    print(f"::error::Vercel will BLOCK the deploy: commit author '{author}' is not an"
          f" account that can deploy to team '{team}'. Accounts on that team: {names}."
          " Either point this repo's git user.email at one of them and re-author the"
          " commit, or have a team owner add the author's Vercel account.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
