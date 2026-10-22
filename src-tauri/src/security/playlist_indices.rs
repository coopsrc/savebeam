use std::collections::BTreeSet;

use crate::domain::error::{AppError, ErrorCode};

pub fn validate_indices(indices: &[u32]) -> Result<Vec<u32>, AppError> {
    let selected: BTreeSet<_> = indices.iter().copied().collect();
    if selected.is_empty()
        || selected.len() > 50
        || selected.len() != indices.len()
        || selected.iter().any(|index| !(1..=50).contains(index))
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "请选择 1 到 50 范围内不重复的系列条目。",
            false,
        ));
    }
    Ok(selected.into_iter().collect())
}
