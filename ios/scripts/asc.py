#!/usr/bin/env python3
"""App Store Connect hazırlığı (TestFlight iş akışı için).

Paket kimliklerini (uygulama + widget) Apple hesabına kaydeder ve App Store
Connect'te uygulama kaydı olup olmadığına bakar; yoksa ne yapılacağını söyler.
Apple uygulama kaydının API ile açılmasına izin vermiyor — o tek adım elle.

Ortam: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, FT_BUNDLE_ID. Çıktı: team=<ekip kimliği>
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt  # pyjwt[crypto]

API = "https://api.appstoreconnect.apple.com/v1"


def token() -> str:
    key = open(os.environ["ASC_KEY_PATH"]).read()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
        key, algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


def call(method: str, path: str, body=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def fail(msg: str):
    print(f"::error::{msg}")
    sys.exit(1)


def ensure_bundle_id(identifier: str, name: str):
    q = urllib.parse.quote(identifier)
    st, res = call("GET", f"/bundleIds?filter[identifier]={q}&limit=5")
    if st == 401:
        fail("App Store Connect anahtarı reddedildi: ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 gizlilerini kontrol edin.")
    if st == 403:
        fail("Anahtarın yetkisi yetmiyor: App Store Connect → Users and Access → Integrations'ta 'Admin' rolüyle yeni anahtar açın.")
    for d in res.get("data", []):
        if d["attributes"]["identifier"] == identifier:
            print(f"✓ paket kimliği kayıtlı: {identifier}")
            return d["attributes"].get("seedId")
    st, res = call("POST", "/bundleIds", {"data": {"type": "bundleIds", "attributes": {
        "identifier": identifier, "name": name, "platform": "IOS"}}})
    if st in (200, 201):
        print(f"✓ paket kimliği kaydedildi: {identifier}")
        return res["data"]["attributes"].get("seedId")
    detail = "; ".join(e.get("detail", "") for e in res.get("errors", []))
    fail(f"{identifier} kaydedilemedi ({st}): {detail}. Başka bir hesapta kayıtlıysa GitHub → Settings → "
         f"Variables'a FT_BUNDLE_ID = com.<adınız>.fintrack ekleyin.")


def main():
    bid = os.environ["FT_BUNDLE_ID"]
    team = ensure_bundle_id(bid, "FinTrack")
    ensure_bundle_id(bid + ".widget", "FinTrack Widget")
    st, res = call("GET", f"/apps?filter[bundleId]={urllib.parse.quote(bid)}&limit=1")
    if not res.get("data"):
        fail(f"App Store Connect'te uygulama kaydı yok. appstoreconnect.apple.com → Apps → + → New App: "
             f"iOS, ad 'FinTrack <adınız>' (adlar tüm App Store'da benzersiz olmalı), dil Türkçe, "
             f"Bundle ID '{bid}', SKU 'fintrack'. Sonra bu iş akışını yeniden çalıştırın.")
    print(f"✓ uygulama kaydı: {res['data'][0]['attributes'].get('name')}")
    # Ekip kimliği = paket kimliğinin ön eki (seedId); gizli olarak verilmediyse buradan
    if team and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"team={team}\n")


if __name__ == "__main__":
    main()
