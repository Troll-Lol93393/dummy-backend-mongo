// Polyfill browser APIs required by pdfjs-dist (used by pdf-parse) in Node.js
// This file is preloaded via --require before any application code runs.
const g = globalThis as Record<string, unknown>;
if (!g["DOMMatrix"]) {
    g["DOMMatrix"] = class DOMMatrix {};
}
if (!g["ImageData"]) {
    g["ImageData"] = class ImageData {};
}
if (!g["Path2D"]) {
    g["Path2D"] = class Path2D {};
}
