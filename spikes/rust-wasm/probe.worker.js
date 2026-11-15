// Isolated probe: test direct Rust WebAssembly under a strict CSP in real WebKit.
self.onmessage = async () => {
  try {
    const wasmResponse = await fetch("/models/fasttext-rust-v1.wasm");
    if (!wasmResponse.ok) throw new Error("WASM HTTP "+wasmResponse.status);
    const { instance } = await WebAssembly.instantiateStreaming(wasmResponse, {});
    const exports = instance.exports;
    const fileResponse = await fetch("/models/invoice-categories-v1.ftz");
    if (!fileResponse.ok) throw new Error("MODEL HTTP "+fileResponse.status);
    const model = new Uint8Array(await fileResponse.arrayBuffer());
    let ptr=exports.ft_alloc(model.length);
    if (!ptr) throw new Error("model allocation failed");
    new Uint8Array(exports.memory.buffer,ptr,model.length).set(model);
    const loaded=exports.ft_load(ptr,model.length);
    exports.ft_free(ptr,model.length);
    if (loaded !== 1) throw new Error("model parsing failed: "+loaded);
    const encoder = new TextEncoder();
    const data = encoder.encode("cappuccino bar");
    ptr=exports.ft_alloc(data.length);
    if (!ptr) throw new Error("input allocation failed");
    new Uint8Array(exports.memory.buffer,ptr,data.length).set(data);
    const out = exports.ft_alloc(16);
    if (!out) throw new Error("output allocation failed");
    const count=exports.ft_predict(ptr,data.length,out);
    const result = [];
    const dv = new DataView(exports.memory.buffer, out, 16);
    for (let i=0;i<Math.min(count,2);i++) {
      result.push({category:dv.getUint32(8*i,true),probability:dv.getFloat32(8*i+4,true)});
    }
    exports.ft_free(ptr,data.length);
    exports.ft_free(out,16);
    self.postMessage({ok:true,loaded,count,predictions:result,wasmBytes:(await (await fetch("/models/fasttext-rust-v1.wasm")).arrayBuffer()).byteLength});
  } catch(error) {
    self.postMessage({ok:false,name:error?.name,message:String(error?.message||error).slice(0,450)});
  }
};
