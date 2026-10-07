import React, { forwardRef, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

const ImageSlider = forwardRef(
  /**
   * @param {{ images: (string | { src: string, position?: string })[], interval?: number, className?: string }} props
   * @param {React.ForwardedRef<HTMLDivElement>} ref
   */
  ({ images, interval = 4000, className, ...props }, ref) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const slides = images.map((img) =>
    typeof img === "string" ? { src: img, position: "50% 50%" } : { position: "50% 50%", ...img }
  );

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, interval);
    return () => clearInterval(timer);
  }, [slides.length, interval]);

  return (
    <div
      ref={ref}
      className={cn("relative w-full h-full overflow-hidden bg-background", className)}
      {...props}
    >
      <AnimatePresence initial={false}>
        <motion.img
          key={currentIndex}
          src={slides[currentIndex].src}
          alt={`Slide ${currentIndex + 1}`}
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="absolute top-0 left-0 w-full h-full object-cover"
          style={{ objectPosition: slides[currentIndex].position }}
        />
      </AnimatePresence>
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setCurrentIndex(index)}
              className={cn(
                "w-2 h-2 rounded-full transition-colors duration-300",
                currentIndex === index ? "bg-white" : "bg-white/50 hover:bg-white"
              )}
              aria-label={`Ir para o slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

ImageSlider.displayName = "ImageSlider";

export { ImageSlider };
