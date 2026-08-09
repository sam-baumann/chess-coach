#!/usr/bin/env python3
"""Audit and screenshot a review page in BOTH themes before publishing.

    uv run --with pillow python preview.py reviews/foo.html --out /tmp/shots

Does two things the eye alone will miss:

1. `audit` — the published page is wrapped in a skeleton whose theme you do not
   control. Any colour whose ONLY definition sits inside an @media or
   [data-theme] block silently fails to apply in the un-stamped "system" state,
   rendering one theme's text on the other theme's ground. This checks that
   every token is defined in all three states, that no raw hex leaks into
   component rules, that no var() is undefined, and that body paints an
   explicit background.
2. `shots` — wraps the file the way the host does and renders it at both
   theme stamps, so the diagrams and chart can actually be looked at.

Exits non-zero if the audit fails, so it can gate a publish.
"""
import argparse, pathlib, re, shutil, subprocess, sys

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chromium-browser",
]

SKELETON = ('<!doctype html><html{stamp}><head><meta charset="utf-8">{head}</head>'
            '<body>{body}</body></html>')


def find_chrome():
    for c in CHROME_CANDIDATES:
        if c.startswith("/") and pathlib.Path(c).exists():
            return c
        found = shutil.which(c)
        if found:
            return found
    return None


def audit(src):
    """Return a list of problem strings; empty means the page is sound."""
    problems = []
    m = re.search(r"<style>(.*?)</style>", src, re.S)
    if not m:
        return ["no <style> block found"]
    css = m.group(1)

    blocks = {
        "light": re.search(r":root\{(.*?)\n\}", css, re.S),
        "media": re.search(r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*"
                           r":root:not\(\[data-theme=\"light\"\]\)\{(.*?)\n\s*\}", css, re.S),
        "stamp": re.search(r":root\[data-theme=\"dark\"\]\{(.*?)\n\}", css, re.S),
    }
    missing_block = [k for k, v in blocks.items() if v is None]
    if missing_block:
        # A deliberately single-theme page is legal, but say so out loud.
        problems.append(f"theme block(s) not found: {', '.join(missing_block)} "
                        "(fine only if the page commits to one theme on purpose)")
        return problems

    sets = {k: set(re.findall(r"(--[a-z0-9-]+)\s*:", v.group(1)))
            for k, v in blocks.items()}
    for other in ("media", "stamp"):
        gap = sets["light"] - sets[other]
        if gap:
            problems.append(f"tokens defined in :root but not in {other}: {sorted(gap)}")
        extra = sets[other] - sets["light"]
        if extra:
            problems.append(f"tokens in {other} with no :root default: {sorted(extra)}")

    used = set(re.findall(r"var\((--[a-z0-9-]+)", css))
    undefined = used - sets["light"]
    if undefined:
        problems.append(f"var() references with no definition: {sorted(undefined)}")

    # Raw colours outside the token blocks.
    stripped = css
    for v in blocks.values():
        stripped = stripped.replace(v.group(1), "")
    leaked = set(re.findall(r"#[0-9A-Fa-f]{3,8}\b", stripped))
    if leaked:
        problems.append(f"raw hex outside token blocks: {sorted(leaked)}")

    if not re.search(r"body\s*\{[^}]*background:\s*var\(", css):
        problems.append("body has no explicit background from a token "
                        "(a transparent body borrows the host's ground)")
    return problems


def shots(path, src, outdir, chrome, height):
    outdir.mkdir(parents=True, exist_ok=True)
    title = re.search(r"<title>.*?</title>", src, re.S)
    head = title.group(0) if title else ""
    body = src.replace(head, "") if head else src

    made = []
    for mode in ("light", "dark"):
        page = SKELETON.format(stamp=f' data-theme="{mode}"', head=head, body=body)
        html_path = outdir / f"preview-{mode}.html"
        html_path.write_text(page)
        png = outdir / f"{path.stem}-{mode}.png"
        subprocess.run([chrome, "--headless", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size=1200,{height}", f"--screenshot={png}",
                        html_path.resolve().as_uri()],
                       check=True, capture_output=True)
        made.append(png)
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("page", help="the review HTML file")
    ap.add_argument("--out", default="", help="screenshot directory (default alongside)")
    ap.add_argument("--height", type=int, default=7000, help="capture height in px")
    ap.add_argument("--no-shots", action="store_true", help="audit only")
    args = ap.parse_args()

    path = pathlib.Path(args.page)
    src = path.read_text()

    problems = audit(src)
    if problems:
        print("AUDIT FAILED")
        for p in problems:
            print(f"  - {p}")
    else:
        print("audit ok — tokens complete in all three theme states")

    if not args.no_shots:
        chrome = find_chrome()
        if not chrome:
            print("no Chrome/Chromium found; skipping screenshots", file=sys.stderr)
        else:
            outdir = pathlib.Path(args.out) if args.out else path.parent / "_preview"
            for png in shots(path, src, outdir, chrome, args.height):
                print(f"wrote {png}")

    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
