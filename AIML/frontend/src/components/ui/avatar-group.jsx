"use client" 

import * as React from "react"
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const AvatarGroup = ({
  avatars,
  maxVisible = 5,
  size = 40,
  overlap = 14,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const visibleAvatars = avatars.slice(0, maxVisible);
  const extraCount = avatars.length - maxVisible;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-3">
        {visibleAvatars.map((avatar, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <div
              key={idx}
              className="border-4 border-background rounded-full bg-background transition-all duration-300 relative"
              style={{
                width: size,
                height: size,
                zIndex: isHovered ? 100 : visibleAvatars.length - idx,
                marginLeft: idx === 0 ? 0 : -overlap,
                position: "relative",
                transition:
                  "margin-left 0.3s cubic-bezier(0.4,0,0.2,1), z-index 0s, box-shadow 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1)",
                transform: isHovered ? "translateY(-10px)" : "translateY(0)",
              }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <img
                src={avatar.src}
                alt={avatar.alt || `Avatar ${idx + 1}`}
                width={size}
                height={size}
                className="rounded-full object-cover size-full"
                draggable={false}
              />
              <AnimatePresence>
                {isHovered && avatar.label && (
                  <motion.div
                    key="tooltip"
                    initial={{
                      x: "-50%",
                      y: 10,
                      opacity: 0,
                      scale: 0.7,
                    }}
                    animate={{
                      x: "-50%", 
                      y: 0,
                      opacity: 1,
                      scale: 1,
                    }}
                    exit={{
                      x: "-50%",
                      y: 10,
                      opacity: 0,
                      scale: 0.7,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 24,
                    }}
                    className="absolute z-50 px-2 py-1 bg-primary text-primary-foreground text-[10px] rounded shadow-lg whitespace-nowrap pointer-events-none font-bold uppercase tracking-wider"
                    style={{
                      top: -size * 0.7,
                      left: "50%",
                    }}
                  >
                    {avatar.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {extraCount > 0 && (
          <div
            className="flex items-center justify-center bg-primary text-primary-foreground font-bold border-4 border-background rounded-full"
            style={{
              width: size,
              height: size,
              marginLeft: -overlap,
              zIndex: 0,
              fontSize: size * 0.32,
              transition: "margin-left 0.3s cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            +{extraCount}
          </div>
        )}
      </div>
    </div>
  );
};

export { AvatarGroup };
