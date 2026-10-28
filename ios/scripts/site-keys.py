#!/usr/bin/env python3
"""Supabase adresi ve anon (herkese açık) anahtarını canlı web sitesinden okur.

Bu değerler tarayıcıya giden JS dosyalarında zaten açıkça durur (NEXT_PUBLIC_*);
gizli değildir ve satır düzeyi güvenlik (RLS) ile korunur. TestFlight iş akışı
SUPABASE_URL / SUPABASE_ANON_KEY gizlileri verilmediyse bunu kullanır.
Yalnız role=anon JWT ya da sb_publishable_ anahtar kabul edilir.

Kullanım: site-keys.py https://site.vercel.app  → GITHUB_OUTPUT'a url=, key=
"""
import base64
import json
import os
import re
import sys
import urllib.request


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "fintrack-ios-ci"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def is_anon_jwt(tok: str) -> bool:
    try:
        part = tok.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return payload.get("role") == "anon"
    except Exception:
        return False


def main():
    site = sys.argv[1].rstrip("/")
    chunks: list[str] = []
    for page in ("/login", "/"):
        try:
            html = get(site + page)
        except Exception as e:
            print(f"{page}: {e}")
            continue
        chunks += re.findall(r'/_next/static/[^"\'\s]+?\.js', html)
    url = key = None
    for c in dict.fromkeys(chunks):
        try:
            js = get(site + c)
        except Exception:
            continue
        url = url or next(iter(re.findall(r"https://[a-z0-9]{15,30}\.supabase\.co", js)), None)
        if not key:
            key = next((t for t in re.findall(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", js) if is_anon_jwt(t)), None) \
                or next(iter(re.findall(r"sb_publishable_[\w-]{10,}", js)), None)
        if url and key:
            break
    if not (url and key):
        print(f"::error::Supabase bilgileri {site} üzerinden okunamadı. SUPABASE_URL ve SUPABASE_ANON_KEY "
              "gizlilerini ekleyin (Vercel → Settings → Environment Variables'taki NEXT_PUBLIC_SUPABASE_*).")
        sys.exit(1)
    print(f"::add-mask::{key}")
    print(f"✓ Supabase: {url}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"url={url}\nkey={key}\n")


if __name__ == "__main__":
    main()
