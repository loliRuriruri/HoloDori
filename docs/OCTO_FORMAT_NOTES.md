# Octo Asset System & `octocacheevai` Technical Specification

> **Classification Authority**: HoloDori Live2D Manager — Reverse Engineering Audit  
> **Status**: VERIFIED  
> **Date**: 2026-10-01  

---

## 1. Overview & Engine Origin

HoloDori (*hololive Dreams*, developed by QualiArts, Inc. under CyberAgent) utilizes the proprietary **Octo** (also referenced as **Octofox**) resource management framework. This framework is identical in architecture to QualiArts' *Gakuen Idolm@ster* (`gkmas`) and *Idoly Pride*.

The client ships with an encrypted manifest file named `octocacheevai`, which serves as the local database index of all server-side and local game assets.

---

## 2. On-Disk File Topology & Bootstrap Assets

### 2.1 File Location
- **Canonical Game Location**: `<GameRoot>/hololive-Dreams_Data/Octo/`
- **Primary Manifest**: `<GameRoot>/hololive-Dreams_Data/Octo/octocacheevai` (5,589,793 bytes)
- **Local Asset List**: `<GameRoot>/hololive-Dreams_Data/Octo/l` (9,961 bytes, 243 entries)
- **Local Sharded Cache Folders**: `<GameRoot>/hololive-Dreams_Data/Octo/0/` through `.../9/`

### 2.2 Sharding Scheme [VERIFIED]
Local bootstrap assets are sharded into 10 folders (`0` to `9`) based on the final character of their identifier:
- Identifier format: `A<ID>` (AssetBundle) or `R<ID>` (Resource, e.g. CRI Audio `.acb`/`.awb`, video `.usm`)
- Filename on disk: Hex-encoded ASCII representation of the code.
  - Example: `A20757` -> Hex string `413230373537` placed inside folder `7`.
  - Example: `R14125` -> Hex string `523134313235.acb` placed inside folder `5`.

### 2.3 Bootstrap Set in `l` [VERIFIED]
The file `l` contains 243 entries defining the assets bundled directly with the Steam client installer:
- 138 Voice cue sheets (`vo_*`)
- 29 Textures (`t_*`)
- 23 FBX geometry meshes (`fbx_*`)
- 21 Visual components (`vis_*`)
- 16 Particles/effects (`eff_*`)
- Common shaders and environment models.
- **Live2D Models Present Locally**: **0** (All Live2D models are remote on-demand assets).

---

## 3. `octocacheevai` Binary Format

### 3.1 Outer Container [VERIFIED]
```text
+--------+-------------------------------------------------------------+
| Byte 0 | Bytes 1 .. N                                                |
| 0x01   | AES-128-CBC Ciphertext (multiple of 16 bytes, PKCS7 padded) |
+--------+-------------------------------------------------------------+
```
- **Byte 0**: Magic format version marker. Must equal `0x01`.
- **Bytes 1..End**: AES-128-CBC encrypted payload.

### 3.2 Cryptographic Parameters [VERIFIED]
- **Cipher**: AES-128 in CBC mode with PKCS#7 padding
- **Key (16 bytes hex)**: `976729e24e8017e09027ef52080eb84b`
- **IV (16 bytes hex)**: `1c6e6f9255c0e5412712f4010225e378`

### 3.3 Decrypted Plaintext Structure [VERIFIED]
```text
+-----------------------+----------------------------------------------+
| Bytes 0 .. 15         | Bytes 16 .. End                              |
| MD5 Checksum (16 B)   | Serialized Protocol Buffers (octodb.Database)|
+-----------------------+----------------------------------------------+
```
- **Integrity Verification**: `MD5(plaintext[16..]) == plaintext[0..16]`
  - Tested on revision 20: Expected `6733a78790e6c97cc4b95716789b5fbb`, Computed `6733a78790e6c97cc4b95716789b5fbb` (Exact match).

---

## 4. Protobuf Schema (`octodb.proto`)

```protobuf
syntax = "proto3";

package octodb;

message Data {
  int32 id = 1;                     // Internal asset index
  string name = 2;                  // Canonical semantic asset bundle name
  int32 size = 3;                   // Expected remote payload size in bytes
  uint32 crc = 4;                   // CRC32 checksum
  string md5 = 5;                   // MD5 hex checksum of the remote payload
  repeated int32 dependencies = 6;  // IDs of dependent asset bundles
  string objectName = 7;            // Remote URL object key (e.g., "DCgZ7m")
  repeated string addresses = 8;    // Unity Addressable asset keys
}

message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}

message Database {
  int32 revisionId = 1;                         // Master catalog revision (currently 20)
  repeated Data assetBundleList = 2;            // 25,419 AssetBundle entries
  repeated Data resourceList = 3;               // 19,480 Resource entries (audio/video/config)
  string urlFormat = 4;                         // Remote CDN template, e.g. "https://asset.review-game-hololive-dreams.com/{o}"
  repeated int32 rollbackRevisionIds = 5;
  repeated Timestamp rollbackTimes = 6;
  int64 serverTime = 7;
}
```

---

## 5. Header Deobfuscation Algorithm

Downloaded Unity asset bundles (`kind == "asset"`) and audio/video resources (`kind == "resource"`) do not begin directly with standard file headers. Their headers are masked by Octo's proprietary stream filter.

### 5.1 Asset Bundle Mask Generation (`create_hash_mask`) [VERIFIED]
For asset bundles, the mask is derived deterministically from the ASCII string of `item.name`:
1. `size = len(name) * 2`
2. Initialize byte array `mask` of length `size`.
3. For index $i$ in `0..len(name)-1`:
   - $c = \text{ord}(name[i])$
   - $mask[2i] = c$
   - $mask[size - 1 - 2i] = \sim c \pmod{256}$
4. Initialize `rolling = 0x7C` (constant from `Vision.Octo.StreamProxy.BytesToHash`).
5. For each byte $b$ in `mask`:
   - $rolling = (((rolling \ll 7) \mid (rolling \gg 1)) \oplus b) \pmod{256}$
6. For each byte in `mask`:
   - $mask[j] = mask[j] \oplus rolling$

### 5.2 Header Unmasking [VERIFIED]
For asset bundles:
- If first 5 bytes are already `Unity`, no deobfuscation is needed.
- Otherwise, XOR the first 256 bytes (`limit = min(256, data.len())`) with `mask[i % mask.len()]`.
- **Result**: The file header becomes valid `UnityFS\0\0\0\0\x08 5.x.`!

### 5.3 Resource Unmasking (`QUAVMAGIC`) [VERIFIED]
For raw media resources (CRI ADX2 audio `.acb`/`.awb`, Sofdec2 video `.usm`):
- If data starts with 9-byte ASCII magic `QUAVMAGIC`:
  - Slice off the first 9 bytes.
  - Apply the XOR hash mask (derived from the full resource name) to the leading 256 bytes.
  - Resulting headers: `@UTF` (`.acb`/`.acf`), `AFS2` (`.awb`), `CRID` (`.usm`).

---

## 6. Remote CDN Acquisition Protocol

- **Endpoint Template**: `https://asset.review-game-hololive-dreams.com/{o}`
- **Parameter `{o}`**: The `objectName` field from `octodb.Data`.
- **Transport**: Standard HTTPS GET / HEAD requests.
- **Authentication**: **NONE REQUIRED** (Public HTTP 200).
- **Integrity Validation**: Compare downloaded bytes length against `item.size` and MD5 digest against `item.md5`.
