#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Firma criptográfica GPG estándar para paquetes Debian (.deb) y sumas SHA256.
- Inserta la firma oficial `_gpgorigin` dentro del archivo `ar` del `.deb` (formato debsig/Debian)
  manteniendo compatibilidad total con `dpkg`, `apt`, `PackageKit` y `snap-store` (App Center).
- Genera firma ASCII separada (`.deb.asc`), suma firmada (`SHA256SUMS.txt.asc`)
  y exporta la clave pública (`recursos-cockpit-archive-keyring.gpg` y `.asc`).
"""

import base64
import os
import shutil
import subprocess
import sys
import tempfile


KEY_UID_NAME = "cminewarIA (Recursos Cockpit Signing)"
KEY_UID_EMAIL = "cminewarIA@users.noreply.github.com"


def _parse_ar_archive(deb_bytes: bytes):
    if not deb_bytes.startswith(b"!<arch>\n"):
        raise ValueError("El archivo no es un paquete Debian 'ar' válido")
    pos = 8
    members = []
    n = len(deb_bytes)
    while pos < n:
        if pos + 60 > n:
            raise ValueError("Cabecera 'ar' truncada")
        header = deb_bytes[pos : pos + 60]
        pos += 60
        name = header[0:16].decode("ascii", errors="replace").rstrip(" /")
        size_str = header[48:58].decode("ascii", errors="replace").strip()
        size = int(size_str)
        payload = deb_bytes[pos : pos + size]
        pos += size
        if pos % 2 == 1 and pos < n and deb_bytes[pos : pos + 1] == b"\n":
            pos += 1
        members.append((name, header, payload))
    return members


def _build_ar_member(name: str, payload: bytes, mtime: int = 0) -> bytes:
    name_field = f"{name:<16}"[:16].encode("ascii")
    mtime_field = f"{mtime:<12}"[:12].encode("ascii")
    uid_field = f"{0:<6}".encode("ascii")
    gid_field = f"{0:<6}".encode("ascii")
    mode_field = f"{'100644':<8}".encode("ascii")
    size_field = f"{len(payload):<10}"[:10].encode("ascii")
    end_marker = b"`\n"
    header = name_field + mtime_field + uid_field + gid_field + mode_field + size_field + end_marker
    assert len(header) == 60, f"Invalid ar header length: {len(header)}"
    out = header + payload
    if len(payload) % 2 == 1:
        out += b"\n"
    return out


def _ensure_gpg_signing_key(gpg_home: str, passphrase: str = ""):
    env = dict(os.environ)
    env["GNUPGHOME"] = gpg_home
    os.makedirs(gpg_home, exist_ok=True)
    os.chmod(gpg_home, 0o700)

    # 1. Importar desde DEB_GPG_PRIVATE_KEY si está presente (CI / GitHub Actions)
    raw_priv = os.environ.get("DEB_GPG_PRIVATE_KEY", "").strip()
    if raw_priv:
        key_bytes = raw_priv.encode("utf-8")
        if "BEGIN PGP PRIVATE KEY BLOCK" not in raw_priv:
            try:
                key_bytes = base64.b64decode(raw_priv)
            except Exception:
                pass
        subprocess.run(
            ["gpg", "--batch", "--yes", "--import"],
            input=key_bytes,
            env=env,
            check=True,
            capture_output=True,
        )

    # 2. Comprobar si ya existe una clave secreta en gpg_home
    res = subprocess.run(
        ["gpg", "--batch", "--list-secret-keys", "--with-colons"],
        env=env,
        capture_output=True,
        text=True,
    )
    key_fpr = ""
    for line in res.stdout.splitlines():
        if line.startswith("fpr:"):
            key_fpr = line.split(":")[9]
            break

    # 3. Intentar usar la clave del entorno de usuario si gpg_home está vacío
    if not key_fpr:
        default_gnupg = os.path.expanduser("~/.gnupg")
        if os.path.isdir(default_gnupg) and os.path.abspath(default_gnupg) != os.path.abspath(gpg_home):
            res_def = subprocess.run(
                ["gpg", "--batch", "--list-secret-keys", "--with-colons"],
                capture_output=True,
                text=True,
            )
            for line in res_def.stdout.splitlines():
                if line.startswith("fpr:"):
                    key_fpr = line.split(":")[9]
                    env = dict(os.environ)
                    gpg_home = default_gnupg
                    break

    # 4. Generar una clave local persistente si no existía ninguna todavía
    if not key_fpr:
        batch_spec = (
            "%echo Generating Recursos Cockpit Debian signing key\n"
            "Key-Type: RSA\n"
            "Key-Length: 3072\n"
            "Subkey-Type: RSA\n"
            "Subkey-Length: 3072\n"
            f"Name-Real: {KEY_UID_NAME}\n"
            f"Name-Email: {KEY_UID_EMAIL}\n"
            "Expire-Date: 0\n"
            "%no-protection\n"
            "%commit\n"
        )
        subprocess.run(
            ["gpg", "--batch", "--yes", "--gen-key"],
            input=batch_spec.encode("utf-8"),
            env=env,
            check=True,
            capture_output=True,
        )
        res = subprocess.run(
            ["gpg", "--batch", "--list-secret-keys", "--with-colons"],
            env=env,
            capture_output=True,
            text=True,
        )
        for line in res.stdout.splitlines():
            if line.startswith("fpr:"):
                key_fpr = line.split(":")[9]
                break

    if not key_fpr:
        raise RuntimeError("No se pudo inicializar ninguna clave GPG para firmar el paquete .deb")
    return env, key_fpr


def _gpg_detach_sign(payload: bytes, env: dict, key_fpr: str, passphrase: str = "", armor: bool = True) -> bytes:
    cmd = [
        "gpg",
        "--batch",
        "--yes",
        "--pinentry-mode",
        "loopback",
        "--local-user",
        key_fpr,
        "--detach-sign",
    ]
    if armor:
        cmd.append("--armor")
    if passphrase:
        cmd.extend(["--passphrase", passphrase])
    proc = subprocess.run(cmd, input=payload, env=env, check=True, capture_output=True)
    return proc.stdout


def sign_deb_package(deb_path: str, project_root: str):
    if not shutil.which("gpg"):
        print("⚠️ [SIGN] gpg no está instalado; se omite firma GPG.", file=sys.stderr)
        return False

    deb_path = os.path.abspath(deb_path)
    dist_dir = os.path.dirname(deb_path)
    passphrase = os.environ.get("DEB_GPG_PASSPHRASE", "")

    if os.environ.get("DEB_GPG_PRIVATE_KEY", "").strip():
        gpg_home = tempfile.mkdtemp(prefix="recursos_gpg_")
        cleanup_gpg = True
    else:
        gpg_home = os.path.expanduser("~/.config/recursos-cockpit/gpg")
        cleanup_gpg = False

    try:
        env, key_fpr = _ensure_gpg_signing_key(gpg_home, passphrase=passphrase)

        # 1. Exportar clave pública (keyring binario y ASCII)
        keyring_bin = subprocess.run(
            ["gpg", "--batch", "--yes", "--export", key_fpr],
            env=env,
            check=True,
            capture_output=True,
        ).stdout
        keyring_asc = subprocess.run(
            ["gpg", "--batch", "--yes", "--armor", "--export", key_fpr],
            env=env,
            check=True,
            capture_output=True,
        ).stdout

        dist_keyring = os.path.join(dist_dir, "recursos-cockpit-archive-keyring.gpg")
        dist_pub_asc = os.path.join(dist_dir, "recursos-cockpit-signing-key.asc")
        with open(dist_keyring, "wb") as f:
            f.write(keyring_bin)
        with open(dist_pub_asc, "wb") as f:
            f.write(keyring_asc)

        repo_keys_dir = os.path.join(project_root, "packaging", "keys")
        os.makedirs(repo_keys_dir, exist_ok=True)
        with open(os.path.join(repo_keys_dir, "recursos-cockpit-signing-key.asc"), "wb") as f:
            f.write(keyring_asc)

        # 2. Leer miembros estándar del archivo .deb e insertar firma _gpgorigin (estándar debsigs)
        with open(deb_path, "rb") as f:
            raw_deb = f.read()
        members = _parse_ar_archive(raw_deb)
        base_members = [m for m in members if not m[0].startswith("_gpg")]
        sign_input = b"".join(payload for _, _, payload in base_members)
        gpg_origin_sig = _gpg_detach_sign(sign_input, env=env, key_fpr=key_fpr, passphrase=passphrase, armor=True)

        rebuilt = bytearray(b"!<arch>\n")
        for _, header, payload in base_members:
            rebuilt.extend(header)
            rebuilt.extend(payload)
            if len(payload) % 2 == 1:
                rebuilt.extend(b"\n")
        rebuilt.extend(_build_ar_member("_gpgorigin", gpg_origin_sig))

        with open(deb_path, "wb") as f:
            f.write(bytes(rebuilt))

        # 3. Generar firma ASCII separada del .deb completo (.deb.asc)
        deb_asc = _gpg_detach_sign(bytes(rebuilt), env=env, key_fpr=key_fpr, passphrase=passphrase, armor=True)
        with open(deb_path + ".asc", "wb") as f:
            f.write(deb_asc)

        print(f"🔐 [SIGN] Paquete .deb firmado con clave GPG {key_fpr[-16:]} (_gpgorigin + .asc)")
        return True
    finally:
        if cleanup_gpg and os.path.isdir(gpg_home):
            shutil.rmtree(gpg_home, ignore_errors=True)


def sign_sha256sums(sha_path: str):
    if not shutil.which("gpg") or not os.path.isfile(sha_path):
        return False
    passphrase = os.environ.get("DEB_GPG_PASSPHRASE", "")
    if os.environ.get("DEB_GPG_PRIVATE_KEY", "").strip():
        gpg_home = tempfile.mkdtemp(prefix="recursos_gpg_sha_")
        cleanup_gpg = True
    else:
        gpg_home = os.path.expanduser("~/.config/recursos-cockpit/gpg")
        cleanup_gpg = False
    try:
        env, key_fpr = _ensure_gpg_signing_key(gpg_home, passphrase=passphrase)
        with open(sha_path, "rb") as f:
            payload = f.read()
        sig = _gpg_detach_sign(payload, env=env, key_fpr=key_fpr, passphrase=passphrase, armor=True)
        with open(sha_path + ".asc", "wb") as f:
            f.write(sig)
        print(f"🔐 [SIGN] SHA256SUMS.txt.asc generado correctamente")
        return True
    finally:
        if cleanup_gpg and os.path.isdir(gpg_home):
            shutil.rmtree(gpg_home, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: sign_deb.py <ruta_al_deb> [--sha <ruta_SHA256SUMS.txt>] [--sha-only <ruta_SHA256SUMS.txt>]", file=sys.stderr)
        sys.exit(1)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    proj_root = os.path.abspath(os.path.join(script_dir, ".."))
    if sys.argv[1] == "--sha-only" and len(sys.argv) >= 3:
        sign_sha256sums(sys.argv[2])
        sys.exit(0)
    target_deb = sys.argv[1]
    sign_deb_package(target_deb, proj_root)
    if "--sha" in sys.argv:
        idx = sys.argv.index("--sha")
        if idx + 1 < len(sys.argv):
            sign_sha256sums(sys.argv[idx + 1])
