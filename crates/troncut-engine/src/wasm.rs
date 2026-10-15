//! Versioned numeric ABI with no raw input pointers or unsafe memory access.
//! Results may be read from linear memory until the next query/free.
use super::{Interval, TimelineIndex};
use std::{cell::RefCell, collections::BTreeMap};

#[derive(Default)]
struct Registry {
    next: u32,
    indices: BTreeMap<u32, TimelineIndex>,
}
thread_local! { static REGISTRY: RefCell<Registry> = RefCell::new(Registry::default()); }

#[no_mangle]
pub extern "C" fn engine_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn index_new() -> u32 {
    REGISTRY.with_borrow_mut(|registry| {
        let Some(next) = registry.next.checked_add(1) else {
            return 0;
        };
        registry.next = next;
        registry.indices.insert(next, TimelineIndex::default());
        next
    })
}

#[no_mangle]
pub extern "C" fn index_free(handle: u32) {
    REGISTRY.with_borrow_mut(|registry| {
        registry.indices.remove(&handle);
    });
}

#[no_mangle]
pub extern "C" fn index_add(handle: u32, id: u32, track: u32, start: f64, end: f64) -> bool {
    REGISTRY.with_borrow_mut(|registry| {
        registry.indices.get_mut(&handle).is_some_and(|index| {
            index.add(Interval {
                id,
                track,
                start,
                end,
            })
        })
    })
}

#[no_mangle]
pub extern "C" fn index_build(handle: u32) {
    REGISTRY.with_borrow_mut(|registry| {
        if let Some(index) = registry.indices.get_mut(&handle) {
            index.build();
        }
    });
}

#[no_mangle]
pub extern "C" fn index_query(handle: u32, start: f64, end: f64, track: i32, closed: bool) -> u32 {
    REGISTRY.with_borrow_mut(|registry| {
        registry.indices.get_mut(&handle).map_or(0, |index| {
            index
                .query(start, end, (track >= 0).then_some(track as u32), closed)
                .len() as u32
        })
    })
}

#[no_mangle]
pub extern "C" fn index_results_ptr(handle: u32) -> usize {
    REGISTRY.with_borrow(|registry| {
        registry
            .indices
            .get(&handle)
            .map_or(0, |index| index.results.as_ptr() as usize)
    })
}
