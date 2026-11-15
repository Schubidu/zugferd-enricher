//! Small direct WebAssembly C-ABI adapter to a pure-Rust fastText inference library.
//! No Emscripten, wasm-bindgen, generated JS glue, eval or Function constructor.

use fasttext_pure_rs::FastText;
use std::io::Cursor;
use std::sync::OnceLock;

static MODEL: OnceLock<FastText> = OnceLock::new();

#[unsafe(no_mangle)]
pub extern "C" fn ft_alloc(length: usize) -> *mut u8 {
    if length == 0 || length > 2_000_000 {
        return std::ptr::null_mut();
    }
    let bytes = vec![0u8; length].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ft_free(ptr: *mut u8, length: usize) {
    if !ptr.is_null() && length > 0 {
        let slice = std::ptr::slice_from_raw_parts_mut(ptr, length);
        unsafe { drop(Box::from_raw(slice)) };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn ft_load(ptr: *const u8, length: usize) -> i32 {
    if ptr.is_null() || length == 0 || length > 1_048_576 {
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, length) };
    match FastText::load_from_reader(Cursor::new(bytes)) {
        Ok(model) => {
            if MODEL.set(model).is_ok() { 1 } else { 2 }
        }
        Err(_) => -2,
    }
}

fn category_id(label: &str) -> u32 {
    match label {
        "__label__accommodation" => 1,
        "__label__food" => 2,
        "__label__beverage" => 3,
        "__label__parking" => 4,
        "__label__city_tax" => 5,
        "__label__bundle" => 6,
        "__label__other" => 7,
        _ => 0,
    }
}

/// Write two predictions into exactly 16 bytes, each [u32 category, f32 probability]
/// in little-endian layout. Never hold stale memory views after JS allocations.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ft_predict(
    input_ptr: *const u8, input_length: usize, result_ptr: *mut u8,
) -> i32 {
    if input_ptr.is_null() || result_ptr.is_null() || input_length == 0 || input_length > 8192 {
        return -1;
    }
    let model = match MODEL.get() {
        Some(value) => value,
        None => return -2,
    };
    let input_bytes = unsafe { std::slice::from_raw_parts(input_ptr, input_length) };
    let text = match std::str::from_utf8(input_bytes) {
        Ok(value) => value,
        Err(_) => return -3,
    };
    let predictions = match model.predict(text, 2, 0.0) {
        Ok(value) => value,
        Err(_) => return -4,
    };
    let output = unsafe { std::slice::from_raw_parts_mut(result_ptr, 16) };
    output.fill(0);
    for (index, prediction) in predictions.iter().take(2).enumerate() {
        let offset = index * 8;
        output[offset..offset + 4].copy_from_slice(&category_id(&prediction.label).to_le_bytes());
        output[offset + 4..offset + 8].copy_from_slice(&prediction.probability.to_le_bytes());
    }
    predictions.len().min(2) as i32
}
