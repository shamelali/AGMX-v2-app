#!/usr/bin/env python3
"""
Git Worktree Manager for AGMX

Manage Git worktrees for parallel development, feature branches, hotfixes, etc.

Usage:
    python3 tools/worktree.py create <branch-name> [base-branch]   Create new worktree
    python3 tools/worktree.py list                                  List all worktrees
    python3 tools/worktree.py remove <branch-name>                  Remove worktree
    python3 tools/worktree.py prune                                 Prune stale worktrees
    python3 tools/worktree.py switch <branch-name>                  Print cd command for worktree

Examples:
    python3 tools/worktree.py create feature/new-ui main
    python3 tools/worktree.py create hotfix/login-bug v1.0.0
    python3 tools/worktree.py list
    python3 tools/worktree.py remove feature/new-ui
    python3 tools/worktree.py switch feature/new-ui
"""

import argparse
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKTREES_DIR = ROOT / "worktrees"


def run(cmd: list[str], cwd: pathlib.Path | None = None) -> subprocess.CompletedProcess:
    """Run a command and return the result."""
    return subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True)


def ensure_worktrees_dir() -> None:
    """Ensure the worktrees directory exists."""
    WORKTREES_DIR.mkdir(exist_ok=True)


def worktree_path(branch: str) -> pathlib.Path:
    """Get the filesystem path for a worktree branch."""
    # Sanitize branch name for filesystem
    safe_name = branch.replace("/", "-").replace("\\", "-")
    return WORKTREES_DIR / safe_name


def branch_exists(branch: str) -> bool:
    """Check if a branch exists locally or remotely."""
    result = run(["git", "rev-parse", "--verify", branch])
    if result.returncode == 0:
        return True
    # Check remote
    result = run(["git", "rev-parse", "--verify", f"origin/{branch}"])
    return result.returncode == 0


def get_current_branch() -> str:
    """Get the current branch name."""
    result = run(["git", "branch", "--show-current"])
    return result.stdout.strip()


def list_worktrees() -> list[dict]:
    """List all worktrees with their details."""
    result = run(["git", "worktree", "list", "--porcelain"])
    if result.returncode != 0:
        return []

    worktrees = []
    current = {}
    for line in result.stdout.strip().split("\n"):
        if not line:
            if current:
                worktrees.append(current)
                current = {}
            continue
        if line.startswith("worktree "):
            current["path"] = line[9:]
        elif line.startswith("HEAD "):
            current["head"] = line[5:]
        elif line.startswith("branch "):
            current["branch"] = line[7:]
        elif line == "bare":
            current["bare"] = True
        elif line == "detached":
            current["detached"] = True
    if current:
        worktrees.append(current)
    return worktrees


def create_worktree(branch: str, base: str | None = None) -> bool:
    """Create a new worktree for the given branch."""
    ensure_worktrees_dir()

    path = worktree_path(branch)

    if path.exists():
        print(f"Error: Worktree directory already exists: {path}")
        return False

    # Determine base branch
    if base is None:
        base = get_current_branch()
        print(f"No base branch specified, using current branch: {base}")

    # Check if branch exists locally
    if branch_exists(branch):
        print(f"Branch '{branch}' already exists locally. Checking out existing branch...")
        result = run(["git", "worktree", "add", str(path), branch])
    else:
        # Check if branch exists on remote
        if branch_exists(f"origin/{branch}"):
            print(f"Branch '{branch}' found on remote. Creating local tracking branch...")
            result = run(["git", "worktree", "add", "-b", branch, str(path), f"origin/{branch}"])
        else:
            print(f"Branch '{branch}' does not exist. Creating new branch from '{base}'...")
            result = run(["git", "worktree", "add", "-b", branch, str(path), base])

    if result.returncode != 0:
        print(f"Error creating worktree: {result.stderr}")
        return False

    print(f"✅ Worktree created at: {path}")
    print(f"   Branch: {branch}")
    print(f"   Base: {base}")
    print(f"\nTo switch to this worktree:")
    print(f"  cd {path}")
    return True


