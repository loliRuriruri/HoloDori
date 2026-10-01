use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;
type Aes128CbcEnc = cbc::Encryptor<aes::Aes128>;

pub const FILE_KEY: [u8; 16] = [
    0x97, 0x67, 0x29, 0xe2, 0x4e, 0x80, 0x17, 0xe0, 0x90, 0x27, 0xef, 0x52, 0x08, 0x0e, 0xb8, 0x4b,
];
pub const FILE_IV: [u8; 16] = [
    0x1c, 0x6e, 0x6f, 0x92, 0x55, 0xc0, 0xe5, 0x41, 0x27, 0x12, 0xf4, 0x01, 0x02, 0x25, 0xe3, 0x78,
];

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct OctoItem {
    pub id: i32,
    pub name: String,
    pub size: i32,
    pub crc: u32,
    pub md5: String,
    pub dependencies: Vec<i32>,
    pub object_name: String,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct OctoDatabase {
    pub revision_id: i32,
    pub url_format: String,
    pub asset_bundles: Vec<OctoItem>,
    pub resources: Vec<OctoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OctoAuditReport {
    pub revision_id: i32,
    pub url_format: String,
    pub total_asset_bundles: usize,
    pub total_resources: usize,
    pub live2d_model_bundles: usize,
    pub live2d_motion_bundles: usize,
    pub live2d_expression_bundles: usize,
    pub total_live2d_bundles: usize,
    pub language_distribution: BTreeMap<String, usize>,
    pub known_models: BTreeMap<String, Option<OctoItem>>,
}

pub fn read_varint(buf: &[u8], offset: &mut usize) -> Result<u64, String> {
    let mut res: u64 = 0;
    let mut shift = 0;
    while *offset < buf.len() {
        let b = buf[*offset];
        *offset += 1;
        res |= ((b & 0x7F) as u64) << shift;
        if (b & 0x80) == 0 {
            return Ok(res);
        }
        shift += 7;
        if shift > 64 {
            return Err("Varint overflow".to_string());
        }
    }
    Err("Unexpected EOF reading varint".to_string())
}

pub fn write_varint(val: u64, buf: &mut Vec<u8>) {
    let mut v = val;
    loop {
        if (v & !0x7F) == 0 {
            buf.push(v as u8);
            return;
        } else {
            buf.push(((v & 0x7F) | 0x80) as u8);
            v >>= 7;
        }
    }
}

pub fn parse_octo_item(buf: &[u8]) -> Result<OctoItem, String> {
    let mut offset = 0;
    let mut item = OctoItem::default();

    while offset < buf.len() {
        let tag = read_varint(buf, &mut offset)?;
        let field_num = (tag >> 3) as i32;
        let wire_type = (tag & 7) as u8;

        match wire_type {
            0 => {
                let val = read_varint(buf, &mut offset)?;
                match field_num {
                    1 => item.id = val as i32,
                    3 => item.size = val as i32,
                    4 => item.crc = val as u32,
                    6 => item.dependencies.push(val as i32),
                    _ => {}
                }
            }
            1 => {
                offset += 8;
            }
            2 => {
                let len = read_varint(buf, &mut offset)? as usize;
                if offset + len > buf.len() {
                    return Err("Length delimited chunk exceeds bounds".to_string());
                }
                let bytes = &buf[offset..offset + len];
                offset += len;
                let s = String::from_utf8_lossy(bytes).to_string();
                match field_num {
                    2 => item.name = s,
                    5 => item.md5 = s,
                    7 => item.object_name = s,
                    8 => item.addresses.push(s),
                    _ => {}
                }
            }
            5 => {
                offset += 4;
            }
            _ => return Err(format!("Unsupported wire type: {}", wire_type)),
        }
    }

    Ok(item)
}

pub fn parse_octocache_bytes(raw: &[u8]) -> Result<OctoDatabase, String> {
    if raw.is_empty() {
        return Err("Empty octocache file".to_string());
    }
    if raw[0] != 1 {
        return Err(format!(
            "Invalid octocache marker: expected 1, found {}",
            raw[0]
        ));
    }

    let ciphertext = &raw[1..];
    if ciphertext.is_empty() || !ciphertext.len().is_multiple_of(16) {
        return Err(format!(
            "Ciphertext length {} is not a non-zero multiple of 16",
            ciphertext.len()
        ));
    }

    let decryptor = Aes128CbcDec::new(&FILE_KEY.into(), &FILE_IV.into());
    let mut buf = ciphertext.to_vec();
    let plaintext = decryptor
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|e| format!("PKCS7 unpadding error: {:?}", e))?;

    if plaintext.len() < 16 {
        return Err("Decrypted data is shorter than 16-byte MD5 header".to_string());
    }

    let expected_md5 = &plaintext[..16];
    let payload = &plaintext[16..];

    let mut hasher = Md5::new();
    hasher.update(payload);
    let actual_md5 = hasher.finalize();

    if expected_md5 != actual_md5.as_slice() {
        return Err("Octocache MD5 checksum verification failed".to_string());
    }

    let mut db = OctoDatabase::default();
    let mut offset = 0;

    while offset < payload.len() {
        let tag = read_varint(payload, &mut offset)?;
        let field_num = (tag >> 3) as i32;
        let wire_type = (tag & 7) as u8;

        match wire_type {
            0 => {
                let val = read_varint(payload, &mut offset)?;
                if field_num == 1 {
                    db.revision_id = val as i32;
                }
            }
            1 => {
                offset += 8;
            }
            2 => {
                let len = read_varint(payload, &mut offset)? as usize;
                if offset + len > payload.len() {
                    return Err("Database chunk exceeds bounds".to_string());
                }
                let chunk = &payload[offset..offset + len];
                offset += len;

                match field_num {
                    2 => {
                        let item = parse_octo_item(chunk)?;
                        db.asset_bundles.push(item);
                    }
                    3 => {
                        let item = parse_octo_item(chunk)?;
                        db.resources.push(item);
                    }
                    4 => {
                        db.url_format = String::from_utf8_lossy(chunk).to_string();
                    }
                    _ => {}
                }
            }
            5 => {
                offset += 4;
            }
            _ => return Err(format!("Unsupported wire type in root DB: {}", wire_type)),
        }
    }

    Ok(db)
}

/// Generates the deterministic XOR mask derived from an asset name.
pub fn create_hash_mask(name: &str) -> Vec<u8> {
    if name.is_empty() {
        return Vec::new();
    }
    let size = name.len() * 2;
    let mut mask = vec![0u8; size];
    let tail = size - 1;

    for (i, c) in name.chars().enumerate() {
        let val = c as u32;
        let byte_val = (val & 0xFF) as u8;
        mask[i * 2] = byte_val;
        mask[tail - i * 2] = !byte_val;
    }

    let mut rolling: u8 = 0x7C;
    for &b in &mask {
        rolling = (((rolling & 1) << 7) | (rolling >> 1)) ^ b;
    }
    for b in &mut mask {
        *b ^= rolling;
    }

    mask
}

/// Deobfuscates the leading 256 bytes of an asset bundle using the asset name mask.
pub fn deobfuscate_bundle_header(data: &mut [u8], asset_name: &str) {
    if data.starts_with(b"Unity") {
        return;
    }
    let mask = create_hash_mask(asset_name);
    if mask.is_empty() {
        return;
    }
    let limit = 256.min(data.len());
    for i in 0..limit {
        data[i] ^= mask[i % mask.len()];
    }
}

/// Encrypts a synthetic payload for unit testing.
pub fn build_synthetic_octocache(revision: i32, url_format: &str, items: &[OctoItem]) -> Vec<u8> {
    let mut payload = Vec::new();

    // Field 1: revisionId (varint)
    write_varint(1 << 3, &mut payload);
    write_varint(revision as u64, &mut payload);

    // Field 2: assetBundleList
    for item in items {
        let mut item_buf = Vec::new();
        // Item field 1: id
        write_varint(1 << 3, &mut item_buf);
        write_varint(item.id as u64, &mut item_buf);
        // Item field 2: name
        write_varint((2 << 3) | 2, &mut item_buf);
        write_varint(item.name.len() as u64, &mut item_buf);
        item_buf.extend_from_slice(item.name.as_bytes());
        // Item field 3: size
        write_varint(3 << 3, &mut item_buf);
        write_varint(item.size as u64, &mut item_buf);
        // Item field 5: md5
        if !item.md5.is_empty() {
            write_varint((5 << 3) | 2, &mut item_buf);
            write_varint(item.md5.len() as u64, &mut item_buf);
            item_buf.extend_from_slice(item.md5.as_bytes());
        }
        // Item field 7: objectName
        if !item.object_name.is_empty() {
            write_varint((7 << 3) | 2, &mut item_buf);
            write_varint(item.object_name.len() as u64, &mut item_buf);
            item_buf.extend_from_slice(item.object_name.as_bytes());
        }

        write_varint((2 << 3) | 2, &mut payload);
        write_varint(item_buf.len() as u64, &mut payload);
        payload.extend_from_slice(&item_buf);
    }

    // Field 4: urlFormat
    write_varint((4 << 3) | 2, &mut payload);
    write_varint(url_format.len() as u64, &mut payload);
    payload.extend_from_slice(url_format.as_bytes());

    // Compute MD5
    let mut hasher = Md5::new();
    hasher.update(&payload);
    let md5_bytes = hasher.finalize();

    // Plaintext = md5 + payload
    let mut plaintext = Vec::new();
    plaintext.extend_from_slice(md5_bytes.as_slice());
    plaintext.extend_from_slice(&payload);

    // Encrypt with PKCS7 padding
    let encryptor = Aes128CbcEnc::new(&FILE_KEY.into(), &FILE_IV.into());
    let pt_len = plaintext.len();
    let mut ciphertext = plaintext;
    ciphertext.resize(pt_len + 16, 0);
    let ct_len = encryptor
        .encrypt_padded_mut::<Pkcs7>(&mut ciphertext, pt_len)
        .expect("PKCS7 encrypt failed")
        .len();
    ciphertext.truncate(ct_len);

    // Final buffer: marker 0x01 + ciphertext
    let mut result = Vec::with_capacity(1 + ciphertext.len());
    result.push(1u8);
    result.extend_from_slice(&ciphertext);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_octocache_roundtrip() {
        let items = vec![OctoItem {
            id: 101,
            name: "live2d_mdl_00001-nrml-0000-00".to_string(),
            size: 3000000,
            crc: 0,
            md5: "abc123md5".to_string(),
            dependencies: Vec::new(),
            object_name: "obj_test_101".to_string(),
            addresses: Vec::new(),
        }];

        let synthetic = build_synthetic_octocache(42, "https://asset.example.com/{o}", &items);
        let parsed = parse_octocache_bytes(&synthetic).expect("synthetic parse should succeed");

        assert_eq!(parsed.revision_id, 42);
        assert_eq!(parsed.url_format, "https://asset.example.com/{o}");
        assert_eq!(parsed.asset_bundles.len(), 1);
        assert_eq!(parsed.asset_bundles[0].id, 101);
        assert_eq!(
            parsed.asset_bundles[0].name,
            "live2d_mdl_00001-nrml-0000-00"
        );
        assert_eq!(parsed.asset_bundles[0].size, 3000000);
        assert_eq!(parsed.asset_bundles[0].object_name, "obj_test_101");
    }

    #[test]
    fn test_invalid_marker() {
        let synthetic = build_synthetic_octocache(1, "https://test/{o}", &[]);
        let mut corrupted = synthetic.clone();
        corrupted[0] = 0x02; // invalid marker
        let err = parse_octocache_bytes(&corrupted).unwrap_err();
        assert!(err.contains("Invalid octocache marker"));
    }

    #[test]
    fn test_corrupted_md5() {
        let mut synthetic = build_synthetic_octocache(1, "https://test/{o}", &[]);
        // Corrupt one byte of ciphertext (will corrupt decrypted plaintext MD5/payload)
        if synthetic.len() > 20 {
            synthetic[20] ^= 0xFF;
        }
        let res = parse_octocache_bytes(&synthetic);
        assert!(res.is_err());
    }

    #[test]
    fn test_hash_mask_and_bundle_deobfuscation() {
        let asset_name = "live2d_mdl_00007-nrml-0008-00";
        // Observed obfuscated leading 16 bytes for DCgZ7m
        let mut test_header = [
            0xF7, 0x6F, 0xCE, 0x75, 0xC1, 0x5A, 0xF8, 0x09, 0xFC, 0x01, 0xAA, 0x09, 0xA4, 0x2F,
            0xDB, 0x32,
        ];

        deobfuscate_bundle_header(&mut test_header, asset_name);
        assert_eq!(&test_header[..7], b"UnityFS");
    }
}
