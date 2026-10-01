use std::collections::HashMap;
use std::path::Path;
use regex::Regex;

use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::types::{MatchConfidence, ParsedIdentity};

#[derive(Debug, Clone)]
pub struct NamingRuleConfig {
    pub outfit_to_style: HashMap<String, String>,
}

impl Default for NamingRuleConfig {
    fn default() -> Self {
        let mut map = HashMap::new();
        map.insert("001".to_string(), "nrml".to_string());
        map.insert("002".to_string(), "cmmn".to_string());
        map.insert("003".to_string(), "uniq".to_string());
        // Note: Outfit "004" is intentionally NOT hard-coded per Section 6 instructions.
        Self { outfit_to_style: map }
    }
}

pub struct IdentityParser {
    config: NamingRuleConfig,
    regex_standard_delimited: Regex,
    regex_compact: Regex,
    regex_any_5_3: Regex,
}

impl IdentityParser {
    pub fn new(config: NamingRuleConfig) -> Self {
        Self {
            config,
            // Matches e.g. "model_12345_001" or "12345_001_nrml" or "char_12345_001"
            regex_standard_delimited: Regex::new(
                r"(?:^|[^0-9])(?P<char>\d{5})[_-](?P<outfit>\d{3})(?:[_-](?P<style>[a-zA-Z]+))?(?:[^0-9]|$)",
            ).expect("valid regex"),
            // Matches e.g. "12345001" or "12345001_nrml"
            regex_compact: Regex::new(
                r"(?:^|[^0-9])(?P<char>\d{5})(?P<outfit>\d{3})(?:[_-](?P<style>[a-zA-Z]+))?(?:[^0-9]|$)",
            ).expect("valid regex"),
            // Pattern to detect all 5-digit candidate sequences for ambiguity detection
            regex_any_5_3: Regex::new(r"\d{5}").expect("valid regex"),
        }
    }

    pub fn parse_path(&self, path: &Path) -> Result<ParsedIdentity, DomainError> {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        self.parse_name(stem)
    }

    pub fn parse_name(&self, name: &str) -> Result<ParsedIdentity, DomainError> {
        let mut evidence = Vec::new();

        // Check for multiple distinct 5-digit sequences (which would create ambiguity)
        let five_digit_matches: Vec<_> = self.regex_any_5_3.find_iter(name).collect();
        if five_digit_matches.len() > 1 {
            // Check if they are distinct
            let first_val = five_digit_matches[0].as_str();
            let has_different = five_digit_matches.iter().any(|m| m.as_str() != first_val);
            if has_different {
                return Ok(ParsedIdentity {
                    character_id: "".to_string(),
                    outfit_id: "".to_string(),
                    style_tag: None,
                    confidence: MatchConfidence::Ambiguous,
                    evidence: vec![format!(
                        "Multiple distinct 5-digit character identifiers found in '{}'",
                        name
                    )],
                    source_stem: name.to_string(),
                });
            }
        }

        // Try standard delimited pattern first
        if let Some(caps) = self.regex_standard_delimited.captures(name) {
            let char_id = caps.name("char").unwrap().as_str().to_string();
            let outfit_id = caps.name("outfit").unwrap().as_str().to_string();
            evidence.push(format!("Matched delimited pattern: char={}, outfit={}", char_id, outfit_id));

            let explicit_style = caps.name("style").map(|s| s.as_str().to_lowercase());
            let mapped_style = self.config.outfit_to_style.get(&outfit_id).cloned();

            let (style_tag, confidence) = match (explicit_style, mapped_style) {
                (Some(exp), Some(mapped)) => {
                    if exp == mapped {
                        evidence.push(format!("Explicit style '{}' matches known mapping for outfit {}", exp, outfit_id));
                        (Some(exp), MatchConfidence::Exact)
                    } else {
                        evidence.push(format!("Explicit style '{}' differs from default mapped style '{}'", exp, mapped));
                        (Some(exp), MatchConfidence::High)
                    }
                }
                (Some(exp), None) => {
                    evidence.push(format!("Explicit style '{}' found; outfit {} has no default mapping", exp, outfit_id));
                    (Some(exp), MatchConfidence::High)
                }
                (None, Some(mapped)) => {
                    evidence.push(format!("Derived style '{}' from outfit ID {}", mapped, outfit_id));
                    (Some(mapped), MatchConfidence::High)
                }
                (None, None) => {
                    evidence.push(format!("No style tag specified and no default rule for outfit ID {}", outfit_id));
                    (None, MatchConfidence::High)
                }
            };

            return Ok(ParsedIdentity {
                character_id: char_id,
                outfit_id,
                style_tag,
                confidence,
                evidence,
                source_stem: name.to_string(),
            });
        }

        // Try compact pattern
        if let Some(caps) = self.regex_compact.captures(name) {
            let char_id = caps.name("char").unwrap().as_str().to_string();
            let outfit_id = caps.name("outfit").unwrap().as_str().to_string();
            evidence.push(format!("Matched compact pattern: char={}, outfit={}", char_id, outfit_id));

            let explicit_style = caps.name("style").map(|s| s.as_str().to_lowercase());
            let mapped_style = self.config.outfit_to_style.get(&outfit_id).cloned();

            let (style_tag, confidence) = match (explicit_style, mapped_style) {
                (Some(exp), Some(mapped)) => {
                    if exp == mapped {
                        evidence.push(format!("Explicit style '{}' matches known mapping", exp));
                        (Some(exp), MatchConfidence::Exact)
                    } else {
                        (Some(exp), MatchConfidence::High)
                    }
                }
                (Some(exp), None) => (Some(exp), MatchConfidence::High),
                (None, Some(mapped)) => (Some(mapped), MatchConfidence::High),
                (None, None) => (None, MatchConfidence::High),
            };

            return Ok(ParsedIdentity {
                character_id: char_id,
                outfit_id,
                style_tag,
                confidence,
                evidence,
                source_stem: name.to_string(),
            });
        }

        // No match
        Err(DomainError::AmbiguousNaming {
            code: ErrorCode::ErrAmbiguousNaming,
            name: name.to_string(),
            reason: "Does not contain standard 5-digit character ID and 3-digit outfit ID".to_string(),
        })
    }
}
