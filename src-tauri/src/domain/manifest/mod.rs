use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::domain::error::{DomainError, ErrorCode};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct Model3FileReferences {
    pub moc: String,
    pub textures: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physics: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_info: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct Model3Manifest {
    pub version: u32,
    pub file_references: Model3FileReferences,
}

impl Model3Manifest {
    pub fn new_minimal(moc_relative_path: &str, texture_relative_paths: &[String]) -> Result<Self, DomainError> {
        // Validate that no path is absolute or attempts path traversal
        Self::validate_relative_path(moc_relative_path)?;
        for tex in texture_relative_paths {
            Self::validate_relative_path(tex)?;
        }

        Ok(Self {
            version: 3,
            file_references: Model3FileReferences {
                moc: moc_relative_path.to_string(),
                textures: texture_relative_paths.to_vec(),
                physics: None,
                pose: None,
                display_info: None,
                user_data: None,
            },
        })
    }

    pub fn to_json_pretty(&self) -> Result<String, DomainError> {
        serde_json::to_string_pretty(self).map_err(|e| DomainError::ManifestInvalid {
            code: ErrorCode::ErrManifestInvalid,
            manifest_path: std::path::PathBuf::from("manifest.json"),
            reason: format!("Failed to serialize manifest: {}", e),
        })
    }

    pub fn from_json_str(content: &str) -> Result<Self, DomainError> {
        serde_json::from_str(content).map_err(|e| DomainError::ManifestInvalid {
            code: ErrorCode::ErrManifestInvalid,
            manifest_path: std::path::PathBuf::from("manifest.json"),
            reason: format!("Failed to parse manifest: {}", e),
        })
    }

    fn validate_relative_path(path_str: &str) -> Result<(), DomainError> {
        let p = Path::new(path_str);
        if p.is_absolute() {
            return Err(DomainError::PathTraversalDetected {
                code: ErrorCode::ErrPathTraversalDetected,
                path: p.to_path_buf(),
            });
        }
        for component in p.components() {
            if let std::path::Component::ParentDir = component {
                return Err(DomainError::PathTraversalDetected {
                    code: ErrorCode::ErrPathTraversalDetected,
                    path: p.to_path_buf(),
                });
            }
            if let std::path::Component::Prefix(_) = component {
                return Err(DomainError::PathTraversalDetected {
                    code: ErrorCode::ErrPathTraversalDetected,
                    path: p.to_path_buf(),
                });
            }
            if let std::path::Component::RootDir = component {
                return Err(DomainError::PathTraversalDetected {
                    code: ErrorCode::ErrPathTraversalDetected,
                    path: p.to_path_buf(),
                });
            }
        }
        Ok(())
    }
}
