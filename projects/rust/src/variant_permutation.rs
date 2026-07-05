use std::collections::{HashMap, HashSet};

use crate::{Error, Result};

/// Generates non-empty variant combinations while excluding opposite pairs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantPermutation {
    values: Vec<String>,
    opposites: Vec<(usize, usize)>,
    generated: Vec<String>,
}

impl VariantPermutation {
    pub fn new(
        values: impl IntoIterator<Item = impl Into<String>>,
        opposites: impl IntoIterator<Item = (usize, usize)>,
    ) -> Result<Self> {
        let values = values.into_iter().map(Into::into).collect::<Vec<_>>();
        let opposites = opposites.into_iter().collect::<Vec<_>>();
        if values.is_empty()
            || values
                .iter()
                .any(|value| value.is_empty() || value.contains(','))
            || values.iter().collect::<HashSet<_>>().len() != values.len()
        {
            return Err(Error::Schema(
                "permutation values must be unique non-empty strings without commas".into(),
            ));
        }
        if values.len() >= usize::BITS as usize
            || opposites.iter().any(|(left, right)| {
                left == right || *left >= values.len() || *right >= values.len()
            })
        {
            return Err(Error::Schema("invalid permutation opposite indexes".into()));
        }
        let mut result = Self {
            values,
            opposites,
            generated: Vec::new(),
        };
        result.generated = result.generate_inner();
        Ok(result)
    }

    pub fn wasd() -> Self {
        Self::new(["W", "A", "S", "D"], [(0, 2), (1, 3)]).expect("valid WASD permutation")
    }

    pub fn arrows() -> Self {
        Self::new(["Up", "Left", "Down", "Right"], [(0, 2), (1, 3)])
            .expect("valid arrow permutation")
    }

    pub fn values(&self) -> &[String] {
        &self.values
    }

    pub fn generate(&self) -> &[String] {
        &self.generated
    }

    pub fn resolve_flags(&self, flags: &[bool]) -> Result<String> {
        if flags.len() != self.values.len() {
            return Err(Error::Value(format!(
                "variant permutation requires {} boolean flags",
                self.values.len()
            )));
        }
        let enabled = self
            .values
            .iter()
            .zip(flags)
            .filter_map(|(value, enabled)| enabled.then_some(value.as_str()))
            .collect::<HashSet<_>>();
        self.resolve_enabled(&enabled)
    }

    pub fn resolve_map(&self, flags: &HashMap<String, bool>) -> Result<String> {
        if flags.len() != self.values.len() || flags.keys().any(|key| !self.values.contains(key)) {
            return Err(Error::Value(
                "variant permutation map must define every known key".into(),
            ));
        }
        let enabled = self
            .values
            .iter()
            .filter_map(|value| flags[value].then_some(value.as_str()))
            .collect::<HashSet<_>>();
        self.resolve_enabled(&enabled)
    }

    pub fn expand(&self, variant: &str) -> Result<HashMap<String, bool>> {
        if !variant.is_empty() && !self.generated.iter().any(|candidate| candidate == variant) {
            return Err(Error::Value(format!(
                "unknown generated permutation: {variant}"
            )));
        }
        let enabled = variant
            .split(',')
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        Ok(self
            .values
            .iter()
            .map(|value| (value.clone(), enabled.contains(value.as_str())))
            .collect())
    }

    fn resolve_enabled(&self, enabled: &HashSet<&str>) -> Result<String> {
        if enabled.is_empty() {
            return Ok(String::new());
        }
        self.generated
            .iter()
            .find(|variant| {
                let selected = variant.split(',').collect::<HashSet<_>>();
                selected == *enabled
            })
            .cloned()
            .ok_or_else(|| Error::Value("permutation contains an opposite combination".into()))
    }

    fn generate_inner(&self) -> Vec<String> {
        let mut group_order = HashMap::new();
        for (group, (left, right)) in self.opposites.iter().enumerate() {
            group_order.entry(*left).or_insert(group);
            group_order.entry(*right).or_insert(group);
        }
        let mut next_group = self.opposites.len();
        for index in 0..self.values.len() {
            group_order.entry(index).or_insert_with(|| {
                let group = next_group;
                next_group += 1;
                group
            });
        }
        let mut variants = Vec::new();
        for mask in 1_usize..(1_usize << self.values.len()) {
            let mut indexes = (0..self.values.len())
                .filter(|index| mask & (1 << index) != 0)
                .collect::<Vec<_>>();
            if self
                .opposites
                .iter()
                .any(|(left, right)| indexes.contains(left) && indexes.contains(right))
            {
                continue;
            }
            indexes.sort_by_key(|index| (group_order[index], *index));
            variants.push((
                indexes.clone(),
                indexes
                    .iter()
                    .map(|index| self.values[*index].as_str())
                    .collect::<Vec<_>>()
                    .join(","),
            ));
        }
        variants.sort_by(|(left, _), (right, _)| {
            left.len().cmp(&right.len()).then_with(|| left.cmp(right))
        });
        variants.into_iter().map(|(_, variant)| variant).collect()
    }
}
