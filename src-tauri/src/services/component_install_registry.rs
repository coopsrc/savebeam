//! In-memory cancellation handles for component install/update jobs.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{
    domain::{
        component::ComponentKind,
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::CancellationToken,
};

#[derive(Clone, Default)]
pub struct ComponentInstallRegistry {
    active: Arc<Mutex<HashMap<ComponentKind, CancellationToken>>>,
}

impl ComponentInstallRegistry {
    pub fn begin(&self, kind: ComponentKind) -> Result<CancellationToken, AppError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "组件安装状态暂时不可用。", true))?;
        if active.contains_key(&kind) {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "该组件正在安装或更新。",
                false,
            ));
        }
        let token = CancellationToken::default();
        active.insert(kind, token.clone());
        Ok(token)
    }

    pub fn cancel(&self, kind: ComponentKind) -> Result<(), AppError> {
        let active = self
            .active
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "组件安装状态暂时不可用。", true))?;
        if let Some(token) = active.get(&kind) {
            token.cancel();
        }
        Ok(())
    }

    pub fn finish(&self, kind: ComponentKind) -> Result<(), AppError> {
        self.active
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "组件安装状态暂时不可用。", true))?
            .remove(&kind);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::ComponentInstallRegistry;
    use crate::domain::component::ComponentKind;

    #[test]
    fn rejects_duplicate_installs_and_cancels_the_active_token() {
        let registry = ComponentInstallRegistry::default();
        let token = registry.begin(ComponentKind::YtDlp).unwrap();
        assert!(registry.begin(ComponentKind::YtDlp).is_err());
        registry.cancel(ComponentKind::YtDlp).unwrap();
        assert!(token.is_cancelled());
        registry.finish(ComponentKind::YtDlp).unwrap();
        assert!(registry.begin(ComponentKind::YtDlp).is_ok());
    }
}
