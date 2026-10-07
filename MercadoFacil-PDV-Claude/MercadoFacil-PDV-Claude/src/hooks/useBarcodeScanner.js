import { useEffect, useRef, useCallback } from "react";

// Hook that detects barcode scanner input globally.
// USB barcode scanners type characters very fast (typically < 50ms between keys)
// and end with Enter. This distinguishes scanner input from human typing.
//
// Usage:
//   useBarcodeScanner((code) => { console.log("Scanned:", code); });
//
// Options:
//   minLength: minimum characters to consider a valid barcode (default 3)
//   maxKeyInterval: max ms between keys to be considered scanner input (default 50)
export function useBarcodeScanner(onScan, options = {}) {
  const { minLength = 3, maxKeyInterval = 50 } = options;
  const buffer = useRef("");
  const lastKeyTime = useRef(0);
  const callbackRef = useRef(onScan);
  callbackRef.current = onScan;

  // Check if focus is on an input/textarea — if so, don't intercept (let it type normally)
  const isTypingInInput = useCallback(() => {
    const el = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept if user is typing in an input field
      if (isTypingInInput()) {
        buffer.current = "";
        return;
      }

      const now = Date.now();
      const elapsed = now - lastKeyTime.current;
      lastKeyTime.current = now;

      // If too much time passed, reset buffer (human typing)
      if (elapsed > maxKeyInterval && buffer.current.length > 0) {
        buffer.current = "";
      }

      // Enter key = end of barcode
      if (e.key === "Enter") {
        if (buffer.current.length >= minLength) {
          e.preventDefault();
          callbackRef.current(buffer.current);
        }
        buffer.current = "";
        return;
      }

      // Only collect printable characters
      if (e.key.length === 1) {
        buffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [minLength, maxKeyInterval, isTypingInInput]);
}