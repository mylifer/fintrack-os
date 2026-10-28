#!/usr/bin/env python3
"""TestFlight için imzalama — Xcode'un otomatik imzalaması olmadan.

Xcode'un kendi App Store Connect girişi CI'da "Authentication failed" verdiği
için sertifika ve profiller doğrudan App Store Connect API'siyle hazırlanır
(asc.py ile aynı anahtar). Durumsuz çalışır:

  setup   → geçici "Apple Distribution" sertifikası (yeni anahtar + CSR),
            App Store profilleri (uygulama + widget), geçici keychain.
            GITHUB_ENV'e: PROFILE_APP, PROFILE_WIDGET, SIGN_KEYCHAIN,
            APP_GROUP_OK (profilde App Group var mı)
  cleanup → bu çalışmanın profil ve sertifikasını siler. Sertifika iptali
            TestFlight'a yüklenmiş sürümleri etkilemez.

Ortam: asc.py'ninkiler + RUNNER_TEMP, GITHUB_RUN_ID
"""
import base64
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asc import call, fail  # noqa: E402

WORK = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "sign"
STATE = WORK / "state.json"
KC_PASS = "ci"


def sh(*args, check=True, **kw):
    return subprocess.run(list(args), check=check, text=True, capture_output=True, **kw)


def env_out(**kv):
    with open(os.environ["GITHUB_ENV"], "a") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def save_state(state):
    STATE.write_text(json.dumps(state))


def bundle_resource(identifier: str) -> str:
    st, res = call("GET", f"/bundleIds?filter[identifier]={identifier}&limit=10")
    for d in res.get("data", []):
        if d["attributes"]["identifier"] == identifier:
            return d["id"]
    fail(f"Paket kimliği bulunamadı: {identifier}")


def ensure_app_groups_capability(bid_id: str):
    st, res = call("GET", f"/bundleIds/{bid_id}/bundleIdCapabilities")
    if any(d["attributes"].get("capabilityType") == "APP_GROUPS" for d in res.get("data", [])):
        return
    st, res = call("POST", "/bundleIdCapabilities", {"data": {
        "type": "bundleIdCapabilities", "attributes": {"capabilityType": "APP_GROUPS"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid_id}}}}})
    print(f"App Groups yeteneği: {st}")


