#!/usr/bin/env python3
"""Converts the Godot project's data/*.tres resources into the JSON files the
three.js build reads (data/*.json).

Usage:
    python3 tools/convert_godot_data.py <path to the Godot project> [<out dir>]

Only fields written in a .tres are copied; anything left out takes the
default from the matching class in src/sim/defs.js, the same way Godot falls
back to the script's defaults. References to other resources become their
ids ("ammo": "gas_cartridge"), models become file names under
assets/models/, and recipe inputs become [{"item": id, "count": n}].
"""

import json
import os
import re
import sys

FOLDERS = {
    "items": "items",
    "nodes": "nodes",
    "npcs": "npcs",
    "recipes": "recipes",
    "stations": "stations",
    "terrain": "terrain",
    "weapon_types": "weapon_types",
}


def parse_value(text, ext, subs):
    text = text.strip()
    if text.startswith('&"') or text.startswith('"'):
        return json.loads(text.lstrip("&"))
    if text in ("true", "false"):
        return text == "true"
    if text == "null":
        return None
    m = re.fullmatch(r"Color\(([^)]*)\)", text)
    if m:
        return [round(float(v), 4) for v in m.group(1).split(",")]
    m = re.fullmatch(r'ExtResource\("([^"]+)"\)', text)
    if m:
        return ext[m.group(1)]
    m = re.fullmatch(r'SubResource\("([^"]+)"\)', text)
    if m:
        return subs[m.group(1)]
    m = re.fullmatch(r"Array\[.*?\]\(\[(.*)\]\)", text)
    if m:
        inner = m.group(1).strip()
        if not inner:
            return []
        return [parse_value(part, ext, subs) for part in split_top(inner)]
    if text.startswith("["):
        inner = text[1:-1].strip()
        return [parse_value(part, ext, subs) for part in split_top(inner)] if inner else []
    try:
        return int(text)
    except ValueError:
        return float(text)


def split_top(text):
    """Splits on commas outside brackets and parentheses."""
    out, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == "," and depth == 0:
            out.append(text[start:i])
            start = i + 1
    out.append(text[start:])
    return [p for p in (s.strip() for s in out) if p]


def resource_id(godot_root, res_path):
    """The id field of the .tres at a res:// path (what saves and maps use)."""
    path = os.path.join(godot_root, res_path.replace("res://", ""))
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r'id = &?"([^"]+)"', line.strip())
            if m:
                return m.group(1)
    return os.path.splitext(os.path.basename(path))[0]


def parse_tres(godot_root, path):
    ext, subs = {}, {}
    current, props = None, None
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        head = re.match(r"\[(\w+)(.*)\]$", line)
        if head:
            kind, attrs = head.group(1), head.group(2)
            if kind == "ext_resource":
                rid = re.search(r'id="([^"]+)"', attrs).group(1)
                rpath = re.search(r'path="([^"]+)"', attrs).group(1)
                rtype = re.search(r'type="([^"]+)"', attrs).group(1)
                if rtype == "PackedScene":
                    ext[rid] = os.path.basename(rpath)
                elif rtype == "Script":
                    ext[rid] = {"__script": os.path.basename(rpath)}
                else:
                    ext[rid] = resource_id(godot_root, rpath)
                current = None
            elif kind == "sub_resource":
                rid = re.search(r'id="([^"]+)"', attrs).group(1)
                props = {}
                subs[rid] = props
                current = "sub"
            elif kind == "resource":
                props = {}
                current = "resource"
            continue
        if current is None or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key == "script":
            continue
        props[key] = parse_value(value, ext, subs)
    return props


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    godot_root = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data")
    for name, folder in FOLDERS.items():
        src = os.path.join(godot_root, "data", folder)
        out = {}
        for file in sorted(os.listdir(src)):
            if not file.endswith(".tres"):
                continue
            props = parse_tres(godot_root, os.path.join(src, file))
            out[props["id"]] = props
        with open(os.path.join(out_dir, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
            f.write("\n")
        print(f"{name}: {len(out)}")


if __name__ == "__main__":
    main()
