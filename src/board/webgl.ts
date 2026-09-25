/** True when the browser can create a WebGL context (the 3D board needs one). */
export function webglAvailable(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // don't hold one of the browser's few contexts
    return true;
  } catch {
    return false;
  }
}