def create_certificate(state) -> None:
    key, csr = WORK / "key.pem", WORK / "csr.pem"
    sh("openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(csr),
       "-subj", "/CN=Orbit CI/O=Orbit")
    st, res = call("POST", "/certificates", {"data": {"type": "certificates", "attributes": {
        "certificateType": "DISTRIBUTION", "csrContent": csr.read_text()}}})
    if st not in (200, 201):
        detail = "; ".join(e.get("detail", "") for e in res.get("errors", []))
        fail(f"Dağıtım sertifikası oluşturulamadı ({st}): {detail}. Sertifika sınırı dolduysa "
             "developer.apple.com → Certificates'ta eski 'Apple Distribution' sertifikalarından birini silin.")
    cert = res["data"]
    state["certificate"] = cert["id"]
    save_state(state)
    der = WORK / "cert.der"
    der.write_bytes(base64.b64decode(cert["attributes"]["certificateContent"]))
    sh("openssl", "x509", "-inform", "DER", "-in", str(der), "-out", str(WORK / "cert.pem"))
    p12 = WORK / "cert.p12"
    # macOS 'security' eski PKCS#12 algoritmalarını bekler: OpenSSL 3'te -legacy, LibreSSL'de varsayılan
    r = sh("openssl", "pkcs12", "-export", "-legacy", "-inkey", str(key), "-in", str(WORK / "cert.pem"),
           "-out", str(p12), "-passout", f"pass:{KC_PASS}", check=False)
    if r.returncode != 0:
        sh("openssl", "pkcs12", "-export", "-inkey", str(key), "-in", str(WORK / "cert.pem"),
           "-out", str(p12), "-passout", f"pass:{KC_PASS}")
    kc = str(WORK / "orbit-ci.keychain-db")
    sh("security", "create-keychain", "-p", KC_PASS, kc)
    sh("security", "set-keychain-settings", "-lut", "21600", kc)
    sh("security", "unlock-keychain", "-p", KC_PASS, kc)
    sh("security", "import", str(p12), "-k", kc, "-P", KC_PASS, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
    sh("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", KC_PASS, kc)
    current = [l.strip().strip('"') for l in sh("security", "list-keychains", "-d", "user").stdout.splitlines() if l.strip()]
    sh("security", "list-keychains", "-d", "user", "-s", kc, *current)
    ids = sh("security", "find-identity", "-v", "-p", "codesigning", kc).stdout
    print(ids.strip())
    state["keychain"] = kc
    save_state(state)
    env_out(SIGN_KEYCHAIN=kc)


def create_profile(state, identifier: str, bid_id: str) -> tuple[str, dict]:
    name = f"Orbit CI {identifier} {os.environ.get('GITHUB_RUN_ID', 'local')}-{os.environ.get('GITHUB_RUN_ATTEMPT', '1')}"
    st, res = call("POST", "/profiles", {"data": {"type": "profiles",
        "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid_id}},
                          "certificates": {"data": [{"type": "certificates", "id": state["certificate"]}]}}}})
    if st not in (200, 201):
        detail = "; ".join(e.get("detail", "") for e in res.get("errors", []))
        fail(f"Profil oluşturulamadı: {identifier} ({st}): {detail}")
    p = res["data"]
    state.setdefault("profiles", []).append(p["id"])
    save_state(state)
    content = base64.b64decode(p["attributes"]["profileContent"])
    uuid = p["attributes"]["uuid"]
    for d in (Path.home() / "Library/MobileDevice/Provisioning Profiles",
              Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles"):
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{uuid}.mobileprovision").write_bytes(content)
    f = WORK / f"{uuid}.mobileprovision"
    f.write_bytes(content)
    decoded = sh("security", "cms", "-D", "-i", str(f)).stdout
    ents = plistlib.loads(decoded.encode()).get("Entitlements", {})
    print(f"✓ profil: {name} · App Group: {ents.get('com.apple.security.application-groups')}")
    return name, ents


def setup():
    WORK.mkdir(parents=True, exist_ok=True)
    state = {}
    bid = os.environ["FT_BUNDLE_ID"]
    group = f"group.{bid}"
    app_id, widget_id = bundle_resource(bid), bundle_resource(bid + ".widget")
    for i in (app_id, widget_id):
        ensure_app_groups_capability(i)
    st, _ = call("GET", "/appGroups?limit=1")
    print(f"App Group API yoklaması: {st}")
    create_certificate(state)
    app_name, app_ents = create_profile(state, bid, app_id)
    widget_name, widget_ents = create_profile(state, bid + ".widget", widget_id)
    ok = all(group in (e.get("com.apple.security.application-groups") or []) for e in (app_ents, widget_ents))
    if not ok:
        print(f"Profillerde {group} yok — App Group yerine ortak keychain ile imzalanır (widget verisi oradan).")
    env_out(PROFILE_APP=app_name, PROFILE_WIDGET=widget_name, APP_GROUP_OK="true" if ok else "false")


def cleanup():
    if not STATE.exists():
        return
    state = json.loads(STATE.read_text())
    for pid in state.get("profiles", []):
        print("profil silindi:", call("DELETE", f"/profiles/{pid}")[0])
    if state.get("certificate"):
        print("sertifika silindi:", call("DELETE", f"/certificates/{state['certificate']}")[0])
    if state.get("keychain"):
        sh("security", "delete-keychain", state["keychain"], check=False)


if __name__ == "__main__":
    {"setup": setup, "cleanup": cleanup}[sys.argv[1]]()