def remove_worktree(branch: str, force: bool = False) -> bool:
    """Remove a worktree."""
    path = worktree_path(branch)

    if not path.exists():
        # Check if it's registered with git but path is different
        worktrees = list_worktrees()
        for wt in worktrees:
            if wt.get("branch") == f"refs/heads/{branch}" or wt.get("branch") == branch:
                path = pathlib.Path(wt["path"])
                break
        else:
            print(f"Error: Worktree for branch '{branch}' not found at {path}")
            return False

    cmd = ["git", "worktree", "remove"]
    if force:
        cmd.append("--force")
    cmd.append(str(path))

    result = run(cmd)
    if result.returncode != 0:
        print(f"Error removing worktree: {result.stderr}")
        return False

    print(f"✅ Worktree removed: {path}")
    return True


def prune_worktrees() -> bool:
    """Prune stale worktree entries."""
    result = run(["git", "worktree", "prune"])
    if result.returncode != 0:
        print(f"Error pruning worktrees: {result.stderr}")
        return False

    if result.stdout.strip():
        print(result.stdout.strip())
    else:
        print("No stale worktrees to prune.")
    return True


def switch_worktree(branch: str) -> bool:
    """Print the cd command for a worktree."""
    path = worktree_path(branch)

    if not path.exists():
        # Check git worktree list
        worktrees = list_worktrees()
        for wt in worktrees:
            wt_branch = wt.get("branch", "").replace("refs/heads/", "")
            if wt_branch == branch:
                path = pathlib.Path(wt["path"])
                break
        else:
            print(f"Error: Worktree for branch '{branch}' not found")
            return False

    print(f"cd {path}")
    return True


def list_worktrees_cmd() -> None:
    """List all worktrees in a formatted table."""
    worktrees = list_worktrees()

    if not worktrees:
        print("No worktrees found.")
        return

    print(f"{'Branch':<30} {'Path':<50} {'Status'}")
    print("-" * 100)

    for wt in worktrees:
        branch = wt.get("branch", "").replace("refs/heads/", "")
        path = wt.get("path", "")
        head = wt.get("head", "")[:8]

        # Determine status
        status_parts = []
        if wt.get("bare"):
            status_parts.append("bare")
        if wt.get("detached"):
            status_parts.append("detached")
        if path == str(ROOT):
            status_parts.append("main")
        status = ", ".join(status_parts) if status_parts else "active"

        # Shorten path for display
        display_path = path
        if path.startswith(str(ROOT)):
            display_path = path[len(str(ROOT)):]
            if not display_path:
                display_path = "."
            elif display_path.startswith("/"):
                display_path = display_path[1:]

        print(f"{branch:<30} {display_path:<50} {status}")


def main():
    parser = argparse.ArgumentParser(
        description="Git Worktree Manager for AGMX",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Create
    create_parser = subparsers.add_parser("create", help="Create new worktree")
    create_parser.add_argument("branch", help="Branch name")
    create_parser.add_argument("base", nargs="?", help="Base branch (default: current branch)")

    # List
    subparsers.add_parser("list", help="List all worktrees")

    # Remove
    remove_parser = subparsers.add_parser("remove", help="Remove worktree")
    remove_parser.add_argument("branch", help="Branch name")
    remove_parser.add_argument("-f", "--force", action="store_true", help="Force removal")

    # Prune
    subparsers.add_parser("prune", help="Prune stale worktree entries")

    # Switch
    switch_parser = subparsers.add_parser("switch", help="Print cd command for worktree")
    switch_parser.add_argument("branch", help="Branch name")

    args = parser.parse_args()

    if args.command == "create":
        success = create_worktree(args.branch, args.base)
        sys.exit(0 if success else 1)
    elif args.command == "list":
        list_worktrees_cmd()
    elif args.command == "remove":
        success = remove_worktree(args.branch, args.force)
        sys.exit(0 if success else 1)
    elif args.command == "prune":
        success = prune_worktrees()
        sys.exit(0 if success else 1)
    elif args.command == "switch":
        success = switch_worktree(args.branch)
        sys.exit(0 if success else 1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()