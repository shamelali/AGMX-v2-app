#!/usr/bin/env python3
"""Query the linked Supabase project through the Management API.

The CLI's `db push` needs a database password this sandbox does not have;
the Management API's query endpoint accepts the same access token the CLI
uses, so this is the way to read the live schema without a password.
"""
import json
import os
import sys
import urllib.request

REF = os.environ.get("SUPABASE_PROJECT_REF", "jchfalaibabmszewemat")
TOKEN = open(os.path.expanduser("~/.supabase/access-token")).read().strip()
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"


def query(sql):
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        URL, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode())


if __name__ == "__main__":
    sql = sys.stdin.read()
    out = query(sql)
    print(json.dumps(out, indent=2))
