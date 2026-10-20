#!/usr/bin/env python3
"""Rebuild skills/ux-review/references/guidelines.md from ui-ux-pro-max's
ux-guidelines.csv (MIT, Next Level Builder).

    python3 tools/import_ux_guidelines.py <path-to-ui-ux-pro-max-skill> [commit]

Keeps High/Critical/Medium rules for web and mobile. Layout and responsive
rules are left to responsive-check, performance to other tools; AI, spatial
and sustainability rules do not apply to typical web apps.
"""
import csv
import sys
from collections import OrderedDict
from pathlib import Path

SKIP_CATEGORIES = {'Sustainability', 'Spatial UI', 'AI Interaction', 'Performance', 'Layout', 'Responsive'}
SKIP_ISSUES = {'Smooth Scroll', 'Transform Performance', 'Font Loading', 'Heading Line Balance'}
PLATFORMS = {'All', 'Web', 'Mobile'}
SEVERITY_ORDER = {'Critical': 0, 'High': 1, 'Medium': 2}

src = Path(sys.argv[1])
commit = sys.argv[2] if len(sys.argv) > 2 else 'unknown'
rows = list(csv.DictReader(open(src / 'src/ui-ux-pro-max/data/ux-guidelines.csv', encoding='utf-8')))
keep = [
    r for r in rows
    if r['Severity'] in SEVERITY_ORDER and r['Platform'] in PLATFORMS
    and r['Category'] not in SKIP_CATEGORIES and r['Issue'] not in SKIP_ISSUES
]

groups = OrderedDict()
for r in sorted(keep, key=lambda r: (r['Category'].split(' / ')[0], SEVERITY_ORDER[r['Severity']])):
    groups.setdefault(r['Category'].split(' / ')[0], []).append(r)

clean = lambda s: ' '.join(s.split()).replace('|', '\\|')
out = [
    '# UX guidelines',
    '',
    f'{len(keep)} rules adapted from [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)',
    f'(`src/ui-ux-pro-max/data/ux-guidelines.csv`, commit `{commit[:7]}`), MIT License,',
    'Copyright (c) 2024 Next Level Builder. Filtered to Critical/High/Medium rules for',
    'web and mobile; layout and responsive rules are covered by responsive-check.',
    'Regenerate with `python3 tools/import_ux_guidelines.py <checkout> <commit>`.',
    '',
    'Use them as a second pass after `checklist.md`: each rule says what to look',
    'for (Do / Don\'t). Cite the rule name in findings so the user can look it up.',
    '',
    '## Contents',
    '',
    *[f'- [{c}](#{c.lower().replace(" ", "-")}) ({len(rs)})' for c, rs in groups.items()],
    '',
]
for cat, rs in groups.items():
    out += [f'## {cat}', '', '| Rule | Severity | Platform | Do | Don\'t |', '|---|---|---|---|---|']
    for r in rs:
        out.append(f"| **{clean(r['Issue'])}** — {clean(r['Description'])} | {r['Severity']} | {r['Platform']} | {clean(r['Do'])} | {clean(r["Don't"])} |")
    out.append('')

dest = Path(__file__).resolve().parent.parent / 'skills/ux-review/references/guidelines.md'
dest.write_text('\n'.join(out), encoding='utf-8')
print(f'{len(keep)} rules → {dest}')
