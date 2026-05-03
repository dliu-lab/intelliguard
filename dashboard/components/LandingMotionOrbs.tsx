"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const particleSeeds = [
  { x: 7, y: 44, size: 3, depth: 18, delay: 0 },
  { x: 10, y: 60, size: 2, depth: 26, delay: 0.7 },
  { x: 16, y: 51, size: 2, depth: 16, delay: 1.2 },
  { x: 28, y: 34, size: 2, depth: -20, delay: 0.3 },
  { x: 36, y: 73, size: 3, depth: 28, delay: 1.6 },
  { x: 52, y: 63, size: 2, depth: -26, delay: 0.5 },
  { x: 63, y: 28, size: 2, depth: 20, delay: 1.1 },
  { x: 71, y: 76, size: 3, depth: -16, delay: 0.9 },
  { x: 82, y: 58, size: 2, depth: 24, delay: 1.9 },
  { x: 92, y: 49, size: 2, depth: -22, delay: 0.4 },
  { x: 76, y: 38, size: 1.5, depth: 30, delay: 1.4 },
  { x: 44, y: 22, size: 1.5, depth: -18, delay: 2.1 },
];

export function LandingMotionOrbs() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      setPointer({
        x: event.clientX / window.innerWidth - 0.5,
        y: event.clientY / window.innerHeight - 0.5,
      });
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        setPointer({ x: 0, y: 0 });
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="hero-backdrop absolute inset-0" />
      <div className="hero-backdrop-ambient absolute inset-0" />
      <motion.div
        className="hero-orb-primary absolute -left-[18vw] -top-[28vw] h-[62vw] w-[62vw] rounded-full border border-accent/30 blur-[0.2px]"
        style={{ x: pointer.x * -22, y: pointer.y * -16 }}
      />
      <motion.div
        className="hero-orb-horizon absolute -bottom-[37vw] -left-[10vw] h-[66vw] w-[86vw] rounded-[50%] border-t border-accent/70 shadow-[0_-18px_90px_rgba(0,200,150,0.3)]"
        style={{ x: pointer.x * 30, y: pointer.y * 18, rotate: 7 }}
      />
      <div className="absolute inset-0 h-full bg-[linear-gradient(22deg,transparent_0%,rgba(0,200,150,0.06)_46%,transparent_47%),linear-gradient(19deg,transparent_0%,rgba(255,255,255,0.035)_42%,transparent_43%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,200,150,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:210px_100%,56px_56px] opacity-45" />
      <div className="absolute left-[9%] top-[12%] h-[65%] w-px bg-gradient-to-b from-transparent via-accent/35 to-transparent" />
      <div className="absolute left-[24%] top-[22%] h-[48%] w-px bg-gradient-to-b from-transparent via-accent/25 to-transparent" />
      <div className="absolute right-[10%] top-[45%] h-[42%] w-px bg-gradient-to-b from-transparent via-accent/25 to-transparent" />

      {particleSeeds.map((particle) => (
        <motion.span
          key={`${particle.x}-${particle.y}`}
          className="absolute rounded-full bg-accent shadow-[0_0_16px_rgba(0,200,150,0.8)]"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            x: pointer.x * particle.depth,
            y: pointer.y * particle.depth,
          }}
          animate={{ opacity: [0.25, 0.85, 0.25], scale: [1, 1.7, 1] }}
          transition={{ duration: 3.5 + particle.delay, delay: particle.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

    </div>
  );
}
