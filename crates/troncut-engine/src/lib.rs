//! Editing queries shared by React/Wasm and future native workers.
//! No UI, OS, decoder or third-party runtime dependencies belong here.
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug)]
pub struct Interval {
    pub id: u32,
    pub track: u32,
    pub start: f64,
    pub end: f64,
}

#[derive(Default)]
struct Tree {
    intervals: Vec<Interval>,
    max_end: Vec<f64>,
}

impl Tree {
    fn build(&mut self) {
        self.intervals
            .sort_unstable_by(|a, b| a.start.total_cmp(&b.start).then(a.id.cmp(&b.id)));
        self.max_end.resize(self.intervals.len(), 0.0);
        self.build_range(0, self.intervals.len());
    }

    fn build_range(&mut self, lo: usize, hi: usize) -> f64 {
        if lo == hi {
            return f64::NEG_INFINITY;
        }
        let mid = lo + (hi - lo) / 2;
        let max = self.intervals[mid]
            .end
            .max(self.build_range(lo, mid))
            .max(self.build_range(mid + 1, hi));
        self.max_end[mid] = max;
        max
    }

    fn query(&self, lo: usize, hi: usize, start: f64, end: f64, closed: bool, out: &mut Vec<u32>) {
        if lo == hi {
            return;
        }
        let mid = lo + (hi - lo) / 2;
        let node = self.intervals[mid];
        if self.max_end[mid] < start || (!closed && self.max_end[mid] == start) {
            return;
        }
        self.query(lo, mid, start, end, closed, out);
        if node.start > end || (!closed && start != end && node.start == end) {
            return;
        }
        if node.end > start || (closed && node.end == start) {
            out.push(node.id);
        }
        self.query(mid + 1, hi, start, end, closed, out);
    }
}

/// Static augmented interval trees, rebuilt after edits, not on playback ticks.
/// Results use original clip indices to preserve existing paint order.
#[derive(Default)]
pub struct TimelineIndex {
    trees: BTreeMap<u32, Tree>,
    results: Vec<u32>,
    built: bool,
}

impl TimelineIndex {
    pub fn add(&mut self, interval: Interval) -> bool {
        if !interval.start.is_finite() || !interval.end.is_finite() || interval.end < interval.start
        {
            return false;
        }
        self.trees
            .entry(interval.track)
            .or_default()
            .intervals
            .push(interval);
        self.built = false;
        true
    }

    pub fn build(&mut self) {
        for tree in self.trees.values_mut() {
            tree.build();
        }
        self.built = true;
    }

    /// Point queries exclude the clip's right endpoint unless `closed` is true.
    /// Closed viewport queries match legacy timeline culling at both edges.
    pub fn query(&mut self, start: f64, end: f64, track: Option<u32>, closed: bool) -> &[u32] {
        self.results.clear();
        if !self.built || !start.is_finite() || !end.is_finite() || end < start {
            return &self.results;
        }
        if let Some(track) = track {
            if let Some(tree) = self.trees.get(&track) {
                tree.query(
                    0,
                    tree.intervals.len(),
                    start,
                    end,
                    closed,
                    &mut self.results,
                );
            }
        } else {
            for tree in self.trees.values() {
                tree.query(
                    0,
                    tree.intervals.len(),
                    start,
                    end,
                    closed,
                    &mut self.results,
                );
            }
        }
        self.results.sort_unstable();
        &self.results
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_tracks_and_order() {
        let mut index = TimelineIndex::default();
        for (id, track, start, end) in [(8, 1, -1.0, 4.0), (2, 0, 2.0, 3.0), (5, 0, 3.0, 6.0)] {
            assert!(index.add(Interval {
                id,
                track,
                start,
                end
            }));
        }
        index.build();
        assert_eq!(index.query(3.0, 3.0, None, false), &[5, 8]);
        assert_eq!(index.query(3.0, 3.0, Some(0), true), &[2, 5]);
        assert_eq!(index.query(2.0, 3.0, Some(0), false), &[2]);
        assert_eq!(index.query(6.0, 7.0, None, false), &[]);
        assert_eq!(index.query(4.0, 1.0, None, true), &[]);
        assert_eq!(index.query(f64::NAN, 4.0, None, true), &[]);
        assert!(!index.add(Interval {
            id: 9,
            track: 0,
            start: 0.0,
            end: f64::INFINITY
        }));
    }

    #[test]
    fn randomized_queries_match_linear_oracle_with_long_overlaps() {
        let mut seed = 23u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (seed >> 32) as u32
        };
        let intervals: Vec<_> = (0..10_000)
            .map(|id| {
                let start = f64::from(next() % 100_000) / 100.0;
                Interval {
                    id,
                    track: next() % 32,
                    start,
                    end: start + f64::from(next() % 50_000) / 100.0,
                }
            })
            .collect();
        let mut index = TimelineIndex::default();
        for interval in &intervals {
            assert!(index.add(*interval));
        }
        index.build();
        for i in 0..1000 {
            let start = f64::from(next() % 100_000) / 100.0;
            let end = start + if i % 2 == 0 { 0.0 } else { 20.0 };
            let track = if i % 3 == 0 { Some(next() % 32) } else { None };
            let closed = i % 2 == 0;
            let expected: Vec<_> = intervals
                .iter()
                .filter(|v| {
                    track.is_none_or(|t| v.track == t)
                        && (v.start < end || ((closed || start == end) && v.start == end))
                        && (v.end > start || (closed && v.end == start))
                })
                .map(|v| v.id)
                .collect();
            assert_eq!(index.query(start, end, track, closed), expected);
        }
    }
}
