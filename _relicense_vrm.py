# VRM(0.x) 파일의 라이선스 칸만 고쳐 쓴다.
#
#   python _relicense_vrm.py static/avatar.vrm static/wardrobe/교복.vrm ...
#
# 만든이가 본인인 아바타를 VRoid 에서 다시 내보내지 않고
# 재배포 금지(Redistribution_Prohibited)를 푸는 데 쓴다.
# 모양·뼈·텍스처는 한 바이트도 안 건드린다 — glb 의 JSON 덩어리만 갈아 끼운다.
import json
import shutil
import struct
import sys

LICENSE = "CC_BY_NC"
COMMERCIAL = "Disallow"      # NC 와 맞춘다


def relicense(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, _total = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", path + " 는 glb 가 아니다"
    jlen, jtype = struct.unpack_from("<I4s", data, 12)
    assert jtype == b"JSON"
    doc = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]                      # BIN 덩어리 그대로

    meta = doc["extensions"]["VRM"]["meta"]
    before = (meta.get("licenseName"), meta.get("commercialUssageName"))
    meta["licenseName"] = LICENSE
    meta["commercialUssageName"] = COMMERCIAL

    js = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)                  # glb 는 4바이트 맞춤, 빈칸으로 채운다
    body = struct.pack("<I4s", len(js), b"JSON") + js + rest
    out = struct.pack("<4sII", b"glTF", ver, 12 + len(body)) + body

    shutil.copy2(path, path + ".bak_license")
    with open(path, "wb") as f:
        f.write(out)
    print(f"{path}: {before} -> {(LICENSE, COMMERCIAL)}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        relicense(p)
