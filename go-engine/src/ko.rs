use serde::{Deserialize, Serialize};

use crate::stone::Stone;

/// Ko status tracking. When a ko exists, the locked point and the stone color that cannot play there are recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ko {
    pub pos: (i8, i8),
    pub illegal: Stone,
}
