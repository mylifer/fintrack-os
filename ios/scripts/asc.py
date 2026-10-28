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
        fail(f"App Store Connect anahtarı reddedildi (Key ID {os.environ['ASC_KEY_ID']}). ASC_KEY_P8 bu Key ID'li "
             "Team Keys anahtarının dosyası olmalı; Individual Keys anahtarı çalışmaz.")
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


def ensure_testers(app_id: str):
    """İç test grubu 'Ben' (tüm sürümlere erişim) ve ekibin tüm kullanıcıları test eden olarak.
    Telefonda başka Apple ID kullanılıyorsa o hesap önce Users and Access'ten davet edilip
    kabul edilmiş olmalı; sonraki çalışmada kendiliğinden eklenir. Hata olursa iş durmaz."""
    st, res = call("GET", f"/apps/{app_id}/betaGroups?limit=50")
    group = next((g for g in res.get("data", []) if g["attributes"].get("isInternalGroup")), None)
    if not group:
        st, res = call("POST", "/betaGroups", {"data": {"type": "betaGroups",
            "attributes": {"name": "Ben", "isInternalGroup": True, "hasAccessToAllBuilds": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
        if st not in (200, 201):
            print(f"::warning::İç test grubu açılamadı ({st}); App Store Connect → TestFlight'tan elle açın.")
            return
        group = res["data"]
        print("✓ iç test grubu açıldı: Ben")
    gid = group["id"]
    st, res = call("GET", f"/betaGroups/{gid}/betaTesters?limit=200")
    have = {t["attributes"].get("email", "").lower() for t in res.get("data", [])}
    st, users = call("GET", "/users?limit=200")
    for u in users.get("data", []):
        email = (u["attributes"].get("username") or "").lower()
        if not email or email in have:
            continue
        st, r = call("POST", "/betaTesters", {"data": {"type": "betaTesters",
            "attributes": {"email": email, "firstName": u["attributes"].get("firstName") or "",
                           "lastName": u["attributes"].get("lastName") or ""},
            "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": gid}]}}}})
        print(f"test eden eklendi: {st}")  # e-posta günlüğe yazılmaz (depo herkese açık)
    print(f"✓ iç test grubu: {len(users.get('data', []))} kullanıcı")


def main():
    bid = os.environ["FT_BUNDLE_ID"]
    team = ensure_bundle_id(bid, "FinTrack")
    ensure_bundle_id(bid + ".widget", "FinTrack Widget")
    st, res = call("GET", f"/apps?filter[bundleId]={urllib.parse.quote(bid)}&limit=1")
    if not res.get("data"):
        fail(f"App Store Connect'te uygulama kaydı yok. appstoreconnect.apple.com → Apps → + → New App: "
             f"iOS, ad 'Orbit <adınız>' (adlar tüm App Store'da benzersiz olmalı), dil Türkçe, "
             f"Bundle ID '{bid}', SKU 'fintrack'. Sonra bu iş akışını yeniden çalıştırın.")
    print(f"✓ uygulama kaydı: {res['data'][0]['attributes'].get('name')}")
    try:
        ensure_testers(res["data"][0]["id"])
    except Exception as e:  # test grubu iş akışını durdurmasın
        print(f"::warning::Test grubu ayarlanamadı: {e}")
    # Anahtarın yetkisi: Xcode bulut imzalama için Admin rolü gerekir
    probes = {p: call("GET", p)[0] for p in ("/users?limit=1", "/certificates?limit=1", "/profiles?limit=1")}
    print("yetki yoklaması:", ", ".join(f"{p.split('?')[0]} → {st}" for p, st in probes.items()))
    if probes["/users?limit=1"] == 403:
        print("::warning::Bu anahtar Admin değil gibi görünüyor; Xcode bulut imzalama Admin anahtarı ister.")
    # Ekip kimliği = paket kimliğinin ön eki (seedId); gizli olarak verilmediyse buradan
    if team and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"team={team}\n")


if __name__ == "__main__":
    main()
