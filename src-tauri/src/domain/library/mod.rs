pub mod batch;
pub mod cache;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use crate::domain::types::{
    BuildStatus, CharacterEntry, CharacterLibrary, LibraryFilter, LibraryScanReport, MatchedPair,
    OutfitEntry, StyleFilter,
};

impl CharacterLibrary {
    /// Constructs a deterministic CharacterLibrary from matched pairs.
    /// Deduplicates identical model source paths and guarantees deterministic sorting:
    /// Character ID ascending, then Outfit ID ascending.
    pub fn from_matched_pairs(
        pairs: Vec<MatchedPair>,
        root_paths: Vec<PathBuf>,
        scan_report: LibraryScanReport,
    ) -> Self {
        let mut seen_models: HashSet<PathBuf> = HashSet::new();
        let mut grouped: BTreeMap<String, Vec<OutfitEntry>> = BTreeMap::new();

        for pair in pairs {
            // Deduplicate pairs referencing identical model source
            if seen_models.contains(&pair.model_source) {
                continue;
            }
            seen_models.insert(pair.model_source.clone());

            let char_id = if pair.identity.character_id.is_empty() {
                "unknown".to_string()
            } else {
                pair.identity.character_id.clone()
            };

            let outfit_id = if pair.identity.outfit_id.is_empty() {
                "unknown".to_string()
            } else {
                pair.identity.outfit_id.clone()
            };

            let style_token = pair.identity.style_tag.clone();
            let thumbnail_source = pair.textures.first().cloned();

            let entry = OutfitEntry {
                id: pair.id.clone(),
                character_id: char_id.clone(),
                outfit_id,
                style_token,
                model_source: pair.model_source.clone(),
                model_type: pair.model_type.clone(),
                textures: pair.textures.clone(),
                match_status: pair.match_confidence,
                validation_status: None,
                build_status: None,
                thumbnail_source,
                evidence: pair.evidence.clone(),
                warnings: pair.warnings.clone(),
                matched_pair: pair,
            };

            grouped.entry(char_id).or_default().push(entry);
        }

        let mut characters = Vec::new();
        let mut total_models = 0;
        let mut buildable_models = 0;

        for (char_id, mut outfits) in grouped {
            // Sort outfits deterministically by outfit_id ascending
            outfits.sort_by(|a, b| a.outfit_id.cmp(&b.outfit_id));

            let buildable_count = outfits.iter().filter(|o| o.is_buildable()).count();
            let mut char_warnings = Vec::new();
            for o in &outfits {
                for w in &o.warnings {
                    if !char_warnings.contains(w) {
                        char_warnings.push(w.clone());
                    }
                }
            }

            total_models += outfits.len();
            buildable_models += buildable_count;

            characters.push(CharacterEntry {
                character_id: char_id,
                display_name: None,
                outfits,
                warnings: char_warnings,
                buildable_count,
            });
        }

        // BTreeMap guarantees character_id ascending order
        Self {
            root_paths,
            characters,
            total_models,
            buildable_models,
            scan_report,
        }
    }

    /// Finds a specific outfit by its unique identifier (e.g. "00007_001").
    pub fn find_outfit(&self, id: &str) -> Option<&OutfitEntry> {
        for char_entry in &self.characters {
            for outfit in &char_entry.outfits {
                if outfit.id == id {
                    return Some(outfit);
                }
            }
        }
        None
    }

    /// Finds a specific outfit mutably.
    pub fn find_outfit_mut(&mut self, id: &str) -> Option<&mut OutfitEntry> {
        for char_entry in &mut self.characters {
            for outfit in &mut char_entry.outfits {
                if outfit.id == id {
                    return Some(outfit);
                }
            }
        }
        None
    }

    /// Updates the build status of a specific outfit in the library.
    pub fn update_build_status(&mut self, id: &str, status: BuildStatus) -> bool {
        if let Some(outfit) = self.find_outfit_mut(id) {
            outfit.build_status = Some(status);
            outfit.validation_status = Some(status);
            true
        } else {
            false
        }
    }

    /// Filters the library by search query, status filter, and style filter.
    /// Preserves deterministic sorting order.
    pub fn filter(
        &self,
        query: &str,
        filter: LibraryFilter,
        style_filter: &StyleFilter,
    ) -> Vec<CharacterEntry> {
        let q = query.trim().to_lowercase();

        let mut filtered_chars = Vec::new();

        for char_entry in &self.characters {
            let mut matching_outfits = Vec::new();

            for outfit in &char_entry.outfits {
                // 1. Style filter check
                let matches_style = match style_filter {
                    StyleFilter::All => true,
                    StyleFilter::Nrml => outfit
                        .style_token
                        .as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case("nrml")),
                    StyleFilter::Uniq => outfit
                        .style_token
                        .as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case("uniq")),
                    StyleFilter::Cmmn => outfit
                        .style_token
                        .as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case("cmmn")),
                    StyleFilter::Unknown => {
                        outfit.style_token.is_none()
                            || outfit
                                .style_token
                                .as_deref()
                                .is_some_and(|s| s.eq_ignore_ascii_case("unknown"))
                    }
                    StyleFilter::Custom(c) => outfit
                        .style_token
                        .as_deref()
                        .is_some_and(|s| s.eq_ignore_ascii_case(c)),
                };
                if !matches_style {
                    continue;
                }

                // 2. Status filter check
                let matches_status = match filter {
                    LibraryFilter::All => true,
                    LibraryFilter::Buildable => outfit.is_buildable(),
                    LibraryFilter::Built => matches!(
                        outfit.build_status,
                        Some(BuildStatus::Pass) | Some(BuildStatus::PassWithWarnings)
                    ),
                    LibraryFilter::Warnings => {
                        !outfit.warnings.is_empty()
                            || matches!(outfit.build_status, Some(BuildStatus::PassWithWarnings))
                    }
                    LibraryFilter::Ambiguous => {
                        outfit.match_status == crate::domain::types::MatchConfidence::Ambiguous
                    }
                    LibraryFilter::Failed => matches!(outfit.build_status, Some(BuildStatus::Fail)),
                };
                if !matches_status {
                    continue;
                }

                // 3. Search query check
                if !q.is_empty() {
                    let char_match = char_entry.character_id.to_lowercase().contains(&q);
                    let name_match = char_entry
                        .display_name
                        .as_deref()
                        .is_some_and(|d| d.to_lowercase().contains(&q));
                    let outfit_match = outfit.outfit_id.to_lowercase().contains(&q);
                    let style_match = outfit
                        .style_token
                        .as_deref()
                        .is_some_and(|s| s.to_lowercase().contains(&q));
                    let id_match = outfit.id.to_lowercase().contains(&q);

                    if !char_match && !name_match && !outfit_match && !style_match && !id_match {
                        continue;
                    }
                }

                matching_outfits.push(outfit.clone());
            }

            if !matching_outfits.is_empty() {
                let buildable_count = matching_outfits.iter().filter(|o| o.is_buildable()).count();
                filtered_chars.push(CharacterEntry {
                    character_id: char_entry.character_id.clone(),
                    display_name: char_entry.display_name.clone(),
                    outfits: matching_outfits,
                    warnings: char_entry.warnings.clone(),
                    buildable_count,
                });
            }
        }

        filtered_chars
    }
}
