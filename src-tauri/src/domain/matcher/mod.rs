use std::path::{Path, PathBuf};

use crate::domain::types::{
    FileClassification, MatchConfidence, MatchedPair, ModelSourceType, ParsedIdentity, ScannedFile,
};

#[derive(Debug, Clone)]
pub struct TextureCandidateScore {
    pub path: PathBuf,
    pub score: u32,
    pub evidence: Vec<String>,
}

pub struct TextureMatcher;

impl TextureMatcher {
    pub fn match_model(
        model_path: &Path,
        model_type: ModelSourceType,
        identity: &ParsedIdentity,
        textures: &[ScannedFile],
    ) -> MatchedPair {
        let mut scored_candidates: Vec<TextureCandidateScore> = Vec::new();

        for tex in textures {
            if tex.classification != FileClassification::TextureImage {
                continue;
            }

            let mut score = 0;
            let mut evidence = Vec::new();
            let tex_name = &tex.file_name.to_lowercase();
            let tex_stem = Path::new(&tex.file_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            // 1. Character ID match
            let mut char_matched = false;
            if !identity.character_id.is_empty()
                && tex_name.contains(&identity.character_id.to_lowercase())
            {
                score += 40;
                char_matched = true;
                evidence.push(format!(
                    "Texture name contains character ID '{}'",
                    identity.character_id
                ));
            }

            // 2. Outfit ID match
            // To prevent false substring matches (e.g. char ID "00010" containing "001"),
            // inspect the texture name outside of the character ID occurrence.
            let name_for_outfit = if char_matched {
                tex_name.replacen(&identity.character_id.to_lowercase(), "", 1)
            } else {
                tex_name.clone()
            };

            if !identity.outfit_id.is_empty()
                && name_for_outfit.contains(&identity.outfit_id.to_lowercase())
            {
                score += 30;
                evidence.push(format!(
                    "Texture name contains outfit ID '{}'",
                    identity.outfit_id
                ));
            }

            // 3. Style token match
            if let Some(style) = &identity.style_tag {
                if !style.is_empty() && tex_name.contains(&style.to_lowercase()) {
                    score += 20;
                    evidence.push(format!("Texture name contains style token '{}'", style));
                }
            }

            // 4. Common filename stem
            let model_stem = identity.source_stem.to_lowercase();
            if tex_stem == model_stem {
                score += 25;
                evidence.push("Exact stem match between model and texture".to_string());
            } else if tex_stem.starts_with(&model_stem) || model_stem.starts_with(&tex_stem) {
                score += 15;
                evidence.push("Partial stem prefix match".to_string());
            }

            // 5. Directory proximity
            let model_dir = model_path.parent();
            let tex_dir = tex.path.parent();
            if model_dir.is_some() && model_dir == tex_dir {
                score += 10;
                evidence.push("Texture resides in the same directory as model".to_string());
            } else if let (Some(m_dir), Some(t_dir)) = (model_dir, tex_dir) {
                if t_dir.ends_with("textures") && t_dir.parent() == Some(m_dir) {
                    score += 10;
                    evidence
                        .push("Texture resides in adjacent 'textures' subdirectory".to_string());
                }
            }

            if score > 0 {
                scored_candidates.push(TextureCandidateScore {
                    path: tex.path.clone(),
                    score,
                    evidence,
                });
            }
        }

        // Sort descending by score
        scored_candidates.sort_by_key(|a| std::cmp::Reverse(a.score));

        let model_id = if !identity.character_id.is_empty() && !identity.outfit_id.is_empty() {
            format!("{}_{}", identity.character_id, identity.outfit_id)
        } else {
            identity.source_stem.clone()
        };

        if scored_candidates.is_empty() {
            return MatchedPair {
                id: model_id,
                model_source: model_path.to_path_buf(),
                model_type,
                identity: identity.clone(),
                textures: Vec::new(),
                match_confidence: MatchConfidence::NoMatch,
                evidence: vec![
                    "No candidate PNG textures found with matching identifiers".to_string()
                ],
                warnings: vec!["No matching texture found".to_string()],
            };
        }

        let top_score = scored_candidates[0].score;

        // Check if multiple candidates share the exact top score and it's a qualifying score
        let top_candidates: Vec<_> = scored_candidates
            .iter()
            .filter(|c| c.score == top_score && c.score >= 50)
            .collect();

        if top_candidates.len() > 1 {
            let mut candidate_paths: Vec<_> =
                top_candidates.iter().map(|c| c.path.clone()).collect();
            let candidate_names: Vec<String> = top_candidates
                .iter()
                .filter_map(|c| {
                    c.path
                        .file_name()
                        .and_then(|f| f.to_str())
                        .map(|s| s.to_string())
                })
                .collect();

            // Check if candidates constitute a sequenced multi-atlas set (e.g. texture_00, texture_01)
            if is_multi_atlas_set(&candidate_paths) {
                candidate_paths.sort();
                return MatchedPair {
                    id: model_id,
                    model_source: model_path.to_path_buf(),
                    model_type,
                    identity: identity.clone(),
                    textures: candidate_paths.clone(),
                    match_confidence: MatchConfidence::High,
                    evidence: vec![format!(
                        "Sequenced multi-atlas texture set detected ({} atlases): {:?}",
                        candidate_paths.len(),
                        candidate_names
                    )],
                    warnings: Vec::new(),
                };
            }

            return MatchedPair {
                id: model_id,
                model_source: model_path.to_path_buf(),
                model_type,
                identity: identity.clone(),
                textures: candidate_paths,
                match_confidence: MatchConfidence::Ambiguous,
                evidence: vec![format!(
                    "Conflicting candidates with identical match score {}: {:?}",
                    top_score, candidate_names
                )],
                warnings: vec![format!(
                    "Ambiguous texture match: {} candidates tied for top score",
                    top_candidates.len()
                )],
            };
        }

        let best = &scored_candidates[0];
        let confidence = if best.score >= 90 {
            MatchConfidence::Exact
        } else if best.score >= 50 {
            MatchConfidence::High
        } else {
            MatchConfidence::Ambiguous
        };

        MatchedPair {
            id: model_id,
            model_source: model_path.to_path_buf(),
            model_type,
            identity: identity.clone(),
            textures: vec![best.path.clone()],
            match_confidence: confidence,
            evidence: best.evidence.clone(),
            warnings: Vec::new(),
        }
    }
}

fn is_multi_atlas_set(paths: &[PathBuf]) -> bool {
    if paths.len() <= 1 {
        return false;
    }
    let re = match regex::Regex::new(r"^(.*?)(?:[_\-\s]?(?:texture)?)[_\-]?(\d{1,2})$") {
        Ok(r) => r,
        Err(_) => return false,
    };
    let mut prefixes = Vec::new();
    let mut indices = Vec::new();

    for p in paths {
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if let Some(caps) = re.captures(stem) {
            prefixes.push(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
            if let Ok(idx) = caps.get(2).map(|m| m.as_str()).unwrap_or("").parse::<u32>() {
                indices.push(idx);
            }
        }
    }

    if prefixes.len() == paths.len() && indices.len() == paths.len() {
        let first_prefix = prefixes[0];
        if prefixes.iter().all(|&p| p == first_prefix) {
            indices.sort_unstable();
            indices.dedup();
            return indices.len() == paths.len() && indices[0] <= 1;
        }
    }
    false
}
