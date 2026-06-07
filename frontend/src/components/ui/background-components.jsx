"use client";

import { cn } from '../../lib/utils.js';

export const SunnyGlowBackground = ({ children, className }) => {
  return (
    <div className={cn("min-h-screen w-full relative bg-white overflow-hidden", className)}>
      {/* Sunny Glow Background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at center, #fde047, transparent)
          `,
          opacity: 0.6,
        }}
      />
      {/* Soft Yellow Glow Overlay */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at center, #FFF991 0%, transparent 70%)
          `,
          opacity: 0.4,
          mixBlendMode: "multiply",
        }}
      />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};

export default SunnyGlowBackground;
